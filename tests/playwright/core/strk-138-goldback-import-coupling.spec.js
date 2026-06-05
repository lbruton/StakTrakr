/**
 * STRK-138 — Numista Goldback misclassification / Type-drives-Metal coupling.
 *
 * TDD: these tests assert the TARGET behavior (Approach C) and are expected to
 * FAIL until the implementation tasks land:
 *  - Type drives Metal (Goldback/Silverback always selectable; selecting one
 *    sets Metal + weight unit + rebuilds the denomination picker).
 *  - Numista import detects Goldback/Silverback and runs the same reconciliation
 *    a manual change would, so the filled form is identical to a correct manual
 *    entry (no re-selection / re-search).
 *  - parseGoldbackDenomination() exact-match fraction parsing.
 *  - Regression: non-goldback import and editing existing items are unchanged.
 *
 * Requirement → test mapping is noted inline on each `test(...)` title.
 */

import { test, expect } from "../helpers/mocks/extended-test.js";

const ITEM_UUID = "strk138-base-item";
const CATALOG_ID = "999138";

const BASE_ITEM = {
  uuid: ITEM_UUID,
  metal: "Silver",
  composition: "Silver",
  name: "STRK-138 Fixture Coin",
  qty: 1,
  type: "Coin",
  weight: 31.1,
  weightUnit: "g",
  price: 40,
  marketValue: 0,
  date: "2026-06-04",
  purchaseLocation: "StakTrakr",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2024",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 32,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: CATALOG_ID,
  serial: 1,
};

const GOLDBACK_ITEM = {
  ...BASE_ITEM,
  uuid: "strk138-goldback-item",
  name: "5 Idaho Goldback",
  metal: "Gold",
  composition: "Gold",
  type: "Goldback",
  weight: 5,
  weightUnit: "gb",
  numistaId: "999139",
  serial: 2,
};

// A *normalized* Numista result as passed to showNumistaResults([...]). The
// import-detection logic is responsible for classifying type/metal upstream; we
// assert the post-Fill form state matches a correct manual entry.
const COIN_RESULT = {
  name: "1 Dollar American Silver Eagle",
  catalogId: CATALOG_ID,
  country: "United States",
  denomination: "1 Dollar",
  year: "2024",
  metal: "Silver",
  type: "Coin",
  weight: 31.1,
  composition: "Silver",
};

const GOLDBACK_RESULT = {
  name: "1 Idaho Goldback",
  catalogId: "999139",
  country: "United States",
  denomination: "1 Idaho Goldback",
  year: "2023",
  metal: "Gold",
  type: "Goldback",
  weight: 0,
  composition: "Gold",
};

const GOLDBACK_FRACTION_RESULT = {
  ...GOLDBACK_RESULT,
  name: "1/4 Idaho Goldback",
  denomination: "1/4 Idaho Goldback",
};

const GOLDBACK_NO_DENOM_RESULT = {
  ...GOLDBACK_RESULT,
  name: "Idaho Goldback",
  denomination: "",
};

const SILVERBACK_RESULT = {
  name: "1 Silverback",
  catalogId: "999140",
  country: "United States",
  denomination: "1 Silverback",
  year: "2023",
  metal: "Silver",
  type: "Silverback",
  weight: 0,
  composition: "Silver",
};

async function seedData(page, opts = {}) {
  const { inventory = [BASE_ITEM], catalogConfigured = true } = opts;
  await page.addInitScript(
    ({ inv, configured }) => {
      localStorage.setItem("metalInventory", JSON.stringify(inv));
      localStorage.setItem("numistaViewFields", JSON.stringify({}));
      if (configured) {
        localStorage.setItem(
          "catalog_api_config",
          JSON.stringify({ numista: { apiKey: btoa("fake-test-key"), quota: 2000 } })
        );
      } else {
        localStorage.removeItem("catalog_api_config");
      }
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
        },
        { once: true }
      );
    },
    { inv: inventory, configured: catalogConfigured }
  );
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.editItem === "function" &&
      typeof window.showNumistaResults === "function" &&
      typeof window.handleTypeChange === "function" &&
      Array.isArray(window.inventory)
  );
  await page.evaluate(async () => {
    if (window.imageCache?.init) await window.imageCache.init();
  });
}

async function openAddForm(page) {
  // Mirror the production Add-mode reset (the #newItemBtn handler runs the same
  // reset/open sequence) — clear Metal/Type, run the type filter + reconciliation,
  // then open the modal. Matches the reliable openAddModal pattern used across the
  // core suite (inventory-crud).
  await page.waitForSelector("#newItemBtn", { state: "visible" });

  // The #itemType / #itemMetal change listeners are wired by setupEventListeners()
  // inside init.js's deferred Phase-14 setTimeout. selectOption() fires a *real*
  // change event, but if it lands before that listener attaches the production
  // reconciliation never runs (the listener-attach race behind STRK-138 test
  // flake). Probe deterministically: dispatch a Goldback change on #itemType and
  // wait until handleTypeChange's observable side-effect (weight unit -> "gb")
  // takes hold, which is only possible once the listener is live.
  await page.waitForFunction(
    () => {
      const type = document.getElementById("itemType");
      const unit = document.getElementById("itemWeightUnit");
      if (!(type instanceof HTMLElement) || !(unit instanceof HTMLElement)) return false;
      unit.value = "oz";
      type.value = "Goldback";
      type.dispatchEvent(new Event("change", { bubbles: true }));
      return unit.value === "gb";
    },
    undefined,
    { timeout: 10000 }
  );

  await page.evaluate(() => {
    document.getElementById("inventoryForm")?.reset();
    const metal = document.getElementById("itemMetal");
    const type = document.getElementById("itemType");
    if (metal) metal.value = "";
    if (type) type.value = "";
    const unit = document.getElementById("itemWeightUnit");
    if (unit) unit.value = "oz";
    if (typeof window.filterTypesByMetal === "function") window.filterTypesByMetal("");
    if (typeof window.handleTypeChange === "function") window.handleTypeChange();
    if (typeof window.openModalById === "function") {
      window.openModalById("itemModal");
    } else {
      document.getElementById("itemModal").style.display = "flex";
    }
  });
  await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });
}

async function openEditForm(page, index = 0) {
  await page.evaluate((idx) => window.editItem(idx), index);
  await expect(page.locator("#itemModal")).toBeVisible();
}

// Drive #itemType via Playwright selectOption, which auto-waits for
// actionability and dispatches a real change event — eliminating the race
// against init.js's deferred Phase-14 listener attach. Goldback/Silverback are
// always selectable since Task 1, so selectOption no longer throws.
async function setType(page, value) {
  await page.selectOption("#itemType", value);
}

async function setMetal(page, value) {
  await page.selectOption("#itemMetal", value);
}

// Open the Numista field picker against a pre-built (normalized) result.
async function openNumistaPicker(page, result) {
  await page.evaluate((r) => window.showNumistaResults([r], true, ""), result);
  await expect(page.locator("#numistaResultsModal")).toBeVisible();
  await expect(page.locator("#numistaFieldPicker")).toBeVisible();
}

async function fillFromPicker(page) {
  await page.locator("#numistaFillBtn").click();
  await expect(page.locator("#numistaFieldPicker")).not.toBeVisible();
}

async function formState(page) {
  return page.evaluate(() => {
    const get = (id) => {
      const el = document.getElementById(id);
      return el instanceof HTMLElement ? el.value : null;
    };
    return {
      type: get("itemType"),
      metal: get("itemMetal"),
      unit: get("itemWeightUnit"),
      gbDenom: get("itemGbDenom"),
    };
  });
}

test.describe("core/strk-138-goldback-import-coupling", () => {
  // -------------------------------------------------------------------------
  // Type-drives-Metal (Requirements 1, 2, 5)
  // -------------------------------------------------------------------------

  test("Add form: Goldback and Silverback are visible+enabled with Metal empty (Req 1.1, 1.3)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [] });
    await gotoApp(page);
    await openAddForm(page);

    const state = await page.evaluate(() => {
      const metal = document.getElementById("itemMetal");
      const type = document.getElementById("itemType");
      const opt = (val) => Array.from(type.options).find((o) => o.value === val);
      const gb = opt("Goldback");
      const sb = opt("Silverback");
      return {
        metalValue: metal.value,
        goldback: { exists: !!gb, hidden: gb?.hidden, disabled: gb?.disabled },
        silverback: { exists: !!sb, hidden: sb?.hidden, disabled: sb?.disabled },
      };
    });

    expect(state.metalValue).toBe("");
    expect(state.goldback.exists).toBe(true);
    expect(state.goldback.hidden).toBe(false);
    expect(state.goldback.disabled).toBe(false);
    expect(state.silverback.exists).toBe(true);
    expect(state.silverback.hidden).toBe(false);
    expect(state.silverback.disabled).toBe(false);
  });

  test("Edit form: Goldback and Silverback selectable regardless of stored Metal (Req 1.2)", async ({
    page,
  }) => {
    // Editing a Silver coin must still expose Goldback (a Gold-only type).
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openEditForm(page);

    const state = await page.evaluate(() => {
      const type = document.getElementById("itemType");
      const opt = (val) => Array.from(type.options).find((o) => o.value === val);
      const gb = opt("Goldback");
      const sb = opt("Silverback");
      return {
        metalValue: document.getElementById("itemMetal").value,
        goldbackHidden: gb?.hidden,
        goldbackDisabled: gb?.disabled,
        silverbackHidden: sb?.hidden,
        silverbackDisabled: sb?.disabled,
      };
    });

    expect(state.metalValue).toBe("Silver");
    expect(state.goldbackHidden).toBe(false);
    expect(state.goldbackDisabled).toBe(false);
    expect(state.silverbackHidden).toBe(false);
    expect(state.silverbackDisabled).toBe(false);
  });

  test("Selecting Type=Goldback drives Metal=Gold, unit=gb, denom picker present (Req 2.1, 2.3)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [] });
    await gotoApp(page);
    await openAddForm(page);

    await setType(page, "Goldback");

    const state = await formState(page);
    expect(state.type).toBe("Goldback");
    expect(state.metal).toBe("Gold");
    expect(state.unit).toBe("gb");

    // Denomination picker rebuilt + shown for Goldback.
    await expect(page.locator("#itemGbDenom")).toBeVisible();
    const denomOptionCount = await page.locator("#itemGbDenom option").count();
    expect(denomOptionCount).toBeGreaterThan(0);
  });

  test("Selecting Type=Silverback drives Metal=Silver, unit=sb (Req 2.2)", async ({ page }) => {
    await seedData(page, { inventory: [] });
    await gotoApp(page);
    await openAddForm(page);

    await setType(page, "Silverback");

    const state = await formState(page);
    expect(state.type).toBe("Silverback");
    expect(state.metal).toBe("Silver");
    expect(state.unit).toBe("sb");
  });

  test("Selecting a coin Type leaves Metal/unit on normal (non-gb) behavior (Req 2.4)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [] });
    await gotoApp(page);
    await openAddForm(page);

    await setType(page, "Coin");

    const state = await formState(page);
    expect(state.type).toBe("Coin");
    expect(state.unit).not.toBe("gb");
    expect(state.unit).not.toBe("sb");
  });

  test("Changing Metal to Silver while Goldback active resets Type — no Silver+Goldback (Req 5.1, 5.3)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [] });
    await gotoApp(page);
    await openAddForm(page);

    // Establish Type=Goldback (which should set Metal=Gold).
    await setType(page, "Goldback");
    let state = await formState(page);
    expect(state.type).toBe("Goldback");
    expect(state.metal).toBe("Gold");

    // Now force Metal=Silver — the incompatible combo must reconcile by
    // resetting Type back to the placeholder (no Silver+Goldback record).
    await setMetal(page, "Silver");

    state = await formState(page);
    expect(state.type).toBe("");
    expect(state.metal).toBe("Silver");
  });

  test("Changing Metal to Gold while Silverback active resets Type — no Gold+Silverback (Req 5.2)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [] });
    await gotoApp(page);
    await openAddForm(page);

    // Establish Type=Silverback (which should set Metal=Silver).
    await setType(page, "Silverback");
    let state = await formState(page);
    expect(state.type).toBe("Silverback");
    expect(state.metal).toBe("Silver");

    // Now force Metal=Gold — the incompatible combo must reconcile by
    // resetting Type back to the placeholder (no Gold+Silverback record).
    await setMetal(page, "Gold");

    state = await formState(page);
    expect(state.type).toBe("");
    expect(state.metal).toBe("Gold");
  });

  // -------------------------------------------------------------------------
  // Numista import detection (Requirement 3)
  // -------------------------------------------------------------------------

  test("normalizeType classifies Goldback from title text with Exonumia category (Req 3.1)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [] });
    await gotoApp(page);

    const type = await page.evaluate(() => {
      const provider = new window.NumistaProvider();
      return provider.normalizeType("Exonumia", "1/4 Idaho Goldback");
    });
    expect(type).toBe("Goldback");
  });

  test("normalizeType classifies Silverback from title text with Exonumia category (Req 3.2)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [] });
    await gotoApp(page);

    const type = await page.evaluate(() => {
      const provider = new window.NumistaProvider();
      return provider.normalizeType("Exonumia", "1 Silverback");
    });
    expect(type).toBe("Silverback");
  });

  test("Goldback Numista import fills Type=Goldback, Metal=Gold, unit=gb with no manual step (Req 3.3, 3.5)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [] });
    await gotoApp(page);
    await openAddForm(page);
    await openNumistaPicker(page, GOLDBACK_RESULT);
    await fillFromPicker(page);

    const state = await formState(page);
    expect(state.type).toBe("Goldback");
    expect(state.metal).toBe("Gold");
    expect(state.unit).toBe("gb");
  });

  test("Silverback Numista import fills Type=Silverback, Metal=Silver, unit=sb (Req 3.4)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [] });
    await gotoApp(page);
    await openAddForm(page);
    await openNumistaPicker(page, SILVERBACK_RESULT);
    await fillFromPicker(page);

    const state = await formState(page);
    expect(state.type).toBe("Silverback");
    expect(state.metal).toBe("Silver");
    expect(state.unit).toBe("sb");
  });

  // -------------------------------------------------------------------------
  // Fraction parsing (Requirement 4)
  // -------------------------------------------------------------------------

  test("parseGoldbackDenomination parses exact fractions and rejects non-matches (Req 4.1, 4.2, 4.3)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [] });
    await gotoApp(page);

    const results = await page.evaluate(() => {
      const fn = window.parseGoldbackDenomination;
      if (typeof fn !== "function") return { missing: true };
      return {
        missing: false,
        quarterSlash: fn("1/4"),
        quarterUnicode: fn("¼"),
        half: fn("1/2"),
        one: fn("1"),
        third: fn("1/3"),
        empty: fn(""),
      };
    });

    expect(results.missing).toBe(false);
    expect(results.quarterSlash).toBe(0.25);
    expect(results.quarterUnicode).toBe(0.25);
    expect(results.half).toBe(0.5);
    expect(results.one).toBe(1);
    expect(results.third).toBeNull();
    expect(results.empty).toBeNull();
  });

  test("Importing '1/4 Idaho Goldback' sets #itemGbDenom to 0.25 (Req 4.1)", async ({ page }) => {
    await seedData(page, { inventory: [] });
    await gotoApp(page);
    await openAddForm(page);
    await openNumistaPicker(page, GOLDBACK_FRACTION_RESULT);
    await fillFromPicker(page);

    const state = await formState(page);
    expect(state.type).toBe("Goldback");
    expect(state.gbDenom).toBe("0.25");
  });

  test("Importing a Goldback with no denomination leaves #itemGbDenom at '1' (Req 4.3)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [] });
    await gotoApp(page);
    await openAddForm(page);
    await openNumistaPicker(page, GOLDBACK_NO_DENOM_RESULT);
    await fillFromPicker(page);

    const state = await formState(page);
    expect(state.type).toBe("Goldback");
    expect(state.gbDenom).toBe("1");
  });

  // -------------------------------------------------------------------------
  // Regression (Requirement 6)
  // -------------------------------------------------------------------------

  test("Coin Numista import fills Type/Metal/unit unchanged from current behavior (Req 6.1)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [] });
    await gotoApp(page);
    await openAddForm(page);
    await openNumistaPicker(page, COIN_RESULT);
    await fillFromPicker(page);

    const state = await formState(page);
    expect(state.type).toBe("Coin");
    expect(state.metal).toBe("Silver");
    // Weight import sets unit to grams; never gb/sb for a coin.
    expect(state.unit).not.toBe("gb");
    expect(state.unit).not.toBe("sb");
  });

  test("Editing an existing Goldback item does not mutate stored Type/Metal/denomination (Req 6.2)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [GOLDBACK_ITEM] });
    await gotoApp(page);
    await openEditForm(page);

    const state = await formState(page);
    expect(state.type).toBe("Goldback");
    expect(state.metal).toBe("Gold");
    expect(state.unit).toBe("gb");
    expect(state.gbDenom).toBe("5");

    // Stored inventory record must be untouched by merely opening the editor.
    const stored = await page.evaluate(() => {
      const inv = window.inventory.find((i) => i.uuid === "strk138-goldback-item");
      return { type: inv.type, metal: inv.metal, weight: inv.weight, weightUnit: inv.weightUnit };
    });
    expect(stored.type).toBe("Goldback");
    expect(stored.metal).toBe("Gold");
    expect(stored.weight).toBe(5);
    expect(stored.weightUnit).toBe("gb");
  });
});

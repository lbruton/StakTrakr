// STRK-301 — collapsible add/edit form sections (restoration).
//
// The <details>/<summary> CSS machinery (css/styles.css "COLLAPSIBLE FORM
// SECTIONS" banner, .form-section-count pill) survived an earlier flattening
// of the markup to plain divs; this issue restores the markup and layers a
// remembered-state system on top. These tests pin the restored contract:
//
//   - every collapsible section is a real <details data-section="…"> — the
//     collapse mechanism is native, not JS;
//   - the Constitutional card is NOT collapsible (STRK-329) — it uses the
//     shared .form-section chrome but is a plain div, not <details>;
//   - first-visit defaults: Images open, everything else collapsed;
//   - per-section state persists in localStorage ("formSectionState") on
//     USER toggles only. The key is registered in ALLOWED_STORAGE_KEYS and
//     deliberately NOT in SYNC_SCOPE_KEYS — a device-local UI preference;
//   - precedence: remembered explicit choice > data-present-on-edit >
//     static default. The count badge is what makes remembered-closed safe:
//     data is never silently hidden;
//   - required-field audit: constraint validation on a control inside a
//     closed <details> throws Chrome's "not focusable" error and the form
//     silently no-ops, so no [required] may ever live inside a section.
//
// SUMMARY-EMBEDDED CONTROLS: the Constitutional header hosts the
// denomination/face chip toggle, and clone mode injects checkboxes into
// section headers. Clicking a nested interactive element activates THAT
// element, not the <summary> (HTML activation-behaviour rules) — one test
// pins this so a refactor that flattens the chip into plain spans (which
// WOULD toggle the section) gets caught.

import { test, expect } from "../helpers/mocks/extended-test.js";
import { suppressWhatsNewPopup } from "../helpers/seed.js";

const SECTION_KEYS = [
  "images",
  "grading",
  "marketPricing",
  "catalog",
  "notes",
  "attachments",
  "tags",
];

// Collapsed by default on first visit. Constitutional is asserted separately —
// its VISIBILITY is owned by the weight-unit toggle, its disclosure is open.
const DEFAULT_COLLAPSED = ["grading", "marketPricing", "catalog", "notes", "attachments", "tags"];

// Deliberately minimal — only the fields these tests exercise. editItem's
// populate path defaults every absent field, and a full-item literal here
// would just clone inventory-crud's seed.
const SEED_ITEM = {
  uuid: "strk301-seed-item",
  metal: "Silver",
  composition: "Silver",
  name: "STRK-301 Seed Coin",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 30,
  notes: "Bought at the local shop",
  purity: 0.999,
  serial: 1,
};

const SEED_TAGS = ["stack", "gift", "graded"];

/**
 * Seeds one inventory item (with notes and three tags), optionally a
 * remembered section-state map, and boots to a settled app.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {object|null} sectionState - Pre-seeded formSectionState map, or null
 * @returns {Promise<void>}
 */
async function seedAndGoto(page, sectionState = null) {
  await page.addInitScript(
    ({ item, tags, state }) => {
      localStorage.setItem("metalInventory", JSON.stringify([item]));
      localStorage.setItem("itemTags", JSON.stringify({ [item.uuid]: tags }));
      if (state) localStorage.setItem("formSectionState", JSON.stringify(state));
    },
    { item: SEED_ITEM, tags: SEED_TAGS, state: sectionState }
  );
  await suppressWhatsNewPopup(page);
  // Deep-link into the Inventory tab (STRK-282): #newItemBtn lives in that
  // panel, and the v2 shell boots on Dashboard, so a bare /index.html leaves
  // this control display:none.
  await page.goto("/index.html#/inventory", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () => typeof window.editItem === "function" && Array.isArray(window.inventory)
  );
}

/**
 * Opens the add-item modal through the production button path.
 * @param {import('@playwright/test').Page} page - Page under test
 * @returns {Promise<void>}
 */
async function openAddModal(page) {
  await page.waitForFunction(() => window.appListenersReady === true);
  await page.evaluate(() => document.getElementById("newItemBtn").click());
  await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });
}

/**
 * Seeds, opens the add modal, and switches to constitutional mode.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {object|null} sectionState - Pre-seeded formSectionState map, or null
 * @returns {Promise<void>}
 */
async function showConstitutionalCard(page, sectionState = null) {
  await seedAndGoto(page, sectionState);
  await openAddModal(page);
  await page.evaluate(() => {
    document.getElementById("itemWeightUnit").value = "cu";
    window.toggleConstitutionalGroup();
  });
}

/**
 * Returns the details element for a section key.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {string} key - data-section key
 * @returns {import('@playwright/test').Locator} Locator for the section
 */
const section = (page, key) => page.locator(`details.form-section[data-section="${key}"]`);

/**
 * Reads the open state of every section as {key: boolean}.
 * @param {import('@playwright/test').Page} page - Page under test
 * @returns {Promise<Record<string, boolean>>} Map of section key to open state
 */
const readOpenStates = (page) =>
  page.evaluate((keys) => {
    const out = {};
    keys.forEach((k) => {
      const el = document.querySelector(`details.form-section[data-section="${k}"]`);
      out[k] = el ? el.open : undefined;
    });
    return out;
  }, SECTION_KEYS);

test.describe("STRK-301 — collapsible add/edit form sections", () => {
  test("all seven collapsible sections are native <details> with first-visit defaults", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    const tags = await page.evaluate((keys) => {
      const out = {};
      keys.forEach((k) => {
        const el = document.querySelector(`.form-section[data-section="${k}"]`);
        out[k] = el
          ? { tag: el.tagName, summary: el.firstElementChild && el.firstElementChild.tagName }
          : null;
      });
      return out;
    }, SECTION_KEYS);
    for (const key of SECTION_KEYS) {
      expect(tags[key], `section ${key} missing`).not.toBeNull();
      expect(tags[key].tag, `section ${key} is not a <details>`).toBe("DETAILS");
      expect(tags[key].summary, `section ${key} header is not a <summary>`).toBe("SUMMARY");
    }

    const open = await readOpenStates(page);
    expect(open.images, "Images defaults open").toBe(true);
    for (const key of DEFAULT_COLLAPSED) {
      expect(open[key], `${key} defaults collapsed`).toBe(false);
    }
  });

  test("renamed titles: Market Pricing & Details section, Today's Market Price label", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    await expect(section(page, "marketPricing").locator("summary")).toContainText(
      "Market Pricing & Details"
    );
    await expect(page.locator('label[for="itemMarketValue"]')).toContainText(
      "Today's Market Price"
    );
  });

  test("a user toggle persists across a full reload; the key is allowlisted and device-local", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    await section(page, "notes").locator("summary").click();
    expect((await readOpenStates(page)).notes).toBe(true);

    // The details `toggle` event (which drives persistence) fires as a queued
    // task after the click — poll for the write instead of racing it.
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("formSectionState") || "{}").notes === true
    );

    const registration = await page.evaluate(() => ({
      stored: JSON.parse(localStorage.getItem("formSectionState") || "{}"),
      allowlisted: window.ALLOWED_STORAGE_KEYS.includes("formSectionState"),
      synced: window.SYNC_SCOPE_KEYS.includes("formSectionState"),
    }));
    expect(registration.stored.notes).toBe(true);
    expect(registration.allowlisted, "must be in ALLOWED_STORAGE_KEYS or wiped at boot").toBe(true);
    // Deliberate decision (STRK-301): device-local UI preference, excluded
    // from cloud sync. If this ever flips, itemTags-style convergence rules
    // apply — see .context/cloud-sync-convergence.md before changing.
    expect(registration.synced, "device-local — never in SYNC_SCOPE_KEYS").toBe(false);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#newItemBtn", { state: "visible" });
    await openAddModal(page);
    expect((await readOpenStates(page)).notes, "remembered open state survives reload").toBe(true);
  });

  test("edit with no remembered state auto-opens exactly the sections holding data", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.evaluate(() => window.editItem(0));
    await expect(page.locator("#itemModal")).toBeVisible();

    const open = await readOpenStates(page);
    expect(open.notes, "seed item has notes").toBe(true);
    expect(open.tags, "seed item has three tags").toBe(true);
    expect(open.grading, "no grading data — stays collapsed").toBe(false);
    expect(open.catalog, "no catalog data — stays collapsed").toBe(false);
    expect(open.attachments, "no attachments — stays collapsed").toBe(false);
  });

  test("a remembered explicit choice beats data-present, and the badge keeps the data visible", async ({
    page,
  }) => {
    await seedAndGoto(page, { notes: false, tags: false });
    await page.evaluate(() => window.editItem(0));
    await expect(page.locator("#itemModal")).toBeVisible();

    const open = await readOpenStates(page);
    expect(open.notes, "remembered closed wins over data-present").toBe(false);
    expect(open.tags, "remembered closed wins over data-present").toBe(false);

    await expect(section(page, "tags").locator(".form-section-count")).toHaveText("3");
    await expect(section(page, "notes").locator(".form-section-count")).toHaveText("1");
    await expect(section(page, "grading").locator(".form-section-count")).toBeHidden();
  });

  test("no required control ever sits inside a collapsible section", async ({ page }) => {
    await seedAndGoto(page);
    await openAddModal(page);
    const trapped = await page.evaluate(
      () => document.querySelectorAll("details.form-section [required]").length
    );
    expect(trapped, "a [required] inside <details> makes submit silently no-op").toBe(0);
  });

  test("summary is keyboard-operable with a visible focus ring in all four themes", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    const summary = section(page, "grading").locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    expect((await readOpenStates(page)).grading, "Enter opens").toBe(true);
    await page.keyboard.press("Space");
    expect((await readOpenStates(page)).grading, "Space closes").toBe(false);

    for (const theme of ["light", "dark", "slate", "sepia"]) {
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      // Keyboard-driven focus so :focus-visible matches.
      await page.evaluate(() => document.activeElement.blur());
      await summary.focus();
      const ring = await summary.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: cs.outlineWidth };
      });
      expect(ring.style, `theme ${theme}: focus outline missing`).not.toBe("none");
      expect(parseFloat(ring.width), `theme ${theme}: zero-width outline`).toBeGreaterThan(0);
    }
  });

  test("constitutional card chip toggle activates without hiding the body", async ({ page }) => {
    await showConstitutionalCard(page);
    const card = page.locator("#item-constitutional-group");
    await expect(card).toBeVisible();
    const body = card.locator(".form-section-body");
    await expect(body).toBeVisible();

    await card.locator('.chip-sort-btn[data-mode="denom"]').click();
    await expect(card.locator('.chip-sort-btn[data-mode="denom"]')).toHaveClass(/active/);
    await expect(body, "chip click must not hide the body").toBeVisible();
  });

  test("programmatic writes land in collapsed sections; openFormSection opens without persisting", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    // A closed <details> hides content visually only — the controls stay in
    // the DOM and writable. This is what keeps catalog fills and bulk edit
    // working without any special-casing.
    const roundTrip = await page.evaluate(() => {
      const el = document.getElementById("itemMarketValue");
      el.value = "55";
      return el.value;
    });
    expect(roundTrip).toBe("55");

    await page.evaluate(() => window.openFormSection("catalog"));
    expect((await readOpenStates(page)).catalog, "programmatic open works").toBe(true);
    const persisted = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("formSectionState") || "{}")
    );
    expect(persisted.catalog, "programmatic opens must never persist as a user choice").toBe(
      undefined
    );
  });

  test("constitutional card is not a <details> and has no disclosure affordance (STRK-329)", async ({
    page,
  }) => {
    await showConstitutionalCard(page);
    const card = page.locator("#item-constitutional-group");
    await expect(card).toBeVisible();

    const tagName = await card.evaluate((el) => el.tagName);
    expect(tagName, "constitutional must be a <div>").toBe("DIV");

    const chevron = await card.locator(".form-section-header").evaluate((el) => {
      const after = getComputedStyle(el, "::after");
      return after.content;
    });
    expect(chevron, "no chevron pseudo-element on a non-details header").toBe("none");

    const body = card.locator(".form-section-body");
    await card.locator(".form-section-header").click();
    await expect(body, "header click must not hide the body").toBeVisible();
  });

  test("stale remembered {constitutional: false} does not hide the card (STRK-329)", async ({
    page,
  }) => {
    await showConstitutionalCard(page, { constitutional: false });
    const body = page.locator("#item-constitutional-group .form-section-body");
    await expect(body, "stale remembered-closed must not hide constitutional").toBeVisible();
  });

  test("collapsed defaults shorten the form on a phone viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAndGoto(page);
    await openAddModal(page);

    const collapsedHeight = await page.evaluate(
      () => document.getElementById("inventoryForm").scrollHeight
    );
    await page.evaluate(() => {
      document.querySelectorAll("details.form-section").forEach((d) => (d.open = true));
    });
    const expandedHeight = await page.evaluate(
      () => document.getElementById("inventoryForm").scrollHeight
    );
    // The always-visible core block dominates the form's height on a phone,
    // so assert an absolute saving rather than a ratio: collapsing the
    // optional sections must reclaim a real chunk of scroll.
    expect(
      collapsedHeight,
      `collapsed ${collapsedHeight}px should save real scroll vs expanded ${expandedHeight}px`
    ).toBeLessThan(expandedHeight - 300);
  });
});

// Type drives Metal on the Add/Edit form: Goldback and Silverback are always
// selectable, and choosing one sets Metal, the weight unit and the denomination
// picker. A Numista fill runs the same reconciliation as a manual change.
// normalizeType and parseGoldbackDenomination are unit-tested in
// tests/unit/numista-goldback-import.test.js.

const TYPE_ITEM = {
  uuid: "strk138-base-item",
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
  numistaId: "999138",
  serial: 1,
};

const GOLDBACK_ITEM = {
  ...TYPE_ITEM,
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

// Normalized Numista results as passed to showNumistaResults([...]).
const COIN_RESULT = {
  name: "1 Dollar American Silver Eagle",
  catalogId: "999138",
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

// Source metal Silver conflicts with Type Goldback: handleTypeChange must run
// before filterTypesByMetal, or the stale metal resets the Type.
const GOLDBACK_BAD_METAL_RESULT = { ...GOLDBACK_RESULT, metal: "Silver", composition: "Silver" };

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

/**
 * Seeds inventory and a configured Numista key, then opens the Inventory tab.
 * @param {import('@playwright/test').Page} page - Page to boot.
 * @param {object[]} inventory - Items to seed.
 * @returns {Promise<void>}
 */
async function seedTypeFormAndGoto(page, inventory) {
  await page.addInitScript((inv) => {
    localStorage.setItem("metalInventory", JSON.stringify(inv));
    localStorage.setItem("numistaViewFields", JSON.stringify({}));
    localStorage.setItem(
      "catalog_api_config",
      JSON.stringify({ numista: { apiKey: btoa("fake-test-key"), quota: 2000 } })
    );
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
      },
      { once: true }
    );
  }, inventory);
  await page.goto("/index.html#/inventory", { waitUntil: "domcontentloaded" });
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

/**
 * Opens the Add form the way #newItemBtn does: Metal and Type cleared, the type
 * filter and reconciliation run. Safe to call again on an open form.
 * @param {import('@playwright/test').Page} page - Booted page.
 * @returns {Promise<void>}
 */
async function openAddTypeForm(page) {
  await page.waitForSelector("#newItemBtn", { state: "visible" });

  // setupEventListeners() wires the #itemType change listener in a deferred
  // boot timer. Probe until a Goldback change event sets the unit to "gb".
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

/**
 * Opens the Edit form for the item at `index`.
 * @param {import('@playwright/test').Page} page - Booted page.
 * @param {number} [index] - Inventory index.
 * @returns {Promise<void>}
 */
async function openEditTypeForm(page, index = 0) {
  await page.evaluate((idx) => window.editItem(idx), index);
  await expect(page.locator("#itemModal")).toBeVisible();
}

// selectOption waits for the control and fires a real change event.
const setType = (page, value) => page.selectOption("#itemType", value);
const setMetal = (page, value) => page.selectOption("#itemMetal", value);

const readSpot = (page) =>
  page.evaluate(() => {
    const el = document.getElementById("itemSpotPrice");
    return el instanceof HTMLElement ? el.value : null;
  });

const setSpot = (page, value) =>
  page.evaluate((v) => {
    const el = document.getElementById("itemSpotPrice");
    if (el instanceof HTMLElement) el.value = v;
  }, value);

/**
 * Opens the Numista field picker on `result` and fills the form from it.
 * @param {import('@playwright/test').Page} page - Page with the Add form open.
 * @param {object} result - A normalized Numista result.
 * @returns {Promise<void>}
 */
async function fillFromNumista(page, result) {
  await page.evaluate((r) => window.showNumistaResults([r], true, ""), result);
  await expect(page.locator("#numistaResultsModal")).toBeVisible();
  await expect(page.locator("#numistaFieldPicker")).toBeVisible();
  await page.locator("#numistaFillBtn").click();
  await expect(page.locator("#numistaFieldPicker")).not.toBeVisible();
}

/**
 * Reads Type, Metal, weight unit and Goldback denomination from the form.
 * @param {import('@playwright/test').Page} page - Page with the item form open.
 * @returns {Promise<{type: string|null, metal: string|null, unit: string|null, gbDenom: string|null}>}
 */
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

/**
 * Reads whether the named options of a Type <select> exist, are hidden or are disabled.
 * @param {import('@playwright/test').Page} page - Booted page.
 * @param {string} selector - Selector of the <select>.
 * @param {string[]} values - Option values to read.
 * @returns {Promise<Record<string, {exists: boolean, hidden: boolean, disabled: boolean}>>}
 */
const readTypeOptions = (page, selector, values) =>
  page.evaluate(
    ({ sel, vals }) => {
      const select = document.querySelector(sel);
      return Object.fromEntries(
        vals.map((val) => {
          const opt = Array.from(select.options).find((o) => o.value === val);
          return [val, { exists: !!opt, hidden: !!opt?.hidden, disabled: !!opt?.disabled }];
        })
      );
    },
    { sel: selector, vals: values }
  );

/**
 * Runs each case as a step on one page, reopening a fresh Add form first.
 * @param {import('@playwright/test').Page} page - Booted page.
 * @param {Array<{name: string, run: Function}>} cases - Steps to run.
 * @returns {Promise<void>}
 */
const runAddFormCases = async (page, cases) => {
  test.setTimeout(test.info().timeout * cases.length);
  for (const { name, run } of cases) {
    await test.step(name, async () => {
      await openAddTypeForm(page);
      await run(page);
    });
  }
};

const AVAILABLE = { exists: true, hidden: false, disabled: false };
const UNAVAILABLE = { exists: true, hidden: true, disabled: true };

const TYPE_DRIVES_METAL_CASES = [
  {
    name: "Add form: Goldback and Silverback are visible+enabled with Metal empty (Req 1.1, 1.3)",
    run: async (page) => {
      expect((await formState(page)).metal).toBe("");
      expect(await readTypeOptions(page, "#itemType", ["Goldback", "Silverback"])).toEqual({
        Goldback: AVAILABLE,
        Silverback: AVAILABLE,
      });
    },
  },
  {
    name: "Selecting Type=Goldback drives Metal=Gold, unit=gb, denom picker present (Req 2.1, 2.3)",
    run: async (page) => {
      await setType(page, "Goldback");
      const state = await formState(page);
      expect([state.type, state.metal, state.unit]).toEqual(["Goldback", "Gold", "gb"]);
      await expect(page.locator("#itemGbDenom")).toBeVisible();
      expect(await page.locator("#itemGbDenom option").count()).toBeGreaterThan(0);
    },
  },
  {
    name: "Selecting Type=Silverback drives Metal=Silver, unit=sb (Req 2.2)",
    run: async (page) => {
      await setType(page, "Silverback");
      const state = await formState(page);
      expect([state.type, state.metal, state.unit]).toEqual(["Silverback", "Silver", "sb"]);
    },
  },
  {
    name: "Selecting a coin Type leaves Metal/unit on normal (non-gb) behavior (Req 2.4)",
    run: async (page) => {
      await setType(page, "Coin");
      const state = await formState(page);
      expect(state.type).toBe("Coin");
      expect(["gb", "sb"]).not.toContain(state.unit);
    },
  },
  {
    name: "Changing Metal to Silver while Goldback active resets Type — no Silver+Goldback (Req 5.1, 5.3)",
    run: async (page) => {
      await setType(page, "Goldback");
      expect((await formState(page)).metal).toBe("Gold");
      await setMetal(page, "Silver");
      const state = await formState(page);
      expect([state.type, state.metal]).toEqual(["", "Silver"]);
    },
  },
  {
    name: "Changing Metal to Gold while Silverback active resets Type — no Gold+Silverback (Req 5.2)",
    run: async (page) => {
      await setType(page, "Silverback");
      expect((await formState(page)).metal).toBe("Silver");
      await setMetal(page, "Gold");
      const state = await formState(page);
      expect([state.type, state.metal]).toEqual(["", "Gold"]);
    },
  },
  {
    name: "Type-driven Metal change clears a stale spot lookup; a non-metal-changing Type does not (Req 2, data-integrity)",
    run: async (page) => {
      await setSpot(page, "2400.55");
      await setType(page, "Goldback");
      expect((await formState(page)).metal).toBe("Gold");
      expect(await readSpot(page)).toBe("");

      // Coin to Round keeps Metal, so the spot lookup stays.
      await setMetal(page, "Silver");
      await setType(page, "Coin");
      const metalBefore = (await formState(page)).metal;
      await setSpot(page, "31.42");
      await setType(page, "Round");
      expect((await formState(page)).metal).toBe(metalBefore);
      expect(await readSpot(page)).toBe("31.42");
    },
  },
];

// The 1/4 case runs before the no-denomination case, so the second shows that
// reopening the form resets the picker to "1".
const NUMISTA_FILL_CASES = [
  {
    name: "Goldback Numista import fills Type=Goldback, Metal=Gold, unit=gb with no manual step (Req 3.3, 3.5)",
    run: async (page) => {
      await fillFromNumista(page, GOLDBACK_RESULT);
      const state = await formState(page);
      expect([state.type, state.metal, state.unit]).toEqual(["Goldback", "Gold", "gb"]);
    },
  },
  {
    name: "Goldback import with incompatible source metal still lands Type=Goldback, Metal=Gold, unit=gb (Req 3.3, 3.5 robustness)",
    run: async (page) => {
      await fillFromNumista(page, GOLDBACK_BAD_METAL_RESULT);
      const state = await formState(page);
      expect([state.type, state.metal, state.unit]).toEqual(["Goldback", "Gold", "gb"]);
    },
  },
  {
    // The fill calls handleTypeChange() directly, so the Metal change listener
    // that clears #itemSpotPrice never fires on its own.
    name: "Goldback import whose source metal forces a coercion clears a stale spot lookup (Copilot import stale-spot fix)",
    run: async (page) => {
      await setSpot(page, "31.42");
      await fillFromNumista(page, GOLDBACK_BAD_METAL_RESULT);
      expect(await readSpot(page)).toBe("");
    },
  },
  {
    name: "Silverback Numista import fills Type=Silverback, Metal=Silver, unit=sb (Req 3.4)",
    run: async (page) => {
      await fillFromNumista(page, SILVERBACK_RESULT);
      const state = await formState(page);
      expect([state.type, state.metal, state.unit]).toEqual(["Silverback", "Silver", "sb"]);
    },
  },
  {
    name: "Importing '1/4 Idaho Goldback' sets #itemGbDenom to 0.25 (Req 4.1)",
    run: async (page) => {
      await fillFromNumista(page, {
        ...GOLDBACK_RESULT,
        name: "1/4 Idaho Goldback",
        denomination: "1/4 Idaho Goldback",
      });
      const state = await formState(page);
      expect([state.type, state.gbDenom]).toEqual(["Goldback", "0.25"]);
    },
  },
  {
    name: "Importing a Goldback with no denomination leaves #itemGbDenom at '1' (Req 4.3)",
    run: async (page) => {
      await fillFromNumista(page, { ...GOLDBACK_RESULT, name: "Idaho Goldback", denomination: "" });
      const state = await formState(page);
      expect([state.type, state.gbDenom]).toEqual(["Goldback", "1"]);
    },
  },
  {
    name: "Coin Numista import fills Type/Metal/unit unchanged from current behavior (Req 6.1)",
    run: async (page) => {
      await fillFromNumista(page, COIN_RESULT);
      const state = await formState(page);
      expect([state.type, state.metal]).toEqual(["Coin", "Silver"]);
      // The weight import sets grams; a coin never gets gb or sb.
      expect(["gb", "sb"]).not.toContain(state.unit);
    },
  },
];

/**
 * Starts an inline Type edit on the item with `uuid` and reads the options.
 * @param {import('@playwright/test').Page} page - Booted page.
 * @param {string} uuid - Item uuid.
 * @returns {Promise<Record<string, {exists: boolean, hidden: boolean, disabled: boolean}>>}
 */
async function readInlineTypeOptions(page, uuid) {
  await page.evaluate((id) => {
    const idx = window.inventory.findIndex((i) => i.uuid === id);
    const td = document.createElement("td");
    td.id = "inline-type-probe";
    td.dataset.field = "type";
    document.body.appendChild(td);
    window.startCellEdit(idx, "type", td);
  }, uuid);
  return readTypeOptions(page, "#inline-type-probe select.inline-select", [
    "Goldback",
    "Silverback",
    "Coin",
  ]);
}

test.describe("STRK-138 — Type drives Metal on the item form", () => {
  test("the Add form couples Type, Metal, unit and the spot lookup", async ({ page }) => {
    await seedTypeFormAndGoto(page, []);
    await runAddFormCases(page, TYPE_DRIVES_METAL_CASES);
  });

  test("a Numista fill reconciles Type, Metal, unit and denomination", async ({ page }) => {
    await seedTypeFormAndGoto(page, []);
    await runAddFormCases(page, NUMISTA_FILL_CASES);
  });

  test("Edit form: Goldback and Silverback selectable regardless of stored Metal (Req 1.2)", async ({
    page,
  }) => {
    await seedTypeFormAndGoto(page, [TYPE_ITEM]);
    await openEditTypeForm(page);
    expect((await formState(page)).metal).toBe("Silver");
    expect(await readTypeOptions(page, "#itemType", ["Goldback", "Silverback"])).toEqual({
      Goldback: AVAILABLE,
      Silverback: AVAILABLE,
    });
  });

  test("Editing an existing Goldback item does not mutate stored Type/Metal/denomination (Req 6.2)", async ({
    page,
  }) => {
    await seedTypeFormAndGoto(page, [GOLDBACK_ITEM]);
    await openEditTypeForm(page);
    expect(await formState(page)).toEqual({
      type: "Goldback",
      metal: "Gold",
      unit: "gb",
      gbDenom: "5",
    });

    const stored = await page.evaluate(() => {
      const inv = window.inventory.find((i) => i.uuid === "strk138-goldback-item");
      return { type: inv.type, metal: inv.metal, weight: inv.weight, weightUnit: inv.weightUnit };
    });
    expect(stored).toEqual({ type: "Goldback", metal: "Gold", weight: 5, weightUnit: "gb" });
  });

  // The Add/Edit form shows Goldback and Silverback for any Metal, but bulk edit
  // and the inline table edit still hide incompatible Types through TYPE_METAL_FILTER.
  test("Inline table-edit hides the Type options the row's Metal excludes (STAK-580 guard)", async ({
    page,
  }) => {
    await seedTypeFormAndGoto(page, [TYPE_ITEM, GOLDBACK_ITEM]);

    // Goldback is Gold-only and Silverback is Silver-only.
    expect(await readInlineTypeOptions(page, "strk138-base-item")).toEqual({
      Goldback: UNAVAILABLE,
      Silverback: AVAILABLE,
      Coin: AVAILABLE,
    });
    await page.evaluate(() => document.getElementById("inline-type-probe")?.remove());
    const gold = await readInlineTypeOptions(page, "strk138-goldback-item");
    expect(gold.Goldback).toEqual(AVAILABLE);
    expect(gold.Silverback).toEqual(UNAVAILABLE);
  });
});

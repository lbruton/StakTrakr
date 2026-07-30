import { test, expect } from "../helpers/mocks/extended-test.js";

const MONEY_ITEM = {
  uuid: "core-money-base-item",
  metal: "Silver",
  composition: "Silver",
  name: "Core Money Base ASE",
  qty: 4,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 100,
  marketValue: 0,
  date: "2026-04-01",
  purchaseLocation: "StakTrakr",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2026",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 30,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: "",
  serial: 1,
};

const LEGACY_SILVERBACK = {
  ...MONEY_ITEM,
  uuid: "core-legacy-silverback",
  metal: "Silver",
  composition: "Silver",
  name: "Core Legacy Silverback",
  qty: 1,
  type: "Silverback",
  weight: 1,
  weightUnit: "gb",
  price: 0,
  serial: 17,
};

const MIGRATED_SILVERBACK = {
  ...LEGACY_SILVERBACK,
  uuid: "core-migrated-silverback",
  name: "Core Migrated Silverback",
  weightUnit: "sb",
};

const GOLDBACK_ITEM = {
  ...MONEY_ITEM,
  uuid: "core-goldback-item",
  metal: "Gold",
  composition: "Gold",
  name: "Core Goldback",
  qty: 1,
  type: "Goldback",
  weight: 5,
  weightUnit: "gb",
  price: 25,
  purity: 1,
};

const SPOT_ENTRY = {
  timestamp: "2026-04-01T12:00:00.000Z",
  metal: "Silver",
  spot: 33.25,
  source: "seed",
  provider: "Playwright",
};

async function seedMoneyData(page, options = {}) {
  const {
    inventory = [],
    displayCurrency = "USD",
    exchangeRates = { EUR: 0.9 },
    spotHistory = [SPOT_ENTRY],
    goldbackPriceHistory = {},
    goldbackPrices = {},
    goldbackPricingSource = "api",
  } = options;

  await page.route("https://open.er-api.com/v6/latest/USD", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: "success", base_code: "USD", rates: exchangeRates }),
    });
  });

  await page.addInitScript(
    ({ seededInventory, currency, rates, history, gbHistory, gbPrices, gbSource }) => {
      localStorage.setItem("metalInventory", JSON.stringify(seededInventory));
      localStorage.setItem("itemTags", JSON.stringify({}));
      localStorage.setItem("cardViewStyle", "D");
      localStorage.setItem("displayCurrency", JSON.stringify(currency));
      localStorage.setItem("exchangeRates", JSON.stringify(rates));
      localStorage.setItem("metalSpotHistory", JSON.stringify(history));
      localStorage.setItem("goldback-price-history", JSON.stringify(gbHistory));
      localStorage.setItem("goldback-prices", JSON.stringify(gbPrices));
      localStorage.setItem("goldback-pricing-source", JSON.stringify(gbSource));
      localStorage.setItem("defaultSortColumn", "4");
      localStorage.setItem("defaultSortDir", "asc");

      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (typeof APP_VERSION !== "undefined") {
            localStorage.setItem("ackVersion", APP_VERSION);
          }
        },
        { once: true }
      );
    },
    {
      seededInventory: inventory,
      currency: displayCurrency,
      rates: exchangeRates,
      history: spotHistory,
      gbHistory: goldbackPriceHistory,
      gbPrices: goldbackPrices,
      gbSource: goldbackPricingSource,
    }
  );
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () =>
      typeof window.editItem === "function" &&
      typeof window.duplicateItem === "function" &&
      typeof window.showViewModal === "function" &&
      Array.isArray(window.inventory)
  );
  // STRK-294: wait for the listener-readiness flag instead of sleeping. Phase 14
  // of init.js attaches every listener inside a `setTimeout(…, 200)`, so the
  // waitForFunction above goes true well before the UI is actually interactive.
  // This replaced a bare `waitForTimeout(300)` — a 100ms margin over that timer,
  // which is thin enough to flake on a loaded CI runner and would fail in a way
  // that looks unrelated to whatever the spec is testing.
  await page.waitForFunction(() => window.appListenersReady === true);
}

async function openAddModal(page) {
  await page.evaluate(() => document.getElementById("newItemBtn")?.click());
  await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });
}

async function openEditModal(page, index = 0) {
  await page.evaluate((idx) => window.editItem(idx), index);
  await expect(page.locator("#itemModal")).toBeVisible();
}

async function openCloneModal(page, index = 0) {
  await page.evaluate((idx) => window.duplicateItem(idx), index);
  await expect(page.locator("#itemModal")).toBeVisible();
}

async function openViewModal(page, index = 0) {
  await page.evaluate((idx) => window.showViewModal(idx), index);
  await expect(page.locator("#viewItemModal")).toBeVisible();
}

function purchaseModeButton(page, mode) {
  return page.locator(`#purchasePriceModeToggle [data-mode="${mode}"]`);
}

async function selectPurchaseMode(page, mode) {
  await expect(page.locator("#purchasePriceModeToggle")).toHaveCount(1);
  await purchaseModeButton(page, mode).click();
  await expect(purchaseModeButton(page, mode)).toHaveClass(/active/);
}

async function fillInventoryForm(page, { name, qty = "1", price = "100", weight = "1" }) {
  await page.selectOption("#itemMetal", "Silver");
  await page.selectOption("#itemType", "Coin");
  await page.fill("#itemName", name);
  await page.fill("#itemQty", String(qty));
  await page.fill("#itemWeight", String(weight));
  await page.fill("#itemDate", "2026-04-01");
  await page.fill("#itemPrice", String(price));
}

async function submitItemForm(page) {
  await page.click("#itemModalSubmit");
  await expect(page.locator("#itemModal")).toBeHidden();
}

async function getInventoryItem(page, name) {
  return page.evaluate(
    (targetName) => window.inventory.find((item) => item.name === targetName) || null,
    name
  );
}

function tableRowByName(page, name) {
  return page.locator("#inventoryTable tbody tr").filter({ hasText: name });
}

async function captureNumistaCsvExport(page) {
  return page.evaluate(() => {
    return new Promise((resolve, reject) => {
      const originalCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = (blob) => {
        const reader = new FileReader();
        reader.onload = () => {
          URL.createObjectURL = originalCreateObjectURL;
          resolve(reader.result);
        };
        reader.onerror = () => {
          URL.createObjectURL = originalCreateObjectURL;
          reject(new Error("FileReader failed to read export blob"));
        };
        reader.readAsText(blob);
        return originalCreateObjectURL.call(URL, blob);
      };
      try {
        window.exportNumistaCsv();
      } catch (err) {
        URL.createObjectURL = originalCreateObjectURL;
        reject(err);
      }
    });
  });
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

test.describe("core/inventory-math", () => {
  test("Goldback and Silverback types expose the right controls and accounting units", async ({
    page,
  }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.selectOption("#itemMetal", "Gold");
    await page.selectOption("#itemType", "Goldback");
    await expect(page.locator("#itemGbDenom")).toBeVisible();
    await expect(page.locator("#itemWeight")).toBeHidden();
    await expect(page.locator("#itemWeightUnit")).toHaveValue("gb");
    const expectedDenominations = await page.evaluate(() =>
      window.GOLDBACK_DENOMINATIONS.map((denomination) => String(denomination.weight))
    );
    const actualDenominations = await page
      .locator("#itemGbDenom option")
      .evaluateAll((options) => options.map((option) => option.value));
    expect(actualDenominations).toEqual(expectedDenominations);
    expect(actualDenominations).toEqual(expect.arrayContaining(["0.25", "1", "100"]));

    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Silverback");
    await expect(page.locator("#itemWeightUnit")).toHaveValue("sb");
    await expect(page.locator("#itemGbDenom")).toBeHidden();
    await expect(page.locator("#itemGbDenom")).not.toHaveAttribute("aria-label", /Goldback/i);
  });

  test("Goldback price lookups use Goldback history instead of gold spot", async ({ page }) => {
    await seedMoneyData(page, {
      goldbackPriceHistory: {
        1: [{ ts: new Date("2026-05-11T12:00:00.000Z").getTime(), price: 9.48, source: "api" }],
      },
      goldbackPricingSource: "manual",
    });
    await gotoApp(page);
    await openAddModal(page);

    await page.fill("#itemDate", "2026-05-11");
    await page.selectOption("#itemMetal", "Gold");
    await page.selectOption("#itemType", "Goldback");
    await page.click("#spotLookupBtn");

    await expect(page.locator("#spotLookupModal")).toBeVisible();
    await expect(page.locator("#spotLookupTitle")).toContainText("Goldback Lookup");
    await expect(page.locator("#spotLookupBody")).toContainText("Goldback Price");
    await expect(page.locator("#spotLookupBody")).toContainText("$9.48");
    await expect(page.locator("#spotLookupBody")).not.toContainText("Offset");

    await page.locator(".spot-lookup-use-btn").first().click();
    await expect(page.locator("#itemPrice")).toHaveValue("9.48");
  });

  test("Goldback manual retail value is a floor override and Silverback falls through to melt", async ({
    page,
  }) => {
    await seedMoneyData(page, {
      inventory: [MIGRATED_SILVERBACK],
      goldbackPrices: { 1: { price: 9.48, updatedAt: Date.now(), source: "api" } },
      goldbackPricingSource: "manual",
    });
    await gotoApp(page);
    await page.waitForFunction(() => typeof window.calculateRetailPrice === "function");

    const values = await page.evaluate(() => {
      const goldback = {
        metal: "Gold",
        type: "Goldback",
        weight: 1,
        weightUnit: "gb",
        qty: 1,
        purity: 0.999,
        price: 0,
      };
      const silverback = window.inventory[0];
      return {
        highManual: window.calculateRetailPrice({ ...goldback, marketValue: 100 }, 4715.22),
        lowManual: window.calculateRetailPrice({ ...goldback, marketValue: 2 }, 4715.22),
        silverback: window.calculateRetailPrice(silverback, 25),
      };
    });

    expect(values.highManual.gbDenomPrice).toBe(9.48);
    expect(values.highManual.isManualRetail).toBe(true);
    expect(values.highManual.retailTotal).toBe(100);
    expect(values.lowManual.isManualRetail).toBe(false);
    expect(values.lowManual.retailTotal).toBe(9.48);
    expect(values.silverback.gbDenomPrice).toBeNull();
    expect(values.silverback.meltValue).toBeCloseTo(0.024975, 6);
    expect(values.silverback.retailTotal).toBeCloseTo(0.024975, 6);
  });

  test("legacy Silverback gb records migrate to sb in runtime and storage", async ({ page }) => {
    await seedMoneyData(page, { inventory: [LEGACY_SILVERBACK] });
    await gotoApp(page);

    const stored = await page.evaluate(() => ({
      runtimeUnit: window.inventory[0].weightUnit,
      storedUnit: JSON.parse(localStorage.getItem("metalInventory"))[0].weightUnit,
    }));
    expect(stored.runtimeUnit).toBe("sb");
    expect(stored.storedUnit).toBe("sb");

    await page.reload();
    await page.waitForFunction(() => Array.isArray(window.inventory) && window.inventory.length);
    await expect.poll(() => page.evaluate(() => window.inventory[0].weightUnit)).toBe("sb");
  });

  test("lot purchase price saves per-unit value while preserving rounded lot editing", async ({
    page,
  }) => {
    const itemName = "Core LOT Save Precision";
    await seedMoneyData(page);
    await gotoApp(page);
    await openAddModal(page);

    await fillInventoryForm(page, { name: itemName, qty: "30", price: "" });
    await selectPurchaseMode(page, "lot");
    await page.fill("#itemPrice", "1700");
    await submitItemForm(page);

    const saved = await getInventoryItem(page, itemName);
    expect(saved).toBeTruthy();
    expect(saved.pricingType).toBe("lot");
    expect(saved.price).toBeCloseTo(1700 / 30, 12);
    expect(saved.price).not.toBe(56.666667);
    expect(saved.price * saved.qty).toBeCloseTo(1700, 12);

    await openEditModal(page, 0);
    await expect(purchaseModeButton(page, "lot")).toHaveClass(/active/);
    await expect(page.locator("#itemPrice")).toHaveValue("1700.00");
    await selectPurchaseMode(page, "each");
    await expect(page.locator("#itemPrice")).toHaveValue("56.67");
    await selectPurchaseMode(page, "lot");
    await expect(page.locator("#itemPrice")).toHaveValue("1700.00");
  });

  test("lot and each toggles convert display values and emit a single input event", async ({
    page,
  }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.fill("#itemQty", "30");
    await selectPurchaseMode(page, "lot");
    await page.fill("#itemPrice", "1700");
    await page.evaluate(() => {
      window.__corePriceInputEvents = 0;
      document.getElementById("itemPrice").addEventListener("input", () => {
        window.__corePriceInputEvents += 1;
      });
    });

    await selectPurchaseMode(page, "each");
    await expect(page.locator("#itemPrice")).toHaveValue("56.67");
    await expect.poll(() => page.evaluate(() => window.__corePriceInputEvents)).toBe(1);

    await selectPurchaseMode(page, "lot");
    await expect(page.locator("#itemPrice")).toHaveValue("1700.00");
  });

  test("table and view modal show quantity-total purchase price, not only per-unit price", async ({
    page,
  }) => {
    await seedMoneyData(page, { inventory: [MONEY_ITEM] });
    await gotoApp(page);

    const row = tableRowByName(page, MONEY_ITEM.name);
    await expect(row.locator('[data-column="purchasePrice"]')).toContainText("$400.00");
    await expect(row.locator('[data-column="purchasePrice"]')).not.toContainText("$100.00");

    await openViewModal(page);
    const modal = page.locator("#viewItemModal");
    await expect(modal).toContainText("$400.00 total");
    await expect(modal).toContainText("$100.00 each");
  });

  test("display-currency lot entry stores base-currency per-unit price", async ({ page }) => {
    const itemName = "Core EUR Lot";
    await seedMoneyData(page, { displayCurrency: "EUR", exchangeRates: { EUR: 0.9 } });
    await gotoApp(page);
    await openAddModal(page);

    await fillInventoryForm(page, { name: itemName, qty: "3", price: "" });
    await selectPurchaseMode(page, "lot");
    await page.fill("#itemPrice", "90");
    await submitItemForm(page);

    const item = await getInventoryItem(page, itemName);
    expect(item).not.toBeNull();
    expect(item.qty).toBe(3);
    expect(item.price).toBeCloseTo((90 / 3) * (1 / 0.9), 6);
  });

  test("Numista EUR export reimports without USD price inflation", async ({ page }) => {
    const numistaItem = {
      ...MONEY_ITEM,
      uuid: "core-numista-roundtrip",
      numistaId: "67890",
      name: "Core Numista Roundtrip 2026",
      qty: 1,
      price: 100,
      purchasePrice: 100,
    };
    await seedMoneyData(page, {
      inventory: [numistaItem],
      displayCurrency: "EUR",
      exchangeRates: { EUR: 0.9 },
    });
    await gotoApp(page);

    const csv = await captureNumistaCsvExport(page);
    const [headerLine, rowLine] = String(csv).trim().split(/\r?\n/);
    const headers = parseCsvLine(headerLine);
    const row = parseCsvLine(rowLine);
    const buyingPriceIndex = headers.indexOf("Buying price (EUR)");
    expect(buyingPriceIndex).toBeGreaterThanOrEqual(0);
    expect(row[buyingPriceIndex]).toBe("90.00");

    await page.evaluate((csvText) => {
      localStorage.setItem("metalInventory", JSON.stringify([]));
      window.inventory = [];
      const file = new File([csvText], "numista-roundtrip.csv", { type: "text/csv" });
      window.importNumistaCsv(file, true);
    }, csv);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem("metalInventory") || "[]";
          return JSON.parse(raw)[0]?.price ?? null;
        })
      )
      .toBeCloseTo(100, 2);
  });

  test("duplicating drifted and lot-saved items restores rounded purchase fields", async ({
    page,
  }) => {
    const lotSource = {
      ...MONEY_ITEM,
      uuid: "core-lot-source",
      name: "Core LOT Source",
      qty: 30,
      price: 1700 / 30,
      pricingType: "lot",
    };
    const driftedEach = {
      ...MONEY_ITEM,
      uuid: "core-drifted-each",
      name: "Core Drifted Each",
      qty: 4,
      price: 56.66666666666667,
      pricingType: "each",
    };

    await seedMoneyData(page, { inventory: [lotSource, driftedEach] });
    await gotoApp(page);
    await openCloneModal(page, 0);
    await expect(purchaseModeButton(page, "lot")).toHaveClass(/active/);
    await expect(page.locator("#itemPrice")).toHaveValue("1700.00");

    await page.evaluate(() => {
      if (typeof window.closeModalById === "function") window.closeModalById("itemModal");
    });
    await expect(page.locator("#itemModal")).toBeHidden();

    await openCloneModal(page, 1);
    await expect(purchaseModeButton(page, "each")).toHaveClass(/active/);
    await expect(page.locator("#itemPrice")).toHaveValue("56.67");
  });
});

// ---------------------------------------------------------------------------
// STRK-235 — Constitutional / junk silver. Written TDD-first (red) and now green
// against the landed implementation. Asserts the design.md contracts for tasks 1-10
// and maps every requirements.md AC (R1-R6).
// ---------------------------------------------------------------------------

// Mint-spec fresh pure-silver troy oz per coin (design.md Data Models table).
const CU_VARIANT_FRESH = {
  "con-90-dime": 0.07234,
  "con-90-quarter": 0.18084,
  "con-90-half": 0.36169,
  "con-90-dollar": 0.77344, // silver-dollar exception: NOT 0.7234/$ subsidiary rate
  "con-40-half": 0.1479,
  "con-40-ike": 0.31625,
  "con-35-nickel": 0.05626,
};

const CU_QUARTERS_40 = {
  ...MONEY_ITEM,
  uuid: "core-cu-quarters-40",
  name: "Core 40 Silver Quarters",
  type: "Constitutional",
  metal: "Silver",
  composition: "Silver",
  weightUnit: "cu",
  constitutionalEntryMode: "denom",
  constitutionalVariant: "con-90-quarter",
  weight: 0.25,
  qty: 40,
  purity: 0.9,
  price: 0,
  serial: 30,
};

const CU_FACE_50 = {
  ...MONEY_ITEM,
  uuid: "core-cu-face-50",
  name: "Core $50 Face 90 Bag",
  type: "Constitutional",
  metal: "Silver",
  composition: "Silver",
  weightUnit: "cu",
  constitutionalEntryMode: "face",
  constitutionalVariant: "con-90-subsidiary",
  weight: 50,
  qty: 1,
  purity: 0.9,
  price: 0,
  serial: 31,
};

// Set the global wear basis live (read at compute time) and evaluate the helpers.
async function setBasisAndCompute(page, basis, item) {
  return page.evaluate(
    ({ b, it }) => {
      localStorage.setItem("constitutionalValuationBasis", JSON.stringify(b));
      return {
        oz: window.getConstitutionalSilverOz(it),
        wearFactor: window.getConstitutionalWearFactor(),
        melt: window.computeMeltValue(it, 30),
      };
    },
    { b: basis, it: item }
  );
}

// Open the settings modal AND switch to a section (mirrors settings-api.spec.js helper).
async function openConstitutionalSettings(page, section) {
  await page.waitForFunction(
    () =>
      typeof window.showSettingsModal === "function" &&
      typeof window.switchSettingsSection === "function"
  );
  await page.evaluate((s) => {
    window.showSettingsModal(s);
    window.switchSettingsSection(s);
  }, section);
}

// Shared setup for the bulk-conversion tests (STRK-238 constitutional, STRK-246
// goldback) — seed the inventory, boot the app, open the bulk-edit modal, and select
// the first seeded row.
async function seedAndOpenBulkEdit(page, inventory) {
  await seedMoneyData(page, { inventory });
  await gotoApp(page);
  await page.waitForFunction(() => typeof window.openBulkEdit === "function");
  await page.evaluate(() => window.openBulkEdit());
  await expect(page.locator("#bulkEditModal")).toBeVisible({ timeout: 10000 });
  await page.click(
    '#bulkEditModal .bulk-edit-table tbody tr[data-serial="1"] input[type="checkbox"]'
  );
}

test.describe("core/inventory-math — STRK-235 constitutional silver", () => {
  // ---- Group A: constants + registration (R3 data, R4-AC5, R6-AC3) -------
  test("CONSTITUTIONAL_VARIANTS exposes all 7 variants with mint-spec silver weights", async ({
    page,
  }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    const variants = await page.evaluate(() => window.CONSTITUTIONAL_VARIANTS || null);
    expect(Array.isArray(variants)).toBe(true);
    expect(variants).toHaveLength(7);
    const byId = Object.fromEntries(variants.map((v) => [v.id, v]));
    for (const [id, fresh] of Object.entries(CU_VARIANT_FRESH)) {
      expect(byId[id]).toBeTruthy();
      expect(byId[id].silverOzFresh).toBeCloseTo(fresh, 5);
    }
    // R3-AC2: silver dollar is 0.77344/coin, NOT the 0.7234 subsidiary per-$ rate.
    expect(byId["con-90-dollar"].silverOzFresh).toBeCloseTo(0.77344, 5);
    expect(byId["con-90-dollar"].silverOzFresh).not.toBeCloseTo(0.7234, 3);
  });

  test("subsidiary-per-dollar and worn-scalar constants match the design", async ({ page }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    const c = await page.evaluate(() => ({
      sub: window.CONSTITUTIONAL_SUBSIDIARY_OZT_PER_DOLLAR,
      worn: window.CONSTITUTIONAL_WORN_SCALAR,
      key: window.CONSTITUTIONAL_BASIS_KEY,
    }));
    expect(c.sub).toBeCloseTo(0.7234, 5);
    expect(c.worn).toBeCloseTo(0.98839, 5);
    expect(c.key).toBe("constitutionalValuationBasis");
  });

  test("constitutionalValuationBasis is registered for storage survival and cloud sync", async ({
    page,
  }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    const reg = await page.evaluate(() => ({
      allowed: (window.ALLOWED_STORAGE_KEYS || []).includes("constitutionalValuationBasis"),
      sync: (window.SYNC_SCOPE_KEYS || []).includes("constitutionalValuationBasis"),
    }));
    expect(reg.allowed).toBe(true); // R6-AC3 survives cleanupStorage
    expect(reg.sync).toBe(true); // R4-AC5 included in cloud sync scope
  });

  // ---- Group B: silver-content math (R1-AC2, R3-AC1/AC2, R4-AC1/AC2) -----
  test("fresh basis returns each variant's exact mint silver weight", async ({ page }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    for (const [id, fresh] of Object.entries(CU_VARIANT_FRESH)) {
      const item = {
        weightUnit: "cu",
        constitutionalEntryMode: "denom",
        constitutionalVariant: id,
        weight: 0.1,
        qty: 1,
      };
      const { oz, wearFactor } = await setBasisAndCompute(page, "fresh", item);
      expect(wearFactor).toBeCloseTo(1, 6);
      expect(oz).toBeCloseTo(fresh, 5);
    }
  });

  test("worn basis (default) scales every variant by the worn factor", async ({ page }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    const item = {
      weightUnit: "cu",
      constitutionalEntryMode: "denom",
      constitutionalVariant: "con-90-quarter",
      weight: 0.25,
      qty: 1,
    };
    const worn = await setBasisAndCompute(page, "worn", item);
    expect(worn.wearFactor).toBeCloseTo(0.98839, 5);
    expect(worn.oz).toBeCloseTo(0.18084 * 0.98839, 6);
    // R4-AC1: no key set → default is worn.
    const dflt = await page.evaluate((it) => {
      localStorage.removeItem("constitutionalValuationBasis");
      return { oz: window.getConstitutionalSilverOz(it), wf: window.getConstitutionalWearFactor() };
    }, item);
    expect(dflt.wf).toBeCloseTo(0.98839, 5);
    expect(dflt.oz).toBeCloseTo(0.18084 * 0.98839, 6);
  });

  test("denomination mode multiplies per-coin silver by coin count", async ({ page }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    const item = {
      weightUnit: "cu",
      constitutionalEntryMode: "denom",
      constitutionalVariant: "con-90-quarter",
      weight: 0.25,
      qty: 40,
    };
    const fresh = await setBasisAndCompute(page, "fresh", item);
    expect(fresh.oz).toBeCloseTo(7.2336, 4); // 40 × 0.18084
  });

  test("silver dollars carry more silver per face-dollar than subsidiary coinage", async ({
    page,
  }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    const result = await page.evaluate(() => {
      localStorage.setItem("constitutionalValuationBasis", JSON.stringify("fresh"));
      const dollar = window.getConstitutionalSilverOz({
        weightUnit: "cu",
        constitutionalEntryMode: "denom",
        constitutionalVariant: "con-90-dollar",
        weight: 1,
        qty: 1,
      });
      const fourQuarters = window.getConstitutionalSilverOz({
        weightUnit: "cu",
        constitutionalEntryMode: "denom",
        constitutionalVariant: "con-90-quarter",
        weight: 0.25,
        qty: 4,
      });
      return { dollar, fourQuarters };
    });
    // Same $1 face value, more silver in the dollar (R3-AC2).
    expect(result.dollar).toBeCloseTo(0.77344, 5);
    expect(result.fourQuarters).toBeCloseTo(0.72336, 5);
    expect(result.dollar).toBeGreaterThan(result.fourQuarters);
  });

  test("unknown or missing variant yields zero silver oz without throwing", async ({ page }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    const oz = await page.evaluate(() =>
      window.getConstitutionalSilverOz({
        weightUnit: "cu",
        constitutionalEntryMode: "denom",
        constitutionalVariant: "con-bogus-xyz",
        weight: 0.25,
        qty: 5,
      })
    );
    expect(oz).toBe(0);
  });

  // ---- Group C: melt value (R3-AC3/AC4/AC5) -----------------------------
  test("$10 face 90% subsidiary on the worn basis melts to ~7.15 ozt x spot", async ({ page }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    const item = {
      weightUnit: "cu",
      constitutionalEntryMode: "face",
      constitutionalVariant: "con-90-subsidiary",
      weight: 10,
      qty: 1,
      purity: 0.9,
    };
    const r = await page.evaluate((it) => {
      localStorage.setItem("constitutionalValuationBasis", JSON.stringify("worn"));
      return { oz: window.getConstitutionalSilverOz(it), melt: window.computeMeltValue(it, 33.25) };
    }, item);
    expect(r.oz).toBeCloseTo(7.15, 2);
    expect(r.melt).toBeCloseTo(7.15 * 33.25, 1);
  });

  test("melt value never double-applies coin purity", async ({ page }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    const r = await page.evaluate(() => {
      localStorage.setItem("constitutionalValuationBasis", JSON.stringify("fresh"));
      const base = {
        weightUnit: "cu",
        constitutionalEntryMode: "denom",
        constitutionalVariant: "con-90-dollar",
        weight: 1,
        qty: 1,
      };
      const oz = window.getConstitutionalSilverOz(base);
      return {
        oz,
        meltPurity09: window.computeMeltValue({ ...base, purity: 0.9 }, 30),
        meltPurity1: window.computeMeltValue({ ...base, purity: 1 }, 30),
      };
    });
    // ASW is already pure silver — purity must be ignored, never multiplied again.
    expect(r.meltPurity09).toBeCloseTo(r.oz * 30, 4);
    expect(r.meltPurity1).toBeCloseTo(r.oz * 30, 4);
    expect(r.meltPurity09).toBeCloseTo(r.meltPurity1, 6);
  });

  test("missing silver spot degrades to zero without crashing", async ({ page }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    const item = {
      weightUnit: "cu",
      constitutionalEntryMode: "face",
      constitutionalVariant: "con-90-subsidiary",
      weight: 10,
      qty: 1,
    };
    // Exercise the genuinely-missing-spot path (undefined), not just 0 — the cu branch
    // must coerce to 0 rather than returning NaN.
    const results = await page.evaluate(
      (it) => ({
        undef: window.computeMeltValue(it, undefined),
        zero: window.computeMeltValue(it, 0),
      }),
      item
    );
    expect(Number.isFinite(results.undef)).toBe(true);
    expect(results.undef).toBe(0);
    expect(results.zero).toBe(0);
  });

  test("constitutional value is melt-only (no retail premium added)", async ({ page }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    const r = await page.evaluate(() => {
      localStorage.setItem("constitutionalValuationBasis", JSON.stringify("worn"));
      const item = {
        weightUnit: "cu",
        constitutionalEntryMode: "denom",
        constitutionalVariant: "con-90-half",
        weight: 0.5,
        qty: 3,
      };
      return {
        oz: window.getConstitutionalSilverOz(item),
        melt: window.computeMeltValue(item, 30),
      };
    });
    expect(r.melt).toBeCloseTo(r.oz * 30, 6);
  });

  // ---- Group D: recompute on basis change (R4-AC3) ----------------------
  test("changing the global basis reprices an unedited item", async ({ page }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    const item = {
      weightUnit: "cu",
      constitutionalEntryMode: "denom",
      constitutionalVariant: "con-90-quarter",
      weight: 0.25,
      qty: 40,
    };
    const r = await page.evaluate((it) => {
      localStorage.setItem("constitutionalValuationBasis", JSON.stringify("worn"));
      const worn = window.getConstitutionalSilverOz(it);
      localStorage.setItem("constitutionalValuationBasis", JSON.stringify("fresh"));
      const fresh = window.getConstitutionalSilverOz(it);
      return { worn, fresh, sameItem: JSON.stringify(it) };
    }, item);
    expect(r.fresh).toBeGreaterThan(r.worn);
    expect(r.fresh / r.worn).toBeCloseTo(1 / 0.98839, 4);
    // The item object itself was never mutated — no per-item edit was required.
    expect(r.sameItem).toBe(JSON.stringify(item));
  });

  // ---- Group E: add flow (R1, R2, R3 metal forcing) ---------------------
  test("selecting Constitutional reveals the control group, forces Silver, hides raw weight", async ({
    page,
  }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    await openAddModal(page);
    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Constitutional");
    await expect(page.locator("#item-constitutional-group")).toBeVisible();
    await expect(page.locator("#itemMetal")).toHaveValue("Silver");
    await expect(page.locator("#itemWeightUnit")).toHaveValue("cu");
    await expect(page.locator("#itemWeight")).toBeHidden();
  });

  test("denomination mode saves a variant + coin count item with the cu unit", async ({ page }) => {
    const itemName = "Core CU Denom Save";
    await seedMoneyData(page);
    await gotoApp(page);
    await openAddModal(page);
    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Constitutional");
    // Face value is the default entry mode (STRK-235) — switch to denomination first.
    await page.click('#constitutional-entry-mode-toggle [data-mode="denom"]');
    await page.selectOption("#item-constitutional-variant", "con-90-quarter");
    await page.fill("#item-constitutional-count", "40");
    await page.fill("#itemName", itemName);
    await page.fill("#itemDate", "2026-04-01");
    await page.fill("#itemPrice", "100");
    await page.click("#itemModalSubmit");
    await expect(page.locator("#itemModal")).toBeHidden();

    const saved = await getInventoryItem(page, itemName);
    expect(saved).toBeTruthy();
    expect(saved.weightUnit).toBe("cu");
    expect(saved.constitutionalEntryMode).toBe("denom");
    expect(saved.constitutionalVariant).toBe("con-90-quarter");
    expect(Number(saved.weight)).toBeCloseTo(0.25, 6);
    expect(Number(saved.qty)).toBe(40);
    expect(saved.metal).toBe("Silver");
  });

  test("face-value mode saves a 90% subsidiary item with face value in weight", async ({
    page,
  }) => {
    const itemName = "Core CU Face Save";
    await seedMoneyData(page);
    await gotoApp(page);
    await openAddModal(page);
    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Constitutional");
    await page.click('#constitutional-entry-mode-toggle [data-mode="face"]');
    await page.fill("#item-constitutional-face", "50");
    await page.fill("#itemName", itemName);
    await page.fill("#itemDate", "2026-04-01");
    await page.fill("#itemPrice", "100");
    await page.click("#itemModalSubmit");
    await expect(page.locator("#itemModal")).toBeHidden();

    const saved = await getInventoryItem(page, itemName);
    expect(saved).toBeTruthy();
    expect(saved.weightUnit).toBe("cu");
    expect(saved.constitutionalEntryMode).toBe("face");
    expect(saved.constitutionalVariant).toBe("con-90-subsidiary");
    expect(Number(saved.weight)).toBeCloseTo(50, 6);
    expect(Number(saved.qty)).toBe(1);
  });

  // ---- Group F: wear-basis control (R4-AC4, AC6) ------------------------
  test("wear-basis control lives in the Currency settings tab and defaults to worn", async ({
    page,
  }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    await openConstitutionalSettings(page, "currency");
    await expect(page.locator("#settingsModal")).toBeVisible();
    await expect(
      page.locator("#settingsPanel_currency #settings-constitutional-basis")
    ).toHaveCount(1);
    await expect(page.locator('#settings-constitutional-basis [data-val="worn"]')).toHaveClass(
      /active/
    );
  });

  test("changing the wear basis persists across reload", async ({ page }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    await openConstitutionalSettings(page, "currency");
    await page.click('#settings-constitutional-basis [data-val="fresh"]');
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("constitutionalValuationBasis") || "null")
        )
      )
      .toBe("fresh");

    await page.reload();
    await page.waitForFunction(() => typeof window.switchSettingsSection === "function");
    const persisted = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("constitutionalValuationBasis") || "null")
    );
    expect(persisted).toBe("fresh");
    await openConstitutionalSettings(page, "currency");
    await expect(page.locator('#settings-constitutional-basis [data-val="fresh"]')).toHaveClass(
      /active/
    );
  });

  // ---- Group G: display + integrity (R5, R6-AC1/AC2/AC4) ----------------
  test("inventory weight summary counts constitutional silver content, not raw face", async ({
    page,
  }) => {
    await seedMoneyData(page, { inventory: [CU_QUARTERS_40] });
    await gotoApp(page);
    await openConstitutionalSettings(page, "system");
    await expect(page.locator("#invSummaryWeight")).toBeVisible();
    const text = await page.locator("#invSummaryWeight").textContent();
    const oz = parseFloat(String(text).replace(/[^0-9.]/g, ""));
    // 40 quarters worn ≈ 7.15 ozt silver, NOT the 10.00 raw face (40 × $0.25).
    expect(oz).toBeGreaterThan(6.5);
    expect(oz).toBeLessThan(8);
  });

  // STRK-233 — the Settings inventory summary card reports CURRENT in-stock holdings only.
  // Disposed (sold/traded/gifted/lost/returned) items must drop out of ALL four figures —
  // count, total weight, melt value, AND last-modified — via the canonical isDisposed()
  // predicate, otherwise they inflate the card with stock the user no longer holds.
  test("inventory summary card excludes disposed items from count, weight, melt, and last-modified", async ({
    page,
  }) => {
    const LIVE_TS = 1717000000000; // 2024-05-29 — older
    const DISPOSED_TS = 1740000000000; // 2025-02-19 — strictly NEWER; would win last-modified if unfiltered
    const liveAse = { ...MONEY_ITEM, uuid: "strk233-live", serial: 1, qty: 4, updatedAt: LIVE_TS };
    const disposedAse = {
      ...MONEY_ITEM,
      uuid: "strk233-disposed",
      serial: 2,
      qty: 4,
      updatedAt: DISPOSED_TS,
      disposition: { type: "sold", amount: 500, date: "2026-05-01" },
    };
    await seedMoneyData(page, { inventory: [liveAse, disposedAse] });
    await gotoApp(page);
    // Live spot so the melt reduce yields a real figure (spotPrices defaults to 0).
    await page.evaluate(() => {
      if (typeof spotPrices !== "undefined") spotPrices.silver = 30;
    });
    await openConstitutionalSettings(page, "system");

    // Count: only the 4 live units, NOT 8 (live + disposed).
    await expect(page.locator("#invSummaryCount")).toHaveText("4 items");

    // Weight: ~4 ozt (4 × 1 oz live), NOT ~8 ozt including the disposed bag.
    const wText = await page.locator("#invSummaryWeight").textContent();
    const liveOz = parseFloat(String(wText).replace(/[^0-9.]/g, ""));
    expect(liveOz).toBeGreaterThan(3.5);
    expect(liveOz).toBeLessThan(4.5);

    // Melt: 4 oz × $30 × 0.999 ≈ $120 (live only), NOT ~$240 including the disposed bag.
    const mText = await page.locator("#invSummaryMelt").textContent();
    const liveMelt = parseFloat(String(mText).replace(/[^0-9.]/g, ""));
    expect(liveMelt).toBeGreaterThan(100);
    expect(liveMelt).toBeLessThan(140);

    // Last modified: driven by the live item's date, NOT the strictly-newer disposed item's.
    const fmt = (ts) =>
      new Date(ts).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    await expect(page.locator("#invSummaryModified")).toHaveText(fmt(LIVE_TS));
    await expect(page.locator("#invSummaryModified")).not.toHaveText(fmt(DISPOSED_TS));
  });

  test("the per-item details view shows the variant and derived silver content", async ({
    page,
  }) => {
    await seedMoneyData(page, { inventory: [CU_QUARTERS_40] });
    await gotoApp(page);
    await page.evaluate(() => window.showViewModal(0));
    await expect(page.locator("#viewItemModal")).toBeVisible();
    await expect(page.locator("#viewItemModal")).toContainText(/90%\s*Quarter/i);
  });

  // STRK-237 put the derived pure-silver oz in the Weight cell and the face value in the
  // tooltip. STRK-300 REVERSES that pairing: constitutional silver is quoted, bought, and
  // mentally modelled by face value, and the table was the odd surface out (cards and the
  // detail modal already led with face). The cell now shows total face with an `fv` suffix and
  // the ASW moves to the tooltip. The sort key and the filter key are deliberately unchanged —
  // neither ever depended on this cell's text.
  test("inventory table weight column shows total face value for constitutional rows, ASW in tooltip", async ({
    page,
  }) => {
    await seedMoneyData(page, { inventory: [CU_QUARTERS_40] });
    await gotoApp(page);
    await page.waitForSelector("#inventoryTable tbody tr", { state: "visible" });
    const weightCell = page
      .locator("#inventoryTable tbody tr")
      .filter({ hasText: "Core 40 Silver Quarters" })
      .locator("td[data-column='weight'] .filter-text");
    // 40 quarters × $0.25 = $10.00 total face. Value-then-suffix, matching "0.54 oz" / "5 gb".
    await expect(weightCell).toHaveText("$10.00 fv");
    // The old in-column ozt figure is gone from the cell.
    await expect(weightCell).not.toContainText("oz");
    // ASW (~7.15 ozt worn) + valuation basis move to the tooltip, abbreviation expanded.
    const title = await weightCell.getAttribute("title");
    expect(title).toMatch(/ASW \(Actual Silver Weight\)/);
    expect(title).toMatch(/worn/i);
    const aswOz = parseFloat(title.match(/^([\d.]+) ozt/)[1]);
    expect(aswOz).toBeGreaterThan(6.5);
    expect(aswOz).toBeLessThan(8);
    // STRK-239/240: the cell is still click-to-filter and still keys on the ASW, so the mobile
    // tap contract and the STRK-240 anti-collision guarantee both survive the display flip.
    await expect(weightCell).toHaveClass(/\bfilter-text\b/);
    await expect(weightCell).toHaveAttribute(
      "onclick",
      new RegExp(`^applyColumnFilter\\('weight', "${aswOz.toFixed(2).replace(/\./g, "\\.")}"\\)$`)
    );
    await expect(weightCell).toHaveAttribute("role", "button");
  });

  // STRK-239 (beta feedback): the cu weight cell is interactive again — clicking it applies the
  // weight column filter, narrowing the table. The STRK-237 disable is reversed.
  // STRK-240: the filter keys on the DISPLAYED derived oz, not the stored face value.
  test("clicking a constitutional weight cell filters the table by its derived silver oz", async ({
    page,
  }) => {
    const CU_SILVER_DOLLAR = {
      ...CU_QUARTERS_40,
      uuid: "core-cu-dollar-filter",
      name: "Core Silver Dollar",
      constitutionalVariant: "con-90-dollar",
      weight: 1,
      qty: 1,
      serial: 34,
    };
    await seedMoneyData(page, { inventory: [CU_QUARTERS_40, CU_SILVER_DOLLAR] });
    await gotoApp(page);
    await page.waitForSelector("#inventoryTable tbody tr", { state: "visible" });
    const weightCell = page
      .locator("#inventoryTable tbody tr")
      .filter({ hasText: "Core 40 Silver Quarters" })
      .locator("td[data-column='weight'] .filter-text");
    // STRK-240: keys on the derived ASW (quoted string), not the stored per-coin face. The
    // ~0.76 oz silver dollar derives a different oz, so it is filtered out.
    // STRK-300: the ASW now lives in the tooltip rather than the cell text, so read it there —
    // which also asserts the tooltip and the filter key agree on the same figure.
    const quartersTitle = await weightCell.getAttribute("title");
    const quartersOz = quartersTitle.match(/^([\d.]+) ozt/)[1];
    await expect(weightCell).toHaveAttribute(
      "onclick",
      new RegExp(`^applyColumnFilter\\('weight', "${quartersOz.replace(/\./g, "\\.")}"\\)$`)
    );
    await expect(page.locator("#inventoryTable tbody tr")).toHaveCount(2);
    await weightCell.click();
    // Only the ~7.15 oz quarters remain; the ~0.76 oz dollar (a different derived oz) drops out.
    await expect(page.locator("#inventoryTable tbody tr")).toHaveCount(1);
    await expect(page.locator("#inventoryTable tbody tr")).toContainText("Core 40 Silver Quarters");
  });

  // STRK-240: the constitutional weight filter must key on the DISPLAYED derived oz, not the stored
  // face value. A FACE-mode item stores its $ face in `weight` (e.g. $10), so the old face-keyed
  // filter (STRK-239) compared dollars-of-face to ounces-of-weight and a $10-face bag wrongly
  // matched a 10 oz bar. Clicking the cu cell now filters on its ~7.15 oz and excludes the bar.
  test("constitutional weight filter keys on derived oz, not face — no collision with a same-numbered oz item", async ({
    page,
  }) => {
    const CU_FACE_10 = {
      ...CU_FACE_50,
      uuid: "core-cu-face-10",
      name: "Core $10 Face Bag",
      weight: 10, // $10 total face → derives ~7.15 oz (NOT 10 oz)
      serial: 40,
    };
    const TEN_OZ_BAR = {
      ...MONEY_ITEM,
      uuid: "core-ten-oz-bar",
      name: "Core Ten Oz Bar",
      type: "Bar",
      weightUnit: "oz",
      weight: 10, // raw weight 10 — the value the old face-keyed filter wrongly collided with
      qty: 1,
      serial: 41,
    };
    await seedMoneyData(page, { inventory: [CU_FACE_10, TEN_OZ_BAR] });
    await gotoApp(page);
    await page.waitForSelector("#inventoryTable tbody tr", { state: "visible" });
    await expect(page.locator("#inventoryTable tbody tr")).toHaveCount(2);

    const cuWeightCell = page
      .locator("#inventoryTable tbody tr")
      .filter({ hasText: "Core $10 Face Bag" })
      .locator("td[data-column='weight'] .filter-text");
    // The filter key is the derived ASW (~7.15), decisively != the stored face 10.
    // STRK-300: the cell text is now "$10.00 fv" and the ASW lives in the tooltip — which makes
    // this the sharper version of the test, since the cell text is once again the face number
    // 10 and yet must NOT collide with the 10 oz bar.
    await expect(cuWeightCell).toHaveText("$10.00 fv");
    const cuTitle = await cuWeightCell.getAttribute("title");
    const cuOz = cuTitle.match(/^([\d.]+) ozt/)[1];
    expect(parseFloat(cuOz)).toBeGreaterThan(6.5);
    expect(parseFloat(cuOz)).toBeLessThan(8);
    await expect(cuWeightCell).toHaveAttribute(
      "onclick",
      new RegExp(`^applyColumnFilter\\('weight', "${cuOz.replace(/\./g, "\\.")}"\\)$`)
    );

    await cuWeightCell.click();
    // Only the constitutional row survives; the 10 oz bar (raw weight 10) is NOT pulled in.
    await expect(page.locator("#inventoryTable tbody tr")).toHaveCount(1);
    await expect(page.locator("#inventoryTable tbody tr")).toContainText("Core $10 Face Bag");
    await expect(page.locator("#inventoryTable tbody tr")).not.toContainText("Core Ten Oz Bar");
  });

  // STRK-237 follow-up (PR #1328 review, T10/Codex): the Weight column now displays derived
  // silver oz for cu rows, so the column SORT must rank cu rows by that same derived oz — not
  // the stored face value. A 40-quarter bag (~7.15 oz, $0.25/coin face) must sort ABOVE a lone
  // silver dollar (~0.76 oz, $1.00 face); the old raw-weight sort ranked the dollar higher.
  test("inventory table weight sort ranks constitutional rows by derived silver oz, not face", async ({
    page,
  }) => {
    const CU_DOLLAR = {
      ...CU_QUARTERS_40,
      uuid: "core-cu-dollar-1",
      name: "Core Silver Dollar",
      constitutionalVariant: "con-90-dollar",
      weight: 1,
      qty: 1,
      serial: 32,
    };
    await seedMoneyData(page, { inventory: [CU_DOLLAR, CU_QUARTERS_40] });
    await page.addInitScript(() => {
      localStorage.setItem("defaultSortColumn", "6"); // Weight column
      localStorage.setItem("defaultSortDir", "desc");
    });
    await gotoApp(page);
    await page.waitForSelector("#inventoryTable tbody tr", { state: "visible" });
    const names = await page
      .locator("#inventoryTable tbody tr [data-column='name']")
      .allTextContents();
    // ~7.15 oz quarters outrank the ~0.76 oz dollar; the old raw-face sort ranked $1.00 > $0.25.
    expect(names[0]).toContain("Core 40 Silver Quarters");
    expect(names[1]).toContain("Core Silver Dollar");
  });

  // STRK-237 follow-up (PR #1328 review, T6/Copilot): in face-entry mode `weight` is already the
  // TOTAL face (qty is 1 by contract), so the face figure must be the stored value directly —
  // not weight × qty — even if legacy data carries qty > 1.
  // STRK-300 moved that figure from the tooltip into the cell, so the invariant is asserted
  // there now. It is the same guarantee, on the surface that carries the number today.
  test("constitutional face value uses the stored total in face mode (ignores qty)", async ({
    page,
  }) => {
    const CU_FACE_QTY2 = {
      ...CU_FACE_50,
      uuid: "core-cu-face-qty2",
      name: "Core Face Mode Qty2",
      weight: 50,
      qty: 2,
      serial: 33,
    };
    await seedMoneyData(page, { inventory: [CU_FACE_QTY2] });
    await gotoApp(page);
    await page.waitForSelector("#inventoryTable tbody tr", { state: "visible" });
    const cell = page
      .locator("#inventoryTable tbody tr")
      .filter({ hasText: "Core Face Mode Qty2" })
      .locator("td[data-column='weight'] .filter-text");
    // Stored total face is $50.00; a weight × qty fold would wrongly show $100.00.
    await expect(cell).toHaveText("$50.00 fv");
    await expect(cell).not.toContainText("$100.00");
    // The shared helper is the one place that decides this, so assert it directly too.
    const totals = await page.evaluate(() => ({
      faceMode: window.getConstitutionalTotalFace({
        weight: 50,
        qty: 2,
        constitutionalEntryMode: "face",
      }),
      denomMode: window.getConstitutionalTotalFace({
        weight: 0.25,
        qty: 24,
        constitutionalEntryMode: "denomination",
      }),
      zeroQty: window.getConstitutionalTotalFace({
        weight: 0.25,
        qty: 0,
        constitutionalEntryMode: "denomination",
      }),
    }));
    expect(totals.faceMode).toBe(50); // stored total, qty ignored by contract
    expect(totals.denomMode).toBeCloseTo(6, 9); // 24 × $0.25
    expect(totals.zeroQty).toBe(0); // mirrors getConstitutionalSilverOz's qty handling
  });

  test("constitutional rows have a dedicated type-color token defined", async ({ page }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    const token = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--type-constitutional-bg").trim()
    );
    expect(token.length).toBeGreaterThan(0);
  });

  test("bulk edit type to Constitutional coerces unit to cu and metal to Silver", async ({
    page,
  }) => {
    await seedMoneyData(page, { inventory: [MONEY_ITEM] });
    await gotoApp(page);
    await page.waitForFunction(() => typeof window.openBulkEdit === "function");
    await page.evaluate(() => window.openBulkEdit());
    await expect(page.locator("#bulkEditModal")).toBeVisible({ timeout: 10000 });
    // Bulk-edit inputs are checkbox-gated — enable the Type and Weight Unit fields
    // before interacting (established pattern, see strk-117-goldback-type.spec.js).
    await page.click("#bulkField_type");
    await page.click("#bulkField_weightUnit");
    await page.selectOption("#bulkFieldVal_type", "Constitutional");
    await expect
      .poll(() => page.evaluate(() => document.getElementById("bulkFieldVal_weightUnit")?.value))
      .toBe("cu");
  });

  // STRK-238 — bulk type→Constitutional must stage VALID constitutional metadata
  // (denom-only sub-control) so the coerced item is not a 0-silver-oz ghost. The
  // denomination picker drives constitutionalVariant + entryMode="denom"; each
  // item keeps its existing qty as the coin count. The metadata bundle is
  // force-applied past the checkbox gate (only Type need be enabled).
  test("bulk type→Constitutional with a denomination yields valid, non-zero-oz items", async ({
    page,
  }) => {
    await seedAndOpenBulkEdit(page, [MONEY_ITEM]);

    // Enable only the Type field, choose Constitutional, then pick a denomination
    // from the new sub-control. weightUnit/metal/entryMode/variant are coupled.
    await page.click("#bulkField_type");
    await page.selectOption("#bulkFieldVal_type", "Constitutional");
    await expect(page.locator("#bulkFieldVal_constitutionalVariant")).toBeVisible();
    await page.selectOption("#bulkFieldVal_constitutionalVariant", "con-90-quarter");

    await page.click("#bulkEditApplyBtn");
    await page.waitForSelector("#bulkConfirmModal", { state: "visible" });
    await page.click("#bulkConfirmOkBtn");

    const result = await page.evaluate(() => {
      const it = window.inventory.find((i) => i.serial === 1);
      return {
        weightUnit: it.weightUnit,
        metal: it.metal,
        mode: it.constitutionalEntryMode,
        variant: it.constitutionalVariant,
        qty: it.qty,
        oz: window.getConstitutionalSilverOz(it),
        expected: 0.18084 * window.getConstitutionalWearFactor() * it.qty,
      };
    });
    expect(result.weightUnit).toBe("cu");
    expect(result.metal).toBe("Silver");
    expect(result.mode).toBe("denom");
    expect(result.variant).toBe("con-90-quarter");
    expect(result.qty).toBe(4); // denom-only: existing qty preserved as coin count
    expect(result.oz).toBeGreaterThan(0);
    expect(result.oz).toBeCloseTo(result.expected, 6);
  });

  // STRK-238 — the picker must also trigger off a manual Weight-Unit→cu change
  // (not only Type→Constitutional), and the same metadata bundle must apply.
  test("bulk manual weight-unit→cu reveals the denomination picker and applies valid metadata", async ({
    page,
  }) => {
    await seedAndOpenBulkEdit(page, [MONEY_ITEM]);

    // Enable the Weight Unit field and pick cu directly — no Type change.
    await page.click("#bulkField_weightUnit");
    await page.selectOption("#bulkFieldVal_weightUnit", "cu");
    await expect(page.locator("#bulkFieldVal_constitutionalVariant")).toBeVisible();
    await page.selectOption("#bulkFieldVal_constitutionalVariant", "con-90-dime");

    await page.click("#bulkEditApplyBtn");
    await page.waitForSelector("#bulkConfirmModal", { state: "visible" });
    await page.click("#bulkConfirmOkBtn");

    const result = await page.evaluate(() => {
      const it = window.inventory.find((i) => i.serial === 1);
      return {
        weightUnit: it.weightUnit,
        metal: it.metal,
        mode: it.constitutionalEntryMode,
        variant: it.constitutionalVariant,
        qty: it.qty,
        oz: window.getConstitutionalSilverOz(it),
        expected: 0.07234 * window.getConstitutionalWearFactor() * it.qty,
      };
    });
    expect(result.weightUnit).toBe("cu");
    expect(result.metal).toBe("Silver");
    expect(result.mode).toBe("denom");
    expect(result.variant).toBe("con-90-dime");
    expect(result.qty).toBe(4);
    expect(result.oz).toBeGreaterThan(0);
    expect(result.oz).toBeCloseTo(result.expected, 6);
  });

  // STRK-246 — bulk type→Goldback must stage the full goldback metadata bundle
  // (weightUnit="gb" + metal="Gold" + the picked denomination as `weight`) past the
  // checkbox gate, mirroring STRK-238's constitutional bundle. Without it the item
  // keeps weightUnit="oz" and is a malformed goldback valued as plain oz, and the
  // STRK-244 recording gate captures nothing — leaving the value chart stale.
  test("bulk type→Goldback with a denomination yields a valid gb item and records history", async ({
    page,
  }) => {
    // Seed a NON-fine (90%) source item so the purity reset is observable: gb melt
    // multiplies by item.purity, so a leftover 0.9 would under-value the conversion.
    await seedAndOpenBulkEdit(page, [{ ...MONEY_ITEM, purity: 0.9 }]);

    // Goldback is a Gold-only type — set Metal→Gold first to un-hide it (the bulk
    // type<-metal filter, see strk-117). Enable Weight so the denomination picker is
    // interactive, but deliberately leave weightUnit UNCHECKED: the resulting
    // weightUnit="gb" can then only come from applyBulkGoldbackBundle's past-the-gate
    // injection, which is exactly the STRK-246 fix under test.
    await page.click("#bulkField_metal");
    await page.selectOption("#bulkFieldVal_metal", "Gold");
    await page.click("#bulkField_type");
    await page.click("#bulkField_weight");
    await page.selectOption("#bulkFieldVal_type", "Goldback");
    await expect(page.locator("#bulkFieldVal_weightDenom")).toBeVisible();
    await page.selectOption("#bulkFieldVal_weightDenom", "5");

    await page.click("#bulkEditApplyBtn");
    await page.waitForSelector("#bulkConfirmModal", { state: "visible" });
    await page.click("#bulkConfirmOkBtn");

    const result = await page.evaluate(() => {
      const it = window.inventory.find((i) => i.serial === 1);
      const hist = JSON.parse(localStorage.getItem("item-price-history") || "{}");
      return {
        weightUnit: it.weightUnit,
        metal: it.metal,
        weight: Number(it.weight),
        purity: Number(it.purity),
        historyPoints: (hist[it.uuid] || []).length,
      };
    });
    // The conversion actually takes effect (not a malformed oz-valued goldback).
    expect(result.weightUnit).toBe("gb");
    expect(result.metal).toBe("Gold");
    expect(result.weight).toBe(5); // denomination NUMBER, the key getGoldbackRetailPrice prices off
    expect(result.purity).toBe(0.999); // stale 0.9 reset to goldback fineness — no melt under-valuation
    // STRK-244 gate now records the converted valuation (bundle keys are price-relevant).
    expect(result.historyPoints).toBeGreaterThanOrEqual(1);
  });

  // STRK-246 — the Goldback bundle must also fire on a manual Weight-Unit→gb change
  // (the second branch of isGoldbackApply), not only Type→Goldback — mirroring the
  // STRK-238 constitutional manual-unit path. metal="Gold" must be injected even
  // though the Type and Metal fields are never touched.
  test("bulk manual weight-unit→gb injects the goldback bundle without a Type change", async ({
    page,
  }) => {
    await seedAndOpenBulkEdit(page, [MONEY_ITEM]);

    // Enable Weight Unit + Weight, pick gb directly (no Type change). The denomination
    // picker reveals; metal="Gold" and the picked denomination as weight are injected
    // by applyBulkGoldbackBundle via the isGoldbackApply weightUnit branch.
    await page.click("#bulkField_weightUnit");
    await page.click("#bulkField_weight");
    await page.selectOption("#bulkFieldVal_weightUnit", "gb");
    await expect(page.locator("#bulkFieldVal_weightDenom")).toBeVisible();
    await page.selectOption("#bulkFieldVal_weightDenom", "10");

    await page.click("#bulkEditApplyBtn");
    await page.waitForSelector("#bulkConfirmModal", { state: "visible" });
    await page.click("#bulkConfirmOkBtn");

    const result = await page.evaluate(() => {
      const it = window.inventory.find((i) => i.serial === 1);
      return { weightUnit: it.weightUnit, metal: it.metal, weight: Number(it.weight) };
    });
    expect(result.weightUnit).toBe("gb");
    expect(result.metal).toBe("Gold"); // injected by the bundle — Metal field untouched
    expect(result.weight).toBe(10);
  });

  test("existing manually-entered 90% Silver coins are unaffected", async ({ page }) => {
    const legacyCoin = {
      ...MONEY_ITEM,
      uuid: "core-legacy-90",
      name: "Core Legacy 90 Coin",
      type: "Coin",
      weightUnit: "oz",
      weight: 0.715,
      qty: 1,
      purity: 0.9,
    };
    await seedMoneyData(page, { inventory: [legacyCoin] });
    await gotoApp(page);
    const melt = await page.evaluate(() => window.computeMeltValue(window.inventory[0], 30));
    // Unchanged generic path: weight × qty × spot × purity.
    expect(melt).toBeCloseTo(0.715 * 30 * 0.9, 4);
    expect(await page.evaluate(() => window.inventory[0].weightUnit)).toBe("oz");
  });

  test("a constitutional item round-trips through reload without data loss", async ({ page }) => {
    await seedMoneyData(page, { inventory: [CU_FACE_50] });
    await gotoApp(page);
    await page.reload();
    await page.waitForFunction(() => Array.isArray(window.inventory) && window.inventory.length);
    const restored = await page.evaluate(() => {
      const it = JSON.parse(localStorage.getItem("metalInventory"))[0];
      return {
        weightUnit: it.weightUnit,
        mode: it.constitutionalEntryMode,
        variant: it.constitutionalVariant,
        weight: it.weight,
        qty: it.qty,
      };
    });
    expect(restored.weightUnit).toBe("cu");
    expect(restored.mode).toBe("face");
    expect(restored.variant).toBe("con-90-subsidiary");
    expect(Number(restored.weight)).toBeCloseTo(50, 6);
    expect(Number(restored.qty)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// STRK-243 — constitutional pre-ship fix (surfaced by the v3.35.55 dev→main ship
// review). Picking the cu weight-unit option directly dead-ends the save.
// ---------------------------------------------------------------------------
test.describe("core/inventory-math — STRK-243 constitutional pre-ship fix", () => {
  test("STRK-243 — the constitutional unit is Type-driven, not a manual dropdown choice", async ({
    page,
  }) => {
    await seedMoneyData(page);
    await gotoApp(page);
    await openAddModal(page);

    // The cu unit option must not be user-selectable: choosing it directly while
    // Type != Constitutional left the constitutional card hidden, so the save read
    // blank hidden fields -> weight 0 validation dead-end. Type=Constitutional is
    // the canonical path and drives the unit programmatically.
    await expect(page.locator('#itemWeightUnit option[value="cu"]')).toHaveAttribute("hidden", "");

    // The canonical path still wires everything: Type=Constitutional -> unit=cu + card shown.
    await page.selectOption("#itemType", "Constitutional");
    await expect(page.locator("#itemWeightUnit")).toHaveValue("cu");
    await expect(page.locator("#item-constitutional-group")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// STRK-244 / STRK-245 — constitutional valuation-change price-history recording
// and the Type→Constitutional custom-purity reset (surfaced by the v3.35.56
// dev→main ship review; same systemic root as STRK-241 — a valuation field not
// registered at a value-change-detection site).
// ---------------------------------------------------------------------------
const CU_HALVES_90 = {
  ...MONEY_ITEM,
  uuid: "core-cu-halves-90",
  name: "Core 90% Half Dollars",
  type: "Constitutional",
  metal: "Silver",
  composition: "Silver",
  weightUnit: "cu",
  constitutionalEntryMode: "denom",
  constitutionalVariant: "con-90-half",
  weight: 0.5,
  qty: 20,
  purity: 0.9,
  price: 0,
  serial: 60,
};

const OZ_COIN_FOR_CONVERT = {
  ...MONEY_ITEM,
  uuid: "core-oz-coin-convert",
  name: "Core Oz Coin",
  type: "Coin",
  metal: "Silver",
  composition: "Silver",
  weightUnit: "oz",
  weight: 1,
  qty: 1,
  purity: 0.999,
  price: 100,
  serial: 61,
};

test.describe("core/inventory-math — STRK-244/245 constitutional valuation history + purity reset", () => {
  test("STRK-244 — a denomination-only edit (con-90-half → con-40-half) records a price-history point", async ({
    page,
  }) => {
    await seedMoneyData(page, { inventory: [CU_HALVES_90] });
    await gotoApp(page);

    // Start from an empty per-item history so the recording is unconditional (no
    // prior entry to dedup against) — isolates the edit gate from spot/melt timing.
    await page.evaluate(() => {
      localStorage.setItem("item-price-history", JSON.stringify({}));
      if (window.loadItemPriceHistory) window.loadItemPriceHistory();
    });

    await openEditModal(page, 0);
    // Both variants share facePerCoin 0.5, so the stored `weight` is unchanged —
    // only constitutionalVariant (90%→40%) moves, which the legacy gate missed.
    await page.selectOption("#item-constitutional-variant", "con-40-half");
    await submitItemForm(page);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const h = JSON.parse(localStorage.getItem("item-price-history") || "{}");
          return (h["core-cu-halves-90"] || []).length;
        })
      )
      .toBe(1);
  });

  test("STRK-245 — converting a Custom-purity item to Constitutional hides the wrapper and saves the reset purity", async ({
    page,
  }) => {
    await seedMoneyData(page, { inventory: [OZ_COIN_FOR_CONVERT] });
    await gotoApp(page);
    await openEditModal(page, 0);

    // Put the modal in the buggy state: a visible custom-purity input.
    await page.selectOption("#itemPuritySelect", "custom");
    await page.fill("#itemPurity", "0.875");
    await expect(page.locator("#purityCustomWrapper")).toBeVisible();

    // Convert to Constitutional — the orphaned custom input must hide. It lives
    // outside #standardMeasureRow, so toggleConstitutionalGroup alone won't hide it.
    await page.selectOption("#itemType", "Constitutional");
    await expect(page.locator("#purityCustomWrapper")).toBeHidden();

    // And the stale custom purity must not persist onto the saved cu item — the reset
    // lands at SAVE time (parseItemFormFields coerces cu purity to 0.999), so the saved
    // cu item carries 0.999, not the orphaned 0.875 (cu valuation ignores purity anyway).
    await page.fill("#item-constitutional-face", "50");
    await submitItemForm(page);
    const saved = await getInventoryItem(page, "Core Oz Coin");
    expect(saved).toBeTruthy();
    expect(saved.weightUnit).toBe("cu");
    expect(saved.purity).toBeCloseTo(0.999, 4);
  });

  test("STRK-245 — converting an item with a NON-custom preset purity to Constitutional preserves the preset", async ({
    page,
  }) => {
    // Copilot review guard: the purity reset must fire ONLY for "custom". Forcing a
    // non-custom preset (e.g. .925 Sterling) to 0.999 would silently corrupt purity
    // if the user toggled Type to Constitutional and back to a normal type.
    await seedMoneyData(page, { inventory: [OZ_COIN_FOR_CONVERT] });
    await gotoApp(page);
    await openEditModal(page, 0);

    await page.selectOption("#itemPuritySelect", "0.925");
    await expect(page.locator("#purityCustomWrapper")).toBeHidden();

    await page.selectOption("#itemType", "Constitutional");
    // The preset must survive untouched (not clobbered to 0.999); the wrapper stays
    // hidden since this was never the custom case.
    await expect(page.locator("#purityCustomWrapper")).toBeHidden();
    const purityValue = await page.evaluate(
      () => document.getElementById("itemPuritySelect")?.value
    );
    expect(purityValue).toBe("0.925");
  });

  test("STRK-245 — backing out of Constitutional before saving preserves a custom purity (no data loss)", async ({
    page,
  }) => {
    // Codex review guard: the purity reset must land at SAVE time (final type = cu), not
    // on the transient type-change. Toggling INTO Constitutional and back OUT must not
    // destroy the custom value, else the user silently loses it on the next save.
    await seedMoneyData(page, { inventory: [OZ_COIN_FOR_CONVERT] });
    await gotoApp(page);
    await openEditModal(page, 0);

    await page.selectOption("#itemPuritySelect", "custom");
    await page.fill("#itemPurity", "0.875");

    // Pass THROUGH Constitutional (hides the wrapper) and back to a normal type.
    await page.selectOption("#itemType", "Constitutional");
    await page.selectOption("#itemType", "Coin");

    // The custom input is restored and its value survives the round-trip.
    await expect(page.locator("#purityCustomWrapper")).toBeVisible();
    await expect(page.locator("#itemPurity")).toHaveValue("0.875");

    // Saving as a normal Coin keeps the original custom purity (not reset to 0.999).
    await submitItemForm(page);
    const saved = await getInventoryItem(page, "Core Oz Coin");
    expect(saved.weightUnit).toBe("oz");
    expect(saved.purity).toBeCloseTo(0.875, 4);
  });
});

test.describe("core/inventory-math — STRK-247 purity-wrapper visibility centralization", () => {
  test("custom purity → Constitutional → Goldback re-shows the custom-purity wrapper", async ({
    page,
  }) => {
    // STRK-247 (Codex, PR #1336 follow-up): the gb/sb branch of handleTypeChange
    // preserves a "custom" purity select but historically never re-showed
    // #purityCustomWrapper. Threading custom → Constitutional (hides it) → Goldback
    // left the wrapper stuck hidden while the select stayed "custom", silently
    // persisting a stale value the user could neither see nor correct. Only the
    // non-special else branch (STRK-245) restored visibility — same per-branch
    // omission class as STRK-245 itself. The centralized recompute fixes all branches.
    await seedMoneyData(page, { inventory: [OZ_COIN_FOR_CONVERT] });
    await gotoApp(page);
    await openEditModal(page, 0);

    // Put the modal in a visible custom-purity state.
    await page.selectOption("#itemPuritySelect", "custom");
    await page.fill("#itemPurity", "0.875");
    await expect(page.locator("#purityCustomWrapper")).toBeVisible();

    // Pass THROUGH Constitutional — the orphaned custom input hides (it lives outside
    // #standardMeasureRow, so toggleConstitutionalGroup alone would not hide it).
    await page.selectOption("#itemType", "Constitutional");
    await expect(page.locator("#purityCustomWrapper")).toBeHidden();

    // …then jump straight to Goldback. Centralized visibility re-shows the wrapper
    // because the select is still "custom" and the type is not Constitutional, so the
    // persisted purity is once again an honest, visible, editable value.
    await page.selectOption("#itemType", "Goldback");
    await expect(page.locator("#itemPuritySelect")).toHaveValue("custom");
    await expect(page.locator("#purityCustomWrapper")).toBeVisible();
    await expect(page.locator("#itemPurity")).toHaveValue("0.875");
  });

  test("custom purity → Constitutional → Silverback re-shows the wrapper and saves the visible purity", async ({
    page,
  }) => {
    await seedMoneyData(page, { inventory: [OZ_COIN_FOR_CONVERT] });
    await gotoApp(page);
    await openEditModal(page, 0);

    await page.selectOption("#itemPuritySelect", "custom");
    await page.fill("#itemPurity", "0.85");

    // custom → Constitutional (hides wrapper) → Silverback (gb/sb branch).
    await page.selectOption("#itemType", "Constitutional");
    await page.selectOption("#itemType", "Silverback");

    // The wrapper is honest again: visible, tracking the still-"custom" select. What
    // the user sees is exactly what persists — no hidden purity silently feeding the
    // sb melt valuation (computeMeltValue applies ×purity for non-cu items).
    await expect(page.locator("#purityCustomWrapper")).toBeVisible();
    await expect(page.locator("#itemPurity")).toHaveValue("0.85");

    await submitItemForm(page);
    const saved = await getInventoryItem(page, "Core Oz Coin");
    expect(saved.weightUnit).toBe("sb");
    expect(saved.purity).toBeCloseTo(0.85, 4);
  });
});

// ===========================================================================
// STRK-242 — Constitutional by-denomination lot pricing (coin-count = lot qty)
// Cohort B (RED): asserts not-yet-built behavior; MUST fail before Cohort C.
// Assertions check DOM structure + stored data (toggle `is-hidden` class, toggle
// mode, item.price/pricingType/qty) — never just visible text (STRK-123).
// ===========================================================================

const CU_DENOM_LOT_STORED = {
  ...CU_QUARTERS_40,
  uuid: "core-cu-denom-lot-stored",
  name: "Core CU Denom Lot Stored",
  qty: 30,
  price: 1700 / 30, // per-unit; price × qty reconstructs the 1700 lot total
  pricingType: "lot",
  serial: 42,
};

const CU_DENOM_EACH_STORED = {
  ...CU_QUARTERS_40,
  uuid: "core-cu-denom-each-stored",
  name: "Core CU Denom Each Stored",
  qty: 30,
  price: 56.67,
  pricingType: "each",
  serial: 43,
};

const CU_DENOM_LEGACY_NOTYPE = { ...CU_QUARTERS_40 };
CU_DENOM_LEGACY_NOTYPE.uuid = "core-cu-denom-legacy";
CU_DENOM_LEGACY_NOTYPE.name = "Core CU Denom Legacy";
CU_DENOM_LEGACY_NOTYPE.qty = 30;
CU_DENOM_LEGACY_NOTYPE.price = 56.67;
CU_DENOM_LEGACY_NOTYPE.serial = 44;
delete CU_DENOM_LEGACY_NOTYPE.pricingType; // legacy item → treated as each (AC-7)

const CU_FACE_STORED = {
  ...CU_FACE_50,
  uuid: "core-cu-face-stored",
  name: "Core CU Face Stored",
  price: 100,
  serial: 45,
};

/** Fresh app on an empty inventory. */
async function gotoFresh(page) {
  await seedMoneyData(page);
  await gotoApp(page);
}

/** Drive the add-item modal into cu by-denomination mode with a given coin count. */
async function addModalCuDenom(page, { variant = "con-90-quarter", count }) {
  await openAddModal(page);
  await page.selectOption("#itemMetal", "Silver");
  await page.selectOption("#itemType", "Constitutional");
  await page.click('#constitutional-entry-mode-toggle [data-mode="denom"]');
  await page.selectOption("#item-constitutional-variant", variant);
  await page.fill("#item-constitutional-count", String(count));
}

/** Fresh app + add-item modal already in cu by-denomination mode. */
async function freshAddCuDenom(page, opts) {
  await gotoFresh(page);
  await addModalCuDenom(page, opts);
}

/** Add + save a cu by-denomination item through the real modal save path. */
async function saveCuDenomItem(page, { name, count, price, variant = "con-90-quarter" }) {
  await freshAddCuDenom(page, { variant, count });
  await page.fill("#itemName", name);
  await page.fill("#itemDate", "2026-04-01");
  await page.fill("#itemPrice", String(price));
  await page.click("#itemModalSubmit");
  await expect(page.locator("#itemModal")).toBeHidden();
}

/** Seed one item and load the app. */
async function seedAndGoto(page, item) {
  await seedMoneyData(page, { inventory: [item] });
  await gotoApp(page);
}

/** Seed one item, load the app, and open it in the edit modal. */
async function seedAndEdit(page, item) {
  await seedAndGoto(page, item);
  await openEditModal(page, 0);
}

/** Assert the purchase-price toggle is shown (not is-hidden). */
async function expectToggleShown(page) {
  await expect(page.locator("#purchasePriceModeToggle")).not.toHaveClass(/is-hidden/);
}

/** Assert the toggle is shown AND the given mode button is active. */
async function expectToggleVisible(page, mode) {
  await expectToggleShown(page);
  await expect(purchaseModeButton(page, mode)).toHaveClass(/active/);
}

/** Assert the purchase-price toggle is hidden (is-hidden). */
async function expectToggleHidden(page) {
  await expect(page.locator("#purchasePriceModeToggle")).toHaveClass(/is-hidden/);
}

// Shared base for the cu persistence-detection evaluates (hash/diff) — passed into
// page.evaluate so this object literal is declared once (keeps the duplication gate happy).
const CU_DETECT_BASE = {
  name: "CU Detect Base",
  metal: "Silver",
  weight: 0.25,
  date: "2026-04-01",
  type: "Constitutional",
  weightUnit: "cu",
  constitutionalVariant: "con-90-quarter",
  constitutionalEntryMode: "denom",
  qty: 30,
  price: 1700 / 30,
};

/** Capture window.exportJson()'s JSON payload without writing a file to disk. */
async function captureJsonExport(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const original = URL.createObjectURL;
        URL.createObjectURL = (blob) => {
          const reader = new FileReader();
          reader.onload = () => {
            URL.createObjectURL = original;
            try {
              resolve(JSON.parse(reader.result));
            } catch (e) {
              reject(e);
            }
          };
          reader.onerror = () => {
            URL.createObjectURL = original;
            reject(new Error("FileReader failed to read export blob"));
          };
          reader.readAsText(blob);
          return original.call(URL, blob);
        };
        try {
          window.exportJson();
        } catch (e) {
          URL.createObjectURL = original;
          reject(e);
        }
      })
  );
}

test.describe("core/inventory-math — STRK-242 constitutional lot pricing", () => {
  // ---- B.1: toggle visibility + default + live re-resolve (AC-1, AC-2, AC-5, AC-9) ----
  test("denomination mode shows the purchase toggle defaulted to LOT (AC-1, AC-2)", async ({
    page,
  }) => {
    await freshAddCuDenom(page, { count: 40 });
    await expectToggleVisible(page, "lot");
  });

  test("denomination count > 1 shows the toggle; count <= 1 hides it (AC-9 corner)", async ({
    page,
  }) => {
    await freshAddCuDenom(page, { count: 40 });
    await expectToggleShown(page);
    await page.fill("#item-constitutional-count", "1");
    await expectToggleHidden(page);
  });

  test("switching constitutional entry mode live re-resolves the toggle (AC-5, AC-9)", async ({
    page,
  }) => {
    await freshAddCuDenom(page, { count: 40 });
    await expectToggleVisible(page, "lot");
    // denom → face: toggle disappears, reverts to EACH
    await page.click('#constitutional-entry-mode-toggle [data-mode="face"]');
    await expectToggleHidden(page);
    // face → denom: toggle reappears and snaps to LOT
    await page.click('#constitutional-entry-mode-toggle [data-mode="denom"]');
    await expectToggleVisible(page, "lot");
  });

  // ---- B.2: save divides by cu.qty + exact-lot round-trip + face never divides (AC-3, AC-4, AC-6) ----
  test("denomination LOT save divides the lot total by coin count, not #itemQty (AC-3)", async ({
    page,
  }) => {
    const name = "Core CU Denom LOT Divide";
    await saveCuDenomItem(page, { name, count: 30, price: 1700 });

    const saved = await getInventoryItem(page, name);
    expect(saved).toBeTruthy();
    expect(saved.pricingType).toBe("lot");
    expect(Number(saved.qty)).toBe(30);
    expect(saved.price).toBeCloseTo(1700 / 30, 10);
    expect(saved.price * saved.qty).toBeCloseTo(1700, 9);
  });

  test("uneven lot division reconstructs the exact total on edit without drift (AC-4)", async ({
    page,
  }) => {
    const name = "Core CU Denom Exact Lot";
    await saveCuDenomItem(page, { name, count: 30, price: 1700 });

    const saved = await getInventoryItem(page, name);
    expect(saved.price * saved.qty).toBeCloseTo(1700, 9);

    await openEditModal(page, 0);
    await expect(purchaseModeButton(page, "lot")).toHaveClass(/active/);
    await expect(page.locator("#itemPrice")).toHaveValue("1700.00");
  });

  test("face-value mode never divides the entered price (AC-6 regression guard)", async ({
    page,
  }) => {
    // Regression guard re-scoping STRK-235's no-divide protection to face mode. Green
    // before AND after Cohort C — it protects the C.3 guard reshape from accidentally
    // dividing a face entry. B.2's RED signal comes from AC-3/AC-4, not this guard.
    const name = "Core CU Face No Divide";
    await gotoFresh(page);
    await openAddModal(page);
    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Constitutional");
    await page.click('#constitutional-entry-mode-toggle [data-mode="face"]');
    await page.fill("#item-constitutional-face", "50");
    await expectToggleHidden(page);
    await page.fill("#itemName", name);
    await page.fill("#itemDate", "2026-04-01");
    await page.fill("#itemPrice", "100");
    await page.click("#itemModalSubmit");
    await expect(page.locator("#itemModal")).toBeHidden();

    const saved = await getInventoryItem(page, name);
    expect(saved.constitutionalEntryMode).toBe("face");
    expect(saved.price).toBe(100);
  });

  // ---- B.3: edit-restore of stored pricingType (AC-7, AC-8) ----
  test("editing a stored denom LOT item restores toggle visible + LOT, reconstructed total (AC-7)", async ({
    page,
  }) => {
    await seedAndEdit(page, CU_DENOM_LOT_STORED);
    await expectToggleVisible(page, "lot");
    await expect(page.locator("#itemPrice")).toHaveValue("1700.00");
  });

  test("editing a stored denom EACH item restores toggle visible + EACH per-coin (AC-7)", async ({
    page,
  }) => {
    await seedAndEdit(page, CU_DENOM_EACH_STORED);
    await expectToggleVisible(page, "each");
    await expect(page.locator("#itemPrice")).toHaveValue("56.67");
  });

  test("editing a legacy denom item (no pricingType) defaults to EACH (AC-7)", async ({ page }) => {
    await seedAndEdit(page, CU_DENOM_LEGACY_NOTYPE);
    await expectToggleVisible(page, "each");
  });

  test("editing a stored face item keeps toggle hidden, price = stored total (AC-8)", async ({
    page,
  }) => {
    await seedAndEdit(page, CU_FACE_STORED);
    await expectToggleHidden(page);
    await expect(page.locator("#itemPrice")).toHaveValue("100.00");
  });

  // ---- Review regressions (PR #1340): override-bleed + count re-default ----
  test("cu denom qty override does not bleed into a Coin's lot/each conversion (type exit clears it)", async ({
    page,
  }) => {
    // codex P2 / CodeRabbit: switching Type away from Constitutional must clear the qty
    // override, or readQty keeps reading #item-constitutional-count for the next item.
    await freshAddCuDenom(page, { count: 40 });
    await expectToggleVisible(page, "lot");
    await page.selectOption("#itemType", "Coin");
    await page.fill("#itemName", "Bleed Guard Coin");
    await page.fill("#itemWeight", "1");
    await page.fill("#itemDate", "2026-04-01");
    await page.fill("#itemQty", "3");
    await selectPurchaseMode(page, "lot");
    await page.fill("#itemPrice", "90");
    await selectPurchaseMode(page, "each");
    // 90 / #itemQty(3) = 30.00 — NOT 90 / count(40) = 2.25 (which a bled override would give)
    await expect(page.locator("#itemPrice")).toHaveValue("30.00");
  });

  test("editing a stored denom EACH item does not flip to LOT when the count changes", async ({
    page,
  }) => {
    // Copilot: after restore, wasInteracted() is false, so a count edit previously re-applied
    // the LOT default and silently converted a per-coin (each) item to lot pricing.
    await seedAndEdit(page, CU_DENOM_EACH_STORED);
    await expectToggleVisible(page, "each");
    await page.fill("#item-constitutional-count", "20");
    await expectToggleVisible(page, "each");
  });

  // ---- B.4: pricingType persistence registration (D-6 / AC-7, AC-4 durability) ----
  test("pricingType survives a JSON export → import round-trip (AC-7 durability)", async ({
    page,
  }) => {
    await seedAndGoto(page, CU_DENOM_LOT_STORED);

    const exported = await captureJsonExport(page);
    const exportedItem = exported.items.find((it) => it.uuid === CU_DENOM_LOT_STORED.uuid);
    expect(exportedItem).toBeTruthy();
    expect(exportedItem.pricingType).toBe("lot"); // C.8 — JSON export whitelist

    await page.evaluate((text) => window.importJsonFromText(text, true), JSON.stringify(exported));
    await expect
      .poll(() =>
        page.evaluate(
          (uuid) => (window.inventory.find((it) => it.uuid === uuid) || {}).pricingType,
          CU_DENOM_LOT_STORED.uuid
        )
      )
      .toBe("lot"); // C.9 — JSON import read
  });

  test("pricingType is written to the ZIP backup inventory whitelist (AC-7 durability)", async ({
    page,
  }) => {
    // Backup WRITE coverage (C.10). restoreBackupZip JSON.parses the stored inventory
    // verbatim (no per-field whitelist), so a written field round-trips on restore.
    await seedAndGoto(page, CU_DENOM_LOT_STORED);
    const backedUp = await page.evaluate(async (uuid) => {
      const blob = await window.createBackupZip();
      const zip = await JSZip.loadAsync(blob);
      const json = JSON.parse(await zip.file("inventory_data.json").async("string"));
      return (json.inventory.find((it) => it.uuid === uuid) || {}).pricingType;
    }, CU_DENOM_LOT_STORED.uuid);
    expect(backedUp).toBe("lot");
  });

  test("computeInventoryHash is cu-scoped and changes when only pricingType differs (AC-7 durability)", async ({
    page,
  }) => {
    await gotoFresh(page);
    const result = await page.evaluate(async (base) => {
      const cuLot = { ...base, uuid: "h-cu", pricingType: "lot" };
      const cuEach = { ...base, uuid: "h-cu", pricingType: "each" };
      // non-cu pair differing only in pricingType — must stay equal (cu-scope guard,
      // no one-time upgrade-sync churn for inventories without junk silver).
      const baseCoin = {
        uuid: "h-coin",
        name: "Hash Coin",
        metal: "Silver",
        weight: 1,
        date: "2026-04-01",
        type: "Coin",
        weightUnit: "oz",
        qty: 2,
        price: 50,
      };
      const coinLot = { ...baseCoin, pricingType: "lot" };
      const coinEach = { ...baseCoin, pricingType: "each" };
      return {
        cuLot: await window.computeInventoryHash([cuLot]),
        cuEach: await window.computeInventoryHash([cuEach]),
        coinLot: await window.computeInventoryHash([coinLot]),
        coinEach: await window.computeInventoryHash([coinEach]),
      };
    }, CU_DETECT_BASE);
    expect(result.cuLot).toBeTruthy();
    expect(result.cuLot).not.toBe(result.cuEach); // C.11 — cu hash includes pricingType
    expect(result.coinLot).toBe(result.coinEach); // non-cu hash unchanged
  });

  test("DiffEngine and changeLog register a pricingType-only change (AC-7 durability)", async ({
    page,
  }) => {
    await gotoFresh(page);
    const result = await page.evaluate((base) => {
      const each = { ...base, uuid: "d-cu", pricingType: "each" };
      const lot = { ...base, uuid: "d-cu", pricingType: "lot" };
      const diff = window.DiffEngine.compareItems([each], [lot]);
      const modifiedFields = diff.modified.flatMap((m) => m.changes.map((c) => c.field));
      window.changeLog.splice(0, window.changeLog.length);
      window.logItemChanges(each, lot);
      const logged = window.changeLog.filter((e) => e.field === "pricingType").length;
      return { modifiedFields, logged };
    }, CU_DETECT_BASE);
    expect(result.modifiedFields).toContain("pricingType"); // C.12 — DIFF_FIELDS
    expect(result.logged).toBe(1); // C.13 — logItemChanges tracked fields
  });

  // ---- B.5: display totals stay price×qty; price-history chart untouched (AC-10) ----
  test("denom LOT item saved via the modal renders price×qty totals (AC-10)", async ({ page }) => {
    // Routed through the modal save path (never seeded pre-shaped) so it FAILS before
    // C.3 (unfixed save stores the lot total as per-unit → table shows 30× too much)
    // and turns green once C.3 makes item.price per-unit and item.qty = cu.qty. The
    // view-modal price-history chart is asserted untouched by the no-production-change
    // invariant for display surfaces (verified in CLOSE-3; the chart code is not edited).
    const name = "Core CU Denom Display";
    await saveCuDenomItem(page, { name, count: 30, price: 1700 });

    const saved = await getInventoryItem(page, name);
    expect(saved.price * saved.qty).toBeCloseTo(1700, 9);

    const row = tableRowByName(page, name);
    await expect(row.locator('[data-column="purchasePrice"]')).toContainText("$1,700.00");
    await expect(row.locator('[data-column="purchasePrice"]')).not.toContainText("$51,000.00");
  });
});

// =============================================================================
// STRK-299 — the derived pure-silver figure is labelled ASW on every visible surface
// =============================================================================
// ASW (Actual Silver Weight) is the standard numismatic term for a coin's pure silver content
// in troy ounces. Junk-silver dealers quote and price bags in ASW, and the codebase already
// used the term internally (constants.js, events.js, viewModal.js) — but no user-facing surface
// said it, and the three that showed the figure each phrased it differently. Display labels
// only: CSV export headers are the import round-trip contract and must not move.

/**
 * Seeds a single item, loads the app, and opens its detail modal.
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Object} item - The item to seed
 * @returns {Promise<void>}
 */
async function seedAndOpenModal(page, item) {
  await seedMoneyData(page, { inventory: [item] });
  await gotoApp(page);
  await page.evaluate(() => window.showViewModal(0));
  await expect(page.locator("#viewItemModal")).toBeVisible();
}

/**
 * The detail-row label spans in the open view modal.
 * @param {import('@playwright/test').Page} page - Playwright page
 * @returns {import('@playwright/test').Locator} Label spans
 */
const modalLabels = (page) => page.locator("#viewItemModal .view-detail-label");

/**
 * The value span of the detail row whose label matches `label` exactly.
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} label - Exact label text
 * @returns {import('@playwright/test').Locator} The row's value span
 */
const modalValueFor = (page, label) =>
  page
    .locator("#viewItemModal .view-detail-item")
    .filter({ has: page.locator(".view-detail-label", { hasText: new RegExp(`^${label}$`) }) })
    .locator(".view-detail-value");

/**
 * Seeds an inventory, forces a card view style, and waits for the grid to render.
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Array<Object>} inventory - Items to seed
 * @param {string} style - Card view style ("A", "B", or "C")
 * @returns {Promise<void>}
 */
async function seedAndLoadCards(page, inventory, style) {
  await seedMoneyData(page, { inventory });
  await page.addInitScript((s) => localStorage.setItem("cardViewStyle", s), style);
  await gotoApp(page);
  await page.waitForSelector("#cardViewGrid article", { state: "attached", timeout: 15000 });
}

test.describe("core/inventory-math — STRK-299 ASW relabel", () => {
  /** A face-mode constitutional lot: $14.75 total face → ~10.5 ozt ASW on the worn basis. */
  const CU_ASW_LOT = {
    ...CU_FACE_50,
    uuid: "core-strk299-asw",
    name: "Core STRK299 ASW Lot",
    weight: 14.75,
    qty: 1,
    serial: 299,
  };

  test("the detail modal labels the derived figure ASW, never 'Silver content'", async ({
    page,
  }) => {
    await seedAndOpenModal(page, CU_ASW_LOT);
    await expect(modalLabels(page).filter({ hasText: /^ASW$/ })).toHaveCount(1);
    // AC3: the old phrasing is gone from the modal entirely.
    await expect(page.locator("#viewItemModal")).not.toContainText(/silver content/i);
    // The value is still the derived ozt figure, unchanged by the relabel.
    await expect(modalValueFor(page, "ASW")).toHaveText(/^\d+\.\d{4} ozt$/);
  });

  test("the ASW label carries the expanded term as a hover tooltip", async ({ page }) => {
    // The grid is compact, so the label stays the bare abbreviation and the expansion rides
    // along as a title — a reader who does not know "ASW" is one hover from the meaning.
    await seedAndOpenModal(page, CU_ASW_LOT);
    await expect(modalLabels(page).filter({ hasText: /^ASW$/ })).toHaveAttribute(
      "title",
      /ASW \(Actual Silver Weight\)/
    );
  });

  test("the constitutional weight cell tooltip names ASW alongside the valuation basis", async ({
    page,
  }) => {
    // STRK-300 subsequently flipped the cell/tooltip pairing, so the face value now lives in
    // the cell and this tooltip carries the ASW. The ASW naming this issue introduced is what
    // survives the flip and is asserted here.
    await seedAndLoad(page, [CU_ASW_LOT]);
    const title = await weightCellFor(page, "Core STRK299 ASW Lot").getAttribute("title");
    expect(title).toMatch(/ASW \(Actual Silver Weight\)/);
    expect(title).toMatch(/^\d+\.\d{2} ozt /);
    expect(title).toMatch(/worn/i);
  });

  test("the weight-unit tooltip table names ASW for cu instead of the stale phrasing", async ({
    page,
  }) => {
    await seedAndLoad(page, [CU_ASW_LOT]);
    // This map entry is currently unreachable for cu cells (the cell ternary always routes cu
    // to cuWeightTooltip), but it must not sit there contradicting the term the app now uses.
    // Read the entry with plain string operations, not a regex. A regex LITERAL containing a
    // double-quote character desyncs Codacy's Lizard tokenizer — it reads the quote as the start
    // of a string, loses parser state, and reports a phantom ~600-line function for this file.
    const src = await page.evaluate(async () => {
      const res = await fetch("./js/inventory-table.js");
      return res.text();
    });
    const cuEntry = src.split("\n").find((line) => line.trim().startsWith("cu:"));
    expect(cuEntry).toBeTruthy();
    expect(cuEntry).toContain("ASW (Actual Silver Weight)");
    expect(cuEntry.toLowerCase()).not.toContain("silver content");
  });

  test("CSV export headers are byte-identical — the relabel never reaches the round trip", async ({
    page,
  }) => {
    // AC4 / explicit out-of-scope: js/csv-export.js defines the import round-trip contract.
    // Renaming any header would break re-import of previously exported files.
    await seedAndLoad(page, [CU_ASW_LOT]);
    const header = await page.evaluate(() => {
      const csv = window.exportInventoryCSV();
      if (!csv) return null;
      // The export opens with "# exportOrigin: ..." provenance comments; the header is the
      // first non-comment line.
      return csv.split(/\r?\n/).find((l) => l && !l.startsWith("#")) ?? null;
    });
    expect(header).not.toBeNull();
    expect(header).toContain("Weight(oz)");
    expect(header).toContain("Constitutional Variant");
    expect(header).toContain("Constitutional Entry Mode");
    // No display vocabulary leaked into the machine contract.
    expect(header).not.toMatch(/ASW/);
    expect(header).not.toMatch(/silver content/i);
  });
});

// =============================================================================
// STRK-300 — constitutional rows lead with face value; ASW moves to the tooltip
// =============================================================================
// Constitutional silver is quoted, bought, and mentally modelled by FACE VALUE, but the display
// surfaces disagreed about which figure was primary: the card chip and the detail modal already
// led with face while the table led with derived ASW. The table is the odd one out, so its
// Weight cell now shows total face ("$6.00 fv") and the ASW moves to the cell tooltip.
// Deliberately unchanged: the Weight SORT key and the weight FILTER key both stay ASW-keyed —
// neither ever depended on the cell's text, and a dollar figure cannot interleave with ounces
// on one scale.

const CU_DENOM_24Q = {
  ...CU_QUARTERS_40,
  uuid: "core-strk300-denom24",
  name: "Core STRK300 Denom 24 Quarters",
  weight: 0.25,
  qty: 24, // 24 × $0.25 = $6.00 total face
  serial: 300,
};

const CU_FACE_1475 = {
  ...CU_FACE_50,
  uuid: "core-strk300-face1475",
  name: "Core STRK300 Face Lot",
  weight: 14.75,
  qty: 1,
  serial: 301,
};

test.describe("core/inventory-math — STRK-300 constitutional face-value display flip", () => {
  test("denomination mode shows the coin count in Qty and total face in Weight", async ({
    page,
  }) => {
    await seedAndLoad(page, [CU_DENOM_24Q]);
    const row = page.locator("#inventoryTable tbody tr").filter({ hasText: "Denom 24 Quarters" });
    // Qty stays a real count — nothing is lost by moving face value into the Weight cell.
    await expect(row.locator("td[data-column='qty']")).toContainText("24");
    await expect(row.locator("td[data-column='weight'] .filter-text")).toHaveText("$6.00 fv");
  });

  test("face mode shows its truthful lot qty of 1 and the stored total face", async ({ page }) => {
    await seedAndLoad(page, [CU_FACE_1475]);
    const row = page.locator("#inventoryTable tbody tr").filter({ hasText: "Face Lot" });
    await expect(row.locator("td[data-column='qty']")).toContainText("1");
    await expect(row.locator("td[data-column='weight'] .filter-text")).toHaveText("$14.75 fv");
  });

  test("weight sort still ranks cu rows by ASW, so face value is not monotonic", async ({
    page,
  }) => {
    // The documented, accepted quirk: across mixed finenesses the displayed fv does not increase
    // with the sort. $1.00 fv of 35% war nickels (~1.11 ozt) outranks $1.20 fv of 90% dimes
    // (~0.86 ozt) because the column ranks on silver content, which is the point.
    const CU_NICKELS = {
      ...CU_QUARTERS_40,
      uuid: "core-strk300-nickels",
      name: "Core STRK300 War Nickels",
      constitutionalVariant: "con-35-nickel",
      weight: 0.05,
      qty: 20, // $1.00 face, ~1.11 ozt ASW
      serial: 302,
    };
    const CU_DIMES = {
      ...CU_QUARTERS_40,
      uuid: "core-strk300-dimes",
      name: "Core STRK300 Silver Dimes",
      constitutionalVariant: "con-90-dime",
      weight: 0.1,
      qty: 12, // $1.20 face, ~0.86 ozt ASW
      serial: 303,
    };
    await seedWeightSorted(page, [CU_DIMES, CU_NICKELS]);
    const names = await rowNames(page);
    expect(names[0]).toContain("War Nickels");
    expect(names[1]).toContain("Silver Dimes");
    // ...and the cell text confirms the non-monotonicity is real, not a fixture artefact.
    const rows = page.locator("#inventoryTable tbody tr");
    await expect(rows.nth(0).locator("td[data-column='weight'] .filter-text")).toHaveText(
      "$1.00 fv"
    );
    await expect(rows.nth(1).locator("td[data-column='weight'] .filter-text")).toHaveText(
      "$1.20 fv"
    );
  });

  test("the detail modal labels cu items Face value and keeps the ASW row", async ({ page }) => {
    await seedAndOpenModal(page, CU_FACE_1475);
    await expect(modalLabels(page).filter({ hasText: /^Face value$/ })).toHaveCount(1);
    // A cu item no longer labels a dollar figure "Weight".
    await expect(modalLabels(page).filter({ hasText: /^Weight$/ })).toHaveCount(0);
    // The ASW row (STRK-299) survives the flip.
    await expect(modalLabels(page).filter({ hasText: /^ASW$/ })).toHaveCount(1);
    // Total face, no suffix — the label already carries the meaning.
    await expect(modalValueFor(page, "Face value")).toHaveText("$14.75");
  });

  test("the detail modal still labels bullion items Weight", async ({ page }) => {
    await seedAndOpenModal(page, MONEY_ITEM);
    await expect(modalLabels(page).filter({ hasText: /^Weight$/ })).toHaveCount(1);
    await expect(modalLabels(page).filter({ hasText: /^Face value$/ })).toHaveCount(0);
  });

  for (const style of ["A", "B", "C"]) {
    test(`card view ${style} shows total face with the fv suffix for cu items`, async ({
      page,
    }) => {
      await seedAndLoadCards(page, [CU_DENOM_24Q], style);
      // Was per-coin "$0.25 face" via the 2-arg formatWeight fallback — right figure, wrong frame.
      await expect(page.locator("#cardViewGrid .cv-chip-weight").first()).toHaveText("$6.00 fv");
    });
  }

  test("card view weight chips are unchanged for non-cu items", async ({ page }) => {
    await seedAndLoadCards(page, [MONEY_ITEM, GOLDBACK_ITEM], "A");
    const chips = await page.locator("#cardViewGrid .cv-chip-weight").allTextContents();
    expect(chips).toContain("1.00 oz");
    expect(chips).toContain("5 gb");
    expect(chips.join(" ")).not.toContain("fv");
  });

  test("face value stays in USD when the display currency is EUR", async ({ page }) => {
    // Face value is a US legal-tender denomination, not a market price — it is never converted.
    await seedMoneyData(page, { inventory: [CU_DENOM_24Q], displayCurrency: "EUR" });
    await gotoApp(page);
    await page.waitForSelector("#inventoryTable tbody tr", { state: "visible" });
    await expect(weightCellFor(page, "Denom 24 Quarters")).toHaveText("$6.00 fv");
    await page.evaluate(() => window.showViewModal(0));
    await expect(page.locator("#viewItemModal")).toBeVisible();
    await expect(modalValueFor(page, "Face value")).toHaveText("$6.00");
    await expect(modalValueFor(page, "Face value")).not.toContainText("€");
  });

  test("summary weight total and melt still use ASW, not the newly displayed face", async ({
    page,
  }) => {
    // AC8: the flip is display-only. The summary strip keeps summing troy ounces.
    await seedMoneyData(page, { inventory: [CU_QUARTERS_40] });
    await gotoApp(page);
    await openConstitutionalSettings(page, "system");
    const text = await page.locator("#invSummaryWeight").textContent();
    const oz = parseFloat(String(text).replace(/[^0-9.]/g, ""));
    // 40 quarters worn ≈ 7.15 ozt — NOT the 10.00 face now shown in the Weight cell.
    expect(oz).toBeGreaterThan(6.5);
    expect(oz).toBeLessThan(8);
    expect(oz).not.toBeCloseTo(10, 1);
  });

  // PR #1406 review (Codex P2): after the flip the cu cell reads "$10.00 fv" while its filter
  // key stays the ASW ("7.15"), so the chip — which echoes the key verbatim — showed a bare
  // number matching nothing on the row it came from.
  test("the cu filter chip names its unit so it is not a bare number after the flip", async ({
    page,
  }) => {
    await seedAndLoad(page, [CU_QUARTERS_40]);
    await weightCellFor(page, "Core 40 Silver Quarters").click();
    const chips = page.locator("#activeFilters .filter-chip");
    await expect(chips.filter({ hasText: /^\d+\.\d{2} oz/ })).toHaveCount(1);
  });

  test("the cu chip label is scoped to keys a cu item actually produces", async ({ page }) => {
    await seedAndLoad(page, [CU_QUARTERS_40]);
    const labels = await page.evaluate(() => ({
      cuMatch: window.getWeightFilterLabel("7.15", [
        { weight: 10, qty: 1, weightUnit: "cu", constitutionalEntryMode: "face" },
      ]),
      noCuItems: window.getWeightFilterLabel("7.15", []),
      bullionKey: window.getWeightFilterLabel("10", [{ weight: 10, weightUnit: "oz" }]),
      gbStillWorks: window.getWeightFilterLabel("0.00500", [{ weight: 5, weightUnit: "gb" }]),
    }));
    // A $10-face 90% bag derives ~7.15 ozt, so the key resolves and gains its unit.
    expect(labels.cuMatch).toBe("7.15 oz");
    // With no cu item producing that key, the value passes through untouched.
    expect(labels.noCuItems).toBe("7.15");
    // Bullion chips are unchanged — they were never ambiguous.
    expect(labels.bullionKey).toBe("10");
    // The STRK-316 gb/sb path is unaffected by the new cu branch.
    expect(labels.gbStillWorks).toBe("5 gb");
  });

  test("the legacy 2-arg formatWeight fallback renders the normalized fv suffix", async ({
    page,
  }) => {
    // AC9: change log, bulk edit preview, backup print, add toast, and print/export rows all
    // reach cu through this fallback. Suffix normalized "face" -> "fv"; frame unchanged.
    await seedAndLoad(page, [CU_DENOM_24Q]);
    const out = await page.evaluate(() => ({
      cuFallback: window.formatWeight(0.25, "cu"),
      cuWithItem: window.formatWeight(0.25, "cu", {
        weight: 0.25,
        qty: 24,
        constitutionalEntryMode: "denom",
        constitutionalVariant: "con-90-quarter",
      }),
      oz: window.formatWeight(1, "oz"),
      gb: window.formatWeight(5, "gb"),
    }));
    expect(out.cuFallback).toBe("$0.25 fv");
    expect(out.cuFallback).not.toContain("face");
    // The 3-arg cu form is deliberately untouched — it still returns the ASW.
    expect(out.cuWithItem).toMatch(/^\d+\.\d{2} oz$/);
    // Non-cu units are byte-identical.
    expect(out.oz).toBe("1.00 oz");
    expect(out.gb).toBe("5 gb");
  });
});

// =============================================================================
// STRK-316 — Goldback/Silverback weight sort + filter key use the troy-oz equivalent
// =============================================================================
// gb/sb items store the raw DENOMINATION in `item.weight` (a 5 Goldback stores 5, not its
// 0.005 ozt of gold) — the same storage shape constitutional face value uses. Two consumers
// read that stored number as if it were troy ounces:
//   * Weight sort — a 5 gb ranked as 5 ozt and outranked a 2.00 oz round.
//   * Weight filter key — a `2 gb` note and a `2.00 oz` coin shared the key "2", so clicking
//     Weight on either matched both. Same cross-unit collision class STRK-240 fixed for cu.
// Both now route through getUnitOztWeight. The gb/sb filter key is a 5-decimal ozt string
// (2 decimals would collapse ¼/½/1/2 gb into "0.00"; a raw String() emits IEEE-754 artifacts
// such as 0.009000000000000001), and getWeightFilterLabel maps it back to the "5 gb" text the
// cell shows so the chip stays readable.

const GB_5_NOTE = {
  ...GOLDBACK_ITEM,
  uuid: "core-strk316-gb5",
  name: "Core STRK316 Five Goldback",
  weight: 5,
  qty: 1,
  serial: 316,
};

const GB_2_NOTE = {
  ...GOLDBACK_ITEM,
  uuid: "core-strk316-gb2",
  name: "Core STRK316 Two Goldback",
  weight: 2,
  qty: 1,
  serial: 317,
};

const OZ_2_ROUND = {
  ...MONEY_ITEM,
  uuid: "core-strk316-oz2",
  name: "Core STRK316 Two Oz Round",
  type: "Round",
  weight: 2,
  weightUnit: "oz",
  qty: 1,
  serial: 318,
};

const OZ_10_BAR = {
  ...MONEY_ITEM,
  uuid: "core-strk316-oz10",
  name: "Core STRK316 Ten Oz Bar",
  type: "Bar",
  weight: 10,
  weightUnit: "oz",
  qty: 1,
  serial: 319,
};

const OZ_1_COIN = {
  ...MONEY_ITEM,
  uuid: "core-strk316-oz1",
  name: "Core STRK316 One Oz Coin",
  weight: 1,
  weightUnit: "oz",
  qty: 1,
  serial: 320,
};

const GB_1_NOTE = {
  ...GOLDBACK_ITEM,
  uuid: "core-strk316-gb1",
  name: "Core STRK316 One Goldback",
  weight: 1,
  qty: 1,
  serial: 323,
};

const SB_1_NOTE = {
  ...MIGRATED_SILVERBACK,
  uuid: "core-strk316-sb1",
  name: "Core STRK316 One Silverback",
  weight: 1,
  weightUnit: "sb",
  qty: 1,
  serial: 324,
};

/**
 * Seeds an inventory with the Weight column (index 6) as the active sort. The second
 * addInitScript runs after seedMoneyData's and overwrites its column-4 default.
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Array<Object>} inventory - Items to seed
 * @param {string} [dir] - Sort direction, "desc" or "asc"
 * @returns {Promise<void>}
 */
async function seedWeightSorted(page, inventory, dir = "desc") {
  await seedMoneyData(page, { inventory });
  await page.addInitScript((d) => {
    localStorage.setItem("defaultSortColumn", "6");
    localStorage.setItem("defaultSortDir", d);
  }, dir);
  await gotoApp(page);
  await page.waitForSelector("#inventoryTable tbody tr", { state: "visible" });
}

/**
 * Reads the rendered inventory row names in current sort order.
 * @param {import('@playwright/test').Page} page - Playwright page
 * @returns {Promise<string[]>} Row name cell texts
 */
const rowNames = (page) =>
  page.locator("#inventoryTable tbody tr [data-column='name']").allTextContents();

/**
 * Seeds an inventory, loads the app, and waits for the table to render.
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Array<Object>} inventory - Items to seed
 * @returns {Promise<void>}
 */
async function seedAndLoad(page, inventory) {
  await seedMoneyData(page, { inventory });
  await gotoApp(page);
  await page.waitForSelector("#inventoryTable tbody tr", { state: "visible" });
}

/**
 * The clickable Weight cell of the row whose name contains `name`.
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} name - Substring of the row name
 * @returns {import('@playwright/test').Locator} The cell's .filter-text span
 */
const weightCellFor = (page, name) =>
  page
    .locator("#inventoryTable tbody tr")
    .filter({ hasText: name })
    .locator("td[data-column='weight'] .filter-text");

/**
 * Currently rendered rows whose name contains `name`. Counting a sub-locator avoids the strict-
 * mode violation that `not.toContainText` raises against a multi-row locator.
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} name - Substring of the row name
 * @returns {import('@playwright/test').Locator} Matching rows
 */
const rowsNamed = (page, name) =>
  page.locator("#inventoryTable tbody tr").filter({ hasText: name });

test.describe("core/inventory-math — STRK-316 goldback weight sort and filter key", () => {
  test("descending weight sort ranks goldbacks by ozt equivalent, below every bullion row", async ({
    page,
  }) => {
    await seedWeightSorted(page, [GB_5_NOTE, OZ_10_BAR, GB_2_NOTE, OZ_2_ROUND, OZ_1_COIN]);
    const names = await rowNames(page);
    // 10 ozt > 2 ozt > 1 ozt > 0.005 ozt (5 gb) > 0.002 ozt (2 gb).
    // Before the fix the raw denomination put 5 gb between the 10 oz and 2 oz rows.
    expect(names[0]).toContain("Ten Oz Bar");
    expect(names[1]).toContain("Two Oz Round");
    expect(names[2]).toContain("One Oz Coin");
    expect(names[3]).toContain("Five Goldback");
    expect(names[4]).toContain("Two Goldback");
  });

  test("ascending weight sort is the exact reverse", async ({ page }) => {
    await seedWeightSorted(page, [GB_5_NOTE, OZ_10_BAR, GB_2_NOTE, OZ_2_ROUND, OZ_1_COIN], "asc");
    const names = await rowNames(page);
    expect(names[0]).toContain("Two Goldback");
    expect(names[1]).toContain("Five Goldback");
    expect(names[2]).toContain("One Oz Coin");
    expect(names[3]).toContain("Two Oz Round");
    expect(names[4]).toContain("Ten Oz Bar");
  });

  test("bullion-only weight sort is unchanged by the gb/sb conversion", async ({ page }) => {
    // AC2 guard: oz/g/kg/lb rows must be byte-identical to the pre-fix ordering.
    const GRAM_BAR = {
      ...MONEY_ITEM,
      uuid: "core-strk316-gram",
      name: "Core STRK316 Gram Bar",
      weight: 31.65 / 31.1034768, // ~1.0176 ozt, displayed as 31.65 g
      weightUnit: "g",
      qty: 1,
      serial: 321,
    };
    await seedWeightSorted(page, [OZ_1_COIN, OZ_10_BAR, GRAM_BAR, OZ_2_ROUND]);
    const names = await rowNames(page);
    expect(names[0]).toContain("Ten Oz Bar");
    expect(names[1]).toContain("Two Oz Round");
    expect(names[2]).toContain("Gram Bar"); // ~1.0176 ozt slots above the 1.00 oz coin
    expect(names[3]).toContain("One Oz Coin");
  });

  test("a 2 gb note and a 2.00 oz round no longer share a weight filter bucket", async ({
    page,
  }) => {
    await seedAndLoad(page, [GB_2_NOTE, OZ_2_ROUND]);
    await expect(page.locator("#inventoryTable tbody tr")).toHaveCount(2);

    const gbCell = weightCellFor(page, "Core STRK316 Two Goldback");
    const ozCell = weightCellFor(page, "Core STRK316 Two Oz Round");

    // The cell TEXT is unchanged — only the filter key moved to the ozt scale.
    await expect(gbCell).toHaveText("2 gb");
    await expect(ozCell).toHaveText("2.00 oz");
    // gb keys on 0.00200 ozt; plain bullion keeps its raw numeric weight.
    await expect(gbCell).toHaveAttribute("onclick", `applyColumnFilter('weight', "0.00200")`);
    await expect(ozCell).toHaveAttribute("onclick", `applyColumnFilter('weight', 2)`);

    await gbCell.click();
    await expect(page.locator("#inventoryTable tbody tr")).toHaveCount(1);
    await expect(rowsNamed(page, "Two Goldback")).toHaveCount(1);
    await expect(rowsNamed(page, "Two Oz Round")).toHaveCount(0);
  });

  test("clicking a 2.00 oz weight cell does not pull in a 2 gb note", async ({ page }) => {
    await seedAndLoad(page, [GB_2_NOTE, OZ_2_ROUND]);
    await weightCellFor(page, "Core STRK316 Two Oz Round").click();
    await expect(page.locator("#inventoryTable tbody tr")).toHaveCount(1);
    await expect(rowsNamed(page, "Two Oz Round")).toHaveCount(1);
    await expect(rowsNamed(page, "Two Goldback")).toHaveCount(0);
  });

  test("different goldback denominations stay distinct; equal denominations group together", async ({
    page,
  }) => {
    const GB_2_SECOND = {
      ...GB_2_NOTE,
      uuid: "core-strk316-gb2b",
      name: "Core STRK316 Two Goldback Second",
      serial: 322,
    };
    await seedAndLoad(page, [GB_5_NOTE, GB_2_NOTE, GB_2_SECOND]);
    await expect(page.locator("#inventoryTable tbody tr")).toHaveCount(3);

    await weightCellFor(page, "Core STRK316 Two Goldback Second").click();

    // Both 2 gb notes match (same key); the 5 gb note does not.
    await expect(page.locator("#inventoryTable tbody tr")).toHaveCount(2);
    await expect(rowsNamed(page, "Two Goldback")).toHaveCount(2);
    await expect(rowsNamed(page, "Five Goldback")).toHaveCount(0);
  });

  test("the active filter chip shows the denomination, not the raw ozt key", async ({ page }) => {
    // The chip renderer echoes the filter key verbatim, so without getWeightFilterLabel this
    // chip would read "0.00500" — unreadable for the Goldback users this fix serves.
    await seedAndLoad(page, [GB_5_NOTE, OZ_2_ROUND]);
    await weightCellFor(page, "Core STRK316 Five Goldback").click();

    const chips = page.locator("#activeFilters .filter-chip");
    await expect(chips.filter({ hasText: "5 gb" })).toHaveCount(1);
    await expect(chips.filter({ hasText: "0.00500" })).toHaveCount(0);
  });

  test("getUnitOztWeight converts gb/sb and passes every other unit through untouched", async ({
    page,
  }) => {
    await seedAndLoad(page, [GB_5_NOTE]);
    const result = await page.evaluate(() => ({
      gb5: window.getUnitOztWeight({ weight: 5, weightUnit: "gb" }),
      gbQuarter: window.getUnitOztWeight({ weight: 0.25, weightUnit: "gb" }),
      sb1: window.getUnitOztWeight({ weight: 1, weightUnit: "sb" }),
      oz10: window.getUnitOztWeight({ weight: 10, weightUnit: "oz" }),
      gram: window.getUnitOztWeight({ weight: 1.0175, weightUnit: "g" }),
      kg: window.getUnitOztWeight({ weight: 2, weightUnit: "kg" }),
      missing: window.getUnitOztWeight({}),
      nullish: window.getUnitOztWeight(null),
    }));
    expect(result.gb5).toBeCloseTo(0.005, 10);
    expect(result.gbQuarter).toBeCloseTo(0.00025, 10);
    expect(result.sb1).toBeCloseTo(0.001, 10);
    // Non-gb/sb units already store troy oz — identical to the previous parseFloat(item.weight).
    expect(result.oz10).toBe(10);
    expect(result.gram).toBe(1.0175);
    expect(result.kg).toBe(2);
    expect(result.missing).toBe(0);
    expect(result.nullish).toBe(0);
  });

  test("gb/sb filter keys are 5-decimal ozt; bullion keys are unchanged raw weight", async ({
    page,
  }) => {
    await seedAndLoad(page, [GB_5_NOTE]);
    const keys = await page.evaluate(() => ({
      gbQuarter: window.getItemFilterWeight({ weight: 0.25, weightUnit: "gb" }),
      gbHalf: window.getItemFilterWeight({ weight: 0.5, weightUnit: "gb" }),
      gb1: window.getItemFilterWeight({ weight: 1, weightUnit: "gb" }),
      gb2: window.getItemFilterWeight({ weight: 2, weightUnit: "gb" }),
      gb5: window.getItemFilterWeight({ weight: 5, weightUnit: "gb" }),
      gb9: window.getItemFilterWeight({ weight: 9, weightUnit: "gb" }),
      oz10: window.getItemFilterWeight({ weight: 10, weightUnit: "oz" }),
      gram: window.getItemFilterWeight({ weight: 1.0175, weightUnit: "g" }),
    }));
    // ¼ / ½ / 1 gb all collapse to "0.00" at 2 decimals and ½/1 still collide at 3 — the
    // 5-decimal width is what keeps every denomination in its own bucket.
    expect(keys.gbQuarter).toBe("0.00025");
    expect(keys.gbHalf).toBe("0.00050");
    expect(keys.gb1).toBe("0.00100");
    expect(keys.gb2).toBe("0.00200");
    expect(keys.gb5).toBe("0.00500");
    // 9 * 0.001 is 0.009000000000000001 in IEEE-754; the fixed width absorbs the artifact.
    expect(keys.gb9).toBe("0.00900");
    expect(new Set(Object.values(keys)).size).toBe(Object.keys(keys).length);
    // Bullion keys byte-identical to the legacy raw-weight string.
    expect(keys.oz10).toBe("10");
    expect(keys.gram).toBe("1.0175");
  });

  // PR #1405 review (Codex P2 + Copilot, independently): gb and sb share a 0.001 ozt conversion
  // factor, so 1 gb and 1 sb produce the SAME key and the filter genuinely selects both — correct
  // for a metal-agnostic weight column. The original label resolved by inventory order, so a
  // click on a `1 sb` cell could render a chip reading "1 gb", hiding the Silverbacks entirely.
  test("a key shared by a Goldback and a Silverback names both units in the chip", async ({
    page,
  }) => {
    await seedAndLoad(page, [GB_1_NOTE, SB_1_NOTE]);
    await expect(page.locator("#inventoryTable tbody tr")).toHaveCount(2);

    const keys = await page.evaluate(() => ({
      gb: window.getItemFilterWeight({ weight: 1, weightUnit: "gb" }),
      sb: window.getItemFilterWeight({ weight: 1, weightUnit: "sb" }),
    }));
    expect(keys.gb).toBe("0.00100");
    expect(keys.sb).toBe(keys.gb); // the shared key is intended, not a bug

    // Click the SILVERBACK cell — the chip must not claim the selection is Goldbacks only.
    await weightCellFor(page, "Core STRK316 One Silverback").click();
    const chips = page.locator("#activeFilters .filter-chip");
    await expect(chips.filter({ hasText: "1 gb/sb" })).toHaveCount(1);
    // Both rows really are selected, which is exactly what the label now says.
    await expect(page.locator("#inventoryTable tbody tr")).toHaveCount(2);
  });

  test("the chip label is deterministic regardless of inventory order", async ({ page }) => {
    await seedAndLoad(page, [GB_5_NOTE]);
    const labels = await page.evaluate(() => ({
      bothGbFirst: window.getWeightFilterLabel("0.00100", [
        { weight: 1, weightUnit: "gb" },
        { weight: 1, weightUnit: "sb" },
      ]),
      bothSbFirst: window.getWeightFilterLabel("0.00100", [
        { weight: 1, weightUnit: "sb" },
        { weight: 1, weightUnit: "gb" },
      ]),
      gbOnly: window.getWeightFilterLabel("0.00500", [{ weight: 5, weightUnit: "gb" }]),
      sbOnly: window.getWeightFilterLabel("0.00100", [{ weight: 1, weightUnit: "sb" }]),
      bullionKey: window.getWeightFilterLabel("10", [{ weight: 10, weightUnit: "oz" }]),
      cuKey: window.getWeightFilterLabel("7.15", []),
      noMatch: window.getWeightFilterLabel("0.09900", [{ weight: 5, weightUnit: "gb" }]),
      empty: window.getWeightFilterLabel("", []),
    }));
    // Same answer whichever unit happens to come first in the inventory.
    expect(labels.bothGbFirst).toBe("1 gb/sb");
    expect(labels.bothSbFirst).toBe("1 gb/sb");
    // Unambiguous keys keep the plain denomination label.
    expect(labels.gbOnly).toBe("5 gb");
    expect(labels.sbOnly).toBe("1 sb");
    // Non gb/sb keys pass through untouched — bullion and cu chips are unaffected.
    expect(labels.bullionKey).toBe("10");
    expect(labels.cuKey).toBe("7.15");
    expect(labels.noMatch).toBe("0.09900");
    expect(labels.empty).toBe("");
  });

  test("isDerivedWeightUnit is the single source for which units get a rewritten key", async ({
    page,
  }) => {
    // The table's Weight cell keys off this predicate rather than its own unit list, so the
    // cell can no longer drift out of sync with getItemFilterWeight (PR #1405 review, Codacy).
    await seedAndLoad(page, [GB_5_NOTE]);
    const derived = await page.evaluate(() =>
      ["cu", "gb", "sb", "oz", "g", "kg", "lb", undefined].map((u) => [
        String(u),
        window.isDerivedWeightUnit({ weightUnit: u }),
      ])
    );
    expect(Object.fromEntries(derived)).toEqual({
      cu: true,
      gb: true,
      sb: true,
      oz: false,
      g: false,
      kg: false,
      lb: false,
      undefined: false,
    });
    // Every unit the predicate reports as derived must actually get a rewritten key.
    const rewritten = await page.evaluate(() =>
      ["gb", "sb", "oz"].map((u) => [
        u,
        window.getItemFilterWeight({ weight: 2, weightUnit: u }) !== String(2),
      ])
    );
    expect(Object.fromEntries(rewritten)).toEqual({ gb: true, sb: true, oz: false });
  });

  test("computeMeltValue is numerically unchanged after routing through the shared helper", async ({
    page,
  }) => {
    // AC5 guard: the gb/sb ternary moved out of computeMeltValue into getUnitOztWeight.
    await seedAndLoad(page, [GB_5_NOTE]);
    const melt = await page.evaluate(() => ({
      gb: window.computeMeltValue({ weight: 5, weightUnit: "gb", qty: 3, purity: 1 }, 4000),
      sb: window.computeMeltValue({ weight: 1, weightUnit: "sb", qty: 10, purity: 1 }, 30),
      oz: window.computeMeltValue({ weight: 2, weightUnit: "oz", qty: 4, purity: 0.999 }, 30),
    }));
    expect(melt.gb).toBeCloseTo(0.005 * 3 * 4000, 9); // $60.00
    expect(melt.sb).toBeCloseTo(0.001 * 10 * 30, 9); // $0.30
    expect(melt.oz).toBeCloseTo(2 * 4 * 30 * 0.999, 9); // unchanged bullion path
  });
});

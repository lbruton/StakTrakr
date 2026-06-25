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
  await page.waitForTimeout(300);
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

// STRK-238: shared setup for the bulk constitutional-conversion tests — seed the
// inventory, boot the app, open the bulk-edit modal, and select the seeded item.
async function openBulkEditForConstitutional(page, inventory) {
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

  // STRK-237 — the inventory-table Weight column must render a constitutional row as the
  // derived pure-silver content (oz), consistent with every other row and the portfolio
  // totals, with the face value relocated to the cell tooltip (no more in-column "$X.XX face").
  test("inventory table weight column shows derived silver oz for constitutional rows, face in tooltip", async ({
    page,
  }) => {
    await seedMoneyData(page, { inventory: [CU_QUARTERS_40] });
    await gotoApp(page);
    await page.waitForSelector("#inventoryTable tbody tr", { state: "visible" });
    const weightCell = page
      .locator("#inventoryTable tbody tr")
      .filter({ hasText: "Core 40 Silver Quarters" })
      .locator("td[data-column='weight'] .filter-text");
    // 40 quarters worn ≈ 7.15 ozt silver — shown as a weight, NOT the raw "$10.00 face".
    await expect(weightCell).toHaveText(/^\d+\.\d+\s*oz$/);
    await expect(weightCell).not.toContainText("face");
    const oz = parseFloat((await weightCell.textContent()).replace(/[^0-9.]/g, ""));
    expect(oz).toBeGreaterThan(6.5);
    expect(oz).toBeLessThan(8);
    // Face value (40 × $0.25 = $10.00) + valuation basis move to the cell tooltip.
    const title = await weightCell.getAttribute("title");
    expect(title).toMatch(/\$10\.00 face/);
    expect(title).toMatch(/worn/i);
    // STRK-239 (beta feedback): the cu weight cell is click-to-filter like every other weight unit
    // (oz/g/gb/sb). STRK-240: the filter value is the DISPLAYED derived oz (a quoted string), not
    // the raw stored face value — so the chip matches what's shown and a $-face value can't collide
    // with an oz weight. The face value stays in the tooltip (asserted above).
    await expect(weightCell).toHaveClass(/\bfilter-text\b/);
    const displayedOz239 = (await weightCell.textContent()).replace(/[^0-9.]/g, "");
    await expect(weightCell).toHaveAttribute(
      "onclick",
      new RegExp(`^applyColumnFilter\\('weight', "?${displayedOz239.replace(/\./g, "\\.")}"?\\)$`)
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
    // STRK-240: keys on the displayed derived oz (quoted string), not the stored per-coin face. The
    // ~0.76 oz silver dollar derives a different oz, so it is filtered out.
    const quartersOz = (await weightCell.textContent()).replace(/[^0-9.]/g, "");
    await expect(weightCell).toHaveAttribute(
      "onclick",
      new RegExp(`^applyColumnFilter\\('weight', "?${quartersOz.replace(/\./g, "\\.")}"?\\)$`)
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
    // The chip value is the displayed derived oz (~7.15), decisively != the stored face 10.
    const cuOz = (await cuWeightCell.textContent()).replace(/[^0-9.]/g, "");
    expect(parseFloat(cuOz)).toBeGreaterThan(6.5);
    expect(parseFloat(cuOz)).toBeLessThan(8);
    await expect(cuWeightCell).toHaveAttribute(
      "onclick",
      new RegExp(`^applyColumnFilter\\('weight', "?${cuOz.replace(/\./g, "\\.")}"?\\)$`)
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
  // TOTAL face (qty is 1 by contract), so the weight-cell tooltip must show the stored face
  // directly — not weight × qty — even if legacy data carries qty > 1.
  test("constitutional weight tooltip uses stored total face in face mode (ignores qty)", async ({
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
    const title = await page
      .locator("#inventoryTable tbody tr")
      .filter({ hasText: "Core Face Mode Qty2" })
      .locator("td[data-column='weight'] .filter-text")
      .getAttribute("title");
    // Stored total face is $50.00; the old weight × qty would have wrongly shown $100.00.
    expect(title).toMatch(/\$50\.00 face/);
    expect(title).not.toMatch(/\$100\.00/);
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
    await openBulkEditForConstitutional(page, [MONEY_ITEM]);

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
    await openBulkEditForConstitutional(page, [MONEY_ITEM]);

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

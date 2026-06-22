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
// STRK-235 — Constitutional / junk silver (TDD red phase: written BEFORE impl).
// These assert the design.md contracts for tasks 1-10; they must fail now and
// pass once the implementation lands. Maps every requirements.md AC (R1-R6).
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
    const melt = await page.evaluate(() =>
      window.computeMeltValue(
        {
          weightUnit: "cu",
          constitutionalEntryMode: "face",
          constitutionalVariant: "con-90-subsidiary",
          weight: 10,
          qty: 1,
        },
        0
      )
    );
    expect(melt).toBe(0);
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

  test("the per-item details view shows the variant and derived silver content", async ({
    page,
  }) => {
    await seedMoneyData(page, { inventory: [CU_QUARTERS_40] });
    await gotoApp(page);
    await page.evaluate(() => window.showViewModal(0));
    await expect(page.locator("#viewItemModal")).toBeVisible();
    await expect(page.locator("#viewItemModal")).toContainText(/90%\s*Quarter/i);
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
    await page.selectOption("#bulkFieldVal_type", "Constitutional");
    await expect
      .poll(() => page.evaluate(() => document.getElementById("bulkFieldVal_weightUnit")?.value))
      .toBe("cu");
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

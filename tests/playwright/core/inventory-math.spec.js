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

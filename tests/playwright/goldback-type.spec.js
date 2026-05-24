import { test, expect } from "./helpers/mocks/extended-test.js";

const BASE_ITEMS = [
  {
    uuid: "stak562-goldback-item",
    metal: "Gold",
    composition: "Gold",
    name: "STAK562 Goldback Existing",
    qty: 1,
    type: "Goldback",
    weight: 5,
    weightUnit: "gb",
    price: 25,
    marketValue: 0,
    date: "2026-01-01",
    purchaseLocation: "staktrakr.com",
    storageLocation: "Safe",
    serialNumber: "",
    notes: "",
    year: "2026",
    grade: "",
    gradingAuthority: "",
    certNumber: "",
    pcgsNumber: "",
    pcgsVerified: false,
    spotPriceAtPurchase: 0,
    premiumPerOz: 0,
    totalPremium: 0,
    purity: 1,
    numistaId: "",
    serial: 1,
  },
  {
    uuid: "stak562-silver-item",
    metal: "Silver",
    composition: "Silver",
    name: "STAK562 Silver Coin",
    qty: 1,
    type: "Coin",
    weight: 1,
    weightUnit: "oz",
    price: 30,
    marketValue: 0,
    date: "2026-01-01",
    purchaseLocation: "staktrakr.com",
    storageLocation: "Safe",
    serialNumber: "",
    notes: "",
    year: "2026",
    grade: "",
    gradingAuthority: "",
    certNumber: "",
    pcgsNumber: "",
    pcgsVerified: false,
    spotPriceAtPurchase: 0,
    premiumPerOz: 0,
    totalPremium: 0,
    purity: 0.999,
    numistaId: "",
    serial: 2,
  },
];

async function seedData(page, inventory = BASE_ITEMS, options = {}) {
  const { goldbackPrices = {}, goldbackPriceHistory = {}, goldbackPricingSource = "api" } = options;

  await page.addInitScript(
    ({ inv, gbPrices, gbHistory, gbSource }) => {
      localStorage.setItem("metalInventory", JSON.stringify(inv));
      localStorage.setItem("goldback-prices", JSON.stringify(gbPrices));
      localStorage.setItem("goldback-price-history", JSON.stringify(gbHistory));
      localStorage.setItem("goldback-pricing-source", JSON.stringify(gbSource));
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
      inv: inventory,
      gbPrices: goldbackPrices,
      gbHistory: goldbackPriceHistory,
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
      typeof window.openBulkEdit === "function" &&
      Array.isArray(window.inventory)
  );
  await page.waitForTimeout(500);
}

async function openAddModal(page) {
  const whatsNew = page.locator("#whatsNewPopup");
  if (await whatsNew.isVisible()) {
    await page.click("#whatsNewDismissBtn");
  }
  await page.evaluate(() => document.getElementById("newItemBtn").click());
  await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });
}

async function openBulkEditModal(page) {
  const whatsNew = page.locator("#whatsNewPopup");
  if (await whatsNew.isVisible()) {
    await page.click("#whatsNewDismissBtn");
  }
  await page.evaluate(() => {
    if (typeof window.openBulkEdit === "function") {
      window.openBulkEdit();
      return;
    }
    const btn = document.getElementById("bulkEditBtn");
    if (btn) btn.click();
  });
  await expect(page.locator("#bulkEditModal")).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#bulkFieldVal_type")).toHaveCount(1);
}

async function readOptionState(page, selectId, value) {
  return page.evaluate(
    ({ sid, optionValue }) => {
      const select = document.getElementById(sid);
      if (!select) return { exists: false, hidden: true, disabled: true };
      const option = Array.from(select.options).find((opt) => opt.value === optionValue);
      if (!option) return { exists: false, hidden: true, disabled: true };
      return {
        exists: true,
        hidden: Boolean(option.hidden),
        disabled: Boolean(option.disabled),
      };
    },
    { sid: selectId, optionValue: value }
  );
}

test.describe("goldback-type — STAK-562 first-class type behavior", () => {
  test("1. Type dropdown includes Goldback and Silverback", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await expect(page.locator('#itemType option[value="Goldback"]')).toHaveCount(1);
    await expect(page.locator('#itemType option[value="Silverback"]')).toHaveCount(1);
  });

  test("2. Metal selection filters Goldback/Silverback options", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.selectOption("#itemMetal", "Gold");
    const goldGoldback = await readOptionState(page, "itemType", "Goldback");
    const goldSilverback = await readOptionState(page, "itemType", "Silverback");
    expect(goldGoldback.exists).toBe(true);
    expect(goldGoldback.hidden).toBe(false);
    expect(goldSilverback.exists).toBe(true);
    expect(goldSilverback.hidden).toBe(true);

    await page.selectOption("#itemMetal", "Silver");
    const silverGoldback = await readOptionState(page, "itemType", "Goldback");
    const silverSilverback = await readOptionState(page, "itemType", "Silverback");
    expect(silverGoldback.hidden).toBe(true);
    expect(silverSilverback.hidden).toBe(false);

    await page.selectOption("#itemMetal", "Platinum");
    const platinumGoldback = await readOptionState(page, "itemType", "Goldback");
    const platinumSilverback = await readOptionState(page, "itemType", "Silverback");
    expect(platinumGoldback.hidden).toBe(true);
    expect(platinumSilverback.hidden).toBe(true);
  });

  test("3. Goldback type swaps to denomination picker", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.selectOption("#itemMetal", "Gold");
    await page.selectOption("#itemType", "Goldback");

    await expect(page.locator("#itemGbDenom")).toBeVisible();
    await expect(page.locator("#itemWeight")).toBeHidden();
    await expect(page.locator("#itemWeightLabel")).toHaveText("DENOMINATION");
    await expect(page.locator("#itemWeightUnit")).toHaveValue("gb");
  });

  test("4. Switching away from Goldback reverts to weight/unit", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.selectOption("#itemMetal", "Gold");
    await page.selectOption("#itemType", "Goldback");
    await page.selectOption("#itemType", "Coin");

    await expect(page.locator("#itemGbDenom")).toBeHidden();
    await expect(page.locator("#itemWeight")).toBeVisible();
    await expect(page.locator("#itemWeightLabel")).toHaveText("Weight");
    await expect(page.locator("#itemWeightUnit")).toHaveValue("oz");
  });

  test("5. Purity list includes .500 option", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await expect(page.locator('#itemPuritySelect option[value="0.500"]')).toHaveCount(1);
  });

  test("6. Edit modal restores Goldback type and denomination", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);

    await page.evaluate(() => window.editItem(0));
    await expect(page.locator("#itemModal")).toBeVisible();

    await expect(page.locator("#itemType")).toHaveValue("Goldback");
    await expect(page.locator("#itemGbDenom")).toBeVisible();
    await expect(page.locator("#itemGbDenom")).toHaveValue("5");
    await expect(page.locator("#itemWeightUnit")).toHaveValue("gb");
  });

  test("7. Bulk edit has same type filtering and denomination cascade", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openBulkEditModal(page);

    await expect(page.locator('#bulkFieldVal_type option[value="Goldback"]')).toHaveCount(1);
    await expect(page.locator('#bulkFieldVal_type option[value="Silverback"]')).toHaveCount(1);

    await page.click("#bulkField_metal");
    await page.selectOption("#bulkFieldVal_metal", "Gold");
    const bulkGoldState = await readOptionState(page, "bulkFieldVal_type", "Goldback");
    const bulkSilverState = await readOptionState(page, "bulkFieldVal_type", "Silverback");
    expect(bulkGoldState.hidden).toBe(false);
    expect(bulkSilverState.hidden).toBe(true);

    await page.click("#bulkField_type");
    await page.click("#bulkField_weight");
    await page.click("#bulkField_weightUnit");
    await page.selectOption("#bulkFieldVal_type", "Goldback");

    await expect(page.locator("#bulkFieldVal_weightDenom")).toBeVisible();
    await expect(page.locator("#bulkFieldVal_weight")).toBeHidden();
  });

  test("8. Silverback type uses sb unit without denomination picker", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Silverback");

    await expect(page.locator("#itemWeightUnit")).toHaveValue("sb");
    await expect(page.locator("#itemGbDenom")).toBeHidden();
  });

  test("9. Goldback type shows all 9 standard denominations", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.selectOption("#itemMetal", "Gold");
    await page.selectOption("#itemType", "Goldback");

    const options = await page.evaluate(() => {
      const sel = document.getElementById("itemGbDenom");
      return Array.from(sel.options).map((o) => ({ value: o.value, text: o.textContent }));
    });
    expect(options).toHaveLength(9);
    expect(options[0].text).toBe("¼ Goldback");
    expect(options[1].text).toBe("½ Goldback");
    expect(options[8].text).toBe("100 Goldback");
  });

  test("10. Silverback has a dedicated silverback unit option", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Silverback");

    const unitText = await page.evaluate(() => {
      const opt = document.querySelector('#itemWeightUnit option[value="sb"]');
      return opt ? opt.textContent : null;
    });
    expect(unitText).toBe("silverback");
    await expect(page.locator("#itemWeightUnit")).toHaveValue("sb");
  });

  test("11. Purity defaults to .999 when switching to Goldback or Silverback", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await expect(page.locator("#itemPuritySelect")).toHaveValue("0.9999");

    await page.selectOption("#itemMetal", "Gold");
    await page.selectOption("#itemType", "Goldback");
    await expect(page.locator("#itemPuritySelect")).toHaveValue("0.999");

    await page.selectOption("#itemType", "Coin");
    await page.selectOption("#itemPuritySelect", "0.925");

    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Silverback");
    await expect(page.locator("#itemPuritySelect")).toHaveValue("0.999");
  });

  test("12. Custom purity is not overwritten when switching to Goldback/Silverback", async ({
    page,
  }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.selectOption("#itemPuritySelect", "custom");
    await page.fill("#itemPurity", "0.9995");

    await page.selectOption("#itemMetal", "Gold");
    await page.selectOption("#itemType", "Goldback");

    await expect(page.locator("#itemPuritySelect")).toHaveValue("custom");
  });

  test("13. Bulk edit Silverback uses sb unit without denomination picker", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openBulkEditModal(page);

    await page.click("#bulkField_metal");
    await page.click("#bulkField_type");
    await page.click("#bulkField_weight");
    await page.click("#bulkField_weightUnit");

    await page.selectOption("#bulkFieldVal_metal", "Silver");
    await page.selectOption("#bulkFieldVal_type", "Silverback");

    await expect(page.locator("#bulkFieldVal_weightUnit")).toHaveValue("sb");
    await expect(page.locator("#bulkFieldVal_weightDenom")).toBeHidden();

    await page.selectOption("#bulkFieldVal_metal", "Gold");
    await page.selectOption("#bulkFieldVal_type", "Goldback");

    const goldOptions = await page.evaluate(() => {
      const sel = document.getElementById("bulkFieldVal_weightDenom");
      return Array.from(sel.options).map((o) => ({ value: o.value, text: o.textContent }));
    });
    expect(goldOptions).toHaveLength(9);
    expect(goldOptions[0].text).toBe("¼ Goldback");
  });

  test("14. Manual Goldback retail value is a floor override, not ignored", async ({ page }) => {
    await seedData(page, BASE_ITEMS, {
      goldbackPrices: { 1: { price: 9.48, updatedAt: Date.now(), source: "api" } },
      goldbackPricingSource: "manual",
    });
    await gotoApp(page);
    await page.waitForFunction(() => typeof window.calculateRetailPrice === "function");

    const values = await page.evaluate(() => {
      const baseItem = {
        metal: "Gold",
        type: "Goldback",
        weight: 1,
        weightUnit: "gb",
        qty: 1,
        purity: 0.999,
        price: 0,
      };

      return {
        highManual: window.calculateRetailPrice({ ...baseItem, marketValue: 100 }, 4715.22),
        lowManual: window.calculateRetailPrice({ ...baseItem, marketValue: 2 }, 4715.22),
      };
    });

    expect(values.highManual.gbDenomPrice).toBe(9.48);
    expect(values.highManual.isManualRetail).toBe(true);
    expect(values.highManual.retailTotal).toBe(100);
    expect(values.lowManual.isManualRetail).toBe(false);
    expect(values.lowManual.retailTotal).toBe(9.48);
  });

  test("15. Goldback retail lookup uses daily Goldback history instead of gold spot", async ({
    page,
  }) => {
    const today = new Date().toLocaleDateString("en-CA");

    await seedData(page, [], {
      goldbackPriceHistory: {
        1: [{ ts: new Date(`${today}T12:00:00.000Z`).getTime(), price: 9.48, source: "api" }],
      },
      goldbackPricingSource: "manual",
    });
    await gotoApp(page);
    await openAddModal(page);

    await page.fill("#itemDate", "2026-05-11");
    await page.selectOption("#itemMetal", "Gold");
    await page.selectOption("#itemType", "Goldback");
    await expect(page.locator("#itemWeightUnit")).toHaveValue("gb");

    await page.click("#retailSpotLookupBtn");
    await expect(page.locator("#spotLookupModal")).toBeVisible();
    await expect(page.locator("#spotLookupTitle")).toContainText("Goldback Lookup");
    await expect(page.locator("#spotLookupBody")).toContainText("Goldback Price");
    await expect(page.locator("#spotLookupBody")).toContainText("$9.48");

    await page.locator(".spot-lookup-use-btn").first().click();
    await expect(page.locator("#itemMarketValue")).toHaveValue("9.48");
  });

  test("16. Goldback purchase-price lookup uses Goldback history, not gold spot (STRK-77)", async ({
    page,
  }) => {
    await seedData(page, [], {
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
    await expect(page.locator("#itemWeightUnit")).toHaveValue("gb");

    await page.click("#spotLookupBtn");
    await expect(page.locator("#spotLookupModal")).toBeVisible();
    await expect(page.locator("#spotLookupTitle")).toContainText("Goldback Lookup");
    await expect(page.locator("#spotLookupBody")).toContainText("Goldback Price");
    await expect(page.locator("#spotLookupBody")).toContainText("$9.48");
    await expect(page.locator("#spotLookupBody")).not.toContainText("Offset");

    await page.locator(".spot-lookup-use-btn").first().click();
    await expect(page.locator("#itemPrice")).toHaveValue("9.48");
  });
});

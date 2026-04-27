import { test, expect } from "@playwright/test";

const BASE_ITEM = {
  uuid: "strk4-base-item",
  metal: "Silver",
  composition: "Silver",
  name: "STRK-4 Base Silver Eagle",
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

const EXACT_SPOT_ENTRY = {
  timestamp: "2026-04-01T12:00:00.000Z",
  metal: "Silver",
  spot: 33.25,
  source: "seed",
  provider: "Playwright",
};

async function seedData(page, options = {}) {
  const {
    inventory = [],
    displayCurrency = "USD",
    exchangeRates = { EUR: 0.9 },
    spotHistory = [EXACT_SPOT_ENTRY],
  } = options;

  await page.route("https://open.er-api.com/v6/latest/USD", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: "success", base_code: "USD", rates: exchangeRates }),
    });
  });

  await page.addInitScript(
    ({ seededInventory, currency, rates, history }) => {
      localStorage.setItem("metalInventory", JSON.stringify(seededInventory));
      localStorage.setItem("itemTags", JSON.stringify({}));
      localStorage.setItem("cardViewStyle", "D");
      localStorage.setItem("displayCurrency", JSON.stringify(currency));
      localStorage.setItem("exchangeRates", JSON.stringify(rates));
      localStorage.setItem("metalSpotHistory", JSON.stringify(history));
      localStorage.setItem("sortColumn", "4");
      localStorage.setItem("sortDirection", "asc");

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
    }
  );
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () =>
      typeof window.editItem === "function" &&
      typeof window.showViewModal === "function" &&
      Array.isArray(window.inventory)
  );
  await page.waitForTimeout(500);
}

async function openAddModal(page) {
  const modal = page.locator("#itemModal");
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.evaluate(() => document.getElementById("newItemBtn").click());
    if (await modal.isVisible()) return;
    await page.waitForTimeout(250);
  }
  await expect(modal).toBeVisible();
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

async function closeItemModal(page) {
  await page.evaluate(() => {
    if (typeof window.closeModalById === "function") {
      window.closeModalById("itemModal");
    } else {
      const modal = document.getElementById("itemModal");
      if (modal) modal.style.display = "none";
    }
  });
  await expect(page.locator("#itemModal")).toBeHidden();
}

function purchaseModeButton(page, mode) {
  return page.locator(`#purchasePriceModeToggle [data-mode="${mode}"]`);
}

async function expectPurchaseModeTogglePresent(page) {
  await expect(page.locator("#purchasePriceModeToggle")).toHaveCount(1, { timeout: 1000 });
  await expect(purchaseModeButton(page, "each")).toHaveCount(1, { timeout: 1000 });
  await expect(purchaseModeButton(page, "lot")).toHaveCount(1, { timeout: 1000 });
}

async function expectEachModeActive(page) {
  await expectPurchaseModeTogglePresent(page);
  await expect(purchaseModeButton(page, "each")).toHaveClass(/active/);
  await expect(purchaseModeButton(page, "lot")).not.toHaveClass(/active/);
}

async function selectPurchaseMode(page, mode) {
  await expectPurchaseModeTogglePresent(page);
  await purchaseModeButton(page, mode).click();
  await expect(purchaseModeButton(page, mode)).toHaveClass(/active/);
}

async function fillInventoryForm(
  page,
  { name, qty = "1", price = "100", weight = "1", date = "2026-04-01" }
) {
  await page.selectOption("#itemMetal", "Silver");
  await page.selectOption("#itemType", "Coin");
  await page.fill("#itemName", name);
  await page.fill("#itemQty", String(qty));
  await page.fill("#itemWeight", String(weight));
  await page.fill("#itemDate", date);
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

async function expectPurchaseCellText(page, name, expectedText) {
  const row = tableRowByName(page, name);
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-column="purchasePrice"]')).toContainText(expectedText);
}

test.describe("STRK-4 Lot/Each Purchase Price toggle", () => {
  test("1. Toggle defaults to Each on add — REQ-1.1, REQ-1.2", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await expectEachModeActive(page);
  });

  test("2. Toggle defaults to Each on edit — REQ-1.2", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openEditModal(page);

    await expectEachModeActive(page);
    await expect(page.locator("#itemPrice")).toHaveValue("100");
  });

  test("3. Toggle defaults to Each on clone — REQ-1.2", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openCloneModal(page);

    await expectEachModeActive(page);
  });

  test("4. Each mode stores input as-is — REQ-1.4", async ({ page }) => {
    const itemName = "STRK-4 Each Stores Input";
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);
    await expectEachModeActive(page);
    await fillInventoryForm(page, { name: itemName, qty: "4", price: "100" });
    await submitItemForm(page);

    const item = await getInventoryItem(page, itemName);
    expect(item).not.toBeNull();
    expect(item.qty).toBe(4);
    expect(item.price).toBeCloseTo(100, 6);
  });

  test("5. Lot mode divides on save (4x at $400 -> $100 each) — REQ-1.3", async ({ page }) => {
    const itemName = "STRK-4 Lot Divides";
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);
    await selectPurchaseMode(page, "lot");
    await fillInventoryForm(page, { name: itemName, qty: "4", price: "400" });
    await submitItemForm(page);

    const item = await getInventoryItem(page, itemName);
    expect(item).not.toBeNull();
    expect(item.qty).toBe(4);
    expect(item.price).toBeCloseTo(100, 6);
  });

  test("6. Reddit reporter scenario (120x at $120 lot -> $1.00 each, $120 total in table) — REQ-1.3, REQ-4.1", async ({
    page,
  }) => {
    const itemName = "STRK-4 Reddit Half Dollars";
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);
    await selectPurchaseMode(page, "lot");
    await fillInventoryForm(page, {
      name: itemName,
      qty: "120",
      price: "120",
      weight: "0.3617",
    });
    await submitItemForm(page);

    const item = await getInventoryItem(page, itemName);
    expect(item).not.toBeNull();
    expect(item.qty).toBe(120);
    expect(item.price).toBeCloseTo(1, 6);
    await expectPurchaseCellText(page, itemName, "$120.00");
  });

  test("7. Qty-zero + Lot blocks submission with appAlert — REQ-1.5", async ({ page }) => {
    const itemName = "STRK-4 Lot Qty Zero";
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);
    await selectPurchaseMode(page, "lot");
    await fillInventoryForm(page, { name: itemName, qty: "0", price: "120" });
    await page.click("#itemModalSubmit");

    await expect(page.locator("#itemModal")).toBeVisible();
    await expect(
      page.locator(".app-dialog, .dialog, [role='dialog']").filter({
        hasText: /Lot mode requires a quantity of at least 1/i,
      })
    ).toBeVisible();
    await expect.poll(() => getInventoryItem(page, itemName)).toBeNull();
  });

  test("8. Helper text live-updates as toggle/qty/price change — REQ-2.1, REQ-2.2, REQ-2.3", async ({
    page,
  }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);
    await expectPurchaseModeTogglePresent(page);

    const helper = page.locator("#purchasePriceHelper");
    await expect(helper).toHaveAttribute("aria-live", "polite");
    await page.fill("#itemQty", "1");
    await page.fill("#itemPrice", "100");
    await expect(helper).toHaveText(/Each.*price per single item/i);

    await page.fill("#itemQty", "5");
    await expect(helper).toContainText("Total for 5: $500.00");

    await selectPurchaseMode(page, "lot");
    await expect(helper).toContainText("Lot — total paid for all 5 items");
    await expect(helper).toContainText("Saved as $20.00 each");

    await page.fill("#itemQty", "4");
    await expect(helper).toContainText("Saved as $25.00 each");
  });

  test("9. Spot-lookup auto-selects Each — REQ-1.7", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);
    await fillInventoryForm(page, {
      name: "STRK-4 Spot Lookup",
      qty: "3",
      price: "90",
      date: "2026-04-01",
    });
    await selectPurchaseMode(page, "lot");

    await page.click("#spotLookupBtn");
    await expect(page.locator("#spotLookupModal")).toBeVisible();
    await page.locator(".spot-lookup-use-btn").first().click();

    await expectEachModeActive(page);
    await expect(page.locator("#itemPrice")).toHaveValue("33.25");
  });

  test("10. View modal dual display when qty greater than one — REQ-3.1", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openViewModal(page);

    const purchaseRow = page.locator("#viewItemModal").filter({ hasText: "Purchase" });
    await expect(purchaseRow).toContainText("$400.00 total");
    await expect(purchaseRow).toContainText("$100.00 each");
    await expect(purchaseRow).toContainText("(4/1/26)");
  });

  test("11. View modal single value when qty equals one — REQ-3.2", async ({ page }) => {
    await seedData(page, {
      inventory: [{ ...BASE_ITEM, uuid: "strk4-single-item", name: "STRK-4 Single", qty: 1 }],
    });
    await gotoApp(page);
    await openAddModal(page);
    await expectPurchaseModeTogglePresent(page);
    await closeItemModal(page);
    await openViewModal(page);

    const purchaseRow = page.locator("#viewItemModal").filter({ hasText: "Purchase" });
    await expect(purchaseRow).toContainText("$100.00 (4/1/26)");
    await expect(purchaseRow).not.toContainText("total");
    await expect(purchaseRow).not.toContainText("each");
  });

  test("12. Table Purchase column shows qty-total — REQ-4.1", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    await expectPurchaseCellText(page, BASE_ITEM.name, "$400.00");
    await expect(
      tableRowByName(page, BASE_ITEM.name).locator('[data-column="purchasePrice"]')
    ).not.toContainText("$100.00");
  });

  test("13. Sort by Purchase column sorts by total — REQ-4.2", async ({ page }) => {
    const lowerTotal = {
      ...BASE_ITEM,
      uuid: "strk4-sort-lower-total",
      name: "STRK-4 Sort Lower Total",
      qty: 1,
      price: 200,
    };
    const higherTotal = {
      ...BASE_ITEM,
      uuid: "strk4-sort-higher-total",
      name: "STRK-4 Sort Higher Total",
      qty: 5,
      price: 50,
    };
    await seedData(page, { inventory: [higherTotal, lowerTotal] });
    await gotoApp(page);

    await page.locator('#inventoryTable thead th[data-column="purchasePrice"]').click();
    await expect(
      tableRowByName(page, lowerTotal.name).locator('[data-column="purchasePrice"]')
    ).toContainText("$200.00");
    await expect(
      tableRowByName(page, higherTotal.name).locator('[data-column="purchasePrice"]')
    ).toContainText("$250.00");

    const orderedNames = await page
      .locator("#inventoryTable tbody tr [data-column='name']")
      .allTextContents();
    const lowerIndex = orderedNames.findIndex((text) => text.includes(lowerTotal.name));
    const higherIndex = orderedNames.findIndex((text) => text.includes(higherTotal.name));
    expect(lowerIndex).toBeGreaterThanOrEqual(0);
    expect(higherIndex).toBeGreaterThanOrEqual(0);
    expect(lowerIndex).toBeLessThan(higherIndex);
  });

  test("14. FX path (USD->EUR with known rate) — REQ-1.3 + Reliability NFR", async ({ page }) => {
    const itemName = "STRK-4 EUR Lot";
    await seedData(page, { displayCurrency: "EUR", exchangeRates: { EUR: 0.9 } });
    await gotoApp(page);
    await openAddModal(page);
    await selectPurchaseMode(page, "lot");
    await fillInventoryForm(page, { name: itemName, qty: "3", price: "90" });
    await submitItemForm(page);

    const item = await getInventoryItem(page, itemName);
    expect(item).not.toBeNull();
    expect(item.qty).toBe(3);
    expect(item.price).toBeCloseTo((90 / 3) * (1 / 0.9), 6);
  });
});

import { test, expect } from "../helpers/mocks/extended-test.js";

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
    await expect(page.locator("#itemPrice")).toHaveValue("100.00");
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
    await fillInventoryForm(page, { name: itemName, qty: "4", price: "" });
    await selectPurchaseMode(page, "lot");
    await page.fill("#itemPrice", "400");
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
    await fillInventoryForm(page, {
      name: itemName,
      qty: "120",
      price: "",
      weight: "0.3617",
    });
    await selectPurchaseMode(page, "lot");
    await page.fill("#itemPrice", "120");
    await submitItemForm(page);

    const item = await getInventoryItem(page, itemName);
    expect(item).not.toBeNull();
    expect(item.qty).toBe(120);
    expect(item.price).toBeCloseTo(1, 6);
    await expectPurchaseCellText(page, itemName, "$120.00");
  });

  test("7. Toggle hides at qty <= 1 and auto-coerces Lot back to Each — STRK-4 QA refinement", async ({
    page,
  }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    const toggle = page.locator("#purchasePriceModeToggle");

    // Empty qty → toggle hidden (no mode decision to make)
    await expect(toggle).toHaveClass(/is-hidden/);

    // qty=1 → still hidden (Lot/Each are equivalent)
    await page.fill("#itemQty", "1");
    await expect(toggle).toHaveClass(/is-hidden/);

    // qty>1 → toggle becomes visible
    await page.fill("#itemQty", "4");
    await expect(toggle).not.toHaveClass(/is-hidden/);

    // Switch to Lot mode while qty>1 is valid
    await selectPurchaseMode(page, "lot");
    await expect(purchaseModeButton(page, "lot")).toHaveClass(/active/);

    // Drop qty back to 1 → toggle hides AND mode auto-coerces to Each
    await page.fill("#itemQty", "1");
    await expect(toggle).toHaveClass(/is-hidden/);
    await expect(purchaseModeButton(page, "each")).toHaveClass(/active/);
    await expect(purchaseModeButton(page, "lot")).not.toHaveClass(/active/);
  });

  test("8. Mode hint renders inline as input placeholder — STRK-4 QA refinement", async ({
    page,
  }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    const priceInput = page.locator("#itemPrice");

    // Each is the default mode — placeholder reflects it
    await expect(priceInput).toHaveAttribute("placeholder", "Each");

    // qty>1 reveals the toggle; switching to Lot updates the placeholder inline
    await page.fill("#itemQty", "5");
    await selectPurchaseMode(page, "lot");
    await expect(priceInput).toHaveAttribute("placeholder", "Lot total");

    // Switch back to Each — placeholder restores
    await selectPurchaseMode(page, "each");
    await expect(priceInput).toHaveAttribute("placeholder", "Each");
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
    await fillInventoryForm(page, { name: itemName, qty: "3", price: "" });
    await selectPurchaseMode(page, "lot");
    await page.fill("#itemPrice", "90");
    await submitItemForm(page);

    const item = await getInventoryItem(page, itemName);
    expect(item).not.toBeNull();
    expect(item.qty).toBe(3);
    expect(item.price).toBeCloseTo((90 / 3) * (1 / 0.9), 6);
  });

  test("15. STRK-23 switching Lot to Each converts the visible input", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.fill("#itemQty", "2");
    await selectPurchaseMode(page, "lot");
    await page.fill("#itemPrice", "100");
    await selectPurchaseMode(page, "each");

    await expect(page.locator("#itemPrice")).toHaveValue("50.00");
  });

  test("16. STRK-23 switching Each to Lot converts the visible input", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.fill("#itemQty", "2");
    await page.fill("#itemPrice", "50");
    await selectPurchaseMode(page, "lot");

    await expect(page.locator("#itemPrice")).toHaveValue("100.00");
  });

  test("17. STRK-23 switching modes emits input after auto-conversion", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.fill("#itemQty", "2");
    await selectPurchaseMode(page, "lot");
    await page.fill("#itemPrice", "100");
    await page.evaluate(() => {
      window.__strk23PriceInputEvents = 0;
      document.getElementById("itemPrice").addEventListener("input", () => {
        window.__strk23PriceInputEvents += 1;
      });
    });

    await selectPurchaseMode(page, "each");

    await expect(page.locator("#itemPrice")).toHaveValue("50.00");
    await expect.poll(() => page.evaluate(() => window.__strk23PriceInputEvents)).toBe(1);
  });
});

// =============================================================================
// STRK-88 — Floating-point price artifact: purchase price rounding
// =============================================================================

test.describe("STRK-88 — Purchase price rounding", () => {
  // AC-1: LOT→EACH toggle displays currency-rounded value (not 6-decimal raw)

  test("18. STRK-88 AC-1: $1700 LOT/qty 30 toggles to $56.67 EACH (not $56.666667)", async ({
    page,
  }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.fill("#itemQty", "30");
    await selectPurchaseMode(page, "lot");
    await page.fill("#itemPrice", "1700");
    await selectPurchaseMode(page, "each");

    // Should show $56.67 (2dp USD), NOT 56.666667
    await expect(page.locator("#itemPrice")).toHaveValue("56.67");
  });

  test("19. STRK-88 AC-1: EACH→LOT with exact-lot cache restores original $1700", async ({
    page,
  }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.fill("#itemQty", "30");
    await selectPurchaseMode(page, "lot");
    await page.fill("#itemPrice", "1700");
    await selectPurchaseMode(page, "each");

    // LOT→EACH: should now show 56.67
    await expect(page.locator("#itemPrice")).toHaveValue("56.67");

    // EACH→LOT: with exact LOT cache, should restore original $1700
    await selectPurchaseMode(page, "lot");
    await expect(page.locator("#itemPrice")).toHaveValue("1700.00");
  });

  // AC-2: Mode emits exactly one input event after conversion (regression guard)

  test("20. STRK-88 AC-2: toggle emits exactly one input event after LOT→EACH conversion", async ({
    page,
  }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.fill("#itemQty", "30");
    await selectPurchaseMode(page, "lot");
    await page.fill("#itemPrice", "1700");

    await page.evaluate(() => {
      window.__strk88InputEvents = 0;
      document.getElementById("itemPrice").addEventListener("input", () => {
        window.__strk88InputEvents += 1;
      });
    });

    await selectPurchaseMode(page, "each");
    await expect.poll(() => page.evaluate(() => window.__strk88InputEvents)).toBe(1);
  });

  test("20b. STRK-88 AC-5b: saving $1700 LOT/qty 30 does not persist six-decimal drift", async ({
    page,
  }) => {
    const itemName = "STRK-88 LOT Save Precision";
    await seedData(page);
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

  // AC-3a: Edit-mode EACH reopens with rounded value (not raw 6dp float)

  test("21. STRK-88 AC-3b: editing an EACH-saved item with drift reopens in EACH mode showing $56.67", async ({
    page,
  }) => {
    const itemName = "STRK-88 EACH Edit Restore";
    const EACH_ITEM = {
      ...BASE_ITEM,
      uuid: "strk88-each-restore",
      name: itemName,
      qty: 30,
      price: 56.66666666666667, // legacy drifted value (1700/30 stored as raw float)
      pricingType: "each",
    };

    await seedData(page, { inventory: [EACH_ITEM] });
    await gotoApp(page);
    await openEditModal(page);

    // Verify EACH mode and rounded display
    await expect(purchaseModeButton(page, "each")).toHaveClass(/active/);
    await expect(page.locator("#itemPrice")).toHaveValue("56.67");
  });

  // AC-3a: Edit-mode LOT restore shows $1700 and rehydrates exact-lot cache

  test("22. STRK-88 AC-3a: editing a LOT-saved item reopens in LOT mode showing $1700", async ({
    page,
  }) => {
    const itemName = "STRK-88 LOT Edit Restore";
    const LOT_ITEM = {
      ...BASE_ITEM,
      uuid: "strk88-lot-restore",
      name: itemName,
      qty: 30,
      price: 1700 / 30, // stored per-unit
      pricingType: "lot",
    };

    await seedData(page, { inventory: [LOT_ITEM] });
    await gotoApp(page);
    await openEditModal(page);

    // Should be in LOT mode, showing $1700
    await expect(purchaseModeButton(page, "lot")).toHaveClass(/active/);
    await expect(page.locator("#itemPrice")).toHaveValue("1700.00");

    // Cache should be rehydrated: switching to EACH shows $56.67
    await selectPurchaseMode(page, "each");
    await expect(page.locator("#itemPrice")).toHaveValue("56.67");

    // Switching back to LOT recovers $1700 (not 56.67 × 30 = 1700.10)
    await selectPurchaseMode(page, "lot");
    await expect(page.locator("#itemPrice")).toHaveValue("1700.00");
  });

  // AC-4: Changing qty in LOT mode invalidates the exact-lot cache

  test("23. STRK-88 AC-4: changing qty while LOT mode active clears the exact-lot cache", async ({
    page,
  }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.fill("#itemQty", "30");
    await selectPurchaseMode(page, "lot");
    await page.fill("#itemPrice", "1700");

    // Prime the exact-lot cache via LOT→EACH→LOT cycle
    await selectPurchaseMode(page, "each");
    await expect(page.locator("#itemPrice")).toHaveValue("56.67");
    await selectPurchaseMode(page, "lot");
    await expect(page.locator("#itemPrice")).toHaveValue("1700.00");

    // Changing qty should invalidate the old cache
    await page.fill("#itemQty", "10");
    await page.fill("#itemPrice", "1000");

    // LOT→EACH: should use new qty (1000/10=100, rounded to $100.00)
    await selectPurchaseMode(page, "each");
    await expect(page.locator("#itemPrice")).toHaveValue("100.00");

    // EACH→LOT with no old cache: should compute 100*10=1000
    await selectPurchaseMode(page, "lot");
    await expect(page.locator("#itemPrice")).toHaveValue("1000.00");
  });

  // AC-5a: Duplicate mode rounds drifted EACH values

  test("24. STRK-88 AC-5a: duplicating a drifted EACH item rounds the price display", async ({
    page,
  }) => {
    const DRIFTED_ITEM = {
      ...BASE_ITEM,
      uuid: "strk88-drifted-each",
      name: "STRK-88 Drifted Each",
      qty: 4,
      price: 56.66666666666667, // legacy drifted value (1700/30 stored as raw float)
      pricingType: "each",
    };

    await seedData(page, { inventory: [DRIFTED_ITEM] });
    await gotoApp(page);
    await openCloneModal(page);

    // Should show rounded $56.67, not $56.666667
    await expect(page.locator("#itemPrice")).toHaveValue("56.67");
  });

  // AC-5b: Duplicate mode for a LOT source item shows per-unit rounded price in EACH mode

  test("25. STRK-88 AC-5b: duplicating a LOT-saved item preserves LOT mode and total", async ({
    page,
  }) => {
    const LOT_SOURCE = {
      ...BASE_ITEM,
      uuid: "strk88-lot-source",
      name: "STRK-88 LOT Source",
      qty: 30,
      price: 1700 / 30, // stored per-unit
      pricingType: "lot",
    };

    await seedData(page, { inventory: [LOT_SOURCE] });
    await gotoApp(page);
    await openCloneModal(page);

    await expect(page.locator("#itemQty")).toHaveValue("30");
    await expect(purchaseModeButton(page, "lot")).toHaveClass(/active/);
    await expect(page.locator("#itemPrice")).toHaveValue("1700.00");

    await selectPurchaseMode(page, "each");
    await expect(page.locator("#itemPrice")).toHaveValue("56.67");
    await selectPurchaseMode(page, "lot");
    await expect(page.locator("#itemPrice")).toHaveValue("1700.00");
  });

  test("26. STRK-88 AC-4: Numista CSV export writes display-currency buying price", async ({
    page,
  }) => {
    const itemName = "STRK-88 Numista Export";
    const NUMISTA_ITEM = {
      ...BASE_ITEM,
      uuid: "strk88-numista-export",
      numistaId: "12345",
      name: `${itemName} 2026`,
      qty: 1,
      price: 100,
      purchasePrice: 100,
      purchaseLocation: "Coin Shop",
      storageLocation: "Safe",
    };

    await seedData(page, {
      inventory: [NUMISTA_ITEM],
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
  });

  test("27. STRK-88 AC-4: Numista EUR export reimports without USD price inflation", async ({
    page,
  }) => {
    const NUMISTA_ITEM = {
      ...BASE_ITEM,
      uuid: "strk88-numista-roundtrip",
      numistaId: "67890",
      name: "STRK-88 Numista Roundtrip 2026",
      qty: 1,
      price: 100,
      purchasePrice: 100,
    };

    await seedData(page, {
      inventory: [NUMISTA_ITEM],
      displayCurrency: "EUR",
      exchangeRates: { EUR: 0.9 },
    });
    await gotoApp(page);

    const csv = await captureNumistaCsvExport(page);
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
});

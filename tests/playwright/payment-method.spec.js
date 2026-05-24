import { test, expect } from "./helpers/mocks/extended-test.js";

const makeItem = (overrides = {}) => ({
  uuid: overrides.uuid || `strk-50-${overrides.serial || 1}`,
  metal: "Silver",
  composition: "Silver",
  name: overrides.name || "STRK-50 Test Eagle",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 30,
  marketValue: 35,
  date: "2026-05-13",
  purchaseLocation: "Local coin shop",
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
  serial: overrides.serial || 1,
  ...overrides,
});

async function seedData(page, inventory = []) {
  await page.addInitScript(
    ({ inv }) => {
      localStorage.setItem("metalInventory", JSON.stringify(inv));
      localStorage.setItem("inventorySerial", String(inv.length + 10));
      localStorage.setItem("inventorySeedApplied", "2026-05-13T00:00:00.000Z");
      localStorage.setItem("itemTags", JSON.stringify({}));
      localStorage.setItem("cardViewStyle", "A");
      localStorage.setItem("chipMinCount", "3");
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
    { inv: inventory }
  );
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () =>
      typeof window.editItem === "function" &&
      typeof window.duplicateItem === "function" &&
      typeof window.openBulkEdit === "function" &&
      typeof window.exportInventoryCSV === "function" &&
      Array.isArray(window.inventory)
  );
  await page.waitForTimeout(500);
}

async function dismissWhatsNew(page) {
  const whatsNew = page.locator("#whatsNewPopup");
  if (await whatsNew.isVisible()) {
    await page.click("#whatsNewDismissBtn");
  }
}

async function openAddModal(page) {
  await dismissWhatsNew(page);
  await page.evaluate(() => document.getElementById("newItemBtn").click());
  await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });
}

async function submitItemModal(page) {
  await page.click("#itemModalSubmit");
  await expect(page.locator("#itemModal")).toBeHidden();
}

async function openBulkEditModal(page) {
  await dismissWhatsNew(page);
  await page.evaluate(() => window.openBulkEdit());
  await expect(page.locator("#bulkEditModal")).toBeVisible({ timeout: 10000 });
}

test.describe("STRK-50 payment method dropdown", () => {
  test("AC-1/2/3 — dropdown options persist and blank selection omits the key", async ({
    page,
  }) => {
    await seedData(page, [makeItem({ serial: 1, name: "STRK-50 Existing" })]);
    await gotoApp(page);
    await openAddModal(page);

    const optionLabels = await page.locator("#itemPaymentMethod option").allTextContents();
    expect(optionLabels).toEqual([
      "(blank)",
      "Zelle",
      "PayPal",
      "Credit Card",
      "Debit Card",
      "Cash",
      "Check",
      "Wire",
      "Crypto",
      "Other",
    ]);

    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Coin");
    await page.fill("#itemName", "STRK-50 Credit Purchase");
    await page.fill("#itemWeight", "1");
    await page.fill("#itemPrice", "31");
    await page.selectOption("#itemPaymentMethod", "Credit Card");
    await submitItemModal(page);

    let stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("metalInventory")).find(
        (item) => item.name === "STRK-50 Credit Purchase"
      )
    );
    expect(stored.paymentMethod).toBe("Credit Card");

    const idx = await page.evaluate(() =>
      window.inventory.findIndex((item) => item.name === "STRK-50 Credit Purchase")
    );
    await page.evaluate((inventoryIndex) => window.editItem(inventoryIndex), idx);
    await expect(page.locator("#itemModal")).toBeVisible();
    await expect(page.locator("#itemPaymentMethod")).toHaveValue("Credit Card");
    await page.selectOption("#itemPaymentMethod", "");
    await submitItemModal(page);

    stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("metalInventory")).find(
        (item) => item.name === "STRK-50 Credit Purchase"
      )
    );
    expect(Object.prototype.hasOwnProperty.call(stored, "paymentMethod")).toBe(false);
  });

  test("AC-4/5 — payment method participates in chips, search, and view modal", async ({
    page,
  }) => {
    await seedData(page, [
      makeItem({ serial: 1, name: "STRK-50 Card 1", paymentMethod: "Credit Card" }),
      makeItem({ serial: 2, name: "STRK-50 Card 2", paymentMethod: "Credit Card" }),
      makeItem({ serial: 3, name: "STRK-50 Card 3", paymentMethod: "Credit Card" }),
      makeItem({ serial: 4, name: "STRK-50 Zelle", paymentMethod: "Zelle" }),
    ]);
    await gotoApp(page);
    await page.evaluate(() => window.clearAllFilters());
    await page.waitForTimeout(300);

    const creditChip = page
      .locator("#activeFilters .filter-chip")
      .filter({ hasText: "Credit Card" })
      .first();
    await expect(creditChip).toBeVisible();
    await creditChip.click();
    await page.waitForTimeout(300);
    await expect(page.locator("#cardViewGrid")).toContainText("STRK-50 Card 1");
    await expect(page.locator("#cardViewGrid")).not.toContainText("STRK-50 Zelle");

    await page.evaluate(() => window.clearAllFilters());
    await page.fill("#searchInput", "Zelle");
    await page.waitForTimeout(500);
    await expect(page.locator("#cardViewGrid")).toContainText("STRK-50 Zelle");
    await expect(page.locator("#cardViewGrid")).not.toContainText("STRK-50 Card 1");

    await page.evaluate(() => window.showViewModal(0));
    await expect(page.locator("#viewItemModal")).toBeVisible();
    await expect(page.locator("#viewItemModal")).toContainText("Payment Method");
    await expect(page.locator("#viewItemModal")).toContainText("Credit Card");
  });

  test("AC-9/10 — bulk edit sets and clears paymentMethod; clone preserves it", async ({
    page,
  }) => {
    await seedData(page, [
      makeItem({ serial: 1, name: "STRK-50 Bulk 1", paymentMethod: "PayPal" }),
      makeItem({ serial: 2, name: "STRK-50 Bulk 2" }),
    ]);
    await gotoApp(page);

    await openBulkEditModal(page);
    await page.getByRole("button", { name: "Select All" }).click();
    await page.click("#bulkField_paymentMethod");
    await page.selectOption("#bulkFieldVal_paymentMethod", "Wire");
    await page.getByRole("button", { name: /Apply Changes/ }).click();
    await page.click("#bulkConfirmOkBtn");
    await expect(page.locator("#bulkConfirmModal")).toBeHidden();

    let stored = await page.evaluate(() => JSON.parse(localStorage.getItem("metalInventory")));
    expect(stored.every((item) => item.paymentMethod === "Wire")).toBe(true);

    await page.selectOption("#bulkFieldVal_paymentMethod", "");
    await page.getByRole("button", { name: /Apply Changes/ }).click();
    await page.click("#bulkConfirmOkBtn");
    await expect(page.locator("#bulkConfirmModal")).toBeHidden();
    stored = await page.evaluate(() => JSON.parse(localStorage.getItem("metalInventory")));
    expect(
      stored.every((item) => !Object.prototype.hasOwnProperty.call(item, "paymentMethod"))
    ).toBe(true);

    await page.evaluate(() => {
      window.inventory[0].paymentMethod = "PayPal";
      localStorage.setItem("metalInventory", JSON.stringify(window.inventory));
      window.duplicateItem(0);
    });
    await expect(page.locator("#itemModal")).toBeVisible();
    await expect(page.locator("#itemPaymentMethod")).toHaveValue("PayPal");
  });

  test("AC-7 — CSV/JSON export and JSON import round-trip paymentMethod", async ({ page }) => {
    await seedData(page, [
      makeItem({ serial: 1, name: "STRK-50 Export", paymentMethod: "Crypto" }),
    ]);
    await gotoApp(page);

    const csv = await page.evaluate(() => window.exportInventoryCSV());
    expect(csv).toContain("Payment Method");
    expect(csv).toContain("Crypto");

    const jsonText = await page.evaluate(() => {
      const captured = [];
      const OriginalBlob = window.Blob;
      window.Blob = function (parts, options) {
        captured.push(parts.join(""));
        return new OriginalBlob(parts, options);
      };
      const originalCreate = URL.createObjectURL;
      const originalClick = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = () => "blob:staktrakr-test";
      HTMLAnchorElement.prototype.click = () => {};
      window.exportJson();
      window.Blob = OriginalBlob;
      URL.createObjectURL = originalCreate;
      HTMLAnchorElement.prototype.click = originalClick;
      return captured[0];
    });
    expect(JSON.parse(jsonText).items[0].paymentMethod).toBe("Crypto");

    await page.evaluate(() => {
      window.importJsonFromText(
        JSON.stringify({
          items: [
            {
              metal: "Silver",
              composition: "Silver",
              name: "STRK-50 Imported",
              qty: 1,
              type: "Coin",
              weight: 1,
              price: 25,
              date: "2026-05-13",
              paymentMethod: "Wire",
              serial: 90,
              uuid: "strk-50-imported",
            },
          ],
        }),
        true
      );
    });
    await page.waitForFunction(() => {
      const stored = JSON.parse(localStorage.getItem("metalInventory") || "[]");
      return stored.length === 1 && stored[0].paymentMethod === "Wire";
    });
  });
});

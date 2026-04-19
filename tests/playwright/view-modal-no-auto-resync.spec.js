import { test, expect } from "@playwright/test";

const NUMISTA_ID = "298883";
const QUOTED_TITLE = '1 Dollar "American Silver Eagle" New Reverse';

const BASE_ITEM = {
  uuid: "stak554-view-modal-item",
  metal: "Silver",
  composition: "Silver",
  name: "STAK-554 View Modal Fixture",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 40,
  marketValue: 0,
  date: "2026-04-18",
  purchaseLocation: "StakTrakr",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2021",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 32,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: NUMISTA_ID,
  serial: 1,
};

const LOOKUP_RESULT = {
  name: QUOTED_TITLE,
  country: "United States",
  denomination: "1 Dollar",
  shape: "Round",
  diameter: 40.6,
  thickness: 2.98,
  composition: "Silver (.999)",
  metal: "Silver",
  orientation: "Coin alignment",
  technique: "Milled",
  tags: ["Bullion", "Eagle"],
};

async function seedInventory(page, items) {
  await page.addInitScript((inventory) => {
    localStorage.setItem("metalInventory", JSON.stringify(inventory));
    localStorage.setItem("itemTags", JSON.stringify({}));

    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") {
          localStorage.setItem("ackVersion", APP_VERSION);
        }
      },
      { once: true }
    );
  }, items);
}

async function stubCatalogLookup(page, lookupResult = LOOKUP_RESULT) {
  await page.addInitScript((result) => {
    const installStub = (api) => {
      if (!api || typeof api !== "object") return;
      api.lookupItem = async () => ({ ...result });
    };

    let currentCatalogApi;

    Object.defineProperty(window, "catalogAPI", {
      configurable: true,
      get() {
        return currentCatalogApi;
      },
      set(value) {
        currentCatalogApi = value;
        installStub(value);
      },
    });

    document.addEventListener(
      "DOMContentLoaded",
      () => {
        installStub(window.catalogAPI);
      },
      { once: true }
    );
  }, lookupResult);
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.showViewModal === "function" &&
      Array.isArray(window.inventory) &&
      window.inventory.length > 0
  );
}

async function openViewModal(page, index = 0) {
  await page.evaluate((inventoryIndex) => window.showViewModal(inventoryIndex), index);
  await expect(page.locator("#viewItemModal")).toBeVisible();
}

async function clearImageCache(page) {
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase("StakTrakrImages");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error("IndexedDB deleteDatabase failed"));
      request.onblocked = () => reject(new Error("IndexedDB deleteDatabase blocked"));
    });
  });
}

test.describe("view-modal-no-auto-resync — STAK-554", () => {
  test("1. item with Numista ID opens without resync picker modal", async ({ page }) => {
    await seedInventory(page, [BASE_ITEM]);
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openViewModal(page);

    await expect(page.locator("#resyncPickerModal")).toHaveCount(0);
  });

  test("2. item with cleared IndexedDB cache still opens without resync picker modal", async ({
    page,
  }) => {
    await seedInventory(page, [BASE_ITEM]);
    await stubCatalogLookup(page);
    await gotoApp(page);
    await clearImageCache(page);
    await openViewModal(page);

    await expect(page.locator("#resyncPickerModal")).toHaveCount(0);
  });

  test("3. item without Numista ID opens cleanly with zero pageerror events", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await seedInventory(page, [{ ...BASE_ITEM, numistaId: "", name: "STAK-554 No Numista" }]);
    await gotoApp(page);
    await openViewModal(page);

    await expect(page.locator("#resyncPickerModal")).toHaveCount(0);
    expect(pageErrors).toEqual([]);

    const showResyncPickerType = await page.evaluate(() => typeof window.showResyncPicker);
    expect(showResyncPickerType).toBe("undefined");
  });

  test("4. quoted item title renders literal quotes without HTML entities", async ({ page }) => {
    await seedInventory(page, [{ ...BASE_ITEM, name: QUOTED_TITLE }]);
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openViewModal(page);

    const title = page.locator("#viewModalTitle");
    await expect(title).toHaveText(QUOTED_TITLE);
    await expect(title).not.toContainText("&quot;");

    const innerHtml = await title.evaluate((node) => node.innerHTML);
    expect(innerHtml).not.toContain("&quot;");
    expect(innerHtml).not.toContain("&amp;quot;");
  });

  test("5. deleted picker symbols are absent while retained field-meta helpers remain", async ({
    page,
  }) => {
    await seedInventory(page, [BASE_ITEM]);
    await gotoApp(page);

    const exportedSymbols = await page.evaluate(() => ({
      showResyncPicker: window.showResyncPicker,
      applyPickerSelections: window.applyPickerSelections,
      FIELD_TIERS: window.FIELD_TIERS,
      getFieldMeta: window.getFieldMeta,
      initFieldMeta: typeof window.initFieldMeta,
      markUserModified: typeof window.markUserModified,
    }));

    expect(exportedSymbols.showResyncPicker).toBeUndefined();
    expect(exportedSymbols.applyPickerSelections).toBeUndefined();
    expect(exportedSymbols.FIELD_TIERS).toBeUndefined();
    expect(exportedSymbols.getFieldMeta).toBeUndefined();
    expect(exportedSymbols.initFieldMeta).toBe("function");
    expect(exportedSymbols.markUserModified).toBe("function");
  });
});

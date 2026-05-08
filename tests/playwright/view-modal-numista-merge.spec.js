import { test, expect } from "@playwright/test";

const BASE_CATALOG_ID = "571841";

const BASE_ITEM = {
  uuid: "strk55-view-modal-numista-merge",
  metal: "Silver",
  composition: "Silver",
  name: "STRK-55 View Modal Fixture",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 40,
  marketValue: 0,
  date: "2026-05-08",
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
  numistaId: BASE_CATALOG_ID,
  serial: 1,
};

const CACHE_RESULT = {
  name: "American Silver Eagle",
  catalogId: BASE_CATALOG_ID,
  country: "United States",
  denomination: "1 Dollar",
  diameter: 40.6,
  thickness: 2.98,
  shape: "Round",
  composition: "Silver",
  orientation: "Coin alignment",
  technique: "Milled",
  kmReferences: [{ catalogue: "KM", number: "274" }],
  mintageByYear: [{ year: "2024", mintage: 1000000, remark: "test cache" }],
  tags: ["Bullion", "Eagle"],
  obverseDesc: "Cache obverse",
  reverseDesc: "Cache reverse",
  edgeDesc: "Cache edge",
};

async function seedInventory(page, items, itemTags = {}) {
  await page.addInitScript(
    ({ inventory, tags }) => {
      localStorage.setItem("metalInventory", JSON.stringify(inventory));
      localStorage.setItem("itemTags", JSON.stringify(tags));
      localStorage.setItem("numistaViewFields", JSON.stringify({}));

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
    { inventory: items, tags: itemTags }
  );
}

async function stubCatalogLookup(page, result = null) {
  await page.addInitScript((lookupResult) => {
    const installStub = (api) => {
      if (!api || typeof api !== "object") return;
      api.lookupItem = async () => (lookupResult ? { ...lookupResult } : null);
      api.searchItems = async () => (lookupResult ? [{ ...lookupResult }] : []);
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
  }, result);
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.showViewModal === "function" &&
      typeof window.editItem === "function" &&
      Array.isArray(window.inventory) &&
      window.inventory.length > 0
  );
  await page.evaluate(async () => {
    if (window.imageCache?.init) await window.imageCache.init();
  });
}

async function cacheMetadata(page, catalogId, result, cachedAt = Date.now()) {
  await page.evaluate(
    async ({ id, metadata, timestamp }) => {
      await window.imageCache.init();
      await window.imageCache.cacheMetadata(id, { ...metadata, catalogId: id });
      const record = await window.imageCache.getMetadata(id);
      await window.imageCache.importMetadataRecord({ ...record, cachedAt: timestamp });
    },
    { id: catalogId, metadata: result, timestamp: cachedAt }
  );
}

async function openViewModal(page, index = 0) {
  await page.evaluate((inventoryIndex) => window.showViewModal(inventoryIndex), index);
  await expect(page.locator("#viewItemModal")).toBeVisible();
  await expect(page.locator(".view-numista-section")).toBeVisible();
}

async function closeViewModal(page) {
  await page.evaluate(() => window.closeViewModal?.());
  await expect(page.locator("#viewItemModal")).toBeHidden();
}

function catalogSection(page) {
  return page.locator(".view-numista-section");
}

function detailItem(page, label) {
  return catalogSection(page).locator(".view-detail-item").filter({ hasText: label }).first();
}

test.describe("view-modal-numista-merge — STRK-55", () => {
  test("AC-1: item numistaData composition wins over cached composition", async ({ page }) => {
    const item = {
      ...BASE_ITEM,
      numistaData: { composition: "Silver (.9999)" },
    };
    await seedInventory(page, [item]);
    await stubCatalogLookup(page);
    await gotoApp(page);
    await cacheMetadata(page, item.numistaId, CACHE_RESULT);

    await openViewModal(page);

    await expect(detailItem(page, "Composition")).toContainText("Silver (.9999)");
    await expect(detailItem(page, "Composition")).not.toContainText(/^Composition\s+Silver$/);
  });

  test("AC-2: obverse, reverse, and edge render as visible rows and image tooltips", async ({
    page,
  }) => {
    const item = {
      ...BASE_ITEM,
      numistaData: {
        obverseDesc: "Liberty walking toward the sunrise",
        reverseDesc: "Heraldic eagle with shield",
        edgeDesc: "Reeded edge",
      },
    };
    await seedInventory(page, [item]);
    await stubCatalogLookup(page);
    await gotoApp(page);

    await openViewModal(page);

    await expect(detailItem(page, "Obverse")).toContainText("Liberty walking");
    await expect(detailItem(page, "Reverse")).toContainText("Heraldic eagle");
    await expect(detailItem(page, "Edge")).toContainText("Reeded edge");

    await expect(page.locator("#viewImageSection .view-image-slot").nth(0)).toHaveAttribute(
      "title",
      /Obverse: Liberty walking/
    );
    await expect(page.locator("#viewImageSection .view-image-slot").nth(1)).toHaveAttribute(
      "title",
      /Reverse: Heraldic eagle/
    );
  });

  test("AC-3: two items sharing one catalogId render their own per-item values", async ({
    page,
  }) => {
    const items = [
      {
        ...BASE_ITEM,
        uuid: "strk55-shared-a",
        name: "STRK-55 Shared A",
        numistaData: { composition: "Silver (.9999)" },
      },
      {
        ...BASE_ITEM,
        uuid: "strk55-shared-b",
        name: "STRK-55 Shared B",
        numistaData: { composition: "Silver proof finish" },
      },
    ];
    await seedInventory(page, items);
    await stubCatalogLookup(page);
    await gotoApp(page);
    await cacheMetadata(page, BASE_CATALOG_ID, CACHE_RESULT);

    await openViewModal(page, 0);
    await expect(detailItem(page, "Composition")).toContainText("Silver (.9999)");
    await closeViewModal(page);

    await openViewModal(page, 1);
    await expect(detailItem(page, "Composition")).toContainText("Silver proof finish");
  });

  test("AC-4: Edit modal save is reflected on next View open without stale cache", async ({
    page,
  }) => {
    const item = {
      ...BASE_ITEM,
      numistaData: { diameter: "39" },
    };
    await seedInventory(page, [item]);
    await stubCatalogLookup(page);
    await gotoApp(page);
    await cacheMetadata(page, BASE_CATALOG_ID, { ...CACHE_RESULT, diameter: 39 });

    await page.evaluate(() => window.editItem(0));
    await expect(page.locator("#itemModal")).toBeVisible();
    await page.locator("#numistaDiameter").fill("40");
    await page.locator("#itemModalSubmit").click();
    await expect(page.locator("#itemModal")).toBeHidden();

    await openViewModal(page);
    await expect(detailItem(page, "Diameter")).toContainText("40 mm");
  });

  test("AC-5/AC-6: item flat fields render, including KM Reference and mintage", async ({
    page,
  }) => {
    const item = {
      ...BASE_ITEM,
      numistaData: {
        country: "Canada",
        denomination: "5 Dollars",
        shape: "Rectangle",
        length: "50",
        width: "30",
        thickness: "3",
        orientation: "Medal alignment",
        technique: "Proof",
        mintage: "25,000",
        rarityIndex: "47",
        kmRef: "KM#273",
        commemorative: true,
        commemorativeDesc: "Anniversary issue",
      },
    };
    await seedInventory(page, [item]);
    await stubCatalogLookup(page);
    await gotoApp(page);
    await cacheMetadata(page, BASE_CATALOG_ID, CACHE_RESULT);

    await openViewModal(page);

    await expect(detailItem(page, "Country")).toContainText("Canada");
    await expect(detailItem(page, "Denomination")).toContainText("5 Dollars");
    await expect(detailItem(page, "Dimensions")).toContainText("50 × 30 × 3 mm");
    await expect(detailItem(page, "Orientation")).toContainText("Medal alignment");
    await expect(detailItem(page, "Technique")).toContainText("Proof");
    await expect(detailItem(page, "KM Reference")).toContainText("KM#273");
    await expect(detailItem(page, "Mintage")).toContainText("25,000");
    await expect(detailItem(page, "Rarity")).toContainText("47");
    await expect(detailItem(page, "Commemorative")).toContainText("Anniversary issue");
  });

  test("AC-6/AC-7: cache-only legacy items still render cached reference shape", async ({
    page,
  }) => {
    await seedInventory(page, [{ ...BASE_ITEM, numistaData: null }]);
    await stubCatalogLookup(page);
    await gotoApp(page);
    await cacheMetadata(page, BASE_CATALOG_ID, CACHE_RESULT);

    await openViewModal(page);

    await expect(detailItem(page, "Composition")).toContainText("Silver");
    await expect(detailItem(page, "References")).toContainText("KM#274");
    await expect(detailItem(page, "Mintage")).toContainText("2024: 1,000,000");
  });

  test("tags-dedupe: Catalog Data no longer duplicates dedicated tag chips", async ({ page }) => {
    const itemTags = { [BASE_ITEM.uuid]: ["Bullion", "Eagle"] };
    await seedInventory(page, [{ ...BASE_ITEM, numistaData: null }], itemTags);
    await stubCatalogLookup(page);
    await gotoApp(page);
    await cacheMetadata(page, BASE_CATALOG_ID, CACHE_RESULT);

    await openViewModal(page);

    await expect(
      catalogSection(page).locator(".view-detail-label", { hasText: "Tags" })
    ).toHaveCount(0);
    await expect(page.locator("#viewTagsSection .tag-chip")).toHaveCount(2);
  });

  test("AC-8: partial item metadata overrides one field while API refresh updates cache", async ({
    page,
  }) => {
    const item = {
      ...BASE_ITEM,
      numistaData: { kmRef: "KM#274" },
    };
    const staleTimestamp = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const refreshedResult = {
      ...CACHE_RESULT,
      composition: "Silver refreshed from API",
      kmReferences: [{ catalogue: "KM", number: "999" }],
    };
    await seedInventory(page, [item]);
    await stubCatalogLookup(page, refreshedResult);
    await gotoApp(page);
    await cacheMetadata(page, BASE_CATALOG_ID, CACHE_RESULT, staleTimestamp);

    await openViewModal(page);

    await expect(detailItem(page, "KM Reference")).toContainText("KM#274");
    await expect(detailItem(page, "Composition")).toContainText("Silver refreshed from API");

    const cached = await page.evaluate(
      (catalogId) => window.imageCache.getMetadata(catalogId),
      BASE_CATALOG_ID
    );
    expect(cached.cachedAt).toBeGreaterThan(staleTimestamp);
    expect(cached.composition).toBe("Silver refreshed from API");
  });

  test("defensive empty stripping: raw empty item values fall back to cache", async ({ page }) => {
    const item = {
      ...BASE_ITEM,
      numistaData: { composition: "", obverseDesc: null },
    };
    await seedInventory(page, [item]);
    await stubCatalogLookup(page);
    await gotoApp(page);
    await cacheMetadata(page, BASE_CATALOG_ID, CACHE_RESULT);

    await openViewModal(page);

    await expect(detailItem(page, "Composition")).toContainText("Silver");
    await expect(detailItem(page, "Obverse")).toContainText("Cache obverse");
  });

  test("toggle-off behavior: settings UI persists obverse/reverse visibility", async ({ page }) => {
    const item = {
      ...BASE_ITEM,
      numistaData: {
        obverseDesc: "Toggle obverse",
        reverseDesc: "Toggle reverse",
      },
    };
    await seedInventory(page, [item]);
    await stubCatalogLookup(page);
    await gotoApp(page);

    await page.evaluate(() => window.openBulkSyncModal("numista"));
    await expect(page.locator("#bulkSyncModal")).toBeVisible();
    await page.locator('#bulkSyncModal .bulk-tab[data-tab="sync-settings"]').click();

    const obverseToggle = page.locator('#bulkSyncModal input[data-nf="obverse"]');
    const reverseToggle = page.locator('#bulkSyncModal input[data-nf="reverse"]');
    await expect(obverseToggle).toBeVisible();
    await expect(reverseToggle).toBeVisible();
    await obverseToggle.uncheck();
    await reverseToggle.uncheck();

    await page.evaluate(() => window.closeBulkSyncModal());
    await openViewModal(page);
    await expect(detailItem(page, "Obverse")).toHaveCount(0);
    await expect(detailItem(page, "Reverse")).toHaveCount(0);
    await closeViewModal(page);

    await page.evaluate(() => window.openBulkSyncModal("numista"));
    await page.locator('#bulkSyncModal .bulk-tab[data-tab="sync-settings"]').click();
    await page.locator('#bulkSyncModal input[data-nf="obverse"]').check();
    await page.locator('#bulkSyncModal input[data-nf="reverse"]').check();
    await page.evaluate(() => window.closeBulkSyncModal());

    await openViewModal(page);
    await expect(detailItem(page, "Obverse")).toContainText("Toggle obverse");
    await expect(detailItem(page, "Reverse")).toContainText("Toggle reverse");
  });

  test("cache-empty item-populated path renders without API metadata", async ({ page }) => {
    const item = {
      ...BASE_ITEM,
      numistaId: "cache-empty-strk-55",
      numistaData: {
        composition: "Silver (.9999)",
        obverseDesc: "Test obverse",
      },
    };
    await seedInventory(page, [item]);
    await stubCatalogLookup(page, null);
    await gotoApp(page);

    await openViewModal(page);

    await expect(detailItem(page, "Composition")).toContainText("Silver (.9999)");
    await expect(detailItem(page, "Obverse")).toContainText("Test obverse");
  });
});

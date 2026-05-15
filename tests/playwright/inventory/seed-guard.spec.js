import { test, expect } from "../helpers/mocks/extended-test.js";

const BASE_ITEM = {
  uuid: "strk13-base-item",
  metal: "Silver",
  composition: "Silver",
  name: "STRK-13 Base Silver Eagle",
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

async function clearAppStorage(page) {
  await page.addInitScript(() => {
    localStorage.clear();
    indexedDB.deleteDatabase("StakTrakrImages");
  });
}

async function suppressWhatsNewPopup(page) {
  await page.addInitScript(() => {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") {
          localStorage.setItem("ackVersion", APP_VERSION);
        }
      },
      { once: true }
    );
  });
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Array.isArray(window.inventory));
  await page.waitForLoadState("networkidle");
}

test.describe("STRK-13 Inventory Seed Guard", () => {
  test.beforeEach(async ({ page }) => {
    await clearAppStorage(page);
  });

  test("1. first-run-seeds: empty localStorage seeds 8 sample items and sets sentinel — REQ-1.4, REQ-1.5", async ({
    page,
  }) => {
    await suppressWhatsNewPopup(page);
    await gotoApp(page);

    const inventoryLength = await page.evaluate(() => window.inventory && window.inventory.length);
    expect(inventoryLength).toBe(8);

    const sentinel = await page.evaluate(() => localStorage.getItem("inventorySeedApplied"));
    expect(sentinel).not.toBeNull();

    const banner = page.locator("#inventoryRecoveryBanner");
    await expect(banner).toHaveCount(0);
  });

  test("2. returning-with-data-no-seed: pre-set inventory with sentinel does not merge sample data — REQ-1.1", async ({
    page,
  }) => {
    await suppressWhatsNewPopup(page);
    await page.addInitScript((item) => {
      localStorage.setItem("metalInventory", JSON.stringify([item]));
      localStorage.setItem("inventorySeedApplied", "2026-04-01T00:00:00.000Z");
    }, BASE_ITEM);

    await gotoApp(page);

    const inventoryLength = await page.evaluate(() => window.inventory && window.inventory.length);
    expect(inventoryLength).toBe(1);

    const firstName = await page.evaluate(() => window.inventory[0] && window.inventory[0].name);
    expect(firstName).toBe(BASE_ITEM.name);

    const sentinel = await page.evaluate(() => localStorage.getItem("inventorySeedApplied"));
    expect(sentinel).toBe("2026-04-01T00:00:00.000Z");
  });

  test("3. damaged-key-shows-banner: missing inventory + present serial shows recovery banner, no seed — REQ-1.2, REQ-2.1", async ({
    page,
  }) => {
    await suppressWhatsNewPopup(page);
    await page.addInitScript(() => {
      localStorage.setItem("inventorySerial", "5");
      localStorage.setItem("cloud_sync_local_modified", "2026-04-20T00:00:00.000Z");
    });

    await gotoApp(page);

    const banner = page.locator("#inventoryRecoveryBanner");
    await expect(banner).toBeVisible();

    const metalInventoryRaw = await page.evaluate(() => localStorage.getItem("metalInventory"));
    expect(metalInventoryRaw).toBeNull();

    const inventoryLength = await page.evaluate(() => window.inventory && window.inventory.length);
    expect(inventoryLength).toBe(0);

    const tableRows = await page.locator("#inventoryTable tbody tr").count();
    expect(tableRows).toBe(0);
  });

  test("4. parse-error-shows-banner: corrupt JSON shows recovery banner, leaves storage untouched, records SyntaxError — REQ-1.3, REQ-2.1, REQ-3.2", async ({
    page,
  }) => {
    await suppressWhatsNewPopup(page);
    await page.addInitScript(() => {
      localStorage.setItem("metalInventory", "{not valid json");
    });

    await gotoApp(page);

    const banner = page.locator("#inventoryRecoveryBanner");
    await expect(banner).toBeVisible();

    const metalInventoryRaw = await page.evaluate(() => localStorage.getItem("metalInventory"));
    expect(metalInventoryRaw).toBe("{not valid json");

    const diagnosticsRaw = await page.evaluate(() =>
      localStorage.getItem("staktrakr.bootDiagnostics")
    );
    expect(diagnosticsRaw).not.toBeNull();
    const diagnostics = JSON.parse(diagnosticsRaw);
    expect(Array.isArray(diagnostics)).toBe(true);
    const hasSyntaxError = diagnostics.some((entry) => entry && entry.errorName === "SyntaxError");
    expect(hasSyntaxError).toBe(true);
  });

  test("5. migration-sets-sentinel: returning user without sentinel gets sentinel set without seeding — REQ-4.1", async ({
    page,
  }) => {
    await suppressWhatsNewPopup(page);
    await page.addInitScript((item) => {
      localStorage.setItem("metalInventory", JSON.stringify([item]));
    }, BASE_ITEM);

    await gotoApp(page);

    const inventoryLength = await page.evaluate(() => window.inventory && window.inventory.length);
    expect(inventoryLength).toBe(1);

    const firstName = await page.evaluate(() => window.inventory[0] && window.inventory[0].name);
    expect(firstName).toBe(BASE_ITEM.name);

    const sentinel = await page.evaluate(() => localStorage.getItem("inventorySeedApplied"));
    expect(sentinel).not.toBeNull();
  });

  test("6. compressed-inventory-loads: large CMP1-prefixed inventory must NOT be misclassified as parse-error — REQ-1.1, regression for Codex finding", async ({
    page,
  }) => {
    // Pre-seed a CMP1:-prefixed metalInventory value to exercise the
    // compression-wrapper code path in classifyBootState. The current
    // LZString implementation in js/utils.js is a no-op (compressToUTF16
    // returns input unchanged), so the on-disk shape for large payloads is
    // simply "CMP1:" + JSON_STRING. Raw JSON.parse on that prefix throws
    // SyntaxError, which without the decompression-aware classifier would
    // misclassify a real returning user as parse-error.
    await suppressWhatsNewPopup(page);
    await page.addInitScript((item) => {
      const items = [];
      for (let i = 0; i < 60; i++) {
        items.push(Object.assign({}, item, { uuid: `cmp-test-${i}`, serial: i + 1 }));
      }
      const json = JSON.stringify(items);
      // Sanity: confirm the fixture is large enough to actually trip the
      // production compression threshold (4096 chars).
      if (json.length < 4096) {
        throw new Error("test fixture too small to trigger compression wrapper");
      }
      localStorage.setItem("metalInventory", "CMP1:" + json);
      localStorage.setItem("inventorySerial", String(items.length));
      localStorage.setItem("inventorySeedApplied", "2026-04-01T00:00:00.000Z");
    }, BASE_ITEM);

    await gotoApp(page);

    // Recovery banner MUST NOT be visible — this is the regression we're guarding.
    const banner = page.locator("#inventoryRecoveryBanner");
    await expect(banner).toHaveCount(0);

    // Inventory loaded from the CMP1:-prefixed payload, not seeded over.
    const inventoryLength = await page.evaluate(() => window.inventory && window.inventory.length);
    expect(inventoryLength).toBe(60);
  });
});

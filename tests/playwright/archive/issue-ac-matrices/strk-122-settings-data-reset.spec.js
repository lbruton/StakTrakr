import { test, expect } from "../../helpers/mocks/extended-test.js";

/**
 * STAK-442 — Storage tab danger buttons to Inventory
 *
 * Regression tests verifying danger buttons (#removeInventoryDataBtn and
 * #boatingAccidentBtn) are on the Inventory tab, not the Storage tab.
 */

async function openSettingsModal(page) {
  await page.waitForFunction(() => typeof window.showSettingsModal === "function");
  await page.evaluate(() => window.showSettingsModal());
  await expect(page.locator("#settingsModal")).toBeVisible();
}

async function switchSettingsSection(page, section) {
  await page.evaluate((s) => window.switchSettingsSection(s), section);
  await expect(page.locator(`#settingsPanel_${section}`)).toBeVisible();
}

test.describe("STAK-442 — Danger buttons location", () => {
  test.beforeEach(async ({ page }) => {
    // Seed minimal inventory so the app loads cleanly
    await page.addInitScript(() => {
      localStorage.setItem(
        "metalInventory",
        JSON.stringify([
          {
            uuid: "stak442-item-1",
            metal: "Silver",
            composition: "Silver",
            name: "STAK442 Test Item",
            qty: 1,
            type: "Coin",
            weight: 1,
            price: 30,
            marketValue: 0,
            date: "2025-01-01",
            purchaseLocation: "staktrakr.com",
            storageLocation: "",
            serialNumber: "",
            notes: "",
            year: "2025",
            grade: "",
            gradingAuthority: "",
            certNumber: "",
            pcgsNumber: "",
            pcgsVerified: false,
            spotPriceAtPurchase: 28,
            premiumPerOz: 0,
            totalPremium: 0,
            purity: 0.999,
            numistaId: "",
            serial: 1,
          },
        ])
      );
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
    });

    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.showSettingsModal === "function" &&
        typeof window.switchSettingsSection === "function"
    );
  });

  // ========================================================================
  // Test 1 — Danger buttons are present on Inventory (system) tab
  // ========================================================================
  test("1. Inventory tab has #removeInventoryDataBtn and #boatingAccidentBtn", async ({ page }) => {
    await openSettingsModal(page);
    await switchSettingsSection(page, "system");

    const panel = page.locator("#settingsPanel_system");
    await expect(panel.locator("#removeInventoryDataBtn")).toBeVisible();
    await expect(panel.locator("#boatingAccidentBtn")).toBeVisible();
  });

  // ========================================================================
  // Test 2 — Danger buttons are NOT present on Storage tab
  // ========================================================================
  test("2. Storage tab does NOT have #removeInventoryDataBtn or #boatingAccidentBtn", async ({
    page,
  }) => {
    await openSettingsModal(page);
    await switchSettingsSection(page, "storage");

    const panel = page.locator("#settingsPanel_storage");
    await expect(panel.locator("#removeInventoryDataBtn")).toHaveCount(0);
    await expect(panel.locator("#boatingAccidentBtn")).toHaveCount(0);
  });
});

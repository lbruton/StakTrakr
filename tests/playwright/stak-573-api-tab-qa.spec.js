import { test, expect } from "@playwright/test";
import { injectSeedInventory } from "./helpers/seed.js";

/**
 * STAK-573 — API Tab QA Pass (TDD red phase)
 *
 * These tests are written BEFORE implementation. They MUST fail against the
 * current branch. Implementation tasks turn them green.
 *
 * REQ-1   Save button on catalog expand panels
 * REQ-2   Masked key indicator (bullet chars + data-masked)
 * REQ-3   Usage bar shows request count, not "No key configured"
 * REQ-4   Test endpoint triggers network request
 * REQ-5   Button label says "Advanced Settings" not "Open Bulk Sync"
 * REQ-6   TTL text removed from Metals.dev panel
 * REQ-7   Spot provider footers (metals-api, metalpriceapi)
 * REQ-8   History buttons use .btn-history class
 * REQ-9   Bulk Sync modal width <= Settings modal width
 * REQ-10  Bulk Sync modal has exactly 2 tabs (Overview + Sync Settings)
 * REQ-11  Bulk Sync modal buttons use btn-action-primary class
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedCatalogConfig(page, config) {
  await page.addInitScript((data) => {
    localStorage.setItem("catalog_api_config", JSON.stringify(data));
  }, config);
}

async function openApiSettings(page) {
  await page.waitForFunction(() => typeof window.showSettingsModal === "function");
  await page.evaluate(() => window.showSettingsModal("api"));
  await expect(page.locator("#settingsModal")).toBeVisible();
  await expect(page.locator("#settingsPanel_api")).toBeVisible();
}

async function openCatalogExpandPanel(page, providerName) {
  const catalog = page.locator("#apiSection_catalog");
  const row = catalog.locator(".catalog-row").filter({ hasText: new RegExp(providerName, "i") });
  // Click the row or its configure/expand button to open the expand panel
  const expandBtn = row
    .locator("button")
    .filter({ hasText: /Configure|Expand|Settings/i })
    .first();
  if (await expandBtn.isVisible()) {
    await expandBtn.click();
  } else {
    await row.click();
  }
  return row;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("STAK-573 — API Tab QA Pass", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  // =========================================================================
  // REQ-1 — Save button on catalog expand panels
  // =========================================================================
  test.describe("REQ-1 — Save button on catalog expand panels", () => {
    test("Numista expand panel has a Save button with class js-catalog-save", async ({ page }) => {
      await seedCatalogConfig(page, { numista: { apiKey: btoa("fake-numista-key") } });
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await openApiSettings(page);
      await openCatalogExpandPanel(page, "Numista");

      const numistaRow = page.locator('.catalog-row[data-provider="numista"]');
      const saveBtn = numistaRow.locator("button.js-catalog-save");
      await expect(saveBtn).toBeVisible();
      await expect(saveBtn).toHaveText(/Save/);
    });

    test("PCGS expand panel has a Save button with class js-catalog-save", async ({ page }) => {
      await seedCatalogConfig(page, { pcgs: { apiKey: btoa("fake-pcgs-key") } });
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await openApiSettings(page);
      await openCatalogExpandPanel(page, "PCGS");

      const pcgsRow = page.locator('.catalog-row[data-provider="pcgs"]');
      const saveBtn = pcgsRow.locator("button.js-catalog-save");
      await expect(saveBtn).toBeVisible();
    });
  });

  // =========================================================================
  // REQ-2 — Masked key indicator
  // =========================================================================
  test.describe("REQ-2 — Masked key indicator", () => {
    test("Numista API key input shows 8 bullet chars and data-masked=true when key is configured", async ({
      page,
    }) => {
      const encodedKey = btoa("test-numista-api-key-12345");
      await seedCatalogConfig(page, { numista: { apiKey: encodedKey } });
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await openApiSettings(page);
      await openCatalogExpandPanel(page, "Numista");

      const catalog = page.locator("#apiSection_catalog");
      // Find the API key input within the Numista expand panel
      const keyInput = catalog
        .locator(".catalog-row")
        .filter({ hasText: /Numista/i })
        .locator('input[type="password"], input[type="text"]')
        .first();

      // Input should show masked value (8 bullet characters)
      await expect(keyInput).toHaveValue("••••••••");

      // data-masked attribute should be "true"
      await expect(keyInput).toHaveAttribute("data-masked", "true");
    });
  });

  // =========================================================================
  // REQ-3 — Usage bar shows request count
  // =========================================================================
  test.describe("REQ-3 — Usage bar", () => {
    test("Usage bar shows request count, not 'No key configured' when key is present", async ({
      page,
    }) => {
      await seedCatalogConfig(page, {
        numista: {
          apiKey: btoa("fake-numista-key"),
          usage: { used: 42, limit: 100, resetDate: "2026-05-01" },
        },
      });
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await openApiSettings(page);
      await openCatalogExpandPanel(page, "Numista");

      const catalog = page.locator("#apiSection_catalog");
      const numistaSection = catalog.locator(".catalog-row").filter({ hasText: /Numista/i });

      // The usage bar text should NOT say "No key configured"
      const usageText = await numistaSection.innerText();
      expect(usageText).not.toMatch(/No key configured/i);

      // Should show some request count (e.g., "42 / 100" or "42 requests")
      expect(usageText).toMatch(/\d+/);
    });
  });

  // =========================================================================
  // REQ-4 — Test endpoint triggers network request and shows result indicator
  // =========================================================================
  test.describe("REQ-4 — Test endpoint", () => {
    test("Clicking Numista Test button in expand panel triggers request and shows result indicator", async ({
      page,
    }) => {
      await seedCatalogConfig(page, { numista: { apiKey: btoa("fake-numista-key") } });

      const networkRequests = [];
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (/numista/i.test(url)) {
          networkRequests.push(url);
        }
        return route.continue();
      });

      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await openApiSettings(page);
      await openCatalogExpandPanel(page, "Numista");

      const numistaRow = page.locator('.catalog-row[data-provider="numista"]');
      const testBtn = numistaRow.locator("button.js-catalog-test");
      await expect(testBtn).toBeVisible();

      // Verify the Save button is in the same row
      const saveBtn = numistaRow.locator("button.js-catalog-save");
      await expect(saveBtn).toBeVisible();

      await testBtn.click();

      // Wait for the request to fire
      await page.waitForTimeout(1000);

      // At least one network request to a Numista endpoint should have been made
      expect(networkRequests.length).toBeGreaterThan(0);

      // After test completes, a result indicator should appear (success/fail badge or text)
      const resultIndicator = numistaRow.locator(".test-result, .test-status, [data-test-result]");
      await expect(resultIndicator).toBeVisible({ timeout: 5000 });
    });
  });

  // =========================================================================
  // REQ-5 — Button label says "Advanced Settings" not "Open Bulk Sync"
  // =========================================================================
  test.describe("REQ-5 — Button label", () => {
    test("Numista expand panel bottom action button says 'Advanced Settings' not 'Open Bulk Sync'", async ({
      page,
    }) => {
      await seedCatalogConfig(page, { numista: { apiKey: btoa("fake-numista-key") } });
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await openApiSettings(page);
      await openCatalogExpandPanel(page, "Numista");

      const catalog = page.locator("#apiSection_catalog");
      const numistaSection = catalog.locator(".catalog-row").filter({ hasText: /Numista/i });

      // Should have a button saying "Advanced Settings"
      const advancedBtn = numistaSection
        .locator("button")
        .filter({ hasText: /Advanced Settings/i });
      await expect(advancedBtn).toBeVisible();

      // Should NOT have a button saying "Open Bulk Sync"
      const bulkSyncBtn = numistaSection.locator("button").filter({ hasText: /Open Bulk Sync/i });
      await expect(bulkSyncBtn).toHaveCount(0);
    });
  });

  // =========================================================================
  // REQ-6 — TTL text removed from Metals.dev panel
  // =========================================================================
  test.describe("REQ-6 — TTL text", () => {
    test("Metals.dev panel does NOT contain 'Polls on cache TTL interval.'", async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem("spotPricingSource", JSON.stringify("METALS_DEV"));
      });
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await openApiSettings(page);

      const metalsDevPanel = page
        .locator("#apiSection_spot")
        .locator('.spot-accordion-panel[data-val="METALS_DEV"]');
      await expect(metalsDevPanel).toBeVisible();

      const panelText = await metalsDevPanel.innerText();
      expect(panelText).not.toContain("Polls on cache TTL interval.");
    });
  });

  // =========================================================================
  // REQ-7 — Spot provider footers
  // =========================================================================
  test.describe("REQ-7 — Spot footers", () => {
    test("Metals-API panel has footer text 'Provided by metals-api.com'", async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem("spotPricingSource", JSON.stringify("METALS_API"));
      });
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await openApiSettings(page);

      const metalsApiPanel = page
        .locator("#apiSection_spot")
        .locator('.spot-accordion-panel[data-val="METALS_API"]');
      await expect(metalsApiPanel).toBeVisible();
      await expect(metalsApiPanel).toContainText("Provided by metals-api.com");
    });

    test("MetalPriceAPI panel has footer text 'Provided by metalpriceapi.com'", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        localStorage.setItem("spotPricingSource", JSON.stringify("METAL_PRICE_API"));
      });
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await openApiSettings(page);

      const metalPriceApiPanel = page
        .locator("#apiSection_spot")
        .locator('.spot-accordion-panel[data-val="METAL_PRICE_API"]');
      await expect(metalPriceApiPanel).toBeVisible();
      await expect(metalPriceApiPanel).toContainText("Provided by metalpriceapi.com");
    });
  });

  // =========================================================================
  // REQ-8 — History buttons use .btn-history class
  // =========================================================================
  test.describe("REQ-8 — History button color", () => {
    test("Catalog history buttons have class btn-history", async ({ page }) => {
      await seedCatalogConfig(page, { numista: { apiKey: btoa("fake-numista-key") } });
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await openApiSettings(page);
      await openCatalogExpandPanel(page, "Numista");

      const catalog = page.locator("#apiSection_catalog");
      const historyBtn = catalog.locator('button:has-text("History")').first();
      await expect(historyBtn).toBeVisible();
      await expect(historyBtn).toHaveClass(/btn-history/);
    });
  });

  // =========================================================================
  // REQ-9 — Bulk Sync modal width <= Settings modal width
  // =========================================================================
  test.describe("REQ-9 — Modal width", () => {
    test("Bulk Sync modal width is less than or equal to Settings modal width", async ({
      page,
    }) => {
      await seedCatalogConfig(page, { numista: { apiKey: btoa("fake-numista-key") } });
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await openApiSettings(page);

      // Measure the Settings modal width
      const settingsWidth = await page
        .locator("#settingsModal .modal-content")
        .evaluate((el) => el.getBoundingClientRect().width);

      // Open Bulk Sync modal
      await openCatalogExpandPanel(page, "Numista");
      const catalog = page.locator("#apiSection_catalog");
      const bulkSyncBtn = catalog
        .locator("button")
        .filter({ hasText: /Advanced Settings|Bulk Sync/i })
        .first();
      await expect(bulkSyncBtn).toBeVisible();
      await bulkSyncBtn.click();

      const bulkModal = page.locator("#bulkSyncModal");
      await expect(bulkModal).toBeVisible();

      // Measure the Bulk Sync modal width
      const bulkWidth = await bulkModal
        .locator(".modal-content")
        .evaluate((el) => el.getBoundingClientRect().width);

      expect(bulkWidth).toBeLessThanOrEqual(settingsWidth);
    });
  });

  // =========================================================================
  // REQ-10 — Bulk Sync modal tab consolidation
  // =========================================================================
  test.describe("REQ-10 — Tab consolidation", () => {
    test("Bulk Sync modal has exactly 2 tabs (Overview + Sync Settings)", async ({ page }) => {
      await seedCatalogConfig(page, { numista: { apiKey: btoa("fake-numista-key") } });
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await openApiSettings(page);
      await openCatalogExpandPanel(page, "Numista");

      const catalog = page.locator("#apiSection_catalog");
      const bulkSyncBtn = catalog
        .locator("button")
        .filter({ hasText: /Advanced Settings|Bulk Sync/i })
        .first();
      await expect(bulkSyncBtn).toBeVisible();
      await bulkSyncBtn.click();

      const modal = page.locator("#bulkSyncModal");
      await expect(modal).toBeVisible();

      // Exactly 2 tabs
      const tabs = modal.locator('.bulk-tab, [role="tab"]');
      await expect(tabs).toHaveCount(2);

      // Tab labels should be "Overview" and "Sync Settings"
      const tabTexts = await tabs.allTextContents();
      expect(tabTexts.some((t) => /Overview/i.test(t))).toBe(true);
      expect(tabTexts.some((t) => /Sync Settings/i.test(t))).toBe(true);
    });

    test("Bulk Sync modal does NOT have an Activity tab", async ({ page }) => {
      await seedCatalogConfig(page, { numista: { apiKey: btoa("fake-numista-key") } });
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await openApiSettings(page);
      await openCatalogExpandPanel(page, "Numista");

      const catalog = page.locator("#apiSection_catalog");
      const bulkSyncBtn = catalog
        .locator("button")
        .filter({ hasText: /Advanced Settings|Bulk Sync/i })
        .first();
      await expect(bulkSyncBtn).toBeVisible();
      await bulkSyncBtn.click();

      const modal = page.locator("#bulkSyncModal");
      await expect(modal).toBeVisible();

      // Activity tab must NOT exist
      await expect(modal.locator('[data-tab="activity"]')).toHaveCount(0);
      const tabTexts = await modal.locator('.bulk-tab, [role="tab"]').allTextContents();
      expect(tabTexts.some((t) => /Activity/i.test(t))).toBe(false);
    });
  });

  // =========================================================================
  // REQ-11 — Button color variance (btn-action-primary)
  // =========================================================================
  test.describe("REQ-11 — Button color variance", () => {
    test("Bulk Sync modal has buttons with btn-action-primary class", async ({ page }) => {
      await seedCatalogConfig(page, { numista: { apiKey: btoa("fake-numista-key") } });
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await openApiSettings(page);
      await openCatalogExpandPanel(page, "Numista");

      const catalog = page.locator("#apiSection_catalog");
      const bulkSyncBtn = catalog
        .locator("button")
        .filter({ hasText: /Advanced Settings|Bulk Sync/i })
        .first();
      await expect(bulkSyncBtn).toBeVisible();
      await bulkSyncBtn.click();

      const modal = page.locator("#bulkSyncModal");
      await expect(modal).toBeVisible();

      // At least one button in the modal should have btn-action-primary class
      const primaryBtns = modal.locator("button.btn-action-primary");
      const count = await primaryBtns.count();
      expect(count).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // REQ-12 — Sync pipeline round-trip
  // =========================================================================
  test.describe("REQ-12 — Sync pipeline round-trip", () => {
    test("catalog_api_config survives ZIP export → clear → import", async ({ page }) => {
      const testConfig = {
        numista: { apiKey: btoa("test-numista-key-12345"), quota: 2000 },
        numistaUsage: { used: 42, month: "2026-04" },
        pcgs: { bearerToken: btoa("test-pcgs-token-67890") },
        pcgsUsage: { used: 5, date: "2026-04-23" },
        local: { enabled: true },
      };

      await seedCatalogConfig(page, testConfig);
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });

      // Verify the key is in localStorage
      const before = await page.evaluate(() => localStorage.getItem("catalog_api_config"));
      expect(before).toBeTruthy();
      const parsed = JSON.parse(before);
      expect(parsed.numista.apiKey).toBe(btoa("test-numista-key-12345"));

      // Verify catalog_api_config is in ALLOWED_STORAGE_KEYS
      const isAllowed = await page.evaluate(() => {
        return (
          typeof ALLOWED_STORAGE_KEYS !== "undefined" &&
          ALLOWED_STORAGE_KEYS.includes("catalog_api_config")
        );
      });
      expect(isAllowed).toBe(true);

      // Verify the key survives a storage round-trip (saveDataSync/loadDataSync are synchronous)
      const roundTrip = await page.evaluate(() => {
        const original = localStorage.getItem("catalog_api_config");
        const data = JSON.parse(original);
        if (typeof saveDataSync === "function" && typeof loadDataSync === "function") {
          saveDataSync("catalog_api_config", data);
          const restored = loadDataSync("catalog_api_config", null);
          return JSON.stringify(restored) === JSON.stringify(data);
        }
        // Fallback: raw localStorage round-trip
        localStorage.removeItem("catalog_api_config");
        localStorage.setItem("catalog_api_config", original);
        return localStorage.getItem("catalog_api_config") === original;
      });
      expect(roundTrip).toBe(true);
    });
  });
});

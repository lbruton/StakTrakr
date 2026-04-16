import { test, expect } from "@playwright/test";
import { injectSeedInventory } from "../helpers/seed.js";

/**
 * Playwright regression spec for STAK-545 — Market button behavior split.
 *
 * All tests GREEN — production changes ship in the same PR as this spec.
 *
 * Covers:
 *   4.1 — header Market button does NOT open the Settings modal
 *   4.2 — header Market button calls syncRetailPrices (market data refresh)
 *   4.3 — Market block gear control opens Settings on the Market tab
 *   4.4 — Vault header button click opens Settings on the System tab (regression guard)
 *   4.5 — other settings entry points still open their expected tabs (regression guard)
 */

test.describe("03-settings/04-market-controls — STAK-545 header Market button & gear control", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    // Wait for showSettingsModal to exist AND for the 200ms delayed event-listener
    // setup in init.js (Phase 14) to have completed before interacting with buttons.
    await page.waitForFunction(() => typeof window.showSettingsModal === "function");
    await page.waitForTimeout(300);
  });

  // ─── NEW BEHAVIOR (expected FAIL against current implementation) ─────────

  test("4.1 — clicking header Market button does NOT open the Settings modal", async ({ page }) => {
    const settingsModal = page.locator("#settingsModal");

    // Confirm modal is not already open
    await expect(settingsModal).not.toBeVisible();

    // Click the header Market button
    const headerMarketBtn = page.locator("#headerMarketBtn");
    await expect(headerMarketBtn).toBeVisible();
    await headerMarketBtn.click();

    // After STAK-545: modal must remain hidden
    await expect(settingsModal).not.toBeVisible();
  });

  test("4.2 — clicking header Market button calls syncRetailPrices", async ({ page }) => {
    // Install a spy on window.syncRetailPrices before clicking
    await page.evaluate(() => {
      window._stak545SyncCalled = false;
      if (typeof window.syncRetailPrices === "function") {
        const orig = window.syncRetailPrices;
        window.syncRetailPrices = async () => {
          window._stak545SyncCalled = true;
          // Do not invoke the real fetch — test environment has no API
        };
        window._stak545OrigSyncRetailPrices = orig;
      }
    });

    const headerMarketBtn = page.locator("#headerMarketBtn");
    await expect(headerMarketBtn).toBeVisible();
    await headerMarketBtn.click();

    const called = await page.evaluate(() => window._stak545SyncCalled);
    expect(called).toBe(true);
  });

  test("4.3 — clicking Market block gear control opens Settings on the Market tab", async ({
    page,
  }) => {
    // This element is added in Task 3 — does not exist yet.
    // The test fails because #marketSettingsBtn is absent.
    const gearBtn = page.locator("#marketSettingsBtn");
    await expect(gearBtn).toBeVisible();
    await gearBtn.click();

    const settingsModal = page.locator("#settingsModal");
    await expect(settingsModal).toBeVisible();

    const marketPanel = page.locator("#settingsPanel_market");
    await expect(marketPanel).toBeVisible();
  });

  // ─── EXISTING BEHAVIOR (expected PASS — regression guard) ────────────────

  test("4.4 — Vault header button click opens Settings on the System tab", async ({ page }) => {
    // #headerVaultBtn is visible by default (null=show in constants.js)
    const vaultBtn = page.locator("#headerVaultBtn");
    await expect(vaultBtn).toBeVisible();
    await vaultBtn.click();

    const settingsModal = page.locator("#settingsModal");
    await expect(settingsModal).toBeVisible();

    const systemPanel = page.locator("#settingsPanel_system");
    await expect(systemPanel).toBeVisible();
  });

  test("4.5 — other settings entry points still open their expected tabs", async ({ page }) => {
    // LOG / changelog tab
    await page.evaluate(() => {
      if (typeof window.showSettingsModal === "function") {
        window.showSettingsModal("changelog");
      }
    });

    const settingsModal = page.locator("#settingsModal");
    await expect(settingsModal).toBeVisible();

    const changelogPanel = page.locator("#settingsPanel_changelog");
    await expect(changelogPanel).toBeVisible();

    // Close and reopen on Market tab via the programmatic path (not the header button)
    await page.evaluate(() => {
      if (typeof window.hideSettingsModal === "function") window.hideSettingsModal();
    });

    await page.evaluate(() => {
      if (typeof window.showSettingsModal === "function") {
        window.showSettingsModal("market");
      }
    });

    await expect(settingsModal).toBeVisible();

    const marketPanel = page.locator("#settingsPanel_market");
    await expect(marketPanel).toBeVisible();
  });
});

import { test, expect } from "../../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../../helpers/seed.js";

/**
 * Playwright regression spec for STAK-545 — Market button behavior split.
 *
 * All tests GREEN — production changes ship in the same PR as this spec.
 *
 * Covers:
 *   4.1/4.2 — header Market button retired (STRK-290); the market pull moved to
 *             #marketRefreshBtn in the Market block
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

  // 4.1 and 4.2 REWRITTEN for STRK-290, not deleted — this is an acceptance
  // record, so it should show the behaviour was retired deliberately rather than
  // quietly vanishing from the matrix.
  //
  // Both originals drove #headerMarketBtn: 4.1 asserted it refreshed instead of
  // opening Settings, 4.2 spied on window.syncRetailPrices to prove the click
  // reached the retail pipeline. STAK-545's split is now moot because the button
  // is gone (STRK-290) — the market pull lives on #marketRefreshBtn inside the
  // Market block, next to the table it refreshes.
  //
  // Note the spy in the original 4.2 worked only because the header called
  // `window.syncRetailPrices`. The replacement control calls the lexical
  // `syncRetailPrices` binding directly, so a window-level spy would no longer
  // intercept it; the live coverage in core/retail-market.spec.js observes the
  // sync's providers.json fetch instead. Both names resolve to one object — a
  // const in js/retail.js that is never reassigned, plus its window export.
  test("4.1/4.2 — the header Market button is retired; the market pull lives in the Market block", async ({
    page,
  }) => {
    await expect(page.locator("#headerMarketBtn")).toHaveCount(0);
    await expect(page.locator("#headerMarketDot")).toHaveCount(0);

    // The replacement affordance, and its freshness dot, render with the block.
    await expect(page.locator("#marketRefreshBtn")).toHaveCount(1);
    await expect(page.locator("#marketFreshnessDot")).toHaveCount(1);

    // Retiring the button must not have taken the Settings route with it: the
    // gear control in the same block still opens Settings › Market (4.3 below).
    await expect(page.locator("#settingsModal")).not.toBeVisible();
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

  // SUPERSEDED by STRK-285 (2026-07-26). The original AC asserted that
  // #headerVaultBtn opened Settings on the System tab. That button was
  // deliberately retired — it never performed an action, it was one of two
  // identical showSettingsModal("system") shortcuts. The AC is rewritten rather
  // than deleted so the archive records that this behaviour was removed on
  // purpose, not silently lost. Live coverage: core/header-retirement.spec.js.
  test("4.4 — Vault header button retired; Settings System tab still reachable", async ({
    page,
  }) => {
    await expect(page.locator("#headerVaultBtn")).toHaveCount(0);

    await page.evaluate(() => window.showSettingsModal("system"));
    await expect(page.locator("#settingsModal")).toBeVisible();
    await expect(page.locator("#settingsPanel_system")).toBeVisible();
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

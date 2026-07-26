import { test, expect } from "../../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../../helpers/seed.js";

/**
 * STRK-89 — Add gold-api.com as first-class spot price provider (green phase)
 *
 * Acceptance / regression tests for the STRK-89 implementation shipped in
 * v3.34.76. All tests should pass against the current branch.
 *
 * Test list (maps to requirements.md acceptance criteria):
 *   1. REQ-6.1/6.2  Gold API pill exists at position 4 in pill group (7 total)
 *   2. REQ-3.2      Clicking Gold API pill shows GOLD_API panel, hides others
 *   3. REQ-3.3      Gold API sub-card structure (header, badge, details, checkboxes, footer)
 *   4. REQ-2.4      Optional key toggle — details/summary collapsed by default
 *   5. REQ-3.2      Provider persistence — select Gold API, reload, still selected
 *   6. REQ-3.2      Switching away and back — clean state
 */

// ---------------------------------------------------------------------------
// Helpers (reused from stak-443-api-tab.spec.js pattern)
// ---------------------------------------------------------------------------

async function seedApiState(page, opts = {}) {
  await page.addInitScript((data) => {
    if (data.spotPricingSource !== undefined) {
      localStorage.setItem("spotPricingSource", JSON.stringify(data.spotPricingSource));
    }
    if (data.metalApiConfig !== undefined) {
      localStorage.setItem("metalApiConfig", JSON.stringify(data.metalApiConfig));
    }
  }, opts);
}

async function openApiSettings(page) {
  await page.waitForFunction(() => typeof window.showSettingsModal === "function");
  await page.evaluate(() => window.showSettingsModal("api"));
  await expect(page.locator("#settingsModal")).toBeVisible();
  await expect(page.locator("#settingsPanel_api")).toBeVisible();
}

async function readSpotPricingSource(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("spotPricingSource");
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  });
}

async function confirmSpotProviderSwitch(page, label) {
  const dialog = page.locator("#appDialogModal");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(label);
  await dialog.locator("#appDialogOk").click();
  await expect(dialog).toBeHidden();
}

async function wrapSpotSyncForHeaderAssertions(page) {
  await page.evaluate(() => {
    window.__headerSpotSyncCalls = [];
    const original = window.syncSpotPricesFromApi;
    window.syncSpotPricesFromApi = async (...args) => {
      window.__headerSpotSyncCalls.push(args);
      return original(...args);
    };
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("STRK-89 — Gold API provider", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  // =========================================================================
  // 1. REQ-6.1/6.2 — Gold API pill exists at position 4 (5th of 7 pills)
  // =========================================================================
  test("1. Gold API pill exists at position 4 in the spot source pill group (7 total pills)", async ({
    page,
  }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const spotSection = page.locator("#apiSection_spot");
    const pillGroup = spotSection.locator('.gb-source-group[role="radiogroup"]');
    await expect(pillGroup).toHaveCount(1);

    // With GOLD_API added, there should be 7 pills total
    const pills = pillGroup.locator(".gb-source-btn");
    await expect(pills).toHaveCount(7);

    // Gold API pill at index 4 (0-based) — after MetalPriceAPI, before Custom
    const goldApiPill = pills.nth(4);
    await expect(goldApiPill).toHaveAttribute("data-val", "GOLD_API");
    await expect(goldApiPill).toContainText("Gold API");
  });

  // =========================================================================
  // 2. REQ-3.2 — Clicking Gold API pill shows GOLD_API panel, hides others
  // =========================================================================
  test("2. Clicking Gold API pill shows GOLD_API panel and hides all other panels", async ({
    page,
  }) => {
    // Start on a different provider so the click triggers a real switch
    await seedApiState(page, { spotPricingSource: "STAKTRAKR" });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const spotSection = page.locator("#apiSection_spot");
    const pill = spotSection.locator('.gb-source-btn[data-val="GOLD_API"]');
    await expect(pill).toHaveCount(1);
    await pill.click();
    await confirmSpotProviderSwitch(page, "Gold API");

    // Pill reflects active state
    await expect(pill).toHaveClass(/active/);
    await expect(pill).toHaveAttribute("aria-checked", "true");

    // GOLD_API panel is visible
    const activePanel = spotSection.locator('.spot-accordion-panel[data-val="GOLD_API"]');
    await expect(activePanel).toBeVisible();

    // All other panels are hidden (6 others now: STAKTRAKR, METALS_DEV, METALS_API, METAL_PRICE_API, CUSTOM, MANUAL)
    const otherPanels = spotSection.locator('.spot-accordion-panel:not([data-val="GOLD_API"])');
    const otherCount = await otherPanels.count();
    expect(otherCount).toBe(6);
    for (let i = 0; i < otherCount; i++) {
      await expect(otherPanels.nth(i)).toBeHidden();
    }
  });

  // =========================================================================
  // 3. REQ-3.3 — Gold API sub-card structure
  // =========================================================================
  test("3. Gold API sub-card contains header with badge, optional key details, metal checkboxes, auto-refresh, and footer", async ({
    page,
  }) => {
    await seedApiState(page, { spotPricingSource: "GOLD_API" });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const panel = page
      .locator("#apiSection_spot")
      .locator('.spot-accordion-panel[data-val="GOLD_API"]');
    await expect(panel).toBeVisible();

    // Header with "Free · Optional key" badge
    await expect(panel).toContainText("Free · Optional key");

    // Collapsible details element with "Premium API Key (optional)" summary
    const details = panel.locator("details.optional-key-details");
    await expect(details).toHaveCount(1);
    const summary = details.locator("summary");
    await expect(summary).toContainText("Premium API Key (optional)");

    // Details should be collapsed by default (no 'open' attribute)
    const isOpen = await details.evaluate((el) => el.hasAttribute("open"));
    expect(isOpen).toBe(false);

    // Four metal checkboxes — all checked by default
    const metalCheckboxes = panel.locator('input[type="checkbox"][data-metal]');
    await expect(metalCheckboxes).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(metalCheckboxes.nth(i)).toBeChecked();
    }

    // Auto-refresh checkbox
    const autoRefresh = panel.locator('input[type="checkbox"].js-auto-refresh');
    await expect(autoRefresh).toHaveCount(1);

    // Footer attribution
    await expect(panel).toContainText("gold-api.com");
  });

  // =========================================================================
  // 4. REQ-2.4 — Optional key toggle: details/summary disclosure
  // =========================================================================
  test("4. Clicking the optional key summary expands to reveal the API key input field", async ({
    page,
  }) => {
    await seedApiState(page, { spotPricingSource: "GOLD_API" });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const panel = page
      .locator("#apiSection_spot")
      .locator('.spot-accordion-panel[data-val="GOLD_API"]');
    const details = panel.locator("details.optional-key-details");

    // Collapsed by default — key input not visible
    const keyInput = details.locator('input[type="password"]');
    await expect(keyInput).toBeHidden();

    // Click summary to expand
    const summary = details.locator("summary");
    await summary.click();

    // Now key input should be visible
    await expect(keyInput).toBeVisible();
  });

  // =========================================================================
  // 5. REQ-3.2 — Provider persistence across reload
  // =========================================================================
  test("5. Selecting Gold API persists across page reload", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    // Click Gold API pill
    const spotSection = page.locator("#apiSection_spot");
    const pill = spotSection.locator('.gb-source-btn[data-val="GOLD_API"]');
    await pill.click();
    await confirmSpotProviderSwitch(page, "Gold API");

    // Verify persisted
    expect(await readSpotPricingSource(page)).toBe("GOLD_API");

    // Reload and verify still selected
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await readSpotPricingSource(page)).toBe("GOLD_API");

    // Reopen settings and verify pill is active
    await openApiSettings(page);
    const pillAfterReload = page
      .locator("#apiSection_spot")
      .locator('.gb-source-btn[data-val="GOLD_API"]');
    await expect(pillAfterReload).toHaveClass(/active/);
  });

  // =========================================================================
  // 6. Switch away and back — clean state
  // =========================================================================
  test("6. Switching to StakTrakr and back to Gold API renders a clean panel", async ({ page }) => {
    await seedApiState(page, { spotPricingSource: "GOLD_API" });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const spotSection = page.locator("#apiSection_spot");

    // Verify Gold API panel visible initially
    const goldPanel = spotSection.locator('.spot-accordion-panel[data-val="GOLD_API"]');
    await expect(goldPanel).toBeVisible();

    // Switch to StakTrakr
    const staktrakrPill = spotSection.locator('.gb-source-btn[data-val="STAKTRAKR"]');
    await staktrakrPill.click();
    await confirmSpotProviderSwitch(page, "StakTrakr");
    await expect(goldPanel).toBeHidden();

    // Switch back to Gold API
    const goldPill = spotSection.locator('.gb-source-btn[data-val="GOLD_API"]');
    await goldPill.click();
    await confirmSpotProviderSwitch(page, "Gold API");

    // Panel visible again with clean structure
    await expect(goldPanel).toBeVisible();
    await expect(goldPanel).toContainText("Free · Optional key");
    await expect(goldPanel.locator("details.optional-key-details")).toHaveCount(1);

    // Verify persisted as GOLD_API
    expect(await readSpotPricingSource(page)).toBe("GOLD_API");
  });

  // STRK-284 retargeted #headerSyncBtn → the per-card refresh icon; the header
  // button was retired and the per-card icon is now the manual sync affordance.
  test("7. Spot sync works with the default StakTrakr provider", async ({ page }) => {
    await seedApiState(page, { spotPricingSource: "STAKTRAKR" });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.syncSpotPricesFromApi === "function");
    await page.waitForTimeout(300);
    await wrapSpotSyncForHeaderAssertions(page);

    await page.locator("#syncIconSilver").click();

    await page.waitForFunction(() => window.__headerSpotSyncCalls?.length === 1);
    await expect.poll(() => page.evaluate(() => window.__headerSpotSyncCalls[0])).toEqual([true]);
    await expect(page.locator("body")).not.toContainText(
      "API sync functionality requires Metals API configuration"
    );
  });

  test("8. Spot sync works with Gold API and no premium key", async ({ page }) => {
    await page.route("https://api.gold-api.com/price/**", async (route) => {
      const symbol = route.request().url().split("/").pop();
      const prices = { XAU: 3333, XAG: 44, XPT: 1111, XPD: 999 };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ price: prices[symbol] || 1 }),
      });
    });
    await seedApiState(page, { spotPricingSource: "GOLD_API" });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.syncSpotPricesFromApi === "function");
    await page.waitForTimeout(300);
    await wrapSpotSyncForHeaderAssertions(page);

    await page.locator("#syncIconSilver").click();

    await page.waitForFunction(() => window.__headerSpotSyncCalls?.length === 1);
    await expect.poll(() => page.evaluate(() => window.__headerSpotSyncCalls[0])).toEqual([true]);
    await expect(page.locator("body")).not.toContainText(
      "API sync functionality requires Metals API configuration"
    );
  });
});

/**
 * STRK-85 — Goldback premium in ticker + tiered premium colors
 *
 * Acceptance / regression tests. Implementation ships in this same PR (Cohort C).
 * Covers _calcMarketPremium wired into all three render surfaces: ticker, Matrix, detail modal.
 *
 * AC-1: Goldback ticker items render a premium percentage.
 * AC-2: Premium math matches ((bestPrice - g1Rate) / g1Rate) * 100.
 * AC-3: Three-tier class scheme (low <2%, mid 2–5%, high ≥5%) applied consistently.
 * AC-5: Premium value and tier class identical across ticker and Matrix.
 *
 * Note: AC-4 (single shared helper, no inline threshold duplication) is verified
 * structurally via source grep in CLOSE-3, not through DOM assertions here.
 */

import { test, expect } from "@playwright/test";
import { installStakTrakrNetworkMocks } from "./helpers/mocks/routes.js";
import { injectSeedInventory } from "./helpers/seed.js";

// ── Fixture constants ─────────────────────────────────────────────────────────

const SLUG = "utah-1-goldback";
const G1_RATE = 4.25;

// HIGH tier: vendor $5.10 → ((5.10 - 4.25) / 4.25) * 100 = +20.0% (≥5%)
const HIGH_PRICE = 5.1;
// MID tier: vendor $4.3775 → ((4.3775 - 4.25) / 4.25) * 100 = +3.0% (≥2% and <5%)
const MID_PRICE = 4.3775;
// LOW tier: vendor $4.2925 → ((4.2925 - 4.25) / 4.25) * 100 = +1.0% (<2%)
const LOW_PRICE = 4.2925;

const makeVendorData = (price) => ({
  median_price: price,
  lowest_price: price,
  highest_price: price,
  vendors: {
    herobullion: { price, inStock: true, in_stock: true },
  },
});

const makePricesBlob = (price) => ({
  lastSync: new Date().toISOString(),
  window_start: new Date().toISOString(),
  prices: { [SLUG]: makeVendorData(price) },
});

const COIN_META = {
  [SLUG]: { name: "Utah 1 Goldback", weight: 0.001, metal: "goldback" },
};

const VENDOR_META = {
  herobullion: { name: "Hero Bullion", color: "#10b981", url: "https://herobullion.com" },
};

// ── Setup helpers ─────────────────────────────────────────────────────────────

const setupFixture = async (page, vendorPrice) => {
  await injectSeedInventory(page);

  await installStakTrakrNetworkMocks(page, {
    goldback: { g1_usd: G1_RATE },
    retailLatest: { [SLUG]: makeVendorData(vendorPrice) },
  });

  await page.addInitScript(
    ({ prices, coinMeta, vendorMeta }) => {
      const writeJson = (key, val) => localStorage.setItem(key, JSON.stringify(val));
      writeJson("v2RetailPrices", prices);
      writeJson("retailPrices", prices);
      writeJson("retailManifestCoinMeta", coinMeta);
      writeJson("retailManifestVendorMeta", vendorMeta);
      writeJson("retailManifestSlugs", Object.keys(coinMeta));
      writeJson("spotGold", 2000);
      writeJson("spotSilver", 36);
      // Stub LightweightCharts so openMarketDetailModal works without the CDN
      window.LightweightCharts = {
        CrosshairMode: { Normal: 0 },
        createChart(container) {
          const root = document.createElement("div");
          root.className = "tv-lightweight-charts";
          container.appendChild(root);
          return {
            addLineSeries() {
              return { setData() {} };
            },
            addHistogramSeries() {
              return { setData() {} };
            },
            addAreaSeries() {
              return { setData() {} };
            },
            timeScale() {
              return { fitContent() {}, applyOptions() {} };
            },
            applyOptions() {},
            resize() {},
            remove() {
              root.remove();
            },
          };
        },
      };
    },
    { prices: makePricesBlob(vendorPrice), coinMeta: COIN_META, vendorMeta: VENDOR_META }
  );

  await page.goto("/index.html");
  await page.waitForFunction(
    () =>
      typeof window.initMarketData === "function" && typeof window.refreshMarketData === "function"
  );
  await page.evaluate(async () => {
    if (typeof spotPrices !== "undefined") {
      spotPrices.gold = 2000;
      spotPrices.silver = 36;
    }
    await window.initMarketData();
    window.refreshMarketData();
  });
  await page.waitForSelector(".ticker-item", { timeout: 10000 });
};

const openDetailModal = async (page) => {
  await page.evaluate(() => window.openMarketDetailModal("utah-1-goldback"));
  await page.waitForSelector("#marketDetailModal:not([hidden]) .vendor-prices-table", {
    timeout: 10000,
  });
};

// ── Locator helpers ───────────────────────────────────────────────────────────

/**
 * Locates the .premium span inside the goldback ticker item specifically.
 *
 * Context: startRetailBackgroundSync() fires on page load (missingProviders=true)
 * and overwrites v2RetailPrices with all manifest coins (silver eagle, gold eagle,
 * goldback). Using .first() grabs the gold eagle "+2.0%" span instead of goldback.
 * Filtering by "Goldback" text always targets the correct ticker item.
 */
const goldbackTickerPremium = (page) =>
  page
    .locator(".ticker-block[data-ticker-block='primary'] .ticker-item")
    .filter({ hasText: "Goldback" })
    .locator(".premium");

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("STRK-85 — Goldback premium tiers", () => {
  test("AC-1 — Goldback ticker item renders a non-empty premium span", async ({ page }) => {
    await setupFixture(page, HIGH_PRICE);
    // Before C.1: ticker skips goldback premium (spot returns null) — span is empty.
    await expect(goldbackTickerPremium(page)).not.toBeEmpty();
  });

  test("AC-2 — Goldback ticker premium matches ((price - g1Rate) / g1Rate) * 100", async ({
    page,
  }) => {
    await setupFixture(page, HIGH_PRICE);
    const expected = `+${(((HIGH_PRICE - G1_RATE) / G1_RATE) * 100).toFixed(1)}%`; // "+20.0%"
    await expect(goldbackTickerPremium(page)).toHaveText(expected);
  });

  test("AC-3 ticker — ≥5% premium renders with .high class", async ({ page }) => {
    await setupFixture(page, HIGH_PRICE);
    await expect(goldbackTickerPremium(page)).toHaveClass(/\bhigh\b/);
  });

  test("AC-3 ticker — 2–5% premium renders with .mid class", async ({ page }) => {
    await setupFixture(page, MID_PRICE);
    await expect(goldbackTickerPremium(page)).toHaveClass(/\bmid\b/);
  });

  test("AC-3 ticker — <2% premium renders with .low class", async ({ page }) => {
    await setupFixture(page, LOW_PRICE);
    await expect(goldbackTickerPremium(page)).toHaveClass(/\blow\b/);
  });

  test("AC-3 Matrix — 2–5% premium renders with .vp-premium.mid class", async ({ page }) => {
    await setupFixture(page, MID_PRICE);
    await page.evaluate(() => window.renderVendorPrices());
    await page.waitForSelector(".vendor-prices-table", { timeout: 10000 });
    // Before C.1: Matrix uses binary scheme (< 10 = low, ≥ 10 = high) — no .mid class exists.
    const midBadge = page.locator(".vendor-prices-table .vp-premium.mid");
    await expect(midBadge.first()).toBeVisible();
  });

  test("AC-3 detail modal — goldback vendor row renders a .vp-premium badge", async ({ page }) => {
    await setupFixture(page, HIGH_PRICE);
    await openDetailModal(page);
    // Before C.1: detail modal uses spotPrice (null for goldbacks) — shows "—" instead of a badge.
    const badge = page.locator("#marketDetailContent .vp-premium");
    await expect(badge.first()).toBeVisible();
  });

  test("AC-5 — premium text and tier class match across ticker and Matrix", async ({ page }) => {
    await setupFixture(page, HIGH_PRICE);
    await page.evaluate(() => window.renderVendorPrices());
    await page.waitForSelector(".vendor-prices-table", { timeout: 10000 });

    // Scope Matrix badge to the goldback row (background sync adds other coins to the table)
    const matrixBadge = page
      .locator(".vendor-prices-table tbody tr")
      .filter({ hasText: "Goldback" })
      .locator(".vp-premium");

    // Before C.1: ticker shows no premium text; only Matrix shows it (via G1 rate branch).
    await expect(goldbackTickerPremium(page)).toHaveText("+20.0%");
    await expect(goldbackTickerPremium(page)).toHaveClass(/\bhigh\b/);
    await expect(matrixBadge).toHaveText("+20.0%");
    await expect(matrixBadge).toHaveClass(/\bhigh\b/);
  });
});

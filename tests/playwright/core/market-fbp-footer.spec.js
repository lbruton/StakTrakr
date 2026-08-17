import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";
import { installStakTrakrNetworkMocks } from "../helpers/mocks/routes.js";

// STRK-334 (R5): the market footer disclaimer must credit FindBullionPrices —
// the base "best effort" sentence plus an attribution line and a
// findbullionprices.com link that opens in a new tab with rel="noopener
// noreferrer", while the existing currency disclaimer is preserved. RED until
// js/market-data.js renderVendorPrices appends the link (design C6).

const GENERATED_AT = "2026-05-26T12:00:00.000Z";
const RECENT_DATE = "2026-05-24";
const RECENT_TS = Math.floor(new Date(`${RECENT_DATE}T18:00:00Z`).getTime() / 1000);
// Pin the clock so the market-history 7-day window includes the seeded row and
// the vendor table paints deterministically (mirrors retail-market.spec.js).
const FIXED_NOW = new Date("2026-05-26T18:00:00.000Z");

const SLUG = "core-alpha-silver";
const coinMeta = { [SLUG]: { name: "Alpha Silver Bar", weight: 1, metal: "silver" } };
const vendorMeta = {
  jmbullion: { name: "JM Bullion", color: "#ef4444", url: "https://jmbullion.com" },
  apmex: { name: "APMEX", color: "#60a5fa", url: "https://apmex.com" },
};

const prices = {
  lastSync: GENERATED_AT,
  window_start: GENERATED_AT,
  prices: {
    [SLUG]: {
      median_price: 38,
      lowest_price: 38,
      highest_price: 38,
      vendors: { jmbullion: { price: 38, inStock: true, in_stock: true } },
    },
  },
};

const historyRows = {
  [SLUG]: [
    {
      date: RECENT_DATE,
      t: `${RECENT_DATE}T00:00:00Z`,
      ts: RECENT_TS,
      avg_median: 38,
      avg_low: 38,
      avg: 38,
      low: 38,
      close: 38,
      vendors: { jmbullion: { avg: 38 } },
    },
  ],
};

const intradayRows = {
  [SLUG]: [
    {
      t: GENERATED_AT,
      ts: Math.floor(new Date(GENERATED_AT).getTime() / 1000),
      median: 38,
      low: 38,
      vendors: { jmbullion: 38 },
    },
  ],
};

/**
 * Seeds the retail caches + display currency, installs network mocks, then
 * boots the Market tab and waits for the vendor prices table (and its footer).
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @returns {Promise<void>}
 */
async function bootMarketFooter(page) {
  await injectSeedInventory(page);
  await installStakTrakrNetworkMocks(page, { exchangeRates: { EUR: 0.9 } });

  await page.addInitScript(
    ({ seeded, meta, vendors }) => {
      const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
      const slugs = Object.keys(meta);
      writeJson("v2RetailPrices", seeded.prices);
      writeJson("retailPrices", seeded.prices);
      writeJson("v2RetailHistory", seeded.history);
      writeJson("retailPriceHistory", seeded.history);
      writeJson("v2RetailIntraday", seeded.intraday);
      writeJson("retailIntradayData", seeded.intraday);
      writeJson("retailManifestSlugs", slugs);
      writeJson("retailManifestCoinMeta", meta);
      writeJson("retailManifestVendorMeta", vendors);
      // Non-USD display currency so the currency disclaimer renders and can be
      // asserted to survive the footer restructure.
      writeJson("displayCurrency", "EUR");
      writeJson("exchangeRates", { EUR: 0.9 });
      localStorage.setItem("retailManifestGeneratedAt", seeded.generatedAt);
      localStorage.setItem("spotSilver", JSON.stringify(36));
      localStorage.setItem("spotGold", JSON.stringify(2000));
    },
    {
      seeded: { prices, history: historyRows, intraday: intradayRows, generatedAt: GENERATED_AT },
      meta: coinMeta,
      vendors: vendorMeta,
    }
  );

  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto("/index.html#/market", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.renderVendorPrices === "function" &&
      typeof window.refreshMarketData === "function" &&
      typeof window.initMarketData === "function"
  );
  await page.waitForFunction(
    () => typeof spotPrices !== "undefined" && Number(spotPrices.gold) > 0
  );
  await page.evaluate(async () => {
    if (typeof spotPrices !== "undefined") {
      spotPrices.gold = 2000;
      spotPrices.silver = 36;
    }
    await window.initMarketData?.();
    window.refreshMarketData();
  });
  await page.waitForSelector(".vendor-prices-table", { timeout: 10000 });
}

test.describe("STRK-334 market footer FindBullionPrices attribution", () => {
  test("footer links to findbullionprices.com in a new tab with noopener noreferrer", async ({
    page,
  }) => {
    await bootMarketFooter(page);

    const fbpLink = page.locator('a[href="https://findbullionprices.com"]');
    await expect(fbpLink).toBeVisible();
    await expect(fbpLink).toHaveText("findbullionprices.com");
    await expect(fbpLink).toHaveAttribute("target", "_blank");
    const rel = (await fbpLink.getAttribute("rel")) || "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  });

  test("footer keeps the best-effort line, adds the attribution copy, and preserves the currency disclaimer", async ({
    page,
  }) => {
    await bootMarketFooter(page);

    await expect(page.getByText(/Market prices are best effort/)).toBeVisible();
    await expect(page.getByText(/provided by/i)).toBeVisible();
    await expect(page.getByText(/Currency conversion is for convenience only/)).toBeVisible();
  });
});

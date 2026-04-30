import { test, expect } from "@playwright/test";
import { injectSeedInventory } from "../helpers/seed.js";

const MARKET_FILTER_KEY = "staktrakr.market_filter";
const SLUG_SILVER = "ase";
const SLUG_GOLD = "cml-gold";
const VENDORS = [
  { id: "apmex", name: "APMEX", color: "#60a5fa", url: "https://www.apmex.com" },
  { id: "jmbullion", name: "JM Bullion", color: "#fbbf24", url: "https://www.jmbullion.com" },
];

const daysAgo = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

const recentDate = daysAgo(2);
const oldDate = daysAgo(20);
const generatedAt = new Date().toISOString();
const recentTs = Math.floor(new Date(`${recentDate}T18:00:00Z`).getTime() / 1000);
const olderTs = Math.floor(new Date(`${recentDate}T12:00:00Z`).getTime() / 1000);

const coinMeta = {
  [SLUG_SILVER]: { name: "American Silver Eagle", weight: 1, metal: "silver" },
  [SLUG_GOLD]: { name: "Canadian Gold Maple Leaf", weight: 1, metal: "gold" },
};

const vendorMeta = Object.fromEntries(
  VENDORS.map((vendor) => [vendor.id, { name: vendor.name, color: vendor.color, url: vendor.url }])
);

const providers = {
  [SLUG_SILVER]: {
    apmex: "https://www.apmex.com/product/ase",
    jmbullion: "https://www.jmbullion.com/product/ase",
  },
  [SLUG_GOLD]: {
    apmex: "https://www.apmex.com/product/cml",
    jmbullion: "https://www.jmbullion.com/product/cml",
  },
};

const initialPrices = {
  lastSync: generatedAt,
  window_start: generatedAt,
  prices: {
    [SLUG_SILVER]: {
      median_price: 42.25,
      lowest_price: 41.95,
      highest_price: 43.1,
      vendors: {
        apmex: { price: 43.1, inStock: true, in_stock: true },
        jmbullion: { price: 41.95, inStock: true, in_stock: true },
      },
    },
    [SLUG_GOLD]: {
      median_price: 3520.75,
      lowest_price: 3499.95,
      highest_price: 3550.5,
      vendors: {
        apmex: { price: 3550.5, inStock: true, in_stock: true },
        jmbullion: { price: 3499.95, inStock: true, in_stock: true },
      },
    },
  },
};

const syncedPrices = {
  [SLUG_SILVER]: {
    median: 44.44,
    median_price: 44.44,
    low: 43.21,
    lowest_price: 43.21,
    high: 45.67,
    highest_price: 45.67,
    weight_oz: 1,
    window_start: generatedAt,
    vendors: {
      apmex: { price: 44.44, in_stock: true, inStock: true, url: providers[SLUG_SILVER].apmex },
      jmbullion: {
        price: 43.21,
        in_stock: true,
        inStock: true,
        url: providers[SLUG_SILVER].jmbullion,
      },
    },
  },
  [SLUG_GOLD]: {
    median: 3620.5,
    median_price: 3620.5,
    low: 3599,
    lowest_price: 3599,
    high: 3650,
    highest_price: 3650,
    weight_oz: 1,
    window_start: generatedAt,
    vendors: {
      apmex: { price: 3650, in_stock: true, inStock: true, url: providers[SLUG_GOLD].apmex },
      jmbullion: {
        price: 3599,
        in_stock: true,
        inStock: true,
        url: providers[SLUG_GOLD].jmbullion,
      },
    },
  },
};

const historyRows = {
  [SLUG_SILVER]: [
    {
      date: oldDate,
      t: `${oldDate}T00:00:00Z`,
      ts: Math.floor(new Date(`${oldDate}T00:00:00Z`).getTime() / 1000),
      avg_median: 39.5,
      avg_low: 39,
      avg: 39.5,
      low: 39,
      close: 39.5,
      vendors: { apmex: { avg: 40 }, jmbullion: { avg: 39 } },
    },
    {
      date: recentDate,
      t: `${recentDate}T00:00:00Z`,
      ts: recentTs,
      avg_median: 42.25,
      avg_low: 41.95,
      avg: 42.25,
      low: 41.95,
      close: 42.25,
      vendors: { apmex: { avg: 43.1 }, jmbullion: { avg: 41.95 } },
    },
  ],
  [SLUG_GOLD]: [
    {
      date: recentDate,
      t: `${recentDate}T00:00:00Z`,
      ts: recentTs,
      avg_median: 3520.75,
      avg_low: 3499.95,
      avg: 3520.75,
      low: 3499.95,
      close: 3520.75,
      vendors: { apmex: { avg: 3550.5 }, jmbullion: { avg: 3499.95 } },
    },
  ],
};

const intradayRows = {
  [SLUG_SILVER]: [
    {
      t: `${recentDate}T12:00:00Z`,
      ts: olderTs,
      median: 42,
      low: 41.8,
      vendors: { apmex: 42.5, jmbullion: 41.8 },
    },
    {
      t: `${recentDate}T18:00:00Z`,
      ts: recentTs,
      median: 44.44,
      low: 43.21,
      vendors: { apmex: 44.44, jmbullion: 43.21 },
    },
  ],
  [SLUG_GOLD]: [
    {
      t: `${recentDate}T12:00:00Z`,
      ts: olderTs,
      median: 3600,
      low: 3585,
      vendors: { apmex: 3610, jmbullion: 3585 },
    },
    {
      t: `${recentDate}T18:00:00Z`,
      ts: recentTs,
      median: 3620.5,
      low: 3599,
      vendors: { apmex: 3650, jmbullion: 3599 },
    },
  ],
};

const manifestResponse = {
  v: 2,
  generated_at: generatedAt,
  data: {
    coins: [
      { slug: SLUG_SILVER, name: coinMeta[SLUG_SILVER].name, weight_oz: 1, metal: "xag" },
      { slug: SLUG_GOLD, name: coinMeta[SLUG_GOLD].name, weight_oz: 1, metal: "xau" },
    ],
    vendors: VENDORS,
  },
};

const providersResponse = {
  v: 2,
  generated_at: generatedAt,
  data: {
    coins: {
      [SLUG_SILVER]: {
        providers: VENDORS.map((vendor) => ({
          id: vendor.id,
          enabled: true,
          url: providers[SLUG_SILVER][vendor.id],
        })),
      },
      [SLUG_GOLD]: {
        providers: VENDORS.map((vendor) => ({
          id: vendor.id,
          enabled: true,
          url: providers[SLUG_GOLD][vendor.id],
        })),
      },
    },
  },
};

const lightweightChartsStub = `
  window.LightweightCharts = {
    CrosshairMode: { Normal: 0 },
    createChart(container) {
      const root = document.createElement("div");
      root.className = "tv-lightweight-charts";
      root.dataset.testChart = "true";
      root.style.height = "100%";
      root.style.minHeight = "120px";
      container.appendChild(root);
      return {
        addLineSeries() {
          return {
            setData(data) {
              const nextCount = Number(root.dataset.pointCount || 0) + data.length;
              root.dataset.pointCount = String(nextCount);
              root.setAttribute("data-point-count", String(nextCount));
            },
          };
        },
        timeScale() {
          return { fitContent() {} };
        },
        remove() {
          root.remove();
        },
      };
    },
  };
`;

const setupRetailFixture = async (page) => {
  await injectSeedInventory(page);

  await page.addInitScript(
    ({ prices, history, intraday, slugs, meta, vendors, providerMap, generatedAtValue }) => {
      const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
      writeJson("v2RetailPrices", prices);
      writeJson("retailPrices", prices);
      writeJson("v2RetailHistory", history);
      writeJson("retailPriceHistory", history);
      writeJson("v2RetailIntraday", intraday);
      writeJson("retailIntradayData", intraday);
      writeJson("retailManifestSlugs", slugs);
      writeJson("retailManifestCoinMeta", meta);
      writeJson("retailManifestVendorMeta", vendors);
      writeJson("retailProviders", providerMap);
      localStorage.setItem("retailManifestGeneratedAt", generatedAtValue);
      localStorage.setItem("spotSilver", JSON.stringify(36));
      localStorage.setItem("spotGold", JSON.stringify(3350));

      window.LightweightCharts = {
        CrosshairMode: { Normal: 0 },
        createChart(container) {
          const root = document.createElement("div");
          root.className = "tv-lightweight-charts";
          root.dataset.testChart = "true";
          root.style.height = "100%";
          root.style.minHeight = "120px";
          container.appendChild(root);
          return {
            addLineSeries() {
              return {
                setData(data) {
                  const nextCount = Number(root.dataset.pointCount || 0) + data.length;
                  root.dataset.pointCount = String(nextCount);
                  root.setAttribute("data-point-count", String(nextCount));
                },
              };
            },
            timeScale() {
              return { fitContent() {} };
            },
            remove() {
              root.remove();
            },
          };
        },
      };
    },
    {
      prices: initialPrices,
      history: historyRows,
      intraday: intradayRows,
      slugs: [SLUG_SILVER, SLUG_GOLD],
      meta: coinMeta,
      vendors: vendorMeta,
      providerMap: providers,
      generatedAtValue: generatedAt,
    }
  );

  await page.route("https://cdn.jsdelivr.net/npm/lightweight-charts@4/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: lightweightChartsStub,
    });
  });

  await page.route("https://api.staktrakr.com/data/v2/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/data\/v2\//, "");
    const json = responseForPath(path);
    if (!json) {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(json),
    });
  });

  await page.route("https://api2.staktrakr.com/data/v2/**", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });

  await page.goto("/index.html");
  await page.waitForFunction(
    () =>
      typeof window.showSettingsModal === "function" &&
      typeof window.renderVendorPrices === "function" &&
      typeof window.renderRetailHistoryTable === "function" &&
      typeof window.syncRetailPrices === "function"
  );
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    window.refreshMarketData();
  });
};

const responseForPath = (path) => {
  if (path === "manifest.json") return manifestResponse;
  if (path === "providers.json") return providersResponse;
  if (path === "goldback/latest.json") return { v: 2, data: { g1_usd: 4.25 } };

  const match = path.match(/^retail\/([^/]+)\/([^/]+)\.json$/);
  if (!match) return null;

  const [, slug, file] = match;
  if (!Object.prototype.hasOwnProperty.call(syncedPrices, slug)) return null;

  if (file === "latest") return { v: 2, generated_at: generatedAt, data: syncedPrices[slug] };
  if (file === "intraday") return { v: 2, generated_at: generatedAt, data: intradayRows[slug] };
  if (file === "history-7d" || file === "history-30d" || file === "history-90d") {
    return { v: 2, generated_at: generatedAt, data: historyRows[slug] };
  }
  return null;
};

test.describe("STAK-582 — surviving market retail surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await setupRetailFixture(page);
  });

  test("Market History table renders and responds to coin/timeframe changes", async ({ page }) => {
    await page.evaluate(() => window.showSettingsModal("changelog"));
    await page.locator('[data-log-tab="market"]').click();

    const historyPanel = page.locator("#logPanel_market");
    await expect(historyPanel).toBeVisible();
    await expect(page.locator("#retailHistorySlugSelect")).toContainText("American Silver Eagle");
    await expect(page.locator("#retailHistoryTableBody")).toContainText(recentDate);
    await expect(page.locator("#retailHistoryTableBody")).not.toContainText(oldDate);
    await expect(page.locator("#retailHistoryTableBody")).toContainText("$42.25");

    await page.locator('[data-retail-timeframe="all"]').click();
    await expect(page.locator("#retailHistoryTableBody")).toContainText(oldDate);

    await page.locator("#retailHistorySlugSelect").selectOption(SLUG_GOLD);
    await expect(page.locator("#retailHistoryTableBody")).toContainText("$3,520.75");
    await expect(page.locator("#retailHistoryTableBody")).not.toContainText("$42.25");
  });

  test("Market Filter Matrix toggles slug/vendor visibility and keeps matrix styling", async ({
    page,
  }) => {
    await page.evaluate(() => window.showSettingsModal("market"));

    const matrix = page.locator("#marketFilterMatrix");
    await expect(matrix).toBeVisible();
    await expect(
      matrix.locator("tbody tr").filter({ hasText: "American Silver Eagle" })
    ).toHaveCount(1);
    await expect(page.locator("#marketFilterMetalPills .market-filter-pill.active")).toHaveText(
      "All"
    );

    const matrixWrapStyle = await page.locator("#marketFilterMatrixWrap").evaluate((el) => {
      const style = getComputedStyle(el);
      return { borderStyle: style.borderStyle, borderRadius: style.borderRadius };
    });
    expect(matrixWrapStyle.borderStyle).not.toBe("none");
    expect(parseFloat(matrixWrapStyle.borderRadius)).toBeGreaterThan(0);

    const jmToggle = page.locator(
      `#marketFilterMatrix input[data-slug="${SLUG_SILVER}"][data-vendor="jmbullion"]`
    );
    await expect(jmToggle).toBeChecked();
    await jmToggle.click();
    await expect(jmToggle).not.toBeChecked();

    const savedFilter = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      MARKET_FILTER_KEY
    );
    expect(savedFilter).toEqual({ [SLUG_SILVER]: { jmbullion: false } });

    await expect(page.locator("#bestPriceTickerEl .ticker-item .coin").first()).toBeVisible();
    await expect(page.locator("#bestPriceTickerEl")).toContainText("APMEX");
  });

  test("Retail Detail Modal opens from the active vendor table and renders history/intraday charts", async ({
    page,
  }) => {
    await expect(
      page.locator(".vendor-prices-table .vp-coin-link", { hasText: "American Silver Eagle" })
    ).toBeVisible();
    await page
      .locator(".vendor-prices-table .vp-coin-link", { hasText: "American Silver Eagle" })
      .click();

    const modal = page.locator("#marketDetailModal");
    await expect(modal).toBeVisible();
    await expect(page.locator("#marketDetailTitle")).toContainText("American Silver Eagle");
    await expect(page.locator("#marketDetailChartArea .tv-lightweight-charts")).toBeVisible();
    await expect(page.locator("#marketDetailChartArea .tv-lightweight-charts")).toHaveAttribute(
      "data-point-count",
      /[1-9]/
    );

    await page.locator('#marketDetailContent button[data-period="24h"]').click();
    await expect(page.locator("#marketDetailChartArea .tv-lightweight-charts")).toBeVisible();
    await expect(page.locator("#marketDetailChartArea .tv-lightweight-charts")).toHaveAttribute(
      "data-point-count",
      /[1-9]/
    );
  });

  test("Main-page ticker and vendor price table render active market data", async ({ page }) => {
    const ticker = page.locator("#bestPriceTickerEl");
    await expect(ticker).toBeVisible();
    await expect(ticker.locator(".ticker-item")).toHaveCount(2);
    await expect(ticker).toContainText("American Silver Eagle");
    await expect(ticker).toContainText("$41.95");

    const vendorSection = page.locator("#vendorPricesSectionEl");
    await expect(vendorSection).toBeVisible();
    await expect(vendorSection.locator(".vendor-prices-tabs button.active")).toHaveText("Silver");
    await expect(vendorSection.locator(".vendor-prices-table")).toBeVisible();
    await expect(vendorSection.locator(".vendor-prices-table")).toContainText(
      "American Silver Eagle"
    );
    await expect(vendorSection.locator(".vendor-prices-table")).toContainText("$41.95");
  });

  test("Retail sync updates cached state and remaining market UI status", async ({ page }) => {
    await page.evaluate(() => window.showSettingsModal("market"));
    await page.locator("#retailSyncBtn").click();

    await expect(page.locator("#retailSyncStatus")).toContainText("Synced 2 coin(s)");
    await expect(page.locator("#retailSyncBtn")).toHaveText("Sync Now");

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("v2RetailPrices")));
    expect(stored.prices[SLUG_SILVER].median_price).toBe(44.44);
    expect(stored.prices[SLUG_GOLD].lowest_price).toBe(3599);

    await expect(page.locator("#bestPriceTickerEl")).toBeVisible();
    await expect(page.locator("#vendorPricesContainer")).toBeVisible();
    await page.evaluate(() => window.showSettingsModal("changelog"));
    await page.locator('[data-log-tab="market"]').click();
    await expect(page.locator("#retailSyncLogContainer")).toContainText("OK");
    await expect(page.locator("#retailSyncLogContainer")).toContainText("2");
  });
});

import { test, expect } from "@playwright/test";
import { injectSeedInventory } from "../helpers/seed.js";

const SLUG_SILVER = "ase";
const SLUG_GOLDBACK = "goldback-oklahoma-g1";
const VENDORS = [
  { id: "apmex", name: "APMEX", color: "#60a5fa", url: "https://www.apmex.com" },
  { id: "jmbullion", name: "JM Bullion", color: "#fbbf24", url: "https://www.jmbullion.com" },
  { id: "goldback", name: "Goldback", color: "#d4a017", url: "https://www.goldback.com" },
];

const daysAgo = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

const recentDate = daysAgo(2);
const generatedAt = new Date().toISOString();
const recentTs = Math.floor(new Date(`${recentDate}T18:00:00Z`).getTime() / 1000);
const RED_PHASE_EXPECT_TIMEOUT_MS = 1000;
const CONVENIENCE_DISCLAIMER =
  "Currency conversion is for convenience only — vendors are US-based and may not accept your selected currency at checkout.";

const coinMeta = {
  [SLUG_SILVER]: { name: "American Silver Eagle", weight: 1, metal: "silver" },
  [SLUG_GOLDBACK]: { name: "G1 Oklahoma Goldback", weight: 0.001, metal: "goldback" },
};

const vendorMeta = Object.fromEntries(
  VENDORS.map((vendor) => [vendor.id, { name: vendor.name, color: vendor.color, url: vendor.url }])
);

const providers = {
  [SLUG_SILVER]: {
    apmex: "https://www.apmex.com/product/ase",
    jmbullion: "https://www.jmbullion.com/product/ase",
  },
  [SLUG_GOLDBACK]: {
    goldback: "https://www.goldback.com/goldbacks/oklahoma-goldback-1",
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
        apmex: { price: 41.95, inStock: true, in_stock: true },
        jmbullion: { price: 43.1, inStock: true, in_stock: true },
      },
    },
    [SLUG_GOLDBACK]: {
      median_price: 4.25,
      lowest_price: 4.25,
      highest_price: 4.25,
      vendors: {
        goldback: { price: 4.25, inStock: true, in_stock: true },
      },
    },
  },
};

const historyRows = {
  [SLUG_SILVER]: [
    {
      date: recentDate,
      t: `${recentDate}T00:00:00Z`,
      ts: recentTs,
      avg_median: 42.25,
      avg_low: 41.95,
      avg: 42.25,
      low: 41.95,
      close: 42.25,
      vendors: { apmex: { avg: 41.95 }, jmbullion: { avg: 43.1 } },
    },
  ],
  [SLUG_GOLDBACK]: [
    {
      date: recentDate,
      t: `${recentDate}T00:00:00Z`,
      ts: recentTs,
      avg_median: 4.25,
      avg_low: 4.25,
      avg: 4.25,
      low: 4.25,
      close: 4.25,
      vendors: { goldback: { avg: 4.25 } },
    },
  ],
};

const intradayRows = {
  [SLUG_SILVER]: [
    {
      t: `${recentDate}T18:00:00Z`,
      ts: recentTs,
      median: 42.25,
      low: 41.95,
      vendors: { apmex: 41.95, jmbullion: 43.1 },
    },
  ],
  [SLUG_GOLDBACK]: [
    {
      t: `${recentDate}T18:00:00Z`,
      ts: recentTs,
      median: 4.25,
      low: 4.25,
      vendors: { goldback: 4.25 },
    },
  ],
};

const manifestResponse = {
  v: 2,
  generated_at: generatedAt,
  data: {
    coins: [
      { slug: SLUG_SILVER, name: coinMeta[SLUG_SILVER].name, weight_oz: 1, metal: "xag" },
      {
        slug: SLUG_GOLDBACK,
        name: coinMeta[SLUG_GOLDBACK].name,
        weight_oz: 0.001,
        metal: "goldback",
      },
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
        providers: [
          { id: "apmex", enabled: true, url: providers[SLUG_SILVER].apmex },
          { id: "jmbullion", enabled: true, url: providers[SLUG_SILVER].jmbullion },
        ],
      },
      [SLUG_GOLDBACK]: {
        providers: [{ id: "goldback", enabled: true, url: providers[SLUG_GOLDBACK].goldback }],
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
      slugs: [SLUG_SILVER, SLUG_GOLDBACK],
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
      typeof window.renderRetailHistoryTable === "function"
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
  if (!Object.prototype.hasOwnProperty.call(initialPrices.prices, slug)) return null;

  if (file === "latest")
    return { v: 2, generated_at: generatedAt, data: initialPrices.prices[slug] };
  if (file === "intraday") return { v: 2, generated_at: generatedAt, data: intradayRows[slug] };
  if (file === "history-7d" || file === "history-30d" || file === "history-90d") {
    return { v: 2, generated_at: generatedAt, data: historyRows[slug] };
  }
  return null;
};

test.describe("STAK-581 — retail currency switch red phase", () => {
  test.beforeEach(async ({ page }) => {
    await setupRetailFixture(page);
  });

  test("retail market surfaces follow display currency changes", async ({ page }) => {
    const ticker = page.locator("#bestPriceTickerEl");
    const vendorSection = page.locator("#vendorPricesContainer");

    await expect(ticker).toBeVisible();
    await expect(ticker).toContainText("$");
    await expect(ticker).toContainText("American Silver Eagle");

    const vendorGrid = vendorSection.locator(".vendor-prices-table");
    await expect(vendorGrid).toContainText("American Silver Eagle");
    const silverRow = vendorGrid
      .locator("tbody tr")
      .filter({ has: page.locator(".vp-coin-link", { hasText: "American Silver Eagle" }) });
    const cellForHeader = async (headerLabel) => {
      const columnIndex = await vendorGrid
        .locator("thead th")
        .evaluateAll(
          (headers, label) => headers.findIndex((header) => header.textContent.trim() === label),
          headerLabel
        );
      expect(columnIndex).toBeGreaterThanOrEqual(0);
      return silverRow.locator("td").nth(columnIndex);
    };
    const apmexCell = await cellForHeader("APMEX");
    const jmBullionCell = await cellForHeader("JM");
    const medianCell = await cellForHeader("MEDIAN");
    const spreadCell = await cellForHeader("SPREAD");

    await expect(apmexCell).toContainText("$41.95");
    await expect(jmBullionCell).toContainText("$43.10");
    await expect(medianCell).toContainText("$42.25");
    await expect(spreadCell).toContainText("$1.15");
    await expect(vendorSection).not.toContainText(CONVENIENCE_DISCLAIMER);

    await page.evaluate(() => window.showSettingsModal("changelog"));
    await page.locator('[data-log-tab="market"]').click();
    await page.locator("#retailHistorySlugSelect").selectOption(SLUG_GOLDBACK);

    const historyTable = page.locator("#retailHistoryTableBody");
    await expect(historyTable).toContainText(recentDate);
    await expect(historyTable).toContainText("$");
    await expect(page.locator("#settingsModal")).not.toContainText(CONVENIENCE_DISCLAIMER);

    await page.evaluate(() => window.saveDisplayCurrency("EUR"));

    await expect.soft(ticker).toContainText("€", { timeout: RED_PHASE_EXPECT_TIMEOUT_MS });
    await expect
      .soft(ticker.locator(".price").first())
      .not.toContainText("$", { timeout: RED_PHASE_EXPECT_TIMEOUT_MS });
    await expect.soft(apmexCell).toContainText("€", { timeout: RED_PHASE_EXPECT_TIMEOUT_MS });
    await expect.soft(jmBullionCell).toContainText("€", { timeout: RED_PHASE_EXPECT_TIMEOUT_MS });
    await expect.soft(medianCell).toContainText("€", { timeout: RED_PHASE_EXPECT_TIMEOUT_MS });
    await expect.soft(spreadCell).toContainText("€", { timeout: RED_PHASE_EXPECT_TIMEOUT_MS });
    await expect.soft(historyTable).toContainText("€", { timeout: RED_PHASE_EXPECT_TIMEOUT_MS });
    await expect.soft(vendorSection).toContainText(CONVENIENCE_DISCLAIMER, {
      timeout: RED_PHASE_EXPECT_TIMEOUT_MS,
    });

    await page.evaluate(() => window.saveDisplayCurrency("USD"));

    await expect(ticker.locator(".price").first()).toContainText("$");
    await expect(apmexCell).toContainText("$41.95");
    await expect(jmBullionCell).toContainText("$43.10");
    await expect(medianCell).toContainText("$42.25");
    await expect(spreadCell).toContainText("$1.15");
    await expect(historyTable).toContainText("$");
    await expect(vendorSection).not.toContainText(CONVENIENCE_DISCLAIMER);
  });
});

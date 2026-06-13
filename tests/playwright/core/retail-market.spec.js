import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

const MARKET_FILTER_KEY = "staktrakr.market_filter";
const GOLDBACK_G1_RATE = 4.25;
const GENERATED_AT = "2026-05-26T12:00:00.000Z";
const RECENT_DATE = "2026-05-24";
const RECENT_TS = Math.floor(new Date(`${RECENT_DATE}T18:00:00Z`).getTime() / 1000);
// Pin the browser clock so wall-clock-relative filters (e.g. the market-history
// 7-day timeframe window in renderVendorPrices) always include the seeded
// RECENT_DATE rows. Without this the test rots into a time-bomb: once real
// "today" drifts >7 days past RECENT_DATE, the default history view filters out
// every seeded row and #retailHistoryTableBody renders the empty placeholder.
// Anchored just after GENERATED_AT so all seeded data (manifest generated_at,
// prices lastSync) sits in the past while RECENT_DATE stays inside the window.
const FIXED_NOW = new Date("2026-05-26T18:00:00.000Z");
const CURRENCY_DISCLAIMER =
  "Currency conversion is for convenience only — vendors are US-based and may not accept your selected currency at checkout.";

const SLUG_SILVER_Z = "core-zebra-silver";
const SLUG_SILVER_A = "core-alpha-silver";
const SLUG_SILVER_M = "core-middle-silver";
const SLUG_GOLD_A = "core-alpha-gold";
const SLUG_GOLD_Z = "core-zulu-gold";
const SLUG_GOLDBACK = "core-utah-goldback-g1";
const SYNTHETIC_UNRESOLVED = "core-unresolved-retail-slug";
const SYNTHETIC_UNKNOWN_METAL = "core-unknown-metal-retail-slug";

const VENDORS = [
  { id: "herobullion", name: "Hero Bullion", color: "#10b981", url: "https://herobullion.com" },
  { id: "jmbullion", name: "JM Bullion", color: "#ef4444", url: "https://jmbullion.com" },
  { id: "goldback", name: "Goldback", color: "#fbbf24", url: "https://goldback.com" },
  { id: "apmex", name: "APMEX", color: "#60a5fa", url: "https://apmex.com" },
  {
    id: "bullionexchanges",
    name: "Bullion Exchanges",
    color: "#f59e0b",
    url: "https://bullionexchanges.com",
  },
];

const coinMeta = {
  [SLUG_SILVER_Z]: { name: "Zebra Silver Round", weight: 1, metal: "silver" },
  [SLUG_SILVER_A]: { name: "Alpha Silver Bar", weight: 1, metal: "silver" },
  [SLUG_SILVER_M]: { name: "Middle Silver Coin", weight: 1, metal: "silver" },
  [SLUG_GOLD_A]: { name: "Alpha Gold Coin", weight: 1, metal: "gold" },
  [SLUG_GOLD_Z]: { name: "Zulu Gold Coin", weight: 1, metal: "gold" },
  [SLUG_GOLDBACK]: { name: "Utah 1 Goldback", weight: 0, metal: "goldback" },
  [SYNTHETIC_UNKNOWN_METAL]: { name: "Unknown Metal Test", weight: 1, metal: "unknown" },
};

const vendorMeta = Object.fromEntries(
  VENDORS.map((vendor) => [vendor.id, { name: vendor.name, color: vendor.color, url: vendor.url }])
);

const priceRows = {
  [SLUG_SILVER_Z]: { price: 42, vendor: "herobullion" },
  [SLUG_SILVER_A]: { price: 38, vendor: "apmex" },
  [SLUG_SILVER_M]: { price: 40, vendor: "bullionexchanges" },
  [SLUG_GOLD_Z]: { price: 2150, vendor: "jmbullion" },
  [SLUG_GOLD_A]: { price: 2200, vendor: "apmex" },
  [SLUG_GOLDBACK]: { price: 5.1, vendor: "goldback" },
};

const prices = {
  lastSync: GENERATED_AT,
  window_start: GENERATED_AT,
  prices: Object.fromEntries(
    Object.entries(priceRows).map(([slug, row]) => [
      slug,
      {
        median_price: row.price,
        lowest_price: row.price,
        highest_price: row.price,
        vendors: { [row.vendor]: { price: row.price, inStock: true, in_stock: true } },
      },
    ])
  ),
};

const historyRows = Object.fromEntries(
  Object.entries(priceRows).map(([slug, row]) => [
    slug,
    [
      {
        date: RECENT_DATE,
        t: `${RECENT_DATE}T00:00:00Z`,
        ts: RECENT_TS,
        avg_median: row.price,
        avg_low: row.price,
        avg: row.price,
        low: row.price,
        close: row.price,
        vendors: { [row.vendor]: { avg: row.price } },
      },
    ],
  ])
);

const intradayRows = Object.fromEntries(
  Object.entries(priceRows).map(([slug, row]) => [
    slug,
    [
      {
        t: `${RECENT_DATE}T18:00:00Z`,
        ts: RECENT_TS,
        median: row.price,
        low: row.price,
        vendors: { [row.vendor]: row.price },
      },
    ],
  ])
);

const lightweightChartsStub = `
  window.LightweightCharts = {
    CrosshairMode: { Normal: 0 },
    createChart(container) {
      const root = document.createElement("div");
      root.className = "tv-lightweight-charts";
      root.dataset.testChart = "true";
      container.appendChild(root);
      return {
        addLineSeries() {
          return { setData(data) { root.dataset.pointCount = String(data.length); } };
        },
        addHistogramSeries() {
          return { setData(data) { root.dataset.histogramCount = String(data.length); } };
        },
        addAreaSeries() {
          return { setData(data) { root.dataset.areaCount = String(data.length); } };
        },
        timeScale() { return { fitContent() {}, applyOptions() {} }; },
        applyOptions() {},
        resize() {},
        remove() { root.remove(); },
      };
    },
  };
`;

function latestForSlug(slug) {
  const row = prices.prices[slug];
  if (!row) return null;
  return {
    weight_oz: coinMeta[slug]?.weight || 1,
    median: row.median_price,
    median_price: row.median_price,
    low: row.lowest_price,
    lowest_price: row.lowest_price,
    high: row.highest_price,
    highest_price: row.highest_price,
    window_start: GENERATED_AT,
    vendors: row.vendors,
  };
}

async function setupRetailFixture(page, options = {}) {
  const {
    savedTab,
    marketFilter,
    displayCurrency = "USD",
    exchangeRates = { EUR: 0.9 },
    failPrimary = false,
  } = options;

  await injectSeedInventory(page);

  await page.route("https://open.er-api.com/v6/latest/USD", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: "success", base_code: "USD", rates: exchangeRates }),
    });
  });

  await page.route("https://cdn.jsdelivr.net/npm/lightweight-charts@4/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: lightweightChartsStub,
    });
  });

  await page.addInitScript(
    ({ seeded, meta, vendors, saved, filter, currency, rates }) => {
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
      writeJson("displayCurrency", currency);
      writeJson("exchangeRates", rates);
      localStorage.setItem("retailManifestGeneratedAt", seeded.generatedAt);
      localStorage.setItem("spotSilver", JSON.stringify(36));
      localStorage.setItem("spotGold", JSON.stringify(2000));
      if (saved !== undefined) writeJson("vendorPricesActiveTab", saved);
      if (filter) writeJson("staktrakr.market_filter", filter);
      window.LightweightCharts = {
        CrosshairMode: { Normal: 0 },
        createChart(container) {
          const root = document.createElement("div");
          root.className = "tv-lightweight-charts";
          container.appendChild(root);
          return {
            addLineSeries() {
              return {
                setData(data) {
                  root.dataset.pointCount = String(data.length);
                },
              };
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
    {
      seeded: { prices, history: historyRows, intraday: intradayRows, generatedAt: GENERATED_AT },
      meta: coinMeta,
      vendors: vendorMeta,
      saved: savedTab,
      filter: marketFilter,
      currency: displayCurrency,
      rates: exchangeRates,
    }
  );

  const fulfillV2 = async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/data\/v2\//, "");
    if (path === "manifest.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 2,
          generated_at: GENERATED_AT,
          data: {
            coins: Object.entries(coinMeta).map(([slug, meta]) => ({
              slug,
              name: meta.name,
              weight_oz: meta.weight,
              metal: meta.metal === "silver" ? "xag" : meta.metal === "gold" ? "xau" : meta.metal,
            })),
            vendors: VENDORS,
          },
        }),
      });
      return;
    }
    if (path === "providers.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ v: 2, generated_at: GENERATED_AT, data: { coins: {} } }),
      });
      return;
    }
    if (path === "goldback/latest.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 2,
          generated_at: GENERATED_AT,
          data: { g1_usd: GOLDBACK_G1_RATE },
        }),
      });
      return;
    }
    const match = path.match(/^retail\/([^/]+)\/([^/]+)\.json$/);
    if (!match) {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return;
    }
    const [, slug, file] = match;
    const data =
      file === "latest"
        ? latestForSlug(slug)
        : file === "intraday"
          ? intradayRows[slug]
          : file.startsWith("history-")
            ? historyRows[slug]
            : null;
    await route.fulfill({
      status: data ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(data ? { v: 2, generated_at: GENERATED_AT, data } : {}),
    });
  };

  const failV2 = async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  };

  // STRK-188: failPrimary simulates an api1 (GitHub Pages) outage — the primary
  // endpoint returns 503 while api2 (Fly.io) serves the fixtures, exercising the
  // ordered failover in the market data fetch path.
  await page.route("https://api.staktrakr.com/data/v2/**", failPrimary ? failV2 : fulfillV2);
  await page.route("https://api2.staktrakr.com/data/v2/**", failPrimary ? fulfillV2 : failV2);

  // Freeze Date for the market-history 7-day window across the seeded
  // RECENT_DATE fixtures. setFixedTime pins Date.now()/new Date() at FIXED_NOW
  // permanently (install()/setSystemTime() would let it tick forward from the
  // seed instead). Playwright still installs faked timers but drives them in
  // real time, so setTimeout/requestAnimationFrame keep firing and app boot /
  // chart / exchange-rate logic runs normally — we pin the clock, not pause it.
  await page.clock.setFixedTime(FIXED_NOW);

  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.renderVendorPrices === "function" &&
      typeof window.refreshMarketData === "function" &&
      typeof window.showSettingsModal === "function"
  );
  // STRK-148 de-flake: boot's awaited loadSeedSpotHistory() pushes the seed
  // bundle's gold spot (~$4456) into spotPrices.gold AFTER the function-existence
  // wait above, via fetchSpotPrice(). Wait for that boot seed write to land
  // BEFORE the override below, so the override is the last writer and isn't
  // clobbered before refreshMarketData() reads it. (Latent race surfaced by
  // STRK-141's awaited boot-hydration timing; not a product bug — see STRK-148.)
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

const getActiveTab = (page) =>
  page.locator(".vendor-prices-tabs button.active").getAttribute("data-metal");

const getTabLabels = async (page) =>
  (await page.locator(".vendor-prices-tabs button").allTextContents()).map((label) => label.trim());

const getRows = async (page) =>
  (await page.locator(".vendor-prices-table tbody tr td:first-child").allTextContents())
    .map((row) => row.trim())
    .filter(Boolean);

async function getVendorCellText(page, rowName, vendorHeader) {
  return page.locator(".vendor-prices-table").evaluate(
    (table, args) => {
      const headers = Array.from(table.querySelectorAll("thead th")).map((th) =>
        th.textContent.trim()
      );
      const columnIndex = headers.indexOf(args.vendorHeader);
      const row = Array.from(table.querySelectorAll("tbody tr")).find(
        (tr) => tr.querySelector("td:first-child")?.textContent.trim() === args.rowName
      );
      return row?.children[columnIndex]?.textContent.trim() || null;
    },
    { rowName, vendorHeader }
  );
}

test.describe("core/retail-market", () => {
  test("matrix defaults to All, sorts rows and vendor columns, and uses per-metal premium math", async ({
    page,
  }) => {
    await setupRetailFixture(page);

    expect(await getTabLabels(page)).toEqual(["All", "Gold", "Silver", "Goldback"]);
    expect(await getActiveTab(page)).toBe("all");
    expect(await getRows(page)).toEqual([
      "Alpha Gold Coin",
      "Zulu Gold Coin",
      "Alpha Silver Bar",
      "Middle Silver Coin",
      "Zebra Silver Round",
      "Utah 1 Goldback",
    ]);

    const headers = await page.locator(".vendor-prices-table thead th").allTextContents();
    expect(
      headers.map((h) => h.trim()).filter((h) => !["ITEM", "MEDIAN", "SPREAD"].includes(h))
    ).toEqual(["APMEX", "BullionX", "Goldback", "Hero", "JM"]);

    expect(await getVendorCellText(page, "Alpha Gold Coin", "APMEX")).toContain("+10.0%");
    expect(await getVendorCellText(page, "Alpha Silver Bar", "APMEX")).toContain("+5.6%");
    expect(await getVendorCellText(page, "Utah 1 Goldback", "Goldback")).toContain("+20.0%");
  });

  test("saved tabs, per-metal tabs, and filter matrix exclusions all constrain visible rows", async ({
    page,
  }) => {
    await setupRetailFixture(page, {
      savedTab: "xag",
      marketFilter: { [SLUG_GOLD_Z]: { jmbullion: false } },
    });

    expect(await getActiveTab(page)).toBe("xag");
    expect(await getRows(page)).toEqual([
      "Alpha Silver Bar",
      "Middle Silver Coin",
      "Zebra Silver Round",
    ]);

    await page.locator('.vendor-prices-tabs button[data-metal="all"]').click();
    expect(await getRows(page)).toEqual([
      "Alpha Gold Coin",
      "Alpha Silver Bar",
      "Middle Silver Coin",
      "Zebra Silver Round",
      "Utah 1 Goldback",
    ]);
    await expect(page.locator(".vendor-prices-table")).not.toContainText("Zulu Gold Coin");

    await page.evaluate(() => window.showSettingsModal("market"));
    const matrix = page.locator("#marketFilterMatrix");
    await expect(matrix).toBeVisible();
    const toggle = matrix.locator(`input[data-slug="${SLUG_SILVER_A}"][data-vendor="apmex"]`);
    await expect(toggle).toBeChecked();
    await toggle.click();
    expect(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), MARKET_FILTER_KEY)
    ).toEqual({ [SLUG_GOLD_Z]: { jmbullion: false }, [SLUG_SILVER_A]: { apmex: false } });
  });

  test("Goldback premiums render consistently in ticker, matrix, and detail modal", async ({
    page,
  }) => {
    await setupRetailFixture(page);

    const tickerPremium = page
      .locator(".ticker-block[data-ticker-block='primary'] .ticker-item")
      .filter({ hasText: "Goldback" })
      .locator(".premium");
    await expect(tickerPremium).toHaveText("+20.0%");
    await expect(tickerPremium).toHaveClass(/\bhigh\b/);

    const matrixBadge = page
      .locator(".vendor-prices-table tbody tr")
      .filter({ hasText: "Goldback" })
      .locator(".vp-premium");
    await expect(matrixBadge).toHaveText("+20.0%");
    await expect(matrixBadge).toHaveClass(/\bhigh\b/);

    await page.evaluate((slug) => window.openMarketDetailModal(slug), SLUG_GOLDBACK);
    const detailBadge = page.locator("#marketDetailContent .vp-premium");
    await expect(detailBadge.first()).toHaveText("+20.0%");
    await expect(detailBadge.first()).toHaveClass(/\bhigh\b/);
  });

  test("retail ticker, matrix, history, and detail modal follow display currency changes", async ({
    page,
  }) => {
    await setupRetailFixture(page);

    const ticker = page.locator("#bestPriceTickerEl");
    const matrix = page.locator(".vendor-prices-table");
    await expect(ticker).toContainText("$");
    await expect(matrix).toContainText("$38.00");

    await page.evaluate(() => window.showSettingsModal("changelog"));
    await page.waitForTimeout(250);
    await page.locator('[data-log-tab="market"]').click();
    await page.locator("#retailHistorySlugSelect").selectOption(SLUG_SILVER_A);
    const historyTable = page.locator("#retailHistoryTableBody");
    await expect(historyTable).toContainText("$38.00");

    await page.evaluate(() => window.saveDisplayCurrency("EUR"));
    await expect(ticker).toContainText("€");
    await expect(matrix).toContainText("€");
    await expect(historyTable).toContainText("€");
    await expect(page.locator("#vendorPricesContainer")).toContainText(CURRENCY_DISCLAIMER);

    await page.evaluate((slug) => window.openMarketDetailModal(slug), SLUG_SILVER_A);
    const modalContent = page.locator("#marketDetailContent");
    await expect(modalContent).toContainText("€");
    await expect(modalContent).toContainText(CURRENCY_DISCLAIMER);
  });

  test("unresolved retail slugs are rejected before filter and render paths", async ({ page }) => {
    await setupRetailFixture(page);

    await page.waitForFunction(() => typeof window._isSlugResolved === "function");
    expect(await page.evaluate((slug) => window._isSlugResolved(slug), SYNTHETIC_UNRESOLVED)).toBe(
      false
    );
    expect(
      await page.evaluate((slug) => window._isSlugResolved(slug), SYNTHETIC_UNKNOWN_METAL)
    ).toBe(false);
    expect(await page.evaluate((slug) => window._isSlugResolved(slug), SLUG_SILVER_A)).toBe(true);

    const activeSlugs = await page.evaluate(() => window.getActiveRetailSlugs());
    expect(activeSlugs).not.toContain(SYNTHETIC_UNRESOLVED);
    await expect(page.locator(`[data-slug="${SYNTHETIC_UNRESOLVED}"]`)).toHaveCount(0);
  });

  test("retail detail modal renders current and intraday chart data from active matrix rows", async ({
    page,
  }) => {
    await setupRetailFixture(page);

    await page
      .locator(".vendor-prices-table .vp-coin-link", { hasText: "Alpha Silver Bar" })
      .click();

    await expect(page.locator("#marketDetailModal")).toBeVisible();
    await expect(page.locator("#marketDetailTitle")).toContainText("Alpha Silver Bar");
    await expect(page.locator("#marketDetailChartArea .tv-lightweight-charts")).toHaveAttribute(
      "data-point-count",
      /[1-9]/
    );

    await page.locator('#marketDetailContent button[data-period="24h"]').click();
    await expect(page.locator("#marketDetailChartArea .tv-lightweight-charts")).toHaveAttribute(
      "data-point-count",
      /[1-9]/
    );
  });

  test("market detail modal fails over to api2 when the primary API is down (STRK-188)", async ({
    page,
  }) => {
    await setupRetailFixture(page, { failPrimary: true });

    await page
      .locator(".vendor-prices-table .vp-coin-link", { hasText: "Alpha Silver Bar" })
      .click();

    await expect(page.locator("#marketDetailModal")).toBeVisible();
    await expect(page.locator("#marketDetailTitle")).toContainText("Alpha Silver Bar");
    // The modal chart renders only from the fetched history/intraday feeds —
    // there is no localStorage fallback in this path. With api1 down, a rendered
    // chart proves the api2 failover delivered the data.
    await expect(page.locator("#marketDetailChartArea .tv-lightweight-charts")).toHaveAttribute(
      "data-point-count",
      /[1-9]/
    );

    await page.locator('#marketDetailContent button[data-period="24h"]').click();
    await expect(page.locator("#marketDetailChartArea .tv-lightweight-charts")).toHaveAttribute(
      "data-point-count",
      /[1-9]/
    );
  });
});

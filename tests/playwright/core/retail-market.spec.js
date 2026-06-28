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
    // STRK-249 (review finding #2): instead of failing api1, serve api1 a
    // stale-but-200 goldback/latest.json envelope (HTTP 200, but generated_at
    // is stalePrimaryAgeMs in the past) while api2 serves a FRESH envelope. This
    // exercises the strict-freshness gate-rejection failover path that the hard
    // api1=503 case (failPrimary) skips — the 503 throws on !resp.ok BEFORE the
    // `validate` gate ever runs. Backward-compatible: off unless stalePrimary set.
    stalePrimary = false,
    stalePrimaryRate, // g1_usd carried by the api1 STALE 200 envelope
    stalePrimaryAgeMs, // age of the api1 envelope's generated_at vs FIXED_NOW
    freshSecondaryRate, // g1_usd carried by the api2 FRESH 200 envelope
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

  // STRK-249 (review finding #2): api1 goldback handler that returns a stale-but-200
  // envelope (HTTP 200, generated_at = stalePrimaryAgeMs in the past, but a positive
  // stale_after so the strict gate has a budget to test against). All other api1 paths
  // fall through to fulfillV2 so the manifest + per-slug details still load normally.
  const STALE_AFTER_SECONDS = 90000; // production goldback stale_after (~25h gate budget)
  const goldbackStaleV2 = async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/data\/v2\//, "");
    if (path !== "goldback/latest.json") return fulfillV2(route);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        v: 2,
        generated_at: new Date(FIXED_NOW.getTime() - stalePrimaryAgeMs).toISOString(),
        stale_after: STALE_AFTER_SECONDS,
        data: { g1_usd: stalePrimaryRate },
      }),
    });
  };

  // STRK-249 (review finding #2): api2 goldback handler that returns a FRESH 200
  // envelope (generated_at ≈ FIXED_NOW) with a DISTINCT g1_usd, so the rendered
  // goldback premium unambiguously identifies whether api1 (stale) or api2 (fresh) won.
  const goldbackFreshV2 = async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/data\/v2\//, "");
    if (path !== "goldback/latest.json") return fulfillV2(route);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        v: 2,
        generated_at: FIXED_NOW.toISOString(),
        stale_after: STALE_AFTER_SECONDS,
        data: { g1_usd: freshSecondaryRate },
      }),
    });
  };

  // STRK-188: failPrimary simulates an api1 (GitHub Pages) outage — the primary
  // endpoint returns 503 while api2 (Fly.io) serves the fixtures, exercising the
  // ordered failover in the market data fetch path.
  if (stalePrimary) {
    // api1 serves a stale-but-200 goldback envelope (and normal fixtures otherwise);
    // api2 serves a fresh goldback envelope (and normal fixtures otherwise). The
    // strict gate must reject api1's stale 200 and advance to api2's fresh rate.
    await page.route("https://api.staktrakr.com/data/v2/**", goldbackStaleV2);
    await page.route("https://api2.staktrakr.com/data/v2/**", goldbackFreshV2);
  } else {
    await page.route("https://api.staktrakr.com/data/v2/**", failPrimary ? failV2 : fulfillV2);
    await page.route("https://api2.staktrakr.com/data/v2/**", failPrimary ? fulfillV2 : failV2);
  }

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
  // STRK-213: the providers.json refresh must not hard-depend on AbortSignal.timeout,
  // which is absent on older runtimes. Its sibling v2 fetch helpers
  // (_pickFreshestV2Endpoint, _fetchV2Json) already use the AbortController + setTimeout
  // pattern; _fetchAndApplyV2Providers previously passed `signal: AbortSignal.timeout(5000)`,
  // which is evaluated synchronously as an argument — so on a runtime lacking that static
  // method the providers fetch threw before the request and was swallowed by the catch.
  // The result was silent provider staleness: price sync reported success while
  // retailProviders never refreshed. This test deletes AbortSignal.timeout, runs one sync,
  // and asserts the flattened provider map is still fetched and persisted.
  test("refreshes retail providers when AbortSignal.timeout is unavailable (STRK-213)", async ({
    page,
  }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    // Boot's background sync populates providers from the default mock. Wait for it so the
    // harness is proven working and the in-progress guard has cleared before our probe.
    await page.waitForFunction(
      () =>
        typeof window.syncRetailPrices === "function" &&
        window.retailProviders &&
        Object.keys(window.retailProviders).length > 0
    );

    const result = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      // Reset both observable sinks so a swallowed providers fetch leaves them empty.
      window.retailProviders = {};
      localStorage.removeItem("retailProviders");

      // Simulate an older runtime where the AbortSignal.timeout static method is absent.
      const realTimeout = AbortSignal.timeout;
      delete AbortSignal.timeout;
      try {
        // Ride past any still-in-flight boot sync: the _retailSyncInProgress guard turns a
        // colliding call into a silent no-op, so retry until a call actually runs the v2
        // sync. Once it does, the providers refresh either repopulates the map (fixed) or
        // stays empty (regressed) — never an infinite wait, since the deadline bounds it.
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          await window.syncRetailPrices({ ui: false });
          if (window.retailProviders && Object.keys(window.retailProviders).length > 0) break;
          await sleep(150);
        }
      } finally {
        AbortSignal.timeout = realTimeout;
      }

      const stored = localStorage.getItem("retailProviders");
      return {
        windowProviders: window.retailProviders,
        stored: stored ? JSON.parse(stored) : null,
      };
    });

    // The providers refresh must have run and persisted the flattened legacy
    // { slug: { vendorId: url } } map even with AbortSignal.timeout removed.
    expect(result.stored).toBeTruthy();
    expect(Object.keys(result.stored || {}).length).toBeGreaterThan(0);
    expect(result.stored["1oz-silver-eagle"]).toMatchObject({
      apmex: "https://www.apmex.com/product/1oz-silver-eagle",
      jmbullion: "https://www.jmbullion.com/product/1oz-silver-eagle",
    });
    expect(Object.keys(result.windowProviders || {}).length).toBeGreaterThan(0);
  });

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

  // =========================================================================
  // STRK-249 — AC-6 / AC-7: market-table goldback premium cells render in
  // LOCKSTEP with spot-based premiums (same paint when a fresh cached
  // goldbackPrices['1'] exists), then refine after the network fetch resolves.
  //
  // RED CONTRACT (fails until C.4 seeds _goldbackG1Rate from the goldback cache):
  //   js/market-data.js _goldbackG1Rate (`:113`) starts null and is only populated
  //   by the initMarketData() network fetch (`:1710-1725`). The three premium cell
  //   builders gate on `_goldbackG1Rate > 0` (_buildTickerItem `:396`,
  //   _buildModalVendorRow `:889`, _buildVendorPriceCell `:1364`). So on the FIRST
  //   synchronous paint — before the network resolves but WITH a fresh cache —
  //   spot-based premiums render while the goldback premium cell stays blank (AC-6).
  //   Once C.4 seeds the rate from goldbackPrices['1'], the goldback badge paints in
  //   the same pass; after the network fetch resolves it reflects the updated rate
  //   (AC-7).
  //
  // Asserted via DOM STRUCTURE: the goldback matrix row's `.vp-premium` badge cell
  // builder output, compared against a spot-premium badge in the same paint.
  // =========================================================================

  // A fresh cache rate distinct from the network g1_usd (GOLDBACK_G1_RATE = 4.25),
  // so AC-7's "updated rate" is observable: goldback vendor price 5.1 ÷ 5.0 = +2.0%
  // from cache, vs 5.1 ÷ 4.25 = +20.0% from the network.
  const GOLDBACK_CACHE_RATE = 5.0;
  const GOLDBACK_CACHE_PREMIUM = "+2.0%";
  const GOLDBACK_NETWORK_PREMIUM = "+20.0%";

  // Boot the retail matrix exactly like setupRetailFixture (full v2 manifest +
  // detail routes so spot-based premiums render), but with the goldback endpoint
  // FAILING so the boot initMarketData() leaves _goldbackG1Rate null (the only
  // network seeding path today) — while a FRESH goldbackPrices['1'] cache is seeded.
  // This is the same-paint condition AC-6 probes: spot premiums paint, and the
  // goldback premium should paint in lockstep from the cache (it does not yet).
  async function bootGoldbackMatrixCacheOnly(page) {
    await injectSeedInventory(page);

    await page.route("https://open.er-api.com/v6/latest/USD", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: "success", base_code: "USD", rates: { EUR: 0.9 } }),
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
      ({ seeded, meta, vendors, cacheRate }) => {
        const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
        writeJson("v2RetailPrices", seeded.prices);
        writeJson("retailPrices", seeded.prices);
        writeJson("v2RetailHistory", seeded.history);
        writeJson("retailPriceHistory", seeded.history);
        writeJson("v2RetailIntraday", seeded.intraday);
        writeJson("retailIntradayData", seeded.intraday);
        writeJson("retailManifestSlugs", Object.keys(meta));
        writeJson("retailManifestCoinMeta", meta);
        writeJson("retailManifestVendorMeta", vendors);
        localStorage.setItem("retailManifestGeneratedAt", seeded.generatedAt);
        localStorage.setItem("spotSilver", JSON.stringify(36));
        localStorage.setItem("spotGold", JSON.stringify(2000));
        // Goldback "api" mode + a FRESH goldbackPrices['1'] cache: a correct
        // implementation seeds _goldbackG1Rate from this on first render.
        writeJson("goldback-pricing-source", "api");
        writeJson("goldback-prices", {
          1: {
            price: cacheRate,
            updatedAt: Date.now(),
            source: "api",
            ts: Math.floor(Date.now() / 1000),
            staleAfter: 90000,
          },
        });
      },
      {
        seeded: { prices, history: historyRows, intraday: intradayRows, generatedAt: GENERATED_AT },
        meta: coinMeta,
        vendors: vendorMeta,
        cacheRate: GOLDBACK_CACHE_RATE,
      }
    );

    // Full v2 routing (mirrors setupRetailFixture's fulfillV2) so the manifest and
    // per-slug detail load and spot premiums compute — EXCEPT goldback/latest.json,
    // which fails on both hosts so _goldbackG1Rate stays null (network unseeded).
    const fulfillV2 = async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^\/data\/v2\//, "");
      if (path === "goldback/latest.json") {
        await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
        return;
      }
      if (path === "manifest.json") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            v: 2,
            generated_at: GENERATED_AT,
            data: {
              coins: Object.entries(coinMeta).map(([slug, m]) => ({
                slug,
                name: m.name,
                weight_oz: m.weight,
                metal: m.metal === "silver" ? "xag" : m.metal === "gold" ? "xau" : m.metal,
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
    await page.route("https://api.staktrakr.com/data/v2/**", fulfillV2);
    await page.route("https://api2.staktrakr.com/data/v2/**", async (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
    );

    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.renderVendorPrices === "function" &&
        typeof window.refreshMarketData === "function" &&
        typeof window.initMarketData === "function"
    );
    await page.waitForFunction(
      () => typeof spotPrices !== "undefined" && Number(spotPrices.gold) > 0
    );
    // Run initMarketData with the goldback endpoint failing: manifest + per-slug
    // detail load (so spot premiums render) but _goldbackG1Rate stays null.
    await page.evaluate(async () => {
      spotPrices.gold = 2000;
      spotPrices.silver = 36;
      await window.initMarketData?.();
      window.refreshMarketData();
    });
    await page.waitForSelector(".vendor-prices-table", { timeout: 10000 });
  }

  // Returns the `.vp-premium` badge text inside the goldback matrix row, or null.
  const goldbackMatrixBadge = (page) =>
    page
      .locator(".vendor-prices-table tbody tr")
      .filter({ hasText: "Goldback" })
      .locator(".vp-premium");

  test("AC-6: goldback premium cell renders in the same paint as spot premiums when a fresh cache exists", async ({
    page,
  }) => {
    await bootGoldbackMatrixCacheOnly(page);

    // Sanity: confirm the goldback row exists and a sibling SPOT-premium cell DID
    // paint in this pass (the cross-metal "All" view shares the same render).
    await page.locator('.vendor-prices-tabs button[data-metal="all"]').click();
    await page.waitForSelector(".vendor-prices-table", { timeout: 5000 });
    const silverBadge = page
      .locator(".vendor-prices-table tbody tr")
      .filter({ hasText: "Alpha Silver Bar" })
      .locator(".vp-premium");
    await expect(silverBadge.first()).toHaveText(/[+-]\d/);

    // RED: with _goldbackG1Rate unseeded from cache, the goldback premium cell is
    // blank in the very paint that already shows the spot-based silver premium.
    // After C.4 seeds the rate from goldbackPrices['1'], the badge paints here too,
    // reflecting the CACHE rate (5.1 ÷ 5.0 = +2.0%).
    const gbBadge = goldbackMatrixBadge(page);
    await expect(gbBadge).toHaveCount(1);
    await expect(gbBadge.first()).toHaveText(GOLDBACK_CACHE_PREMIUM);
  });

  test("AC-7: goldback premium cell reflects the updated rate after the network fetch resolves", async ({
    page,
  }) => {
    await bootGoldbackMatrixCacheOnly(page);

    // First paint reflects the CACHE rate (AC-6 lockstep precondition). RED here too:
    // the cache rate never seeds _goldbackG1Rate, so this badge is absent pre-network.
    const gbBadge = goldbackMatrixBadge(page);
    await expect(gbBadge).toHaveCount(1);
    await expect(gbBadge.first()).toHaveText(GOLDBACK_CACHE_PREMIUM);

    // Now let the network goldback fetch succeed and resolve.
    const fulfillGoldback = async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 2,
          generated_at: GENERATED_AT,
          data: { g1_usd: GOLDBACK_G1_RATE },
        }),
      });
    await page.route("https://api.staktrakr.com/data/v2/goldback/latest.json", fulfillGoldback);
    await page.evaluate(async () => {
      window._marketDataInitialized = false;
      await window.initMarketData();
      window.renderVendorPrices();
    });

    // After the network resolves, the premium cell reflects the UPDATED (network)
    // rate (5.1 ÷ 4.25 = +20.0%), not the prior cache rate.
    await expect(goldbackMatrixBadge(page).first()).toHaveText(GOLDBACK_NETWORK_PREMIUM);
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

  // =========================================================================
  // STRK-249 — AC-8 / AC-9: the two RAW api1-only market-data fetches must fail
  // over to api2 when the api1 origin is stale/down. Both fetches hardcode
  // V2_API ("https://api.staktrakr.com/data/v2") today and never reach api2:
  //   - AC-8 goldback-G1: js/market-data.js initMarketData() (`:1712`)
  //       `fetch(V2_API + "/goldback/latest.json")` — api1-only, so with api1
  //       down _goldbackG1Rate stays null and the goldback premium cell is blank.
  //   - AC-9 retail-detail: js/market-data.js _resolveVendorDetailMap() (`:1199`)
  //       `fetch(V2_API + "/retail/<slug>/latest.json")` — api1-only, so with api1
  //       down an un-cached slug never resolves a detail and its price cell stays "—".
  //
  // Both mirror the STRK-188 failover pattern: setupRetailFixture(page,
  // { failPrimary: true }) returns 503 from api1 while api2 serves the fixtures.
  // Service workers are blocked in the core Playwright project
  // (playwright.config.js:26), so these intercept as ordinary page fetches — the
  // C-5 SW short-circuit caveat (a stale-but-200 must NOT end the failover loop)
  // does not apply to this harness; here api1 is a hard 503.
  //
  // RED until C.5 routes BOTH raw fetches through _marketV2Fetch with the strict
  // `validate` gate, at which point the ordered V2_API_ENDPOINTS failover reaches
  // api2 and both rendered surfaces below reflect the api2 values.
  // =========================================================================

  test("AC-8: goldback-G1 fetch fails over to api2 so the goldback premium reflects the api2 G1 rate (STRK-249)", async ({
    page,
  }) => {
    // api1 down, api2 serves goldback/latest.json with g1_usd = GOLDBACK_G1_RATE
    // (4.25). No goldback cache is seeded, so _goldbackG1Rate's ONLY source is the
    // (api1-only) network fetch — isolating the AC-8 failover gap from C.4's cache
    // seeding. Goldback vendor price 5.1 / 4.25 = +20.0% once the api2 rate lands.
    await setupRetailFixture(page, { failPrimary: true });

    const matrixBadge = page
      .locator(".vendor-prices-table tbody tr")
      .filter({ hasText: "Goldback" })
      .locator(".vp-premium");

    // RED: the raw goldback fetch hits api1 only (503), never api2, so
    // _goldbackG1Rate stays null and the goldback premium badge never paints.
    // After C.5 routes it through _marketV2Fetch, failover reaches api2 and the
    // badge paints the api2-derived premium.
    await expect(matrixBadge).toHaveCount(1);
    await expect(matrixBadge.first()).toHaveText("+20.0%");
    await expect(matrixBadge.first()).toHaveClass(/\bhigh\b/);
  });

  // =========================================================================
  // STRK-249 — review finding #2: the AC-8 anti-short-circuit guard (a stale
  // api1 200 must NOT end the failover loop) currently has ZERO coverage. The
  // AC-8 test above drives api1 = hard 503, so _staktrakrFetch throws on
  // `!resp.ok` (api.js:53) BEFORE the strict `validate` gate ever runs — the
  // _strictMarketFreshness rejection path is never exercised.
  //
  // This test closes that gap. api1 returns a STALE-but-200 goldback envelope
  // (HTTP 200, generated_at 3h before FIXED_NOW, stale_after 90000s) and api2
  // returns a FRESH 200 envelope with a DISTINCT g1_usd. The rendered goldback
  // premium tells us which endpoint's rate won:
  //   - api1 STALE rate 3.0  -> goldback vendor price 5.1 / 3.0 = +70.0%
  //   - api2 FRESH rate 5.0  -> goldback vendor price 5.1 / 5.0 =  +2.0%
  //
  // RED TODAY: _strictMarketFreshness uses { multiplier: 1, floorMs: 0 }, so the
  // accept budget is stale_after itself = 90000s ~ 25h. A 3h-old envelope (well
  // under 25h) PASSES the gate, so api1's stale 200 is accepted and short-circuits
  // the loop -- the premium renders the api1 STALE rate (+70.0%), and the api2 FRESH
  // assertion (+2.0%) FAILS. This proves the stale-200 short-circuit bug.
  //
  // GREEN after finding #1: once an absolute realtime cap (~2h) is added to the
  // goldback freshness regime, the 3h api1 envelope is REJECTED, failover advances
  // to api2's fresh 200, and the premium reflects the api2 rate (+2.0%). Production
  // (finding #1) is out of scope here -- this RED test only locks the contract.
  // =========================================================================
  test("AC-8/AC-9 guard: a stale-but-200 api1 goldback envelope is rejected by the strict gate and fails over to the api2 fresh rate (STRK-249)", async ({
    page,
  }) => {
    // api1 = stale-but-200 (generated_at 3h before FIXED_NOW, > the incoming 2h
    // realtime cap but < the 25h stale_after), api2 = fresh, distinct rates. No
    // goldback cache is seeded, so _goldbackG1Rate's only source is this network
    // fetch -- isolating the strict-gate failover from C.4's cache seeding.
    await setupRetailFixture(page, {
      stalePrimary: true,
      stalePrimaryAgeMs: 3 * 60 * 60 * 1000, // 3h
      stalePrimaryRate: 3.0, // 5.1 / 3.0 = +70.0% (api1 stale, wins today)
      freshSecondaryRate: 5.0, // 5.1 / 5.0 =  +2.0% (api2 fresh, wins after #1)
    });

    const matrixBadge = page
      .locator(".vendor-prices-table tbody tr")
      .filter({ hasText: "Goldback" })
      .locator(".vp-premium");

    // RED: today's 25h gate budget accepts the 3h-old api1 200, so it short-circuits
    // the failover loop and the premium renders the api1 STALE rate (+70.0%) -- this
    // assertion FAILS. After finding #1 adds the 2h realtime cap, the 3h api1 200 is
    // rejected, failover reaches api2, and the premium renders the api2 FRESH rate.
    await expect(matrixBadge).toHaveCount(1);
    await expect(matrixBadge.first()).toHaveText("+2.0%");
  });

  test("AC-9: retail-detail latest.json fetch fails over to api2 so the matrix consumes the api2 price (STRK-249)", async ({
    page,
  }) => {
    // Boot with api1 DOWN and api2 serving fulfillV2, but pin the seeded summary
    // FRESH (lastSync = FIXED_NOW) and seed providers so retail.js's boot sync — a
    // SEPARATE data path that would otherwise pre-resolve every slug from api2 and
    // mask this gap — is skipped. With sync skipped, market-data.js's render-time
    // _resolveVendorDetailMap (`:1199`) is the SOLE network path for SLUG_SILVER_A,
    // whose vendor detail is stripped from the summary so it is never cache-resolved.
    // Its detail therefore resolves ONLY from that fetch; today the fetch is hardcoded
    // to V2_API (api1) and never reaches api2, so _buildVendorTableRow omits the row
    // entirely (no detail.vendors). After C.5's failover the fetch reaches api2, the
    // detail resolves, and the SLUG_SILVER_A row + its APMEX price cell paint.
    await page.route("https://open.er-api.com/v6/latest/USD", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: "success", base_code: "USD", rates: { EUR: 0.9 } }),
      });
    });
    await page.route("https://cdn.jsdelivr.net/npm/lightweight-charts@4/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: lightweightChartsStub,
      });
    });

    await injectSeedInventory(page);
    await page.addInitScript(
      ({ seeded, meta, vendors, freshSync, uncachedSlug }) => {
        const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
        // Fresh-stamp the summary and strip the target slug's vendors so it is the
        // only un-cached row (must be fetched), while every other slug renders from
        // cache. lastSync = freshSync keeps retail.js's boot sync from triggering.
        const summary = JSON.parse(JSON.stringify(seeded.prices));
        summary.lastSync = freshSync;
        if (summary.prices[uncachedSlug]) delete summary.prices[uncachedSlug].vendors;
        writeJson("v2RetailPrices", summary);
        writeJson("retailPrices", summary);
        writeJson("v2RetailHistory", seeded.history);
        writeJson("retailPriceHistory", seeded.history);
        writeJson("v2RetailIntraday", seeded.intraday);
        writeJson("retailIntradayData", seeded.intraday);
        writeJson("retailManifestSlugs", Object.keys(meta));
        writeJson("retailManifestCoinMeta", meta);
        writeJson("retailManifestVendorMeta", vendors);
        // Non-empty providers → retail.js boot sync's missingProviders gate is false.
        writeJson("retailProviders", { [uncachedSlug]: { apmex: "https://apmex.com/x" } });
        writeJson("displayCurrency", "USD");
        writeJson("exchangeRates", { EUR: 0.9 });
        localStorage.setItem("retailManifestGeneratedAt", seeded.generatedAt);
        localStorage.setItem("spotSilver", JSON.stringify(36));
        localStorage.setItem("spotGold", JSON.stringify(2000));
      },
      {
        seeded: { prices, history: historyRows, intraday: intradayRows, generatedAt: GENERATED_AT },
        meta: coinMeta,
        vendors: vendorMeta,
        freshSync: FIXED_NOW.toISOString(),
        uncachedSlug: SLUG_SILVER_A,
      }
    );

    // api2 serves the v2 fixtures (manifest + per-slug latest.json, incl. the
    // stripped slug with its real vendors); api1 is hard-down (503). Mirrors
    // setupRetailFixture's fulfillV2 routing under failPrimary.
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
              coins: Object.entries(coinMeta).map(([slug, m]) => ({
                slug,
                name: m.name,
                weight_oz: m.weight,
                metal: m.metal === "silver" ? "xag" : m.metal === "gold" ? "xau" : m.metal,
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
    await page.route("https://api.staktrakr.com/data/v2/**", async (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
    );
    await page.route("https://api2.staktrakr.com/data/v2/**", fulfillV2);

    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
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
      spotPrices.gold = 2000;
      spotPrices.silver = 36;
      await window.initMarketData?.();
      window.refreshMarketData();
    });
    await page.waitForSelector(".vendor-prices-table", { timeout: 10000 });

    // Coalesce the missing-cell sentinel to "" so the RED state reads as the
    // absent api2 price (not a null-matcher error). Today the SLUG_SILVER_A row is
    // omitted entirely (its detail never resolved), so getVendorCellText is null.
    const apmexCell = async () =>
      (await getVendorCellText(page, "Alpha Silver Bar", "APMEX")) ?? "";

    // RED: the render-time latest.json fetch hits api1 only (503), never api2, so
    // _resolveVendorDetailMap resolves no detail for the un-cached slug — its row
    // (and APMEX price cell) never paints. After C.5 routes the fetch through
    // _marketV2Fetch, failover reaches api2's latest.json (APMEX vendor price 38)
    // and the matrix consumes the api2 price.
    await expect.poll(apmexCell, { timeout: 8000 }).toContain("$38.00");
  });
});

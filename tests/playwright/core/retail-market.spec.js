import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

const MARKET_FILTER_KEY = "staktrakr.market_filter";
const GOLDBACK_G1_RATE = 4.25;
const GENERATED_AT = "2026-05-26T12:00:00.000Z";
const RECENT_DATE = "2026-05-24";
const RECENT_TS = Math.floor(new Date(`${RECENT_DATE}T18:00:00Z`).getTime() / 1000);
const RECENT_INTRADAY_ISO = "2026-05-26T12:00:00.000Z";
const RECENT_INTRADAY_TS = Math.floor(new Date(RECENT_INTRADAY_ISO).getTime() / 1000);
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
        t: RECENT_INTRADAY_ISO,
        ts: RECENT_INTRADAY_TS,
        median: row.price,
        low: row.price,
        vendors: { [row.vendor]: row.price },
      },
    ],
  ])
);

/**
 * Converts an ISO 8601 timestamp to Unix seconds for lightweight-charts time values.
 * @param {string} iso - ISO 8601 date/time string.
 * @returns {number} Unix timestamp in seconds.
 */
const toUnixSeconds = (iso) => Math.floor(new Date(iso).getTime() / 1000);

const STRK260_INTRADAY_ROWS = [
  {
    t: "2026-05-25T17:59:59.000Z",
    ts: toUnixSeconds("2026-05-25T17:59:59.000Z"),
    vendors: { herobullion: 999 },
  },
  {
    t: "2026-05-25T18:00:00.000Z",
    ts: toUnixSeconds("2026-05-25T18:00:00.000Z"),
    vendors: { herobullion: 101, apmex: 105 },
  },
  {
    t: "2026-05-26T12:00:00.000Z",
    ts: toUnixSeconds("2026-05-26T12:00:00.000Z"),
    vendors: {
      herobullion: 109,
      jmbullion: "107",
      goldback: 0,
      bullionexchanges: -5,
    },
  },
  {
    t: "2026-05-26T18:00:00.000Z",
    ts: toUnixSeconds("2026-05-26T18:00:00.000Z"),
    vendors: { apmex: 111, jmbullion: "not-a-number" },
  },
  {
    t: "invalid",
    ts: "invalid",
    vendors: { herobullion: 600 },
  },
  {
    t: "2026-05-26T18:00:01.000Z",
    ts: toUnixSeconds("2026-05-26T18:00:01.000Z"),
    vendors: { herobullion: 500 },
  },
];

// STRK-276: two herobullion rows inside the SAME unix second. `ts` is omitted
// deliberately so _parseMarketDetailTime falls through to the millisecond-
// precision `t` field (js/market-data.js:777) — that yields distinct timeMs
// but an identical intraday chartTime of Math.floor(timeMs / 1000), which is
// exactly the collision the intraday path had no dedup for.
const STRK276_SAME_SECOND_INTRADAY_ROWS = [
  { t: "2026-05-26T17:00:00.000Z", vendors: { herobullion: 100 } },
  { t: "2026-05-26T17:59:59.200Z", vendors: { herobullion: 120 } },
  { t: "2026-05-26T17:59:59.800Z", vendors: { herobullion: 130 } },
];

const STRK260_HISTORY_30D_ROWS = [
  {
    t: "2026-04-26T17:59:59.000Z",
    ts: toUnixSeconds("2026-04-26T17:59:59.000Z"),
    vendors: { bullionexchanges: { avg: 999 } },
  },
  {
    t: "2026-04-26T18:00:00.000Z",
    ts: toUnixSeconds("2026-04-26T18:00:00.000Z"),
    vendors: { herobullion: { avg: 31 } },
  },
  {
    t: "2026-04-30T12:00:00.000Z",
    ts: toUnixSeconds("2026-04-30T12:00:00.000Z"),
    vendors: { apmex: { avg: "35" } },
  },
  {
    t: "2026-05-19T17:59:59.000Z",
    ts: toUnixSeconds("2026-05-19T17:59:59.000Z"),
    vendors: { jmbullion: { avg: 61 } },
  },
  {
    t: "2026-05-19T18:00:00.000Z",
    ts: toUnixSeconds("2026-05-19T18:00:00.000Z"),
    vendors: { herobullion: { avg: 71 }, apmex: { avg: 75 } },
  },
  {
    t: "2026-05-23T12:00:00.000Z",
    ts: toUnixSeconds("2026-05-23T12:00:00.000Z"),
    vendors: { herobullion: { avg: 79 } },
  },
  {
    t: "2026-05-26T12:00:00.000Z",
    ts: toUnixSeconds("2026-05-26T12:00:00.000Z"),
    vendors: {
      apmex: { avg: 85 },
      jmbullion: { avg: 0 },
      goldback: { avg: -4 },
      bullionexchanges: { avg: "not-a-number" },
      summitmetals: { avg: "Infinity" },
      providentmetals: {},
    },
  },
  {
    t: "invalid",
    ts: "invalid",
    vendors: { apmex: { avg: 500 } },
  },
  {
    t: "2026-05-26T18:00:01.000Z",
    ts: toUnixSeconds("2026-05-26T18:00:01.000Z"),
    vendors: { apmex: { avg: 700 } },
  },
];

const STRK260_HISTORY_90D_ROWS = [
  {
    t: "2026-02-25T17:59:59.000Z",
    ts: toUnixSeconds("2026-02-25T17:59:59.000Z"),
    vendors: { herobullion: { avg: 15 } },
  },
  {
    t: "2026-02-25T18:00:00.000Z",
    ts: toUnixSeconds("2026-02-25T18:00:00.000Z"),
    vendors: { apmex: { avg: 25 } },
  },
  {
    t: "2026-03-01T12:00:00.000Z",
    ts: toUnixSeconds("2026-03-01T12:00:00.000Z"),
    vendors: { herobullion: { avg: 35 } },
  },
  {
    t: "2026-03-27T17:59:59.000Z",
    ts: toUnixSeconds("2026-03-27T17:59:59.000Z"),
    vendors: { herobullion: { avg: 44 } },
  },
  {
    t: "2026-03-27T18:00:00.000Z",
    ts: toUnixSeconds("2026-03-27T18:00:00.000Z"),
    vendors: { apmex: { avg: 45 } },
  },
  {
    t: "2026-04-26T18:00:00.000Z",
    ts: toUnixSeconds("2026-04-26T18:00:00.000Z"),
    vendors: { herobullion: { avg: 55 } },
  },
  {
    t: "2026-05-26T12:00:00.000Z",
    ts: toUnixSeconds("2026-05-26T12:00:00.000Z"),
    vendors: { apmex: { avg: 65 }, jmbullion: { avg: null } },
  },
  {
    t: "2026-05-27T12:00:00.000Z",
    ts: toUnixSeconds("2026-05-27T12:00:00.000Z"),
    vendors: { apmex: { avg: 800 } },
  },
];

const STRK260_MODAL_FEEDS = {
  [SLUG_SILVER_A]: {
    intraday: STRK260_INTRADAY_ROWS,
    "history-30d": STRK260_HISTORY_30D_ROWS,
    "history-90d": STRK260_HISTORY_90D_ROWS,
  },
};

const STRK260_ALL_INVALID_HISTORY_ROWS = [
  {
    t: "2026-05-26T12:00:00.000Z",
    ts: toUnixSeconds("2026-05-26T12:00:00.000Z"),
    vendors: {
      herobullion: { avg: 0 },
      apmex: { avg: -3 },
      jmbullion: { avg: "not-a-number" },
      goldback: { avg: null },
    },
  },
  {
    t: "invalid",
    ts: "invalid",
    vendors: { herobullion: { avg: 55 } },
  },
  {
    // Non-intraday periods now bound by UTC calendar date (STRK-260
    // fix), so a same-day-but-later timestamp no longer excludes a row — this
    // has to be a genuinely future calendar date to stay excluded and keep
    // this fixture's "every row is invalid or out of window" guarantee.
    t: "2026-05-27T12:00:00.000Z",
    ts: toUnixSeconds("2026-05-27T12:00:00.000Z"),
    vendors: { apmex: { avg: 65 } },
  },
];

const STRK260_UNAVAILABLE_SUMMARY = {
  Median: "—",
  Low: "—",
  High: "—",
  Spread: "—",
};

const STRK260_PERIOD_EXPECTATIONS = {
  "24H": {
    id: "24h",
    label: "24H",
    summary: {
      Median: "$107.00",
      Low: "$101.00",
      High: "$111.00",
      Spread: "$10.00",
    },
    series: [
      {
        title: "APMEX",
        data: [
          { time: toUnixSeconds("2026-05-25T18:00:00.000Z"), value: 105 },
          { time: toUnixSeconds("2026-05-26T18:00:00.000Z"), value: 111 },
        ],
      },
      {
        title: "Hero",
        data: [
          { time: toUnixSeconds("2026-05-25T18:00:00.000Z"), value: 101 },
          { time: toUnixSeconds("2026-05-26T12:00:00.000Z"), value: 109 },
        ],
      },
      {
        title: "JM",
        data: [{ time: toUnixSeconds("2026-05-26T12:00:00.000Z"), value: 107 }],
      },
    ],
  },
  // STRK-260: 7D/30D/60D/90D expectations below bound rows by UTC
  // calendar date (start exclusive, end inclusive — see market-data.js
  // _buildMarketDetailRangeModel), not exact milliseconds. Two fixture rows
  // shift as a direct, verified consequence:
  //   - STRK260_HISTORY_30D_ROWS' 2026-05-26T18:00:01Z apmex=700 row (one
  //     second past FIXED_NOW) is on the SAME UTC calendar date as "today"
  //     (2026-05-26), so it is now correctly retained by the 7D/30D windows
  //     and, being the chronologically-latest 05-26 observation, wins the
  //     existing same-day "latest wins" Vendor dedup over the noon row
  //     (apmex avg 85) — replacing the 05-26 APMEX point's value with 700 in
  //     both 7D and 30D. This is the intended fix: a real publisher daily
  //     bucket only ever has ONE row per (vendor, date), stamped at noon UTC,
  //     so this two-rows-same-day case can't occur outside this synthetic
  //     boundary fixture.
  //   - The 2026-04-26T18:00:00Z / 2026-05-19T18:00:00Z / 2026-02-25T18:00:00Z
  //     rows sit exactly on their period's startDate (the day exactly N
  //     calendar days before "today"). Under the old millisecond compare they
  //     happened to be included (timeMs === startMs) only because FIXED_NOW's
  //     time-of-day (18:00 UTC) is after the rows' noon-UTC stamp; that was
  //     the reported inconsistency (the same nominal "7D" window silently
  //     gaining or losing this boundary day depending on what time of day
  //     "now" fell at). The new exclusive-start rule deterministically drops
  //     the startDate day so every period spans exactly N calendar dates
  //     (today plus the N-1 preceding days), regardless of time-of-day.
  "7D": {
    id: "7d",
    label: "7D",
    summary: {
      Median: "$389.50",
      Low: "$79.00",
      High: "$700.00",
      Spread: "$621.00",
    },
    series: [
      {
        title: "APMEX",
        data: [{ time: "2026-05-26", value: 700 }],
      },
      {
        title: "Hero",
        data: [{ time: "2026-05-23", value: 79 }],
      },
    ],
  },
  "30D": {
    id: "30d",
    label: "30D",
    summary: {
      Median: "$73.00",
      Low: "$35.00",
      High: "$700.00",
      Spread: "$665.00",
    },
    series: [
      {
        title: "APMEX",
        data: [
          { time: "2026-04-30", value: 35 },
          { time: "2026-05-19", value: 75 },
          { time: "2026-05-26", value: 700 },
        ],
      },
      {
        title: "Hero",
        data: [
          { time: "2026-05-19", value: 71 },
          { time: "2026-05-23", value: 79 },
        ],
      },
      {
        title: "JM",
        data: [{ time: "2026-05-19", value: 61 }],
      },
    ],
  },
  "60D": {
    id: "60d",
    label: "60D",
    summary: {
      Median: "$60.00",
      Low: "$55.00",
      High: "$65.00",
      Spread: "$10.00",
    },
    series: [
      {
        title: "APMEX",
        data: [{ time: "2026-05-26", value: 65 }],
      },
      {
        title: "Hero",
        data: [{ time: "2026-04-26", value: 55 }],
      },
    ],
  },
  "90D": {
    id: "90d",
    label: "90D",
    summary: {
      Median: "$45.00",
      Low: "$35.00",
      High: "$65.00",
      Spread: "$30.00",
    },
    series: [
      {
        title: "APMEX",
        data: [
          { time: "2026-03-27", value: 45 },
          { time: "2026-05-26", value: 65 },
        ],
      },
      {
        title: "Hero",
        data: [
          { time: "2026-03-01", value: 35 },
          { time: "2026-03-27", value: 44 },
          { time: "2026-04-26", value: 55 },
        ],
      },
    ],
  },
};

const STRK260_PERIODS = Object.values(STRK260_PERIOD_EXPECTATIONS);

const lightweightChartsStub = `
  (() => {
    const harness = window.__marketChartHarness || {
      nextId: 1,
      instances: [],
      removeCount: 0,
      removedIds: [],
      peakRootCount: 0,
      rootEvents: [],
    };
    harness.peakRootCount = harness.peakRootCount || 0;
    harness.rootEvents = harness.rootEvents || [];
    window.__marketChartHarness = harness;
    const cloneData = (data) => data.map((point) => ({ ...point }));
    const recordRootEvent = (type, id) => {
      const rootCount = document.querySelectorAll(
        "#marketDetailChartArea .tv-lightweight-charts"
      ).length;
      harness.peakRootCount = Math.max(harness.peakRootCount, rootCount);
      harness.rootEvents.push({ type, id, rootCount, at: performance.now() });
    };
    window.LightweightCharts = {
    CrosshairMode: { Normal: 0 },
    createChart(container, options = {}) {
      const root = document.createElement("div");
      root.className = "tv-lightweight-charts";
      root.dataset.testChart = "true";
      const instance = {
        id: harness.nextId++,
        containerId: container.id,
        options,
        appliedOptions: [],
        series: [],
        removed: false,
      };
      root.dataset.chartInstanceId = String(instance.id);
      container.appendChild(root);
      recordRootEvent("create", instance.id);
      harness.instances.push(instance);
      const addSeries = (type, seriesOptions = {}) => {
        const record = { type, options: seriesOptions, data: [] };
        instance.series.push(record);
        return {
          setData(data) {
            // STRK-276: model the real library's contract. Lightweight Charts
            // requires series data strictly ascending by time and asserts on
            // duplicate or out-of-order points, which surfaces in the app as
            // the whole view degrading to "Chart unavailable". The stub used to
            // accept anything, so no test could reproduce that failure mode.
            for (let i = 1; i < data.length; i += 1) {
              if (data[i].time <= data[i - 1].time) {
                throw new Error(
                  "Assertion failed: data must be asc ordered by time, index=" +
                    i +
                    ", time=" +
                    data[i].time +
                    ", prev time=" +
                    data[i - 1].time
                );
              }
            }
            record.data = cloneData(data);
            root.dataset.pointCount = String(
              instance.series.reduce((count, series) => count + series.data.length, 0)
            );
            if (type === "histogram") root.dataset.histogramCount = String(data.length);
            if (type === "area") root.dataset.areaCount = String(data.length);
          },
        };
      };
      return {
        addLineSeries(options) {
          return addSeries("line", options);
        },
        addHistogramSeries(options) {
          return addSeries("histogram", options);
        },
        addAreaSeries(options) {
          return addSeries("area", options);
        },
        timeScale() {
          return {
            fitContent() {
              instance.fitContentCount = (instance.fitContentCount || 0) + 1;
            },
            applyOptions(next) {
              instance.timeScaleOptions = next;
            },
          };
        },
        applyOptions(next) {
          instance.appliedOptions.push(next);
        },
        resize() {},
        remove() {
          if (instance.removed) return;
          instance.removed = true;
          harness.removeCount += 1;
          harness.removedIds.push(instance.id);
          root.remove();
          recordRootEvent("remove", instance.id);
        },
      };
    },
  };
  })();
`;

/**
 * Builds the v2 latest.json payload for a fixture slug, mapping the seeded
 * price row to the vendor/median/high/low shape the app expects.
 * @param {string} slug - Retail coin slug.
 * @returns {Object|null} v2 latest-price payload, or null if the slug has no seeded price row.
 */
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

/**
 * Returns a v2-API route handler that serves the standard fixture set.
 * @param {{ failGoldback?: boolean, goldbackG1Rate?: number }} opts
 *   failGoldback  – return 503 for goldback/latest.json (default: false)
 *   goldbackG1Rate – g1_usd for a successful goldback response (default: GOLDBACK_G1_RATE)
 */
function makeV2Handler({
  failGoldback = false,
  goldbackG1Rate = GOLDBACK_G1_RATE,
  retailFeeds = {},
  failedRetailFeeds = [],
} = {}) {
  return async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/data\/v2\//, "");
    if (path === "goldback/latest.json") {
      if (failGoldback) {
        await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            v: 2,
            generated_at: GENERATED_AT,
            data: { g1_usd: goldbackG1Rate },
          }),
        });
      }
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
    const match = path.match(/^retail\/([^/]+)\/([^/]+)\.json$/);
    if (!match) {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return;
    }
    const [, slug, file] = match;
    if (failedRetailFeeds.includes(file)) {
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      return;
    }
    const slugFeeds = retailFeeds[slug] || {};
    const hasOverride = Object.prototype.hasOwnProperty.call(slugFeeds, file);
    const data = hasOverride
      ? slugFeeds[file]
      : file === "latest"
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
}

/**
 * Creates a deferred promise pair for coordinating route handlers with test assertions.
 * @returns {{promise: Promise<void>, resolve: Function}} The pending promise and its resolver.
 */
function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/**
 * Intercepts the primary-API retail latest.json route for a slug and holds it
 * open until manually released, letting tests observe in-flight fetch state.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @param {string} slug - Retail coin slug whose latest.json request to gate.
 * @returns {Promise<{requested: Promise<void>, release: Function}>} A promise
 *   that resolves once the route is hit, and a function to release the held response.
 */
async function gatePrimaryRetailLatest(page, slug) {
  const requested = createDeferred();
  const release = createDeferred();
  await page.route(
    `https://api.staktrakr.com/data/v2/retail/${slug}/latest.json`,
    async (route) => {
      requested.resolve();
      await release.promise;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 2,
          generated_at: GENERATED_AT,
          data: latestForSlug(slug),
        }),
      });
    }
  );
  return { requested: requested.promise, release: release.resolve };
}

/** Stubs the exchange-rate and lightweight-charts CDN routes for a page. */
async function routeExchangeAndCharts(page, exchangeRates = { EUR: 0.9 }) {
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
}

/**
 * Common boot sequence after routes + initScript are wired: sets the fixed
 * clock, navigates, waits for market functions and spot price to settle, then
 * drives initMarketData + refreshMarketData before waiting for the table.
 */
async function bootMarketDataPage(page) {
  await page.clock.setFixedTime(FIXED_NOW);
  // Deep-link into the Market tab (STRK-282): vendor prices live in that panel
  // and the v2 shell boots on Dashboard, so a bare /index.html renders them
  // display:none.
  await page.goto("/index.html#/market", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.renderVendorPrices === "function" &&
      typeof window.refreshMarketData === "function" &&
      typeof window.initMarketData === "function" &&
      typeof window.showSettingsModal === "function"
  );
  // STRK-148 de-flake: boot's awaited loadSeedSpotHistory() pushes the seed
  // bundle's gold spot (~$4456) into spotPrices.gold AFTER the function-existence
  // wait above, via fetchSpotPrice(). Wait for that boot seed write to land
  // BEFORE the override below, so the override is the last writer and isn't
  // clobbered before refreshMarketData() reads it.
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

/**
 * Seeds inventory, routes, and localStorage fixtures for a retail-market test,
 * then boots the market data page.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @param {Object} [options] - Fixture overrides (see destructured options below).
 * @returns {Promise<void>}
 */
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
    retailFeeds = {},
    failedRetailFeeds = [],
  } = options;

  await injectSeedInventory(page);
  await routeExchangeAndCharts(page, exchangeRates);
  await page.addInitScript({ content: lightweightChartsStub });

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

  const fulfillV2 = makeV2Handler({ retailFeeds, failedRetailFeeds });
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
  await bootMarketDataPage(page);
}

/**
 * Reads the active vendor-prices tab's metal filter.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @returns {Promise<string|null>} The active tab's data-metal value.
 */
const getActiveTab = (page) =>
  page.locator(".vendor-prices-tabs button.active").getAttribute("data-metal");

/**
 * Reads the visible vendor-prices tab labels.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @returns {Promise<string[]>} Trimmed tab label text.
 */
const getTabLabels = async (page) =>
  (await page.locator(".vendor-prices-tabs button").allTextContents()).map((label) => label.trim());

/**
 * Reads the vendor-prices table's first-column row labels.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @returns {Promise<string[]>} Trimmed, non-empty row labels in table order.
 */
const getRows = async (page) =>
  (await page.locator(".vendor-prices-table tbody tr td:first-child").allTextContents())
    .map((row) => row.trim())
    .filter(Boolean);

/**
 * Reads a single vendor-prices table cell by row label and vendor column header.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @param {string} rowName - First-column row label to match.
 * @param {string} vendorHeader - Header text of the target vendor column.
 * @returns {Promise<string|null>} Trimmed cell text, or null if the row/column isn't found.
 */
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

/**
 * Locates a period button (e.g. "24H", "90D") within the market detail modal.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @param {string} label - Exact button label to match.
 * @returns {import('@playwright/test').Locator} Locator for the matching period button.
 */
const marketPeriodButton = (page, label) =>
  page.locator("#marketDetailContent").getByRole("button", { name: label, exact: true });

/**
 * Clicks a market-detail period button after asserting it is visible.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @param {string} label - Exact period button label to click.
 * @returns {Promise<void>}
 */
async function clickMarketPeriod(page, label) {
  const button = marketPeriodButton(page, label);
  await expect(button).toBeVisible();
  await button.click();
}

/**
 * Locates the market-detail summary value elements.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @returns {import('@playwright/test').Locator} Locator for `.market-value` elements in the detail modal.
 */
const marketSummaryValues = (page) => page.locator("#marketDetailContent .market-value");

/**
 * Asserts the market-detail summary stats match expected label/value pairs, in order.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @param {Object<string,string>} expectedSummary - Ordered map of stat label to expected display value.
 * @returns {Promise<void>}
 */
async function expectMarketSummary(page, expectedSummary) {
  const stats = marketSummaryValues(page).locator("..");
  const entries = Object.entries(expectedSummary);
  await expect(stats).toHaveCount(entries.length);
  for (const [index, [label, value]] of entries.entries()) {
    const stat = stats.nth(index);
    await expect(stat.locator(":scope > div").first()).toHaveText(label);
    await expect(stat.locator(":scope > .market-value")).toHaveText(value);
  }
}

/**
 * Boots the retail fixture (defaulting to the STRK-260 modal feeds) and opens
 * the Alpha Silver Bar market detail modal.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @param {Object} [options] - Overrides forwarded to setupRetailFixture.
 * @returns {Promise<void>}
 */
async function openStrk260MarketDetail(page, options = {}) {
  await setupRetailFixture(page, {
    ...options,
    retailFeeds: options.retailFeeds || STRK260_MODAL_FEEDS,
  });
  await clickStrk260MarketDetail(page);
}

/**
 * Clicks the Alpha Silver Bar coin link and asserts the market detail modal
 * opens with the expected title.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @returns {Promise<void>}
 */
async function clickStrk260MarketDetail(page) {
  await page.locator(".vendor-prices-table .vp-coin-link", { hasText: "Alpha Silver Bar" }).click();
  await expect(page.locator("#marketDetailModal")).toBeVisible();
  await expect(page.locator("#marketDetailTitle")).toContainText("Alpha Silver Bar");
}

/**
 * Seeds SLUG_SILVER_A's 30-day history feed with `rows`, pins the clock at
 * `now`, opens the STRK-260 market detail modal, switches to the 7D period,
 * and asserts exactly one active chart renders with a series payload equal
 * to `expectedSeries`.
 *
 * Shared by the STRK-260 noon-UTC boundary regression pair: daily aggregates
 * are always stamped at T12:00:00Z (devops/pollers/shared/api-export-v2.js
 * buildDailyWithVendors), so comparing that fixed stamp against an arbitrary
 * wall-clock "now" in milliseconds is time-of-day dependent. The two callers
 * pin the clock on either side of the noon-UTC stamp to prove the fix
 * (UTC-calendar-date bounding for non-intraday periods).
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @param {Object} params - Per-test fixture and expectation overrides.
 * @param {Date} params.now - Wall-clock time to pin via page.clock.setFixedTime.
 * @param {Array<Object>} params.rows - history-30d rows to seed for SLUG_SILVER_A.
 * @param {Array<{title: string, data: Array<{time: string, value: number}>}>} params.expectedSeries -
 *   Expected chartSeriesPayload result for the 7D period after the rows are applied.
 * @returns {Promise<void>}
 */
async function expectSevenDaySeriesForHistoryRows(page, { now, rows, expectedSeries }) {
  await setupRetailFixture(page, {
    retailFeeds: {
      [SLUG_SILVER_A]: {
        "history-30d": rows,
      },
    },
  });
  await page.clock.setFixedTime(now);
  await clickStrk260MarketDetail(page);
  await clickMarketPeriod(page, "7D");

  await expect.poll(async () => (await getMarketChartHarness(page)).rootCount).toBe(1);
  const chart = activeMarketChart(await getMarketChartHarness(page));
  expect(chartSeriesPayload(chart)).toEqual(expectedSeries);
}

/**
 * Waits for the v2 retail-prices background sync to complete by polling
 * localStorage for the expected lastSync timestamp.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @returns {Promise<void>}
 */
async function waitForRetailBackgroundSync(page) {
  await page.waitForFunction((expectedLastSync) => {
    const stored = localStorage.getItem("v2RetailPrices");
    if (!stored) return false;
    try {
      return JSON.parse(stored).lastSync === expectedLastSync;
    } catch {
      return false;
    }
  }, FIXED_NOW.toISOString());
}

/**
 * Reads the in-page lightweight-charts test harness state (instances, series
 * data, removal/root-count bookkeeping) for the market detail chart.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @returns {Promise<Object>} Snapshot of chart harness instances, series, and root-count bookkeeping.
 */
async function getMarketChartHarness(page) {
  return page.evaluate(() => {
    const harness = window.__marketChartHarness || {
      instances: [],
      removeCount: 0,
      removedIds: [],
    };
    const roots = Array.from(
      document.querySelectorAll("#marketDetailChartArea .tv-lightweight-charts")
    );
    const connectedIds = new Set(
      roots.map((root) => Number(root.dataset.chartInstanceId)).filter(Number.isFinite)
    );
    return {
      removeCount: harness.removeCount,
      removedIds: [...harness.removedIds],
      peakRootCount: harness.peakRootCount || 0,
      rootEvents: [...(harness.rootEvents || [])],
      rootCount: roots.length,
      instances: harness.instances.map((instance) => ({
        id: instance.id,
        containerId: instance.containerId,
        removed: instance.removed,
        active: connectedIds.has(instance.id),
        timeVisible: !!instance.options?.timeScale?.timeVisible,
        hasPriceFormatter: typeof instance.options?.localization?.priceFormatter === "function",
        formattedHundred:
          typeof instance.options?.localization?.priceFormatter === "function"
            ? instance.options.localization.priceFormatter(100)
            : null,
        series: instance.series.map((series) => ({
          type: series.type,
          title: series.options?.title || "",
          data: series.data.map((point) => ({ ...point })),
        })),
      })),
    };
  });
}

/**
 * Finds the currently active market-detail chart instance in a harness snapshot.
 * @param {Object} snapshot - Snapshot returned by getMarketChartHarness.
 * @returns {Object|undefined} The active chart instance, or undefined if none is active.
 */
const activeMarketChart = (snapshot) =>
  [...snapshot.instances]
    .reverse()
    .find((instance) => instance.containerId === "marketDetailChartArea" && instance.active);

/**
 * Extracts a comparable, title-sorted series payload from a chart instance.
 * @param {Object} chart - Chart instance from a harness snapshot.
 * @returns {Array<{title: string, data: Array<{time: number, value: number}>}>} Sorted series payload for assertions.
 */
const chartSeriesPayload = (chart) =>
  chart.series
    .map((series) => ({
      title: series.title,
      data: series.data.map((point) => ({ time: point.time, value: point.value })),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

/**
 * Converts a series payload's values by a currency exchange rate.
 * @param {Array<{title: string, data: Array<{time: number, value: number}>}>} series - Series payload to convert.
 * @param {number} rate - Multiplier applied to each data point's value.
 * @returns {Array<{title: string, data: Array<{time: number, value: number}>}>} Converted series payload.
 */
const convertSeriesPayload = (series, rate) =>
  series.map((vendorSeries) => ({
    title: vendorSeries.title,
    data: vendorSeries.data.map((point) => ({ ...point, value: point.value * rate })),
  }));

/**
 * Asserts a market-detail period renders a usable chart: no "Chart unavailable"
 * message, matching summary stats, matching series data, and exactly one chart root.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @param {Object} period - Period expectation entry with `summary` and `series`.
 * @returns {Promise<void>}
 */
async function expectUsableMarketChart(page, period) {
  await expect(page.getByText("Chart unavailable", { exact: true })).toHaveCount(0);
  await expectMarketSummary(page, period.summary);
  await expect
    .poll(async () => {
      const chart = activeMarketChart(await getMarketChartHarness(page));
      return chart ? chartSeriesPayload(chart) : null;
    })
    .toEqual(period.series);
  await expect.poll(async () => (await getMarketChartHarness(page)).rootCount).toBe(1);
}

/**
 * Asserts the market-detail modal shows the "Chart unavailable" state with the
 * unavailable summary and zero chart roots.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @returns {Promise<void>}
 */
async function expectUnavailableMarketChart(page) {
  await expect(page.getByText("Chart unavailable", { exact: true })).toBeVisible();
  await expectMarketSummary(page, STRK260_UNAVAILABLE_SUMMARY);
  await expect.poll(async () => (await getMarketChartHarness(page)).rootCount).toBe(0);
}

/**
 * Repeatedly clicks through market-detail period buttons and measures how long
 * each switch takes to fully complete (button state, summary, chart series,
 * and root count converge), across the given number of cycles.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @param {Array<Object>} periods - Ordered period expectation entries to cycle through.
 * @param {number} [cycles=3] - Number of times to repeat the full period sequence.
 * @returns {Promise<Array<{id: string, completed: boolean, durationMs: number, reason?: string, state?: Object}>>}
 *   Per-switch measurement results.
 */
async function measureCompletedMarketSwitches(page, periods, cycles = 3) {
  const sequence = Array.from({ length: cycles }, () => periods).flat();
  return page.evaluate(
    async ({ steps, deadlineMs }) => {
      const readState = (step) => {
        const buttons = Array.from(
          document.querySelectorAll("#marketDetailContent button[data-period]")
        );
        const selectedByClass = buttons.filter((button) => button.classList.contains("active"));
        const selectedByAria = buttons.filter(
          (button) => button.getAttribute("aria-pressed") === "true"
        );
        const summary = Array.from(
          document.querySelectorAll("#marketDetailContent .market-value")
        ).map((value) => value.textContent.trim());
        const roots = Array.from(
          document.querySelectorAll("#marketDetailChartArea .tv-lightweight-charts")
        );
        const activeId = roots.length === 1 ? Number(roots[0].dataset.chartInstanceId) : Number.NaN;
        const activeInstance = window.__marketChartHarness?.instances.find(
          (instance) => instance.id === activeId && !instance.removed
        );
        const series = (activeInstance?.series || [])
          .map((vendorSeries) => ({
            title: vendorSeries.options?.title || "",
            data: vendorSeries.data.map((point) => ({
              time: point.time,
              value: point.value,
            })),
          }))
          .sort((a, b) => a.title.localeCompare(b.title));
        const selected = buttons.find((button) => button.getAttribute("data-period") === step.id);
        return {
          selectedByClass: selectedByClass.length,
          selectedByAria: selectedByAria.length,
          selectedClass: !!selected?.classList.contains("active"),
          selectedAria: selected?.getAttribute("aria-pressed") === "true",
          summary,
          rootCount: roots.length,
          series,
        };
      };

      const isComplete = (state, step) =>
        state.selectedByClass === 1 &&
        state.selectedByAria === 1 &&
        state.selectedClass &&
        state.selectedAria &&
        JSON.stringify(state.summary) === JSON.stringify(Object.values(step.summary)) &&
        state.rootCount === 1 &&
        JSON.stringify(state.series) === JSON.stringify(step.series);

      const results = [];
      for (const step of steps) {
        const button = document.querySelector(
          `#marketDetailContent button[data-period="${step.id}"]`
        );
        if (!button) {
          results.push({ id: step.id, completed: false, reason: "missing-button" });
          break;
        }

        const startedAt = performance.now();
        button.click();
        const result = await new Promise((resolve) => {
          const check = () => {
            const state = readState(step);
            const durationMs = performance.now() - startedAt;
            if (isComplete(state, step)) {
              resolve({ id: step.id, completed: true, durationMs, state });
              return;
            }
            if (durationMs >= deadlineMs) {
              resolve({
                id: step.id,
                completed: false,
                durationMs,
                reason: "completion-timeout",
                state,
              });
              return;
            }
            requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        });
        results.push(result);
        if (!result.completed) break;
      }
      return results;
    },
    { steps: sequence, deadlineMs: 1000 }
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
    // Deep-link into the Market tab (STRK-282) — see bootMarketDataPage.
    await page.goto("/index.html#/market", { waitUntil: "domcontentloaded" });

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

    // Settings listeners are intentionally wired on a delayed init callback.
    // Drive the real sidebar navigation and retry until that observable
    // listener contract is ready instead of racing the matrix change handler.
    await page.evaluate(() => window.showSettingsModal("currency"));
    await expect(async () => {
      await page.locator('.settings-nav-item[data-section="market"]').click();
      expect(await page.locator("#settingsPanel_market").isVisible()).toBe(true);
    }).toPass({ intervals: [50, 100, 200], timeout: 5000 });
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

    // DE-FLAKE (STRK-327). The locator spans every track in the container, and
    // the superseded track lingers until the rAF sweep in _finalizeTickerTrack —
    // the trap already recorded for STRK-317. The fixture's boot renders twice
    // (app boot, then refreshMarketData), so under full-suite load both tracks
    // can still be mounted here, and the single "Goldback" fixture slug then
    // resolves to two .premium nodes and a strict-mode violation. Observed
    // failing once in a 572-test run; passes in isolation and in-file.
    await expect(page.locator("#bestPriceTickerEl .ticker-track")).toHaveCount(1);

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

  // STRK-317: two ticker display fixes pinned together —
  // (1) coin names render in full (the old code hard-truncated >30 chars to 27+"…"
  //     in _buildTickerItemEl; the pill CSS already sizes to content), and
  // (2) _shortVendor resolves vendors missing from its hardcoded map via the
  //     manifest vendor-meta display name instead of leaking the raw lowercase
  //     vid (the "mintbuilder" bug), with mintbuilder now also in the map.
  test("STRK-317 — ticker renders full long names and resolves vendor labels", async ({ page }) => {
    await setupRetailFixture(page);

    // 38 chars — the pre-fix cap truncated anything over 30.
    const LONG_NAME = "Australian Silver Kookaburra 1 oz Coin";

    await page.evaluate(
      ({ longName, slugLong, slugMeta }) => {
        // Top-level consts in classic scripts share one global scope, so the
        // module-scope getters are bare-accessible here. Pin the mutated maps
        // on the window globals each getter prefers so the re-render sees them
        // (the loadDataSync fallbacks re-parse localStorage on every call and
        // would discard in-place mutation).
        const cm = _getCoinMeta() || loadDataSync("retailManifestCoinMeta", {});
        cm[slugLong] = { ...cm[slugLong], name: longName };
        window._manifestCoinMeta = cm;

        const vm = _getVendorMeta();
        // futurevendor: NOT in _shortVendor's map — must fall back to this name.
        vm.futurevendor = { name: "Future Vendor", color: "#8b5cf6", url: null };
        window._manifestVendorMeta = vm;

        const coins = _getRetailCoins();
        // mintbuilder: resolved by _shortVendor's hardcoded map after STRK-317.
        coins[slugLong].vendors = {
          mintbuilder: { price: 42, inStock: true, in_stock: true },
        };
        coins[slugMeta].vendors = {
          futurevendor: { price: 38, inStock: true, in_stock: true },
        };
        window._v2RetailData = { prices: coins };

        const container = document.getElementById("bestPriceTickerEl");
        if (container) container.dataset.tickerSignature = "";
        window.renderBestPriceTicker();
      },
      { longName: LONG_NAME, slugLong: SLUG_SILVER_Z, slugMeta: SLUG_SILVER_A }
    );

    // The re-render briefly mounts a new track alongside the superseded one
    // (the rAF sweep in _finalizeTickerTrack removes it) — wait for the swap
    // to settle so the primary-block locators below resolve uniquely.
    await expect(page.locator("#bestPriceTickerEl .ticker-track")).toHaveCount(1);

    const primaryBlock = page.locator(".ticker-block[data-ticker-block='primary']");

    const longItem = primaryBlock.locator(".ticker-item").filter({ hasText: "Kookaburra" });
    await expect(longItem.locator(".coin")).toHaveText(LONG_NAME);
    await expect(longItem.locator(".vendor")).toHaveText("MintBuilder");

    const metaFallbackItem = primaryBlock
      .locator(".ticker-item")
      .filter({ hasText: "Alpha Silver Bar" });
    await expect(metaFallbackItem.locator(".vendor")).toHaveText("Future Vendor");
  });

  // STRK-322: MintBuilder promoted to a first-class frontend vendor. The scrape
  // rollout (STRK-307/311) registered mintbuilder in none of the three
  // js/retail.js registries, leaving the detail-modal legend and every
  // Object.keys(RETAIL_VENDOR_NAMES)-gated path blind to it — only the
  // _shortVendor map (STRK-317) papered over the label. Pins the registration,
  // the NAMES/URLS/COLORS parity invariant, and the user-visible legend item.
  test("STRK-322 — MintBuilder is registered in all vendor registries and renders in the detail-modal legend", async ({
    page,
  }) => {
    // Serve a latest.json where mintbuilder is the vendor for one slug — the
    // detail modal's background refresh (openRetailViewModal) refetches this
    // feed and REBUILDS the legend from it, so seeding window state directly
    // gets overwritten ~instantly. Overriding the mocked feed exercises the
    // real fetch → retailPrices → _buildVendorLegend path instead.
    await setupRetailFixture(page, {
      retailFeeds: {
        [SLUG_SILVER_A]: {
          latest: {
            weight_oz: 1,
            median_price: 42.5,
            lowest_price: 42.5,
            window_start: GENERATED_AT,
            vendors: { mintbuilder: { price: 42.5, in_stock: true } },
          },
        },
      },
    });

    const registries = await page.evaluate(() => ({
      name: window.RETAIL_VENDOR_NAMES.mintbuilder ?? null,
      url: window.RETAIL_VENDOR_URLS.mintbuilder ?? null,
      color: window.RETAIL_VENDOR_COLORS.mintbuilder ?? null,
      nameKeys: Object.keys(window.RETAIL_VENDOR_NAMES).sort(),
      urlKeys: Object.keys(window.RETAIL_VENDOR_URLS).sort(),
      colorKeys: Object.keys(window.RETAIL_VENDOR_COLORS).sort(),
      colors: Object.values(window.RETAIL_VENDOR_COLORS),
    }));
    expect(registries.name).toBe("MintBuilder");
    expect(registries.url).toBe("https://mintbuilder.com");
    expect(registries.color).toMatch(/^#[0-9a-f]{6}$/i);
    // Parity invariant: the three registries must describe the same vendor set,
    // so a future vendor can never land half-registered again.
    expect(registries.urlKeys).toEqual(registries.nameKeys);
    expect(registries.colorKeys).toEqual(registries.nameKeys);
    // Chart lines must stay distinguishable — no two vendors share a color.
    expect(new Set(registries.colors).size).toBe(registries.colors.length);

    // User-visible contract: a mintbuilder price renders a labelled legend item
    // linking to the vendor homepage (RETAIL_VENDOR_URLS fallback — no per-slug
    // provider URL is seeded here on purpose). The fixture slug needs a
    // RETAIL_COIN_META entry for the modal to open at all.
    await page.evaluate((slug) => {
      window.RETAIL_COIN_META[slug] = { name: "Legend Probe Silver", weight: 1, metal: "silver" };
      window.openRetailViewModal(slug);
    }, SLUG_SILVER_A);

    const legendItem = page
      .locator("#retailViewVendorLegend .retail-legend-item")
      .filter({ hasText: "MintBuilder" });
    await expect(legendItem).toHaveCount(1);

    // The legend renders an <a href="#"> whose click handler window.open()s the
    // resolved vendor URL (popup pattern — the real URL never lands in href).
    // No per-slug provider URL is seeded, so the only way this item is a link
    // at all is the new RETAIL_VENDOR_URLS.mintbuilder homepage fallback —
    // stub window.open and click to pin the resolved URL.
    await page.evaluate(() => {
      window.__openedUrls = [];
      window.open = (url) => {
        window.__openedUrls.push(url);
        return null;
      };
    });
    await legendItem.click();
    const openedUrls = await page.evaluate(() => window.__openedUrls);
    expect(openedUrls[0]).toBe("https://mintbuilder.com");
  });

  // STRK-317 review round 1 (Codex): the test above seeds window meta directly,
  // which cannot catch the dual-store gap — retail.js's _populateManifestState
  // (the REAL mid-session manifest sync path) updates its lexical
  // _manifestVendorMeta + localStorage but historically never the
  // window._manifestVendorMeta property that market-data.js's _getVendorMeta
  // prefers, so a vendor added by a sync stayed invisible to the fallback until
  // reload. This drives the real populate function and pins the mirror.
  test("STRK-317 — manifest sync refreshes the vendor meta the ticker fallback reads", async ({
    page,
  }) => {
    await setupRetailFixture(page);

    await page.evaluate(
      ({ slugMeta }) => {
        const toCode = (m) => (m === "silver" ? "xag" : m === "gold" ? "xau" : m);
        const coins = Object.entries(_getCoinMeta()).map(([slug, m]) => ({
          slug,
          name: m.name,
          weight_oz: m.weight,
          metal: toCode(m.metal),
        }));
        const vendors = Object.entries(_getVendorMeta()).map(([id, v]) => ({
          id,
          name: v.name,
          color: v.color,
          url: v.url,
        }));
        vendors.push({ id: "syncedvendor", name: "Synced Vendor", color: "#8b5cf6", url: null });

        // Real sync path — must mirror onto window._manifestVendorMeta.
        _populateManifestState(coins, vendors);

        const priceMap = _getRetailCoins();
        priceMap[slugMeta].vendors = {
          syncedvendor: { price: 38, inStock: true, in_stock: true },
        };
        window._v2RetailData = { prices: priceMap };

        const container = document.getElementById("bestPriceTickerEl");
        if (container) container.dataset.tickerSignature = "";
        window.renderBestPriceTicker();
      },
      { slugMeta: SLUG_SILVER_A }
    );

    await expect(page.locator("#bestPriceTickerEl .ticker-track")).toHaveCount(1);
    const item = page
      .locator(".ticker-block[data-ticker-block='primary'] .ticker-item")
      .filter({ hasText: "Alpha Silver Bar" });
    await expect(item.locator(".vendor")).toHaveText("Synced Vendor");
  });

  // STRK-317 review round 1 (Codex): with fewer than 4 items the ticker takes
  // the non-animated static path, and .market-ticker is overflow:hidden — a
  // full-length name on a narrow viewport used to clip at BOTH edges (the
  // track was plain justify-content:center). The static track now allows
  // horizontal scroll with `safe center`, keeping every character reachable.
  test("STRK-317 — static ticker (<4 items) keeps long names reachable on narrow viewports", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupRetailFixture(page);
    // The ticker is a DASHBOARD section, unlike the vendor-price tables this
    // fixture otherwise serves — and setupRetailFixture boots into Market. This
    // assertion measures real layout (overflowX / scrollWidth), which only has
    // meaning while the element is actually rendered (STRK-282).
    //
    // Switch via window.activateTab, not by clicking the header nav: this test
    // runs at 390px, where .app-tab-nav is display:none in favour of the mobile
    // bottom bar, so the header button is not clickable. tabs.js exposes
    // activateTab for exactly this.
    await page.evaluate(() => window.activateTab("dashboard"));
    await expect(page.locator("#tabViewDashboard")).toBeVisible();

    const LONG_NAME = "Australian Silver Kookaburra 1 oz Coin";

    await page.evaluate(
      ({ longName, slug }) => {
        const cm = _getCoinMeta() || loadDataSync("retailManifestCoinMeta", {});
        cm[slug] = { ...cm[slug], name: longName };
        window._manifestCoinMeta = cm;
        // Single item → static (non-animated) track path.
        const priceMap = _getRetailCoins();
        window._v2RetailData = { prices: { [slug]: priceMap[slug] } };
        const container = document.getElementById("bestPriceTickerEl");
        if (container) container.dataset.tickerSignature = "";
        window.renderBestPriceTicker();
      },
      { longName: LONG_NAME, slug: SLUG_SILVER_Z }
    );

    const track = page.locator("#bestPriceTickerEl .ticker-track");
    await expect(track).toHaveCount(1);
    await expect(track).toHaveClass(/\bstatic\b/);
    await expect(track.locator(".ticker-item .coin")).toHaveText(LONG_NAME);

    const overflow = await track.evaluate((el) => ({
      overflowX: getComputedStyle(el).overflowX,
      scrollable: el.scrollWidth > el.clientWidth,
    }));
    // The 38-char item overflows a 390px viewport; scrollability is what makes
    // the restored characters reachable instead of clipped.
    expect(overflow.overflowX).toBe("auto");
    expect(overflow.scrollable).toBe(true);
  });

  // STRK-275 / STAK-513: rapid re-renders must leave exactly one .ticker-track.
  //
  // _finalizeTickerTrack runs inside requestAnimationFrame, so several renders
  // can be in flight at once. Cleanup relies on the sweep at the end of that
  // function removing every track except the current one — which is precisely
  // why the separate `previousTrack` argument it used to receive was redundant
  // and was dropped. This pins the invariant that makes it redundant; without
  // it, the removal rests on reading the code rather than on a test.
  test("STRK-275 — rapid ticker re-renders leave exactly one track (STAK-513)", async ({
    page,
  }) => {
    await setupRetailFixture(page);

    const track = page.locator("#bestPriceTickerEl .ticker-track");
    await expect(track).toHaveCount(1);

    // The sweep only matters on the animated path, which needs >= 4 items;
    // fewer would take the static branch and the assertion would pass vacuously.
    const itemCount = await page
      .locator("#bestPriceTickerEl .ticker-block[data-ticker-block='primary'] .ticker-item")
      .count();
    expect(itemCount).toBeGreaterThanOrEqual(4);

    // Each call must actually reach the render path. renderBestPriceTicker
    // early-returns while the container's stored signature still matches
    // (js/market-data.js:640), so calling it repeatedly with unchanged data
    // schedules nothing whatsoever — measured with a MutationObserver: zero
    // tracks created across 12 calls. Clearing the stored signature defeats
    // that memoization guard, which is what the STAK-513 scenario needs: a new
    // track built while the previous one is still mounted and its rAF pending.
    // Done this way rather than by mutating seeded prices so the test does not
    // depend on the retail cache's shape.
    const renderStats = await page.evaluate(async () => {
      const container = document.getElementById("bestPriceTickerEl");

      let tracksCreated = 0;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType === 1 && node.classList?.contains("ticker-track")) {
              tracksCreated += 1;
            }
          }
        }
      });
      observer.observe(container, { childList: true });

      for (let i = 0; i < 12; i += 1) {
        container.dataset.tickerSignature = "";
        window.renderBestPriceTicker();
      }

      // Let every queued rAF callback drain before reporting.
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50)));
      });
      observer.disconnect();

      return { tracksCreated };
    });

    // Self-check: if this ever drops to 0/1 the loop has gone inert again and
    // the single-track assertion below would pass without exercising anything.
    expect(renderStats.tracksCreated).toBeGreaterThan(1);

    await expect(track).toHaveCount(1);
  });

  // STRK-327: the ticker sizes its scroll loop from a measured block width, so a
  // rebuild that lands while #tabViewDashboard is display:none measures 0, takes
  // the static branch, and reveals frozen — with the STRK-317 scrollbar showing
  // for the wrong reason. activateTab re-measures on reveal.
  //
  // Lives here rather than in tab-shell.spec.js (where the sibling
  // updatePortalHeight guard sits) because it needs the seeded retail fixture to
  // reach a >=4-item animated track at all.
  test("STRK-327 — a ticker rendered while Dashboard is hidden animates on reveal", async ({
    page,
  }) => {
    await setupRetailFixture(page);

    const track = page.locator("#bestPriceTickerEl .ticker-track");
    await expect(track).toHaveCount(1);

    // Only the animated path is repaired. A <4-item track is legitimately static
    // and must stay so, and this assertion would pass vacuously against one.
    const itemCount = await page
      .locator("#bestPriceTickerEl .ticker-block[data-ticker-block='primary'] .ticker-item")
      .count();
    expect(itemCount).toBeGreaterThanOrEqual(4);

    /**
     * Read the ticker track's animation state straight from the DOM.
     *
     * Deliberately reports the two fields that discriminate a running loop from
     * the STRK-327 failure: a visibility-only assertion passes either way.
     * @returns {Promise<{isStatic: boolean, loopWidth: number}|null>} Track state, or null when absent.
     */
    const readTrack = () =>
      page.evaluate(() => {
        const el = document.querySelector("#bestPriceTickerEl .ticker-track");
        if (!el) return null;
        return {
          isStatic: el.classList.contains("static"),
          loopWidth: Number(el.dataset.loopWidth || 0),
        };
      });

    // SELF-CHECK, and the reason this test needs no setup of its own: the shared
    // fixture boots at #/market (vendor prices live in that panel), so
    // refreshMarketData renders the ticker into a display:none Dashboard. That
    // is the reported "reload on another tab" repro, reproduced for free — and
    // it means the whole retail-market suite has been running against a frozen
    // ticker, unnoticed, because every other assertion here checks structure and
    // content rather than whether the thing actually moves.
    //
    // If this ever stops arriving broken, the reveal assertions below go vacuous.
    const beforeReveal = await readTrack();
    expect(beforeReveal.isStatic).toBe(true);
    expect(beforeReveal.loopWidth).toBe(0);

    await page.locator("#tabBtnDashboard").click();
    await expect(page.locator("#tabViewDashboard")).toBeVisible();

    // The repair: animating again, and no scrollbar, because `static` is gone.
    const repaired = await readTrack();
    expect(repaired.isStatic).toBe(false);
    expect(repaired.loopWidth).toBeGreaterThan(0);
    expect(await track.evaluate((el) => getComputedStyle(el).overflowX)).not.toBe("auto");
  });

  // STRK-327: the mirror case — a genuinely short track must survive the reveal
  // repair untouched. The `static` class is overloaded (it marks both a <4-item
  // track and a failed measurement), so a repair keyed on the class rather than
  // on the duplicate block would strip it here and animate a single-block track
  // against nothing, exposing a gap at the wrap point and losing STRK-317's
  // centering and scrollbar.
  test("STRK-327 — a legitimately static track stays static across tab switches", async ({
    page,
  }) => {
    await setupRetailFixture(page);

    await page.evaluate((slug) => {
      const priceMap = _getRetailCoins();
      window._v2RetailData = { prices: { [slug]: priceMap[slug] } };
      document.getElementById("bestPriceTickerEl").dataset.tickerSignature = "";
      window.renderBestPriceTicker();
    }, SLUG_SILVER_Z);

    const track = page.locator("#bestPriceTickerEl .ticker-track");
    await expect(track).toHaveCount(1);
    await expect(track).toHaveClass(/\bstatic\b/);

    await page.locator("#tabBtnMarket").click();
    await expect(page.locator("#tabViewDashboard")).toBeHidden();
    await page.locator("#tabBtnDashboard").click();
    await expect(page.locator("#tabViewDashboard")).toBeVisible();

    await expect(track).toHaveClass(/\bstatic\b/);
    expect(await track.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
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
    await routeExchangeAndCharts(page);

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

    // Full v2 routing so manifest + per-slug detail load and spot premiums compute —
    // EXCEPT goldback/latest.json, which fails on both hosts so _goldbackG1Rate stays
    // null (network unseeded). makeV2Handler({ failGoldback: true }) handles both.
    await page.route("https://api.staktrakr.com/data/v2/**", makeV2Handler({ failGoldback: true }));
    await page.route("https://api2.staktrakr.com/data/v2/**", async (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
    );

    // Run initMarketData with the goldback endpoint failing: manifest + per-slug
    // detail load (so spot premiums render) but _goldbackG1Rate stays null.
    await bootMarketDataPage(page);
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

    // RED: the raw goldback fetch hits api1 only (503), never api2, so
    // _goldbackG1Rate stays null and the goldback premium badge never paints.
    // After C.5 routes it through _marketV2Fetch, failover reaches api2 and the
    // badge paints the api2-derived premium.
    const matrixBadge = goldbackMatrixBadge(page);
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

    // RED: today's 25h gate budget accepts the 3h-old api1 200, so it short-circuits
    // the failover loop and the premium renders the api1 STALE rate (+70.0%) -- this
    // assertion FAILS. After finding #1 adds the 2h realtime cap, the 3h api1 200 is
    // rejected, failover reaches api2, and the premium renders the api2 FRESH rate.
    const matrixBadge = goldbackMatrixBadge(page);
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
    await routeExchangeAndCharts(page);
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
    await page.route("https://api.staktrakr.com/data/v2/**", async (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
    );
    await page.route("https://api2.staktrakr.com/data/v2/**", makeV2Handler());
    await bootMarketDataPage(page);

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

  test.describe("STRK-260 market detail ranges", () => {
    test.use({ timezoneId: "Pacific/Auckland" });

    test("period controls expose the exact order, default, class, ARIA, and keyboard contract", async ({
      page,
    }) => {
      await openStrk260MarketDetail(page);

      const group = page.getByRole("group", { name: "Vendor history period" });
      const buttons = group.getByRole("button");
      expect((await buttons.allTextContents()).map((text) => text.trim())).toEqual([
        "24H",
        "7D",
        "30D",
        "60D",
        "90D",
      ]);
      await expect(buttons).toHaveCount(5);
      await expect(group).toHaveClass(/\bchip-sort-toggle\b/);

      for (const button of await buttons.all()) {
        await expect(button).toHaveAttribute("type", "button");
        await expect(button).toHaveClass(/\bchip-sort-btn\b/);
      }

      await expect(marketPeriodButton(page, "7D")).toHaveAttribute("aria-pressed", "true");
      await expect(marketPeriodButton(page, "7D")).toHaveClass(/\bactive\b/);
      await expect(group.locator('button[aria-pressed="true"]')).toHaveCount(1);
      await expect(group.locator("button.active")).toHaveCount(1);

      let previousLabel = "7D";
      for (const [index, label] of ["24H", "30D", "60D", "90D", "7D"].entries()) {
        const previousButton = marketPeriodButton(page, previousLabel);
        const button = marketPeriodButton(page, label);
        await button.focus();
        await button.press(index % 2 === 0 ? "Enter" : "Space");
        await expect(button).toBeFocused();
        await expect(button).toHaveAttribute("aria-pressed", "true");
        await expect(button).toHaveClass(/\bactive\b/);
        await expect(previousButton).toHaveAttribute("aria-pressed", "false");
        await expect(previousButton).not.toHaveClass(/\bactive\b/);
        await expect(group.locator('button[aria-pressed="true"]')).toHaveCount(1);
        await expect(group.locator("button.active")).toHaveCount(1);
        previousLabel = label;
      }
    });

    test("all five rolling windows use inclusive timestamps and matching odd/even summaries", async ({
      page,
    }) => {
      await openStrk260MarketDetail(page);

      for (const period of STRK260_PERIODS) {
        await clickMarketPeriod(page, period.label);
        await expectUsableMarketChart(page, period);
        const chart = activeMarketChart(await getMarketChartHarness(page));
        expect(chart, `${period.label} chart instance`).toBeTruthy();
        expect(chart.timeVisible).toBe(period.label === "24H");
        expect(chartSeriesPayload(chart)).toEqual(period.series);
      }
    });

    // STRK-260: renamed from "invalid and future observations are
    // excluded" — non-intraday periods now bound by UTC calendar date, so a
    // same-day-but-later-than-now observation (the fixture's 05-26T18:00:01Z
    // apmex row) is correctly retained, not excluded. Out-of-window CALENDAR
    // DATES (a different day) and invalid values are still excluded.
    test("invalid observations and out-of-window dates are excluded while partial Vendors remain usable", async ({
      page,
    }) => {
      await openStrk260MarketDetail(page);
      await clickMarketPeriod(page, "7D");

      await expect.poll(async () => (await getMarketChartHarness(page)).rootCount).toBe(1);
      const chart = activeMarketChart(await getMarketChartHarness(page));
      expect(chartSeriesPayload(chart)).toEqual(STRK260_PERIOD_EXPECTATIONS["7D"].series);
      await expectMarketSummary(page, STRK260_PERIOD_EXPECTATIONS["7D"].summary);
    });

    // STRK-276: the intraday path had no (vendorId, chartTime) dedup, unlike
    // the daily path. Intraday keys chart time as Math.floor(timeMs / 1000), so
    // two rows for one vendor inside the same second produced two points at an
    // identical time — which Lightweight Charts rejects, degrading the whole
    // 24H view to "Chart unavailable" rather than dropping one point.
    //
    // Dedup is applied when building seriesByVendor, NOT when collecting
    // observations. The duplicate is a chart-rendering constraint, so the fix
    // belongs at the presentation boundary; the summary keeps counting every
    // real observation. The summary assertion below pins that deliberately.
    test("STRK-276 — same-second intraday duplicates collapse in the chart but not the summary", async ({
      page,
    }) => {
      await openStrk260MarketDetail(page, {
        retailFeeds: {
          [SLUG_SILVER_A]: {
            ...STRK260_MODAL_FEEDS[SLUG_SILVER_A],
            intraday: STRK276_SAME_SECOND_INTRADAY_ROWS,
          },
        },
      });
      await clickMarketPeriod(page, "24H");

      // Chart: one point per (vendor, second). Latest same-second value wins,
      // matching the daily branch's timeMs-descending tie-break.
      await expect(page.getByText("Chart unavailable", { exact: true })).toHaveCount(0);
      await expect
        .poll(async () => {
          const activeChart = activeMarketChart(await getMarketChartHarness(page));
          return activeChart ? chartSeriesPayload(activeChart) : null;
        })
        .toEqual([
          {
            title: "Hero",
            data: [
              { time: toUnixSeconds("2026-05-26T17:00:00.000Z"), value: 100 },
              { time: toUnixSeconds("2026-05-26T17:59:59.000Z"), value: 130 },
            ],
          },
        ]);

      // Summary: all three observations still counted (100, 120, 130).
      // Median 120 proves the 120 row was NOT discarded — deduping here would
      // have shifted it to 115.
      await expectMarketSummary(page, {
        Median: "$120.00",
        Low: "$100.00",
        High: "$130.00",
        Spread: "$30.00",
      });
    });

    // STRK-260 regression coverage: daily aggregates are always
    // stamped at T12:00:00Z (devops/pollers/shared/api-export-v2.js
    // buildDailyWithVendors), so comparing that fixed stamp against an
    // arbitrary wall-clock "now" in milliseconds is time-of-day dependent.
    // These two tests pin the clock on either side of the noon-UTC stamp to
    // prove the fix (UTC-calendar-date bounding for non-intraday periods).
    test("today's own daily aggregate is included in a non-intraday range before 12:00 UTC", async ({
      page,
    }) => {
      await expectSevenDaySeriesForHistoryRows(page, {
        now: new Date("2026-06-10T06:00:00.000Z"),
        rows: [
          {
            // Today's daily aggregate, stamped at the publisher's noon-UTC
            // convention. With "now" at 06:00 UTC the old exact-millisecond
            // filter rejected this as "future" (timeMs 12:00 > endMs 06:00),
            // dropping the most current point from every non-intraday chart
            // until noon UTC passed.
            t: "2026-06-10T12:00:00.000Z",
            ts: toUnixSeconds("2026-06-10T12:00:00.000Z"),
            vendors: { apmex: { avg: 99 } },
          },
        ],
        expectedSeries: [{ title: "APMEX", data: [{ time: "2026-06-10", value: 99 }] }],
      });
    });

    test("the oldest calendar day a rolling window is meant to include is retained deterministically after 12:00 UTC", async ({
      page,
    }) => {
      await expectSevenDaySeriesForHistoryRows(page, {
        now: new Date("2026-06-17T18:00:00.000Z"),
        rows: [
          {
            // Exactly on the 7D window's startDate (7 calendar days before
            // "today", 2026-06-17): excluded by design — start is
            // exclusive so the window spans exactly 7 calendar dates
            // (today plus the 6 preceding), not 8.
            t: "2026-06-10T12:00:00.000Z",
            ts: toUnixSeconds("2026-06-10T12:00:00.000Z"),
            vendors: { herobullion: { avg: 10 } },
          },
          {
            // The oldest calendar date the 7D window IS meant to include.
            // Locks in that the new exclusive-start rule trims exactly one
            // boundary day, not more, keeping the window deterministic
            // regardless of what time of day "now" falls at (mirroring the
            // before-noon test above).
            t: "2026-06-11T12:00:00.000Z",
            ts: toUnixSeconds("2026-06-11T12:00:00.000Z"),
            vendors: { herobullion: { avg: 11 } },
          },
        ],
        expectedSeries: [{ title: "Hero", data: [{ time: "2026-06-11", value: 11 }] }],
      });
    });

    test("duplicate daily Vendor dates keep the chronologically latest observation", async ({
      page,
    }) => {
      const duplicateDailyRows = [
        {
          t: "2026-05-25T18:00:00.000Z",
          ts: toUnixSeconds("2026-05-25T18:00:00.000Z"),
          vendors: { apmex: { avg: 90 } },
        },
        {
          t: "2026-05-25T12:00:00.000Z",
          ts: toUnixSeconds("2026-05-25T12:00:00.000Z"),
          vendors: { apmex: { avg: 70 } },
        },
      ];
      await openStrk260MarketDetail(page, {
        retailFeeds: {
          [SLUG_SILVER_A]: {
            ...STRK260_MODAL_FEEDS[SLUG_SILVER_A],
            "history-30d": duplicateDailyRows,
          },
        },
      });

      await expectUsableMarketChart(page, {
        summary: {
          Median: "$90.00",
          Low: "$90.00",
          High: "$90.00",
          Spread: "$0.00",
        },
        series: [
          {
            title: "APMEX",
            data: [{ time: "2026-05-25", value: 90 }],
          },
        ],
      });
    });

    test("a failed 30-day feed isolates 7D and 30D while 24H, 60D, and 90D remain usable", async ({
      page,
    }) => {
      await openStrk260MarketDetail(page, { failedRetailFeeds: ["history-30d"] });

      const periodButtons = page.locator("#marketDetailContent button[data-period]");
      await expect(periodButtons).toHaveCount(5);
      await expect(page.locator("#marketDetailContent button[data-period].active")).toHaveCount(1);
      await expect(
        page.locator('#marketDetailContent button[data-period][aria-pressed="true"]')
      ).toHaveCount(1);
      await expect(marketPeriodButton(page, "7D")).toHaveClass(/\bactive\b/);
      await expect(marketPeriodButton(page, "7D")).toHaveAttribute("aria-pressed", "true");
      for (const label of ["24H", "30D", "60D", "90D"]) {
        await expect(marketPeriodButton(page, label)).not.toHaveClass(/\bactive\b/);
        await expect(marketPeriodButton(page, label)).toHaveAttribute("aria-pressed", "false");
      }
      await expectUnavailableMarketChart(page);

      await clickMarketPeriod(page, "30D");
      await expectUnavailableMarketChart(page);

      await clickMarketPeriod(page, "24H");
      await expectUsableMarketChart(page, STRK260_PERIOD_EXPECTATIONS["24H"]);

      await clickMarketPeriod(page, "60D");
      await expectUsableMarketChart(page, STRK260_PERIOD_EXPECTATIONS["60D"]);
      await clickMarketPeriod(page, "90D");
      await expectUsableMarketChart(page, STRK260_PERIOD_EXPECTATIONS["90D"]);
    });

    test("HTTP failures and successful empty or invalid feeds isolate unavailable ranges", async ({
      page,
    }) => {
      await openStrk260MarketDetail(page, { failedRetailFeeds: ["history-90d"] });

      await clickMarketPeriod(page, "7D");
      await expectUsableMarketChart(page, STRK260_PERIOD_EXPECTATIONS["7D"]);
      await clickMarketPeriod(page, "30D");
      await expectUsableMarketChart(page, STRK260_PERIOD_EXPECTATIONS["30D"]);

      for (const label of ["60D", "90D"]) {
        await clickMarketPeriod(page, label);
        await expectUnavailableMarketChart(page);
      }

      const emptyFeedPage = await page.context().newPage();
      const emptyFeedStatuses = [];
      await setupRetailFixture(emptyFeedPage, {
        retailFeeds: {
          [SLUG_SILVER_A]: {
            ...STRK260_MODAL_FEEDS[SLUG_SILVER_A],
            "history-30d": [],
          },
        },
      });
      await waitForRetailBackgroundSync(emptyFeedPage);
      emptyFeedPage.on("response", (response) => {
        if (
          new URL(response.url()).pathname.endsWith(`/retail/${SLUG_SILVER_A}/history-30d.json`)
        ) {
          emptyFeedStatuses.push(response.status());
        }
      });
      await clickStrk260MarketDetail(emptyFeedPage);
      await expectUnavailableMarketChart(emptyFeedPage);
      expect(emptyFeedStatuses).toEqual([200]);
      await clickMarketPeriod(emptyFeedPage, "30D");
      await expectUnavailableMarketChart(emptyFeedPage);
      await clickMarketPeriod(emptyFeedPage, "24H");
      await expectUsableMarketChart(emptyFeedPage, STRK260_PERIOD_EXPECTATIONS["24H"]);
      await clickMarketPeriod(emptyFeedPage, "60D");
      await expectUsableMarketChart(emptyFeedPage, STRK260_PERIOD_EXPECTATIONS["60D"]);
      await clickMarketPeriod(emptyFeedPage, "90D");
      await expectUsableMarketChart(emptyFeedPage, STRK260_PERIOD_EXPECTATIONS["90D"]);
      await emptyFeedPage.close();

      const invalidFeedPage = await page.context().newPage();
      const invalidFeedStatuses = [];
      await setupRetailFixture(invalidFeedPage, {
        retailFeeds: {
          [SLUG_SILVER_A]: {
            ...STRK260_MODAL_FEEDS[SLUG_SILVER_A],
            "history-90d": STRK260_ALL_INVALID_HISTORY_ROWS,
          },
        },
      });
      await waitForRetailBackgroundSync(invalidFeedPage);
      invalidFeedPage.on("response", (response) => {
        if (
          new URL(response.url()).pathname.endsWith(`/retail/${SLUG_SILVER_A}/history-90d.json`)
        ) {
          invalidFeedStatuses.push(response.status());
        }
      });
      await clickStrk260MarketDetail(invalidFeedPage);
      expect(invalidFeedStatuses).toEqual([200]);
      for (const label of ["60D", "90D"]) {
        await clickMarketPeriod(invalidFeedPage, label);
        await expectUnavailableMarketChart(invalidFeedPage);
      }
      await clickMarketPeriod(invalidFeedPage, "24H");
      await expectUsableMarketChart(invalidFeedPage, STRK260_PERIOD_EXPECTATIONS["24H"]);
      await clickMarketPeriod(invalidFeedPage, "7D");
      await expectUsableMarketChart(invalidFeedPage, STRK260_PERIOD_EXPECTATIONS["7D"]);
      await clickMarketPeriod(invalidFeedPage, "30D");
      await expectUsableMarketChart(invalidFeedPage, STRK260_PERIOD_EXPECTATIONS["30D"]);
      await invalidFeedPage.close();
    });

    test("period switching never changes the current Vendor comparison table", async ({ page }) => {
      await openStrk260MarketDetail(page);

      const currentTable = page.locator("#marketDetailContent table tbody");
      const initialRows = await currentTable.allTextContents();
      expect(initialRows.join(" ")).toContain("$38.00");

      for (const label of ["24H", "7D", "30D", "60D", "90D", "7D"]) {
        await clickMarketPeriod(page, label);
        await expect(currentTable).toHaveText(initialRows[0]);
      }
    });

    test("currencychange converts once and preserves the selected period", async ({ page }) => {
      await openStrk260MarketDetail(page, { exchangeRates: { EUR: 0.5 } });
      await clickMarketPeriod(page, "24H");
      await page.evaluate(() => window.saveDisplayCurrency("EUR"));

      await expect(marketPeriodButton(page, "24H")).toHaveAttribute("aria-pressed", "true");
      await expectUsableMarketChart(page, {
        summary: {
          Median: "€53.50",
          Low: "€50.50",
          High: "€55.50",
          Spread: "€5.00",
        },
        series: convertSeriesPayload(STRK260_PERIOD_EXPECTATIONS["24H"].series, 0.5),
      });
      await expect(page.locator("#marketDetailContent table tbody")).toContainText("€19.00");
      await expect(page.locator("#marketDetailContent")).toContainText(CURRENCY_DISCLAIMER);

      const chart = activeMarketChart(await getMarketChartHarness(page));
      expect(chartSeriesPayload(chart)).toEqual(
        convertSeriesPayload(STRK260_PERIOD_EXPECTATIONS["24H"].series, 0.5)
      );
      expect(chart.hasPriceFormatter).toBe(true);
      expect(chart.formattedHundred).toBe("€100.00");
    });

    test("close during modal loading invalidates the pending render", async ({ page }) => {
      await setupRetailFixture(page);
      const gate = await gatePrimaryRetailLatest(page, SLUG_SILVER_A);

      const pendingOpen = page.evaluate(
        (slug) => window.openMarketDetailModal(slug),
        SLUG_SILVER_A
      );
      await gate.requested;
      await expect(page.locator("#marketDetailModal")).toBeVisible();
      await expect(page.locator("#marketDetailContent")).toHaveText("Loading coin details…");

      await page.locator("#marketDetailCloseBtn").click();
      await expect(page.locator("#marketDetailModal")).toBeHidden();
      await expect(page.locator("#marketDetailContent")).toBeEmpty();

      gate.release();
      await pendingOpen;

      await expect(page.locator("#marketDetailModal")).toBeHidden();
      await expect(page.locator("#marketDetailContent")).toBeEmpty();
      await expect.poll(async () => (await getMarketChartHarness(page)).rootCount).toBe(0);
    });

    test("an older modal response cannot overwrite a newer open", async ({ page }) => {
      await setupRetailFixture(page);
      const olderGate = await gatePrimaryRetailLatest(page, SLUG_SILVER_A);

      const olderOpen = page.evaluate((slug) => window.openMarketDetailModal(slug), SLUG_SILVER_A);
      await olderGate.requested;
      await expect(page.locator("#marketDetailContent")).toHaveText("Loading coin details…");

      await page.evaluate((slug) => window.openMarketDetailModal(slug), SLUG_SILVER_Z);
      await expect(page.locator("#marketDetailTitle")).toContainText("Zebra Silver Round");
      await expect(page.locator("#marketDetailContent table tbody")).toContainText("$42.00");
      await expect.poll(async () => (await getMarketChartHarness(page)).rootCount).toBe(1);
      const newerChart = activeMarketChart(await getMarketChartHarness(page));
      expect(chartSeriesPayload(newerChart)).toEqual([
        {
          title: "Hero",
          data: [{ time: RECENT_DATE, value: priceRows[SLUG_SILVER_Z].price }],
        },
      ]);

      olderGate.release();
      await olderOpen;

      await expect(page.locator("#marketDetailTitle")).toContainText("Zebra Silver Round");
      await expect(page.locator("#marketDetailContent table tbody")).toContainText("$42.00");
      await expect(page.locator("#marketDetailContent table tbody")).not.toContainText("$38.00");
      await expect.poll(async () => (await getMarketChartHarness(page)).rootCount).toBe(1);
      const finalChart = activeMarketChart(await getMarketChartHarness(page));
      expect(finalChart.id).toBe(newerChart.id);
      expect(chartSeriesPayload(finalChart)).toEqual(chartSeriesPayload(newerChart));
    });

    test("api1 failure reaches api2 for all modal feeds including 90-day history", async ({
      page,
    }) => {
      await setupRetailFixture(page, {
        failPrimary: true,
        retailFeeds: STRK260_MODAL_FEEDS,
      });
      await page.waitForFunction(
        () =>
          localStorage.getItem("appTheme") !== null &&
          localStorage.getItem("defaultSortDir") !== null
      );
      const storageKeysBeforeModal = await page.evaluate(() => Object.keys(localStorage).sort());
      const requests = [];
      page.on("request", (request) => {
        if (request.url().includes(`/retail/${SLUG_SILVER_A}/`)) {
          const url = new URL(request.url());
          requests.push({
            origin: url.origin,
            filename: url.pathname.split("/").at(-1),
            pathname: url.pathname,
            query: url.search,
            method: request.method(),
            postData: request.postData(),
            headers: request.headers(),
          });
        }
      });

      await page
        .locator(".vendor-prices-table .vp-coin-link", { hasText: "Alpha Silver Bar" })
        .click();
      await expect(page.locator("#marketDetailModal")).toBeVisible();
      await expect(page.locator("#marketDetailContent table tbody")).toContainText("$38.00");

      for (const label of ["7D", "24H", "30D", "60D", "90D"]) {
        const period = STRK260_PERIOD_EXPECTATIONS[label];
        await clickMarketPeriod(page, period.label);
        await expectUsableMarketChart(page, period);
      }

      for (const filename of [
        "latest.json",
        "intraday.json",
        "history-30d.json",
        "history-90d.json",
      ]) {
        const attempts = requests.filter((request) => request.filename === filename);
        expect(attempts.map((request) => request.origin)).toEqual([
          "https://api.staktrakr.com",
          "https://api2.staktrakr.com",
        ]);
        expect(attempts.map((request) => request.pathname)).toEqual([
          `/data/v2/retail/${SLUG_SILVER_A}/${filename}`,
          `/data/v2/retail/${SLUG_SILVER_A}/${filename}`,
        ]);
      }

      expect(requests.every((request) => request.method === "GET")).toBe(true);
      expect(requests.every((request) => request.postData === null)).toBe(true);
      expect(requests.every((request) => request.query === "")).toBe(true);
      const forbiddenHeaders = new Set([
        "authorization",
        "cookie",
        "proxy-authorization",
        "x-api-key",
      ]);
      expect(
        requests.flatMap((request) =>
          Object.keys(request.headers).filter((header) =>
            forbiddenHeaders.has(header.toLowerCase())
          )
        )
      ).toEqual([]);
      expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(
        storageKeysBeforeModal
      );
    });

    test("daily chart times retain publisher UTC dates in a UTC+12 browser timezone", async ({
      page,
    }) => {
      await openStrk260MarketDetail(page);
      expect(await page.evaluate(() => new Date().getTimezoneOffset())).toBe(-720);

      await clickMarketPeriod(page, "90D");
      await expect.poll(async () => (await getMarketChartHarness(page)).rootCount).toBe(1);
      const chart = activeMarketChart(await getMarketChartHarness(page));
      expect(chartSeriesPayload(chart)).toEqual(STRK260_PERIOD_EXPECTATIONS["90D"].series);
    });

    test("completed switching stays within the convergence deadline and repeated renders retain one final 90D chart", async ({
      page,
    }) => {
      await openStrk260MarketDetail(page);
      await expect.poll(async () => (await getMarketChartHarness(page)).rootCount).toBe(1);

      const measurements = await measureCompletedMarketSwitches(page, STRK260_PERIODS);
      expect(measurements).toHaveLength(STRK260_PERIODS.length * 3);
      for (const measurement of measurements) {
        expect(measurement.completed, JSON.stringify(measurement)).toBe(true);
        // Bound matches measureCompletedMarketSwitches' own 1000ms deadline rather
        // than the old 400ms wall-clock figure (STRK-310). `completed === true` is
        // what pins the contract — it can only be true if button state, summary,
        // chart series and root count all converged inside the deadline.
        //
        // The 400ms bound did uniquely cover the 400-999ms band, so this is a
        // deliberate narrowing, not a free win. It was dropped because that band
        // is also where shared-runner noise lives: a red there could not
        // distinguish an app regression from a loaded CI box, so it failed
        // intermittently on timing rather than on behaviour. The coverage-map
        // row for this file records the revised contract.
        expect(measurement.durationMs, measurement.id).toBeLessThan(1000);
      }

      await expect.poll(async () => (await getMarketChartHarness(page)).rootCount).toBe(1);

      const snapshot = await getMarketChartHarness(page);
      const modalInstances = snapshot.instances.filter(
        (instance) => instance.containerId === "marketDetailChartArea"
      );
      expect(modalInstances.length).toBeGreaterThan(5);
      expect(new Set(modalInstances.map((instance) => instance.id)).size).toBe(
        modalInstances.length
      );
      expect(modalInstances.filter((instance) => instance.active)).toHaveLength(1);
      expect(modalInstances.filter((instance) => !instance.removed)).toHaveLength(1);
      expect(snapshot.removeCount).toBeGreaterThanOrEqual(modalInstances.length - 1);
      expect(snapshot.peakRootCount).toBeLessThanOrEqual(1);
      expect(snapshot.rootEvents.length).toBeGreaterThan(0);
      expect(snapshot.rootEvents.every((event) => event.rootCount <= 1)).toBe(true);

      await expect(marketPeriodButton(page, "90D")).toHaveAttribute("aria-pressed", "true");
      await expect(marketPeriodButton(page, "90D")).toHaveClass(/\bactive\b/);
      const finalChart = activeMarketChart(snapshot);
      expect(chartSeriesPayload(finalChart)).toEqual(STRK260_PERIOD_EXPECTATIONS["90D"].series);

      await page.locator("#marketDetailCloseBtn").click();
      await expect(page.locator("#marketDetailModal")).toBeHidden();
      await expect.poll(async () => (await getMarketChartHarness(page)).rootCount).toBe(0);
      const afterClose = await getMarketChartHarness(page);
      expect(
        afterClose.instances.filter(
          (instance) => instance.containerId === "marketDetailChartArea" && !instance.removed
        )
      ).toHaveLength(0);

      await page
        .locator(".vendor-prices-table .vp-coin-link", { hasText: "Alpha Silver Bar" })
        .click();
      await expect(page.locator("#marketDetailModal")).toBeVisible();
      await expect(page.locator("#marketDetailContent button[data-period].active")).toHaveCount(1);
      await expect(
        page.locator('#marketDetailContent button[data-period][aria-pressed="true"]')
      ).toHaveCount(1);
      await expect(marketPeriodButton(page, "7D")).toHaveClass(/\bactive\b/);
      await expect(marketPeriodButton(page, "7D")).toHaveAttribute("aria-pressed", "true");
      for (const label of ["24H", "30D", "60D", "90D"]) {
        await expect(marketPeriodButton(page, label)).not.toHaveClass(/\bactive\b/);
        await expect(marketPeriodButton(page, label)).toHaveAttribute("aria-pressed", "false");
      }
      await expectUsableMarketChart(page, STRK260_PERIOD_EXPECTATIONS["7D"]);
      const reopenedChart = activeMarketChart(await getMarketChartHarness(page));
      expect(reopenedChart.id).not.toBe(finalChart.id);
      expect(chartSeriesPayload(reopenedChart)).toEqual(STRK260_PERIOD_EXPECTATIONS["7D"].series);

      await page.locator("#marketDetailCloseBtn").click();
      await expect(page.locator("#marketDetailModal")).toBeHidden();
      await expect.poll(async () => (await getMarketChartHarness(page)).rootCount).toBe(0);
      const afterSecondClose = await getMarketChartHarness(page);
      expect(
        afterSecondClose.instances.filter(
          (instance) => instance.containerId === "marketDetailChartArea" && !instance.removed
        )
      ).toHaveLength(0);
      expect(
        afterSecondClose.instances.find((instance) => instance.id === reopenedChart.id)?.removed
      ).toBe(true);
    });
  });
});

// STRK-290 — the Market block's refresh control.
//
// The block has always rendered a "↻ Refresh" button (js/market-data.js
// renderVendorPrices), but it was wired to startRetailBackgroundSync(), whose
// body is gated behind `if (isStale || missingProviders || missingSlugs)` with
// RETAIL_STALE_MS = 1 hour and no else branch. On data under an hour old the
// click therefore did nothing at all: the button greyed itself out, showed "↻…"
// for a hard-coded 5s setTimeout, re-rendered the same cached data and
// re-enabled. It looked like it worked.
//
// These tests pin the fix: the control must reach syncRetailPrices(), which
// syncs unconditionally, and must drive its own disabled/label state off the
// real promise rather than a timeout that is unrelated to the work.
//
// The seed below matters more than usual — every one of the three guard
// conditions has to be FALSE or the old code path syncs anyway and the test
// passes against the bug. Mirrors the AC-9 seed above (`:1885`).
test.describe("STRK-290 — market block refresh control", () => {
  /**
   * Counting v2 handler — serves the standard fixtures while tallying
   * providers.json fetches.
   *
   * providers.json is the observable that actually discriminates here, and
   * picking it took a correction: manifest.json does NOT work. The pre-fix
   * button's 5s setTimeout re-runs initMarketData(), which calls _ensureManifest()
   * and re-fetches the manifest — so a manifest tally rises even when no sync
   * ran, and the test passes against the bug. providers.json has exactly one
   * caller in the codebase, _fetchAndApplyV2Providers at js/retail.js:1165,
   * reached only from inside _syncRetailV2. If it is fetched, a real sync ran.
   * goldback/latest.json is tallied separately because it is NOT part of the
   * retail sync at all — syncRetailPrices never requests it. It reaches the
   * network only via _seedAndRefreshGoldbackG1Rate (js/market-data.js), which
   * the refresh path has to call explicitly. Counting it apart from
   * providers.json is what keeps "vendor feeds refreshed" and "the Goldback G1
   * benchmark refreshed" independently observable.
   * @param {{ providers: number, goldback: number }} counter - Mutable tallies
   * @returns {(route: import('@playwright/test').Route) => Promise<void>} Route handler
   */
  function makeCountingV2Handler(counter) {
    const fulfill = makeV2Handler();
    return async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname.endsWith("/providers.json")) counter.providers += 1;
      if (pathname.endsWith("/goldback/latest.json")) counter.goldback += 1;
      return fulfill(route);
    };
  }

  /** Reads the retail sync log length — appended to only by the sync path
   * (_appendSyncLogEntry, js/retail.js:414), so growth proves the sync ran to
   * completion rather than merely starting. */
  const syncLogLength = (page) =>
    page.evaluate(() => {
      try {
        return (JSON.parse(localStorage.getItem("retailSyncLog") || "[]") || []).length;
      } catch {
        return 0;
      }
    });

  /**
   * Boots the market block with every background-sync guard already satisfied:
   * lastSync pinned to FIXED_NOW (not stale), a non-empty providers map, and a
   * populated manifest slug list. Under those conditions the pre-fix Refresh
   * button is a total no-op, which is exactly the state we need to observe.
   * @param {import('@playwright/test').Page} page - Page under test
   * @param {{ manifest: number }} counter - Mutable manifest-fetch tally
   * @returns {Promise<void>}
   */
  async function bootFreshMarketBlock(page, counter) {
    await routeExchangeAndCharts(page);
    await injectSeedInventory(page);
    await page.addInitScript({ content: lightweightChartsStub });
    await page.addInitScript(
      ({ seeded, meta, vendors, freshSync }) => {
        const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
        const summary = JSON.parse(JSON.stringify(seeded.prices));
        // Guard 1 — isStale: lastSync inside RETAIL_STALE_MS of the pinned clock.
        summary.lastSync = freshSync;
        writeJson("v2RetailPrices", summary);
        writeJson("retailPrices", summary);
        writeJson("v2RetailHistory", seeded.history);
        writeJson("retailPriceHistory", seeded.history);
        writeJson("v2RetailIntraday", seeded.intraday);
        writeJson("retailIntradayData", seeded.intraday);
        // Guard 3 — missingSlugs: a populated manifest slug list.
        writeJson("retailManifestSlugs", Object.keys(meta));
        writeJson("retailManifestCoinMeta", meta);
        writeJson("retailManifestVendorMeta", vendors);
        // Guard 2 — missingProviders: a non-empty providers map.
        writeJson("retailProviders", { [Object.keys(meta)[0]]: { apmex: "https://apmex.com/x" } });
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
      }
    );

    await page.route("https://api.staktrakr.com/data/v2/**", makeCountingV2Handler(counter));
    await page.route("https://api2.staktrakr.com/data/v2/**", async (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
    );
    await bootMarketDataPage(page);
  }

  /** The in-block refresh control, matched on its visible label so the assertion
   * survives the id being introduced by this same change. */
  const refreshControl = (page) =>
    page.locator("#vendorPricesSectionEl button").filter({ hasText: "Refresh" });

  test("clicking Refresh runs a real market sync even when cached data is fresh", async ({
    page,
  }) => {
    const counter = { providers: 0, goldback: 0 };
    await bootFreshMarketBlock(page, counter);

    // Boot legitimately syncs; only post-click traffic is evidence here.
    const providersAfterBoot = counter.providers;
    const logAfterBoot = await syncLogLength(page);

    await refreshControl(page).click();

    // RED: the click reached startRetailBackgroundSync(), whose guard is false on
    // all three conditions, so it returned without syncing and providers.json is
    // never re-fetched. GREEN: syncRetailPrices() syncs unconditionally.
    await expect
      .poll(() => counter.providers, { timeout: 8000 })
      .toBeGreaterThan(providersAfterBoot);

    // And the sync ran to completion, not merely started.
    await expect.poll(() => syncLogLength(page), { timeout: 8000 }).toBeGreaterThan(logAfterBoot);
  });

  test("Refresh also re-fetches the Goldback G1 benchmark, not just vendor feeds", async ({
    page,
  }) => {
    const counter = { providers: 0, goldback: 0 };
    await bootFreshMarketBlock(page, counter);

    const goldbackAfterBoot = counter.goldback;

    await refreshControl(page).click();

    // Raised in review. syncRetailPrices covers vendor/retail feeds but never
    // requests goldback/latest.json, so a refresh built only on it would update
    // vendor prices while Goldback premiums kept rendering against a stale
    // _goldbackG1Rate until reload. The control's previous implementation got
    // this for free by re-arming initMarketData(); the replacement has to call
    // _seedAndRefreshGoldbackG1Rate() explicitly, and this is what pins it.
    await expect.poll(() => counter.goldback, { timeout: 8000 }).toBeGreaterThan(goldbackAfterBoot);
  });

  test("Refresh reports progress and restores itself when the sync settles", async ({ page }) => {
    const counter = { providers: 0, goldback: 0 };
    await bootFreshMarketBlock(page, counter);

    const button = refreshControl(page);
    await button.click();

    // The pre-fix button ALSO ended up enabled with the idle label, so presence
    // alone proves nothing — it was restored by a hard-coded `setTimeout(…, 5000)`
    // that had no relationship to the sync. The discriminator is the deadline:
    // against mocked routes the awaited sync settles in well under a second, so
    // a 3s budget passes comfortably on the fix and cannot be met by a 5s timer.
    // page.clock.setFixedTime freezes Date but does NOT fake timers, so that 5s
    // is still 5s of real time here.
    await expect(button).toBeEnabled({ timeout: 3000 });
    await expect(button).toContainText("Refresh");

    // Pin that the restore followed real work, so the deadline above can never
    // be satisfied by a control that simply never disabled itself.
    expect(await syncLogLength(page)).toBeGreaterThan(0);
  });

  test("the refresh control has a stable id so it is greppable and testable", async ({ page }) => {
    const counter = { providers: 0, goldback: 0 };
    await bootFreshMarketBlock(page, counter);

    // RED: the button was built by createElement with no id and inline cssText,
    // giving it no searchable handle at all. In a codebase of script-tag globals
    // where grep on identifiers IS the call graph, that is what let a broken
    // control sit unnoticed and be reported as "there is no market refresh
    // button on the main page" during the STRK-290 investigation.
    await expect(page.locator("#marketRefreshBtn")).toHaveCount(1);
  });

  test("market freshness is shown in the block the data lives in", async ({ page }) => {
    const counter = { providers: 0, goldback: 0 };
    await bootFreshMarketBlock(page, counter);

    // #headerMarketDot retires with the header button; its freshness signal moves
    // here rather than being dropped. Asserting a colour class (not just presence)
    // proves updateMarketHealthDot actually repainted the relocated node — an
    // unpainted dot would still satisfy a presence-only check.
    const dot = page.locator("#marketFreshnessDot");
    await expect(dot).toHaveCount(1);
    await expect(dot).toHaveClass(/header-cloud-dot--(green|orange|red)/);

    // The class assertion above is NOT sufficient on its own, which is worth
    // stating because the first cut of this change shipped past it: the dot
    // originally carried .header-cloud-dot, which is `position: absolute` with
    // bottom/right offsets because it used to be a badge on a header button's
    // corner. It painted the right colour while being yanked out of this flex
    // row and anchored to an unrelated ancestor. Pinning the computed position
    // is what makes the assertion about placement rather than colour.
    await expect(dot).toBeVisible();
    expect(await dot.evaluate((el) => getComputedStyle(el).position)).not.toBe("absolute");
  });
});

// STRK-332 — a fresh manifest does not promise a complete export.
//
// exportRetail() catches and skips individual slug failures, yet main() still
// writes a fresh manifest afterward — so the endpoint with the newest
// generated_at can legitimately be missing some slug files. The sync used to
// fetch every slug exclusively from that one base, and a per-slug gap degraded
// straight to the previously stored price with no attempt at the other
// endpoint. NOTE this exposure PRE-DATES the freshest-wins change: the old
// first-HTTP-OK selection was equally single-base. STRK-331 only changed which
// endpoint can be chosen.
//
// The runners-up from the manifest race are now retained and retried per file.
test.describe("STRK-332 — retail per-slug fallback across endpoints", () => {
  const FRESH_MANIFEST_AT = "2026-05-26T12:00:00.000Z";
  const OLDER_MANIFEST_AT = "2026-05-26T11:00:00.000Z";
  const GAP_SLUG = SLUG_SILVER_A;
  const API1 = "https://api.staktrakr.com/data/v2";
  const API2 = "https://api2.staktrakr.com/data/v2";

  /**
   * Build a v2 manifest envelope carrying the fixture's full coin and vendor
   * set at a caller-chosen publication time, so the two endpoints can be given
   * deliberately different generated_at values and the freshest-wins race has a
   * defined winner instead of a stable-sort tie.
   * @param {string} generatedAt - ISO publication timestamp for the envelope
   * @returns {string} The serialized manifest envelope
   */
  const manifestBody = (generatedAt) =>
    JSON.stringify({
      v: 2,
      generated_at: generatedAt,
      data: {
        coins: Object.entries(coinMeta).map(([slug, meta]) => ({
          slug,
          name: meta.name,
          weight_oz: meta.weight,
          metal: meta.metal === "silver" ? "xag" : meta.metal === "gold" ? "xau" : meta.metal,
        })),
        vendors: VENDORS,
      },
    });

  /**
   * Boot the app against a two-endpoint fixture and run one retail sync.
   *
   * api1 always publishes the NEWER manifest, so it wins the freshest-wins race
   * and becomes the primary; api2 is a full export behind an older manifest.
   * The only thing the cases differ on is how api1 answers for the gap slug's
   * latest.json, which the caller supplies.
   * @param {import('@playwright/test').Page} page - The page under test
   * @param {Function} gapResponder - Route handler for api1's gap-slug latest.json
   * @returns {Promise<Function>} Reader returning the captured v2 request URLs
   */
  const runFallbackSync = async (page, gapResponder) => {
    const requested = [];
    page.on("request", (req) => requested.push(req.url()));
    const base = makeV2Handler();

    const withManifest = (generatedAt, special) => async (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^\/data\/v2\//, "");
      if (path === "manifest.json") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: manifestBody(generatedAt),
        });
      }
      if (special && path === `retail/${GAP_SLUG}/latest.json`) return special(route);
      return base(route);
    };

    await page.route(
      "https://api.staktrakr.com/data/v2/**",
      withManifest(FRESH_MANIFEST_AT, gapResponder)
    );
    await page.route(
      "https://api2.staktrakr.com/data/v2/**",
      withManifest(OLDER_MANIFEST_AT, null)
    );

    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.syncRetailPrices === "function");
    await page.evaluate(() => window.syncRetailPrices({ ui: false }));

    return () => requested.filter((url) => url.includes("staktrakr.com/data/v2"));
  };

  const GAP_PATH = `retail/${GAP_SLUG}/latest.json`;

  test("a slug missing from the freshest endpoint is retried against the other endpoint", async ({
    page,
  }) => {
    // api1's export is missing this one slug's latest.json — the exportRetail skip.
    const v2Urls = await runFallbackSync(page, (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
    );
    const gapPath = GAP_PATH;

    // POLL, do not snapshot. syncRetailPrices has an in-progress guard, so the
    // explicit call above can no-op against the boot sync and return before any
    // slug is fetched — asserting on a snapshot here fails ~5 runs in 5.
    // The api2 gap request is the right thing to wait for: it is issued only
    // after api1's 503 for that same file resolves, and every api1 slug request
    // was already issued up-front by the Promise.all, so once this URL appears
    // the api1 side of the picture is complete and the assertions below are
    // reading a settled request log rather than a partial one.
    await expect.poll(v2Urls, { timeout: 15000 }).toContain(`${API2}/${gapPath}`);

    const urls = v2Urls();
    // The freshest endpoint is still the primary and was asked first.
    expect(urls).toContain(`${API1}/${gapPath}`);

    // The fallback is SCOPED to actual gaps: a file api1 served successfully is
    // never re-fetched from api2, or every sync would double its request count.
    // (Files missing from BOTH endpoints — this fixture's deliberately
    // unresolvable synthetic slugs — are legitimately retried on api2 and then
    // give up, which is the cost a fallback is supposed to pay.)
    expect(urls).toContain(`${API1}/retail/${SLUG_GOLD_A}/latest.json`);
    expect(urls).not.toContain(`${API2}/retail/${SLUG_GOLD_A}/latest.json`);
  });

  test("a stale-but-200 slug file is rejected and escalates to the other endpoint", async ({
    page,
  }) => {
    // Review finding (Codex, P1). Endpoint reachability only proves an
    // HTTP-successful MANIFEST, and no per-file freshness check existed for
    // either endpoint — so an arbitrarily old slug file could supply the
    // displayed price while _syncRetailV2 stored the winner's fresh manifest
    // timestamp and painted the market freshness dot green. That is the
    // STRK-331 defect class reached by a different route: a freshness signal
    // describing something other than the data on screen.
    //
    // A stale 200 is the shape that matters. A 503 was already handled by the
    // test above; a stale 200 is indistinguishable from a good response without
    // a gate, which is exactly why the strict stale_after check has to exist.
    const staleIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const v2Urls = await runFallbackSync(page, (route) =>
      // HTTP 200, well-formed, two hours past a 30-minute budget.
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 2,
          generated_at: staleIso,
          stale_after: 1800,
          data: latestForSlug(GAP_SLUG),
        }),
      })
    );

    // Same polling rationale as the test above.
    await expect.poll(v2Urls, { timeout: 15000 }).toContain(`${API2}/${GAP_PATH}`);
    expect(v2Urls()).toContain(`${API1}/${GAP_PATH}`);
  });
});

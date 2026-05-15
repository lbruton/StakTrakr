/**
 * Shared mock fixtures for StakTrakr Playwright tests.
 *
 * Provides deterministic response data for external API calls so the suite
 * runs without real network requests.
 */

const fs = require("fs");
const path = require("path");

// ── Timestamp helpers ───────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();

// ── Exchange rates ──────────────────────────────────────────────────────────

const DEFAULT_EXCHANGE_RATES = {
  result: "success",
  base_code: "USD",
  rates: {
    EUR: 0.92,
    GBP: 0.79,
    CAD: 1.36,
    AUD: 1.52,
    CHF: 0.88,
    JPY: 150.0,
  },
};

const makeExchangeRates = (overrides = {}) => ({
  ...DEFAULT_EXCHANGE_RATES,
  ...overrides,
  rates: { ...DEFAULT_EXCHANGE_RATES.rates, ...(overrides.rates || {}) },
});

// ── v2 envelope factory ─────────────────────────────────────────────────────

const v2 = (data, generatedAt) => ({
  v: 2,
  generated_at: generatedAt || nowIso(),
  data,
});

// ── Manifest ────────────────────────────────────────────────────────────────

const DEFAULT_MANIFEST = {
  coins: [
    { slug: "1oz-silver-eagle", name: "1 oz Silver Eagle", weight_oz: 1, metal: "xag" },
    { slug: "1oz-gold-eagle", name: "1 oz Gold Eagle", weight_oz: 1, metal: "xau" },
    { slug: "utah-1-goldback", name: "Utah 1 Goldback", weight_oz: 0.001, metal: "goldback" },
  ],
  vendors: [
    { id: "apmex", name: "APMEX", color: "#60a5fa", url: "https://www.apmex.com" },
    { id: "jmbullion", name: "JM Bullion", color: "#ef4444", url: "https://www.jmbullion.com" },
    { id: "herobullion", name: "Hero Bullion", color: "#10b981", url: "https://herobullion.com" },
  ],
};

const makeManifest = (overrides = {}) =>
  v2(
    {
      coins: overrides.coins || DEFAULT_MANIFEST.coins,
      vendors: overrides.vendors || DEFAULT_MANIFEST.vendors,
    },
    overrides.generated_at
  );

// ── Retail price shapes ─────────────────────────────────────────────────────

const makeRetailLatest = (slug, prices, generatedAt) =>
  v2(
    {
      lastSync: generatedAt || nowIso(),
      window_start: generatedAt || nowIso(),
      prices: prices || {},
    },
    generatedAt
  );

const makeRetailHistory = (rows, generatedAt) => v2(rows || [], generatedAt);

const makeRetailIntraday = (rows, generatedAt) => v2(rows || [], generatedAt);

// ── Goldback ────────────────────────────────────────────────────────────────

const DEFAULT_GOLDBACK = { g1_usd: 4.25 };

const makeGoldbackLatest = (overrides = {}) => v2({ ...DEFAULT_GOLDBACK, ...overrides });

// ── Providers ───────────────────────────────────────────────────────────────

const DEFAULT_PROVIDERS = {
  providers: [
    {
      id: "apmex",
      name: "APMEX",
      baseUrl: "https://www.apmex.com",
      searchUrl: "https://www.apmex.com/search?q={query}",
      productUrl: "https://www.apmex.com/product/{id}",
      enabled: true,
    },
    {
      id: "jmbullion",
      name: "JM Bullion",
      baseUrl: "https://www.jmbullion.com",
      searchUrl: "https://www.jmbullion.com/search?q={query}",
      productUrl: "https://www.jmbullion.com/product/{id}",
      enabled: true,
    },
  ],
};

const makeProviders = (overrides = {}) => v2({ ...DEFAULT_PROVIDERS, ...overrides });

// ── CDN lightweight-charts stub ─────────────────────────────────────────────

const LIGHTWEIGHT_CHARTS_STUB = `
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
          },
        };
      },
      addHistogramSeries() {
        return {
          setData(data) {
            const nextCount = Number(root.dataset.pointCount || 0) + data.length;
            root.dataset.pointCount = String(nextCount);
          },
        };
      },
      addAreaSeries() {
        return {
          setData(data) {
            const nextCount = Number(root.dataset.pointCount || 0) + data.length;
            root.dataset.pointCount = String(nextCount);
          },
        };
      },
      applyOptions() {},
      resize() {},
      timeScale() {
        return { fitContent() {}, applyOptions() {} };
      },
    };
  },
};
`;

// ── Image bytes ─────────────────────────────────────────────────────────────

const getImageBytes = (name) => {
  const helpersDir = path.join(__dirname, "..");
  const filePath = path.join(helpersDir, name);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath);
  }
  // Return a minimal 1x1 transparent PNG if fixture image is missing
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
};

module.exports = {
  nowIso,
  v2,
  makeExchangeRates,
  makeManifest,
  makeRetailLatest,
  makeRetailHistory,
  makeRetailIntraday,
  makeGoldbackLatest,
  makeProviders,
  LIGHTWEIGHT_CHARTS_STUB,
  getImageBytes,
  // Raw defaults for convenient override
  DEFAULT_EXCHANGE_RATES,
  DEFAULT_MANIFEST,
  DEFAULT_GOLDBACK,
};

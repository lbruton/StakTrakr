/**
 * Shared mock fixtures for StakTrakr Playwright tests.
 *
 * Provides deterministic response data for external API calls so the suite
 * runs without real network requests.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// Default retail prices so the best-price ticker has data to render
const DEFAULT_RETAIL_LATEST = {
  "1oz-silver-eagle": {
    median_price: 32.0,
    lowest_price: 31.5,
    highest_price: 33.0,
    vendors: {
      apmex: { price: 32.0, inStock: true, in_stock: true },
    },
  },
  "1oz-gold-eagle": {
    median_price: 2550.0,
    lowest_price: 2540.0,
    highest_price: 2560.0,
    vendors: {
      jmbullion: { price: 2550.0, inStock: true, in_stock: true },
    },
  },
  "utah-1-goldback": {
    median_price: 4.25,
    lowest_price: 4.0,
    highest_price: 4.5,
    vendors: {
      herobullion: { price: 4.25, inStock: true, in_stock: true },
    },
  },
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

// ── Spot prices ─────────────────────────────────────────────────────────────

const DEFAULT_SPOT_LATEST = {
  xau: { price: 2500.0 },
  xag: { price: 25.0 },
  xpt: { price: 1000.0 },
  xpd: { price: 1000.0 },
};

const makeSpotLatest = (overrides = {}) => v2({ ...DEFAULT_SPOT_LATEST, ...overrides });

const makeSpotDay = (metal, price, timestamp) =>
  v2([
    {
      spot: price,
      metal: metal,
      source: "mock",
      provider: "TEST",
      timestamp: timestamp || nowIso(),
    },
  ]);

// ── Version check ───────────────────────────────────────────────────────────

const DEFAULT_VERSION = {
  version: "3.34.66",
  releaseDate: "2026-05-14",
  releaseUrl: "https://github.com/lbruton/StakTrakr/releases/latest",
};

const makeVersion = (overrides = {}) => ({ ...DEFAULT_VERSION, ...overrides });

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

export {
  nowIso,
  v2,
  makeExchangeRates,
  makeManifest,
  makeRetailLatest,
  makeRetailHistory,
  makeRetailIntraday,
  makeGoldbackLatest,
  makeProviders,
  makeSpotLatest,
  makeSpotDay,
  makeVersion,
  LIGHTWEIGHT_CHARTS_STUB,
  getImageBytes,
  // Raw defaults for convenient override
  DEFAULT_EXCHANGE_RATES,
  DEFAULT_MANIFEST,
  DEFAULT_GOLDBACK,
  DEFAULT_SPOT_LATEST,
  DEFAULT_RETAIL_LATEST,
};

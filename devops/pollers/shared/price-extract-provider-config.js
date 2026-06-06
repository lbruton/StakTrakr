/**
 * Provider scraping configuration for the retail price extractor.
 *
 * This module owns provider defaults, legacy provider overrides, and
 * compatibility predicates used while Vendor modules migrate one at a time.
 */

export const SCRAPE_TIMEOUT_MS = 30_000;
export const FIRECRAWL_TIMEOUT_MS = 55_000;

// Single source of truth for all Vendor-specific scraping behavior.
// Replaces scattered SLOW_PROVIDERS, FIRECRAWL_PREFERRED_PROVIDERS,
// FIRECRAWL_TABLE_PARSE_PROVIDERS, FRACTIONAL_EXEMPT_PROVIDERS, and
// inline if-chains for timeouts/waitFor/waitUntil.
//
// proxy.{pollerId}: "fly" = route through Fly.io proxy, "home" = route through
// home residential proxy, null = use poller's own IP.
//
// phase values:
//   "phase0"             -> Phase 0 (Playwright-direct) first, then Firecrawl, then CF-clearance fallback
//   "firecrawl"          -> Skip Phase 0, Firecrawl first, then CF-clearance fallback
//   "cf-clearance-first" -> Byparr/CF-clearance first, then Firecrawl fallback
export const PROVIDER_DEFAULTS = {
  phase: "phase0",
  waitFor: 0,
  waitUntil: "networkidle",
  waitAfter: 0,
  timeout: SCRAPE_TIMEOUT_MS,
  onlyMainContent: true,
  retryOn408: true,
  fractionalExempt: false,
  cf_clearance_fallback: false,
  requestHtml: false,
  proxy: {},
};

const LEGACY_PROVIDER_OVERRIDES = {
  monumentmetals: {
    phase: "firecrawl", // Same table extraction issue as apmex
    waitFor: 5000,
    timeout: 35_000,
    retryOn408: false, // page either renders in time or does not
  },
  jmbullion: {
    phase: "phase0", // Playwright-direct first; Byparr reserved as fallback
    // JM's CF tier upgraded beyond Byparr's 45s window around 2026-04-23;
    // fresh-session Byparr gets a harder challenge than a long-lived poller browser.
    waitFor: 10_000,
    timeout: 40_000,
    onlyMainContent: false, // React pages return empty with onlyMainContent
    retryOn408: false, // retrying will not help; skip to save about 40s
    cf_clearance_fallback: true,
    fractionalExempt: true, // mega-menu lists fractional coins on every page
  },
  bullionexchanges: {
    phase: "cf-clearance-first", // Byparr first, Firecrawl fallback
    waitFor: 15_000, // React pricing grid needs 12-15s to fully hydrate
    timeout: 70_000,
    fractionalExempt: true, // Related Products section lists fractional variants
    cf_clearance_fallback: true,
    proxy: {
      home: null, // home poller is on residential IP; no proxy needed
      fly: null, // Fly.io uses its own IP
    },
  },
  sdbullion: {
    waitUntil: "domcontentloaded", // fast; no need for networkidle
  },
  herobullion: {
    phase: "firecrawl", // Phase 0 innerText loses pipe-table structure
    waitFor: 3_000,
    // STRK-566: Hero pages keep the price visible even when the product is
    // sold out in JSON-LD. Pull HTML alongside markdown so scrapeUrl can
    // short-circuit on JSON-LD availability before the price extractor runs.
    requestHtml: true,
  },
  gainesvillecoins: {
    phase: "firecrawl", // Phase 0 Playwright direct always times out
    waitFor: 3_000,
  },
  // NOTE: apmex, goldback, and summitmetals are MIGRATED — their config lives in
  // their own price-extract-vendor-*.js modules, not here. Only not-yet-migrated
  // vendors remain in this transitional map (STRK-32 / STRK-150/151/152).
};

export function mergeProviderConfig(...configs) {
  const merged = {
    ...PROVIDER_DEFAULTS,
  };
  for (const cfg of configs) {
    if (!cfg) continue;
    Object.assign(merged, cfg);
  }
  merged.proxy = {
    ...PROVIDER_DEFAULTS.proxy,
    ...configs.reduce((proxy, cfg) => ({ ...proxy, ...(cfg?.proxy ?? {}) }), {}),
  };
  return merged;
}

export const LEGACY_PROVIDER_CONFIG = Object.fromEntries(
  Object.entries(LEGACY_PROVIDER_OVERRIDES).map(([id, cfg]) => [id, mergeProviderConfig(cfg)])
);

export function providerCfg(providerId, vendorModuleConfig = null) {
  const legacyConfig = LEGACY_PROVIDER_CONFIG[providerId] || PROVIDER_DEFAULTS;
  if (!vendorModuleConfig) return legacyConfig;
  return mergeProviderConfig(legacyConfig, vendorModuleConfig);
}

export function resolveProxy(providerId, env = process.env, providerConfig = null) {
  const cfg = providerConfig || providerCfg(providerId);
  const pollerId = env.POLLER_ID || "unknown";
  const target = cfg.proxy?.[pollerId] || null;
  if (target === "fly") return env.FLY_PROXY_URL || null;
  if (target === "home") return env.HOME_PROXY_URL || null;
  return null;
}

// Compatibility shims used by legacy code while call sites migrate to providerCfg().
export const FIRECRAWL_PREFERRED_PROVIDERS = new Set(
  Object.entries(LEGACY_PROVIDER_CONFIG)
    .filter(([, c]) => c.phase === "firecrawl")
    .map(([id]) => id)
);

export const FIRECRAWL_TABLE_PARSE_PROVIDERS = new Set(["monumentmetals"]);
export const PLAYWRIGHT_ONLY_PROVIDERS = new Set([]);

export const FRACTIONAL_EXEMPT_PROVIDERS = new Set(
  Object.entries(LEGACY_PROVIDER_CONFIG)
    .filter(([, c]) => c.fractionalExempt)
    .map(([id]) => id)
);

export const isFirecrawlPreferredProvider = (providerId) =>
  FIRECRAWL_PREFERRED_PROVIDERS.has(providerId);

export const isFirecrawlTableParseProvider = (providerId) =>
  FIRECRAWL_TABLE_PARSE_PROVIDERS.has(providerId);

export const isPlaywrightOnlyProvider = (providerId) => PLAYWRIGHT_ONLY_PROVIDERS.has(providerId);

export const isFractionalExemptProvider = (providerId) =>
  FRACTIONAL_EXEMPT_PROVIDERS.has(providerId);

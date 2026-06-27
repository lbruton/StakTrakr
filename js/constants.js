// CONFIGURATION & GLOBAL CONSTANTS
/**
 * API Provider configurations for metals pricing services
 *
 * Each provider configuration contains:
 * @property {string} name - Display name for the provider
 * @property {string} baseUrl - Base API endpoint URL
 * @property {Object} endpoints - API endpoints for different metals
 * @property {function} parseResponse - Function to parse API response into standard format
 * @property {string} documentation - URL to provider's API documentation
 * @property {boolean} batchSupported - Whether provider supports batch requests
 * @property {string} batchEndpoint - Batch request endpoint pattern
 * @property {function} parseBatchResponse - Function to parse batch API response
 */
const API_PROVIDERS = {
  STAKTRAKR: {
    name: "StakTrakr",
    baseUrl: "https://api.staktrakr.com/data",
    requiresKey: false,
    documentation: "https://www.staktrakr.com",
    endpoints: { silver: "", gold: "", platinum: "", palladium: "" },
    getEndpoint: () => "",
    parseResponse: () => null,
    parseBatchResponse: (data) => {
      const current = {};
      if (Array.isArray(data)) {
        data.forEach((e) => {
          if (e.metal && e.spot > 0) current[e.metal.toLowerCase()] = e.spot;
        });
      }
      return { current, history: {} };
    },
    batchSupported: false,
    maxHistoryDays: 365,
    symbolsPerRequest: "all",
  },
  METALS_DEV: {
    name: "Metals.dev",
    requiresKey: true,
    baseUrl: "https://api.metals.dev/v1",
    endpoints: {
      silver: "/metal/spot?api_key={API_KEY}&metal=silver&currency=USD",
      gold: "/metal/spot?api_key={API_KEY}&metal=gold&currency=USD",
      platinum: "/metal/spot?api_key={API_KEY}&metal=platinum&currency=USD",
      palladium: "/metal/spot?api_key={API_KEY}&metal=palladium&currency=USD",
    },
    latestBatchEndpoint: "/latest?api_key={API_KEY}&currency=USD&unit=toz",
    parseResponse: (data) => data.rate?.price || null,
    parseLatestBatchResponse: (data) => {
      const current = {};
      if (data?.metals) {
        Object.entries(data.metals).forEach(([metal, price]) => {
          if (typeof price === "number" && price > 0) {
            current[metal.toLowerCase()] = price;
          }
        });
      }
      return current;
    },
    documentation: "https://www.metals.dev/docs",
    maxHistoryDays: 30,
    symbolsPerRequest: "all",
    docUrl: "https://metals.dev/documentation",
    batchSupported: true,
    batchEndpoint: "/timeseries?api_key={API_KEY}&start_date={START_DATE}&end_date={END_DATE}",
    parseBatchResponse: (data) => {
      // Metals.dev /timeseries response:
      // { status, currency, unit, rates: { "YYYY-MM-DD": { metals: { gold: N, silver: N, ... } } } }
      const current = {};
      const history = {};
      if (data?.rates && typeof data.rates === "object") {
        const dates = Object.keys(data.rates).sort();
        dates.forEach((dateStr) => {
          const entry = data.rates[dateStr];
          const metals = entry.metals || entry;
          Object.entries(metals).forEach(([metal, price]) => {
            if (typeof price !== "number" || price <= 0) return;
            const key = metal.toLowerCase();
            if (!history[key]) history[key] = [];
            history[key].push({
              timestamp: `${dateStr} 00:00:00`,
              price,
            });
            // Latest date becomes current price
            current[key] = price;
          });
        });
      }
      return { current, history };
    },
  },
  METALS_API: {
    name: "Metals-API.com",
    requiresKey: true,
    baseUrl: "https://metals-api.com/api",
    endpoints: {
      silver: "/latest?access_key={API_KEY}&base=USD&symbols=XAG",
      gold: "/latest?access_key={API_KEY}&base=USD&symbols=XAU",
      platinum: "/latest?access_key={API_KEY}&base=USD&symbols=XPT",
      palladium: "/latest?access_key={API_KEY}&base=USD&symbols=XPD",
    },
    parseResponse: (data, metal) => {
      // Expected format: { "success": true, "rates": { "XAG": 0.04 } }
      const metalCode =
        metal === "silver"
          ? "XAG"
          : metal === "gold"
            ? "XAU"
            : metal === "platinum"
              ? "XPT"
              : "XPD";
      const rate = data.rates?.[metalCode];
      return rate ? 1 / rate : null; // Convert from metal per USD to USD per ounce
    },
    documentation: "https://metals-api.com/documentation",
    maxHistoryDays: 30,
    symbolsPerRequest: 1,
    docUrl: "https://metals-api.com/documentation",
    batchSupported: true,
    batchEndpoint:
      "/timeseries?access_key={API_KEY}&start_date={START_DATE}&end_date={END_DATE}&base=USD&symbols={SYMBOLS}",
    parseBatchResponse: (data) => {
      const current = {};
      const history = {};
      const symbolMap = {
        XAG: "silver",
        XAU: "gold",
        XPT: "platinum",
        XPD: "palladium",
      };
      if (data.rates) {
        const firstKey = Object.keys(data.rates)[0];
        if (
          firstKey &&
          typeof data.rates[firstKey] === "object" &&
          /^\d{4}-\d{2}-\d{2}$/.test(firstKey)
        ) {
          // Timeseries format: { date: { symbol: rate } }
          Object.entries(data.rates).forEach(([date, symbols]) => {
            Object.entries(symbols).forEach(([symbol, rate]) => {
              const metal = symbolMap[symbol];
              if (metal && rate) {
                const price = 1 / rate;
                if (!history[metal]) history[metal] = [];
                history[metal].push({
                  timestamp: `${date} 00:00:00`,
                  price,
                });
                current[metal] = price;
              }
            });
          });
        } else {
          Object.entries(data.rates).forEach(([symbol, rate]) => {
            const metal = symbolMap[symbol];
            if (metal && rate) current[metal] = 1 / rate;
          });
        }
      }
      return { current, history };
    },
  },
  METAL_PRICE_API: {
    name: "MetalPriceAPI.com",
    requiresKey: true,
    baseUrl: "https://api.metalpriceapi.com/v1",
    endpoints: {
      silver: "/latest?api_key={API_KEY}&base=USD&currencies=XAG",
      gold: "/latest?api_key={API_KEY}&base=USD&currencies=XAU",
      platinum: "/latest?api_key={API_KEY}&base=USD&currencies=XPT",
      palladium: "/latest?api_key={API_KEY}&base=USD&currencies=XPD",
    },
    parseResponse: (data, metal) => {
      // Expected format: { "success": true, "rates": { "XAG": 0.04 } }
      const metalCode =
        metal === "silver"
          ? "XAG"
          : metal === "gold"
            ? "XAU"
            : metal === "platinum"
              ? "XPT"
              : "XPD";
      const rate = data.rates?.[metalCode];
      return rate ? 1 / rate : null; // Convert from metal per USD to USD per ounce
    },
    documentation: "https://metalpriceapi.com/documentation",
    maxHistoryDays: 365,
    maxHourlyDays: 7,
    symbolsPerRequest: "all",
    docUrl: "https://metalpriceapi.com/documentation",
    batchSupported: true,
    batchEndpoint:
      "/timeframe?api_key={API_KEY}&start_date={START_DATE}&end_date={END_DATE}&base=USD&currencies={CURRENCIES}",
    hourlyEndpoint:
      "/hourly?api_key={API_KEY}&base=USD&currency={CURRENCY}&start_date={START_DATE}&end_date={END_DATE}",
    parseBatchResponse: (data) => {
      const current = {};
      const history = {};
      const symbolMap = {
        XAG: "silver",
        XAU: "gold",
        XPT: "platinum",
        XPD: "palladium",
      };
      if (data.rates) {
        const firstKey = Object.keys(data.rates)[0];
        if (
          firstKey &&
          typeof data.rates[firstKey] === "object" &&
          /^\d{4}-\d{2}-\d{2}$/.test(firstKey)
        ) {
          Object.entries(data.rates).forEach(([date, symbols]) => {
            Object.entries(symbols).forEach(([symbol, rate]) => {
              const metal = symbolMap[symbol];
              if (metal && rate) {
                const price = 1 / rate;
                if (!history[metal]) history[metal] = [];
                history[metal].push({
                  timestamp: `${date} 00:00:00`,
                  price,
                });
                current[metal] = price;
              }
            });
          });
        } else {
          Object.entries(data.rates).forEach(([symbol, rate]) => {
            const metal = symbolMap[symbol];
            if (metal && rate) current[metal] = 1 / rate;
          });
        }
      }
      return { current, history };
    },
  },
  GOLD_API: {
    name: "Gold API",
    baseUrl: "https://api.gold-api.com",
    requiresKey: false,
    optionalKey: true,
    documentation: "https://gold-api.com/docs",
    endpoints: {
      silver: "/price/XAG",
      gold: "/price/XAU",
      platinum: "/price/XPT",
      palladium: "/price/XPD",
    },
    parseResponse: (data) => {
      const price = data?.price;
      return typeof price === "number" && price > 0 ? price : null;
    },
    batchSupported: false,
    parseBatchResponse: () => ({ current: {}, history: {} }),
    maxHistoryDays: 0,
    symbolsPerRequest: 1,
  },
  CUSTOM: {
    name: "Custom Provider",
    requiresKey: true,
    baseUrl: "",
    endpoints: {
      silver: "",
      gold: "",
      platinum: "",
      palladium: "",
    },
    parseResponse: (data) => {
      if (typeof data === "number") return data;
      if (data.price) return data.price;
      if (data.rate && typeof data.rate === "number") return data.rate;
      return null;
    },
    documentation: "",
    custom: true,
    batchSupported: false, // Custom providers will use individual requests by default
    batchEndpoint: "",
    parseBatchResponse: (data) => {
      // Custom batch parsing would depend on the provider's API format
      return { current: {}, history: {} };
    },
  },
};

// =============================================================================

/**
 * Cert verification lookup URLs for grading authorities.
 * {certNumber} is replaced with the actual certification number.
 * URLs without {certNumber} open the generic verification page.
 *
 * @constant {Object.<string, string>}
 */
const CERT_LOOKUP_URLS = {
  PCGS: "https://www.pcgs.com/cert/{certNumber}",
  NGC: "https://www.ngccoin.com/certlookup/{certNumber}/?CertNum={certNumber}&Grade={grade}&lookup=",
  ANACS: "https://anacs.com/verify/",
  ICG: "https://www.icgcoin.com/verification/",
};

/**
 * @constant {string} APP_VERSION - Application version
 * Follows BRANCH.RELEASE.PATCH.state format
 * State codes: a=alpha, b=beta, rc=release candidate
 * Example: 3.03.02a → branch 3, release 03, patch 02, alpha
 * Updated: 2026-05-12 - STRK-66: Add ¼ Goldback denomination (Idaho, g0.25)
 */

const APP_VERSION = "3.35.60";

/**
 * Numista metadata cache TTL: 30 days in milliseconds.
 * Used by viewModal.js to skip re-fetching recently cached metadata.
 * @constant {number}
 */
const VIEW_METADATA_TTL = 30 * 24 * 60 * 60 * 1000;

/**
 * @constant {string} DEFAULT_CURRENCY - Default currency code for monetary formatting
 */
const DEFAULT_CURRENCY = "USD";

/**
 * Supported display currencies for the currency selector (STACK-50)
 * @constant {Array<{code: string, name: string}>}
 */
const SUPPORTED_CURRENCIES = [
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "CNY", name: "Chinese Yuan" },
  { code: "INR", name: "Indian Rupee" },
  { code: "MXN", name: "Mexican Peso" },
  { code: "SEK", name: "Swedish Krona" },
  { code: "NOK", name: "Norwegian Krone" },
  { code: "NZD", name: "New Zealand Dollar" },
  { code: "SGD", name: "Singapore Dollar" },
  { code: "HKD", name: "Hong Kong Dollar" },
  { code: "ZAR", name: "South African Rand" },
  { code: "RUB", name: "Russian Ruble" },
];

/** @constant {string} DISPLAY_CURRENCY_KEY - LocalStorage key for display currency preference (STACK-50) */
const DISPLAY_CURRENCY_KEY = "displayCurrency"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} EXCHANGE_RATES_KEY - LocalStorage key for cached exchange rates (STACK-50) */
const EXCHANGE_RATES_KEY = "exchangeRates"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} EXCHANGE_RATE_API_URL - Free exchange rate API (no key required) */
const EXCHANGE_RATE_API_URL = "https://open.er-api.com/v6/latest/USD";

/**
 * Fallback exchange rates (USD-based) for offline/file:// use (STACK-50)
 * Updated Feb 2026. Used only when API fetch fails and no cached rates exist.
 * @constant {Object<string, number>}
 */
const FALLBACK_EXCHANGE_RATES = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.36,
  AUD: 1.53,
  CHF: 0.89,
  JPY: 149.5,
  CNY: 7.24,
  INR: 83.1,
  MXN: 17.15,
  SEK: 10.42,
  NOK: 10.55,
  NZD: 1.64,
  SGD: 1.34,
  HKD: 7.82,
  ZAR: 18.65,
  RUB: 92.5,
};

/**
 * Returns formatted version string
 *
 * @param {string} [prefix="v"] - Prefix to add before version
 * @returns {string} Formatted version string (e.g., "v3.03.07b")
 */
const getVersionString = (prefix = "v") => `${prefix}${APP_VERSION}`;

/**
 * Template replacement functions for documentation
 * Used by build process to replace {{TEMPLATE}} variables
 */
const getTemplateVariables = () => ({
  VERSION: APP_VERSION,
  VERSION_WITH_V: `v${APP_VERSION}`,
  VERSION_TITLE: `StakTrakr v${APP_VERSION}`,
  VERSION_BRANCH: APP_VERSION.split(".").slice(0, 2).join(".") + ".x",
  BRANDING_NAME: BRANDING_TITLE,
});

/**
 * Replaces template variables in text
 * @param {string} text - Text containing {{VARIABLE}} placeholders
 * @returns {string} Text with variables replaced
 */
const replaceTemplateVariables = (text) => {
  const variables = getTemplateVariables();
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] || match;
  });
};

/**
 * Inserts formatted version string into a target element
 *
 * @param {string} elementId - ID of the element to update
 * @param {string} [prefix="v"] - Prefix to add before version
 */
const injectVersionString = (elementId, prefix = "v") => {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = getVersionString(prefix);
  }
};

/** @constant {string} BRANDING_TITLE - Optional custom application title */
const BRANDING_TITLE = "StakTrakr";

/**
 * Domain-based branding configuration
 *
 * @property {Object.<string,string>} domainMap - Map of domain keywords to
 * custom display names. Keys are compared in lowercase and may omit the
 * domain extension when `removeExtension` is true.
 * @property {boolean} removeExtension - When true, strips the domain
 * extension (e.g. ".com") before lookup
 * @property {boolean} alwaysOverride - When true, domain mapping overrides
 * `BRANDING_TITLE` across the entire application
 */
const BRANDING_DOMAIN_OPTIONS = {
  domainMap: {
    staktrakr: "StakTrakr",
    stackrtrackr: "StackrTrackr",
    stackertrackr: "Stacker Tracker",
  },
  /** Logo split: [silverPart, goldPart, viewBoxWidth] for the inline SVG tspan elements */
  logoSplit: {
    StakTrakr: ["Stak", "Trakr", 480],
    StackrTrackr: ["Stackr", "Trackr", 560],
    "Stacker Tracker": ["Stacker ", "Tracker", 680],
  },
  removeExtension: true,
  alwaysOverride: false,
};

/**
 * Title detected from the current domain or null if no mapping found
 *
 * Falls back to `BRANDING_TITLE` when running under file:// or no domain is
 * detected.
 * @constant {string|null}
 */
const BRANDING_DOMAIN_OVERRIDE =
  typeof window !== "undefined" && window.location && window.location.hostname
    ? (() => {
        const host = window.location.hostname.toLowerCase();
        const { domainMap, removeExtension } = BRANDING_DOMAIN_OPTIONS;
        if (removeExtension) {
          // Scan hostname parts for the first branded label. Handles plain
          // domains ("stackrtrackr.com"), www ("www.stackrtrackr.com"),
          // subdomains ("beta.staktrakr.com", "dev.staktrakr.com"), and
          // multi-level hosts ("staktrakr.pages.dev") uniformly.
          // typeof guard prevents inherited Object.prototype keys
          // (constructor, toString, etc.) from returning a function.
          for (const part of host.split(".")) {
            if (part && part !== "www" && typeof domainMap[part] === "string") {
              return domainMap[part];
            }
          }
          return null;
        }
        return typeof domainMap[host] === "string" ? domainMap[host] : null;
      })()
    : null;

/** @constant {Object} ENV_LABELS - Environment badge configuration for non-production domains (STAK-376) */
const ENV_LABELS = {
  beta: { label: "BETA", className: "env-badge--beta" },
  preview: { label: "PREVIEW", className: "env-badge--preview" },
  local: { label: "LOCAL", className: "env-badge--local" },
};

/** Detect non-production environment from hostname/protocol (STAK-376) */
function getEnvironmentLabel() {
  if (typeof window === "undefined" || !window.location) return null;
  const host = window.location.hostname.toLowerCase();
  const proto = window.location.protocol;
  if (host === "beta.staktrakr.com") return ENV_LABELS.beta;
  if (host.endsWith(".pages.dev")) return ENV_LABELS.preview;
  if (host === "localhost" || host === "127.0.0.1") return ENV_LABELS.local;
  if (proto === "file:") return ENV_LABELS.local;
  return null;
}

/** @constant {Object} DISPOSITION_TYPES - Disposition types for realized gains tracking (STAK-72) */
const DISPOSITION_TYPES = Object.freeze({
  sold: { label: "Sold", requiresAmount: true },
  traded: { label: "Traded", requiresAmount: true },
  lost: { label: "Lost", requiresAmount: false },
  gifted: { label: "Gifted", requiresAmount: false },
  returned: { label: "Returned", requiresAmount: true },
});

/**
 * Check whether an inventory item has been disposed.
 *
 * Single source of truth for disposition validity (STRK-83): an item is disposed
 * only when item.disposition is a non-null, non-array object with at least one own
 * key. An empty object {}, null, undefined, an array, or a non-object is NOT disposed
 * — a Disposition records realized value and date, so an empty shell is not one.
 * @param {Object} item - Inventory item object
 * @returns {boolean} True if the item has a valid disposition record
 */
function isDisposed(item) {
  const d = item?.disposition;
  return d != null && typeof d === "object" && !Array.isArray(d) && Object.keys(d).length > 0;
}

/** @constant {string} LS_KEY - LocalStorage key for inventory data */
const LS_KEY = "metalInventory"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} SERIAL_KEY - LocalStorage key for inventory serial counter */
const SERIAL_KEY = "inventorySerial"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} CATALOG_MAP_KEY - LocalStorage key for S#/N# associations */
const CATALOG_MAP_KEY = "catalogMap"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} SPOT_HISTORY_KEY - LocalStorage key for spot price history */
const SPOT_HISTORY_KEY = "metalSpotHistory"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} ITEM_PRICE_HISTORY_KEY - LocalStorage key for per-item price history (STACK-43) */
const ITEM_PRICE_HISTORY_KEY = "item-price-history"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} ITEM_PRICE_HISTORY_CLEARED_AT_KEY - Synced watermark: ms timestamp of the last intentional "clear all" of item price history (STRK-223). Absent ⇒ 0 ⇒ never cleared. Entries with `ts <= clearedAt` are dropped on merge/retention. */
const ITEM_PRICE_HISTORY_CLEARED_AT_KEY = "itemPriceHistoryClearedAt"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} GOLDBACK_PRICES_KEY - LocalStorage key for Goldback denomination prices (STACK-45) */
const GOLDBACK_PRICES_KEY = "goldback-prices"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} GOLDBACK_PRICE_HISTORY_KEY - LocalStorage key for Goldback price history (STACK-45) */
const GOLDBACK_PRICE_HISTORY_KEY = "goldback-price-history"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} RETAIL_PRICES_KEY - LocalStorage key for current retail price snapshot */
const RETAIL_PRICES_KEY = "retailPrices"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} RETAIL_PRICE_HISTORY_KEY - LocalStorage key for retail price history */
const RETAIL_PRICE_HISTORY_KEY = "retailPriceHistory"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} RETAIL_PROVIDERS_KEY - LocalStorage key for cached providers.json lookup map */
const RETAIL_PROVIDERS_KEY = "retailProviders"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string[]} V2_API_ENDPOINTS - Ordered list of v2 API endpoints (primary first) */
const V2_API_ENDPOINTS = [
  "https://api.staktrakr.com/data/v2",
  "https://api2.staktrakr.com/data/v2",
];

/** @constant {string} V2_API_BASE_URL - Primary v2 endpoint (backward compat) */
const V2_API_BASE_URL = V2_API_ENDPOINTS[0];

/**
 * @constant {number} SPOT_MAX_PAYLOAD_AGE_MS - Floor for rejecting stale /spot/latest.json
 * payloads (STRK-189). Effective threshold = max(envelope stale_after * 6, this floor).
 */
const SPOT_MAX_PAYLOAD_AGE_MS = 2 * 60 * 60 * 1000;

/** @constant {string} RETAIL_INTRADAY_KEY - LocalStorage key for 15-min intraday window data */
const RETAIL_INTRADAY_KEY = "retailIntradayData"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} RETAIL_SYNC_LOG_KEY - LocalStorage key for retail background sync event log */
const RETAIL_SYNC_LOG_KEY = "retailSyncLog"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** Retail price availability data (out-of-stock detection) */
const RETAIL_AVAILABILITY_KEY = "retailAvailability"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {number} RETAIL_ANOMALY_THRESHOLD - Max fractional deviation from window median before a vendor price is flagged anomalous (cross-vendor pass) */
const RETAIL_ANOMALY_THRESHOLD = 0.4;

/** @constant {number} RETAIL_SPIKE_NEIGHBOR_TOLERANCE - Max fractional deviation between before/after prices to consider them a stable neighborhood (temporal pass) */
const RETAIL_SPIKE_NEIGHBOR_TOLERANCE = 0.05;

/** @constant {string} GOLDBACK_ENABLED_KEY - LocalStorage key for Goldback pricing toggle (STACK-45) */
const GOLDBACK_ENABLED_KEY = "goldback-enabled"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} GOLDBACK_ESTIMATE_ENABLED_KEY - LocalStorage key for Goldback estimation toggle (STACK-52) */
const GOLDBACK_ESTIMATE_ENABLED_KEY = "goldback-estimate-enabled"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {number} GB_ESTIMATE_PREMIUM - Default estimation premium multiplier (1.0 = no premium, pure 2x spot) */
const GB_ESTIMATE_PREMIUM = 1.0;

/** @constant {string} GB_ESTIMATE_MODIFIER_KEY - LocalStorage key for user-configurable premium modifier */
const GB_ESTIMATE_MODIFIER_KEY = "goldback-estimate-modifier"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} GOLDBACK_PRICING_SOURCE_KEY - LocalStorage key for the active Goldback pricing source */
const GOLDBACK_PRICING_SOURCE_KEY = "goldback-pricing-source"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} SPOT_RATIOS_KEY - LocalStorage key for the spot-card ratio chips toggle */
const SPOT_RATIOS_KEY = "show-spot-ratios"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {number} GB_TO_OZT - Conversion factor: 1 Goldback = 0.001 troy oz 24K gold */
const GB_TO_OZT = 0.001;

/** @constant {number} SB_TO_OZT - Conversion factor: 1 Silverback = 0.001 troy oz silver */
const SB_TO_OZT = 0.001;

/** @constant {number} KG_TO_OZT - Conversion factor: 1 kilogram = 32.15075 troy ounces */
const KG_TO_OZT = 32.15075;

/** @constant {number} LB_TO_OZT - Conversion factor: 1 avoirdupois pound = 14.58333 troy ounces */
const LB_TO_OZT = 14.58333;

/**
 * Standard Goldback denominations with gold content.
 * weight = denomination value (used as item.weight when weightUnit='gb')
 * goldOz = troy oz of 24K gold per note
 * @constant {Array<{weight: number, label: string, goldOz: number}>}
 */
const GOLDBACK_DENOMINATIONS = [
  { weight: 0.25, label: "¼ Goldback", goldOz: 0.00025 },
  { weight: 0.5, label: "½ Goldback", goldOz: 0.0005 },
  { weight: 1, label: "1 Goldback", goldOz: 0.001 },
  { weight: 2, label: "2 Goldback", goldOz: 0.002 },
  { weight: 5, label: "5 Goldback", goldOz: 0.005 },
  { weight: 10, label: "10 Goldback", goldOz: 0.01 },
  { weight: 25, label: "25 Goldback", goldOz: 0.025 },
  { weight: 50, label: "50 Goldback", goldOz: 0.05 },
  { weight: 100, label: "100 Goldback", goldOz: 0.1 },
];

const SILVERBACK_DENOMINATIONS = [{ weight: 1, label: "1 Silverback", silverOz: 0.001 }];

/**
 * @constant {Array<{id:string,label:string,facePerCoin:number,silverOzFresh:number}>} CONSTITUTIONAL_VARIANTS
 * U.S. constitutional / "junk" silver variants (STRK-235). `silverOzFresh` is the pure-silver
 * troy oz per coin at mint spec (fresh ASW). Silver dollars were struck at the old 412.5-grain
 * standard → 0.77344 oz each, ~7% more silver per face-dollar than subsidiary 90% coinage, so
 * they carry their own row (a generic 0.7234/$ branch would undervalue every silver dollar).
 * The face-value entry path uses the "con-90-subsidiary" sentinel (NOT listed here) and derives
 * silver from CONSTITUTIONAL_SUBSIDIARY_OZT_PER_DOLLAR × face value.
 */
const CONSTITUTIONAL_VARIANTS = [
  { id: "con-90-dime", label: "90% Dime", facePerCoin: 0.1, silverOzFresh: 0.07234 },
  { id: "con-90-quarter", label: "90% Quarter", facePerCoin: 0.25, silverOzFresh: 0.18084 },
  { id: "con-90-half", label: "90% Half Dollar", facePerCoin: 0.5, silverOzFresh: 0.36169 },
  {
    id: "con-90-dollar",
    label: "90% Dollar (Morgan/Peace)",
    facePerCoin: 1,
    silverOzFresh: 0.77344,
  },
  { id: "con-40-half", label: "40% Half (1965–70)", facePerCoin: 0.5, silverOzFresh: 0.1479 },
  { id: "con-40-ike", label: "40% Eisenhower Dollar", facePerCoin: 1, silverOzFresh: 0.31625 },
  {
    id: "con-35-nickel",
    label: "35% War Nickel (1942–45)",
    facePerCoin: 0.05,
    silverOzFresh: 0.05626,
  },
];

/** @constant {number} CONSTITUTIONAL_SUBSIDIARY_OZT_PER_DOLLAR - Fresh ASW silver troy oz per $1 face for 90% subsidiary coinage (dimes/quarters/halves); used by the face-value entry path (STRK-235). */
const CONSTITUTIONAL_SUBSIDIARY_OZT_PER_DOLLAR = 0.7234;

/** @constant {number} CONSTITUTIONAL_WORN_SCALAR - Worn/fresh multiplier (0.715 ÷ 0.7234) applied uniformly to every variant's fresh ASW; fresh basis = 1.0 (STRK-235). */
const CONSTITUTIONAL_WORN_SCALAR = 0.98839;

/** @constant {string} CONSTITUTIONAL_BASIS_KEY - LocalStorage key for the global worn/fresh valuation basis; values "worn" (default) | "fresh" (STRK-235). */
const CONSTITUTIONAL_BASIS_KEY = "constitutionalValuationBasis";

/** @constant {Object<string, string[]>} TYPE_METAL_FILTER - Type visibility constraints by selected metal */
const TYPE_METAL_FILTER = {
  Goldback: ["Gold"],
  Silverback: ["Silver"],
  Constitutional: ["Silver"],
};

/** @constant {string} ITEM_TAGS_KEY - LocalStorage key for item tags mapping (STAK-126) */
const ITEM_TAGS_KEY = "itemTags"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} ITEM_REMOVED_TAGS_KEY - LocalStorage key for removed per-item tags (STAK-556) */
const ITEM_REMOVED_TAGS_KEY = "itemRemovedTags"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} ITEM_TAGS_LAST_MODIFIED_KEY - LocalStorage key for per-item tag timestamps (STRK-108) */
const ITEM_TAGS_LAST_MODIFIED_KEY = "itemTagsLastModified"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {number} MAX_TAGS_PER_ITEM - Maximum number of tags allowed per item (STAK-126) */
const MAX_TAGS_PER_ITEM = 20;

/** @constant {number} MAX_TAG_LENGTH - Maximum characters per tag name (STAK-126) */
const MAX_TAG_LENGTH = 50;

/** @constant {string} CATALOG_HISTORY_KEY - LocalStorage key for catalog API call history */
const CATALOG_HISTORY_KEY = "staktrakr.catalog.history"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} THEME_KEY - LocalStorage key for theme preference */
const THEME_KEY = "appTheme"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} STORAGE_PERSIST_GRANTED_KEY - LocalStorage key for storage persistence permission grant */
const STORAGE_PERSIST_GRANTED_KEY = "storagePersistGranted"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} IMAGE_ZIP_MANIFEST_VERSION - Version string for the image ZIP export manifest format */
const IMAGE_ZIP_MANIFEST_VERSION = "1.0";

/** @constant {string} CLOUD_VAULT_IDLE_TIMEOUT_KEY - LocalStorage key for vault password idle lock timeout in minutes (15|30|60|120|0=never) */
const CLOUD_VAULT_IDLE_TIMEOUT_KEY = "cloud_vault_idle_timeout"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** App-namespace salt for Simple mode key derivation. Never change — changing invalidates all Simple-mode syncs. */
const STAKTRAKR_SIMPLE_SALT = "53544b52:53494d504c45:76310000";

/** @constant {string} API_KEY_STORAGE_KEY - LocalStorage key for API provider information */
const API_KEY_STORAGE_KEY = "metalApiConfig"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} API_CACHE_KEY - LocalStorage key for cached API data */
const API_CACHE_KEY = "metalApiCache"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} NUMISTA_RESPONSE_CACHE_KEY - 30-day per-type-ID Numista response cache */
const NUMISTA_RESPONSE_CACHE_KEY = "numista_response_cache"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} PCGS_RESPONSE_CACHE_KEY - 30-day per-cert/pcgs-number PCGS response cache */
const PCGS_RESPONSE_CACHE_KEY = "pcgs_response_cache"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} LAST_CACHE_REFRESH_KEY - LocalStorage key for last cache refresh timestamp */
const LAST_CACHE_REFRESH_KEY = "lastCacheRefresh"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} LAST_API_SYNC_KEY - LocalStorage key for last API sync timestamp */
const LAST_API_SYNC_KEY = "lastApiSync"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} SPOT_PRICING_SOURCE_KEY - LocalStorage key for active spot price source (STAK-443) */
const SPOT_PRICING_SOURCE_KEY = "spotPricingSource"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} APP_VERSION_KEY - LocalStorage key for current app version */
const APP_VERSION_KEY = "currentAppVersion"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} VERSION_ACK_KEY - LocalStorage key for acknowledged app version */
const VERSION_ACK_KEY = "ackVersion"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} LAST_VERSION_CHECK_KEY - LocalStorage key for last remote version check timestamp (STACK-67) */
const LAST_VERSION_CHECK_KEY = "lastVersionCheck"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} LATEST_REMOTE_VERSION_KEY - LocalStorage key for cached latest remote version (STACK-67) */
const LATEST_REMOTE_VERSION_KEY = "latestRemoteVersion"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} LATEST_REMOTE_URL_KEY - LocalStorage key for cached latest remote release URL (STACK-67) */
const LATEST_REMOTE_URL_KEY = "latestRemoteUrl"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} VERSION_CHECK_URL - Remote endpoint for latest version info (STACK-67) */
const VERSION_CHECK_URL = "https://www.staktrakr.com/version.json";

/** @constant {number} VERSION_CHECK_TTL - Cache TTL for remote version check in ms (24 hours) */
const VERSION_CHECK_TTL = 24 * 60 * 60 * 1000;

/** @constant {string} FEATURE_FLAGS_KEY - LocalStorage key for feature flags */
const FEATURE_FLAGS_KEY = "featureFlags"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} SPOT_TREND_RANGE_KEY - LocalStorage key for sparkline trend range preferences */
const SPOT_TREND_RANGE_KEY = "spotTrendRange"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} SPOT_COMPARE_MODE_KEY - LocalStorage key for 24h % comparison mode (STACK-92) */
const SPOT_COMPARE_MODE_KEY = "spotCompareMode"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} TIMEZONE_KEY - LocalStorage key for display timezone preference (STACK-63) */
const TIMEZONE_KEY = "appTimeZone"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} ITEMS_PER_PAGE_KEY - LocalStorage key for items per page setting */
const ITEMS_PER_PAGE_KEY = "settingsItemsPerPage"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} CARD_STYLE_KEY - LocalStorage key for card view style (A/B/C/D) (STAK-118) */
const CARD_STYLE_KEY = "cardViewStyle"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} DESKTOP_CARD_VIEW_KEY - LocalStorage key for desktop card view toggle (STAK-118) */
const DESKTOP_CARD_VIEW_KEY = "desktopCardView"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} DEFAULT_SORT_COL_KEY - LocalStorage key for default inventory sort column */
const DEFAULT_SORT_COL_KEY = "defaultSortColumn"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} DEFAULT_SORT_DIR_KEY - LocalStorage key for default inventory sort direction */
const DEFAULT_SORT_DIR_KEY = "defaultSortDir"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} SHOW_REALIZED_KEY - LocalStorage key for showing realized G/L in summary cards (STAK-72) */
const SHOW_REALIZED_KEY = "showRealizedGainLoss"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} METAL_ORDER_KEY - LocalStorage key for metal order/visibility config */
const METAL_ORDER_KEY = "metalOrderConfig"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} SPOT_TREND_KEY - LocalStorage key for persisted spot trend period */
const SPOT_TREND_KEY = "spotTrendPeriod"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} HEADER_TREND_BTN_KEY - LocalStorage key for header trend button visibility */
const HEADER_TREND_BTN_KEY = "headerTrendBtnVisible"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} HEADER_SYNC_BTN_KEY - LocalStorage key for header sync button visibility */
const HEADER_SYNC_BTN_KEY = "headerSyncBtnVisible"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} HEADER_MARKET_BTN_KEY - LocalStorage key for header market button visibility */
const HEADER_MARKET_BTN_KEY = "headerMarketBtnVisible"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} HEADER_VAULT_BTN_KEY - LocalStorage key for header vault button visibility */
const HEADER_VAULT_BTN_KEY = "headerVaultBtnVisible"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} HEADER_RESTORE_BTN_KEY - LocalStorage key for header restore button visibility */
const HEADER_RESTORE_BTN_KEY = "headerRestoreBtnVisible"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} HEADER_CLOUD_SYNC_BTN_KEY - LocalStorage key for header cloud sync button visibility */
const HEADER_CLOUD_SYNC_BTN_KEY = "headerCloudSyncBtnVisible"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} HEADER_BTN_SHOW_TEXT_KEY - LocalStorage key for show-text-under-icons toggle */
const HEADER_BTN_SHOW_TEXT_KEY = "headerBtnShowText"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} RETAIL_MANIFEST_TS_KEY - LocalStorage key for market manifest generated_at timestamp */
const RETAIL_MANIFEST_TS_KEY = "retailManifestGeneratedAt"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} RETAIL_MANIFEST_SLUGS_KEY - LocalStorage key for cached manifest coin slug list */
const RETAIL_MANIFEST_SLUGS_KEY = "retailManifestSlugs"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} RETAIL_MANIFEST_COIN_META_KEY - LocalStorage key for cached manifest coin metadata (canonical names, weights, metals) */
const RETAIL_MANIFEST_COIN_META_KEY = "retailManifestCoinMeta"; // nosemgrep: codacy.javascript.security.hard-coded-password

/** @constant {string} RETAIL_MANIFEST_VENDOR_META_KEY - LocalStorage key for cached manifest vendor display metadata */
const RETAIL_MANIFEST_VENDOR_META_KEY = "retailManifestVendorMeta"; // nosemgrep: codacy.javascript.security.hard-coded-password

const MARKET_FILTER_KEY = "staktrakr.market_filter"; // nosemgrep: codacy.javascript.security.hard-coded-password

// =============================================================================
// IMAGE PROCESSOR DEFAULTS (STACK-95)
// =============================================================================

/** @constant {number} IMAGE_MAX_DIM - Max image dimension in px for resize */
const IMAGE_MAX_DIM = 500;

/** @constant {number} IMAGE_QUALITY - Default compression quality (0-1) */
const IMAGE_QUALITY = 0.75;

/** @constant {number} IMAGE_MAX_BYTES - Max output size per image side in bytes (500 KB) */
const IMAGE_MAX_BYTES = 512000;

/**
 * List of recognized localStorage keys for cleanup validation
 * @constant {string[]}
 */
const VAULT_FILE_EXTENSION = ".stvault";

/** Filename suffix for the companion image vault file exported alongside a backup */
const VAULT_IMAGE_FILE_SUFFIX = "-images";

/** Filename suffix for the companion attachment vault file exported alongside a backup */
const VAULT_ATTACHMENT_FILE_SUFFIX = "-attachments";

// =============================================================================
// CLOUD AUTO-SYNC CONSTANTS (STAK-149)
// =============================================================================

/** Poll interval for remote change detection (10 minutes in ms) */
const SYNC_POLL_INTERVAL = 600000;

/** Debounce delay before pushing after a saveInventory() call (2 seconds) */
const SYNC_PUSH_DEBOUNCE = 2000;

/** Legacy Dropbox paths (pre-v2 flat layout — used for migration detection only) */
const SYNC_FILE_PATH_LEGACY = "/StakTrakr/staktrakr-sync.stvault";
const SYNC_META_PATH_LEGACY = "/StakTrakr/staktrakr-sync.json";
const SYNC_IMAGES_PATH_LEGACY = "/StakTrakr/staktrakr-images.stvault";

/** Dropbox path for the rolling sync vault file (v2 — /sync/ subfolder) */
const SYNC_FILE_PATH = "/StakTrakr/sync/staktrakr-sync.stvault";

/** Dropbox path for the lightweight sync metadata pointer (v2 — /sync/ subfolder) */
const SYNC_META_PATH = "/StakTrakr/sync/staktrakr-sync.json";

/** Dropbox path for the encrypted user-image vault (v2 — /sync/ subfolder) */
const SYNC_IMAGES_PATH = "/StakTrakr/sync/staktrakr-images.stvault";

/** Dropbox path for the encrypted attachment vault (v2 — /sync/ subfolder) */
const SYNC_ATTACHMENTS_PATH = "/StakTrakr/sync/staktrakr-attachments.stvault";

/** Dropbox path for the encrypted item-price-history companion vault (v2 — /sync/ subfolder) */
const SYNC_ITEM_PRICE_HISTORY_PATH = "/StakTrakr/sync/staktrakr-item-price-history.stvault";

/** Attachment total-size threshold in bytes above which the user sees a one-time sync warning */
const SYNC_ATTACHMENT_SIZE_WARN_BYTES = 100 * 1024 * 1024; // 100 MB

/** Dropbox path for the encrypted change manifest (v2 — /sync/ subfolder) */
const SYNC_MANIFEST_PATH = "/StakTrakr/sync/staktrakr-sync.stmanifest";

/** Legacy Dropbox path for the encrypted change manifest (flat root) */
const SYNC_MANIFEST_PATH_LEGACY = "/StakTrakr/staktrakr-sync.stmanifest";

/** Dropbox folder for cloud-side backups */
const SYNC_BACKUP_FOLDER = "/StakTrakr/backups";

/** Filename used for the "latest" cloud backup snapshot */
const CLOUD_LATEST_FILENAME = "staktrakr-latest.json";

/** Cloud backup history depth — how many backups to retain */
const CLOUD_BACKUP_HISTORY_KEY = "cloud_backup_history_depth"; // nosemgrep: codacy.javascript.security.hard-coded-password
const CLOUD_BACKUP_HISTORY_DEFAULT = 5;
const CLOUD_BACKUP_HISTORY_OPTIONS = [3, 5, 10, 20];

/** Filename prefix for user-initiated manual backups */
const MANUAL_BACKUP_PREFIX = "staktrakr-backup-";

/** Filename prefix for auto-sync pre-push snapshot backups */
const SYNC_BACKUP_PREFIX = "pre-sync-";

/**
 * Keys included in a sync vault — inventory data + all user preferences that are
 * meaningful across devices. Expanded in STAK-426 from 8 → ~36 keys.
 * Excludes: OAuth tokens, transient caches, server-sourced data, device-local state.
 */
const SYNC_SCOPE_KEYS = [
  // ── Core data ──
  "metalInventory", // LS_KEY — inventory items
  "itemTags", // ITEM_TAGS_KEY — per-item tags
  "itemRemovedTags", // ITEM_REMOVED_TAGS_KEY — removed per-item tags
  "itemTagsLastModified", // ITEM_TAGS_LAST_MODIFIED_KEY — per-item tag timestamps
  "itemPriceHistoryClearedAt", // ITEM_PRICE_HISTORY_CLEARED_AT_KEY — synced clear-all watermark (STRK-223)

  // ── Display preferences ──
  "displayCurrency", // DISPLAY_CURRENCY_KEY — active display currency
  "constitutionalValuationBasis", // CONSTITUTIONAL_BASIS_KEY — global worn/fresh junk-silver basis (STRK-235)
  "appTheme", // THEME_KEY — light/dark/sepia/system theme
  "cardViewStyle", // CARD_STYLE_KEY
  "desktopCardView", // DESKTOP_CARD_VIEW_KEY
  "defaultSortColumn", // DEFAULT_SORT_COL_KEY
  "defaultSortDir", // DEFAULT_SORT_DIR_KEY
  "showRealizedGainLoss", // SHOW_REALIZED_KEY
  "metalOrderConfig", // METAL_ORDER_KEY
  "settingsItemsPerPage", // ITEMS_PER_PAGE_KEY
  "appTimeZone", // TIMEZONE_KEY

  // ── Chip & filter config ──
  "inlineChipConfig", // inline chip config (grade, year, etc.)
  "filterChipCategoryConfig", // filter chip category config
  "viewModalSectionConfig", // view modal section visibility
  "chipMinCount", // minimum count for filter chips
  "chipMaxCount", // maximum count for filter chips
  "chipCustomGroups", // custom chip groupings
  "chipBlacklist", // hidden chips
  "chipSortOrder", // chip sort preference

  // ── Layout & table ──
  "layoutSectionConfig", // section layout config
  "tableImagesEnabled", // show images in table
  "tableImageSides", // which image sides to show

  // ── Tag config ──
  "tagBlacklist", // hidden tags

  // ── Header button preferences ──
  "headerThemeBtnVisible", // theme toggle button
  "headerCurrencyBtnVisible", // currency toggle button
  "headerTrendBtnVisible", // HEADER_TREND_BTN_KEY
  "headerSyncBtnVisible", // HEADER_SYNC_BTN_KEY
  "headerMarketBtnVisible", // HEADER_MARKET_BTN_KEY
  "headerVaultBtnVisible", // HEADER_VAULT_BTN_KEY
  "headerRestoreBtnVisible", // HEADER_RESTORE_BTN_KEY
  "headerCloudSyncBtnVisible", // HEADER_CLOUD_SYNC_BTN_KEY
  "headerBtnShowText", // HEADER_BTN_SHOW_TEXT_KEY
  "headerBtnOrder", // button ordering
  "headerAboutBtnVisible", // about button

  // ── Feature toggles ──
  "goldback-pricing-source", // GOLDBACK_PRICING_SOURCE_KEY
  "goldback-estimate-modifier", // GB_ESTIMATE_MODIFIER_KEY
  "show-spot-ratios", // SPOT_RATIOS_KEY

  // ── Numista config ──
  "numista_tags_auto", // auto-tag on Numista lookup
  "numistaLookupRules", // lookup rule config
  "numistaViewFields", // view modal field config

  // ── Seed & provider config ──
  "apiProviderOrder", // spot provider order
  "providerPriority", // provider priority config
  "spotPricingSource", // STAK-443: single-select spot source (STAKTRAKR|METALS_DEV|METALS_API|METAL_PRICE_API|GOLD_API|CUSTOM|MANUAL)
  "metalSpotPrices", // STAK-443: manual-mode spot prices {gold, silver, platinum, palladium}

  // ── API credentials ──
  "metalApiConfig", // API_KEY_STORAGE_KEY — spot provider keys (MetalPriceAPI, Metals-API, Custom)
  "catalog_api_config", // Numista API key, PCGS bearer token (CatalogConfig)

  // ── Attachment sync ──
  "syncAttachments", // boolean: include attachment binaries in cloud sync (default true when missing)
];

const SPOT_HISTORY_RUNTIME_WINDOW_DAYS = 180;

const ALLOWED_STORAGE_KEYS = [
  LS_KEY,
  SERIAL_KEY,
  CATALOG_MAP_KEY,
  SPOT_HISTORY_KEY,
  ITEM_PRICE_HISTORY_KEY,
  ITEM_PRICE_HISTORY_CLEARED_AT_KEY,
  THEME_KEY,
  API_KEY_STORAGE_KEY,
  API_CACHE_KEY,
  LAST_CACHE_REFRESH_KEY,
  LAST_API_SYNC_KEY,
  APP_VERSION_KEY,
  VERSION_ACK_KEY,
  FEATURE_FLAGS_KEY,
  CONSTITUTIONAL_BASIS_KEY, // STRK-235 — global worn/fresh junk-silver valuation basis
  "spotSilver",
  "spotGold",
  "spotPlatinum",
  "spotPalladium",
  "chipMinCount",
  "chipMaxCount",
  "changeLog",
  "autocomplete_lookup_cache",
  "autocomplete_cache_timestamp",
  "staktrakr.debug",
  "stackrtrackr.debug",
  "catalog_api_config",
  "staktrakr.catalog.cache",
  "staktrakr.catalog.settings",
  CATALOG_HISTORY_KEY,
  SPOT_TREND_RANGE_KEY,
  SPOT_COMPARE_MODE_KEY,
  ITEMS_PER_PAGE_KEY,
  "chipCustomGroups",
  "chipBlacklist",
  "inlineChipConfig",
  "apiProviderOrder",
  "providerPriority",
  "spotPricingSource", // STAK-443: single-select spot source replacing fallback chain
  "metalSpotPrices", // STAK-443: unified manual-mode spot prices {gold, silver, platinum, palladium}
  "filterChipCategoryConfig",
  "chipSortOrder",
  "disposedFilterMode", // string: "hide"|"show"|"only" — disposed items filter preference (STAK-388)
  GOLDBACK_PRICES_KEY,
  GOLDBACK_PRICE_HISTORY_KEY,
  RETAIL_PRICES_KEY,
  RETAIL_PRICE_HISTORY_KEY,
  RETAIL_PROVIDERS_KEY,
  RETAIL_INTRADAY_KEY,
  RETAIL_SYNC_LOG_KEY,
  RETAIL_AVAILABILITY_KEY,
  NUMISTA_RESPONSE_CACHE_KEY,
  PCGS_RESPONSE_CACHE_KEY,
  GOLDBACK_ENABLED_KEY,
  GOLDBACK_ESTIMATE_ENABLED_KEY,
  GB_ESTIMATE_MODIFIER_KEY,
  GOLDBACK_PRICING_SOURCE_KEY,
  SPOT_RATIOS_KEY, // STRK-161: persist "Show spot ratios" toggle past cleanupStorage
  DISPLAY_CURRENCY_KEY,
  EXCHANGE_RATES_KEY,
  "headerThemeBtnVisible", // boolean string: "true"/"false" (STACK-54)
  "headerCurrencyBtnVisible", // boolean string: "true"/"false" (STACK-54)
  SPOT_TREND_KEY, // string: trend period ("1"|"7"|"30"|"90"|"365"|"1095")
  HEADER_TREND_BTN_KEY, // boolean string: "true"/"false" — header trend button visibility
  HEADER_SYNC_BTN_KEY, // boolean string: "true"/"false" — header sync button visibility
  HEADER_MARKET_BTN_KEY, // boolean string: "true"/"false" — header market button visibility
  HEADER_VAULT_BTN_KEY, // boolean string: null=show, "false"=hide, "true"=show — vault button visibility
  HEADER_RESTORE_BTN_KEY, // boolean string: "true"/"false" — restore button visibility
  HEADER_CLOUD_SYNC_BTN_KEY, // boolean string: "true"/"false" — cloud sync button visibility
  HEADER_BTN_SHOW_TEXT_KEY, // boolean string: "true"/"false" — show text labels under header icons
  RETAIL_MANIFEST_TS_KEY, // string ISO timestamp — market manifest generated_at cache
  RETAIL_MANIFEST_SLUGS_KEY, // JSON array: cached manifest coin slug list
  RETAIL_MANIFEST_COIN_META_KEY, // JSON object: cached manifest coin metadata (canonical names)
  RETAIL_MANIFEST_VENDOR_META_KEY, // JSON object: cached manifest vendor display metadata
  MARKET_FILTER_KEY, // string: market price filter preferences (STAK-515)
  "layoutVisibility", // JSON object: { spotPrices, totals, search, table } (STACK-54) — legacy, migrated to layoutSectionConfig
  "layoutSectionConfig", // JSON array: ordered section config [{ id, label, enabled }] (STACK-54)
  LAST_VERSION_CHECK_KEY, // timestamp: last remote version check (STACK-67)
  LATEST_REMOTE_VERSION_KEY, // string: cached latest remote version (STACK-67)
  LATEST_REMOTE_URL_KEY, // string: cached latest remote release URL (STACK-67)
  "ff_migration_fuzzy_autocomplete", // one-time migration flag (v3.26.01)
  "migration_hourlySource", // one-time migration flag: re-tag StakTrakr hourly entries
  "migration_seedHistoryMerge", // one-time migration flag: skip redundant seed-history merge writes
  "migration_cmp2_compression", // one-time migration flag: re-encode CMP1/large keys to CMP2 (STRK-140)
  "migration_idb_history_v1", // one-time migration flag: market histories moved to IndexedDB (STRK-141)
  "numistaLookupRules", // custom Numista search lookup rules (JSON array)
  "numistaViewFields", // view modal Numista field visibility config (JSON object)
  TIMEZONE_KEY, // string: "auto" | "UTC" | IANA zone (STACK-63)
  "viewModalSectionConfig", // JSON array: ordered view modal section config [{ id, label, enabled }]
  "tableImagesEnabled", // boolean string: "true"/"false" — show thumbnail images in table rows
  "tableImageSides", // string: "both"|"obverse"|"reverse" — which sides to show in table (STAK-118)
  CARD_STYLE_KEY, // string: "A"|"B"|"C" — card view style (STAK-118)
  DESKTOP_CARD_VIEW_KEY, // boolean string: "true"/"false" — desktop card view (STAK-118)
  DEFAULT_SORT_COL_KEY, // number string: default sort column index
  DEFAULT_SORT_DIR_KEY, // string: "asc"|"desc" — default sort direction
  SHOW_REALIZED_KEY, // boolean string: "true"/"false" — show realized G/L in summary cards (STAK-72)
  METAL_ORDER_KEY, // JSON array: metal order/visibility config
  ITEM_TAGS_KEY, // JSON object: per-item tags keyed by UUID (STAK-126)
  ITEM_REMOVED_TAGS_KEY, // JSON object: per-item removed Numista tags keyed by UUID (STAK-556)
  ITEM_TAGS_LAST_MODIFIED_KEY, // JSON object: per-item tag timestamps keyed by UUID (STRK-108)
  "seedImagesVer", // string: current seed images version for cache invalidation
  "cloud_token_dropbox", // JSON: Dropbox OAuth token data
  "cloud_token_pcloud", // JSON: pCloud OAuth token data
  "cloud_token_box", // JSON: Box OAuth token data
  "cloud_last_backup", // JSON: { provider, timestamp } last cloud backup info
  "cloud_kraken_seen", // boolean string: easter egg flag
  "staktrakr_oauth_result", // JSON: transient OAuth callback relay (cleared after read)
  "cloud_activity_log", // JSON: cloud sync activity log entries
  // STAK-149: Auto-sync keys
  "cloud_sync_enabled", // boolean string: "true"/"false" — master auto-sync toggle
  "cloud_sync_last_push", // JSON: { syncId, timestamp, rev, itemCount } — last push from this device
  "cloud_sync_last_pull", // JSON: { syncId, timestamp, rev } — last pull on this device
  "cloud_sync_device_id", // UUID string: stable per-device identifier
  "cloud_sync_cursor", // Dropbox rev string: for efficient change detection
  "cloud_sync_override_backup", // JSON: { timestamp, itemCount, appVersion, data: {...} } — pre-pull local snapshot
  CLOUD_VAULT_IDLE_TIMEOUT_KEY, // number string: vault password idle lock timeout in minutes (15|30|60|120|0=never)
  "cloud_sync_mode", // DEPRECATED: kept for migration only — will be removed after v3.33
  "cloud_dropbox_account_id", // string: Dropbox account_id for Simple mode key derivation
  "cloud_dropbox_email", // string: Dropbox account email for multi-account UX (STAK-449)
  "cloud_dropbox_display_name", // string: Dropbox display name for multi-account UX (STAK-449)
  "cloud_vault_password", // string: user vault password stored for persistent unlock
  STORAGE_PERSIST_GRANTED_KEY, // boolean string: "true"/"false" — storage persistence grant flag
  "headerBtnOrder", // JSON array: header button card order (STAK-320)
  "headerAboutBtnVisible", // boolean string: "true"/"false" — about button visibility (STAK-320)
  "tagBlacklist", // JSON array: tags excluded from auto-tagging
  "numista_tags_auto", // boolean string: "true"/"false" — auto-tag from Numista data
  "cloud_sync_local_modified", // ISO string: timestamp of last local metalInventory save (STAK-414)
  "cloud_sync_migrated", // string: "v2" — cloud folder migration flag (flat → /sync/ + /backups/)
  "cloud_backup_history_depth", // string: "3"|"5"|"10"|"20" — max cloud backups to retain
  "manifestPruningThreshold", // number string: max sync cycles to retain in manifest before pruning older entries (STAK-184)
  // STAK-503: v2 API cache keys
  "v2RetailPrices", // JSON: v2 cached retail prices
  "v2RetailIntraday", // JSON: v2 standalone intraday data
  "v2RetailHistory", // JSON: v2 retail history cache
  "v2SpotHistory", // JSON: v2 spot price history
  "v2ManifestCache", // JSON: v2 manifest metadata cache
  // STAK-504: Market data module keys
  "vendorPricesActiveTab", // string: active metal tab in vendor prices section
  "v2SpotHistoryTs", // string: ISO timestamp of cached v2 spot history
  "inventorySeedApplied", // STRK-13: ISO timestamp string, sentinel proving seed has been applied (or migration ran)
  "staktrakr.bootDiagnostics", // STRK-13: JSON array, 10-entry ring buffer of boot classifications
  // STRK-45: per-item attachments
  "syncAttachments", // boolean string: "true"/"false" — include attachment binaries in cloud sync (default true when missing)
  "syncAttachmentsWarnSeen", // boolean string: "true"/"false" — one-time 100 MB warning has been shown
  "__sync_recovery_snapshot", // STRK-135: pre-merge tag snapshot for manual recovery after one-sided merge
];

/**
 * Keys excluded from portable full-vault exports.
 * These remain in ALLOWED_STORAGE_KEYS (so cleanupStorage doesn't delete them)
 * but are stripped from collectVaultData('full') to prevent shipping live
 * OAuth tokens, vault passwords, and device-specific sync state.
 * @constant {string[]}
 */
const VAULT_EXCLUDE_KEYS = [
  "cloud_token_dropbox",
  "cloud_token_pcloud",
  "cloud_token_box",
  "cloud_dropbox_account_id",
  "cloud_dropbox_email",
  "cloud_dropbox_display_name",
  "cloud_vault_password",
  "cloud_sync_device_id",
  "cloud_sync_cursor",
  "cloud_sync_last_push",
  "cloud_sync_last_pull",
  "cloud_sync_override_backup",
  "cloud_sync_mode",
  "cloud_sync_local_modified",
  "cloud_sync_migrated",
  "staktrakr_oauth_result",
];

/**
 * Keys whose values are volatile cache data (spot prices, API timestamps,
 * exchange rates). Excluded from vault settings-diff comparison to prevent
 * false-positive diffs when async init updates these between export and restore.
 * Still included in vault export/import — just not flagged as "changed."
 */
const VAULT_SETTINGS_DIFF_SKIP = [
  "spotGold",
  "spotSilver",
  "spotPlatinum",
  "spotPalladium",
  SPOT_HISTORY_KEY,
  ITEM_PRICE_HISTORY_KEY,
  EXCHANGE_RATES_KEY,
  LAST_CACHE_REFRESH_KEY,
  LAST_API_SYNC_KEY,
];

/**
 * Market-history localStorage keys now owned by IndexedDB (STRK-141).
 * Skipped by backup/restore so the IDB store remains the single source of
 * truth for these histories.
 * @constant {string[]}
 */
const HISTORY_IDB_KEYS = [
  SPOT_HISTORY_KEY,
  "v2RetailHistory", // nosemgrep: codacy.javascript.security.hard-coded-password
  RETAIL_PRICE_HISTORY_KEY,
];

/** @constant {number} ITEM_PRICE_HISTORY_MAX_DAYS - Retention window (days) for per-item price history (STRK-141) */
const ITEM_PRICE_HISTORY_MAX_DAYS = 365;

/** @constant {number} ITEM_PRICE_HISTORY_MAX_ENTRIES - Max retained entries for per-item price history (STRK-141) */
const ITEM_PRICE_HISTORY_MAX_ENTRIES = 1000;

// =============================================================================
// INLINE CHIP CONFIG — controls which chips appear in the Name cell and order
// =============================================================================

/**
 * Default inline chip configuration. Order determines display order.
 * @constant {Array<{id: string, label: string, enabled: boolean}>}
 */
const INLINE_CHIP_DEFAULTS = [
  { id: "grade", label: "Grade", enabled: true },
  { id: "numista", label: "Numista (N#)", enabled: true },
  { id: "pcgs", label: "PCGS #", enabled: false },
  { id: "year", label: "Year", enabled: true },
  { id: "serial", label: "Serial #", enabled: false },
  { id: "storage", label: "Storage Location", enabled: false },
  { id: "notes", label: "Notes Indicator", enabled: false },
  { id: "purity", label: "Purity", enabled: false },
  { id: "tags", label: "Tags", enabled: false },
  { id: "attachment", label: "Attachments", enabled: true },
];

/**
 * Loads the inline chip config from localStorage, merging with defaults
 * so new chip types added in future versions appear automatically.
 * @returns {Array<{id: string, label: string, enabled: boolean}>}
 */
const getInlineChipConfig = () => {
  const saved = loadDataSync("inlineChipConfig", null);
  if (saved && Array.isArray(saved)) {
    const savedMap = new Map(saved.map((c) => [c.id, c]));
    const merged = saved.filter((c) => INLINE_CHIP_DEFAULTS.some((d) => d.id === c.id));
    for (const def of INLINE_CHIP_DEFAULTS) {
      if (!savedMap.has(def.id)) {
        merged.push({ ...def });
      }
    }
    return merged;
  }
  return INLINE_CHIP_DEFAULTS.map((d) => ({ ...d }));
};

/**
 * Saves the inline chip config to localStorage.
 * @param {Array<{id: string, label: string, enabled: boolean}>} config
 */
const saveInlineChipConfig = (config) => {
  try {
    saveDataSync("inlineChipConfig", config);
    if (typeof scheduleSyncPush === "function") scheduleSyncPush();
  } catch (e) {
    console.warn("Failed to save inline chip config:", e);
  }
};

// =============================================================================
// FILTER CHIP CATEGORY CONFIG — controls which chip categories appear and order
// =============================================================================

/**
 * Default filter chip category configuration. Order determines display order.
 * @constant {Array<{id: string, label: string, enabled: boolean}>}
 */
const FILTER_CHIP_CATEGORY_DEFAULTS = [
  { id: "metal", label: "Metals", enabled: true, group: null },
  { id: "type", label: "Types", enabled: true, group: null },
  { id: "name", label: "Names", enabled: true, group: null },
  { id: "customGroup", label: "Custom Groups", enabled: true, group: null },
  { id: "dynamicName", label: "Dynamic Names", enabled: true, group: null },
  { id: "paymentMethod", label: "Payment Method", enabled: true, group: null },
  { id: "purchaseLocation", label: "Purchase Location", enabled: true, group: null },
  { id: "storageLocation", label: "Storage Location", enabled: true, group: null },
  { id: "year", label: "Years", enabled: true, group: null },
  { id: "grade", label: "Grades", enabled: true, group: null },
  { id: "numistaId", label: "Numista IDs", enabled: true, group: null },
  { id: "purity", label: "Purity", enabled: true, group: null },
  { id: "tags", label: "Tags", enabled: true, group: null },
];

/**
 * Loads the filter chip category config from localStorage, merging with defaults
 * so new categories added in future versions appear automatically.
 * @returns {Array<{id: string, label: string, enabled: boolean}>}
 */
const getFilterChipCategoryConfig = () => {
  try {
    const raw = localStorage.getItem("filterChipCategoryConfig");
    if (raw) {
      const saved = JSON.parse(raw);
      const savedMap = new Map(saved.map((c) => [c.id, c]));
      // Start with saved order, preserving user's arrangement
      const merged = saved.filter((c) => FILTER_CHIP_CATEGORY_DEFAULTS.some((d) => d.id === c.id));
      // Append any new defaults not in saved config
      for (const def of FILTER_CHIP_CATEGORY_DEFAULTS) {
        if (!savedMap.has(def.id)) {
          merged.push({ ...def });
        }
      }
      return merged;
    }
  } catch (e) {
    console.warn("Failed to load filter chip category config:", e);
  }
  return FILTER_CHIP_CATEGORY_DEFAULTS.map((d) => ({ ...d }));
};

/**
 * Saves the filter chip category config to localStorage.
 * @param {Array<{id: string, label: string, enabled: boolean}>} config
 */
const saveFilterChipCategoryConfig = (config) => {
  try {
    localStorage.setItem("filterChipCategoryConfig", JSON.stringify(config));
    if (typeof scheduleSyncPush === "function") scheduleSyncPush();
  } catch (e) {
    console.warn("Failed to save filter chip category config:", e);
  }
};

// =============================================================================
// LAYOUT SECTION CONFIG — controls visibility and order of major page sections
// =============================================================================

/**
 * Default layout section configuration. Order determines display order.
 * @constant {Array<{id: string, label: string, enabled: boolean}>}
 */
const LAYOUT_SECTION_DEFAULTS = [
  { id: "spotPrices", label: "Spot price cards", enabled: true },
  { id: "bestPriceTicker", label: "Best Price Ticker", enabled: true },
  { id: "totals", label: "Summary totals", enabled: true },
  { id: "search", label: "Search & filter bar", enabled: true },
  { id: "table", label: "Inventory table", enabled: true },
  { id: "vendorPrices", label: "Vendor Prices", enabled: true },
];

/**
 * Migrates old layoutVisibility object to new ordered array format.
 * @param {Object} obj - Old format: { spotPrices: bool, totals: bool, ... }
 * @returns {Array<{id: string, label: string, enabled: boolean}>}
 */
const migrateLayoutVisibility = (obj) => {
  const config = LAYOUT_SECTION_DEFAULTS.map((d) => ({
    ...d,
    enabled: obj[d.id] !== undefined ? !!obj[d.id] : d.enabled,
  }));
  try {
    localStorage.setItem("layoutSectionConfig", JSON.stringify(config));
    localStorage.removeItem("layoutVisibility");
  } catch (e) {
    console.warn("Failed to migrate layout visibility:", e);
  }
  return config;
};

/**
 * Generic loader for section config arrays from localStorage.
 * Merges saved user config with defaults so new sections are auto-appended.
 * @param {string} key - localStorage key
 * @param {Array<{id: string, label: string, enabled: boolean}>} defaults
 * @param {string} [legacyKey] - Optional legacy key to migrate from
 * @param {function} [migrateFn] - Migration function for legacy data
 * @returns {Array<{id: string, label: string, enabled: boolean}>}
 */
const _loadSectionConfig = (key, defaults, legacyKey, migrateFn) => {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const saved = JSON.parse(raw);
      const savedMap = new Map(saved.map((c) => [c.id, c]));
      const merged = saved.filter((c) => defaults.some((d) => d.id === c.id));
      for (const def of defaults) {
        if (!savedMap.has(def.id)) merged.push({ ...def });
      }
      return merged;
    }
    if (legacyKey && migrateFn) {
      const legacy = localStorage.getItem(legacyKey);
      if (legacy) return migrateFn(JSON.parse(legacy));
    }
  } catch (e) {
    console.warn(`Failed to load ${key}:`, e);
  }
  return defaults.map((d) => ({ ...d }));
};

/**
 * Generic saver for section config arrays to localStorage.
 * @param {string} key - localStorage key
 * @param {Array<{id: string, label: string, enabled: boolean}>} config
 */
const _saveSectionConfig = (key, config) => {
  try {
    localStorage.setItem(key, JSON.stringify(config));
  } catch (e) {
    console.warn(`Failed to save ${key}:`, e);
  }
};

/** Loads the layout section config, with migration from old layoutVisibility format. */
const getLayoutSectionConfig = () =>
  _loadSectionConfig(
    "layoutSectionConfig",
    LAYOUT_SECTION_DEFAULTS,
    "layoutVisibility",
    migrateLayoutVisibility
  );

/** Saves the layout section config to localStorage. */
const saveLayoutSectionConfig = (config) => _saveSectionConfig("layoutSectionConfig", config);

// =============================================================================
// VIEW MODAL SECTION CONFIG — controls order/visibility of view modal sections
// =============================================================================

/**
 * Default view modal section configuration. Order determines display order.
 * @constant {Array<{id: string, label: string, enabled: boolean}>}
 */
const VIEW_MODAL_SECTION_DEFAULTS = [
  { id: "images", label: "Coin images", enabled: true },
  { id: "valuation", label: "Valuation", enabled: true },
  { id: "priceHistory", label: "Price history", enabled: true },
  { id: "inventory", label: "Inventory details", enabled: true },
  { id: "grading", label: "Grading", enabled: true },
  { id: "numista", label: "Numista data", enabled: true },
  { id: "notes", label: "Notes", enabled: true },
  { id: "tags", label: "Tags", enabled: true },
  { id: "attachments", label: "Attachments", enabled: true },
  { id: "disposition", label: "Disposition", enabled: true },
];

/** Loads the view modal section config from localStorage, merged with defaults. */
const getViewModalSectionConfig = () =>
  _loadSectionConfig("viewModalSectionConfig", VIEW_MODAL_SECTION_DEFAULTS);

/** Saves the view modal section config to localStorage. */
const saveViewModalSectionConfig = (config) => {
  _saveSectionConfig("viewModalSectionConfig", config);
  if (typeof scheduleSyncPush === "function") scheduleSyncPush();
};

// =============================================================================
// NUMISTA VIEW FIELD CONFIG — controls which fields appear in view modal
// =============================================================================

/**
 * Default Numista view field visibility. All enabled by default.
 * @constant {Object<string, boolean>}
 */
const NUMISTA_VIEW_FIELD_DEFAULTS = {
  denomination: true,
  shape: true,
  diameter: true,
  length: true,
  width: true,
  thickness: true,
  orientation: true,
  composition: true,
  country: true,
  technique: true,
  references: true,
  obverse: true,
  reverse: true,
  edge: true,
  tags: true,
  commemorative: true,
  rarity: true,
  mintage: true,
  imageTooltips: true,
};

/**
 * Load Numista view field config from localStorage, merged with defaults.
 * @returns {Object<string, boolean>}
 */
const getNumistaViewFieldConfig = () => {
  try {
    const raw = localStorage.getItem("numistaViewFields");
    if (raw) {
      const saved = JSON.parse(raw);
      return { ...NUMISTA_VIEW_FIELD_DEFAULTS, ...saved };
    }
  } catch (e) {
    console.warn("Failed to load Numista view field config:", e);
  }
  return { ...NUMISTA_VIEW_FIELD_DEFAULTS };
};

/**
 * Save Numista view field config to localStorage.
 * @param {Object<string, boolean>} config
 */
const saveNumistaViewFieldConfig = (config) => {
  try {
    localStorage.setItem("numistaViewFields", JSON.stringify(config));
  } catch (e) {
    console.warn("Failed to save Numista view field config:", e);
  }
};

// Persist current application version for comparison on future loads
try {
  localStorage.setItem(APP_VERSION_KEY, APP_VERSION);
} catch (e) {
  console.warn("Unable to store app version", e);
}

/**
 * @constant {number} DEFAULT_API_CACHE_DURATION - Default cache duration in milliseconds (24 hours)
 */
const DEFAULT_API_CACHE_DURATION = 24 * 60 * 60 * 1000;

/** @constant {number} DEFAULT_API_QUOTA - Default monthly API call quota */
const DEFAULT_API_QUOTA = 100;

/** @constant {boolean} DEV_MODE - Enables verbose debug logging when true */
const DEV_MODE = false;

/**
 * Global debug flag, can be toggled via DEV_MODE or `?debug` query parameter
 * @constant {boolean}
 */
let DEBUG = DEV_MODE;

if (typeof window !== "undefined") {
  const params = new URLSearchParams(window.location.search);
  if (params.has("debug")) {
    const value = params.get("debug");
    DEBUG = value === null || value === "" || value === "1" || value === "true";
  }
}

// =============================================================================
// FEATURE FLAGS SYSTEM
// =============================================================================

/**
 * Feature flags configuration
 * Controls experimental features and gradual rollouts
 *
 * Each feature flag contains:
 * @property {boolean} enabled - Default enabled state
 * @property {boolean} urlOverride - Allow URL parameter override
 * @property {boolean} userToggle - Allow user preference toggle
 * @property {string} description - Human-readable description
 * @property {string} phase - Development phase (dev/testing/beta/stable)
 */
const FEATURE_FLAGS = {
  FUZZY_AUTOCOMPLETE: {
    enabled: true,
    urlOverride: true,
    userToggle: true,
    description: "Fuzzy search autocomplete for item names and locations",
    phase: "stable",
  },
  DEBUG_UI: {
    enabled: false,
    urlOverride: true,
    userToggle: false,
    description: "Debug UI indicators and development tools",
    phase: "dev",
  },
  GROUPED_NAME_CHIPS: {
    enabled: true,
    urlOverride: true,
    userToggle: true,
    description:
      "Group item names by base name (e.g., 'American Silver Eagle (3)' instead of separate year chips)",
    phase: "beta",
  },
  DYNAMIC_NAME_CHIPS: {
    enabled: false,
    urlOverride: true,
    userToggle: true,
    description:
      "Auto-extract text from parentheses and quotes in item names as additional filter chips",
    phase: "beta",
  },
  CHIP_QTY_BADGE: {
    enabled: true,
    urlOverride: true,
    userToggle: true,
    description: "Show item count badge on filter chips",
    phase: "stable",
  },
  COIN_IMAGES: {
    enabled: true,
    urlOverride: true,
    userToggle: true,
    description: "Coin image caching and item view modal",
    phase: "beta",
  },
  MARKET_DASHBOARD_ITEMS: {
    enabled: false,
    urlOverride: true,
    userToggle: true,
    description: "Show goldback and dashboard items in the market list",
    phase: "beta",
  },
  MARKET_AUTO_RETAIL: {
    enabled: false,
    urlOverride: true,
    userToggle: true,
    description: "Auto-update inventory retail prices from linked market data",
    phase: "beta",
  },
};

/**
 * Feature state management class
 * Handles URL parameters, localStorage persistence, and runtime toggles
 */
class FeatureFlags {
  constructor() {
    this.state = this.loadFeatureState();
    this.listeners = new Map();
    this.initializeFromUrl();
  }

  /**
   * Load feature state from localStorage with defaults
   * @returns {Object} Current feature state
   */
  loadFeatureState() {
    try {
      const stored = localStorage.getItem(FEATURE_FLAGS_KEY);
      const parsed = stored ? JSON.parse(stored) : {};

      // Merge with defaults
      const state = {};
      for (const [key, config] of Object.entries(FEATURE_FLAGS)) {
        state[key] = parsed[key] !== undefined ? parsed[key] : config.enabled;
      }

      // One-time migration (v3.26.01): re-enable FUZZY_AUTOCOMPLETE for users
      // who had it silently disabled before the settings toggle existed
      const migrationKey = "ff_migration_fuzzy_autocomplete"; // nosemgrep: codacy.javascript.security.hard-coded-password
      if (!localStorage.getItem(migrationKey) && parsed.FUZZY_AUTOCOMPLETE === false) {
        state.FUZZY_AUTOCOMPLETE = true;
        localStorage.setItem(migrationKey, "1");
        localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify(state));
      }

      return state;
    } catch (e) {
      console.warn("Failed to load feature flags from localStorage:", e);
      return this.getDefaultState();
    }
  }

  /**
   * Get default feature state from configuration
   * @returns {Object} Default feature state
   */
  getDefaultState() {
    const state = {};
    for (const [key, config] of Object.entries(FEATURE_FLAGS)) {
      state[key] = config.enabled;
    }
    return state;
  }

  /**
   * Initialize feature flags from URL parameters
   */
  initializeFromUrl() {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    let changed = false;

    for (const [key, config] of Object.entries(FEATURE_FLAGS)) {
      if (!config.urlOverride) continue;

      const paramName = key.toLowerCase();
      if (params.has(paramName)) {
        const value = params.get(paramName);
        const enabled = value === null || value === "" || value === "1" || value === "true";

        if (this.state[key] !== enabled) {
          this.state[key] = enabled;
          changed = true;

          if (DEBUG) {
            console.log(`Feature flag ${key} set to ${enabled} via URL parameter`);
          }
        }
      }
    }

    if (changed) {
      this.saveFeatureState();
      this.notifyListeners();
    }
  }

  /**
   * Save current feature state to localStorage
   */
  saveFeatureState() {
    try {
      localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.warn("Failed to save feature flags to localStorage:", e);
    }
  }

  /**
   * Check if a feature is enabled
   * @param {string} feature - Feature flag key
   * @returns {boolean} Whether the feature is enabled
   */
  isEnabled(feature) {
    return this.state[feature] === true;
  }

  /**
   * Enable a feature
   * @param {string} feature - Feature flag key
   * @param {boolean} [persist=true] - Whether to save to localStorage
   */
  enable(feature, persist = true) {
    if (this.state[feature] !== true) {
      this.state[feature] = true;
      if (persist) this.saveFeatureState();
      this.notifyListeners(feature);

      if (DEBUG) {
        console.log(`Feature ${feature} enabled`);
      }
    }
  }

  /**
   * Disable a feature
   * @param {string} feature - Feature flag key
   * @param {boolean} [persist=true] - Whether to save to localStorage
   */
  disable(feature, persist = true) {
    if (this.state[feature] !== false) {
      this.state[feature] = false;
      if (persist) this.saveFeatureState();
      this.notifyListeners(feature);

      if (DEBUG) {
        console.log(`Feature ${feature} disabled`);
      }
    }
  }

  /**
   * Toggle a feature on/off
   * @param {string} feature - Feature flag key
   * @param {boolean} [persist=true] - Whether to save to localStorage
   * @returns {boolean} New state after toggle
   */
  toggle(feature, persist = true) {
    const config = FEATURE_FLAGS[feature];
    if (!config || !config.userToggle) {
      console.warn(`Feature ${feature} cannot be toggled by user`);
      return this.state[feature];
    }

    if (this.state[feature]) {
      this.disable(feature, persist);
    } else {
      this.enable(feature, persist);
    }

    return this.state[feature];
  }

  /**
   * Reset all features to default state
   */
  reset() {
    this.state = this.getDefaultState();
    this.saveFeatureState();
    this.notifyListeners();

    if (DEBUG) {
      console.log("All feature flags reset to defaults");
    }
  }

  /**
   * Get current state of all features
   * @returns {Object} Current feature state
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Get feature configuration
   * @param {string} feature - Feature flag key
   * @returns {Object|null} Feature configuration or null if not found
   */
  getConfig(feature) {
    return FEATURE_FLAGS[feature] || null;
  }

  /**
   * Get all feature configurations
   * @returns {Object} All feature configurations
   */
  getAllConfigs() {
    return { ...FEATURE_FLAGS };
  }

  /**
   * Add a listener for feature state changes
   * @param {string} feature - Feature to listen for (or 'all' for all changes)
   * @param {Function} callback - Callback function (feature, enabled, oldEnabled)
   */
  addListener(feature, callback) {
    if (!this.listeners.has(feature)) {
      this.listeners.set(feature, new Set());
    }
    this.listeners.get(feature).add(callback);
  }

  /**
   * Remove a listener for feature state changes
   * @param {string} feature - Feature to stop listening for
   * @param {Function} callback - Callback function to remove
   */
  removeListener(feature, callback) {
    const featureListeners = this.listeners.get(feature);
    if (featureListeners) {
      featureListeners.delete(callback);
      if (featureListeners.size === 0) {
        this.listeners.delete(feature);
      }
    }
  }

  /**
   * Notify listeners of feature state changes
   * @param {string} [changedFeature] - Specific feature that changed (optional)
   */
  notifyListeners(changedFeature = null) {
    // Notify 'all' listeners
    const allListeners = this.listeners.get("all");
    if (allListeners) {
      allListeners.forEach((callback) => {
        try {
          callback(changedFeature, this.state);
        } catch (e) {
          console.error("Error in feature flag listener:", e);
        }
      });
    }

    // Notify specific feature listeners
    if (changedFeature) {
      const featureListeners = this.listeners.get(changedFeature);
      if (featureListeners) {
        const enabled = this.state[changedFeature];
        featureListeners.forEach((callback) => {
          try {
            callback(changedFeature, enabled);
          } catch (e) {
            console.error("Error in feature flag listener:", e);
          }
        });
      }
    }
  }

  /**
   * Get debug information about feature flags
   * @returns {Object} Debug information
   */
  getDebugInfo() {
    return {
      state: this.getState(),
      configs: this.getAllConfigs(),
      urlParams:
        typeof window !== "undefined"
          ? Object.fromEntries(new URLSearchParams(window.location.search))
          : {},
      localStorage: (() => {
        try {
          return JSON.parse(localStorage.getItem(FEATURE_FLAGS_KEY) || "{}");
        } catch (e) {
          return null;
        }
      })(),
    };
  }
}

/**
 * Global feature flags instance
 * @constant {FeatureFlags}
 */
const featureFlags = new FeatureFlags();

/**
 * Convenience functions for common feature flag operations
 */
const isFeatureEnabled = (feature) => featureFlags.isEnabled(feature);
const enableFeature = (feature, persist = true) => featureFlags.enable(feature, persist);
const disableFeature = (feature, persist = true) => featureFlags.disable(feature, persist);
const toggleFeature = (feature, persist = true) => featureFlags.toggle(feature, persist);

/**
 * Log feature flag state on initialization (debug mode only)
 */
if (DEBUG && typeof window !== "undefined") {
  console.log("Feature Flags initialized:", featureFlags.getDebugInfo());
}

/**
 * Metal configuration object - Central registry for all metal-related information
 *
 * This configuration drives the entire application's metal handling by defining:
 * - Display names for user interface elements
 * - Key identifiers for data structures and calculations
 * - DOM element ID patterns for dynamic element selection
 * - LocalStorage keys for persistent data storage
 * - CSS color variables for styling and theming
 *
 * Each metal configuration contains:
 * @property {string} name - Display name used in UI elements and forms
 * @property {string} key - Lowercase identifier for data objects and calculations
 * @property {string} spotKey - DOM ID pattern for spot price input elements
 * @property {string} localStorageKey - Key for storing spot prices in localStorage
 * @property {string} color - CSS custom property name for metal-specific styling
 *
 * Adding a new metal type requires:
 * 1. Adding configuration here
 * 2. Adding corresponding HTML elements following the naming pattern
 * 3. Adding CSS custom properties for colors
 * 4. The application will automatically handle the rest through iteration
 */
const METALS = {
  SILVER: {
    name: "Silver",
    key: "silver",
    spotKey: "spotSilver",
    localStorageKey: "spotSilver",
    color: "silver",
    defaultPrice: 25.0,
  },
  GOLD: {
    name: "Gold",
    key: "gold",
    spotKey: "spotGold",
    localStorageKey: "spotGold",
    color: "gold",
    defaultPrice: 2500.0,
  },
  PLATINUM: {
    name: "Platinum",
    key: "platinum",
    spotKey: "spotPlatinum",
    localStorageKey: "spotPlatinum",
    color: "platinum",
    defaultPrice: 1000.0,
  },
  PALLADIUM: {
    name: "Palladium",
    key: "palladium",
    spotKey: "spotPalladium",
    localStorageKey: "spotPalladium",
    color: "palladium",
    defaultPrice: 1000.0,
  },
};

// =============================================================================

// Expose globals
if (typeof window !== "undefined") {
  window.API_PROVIDERS = API_PROVIDERS;
  window.METALS = METALS;
  window.DEBUG = DEBUG;
  window.DEFAULT_CURRENCY = DEFAULT_CURRENCY;

  window.BRANDING_DOMAIN_OPTIONS = BRANDING_DOMAIN_OPTIONS;
  window.BRANDING_DOMAIN_OVERRIDE = BRANDING_DOMAIN_OVERRIDE;
  window.getTemplateVariables = getTemplateVariables;
  window.replaceTemplateVariables = replaceTemplateVariables;

  // Feature flags system
  window.FEATURE_FLAGS = FEATURE_FLAGS;
  window.featureFlags = featureFlags;
  window.isFeatureEnabled = isFeatureEnabled;
  window.enableFeature = enableFeature;
  window.disableFeature = disableFeature;
  window.toggleFeature = toggleFeature;
  window.ALLOWED_STORAGE_KEYS = ALLOWED_STORAGE_KEYS;
  window.SPOT_HISTORY_RUNTIME_WINDOW_DAYS = SPOT_HISTORY_RUNTIME_WINDOW_DAYS;
  // STAK-149: Cloud auto-sync constants
  window.SYNC_POLL_INTERVAL = SYNC_POLL_INTERVAL;
  window.SYNC_PUSH_DEBOUNCE = SYNC_PUSH_DEBOUNCE;
  window.SYNC_FILE_PATH = SYNC_FILE_PATH;
  window.SYNC_META_PATH = SYNC_META_PATH;
  window.SYNC_IMAGES_PATH = SYNC_IMAGES_PATH;
  window.SYNC_ATTACHMENTS_PATH = SYNC_ATTACHMENTS_PATH;
  window.SYNC_ITEM_PRICE_HISTORY_PATH = SYNC_ITEM_PRICE_HISTORY_PATH;
  window.SYNC_ATTACHMENT_SIZE_WARN_BYTES = SYNC_ATTACHMENT_SIZE_WARN_BYTES;
  window.VAULT_ATTACHMENT_FILE_SUFFIX = VAULT_ATTACHMENT_FILE_SUFFIX;
  window.SYNC_FILE_PATH_LEGACY = SYNC_FILE_PATH_LEGACY;
  window.SYNC_META_PATH_LEGACY = SYNC_META_PATH_LEGACY;
  window.SYNC_IMAGES_PATH_LEGACY = SYNC_IMAGES_PATH_LEGACY;
  window.SYNC_MANIFEST_PATH = SYNC_MANIFEST_PATH;
  window.SYNC_MANIFEST_PATH_LEGACY = SYNC_MANIFEST_PATH_LEGACY;
  window.SYNC_BACKUP_FOLDER = SYNC_BACKUP_FOLDER;
  window.MANUAL_BACKUP_PREFIX = MANUAL_BACKUP_PREFIX;
  window.SYNC_BACKUP_PREFIX = SYNC_BACKUP_PREFIX;
  window.CLOUD_LATEST_FILENAME = CLOUD_LATEST_FILENAME;
  window.CLOUD_BACKUP_HISTORY_KEY = CLOUD_BACKUP_HISTORY_KEY;
  window.CLOUD_BACKUP_HISTORY_DEFAULT = CLOUD_BACKUP_HISTORY_DEFAULT;
  window.CLOUD_BACKUP_HISTORY_OPTIONS = CLOUD_BACKUP_HISTORY_OPTIONS;
  window.SYNC_SCOPE_KEYS = SYNC_SCOPE_KEYS;
  window.VAULT_EXCLUDE_KEYS = VAULT_EXCLUDE_KEYS;
  window.VAULT_SETTINGS_DIFF_SKIP = VAULT_SETTINGS_DIFF_SKIP;
  // STRK-141: market histories migrated to IndexedDB
  window.HISTORY_IDB_KEYS = HISTORY_IDB_KEYS;
  window.ITEM_PRICE_HISTORY_MAX_DAYS = ITEM_PRICE_HISTORY_MAX_DAYS;
  window.ITEM_PRICE_HISTORY_MAX_ENTRIES = ITEM_PRICE_HISTORY_MAX_ENTRIES;
  window.ITEM_PRICE_HISTORY_CLEARED_AT_KEY = ITEM_PRICE_HISTORY_CLEARED_AT_KEY;
  window.CERT_LOOKUP_URLS = CERT_LOOKUP_URLS;
  // Inline chip config
  window.INLINE_CHIP_DEFAULTS = INLINE_CHIP_DEFAULTS;
  window.getInlineChipConfig = getInlineChipConfig;
  window.saveInlineChipConfig = saveInlineChipConfig;
  // Filter chip category config
  window.FILTER_CHIP_CATEGORY_DEFAULTS = FILTER_CHIP_CATEGORY_DEFAULTS;
  window.getFilterChipCategoryConfig = getFilterChipCategoryConfig;
  window.saveFilterChipCategoryConfig = saveFilterChipCategoryConfig;
  // Layout section config
  window.LAYOUT_SECTION_DEFAULTS = LAYOUT_SECTION_DEFAULTS;
  window.getLayoutSectionConfig = getLayoutSectionConfig;
  window.saveLayoutSectionConfig = saveLayoutSectionConfig;
  // Goldback denomination pricing (STACK-45)
  window.GOLDBACK_PRICES_KEY = GOLDBACK_PRICES_KEY;
  window.GOLDBACK_PRICE_HISTORY_KEY = GOLDBACK_PRICE_HISTORY_KEY;
  // Retail market pricing
  window.RETAIL_PRICES_KEY = RETAIL_PRICES_KEY;
  window.RETAIL_PRICE_HISTORY_KEY = RETAIL_PRICE_HISTORY_KEY;
  window.RETAIL_PROVIDERS_KEY = RETAIL_PROVIDERS_KEY;
  window.V2_API_ENDPOINTS = V2_API_ENDPOINTS;
  window.V2_API_BASE_URL = V2_API_BASE_URL;
  window.SPOT_MAX_PAYLOAD_AGE_MS = SPOT_MAX_PAYLOAD_AGE_MS;
  window.RETAIL_INTRADAY_KEY = RETAIL_INTRADAY_KEY;
  window.RETAIL_SYNC_LOG_KEY = RETAIL_SYNC_LOG_KEY;
  window.RETAIL_AVAILABILITY_KEY = RETAIL_AVAILABILITY_KEY;
  window.GOLDBACK_ENABLED_KEY = GOLDBACK_ENABLED_KEY;
  window.GB_TO_OZT = GB_TO_OZT;
  window.SB_TO_OZT = SB_TO_OZT;
  window.GOLDBACK_DENOMINATIONS = GOLDBACK_DENOMINATIONS;
  // STRK-235: constitutional / junk silver
  window.CONSTITUTIONAL_VARIANTS = CONSTITUTIONAL_VARIANTS;
  window.CONSTITUTIONAL_SUBSIDIARY_OZT_PER_DOLLAR = CONSTITUTIONAL_SUBSIDIARY_OZT_PER_DOLLAR;
  window.CONSTITUTIONAL_WORN_SCALAR = CONSTITUTIONAL_WORN_SCALAR;
  window.CONSTITUTIONAL_BASIS_KEY = CONSTITUTIONAL_BASIS_KEY;
  window.GOLDBACK_ESTIMATE_ENABLED_KEY = GOLDBACK_ESTIMATE_ENABLED_KEY;
  window.GB_ESTIMATE_PREMIUM = GB_ESTIMATE_PREMIUM;
  window.GB_ESTIMATE_MODIFIER_KEY = GB_ESTIMATE_MODIFIER_KEY;
  window.GOLDBACK_PRICING_SOURCE_KEY = GOLDBACK_PRICING_SOURCE_KEY;
  // View modal section config
  window.VIEW_MODAL_SECTION_DEFAULTS = VIEW_MODAL_SECTION_DEFAULTS;
  window.getViewModalSectionConfig = getViewModalSectionConfig;
  window.saveViewModalSectionConfig = saveViewModalSectionConfig;
  // Numista view field config
  window.NUMISTA_VIEW_FIELD_DEFAULTS = NUMISTA_VIEW_FIELD_DEFAULTS;
  window.getNumistaViewFieldConfig = getNumistaViewFieldConfig;
  window.saveNumistaViewFieldConfig = saveNumistaViewFieldConfig;
  // Item tags (STAK-126)
  window.ITEM_TAGS_KEY = ITEM_TAGS_KEY;
  window.ITEM_REMOVED_TAGS_KEY = ITEM_REMOVED_TAGS_KEY;
  window.ITEM_TAGS_LAST_MODIFIED_KEY = ITEM_TAGS_LAST_MODIFIED_KEY;
  window.MAX_TAGS_PER_ITEM = MAX_TAGS_PER_ITEM;
  window.MAX_TAG_LENGTH = MAX_TAG_LENGTH;
  // Multi-currency support (STACK-50)
  window.SUPPORTED_CURRENCIES = SUPPORTED_CURRENCIES;
  window.CLOUD_VAULT_IDLE_TIMEOUT_KEY = CLOUD_VAULT_IDLE_TIMEOUT_KEY;
  window.STAKTRAKR_SIMPLE_SALT = STAKTRAKR_SIMPLE_SALT;
  window.DISPLAY_CURRENCY_KEY = DISPLAY_CURRENCY_KEY;
  window.EXCHANGE_RATES_KEY = EXCHANGE_RATES_KEY;
  window.EXCHANGE_RATE_API_URL = EXCHANGE_RATE_API_URL;
  window.FALLBACK_EXCHANGE_RATES = FALLBACK_EXCHANGE_RATES;
  // STAK-222: API pipeline cache keys
  window.NUMISTA_RESPONSE_CACHE_KEY = NUMISTA_RESPONSE_CACHE_KEY;
  window.PCGS_RESPONSE_CACHE_KEY = PCGS_RESPONSE_CACHE_KEY;
  // Image storage expansion (STAK-image-storage)
  window.STORAGE_PERSIST_GRANTED_KEY = STORAGE_PERSIST_GRANTED_KEY;
  window.IMAGE_ZIP_MANIFEST_VERSION = IMAGE_ZIP_MANIFEST_VERSION;
  // Header button visibility keys (STAK-314)
  window.HEADER_VAULT_BTN_KEY = HEADER_VAULT_BTN_KEY;
  window.HEADER_RESTORE_BTN_KEY = HEADER_RESTORE_BTN_KEY;
  window.HEADER_CLOUD_SYNC_BTN_KEY = HEADER_CLOUD_SYNC_BTN_KEY;
  window.HEADER_BTN_SHOW_TEXT_KEY = HEADER_BTN_SHOW_TEXT_KEY;
  window.RETAIL_MANIFEST_TS_KEY = RETAIL_MANIFEST_TS_KEY;
  window.RETAIL_MANIFEST_SLUGS_KEY = RETAIL_MANIFEST_SLUGS_KEY;
  window.RETAIL_MANIFEST_COIN_META_KEY = RETAIL_MANIFEST_COIN_META_KEY;
  window.RETAIL_MANIFEST_VENDOR_META_KEY = RETAIL_MANIFEST_VENDOR_META_KEY;
  window.MARKET_FILTER_KEY = MARKET_FILTER_KEY;
  window.RETAIL_ANOMALY_THRESHOLD = RETAIL_ANOMALY_THRESHOLD;
  window.RETAIL_SPIKE_NEIGHBOR_TOLERANCE = RETAIL_SPIKE_NEIGHBOR_TOLERANCE;
  // Disposition types for realized gains (STAK-72)
  window.DISPOSITION_TYPES = DISPOSITION_TYPES;
  window.isDisposed = isDisposed;
}

// Expose APP_VERSION globally for non-module usage
(function () {
  if (typeof window !== "undefined") {
    window.APP_VERSION = typeof APP_VERSION !== "undefined" ? APP_VERSION : "0.0.0";
  }
})();

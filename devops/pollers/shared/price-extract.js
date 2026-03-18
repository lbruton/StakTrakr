#!/usr/bin/env node
/**
 * StakTrakr Retail Price Extractor
 * ==================================
 * Reads providers.json, scrapes each dealer URL via Playwright direct first
 * (no proxy, 15s timeout), falling back to Firecrawl (with proxy via
 * playwright-service) for targets that fail. Extracts the lowest in-stock
 * price and records each result to Turso.
 *
 * Usage:
 *   FIRECRAWL_API_KEY=fc-... node price-extract.js
 *
 * Environment:
 *   FIRECRAWL_API_KEY   Required for cloud Firecrawl. Omit for self-hosted.
 *   FIRECRAWL_BASE_URL  Self-hosted Firecrawl endpoint (default: api.firecrawl.dev)
 *   HOME_PROXY_URL        Cox WiFi tinyproxy URL (e.g. http://100.112.198.50:8888)
 *   DATA_DIR              Path to repo data/ folder (default: ../../data)
 *   COINS               Comma-separated coin slugs to run (default: all)
 *   DRY_RUN             Set to "1" to skip writing files
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openTursoDb, writeSnapshot, windowFloor, startRunLog, finishRunLog, recordFailure } from "./db.js";
import { loadProviders } from "./provider-db.js";
import { getCFClearanceCookie } from "./cf-clearance.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
// Self-hosted Firecrawl: set FIRECRAWL_BASE_URL=http://localhost:3002
// Cloud Firecrawl (default): leave unset or set to https://api.firecrawl.dev
const FIRECRAWL_BASE_URL = (process.env.FIRECRAWL_BASE_URL || "https://api.firecrawl.dev").replace(/\/$/, "");
// PLAYWRIGHT_LAUNCH: set to "1" to launch Chromium locally instead of connecting
// to a remote browserless. Useful on Fly.io where browsers are installed but no
// external browserless service is running.
const PLAYWRIGHT_LAUNCH = process.env.PLAYWRIGHT_LAUNCH === "1";
const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, "../../data"));
const DRY_RUN = process.env.DRY_RUN === "1";
const COIN_FILTER = process.env.COINS ? process.env.COINS.split(",").map(s => s.trim()) : null;
const CF_CLEARANCE_ENABLED_FLAG = process.env.CF_CLEARANCE_ENABLED !== "0";
let cfAttempts = 0;
let cfSuccess = 0;
let cfFailures = 0;
// Cox WiFi tinyproxy (port 8888) — residential proxy via Tailscale.
// Set as Fly.io secret: fly secrets set HOME_PROXY_URL=http://100.112.198.50:8888
const HOME_PROXY_URL = process.env.HOME_PROXY_URL || null;

// Sequential with per-request jitter (2-8s) — avoids rate-limit fingerprinting.
// Targets are shuffled so the same vendor is never hit consecutively;
// per-vendor effective gap ≈ (47/7 vendors) × avg_jitter ≈ ~30s — well within limits.
// Kept short so each full run completes in <10 min and fits inside the 15-min cron window.
const SCRAPE_TIMEOUT_MS = 30_000;
const FIRECRAWL_TIMEOUT_MS = 55_000; // extended timeout for Firecrawl-preferred SPAs (jmbullion needs 12s waitFor + round-trip)
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 3_000;

// Jitter between requests — randomised anti-pattern fingerprinting.
// Fly.io (datacenter IP) uses longer delays to avoid rate limits.
const POLLER_ID = process.env.POLLER_ID || "unknown";
function jitter() {
  const base = POLLER_ID === "home" ? 500 : 2_000;
  const range = POLLER_ID === "home" ? 1_500 : 6_000;
  return new Promise(r => setTimeout(r, base + Math.random() * range));
}

// Fisher-Yates shuffle (in-place)
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function warn(msg) {
  console.warn(`[${new Date().toISOString().slice(11, 19)}] WARN: ${msg}`);
}

// ---------------------------------------------------------------------------
// Price extraction from Firecrawl markdown
// ---------------------------------------------------------------------------

// Per-oz price ranges by metal type.
// Multiplied by weight_oz to get the expected price range for each coin.
// Filters out accessories, spot ticker values, and unrelated products.
const METAL_PRICE_RANGE_PER_OZ = {
  silver:    { min: 40,   max: 200   },  // 1oz: $40-200, 10oz bar: $400-2000
  gold:      { min: 1500, max: 15000 },  // 1oz: $1500-15000
  platinum:  { min: 500,  max: 6000  },
  palladium: { min: 300,  max: 6000  },
  goldback:  { min: 5,    max: 25    },  // G1 ($10 spot equivalent); G50 would be $500 but tracked separately
};

// Provider IDs that use "As Low As" as their primary price indicator.
// UPDATE 2026-02-21: Monument Metals DOES have a pricing table (1-24 row with eCheck/Wire column).
// "As Low As" is bulk discount (500+) — use table-first extraction like all other vendors.
// Empty set = all vendors now use table-first strategy.
const USES_AS_LOW_AS = new Set([]);

// Out-of-stock text patterns
const OUT_OF_STOCK_PATTERNS = [
  /out of stock/i,
  /sold out/i,
  /currently unavailable/i,
  /notify me when available/i,
  /email when in stock/i,
  /temporarily out of stock/i,
  /back ?order/i,
  /pre-?order/i,
];

// Providers whose "Pre-Order" / "Presale" items still show live purchasable prices.
// For these, skip the pre-?order OOS pattern — treat presale as in-stock.
const PREORDER_TOLERANT_PROVIDERS = new Set(["jmbullion", "monumentmetals"]);

const MARKDOWN_CUTOFF_PATTERNS = {
  sdbullion: [
    /^\*\*Add on Items\*\*/im,              // Firecrawl markdown bold header
    /^Add on Items\s*$/im,                  // Firecrawl plain-text header
    /^\*\*Customers Also Purchased\*\*/im,  // Firecrawl markdown bold header
    /^Customers Also Purchased\s*$/im,      // Firecrawl plain-text header
    /<[^>]*>\s*Add on Items/i,              // Playwright HTML header
    /<[^>]*>\s*Customers Also Purchased/i,  // Playwright HTML header
  ],
  // JM pages show "Similar Products You May Like" carousel with fractional coin
  // "As Low As" prices (1/2 oz, 1/4 oz, 1/10 oz) that fall within the metal
  // price range and cause Math.min() to pick a fractional price instead of 1oz.
  jmbullion: [
    /^Similar Products You May Like/im,    // Firecrawl markdown section heading
    /<[^>]*>\s*Similar Products You May Like/i, // Playwright HTML heading
  ],
};

// Patterns that match the START of the actual product content, used to strip
// site-wide header/nav containing spot price tickers that otherwise get mistaken
// for product prices (e.g. JM Bullion nav shows Gold Ask $5,120.96).
const MARKDOWN_HEADER_SKIP_PATTERNS = {
  // JM Bullion header ends with a timestamp like "Feb 21, 2026 at 13:30 EST"
  // followed by the nav mega-menu. The product area starts after the nav.
  // We skip past the spot ticker to avoid false gold-price matches.
  jmbullion: /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s+[A-Z]{2,4}/,
};

function preprocessMarkdown(markdown, providerId) {
  if (!markdown) return "";
  let result = markdown;

  // Strip site-wide header/nav (spot price tickers) to prevent false matches
  const headerPattern = MARKDOWN_HEADER_SKIP_PATTERNS[providerId];
  if (headerPattern) {
    const headerMatch = result.search(headerPattern);
    if (headerMatch !== -1) {
      // Find end of the matched timestamp line and skip past it
      const afterMatch = result.indexOf("\n", headerMatch);
      if (afterMatch !== -1) result = result.slice(afterMatch + 1);
    }
  }

  // Trim tail: cut at first "related products" section to avoid carousel noise
  const patterns = MARKDOWN_CUTOFF_PATTERNS[providerId];
  if (patterns) {
    let cutIndex = result.length;
    for (const pattern of patterns) {
      const match = result.search(pattern);
      if (match !== -1 && match < cutIndex) cutIndex = match;
    }
    result = result.slice(0, cutIndex);
  }

  return result;
}



/**
 * Detect stock status from Firecrawl markdown.
 *
 * @param {string} markdown  Firecrawl-scraped markdown
 * @param {number} expectedWeightOz  Expected product weight (e.g., 1 for 1 oz)
 * @param {string} [providerId]  Provider ID for per-provider OOS exceptions
 * @returns {{inStock: boolean, reason: string, detectedText: string|null}}
 */
function detectStockStatus(markdown, expectedWeightOz = 1, providerId = "") {
  if (!markdown) {
    return { inStock: true, reason: "no_markdown", detectedText: null };
  }

  // Check for out-of-stock text patterns
  const toleratesPreorder = PREORDER_TOLERANT_PROVIDERS.has(providerId);
  for (const pattern of OUT_OF_STOCK_PATTERNS) {
    if (toleratesPreorder && /pre-?order/i.source === pattern.source) continue;
    const match = markdown.match(pattern);
    if (match) {
      return {
        inStock: false,
        reason: "out_of_stock",
        detectedText: match[0]
      };
    }
  }

  // Check for fractional weight mismatch (related product substitution).
  // Only check the product title area (first H1/H2 or first ~500 chars of main content),
  // NOT the full page — nav menus on Bullion Exchanges etc. contain "1/2 oz" category
  // links that cause false positives on every page.
  // Skipped entirely for FRACTIONAL_EXEMPT_PROVIDERS whose global nav structurally
  // includes fractional coin links on every product page.
  if (expectedWeightOz >= 1 && !FRACTIONAL_EXEMPT_PROVIDERS.has(providerId)) {
    // Extract the product title: first markdown heading (# or ##) or first 500 chars
    const headingMatch = markdown.match(/^#{1,2}\s+(.+)$/m);
    const titleArea = headingMatch ? headingMatch[1] : markdown.slice(0, 500);

    const fractionalPatterns = [
      /\b1\/2\s*oz\b/i,
      /\b1\/4\s*oz\b/i,
      /\b1\/10\s*oz\b/i,
      /\bhalf\s*ounce\b/i,
      /\bquarter\s*ounce\b/i,
    ];

    for (const pattern of fractionalPatterns) {
      const match = titleArea.match(pattern);
      if (match) {
        return {
          inStock: false,
          reason: "fractional_weight",
          detectedText: match[0]
        };
      }
    }
  }

  return { inStock: true, reason: "in_stock", detectedText: null };
}

/**
 * Extract price from JSON-LD Product schema (`offers.price`).
 *
 * Checks first — before any regex-based extraction — because JSON-LD is
 * the authoritative structured price set by the merchant, and avoids
 * false positives from spot ticker values appearing earlier in innerText.
 *
 * @param {string[]} jsonLdScripts  textContent of each ld+json script tag
 * @param {string}   metal
 * @param {number}   weightOz
 * @returns {number|null}
 */
// Sentinel returned by extractJsonLdPrice when JSON-LD has a valid Product
// with price=0 — signals "real product page, no price (OOS)". Callers must
// check for this to avoid falling through to HTML extraction which would
// grab ticker/carousel prices from a zero-priced product page (STAK-475 P1).
const JSONLD_ZERO_PRICE = Symbol("jsonld-zero-price");

function extractJsonLdPrice(jsonLdScripts, metal, weightOz = 1) {
  if (!jsonLdScripts || jsonLdScripts.length === 0) return null;
  const perOz = METAL_PRICE_RANGE_PER_OZ[metal];
  if (!perOz) return null;
  const min = perOz.min * weightOz;
  const max = perOz.max * weightOz;
  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        // @type may be a string or an array per JSON-LD spec
        const typeVal = item["@type"];
        const types = Array.isArray(typeVal) ? typeVal : [typeVal];
        if (!types.includes("Product")) continue;
        const offers = item.offers;
        if (!offers) continue;
        const offerList = Array.isArray(offers) ? offers : [offers];
        for (const offer of offerList) {
          // Strip thousands separators before parsing — "1,200.00" must not become 1
          const price = parseFloat(String(offer.price ?? "").replace(/,/g, ""));
          // price=0 means the product exists but has no price (OOS).
          // Return sentinel so callers mark OOS instead of falling through
          // to HTML extraction which grabs unrelated page prices.
          if (!isNaN(price) && price === 0) return JSONLD_ZERO_PRICE;
          if (!isNaN(price) && price >= min && price <= max) return price;
        }
      }
    } catch { /* invalid JSON — skip */ }
  }
  return null;
}

/**
 * Extract the lowest plausible per-coin price from scraped markdown.
 *
 * Strategy order varies by provider to avoid picking up related-product prices:
 *
 *  For APMEX (table-first):
 *    1. Lowest price in the main pricing table — avoids "As Low As" from
 *       related products (e.g. 1/2 oz AGE) that appear later in the page.
 *    2. "As Low As" fallback.
 *
 *  For Monument Metals (as-low-as-first):
 *    1. "As Low As $XX.XX" — Monument shows this but no pricing table.
 *    2. Table fallback (won't find one for Monument).
 *
 * All candidates are filtered by weight-adjusted price range to exclude
 * accessories, spot ticker values, and fractional coin prices.
 */
function extractPrice(markdown, metal, weightOz = 1, providerId = "") {
  if (!markdown) return null;

  const perOz = METAL_PRICE_RANGE_PER_OZ[metal] || { min: 5, max: 200_000 };
  const range = { min: perOz.min * weightOz, max: perOz.max * weightOz };

  function inRange(p) {
    return p >= range.min && p <= range.max;
  }

  function tablePrices() {
    const prices = [];
    let m;
    const pat = /\|\s*\*{0,2}\$?([\d,]+\.\d{2})\*{0,2}\s*\|/g;
    while ((m = pat.exec(markdown)) !== null) {
      const p = parseFloat(m[1].replace(/,/g, ""));
      if (inRange(p)) prices.push(p);
    }
    return prices;
  }

  function asLowAsPrices() {
    const prices = [];
    let m;
    const pat = /[Aa]s\s+[Ll]ow\s+[Aa]s[\s\\]*\$?([\d,]+\.\d{2})/g;
    while ((m = pat.exec(markdown)) !== null) {
      const p = parseFloat(m[1].replace(/,/g, ""));
      if (inRange(p)) prices.push(p);
    }
    return prices;
  }

  // Returns the Check/Wire (leftmost) price from the first data row of a markdown
  // pricing table. Pricing tables list tiers smallest-first (1-unit → bulk) with
  // columns: Check/Wire | Crypto | Card. Taking prices[0] from the first matching
  // row gives the 1-unit ACH price — the fairest cross-vendor comparison point.
  function firstTableRowFirstPrice() {
    const lines = markdown.split("\n");
    for (const line of lines) {
      if (!line.startsWith("|")) continue;
      if (/^\|\s*[-:]+/.test(line)) continue; // skip separator rows
      const prices = [];
      for (const m of line.matchAll(/\|\s*\*{0,2}\$?([\d,]+\.\d{2})\*{0,2}\s*(?:\|)/g)) {
        const p = parseFloat(m[1].replace(/,/g, ""));
        if (inRange(p)) prices.push(p);
      }
      if (prices.length > 0) return prices[0];
    }
    return null;
  }

  // JM Bullion gold pages render the pricing table as plain text (not pipe tables).
  // Structure: "(e)Check/Wire" header → "1-9" qty tier → "$X,XXX.XX" (Check/Wire price).
  // Returns the first in-range price after the Check/Wire header + first qty tier.
  function jmPriceFromProseTable() {
    const checkWireIdx = markdown.search(/\(e\)Check\s*\/\s*Wire/i);
    if (checkWireIdx === -1) return null;
    // Find the first qty tier label after the header (e.g. "1-9", "1-19", "1+")
    const afterHeader = markdown.slice(checkWireIdx);
    const tierMatch = afterHeader.match(/\n\s*(\d+-\d+|\d+\+)\s*\n/);
    if (!tierMatch) return null;
    // Search for the first price after the tier label
    const afterTier = afterHeader.slice(tierMatch.index + tierMatch[0].length);
    const priceMatch = afterTier.match(/\$\s*([\d,]+\.\d{2})/);
    if (!priceMatch) return null;
    const p = parseFloat(priceMatch[1].replace(/,/g, ""));
    return inRange(p) ? p : null;
  }

  // Fallback for SPAs (e.g. Bullion Exchanges) that render prices as prose rather
  // than markdown pipe tables. Returns the first $XX.XX value in the metal range.
  function firstInRangePriceProse() {
    for (const m of markdown.matchAll(/\$\s*([\d,]+\.\d{2})/g)) {
      const p = parseFloat(m[1].replace(/,/g, ""));
      if (inRange(p)) return p;
    }
    return null;
  }

  // Summit Metals and similar Shopify stores emit "Regular price $XX.XX" or "Sale price $XX.XX"
  function regularPricePrices() {
    const prices = [];
    let m;
    const pat = /(?:Regular|Sale)\s+price\s+\$?([\d,]+\.\d{2})/g;
    while ((m = pat.exec(markdown)) !== null) {
      const p = parseFloat(m[1].replace(/,/g, ""));
      if (inRange(p)) prices.push(p);
    }
    return prices;
  }

  if (providerId === "summitmetals") {
    const reg = regularPricePrices();
    if (reg.length > 0) return { price: Math.min(...reg), matchedBy: "regularPrice" };
    const tbl = tablePrices();
    if (tbl.length > 0) return { price: Math.min(...tbl), matchedBy: "tablePrices" };
    return null;
  }

  if (providerId === "jmbullion") {
    // JM Bullion: pipe table → prose table → "As Low As" fallback.
    // Silver pages often render pipe tables; gold pages render as plain text.
    // jmPriceFromProseTable() handles the plain-text layout:
    //   "(e)Check/Wire" header → "1-9" qty tier → first dollar amount.
    // NOTE: firstInRangePriceProse() is intentionally NOT used here — JMBullion's
    // mega-menu (after nav stripping) can contain goldback category prices in the
    // $5-$25 range that appear before the product price and produce false matches.
    const tblFirst = firstTableRowFirstPrice();
    if (tblFirst !== null) return { price: tblFirst, matchedBy: "tableFirstRow" };
    const proseTbl = jmPriceFromProseTable();
    if (proseTbl !== null) return { price: proseTbl, matchedBy: "jmProseTable" };
    const ala = asLowAsPrices();
    if (ala.length > 0) return { price: Math.min(...ala), matchedBy: "asLowAs" };
  } else if (USES_AS_LOW_AS.has(providerId)) {
    // Reserved for vendors that have no pricing table, only "As Low As" display.
    // Currently empty — all vendors now use table-first extraction.
    const ala = asLowAsPrices();
    if (ala.length > 0) return { price: Math.min(...ala), matchedBy: "asLowAs" };
    const tbl = tablePrices();
    if (tbl.length > 0) return { price: Math.min(...tbl), matchedBy: "tablePrices" };
  } else {
    // ALL VENDORS: APMEX, SDB, Monument, Hero Bullion, Bullion Exchanges, Summit, etc.
    // Tables have columns: Check/Wire | Crypto | Card; rows: 1-unit → bulk.
    // firstTableRowFirstPrice() returns the 1-unit Check/Wire (ACH) price.
    // firstInRangePriceProse() handles SPAs (e.g. Bullion Exchanges) that
    // render the price grid as prose rather than markdown pipe tables.
    // "As Low As" is last resort (bulk discount fallback if table parsing fails).
    const tblFirst = firstTableRowFirstPrice();
    if (tblFirst !== null) return { price: tblFirst, matchedBy: "tableFirstRow" };
    const prose = firstInRangePriceProse();
    if (prose !== null) return { price: prose, matchedBy: "firstInRangeProse" };
    const ala = asLowAsPrices();
    if (ala.length > 0) return { price: Math.min(...ala), matchedBy: "asLowAs" };
  }

  return null;
}


// ---------------------------------------------------------------------------
// Firecrawl API
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Per-Provider Scraping Configuration
// ---------------------------------------------------------------------------
// Single source of truth for all vendor-specific scraping behavior.
// Replaces scattered SLOW_PROVIDERS, FIRECRAWL_PREFERRED_PROVIDERS,
// FIRECRAWL_TABLE_PARSE_PROVIDERS, FRACTIONAL_EXEMPT_PROVIDERS, and
// inline if-chains for timeouts/waitFor/waitUntil.
//
// proxy.{pollerId}: "fly" = route through Fly.io proxy, "home" = route through
//   home residential proxy, null = use poller's own IP.

// phase values:
//   "phase0"             → Phase 0 (Playwright-direct) first, then Firecrawl, then CF-clearance fallback
//   "firecrawl"          → Skip Phase 0, Firecrawl first, then CF-clearance fallback
//   "cf-clearance-first" → Byparr/CF-clearance first, then Firecrawl fallback (for CF-protected vendors)
const PROVIDER_DEFAULTS = {
  phase: "phase0",             // try Phase 0 (Playwright-direct) first
  waitFor: 0,                  // Firecrawl waitFor (ms) — 0 = no extra wait
  waitUntil: "networkidle",    // Phase 0 page.goto waitUntil
  waitAfter: 0,                // Phase 0 extra wait after page load (ms)
  timeout: SCRAPE_TIMEOUT_MS,  // Firecrawl abort timeout
  onlyMainContent: true,       // Firecrawl onlyMainContent flag
  retryOn408: true,            // allow retry on Firecrawl 408 timeout
  fractionalExempt: false,     // skip fractional_weight nav false-positive check
  cf_clearance_fallback: false, // attempt Phase 2 CF-clearance sidecar on 403
  proxy: {},                   // per-poller proxy routing
};

const PROVIDER_CONFIG = {
  apmex: {
    phase: "firecrawl",         // HTML table → innerText loses pipes → wrong price
    waitFor: 8000,
    timeout: FIRECRAWL_TIMEOUT_MS,
  },
  monumentmetals: {
    phase: "firecrawl",         // Same table extraction issue as apmex
    waitFor: 5000,
    timeout: 35_000,
    retryOn408: false,          // page either renders in time or doesn't
  },
  jmbullion: {
    phase: "cf-clearance-first", // Byparr first (100% success), Firecrawl fallback
    waitFor: 10_000,
    timeout: 40_000,
    onlyMainContent: false,     // React pages return empty with onlyMainContent
    retryOn408: false,          // retrying won't help — skip to save ~40s
    cf_clearance_fallback: true,
    fractionalExempt: true,     // mega-menu lists fractional coins on every page
  },
  bullionexchanges: {
    phase: "cf-clearance-first", // Byparr first (100% success), Firecrawl fallback
    waitFor: 15_000,            // React pricing grid needs 12-15s to fully hydrate
    timeout: 70_000,            // extended timeout for 15s waitFor + round-trip
    fractionalExempt: true,     // Related Products section lists fractional variants
    cf_clearance_fallback: true,
    proxy: {
      home: null,               // home poller is on residential IP — no proxy needed
      fly: null,                // Fly.io uses its own IP (93%+ success rate)
    },
  },
  sdbullion: {
    waitUntil: "domcontentloaded",  // fast — no need for networkidle
  },
  herobullion: {
    phase: "firecrawl",            // Phase 0 innerText loses pipe-table structure →
                                   // firstTableRowFirstPrice() returns null → firstInRangePriceProse()
                                   // grabs "As Low As" bulk price before the 1-unit table price.
                                   // Firecrawl markdown has | pipe | tables — extraction works correctly.
    waitFor: 3_000,
  },
  gainesvillecoins: {
    phase: "firecrawl",            // Phase 0 Playwright direct always times out (15s wasted per coin).
                                   // Firecrawl succeeds reliably — skip Phase 0 entirely.
    waitFor: 3_000,
  },
  summitmetals: {
    // defaults are fine — phase0 + networkidle
  },
  goldback: {
    // defaults are fine — phase0 + networkidle
  },
};

// Merge defaults into each provider config
for (const [id, cfg] of Object.entries(PROVIDER_CONFIG)) {
  PROVIDER_CONFIG[id] = { ...PROVIDER_DEFAULTS, ...cfg, proxy: { ...PROVIDER_DEFAULTS.proxy, ...cfg.proxy } };
}

// Helper: get config for a provider (falls back to defaults for unknown vendors)
function providerCfg(providerId) {
  return PROVIDER_CONFIG[providerId] || PROVIDER_DEFAULTS;
}

// Resolve proxy URL for this provider on the current poller instance
const FLY_PROXY_URL = process.env.FLY_PROXY_URL || null;
// Port of the Fly.io-proxied playwright-service (for BEx Cloudflare bypass)
const FLY_PW_SERVICE_PORT = process.env.FLY_PW_SERVICE_PORT || "3004";
function resolveProxy(providerId) {
  const cfg = providerCfg(providerId);
  const target = cfg.proxy?.[POLLER_ID] || null;
  if (target === "fly") return FLY_PROXY_URL;
  if (target === "home") return HOME_PROXY_URL;
  return null;
}

// Compatibility shims — used in code that still references the old Sets.
// TODO: Remove these after all callsites are refactored to use providerCfg().
const SLOW_PROVIDERS = new Set(Object.entries(PROVIDER_CONFIG).filter(([,c]) => c.waitFor > 0).map(([id]) => id));
const FIRECRAWL_PREFERRED_PROVIDERS = new Set(Object.entries(PROVIDER_CONFIG).filter(([,c]) => c.phase === "firecrawl").map(([id]) => id));
const FIRECRAWL_TABLE_PARSE_PROVIDERS = new Set(["apmex", "monumentmetals"]);
const PLAYWRIGHT_ONLY_PROVIDERS = new Set([]);  // kept empty — all routing is via PROVIDER_CONFIG.phase
const FRACTIONAL_EXEMPT_PROVIDERS = new Set(Object.entries(PROVIDER_CONFIG).filter(([,c]) => c.fractionalExempt).map(([id]) => id));



// Scrape via proxied playwright-service (port 3004) — bypasses Firecrawl entirely.
// Returns plain text (like Phase 0 innerText), not markdown.
// Used for vendors behind Cloudflare that need the Fly.io IP.
async function scrapeViaProxy(url, waitFor = 15000, timeout = 40000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(`http://localhost:${FLY_PW_SERVICE_PORT}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, wait_after_load: waitFor, timeout }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`playwright-service-fly HTTP ${resp.status}`);
    const json = await resp.json();
    if (json.pageStatusCode && json.pageStatusCode >= 400) {
      throw new Error(`upstream ${json.pageStatusCode}: ${json.pageError || "error"}`);
    }
    // Convert HTML to plain text (strip tags) for extractPrice()
    const html = json.content || "";
    const text = html.replace(/<script[^>]*>[\s\S]*?<\/script\s*>/gi, "")
                     .replace(/<style[^>]*>[\s\S]*?<\/style\s*>/gi, "")
                     .replace(/<[^>]+>/g, " ")
                     .replace(/\s+/g, " ")
                     .trim();
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function scrapeViaCFClearance(url, providerId, coin) {
  log(`[cf-clearance] attempt: ${providerId} ${url}`);
  const cfData = await getCFClearanceCookie(url);
  if (!cfData) {
    warn(`[cf-clearance] sidecar unavailable for ${providerId}`);
    return null;
  }

  // Byparr already fetched the page — try its response HTML first (fast path).
  // For server-rendered pages this avoids a second Playwright request. For SPAs
  // (e.g. Bullion Exchanges Magento PWA) the HTML is just the app shell with no
  // prices — fall through to Playwright with the cookie so the SPA can hydrate.
  if (cfData.responseHtml) {
    const rawText = cfData.responseHtml
      .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/(script|style|head)>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    const cleaned = preprocessMarkdown(rawText, providerId);
    const inStock = detectStockStatus(cleaned, coin.weight_oz || 1, providerId);
    const price = extractPrice(cleaned, coin.metal, coin.weight_oz || 1, providerId);
    if (price !== null) {
      log(`[cf-clearance] success (html): ${providerId} price=${price.price}`);
      return { price: price.price, inStock: inStock.inStock, source: "cf-clearance" };
    }
    warn(`[cf-clearance] no price from Byparr HTML for ${providerId} — falling through to Playwright`);
    // Don't return null — fall through to Playwright with the cookie.
    // SPA pages need a real browser to hydrate their pricing grids.
  }

  // Fallback: launch Playwright with the cf_clearance cookie.
  // Reached when (a) Byparr had no response HTML, or (b) HTML was present but
  // extraction failed (SPA app shell). Requires a valid cookie.
  if (!cfData.cfClearance) {
    warn(`[cf-clearance] no cookie and no usable HTML for ${providerId}`);
    return null;
  }
  let browser;
  try {
    const cfg = providerCfg(providerId);
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    const context = await browser.newContext({
      userAgent: cfData.userAgent,
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });
    const urlObj = new URL(url);
    await context.addCookies([{
      name: "cf_clearance",
      value: cfData.cfClearance,
      domain: urlObj.hostname,
      path: "/",
      httpOnly: false,
      secure: true,
    }]);
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "font", "stylesheet", "media"].includes(type)) route.abort();
      else route.continue();
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: cfg.timeout || 40000 });
    if (cfg.waitFor > 0) await page.waitForTimeout(cfg.waitFor);
    // Capture JSON-LD BEFORE removing nav elements — some vendors embed
    // <script type="application/ld+json"> inside <header>/<footer>; removing first
    // would make querySelectorAll return empty. Strip nav/header/footer after capturing
    // to prevent spot tickers from polluting innerText (Firecrawl onlyMainContent equivalent).
    const [text, jsonLdScripts] = await page.evaluate(() => {
      const scripts = Array.from(
        document.querySelectorAll('script[type="application/ld+json"]'),
        s => s.textContent
      );
      document.querySelectorAll("nav, header, footer, [role='navigation'], [role='banner']")
        .forEach(el => el.remove());
      return [document.body.innerText, scripts];
    });
    await browser.close();
    browser = null;
    const cleaned = preprocessMarkdown(text, providerId);
    const inStock = detectStockStatus(cleaned, coin.weight_oz || 1, providerId);
    // JSON-LD is authoritative — avoids related-product / spot ticker false positives.
    const jsonLdPrice = extractJsonLdPrice(jsonLdScripts, coin.metal, coin.weight_oz || 1);
    if (jsonLdPrice === JSONLD_ZERO_PRICE) {
      log(`[cf-clearance] ${providerId}: JSON-LD price=0 → OOS, skipping HTML extraction`);
      return { price: null, inStock: false, source: "cf-clearance" };
    }
    if (jsonLdPrice !== null) {
      log(`[cf-clearance] success via jsonLd: ${providerId} price=${jsonLdPrice}`);
      return { price: jsonLdPrice, inStock: inStock.inStock, source: "cf-clearance" };
    }
    const price = extractPrice(cleaned, coin.metal, coin.weight_oz || 1, providerId);
    if (price !== null) {
      log(`[cf-clearance] success (playwright): ${providerId} price=${price.price}`);
      return { price: price.price, inStock: inStock.inStock, source: "cf-clearance" };
    }
    warn(`[cf-clearance] no price extracted for ${providerId}`);
    return null;
  } catch (err) {
    warn(`[cf-clearance] failure: ${providerId} error=${err.message}`);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function scrapeUrl(url, providerId = "", attempt = 1, coin = null) {
  const controller = new AbortController();
  const scrapeTimeout = providerCfg(providerId).timeout;
  const timer = setTimeout(() => controller.abort(), scrapeTimeout);

  const body = {
    url,
    formats: ["markdown"],
    // JM Bullion's React pages sometimes return empty markdown with onlyMainContent.
    // Disable it for JM — our MARKDOWN_CUTOFF_PATTERNS handle noise removal instead.
    onlyMainContent: providerCfg(providerId).onlyMainContent,
  };
  // JS-heavy SPAs need time to mount and render prices; 8s covers all slow providers.
  // (Bumped from 6s after jmbullion/bullionexchanges were removed from PLAYWRIGHT_ONLY;
  // their React SPAs need the extra 2s to fully render pricing tables.)
  const cfgWaitFor = providerCfg(providerId).waitFor;
  if (cfgWaitFor > 0) body.waitFor = cfgWaitFor;

  try {
    const response = await fetch(`${FIRECRAWL_BASE_URL}/v1/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(FIRECRAWL_API_KEY ? { "Authorization": `Bearer ${FIRECRAWL_API_KEY}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      // 403 = bot detection / IP block. Retrying Firecrawl (same IP) won't help;
      // skip retries — terminal failure for this target.
      if (response.status === 403) {
        const cfg = providerCfg(providerId);
        if (cfg.cf_clearance_fallback && CF_CLEARANCE_ENABLED_FLAG) {
          cfAttempts++;
          const phase2 = await scrapeViaCFClearance(url, providerId, coin);
          if (phase2 !== null) {
            cfSuccess++;
            return phase2;
          }
          cfFailures++;
        }
        throw Object.assign(
          new Error(`HTTP 403 (blocked): ${text.slice(0, 200)}`),
          { skipRetry: true }
        );
      }
      // 408 = Firecrawl scrape timeout. For jmbullion, retrying won't help —
      // the page either renders in time or it doesn't. Skip retries to save ~40s.
      if (response.status === 408 && !providerCfg(providerId).retryOn408) {
        throw Object.assign(
          new Error(`HTTP 408 (scrape timeout, jmb/monument retry disabled): ${text.slice(0, 200)}`),
          { skipRetry: true }
        );
      }
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const json = await response.json();
    return json?.data?.markdown ?? null;

  } catch (err) {
    // Abort/timeout = the request was killed by our AbortController.
    // Retrying the same Firecrawl call won't help; skip retries.
    if (err.name === "AbortError" || (err.message && err.message.includes("aborted"))) {
      err.skipRetry = true;
    }
    if (!err.skipRetry && attempt < RETRY_ATTEMPTS) {
      warn(`Retry ${attempt}/${RETRY_ATTEMPTS} for ${url}: ${err.message}`);
      await sleep(RETRY_DELAY_MS * attempt);
      return scrapeUrl(url, providerId, attempt + 1, coin);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Playwright direct — fast first-pass, no proxy, 15s timeout
// ---------------------------------------------------------------------------

/**
 * Lightweight Playwright scrape: direct connection (no proxy), 15s timeout,
 * no retries. Designed as a fast first-pass that succeeds for ~65/88 targets
 * in under 5s. Returns null immediately on any failure so Firecrawl can
 * take over as fallback.
 *
 * @param {string} url
 * @param {string} providerId
 * @param {Object} coin  Coin metadata (metal, weight_oz)
 * @returns {Promise<{price: number, inStock: boolean, source: string}|null>}
 */
async function scrapeWithPlaywrightDirect(url, providerId, coin) {
  if (!PLAYWRIGHT_LAUNCH) return null;

  const DIRECT_TIMEOUT_MS = 15_000;
  const { chromium } = await import("playwright-core");
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();

    // Block non-essential resource types to reduce bandwidth ~60-80%
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "font", "stylesheet", "media"].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    const phase0WaitUntil = providerCfg(providerId).waitUntil;
    const response = await page.goto(url, { waitUntil: phase0WaitUntil, timeout: DIRECT_TIMEOUT_MS });

    // 403 = bot detection — bail immediately, let Firecrawl handle it
    if (response && response.status() === 403) {
      log(`  (playwright-direct) 403 on ${providerId} — skipping to Firecrawl`);
      return null;
    }

    // Per-provider extra wait for JS rendering (Phase A: herobullion 8s->2s)
    // Phase 0 wait handled by providerCfg().waitAfter
    const phase0Wait = providerCfg(providerId).waitAfter;
    if (phase0Wait > 0) {
      await page.waitForTimeout(phase0Wait);
    }

    // Capture JSON-LD BEFORE removing nav elements (same as scrapeViaCFClearance Phase 2).
    // Some vendors embed <script type="application/ld+json"> inside <header>/<footer>;
    // removing those elements first would return empty scripts. After capturing, strip
    // nav/header/footer to prevent spot tickers from polluting innerText and causing
    // firstInRangePriceProse() to match the spot price instead of the product price.
    const [text, jsonLdScripts] = await page.evaluate(() => {
      const scripts = Array.from(
        document.querySelectorAll('script[type="application/ld+json"]'),
        s => s.textContent
      );
      document.querySelectorAll("nav, header, footer, [role='navigation'], [role='banner']")
        .forEach(el => el.remove());
      return [document.body.innerText, scripts];
    });
    const cleaned = preprocessMarkdown(text, providerId);
    const stock = detectStockStatus(cleaned, coin.weight_oz || 1, providerId);

    // JSON-LD is authoritative — check before regex fallbacks to avoid
    // grabbing spot ticker deltas or related-product prices from innerText.
    const jsonLdPrice = extractJsonLdPrice(jsonLdScripts, coin.metal, coin.weight_oz || 1);
    if (jsonLdPrice === JSONLD_ZERO_PRICE) {
      log(`  ${providerId}: JSON-LD price=0 → OOS, skipping HTML extraction`);
      return { price: null, inStock: false, source: "playwright-direct" };
    }
    if (jsonLdPrice !== null) {
      log(`  extractPrice ${providerId}: matched=jsonLd price=$${jsonLdPrice.toFixed(2)}`);
      return { price: jsonLdPrice, inStock: stock.inStock, source: "playwright-direct" };
    }

    const extracted = extractPrice(cleaned, coin.metal, coin.weight_oz || 1, providerId);
    const price = extracted ? extracted.price : null;
    if (extracted) log(`  extractPrice ${providerId}: matched=${extracted.matchedBy} price=$${extracted.price.toFixed(2)}`);

    if (price !== null) {
      return { price, inStock: stock.inStock, source: "playwright-direct" };
    }

    // OOS with no price — still useful stock status info, but let Firecrawl try for a price
    if (!stock.inStock) {
      log(`  (playwright-direct) ${providerId}: OOS detected but no price — trying Firecrawl`);
      return null;
    }

    // Page loaded but no price extracted — Firecrawl may parse differently
    return null;

  } catch (err) {
    log(`  (playwright-direct) ${providerId} failed: ${err.message.slice(0, 100)} — falling back`);
    return null;
  } finally {
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const isLocal = !FIRECRAWL_BASE_URL.includes("api.firecrawl.dev");
  // PLAYWRIGHT_LAUNCH=1 runs Chromium directly — no Firecrawl needed (home poller mode)
  if (!FIRECRAWL_API_KEY && !isLocal && !PLAYWRIGHT_LAUNCH) {
    console.error("Error: FIRECRAWL_API_KEY is required for cloud Firecrawl.");
    console.error("For self-hosted: set FIRECRAWL_BASE_URL=http://localhost:3002");
    console.error("For home poller (Playwright only): set PLAYWRIGHT_LAUNCH=1");
    process.exit(1);
  }

  // Load providers from Turso (falls back to local file if Turso is down)
  let tursoClient = null;
  try { tursoClient = (await import("./turso-client.js")).createTursoClient(); } catch {}
  const providersJson = await loadProviders(tursoClient, DATA_DIR);
  const dateStr = new Date().toISOString().slice(0, 10);

  // Build scrape targets — shuffled to avoid rate-limit fingerprinting
  const targets = [];
  for (const [coinSlug, coin] of Object.entries(providersJson.coins)) {
    if (COIN_FILTER && !COIN_FILTER.includes(coinSlug)) continue;
    for (const provider of coin.providers) {
      const providerUrls = provider.urls ?? (provider.url ? [provider.url] : []);
      if (!provider.enabled || providerUrls.length === 0) continue;
      targets.push({ coinSlug, coin, provider, urls: providerUrls });
    }
  }
  shuffleArray(targets);

  log(`Proxy config: HOME_PROXY_URL=${HOME_PROXY_URL ? "SET" : "NOT SET"}, PLAYWRIGHT_LAUNCH=${PLAYWRIGHT_LAUNCH}`);

  // Probe proxy health (non-blocking, non-fatal; informational only)
  if (HOME_PROXY_URL) {
    try {
      await fetch(HOME_PROXY_URL, { signal: AbortSignal.timeout(5000) });
      log(`Proxy probe: OK (${HOME_PROXY_URL})`);
    } catch {
      warn(`HOME_PROXY_URL unreachable (${HOME_PROXY_URL})`);
    }
  } else {
    log(`Proxy probe: skipped (HOME_PROXY_URL not set)`);
  }

  log(`Retail price extraction: ${targets.length} targets (sequential + jitter)`);
  if (DRY_RUN) log("DRY RUN — no SQLite writes");

  // Open SQLite for this run — closed in finally block to ensure cleanup on fatal errors
  const db = DRY_RUN ? null : await openTursoDb();
  const scrapedAt = new Date().toISOString();
  const winStart = windowFloor();

  // Start run log entry in Turso.
  // First, mark any orphaned "running" rows from previous crashed runs as "error".
  let runId = null;
  if (db) {
    try {
      await db.execute({
        sql: `UPDATE poller_runs SET status = 'error', error = 'orphaned — process crashed or was killed'
              WHERE poller_id = ? AND status = 'running'`,
        args: [POLLER_ID],
      });
      runId = await startRunLog(db, { pollerId: POLLER_ID, startedAt: scrapedAt, total: targets.length });
    } catch (err) {
      warn(`Run log start failed (non-fatal): ${err.message.slice(0, 80)}`);
    }
  }

  try {

  // Scrape all targets sequentially with per-request jitter
  const scrapeResults = [];
  for (let targetIdx = 0; targetIdx < targets.length; targetIdx++) {
    const { coinSlug, coin, provider, urls } = targets[targetIdx];
    log(`Scraping ${coinSlug}/${provider.id}${urls.length > 1 ? ` (${urls.length} URL(s))` : ""}`);

    let price = null;
    let source = "firecrawl";
    let inStock = true;
    let finalUrl = urls[0];
    const _retriedUrls = new Set();

    // ── Phase CF-First: Byparr/CF-clearance first (for cf-clearance-first vendors) ─
    // For vendors where Byparr has 100% success rate (BE, JM), skip the 70s Firecrawl
    // timeout entirely. If Byparr fails, fall through to Phase 0/1 as safety net.
    const cfg = providerCfg(provider.id);
    if (cfg.phase === "cf-clearance-first" && CF_CLEARANCE_ENABLED_FLAG) {
      log(`  [cf-first] ${provider.id}: trying Byparr first`);
      cfAttempts++;
      const cfResult = await scrapeViaCFClearance(urls[0], provider.id, coin);
      if (cfResult !== null && cfResult.price !== null) {
        cfSuccess++;
        price = cfResult.price;
        source = cfResult.source;
        inStock = cfResult.inStock;
        finalUrl = urls[0];
        log(`  ✓ ${coinSlug}/${provider.id}: $${price.toFixed(2)} (cf-first${!inStock ? ", OOS" : ""})`);
        scrapeResults.push({
          coinSlug, coin, providerId: provider.id, url: finalUrl,
          price, source, inStock, ok: true, error: null,
        });
        if (db) {
          await writeSnapshot(db, {
            scrapedAt, windowStart: winStart, coinSlug,
            vendor: provider.id, price, source,
            isFailed: false, inStock,
          });
        }
        if (targetIdx < targets.length - 1) { await jitter(); }
        continue;
      }
      // Byparr returned null or no price — OOS with no price is still useful
      if (cfResult !== null && cfResult.price === null && !cfResult.inStock) {
        cfSuccess++;
        log(`  ✓ ${coinSlug}/${provider.id}: OOS detected (cf-first, no price)`);
        scrapeResults.push({
          coinSlug, coin, providerId: provider.id, url: finalUrl,
          price: null, source: cfResult.source, inStock: false, ok: true, error: null,
        });
        if (db) {
          await writeSnapshot(db, {
            scrapedAt, windowStart: winStart, coinSlug,
            vendor: provider.id, price: null, source: cfResult.source,
            isFailed: false, inStock: false,
          });
        }
        if (targetIdx < targets.length - 1) { await jitter(); }
        continue;
      }
      cfFailures++;
      log(`  ↻ ${coinSlug}/${provider.id}: cf-first failed — falling through to Phase 0/1`);
    }

    // ── Phase 0: Try Playwright direct (no proxy, 15s timeout) ──────────────
    // Fast first-pass — succeeds for ~65/88 targets in <5s. If it gets a price,
    // skip Firecrawl entirely. Skip for PLAYWRIGHT_ONLY_PROVIDERS (they need
    // Firecrawl's stealth patches) and FIRECRAWL_PREFERRED_PROVIDERS (they need
    // Firecrawl's markdown pipe-table conversion for correct extraction).
    // Exception: goldback slugs are individual product detail pages with a single
    // prominently-displayed price — not HTML pricing tables — so Phase 0 Playwright
    // extracts prices correctly for table-parse vendors (apmex, monumentmetals).
    // Bot-detection vendors (jmbullion, bullionexchanges) are NOT bypassed: they
    // still need Firecrawl stealth even on goldback detail pages (API-14).
    const isGoldback = coinSlug.startsWith("goldback");
    const fcPreferredForTarget = FIRECRAWL_PREFERRED_PROVIDERS.has(provider.id) &&
      !(isGoldback && FIRECRAWL_TABLE_PARSE_PROVIDERS.has(provider.id));
    if (!PLAYWRIGHT_ONLY_PROVIDERS.has(provider.id) && !fcPreferredForTarget && PLAYWRIGHT_LAUNCH) {
      const directResult = await scrapeWithPlaywrightDirect(urls[0], provider.id, coin);
      if (directResult !== null) {
        price = directResult.price;
        source = directResult.source;
        inStock = directResult.inStock;
        finalUrl = urls[0];
        log(`  ✓ ${coinSlug}/${provider.id}: $${price.toFixed(2)} (playwright-direct${!inStock ? ", OOS" : ""})`);
        // Skip Firecrawl — go straight to store result
        scrapeResults.push({
          coinSlug, coin, providerId: provider.id, url: finalUrl,
          price, source, inStock, ok: true, error: null,
        });
        if (db) {
          await writeSnapshot(db, {
            scrapedAt, windowStart: winStart, coinSlug,
            vendor: provider.id, price, source,
            isFailed: false, inStock,
          });
        }
        if (targetIdx < targets.length - 1) { await jitter(); }
        continue;
      }
    }

    // ── Phase 1: Try all URLs via Firecrawl ──────────────────────────────────
    // Skip Phase 1 for providers where Firecrawl is structurally unreliable
    // (bot detection or waitFor-not-supported JS rendering). price/inStock stay
    // at their defaults (null / true) so the failure path fires below.
    if (!PLAYWRIGHT_ONLY_PROVIDERS.has(provider.id)) {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        if (i > 0) log(`  → ${coinSlug}/${provider.id}: fallback URL [${i}]: ${url}`);

        try {
          // Proxy-first path: if this provider routes through an alternate IP,
          // try the proxied playwright-service first (e.g., Fly.io IP for BEx).
          let markdown;
          const proxyTarget = resolveProxy(provider.id);
          if (proxyTarget) {
            try {
              const cfg = providerCfg(provider.id);
              const proxyText = await scrapeViaProxy(url, cfg.waitFor, cfg.timeout);
              // scrapeViaProxy returns plain text (like Phase 0), not markdown.
              // Use it directly for extraction — preprocessMarkdown handles both.
              const proxyCleaned = preprocessMarkdown(proxyText, provider.id);
              const proxyStock = detectStockStatus(proxyCleaned, coin.weight_oz || 1, provider.id);
              const proxyExtracted = extractPrice(proxyCleaned, coin.metal, coin.weight_oz || 1, provider.id);
              if (proxyExtracted) {
                log(`  extractPrice ${provider.id}: matched=${proxyExtracted.matchedBy} price=$${proxyExtracted.price.toFixed(2)} (fly-proxy)`);
                price = proxyExtracted.price;
                source = "fly-proxy";
                inStock = proxyStock.inStock;
                finalUrl = url;
                log(`  \u2713 ${coinSlug}/${provider.id}: $${price.toFixed(2)} (fly-proxy)${!inStock ? " OOS" : ""}`);
                break;
              }
              log(`  \u21bb ${coinSlug}/${provider.id}: fly-proxy returned no price, falling back to firecrawl`);
            } catch (proxyErr) {
              warn(`  \u2717 ${provider.id} fly-proxy error: ${proxyErr.message.slice(0, 80)}, falling back`);
            }
          }
          const scrapeResult = await scrapeUrl(url, provider.id, 1, coin);
          // Phase 2 (CF-clearance) returns an object directly — short-circuit markdown path
          if (scrapeResult !== null && typeof scrapeResult === "object") {
            price = scrapeResult.price;
            source = scrapeResult.source;
            inStock = scrapeResult.inStock;
            finalUrl = url;
            log(`  ✓ ${coinSlug}/${provider.id}: $${price.toFixed(2)} (${source})`);
            break;
          }
          markdown = scrapeResult;
          const cleaned = preprocessMarkdown(markdown, provider.id);
          const stock = detectStockStatus(cleaned, coin.weight_oz || 1, provider.id);

          if (!stock.inStock) {
            log(`  ⚠ ${provider.id} [url${i}]: ${stock.reason} — ${stock.detectedText || "detected"}`);
            // Still attempt price extraction — OOS pages often show advertised price
            const oosExtracted = extractPrice(cleaned, coin.metal, coin.weight_oz || 1, provider.id);
            const oosPrice = oosExtracted ? oosExtracted.price : null;
            if (oosExtracted) log(`  extractPrice ${provider.id}: matched=${oosExtracted.matchedBy} price=$${oosExtracted.price.toFixed(2)} (OOS)`);
            if (oosPrice !== null) {
              price = oosPrice;
              finalUrl = url;
              log(`  ✓ ${coinSlug}/${provider.id}: $${oosPrice.toFixed(2)} (firecrawl, OOS)`);
            }
            if (i < urls.length - 1 && oosPrice === null) { await jitter(); continue; }
            // Last URL or got a price — exit loop with inStock=false
            inStock = false;
            if (!finalUrl || finalUrl !== url) finalUrl = url;
            break;
          }

          const extracted = extractPrice(cleaned, coin.metal, coin.weight_oz || 1, provider.id);
          const p = extracted ? extracted.price : null;
          if (extracted) log(`  extractPrice ${provider.id}: matched=${extracted.matchedBy} price=$${extracted.price.toFixed(2)}`);
          if (p !== null) {
            price = p;
            finalUrl = url;
            log(`  ✓ ${coinSlug}/${provider.id}: $${p.toFixed(2)} (firecrawl)${urls.length > 1 ? ` [url${i}]` : ""}`);
            break;
          }

          // Parse failure on this URL — retry once with longer wait for FIRECRAWL_PREFERRED
          // providers (jmbullion, bullionexchanges) where proxy latency can cause under-render.
          if (FIRECRAWL_PREFERRED_PROVIDERS.has(provider.id) && !_retriedUrls.has(url)) {
            _retriedUrls.add(url);
            log(`  ↻ ${coinSlug}/${provider.id} [url${i}]: retrying with extended waitFor...`);
            await jitter();
            try {
              const retryRaw = await scrapeUrl(url, provider.id, 1, coin);
              // Phase 2 result object — short-circuit retry markdown path
              if (retryRaw !== null && typeof retryRaw === "object") {
                price = retryRaw.price;
                source = retryRaw.source;
                inStock = retryRaw.inStock;
                finalUrl = url;
                log(`  ✓ ${coinSlug}/${provider.id}: $${price.toFixed(2)} (${source})`);
                break;
              }
              const retryMd = retryRaw;
              const retryCleaned = preprocessMarkdown(retryMd, provider.id);
              const retryStock = detectStockStatus(retryCleaned, coin.weight_oz || 1, provider.id);
              const retryExtracted = extractPrice(retryCleaned, coin.metal, coin.weight_oz || 1, provider.id);
              const retryPrice = retryExtracted ? retryExtracted.price : null;
              if (retryExtracted) log(`  extractPrice ${provider.id}: matched=${retryExtracted.matchedBy} price=$${retryExtracted.price.toFixed(2)} (retry)`);
              if (retryPrice !== null) {
                price = retryPrice;
                source = "firecrawl-retry";
                inStock = retryStock.inStock;
                finalUrl = url;
                log(`  ✓ ${coinSlug}/${provider.id}: $${retryPrice.toFixed(2)} (firecrawl-retry)${!inStock ? " OOS" : ""}`);
                break;
              }
            } catch (retryErr) {
              warn(`  ✗ ${provider.id} [url${i}] retry error: ${retryErr.message.slice(0, 100)}`);
            }
          }

          warn(`  ? ${coinSlug}/${provider.id} [url${i}]: page loaded, no price — trying next URL`);
          if (i < urls.length - 1) { await jitter(); continue; }

          // Last URL, Firecrawl parse failure — no more fallbacks
          finalUrl = url;

        } catch (err) {
          warn(`  ✗ ${provider.id} [url${i}] firecrawl error: ${err.message.slice(0, 100)}`);
          if (i < urls.length - 1) { await jitter(); continue; }
          // Last URL threw — no more fallbacks
          finalUrl = url;
        }
      }
    }

    // ── Phase 2 fallback: CF-clearance for invisible Cloudflare challenges ──────
    // Cloudflare's JS challenge returns 200 (not 403), so the in-scrapeUrl 403
    // trigger never fires. If Phase 0+1 both returned no price for a
    // cf_clearance_fallback vendor, attempt Byparr now as a last resort.
    // Skip for cf-clearance-first vendors — they already tried Byparr at the top.
    if (price === null && inStock && cfg.phase !== "cf-clearance-first") {
      if (cfg.cf_clearance_fallback && CF_CLEARANCE_ENABLED_FLAG) {
        log(`  [cf-clearance] ${provider.id}: no price from Phase 0/1 — trying Byparr bypass`);
        cfAttempts++;
        try {
          const phase2 = await scrapeViaCFClearance(urls[0], provider.id, coin);
          if (phase2 !== null) {
            price = phase2.price;
            source = phase2.source;
            inStock = phase2.inStock;
            finalUrl = urls[0];
            cfSuccess++;
            log(`  ✓ ${coinSlug}/${provider.id}: $${price.toFixed(2)} (${source})`);
          } else {
            cfFailures++;
          }
        } catch (cfErr) {
          cfFailures++;
          warn(`  ✗ ${provider.id} cf-clearance error: ${cfErr.message.slice(0, 100)}`);
        }
      }
    }

    // Log terminal state if not already logged
    if (price === null && inStock) {
      warn(`  ? ${coinSlug}/${provider.id}: all URLs exhausted, no price found`);
    } else if (price === null && !inStock) {
      // OOS already logged per-URL above
    }

    // ── Store result ──────────────────────────────────────────────────────────
    // OOS with a price is a successful scrape — the advertised price is valid data.
    // Only count as failure if in-stock but no price found (actual scrape failure).
    const scrapeOk = price !== null || !inStock;
    scrapeResults.push({
      coinSlug, coin, providerId: provider.id, url: finalUrl,
      price, source, inStock, ok: scrapeOk,
      error: price === null && inStock ? "price_not_found" : null,
    });

    // Record to Turso
    if (db) {
      await writeSnapshot(db, {
        scrapedAt,
        windowStart: winStart,
        coinSlug,
        vendor:    provider.id,
        price,
        source,
        isFailed:  price === null && inStock,  // Only failed if in stock but no price
        inStock,
      });

      // Record individual failure for failure queue (R10)
      if (price === null && inStock) {
        try {
          await recordFailure(db, {
            coinSlug,
            vendorId: provider.id,
            url: finalUrl || urls[0],
            error: "price_not_found",
            failedAt: scrapedAt,
          });
        } catch (err) {
          warn(`Failure log failed (non-fatal): ${err.message.slice(0, 80)}`);
        }
      }
    }

    // Jitter before next request (skip after last target)
    if (targetIdx < targets.length - 1) {
      await jitter();
    }
  }

  const ok = scrapeResults.filter(r => r.ok).length;
  const fail = scrapeResults.length - ok;

  log(`Done: ${ok}/${scrapeResults.length} prices captured, ${fail} failures, cf-clearance: ${cfAttempts} attempts ${cfSuccess} ok ${cfFailures} failed`);

  // Finish run log entry in Turso
  if (db && runId) {
    try {
      await finishRunLog(db, {
        runId,
        finishedAt: new Date().toISOString(),
        captured: ok,
        failures: fail,
        fbpFilled: 0,
        error: ok === 0 ? "All scrapes failed" : null,
      });
    } catch (err) {
      warn(`Run log finish failed (non-fatal): ${err.message.slice(0, 80)}`);
    }
  }

  if (ok === 0) {
    console.error("All scrapes failed.");
    process.exit(1);
  }

  } finally {
    if (db) db.close();
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

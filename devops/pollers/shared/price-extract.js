#!/usr/bin/env node
/**
 * StakTrakr Retail Price Extractor
 * ==================================
 * Reads providers.json, scrapes each dealer URL via Playwright direct first
 * (no proxy, 15s timeout), falling back to Firecrawl (with proxy via
 * playwright-service) for targets that fail. Extracts the lowest in-stock
 * price and records each result to sqld.
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
import {
  openSqldDb,
  writeSnapshot,
  windowFloor,
  startRunLog,
  finishRunLog,
  recordFailure,
  readSpotCurrent,
} from "./db.js";
import { loadProviders } from "./provider-db.js";
import { getCFClearanceCookie } from "./cf-clearance.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
// Self-hosted Firecrawl: set FIRECRAWL_BASE_URL=http://localhost:3002
// Cloud Firecrawl (default): leave unset or set to https://api.firecrawl.dev
const FIRECRAWL_BASE_URL = (process.env.FIRECRAWL_BASE_URL || "https://api.firecrawl.dev").replace(
  /\/$/,
  ""
);
// PLAYWRIGHT_LAUNCH: set to "1" to launch Chromium locally instead of connecting
// to a remote browserless. Useful on Fly.io where browsers are installed but no
// external browserless service is running.
const PLAYWRIGHT_LAUNCH = process.env.PLAYWRIGHT_LAUNCH === "1";
const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, "../../data"));
const DRY_RUN = process.env.DRY_RUN === "1";
const COIN_FILTER = process.env.COINS ? process.env.COINS.split(",").map((s) => s.trim()) : null;
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
  return new Promise((r) => setTimeout(r, base + Math.random() * range));
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

/** Wrapper around writeSnapshot that catches DB errors so a single failed
 *  write doesn't crash the entire run. Returns true on success. */
let _dbWriteFailures = 0;
async function safeWriteSnapshot(db, row) {
  try {
    await writeSnapshot(db, row);
    return true;
  } catch (err) {
    _dbWriteFailures++;
    warn(
      `DB write failed for ${row.coinSlug}/${row.vendor} (non-fatal): ${err.message.slice(0, 100)}`
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Price extraction from Firecrawl markdown
// ---------------------------------------------------------------------------

// Per-oz price ranges by metal type.
// Multiplied by weight_oz to get the expected price range for each coin.
// Filters out accessories, spot ticker values, and unrelated products.
const METAL_PRICE_RANGE_PER_OZ = {
  silver: { min: 40, max: 200 }, // 1oz: $40-200, 10oz bar: $400-2000
  gold: { min: 1500, max: 15000 }, // 1oz: $1500-15000
  platinum: { min: 500, max: 6000 },
  palladium: { min: 300, max: 6000 },
  goldback: { min: 5, max: 25 }, // G1 ($10 spot equivalent); G50 would be $500 but tracked separately
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
  // Hero Bullion (WooCommerce) shows a `<p class="stock out-of-stock">Unavailable</p>`
  // badge that Firecrawl renders as a bare "Unavailable" line. Anchored to a line
  // start to avoid matching prose like "Currently unavailable for shipping" elsewhere.
  /^\s*unavailable\s*$/im,
];

// Soft 404 patterns — React SPAs return HTTP 200 but render "not found" content.
// When detected, the scraper should record inStock=false and price=null (STAK-475).
const SOFT_404_PATTERNS = [
  /page\s*(not|can['\u2019]?t be|cannot be)\s*found/i,
  /product\s*(not|no longer)\s*(found|available)/i,
  /404\s*[-–—]\s*(page|not found)/i,
  /this\s+page\s+(doesn['\u2019]?t|does not)\s+exist/i,
  /we\s+couldn['\u2019]?t\s+find/i,
  /the\s+page\s+you\s+(requested|are looking for)/i,
  /no\s+longer\s+available/i,
  /has\s+been\s+(removed|discontinued)/i,
];

// Providers whose "Pre-Order" / "Presale" items still show live purchasable prices.
// For these, skip the pre-?order OOS pattern — treat presale as in-stock.
const PREORDER_TOLERANT_PROVIDERS = new Set(["jmbullion", "monumentmetals"]);

const MARKDOWN_CUTOFF_PATTERNS = {
  sdbullion: [
    /^\*\*Add on Items\*\*/im, // Firecrawl markdown bold header
    /^Add on Items\s*$/im, // Firecrawl plain-text header
    /^\*\*Customers Also Purchased\*\*/im, // Firecrawl markdown bold header
    /^Customers Also Purchased\s*$/im, // Firecrawl plain-text header
    /<[^>]*>\s*Add on Items/i, // Playwright HTML header
    /<[^>]*>\s*Customers Also Purchased/i, // Playwright HTML header
  ],
  // JM pages show "Similar Products You May Like" carousel with fractional coin
  // "As Low As" prices (1/2 oz, 1/4 oz, 1/10 oz) that fall within the metal
  // price range and cause Math.min() to pick a fractional price instead of 1oz.
  jmbullion: [
    /^Similar Products You May Like/im, // Firecrawl markdown section heading
    /<[^>]*>\s*Similar Products You May Like/i, // Playwright HTML heading
  ],
  // Monument Metals embeds ShopperApproved customer reviews on every product
  // page. Review prose can contain OOS keywords ("Out Of Stock") that trigger
  // false positives in detectStockStatus(). Cut before the review block.
  monumentmetals: [
    /[\d,]+\s+Reviews?\]\(https:\/\/www\.shopperapproved/i, // Firecrawl markdown (includes href)
    /[\d,]+\s+Reviews?\b/i, // Playwright plain-text (innerText has no href)
    /\bSuggested Products\b/i, // "Suggested Products" section after reviews
  ],
  // Summit Metals (Shopify) embeds an identical static FAQ accordion on every
  // product page. One answer contains the literal phrase "...or marked as
  // 'Out of stock.'", which trips OUT_OF_STOCK_PATTERNS in detectStockStatus()
  // and false-flags EVERY Summit item OOS — even though the real status badge
  // ("In Stock, Ready to Ship") appears higher up the page. Cut the
  // description/reviews/FAQ tail before stock + price detection. The product's
  // own pricing table and "Regular price" cards sit ABOVE "Description Shipping
  // & Returns", so price extraction is unaffected. (Same failure class as the
  // monumentmetals review-block fix above.)
  summitmetals: [
    /^Description Shipping & Returns\s*$/im, // product tab bar — tail begins here
    /^#{0,6}\s*What Our Clients/im, // reviews section heading (fallback)
    /^Faq'?s\s*$/im, // FAQ section heading (final guard before "Out of stock")
  ],
};

// Patterns that match the START of the actual product content, used to strip
// site-wide header/nav containing spot price tickers that otherwise get mistaken
// for product prices (e.g. JM Bullion nav shows Gold Ask $5,120.96).
const MARKDOWN_HEADER_SKIP_PATTERNS = {
  // JM Bullion header ends with a timestamp like "Feb 21, 2026 at 13:30 EST"
  // followed by the nav mega-menu. The product area starts after the nav.
  // We skip past the spot ticker to avoid false gold-price matches.
  jmbullion:
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s+[A-Z]{2,4}/,
  // Monument Metals (React SPA) — nav has spot tickers like "Gold $3,120.50 Silver $32.10".
  // Skip past the header/nav area to avoid firstInRangeProse grabbing spot prices.
  // The product title typically follows a breadcrumb containing "Home >" or the product name.
  monumentmetals: /(?:Home\s*>|Bullion\s*>|Coins?\s*>)/,
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

  // Check for soft 404 pages (React SPAs returning HTTP 200 with "not found" content)
  for (const pattern of SOFT_404_PATTERNS) {
    const match = markdown.match(pattern);
    if (match) {
      return {
        inStock: false,
        reason: "soft_404",
        detectedText: match[0],
      };
    }
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
        detectedText: match[0],
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
          detectedText: match[0],
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
 * Resolution order per Product/Offer:
 *   1. `priceSpecification` with qty-1 + wire/eCheck `appliesToPaymentMethod` (preferred)
 *   2. Bare `offer.price` in metal range — SKIPPED when providerId is in
 *      UNTRUSTED_OFFER_PRICE_VENDORS (STRK-99); caller then falls through to
 *      markdown-table extraction in `extractPrice()`.
 *   3. `offer.price === 0` → returns JSONLD_ZERO_PRICE sentinel (OOS signal,
 *      STAK-475 P1) — honored for ALL vendors including denied ones.
 *
 * @param {string[]} jsonLdScripts  textContent of each ld+json script tag
 * @param {string}   metal
 * @param {number}   [weightOz=1]
 * @param {string}   [providerId=""]  Used to consult UNTRUSTED_OFFER_PRICE_VENDORS
 *                                    denylist (STRK-99). Empty string keeps the
 *                                    legacy "always honor offer.price" behavior.
 * @returns {number|symbol|null}  Numeric price, JSONLD_ZERO_PRICE sentinel for
 *                                OOS, or null if no usable price was found.
 */
// Sentinel returned by extractJsonLdPrice when JSON-LD has a valid Product
// with price=0 — signals "real product page, no price (OOS)". Callers must
// check for this to avoid falling through to HTML extraction which would
// grab ticker/carousel prices from a zero-priced product page (STAK-475 P1).
const JSONLD_ZERO_PRICE = Symbol("jsonld-zero-price");

// Vendors whose JSON-LD `offer.price` is the deepest "As Low As" bulk tier
// rather than the 1-unit retail price (STRK-99). For these vendors, we still
// honor a tier-aware `priceSpecification` block if present (qty-1 wire entry),
// but we skip the bare `offer.price` fallback so extractPrice() can pull the
// correct 1-unit Check/Wire price from the markdown table instead.
//
// Verified 2026-05-23: SDB and BE both publish only `offer.price` (no
// priceSpecification array, no eligibleQuantity, no appliesToPaymentMethod).
// Add a vendor here only after confirming via live JSON-LD capture that the
// bare offer.price is consistently the bulk-tier value.
const UNTRUSTED_OFFER_PRICE_VENDORS = new Set(["sdbullion", "bullionexchanges"]);

function extractJsonLdPrice(jsonLdScripts, metal, weightOz = 1, providerId = "") {
  if (!jsonLdScripts || jsonLdScripts.length === 0) return null;
  const perOz = METAL_PRICE_RANGE_PER_OZ[metal];
  if (!perOz) return null;
  const min = perOz.min * weightOz;
  const max = perOz.max * weightOz;

  function inRange(p) {
    return !isNaN(p) && p >= min && p <= max;
  }

  const WIRE_METHOD_RE = /bank|wire|check|ach/i;
  function isBankTransfer(method) {
    if (!method) return false;
    if (typeof method === "string")
      return method.includes("ByBankTransferInAdvance") || WIRE_METHOD_RE.test(method);
    if (method["@id"])
      return (
        method["@id"].includes("ByBankTransferInAdvance") || WIRE_METHOD_RE.test(method["@id"])
      );
    if (method.name) return WIRE_METHOD_RE.test(method.name);
    return false;
  }

  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const typeVal = item["@type"];
        const types = Array.isArray(typeVal) ? typeVal : [typeVal];
        if (!types.includes("Product")) continue;
        const offers = item.offers;
        if (!offers) continue;
        const offerList = Array.isArray(offers) ? offers : [offers];
        for (const offer of offerList) {
          // Prefer wire/eCheck price from priceSpecification (qty-1 tier).
          // offer.price is often the Card/PayPal tier — ~4% higher than wire.
          const rawSpecs = offer.priceSpecification;
          const specs = rawSpecs == null ? [] : Array.isArray(rawSpecs) ? rawSpecs : [rawSpecs];
          if (specs.length > 0) {
            let wirePrice = null;
            for (const spec of specs) {
              const methods = Array.isArray(spec.appliesToPaymentMethod)
                ? spec.appliesToPaymentMethod
                : [spec.appliesToPaymentMethod];
              if (!methods.some(isBankTransfer)) continue;
              const qty = spec.eligibleQuantity;
              const qtyMin = qty ? String(qty.minValue ?? qty.value ?? "") : "";
              if (qtyMin && qtyMin !== "1") continue;
              const p = parseFloat(String(spec.price ?? "").replace(/,/g, ""));
              if (inRange(p)) {
                wirePrice = p;
                break;
              }
            }
            if (wirePrice !== null) return wirePrice;
          }

          const price = parseFloat(String(offer.price ?? "").replace(/,/g, ""));
          // Always honor the zero-price OOS sentinel — even for denied vendors.
          // A zero offer.price reliably signals "real product page, no price"
          // (STAK-475 P1); only the in-range fallback is untrustworthy.
          if (!isNaN(price) && price === 0) return JSONLD_ZERO_PRICE;
          // STRK-99: SDB and BE publish offer.price as the deepest bulk tier.
          // Skip the bare-offer fallback for these vendors so extractPrice()
          // can read the correct 1-unit Check/Wire price from the markdown table.
          // Tiered priceSpecification above is still honored if a vendor adds one.
          if (UNTRUSTED_OFFER_PRICE_VENDORS.has(providerId)) continue;
          if (inRange(price)) return price;
        }
      }
    } catch {
      /* invalid JSON — skip */
    }
  }
  return null;
}

/**
 * Extract `availability` from any JSON-LD Product/Offer block.
 *
 * schema.org availability values: InStock, OutOfStock, PreOrder, Discontinued,
 * SoldOut, LimitedAvailability, OnlineOnly, InStoreOnly, BackOrder.
 *
 * Returned as a normalized lowercase short token (e.g. "outofstock") or null
 * when no offer with availability is present. Used by `scrapeUrl` to short-
 * circuit Hero Bullion OOS pages where the JSON-LD price is non-zero but
 * the offer is explicitly OutOfStock (STAK-566).
 *
 * @param {string[]} jsonLdScripts  textContent of each ld+json script tag
 * @returns {string|null}
 */
function extractJsonLdAvailability(jsonLdScripts) {
  if (!jsonLdScripts || jsonLdScripts.length === 0) return null;

  function checkProduct(item) {
    const typeVal = item["@type"];
    const types = Array.isArray(typeVal) ? typeVal : [typeVal];
    if (!types.includes("Product")) return null;
    const offers = item.offers;
    if (!offers) return null;
    const offerList = Array.isArray(offers) ? offers : [offers];
    let nonOos = null;
    for (const offer of offerList) {
      const av = offer.availability;
      if (!av) continue;
      // schema.org URLs: http://schema.org/OutOfStock/, https://schema.org/InStock, etc.
      // Also tolerate bare tokens like "OutOfStock". Split by / or # first, then match.
      const m = String(av)
        .split(/[\/#]/)
        .pop()
        .match(/([A-Za-z]+)/);
      if (m) {
        const token = m[1].toLowerCase();
        if (JSONLD_OOS_VALUES.has(token)) return token;
        if (!nonOos) nonOos = token;
      }
    }
    return nonOos;
  }

  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (!item) continue;
        // RankMath/Yoast and many WP themes wrap nodes in @graph.
        let nodes;
        if (item["@graph"] != null) {
          nodes = Array.isArray(item["@graph"]) ? item["@graph"] : [item["@graph"]];
        } else {
          nodes = [item];
        }
        for (const node of nodes) {
          const av = checkProduct(node);
          if (av) return av;
        }
      }
    } catch {
      /* invalid JSON — skip */
    }
  }
  return null;
}

const JSONLD_OOS_VALUES = new Set(["outofstock", "soldout", "discontinued"]);

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

  // JM Bullion pipe-table parser. Firecrawl sometimes renders the JM pricing
  // grid as a markdown pipe table instead of prose. Columns are payment tiers
  // (e.g. | Qty | (e)Check/Wire | Crypto | Card |); the (e)Check/Wire column is
  // the correct ACH/wire price StakTrakr compares. Locate that column by header
  // label, then return its first in-range data-row price. Column-blind fallback
  // picks Card/PayPal ~half the time (STAK-565).
  function jmPriceFromPipeTable() {
    const lines = markdown.split("\n");
    const WIRE_RE = /\(?e?\)?\s*Check\s*\/\s*Wire/i;
    let wireCol = -1;
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      // CRLF-safe: trim before pipe check so \r or leading whitespace don't break startsWith
      const line = lines[i].trim();
      if (!line.startsWith("|") || !WIRE_RE.test(line)) continue;
      // require separator row to avoid prose false-positives (e.g. single-cell note rows)
      let sepFound = false;
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (next === "") continue;
        if (/^\|\s*[-:]+/.test(next)) {
          sepFound = true;
        }
        break;
      }
      if (!sepFound) continue;
      const cells = line.split("|");
      for (let c = 0; c < cells.length; c++) {
        if (WIRE_RE.test(cells[c])) {
          wireCol = c;
          headerIdx = i;
          break;
        }
      }
      if (wireCol !== -1) break;
    }
    if (wireCol === -1) return null;
    let seenData = false;
    for (let i = headerIdx + 1; i < lines.length; i++) {
      // CRLF-safe: trim before pipe check
      const line = lines[i].trim();
      if (!line.startsWith("|")) {
        // stop at table boundary: blank line or prose after we've entered data rows
        if (seenData) break;
        continue;
      }
      if (/^\|\s*[-:]+/.test(line)) continue;
      seenData = true;
      const cells = line.split("|");
      if (wireCol >= cells.length) continue;
      const m = cells[wireCol].match(/\$?\s*([\d,]+\.\d{2})/);
      if (!m) continue;
      const p = parseFloat(m[1].replace(/,/g, ""));
      if (inRange(p)) return p;
    }
    return null;
  }

  // STRK-99 hotfix: tier-anchored prose extractor for vendors whose Byparr-
  // rendered HTML produces flat plain text (no markdown pipe tables) and whose
  // pricing grid is structured as
  //     <qty-range> $<wire> $<crypto> $<card>
  //     <qty-range> $<wire> $<crypto> $<card>
  //     ...
  // (e.g. "1-24 $77.82 $78.61 $80.93   25-99 $77.62 ..." on Bullion Exchanges).
  //
  // qty-range patterns we accept:
  //   "1-24" / "20-99" / "100-499" / "500+"  (multi-tier)
  //   "1+"   (single-tier — no quantity break advertised)
  //
  // The price we return is the FIRST in-range $-value immediately following the
  // FIRST qty-range marker. This:
  //   (a) avoids spot tickers (no qty-range precedes them in the chrome-stripped text),
  //   (b) avoids related-product sidebars (which use "As low as" prose, never qty-range),
  //   (c) gives the 1-unit Check/Wire price (the smallest qty-range always comes first).
  //
  // Returns null when no qty-range pattern is found — the caller should treat
  // this as "no usable price extracted" rather than fall through to a looser
  // matcher that would re-introduce the spot-ticker / related-product noise.
  function tierAnchoredPrice() {
    // qty-range forms we accept (allowing whitespace around dashes since some
    // vendors render "1 - 49" rather than "1-49" in their hydrated DOM):
    //   <1-3 digits> [ws] - [ws] <1-5 digits>    → "1-49" / "1 - 49" / "100-499"
    //   <1-3 digits> +                            → "50+" / "500+" / "1+"
    // We cap the LOW side at 3 digits to prevent "2024 - 2025" year ranges
    // from matching when a description and a price happen to share a line.
    const pattern = /\b(?:\d{1,3}\s*-\s*\d{1,5}|\d{1,3}\+)\s+\$\s*([\d,]+\.\d{2})/g;
    for (const m of markdown.matchAll(pattern)) {
      const p = parseFloat(m[1].replace(/,/g, ""));
      if (inRange(p)) return p;
    }
    return null;
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
    // Summit's pricing grid lists tiers 1-9 → 100+ with columns Check/Wire |
    // Card. The 1-9 Check/Wire price is the single-unit comparison point, matching
    // every other vendor. Firecrawl renders it as a pipe table; phase0 Playwright
    // innerText flattens it to prose ("1-9 $79.22 $82.55"). Target the FIRST qty
    // tier on both paths. The "Regular price" mini-cards carry the 100+ BULK price
    // (≈0.3% lower), so they are the last-resort fallback, never the primary read.
    const tblFirst = firstTableRowFirstPrice(); // Firecrawl pipe-table path
    if (tblFirst !== null) return { price: tblFirst, matchedBy: "tableFirstRow" };
    const tier = tierAnchoredPrice(); // phase0 innerText prose path
    if (tier !== null) return { price: tier, matchedBy: "tierAnchored" };
    const reg = regularPricePrices(); // fallback: bulk "Regular price" cards
    if (reg.length > 0) return { price: Math.min(...reg), matchedBy: "regularPrice" };
    return null;
  }

  if (providerId === "jmbullion") {
    // JM Bullion: prose table → header-aware pipe table. Both anchor to the
    // "(e)Check/Wire" column label. Column-blind fallbacks are DISALLOWED —
    // picking the wrong column returns Card/PayPal (~10% higher than wire)
    // ~half the time depending on which scrape engine rendered the page
    // (STAK-565 regression; original column-blindness noted in STAK-498 Task 6).
    // Better to return null (missed window) than record the wrong-tier price.
    // "As Low As" is a 100+ unit ACH discount, not single-unit retail (STAK-475 P2).
    const proseTbl = jmPriceFromProseTable();
    if (proseTbl !== null) return { price: proseTbl, matchedBy: "jmProseTable" };
    const pipeTbl = jmPriceFromPipeTable();
    if (pipeTbl !== null) return { price: pipeTbl, matchedBy: "jmPipeTable" };
    return null;
  } else if (UNTRUSTED_OFFER_PRICE_VENDORS.has(providerId)) {
    // STRK-99 hotfix (v3.34.83): tier-anchored extraction for SDB + BE.
    // These vendors' Byparr/innerText payloads can contain (in order):
    //   1. Spot ticker in chrome (silver $75.92 / gold $4,520) — survives if
    //      htmlToPlainText chrome-strip misses it.
    //   2. Related-product sidebar entries like "American Eagle ... As low as: $4,566".
    //   3. The main pricing grid:  "1-24 $77.82 $78.61 $80.93   25-99 $77.62 ..."
    //
    // firstInRangePriceProse() picks (1) or (2) when (3) hasn't rendered yet,
    // which is the regression we observed at v3.34.82. Tier-anchored extraction
    // skips (1) and (2) entirely because neither is preceded by a "1-24" /
    // "1+" / "500+" quantity-range marker. Returns null when (3) isn't present
    // — the caller treats that as "no price extracted" rather than poisoning
    // the dashboard with a sidebar or spot value.
    const tblFirst = firstTableRowFirstPrice();
    if (tblFirst !== null) return { price: tblFirst, matchedBy: "tableFirstRow" };
    const tier = tierAnchoredPrice();
    if (tier !== null) return { price: tier, matchedBy: "tierAnchored" };
    return null;
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
  return new Promise((r) => setTimeout(r, ms));
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
  phase: "phase0", // try Phase 0 (Playwright-direct) first
  waitFor: 0, // Firecrawl waitFor (ms) — 0 = no extra wait
  waitUntil: "networkidle", // Phase 0 page.goto waitUntil
  waitAfter: 0, // Phase 0 extra wait after page load (ms)
  timeout: SCRAPE_TIMEOUT_MS, // Firecrawl abort timeout
  onlyMainContent: true, // Firecrawl onlyMainContent flag
  retryOn408: true, // allow retry on Firecrawl 408 timeout
  fractionalExempt: false, // skip fractional_weight nav false-positive check
  cf_clearance_fallback: false, // attempt Phase 2 CF-clearance sidecar on 403
  requestHtml: false, // also request HTML from Firecrawl (for JSON-LD OOS checks)
  proxy: {}, // per-poller proxy routing
};

const PROVIDER_CONFIG = {
  apmex: {
    phase: "firecrawl", // HTML table → innerText loses pipes → wrong price
    waitFor: 8000,
    timeout: FIRECRAWL_TIMEOUT_MS,
  },
  monumentmetals: {
    phase: "firecrawl", // Same table extraction issue as apmex
    waitFor: 5000,
    timeout: 35_000,
    retryOn408: false, // page either renders in time or doesn't
  },
  jmbullion: {
    phase: "phase0", // Playwright-direct first (JSON-LD extracts reliably in ~6s on
    // residential IP). Byparr reserved as fallback via cf_clearance_fallback.
    // JM's CF tier upgraded beyond Byparr's 45s window ~2026-04-23; fresh-session
    // Byparr gets harder challenge than long-lived poller browser (STAK-574; follow-up to STAK-565).
    waitFor: 10_000,
    timeout: 40_000,
    onlyMainContent: false, // React pages return empty with onlyMainContent
    retryOn408: false, // retrying won't help — skip to save ~40s
    cf_clearance_fallback: true,
    fractionalExempt: true, // mega-menu lists fractional coins on every page
  },
  bullionexchanges: {
    phase: "cf-clearance-first", // Byparr first (100% success), Firecrawl fallback
    waitFor: 15_000, // React pricing grid needs 12-15s to fully hydrate
    timeout: 70_000, // extended timeout for 15s waitFor + round-trip
    fractionalExempt: true, // Related Products section lists fractional variants
    cf_clearance_fallback: true,
    proxy: {
      home: null, // home poller is on residential IP — no proxy needed
      fly: null, // Fly.io uses its own IP (93%+ success rate)
    },
  },
  sdbullion: {
    waitUntil: "domcontentloaded", // fast — no need for networkidle
  },
  herobullion: {
    phase: "firecrawl", // Phase 0 innerText loses pipe-table structure →
    // firstTableRowFirstPrice() returns null → firstInRangePriceProse()
    // grabs "As Low As" bulk price before the 1-unit table price.
    // Firecrawl markdown has | pipe | tables — extraction works correctly.
    waitFor: 3_000,
    // STAK-566: Hero pages keep the price visible even when the product is
    // sold out (`availability: OutOfStock` in JSON-LD). Pull HTML alongside
    // markdown so scrapeUrl can short-circuit on the JSON-LD availability
    // signal before the price extractor runs.
    requestHtml: true,
  },
  gainesvillecoins: {
    phase: "firecrawl", // Phase 0 Playwright direct always times out (15s wasted per coin).
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
  PROVIDER_CONFIG[id] = {
    ...PROVIDER_DEFAULTS,
    ...cfg,
    proxy: { ...PROVIDER_DEFAULTS.proxy, ...cfg.proxy },
  };
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
const FIRECRAWL_PREFERRED_PROVIDERS = new Set(
  Object.entries(PROVIDER_CONFIG)
    .filter(([, c]) => c.phase === "firecrawl")
    .map(([id]) => id)
);
const FIRECRAWL_TABLE_PARSE_PROVIDERS = new Set(["monumentmetals"]);
const PLAYWRIGHT_ONLY_PROVIDERS = new Set([]); // kept empty — all routing is via PROVIDER_CONFIG.phase
const FRACTIONAL_EXEMPT_PROVIDERS = new Set(
  Object.entries(PROVIDER_CONFIG)
    .filter(([, c]) => c.fractionalExempt)
    .map(([id]) => id)
);

function findHtmlTagEnd(html, fromIndex) {
  let quote = null;
  for (let i = fromIndex; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return i;
  }
  return -1;
}

function isHtmlWhitespace(ch) {
  return ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === "\f";
}

function findRawTextCloseTag(html, lowerHtml, tagName, fromIndex) {
  const closeTag = tagName.toLowerCase();
  let searchFrom = fromIndex;
  while (searchFrom < html.length) {
    const lt = html.indexOf("<", searchFrom);
    if (lt === -1) return -1;
    let cursor = lt + 1;
    while (cursor < html.length && isHtmlWhitespace(html[cursor])) cursor++;
    if (html[cursor] !== "/") {
      searchFrom = lt + 1;
      continue;
    }
    cursor++;
    while (cursor < html.length && isHtmlWhitespace(html[cursor])) cursor++;
    const nameStart = cursor;
    while (cursor < html.length) {
      const code = lowerHtml.charCodeAt(cursor);
      const isNameChar = (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
      if (!isNameChar) break;
      cursor++;
    }
    if (lowerHtml.slice(nameStart, cursor) !== closeTag) {
      searchFrom = lt + 1;
      continue;
    }
    while (cursor < html.length && isHtmlWhitespace(html[cursor])) cursor++;
    if (html[cursor] === ">") return cursor;
    searchFrom = lt + 1;
  }
  return -1;
}

function collapseWhitespace(text) {
  let output = "";
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (isHtmlWhitespace(ch)) {
      pendingSpace = output.length > 0;
      continue;
    }
    if (pendingSpace) {
      output += " ";
      pendingSpace = false;
    }
    output += ch;
  }
  return output;
}

// Tags whose entire content is dropped (not just their open/close markers) when
// converting HTML to plain text via htmlToPlainText():
//   - script / style: HTML5 raw-text elements; never contain product text.
//   - nav / header / footer: SPA chrome that contains site-wide spot tickers,
//     mega-menu category links, and pre-footer ads. Per HTML5, these MUST NOT
//     contain product (<main>) content, so dropping them is safe across vendors.
//     (STRK-99 hotfix: bullionexchanges returned spot ticker for every coin
//     because Byparr captured the React shell before the price grid hydrated;
//     the only $-values in its plain text were the header ticker.)
const CHROME_OR_RAWTEXT_TAGS = new Set(["script", "style", "nav", "header", "footer"]);

function htmlToPlainText(html) {
  if (!html) return "";
  const lowerHtml = html.toLowerCase();
  let text = "";
  let cursor = 0;

  while (cursor < html.length) {
    const lt = html.indexOf("<", cursor);
    if (lt === -1) {
      text += html.slice(cursor);
      break;
    }

    text += html.slice(cursor, lt);

    if (lowerHtml.startsWith("<!--", lt)) {
      const commentEnd = html.indexOf("-->", lt + 4);
      cursor = commentEnd === -1 ? html.length : commentEnd + 3;
      text += " ";
      continue;
    }

    let nameStart = lt + 1;
    while (nameStart < html.length && isHtmlWhitespace(html[nameStart])) nameStart++;
    const isClosingTag = html[nameStart] === "/";
    if (isClosingTag) nameStart++;
    while (nameStart < html.length && isHtmlWhitespace(html[nameStart])) nameStart++;

    let nameEnd = nameStart;
    while (nameEnd < html.length) {
      const code = lowerHtml.charCodeAt(nameEnd);
      const isNameChar = (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
      if (!isNameChar) break;
      nameEnd++;
    }

    const tagName = lowerHtml.slice(nameStart, nameEnd);
    // STRK-99 hotfix: drop entire <script>, <style>, AND SPA chrome blocks
    // (<nav>, <header>, <footer>) before flattening to plain text. The chrome
    // tags carry site-wide spot tickers and mega-menu links that otherwise
    // poison firstInRangePriceProse() on vendors whose product price is JS-
    // hydrated AFTER Byparr's render window — bullionexchanges was returning
    // spot silver/gold from the header ticker for every coin because Byparr
    // captured the React shell before the product price grid rendered.
    // HTML5 forbids <main>-style product content inside these tags, so this
    // is safe across all vendors using the cf-clearance HTML path.
    //
    // Partial-name guard: `<nav-bar>` stops the name-char loop at `-` and
    // gives tagName="nav". Without checking the char AFTER the name, a
    // custom element would trigger the chrome strip; findRawTextCloseTag
    // would never find a matching `</nav>`, so cursor jumps to html.length
    // and the rest of the document is dropped. Require the next char to be
    // HTML whitespace, `>`, or `/` before treating tagName as a real chrome
    // tag (Gemini review on PR #1148).
    const nextChar = nameEnd < html.length ? html[nameEnd] : "";
    const isCompleteTagName = nameEnd >= html.length || /[\s>/]/.test(nextChar);
    if (!isClosingTag && CHROME_OR_RAWTEXT_TAGS.has(tagName) && isCompleteTagName) {
      const closeEnd = findRawTextCloseTag(html, lowerHtml, tagName, nameEnd);
      cursor = closeEnd === -1 ? html.length : closeEnd + 1;
      text += " ";
      continue;
    }

    const tagEnd = findHtmlTagEnd(html, nameEnd);
    cursor = tagEnd === -1 ? html.length : tagEnd + 1;
    text += " ";
  }

  return collapseWhitespace(text).trim();
}

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
    return htmlToPlainText(json.content || "");
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeChallengePage(html) {
  if (!html) return true;
  if (html.length < 5000) return true;
  const head = html.slice(0, 4096);
  if (/<title>\s*(Just a moment|Attention Required|Access denied|Please Wait)/i.test(head))
    return true;
  if (/cf-browser-verification|cf-challenge-running|__cf_chl_jschl_tk__/i.test(head)) return true;
  return false;
}

function firecrawlMarkdownResult(markdown) {
  return {
    type: "markdown",
    markdown: markdown ?? "",
    price: null,
    inStock: true,
    source: "firecrawl",
  };
}

function firecrawlOutOfStockResult(source = "firecrawl:jsonld-oos") {
  return {
    type: "price-result",
    markdown: "",
    price: null,
    inStock: false,
    source,
  };
}

function isStructuredPriceResult(result) {
  return result !== null && typeof result === "object" && result.type === "price-result";
}

function markdownFromScrapeResult(result) {
  if (result !== null && typeof result === "object") return result.markdown ?? "";
  return result ?? "";
}

function extractJsonLdScriptsFromHtml(html) {
  if (!html) return [];
  const scripts = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const body = match[1].trim();
    if (body) scripts.push(body);
  }
  return scripts;
}

async function scrapeViaCFClearance(url, providerId, coin) {
  log(`[cf-clearance] attempt: ${providerId} ${url}`);
  let cfData = await getCFClearanceCookie(url);
  if (!cfData) {
    warn(`[cf-clearance] sidecar unavailable for ${providerId}`);
    return null;
  }

  if (cfData.responseHtml && looksLikeChallengePage(cfData.responseHtml)) {
    warn(
      `[cf-clearance] challenge-looking HTML from Byparr for ${providerId} (len=${cfData.responseHtml.length}) — retrying once`
    );
    const retry = await getCFClearanceCookie(url);
    if (retry && retry.responseHtml && !looksLikeChallengePage(retry.responseHtml)) {
      // Merge: take retry's clean HTML but keep whichever cookie/UA is set.
      // Byparr often returns HTML without a cookie — losing a valid cookie
      // from the first attempt would silently break the Playwright fallback.
      cfData = {
        cfClearance: retry.cfClearance ?? cfData.cfClearance,
        userAgent: retry.userAgent ?? cfData.userAgent,
        responseHtml: retry.responseHtml,
      };
    } else {
      // Both attempts returned challenge HTML (or retry failed). Don't try to
      // extract prices from a challenge page — drop the HTML so we skip to the
      // Playwright fallback when a cookie is available.
      cfData = { ...cfData, responseHtml: null };
    }
  }

  // Byparr already fetched the page. Check stock status from both JSON-LD
  // availability and page text, then try JSON-LD price (authoritative).
  // For SPAs where both fail, fall through to Playwright with the cookie.
  if (cfData.responseHtml) {
    const jsonLdScripts = extractJsonLdScriptsFromHtml(cfData.responseHtml);

    // JSON-LD availability — BullionExchanges keeps JSON-LD price populated on
    // OOS pages but sets availability=OutOfStock (STRK-30).
    const availability = extractJsonLdAvailability(jsonLdScripts);
    const jsonLdOos = !!(availability && JSONLD_OOS_VALUES.has(availability));
    if (jsonLdOos) {
      log(`[cf-clearance] ${providerId}: JSON-LD availability=${availability} -> OOS`);
    }

    // Text-based OOS detection — catches visible "Out Of Stock" text even when
    // JSON-LD availability is stale/missing.
    const rawText = htmlToPlainText(cfData.responseHtml);
    const cleaned = preprocessMarkdown(rawText, providerId);
    const textStock = detectStockStatus(cleaned, coin.weight_oz || 1, providerId);
    const isInStock = !jsonLdOos && textStock.inStock;

    const jsonLdPrice = extractJsonLdPrice(
      jsonLdScripts,
      coin.metal,
      coin.weight_oz || 1,
      providerId
    );
    if (jsonLdPrice === JSONLD_ZERO_PRICE) {
      log(`[cf-clearance] ${providerId}: JSON-LD price=0 in Byparr HTML -> OOS`);
      return { price: null, inStock: false, source: "cf-clearance:jsonLd" };
    }
    if (jsonLdPrice !== null) {
      log(
        `[cf-clearance] success (html jsonLd): ${providerId} price=${jsonLdPrice} inStock=${isInStock}`
      );
      return { price: jsonLdPrice, inStock: isInStock, source: "cf-clearance:jsonLd" };
    }

    const price = extractPrice(cleaned, coin.metal, coin.weight_oz || 1, providerId);
    if (price !== null) {
      log(`[cf-clearance] success (html): ${providerId} price=${price.price}`);
      return {
        price: price.price,
        inStock: isInStock,
        source: `cf-clearance:${price.matchedBy}`,
      };
    }
    if (!isInStock) {
      log(`[cf-clearance] ${providerId}: OOS detected but no price extractable`);
      return { price: null, inStock: false, source: "cf-clearance:oos" };
    }
    warn(
      `[cf-clearance] no price from Byparr HTML for ${providerId} (len=${cfData.responseHtml.length}, jsonLd=${jsonLdScripts.length}) -- falling through to Playwright`
    );
  }

  if (!cfData.cfClearance) {
    warn(
      `[cf-clearance] ${providerId}: Byparr had no cookie and HTML yielded no price -- cannot fall back to Playwright`
    );
    return null;
  }
  let browser;
  try {
    const cfg = providerCfg(providerId);
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      userAgent: cfData.userAgent,
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });
    const urlObj = new URL(url);
    await context.addCookies([
      {
        name: "cf_clearance",
        value: cfData.cfClearance,
        domain: urlObj.hostname,
        path: "/",
        httpOnly: false,
        secure: true,
      },
    ]);
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
        (s) => s.textContent
      );
      document
        .querySelectorAll("nav, header, footer, [role='navigation'], [role='banner']")
        .forEach((el) => el.remove());
      return [document.body.innerText, scripts];
    });
    await browser.close();
    browser = null;
    const cleaned = preprocessMarkdown(text, providerId);
    const inStock = detectStockStatus(cleaned, coin.weight_oz || 1, providerId);
    // JSON-LD is authoritative — avoids related-product / spot ticker false positives.
    const jsonLdPrice = extractJsonLdPrice(
      jsonLdScripts,
      coin.metal,
      coin.weight_oz || 1,
      providerId
    );
    if (jsonLdPrice === JSONLD_ZERO_PRICE) {
      log(`[cf-clearance] ${providerId}: JSON-LD price=0 → OOS, skipping HTML extraction`);
      return { price: null, inStock: false, source: "cf-clearance" };
    }
    if (jsonLdPrice !== null) {
      log(`[cf-clearance] success via jsonLd: ${providerId} price=${jsonLdPrice}`);
      return { price: jsonLdPrice, inStock: inStock.inStock, source: "cf-clearance:jsonLd" };
    }
    const price = extractPrice(cleaned, coin.metal, coin.weight_oz || 1, providerId);
    if (price !== null) {
      log(`[cf-clearance] success (playwright): ${providerId} price=${price.price}`);
      return {
        price: price.price,
        inStock: inStock.inStock,
        source: `cf-clearance:${price.matchedBy}`,
      };
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

  const cfg = providerCfg(providerId);
  const formats = cfg.requestHtml ? ["markdown", "html"] : ["markdown"];
  const body = {
    url,
    formats,
    // JM Bullion's React pages sometimes return empty markdown with onlyMainContent.
    // Disable it for JM — our MARKDOWN_CUTOFF_PATTERNS handle noise removal instead.
    onlyMainContent: cfg.onlyMainContent,
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
        ...(FIRECRAWL_API_KEY ? { Authorization: `Bearer ${FIRECRAWL_API_KEY}` } : {}),
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
            return { type: "price-result", markdown: "", ...phase2 };
          }
          cfFailures++;
        }
        throw Object.assign(new Error(`HTTP 403 (blocked): ${text.slice(0, 200)}`), {
          skipRetry: true,
        });
      }
      // 408 = Firecrawl scrape timeout. For jmbullion, retrying won't help —
      // the page either renders in time or it doesn't. Skip retries to save ~40s.
      if (response.status === 408 && !providerCfg(providerId).retryOn408) {
        throw Object.assign(
          new Error(
            `HTTP 408 (scrape timeout, jmb/monument retry disabled): ${text.slice(0, 200)}`
          ),
          { skipRetry: true }
        );
      }
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const json = await response.json();
    const markdown = json?.data?.markdown ?? null;

    // STAK-566: When HTML is requested (e.g. herobullion), check JSON-LD
    // `availability` before returning markdown. Hero pages keep the price
    // visible on sold-out products, so the markdown-only path always extracts
    // a valid price and reports inStock=true. Mirrors the cf-clearance JSON-LD
    // OOS short-circuit pattern in scrapeViaCFClearance.
    if (cfg.requestHtml) {
      const html = json?.data?.html ?? null;
      if (html) {
        const jsonLdScripts = extractJsonLdScriptsFromHtml(html);
        const availability = extractJsonLdAvailability(jsonLdScripts);
        if (availability && JSONLD_OOS_VALUES.has(availability)) {
          log(`[firecrawl] ${providerId}: JSON-LD availability=${availability} -> OOS`);
          return firecrawlOutOfStockResult();
        }
      }
    }

    return firecrawlMarkdownResult(markdown);
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
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
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
    const response = await page.goto(url, {
      waitUntil: phase0WaitUntil,
      timeout: DIRECT_TIMEOUT_MS,
    });

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
        (s) => s.textContent
      );
      document
        .querySelectorAll("nav, header, footer, [role='navigation'], [role='banner']")
        .forEach((el) => el.remove());
      return [document.body.innerText, scripts];
    });
    const cleaned = preprocessMarkdown(text, providerId);
    const stock = detectStockStatus(cleaned, coin.weight_oz || 1, providerId);

    // JSON-LD is authoritative — check before regex fallbacks to avoid
    // grabbing spot ticker deltas or related-product prices from innerText.
    const jsonLdPrice = extractJsonLdPrice(
      jsonLdScripts,
      coin.metal,
      coin.weight_oz || 1,
      providerId
    );
    if (jsonLdPrice === JSONLD_ZERO_PRICE) {
      log(`  ${providerId}: JSON-LD price=0 → OOS, skipping HTML extraction`);
      return { price: null, inStock: false, source: "playwright-direct" };
    }
    if (jsonLdPrice !== null) {
      log(`  extractPrice ${providerId}: matched=jsonLd price=$${jsonLdPrice.toFixed(2)}`);
      return { price: jsonLdPrice, inStock: stock.inStock, source: "playwright-direct:jsonLd" };
    }

    const extracted = extractPrice(cleaned, coin.metal, coin.weight_oz || 1, providerId);
    const price = extracted ? extracted.price : null;
    if (extracted)
      log(
        `  extractPrice ${providerId}: matched=${extracted.matchedBy} price=$${extracted.price.toFixed(2)}`
      );

    if (price !== null) {
      return { price, inStock: stock.inStock, source: `playwright-direct:${extracted.matchedBy}` };
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
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
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

  // Load providers from sqld (falls back to local file if sqld is down)
  let tursoClient = null;
  try {
    tursoClient = (await import("./sqld-client.js")).createSqldClient();
  } catch {}
  const providersJson = await loadProviders(tursoClient, DATA_DIR);

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

  log(
    `Proxy config: HOME_PROXY_URL=${HOME_PROXY_URL ? "SET" : "NOT SET"}, PLAYWRIGHT_LAUNCH=${PLAYWRIGHT_LAUNCH}`
  );

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
  const db = DRY_RUN ? null : await openSqldDb();
  const scrapedAt = new Date().toISOString();
  const winStart = windowFloor();

  // STAK-496: Load spot prices + goldback baseline for price bounds guard.
  // Computed once at startup — used by safeWriteSnapshot for each target.
  const _spotByMetal = {}; // { gold: 2650.00, silver: 31.50, ... }
  let _goldbackG1 = null; // goldback.com G1 rate in USD
  if (db) {
    try {
      const spotRows = await readSpotCurrent(db);
      for (const row of spotRows) {
        if (row.metal && row.spot != null) _spotByMetal[row.metal] = Number(row.spot);
      }
      log(
        `[bounds-guard] Spot prices loaded: ${
          Object.entries(_spotByMetal)
            .map(([m, p]) => `${m}=$${p}`)
            .join(", ") || "none"
        }`
      );
    } catch (err) {
      warn(`[bounds-guard] Spot prices unavailable (non-fatal): ${err.message.slice(0, 80)}`);
    }
    try {
      const gbPath = join(DATA_DIR, "api", "goldback-spot.json");
      if (existsSync(gbPath)) {
        const gb = JSON.parse(readFileSync(gbPath, "utf-8"));
        if (gb.g1_usd > 0) _goldbackG1 = gb.g1_usd;
      }
      if (
        _goldbackG1 == null &&
        typeof _spotByMetal.gold === "number" &&
        isFinite(_spotByMetal.gold)
      ) {
        _goldbackG1 = _spotByMetal.gold * 0.003085; // fallback: gold spot × G1 weight
      }
      if (_goldbackG1) log(`[bounds-guard] Goldback G1 baseline: $${_goldbackG1.toFixed(2)}`);
    } catch (err) {
      warn(`[bounds-guard] Goldback baseline unavailable (non-fatal): ${err.message.slice(0, 80)}`);
    }
  }

  /**
   * Compute the dynamic price baseline for a given coin.
   * @param {string} coinSlug
   * @param {object} coin  { metal, weight_oz }
   * @returns {number|null}  baseline price in USD, or null if unavailable
   */
  function computeBaseline(coinSlug, coin) {
    if (coin.metal === "goldback") {
      // Goldback denominations: g0.25, G1, G5, G10, G25, G50
      if (!_goldbackG1) return null;
      const denomMatch =
        coinSlug.match(/goldback-.*?-?g(\d+(?:\.\d+)?)$/i) ||
        coinSlug.match(/goldback-g(\d+(?:\.\d+)?)/i);
      const multiplier = denomMatch ? Number(denomMatch[1]) : 1;
      return _goldbackG1 * multiplier;
    }
    const spot = _spotByMetal[coin.metal];
    if (!spot || !coin.weight_oz) return null;
    return spot * coin.weight_oz;
  }

  // Start run log entry in sqld.
  // First, mark any orphaned "running" rows from previous crashed runs as "error".
  let runId = null;
  if (db) {
    try {
      await db.execute({
        sql: `UPDATE poller_runs SET status = 'error', error = 'orphaned — process crashed or was killed'
              WHERE poller_id = ? AND status = 'running'`,
        args: [POLLER_ID],
      });
      runId = await startRunLog(db, {
        pollerId: POLLER_ID,
        startedAt: scrapedAt,
        total: targets.length,
      });
    } catch (err) {
      warn(`Run log start failed (non-fatal): ${err.message.slice(0, 80)}`);
    }
  }

  try {
    // Scrape all targets sequentially with per-request jitter
    const scrapeResults = [];
    for (let targetIdx = 0; targetIdx < targets.length; targetIdx++) {
      const { coinSlug, coin, provider, urls } = targets[targetIdx];
      log(
        `Scraping ${coinSlug}/${provider.id}${urls.length > 1 ? ` (${urls.length} URL(s))` : ""}`
      );

      // STAK-496: Per-target bounds check params
      const _baseline = computeBaseline(coinSlug, coin);
      const _skipBounds = provider.skipPriceBounds === true;

      let price = null;
      let source = "firecrawl";
      let inStock = true;
      let finalUrl = urls[0];
      const _retriedUrls = new Set();

      // ── Phase CF-First: Byparr/CF-clearance first (for cf-clearance-first vendors) ─
      // For CF-gated vendors (BEx), skip the 70s Firecrawl timeout and solve via Byparr
      // first. If Byparr fails, fall through to Phase 0/1 as safety net.
      const cfg = providerCfg(provider.id);
      if (cfg.phase === "cf-clearance-first" && CF_CLEARANCE_ENABLED_FLAG) {
        log(`  [cf-first] ${provider.id}: trying Byparr first`);
        cfAttempts++;
        const cfResult = await scrapeViaCFClearance(urls[0], provider.id, coin);
        if (cfResult != null && cfResult.price != null) {
          cfSuccess++;
          price = cfResult.price;
          source = cfResult.source;
          inStock = cfResult.inStock;
          finalUrl = urls[0];
          log(
            `  ✓ ${coinSlug}/${provider.id}: $${price.toFixed(2)} (cf-first${!inStock ? ", OOS" : ""})`
          );
          scrapeResults.push({
            coinSlug,
            coin,
            providerId: provider.id,
            url: finalUrl,
            price,
            source,
            inStock,
            ok: true,
            error: null,
          });
          if (db) {
            await safeWriteSnapshot(db, {
              scrapedAt,
              windowStart: winStart,
              coinSlug,
              vendor: provider.id,
              price,
              source,
              isFailed: false,
              inStock,
              baseline: _baseline,
              skipPriceBounds: _skipBounds,
            });
          }
          if (targetIdx < targets.length - 1) {
            await jitter();
          }
          continue;
        }
        // Byparr returned null or no price — OOS with no price is still useful
        if (cfResult != null && cfResult.price == null && !cfResult.inStock) {
          cfSuccess++;
          log(`  ✓ ${coinSlug}/${provider.id}: OOS detected (cf-first, no price)`);
          scrapeResults.push({
            coinSlug,
            coin,
            providerId: provider.id,
            url: finalUrl,
            price: null,
            source: cfResult.source,
            inStock: false,
            ok: true,
            error: null,
          });
          if (db) {
            await safeWriteSnapshot(db, {
              scrapedAt,
              windowStart: winStart,
              coinSlug,
              vendor: provider.id,
              price: null,
              source: cfResult.source,
              isFailed: false,
              inStock: false,
              baseline: _baseline,
              skipPriceBounds: _skipBounds,
            });
          }
          if (targetIdx < targets.length - 1) {
            await jitter();
          }
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
      const fcPreferredForTarget =
        FIRECRAWL_PREFERRED_PROVIDERS.has(provider.id) &&
        !(isGoldback && FIRECRAWL_TABLE_PARSE_PROVIDERS.has(provider.id));
      if (
        !PLAYWRIGHT_ONLY_PROVIDERS.has(provider.id) &&
        !fcPreferredForTarget &&
        PLAYWRIGHT_LAUNCH
      ) {
        const directResult = await scrapeWithPlaywrightDirect(urls[0], provider.id, coin);
        if (directResult !== null) {
          price = directResult.price;
          source = directResult.source;
          inStock = directResult.inStock;
          finalUrl = urls[0];
          log(
            `  ✓ ${coinSlug}/${provider.id}: $${price.toFixed(2)} (playwright-direct${!inStock ? ", OOS" : ""})`
          );
          // Skip Firecrawl — go straight to store result
          scrapeResults.push({
            coinSlug,
            coin,
            providerId: provider.id,
            url: finalUrl,
            price,
            source,
            inStock,
            ok: true,
            error: null,
          });
          if (db) {
            await safeWriteSnapshot(db, {
              scrapedAt,
              windowStart: winStart,
              coinSlug,
              vendor: provider.id,
              price,
              source,
              isFailed: false,
              inStock,
              baseline: _baseline,
              skipPriceBounds: _skipBounds,
            });
          }
          if (targetIdx < targets.length - 1) {
            await jitter();
          }
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
                const proxyStock = detectStockStatus(
                  proxyCleaned,
                  coin.weight_oz || 1,
                  provider.id
                );
                const proxyExtracted = extractPrice(
                  proxyCleaned,
                  coin.metal,
                  coin.weight_oz || 1,
                  provider.id
                );
                if (proxyExtracted) {
                  log(
                    `  extractPrice ${provider.id}: matched=${proxyExtracted.matchedBy} price=$${proxyExtracted.price.toFixed(2)} (fly-proxy)`
                  );
                  price = proxyExtracted.price;
                  source = `fly-proxy:${proxyExtracted.matchedBy}`;
                  inStock = proxyStock.inStock;
                  finalUrl = url;
                  log(
                    `  \u2713 ${coinSlug}/${provider.id}: $${price.toFixed(2)} (fly-proxy)${!inStock ? " OOS" : ""}`
                  );
                  break;
                }
                log(
                  `  \u21bb ${coinSlug}/${provider.id}: fly-proxy returned no price, falling back to firecrawl`
                );
              } catch (proxyErr) {
                warn(
                  `  \u2717 ${provider.id} fly-proxy error: ${proxyErr.message.slice(0, 80)}, falling back`
                );
              }
            }
            const scrapeResult = await scrapeUrl(url, provider.id, 1, coin);
            // Structured scrape results can carry JSON-LD OOS without markdown parsing.
            if (isStructuredPriceResult(scrapeResult)) {
              price = scrapeResult.price;
              source = scrapeResult.source;
              inStock = scrapeResult.inStock;
              finalUrl = url;
              // price may be null when cf-clearance detected OOS via JSON-LD
              // (zero-price sentinel) — guard before toFixed.
              if (price != null) {
                log(`  ✓ ${coinSlug}/${provider.id}: $${price.toFixed(2)} (${source})`);
              } else {
                log(`  ✓ ${coinSlug}/${provider.id}: OOS, no price (${source})`);
              }
              break;
            }
            markdown = markdownFromScrapeResult(scrapeResult);
            const cleaned = preprocessMarkdown(markdown, provider.id);
            const stock = detectStockStatus(cleaned, coin.weight_oz || 1, provider.id);

            if (!stock.inStock) {
              log(
                `  ⚠ ${provider.id} [url${i}]: ${stock.reason} — ${stock.detectedText || "detected"}`
              );
              // Still attempt price extraction — OOS pages often show advertised price
              const oosExtracted = extractPrice(
                cleaned,
                coin.metal,
                coin.weight_oz || 1,
                provider.id
              );
              const oosPrice = oosExtracted ? oosExtracted.price : null;
              if (oosExtracted)
                log(
                  `  extractPrice ${provider.id}: matched=${oosExtracted.matchedBy} price=$${oosExtracted.price.toFixed(2)} (OOS)`
                );
              if (oosPrice !== null) {
                price = oosPrice;
                source = `firecrawl:${oosExtracted.matchedBy}`;
                finalUrl = url;
                log(`  ✓ ${coinSlug}/${provider.id}: $${oosPrice.toFixed(2)} (firecrawl, OOS)`);
              }
              if (i < urls.length - 1 && oosPrice === null) {
                await jitter();
                continue;
              }
              // Last URL or got a price — exit loop with inStock=false
              inStock = false;
              if (!finalUrl || finalUrl !== url) finalUrl = url;
              break;
            }

            const extracted = extractPrice(cleaned, coin.metal, coin.weight_oz || 1, provider.id);
            const p = extracted ? extracted.price : null;
            if (extracted)
              log(
                `  extractPrice ${provider.id}: matched=${extracted.matchedBy} price=$${extracted.price.toFixed(2)}`
              );
            if (p !== null) {
              price = p;
              source = `firecrawl:${extracted.matchedBy}`;
              finalUrl = url;
              log(
                `  ✓ ${coinSlug}/${provider.id}: $${p.toFixed(2)} (firecrawl)${urls.length > 1 ? ` [url${i}]` : ""}`
              );
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
                // Structured scrape results can carry JSON-LD OOS without markdown parsing.
                if (isStructuredPriceResult(retryRaw)) {
                  price = retryRaw.price;
                  source = retryRaw.source;
                  inStock = retryRaw.inStock;
                  finalUrl = url;
                  if (price != null) {
                    log(`  ✓ ${coinSlug}/${provider.id}: $${price.toFixed(2)} (${source})`);
                  } else {
                    log(`  ✓ ${coinSlug}/${provider.id}: OOS, no price (${source})`);
                  }
                  break;
                }
                const retryMd = markdownFromScrapeResult(retryRaw);
                const retryCleaned = preprocessMarkdown(retryMd, provider.id);
                const retryStock = detectStockStatus(
                  retryCleaned,
                  coin.weight_oz || 1,
                  provider.id
                );
                const retryExtracted = extractPrice(
                  retryCleaned,
                  coin.metal,
                  coin.weight_oz || 1,
                  provider.id
                );
                const retryPrice = retryExtracted ? retryExtracted.price : null;
                if (retryExtracted)
                  log(
                    `  extractPrice ${provider.id}: matched=${retryExtracted.matchedBy} price=$${retryExtracted.price.toFixed(2)} (retry)`
                  );
                if (retryPrice !== null) {
                  price = retryPrice;
                  source = `firecrawl-retry:${retryExtracted.matchedBy}`;
                  inStock = retryStock.inStock;
                  finalUrl = url;
                  log(
                    `  ✓ ${coinSlug}/${provider.id}: $${retryPrice.toFixed(2)} (firecrawl-retry)${!inStock ? " OOS" : ""}`
                  );
                  break;
                }
              } catch (retryErr) {
                warn(`  ✗ ${provider.id} [url${i}] retry error: ${retryErr.message.slice(0, 100)}`);
              }
            }

            warn(
              `  ? ${coinSlug}/${provider.id} [url${i}]: page loaded, no price — trying next URL`
            );
            if (i < urls.length - 1) {
              await jitter();
              continue;
            }

            // Last URL, Firecrawl parse failure — no more fallbacks
            finalUrl = url;
          } catch (err) {
            warn(`  ✗ ${provider.id} [url${i}] firecrawl error: ${err.message.slice(0, 100)}`);
            if (i < urls.length - 1) {
              await jitter();
              continue;
            }
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
        coinSlug,
        coin,
        providerId: provider.id,
        url: finalUrl,
        price,
        source,
        inStock,
        ok: scrapeOk,
        error: price === null && inStock ? "price_not_found" : null,
      });

      // Record to sqld
      if (db) {
        await safeWriteSnapshot(db, {
          scrapedAt,
          windowStart: winStart,
          coinSlug,
          vendor: provider.id,
          price,
          source,
          isFailed: price === null && inStock, // Only failed if in stock but no price
          baseline: _baseline,
          skipPriceBounds: _skipBounds,
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

    const ok = scrapeResults.filter((r) => r.ok).length;
    const fail = scrapeResults.length - ok;

    log(
      `Done: ${ok}/${scrapeResults.length} prices captured, ${fail} failures, ${_dbWriteFailures} DB write errors, cf-clearance: ${cfAttempts} attempts ${cfSuccess} ok ${cfFailures} failed`
    );

    // Finish run log entry in sqld
    if (db && runId) {
      try {
        const errorMsg =
          ok === 0
            ? "All scrapes failed"
            : _dbWriteFailures > 0
              ? `${_dbWriteFailures} DB write(s) failed`
              : null;
        await finishRunLog(db, {
          runId,
          finishedAt: new Date().toISOString(),
          captured: ok,
          failures: fail,
          fbpFilled: 0,
          error: errorMsg,
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

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

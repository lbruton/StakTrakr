#!/usr/bin/env node
/**
 * Unit tests for STRK-144 — Summit Metals false-OOS + bulk-price-tier fixes.
 *
 * As of STRK-32/STRK-160 both fixes are owned by the Summit Vendor module,
 * devops/pollers/shared/price-extract-vendor-summit.js (cutoffPatterns +
 * extractPrice), resolved at runtime through the shared parser via the Vendor
 * registry. The two bugs the fix prevents:
 *   1. Every Summit product page embeds a static FAQ whose answer text contains
 *      the literal "...or marked as 'Out of stock.'". That trips
 *      OUT_OF_STOCK_PATTERNS in detectStockStatus(), false-flagging EVERY Summit
 *      item OOS. Fix: the Summit module's cutoffPatterns trim the
 *      description/reviews/FAQ tail before stock + price detection.
 *   2. The summit extractPrice strategy used to read the "Regular price" mini-cards,
 *      which carry the 100+ BULK price ($77.78) instead of the 1-9 single-unit
 *      price ($79.22). Fix: prefer firstTableRowFirstPrice() / tierAnchoredPrice()
 *      (first qty tier) before falling back to the "Regular price" cards.
 *   3. THE ACTUAL PRODUCTION CAUSE: Summit's Shopify JSON-LD advertises
 *      offer.price = the 100+ BULK tier (e.g. $71.97). The poller treats JSON-LD as
 *      authoritative and checks it BEFORE extractMarkdownPrice, so the bulk price
 *      short-circuits and the table-first strategy (#2) never runs. Fix: the Summit
 *      module sets untrustedOfferPrice:true so extractJsonLdPrice() skips the
 *      offer.price and the poller falls through to the qty-tier table extraction.
 *   4. STRK-251: Summit's related-products carousel renders BETWEEN the buy box
 *      and the cutoff anchors ("What Our Clients" / "Faq's"), so cutoffPatterns
 *      cannot trim it. When any carousel product sells out, its literal "Sold out"
 *      badge appears on EVERY Summit product page and trips /sold out/i in
 *      detectStockStatus — false-flagging the whole vendor OOS while price
 *      extraction (anchored to the qty-tier table above the carousel) keeps
 *      working. Fix: the Summit module declares positiveStockPatterns
 *      (buy-box "In Stock, Ready to Ship"); when a positive marker matches,
 *      detectStockStatus skips the negative OOS patterns for that page. The
 *      marker is absent on genuinely sold-out Summit pages (their buy box says
 *      "Out of Stock"), so real OOS still falls through to negative detection.
 *
 * The shared helpers are importable, so this test exercises the real parser and
 * OOS helpers end-to-end (registry → Summit module → shared toolkit). A
 * structural assertion at the end guards the module config against silent
 * removal AND that it no longer lives in the shared file.
 *
 * Run with:
 *   node devops/pollers/shared/price-extract-summit-oos.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  detectStockStatus,
  extractJsonLdPrice,
  extractMarkdownPrice,
  preprocessMarkdown,
} from "./price-extract-shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Regression helper for the old Summit bulk-price bug --------------------

// inRange for 1 oz silver (METAL_PRICE_RANGE_PER_OZ.silver = {min:40,max:200}).
function inRange(p) {
  return p >= 40 && p <= 200;
}

function regularPricePrices(markdown) {
  const prices = [];
  let m;
  const pat = /(?:Regular|Sale)\s+price\s+\$?([\d,]+\.\d{2})/g;
  while ((m = pat.exec(markdown)) !== null) {
    const p = parseFloat(m[1].replace(/,/g, ""));
    if (inRange(p)) prices.push(p);
  }
  return prices;
}

// --- Fixtures (faithful to the real Summit ASE page ordering) ---------------

// Firecrawl path: pipe table preserved.
const SUMMIT_PIPE = `Live Spot Prices:
Ag $75.46

1 oz American Silver Eagle BU (Random Year)
===========================================

$79.22

| Quantity | Check / Wire / Zelle | CC / PayPal / Crypto |
| --- | --- | --- |
| 1-9 | $79.22 | $82.55 |
| 10-19 | $78.83 | $82.14 |
| 100+ | $77.78 | $81.05 |

In Stock, Ready to Ship

### Top Off to FedEx Shipping

Regular price $77.78
Regular price ~$0.00~Sale price $77.78
 Add to cart

Description Shipping & Returns

### Description

Some product copy here.

What Our ClientsSay
-------------------

Faq's
-----

Is the product I'm looking for in stock and available?
------------------------------------------------------

The status will be clearly displayed, indicating whether the item is in stock,
showing the exact quantity, or marked as "Out of stock." This ensures you're
always informed.
`;

// phase0 Playwright innerText path: pipe table flattened to prose.
const SUMMIT_PROSE = `Live Spot Prices: Ag $75.46

1 oz American Silver Eagle BU (Random Year)

$79.22

Quantity Check / Wire / Zelle CC / PayPal / Crypto
1-9 $79.22 $82.55
10-19 $78.83 $82.14
100+ $77.78 $81.05

In Stock, Ready to Ship

Regular price $77.78 Sale price $77.78 Add to cart

Description Shipping & Returns

What Our ClientsSay

Faq's

Is the product I'm looking for in stock and available? The status will be
clearly displayed, indicating whether the item is in stock, showing the exact
quantity, or marked as "Out of stock." This ensures you're always informed.
`;

// STRK-251 fixtures — faithful to the live Summit page ordering (2026-07-01):
// buy box → express-shipping bar → related-products carousel (with a sold-out
// Platinum Eagle card) → "What Our Clients" → "Faq's". The carousel sits BEFORE
// every cutoff anchor, so preprocessMarkdown cannot trim its "Sold out" badge.

// Firecrawl path: pipe table preserved.
const SUMMIT_PIPE_CAROUSEL = `Live Spot Prices:
Ag $75.46

1 oz American Silver Eagle BU (Random Year)
===========================================

$65.81

| Quantity | Check / Wire / Zelle | CC / PayPal / Crypto |
| --- | --- | --- |
| 1-9 | $65.81 | $68.57 |
| 10-19 | $65.48 | $68.23 |
| 100+ | $64.61 | $67.32 |

In Stock, Ready to Ship

$2,000.00 away from Express Shipping

### Top Off to FedEx Shipping

1 oz American Gold Buffalo BU (Random Year)
27 total reviews
Regular price $4,256.36
Sale price $4,256.36
Add to cart

1 oz American Gold Eagle BU (Random Year)
32 total reviews
Regular price $4,121.91
Sale price $4,121.91
Add to cart

Sold out
1 oz American Platinum Eagle BU (Random Year)
0 total reviews
Regular price $1,838.49

What Our ClientsSay
-------------------

Faq's
-----

The status will be clearly displayed, indicating whether the item is in stock,
showing the exact quantity, or marked as "Out of stock."
`;

// phase0 Playwright innerText path: pipe table flattened to prose.
const SUMMIT_PROSE_CAROUSEL = `Live Spot Prices: Ag $75.46

1 oz American Silver Eagle BU (Random Year)

$65.81

Quantity Check / Wire / Zelle CC / PayPal / Crypto
1-9 $65.81 $68.57
10-19 $65.48 $68.23
100+ $64.61 $67.32

In Stock, Ready to Ship

$2,000.00 away from Express Shipping
Top Off to FedEx Shipping

1 oz American Gold Eagle BU (Random Year) Regular price $4,121.91 Add to cart
Sold out 1 oz American Platinum Eagle BU (Random Year) Regular price $1,838.49

What Our ClientsSay

Faq's

The status will be clearly displayed, indicating whether the item is in stock,
showing the exact quantity, or marked as "Out of stock."
`;

// Genuinely sold-out Summit page (live APE page, 2026-07-01): the buy box shows
// "Out of Stock" and the "In Stock, Ready to Ship" marker is entirely absent.
const SUMMIT_PROSE_REAL_OOS = `Live Spot Prices: Ag $75.46

1 oz American Platinum Eagle BU (Random Year)

Out of Stock

Quantity Check / Wire / Zelle CC / PayPal / Crypto
1-9 $1,838.49 $1,915.71
10-19 $1,833.02 $1,910.01

Sold out 1 oz American Platinum Eagle BU (Random Year)

What Our ClientsSay

Faq's
`;

// --- Tests ------------------------------------------------------------------

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("BUG REPRO: raw page (FAQ included) false-flags OOS without the layered fixes", () => {
  // Documents the bug mechanism: the FAQ "Out of stock" trips detection for any
  // vendor without Summit's defenses (cutoffPatterns + positiveStockPatterns).
  assert.equal(detectStockStatus(SUMMIT_PIPE, 1, "apmex").inStock, false);
  assert.equal(detectStockStatus(SUMMIT_PROSE, 1, "apmex").inStock, false);
  // Since STRK-251 the Summit positive buy-box marker rescues even the RAW page
  // (defense in depth on top of the cutoff trim).
  assert.equal(detectStockStatus(SUMMIT_PIPE, 1, "summitmetals").inStock, true);
});

test("cutoff removes the FAQ tail → not OOS (pipe path)", () => {
  const cleaned = preprocessMarkdown(SUMMIT_PIPE, "summitmetals");
  assert.equal(/out of stock/i.test(cleaned), false);
  assert.equal(detectStockStatus(cleaned, 1, "summitmetals").inStock, true);
});

test("cutoff removes the FAQ tail → not OOS (prose path)", () => {
  const cleaned = preprocessMarkdown(SUMMIT_PROSE, "summitmetals");
  assert.equal(/out of stock/i.test(cleaned), false);
  assert.equal(detectStockStatus(cleaned, 1, "summitmetals").inStock, true);
});

test("cutoff preserves the in-stock badge and price table", () => {
  const cleaned = preprocessMarkdown(SUMMIT_PIPE, "summitmetals");
  assert.match(cleaned, /In Stock, Ready to Ship/);
  assert.match(cleaned, /1-9/);
});

test("price = 1-9 single-unit Check/Wire ($79.22), not 100+ bulk (pipe path)", () => {
  const cleaned = preprocessMarkdown(SUMMIT_PIPE, "summitmetals");
  const result = extractMarkdownPrice(cleaned, "silver", 1, "summitmetals");
  assert.equal(result.price, 79.22);
  assert.equal(result.matchedBy, "tableFirstRow");
});

test("price = 1-9 single-unit Check/Wire ($79.22), not 100+ bulk (prose path)", () => {
  const cleaned = preprocessMarkdown(SUMMIT_PROSE, "summitmetals");
  const result = extractMarkdownPrice(cleaned, "silver", 1, "summitmetals");
  assert.equal(result.price, 79.22);
  assert.equal(result.matchedBy, "tierAnchored");
});

test("old behavior would have returned the bulk $77.78 (regression guard)", () => {
  // The pre-fix summit branch read regularPricePrices() first → Math.min → 77.78.
  const cleaned = preprocessMarkdown(SUMMIT_PIPE, "summitmetals");
  const bulk = Math.min(...regularPricePrices(cleaned));
  assert.equal(bulk, 77.78);
  // The fix must NOT return that value.
  assert.notEqual(extractMarkdownPrice(cleaned, "silver", 1, "summitmetals").price, bulk);
});

test("THE PRODUCTION FIX: Summit's bulk JSON-LD offer.price is skipped (untrusted)", () => {
  // Faithful to Summit's real Shopify JSON-LD: a flat offer.price = the 100+ bulk
  // tier ($71.97), InStock — no priceSpecification for the 1-9 wire price.
  const summitJsonLd = [
    JSON.stringify({
      "@type": "Product",
      offers: { price: "71.97", availability: "http://schema.org/InStock" },
    }),
  ];
  // Summit (untrustedOfferPrice:true) → the bulk offer.price is skipped → null,
  // so the poller falls through to the qty-tier markdown extraction ($73.30 live).
  assert.equal(extractJsonLdPrice(summitJsonLd, "silver", 1, "summitmetals"), null);
  // Control: a vendor that trusts offer.price WOULD return the bulk number — proving
  // the untrusted flag is exactly what prevents the short-circuit for Summit.
  assert.equal(extractJsonLdPrice(summitJsonLd, "silver", 1, "apmex"), 71.97);
});

test("STRUCTURAL: Summit cutoff + table-first strategy live in the Vendor module", () => {
  const moduleSrc = readFileSync(join(__dirname, "price-extract-vendor-summit.js"), "utf8");
  // Cutoff config present in the module.
  assert.match(moduleSrc, /cutoffPatterns:\s*\[/, "summit module cutoffPatterns missing");
  assert.match(moduleSrc, /Description Shipping & Returns/, "summit cutoff anchor missing");
  // extractPrice prefers qty-tier extractors over the bulk "Regular price" cards.
  const startIdx = moduleSrc.indexOf("extractPrice(");
  assert.notEqual(startIdx, -1, "summit extractPrice strategy not found in module");
  const strategy = moduleSrc.slice(startIdx);
  const tblIdx = strategy.indexOf("firstTableRowFirstPrice()");
  const tierIdx = strategy.indexOf("tierAnchoredPrice()");
  const regIdx = strategy.indexOf("regularPricePrices()");
  assert.ok(
    tblIdx !== -1 && tierIdx !== -1 && regIdx !== -1,
    "expected all three extractors in summit extractPrice",
  );
  assert.ok(
    tblIdx < regIdx && tierIdx < regIdx,
    "qty-tier extractors must precede the bulk regularPricePrices fallback",
  );
});

test("STRUCTURAL: shared.js no longer owns Summit-specific data (isolation guarantee)", () => {
  const sharedSrc = readFileSync(join(__dirname, "price-extract-shared.js"), "utf8");
  assert.equal(
    sharedSrc.includes("Description Shipping & Returns"),
    false,
    "summit cutoff anchor must not live in shared.js — it belongs to the Vendor module",
  );
  assert.equal(
    sharedSrc.includes('providerId === "summitmetals"'),
    false,
    "summit price branch must not live in shared.js — it belongs to the Vendor module",
  );
});

// --- STRK-251: carousel "Sold out" badge must not false-flag the page OOS ----

test("STRK-251 AC1: carousel 'Sold out' + in-stock buy box → inStock true (pipe path)", () => {
  const cleaned = preprocessMarkdown(SUMMIT_PIPE_CAROUSEL, "summitmetals");
  // The carousel badge survives the cutoff (it sits before every anchor)...
  assert.match(cleaned, /Sold out/i);
  // ...but the buy-box positive marker must win.
  const status = detectStockStatus(cleaned, 1, "summitmetals");
  assert.equal(status.inStock, true);
  assert.equal(status.reason, "positive_stock");
});

test("STRK-251 AC1: carousel 'Sold out' + in-stock buy box → inStock true (prose path)", () => {
  const cleaned = preprocessMarkdown(SUMMIT_PROSE_CAROUSEL, "summitmetals");
  assert.match(cleaned, /Sold out/i);
  assert.equal(detectStockStatus(cleaned, 1, "summitmetals").inStock, true);
});

test("STRK-251 AC1: price extraction unaffected by the carousel (pipe path)", () => {
  const cleaned = preprocessMarkdown(SUMMIT_PIPE_CAROUSEL, "summitmetals");
  const result = extractMarkdownPrice(cleaned, "silver", 1, "summitmetals");
  assert.equal(result.price, 65.81);
});

test("STRK-251 AC2: genuinely OOS page (no positive marker) → inStock false", () => {
  const cleaned = preprocessMarkdown(SUMMIT_PROSE_REAL_OOS, "summitmetals");
  const status = detectStockStatus(cleaned, 1, "summitmetals");
  assert.equal(status.inStock, false);
  assert.equal(status.reason, "out_of_stock");
});

test("STRK-251 AC3: vendors without positiveStockPatterns are unchanged", () => {
  // A page carrying both an in-stock-looking phrase and a "Sold out" badge must
  // still be OOS for a vendor that declares no positive patterns.
  const md = "In Stock, Ready to Ship\n\nSold out\n";
  assert.equal(detectStockStatus(md, 1, "apmex").inStock, false);
  assert.equal(detectStockStatus(md, 1, "jmbullion").inStock, false);
});

test("STRK-251 AC4: fractional wrong-product guard still fires with positive marker", () => {
  const md = `# 1/2 oz American Gold Eagle BU\n\n$2,150.00\n\nIn Stock, Ready to Ship\n`;
  const status = detectStockStatus(md, 1, "summitmetals");
  assert.equal(status.inStock, false);
  assert.equal(status.reason, "fractional_weight");
});

test("STRK-251 STRUCTURAL: Summit module declares positiveStockPatterns", () => {
  const moduleSrc = readFileSync(join(__dirname, "price-extract-vendor-summit.js"), "utf8");
  assert.match(moduleSrc, /positiveStockPatterns:\s*\[/, "summit positiveStockPatterns missing");
  assert.match(moduleSrc, /In Stock, Ready to Ship/, "summit positive buy-box marker missing");
});

let passed = 0;
let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

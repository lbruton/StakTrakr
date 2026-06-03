#!/usr/bin/env node
/**
 * Unit tests for STRK-144 — Summit Metals false-OOS + bulk-price-tier fixes.
 *
 * Two bugs, both in devops/pollers/shared/price-extract.js:
 *   1. Every Summit product page embeds a static FAQ whose answer text contains
 *      the literal "...or marked as 'Out of stock.'". That trips
 *      OUT_OF_STOCK_PATTERNS in detectStockStatus(), false-flagging EVERY Summit
 *      item OOS. Fix: a MARKDOWN_CUTOFF_PATTERNS.summitmetals entry trims the
 *      description/reviews/FAQ tail before stock + price detection.
 *   2. The summit branch of extractPrice() read the "Regular price" mini-cards,
 *      which carry the 100+ BULK price ($77.78) instead of the 1-9 single-unit
 *      price ($79.22). Fix: prefer firstTableRowFirstPrice() / tierAnchoredPrice()
 *      (first qty tier) before falling back to the "Regular price" cards.
 *
 * price-extract.js auto-runs main() on import and exports nothing, so — per the
 * convention of the sibling price-extract-*.test.mjs files — this test inlines a
 * replica of the relevant logic. Keep the replica in sync with the source when
 * the regexes change. A structural assertion at the end guards the real config
 * against silent removal.
 *
 * Run with:
 *   node devops/pollers/shared/price-extract-summit-oos.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Replica of source logic (keep in sync with price-extract.js) -----------

const OUT_OF_STOCK_PATTERNS = [
  /out of stock/i,
  /sold out/i,
  /currently unavailable/i,
  /notify me when available/i,
  /email when in stock/i,
  /temporarily out of stock/i,
  /back ?order/i,
  /pre-?order/i,
  /^\s*unavailable\s*$/im,
];

const MARKDOWN_CUTOFF_PATTERNS = {
  summitmetals: [
    /^\s*Description Shipping & Returns\s*$/im,
    /^#{0,6}\s*What Our Clients/im,
    /^#{0,6}\s*Faq'?s\s*$/im,
  ],
};

function applyCutoff(markdown, providerId) {
  const patterns = MARKDOWN_CUTOFF_PATTERNS[providerId];
  if (!patterns) return markdown;
  let cutIndex = markdown.length;
  for (const pattern of patterns) {
    const match = markdown.search(pattern);
    if (match !== -1 && match < cutIndex) cutIndex = match;
  }
  return markdown.slice(0, cutIndex);
}

function isOutOfStock(markdown) {
  return OUT_OF_STOCK_PATTERNS.some((p) => p.test(markdown));
}

// inRange for 1 oz silver (METAL_PRICE_RANGE_PER_OZ.silver = {min:40,max:200}).
function inRange(p) {
  return p >= 40 && p <= 200;
}

function firstTableRowFirstPrice(markdown) {
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    if (/^\|\s*[-:]+/.test(line)) continue;
    const prices = [];
    for (const m of line.matchAll(/\|\s*\*{0,2}\$?([\d,]+\.\d{2})\*{0,2}\s*(?:\|)/g)) {
      const p = parseFloat(m[1].replace(/,/g, ""));
      if (inRange(p)) prices.push(p);
    }
    if (prices.length > 0) return prices[0];
  }
  return null;
}

function tierAnchoredPrice(markdown) {
  const pattern = /\b(?:\d{1,3}\s*-\s*\d{1,5}|\d{1,3}\+)\s+\$\s*([\d,]+\.\d{2})/g;
  for (const m of markdown.matchAll(pattern)) {
    const p = parseFloat(m[1].replace(/,/g, ""));
    if (inRange(p)) return p;
  }
  return null;
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

function summitPrice(markdown) {
  const tblFirst = firstTableRowFirstPrice(markdown);
  if (tblFirst !== null) return { price: tblFirst, matchedBy: "tableFirstRow" };
  const tier = tierAnchoredPrice(markdown);
  if (tier !== null) return { price: tier, matchedBy: "tierAnchored" };
  const reg = regularPricePrices(markdown);
  if (reg.length > 0) return { price: Math.min(...reg), matchedBy: "regularPrice" };
  return null;
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

// --- Tests ------------------------------------------------------------------

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("BUG REPRO: raw page (FAQ included) false-flags OOS", () => {
  // Documents the bug: without the cutoff, the FAQ "Out of stock" trips detection.
  assert.equal(isOutOfStock(SUMMIT_PIPE), true);
  assert.equal(isOutOfStock(SUMMIT_PROSE), true);
});

test("cutoff removes the FAQ tail → not OOS (pipe path)", () => {
  const cleaned = applyCutoff(SUMMIT_PIPE, "summitmetals");
  assert.equal(/out of stock/i.test(cleaned), false);
  assert.equal(isOutOfStock(cleaned), false);
});

test("cutoff removes the FAQ tail → not OOS (prose path)", () => {
  const cleaned = applyCutoff(SUMMIT_PROSE, "summitmetals");
  assert.equal(/out of stock/i.test(cleaned), false);
  assert.equal(isOutOfStock(cleaned), false);
});

test("cutoff preserves the in-stock badge and price table", () => {
  const cleaned = applyCutoff(SUMMIT_PIPE, "summitmetals");
  assert.match(cleaned, /In Stock, Ready to Ship/);
  assert.match(cleaned, /1-9/);
});

test("price = 1-9 single-unit Check/Wire ($79.22), not 100+ bulk (pipe path)", () => {
  const cleaned = applyCutoff(SUMMIT_PIPE, "summitmetals");
  const result = summitPrice(cleaned);
  assert.equal(result.price, 79.22);
  assert.equal(result.matchedBy, "tableFirstRow");
});

test("price = 1-9 single-unit Check/Wire ($79.22), not 100+ bulk (prose path)", () => {
  const cleaned = applyCutoff(SUMMIT_PROSE, "summitmetals");
  const result = summitPrice(cleaned);
  assert.equal(result.price, 79.22);
  assert.equal(result.matchedBy, "tierAnchored");
});

test("old behavior would have returned the bulk $77.78 (regression guard)", () => {
  // The pre-fix summit branch read regularPricePrices() first → Math.min → 77.78.
  const cleaned = applyCutoff(SUMMIT_PIPE, "summitmetals");
  const bulk = Math.min(...regularPricePrices(cleaned));
  assert.equal(bulk, 77.78);
  // The fix must NOT return that value.
  assert.notEqual(summitPrice(cleaned).price, bulk);
});

test("STRUCTURAL: real source has summitmetals cutoff + table-first extraction", () => {
  const src = readFileSync(join(__dirname, "price-extract.js"), "utf8");
  // Cutoff config present.
  assert.match(src, /summitmetals:\s*\[/, "MARKDOWN_CUTOFF_PATTERNS.summitmetals missing");
  assert.match(src, /Description Shipping & Returns/, "summit cutoff anchor missing");
  // Summit price branch prefers qty-tier extractors over the bulk cards.
  const startIdx = src.indexOf('if (providerId === "summitmetals")');
  assert.notEqual(startIdx, -1, "summit branch not found in source");
  const branch = src.slice(startIdx);
  const tblIdx = branch.indexOf("firstTableRowFirstPrice()");
  const tierIdx = branch.indexOf("tierAnchoredPrice()");
  const regIdx = branch.indexOf("regularPricePrices()");
  assert.ok(tblIdx !== -1 && tierIdx !== -1 && regIdx !== -1, "expected all three extractors in summit branch");
  assert.ok(tblIdx < regIdx && tierIdx < regIdx, "qty-tier extractors must precede the bulk regularPricePrices fallback");
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

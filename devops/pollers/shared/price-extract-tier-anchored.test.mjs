#!/usr/bin/env node
/**
 * Fixture tests for tier-anchored prose extractor — STRK-99 hotfix v3.34.83.
 *
 * For UNTRUSTED_OFFER_PRICE_VENDORS (sdbullion + bullionexchanges), the
 * extractor must:
 *   - Return the wire price from the first qty-tier row when present
 *   - Skip spot tickers, sidebar "As low as" entries, and related products
 *   - Handle single-tier ("1+") rows for products without quantity breaks
 *   - Return null when no qty-tier pattern is present (page is OOS or
 *     hasn't hydrated) — caller treats that as a missed scrape, NOT as
 *     a spot-price write
 *
 * Run:  node devops/pollers/shared/price-extract-tier-anchored.test.mjs
 */

// Inline the helper — keep in sync with price-extract.js.
// Wrap in a closure that mirrors extractPrice()'s inRange() guard.
function makeExtractor(metal, weightOz = 1) {
  const RANGE = {
    silver: [40, 200],
    gold: [1500, 15000],
    platinum: [500, 6000],
    palladium: [300, 6000],
  };
  const [min, max] = RANGE[metal];
  const rangeMin = min * weightOz;
  const rangeMax = max * weightOz;
  const inRange = (p) => !isNaN(p) && p >= rangeMin && p <= rangeMax;

  return function tierAnchoredPrice(markdown) {
    const pattern = /\b(?:\d{1,3}\s*-\s*\d{1,5}|\d{1,3}\+)\s+\$\s*([\d,]+\.\d{2})/g;
    for (const m of markdown.matchAll(pattern)) {
      const p = parseFloat(m[1].replace(/,/g, ""));
      if (inRange(p)) return p;
    }
    return null;
  };
}

let pass = 0;
let fail = 0;
function assert(label, actual, expected) {
  if (actual === expected) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.log(`  FAIL  ${label}`);
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual:   ${JSON.stringify(actual)}`);
    fail++;
  }
}

const tierSilver = makeExtractor("silver");
const tierGold = makeExtractor("gold");

// ---------------------------------------------------------------------------
// Bullion Exchanges live shape — multi-tier silver maple
// ---------------------------------------------------------------------------

const beSilverProse =
  "The prices below represent the item's full list price. " +
  "1-24 $77.82 $78.61 $80.93 " +
  "25-99 $77.62 $78.40 $80.72 " +
  "100-499 $77.42 $78.20 $80.52 " +
  "500+ $77.22 $78.00 $80.31 " +
  "Quantity: - +";

assert(
  "1. BE silver maple multi-tier prose → first wire price ($77.82)",
  tierSilver(beSilverProse),
  77.82
);

// ---------------------------------------------------------------------------
// SDB live shape — qty range uses spaces around dash ("1 - 49")
// This is the regression caught in the v3.34.83 in-container test: the
// initial regex required "1-49" with no spaces and silently skipped to
// the next match ("50+ $78.23" — the bulk tier). The single-unit price
// is $79.23 and we MUST land on it.
// ---------------------------------------------------------------------------

const sdbSilverProse =
  "Quantity Qty Check / Wire Bitcoin Card / PayPal " +
  "1 - 49 $79.23 $80.03 $82.53 " +
  "50+ $78.23 $79.02 $81.49 " +
  "Quantity";

assert(
  "1a. SDB silver maple with '1 - 49' (spaces) → single-unit wire ($79.23, NOT bulk $78.23)",
  tierSilver(sdbSilverProse),
  79.23
);

// ---------------------------------------------------------------------------
// Single-tier table (no qty break — "1+" form)
// ---------------------------------------------------------------------------

const sdbSingleTier = "1+ $89.23";
assert("2. single-tier '1+' form → wire price ($89.23)", tierSilver(sdbSingleTier), 89.23);

const sdbSingleTierBigger = "Some prose 1+ $4,580.63 more prose";
assert(
  "3. single-tier '1+' gold ($4,580.63) — comma thousands handled",
  tierGold(sdbSingleTierBigger),
  4580.63
);

// ---------------------------------------------------------------------------
// Spot ticker MUST be ignored (no qty-tier marker precedes it)
// ---------------------------------------------------------------------------

const onlySpotTicker = "Gold $4,520.00 Silver $75.92 Platinum $1,933.40";
assert("4. spot ticker only → null (no qty-tier prefix)", tierSilver(onlySpotTicker), null);
assert("5. spot ticker only (gold range) → null", tierGold(onlySpotTicker), null);

// ---------------------------------------------------------------------------
// Related-product sidebar ("As low as: $X") MUST be ignored
// ---------------------------------------------------------------------------

const sidebarOnly =
  "American Eagle $50 Coin BU (Random Year) As low as: $4,566.00 Buy Now " +
  "1 oz Generic Silver Bar .999 Fine As low as: $76.72 Buy Now";
assert("6. related-product sidebar only → null (no qty-tier marker)", tierGold(sidebarOnly), null);
assert("7. silver sidebar variant → null", tierSilver(sidebarOnly), null);

// ---------------------------------------------------------------------------
// Realistic combined: spot ticker survived chrome strip + then real grid
// ---------------------------------------------------------------------------

const combined =
  "Gold $4,520.00 Silver $75.92 " + // ticker leaked (shouldn't but defensive)
  "1 oz Silver Canadian Maple Leaf BU (Random Year) " +
  "1-24 $77.82 $78.61 $80.93 " +
  "500+ $77.22 $78.00 $80.31";

assert("8. spot ticker + real grid → real grid wins ($77.82)", tierSilver(combined), 77.82);

// ---------------------------------------------------------------------------
// OOS page (sidebar exists but no tier table) — must return null
// ---------------------------------------------------------------------------

const oosPage =
  "1 oz Silver Canadian Maple Leaf Currently Out of Stock " +
  "Notify Me When Available " +
  "Related: 1 oz Silver Eagle As low as: $92.25 Buy Now";

assert("9. OOS page with sidebar prices but no tier table → null", tierSilver(oosPage), null);

// ---------------------------------------------------------------------------
// Defensive: qty-tier matches must respect the metal range
// ---------------------------------------------------------------------------

assert(
  "10. tier matches with out-of-range price → null",
  tierGold("1-24 $77.82 $78.61"), // silver-range price in gold context
  null
);

assert(
  "11. first in-range tier price wins (skip out-of-range)",
  tierSilver("1-24 $5.00 25-99 $77.82"), // $5 below silver min ($40)
  77.82
);

// ---------------------------------------------------------------------------
// Defensive: leading-digit non-tier patterns should NOT match
// ---------------------------------------------------------------------------

assert(
  "12. 'Year 2024 $77.82' → null ('2024' is not a tier range)",
  tierSilver("Year 2024 $77.82"),
  null
);

assert(
  "12a. year range '2024 - 2025 $99.00' → null (4-digit low excludes year)",
  tierSilver("Minted 2024 - 2025 $99.00"),
  null
);

assert(
  "12b. year range '1988 - 2024 $99.00' → null",
  tierSilver("Released 1988 - 2024 $99.00"),
  null
);

assert(
  "13. '1 oz $77.82' → null ('1' alone with no -X or + suffix is not a tier)",
  tierSilver("1 oz $77.82"),
  null
);

assert("14. '$77.82 1-24' → null (price BEFORE tier, not after)", tierSilver("$77.82 1-24"), null);

// ---------------------------------------------------------------------------
// Multi-row table preserves first-row wire (the 1-unit price)
// ---------------------------------------------------------------------------

assert(
  "15. multi-row with first = bulk (descending) → still picks first match",
  tierSilver("500+ $77.22 $78.00 100-499 $77.42 $78.20 25-99 $77.62 $78.40 1-24 $77.82 $78.61"),
  77.22 // first match wins — vendors normally render ascending qty
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

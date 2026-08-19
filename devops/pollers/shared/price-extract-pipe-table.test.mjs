#!/usr/bin/env node
/**
 * Fixture tests for jmPriceFromPipeTable() — run with:
 *   node devops/pollers/shared/price-extract-pipe-table.test.mjs
 *
 * Covers the 5 original cases + 3 new hardening cases added in PR #1015:
 *   F1 — CRLF line endings + leading whitespace
 *   F2 — Single-cell note row containing "(e)Check/Wire" before real header
 *   F3 — Real table followed by unrelated trailing table
 */

// ---------------------------------------------------------------------------
// Inline the isolated function under test.
// extractPrice() is not exported from price-extract.js, so we duplicate the
// closure here. Keep this in sync with the implementation.
// ---------------------------------------------------------------------------

const GOLD_RANGE = { min: 1000, max: 200_000 };

function makeJmPriceFromPipeTable(markdown, range) {
  function inRange(p) {
    return p >= range.min && p <= range.max;
  }

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

function run(markdown) {
  return makeJmPriceFromPipeTable(markdown, GOLD_RANGE);
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let pass = 0;
let fail = 0;

function assert(label, actual, expected) {
  if (actual === expected) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.error(`  FAIL  ${label}`);
    console.error(`        expected: ${expected}`);
    console.error(`        actual:   ${actual}`);
    fail++;
  }
}

// ---------------------------------------------------------------------------
// Original fixtures (5)
// ---------------------------------------------------------------------------

console.log("\n--- Original fixtures ---");

// 1. Standard pipe table: wire column is col 2 (index)
assert(
  "standard pipe table",
  run(
    `| Qty | (e)Check/Wire | Crypto | Card |\n` +
      `| --- | --- | --- | --- |\n` +
      `| 1-9 | $1,950.00 | $1,960.00 | $1,975.00 |\n` +
      `| 10+ | $1,940.00 | $1,950.00 | $1,965.00 |\n`
  ),
  1950.0
);

// 2. Reordered columns: wire in col 3 (Qty | Crypto | (e)Check/Wire | Card)
assert(
  "reordered columns — wire in col 3",
  run(
    `| Qty | Crypto | (e)Check/Wire | Card |\n` +
      `| --- | --- | --- | --- |\n` +
      `| 1-9 | $1,960.00 | $1,950.00 | $1,975.00 |\n`
  ),
  1950.0
);

// 3. No wire header — expect null
assert(
  "no wire header → null",
  run(`| Qty | Crypto | Card |\n` + `| --- | --- | --- |\n` + `| 1-9 | $1,960.00 | $1,975.00 |\n`),
  null
);

// 4. "Check / Wire" no-paren variant
assert(
  "Check / Wire no-paren variant",
  run(
    `| Qty | Check / Wire | Crypto | Card |\n` +
      `| --- | --- | --- | --- |\n` +
      `| 1-9 | $2,050.00 | $2,060.00 | $2,080.00 |\n`
  ),
  2050.0
);

// 5. Shipping-price noise before real table — only in-range price should match
assert(
  "shipping-price noise before real table",
  run(
    `Shipping: $9.95 standard\n\n` +
      `| Qty | (e)Check/Wire | Crypto | Card |\n` +
      `| --- | --- | --- | --- |\n` +
      `| 1-9 | $1,980.00 | $1,990.00 | $2,005.00 |\n`
  ),
  1980.0
);

// ---------------------------------------------------------------------------
// New hardening fixtures (3)
// ---------------------------------------------------------------------------

console.log("\n--- New hardening fixtures (F1/F2/F3) ---");

// 6. F1 — CRLF line endings + leading whitespace on each line
assert(
  "F1: CRLF endings + leading whitespace",
  run(
    "  | Qty | (e)Check/Wire | Crypto | Card |\r\n" +
      "  | --- | --- | --- | --- |\r\n" +
      "  | 1-9 | $1,955.00 | $1,965.00 | $1,980.00 |\r\n"
  ),
  1955.0
);

// 7. F2 — Single-cell note row containing "(e)Check/Wire" before the real header
assert(
  "F2: note row false-positive before real header",
  run(
    `| See (e)Check/Wire pricing below |\n` +
      `\n` +
      `Some prose about payment methods.\n` +
      `\n` +
      `| Qty | (e)Check/Wire | Crypto | Card |\n` +
      `| --- | --- | --- | --- |\n` +
      `| 1-9 | $1,945.00 | $1,955.00 | $1,970.00 |\n`
  ),
  1945.0
);

// 8. F3 — Real table followed by an unrelated trailing table with a wire-column-index
//    match that should NOT be returned
assert(
  "F3: table boundary — trailing unrelated table ignored",
  run(
    `| Qty | (e)Check/Wire | Crypto | Card |\n` +
      `| --- | --- | --- | --- |\n` +
      `| 1-9 | $1,935.00 | $1,945.00 | $1,960.00 |\n` +
      `\n` +
      `Some prose separating tables.\n` +
      `\n` +
      `| Item | Price | Notes |\n` +
      `| --- | --- | --- |\n` +
      `| Bag | $5.00 | free over $500 |\n`
  ),
  1935.0
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

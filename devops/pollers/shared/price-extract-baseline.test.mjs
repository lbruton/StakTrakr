#!/usr/bin/env node
/**
 * Unit tests for STRK-70 — computeBaseline goldback denomination parsing.
 *
 * computeBaseline is defined as a closure inside price-extract.js and is not
 * exported, so this test inlines a replica of the goldback denomination
 * parsing logic (lines 1522–1531 of price-extract.js). Keep this replica in
 * sync with the source when the regex or multiplier logic changes.
 *
 * Run with:
 *   node devops/pollers/shared/price-extract-baseline.test.mjs
 */

import assert from "node:assert/strict";

function computeGoldbackBaseline(coinSlug, goldbackG1) {
  if (!goldbackG1) return null;
  const denomMatch =
    coinSlug.match(/goldback-.*?-?g(\d+(?:\.\d+)?)$/i) ||
    coinSlug.match(/goldback-g(\d+(?:\.\d+)?)/i);
  const multiplier = denomMatch ? Number(denomMatch[1]) : 1;
  return goldbackG1 * multiplier;
}

const G1 = 4.5;

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

test("goldback-idaho-g0.25 → G1 × 0.25", () => {
  assert.equal(computeGoldbackBaseline("goldback-idaho-g0.25", G1), G1 * 0.25);
});

test("goldback-utah-g1 → G1 × 1", () => {
  assert.equal(computeGoldbackBaseline("goldback-utah-g1", G1), G1 * 1);
});

test("goldback-nevada-g5 → G1 × 5", () => {
  assert.equal(computeGoldbackBaseline("goldback-nevada-g5", G1), G1 * 5);
});

test("goldback-wyoming-g50 → G1 × 50", () => {
  assert.equal(computeGoldbackBaseline("goldback-wyoming-g50", G1), G1 * 50);
});

test("goldback-g10 (no state) → G1 × 10", () => {
  assert.equal(computeGoldbackBaseline("goldback-g10", G1), G1 * 10);
});

test("returns null when goldbackG1 baseline is missing", () => {
  assert.equal(computeGoldbackBaseline("goldback-idaho-g0.25", null), null);
});

let passed = 0;
let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL ${name}\n    ${e.message}`);
    failed++;
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

#!/usr/bin/env node
/**
 * TDD contract tests for the year-preferring FBP slug resolver's pure
 * functions (STRK-334, design C5) — the core R1.1 / R1.2 behavior.
 *
 * RED phase: `./resolve-fbp-slugs.js` does not exist yet.
 *
 * Run with:
 *   node --test devops/pollers/shared/resolve-fbp-slugs.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SITEMAP_XML = readFileSync(
  new URL("./__fixtures__/fbp-sitemap.xml", import.meta.url),
  "utf8"
);

const BASE = "https://findbullionprices.com/p/";
const SLUG_2026 = `${BASE}2026-american-silver-eagle-1-oz-bu-coin/`;
const SLUG_RANDOM = `${BASE}american-silver-eagle-1-oz-random-year/`;
const SLUG_2024 = `${BASE}2024-american-silver-eagle-1-oz-bu-coin/`;
const SLUG_UNDATED = `${BASE}american-silver-eagle-1-oz/`;

const importModule = () => import(new URL("./resolve-fbp-slugs.js", import.meta.url));

test("extractSitemapLocs returns every <loc> URL in the sitemap", async () => {
  const { extractSitemapLocs } = await importModule();
  const locs = extractSitemapLocs(SITEMAP_XML);

  assert.ok(Array.isArray(locs));
  assert.equal(locs.length, 7, "the fixture sitemap declares seven <loc> entries");
  assert.ok(locs.includes(SLUG_2026));
  assert.ok(locs.includes(SLUG_UNDATED));
  assert.ok(locs.includes(`${BASE}2026-american-gold-eagle-1-oz-bu-coin/`));
  assert.ok(locs.includes("https://findbullionprices.com/about/"));
});

test("matchCoinSlugs keeps only slugs containing every keyword (hyphen-normalized)", async () => {
  const { extractSitemapLocs, matchCoinSlugs } = await importModule();
  const locs = extractSitemapLocs(SITEMAP_XML);

  const matched = matchCoinSlugs(locs, "american silver eagle 1 oz");
  assert.deepEqual(
    [...matched].sort(),
    [SLUG_2024, SLUG_UNDATED, SLUG_RANDOM, SLUG_2026].sort(),
    "only the four ASE 1 oz slugs match; gold eagle, maple, and /about/ are excluded"
  );
});

test("rankByYear orders current-year ▸ random-year ▸ older-dated ▸ undated", async () => {
  const { rankByYear } = await importModule();

  // Deliberately unsorted input to prove rankByYear does the ordering.
  const ranked = rankByYear([SLUG_UNDATED, SLUG_2024, SLUG_2026, SLUG_RANDOM], 2026);
  assert.deepEqual(ranked, [SLUG_2026, SLUG_RANDOM, SLUG_2024, SLUG_UNDATED]);
  assert.equal(ranked[0], SLUG_2026, "the current-year slug is the top pick");
});

test("rankByYear falls back to the random-year slug when no current-year slug exists", async () => {
  const { rankByYear } = await importModule();

  const ranked = rankByYear([SLUG_UNDATED, SLUG_2024, SLUG_RANDOM], 2026);
  assert.equal(
    ranked[0],
    SLUG_RANDOM,
    "with 2026 absent, the random-year slug outranks the older-dated and undated slugs"
  );
});

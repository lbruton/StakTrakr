// Unit tests for the per-metal seed-history merge decision (STRK-344).
//
// Root cause being locked in: loadSeedSpotHistory() branched on
// isMerge = existing.length > 0 — fresh profiles hydrated a 180-day seed
// window into spotHistory, existing profiles SKIPPED the merge entirely
// (and a global migration_seedHistoryMerge flag short-circuited even that
// decision). Since getSparklineData() serves every range ≤180d from
// spotHistory alone, an existing profile could never obtain 8–180d history
// for a newly added metal (copper, STRK-303/306). Same global-check-vs-
// per-metal-need disease as STRK-343, one layer down.
//
// The invariant: seed rows are merged PER METAL. A metal is covered when it
// has any history row older than the coverage threshold (30 days) — live
// accretion proves the profile has been tracking it. An uncovered metal
// (newly added, or a young profile) receives its seed rows within the
// 180-day runtime window, skipping any day that already has a live row
// (live data wins — precedent js/spot.js day-dedup).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// --- extract _seedEntriesToMerge from seed-data.js source ---
// Substring extraction (start marker → first column-0 "};"), same harness as
// tests/unit/staktrakr-hourly-backfill.test.js.
const seedSrc = readFileSync(new URL("../../js/seed-data.js", import.meta.url), "utf-8");

const extractConstFn = (src, name) => {
  const marker = `const ${name} = `;
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `could not locate ${marker} in js/seed-data.js`);
  const end = src.indexOf("\n};", start);
  assert.notEqual(end, -1, `could not locate the end of ${name} in js/seed-data.js`);
  const expr = src.slice(start + marker.length, end + "\n}".length);
  return new Function(`return ${expr};`)();
};

const seedEntriesToMerge = extractConstFn(seedSrc, "_seedEntriesToMerge");

// Fixtures use the stored UTC-naive timestamp shape ("YYYY-MM-DD HH:MM:SS").
const NOW = Date.UTC(2026, 7, 16, 12, 0, 0);
const tsDaysAgo = (d, hour = "12:00:00") =>
  `${new Date(NOW - d * 86400000).toISOString().slice(0, 10)} ${hour}`;

const live = (metal, daysAgo, hour) => ({
  metal,
  spot: 100,
  source: "api-hourly",
  timestamp: tsDaysAgo(daysAgo, hour),
});
const seed = (metal, daysAgo) => ({
  metal,
  spot: 50,
  source: "seed",
  timestamp: tsDaysAgo(daysAgo),
});

const METAL_NAMES = ["Gold", "Silver", "Platinum", "Palladium", "Copper"];
const WINDOW_DAYS = 180;
const COVERAGE_DAYS = 30;

// A covered legacy metal: live rows spanning deep into the window.
const coveredHistory = (metal) => [live(metal, 1), live(metal, 45), live(metal, 120)];

const call = (existing, seedEntries) =>
  seedEntriesToMerge(existing, seedEntries, METAL_NAMES, NOW, WINDOW_DAYS, COVERAGE_DAYS);

describe("STRK-344 — _seedEntriesToMerge is per-metal, live-wins, window-bounded", () => {
  test("copper with only recent live rows gets its seed window; covered metals get nothing", () => {
    const existing = [...METAL_NAMES.slice(0, 4).flatMap(coveredHistory), live("Copper", 2)];
    const seeds = METAL_NAMES.flatMap((m) => [seed(m, 10), seed(m, 90), seed(m, 170)]);
    const merged = call(existing, seeds);
    assert.ok(merged.length > 0, "copper must receive seed rows");
    assert.ok(
      merged.every((e) => e.metal === "Copper"),
      "only the uncovered metal merges"
    );
    assert.equal(merged.length, 3, "copper gets all its in-window seed rows");
  });

  test("a metal absent from history entirely is uncovered and merges", () => {
    const existing = METAL_NAMES.slice(0, 4).flatMap(coveredHistory);
    const merged = call(existing, [seed("Copper", 60)]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].metal, "Copper");
  });

  test("all metals deep-covered → empty merge (idempotent no-op)", () => {
    const existing = METAL_NAMES.flatMap(coveredHistory);
    const seeds = METAL_NAMES.map((m) => seed(m, 90));
    assert.deepEqual(call(existing, seeds), []);
  });

  test("empty history → every metal's in-window seed rows merge (fresh-profile parity)", () => {
    const seeds = METAL_NAMES.map((m) => seed(m, 90));
    assert.equal(call([], seeds).length, METAL_NAMES.length);
  });

  test("seed rows outside the 180-day window are excluded", () => {
    const merged = call([], [seed("Copper", 90), seed("Copper", 200)]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].timestamp, tsDaysAgo(90));
  });

  test("live data wins — seed rows on days copper already has live rows are skipped", () => {
    const existing = [live("Copper", 2, "15:00:00")];
    const merged = call(existing, [seed("Copper", 2), seed("Copper", 60)]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].timestamp, tsDaysAgo(60));
  });

  test("a metal with a row just past the coverage threshold is covered", () => {
    const existing = [
      ...METAL_NAMES.slice(0, 4).flatMap(coveredHistory),
      live("Copper", 2),
      live("Copper", 31),
    ];
    assert.deepEqual(call(existing, [seed("Copper", 90)]), []);
  });

  test("seed metals outside the tracked set are never merged", () => {
    const merged = call([], [seed("Rhodium", 90), seed("Copper", 90)]);
    assert.ok(
      merged.every((e) => e.metal === "Copper"),
      "unexpected sixth metal stays out of spotHistory"
    );
  });
});

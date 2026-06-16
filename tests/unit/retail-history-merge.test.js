// Characterization tests for the per-slug retail history merge (STRK-170 cohort 3.8).
//
// _syncRetailV2's per-slug processor merges 7d/30d/90d history feeds into one
// deduped, date-sorted series. This is HIGH-RISK code: the merge order (coarsest
// 90d first, then 30d, then 7d) and the per-date dedup rules (finer-granularity
// aggregates win; same-rank entries weighted-average; vendors union-merge) decide
// whether a slug's history loses or duplicates points. These tests pin that exact
// behavior so the cohort-3.8 complexity refactor stays byte-for-byte equivalent.
//
// Loaded via slice-and-eval (the project's unit pattern, see
// disposition-predicate.test.js): _mergeRetailHistory is a browser global helper
// in js/retail.js with no external dependencies, so we extract its source block
// and evaluate it in isolation.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/retail.js", import.meta.url), "utf-8");

// _mergeRetailHistory delegates to a small self-contained cluster of pure sibling
// helpers (_weightedHistoryAverage, _mergeSameRankHistory, _mergeCrossRankHistory,
// _mergeHistoryCollision). Slice the whole cluster — from the first helper through
// _mergeRetailHistory's closing `\n};` — and evaluate it standalone so the inner
// references resolve. Anchored on the leading helper's declaration so the extraction
// survives surrounding reordering.
const match = src.match(
  /const _weightedHistoryAverage = \([\s\S]*?const _mergeRetailHistory = \([\s\S]*?\n\};/
);
assert.ok(match, "could not locate the merge-helper cluster in js/retail.js");
const _mergeRetailHistory = new Function(match[0] + "\nreturn _mergeRetailHistory;")();

/**
 * Builds one history entry matching the shape produced by addHistory() in
 * _syncRetailV2 (date, t, ts, OHLC, avg_median, avg_low, n, vendors, _sourceRank).
 * @param {object} over - Field overrides merged onto sensible defaults.
 * @returns {object} A history entry.
 */
function entry(over) {
  return {
    _sourceRank: 0,
    date: "2026-05-20",
    t: "2026-05-20T00:00:00Z",
    ts: 1000,
    open: 10,
    high: 12,
    low: 8,
    close: 11,
    avg_median: 11,
    avg_low: 9,
    n: 1,
    vendors: null,
    ...over,
  };
}

describe("_mergeRetailHistory — per-slug history merge (STRK-170 AC-4)", () => {
  test("returns [] for an empty input list", () => {
    assert.deepEqual(_mergeRetailHistory([]), []);
  });

  test("strips the internal _sourceRank field from every emitted entry", () => {
    const out = _mergeRetailHistory([entry({ _sourceRank: 2 })]);
    assert.equal(out.length, 1);
    assert.ok(!("_sourceRank" in out[0]), "_sourceRank must not leak to consumers");
  });

  test("dedups by date — one entry per distinct date, no duplicates dropped or doubled", () => {
    const out = _mergeRetailHistory([
      entry({ date: "2026-05-18", _sourceRank: 0 }),
      entry({ date: "2026-05-19", _sourceRank: 1 }),
      entry({ date: "2026-05-20", _sourceRank: 2 }),
    ]);
    assert.deepEqual(
      out.map((e) => e.date),
      ["2026-05-18", "2026-05-19", "2026-05-20"]
    );
  });

  test("sorts emitted entries ascending by date", () => {
    const out = _mergeRetailHistory([
      entry({ date: "2026-05-22" }),
      entry({ date: "2026-05-20" }),
      entry({ date: "2026-05-21" }),
    ]);
    assert.deepEqual(
      out.map((e) => e.date),
      ["2026-05-20", "2026-05-21", "2026-05-22"]
    );
  });

  test("skips entries with a null date (no crash, not emitted)", () => {
    const out = _mergeRetailHistory([entry({ date: null }), entry({ date: "2026-05-20" })]);
    assert.deepEqual(
      out.map((e) => e.date),
      ["2026-05-20"]
    );
  });

  test("on a date collision, the finer-granularity (higher _sourceRank) close wins", () => {
    // Coarsest-first insertion order mirrors addHistory(hist90,0)/(hist30,1)/(hist7,2).
    const out = _mergeRetailHistory([
      entry({ date: "2026-05-20", _sourceRank: 0, close: 90, avg_median: 90 }),
      entry({ date: "2026-05-20", _sourceRank: 2, close: 7, avg_median: 7 }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].close, 7);
    assert.equal(out[0].avg_median, 7);
  });

  test("cross-rank merge fills missing finer fields from the coarser entry", () => {
    const out = _mergeRetailHistory([
      entry({ date: "2026-05-20", _sourceRank: 0, open: 5, high: 99, low: 1 }),
      entry({
        date: "2026-05-20",
        _sourceRank: 2,
        open: null,
        high: null,
        low: null,
        close: 7,
      }),
    ]);
    assert.equal(out.length, 1);
    // finer.open/high/low are null → fall back to coarser's values
    assert.equal(out[0].open, 5);
    assert.equal(out[0].high, 99);
    assert.equal(out[0].low, 1);
    assert.equal(out[0].close, 7);
  });

  test("same-rank collision weighted-averages avg_median by sample count n", () => {
    const out = _mergeRetailHistory([
      entry({ date: "2026-05-20", _sourceRank: 1, avg_median: 10, n: 1, ts: 100 }),
      entry({ date: "2026-05-20", _sourceRank: 1, avg_median: 20, n: 3, ts: 200 }),
    ]);
    assert.equal(out.length, 1);
    // (10*1 + 20*3) / (1+3) = 70/4 = 17.5
    assert.equal(out[0].avg_median, 17.5);
    // n accumulates to the combined weight
    assert.equal(out[0].n, 4);
    // close follows the newer ts
    assert.equal(out[0].close, 11);
  });

  test("same-rank collision takes max high and min low", () => {
    const out = _mergeRetailHistory([
      entry({ date: "2026-05-20", _sourceRank: 1, high: 12, low: 8 }),
      entry({ date: "2026-05-20", _sourceRank: 1, high: 20, low: 3 }),
    ]);
    assert.equal(out[0].high, 20);
    assert.equal(out[0].low, 3);
  });

  test("cross-rank vendors union-merge with finer taking precedence per key", () => {
    const out = _mergeRetailHistory([
      entry({
        date: "2026-05-20",
        _sourceRank: 0,
        vendors: { apmex: { avg: 1 }, jmbullion: { avg: 2 } },
      }),
      entry({
        date: "2026-05-20",
        _sourceRank: 2,
        vendors: { apmex: { avg: 99 } },
      }),
    ]);
    assert.equal(out.length, 1);
    // jmbullion only in coarser → preserved; apmex in both → finer (99) wins
    assert.deepEqual(out[0].vendors, { jmbullion: { avg: 2 }, apmex: { avg: 99 } });
  });
});

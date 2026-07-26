// Unit tests for the ratio statistics engine (STRK-269).
//
// These tests ENCODE the STRK-269 acceptance criteria for the pure, DOM-free
// ratio series + statistics layer added to js/spot-ratio-math.js (foundation
// for the STRK-268 ratios panel). They cover:
//
//   RATIO_PAIRS  — 4-pair config (Au:Ag, Au:Pt, Au:Pd, Pt:Pd) with bundle metal
//                  keys, live-spot symbols, denominator-accent, decimals, and
//                  the interpretive flag (Au:Ag only).
//   buildRatioSeries(source, numMetal, denMetal)
//                — ascending [isoDate, ratio]; a point is emitted ONLY where
//                  both metals printed a valid close (finite, > 0), so pairs
//                  whose metals start in different years self-truncate (Pt/Pd
//                  begin 1990) with no date special-casing. Accepts the
//                  historicalDataCache shape (Map<year, entries[]>) or a flat
//                  entries array. Zero / negative / non-numeric closes are
//                  excluded. Duplicate same-date closes: later timestamp wins.
//   computeRatioStats(series, liveRatio)
//                — { current, spanStart, spanEnd, points, histMean, median,
//                    vsMeanPct, percentile, avg7, avg30, avg90, avg365, avg5y,
//                    prevClose, high52, low52, allHigh, allLow }. Trailing
//                  averages are TRADING SESSIONS (avg365 = 261 sessions,
//                  avg5y = 1,305) and degrade gracefully on short series.
//                  percentile is all-time share of sessions strictly below
//                  current; high52/low52 are the last-261-session lens.
//                  Extremes are [isoDate, value]. liveRatio (finite, > 0)
//                  overrides the last close for `current`; when absent the
//                  engine falls back to the last close.
//
// Harness: js/spot-ratio-math.js is a script-tag-global module (no ESM/CJS
// exports — it assigns onto `window`). Mirroring spot-ratio-chips.test.js, the
// whole file is evaluated with a mock `window` via new Function("window", src).

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/spot-ratio-math.js", import.meta.url), "utf-8");

// The stats layer reads no collaborators at load time; a bare surface suffices.
function loadModule() {
  const surface = {
    document: { getElementById: () => null, querySelector: () => null },
  };
  new Function("window", src)(surface);
  return surface;
}

const mod = loadModule();

// ---------------------------------------------------------------------------
// Fixture helpers — cache-entry shape produced by _loadSpotSeedBundle():
//   { spot, metal, source, provider, timestamp: "YYYY-MM-DD 12:00:00" }
// ---------------------------------------------------------------------------
const entry = (metal, isoDate, spot, time = "12:00:00") => ({
  spot,
  metal,
  source: "seed",
  provider: "LBMA",
  timestamp: `${isoDate} ${time}`,
});

/** Builds paired Gold/Silver entries where silver is 1 so ratio === gold px. */
const pairedDays = (days) =>
  days.flatMap(([isoDate, goldPx]) => [
    entry("Gold", isoDate, goldPx),
    entry("Silver", isoDate, 1),
  ]);

// Six-session fixture — ratios [80, 90, 100, 110, 120, 100].
const SIX_DAYS = [
  ["2024-01-02", 80],
  ["2024-01-03", 90],
  ["2024-01-04", 100],
  ["2024-01-05", 110],
  ["2024-01-08", 120],
  ["2024-01-09", 100],
];
const sixSeries = () => mod.buildRatioSeries(pairedDays(SIX_DAYS), "Gold", "Silver");

/** Generates n consecutive WEEKDAY iso dates starting 2020-01-01 (a Wednesday). */
const weekdayDates = (n) => {
  const dates = [];
  for (let i = 0; dates.length < n; i++) {
    const d = new Date(Date.UTC(2020, 0, 1) + i * 86400000);
    // UTC in / UTC out: deterministic fixture dates, not local formatting —
    // toLocaleDateString('en-CA') here would be host-timezone dependent.
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
};

// =============================================================================
// RATIO_PAIRS config
// =============================================================================
describe("RATIO_PAIRS config", () => {
  test("exposes exactly the 4 pairs in panel order", () => {
    assert.ok(Array.isArray(mod.RATIO_PAIRS), "RATIO_PAIRS must be an array on window");
    assert.deepEqual(
      mod.RATIO_PAIRS.map((p) => p.id),
      ["au-ag", "au-pt", "au-pd", "pt-pd"]
    );
  });

  test("carries bundle metal keys and live-spot symbols per pair", () => {
    const byId = Object.fromEntries(mod.RATIO_PAIRS.map((p) => [p.id, p]));
    assert.deepEqual(
      [byId["au-ag"].num, byId["au-ag"].den, byId["au-ag"].numSym, byId["au-ag"].denSym],
      ["Gold", "Silver", "xau", "xag"]
    );
    assert.deepEqual(
      [byId["au-pt"].num, byId["au-pt"].den, byId["au-pt"].numSym, byId["au-pt"].denSym],
      ["Gold", "Platinum", "xau", "xpt"]
    );
    assert.deepEqual(
      [byId["au-pd"].num, byId["au-pd"].den, byId["au-pd"].numSym, byId["au-pd"].denSym],
      ["Gold", "Palladium", "xau", "xpd"]
    );
    assert.deepEqual(
      [byId["pt-pd"].num, byId["pt-pd"].den, byId["pt-pd"].numSym, byId["pt-pd"].denSym],
      ["Platinum", "Palladium", "xpt", "xpd"]
    );
  });

  test("accent follows the denominator metal", () => {
    const accents = Object.fromEntries(mod.RATIO_PAIRS.map((p) => [p.id, p.accent]));
    assert.deepEqual(accents, {
      "au-ag": "silver",
      "au-pt": "platinum",
      "au-pd": "palladium",
      "pt-pd": "palladium",
    });
  });

  test("decimals: 1 for Au:Ag, 2 for the rest; interpretive is Au:Ag only", () => {
    for (const p of mod.RATIO_PAIRS) {
      assert.equal(p.decimals, p.id === "au-ag" ? 1 : 2, `decimals for ${p.id}`);
      assert.equal(p.interpretive, p.id === "au-ag", `interpretive for ${p.id}`);
    }
  });
});

// =============================================================================
// buildRatioSeries — join semantics and input hygiene
// =============================================================================
describe("buildRatioSeries", () => {
  test("emits ascending [isoDate, ratio] from a flat entries array", () => {
    const series = sixSeries();
    assert.deepEqual(
      series.map(([d]) => d),
      SIX_DAYS.map(([d]) => d)
    );
    assert.deepEqual(
      series.map(([, r]) => r),
      [80, 90, 100, 110, 120, 100]
    );
  });

  test("accepts the historicalDataCache Map shape and joins across years", () => {
    const cache = new Map([
      [2023, pairedDays([["2023-12-29", 70]])],
      [2024, pairedDays(SIX_DAYS)],
    ]);
    const series = mod.buildRatioSeries(cache, "Gold", "Silver");
    assert.equal(series.length, 7);
    assert.deepEqual(series[0], ["2023-12-29", 70]);
    assert.deepEqual(series[6], ["2024-01-09", 100]);
  });

  test("emits a point only where BOTH metals printed a close", () => {
    const entries = [
      ...pairedDays([["2024-01-02", 80]]),
      entry("Gold", "2024-01-03", 90), // silver missing → no point
      entry("Silver", "2024-01-04", 1), // gold missing → no point
      ...pairedDays([["2024-01-05", 110]]),
    ];
    const series = mod.buildRatioSeries(entries, "Gold", "Silver");
    assert.deepEqual(series, [
      ["2024-01-02", 80],
      ["2024-01-05", 110],
    ]);
  });

  test("a late-starting denominator truncates the pair with no special-casing", () => {
    // Gold prints from 1968; palladium only from 1990 — the join starts 1990.
    const entries = [
      entry("Gold", "1968-01-02", 35.18),
      entry("Gold", "1990-01-02", 399.0),
      entry("Palladium", "1990-01-02", 100.0),
    ];
    const series = mod.buildRatioSeries(entries, "Gold", "Palladium");
    assert.deepEqual(series, [["1990-01-02", 3.99]]);
  });

  test("excludes zero, negative, and non-numeric closes on either side", () => {
    const entries = [
      ...pairedDays([["2024-01-02", 80]]),
      entry("Gold", "2024-01-03", 0),
      entry("Silver", "2024-01-03", 1),
      entry("Gold", "2024-01-04", -5),
      entry("Silver", "2024-01-04", 1),
      entry("Gold", "2024-01-05", "4321.55"),
      entry("Silver", "2024-01-05", 1),
      entry("Gold", "2024-01-08", NaN),
      entry("Silver", "2024-01-08", 1),
      entry("Gold", "2024-01-09", 100),
      entry("Silver", "2024-01-09", Infinity),
    ];
    const series = mod.buildRatioSeries(entries, "Gold", "Silver");
    assert.deepEqual(series, [["2024-01-02", 80]]);
  });

  test("weekend gap-fill prints are excluded so session windows stay honest", () => {
    const entries = pairedDays([
      ["2026-07-24", 80], // Friday
      ["2026-07-25", 90], // Saturday — excluded
      ["2026-07-26", 95], // Sunday — excluded
      ["2026-07-27", 100], // Monday
    ]);
    const series = mod.buildRatioSeries(entries, "Gold", "Silver");
    assert.deepEqual(series, [
      ["2026-07-24", 80],
      ["2026-07-27", 100],
    ]);
  });

  test("duplicate same-date closes: the later timestamp wins", () => {
    const entries = [
      entry("Gold", "2024-01-02", 90, "09:00:00"),
      entry("Gold", "2024-01-02", 80, "16:00:00"),
      entry("Silver", "2024-01-02", 1),
    ];
    assert.deepEqual(mod.buildRatioSeries(entries, "Gold", "Silver"), [["2024-01-02", 80]]);
  });

  test("returns [] for empty, missing, or malformed sources", () => {
    assert.deepEqual(mod.buildRatioSeries([], "Gold", "Silver"), []);
    assert.deepEqual(mod.buildRatioSeries(new Map(), "Gold", "Silver"), []);
    assert.deepEqual(mod.buildRatioSeries(null, "Gold", "Silver"), []);
    assert.deepEqual(mod.buildRatioSeries(undefined, "Gold", "Silver"), []);
    assert.deepEqual(
      mod.buildRatioSeries([{ metal: "Gold" }, null, { timestamp: 42 }], "Gold", "Silver"),
      []
    );
  });
});

// =============================================================================
// computeRatioStats — the full statistic set
// =============================================================================
describe("computeRatioStats", () => {
  test("core stats on the six-session fixture (no live ratio)", () => {
    const s = mod.computeRatioStats(sixSeries(), null);
    assert.equal(s.current, 100); // falls back to last close
    assert.equal(s.spanStart, "2024-01-02");
    assert.equal(s.spanEnd, "2024-01-09");
    assert.equal(s.points, 6);
    assert.equal(s.histMean, 100);
    assert.equal(s.median, 100); // upper median of [80,90,100,100,110,120]
    assert.equal(s.vsMeanPct, 0);
    assert.ok(Math.abs(s.percentile - (2 / 6) * 100) < 1e-9); // 80, 90 strictly below
    assert.equal(s.prevClose, 120); // second-to-last close
  });

  test("liveRatio overrides current; prevClose becomes the last close", () => {
    const s = mod.computeRatioStats(sixSeries(), 130);
    assert.equal(s.current, 130);
    assert.equal(s.prevClose, 100); // last CLOSE — live is not a close
    assert.ok(Math.abs(s.vsMeanPct - 30) < 1e-9);
    assert.equal(s.percentile, 100); // every session strictly below 130
  });

  test("non-positive or non-finite liveRatio falls back to last close", () => {
    for (const bad of [null, undefined, 0, -3, NaN, Infinity, "63.8"]) {
      const s = mod.computeRatioStats(sixSeries(), bad);
      assert.equal(s.current, 100, `liveRatio=${String(bad)}`);
      assert.equal(s.prevClose, 120, `liveRatio=${String(bad)}`);
    }
  });

  test("trailing averages are session windows: avg7 over the last 7 sessions", () => {
    // 10 weekday sessions: [10, 10, 10, then 7×100] → avg7 = 100, histMean = 73.
    const days = weekdayDates(10).map((iso, i) => [iso, i < 3 ? 10 : 100]);
    const s = mod.computeRatioStats(mod.buildRatioSeries(pairedDays(days), "Gold", "Silver"), null);
    assert.equal(s.avg7, 100);
    assert.equal(s.histMean, 73);
  });

  test("avg365 covers exactly the last 261 sessions", () => {
    // 262 weekday sessions: one leading outlier (1000) then 261 × 100.
    const days = weekdayDates(262).map((iso, i) => [iso, i === 0 ? 1000 : 100]);
    const s = mod.computeRatioStats(mod.buildRatioSeries(pairedDays(days), "Gold", "Silver"), null);
    assert.equal(s.avg365, 100); // outlier session falls outside the 261 window
    assert.ok(s.histMean > 100); // ...but stays inside the all-time mean
  });

  test("short series degrade gracefully — no NaN in any window average", () => {
    const s = mod.computeRatioStats(sixSeries(), null);
    for (const key of ["avg7", "avg30", "avg90", "avg365", "avg5y"]) {
      assert.equal(s[key], 100, `${key} averages the available sessions`);
    }
  });

  test("52-week lens is the last 261 sessions; extremes carry [isoDate, value]", () => {
    // 262 sessions where the all-time high (500) is the first session — outside
    // the 52-week window — and the window high (300) sits at session 100.
    const days = weekdayDates(262).map((iso, i) => [
      iso,
      i === 0 ? 500 : i === 100 ? 300 : i === 200 ? 50 : 100,
    ]);
    const series = mod.buildRatioSeries(pairedDays(days), "Gold", "Silver");
    const s = mod.computeRatioStats(series, null);
    assert.deepEqual(s.allHigh, [days[0][0], 500]);
    assert.deepEqual(s.high52, [days[100][0], 300]);
    assert.deepEqual(s.low52, [days[200][0], 50]);
    assert.deepEqual(s.allLow, [days[200][0], 50]);
  });

  test("tied extremes keep the earliest occurrence", () => {
    const days = [
      ["2024-01-02", 100],
      ["2024-01-03", 120],
      ["2024-01-04", 120],
    ];
    const s = mod.computeRatioStats(mod.buildRatioSeries(pairedDays(days), "Gold", "Silver"), null);
    assert.deepEqual(s.allHigh, ["2024-01-03", 120]);
  });

  test("single-point series: prevClose is null, everything else finite", () => {
    const s = mod.computeRatioStats(
      mod.buildRatioSeries(pairedDays([["2024-01-02", 80]]), "Gold", "Silver"),
      null
    );
    assert.equal(s.current, 80);
    assert.equal(s.prevClose, null);
    assert.equal(s.percentile, 0);
    for (const key of [
      "histMean",
      "median",
      "vsMeanPct",
      "avg7",
      "avg30",
      "avg90",
      "avg365",
      "avg5y",
    ]) {
      assert.ok(Number.isFinite(s[key]), `${key} must be finite, got ${s[key]}`);
    }
  });

  test("empty or malformed series returns null", () => {
    assert.equal(mod.computeRatioStats([], null), null);
    assert.equal(mod.computeRatioStats(null, null), null);
    assert.equal(mod.computeRatioStats(undefined, 63.8), null);
  });
});

// =============================================================================
// Committed-bundle sanity — known-good spans verified against the seed bundle
// =============================================================================
describe("committed bundle sanity", () => {
  const cache = new Map();

  before(() => {
    // The bundle calls window._loadSpotSeedBundle(bundle) on load; capture the
    // compact { year: { metal: [[MM-DD, px]] } } payload and expand it into the
    // same cache-entry shape js/spot.js produces.
    const bundleSrc = readFileSync(
      new URL("../../data/spot-history-bundle.js", import.meta.url),
      "utf-8"
    );
    new Function("window", bundleSrc)({
      _loadSpotSeedBundle(bundle) {
        for (const yearStr of Object.keys(bundle)) {
          const entries = [];
          for (const metal of Object.keys(bundle[yearStr])) {
            for (const [md, px] of bundle[yearStr][metal]) {
              entries.push(entry(metal, `${yearStr}-${md}`, px));
            }
          }
          cache.set(parseInt(yearStr, 10), entries);
        }
      },
    });
    assert.ok(
      cache.size > 0,
      "seed bundle did not call _loadSpotSeedBundle — harness shape drifted"
    );
  });

  test("Au:Ag joins from 1968 with the full session count", () => {
    const s = mod.computeRatioStats(mod.buildRatioSeries(cache, "Gold", "Silver"), null);
    assert.equal(s.spanStart, "1968-01-02");
    // Weekday-only floor (the issue's 14,819 figure predates weekend filtering);
    // the count only grows as future weekday sessions land in the bundle.
    assert.ok(s.points >= 14778, `expected ≥ 14,778 sessions, got ${s.points}`);
  });

  test("Pt/Pd pairs self-truncate to their 1990 start", () => {
    for (const [num, den] of [
      ["Gold", "Platinum"],
      ["Gold", "Palladium"],
      ["Platinum", "Palladium"],
    ]) {
      const s = mod.computeRatioStats(mod.buildRatioSeries(cache, num, den), null);
      assert.ok(s.spanStart.startsWith("1990-"), `${num}:${den} spanStart ${s.spanStart}`);
      // Weekday-only floor (the issue's 9,214 figure predates weekend filtering).
      assert.ok(s.points >= 9173, `${num}:${den} expected ≥ 9,173 sessions, got ${s.points}`);
    }
  });

  test("no NaN leaks into any statistic for any pair", () => {
    for (const p of mod.RATIO_PAIRS) {
      const s = mod.computeRatioStats(mod.buildRatioSeries(cache, p.num, p.den), null);
      for (const [key, val] of Object.entries(s)) {
        if (Array.isArray(val)) {
          assert.ok(Number.isFinite(val[1]), `${p.id}.${key}[1] finite`);
        } else if (typeof val === "number") {
          assert.ok(Number.isFinite(val), `${p.id}.${key} finite, got ${val}`);
        }
      }
    }
  });
});

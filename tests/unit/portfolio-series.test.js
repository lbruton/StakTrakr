// Unit tests for js/portfolio-series.js — the STRK-352 portfolio series fold.
// Run: npm run test:unit
//
// These tests are the TDD contract for AC-5..AC-8 and AC-15 (see the STRK-352
// sketch requirements.md) plus approach pins D-8 and the layer-1 boundaries
// (14-day pre-roll, synthetic baseline day, undated fallbacks, per-metal fill,
// flow-adjusted window chain). Written RED against the A.1 stubs.
//
// Purity contract encoded here (deviations from the approach's 4-arg sketch,
// required so the fold is a deterministic function of its inputs):
//   buildPortfolioSeries(items, spotDayMaps, scope, todaySpotPrices, todayKey, helpers)
//   - todayKey: "YYYY-MM-DD" — "today" is injected, never read from the clock
//   - helpers:  { getUnitOztWeight, getConstitutionalSilverOz, isDisposed } —
//     injected doubles under Node; browser callers omit them and the module
//     falls back to the app globals.
// spotDayMaps keys are metal DISPLAY names ("Silver"); todaySpotPrices keys are
// lowercase metal keys ("silver") — matching getSpotDayMap and the spotPrices
// global respectively.
//
// portfolio-series.js is a plain script-tag global file (guarded CJS export),
// so it is evaluated with a synthetic CommonJS context (the load-sw-router.js
// convention, inlined here because only this suite needs it).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

function loadPortfolioSeries() {
  const code = readFileSync(new URL("../../js/portfolio-series.js", import.meta.url), "utf-8");
  const mod = { exports: {} };
  new Function("module", "exports", code)(mod, mod.exports);
  return mod.exports;
}

const { buildPortfolioSeries, computeWindowStats, pickLedgerRows } = loadPortfolioSeries();

// ── fixtures ────────────────────────────────────────────────────────────────

const TODAY = "2024-04-01";

/** Injected helper doubles — deterministic stand-ins for the app globals. */
const helpers = {
  // gb/sb store a Denomination (×0.001 ozt); everything else stores troy oz
  getUnitOztWeight: (item) =>
    item.weightUnit === "gb" || item.weightUnit === "sb"
      ? parseFloat(item.weight) * 0.001
      : parseFloat(item.weight) || 0,
  // cu derived oz is qty-folded and already pure silver (test sets _cuOz)
  getConstitutionalSilverOz: (item) => item._cuOz ?? 0,
  // mirrors js/constants.js isDisposed: non-null, non-array object with ≥1 key
  isDisposed: (item) =>
    !!item.disposition &&
    typeof item.disposition === "object" &&
    !Array.isArray(item.disposition) &&
    Object.keys(item.disposition).length > 0,
};

const mkItem = (overrides = {}) => ({
  uuid: overrides.uuid ?? `u-${Math.random().toString(36).slice(2, 8)}`,
  metal: "Silver",
  qty: 1,
  weight: 1,
  weightUnit: "oz",
  purity: 1,
  price: 10,
  date: "2024-03-01",
  ...overrides,
});

const dayMap = (entries) => new Map(entries);

/** Flat spot: Silver = `spot` for every day 2024-02-01..2024-04-01. */
const flatSilver = (spot) => {
  const m = new Map();
  for (let d = 1; d <= 29; d++) m.set(`2024-02-${String(d).padStart(2, "0")}`, spot);
  for (let d = 1; d <= 31; d++) m.set(`2024-03-${String(d).padStart(2, "0")}`, spot);
  m.set("2024-04-01", spot);
  return m;
};

const build = (items, maps, scope = "Silver", live = { silver: 10 }, today = TODAY) =>
  buildPortfolioSeries(items, maps, scope, live, today, helpers);

const dayIdx = (series, key) => series.days.indexOf(key);

// ── shape ───────────────────────────────────────────────────────────────────

describe("buildPortfolioSeries — shape", () => {
  it("returns an empty series for a scope with no Items — and a populated one otherwise", () => {
    const s = build([], { Silver: flatSilver(10) });
    assert.deepEqual(s.days, []);
    assert.deepEqual(s.melt, []);
    assert.deepEqual(s.basis, []);
    assert.deepEqual(s.buys, []);
    assert.equal(s.baseline, null);
    // distinguishes the real fold from the inert stub: any Item ⇒ non-empty days
    const populated = build([mkItem()], { Silver: flatSilver(10) });
    assert.ok(populated.days.length > 0);
  });

  it("filters Items to the scope (single metal)", () => {
    const items = [
      mkItem({ metal: "Silver", price: 10 }),
      mkItem({ metal: "Gold", price: 100, date: "2024-03-01" }),
    ];
    const s = build(items, { Silver: flatSilver(10), Gold: flatSilver(1000) }, "Silver");
    const last = s.basis.length - 1;
    assert.equal(s.basis[last], 10); // gold item excluded from a Silver scope
  });
});

// ── AC-5: day keys, pre-roll, baseline, undated ─────────────────────────────

describe("AC-5 — series boundaries", () => {
  it("starts 14 days before the first dated acquisition and ends at todayKey (verbatim string keys)", () => {
    const s = build([mkItem({ date: "2024-03-01" })], { Silver: flatSilver(10) });
    assert.equal(s.days[0], "2024-02-16"); // 2024-03-01 − 14 days (leap February)
    assert.equal(s.days[s.days.length - 1], TODAY);
    // consecutive calendar days, no gaps or duplicates (Feb 16..29 + Mar 1..31 + Apr 1)
    assert.equal(s.days.length, 14 + 31 + 1);
    assert.equal(new Set(s.days).size, s.days.length);
  });

  it("emits a synthetic baseline day immediately before the series start", () => {
    const s = build([mkItem({ date: "2024-03-01" })], { Silver: flatSilver(10) });
    assert.equal(s.baseline.day, "2024-02-15");
    assert.equal(s.baseline.melt, 0);
    assert.equal(s.baseline.basis, 0);
  });

  it("holds undated Items from the series start; the baseline stays empty (STRK-353)", () => {
    const items = [
      mkItem({ date: "2024-03-01", price: 10 }),
      mkItem({ date: "", weight: 5, price: 40 }), // undated: held-since-start
    ];
    const s = build(items, { Silver: flatSilver(10) });
    // day 0 (2024-02-16): only the undated item is held — 5 oz × spot 10
    assert.equal(s.melt[0], 50);
    assert.equal(s.basis[0], 40);
    // STRK-353 supersedes the STRK-352 pre-history baseline: an undated Item
    // enters as a series-start acquisition flow, so nothing precedes day 0
    assert.equal(s.baseline.melt, 0);
    assert.equal(s.baseline.basis, 0);
  });

  it("falls back to todayKey − 30 days when no dated acquisitions exist", () => {
    const s = build([mkItem({ date: "", weight: 2, price: 20 })], { Silver: flatSilver(10) });
    assert.equal(s.days[0], "2024-03-02"); // 2024-04-01 − 30 days
    assert.equal(s.days.length, 31);
    assert.equal(s.melt[0], 20); // 2 oz × 10, held throughout
  });
});

// ── AC-6: derived oz routes through the unit helpers ────────────────────────

describe("AC-6 — derived weight", () => {
  it("gb Denominations convert via the injected getUnitOztWeight (weight × 0.001 × qty)", () => {
    const gb = mkItem({ metal: "Gold", weightUnit: "gb", weight: 5, qty: 2, purity: 1, price: 7 });
    const s = build([gb], { Gold: flatSilver(1000) }, "Gold", { gold: 1000 });
    const last = s.melt.length - 1;
    // 5 gb × 0.001 ozt × qty 2 = 0.01 oz × 1000
    assert.ok(Math.abs(s.melt[last] - 10) < 1e-9);
  });

  it("cu uses getConstitutionalSilverOz verbatim — qty-folded, purity NOT re-applied", () => {
    const cu = mkItem({ weightUnit: "cu", _cuOz: 7.15, purity: 0.9, qty: 2, price: 100 });
    const s = build([cu], { Silver: flatSilver(10) });
    const last = s.melt.length - 1;
    // 7.15 derived oz × spot 10 — purity and qty must NOT multiply again
    assert.ok(Math.abs(s.melt[last] - 71.5) < 1e-9);
  });

  it("plain troy-oz items apply qty × purity", () => {
    const s = build([mkItem({ weight: 1, qty: 3, purity: 0.999 })], { Silver: flatSilver(10) });
    const last = s.melt.length - 1;
    assert.ok(Math.abs(s.melt[last] - 29.97) < 1e-9); // 1 × 3 × 0.999 × 10
  });
});

// ── AC-7: Dispositions ──────────────────────────────────────────────────────

describe("AC-7 — Dispositions", () => {
  it("removes melt AND basis from the disposition day onward (interval [acq, disp))", () => {
    const item = mkItem({
      date: "2024-03-01",
      price: 80,
      weight: 10,
      disposition: { type: "sold", date: "2024-03-10", amount: 120 },
    });
    const s = build([item], { Silver: flatSilver(10) });
    assert.equal(s.melt[dayIdx(s, "2024-03-09")], 100); // still held
    assert.equal(s.basis[dayIdx(s, "2024-03-09")], 80);
    assert.equal(s.melt[dayIdx(s, "2024-03-10")], 0); // gone on day d
    assert.equal(s.basis[dayIdx(s, "2024-03-10")], 0);
  });

  it("treats an undated Disposition as never held — excluded from series AND buys", () => {
    const ghost = mkItem({
      date: "2024-03-01",
      disposition: { type: "lost", date: "" },
    });
    const anchor = mkItem({ date: "2024-03-05", price: 10 });
    const s = build([ghost, anchor], { Silver: flatSilver(10) });
    assert.equal(s.basis[dayIdx(s, "2024-03-03")], 0); // ghost never contributes
    assert.equal(s.buys.length, 1); // only the anchor's acquisition
    assert.equal(s.buys[0].day, "2024-03-05");
  });
});

// ── AC-8: per-metal spot gap fill ───────────────────────────────────────────

describe("AC-8 — spot fill", () => {
  it("carries the most recent prior sample forward across gaps (no ceiling)", () => {
    const maps = {
      Silver: dayMap([
        ["2024-03-01", 10],
        ["2024-03-20", 12], // 18-day gap — far beyond any ±7-day window
      ]),
    };
    const s = build([mkItem({ date: "2024-03-01", weight: 1 })], maps);
    assert.equal(s.melt[dayIdx(s, "2024-03-15")], 10); // carried forward
    assert.equal(s.melt[dayIdx(s, "2024-03-20")], 12);
  });

  it("backward-fills days before the metal's first sample", () => {
    const maps = { Silver: dayMap([["2024-03-05", 10]]) };
    const s = build([mkItem({ date: "2024-03-01", weight: 1 })], maps);
    // Fixture correction (C.1, disclosed): the original red assertion observed
    // the backfill through 2024-02-16 — a day the item is NOT held — which
    // contradicts AC-5's holding interval (melt there is rightly 0). The fill
    // is observable only through held days: 03-01..03-04 are held AND precede
    // the first sample (03-05), so their melt proves the leading backfill.
    assert.equal(s.melt[dayIdx(s, "2024-02-16")], 0); // not yet held (AC-5)
    assert.equal(s.melt[dayIdx(s, "2024-03-01")], 10); // held, backfilled
    assert.equal(s.melt[dayIdx(s, "2024-03-04")], 10); // held, still pre-sample
  });

  it("a metal with no Spot History contributes 0 melt (per-metal, never global)", () => {
    const items = [
      mkItem({ metal: "Silver", weight: 1, price: 10 }),
      mkItem({ metal: "Copper", weight: 1, price: 5, date: "2024-03-01" }),
    ];
    // All scope; Copper has no day map at all
    const s = build(items, { Silver: flatSilver(10) }, "All", { silver: 10, copper: 0 });
    const last = s.melt.length - 1;
    assert.equal(s.melt[last], 10); // silver only; copper contributes 0, not NaN
    assert.equal(s.basis[last], 15); // basis still counts the copper purchase
  });
});

// ── buys index ──────────────────────────────────────────────────────────────

describe("buys — acquisition markers", () => {
  it("groups by acquisition date, ascending, including since-disposed Items", () => {
    const a = mkItem({ date: "2024-03-01", price: 10, weight: 1 });
    const b = mkItem({ date: "2024-03-01", price: 20, weight: 2 });
    const sold = mkItem({
      date: "2024-03-05",
      price: 30,
      disposition: { type: "sold", date: "2024-03-20", amount: 35 },
    });
    const s = build([sold, b, a], { Silver: flatSilver(10) });
    assert.deepEqual(
      s.buys.map((x) => x.day),
      ["2024-03-01", "2024-03-05"]
    );
    assert.equal(s.buys[0].items.length, 2);
    assert.equal(s.buys[0].totalCost, 30); // 10 + 20
    assert.equal(s.buys[0].totalOz, 3); // 1 + 2
    assert.equal(s.buys[1].items.length, 1); // disposed acquisition still marked
  });
});

// ── D-8: final day at live spot ─────────────────────────────────────────────

describe("D-8 — final day valued at live spot", () => {
  it("uses todaySpotPrices for the last series day, not the day-map close", () => {
    const s = build([mkItem({ weight: 1 })], { Silver: flatSilver(10) }, "Silver", {
      silver: 12,
    });
    const last = s.melt.length - 1;
    assert.equal(s.melt[last], 12); // live 12, not close 10
    assert.equal(s.melt[last - 1], 10); // prior days still use closes
  });
});

// ── AC-15: flow-adjusted window stats ───────────────────────────────────────

describe("AC-15 — computeWindowStats", () => {
  it("does not misclassify a disposal's melt-out as market loss", () => {
    const item = mkItem({
      date: "2024-03-01",
      price: 80,
      weight: 10,
      disposition: { type: "sold", date: "2024-03-10", amount: 120 },
    });
    const s = build([item], { Silver: flatSilver(10) });
    // sanity that the series itself is live (guards against a stub zero-out)
    assert.equal(s.melt[dayIdx(s, "2024-03-09")], 100);
    const stats = computeWindowStats(s, "2024-03-05");
    // spot is flat: the −100 melt drop at disposition is a flow, not market
    assert.equal(stats.market, 0);
  });

  it("counts flows from the window start day itself (baseline = prior day)", () => {
    // buy ON the window start day: must register as invested, not market gain
    const item = mkItem({ date: "2024-03-05", price: 40, weight: 5 });
    const s = build([item], { Silver: flatSilver(10) });
    const stats = computeWindowStats(s, "2024-03-05");
    assert.equal(stats.invested, 40);
    assert.equal(stats.market, 10); // melt 50 appears, minus 40 flow = +10 premium-to-melt gap
    assert.equal(stats.buyCount, 1);
  });

  it("computes market against real spot movement", () => {
    const maps = {
      Silver: dayMap([
        ["2024-02-16", 10],
        ["2024-03-25", 14], // spot rises
      ]),
    };
    const s = build([mkItem({ date: "2024-03-01", price: 10, weight: 1 })], maps, "Silver", {
      silver: 14,
    });
    const stats = computeWindowStats(s, s.days[0]);
    // 1 oz bought at flow 10; melt ends 14; market = (14 − 0) − 10 = 4
    assert.equal(stats.market, 4);
    assert.ok(Math.abs(stats.marketPct - 40) < 1e-9); // vs end basis 10
  });

  it("suppresses marketPct when the end-of-window basis is 0", () => {
    const item = mkItem({
      date: "2024-03-01",
      price: 80,
      weight: 10,
      disposition: { type: "sold", date: "2024-03-10", amount: 120 },
    });
    const s = build([item], { Silver: flatSilver(10) });
    const stats = computeWindowStats(s, s.days[0]);
    assert.equal(stats.marketPct, null);
    // window spans buy (cost 80, melt 100) and disposal (melt-out 100): the
    // at-cost flow convention books the buy-day melt-vs-cost gap as market
    assert.equal(stats.market, 20);
  });

  it("pace = window-acquired oz ÷ max(1/30, windowDays/30.44) for metal scopes", () => {
    const s = build(
      [mkItem({ date: "2024-03-01", weight: 6, price: 60 })],
      { Silver: flatSilver(10) },
      "Silver"
    );
    const startKey = "2024-03-01";
    const stats = computeWindowStats(s, startKey);
    const windowDays = s.days.length - 1 - dayIdx(s, startKey); // index span
    const months = Math.max(1 / 30, windowDays / 30.44);
    assert.ok(Math.abs(stats.paceOzPerMonth - 6 / months) < 1e-9);
  });

  it("pace is null for the All scope (invested still counted)", () => {
    const s = build([mkItem()], { Silver: flatSilver(10) }, "All", { silver: 10 });
    const stats = computeWindowStats(s, s.days[0]);
    assert.equal(stats.paceOzPerMonth, null);
    assert.equal(stats.invested, 10); // distinguishes real stats from the stub
  });
});

// ── STRK-353: undated Items reconcile as series-start flows ─────────────────
//
// Owner ruling (STRK-353): an undated Item is not a ghost. Its purchase cost
// enters the series as an acquisition flow on the series-start day, mirroring
// its held-from-start melt/basis treatment — so ALL-range invested/market
// always reconcile with the user's actual inventory totals.

describe("STRK-353 — undated acquisition flows", () => {
  // shared fixture: dated 1 oz @ cost 10 (2024-03-01) + undated 5 oz @ cost 40,
  // flat spot 10 → melt[end] = 60, total cost 50
  const mixed = () => [
    mkItem({ date: "2024-03-01", price: 10, weight: 1 }),
    mkItem({ date: "", weight: 5, price: 40 }),
  ];

  it("AC-2: ALL invested includes undated Items' purchase cost", () => {
    const s = build(mixed(), { Silver: flatSilver(10) });
    const stats = computeWindowStats(s, s.days[0]);
    assert.equal(stats.invested, 50); // 10 dated + 40 undated
  });

  it("AC-3: ALL market books the undated day-one melt-vs-cost differential", () => {
    const s = build(mixed(), { Silver: flatSilver(10) });
    const stats = computeWindowStats(s, s.days[0]);
    // spot flat: dated buy at melt parity contributes 0; undated 50 melt − 40
    // cost contributes +10 — previously dropped entirely
    assert.equal(stats.market, 10);
  });

  it("AC-4: undated Items produce no buy marker and no buys count", () => {
    const s = build(mixed(), { Silver: flatSilver(10) });
    assert.equal(s.buys.length, 1); // only the dated 03-01 acquisition
    assert.equal(s.buys[0].day, "2024-03-01");
    const stats = computeWindowStats(s, s.days[0]);
    assert.equal(stats.buyCount, 1);
  });

  it("AC-5: on ALL with zero dispositions, market + invested === final-day melt", () => {
    const s = build(mixed(), { Silver: flatSilver(10) });
    const last = s.melt.length - 1;
    const stats = computeWindowStats(s, s.days[0]);
    assert.ok(Math.abs(stats.market + stats.invested - s.melt[last]) < 1e-9); // 10 + 50 = 60
  });

  it("AC-5: with dispositions, market + invested − disposal melt-out === final-day melt", () => {
    const items = [
      mkItem({
        date: "2024-03-01",
        price: 80,
        weight: 10,
        disposition: { type: "sold", date: "2024-03-10", amount: 120 },
      }),
      mkItem({ date: "", weight: 5, price: 40 }),
    ];
    const s = build(items, { Silver: flatSilver(10) });
    const last = s.melt.length - 1;
    assert.equal(s.melt[last], 50); // sold item gone; undated 5 oz × 10 remains
    const stats = computeWindowStats(s, s.days[0]);
    const meltOut = 100; // 10 oz × spot 10 on the disposition day
    assert.equal(stats.invested, 120); // 80 dated + 40 undated
    assert.equal(stats.market, 30); // sold gain 20 + undated differential 10
    assert.ok(Math.abs(stats.market + stats.invested - meltOut - s.melt[last]) < 1e-9);
  });

  it("AC-6: sub-windows starting after the series start exclude the undated flow", () => {
    const s = build(mixed(), { Silver: flatSilver(10) });
    const stats = computeWindowStats(s, "2024-03-01");
    assert.equal(stats.invested, 10); // dated buy only — undated flow is at day 0
    assert.equal(stats.market, 0); // flat spot: prior-day melt already holds the undated oz
  });

  it("an undated Item disposed ON the series-start day still books its cost flow (dispIdx = 0)", () => {
    // boundary: dispOut[0] records the melt-out, so buyCost[0] must record the
    // cost — otherwise market inflates by the full melt-out, not the flip gain
    const items = [
      mkItem({ date: "2024-03-01", price: 10, weight: 1 }), // series anchor → start 2024-02-16
      mkItem({
        date: "",
        weight: 5,
        price: 40,
        disposition: { type: "sold", date: "2024-02-16", amount: 50 },
      }),
    ];
    const s = build(items, { Silver: flatSilver(10) });
    const last = s.melt.length - 1;
    assert.equal(s.melt[last], 10); // only the anchor is held
    const stats = computeWindowStats(s, s.days[0]);
    assert.equal(stats.invested, 50); // 10 anchor + 40 day-zero flip
    assert.equal(stats.market, 10); // flip gain 50 − 40, anchor 0 — NOT +50
    assert.ok(Math.abs(stats.market + stats.invested - 50 - s.melt[last]) < 1e-9);
  });

  it("an undated Item with a dated disposition flows in at series start and out at disposition", () => {
    const items = [
      mkItem({ date: "2024-03-01", price: 10, weight: 1 }), // series anchor
      mkItem({
        date: "",
        weight: 5,
        price: 40,
        disposition: { type: "sold", date: "2024-03-10", amount: 55 },
      }),
    ];
    const s = build(items, { Silver: flatSilver(10) });
    const last = s.melt.length - 1;
    assert.equal(s.melt[last], 10); // only the anchor remains held
    const stats = computeWindowStats(s, s.days[0]);
    assert.equal(stats.invested, 50); // 10 anchor + 40 undated
    // undated flip: melt-out 50 − cost 40 = +10; anchor contributes 0
    assert.equal(stats.market, 10);
    assert.ok(Math.abs(stats.market + stats.invested - 50 - s.melt[last]) < 1e-9);
  });
});

// ── STRK-362: investedSold — the since-disposed portion of invested ─────────
//
// invested is all-time acquisition flow; the Cost Basis KPI is active-only.
// investedSold reports the window's since-disposed buy flows so the UI can
// show `invested $X (− $Y sold)` where X − Y = active cost basis on ALL.

describe("STRK-362 — investedSold", () => {
  const soldMix = () => [
    mkItem({ date: "2024-03-01", price: 10, weight: 1 }), // active
    mkItem({
      date: "2024-03-05",
      price: 80,
      weight: 10,
      disposition: { type: "sold", date: "2024-03-10", amount: 120 },
    }),
  ];

  it("reports the window's since-disposed acquisition cost separately", () => {
    const s = build(soldMix(), { Silver: flatSilver(10) });
    const stats = computeWindowStats(s, s.days[0]);
    assert.equal(stats.invested, 90); // 10 active + 80 since-sold
    assert.equal(stats.investedSold, 80); // invested − investedSold = active basis
  });

  it("is 0 when no disposed acquisition falls in the window", () => {
    const s = build(soldMix(), { Silver: flatSilver(10) });
    // window opens after the sold item's BUY day — its flow is outside even
    // though its disposition day (03-10) is inside
    const stats = computeWindowStats(s, "2024-03-06");
    assert.equal(stats.investedSold, 0);
  });

  it("counts an undated since-disposed Item's series-start flow as sold", () => {
    const items = [
      mkItem({ date: "2024-03-01", price: 10, weight: 1 }), // series anchor
      mkItem({
        date: "",
        weight: 5,
        price: 40,
        disposition: { type: "sold", date: "2024-03-10", amount: 55 },
      }),
    ];
    const s = build(items, { Silver: flatSilver(10) });
    const stats = computeWindowStats(s, s.days[0]);
    assert.equal(stats.invested, 50);
    assert.equal(stats.investedSold, 40); // the undated flip's day-zero flow
  });

  it("stays 0 with no dispositions at all", () => {
    const s = build([mkItem({ date: "2024-03-01", price: 10 })], { Silver: flatSilver(10) });
    const stats = computeWindowStats(s, s.days[0]);
    assert.equal(stats.investedSold, 0);
  });
});

// ── pickLedgerRows ──────────────────────────────────────────────────────────

describe("pickLedgerRows", () => {
  it("returns active Items in scope, newest first, undated last", () => {
    const items = [
      mkItem({ uuid: "old", date: "2024-03-01" }),
      mkItem({ uuid: "new", date: "2024-03-20" }),
      mkItem({ uuid: "nodate", date: "" }),
      mkItem({
        uuid: "sold",
        date: "2024-03-25",
        disposition: { type: "sold", date: "2024-03-26" },
      }),
      mkItem({ uuid: "gold", metal: "Gold", date: "2024-03-22" }),
    ];
    const rows = pickLedgerRows(items, "Silver", helpers);
    assert.deepEqual(
      rows.map((r) => r.uuid),
      ["new", "old", "nodate"]
    );
  });

  it("includes every metal for the All scope", () => {
    const items = [
      mkItem({ uuid: "s", date: "2024-03-01" }),
      mkItem({ uuid: "g", metal: "Gold", date: "2024-03-02" }),
    ];
    const rows = pickLedgerRows(items, "All", helpers);
    assert.deepEqual(
      rows.map((r) => r.uuid),
      ["g", "s"]
    );
  });
});

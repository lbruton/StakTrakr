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

// ── STRK-364: spotByMetal is total — the unguarded dereference is safe ──────

// Codacy flagged `const spot = spotByMetal[c.metal]` in the accumulation loop
// as an unguarded dereference (PR #1485 review, deferred as pre-existing). It
// is unreachable: spotByMetal and `computed` are keyed from the same `usable`
// array with the same `it.metal || "Unknown"` expression, and _psFillSpot is
// total — it returns a len-sized array even for a metal with no samples. These
// tests pin that invariant so a future refactor that breaks it fails here
// rather than shipping a throw (or, with a `|| []` guard, a silent zero
// series). AC-8 above covers the mixed-scope case; this block covers the
// degenerate spotDayMaps shapes and the disposition path.
describe("STRK-364 — unmapped metals never break the fold", () => {
  const unmapped = (maps, scope = "Palladium") =>
    build([mkItem({ metal: "Palladium", weight: 2, price: 30 })], maps, scope, { silver: 10 });

  it("charts flat 0 melt when the metal is absent from a populated spotDayMaps", () => {
    const s = unmapped({ Silver: flatSilver(10) });
    assert.ok(s.days.length > 0); // a real series, not the empty fallback
    assert.ok(s.melt.every((v) => v === 0)); // no throw, no NaN — flat zero
    assert.equal(s.basis[s.basis.length - 1], 30); // basis still books the cost
  });

  it("tolerates an empty, undefined, or null spotDayMaps identically", () => {
    for (const maps of [{}, undefined, null]) {
      const s = unmapped(maps);
      assert.ok(
        s.melt.every((v) => v === 0),
        `melt not flat-zero for ${String(maps)}`
      );
      assert.ok(!s.melt.some(Number.isNaN), `NaN leaked for ${String(maps)}`);
      assert.equal(s.basis[s.basis.length - 1], 30);
    }
  });

  it("books a zero melt-out for a disposed unmapped Item (the spot[dispIdx] read)", () => {
    const item = mkItem({
      metal: "Palladium",
      weight: 2,
      price: 30,
      date: "2024-03-01",
      disposition: { type: "sold", date: "2024-03-10", amount: 55 },
    });
    const s = build([item], {}, "Palladium", { silver: 10 });
    const d = dayIdx(s, "2024-03-10");
    assert.equal(s._flows.dispOut[d], 0); // melt-out at an unknown spot is 0
    assert.ok(!s._flows.dispOut.some(Number.isNaN));
    // the window chain still resolves to finite numbers rather than NaN. market
    // = melt[end] − prevMelt − invested + out = 0 − 0 − 30 + 0: an unpriced
    // metal's disposition books a market loss equal to its cost, because the
    // melt-out flow that would cancel the buy flow is 0. That is the honest
    // consequence of having no price for the metal, not a fold defect — and it
    // is unreachable in the app, where every SUPPORTED_INVENTORY_METALS member
    // is also in SUPPORTED_SPOT_METALS and gets a (possibly empty) day map.
    const stats = computeWindowStats(s, s.days[0]);
    assert.equal(stats.market, -30);
    assert.ok(Number.isFinite(stats.market));
    assert.equal(stats.invested, 30);
  });

  it("gives an Item with no metal at all the 'Unknown' bucket, not a crash", () => {
    const s = build([mkItem({ metal: undefined, weight: 2, price: 30 })], {}, "All", {});
    assert.ok(s.melt.every((v) => v === 0));
    assert.equal(s.basis[s.basis.length - 1], 30);
  });

  // PR #1486 review (Copilot): on a plain {} these names read as truthy in the
  // `if (!spotByMetal[metal])` fill check, skip their assignment, and poison
  // melt with NaN — which made the totality claim conditional on the metal
  // name. spotByMetal is a null-prototype map so the invariant holds for any
  // string key. Reachable only via a hand-edited backup restore (every UI and
  // CSV import path gates on SUPPORTED_INVENTORY_METALS), but the fold must not
  // depend on that gate holding.
  it("survives metal names that collide with Object.prototype keys", () => {
    for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      const s = build([mkItem({ metal: name, weight: 2, price: 30 })], {}, name, {});
      assert.ok(
        !s.melt.some(Number.isNaN),
        `NaN leaked for metal ${JSON.stringify(name)} — spotByMetal lost its null prototype`
      );
      assert.ok(
        s.melt.every((v) => v === 0),
        `melt not flat-zero for metal ${JSON.stringify(name)}`
      );
      assert.equal(s.basis[s.basis.length - 1], 30);
    }
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

// ── STRK-363: dispositions index ────────────────────────────────────────────

describe("dispositions — disposition markers (STRK-363)", () => {
  it("groups by disposition date, ascending, with per-item melt-out values", () => {
    const a = mkItem({
      date: "2024-03-01",
      price: 10,
      weight: 1,
      disposition: { type: "sold", date: "2024-03-10", amount: 100 },
    });
    const b = mkItem({
      date: "2024-03-01",
      price: 20,
      weight: 2,
      disposition: { type: "sold", date: "2024-03-10", amount: 200 },
    });
    const c = mkItem({
      date: "2024-03-05",
      price: 30,
      weight: 3,
      disposition: { type: "traded", date: "2024-03-15", amount: 300 },
    });
    const s = build([c, b, a], { Silver: flatSilver(10) });
    assert.deepEqual(
      s.dispositions.map((x) => x.day),
      ["2024-03-10", "2024-03-15"]
    );
    assert.equal(s.dispositions[0].items.length, 2);
    assert.equal(s.dispositions[1].items.length, 1);
  });

  it("computes totalMeltOut from spot at the disposition day (not the amount field)", () => {
    const item = mkItem({
      date: "2024-03-01",
      price: 80,
      weight: 10,
      purity: 1,
      disposition: { type: "sold", date: "2024-03-10", amount: 120 },
    });
    const s = build([item], { Silver: flatSilver(10) });
    assert.equal(s.dispositions.length, 1);
    assert.equal(s.dispositions[0].totalMeltOut, 100); // 10 oz × spot 10
  });

  it("attaches per-item meltOut so the tooltip can list individual values", () => {
    const a = mkItem({
      date: "2024-03-01",
      weight: 1,
      purity: 1,
      disposition: { type: "sold", date: "2024-03-10", amount: 100 },
    });
    const b = mkItem({
      date: "2024-03-01",
      weight: 2,
      purity: 1,
      disposition: { type: "sold", date: "2024-03-10", amount: 200 },
    });
    const s = build([a, b], { Silver: flatSilver(10) });
    const group = s.dispositions[0];
    assert.equal(group.items[0]._meltOut, 10); // 1 oz × spot 10
    assert.equal(group.items[1]._meltOut, 20); // 2 oz × spot 10
  });

  it("excludes undated dispositions (never-held items have no marker)", () => {
    const ghost = mkItem({
      date: "2024-03-01",
      disposition: { type: "lost", date: "" },
    });
    const anchor = mkItem({ date: "2024-03-05", price: 10 });
    const s = build([ghost, anchor], { Silver: flatSilver(10) });
    assert.equal(s.dispositions.length, 0);
  });

  it("excludes disposition days outside the series range", () => {
    const item = mkItem({
      date: "2024-03-01",
      weight: 1,
      disposition: { type: "sold", date: "2024-05-01", amount: 20 },
    });
    const s = build([item], { Silver: flatSilver(10) });
    assert.equal(s.dispositions.length, 0); // 2024-05-01 is past todayKey (2024-04-01)
  });

  it("does NOT affect buys count, pace, or invested (AC-3)", () => {
    const active = mkItem({ date: "2024-03-01", price: 10, weight: 1 });
    const sold = mkItem({
      date: "2024-03-05",
      price: 80,
      weight: 10,
      disposition: { type: "sold", date: "2024-03-10", amount: 120 },
    });
    const s = build([active, sold], { Silver: flatSilver(10) });
    assert.equal(s.buys.length, 2); // both acquisitions still marked
    assert.equal(s.dispositions.length, 1); // only the sold item's disposition
    const stats = computeWindowStats(s, s.days[0]);
    assert.equal(stats.buyCount, 2); // unaffected
    assert.equal(stats.invested, 90); // unaffected — 10 + 80

    // pace = window-acquired oz (both items, disposition-blind) ÷ elapsed months
    const windowDays = s.days.length - 1 - dayIdx(s, s.days[0]);
    const months = Math.max(1 / 30, windowDays / 30.44);
    assert.ok(Math.abs(stats.paceOzPerMonth - 11 / months) < 1e-9); // 1 + 10 oz

    // otherwise-identical series with NO disposition — proves the buys/invested/
    // pace figures are unaffected by disposition presence, not just coincidentally
    // matching the totals above
    const notSold = mkItem({ date: "2024-03-05", price: 80, weight: 10 });
    const sBaseline = build([active, notSold], { Silver: flatSilver(10) });
    const statsBaseline = computeWindowStats(sBaseline, sBaseline.days[0]);
    assert.equal(stats.buyCount, statsBaseline.buyCount);
    assert.equal(stats.invested, statsBaseline.invested);
    assert.ok(Math.abs(stats.paceOzPerMonth - statsBaseline.paceOzPerMonth) < 1e-9);
  });

  it("returns an empty dispositions array in the empty series", () => {
    const s = build([], { Silver: flatSilver(10) });
    assert.deepEqual(s.dispositions, []);
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

// ── STRK-362: investedDisposed — the since-disposed portion of invested ─────────
//
// invested is all-time acquisition flow; the Cost Basis KPI is active-only.
// investedDisposed reports the window's since-disposed buy flows so the UI can
// show `invested $X (− $Y disposed)` where X − Y = active cost basis on ALL.

describe("STRK-362 — investedDisposed", () => {
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
    assert.equal(stats.investedDisposed, 80); // invested − investedDisposed = active basis
  });

  it("is 0 when no disposed acquisition falls in the window", () => {
    const s = build(soldMix(), { Silver: flatSilver(10) });
    // window opens after the sold item's BUY day — its flow is outside even
    // though its disposition day (03-10) is inside
    const stats = computeWindowStats(s, "2024-03-06");
    assert.equal(stats.investedDisposed, 0);
  });

  it("counts an undated since-disposed Item's series-start flow as disposed", () => {
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
    assert.equal(stats.investedDisposed, 40); // the undated flip's day-zero flow
  });

  it("stays 0 with no dispositions at all", () => {
    const s = build([mkItem({ date: "2024-03-01", price: 10 })], { Silver: flatSilver(10) });
    const stats = computeWindowStats(s, s.days[0]);
    assert.equal(stats.investedDisposed, 0);
  });
});

// ── PR #1491 review: future-dated acquisitions excluded from the window ────
//
// The uncapped #itemDate input lets an item's date land after todayKey. The
// series (and its buys index) already excludes such a buy's cost from
// invested — its acqIdx falls past the series — but series.buys itself is
// grouped by raw acquisition date with no upper bound, so a future-dated buy
// still showed up in computeWindowStats' buyCount/pace. The window filter
// must cap at the series' final day (today) to agree with invested.

describe("PR #1491 review — future-dated acquisitions excluded from window", () => {
  it("a future-dated Item is not counted in buyCount for the full window, and invested is unchanged", () => {
    const futureDate = "2024-05-01"; // TODAY + 30 days, past the series' final day
    const dated = [mkItem({ date: "2024-03-01", price: 10, weight: 1 })];
    const withFuture = [...dated, mkItem({ date: futureDate, price: 999, weight: 1 })];

    const sBase = build(dated, { Silver: flatSilver(10) });
    const sFuture = build(withFuture, { Silver: flatSilver(10) });

    const statsBase = computeWindowStats(sBase, sBase.days[0]);
    const statsFuture = computeWindowStats(sFuture, sFuture.days[0]);

    assert.equal(statsFuture.buyCount, 1); // future buy excluded, only the dated one counts
    assert.equal(statsFuture.invested, statsBase.invested); // future cost never entered invested
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

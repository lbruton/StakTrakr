// Unit tests for spot-card ratio chips (STRK-161) — TDD RED phase.
//
// These tests ENCODE the sketch acceptance criteria (AC-1..AC-7) for the pure
// math / freshness / estimate layer of js/spot-ratio-chips.js. They are written
// to FAIL against the current STUBS (computeRatio/formatRatio/resolveGoldbackRate/
// isGoldbackStale all return undefined) — that RED state is correct and expected.
//
//   AC-1 computeRatio = gold/metal (issue example Au 4328.97 / Ag 67.84 ≈ 63.8)
//   AC-2 formatRatio: GSR 1dp, Au:Pt & Au:Pd 2dp, goldback 2dp
//   AC-3 guard: a required spot ≤ 0 or non-finite → null, NEVER Infinity/NaN
//   AC-4 resolveGoldbackRate: fresh cache → cache g1 value
//   AC-5 stale + mode spot/manual → computeGoldbackEstimatedRate(spot.gold), est
//   AC-6 stale + mode api → null
//   AC-7 mode off → null
//   isGoldbackStale(entry): true iff (now − entry.ts) > entry.staleAfter
//
// Harness: js/spot-ratio-chips.js is a script-tag-global module (no ESM/CJS
// exports — it assigns onto `window`). Mirroring diff-engine-normalization.test.js,
// the whole file is evaluated with a mock `window` via new Function("window", src).
// The module reads goldback collaborators as bare globals, so the same object is
// shared as `globalThis` AND `window`, letting the tests inject doubles + freeze
// "now" deterministically (never the real Date).

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/spot-ratio-chips.js", import.meta.url), "utf-8");

// Build a fresh module surface. The module assigns its functions onto `window`;
// it also reads goldback collaborators (goldbackPricingSource, spotPrices,
// getGoldbackDenominationPrice, computeGoldbackEstimatedRate, isGoldbackStale) as
// bare globals — so we share ONE object as both the window arg and globalThis.
function loadModule(env = {}) {
  const surface = { ...env };
  // Document/DOM helpers are irrelevant to the math layer but referenced by the
  // render functions; provide harmless no-ops so evaluation never throws.
  if (!surface.document) {
    surface.document = { getElementById: () => null, querySelector: () => null };
  }
  if (!surface.safeGetElement) surface.safeGetElement = () => null;
  if (!surface.debugLog) surface.debugLog = () => {};

  // Expose injected collaborators as real globals for the duration of the load +
  // calls, since the module body references them unqualified.
  const injectedKeys = Object.keys(surface);
  const saved = {};
  for (const k of injectedKeys) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    globalThis[k] = surface[k];
  }

  new Function("window", src)(surface);

  return {
    surface,
    restore() {
      for (const k of injectedKeys) {
        if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
        else delete globalThis[k];
      }
    },
  };
}

// =============================================================================
// AC-1 — computeRatio = gold ÷ metal
// =============================================================================
describe("AC-1 computeRatio = gold ÷ metal", () => {
  let mod;
  beforeEach(() => {
    mod = loadModule();
  });
  afterEach(() => mod.restore());

  test("AC-1: Au 4328.97 / Ag 67.84 ≈ 63.8 (issue GSR example)", () => {
    const ratio = mod.surface.computeRatio(4328.97, 67.84);
    assert.ok(typeof ratio === "number", "computeRatio must return a number");
    assert.ok(Math.abs(ratio - 63.8) < 0.05, `expected ≈63.8, got ${ratio}`);
  });

  test("AC-1: Au/Pt = 4328.97 / 1778.07 ≈ 2.43", () => {
    const ratio = mod.surface.computeRatio(4328.97, 1778.07);
    assert.ok(Math.abs(ratio - 2.43) < 0.01, `expected ≈2.43, got ${ratio}`);
  });

  test("AC-1: Au/Pd = 4328.97 / 1225.67 ≈ 3.53", () => {
    const ratio = mod.surface.computeRatio(4328.97, 1225.67);
    assert.ok(Math.abs(ratio - 3.53) < 0.01, `expected ≈3.53, got ${ratio}`);
  });

  test("AC-1: exact division (10 ÷ 2 = 5)", () => {
    assert.equal(mod.surface.computeRatio(10, 2), 5);
  });
});

// =============================================================================
// AC-2 — formatRatio decimals: GSR 1dp, Au:Pt/Au:Pd 2dp, goldback 2dp
// =============================================================================
describe("AC-2 formatRatio decimal places", () => {
  let mod;
  beforeEach(() => {
    mod = loadModule();
  });
  afterEach(() => mod.restore());

  test("AC-2: GSR formats to 1 decimal place", () => {
    assert.equal(mod.surface.formatRatio(63.8245, 1), "63.8");
  });

  test("AC-2: Au:Pt formats to 2 decimal places", () => {
    assert.equal(mod.surface.formatRatio(2.4346, 2), "2.43");
  });

  test("AC-2: Au:Pd formats to 2 decimal places", () => {
    assert.equal(mod.surface.formatRatio(3.5321, 2), "3.53");
  });

  test("AC-2: goldback rate formats to 2 decimal places (rounds 8.6789 → 8.68)", () => {
    assert.equal(mod.surface.formatRatio(8.6789, 2), "8.68");
  });

  test("AC-2: 1dp rounds half up (63.85 → 63.9 or 63.8 — fixed-decimal, never raw)", () => {
    const out = mod.surface.formatRatio(63.84, 1);
    assert.equal(out, "63.8");
  });
});

// =============================================================================
// AC-3 — guard: required spot ≤ 0 or non-finite → null, NEVER Infinity/NaN
// =============================================================================
describe("AC-3 computeRatio guards against bad inputs (never Infinity/NaN)", () => {
  let mod;
  beforeEach(() => {
    mod = loadModule();
  });
  afterEach(() => mod.restore());

  test("AC-3: zero denominator → null (not Infinity)", () => {
    const r = mod.surface.computeRatio(4328.97, 0);
    assert.equal(r, null, "must return null, never Infinity");
  });

  test("AC-3: zero numerator → null", () => {
    assert.equal(mod.surface.computeRatio(0, 67.84), null);
  });

  test("AC-3: negative denominator → null", () => {
    assert.equal(mod.surface.computeRatio(4328.97, -67.84), null);
  });

  test("AC-3: negative numerator → null", () => {
    assert.equal(mod.surface.computeRatio(-1, 67.84), null);
  });

  test("AC-3: NaN input → null (not NaN)", () => {
    const r = mod.surface.computeRatio(NaN, 67.84);
    assert.equal(r, null);
    assert.ok(!Number.isNaN(r), "must never propagate NaN");
  });

  test("AC-3: Infinity input → null", () => {
    assert.equal(mod.surface.computeRatio(Infinity, 67.84), null);
  });

  test("AC-3: undefined / missing spot → null", () => {
    assert.equal(mod.surface.computeRatio(undefined, 67.84), null);
    assert.equal(mod.surface.computeRatio(4328.97, undefined), null);
  });
});

// =============================================================================
// isGoldbackStale(entry): true iff (now − entry.ts) > entry.staleAfter
// "now" controlled deterministically by freezing Date.now (never the real clock).
// =============================================================================
describe("isGoldbackStale — deterministic freshness window", () => {
  const FROZEN_NOW = 1_700_000_000_000; // fixed reference instant (ms)
  let mod;
  let realDateNow;

  beforeEach(() => {
    realDateNow = Date.now;
    Date.now = () => FROZEN_NOW;
    mod = loadModule({ Date });
  });
  afterEach(() => {
    Date.now = realDateNow;
    mod.restore();
  });

  test("fresh: (now − ts) < staleAfter → not stale", () => {
    const entry = { ts: FROZEN_NOW - 1000, staleAfter: 90000 };
    assert.equal(mod.surface.isGoldbackStale(entry), false);
  });

  test("stale: (now − ts) > staleAfter → stale", () => {
    const entry = { ts: FROZEN_NOW - 90001, staleAfter: 90000 };
    assert.equal(mod.surface.isGoldbackStale(entry), true);
  });

  test("boundary: (now − ts) === staleAfter → NOT stale (strictly greater)", () => {
    const entry = { ts: FROZEN_NOW - 90000, staleAfter: 90000 };
    assert.equal(mod.surface.isGoldbackStale(entry), false);
  });
});

// =============================================================================
// resolveGoldbackRate — fresh/stale × pricing-mode matrix (AC-4..AC-7)
// =============================================================================
describe("resolveGoldbackRate — fresh/stale × mode matrix", () => {
  const FROZEN_NOW = 1_700_000_000_000;
  const FRESH = { ts: FROZEN_NOW - 1000, staleAfter: 90000 };
  const STALE = { ts: FROZEN_NOW - 90001, staleAfter: 90000 };
  let realDateNow;

  function build({ mode, entry, g1, goldSpot, estimate }) {
    return loadModule({
      Date,
      goldbackPricingSource: mode,
      spotPrices: { gold: goldSpot },
      // Cached goldback entry the resolver inspects for freshness + value.
      goldbackPrices: { 1: entry, 1: entry },
      getGoldbackDenominationPrice: (w) => (String(w) === "1" ? g1 : null),
      computeGoldbackEstimatedRate: () => estimate,
    });
  }

  beforeEach(() => {
    realDateNow = Date.now;
    Date.now = () => FROZEN_NOW;
  });
  afterEach(() => {
    Date.now = realDateNow;
  });

  test("AC-4: fresh cache, mode=api → cache g1 value, not flagged est", () => {
    const mod = build({ mode: "api", entry: FRESH, g1: 8.68, goldSpot: 4328.97, estimate: 9.99 });
    const res = mod.surface.resolveGoldbackRate();
    mod.restore();
    assert.ok(res && typeof res === "object", "must return {value, est} on a fresh hit");
    assert.equal(res.value, 8.68, "must surface the cached G1 rate");
    assert.notEqual(res.est, true, "a fresh cache value is NOT an estimate");
  });

  test("AC-4: fresh cache, mode=spot → cache g1 value (cache wins over estimate when fresh)", () => {
    const mod = build({ mode: "spot", entry: FRESH, g1: 8.68, goldSpot: 4328.97, estimate: 9.99 });
    const res = mod.surface.resolveGoldbackRate();
    mod.restore();
    assert.ok(res, "fresh cache must resolve");
    assert.equal(res.value, 8.68);
  });

  test("AC-5: stale cache, mode=spot → computeGoldbackEstimatedRate(gold), flagged est", () => {
    const mod = build({ mode: "spot", entry: STALE, g1: 8.68, goldSpot: 4328.97, estimate: 8.91 });
    const res = mod.surface.resolveGoldbackRate();
    mod.restore();
    assert.ok(res && typeof res === "object", "stale+spot must fall back to the estimate");
    assert.equal(res.value, 8.91, "value must come from computeGoldbackEstimatedRate(spot.gold)");
    assert.equal(res.est, true, "the spot estimate must be flagged est:true");
  });

  test("AC-5: stale cache, mode=manual → computeGoldbackEstimatedRate(gold), flagged est", () => {
    const mod = build({
      mode: "manual",
      entry: STALE,
      g1: 8.68,
      goldSpot: 4328.97,
      estimate: 8.91,
    });
    const res = mod.surface.resolveGoldbackRate();
    mod.restore();
    assert.ok(res, "stale+manual must fall back to the estimate");
    assert.equal(res.value, 8.91);
    assert.equal(res.est, true);
  });

  test("AC-6: stale cache, mode=api → null (a stale API rate is no valid current G1)", () => {
    const mod = build({ mode: "api", entry: STALE, g1: 8.68, goldSpot: 4328.97, estimate: 8.91 });
    const res = mod.surface.resolveGoldbackRate();
    mod.restore();
    assert.equal(res, null, "stale + api must hide the chip (return null)");
  });

  test("AC-7: mode=off → null regardless of cache freshness", () => {
    const mod = build({ mode: "off", entry: FRESH, g1: 8.68, goldSpot: 4328.97, estimate: 8.91 });
    const res = mod.surface.resolveGoldbackRate();
    mod.restore();
    assert.equal(res, null, "mode=off must always return null");
  });
});

// Unit tests for spot-card ratio chips (STRK-161).
//
// These tests ENCODE the sketch acceptance criteria (AC-1..AC-7) for the pure
// math / freshness / estimate layer in js/spot-ratio-math.js and verify the
// implemented computeRatio / formatRatio / resolveGoldbackRate / isGoldbackStale.
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
// Harness: js/spot-ratio-math.js is a script-tag-global module (no ESM/CJS
// exports — it assigns onto `window`). Mirroring diff-engine-normalization.test.js,
// the whole file is evaluated with a mock `window` via new Function("window", src).
// The module reads goldback collaborators as bare globals, so the same object is
// shared as `globalThis` AND `window`, letting the tests inject doubles + freeze
// "now" deterministically (never the real Date).

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Math/freshness/resolve functions live in spot-ratio-math.js (render layer is in
// spot-ratio-chips.js); this unit file tests the math layer.
const src = readFileSync(new URL("../../js/spot-ratio-math.js", import.meta.url), "utf-8");

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

// Registers beforeEach/afterEach that load a plain module (no env overrides) into
// `ctx.mod`. Used by AC-1, AC-2, AC-3 which need no clock or collaborator injection.
function useSimpleMod(ctx) {
  beforeEach(() => {
    ctx.mod = loadModule();
  });
  afterEach(() => ctx.mod.restore());
}

// =============================================================================
// Shared frozen-clock constants used by isGoldbackStale, resolveGoldbackRate,
// and selectGoldbackG1Seed. All three describe blocks freeze Date.now to
// FROZEN_NOW so that seconds-based staleness windows are deterministic.
// =============================================================================
const FROZEN_NOW = 1_700_000_000_000; // fixed reference instant (ms)
const FRESH = { ts: Math.floor(FROZEN_NOW / 1000) - 1000, staleAfter: 90000 };
const STALE = { ts: Math.floor(FROZEN_NOW / 1000) - 90001, staleAfter: 90000 };

// =============================================================================
// AC-1 — computeRatio = gold ÷ metal
// =============================================================================
describe("AC-1 computeRatio = gold ÷ metal", () => {
  const ctx = {};
  useSimpleMod(ctx);

  test("AC-1: Au 4328.97 / Ag 67.84 ≈ 63.8 (issue GSR example)", () => {
    const ratio = ctx.mod.surface.computeRatio(4328.97, 67.84);
    assert.ok(typeof ratio === "number", "computeRatio must return a number");
    assert.ok(Math.abs(ratio - 63.8) < 0.05, `expected ≈63.8, got ${ratio}`);
  });

  test("AC-1: Au/Pt = 4328.97 / 1778.07 ≈ 2.43", () => {
    const ratio = ctx.mod.surface.computeRatio(4328.97, 1778.07);
    assert.ok(Math.abs(ratio - 2.43) < 0.01, `expected ≈2.43, got ${ratio}`);
  });

  test("AC-1: Au/Pd = 4328.97 / 1225.67 ≈ 3.53", () => {
    const ratio = ctx.mod.surface.computeRatio(4328.97, 1225.67);
    assert.ok(Math.abs(ratio - 3.53) < 0.01, `expected ≈3.53, got ${ratio}`);
  });

  test("AC-1: exact division (10 ÷ 2 = 5)", () => {
    assert.equal(ctx.mod.surface.computeRatio(10, 2), 5);
  });
});

// =============================================================================
// AC-2 — formatRatio decimals: GSR 1dp, Au:Pt/Au:Pd 2dp, goldback 2dp
// =============================================================================
describe("AC-2 formatRatio decimal places", () => {
  const ctx = {};
  useSimpleMod(ctx);

  test("AC-2: GSR formats to 1 decimal place", () => {
    assert.equal(ctx.mod.surface.formatRatio(63.8245, 1), "63.8");
  });

  test("AC-2: Au:Pt formats to 2 decimal places", () => {
    assert.equal(ctx.mod.surface.formatRatio(2.4346, 2), "2.43");
  });

  test("AC-2: Au:Pd formats to 2 decimal places", () => {
    assert.equal(ctx.mod.surface.formatRatio(3.5321, 2), "3.53");
  });

  test("AC-2: goldback rate formats to 2 decimal places (rounds 8.6789 → 8.68)", () => {
    assert.equal(ctx.mod.surface.formatRatio(8.6789, 2), "8.68");
  });

  test("AC-2: 1dp rounds half up (63.85 → 63.9 or 63.8 — fixed-decimal, never raw)", () => {
    const out = ctx.mod.surface.formatRatio(63.84, 1);
    assert.equal(out, "63.8");
  });
});

// =============================================================================
// AC-3 — guard: required spot ≤ 0 or non-finite → null, NEVER Infinity/NaN
// =============================================================================
describe("AC-3 computeRatio guards against bad inputs (never Infinity/NaN)", () => {
  const ctx = {};
  useSimpleMod(ctx);

  test("AC-3: zero denominator → null (not Infinity)", () => {
    const r = ctx.mod.surface.computeRatio(4328.97, 0);
    assert.equal(r, null, "must return null, never Infinity");
  });

  test("AC-3: zero numerator → null", () => {
    assert.equal(ctx.mod.surface.computeRatio(0, 67.84), null);
  });

  test("AC-3: negative denominator → null", () => {
    assert.equal(ctx.mod.surface.computeRatio(4328.97, -67.84), null);
  });

  test("AC-3: negative numerator → null", () => {
    assert.equal(ctx.mod.surface.computeRatio(-1, 67.84), null);
  });

  test("AC-3: NaN input → null (not NaN)", () => {
    const r = ctx.mod.surface.computeRatio(NaN, 67.84);
    assert.equal(r, null);
    assert.ok(!Number.isNaN(r), "must never propagate NaN");
  });

  test("AC-3: Infinity input → null", () => {
    assert.equal(ctx.mod.surface.computeRatio(Infinity, 67.84), null);
  });

  test("AC-3: undefined / missing spot → null", () => {
    assert.equal(ctx.mod.surface.computeRatio(undefined, 67.84), null);
    assert.equal(ctx.mod.surface.computeRatio(4328.97, undefined), null);
  });
});

// =============================================================================
// isGoldbackStale(entry): true iff (now − entry.ts) > entry.staleAfter
// "now" controlled deterministically by freezing Date.now (never the real clock).
// =============================================================================
describe("isGoldbackStale — deterministic freshness window", () => {
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
    const entry = { ts: Math.floor(FROZEN_NOW / 1000) - 1000, staleAfter: 90000 };
    assert.equal(mod.surface.isGoldbackStale(entry), false);
  });

  test("stale: (now − ts) > staleAfter → stale", () => {
    const entry = { ts: Math.floor(FROZEN_NOW / 1000) - 90001, staleAfter: 90000 };
    assert.equal(mod.surface.isGoldbackStale(entry), true);
  });

  test("boundary: (now − ts) === staleAfter → NOT stale (strictly greater)", () => {
    const entry = { ts: Math.floor(FROZEN_NOW / 1000) - 90000, staleAfter: 90000 };
    assert.equal(mod.surface.isGoldbackStale(entry), false);
  });
});

// =============================================================================
// resolveGoldbackRate — fresh/stale × pricing-mode matrix (AC-4..AC-7)
// =============================================================================
describe("resolveGoldbackRate — fresh/stale × mode matrix", () => {
  let realDateNow;

  function build({ mode, entry, g1, goldSpot, estimate }) {
    return loadModule({
      Date,
      goldbackPricingSource: mode,
      spotPrices: { gold: goldSpot },
      // Cached goldback entry the resolver inspects for freshness + value.
      goldbackPrices: { 1: entry },
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

// =============================================================================
// AC-6 — selectGoldbackG1Seed(isOnline): pure premium seed-selection helper
//
// C.4 extracts this pure helper INTO js/spot-ratio-math.js, beside
// readFreshCachedGoldback, reading the same bare goldback globals
// (goldbackPrices, getGoldbackDenominationPrice, isGoldbackStale). It governs
// which G1 value seeds the premium chip:
//   - isOnline === true  → readFreshCachedGoldback() — fresh + positive
//     goldbackPrices['1'] only; NEVER paint a stale value online (no stale
//     online paint).
//   - isOnline === false → the last-known G1 (getGoldbackDenominationPrice(1)
//     if > 0) EVEN IF stale, returned plain with no marker (US-5 / Non-Goal #1
//     offline-display preservation).
//   - absent / non-positive goldbackPrices['1'] → null in BOTH modes.
//
// RED until C.4 creates the helper — selectGoldbackG1Seed is undefined here.
// "now" is frozen via Date.now so the seconds-based staleness window
// (isGoldbackStale / readFreshCachedGoldback) is deterministic — NOT the 25h
// getGoldbackPriceInfo reader.
// =============================================================================
describe("AC-6 selectGoldbackG1Seed — premium seed-selection (online vs offline × fresh/stale)", () => {
  // Difference === staleAfter is the staleness EDGE: strictly-greater means this
  // is NOT stale, so it must behave exactly like a fresh entry online.
  const EDGE = { ts: Math.floor(FROZEN_NOW / 1000) - 90000, staleAfter: 90000 };
  let realDateNow;

  // Mirrors the resolveGoldbackRate build(): the cache entry lives at
  // goldbackPrices['1'] for the freshness probe, and getGoldbackDenominationPrice(1)
  // surfaces the last-known G1 value (the same seam readFreshCachedGoldback reads).
  function build({ entry, g1 }) {
    return loadModule({
      Date,
      goldbackPrices: { 1: entry },
      getGoldbackDenominationPrice: (w) => (String(w) === "1" ? g1 : null),
    });
  }

  beforeEach(() => {
    realDateNow = Date.now;
    Date.now = () => FROZEN_NOW;
  });
  afterEach(() => {
    Date.now = realDateNow;
  });

  test("fresh + positive, online → returns that fresh G1 value", () => {
    const mod = build({ entry: FRESH, g1: 8.68 });
    const seed = mod.surface.selectGoldbackG1Seed(true);
    mod.restore();
    assert.equal(seed, 8.68, "fresh online must seed the cached G1 value");
  });

  test("fresh + positive, offline → also returns that G1 value", () => {
    const mod = build({ entry: FRESH, g1: 8.68 });
    const seed = mod.surface.selectGoldbackG1Seed(false);
    mod.restore();
    assert.equal(seed, 8.68, "fresh offline must seed the last-known G1 value");
  });

  test("stale, online → null (declines to seed a stale value, no stale online paint)", () => {
    const mod = build({ entry: STALE, g1: 8.68 });
    const seed = mod.surface.selectGoldbackG1Seed(true);
    mod.restore();
    assert.equal(seed, null, "online must NEVER paint a stale G1 value");
  });

  test("stale, offline → returns the last-known value plain (no marker — US-5)", () => {
    const mod = build({ entry: STALE, g1: 8.68 });
    const seed = mod.surface.selectGoldbackG1Seed(false);
    mod.restore();
    assert.equal(seed, 8.68, "offline must surface the last-known G1 even when stale");
    assert.equal(typeof seed, "number", "offline seed is a plain number, never a marker object");
  });

  test("absent goldbackPrices['1'] → null in both modes", () => {
    const mod = build({ entry: undefined, g1: 0 });
    const online = mod.surface.selectGoldbackG1Seed(true);
    const offline = mod.surface.selectGoldbackG1Seed(false);
    mod.restore();
    assert.equal(online, null, "absent cache → null online");
    assert.equal(offline, null, "absent cache → null offline");
  });

  test("non-positive G1 (0) → null in both modes", () => {
    const mod = build({ entry: FRESH, g1: 0 });
    const online = mod.surface.selectGoldbackG1Seed(true);
    const offline = mod.surface.selectGoldbackG1Seed(false);
    mod.restore();
    assert.equal(online, null, "non-positive G1 → null online");
    assert.equal(offline, null, "non-positive G1 → null offline");
  });

  test("boundary: entry exactly AT the staleness edge → treated as fresh online", () => {
    const mod = build({ entry: EDGE, g1: 8.68 });
    const seed = mod.surface.selectGoldbackG1Seed(true);
    mod.restore();
    assert.equal(seed, 8.68, "difference === staleAfter is NOT stale (strictly greater)");
  });
});

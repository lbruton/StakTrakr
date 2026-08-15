// Unit tests for STRK-303: derive spot prices deterministically, and size the
// sanity bounds per metal.
//
// Copper is the first tracked metal worth less than $1/troy ounce, and it broke
// two assumptions that had held only because every previous metal was worth
// hundreds or thousands of dollars.
//
// 1. spot-extract.js guessed which direction a MetalPriceAPI figure pointed:
//        const price = rate >= 1 ? round2(rate) : round2(1 / rate);
//    With `base=USD` the bare `XAU`/`XAG`/... keys are RECIPROCALS — troy ounces
//    per USD — so gold arrives as 0.000228 and inverting it is correct. Copper
//    arrives as 2.4235, which is >= 1, so the guess skipped the inversion and
//    returned $2.42 instead of $0.4126. The guess was never load-bearing: the
//    same response also carries `USDXAU`/`USDXCU`/... holding the direct USD
//    price, which is what the code's own comment always claimed to read.
//
// 2. A single global sanity range (`price < 5 || price > 50000`) cannot span
//    metals four orders of magnitude apart. A CORRECT copper price fails that
//    floor by 12x, and the resulting throw is caught upstream and turned into
//    process.exit(1) — so it did not drop copper, it killed the whole poll run
//    and took gold, silver, platinum and palladium down with it.
//
// Fixture values below are a live /v1/latest?base=USD probe taken 2026-08-15
// (unix 1786763020), not invented numbers. Platinum and palladium match the
// prices rendered in the app to the cent.
//
// Run: npm run test:unit

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  METAL_MAP,
  METAL_ORDER,
  SPOT_METAL_KEYS,
  METAL_PRICE_BOUNDS,
  derivePrice,
  assertPriceInRange,
  roundPrice,
} from "../../devops/pollers/shared/spot-metals.js";
import { computeOhlca } from "../../devops/pollers/shared/v2-utils.js";

/** Live MetalPriceAPI `rates` payload, probed 2026-08-15. */
const LIVE_RATES = {
  XAU: 0.0002285,
  XAG: 0.01545747,
  XPT: 0.00057155,
  XPD: 0.0007596,
  XCU: 2.42350016,
  USDXAU: 4376.4327,
  USDXAG: 64.6936,
  USDXPT: 1749.6365,
  USDXPD: 1316.4839,
  USDXCU: 0.4126,
};

/** What each symbol must resolve to, from the same probe. */
const EXPECTED_USD = {
  XAU: 4376.4327,
  XAG: 64.6936,
  XPT: 1749.6365,
  XPD: 1316.4839,
  XCU: 0.4126,
};

describe("METAL_MAP and its derived lists", () => {
  it("carries all five metals, with copper appended LAST", () => {
    const symbols = Object.keys(METAL_MAP);
    assert.deepEqual(symbols, ["XAU", "XAG", "XPT", "XPD", "XCU"]);
    assert.equal(symbols.at(-1), "XCU", "copper must be last — insertion order drives entry order");
  });

  it("maps symbols to capitalised display names", () => {
    assert.equal(METAL_MAP.XCU, "Copper");
    assert.equal(METAL_MAP.XAU, "Gold");
  });

  it("derives METAL_ORDER as capitalised names in map order", () => {
    assert.deepEqual(METAL_ORDER, ["Gold", "Silver", "Platinum", "Palladium", "Copper"]);
  });

  it("derives SPOT_METAL_KEYS as lowercase database keys in map order", () => {
    assert.deepEqual(SPOT_METAL_KEYS, ["gold", "silver", "platinum", "palladium", "copper"]);
  });

  it("keeps the legacy four first so existing JSON entry order is unchanged", () => {
    assert.deepEqual(METAL_ORDER.slice(0, 4), ["Gold", "Silver", "Platinum", "Palladium"]);
  });

  it("defines price bounds for every metal in the map", () => {
    for (const symbol of Object.keys(METAL_MAP)) {
      assert.ok(METAL_PRICE_BOUNDS[symbol], `missing bounds for ${symbol}`);
    }
  });
});

describe("derivePrice", () => {
  it("returns the direct USD price for every metal", () => {
    for (const [symbol, expected] of Object.entries(EXPECTED_USD)) {
      assert.equal(derivePrice(LIVE_RATES, symbol), expected, `wrong price for ${symbol}`);
    }
  });

  it("returns copper at ~$0.41/ozt, NOT the ~$2.42 the old heuristic produced", () => {
    const copper = derivePrice(LIVE_RATES, "XCU");
    assert.ok(copper > 0.3 && copper < 0.6, `copper resolved to ${copper}, expected ~0.41`);
    assert.ok(copper < 1, "copper must be sub-dollar — >1 means the reciprocal leaked through");
  });

  it("falls back to inverting the bare reciprocal when the direct key is absent", () => {
    const reciprocalOnly = { XCU: 2.42350016 };
    const price = derivePrice(reciprocalOnly, "XCU");
    assert.ok(Math.abs(price - 0.4126) < 0.0001, `fallback gave ${price}`);
  });

  it("inverts correctly for a metal worth far more than $1", () => {
    const reciprocalOnly = { XAU: 0.0002285 };
    const price = derivePrice(reciprocalOnly, "XAU");
    // Compared as a RELATIVE error, not an absolute one. The fixture reciprocal
    // is the probe value rounded to 8 decimal places, which at a magnitude of
    // 2e-4 leaves only about four significant figures — so inverting it cannot
    // reproduce USDXAU to the cent. Do not re-tighten this to an absolute delta.
    const relativeError = Math.abs(price - 4376.4327) / 4376.4327;
    assert.ok(relativeError < 0.001, `fallback gave ${price} (relative error ${relativeError})`);
  });

  it("never uses magnitude to choose a direction", () => {
    // Both keys present but disagreeing: the direct key must win outright,
    // regardless of which side of 1 either value sits on.
    const conflicting = { XCU: 2.42350016, USDXCU: 0.4126 };
    assert.equal(derivePrice(conflicting, "XCU"), 0.4126);
  });

  it("throws when neither key is present", () => {
    assert.throws(() => derivePrice({ XAU: 0.0002285 }, "XCU"), /XCU/);
  });

  it("throws on a zero rate rather than dividing by it", () => {
    assert.throws(() => derivePrice({ XCU: 0, USDXCU: 0 }, "XCU"), /XCU/);
  });

  it("throws on a missing rates object", () => {
    assert.throws(() => derivePrice(undefined, "XCU"), /XCU/);
  });
});

describe("assertPriceInRange", () => {
  it("accepts every live probe value", () => {
    for (const [symbol, price] of Object.entries(EXPECTED_USD)) {
      assert.doesNotThrow(
        () => assertPriceInRange(symbol, METAL_MAP[symbol], price),
        `${symbol} at ${price} should be in range`
      );
    }
  });

  it("accepts a correct copper price that the old global floor rejected", () => {
    // The old guard was `price < 5`, so $0.4126 threw and killed the run.
    assert.doesNotThrow(() => assertPriceInRange("XCU", "Copper", 0.4126));
  });

  it("rejects a copper price that could only come from a unit or feed error", () => {
    // Deliberately NOT asserting that bounds reject the old heuristic's $2.42.
    // That is ~6x today's copper and sits inside any honest plausible range —
    // a bound tight enough to catch it would fire falsely in a bull market.
    // The guarantee against the inversion bug is structural (derivePrice reads
    // the direct key) and is asserted in the derivePrice suite above. Bounds
    // exist to catch a metal priced like a different metal entirely.
    assert.throws(() => assertPriceInRange("XCU", "Copper", 500), /Copper/);
  });

  it("rejects a gold price that is plausible for copper", () => {
    assert.throws(() => assertPriceInRange("XAU", "Gold", 0.41), /Gold/);
  });

  it("rejects an absurdly high value per metal", () => {
    assert.throws(() => assertPriceInRange("XAG", "Silver", 500000), /Silver/);
  });

  it("throws for a metal with no bounds defined", () => {
    assert.throws(() => assertPriceInRange("XZZ", "Unobtainium", 10), /XZZ/);
  });
});

describe("roundPrice", () => {
  it("keeps two decimals for prices at or above $1", () => {
    assert.equal(roundPrice(4376.4327), 4376.43);
    assert.equal(roundPrice(64.6936), 64.69);
    assert.equal(roundPrice(1749.6365), 1749.64);
  });

  it("keeps four decimals below $1 so copper is not quantised away", () => {
    assert.equal(roundPrice(0.4126), 0.4126);
  });

  it("does not degrade copper by the ~0.6% the old round2 cost", () => {
    const exact = 0.4126;
    const stored = roundPrice(exact);
    const errorPct = (Math.abs(stored - exact) / exact) * 100;
    assert.ok(errorPct < 0.01, `rounding error ${errorPct}% is too large for a sub-dollar metal`);
  });

  it("leaves the legacy four metals' precision unchanged", () => {
    // Regression guard: these are what round2 produced before STRK-303.
    assert.equal(roundPrice(1316.4839), 1316.48);
    assert.equal(roundPrice(0.4126) > 0, true);
  });
});

describe("computeOhlca avg precision (shared with the retail export)", () => {
  const sample = (price, t) => ({ price, timestamp: t });

  it("no longer publishes an avg that contradicts high/low for a sub-dollar metal", () => {
    // open/high/low/close pass through raw, so a flat 2-decimal avg used to
    // emit avg: 0.41 beside high: 0.4131 in the same object.
    const bucket = computeOhlca([
      sample(0.4121, "2026-08-15T00:00:00Z"),
      sample(0.4131, "2026-08-15T00:15:00Z"),
    ]);
    assert.equal(bucket.avg, 0.4126);
    assert.ok(
      bucket.avg >= bucket.low && bucket.avg <= bucket.high,
      `avg ${bucket.avg} fell outside [${bucket.low}, ${bucket.high}]`
    );
  });

  it("is byte-identical to the old behaviour at or above $1 — retail is untouched", () => {
    const bucket = computeOhlca([
      sample(34.21, "2026-08-15T00:00:00Z"),
      sample(34.28, "2026-08-15T00:15:00Z"),
    ]);
    assert.equal(bucket.avg, 34.25); // (34.21 + 34.28) / 2 = 34.245 -> 34.25
  });
});

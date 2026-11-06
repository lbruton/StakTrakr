// Unit tests for the Market premium colour: each dealer price is tiered against the
// median of the in-stock, non-carried prices for the same item.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evalSource, rangeOf, readSource } from "./helpers/source-extract.js";
import { sliceArrowConst } from "./test-helpers.js";

const marketSrc = readSource("js/market-data.js");
const rankDealerPrices = evalSource("js/market-data.js", {
  slice: [
    rangeOf(marketSrc, "const MARKET_PREMIUM_BAND_PCT = 1;"),
    rangeOf(marketSrc, sliceArrowConst(marketSrc, "const _rankDealerPrices = (")),
  ],
  suffix: "\nreturn _rankDealerPrices;",
});

/** Builds an in-stock entry. */
const live = (id, price) => ({ id, price, inStock: true, carried: false });

describe("_rankDealerPrices", () => {
  test("tiers a spread against the in-stock median", () => {
    const rank = rankDealerPrices([live("a", 36.5), live("b", 37), live("c", 40)]);
    assert.equal(rank.median, 37);
    assert.equal(rank.liveCount, 3);
    assert.equal(rank.byId.a.tier, "low");
    assert.equal(rank.byId.b.tier, "mid");
    assert.equal(rank.byId.c.tier, "high");
    assert.equal(rank.byId.b.distancePct, 0);
    assert.ok(Math.abs(rank.byId.c.distancePct - (3 / 37) * 100) < 1e-9);
  });

  test("an even count uses the mean of the two middle prices", () => {
    const rank = rankDealerPrices([live("a", 10), live("b", 20), live("c", 30), live("d", 40)]);
    assert.equal(rank.median, 25);
  });

  test("the band edges at exactly one percent are low and high", () => {
    const rank = rankDealerPrices([live("a", 99), live("m", 100), live("b", 101)]);
    assert.equal(rank.byId.a.tier, "low");
    assert.equal(rank.byId.m.tier, "mid");
    assert.equal(rank.byId.b.tier, "high");
    const inside = rankDealerPrices([live("a", 99.5), live("m", 100), live("b", 100.9)]);
    assert.equal(inside.byId.a.tier, "mid");
    assert.equal(inside.byId.b.tier, "mid");
  });

  test("a single dealer in stock is plain", () => {
    const rank = rankDealerPrices([live("a", 50), { id: "b", price: 48, inStock: false }]);
    assert.equal(rank.median, 50);
    assert.equal(rank.liveCount, 1);
    assert.deepEqual({ ...rank.byId.a }, { tier: "plain", distancePct: null, only: true });
    assert.equal(rank.byId.b, undefined);
  });

  test("no dealer in stock gives no median", () => {
    const rank = rankDealerPrices([{ id: "a", price: 50, inStock: false }]);
    assert.equal(rank.median, null);
    assert.equal(rank.liveCount, 0);
    assert.equal(rank.byId.a, undefined);
  });

  test("a carried price is plain and is left out of the median", () => {
    const rank = rankDealerPrices([
      live("a", 36.5),
      live("b", 37),
      live("c", 40),
      { id: "g", price: 10, inStock: true, carried: true },
    ]);
    assert.equal(rank.median, 37);
    assert.equal(rank.liveCount, 3);
    assert.deepEqual({ ...rank.byId.g }, { tier: "plain", distancePct: null, only: false });
    assert.equal(rank.byId.a.tier, "low");
  });

  test("a missing or zero price is not ranked", () => {
    const rank = rankDealerPrices([live("a", 0), live("b", null), live("c", 20), live("d", 22)]);
    assert.equal(rank.median, 21);
    assert.equal(rank.byId.a, undefined);
    assert.equal(rank.byId.b, undefined);
  });
});

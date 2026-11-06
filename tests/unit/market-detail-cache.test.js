// Unit tests for the Market detail cache that a sync clears.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evalSource, rangeOf, readSource } from "./helpers/source-extract.js";
import { sliceArrowConst } from "./test-helpers.js";

const marketSrc = readSource("js/market-data.js");
const SLUG = "core-alpha-silver";

/**
 * Loads the cache and _resolveVendorDetailMap with a latest.json fetch the test resolves.
 * @returns {{resolve: Function, clear: Function, cache: Function, answer: Function}}
 */
const loadDetailCache = () => {
  let answer = null;
  const api = evalSource("js/market-data.js", {
    params: {
      _getCachedRetailDetail: (slug, coins) =>
        coins && coins[slug] && coins[slug].vendors ? { ...coins[slug] } : null,
      _snapshotWindowTime: () => null,
      _detailWindowTime: () => null,
      _strictMarketFreshness: () => true,
      _marketV2Fetch: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    },
    slice: [
      rangeOf(marketSrc, "let _cachedSlugDetail = {};\nlet _cachedSlugDetailGeneration = 0;"),
      rangeOf(marketSrc, sliceArrowConst(marketSrc, "const _clearCachedSlugDetail = (")),
      rangeOf(marketSrc, sliceArrowConst(marketSrc, "const _resolveVendorDetailMap = async (")),
    ],
    suffix:
      "\nreturn { resolve: _resolveVendorDetailMap, clear: _clearCachedSlugDetail, cache: () => _cachedSlugDetail };",
  });
  return { ...api, answer: (data) => answer({ data }) };
};

const FETCHED = { vendors: { apmex: { price: 38, inStock: true } } };

describe("_resolveVendorDetailMap cache writes", () => {
  test("a fetched detail is cached for the next render", async () => {
    const detail = loadDetailCache();
    const pending = detail.resolve([{ slug: SLUG }], {});
    detail.answer(FETCHED);
    const map = await pending;
    assert.equal(map[SLUG].vendors.apmex.price, 38);
    assert.ok(detail.cache()[SLUG]);
  });

  test("a fetch that finishes after a sync clears the cache does not refill it", async () => {
    const detail = loadDetailCache();
    const pending = detail.resolve([{ slug: SLUG }], {});
    detail.clear();
    detail.answer(FETCHED);
    await pending;
    assert.deepEqual(detail.cache(), {});
  });
});

// Unit tests for the Market detail cache that a sync clears.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evalSource, rangeOf, readSource } from "./helpers/source-extract.js";
import { sliceArrowConst } from "./test-helpers.js";

const marketSrc = readSource("js/market-data.js");
const SLUG = "core-alpha-silver";
const CACHE_LETS =
  "let _cachedSlugDetail = {};\nlet _cachedSlugDetailGeneration = 0;\nlet _vendorTableRenderSeq = 0;";

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
      rangeOf(marketSrc, CACHE_LETS),
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

/**
 * Loads _renderVendorTable with detail fetches the test resolves in any order.
 * @returns {{render: Function, clear: Function, answers: Function[], drawn: string[]}}
 */
const loadVendorTable = () => {
  const answers = [];
  const drawn = [];
  const tableWrap = {};
  const api = evalSource("js/market-data.js", {
    params: {
      safeGetElement: () => ({ querySelector: () => tableWrap }),
      _getRetailCoins: () => ({}),
      _getCoinMeta: () => ({}),
      _getVendorMeta: () => ({}),
      _collectVendorTableRows: () => [{ slug: SLUG }],
      _renderVendorTableMessage: () => {},
      _resolveVendorDetailMap: () => new Promise((resolve) => answers.push(resolve)),
      // The first step after the fetch; the render stops at the empty vendor list.
      _collectEnabledVendorIds: (rows, detailMap) => {
        drawn.push(detailMap.label);
        return [];
      },
    },
    slice: [
      rangeOf(marketSrc, CACHE_LETS),
      rangeOf(marketSrc, sliceArrowConst(marketSrc, "const _clearCachedSlugDetail = (")),
      rangeOf(marketSrc, sliceArrowConst(marketSrc, "const _renderVendorTable = async (")),
    ],
    suffix: "\nreturn { render: _renderVendorTable, clear: _clearCachedSlugDetail };",
  });
  return { ...api, answers, drawn };
};

describe("_renderVendorTable supersede", () => {
  test("an older render that finishes last does not draw", async () => {
    const table = loadVendorTable();
    const older = table.render("all");
    const newer = table.render("xag");
    table.answers[1]({ label: "newer" });
    await newer;
    table.answers[0]({ label: "older" });
    await older;
    assert.deepEqual(table.drawn, ["newer"]);
  });

  test("a render from before a sync does not draw after the cache reset", async () => {
    const table = loadVendorTable();
    const before = table.render("all");
    table.clear();
    table.answers[0]({ label: "before" });
    await before;
    assert.deepEqual(table.drawn, []);
  });
});

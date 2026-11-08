// Unit tests for the price window that a Market "Last seen" tooltip names for a fresh price.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evalSource, rangeOf, readSource } from "./helpers/source-extract.js";
import { sliceArrowConst } from "./test-helpers.js";

const marketSrc = readSource("js/market-data.js");
const detailWindowTime = evalSource("js/market-data.js", {
  slice: [
    rangeOf(marketSrc, sliceArrowConst(marketSrc, "const _validTimestamp = (")),
    rangeOf(marketSrc, sliceArrowConst(marketSrc, "const _detailWindowTime = (")),
  ],
  suffix: "\nreturn _detailWindowTime;",
});

const SNAPSHOT = "2026-05-26T12:00:00.000Z";

/**
 * Loads _snapshotWindowTime against an in-memory snapshot and a storage map.
 * @param {(Object|undefined)} memory - window._v2RetailData, or undefined when unset.
 * @param {Object} stored - Storage values keyed by storage key.
 * @returns {Function} The bound _snapshotWindowTime.
 */
const snapshotWindowTimeWith = (memory, stored) =>
  evalSource("js/market-data.js", {
    params: {
      window: memory === undefined ? {} : { _v2RetailData: memory },
      loadDataSync: (key, fallback) => (key in stored ? stored[key] : fallback),
    },
    slice: [
      rangeOf(marketSrc, sliceArrowConst(marketSrc, "const _validTimestamp = (")),
      rangeOf(marketSrc, sliceArrowConst(marketSrc, "const _snapshotWindowTime = (")),
    ],
    suffix: "\nreturn _snapshotWindowTime;",
  });

describe("_snapshotWindowTime", () => {
  test("an in-memory snapshot without window_start falls through to storage", () => {
    const read = snapshotWindowTimeWith(
      { prices: {}, lastSync: SNAPSHOT },
      { v2RetailPrices: { window_start: SNAPSHOT } }
    );
    assert.equal(read(), SNAPSHOT);
  });

  test("the in-memory window wins when it is valid", () => {
    const read = snapshotWindowTimeWith(
      { window_start: "2026-05-25T00:00:00Z" },
      { v2RetailPrices: { window_start: SNAPSHOT } }
    );
    assert.equal(read(), "2026-05-25T00:00:00Z");
  });

  test("an unparseable v2 window falls through to the v1 key, else null", () => {
    const v1 = {
      v2RetailPrices: { window_start: "bad" },
      retailPrices: { window_start: SNAPSHOT },
    };
    assert.equal(snapshotWindowTimeWith(undefined, v1)(), SNAPSHOT);
    assert.equal(snapshotWindowTimeWith(undefined, {})(), null);
  });
});

describe("_detailWindowTime", () => {
  test("prefers the v2 window t over window_start and the snapshot", () => {
    const detail = { t: "2026-05-25T15:45:00Z", window_start: "2026-05-24T00:00:00Z" };
    assert.equal(detailWindowTime(detail, SNAPSHOT), "2026-05-25T15:45:00Z");
  });

  test("an unparseable t falls through to a valid window_start", () => {
    const detail = { t: "not-a-time", window_start: "2026-05-24T00:00:00Z" };
    assert.equal(detailWindowTime(detail, SNAPSHOT), "2026-05-24T00:00:00Z");
  });

  test("a detail with no valid window uses the snapshot window", () => {
    assert.equal(detailWindowTime({ t: "", window_start: "bad" }, SNAPSHOT), SNAPSHOT);
    assert.equal(detailWindowTime(null, SNAPSHOT), SNAPSHOT);
  });

  test("no window anywhere gives null, so the price gets no tooltip", () => {
    assert.equal(detailWindowTime({}, null), null);
  });
});

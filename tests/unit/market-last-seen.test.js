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

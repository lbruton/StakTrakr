// Pure helpers of the Collections link picker (js/collections-picker.js), sliced out of
// the script-tag IIFE so they run without a page.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evalSource, readSource, sliceBetween } from "./helpers/source-extract.js";

const PICKER_FILE = "js/collections-picker.js";

/** parseYearRange with the module's own MAX_YEAR_RANGE. */
function loadParseYearRange() {
  const src = readSource(PICKER_FILE);
  return evalSource(PICKER_FILE, {
    slice: [
      sliceBetween(src, "const MAX_YEAR_RANGE", ";"),
      sliceBetween(src, "const parseYearRange = (input) => {", "\n  };"),
    ],
    suffix: "\nreturn parseYearRange;",
  });
}

describe("collections picker — year-range shortcut", () => {
  const parse = loadParseYearRange();

  test("accepts sane ranges only", () => {
    assert.deepEqual(parse("1986-1990"), [1986, 1987, 1988, 1989, 1990], "a short range");
    assert.deepEqual(parse("1999"), [1999], "a single year");
    assert.equal(parse("2005-1986"), null, "a reversed range");
    assert.equal(parse("abc"), null, "text that is not a year");
    assert.equal(parse("1000-2999"), null, "a range at or above the limit");
  });
});

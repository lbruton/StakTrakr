// Goldback and Silverback detection in a Numista import: NumistaProvider.normalizeType
// (js/catalog-api.js) and parseGoldbackDenomination (js/catalog-numista-modal.js),
// sliced out of the script-tag sources so they run without a page.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evalSource,
  extractConstFn,
  rangeOf,
  readSource,
  sliceBetween,
} from "./helpers/source-extract.js";
import { sliceConstArray } from "./test-helpers.js";

const CATALOG_API_FILE = "js/catalog-api.js";
const NUMISTA_MODAL_FILE = "js/catalog-numista-modal.js";

/** NumistaProvider.normalizeType as a plain function; its body uses no `this`. */
function loadNormalizeType() {
  const src = readSource(CATALOG_API_FILE);
  const signature = 'normalizeType(category, contextText = "") ';
  const method = sliceBetween(src, `${signature}{`, "\n  }");
  return evalSource(CATALOG_API_FILE, {
    slice: { start: method.start + signature.length, end: method.end },
    opener: 'return (category, contextText = "") =>',
  });
}

/** parseGoldbackDenomination bound to the real GOLDBACK_DENOMINATIONS. */
function loadParseGoldbackDenomination() {
  const constantsSrc = readSource("js/constants.js");
  const GOLDBACK_DENOMINATIONS = evalSource("js/constants.js", {
    slice: rangeOf(constantsSrc, sliceConstArray(constantsSrc, "const GOLDBACK_DENOMINATIONS = [")),
    suffix: "\nreturn GOLDBACK_DENOMINATIONS;",
  });
  return extractConstFn(
    readSource(NUMISTA_MODAL_FILE),
    "parseGoldbackDenomination",
    { window: { GOLDBACK_DENOMINATIONS } },
    { file: NUMISTA_MODAL_FILE }
  );
}

describe("Numista import — Goldback and Silverback", () => {
  const normalizeType = loadNormalizeType();
  const parse = loadParseGoldbackDenomination();

  test("normalizeType reads Goldback and Silverback from the title under an Exonumia category", () => {
    assert.equal(normalizeType("Exonumia", "1/4 Idaho Goldback"), "Goldback", "a Goldback title");
    assert.equal(normalizeType("Exonumia", "1 Silverback"), "Silverback", "a Silverback title");
    assert.equal(
      normalizeType("Standard circulation coins", "1 Dollar"),
      "Coin",
      "a coin category"
    );
  });

  test("parseGoldbackDenomination parses exact fractions and rejects non-matches", () => {
    assert.equal(parse("1/4"), 0.25, "an ASCII fraction");
    assert.equal(parse("¼"), 0.25, "a Unicode fraction");
    assert.equal(parse("1/2"), 0.5, "a half");
    assert.equal(parse("1"), 1, "a whole denomination");
    assert.equal(parse("1/3"), null, "a fraction that is not a denomination");
    assert.equal(parse(""), null, "empty text");
    assert.equal(parse(".5"), 0.5, "a leading-decimal half");
    assert.equal(parse(".25"), 0.25, "a leading-decimal quarter");
  });
});

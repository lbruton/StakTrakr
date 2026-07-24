// Unit tests for parseDate (js/utils-format.js) — STRK-266 + STRK-267.
// Run: npm run test:unit  (node --test tests/unit/parse-date-local-frame.test.js)
//
// Bug under test: parseDate constructed `new Date(year, month, day)` (LOCAL
// midnight) and then formatted with `date.toISOString().split("T")[0]` (UTC).
// For any user in a positive UTC offset, local midnight is the previous UTC
// day, so "2026/01/05" came back as "2026-01-04". The fix formats the Date's
// LOCAL components via toLocaleDateString("en-CA") — never crossing frames.
//
// TZ is pinned to Pacific/Kiritimati (UTC+14, no DST — the maximal positive
// offset) BEFORE any Date use, so the frame-mixing bug reproduces regardless
// of the machine's own timezone. node --test runs each file in its own child
// process, so the pin cannot leak into other test files.

process.env.TZ = "Pacific/Kiritimati";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sliceArrowConst, sliceFunctionDecl } from "./test-helpers.js";

const src = readFileSync(new URL("../../js/utils-format.js", import.meta.url), "utf8");

// parseDate depends on localIsoDate (→ pad2), validatedLocalDate, and
// warnUnparseableDate — slice the whole chain so the eval runs the REAL
// production code.
const pad2Match = src.match(/^const pad2 = .*;$/m);
assert.ok(pad2Match, "could not locate the pad2 declaration in source");

// `new Function(...)` here is NOT user input: the source is sliced from the
// repo's own js/utils-format.js (same pattern as the cloud-sync unit tests).
const parseDate = new Function(
  [
    pad2Match[0],
    sliceArrowConst(src, "const localIsoDate = ("),
    sliceArrowConst(src, "const validatedLocalDate = ("),
    sliceArrowConst(src, "const warnUnparseableDate = ("),
    sliceFunctionDecl(src, "function parseDate("),
    "return parseDate;",
  ].join("\n")
)();

describe("parseDate — local-frame output (STRK-266)", () => {
  it("sanity: TZ pin took effect (exactly UTC+14)", () => {
    // getTimezoneOffset() is minutes to ADD to local time to reach UTC, so
    // UTC+14 reports exactly -840. Asserting the exact value (not merely a
    // negative one) means a failed pin can never false-pass — not even on a
    // developer machine that already sits in some positive-offset zone.
    assert.equal(
      new Date(2026, 0, 5).getTimezoneOffset(),
      -840,
      "expected the Pacific/Kiritimati (UTC+14) TZ pin to be in effect"
    );
  });

  it("YYYY/MM/DD returns the same calendar date", () => {
    assert.equal(parseDate("2026/01/05"), "2026-01-05");
  });

  it("YYYY-M-D (non-padded, dash separators) pads without shifting", () => {
    assert.equal(parseDate("2026-1-5"), "2026-01-05");
  });

  it("unambiguous DD/MM/YYYY (first > 12) returns the same calendar date", () => {
    assert.equal(parseDate("25/12/2026"), "2026-12-25");
  });

  it("unambiguous MM/DD/YYYY (second > 12) returns the same calendar date", () => {
    assert.equal(parseDate("12/25/2026"), "2026-12-25");
  });

  it("ambiguous both <= 12 defaults to US MM/DD/YYYY, same calendar date", () => {
    assert.equal(parseDate("01/05/2026"), "2026-01-05");
  });

  it("strict ISO YYYY-MM-DD is returned verbatim (unchanged fast path)", () => {
    assert.equal(parseDate("2026-01-05"), "2026-01-05");
  });

  it("generic fallback: prose date parses as local midnight, same calendar date", () => {
    assert.equal(parseDate("January 5, 2026"), "2026-01-05");
  });

  it("generic fallback: local datetime string keeps its local calendar date", () => {
    // "YYYY-MM-DD HH:MM" (no zone designator) parses as LOCAL time.
    assert.equal(parseDate("2026-01-05 10:30"), "2026-01-05");
  });

  it("generic fallback: explicit-UTC instant maps to the LOCAL calendar date", () => {
    // 23:00Z on Jan 5 is already Jan 6 at UTC+14. The output stays in the
    // local frame — the calendar date this instant falls on for the user.
    assert.equal(parseDate("2026-01-05T23:00:00Z"), "2026-01-06");
  });

  it("empty and unparseable inputs still return the em-dash sentinel", () => {
    assert.equal(parseDate(""), "—");
    assert.equal(parseDate("not a date"), "—");
  });
});

// STRK-267: the Date constructor silently rolls impossible calendar dates
// (Feb 31 → Mar 2/3), so every numeric branch must verify the constructed
// Date's components round-trip before formatting. A matched-but-impossible
// numeric shape returns the sentinel DIRECTLY — V8's legacy string parser
// also rolls "2026/02/31" → Mar 3, so falling through to the generic
// new Date(string) fallback would resurrect the corruption. This supersedes
// the STRK-266 test that documented the rollover as expected behavior.
describe("parseDate — impossible calendar dates rejected (STRK-267)", () => {
  it("strict ISO shape with an impossible day is rejected, not returned verbatim", () => {
    // V8 rolls new Date("2024-02-31") to Mar 1 (NOT Invalid Date), so the
    // pre-fix ISO branch handed the impossible string back unchanged.
    assert.equal(parseDate("2024-02-31"), "—");
  });

  it("YYYY/MM/DD with an impossible day is rejected, not rolled", () => {
    assert.equal(parseDate("2026/02/31"), "—");
  });

  it("YYYY/M/D (non-padded) impossible day does not reach the rolling generic parser", () => {
    // new Date("2026/2/31") rolls to Mar 3 in the legacy parser — the ymd
    // branch must short-circuit with the sentinel instead of falling through.
    assert.equal(parseDate("2026/2/31"), "—");
  });

  it("unambiguous US MM/DD/YYYY (second > 12) with an impossible day is rejected", () => {
    assert.equal(parseDate("02/31/2024"), "—");
  });

  it("unambiguous European DD/MM/YYYY (first > 12) with an impossible day is rejected", () => {
    assert.equal(parseDate("31/04/2024"), "—");
  });

  it("both components > 12 matches no numeric format and is rejected", () => {
    assert.equal(parseDate("13/13/2024"), "—");
  });

  it("leap day is accepted in a leap year", () => {
    assert.equal(parseDate("2024-02-29"), "2024-02-29");
    assert.equal(parseDate("2024/02/29"), "2024-02-29");
  });

  it("leap day is rejected in a non-leap year", () => {
    assert.equal(parseDate("2023-02-29"), "—");
    assert.equal(parseDate("2023/02/29"), "—");
  });
});

// Unit tests for parseDate (js/utils-format.js) — STRK-266.
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

import { sliceFunctionDecl } from "./test-helpers.js";

const src = readFileSync(new URL("../../js/utils-format.js", import.meta.url), "utf8");

// `new Function(...)` here is NOT user input: the source is sliced from the
// repo's own js/utils-format.js (same pattern as the cloud-sync unit tests).
const parseDate = new Function(
  `${sliceFunctionDecl(src, "function parseDate(")}\nreturn parseDate;`
)();

describe("parseDate — local-frame output (STRK-266)", () => {
  it("sanity: TZ pin took effect (positive UTC offset)", () => {
    // getTimezoneOffset() is minutes to ADD to local time to reach UTC, so a
    // positive-offset zone reports a NEGATIVE value. If this fails, the pin
    // did not apply and every case below could false-pass on UTC-negative
    // developer machines.
    assert.ok(
      new Date(2026, 0, 5).getTimezoneOffset() < 0,
      "expected a positive-UTC-offset timezone (Pacific/Kiritimati)"
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

  it("day-overflow rolls over in the LOCAL frame (documented Date behavior)", () => {
    // new Date(2026, 1, 31) rolls Feb 31 → Mar 3; the output must be that
    // rolled LOCAL date, not its UTC rendering (which was Mar 2 pre-fix).
    assert.equal(parseDate("2026/02/31"), "2026-03-03");
  });

  it("empty and unparseable inputs still return the em-dash sentinel", () => {
    assert.equal(parseDate(""), "—");
    assert.equal(parseDate("not a date"), "—");
  });
});

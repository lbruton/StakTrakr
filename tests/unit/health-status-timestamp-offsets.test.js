// Unit tests for getHealthStatusClass (js/utils.js) — STRK-291, PR #1410 review.
//
// Bug under test: the normalizer decided a timestamp already carried a timezone
// designator with `timestamp.includes("Z") || timestamp.includes("+")`. A
// NEGATIVE offset carries neither, so "2026-07-30T12:00:00-08:00" had a "Z"
// appended and became "2026-07-30T12:00:00-08:00Z" — an Invalid Date. The
// resulting NaN age failed BOTH `<` comparisons and fell through to "--red",
// so a timestamp seconds old reported as over a day stale. Silent, and
// wrong in the alarming direction.
//
// js/api-health.js already had the correct regex in `_normalizeTs`; this test
// pins js/utils.js to the same behaviour so the two cannot drift again.
//
// TZ is pinned so the "naive string is treated as UTC" assertions are stable
// regardless of the machine's own zone. node --test gives each file its own
// child process, so this cannot leak into other test files.

process.env.TZ = "America/Chicago";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sliceFunctionDecl } from "./test-helpers.js";

const src = readFileSync(new URL("../../js/utils.js", import.meta.url), "utf8");

// `new Function(...)` here is NOT user input: the source is sliced from the
// repo's own js/utils.js (same pattern as parse-date-local-frame.test.js).
// The two threshold constants are inlined rather than sliced so a change to
// their VALUES does not silently rewrite what this test asserts — the bucket
// boundaries are pinned here on purpose.
const getHealthStatusClass = new Function(
  [
    "const SPOT_FRESH_MAX_MIN = 60;",
    "const SPOT_STALE_MAX_MIN = 1440;",
    sliceFunctionDecl(src, "function getHealthStatusClass("),
    "return getHealthStatusClass;",
  ].join("\n")
)();

/** Builds a timestamp `minutesAgo` in the past, rendered in the given form. */
const at = (minutesAgo, render) => render(new Date(Date.now() - minutesAgo * 60000));

const asUtcZ = (d) => d.toISOString();
const asNaive = (d) => d.toISOString().replace("T", " ").slice(0, 19);
/** Renders the same instant with an explicit +/- offset, e.g. "-08:00". */
const asOffset = (sign, hours) => (d) => {
  const shifted = new Date(d.getTime() + (sign === "+" ? 1 : -1) * hours * 3600000);
  const pad = String(hours).padStart(2, "0");
  return `${shifted.toISOString().slice(0, 19)}${sign}${pad}:00`;
};

describe("getHealthStatusClass — age buckets", () => {
  it("classifies fresh, stale, and expired by age", () => {
    assert.equal(getHealthStatusClass(at(5, asUtcZ)), "--green");
    assert.equal(getHealthStatusClass(at(90, asUtcZ)), "--orange");
    assert.equal(getHealthStatusClass(at(60 * 30, asUtcZ)), "--red");
  });

  it("treats an absent timestamp as --red", () => {
    assert.equal(getHealthStatusClass(null), "--red");
    assert.equal(getHealthStatusClass(""), "--red");
  });

  it("reads a naive 'YYYY-MM-DD HH:MM:SS' string as UTC", () => {
    // No designator at all — the normalizer must still append "Z" here, which
    // is the behaviour the offset fix had to preserve.
    assert.equal(getHealthStatusClass(at(5, asNaive)), "--green");
    assert.equal(getHealthStatusClass(at(90, asNaive)), "--orange");
  });
});

describe("getHealthStatusClass — timezone designators", () => {
  it("respects a positive offset", () => {
    assert.equal(getHealthStatusClass(at(5, asOffset("+", 2))), "--green");
    assert.equal(getHealthStatusClass(at(90, asOffset("+", 2))), "--orange");
  });

  it("respects a NEGATIVE offset — the regression this test exists for", () => {
    // Pre-fix these produced "…-08:00Z" → Invalid Date → NaN age → "--red".
    // A five-minute-old timestamp reporting as expired is the exact failure.
    assert.equal(getHealthStatusClass(at(5, asOffset("-", 8))), "--green");
    assert.equal(getHealthStatusClass(at(90, asOffset("-", 8))), "--orange");
    assert.equal(getHealthStatusClass(at(60 * 30, asOffset("-", 8))), "--red");
  });

  it("handles a compact offset with no colon", () => {
    const iso = new Date(Date.now() - 5 * 60000).toISOString().slice(0, 19);
    assert.equal(getHealthStatusClass(`${iso}+0000`), "--green");
    assert.equal(getHealthStatusClass(`${iso}-0000`), "--green");
  });

  it("accepts a lowercase z designator", () => {
    const iso = new Date(Date.now() - 5 * 60000).toISOString().slice(0, 19);
    assert.equal(getHealthStatusClass(`${iso}z`), "--green");
  });

  it("does not mistake the date's own hyphens for an offset", () => {
    // "2026-07-30T12:00:00" ends in digits, and the date part is full of
    // hyphens — the offset pattern must be ANCHORED to the end, or a naive
    // string would be read as already-zoned and parsed in local time.
    const naive = new Date(Date.now() - 5 * 60000).toISOString().slice(0, 19);
    assert.equal(getHealthStatusClass(naive), "--green");
  });
});

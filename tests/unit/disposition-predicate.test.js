// Unit tests for isDisposed() — STRK-83 canonical disposition predicate (AC-1).
//
// isDisposed() must treat ONLY a non-null, non-array object with >= 1 own enumerable
// key as "disposed". An empty object {}, null, undefined, an array, and non-objects
// are NOT disposed — a Disposition tracks realized value and date, so an empty shell
// is not a Disposition.
//
// Loaded via slice-and-eval (the project's unit pattern) because isDisposed is a
// browser global in js/constants.js with no external dependencies.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/constants.js", import.meta.url), "utf-8");

// Slice the isDisposed function block out of constants.js and evaluate it in isolation.
// Match the whole function up to its own closing brace (column-0 `\n}`) so the extraction
// stays valid if surrounding definitions are reordered or inserted.
const match = src.match(/function isDisposed\s*\([\s\S]*?\n\}/);
assert.ok(match, "could not locate isDisposed in js/constants.js");
const isDisposed = new Function(match[0] + "\nreturn isDisposed;")();

describe("isDisposed() — canonical disposition predicate (STRK-83 AC-1)", () => {
  test("returns false for an empty disposition object {}", () => {
    assert.equal(isDisposed({ disposition: {} }), false);
  });

  test("returns false for null disposition", () => {
    assert.equal(isDisposed({ disposition: null }), false);
  });

  test("returns false when the disposition key is absent", () => {
    assert.equal(isDisposed({}), false);
  });

  test("returns false for an array disposition", () => {
    assert.equal(isDisposed({ disposition: [] }), false);
  });

  test("returns false for a non-object disposition", () => {
    assert.equal(isDisposed({ disposition: "sold" }), false);
  });

  test("returns false for undefined / no item", () => {
    assert.equal(isDisposed(undefined), false);
  });

  test("returns true for a populated disposition object", () => {
    assert.equal(isDisposed({ disposition: { type: "Sold", date: "2026-05-01" } }), true);
  });

  test("returns true for a disposition with a single key", () => {
    assert.equal(isDisposed({ disposition: { type: "Lost" } }), true);
  });
});

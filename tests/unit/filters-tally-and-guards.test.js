// Unit tests for js/filters.js category-tally normalization + defensive guards.
//
// Covers two pre-existing issues surfaced by Codacy AI on PR #1274 (STRK-170
// cohort 2.4), fixed together in v3.35.36:
//
//   STRK-206  _tallyLocation must NOT tally the synthetic "Numista Import" origin.
//             It is normalized to the "—" placeholder by _filterByLocationField
//             and by the inventory-table display layer, so a location chip built
//             from the tally can never match the filter predicate — clicking it
//             would filter the table to zero items.
//
//   STRK-207  getItemTags() readers must tolerate a null/undefined return
//             (defensive `|| []`), and _resetDisposedFilter must guard its
//             disposedFilterGroup lookup with `instanceof HTMLElement`: safeGetElement
//             returns a TRUTHY DUMMY (not null) when the element is absent, so the
//             naive `if (!dfg)` passes and dfg.querySelectorAll(...) throws.
//
// Harness: these helpers are module-internal `const` arrows in filters.js (NOT on
// window), so each is sliced out of the source and evaluated in isolation with
// injected collaborators — mirroring tests/unit/disposition-predicate.test.js.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/filters.js", import.meta.url), "utf-8");

/** Slice a named `const NAME = (...) => { ... };` block (col-0 terminator) out of the source. */
function sliceConst(name) {
  const re = new RegExp(`const ${name} = \\([\\s\\S]*?\\n\\};`);
  const m = src.match(re);
  assert.ok(m, `could not locate ${name} in js/filters.js`);
  return m[0];
}

describe("filters.js _tallyLocation — STRK-206 Numista-Import normalization", () => {
  const _tallyLocation = new Function(sliceConst("_tallyLocation") + "\nreturn _tallyLocation;")();

  test("tallies a real purchase location", () => {
    const map = {};
    _tallyLocation(map, "APMEX");
    assert.equal(map["APMEX"], 1);
  });

  test("skips empty and Unknown (case-insensitive)", () => {
    const map = {};
    _tallyLocation(map, "");
    _tallyLocation(map, "Unknown");
    _tallyLocation(map, "UNKNOWN");
    assert.deepEqual(map, {});
  });

  test("does NOT tally the synthetic 'Numista Import' origin (STRK-206)", () => {
    const map = {};
    _tallyLocation(map, "Numista Import");
    assert.deepEqual(map, {}, "'Numista Import' must not produce a location chip");
  });
});

describe("filters.js _tallyTags — STRK-207 getItemTags null guard", () => {
  /**
   * Builds an isolated _tallyTags with the given getItemTags collaborator injected.
   * @param {(uuid: string) => (string[]|null|undefined)} getItemTags - Tag-lookup stub
   * @returns {(tags: object, item: object) => void} The isolated _tallyTags
   */
  function build(getItemTags) {
    return new Function("getItemTags", sliceConst("_tallyTags") + "\nreturn _tallyTags;")(
      getItemTags
    );
  }

  test("does not throw when getItemTags returns null", () => {
    const fn = build(() => null);
    const tags = {};
    assert.doesNotThrow(() => fn(tags, { uuid: "abc" }));
    assert.deepEqual(tags, {});
  });

  test("tallies tags normally when getItemTags returns an array", () => {
    const fn = build(() => ["gold", "key-date"]);
    const tags = {};
    fn(tags, { uuid: "abc" });
    assert.equal(tags["gold"], 1);
    assert.equal(tags["key-date"], 1);
  });
});

describe("filters.js _filterFieldMatchesWord — STRK-207 getItemTags null guard (audit site)", () => {
  /**
   * Builds an isolated _filterFieldMatchesWord with getItemTags injected.
   * @param {(uuid: string) => (string[]|null|undefined)} getItemTags - Tag-lookup stub
   * @returns {(item: object, wordRegex: RegExp, word: string, formattedDate: string, catalogText: string) => boolean}
   */
  function build(getItemTags) {
    return new Function(
      "getItemTags",
      sliceConst("_filterFieldMatchesWord") + "\nreturn _filterFieldMatchesWord;"
    )(getItemTags);
  }

  test("does not throw on the tags branch when getItemTags returns null", () => {
    const fn = build(() => null);
    // Item with no field matching /\bzzz\b/i forces evaluation through to the tags line.
    const item = { uuid: "x", date: "" };
    const re = /\bzzz\b/i;
    assert.doesNotThrow(() => fn(item, re, "zzz", "", ""));
    assert.equal(fn(item, re, "zzz", "", ""), false);
  });
});

describe("filters.js _filterResolveSearchCache — STRK-207 getItemTags null guard (audit site)", () => {
  /**
   * Builds an isolated _filterResolveSearchCache with all collaborators injected.
   * Only getItemTags varies per test; the rest are inert doubles so evaluation never throws.
   * @param {(uuid: string) => (string[]|null|undefined)} getItemTags - Tag-lookup stub
   * @returns {(item: object) => {text: string, formattedDate: string, catalogText: string}}
   */
  function build(getItemTags) {
    const searchCache = new Map();
    const formatDisplayDate = () => "";
    const getItemSearchHaystack = (_item, searchTags) => searchTags;
    const collectNumistaStrings = () => [];
    return new Function(
      "searchCache",
      "getItemTags",
      "formatDisplayDate",
      "getItemSearchHaystack",
      "collectNumistaStrings",
      sliceConst("_filterResolveSearchCache") + "\nreturn _filterResolveSearchCache;"
    )(searchCache, getItemTags, formatDisplayDate, getItemSearchHaystack, collectNumistaStrings);
  }

  test("does not throw and yields empty tag text when getItemTags returns null", () => {
    const fn = build(() => null);
    const item = { uuid: "x", date: "" };
    let cached;
    assert.doesNotThrow(() => {
      cached = fn(item);
    });
    // getItemSearchHaystack echoes the resolved search-tags string, so empty tags → "".
    assert.equal(cached.text, "");
  });

  test("joins tags into the haystack when getItemTags returns an array", () => {
    const fn = build(() => ["gold", "key-date"]);
    const cached = fn({ uuid: "x", date: "" });
    assert.equal(cached.text, "gold key-date");
  });
});

describe("filters.js _resetDisposedFilter — STRK-207 disposedFilterGroup guard", () => {
  before(() => {
    // The fix guards with `instanceof HTMLElement`; provide the type in the Node context.
    if (typeof globalThis.HTMLElement === "undefined") {
      globalThis.HTMLElement = class HTMLElement {};
    }
  });

  /**
   * Builds an isolated _resetDisposedFilter with DOM + persistence collaborators injected.
   * @param {*} dfg - The value safeGetElement returns (real element, truthy dummy, etc.)
   * @param {Array<Array>} calls - Accumulator recording (name, ...args) of each side effect
   * @returns {() => void} The isolated _resetDisposedFilter
   */
  function build(dfg, calls) {
    const safeGetElement = () => dfg;
    const saveData = (k, v) => calls.push(["saveData", k, v]);
    const renderTable = () => calls.push(["renderTable"]);
    const renderActiveFilters = () => calls.push(["renderActiveFilters"]);
    return new Function(
      "safeGetElement",
      "saveData",
      "renderTable",
      "renderActiveFilters",
      sliceConst("_resetDisposedFilter") + "\nreturn _resetDisposedFilter;"
    )(safeGetElement, saveData, renderTable, renderActiveFilters);
  }

  test("does not throw on the truthy-dummy element, still persists + re-renders (STRK-207)", () => {
    const calls = [];
    // safeGetElement's truthy dummy: not an HTMLElement and has no querySelectorAll.
    const fn = build({}, calls);
    assert.doesNotThrow(() => fn());
    assert.deepEqual(calls, [
      ["saveData", "disposedFilterMode", "hide"],
      ["renderTable"],
      ["renderActiveFilters"],
    ]);
  });

  test("toggles chip buttons to the 'hide' default when a real element is present", () => {
    const calls = [];
    const buttons = [
      {
        dataset: { disposedMode: "hide" },
        classList: {
          toggle(_c, on) {
            this._active = on;
          },
        },
      },
      {
        dataset: { disposedMode: "show" },
        classList: {
          toggle(_c, on) {
            this._active = on;
          },
        },
      },
    ];
    const el = Object.assign(new globalThis.HTMLElement(), { querySelectorAll: () => buttons });
    const fn = build(el, calls);
    fn();
    assert.equal(buttons[0].classList._active, true, "hide button becomes active");
    assert.equal(buttons[1].classList._active, false, "show button becomes inactive");
  });
});

// Unit tests for the convergence audit fixes (STRK-159, parent STRK-154).
//
// STRK-159 generalizes the convergence invariant ("compare/merge/hash on logical
// content, never raw serialization") across the remaining sync surfaces:
//   1. computeInventoryHash canonicalizes item.disposition (sorted keys) so a
//      key-order variant of the same object is not a false inventory mismatch.
//   2. _hasTagChanges compares decompressed, canonicalized tag content so a
//      compressed-vs-plain (or key-order) variant of identical tags is not a
//      false "changed" signal that triggers a needless merge.
//
// Loaded via slice-and-eval with the real vendored lz-string engine.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// --- Real lz-string + __decompressIfNeeded (for genuine compressed-vs-plain) ---
const lzCode = readFileSync(new URL("../../vendor/lz-string.min.js", import.meta.url), "utf-8");
const _lzModule = { exports: {} };
new Function("module", "exports", "window", lzCode)(_lzModule, _lzModule.exports, undefined);
const LZString = _lzModule.exports;
const utilsSrc = readFileSync(new URL("../../js/utils.js", import.meta.url), "utf-8");
const compFactory = new Function(
  "__LZ",
  "__LZ_REAL",
  utilsSrc.slice(
    utilsSrc.indexOf("const __ST_COMP_PREFIX"),
    utilsSrc.indexOf("function getContrastColor")
  ) + "\nreturn { __decompressIfNeeded };"
);
const { __decompressIfNeeded } = compFactory(LZString, true);

const src = readFileSync(new URL("../../js/cloud-sync.js", import.meta.url), "utf-8");

function slice(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to);
  assert.ok(a !== -1 && b !== -1 && b > a, `could not locate block ${from} .. ${to}`);
  return src.slice(a, b);
}

// Extract the real _stableCanonicalString once and reuse it as an injected dep.
const _stableCanonicalString = new Function(
  slice("function _stableCanonicalString", "function _canonicalizeSettingValue") +
    "\nreturn _stableCanonicalString;"
)();

// NOTE: include the `async` keyword — computeInventoryHash awaits crypto.subtle,
// so a slice that drops `async` yields "await in non-async function" SyntaxError.
const invBlock = slice("async function computeInventoryHash", "function summarizeMetals");
const tagBlock = slice("function _tagSyncKeys()", "function _unionTags");

function sha256BufferToHex(buffer) {
  const a = new Uint8Array(buffer);
  let hex = "";
  for (let j = 0; j < a.length; j++) hex += ("0" + a[j].toString(16)).slice(-2);
  return hex;
}

function inventoryHash(items) {
  const factory = new Function(
    "crypto",
    "DiffEngine",
    "TextEncoder",
    "sha256BufferToHex",
    "_stableCanonicalString",
    "debugLog",
    invBlock + "\nreturn computeInventoryHash;"
  );
  const fn = factory(
    globalThis.crypto,
    { computeItemKey: (it) => String(it.uuid) },
    TextEncoder,
    sha256BufferToHex,
    _stableCanonicalString,
    () => {}
  );
  return fn(items);
}

function makeHasTagChanges(store, decompress) {
  const localStorageMock = { getItem: (k) => (k in store ? store[k] : null) };
  const factory = new Function(
    "localStorage",
    "__decompressIfNeeded",
    "_stableCanonicalString",
    "console",
    tagBlock + "\nreturn _hasTagChanges;"
  );
  return factory(localStorageMock, decompress || ((s) => s), _stableCanonicalString, console);
}

describe("STRK-159 computeInventoryHash canonicalizes disposition", () => {
  test("disposition key-order variance hashes EQUAL", async () => {
    const h1 = await inventoryHash([
      { uuid: "x", disposition: { soldDate: "2026-01-01", soldPrice: 100 } },
    ]);
    const h2 = await inventoryHash([
      { uuid: "x", disposition: { soldPrice: 100, soldDate: "2026-01-01" } },
    ]);
    assert.equal(h1, h2, "same disposition, different key order, must hash equal");
  });

  test("a genuine disposition value change DOES change the hash", async () => {
    const h1 = await inventoryHash([{ uuid: "x", disposition: { soldPrice: 100 } }]);
    const h2 = await inventoryHash([{ uuid: "x", disposition: { soldPrice: 200 } }]);
    assert.notEqual(h1, h2, "different disposition value must hash differently");
  });
});

describe("STRK-159 _hasTagChanges compares logical content", () => {
  const plain = JSON.stringify({ u1: ["a", "b"] });

  test("compressed (CMP2) vs plain of identical tags -> NOT changed", () => {
    const compressed = "CMP2:" + LZString.compressToUTF16(plain);
    const hasChanges = makeHasTagChanges({ itemTags: plain }, __decompressIfNeeded);
    assert.equal(
      hasChanges({ itemTags: compressed }),
      false,
      "compressed twin of identical tags must not be a change"
    );
  });

  test("tag-store key-order variance -> NOT changed", () => {
    const hasChanges = makeHasTagChanges({ itemTags: JSON.stringify({ u1: ["a"], u2: ["b"] }) });
    assert.equal(hasChanges({ itemTags: JSON.stringify({ u2: ["b"], u1: ["a"] }) }), false);
  });

  test("genuinely different tag content -> changed", () => {
    const hasChanges = makeHasTagChanges({ itemTags: plain });
    assert.equal(hasChanges({ itemTags: JSON.stringify({ u1: ["a", "c"] }) }), true);
  });
});

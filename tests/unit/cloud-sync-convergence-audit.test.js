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
import { evalSource, readSource, sliceUntil } from "./helpers/source-extract.js";
import { loadLZString, loadStorageCodec } from "./helpers/storage-codec.js";
import { SYNC_FILE, loadStableCanonicalString, sha256BufferToHex } from "./helpers/sync-blocks.js";

// --- Real lz-string + __decompressIfNeeded (for genuine compressed-vs-plain) ---
const LZString = loadLZString();
const { __decompressIfNeeded } = loadStorageCodec(LZString);

const src = readSource(SYNC_FILE);
const slice = (from, to) => sliceUntil(src, from, to);

// Extract the real _stableCanonicalString once and reuse it as an injected dep.
const _stableCanonicalString = loadStableCanonicalString();

// The slice keeps the `async` keyword: computeInventoryHash awaits crypto.subtle.
const invBlock = slice("async function computeInventoryHash", "function summarizeMetals");
const tagBlock = slice("function _tagSyncKeys()", "function _unionTags");

function inventoryHash(items) {
  const fn = evalSource(SYNC_FILE, {
    params: {
      crypto: globalThis.crypto,
      DiffEngine: { computeItemKey: (it) => String(it.uuid) },
      TextEncoder,
      sha256BufferToHex,
      _stableCanonicalString,
      debugLog: () => {},
    },
    slice: invBlock,
    suffix: "\nreturn computeInventoryHash;",
  });
  return fn(items);
}

function makeHasTagChanges(store, decompress) {
  const localStorageMock = { getItem: (k) => (k in store ? store[k] : null) };
  return evalSource(SYNC_FILE, {
    params: {
      localStorage: localStorageMock,
      __decompressIfNeeded: decompress || ((s) => s),
      _stableCanonicalString,
      console,
    },
    slice: tagBlock,
    suffix: "\nreturn _hasTagChanges;",
  });
}

describe("computeInventoryHash canonicalizes disposition", () => {
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

describe("_hasTagChanges compares logical content", () => {
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

// STRK-338: the retail manifest cache must survive a CMP2-compressed stored value.
//
// js/market-data.js and js/retail.js both own retailManifestCoinMeta and
// retailManifestVendorMeta, and they disagreed on convention. market-data.js writes them
// through saveDataSync (js/market-data.js:294,306), which compresses anything over 4096
// chars into a "CMP2:" envelope. js/retail.js read them back with a bare
// localStorage.getItem + JSON.parse, so a compressed value threw, the catch swallowed it
// and removeItem'd the key, and the cache silently never restored — market-data re-fetched
// and re-wrote it compressed, retail cleared it again, on every page load.
//
// Only payload size held it shut: the live manifest's coin meta measured 2327 chars at 26
// coins (~90 chars/coin), so it crossed 4096 at roughly 46 coins.
//
// These tests exercise the REAL restore function sliced out of js/retail.js against the
// REAL storage helpers and the REAL vendored lz-string engine — no reimplementation of
// either side, so the test cannot pass by agreeing with a mock.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

// Load the vendored lz-string via a synthetic CJS module context (the storage-compression
// .test.js pattern). The minified UMD assigns the IIFE result to module.exports here, the
// same object a browser exposes as window.LZString.
const lzCode = readFileSync(new URL("../../vendor/lz-string.min.js", import.meta.url), "utf-8");
const _lzModule = { exports: {} };
new Function("module", "exports", "window", lzCode)(_lzModule, _lzModule.exports, undefined);
const LZString = _lzModule.exports;

const storageSrc = readFileSync(new URL("../../js/utils-storage.js", import.meta.url), "utf-8");

/**
 * Slices a named block out of a source file between two literal anchors.
 * @param {string} src - File contents.
 * @param {string} startAnchor - Literal text the block starts with.
 * @param {string} endAnchor - Literal text immediately following the block.
 * @param {string} label - Human-readable name for the assertion message.
 * @returns {string} The sliced block.
 */
function sliceBlock(src, startAnchor, endAnchor, label) {
  const start = src.indexOf(startAnchor);
  const end = src.indexOf(endAnchor);
  assert.ok(start !== -1 && end > start, `could not locate the ${label} block`);
  return src.slice(start, end);
}

// The compression codec (__compressIfNeeded / __decompressIfNeeded / the CMP prefixes) and
// the save/load wrappers are non-contiguous in utils-storage.js. Concatenate codec-first so
// the const prefixes are initialized before any wrapper call reaches them.
const codecBlock = sliceBlock(
  storageSrc,
  "const __ST_COMP_PREFIX",
  "// Kick off the one-time",
  "compression codec"
);
const wrapperBlock = sliceBlock(
  storageSrc,
  "const __wouldClobberCompressed",
  "/**\n * Removes unknown localStorage keys",
  "save/load wrapper"
);

const storageFactory = new Function(
  "__LZ",
  "__LZ_REAL",
  "localStorage",
  codecBlock +
    wrapperBlock +
    "\nreturn { saveDataSync, loadDataSync, __compressIfNeeded, __decompressIfNeeded, __ST_COMP_PREFIX };"
);

// The restore path is a small cluster of browser globals in js/retail.js closing over
// module-level `let` bindings and the key constants: _isManifestMetaObject (shape guard),
// _restoreManifestCacheKey (per-key read + eviction), and the
// _restoreRetailManifestCacheFromStorage entry point. Slice the whole cluster so the inner
// references resolve, supply the bindings in the preamble, and hand back an accessor so
// each test can observe the post-restore globals.
const retailSrc = readFileSync(new URL("../../js/retail.js", import.meta.url), "utf-8");
const restoreMatch = retailSrc.match(
  /const _isManifestMetaObject = \([\s\S]*?const _restoreRetailManifestCacheFromStorage = \(\) => \{[\s\S]*?\n\};/
);
assert.ok(restoreMatch, "could not locate the manifest-restore helper cluster in js/retail.js");

const SLUGS_KEY = "retailManifestSlugs";
const COIN_META_KEY = "retailManifestCoinMeta";
const VENDOR_META_KEY = "retailManifestVendorMeta";

const restoreFactory = new Function(
  "localStorage",
  "loadDataSync",
  "RETAIL_MANIFEST_SLUGS_KEY",
  "RETAIL_MANIFEST_COIN_META_KEY",
  "RETAIL_MANIFEST_VENDOR_META_KEY",
  "let _manifestCacheRestored = false;\n" +
    "let _manifestSlugs = null;\n" +
    "let _manifestCoinMeta = null;\n" +
    "let _manifestVendorMeta = null;\n" +
    restoreMatch[0] +
    "\nreturn () => {" +
    "  _restoreRetailManifestCacheFromStorage();" +
    "  return { _manifestSlugs, _manifestCoinMeta, _manifestVendorMeta };" +
    "};"
);

/**
 * Map-backed localStorage double implementing the surface the sliced code touches.
 * @returns {object} A fresh storage stub.
 */
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    has: (k) => map.has(k),
  };
}

let storage;
let saveDataSync;
let loadDataSync;
let COMP_PREFIX;
let runRestore;

beforeEach(() => {
  storage = makeStorage();
  const helpers = storageFactory(LZString, true, storage);
  saveDataSync = helpers.saveDataSync;
  loadDataSync = helpers.loadDataSync;
  COMP_PREFIX = helpers.__ST_COMP_PREFIX;
  // Fresh factory instance per test — the restore function short-circuits on
  // _manifestCacheRestored, so the bindings must not leak across tests.
  runRestore = restoreFactory(storage, loadDataSync, SLUGS_KEY, COIN_META_KEY, VENDOR_META_KEY);
});

/**
 * Builds a manifest coin-meta object large enough to cross the 4096-char compression
 * threshold once serialized. The live manifest sits at 2327 chars for 26 coins.
 * @param {number} count - Number of synthetic coins.
 * @returns {object} Coin meta keyed by slug.
 */
function bigCoinMeta(count) {
  const meta = {};
  for (let i = 0; i < count; i++) {
    meta[`synthetic-bullion-coin-${i}`] = {
      name: `Synthetic Commemorative Bullion Coin Number ${i} 1 oz`,
      weight: 1,
      metal: i % 2 === 0 ? "silver" : "gold",
    };
  }
  return meta;
}

// ---------------------------------------------------------------------------
// The regression: a compressed value must restore, not clear the cache
// ---------------------------------------------------------------------------

describe("STRK-338 — manifest cache restores through the compression helpers", () => {
  test("coin meta written by saveDataSync above the threshold restores intact", () => {
    const meta = bigCoinMeta(60);
    assert.ok(
      JSON.stringify(meta).length > 4096,
      "fixture must exceed the 4096-char threshold or the test is vacuous"
    );
    saveDataSync(COIN_META_KEY, meta);
    assert.ok(
      storage.getItem(COIN_META_KEY).startsWith(COMP_PREFIX),
      "stored value must actually be CMP2-compressed or the test is vacuous"
    );

    const { _manifestCoinMeta } = runRestore();

    assert.deepEqual(_manifestCoinMeta, meta);
    assert.ok(storage.has(COIN_META_KEY), "a readable value must not be cleared from storage");
  });

  test("vendor meta written by saveDataSync above the threshold restores intact", () => {
    const vendors = {};
    for (let i = 0; i < 60; i++) {
      vendors[`synthetic-vendor-${i}`] = {
        name: `Synthetic Precious Metals Dealer Number ${i}`,
        color: "#60a5fa",
        url: `https://www.synthetic-dealer-${i}.example.com`,
      };
    }
    assert.ok(JSON.stringify(vendors).length > 4096, "fixture must exceed the threshold");
    saveDataSync(VENDOR_META_KEY, vendors);
    assert.ok(storage.getItem(VENDOR_META_KEY).startsWith(COMP_PREFIX), "must be compressed");

    const { _manifestVendorMeta } = runRestore();

    assert.deepEqual(_manifestVendorMeta, vendors);
    assert.ok(storage.has(VENDOR_META_KEY), "a readable value must not be cleared from storage");
  });

  test("slug list written by saveDataSync above the threshold restores intact", () => {
    const slugs = Array.from({ length: 250 }, (_, i) => `synthetic-bullion-coin-${i}`);
    assert.ok(JSON.stringify(slugs).length > 4096, "fixture must exceed the threshold");
    saveDataSync(SLUGS_KEY, slugs);
    assert.ok(storage.getItem(SLUGS_KEY).startsWith(COMP_PREFIX), "must be compressed");

    const { _manifestSlugs } = runRestore();

    assert.deepEqual(_manifestSlugs, slugs);
    assert.ok(storage.has(SLUGS_KEY), "a readable value must not be cleared from storage");
  });
});

// ---------------------------------------------------------------------------
// Back-compat: every existing user, and every Playwright seed, stores raw JSON
// ---------------------------------------------------------------------------

describe("STRK-338 — uncompressed values still restore", () => {
  test("raw JSON written straight to localStorage restores for all three keys", () => {
    // This is the shape existing users have on disk and the shape the Playwright specs
    // seed via writeJson() — __decompressIfNeeded is a no-op on an unprefixed string.
    const slugs = ["ase", "age", "buffalo"];
    const meta = { ase: { name: "American Silver Eagle 1 oz", weight: 1, metal: "silver" } };
    const vendors = { apmex: { name: "APMEX", color: "#60a5fa", url: "https://www.apmex.com" } };
    storage.setItem(SLUGS_KEY, JSON.stringify(slugs));
    storage.setItem(COIN_META_KEY, JSON.stringify(meta));
    storage.setItem(VENDOR_META_KEY, JSON.stringify(vendors));

    const restored = runRestore();

    assert.deepEqual(restored._manifestSlugs, slugs);
    assert.deepEqual(restored._manifestCoinMeta, meta);
    assert.deepEqual(restored._manifestVendorMeta, vendors);
  });

  test("a value under the threshold is stored unprefixed and still restores", () => {
    const slugs = ["ase", "age"];
    saveDataSync(SLUGS_KEY, slugs);
    assert.ok(
      !storage.getItem(SLUGS_KEY).startsWith(COMP_PREFIX),
      "a short value must not be compressed — that is what makes the bug latent today"
    );

    assert.deepEqual(runRestore()._manifestSlugs, slugs);
  });

  test("absent keys leave the globals null without throwing", () => {
    const restored = runRestore();

    assert.equal(restored._manifestSlugs, null);
    assert.equal(restored._manifestCoinMeta, null);
    assert.equal(restored._manifestVendorMeta, null);
  });
});

// ---------------------------------------------------------------------------
// Self-healing: a bad value must still be evicted, not left to re-fail forever
// ---------------------------------------------------------------------------

describe("STRK-338 — corrupt and wrong-shape values still self-heal", () => {
  test("non-JSON garbage leaves the global null and evicts the key", () => {
    storage.setItem(COIN_META_KEY, "{not valid json at all");

    const { _manifestCoinMeta } = runRestore();

    assert.equal(_manifestCoinMeta, null);
    assert.ok(!storage.has(COIN_META_KEY), "unparseable value must be evicted");
  });

  test("an array where coin meta expects an object is rejected and evicted", () => {
    storage.setItem(COIN_META_KEY, JSON.stringify(["ase", "age"]));

    const { _manifestCoinMeta } = runRestore();

    assert.equal(_manifestCoinMeta, null);
    assert.ok(!storage.has(COIN_META_KEY), "wrong-shape value must be evicted");
  });

  test("an object where the slug list expects an array is rejected and evicted", () => {
    storage.setItem(SLUGS_KEY, JSON.stringify({ ase: true }));

    const { _manifestSlugs } = runRestore();

    assert.equal(_manifestSlugs, null);
    assert.ok(!storage.has(SLUGS_KEY), "wrong-shape value must be evicted");
  });
});

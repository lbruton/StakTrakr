// Unit tests for computeSettingsHash logical-content hashing (STRK-156, parent STRK-154).
//
// computeSettingsHash() used to hash the RAW localStorage string for each
// SYNC_SCOPE_KEYS entry. Raw strings differ for identical logical content when:
//   - lz-string CMP2-compressed (raw > 4096) on one device vs plain on the other
//   - a scalar stored as JSON ("\"dark\"") vs raw (dark)
//   - object key-order differs
// Any of these produced a false settings:false -> infinite pull loop. The live
// incident had the divergent itemTags compressed (CMP2) on one device and plain
// on the other, guaranteeing a hash mismatch even for identical content.
//
// Fix: hash NORMALIZED logical content (decompress, JSON-parse with raw-scalar
// fallback, sort object keys, preserve array order). These tests load the REAL
// computeSettingsHash block from js/cloud-sync.js and the REAL compression helpers
// from js/utils.js (slice-and-eval, mirrors storage-compression.test.js), with the
// real vendored lz-string engine, so compressed-vs-plain is exercised end-to-end.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// --- Real lz-string engine (UMD assigns IIFE to module.exports) ---
const lzCode = readFileSync(new URL("../../vendor/lz-string.min.js", import.meta.url), "utf-8");
const _lzModule = { exports: {} };
new Function("module", "exports", "window", lzCode)(_lzModule, _lzModule.exports, undefined);
const LZString = _lzModule.exports;

// --- Real __compressIfNeeded / __decompressIfNeeded from utils.js ---
const utilsSrc = readFileSync(new URL("../../js/utils.js", import.meta.url), "utf-8");
const cStart = utilsSrc.indexOf("const __ST_COMP_PREFIX");
const cEnd = utilsSrc.indexOf("function getContrastColor");
assert.ok(
  cStart !== -1 && cEnd !== -1 && cEnd > cStart,
  "could not locate compression block in utils.js"
);
const compFactory = new Function(
  "__LZ",
  "__LZ_REAL",
  utilsSrc.slice(cStart, cEnd) + "\nreturn { __compressIfNeeded, __decompressIfNeeded };"
);
const { __compressIfNeeded, __decompressIfNeeded } = compFactory(LZString, true);

// --- Real computeSettingsHash block from cloud-sync.js ---
const src = readFileSync(new URL("../../js/cloud-sync.js", import.meta.url), "utf-8");
const start = src.indexOf("function _stableCanonicalString");
const end = src.indexOf("function initSyncTabCoordination");
assert.ok(
  start !== -1 && end !== -1 && end > start,
  "could not locate settings-hash block in cloud-sync.js"
);
const block = src.slice(start, end);

const SCOPE = ["metalInventory", "appTheme", "itemTags", "objConfig", "arrConfig"];

function sha256BufferToHex(buffer) {
  const a = new Uint8Array(buffer);
  let hex = "";
  for (let j = 0; j < a.length; j++) hex += ("0" + a[j].toString(16)).slice(-2);
  return hex;
}

// Compute the settings hash over a given localStorage map.
function hashOf(store) {
  const localStorageMock = { getItem: (k) => (k in store ? store[k] : null) };
  const factory = new Function(
    "crypto",
    "localStorage",
    "SYNC_SCOPE_KEYS",
    "__decompressIfNeeded",
    "TextEncoder",
    "sha256BufferToHex",
    "debugLog",
    block + "\nreturn computeSettingsHash;"
  );
  const computeSettingsHash = factory(
    globalThis.crypto,
    localStorageMock,
    SCOPE,
    __decompressIfNeeded,
    TextEncoder,
    sha256BufferToHex,
    () => {}
  );
  return computeSettingsHash();
}

describe("STRK-156 computeSettingsHash hashes logical content", () => {
  test("compressed (CMP2) vs plain value of identical content hash EQUAL", async () => {
    // Build a value large enough that __compressIfNeeded emits a CMP2 body.
    const big = JSON.stringify({ u1: Array.from({ length: 600 }, (_, i) => "tag-" + i) });
    const compressed = __compressIfNeeded(big);
    assert.ok(compressed.startsWith("CMP2:"), "test precondition: value must compress to CMP2");
    assert.notEqual(compressed, big, "compressed form must differ from plain form");

    const hPlain = await hashOf({ appTheme: "dark", itemTags: big });
    const hComp = await hashOf({ appTheme: "dark", itemTags: compressed });
    assert.equal(hPlain, hComp, "compressed and plain twins must hash equal");
  });

  test("scalar stored as raw vs JSON-quoted hash EQUAL", async () => {
    const hRaw = await hashOf({ appTheme: "dark" }); // raw scalar (no quotes)
    const hJson = await hashOf({ appTheme: '"dark"' }); // JSON-quoted string
    assert.equal(hRaw, hJson, "raw scalar and JSON-quoted twin must hash equal");
  });

  test("object key-order variance hashes EQUAL", async () => {
    const h1 = await hashOf({ objConfig: '{"a":1,"b":2}' });
    const h2 = await hashOf({ objConfig: '{"b":2,"a":1}' });
    assert.equal(h1, h2, "key-order must not change the hash");
  });

  test("a genuine value change DOES change the hash", async () => {
    const h1 = await hashOf({ appTheme: "dark" });
    const h2 = await hashOf({ appTheme: "light" });
    assert.notEqual(h1, h2, "different logical content must hash differently");
  });

  test("array reorder DOES change the hash (array order is meaningful)", async () => {
    const h1 = await hashOf({ arrConfig: '["a","b","c"]' });
    const h2 = await hashOf({ arrConfig: '["c","b","a"]' });
    assert.notEqual(h1, h2, "array element order must remain significant");
  });

  test("metalInventory key is excluded from the settings hash", async () => {
    const h1 = await hashOf({ appTheme: "dark", metalInventory: "[{}]" });
    const h2 = await hashOf({ appTheme: "dark", metalInventory: "[{},{}]" });
    assert.equal(h1, h2, "inventory must not influence the settings hash");
  });
});

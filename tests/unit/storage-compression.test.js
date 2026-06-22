// Unit tests for the localStorage compression layer (STRK-140).
//
// Verifies the real __compressIfNeeded / __decompressIfNeeded helpers from js/utils-storage.js
// against the real vendored lz-string engine, and — critically — the dual-format read
// that prevents data loss on upgrade:
//   CMP2: = real lz-string-compressed body (decompress on read)
//   CMP1: = legacy identity-stub body (UNCOMPRESSED; slice prefix only, never decompress)
//
// The CMP1 case is the data-integrity guard: decompressing a never-compressed body with
// lz-string returns garbage, so existing users' data must be sliced, not decompressed.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// Load the vendored lz-string via a synthetic CJS module context (the sw-router.test.js
// pattern). The minified UMD assigns the IIFE result to module.exports here, the same
// object a browser exposes as window.LZString.
const lzCode = readFileSync(new URL("../../vendor/lz-string.min.js", import.meta.url), "utf-8");
const _lzModule = { exports: {} };
new Function("module", "exports", "window", lzCode)(_lzModule, _lzModule.exports, undefined);
const LZString = _lzModule.exports;

// Load the REAL compression helpers from source (not a reimplementation) by slicing the
// block between the prefix constants and the boot-migration marker, then evaluating it
// with the real LZString injected — mirrors the sw-router.test.js eval pattern.
// STRK-177: the compression codec moved verbatim from js/utils.js to js/utils-storage.js.
const src = readFileSync(new URL("../../js/utils-storage.js", import.meta.url), "utf-8");
const start = src.indexOf("const __ST_COMP_PREFIX");
const end = src.indexOf("// Kick off the one-time");
assert.ok(
  start !== -1 && end !== -1 && end > start,
  "could not locate compression block in utils-storage.js"
);
const block = src.slice(start, end);
const factory = new Function(
  "__LZ",
  "__LZ_REAL",
  block +
    "\nreturn { __compressIfNeeded, __decompressIfNeeded, __ST_COMP_PREFIX, __ST_LEGACY_PREFIX };"
);
// Real-engine instance (vendor loaded).
const { __compressIfNeeded, __decompressIfNeeded, __ST_COMP_PREFIX, __ST_LEGACY_PREFIX } = factory(
  LZString,
  true
);
// Fallback instance (vendor failed to load → identity no-op, __LZ_REAL=false).
const identity = { compressToUTF16: (i) => i, decompressFromUTF16: (i) => i };
const { __compressIfNeeded: __compressNoEngine } = factory(identity, false);

const bigJson = JSON.stringify(
  Array.from({ length: 3000 }, (_, i) => ({
    date: "2026-01-" + i,
    value: i * 1.2345,
    vendors: { apmex: i, jm: i + 1, sd: i + 2 },
  }))
);

// Extract the real one-time migration (__migrateCompressionV2) and exercise it against a
// mock localStorage, injecting the same deps it closes over in utils.js.
const migStart = src.indexOf("const __migrateCompressionV2");
const migEnd = src.indexOf("\n};", migStart) + 3;
const migSrc = src.slice(migStart, migEnd);
function makeMockLS(initial) {
  const store = new Map(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    key(i) {
      return Array.from(store.keys())[i] ?? null;
    },
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(k, String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
  };
}
function buildMigration(ls) {
  return new Function(
    "__LZ_REAL",
    "__compressIfNeeded",
    "__ST_LEGACY_PREFIX",
    "__ST_COMP_PREFIX",
    "localStorage",
    migSrc + "\nreturn __migrateCompressionV2;"
  )(true, __compressIfNeeded, "CMP1:", "CMP2:", ls);
}

describe("storage compression (STRK-140)", () => {
  test("vendored lz-string round-trips via UTF16", () => {
    const c = LZString.compressToUTF16(bigJson);
    assert.equal(LZString.decompressFromUTF16(c), bigJson);
  });

  test("prefix constants are CMP2 (current) and CMP1 (legacy)", () => {
    assert.equal(__ST_COMP_PREFIX, "CMP2:");
    assert.equal(__ST_LEGACY_PREFIX, "CMP1:");
  });

  test("small payloads (<4096) pass through uncompressed and unprefixed", () => {
    const small = JSON.stringify({ a: 1, b: 2 });
    assert.equal(__compressIfNeeded(small), small);
    assert.equal(__decompressIfNeeded(small), small);
  });

  test("large payloads compress with CMP2 prefix and shrink materially", () => {
    const out = __compressIfNeeded(bigJson);
    assert.ok(out.startsWith("CMP2:"), "expected CMP2: prefix on compressed payload");
    assert.ok(
      out.length < bigJson.length / 3,
      "expected >3x reduction; got " + (bigJson.length / out.length).toFixed(1) + "x"
    );
  });

  test("CMP2 round-trip restores the original (compress -> decompress)", () => {
    assert.equal(__decompressIfNeeded(__compressIfNeeded(bigJson)), bigJson);
  });

  test("DATA-LOSS GUARD: legacy CMP1 body is sliced, not decompressed", () => {
    // Pre-3.35.1 identity stub wrote "CMP1:" + raw (uncompressed) JSON.
    const legacy = "CMP1:" + bigJson;
    assert.equal(__decompressIfNeeded(legacy), bigJson, "legacy CMP1 data must read back intact");
  });

  test("decompressing a CMP1 body via lz-string would corrupt it (proves why slice is required)", () => {
    // Sanity: confirms the hazard the CMP1 branch avoids.
    assert.notEqual(LZString.decompressFromUTF16(bigJson), bigJson);
  });

  test("FALLBACK SAFETY: no real engine → large payload stored plain (no CMP2 marker)", () => {
    // If lz-string failed to load, __compressIfNeeded must NOT emit CMP2: on an
    // uncompressed body, or a later read with a working engine would decompress garbage.
    const out = __compressNoEngine(bigJson);
    assert.ok(!out.startsWith("CMP2:"), "must not emit CMP2 without a real engine");
    assert.equal(out, bigJson, "no-engine path stores the payload unchanged");
    // And it round-trips through the real reader as plain (unprefixed) JSON.
    assert.equal(__decompressIfNeeded(out), bigJson);
  });

  test("non-string input is returned as-is", () => {
    assert.equal(__decompressIfNeeded(null), null);
    assert.equal(__decompressIfNeeded(undefined), undefined);
  });

  test("__LZ_REAL sentinel discriminates a real engine from an identity-shaped global", () => {
    // Mirrors the sentinel in utils.js: a real engine transforms the probe (comp !== probe)
    // AND round-trips; an identity-shaped global round-trips but does NOT transform.
    const sentinel = (lz) => {
      try {
        if (
          !lz ||
          typeof lz.compressToUTF16 !== "function" ||
          typeof lz.decompressFromUTF16 !== "function"
        ) {
          return false;
        }
        const probe = "STRK-140-".repeat(8);
        const comp = lz.compressToUTF16(probe);
        return comp !== probe && lz.decompressFromUTF16(comp) === probe;
      } catch (e) {
        return false;
      }
    };
    assert.equal(sentinel(LZString), true, "real vendored lz-string must pass");
    assert.equal(sentinel(identity), false, "identity-shaped global must be rejected");
    assert.equal(sentinel(null), false);
    assert.equal(sentinel({ compressToUTF16: (i) => i }), false, "missing decompress fn → false");
  });

  test("boot migration re-encodes CMP1/large keys to CMP2, preserves data, is idempotent", () => {
    const ls = makeMockLS({
      v2RetailHistory: "CMP1:" + bigJson, // legacy CMP1 → should convert to CMP2
      metalSpotHistory: bigJson, // large UNPREFIXED → deliberately left untouched
      appTheme: "dark", // small scalar — untouched
      spotGold: "2000", // small scalar — untouched
    });
    const runMigration = buildMigration(ls);
    runMigration();

    assert.ok(ls.getItem("v2RetailHistory").startsWith("CMP2:"), "CMP1 legacy → CMP2");
    assert.equal(
      __decompressIfNeeded(ls.getItem("v2RetailHistory")),
      bigJson,
      "CMP1 data preserved through migration"
    );
    assert.equal(
      ls.getItem("metalSpotHistory"),
      bigJson,
      "large unprefixed value left untouched (CMP1-only migration)"
    );
    assert.equal(ls.getItem("appTheme"), "dark", "small scalar untouched");
    assert.equal(ls.getItem("spotGold"), "2000", "small scalar untouched");
    assert.equal(ls.getItem("migration_cmp2_compression"), "true", "flag set");

    // Idempotent: a second run changes nothing (flag short-circuits).
    const snapshot = ls.getItem("v2RetailHistory");
    runMigration();
    assert.equal(ls.getItem("v2RetailHistory"), snapshot, "second run is a no-op");
  });
});

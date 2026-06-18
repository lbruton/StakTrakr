// Unit tests for the STRK-202 custom-rule id hardening + import path.
//
// Two behaviours are under test:
//   1. loadCustomRules derives a STABLE, content-based id for rules persisted
//      without one (the old `id: r.id || "custom-" + Date.now()` fallback minted
//      a fresh id every load and could collide two id-less rules on a shared
//      millisecond). The image binding keys on seedImageId, which is preserved
//      verbatim, so a derived rule id never changes which pattern image renders.
//   2. importRules (used by the backup-restore round-trip) preserves each rule's
//      id AND seedImageId so previously-cached pattern images stay bound, dedupes
//      by id, and supports merge vs. replace.
//
// The whole NumistaLookup IIFE is loaded via `new Function` with its free globals
// injected (mirrors the slice-and-eval pattern in
// cloud-sync-item-price-history-merge.test.js): a localStorage stub, a silent
// console, and a deterministic, content-sensitive simpleHash stand-in that
// reproduces the real "sh:"-prefixed shape from js/vault.js.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/numista-lookup.js", import.meta.url), "utf-8");

// Deterministic, content-sensitive stand-in for js/vault.js simpleHash. We only
// rely on (a) equal inputs → equal output and (b) different inputs → (almost
// always) different output, so any pure function of the string suffices.
const simpleHash = (str) => {
  let h = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return "sh:" + (h >>> 0).toString(16);
};

/**
 * Loads a fresh NumistaLookup instance with an isolated localStorage stub.
 * @param {Array<Object>} [seed] - Rules to pre-seed under "numistaLookupRules".
 * @returns {{ NumistaLookup: Object, store: Map<string,string> }}
 */
function loadNumistaLookup(seed) {
  const store = new Map();
  if (seed !== undefined) store.set("numistaLookupRules", JSON.stringify(seed));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const factory = new Function(
    "window",
    "localStorage",
    "simpleHash",
    "console",
    src + "\nreturn NumistaLookup;"
  );
  const NumistaLookup = factory({}, localStorage, simpleHash, { warn() {}, log() {} });
  return { NumistaLookup, store };
}

describe("NumistaLookup id hardening + import (STRK-202)", () => {
  test("loadCustomRules derives stable, non-colliding ids for id-less rules", () => {
    const seed = [
      { pattern: "morgan", replacement: "Morgan Dollar", seedImageId: "img-a" },
      { pattern: "peace", replacement: "Peace Dollar", seedImageId: "img-b" },
    ];
    const { NumistaLookup } = loadNumistaLookup(seed);

    NumistaLookup.loadCustomRules();
    const first = NumistaLookup.getCustomRules();
    assert.equal(first.length, 2);
    assert.ok(first[0].id && first[1].id, "both id-less rules receive an id");
    assert.notEqual(
      first[0].id,
      first[1].id,
      "distinct content yields distinct ids (no collision)"
    );
    assert.equal(first[0].seedImageId, "img-a", "seedImageId preserved");
    assert.equal(first[1].seedImageId, "img-b");

    // Re-loading the same id-less data derives the SAME ids (deterministic).
    NumistaLookup.loadCustomRules();
    const second = NumistaLookup.getCustomRules();
    assert.equal(second[0].id, first[0].id, "derived id is stable across reloads");
    assert.equal(second[1].id, first[1].id);
  });

  test("loadCustomRules preserves an explicit id", () => {
    const { NumistaLookup } = loadNumistaLookup([
      { id: "custom-keep-me", pattern: "x", replacement: "X", seedImageId: "img-x" },
    ]);
    NumistaLookup.loadCustomRules();
    assert.equal(NumistaLookup.getCustomRules()[0].id, "custom-keep-me");
  });

  test("importRules preserves id + seedImageId and dedupes by id on merge", () => {
    const { NumistaLookup } = loadNumistaLookup();
    const res = NumistaLookup.importRules(
      [
        { id: "r1", pattern: "a", replacement: "A", seedImageId: "img1" },
        { id: "r2", pattern: "b", replacement: "B", seedImageId: "img2" },
      ],
      true
    );
    assert.equal(res.success, true);
    assert.equal(res.imported, 2);
    assert.deepEqual(
      NumistaLookup.getCustomRules()
        .map((r) => [r.id, r.seedImageId])
        .sort(),
      [
        ["r1", "img1"],
        ["r2", "img2"],
      ]
    );

    // Re-importing an existing id is idempotent (existing rule wins).
    const res2 = NumistaLookup.importRules(
      [{ id: "r1", pattern: "a", replacement: "A", seedImageId: "img1" }],
      true
    );
    assert.equal(res2.imported, 0, "existing id is not re-added");
    assert.equal(NumistaLookup.getCustomRules().length, 2);
  });

  test("importRules persists rules (with seedImageId) to localStorage", () => {
    const { NumistaLookup, store } = loadNumistaLookup();
    NumistaLookup.importRules(
      [{ id: "r1", pattern: "a", replacement: "A", seedImageId: "img1" }],
      true
    );
    const persisted = JSON.parse(store.get("numistaLookupRules"));
    assert.equal(persisted[0].id, "r1");
    assert.equal(persisted[0].seedImageId, "img1");
  });

  test("importRules with merge=false replaces existing rules", () => {
    const { NumistaLookup } = loadNumistaLookup([
      { id: "old", pattern: "o", replacement: "O", seedImageId: "img-o" },
    ]);
    NumistaLookup.loadCustomRules();
    NumistaLookup.importRules(
      [{ id: "new", pattern: "n", replacement: "N", seedImageId: "img-n" }],
      false
    );
    const rules = NumistaLookup.getCustomRules();
    assert.equal(rules.length, 1);
    assert.equal(rules[0].id, "new");
  });

  test("importRules skips invalid rules (missing pattern or replacement)", () => {
    const { NumistaLookup } = loadNumistaLookup();
    const res = NumistaLookup.importRules(
      [
        { id: "bad", pattern: "", replacement: "X" },
        { id: "good", pattern: "y", replacement: "Y", seedImageId: "img-y" },
      ],
      true
    );
    assert.equal(res.imported, 1);
    assert.equal(NumistaLookup.getCustomRules()[0].id, "good");
  });

  test("importRules derives a stable id for an id-less imported rule", () => {
    const { NumistaLookup } = loadNumistaLookup();
    NumistaLookup.importRules([{ pattern: "z", replacement: "Z", seedImageId: "img-z" }], true);
    const rules = NumistaLookup.getCustomRules();
    assert.equal(rules.length, 1);
    assert.ok(rules[0].id.startsWith("custom-"), "derived id keeps the custom- prefix");
    assert.equal(rules[0].seedImageId, "img-z", "seedImageId preserved on derived-id rule");
  });

  test("importRules rejects a non-array input", () => {
    const { NumistaLookup } = loadNumistaLookup();
    const res = NumistaLookup.importRules(null, true);
    assert.equal(res.success, false);
    assert.equal(res.imported, 0);
  });
});

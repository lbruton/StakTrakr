// Regression tests for STRK-241 — constitutional fields must be part of the
// cloud-sync inventory hash.
//
// `computeInventoryHash` (js/cloud-sync.js) samples a fixed per-item content
// fingerprint (`contentSample`) so a field change is detectable even when the
// item key (uuid) is unchanged. Before the fix it omitted
// `constitutionalVariant` / `constitutionalEntryMode`, so a remote edit that
// changed only a synced junk-silver item's denomination/entry-mode on the same
// uuid produced an IDENTICAL hash. `pollForRemoteChanges` then hit the
// empty-diff silent fast-path and never opened the diff/merge path, silently
// dropping the remote values. Distinct variants even share `facePerCoin`
// (con-90-half and con-40-half both 0.5) so `weight` could not catch it either.
//
// These tests slice `computeInventoryHash` out of the source (mirroring the
// slice-and-eval pattern in cloud-sync-pull-reentrancy.test.js) and call it with
// stubbed dependencies. Two items identical except for a constitutional field
// must hash differently: RED before the fix, GREEN after appending the two
// fields to `contentSample`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";

const src = readFileSync(new URL("../../js/cloud-sync.js", import.meta.url), "utf-8");

// Slice the computeInventoryHash function body and wrap it so it can run with
// stubbed deps. The function's closing brace is the first column-0 `}` after the
// declaration (every nested brace is indented), so "\n}" bounds it precisely.
//
// `new Function(fnSrc)` here is NOT user input: `fnSrc` is sliced from the
// repository's own js/cloud-sync.js read off disk — the same trusted
// slice-and-eval idiom used by cloud-sync-pull-reentrancy.test.js for these
// no-export script-global modules. No external/untrusted string is interpolated.
function buildHashFn() {
  const start = src.indexOf("async function computeInventoryHash(items) {");
  assert.ok(start !== -1, "could not locate computeInventoryHash in js/cloud-sync.js");
  const end = src.indexOf("\n}", start) + 2;
  const fnSrc = src.slice(start, end);
  const factory = new Function(
    "crypto",
    "TextEncoder",
    "DiffEngine",
    "_stableCanonicalString",
    "sha256BufferToHex",
    "debugLog",
    fnSrc + "\nreturn computeInventoryHash;"
  );
  return factory(
    webcrypto,
    TextEncoder,
    { computeItemKey: (item) => item.uuid || "" },
    (o) => JSON.stringify(o),
    (buf) =>
      Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    () => {}
  );
}

describe("STRK-241 — constitutional fields participate in the inventory hash", () => {
  test("denomination-only change on the same uuid yields a different hash", async () => {
    const computeInventoryHash = buildHashFn();
    const base = {
      uuid: "u-1",
      name: "Junk Silver",
      metal: "Silver",
      weightUnit: "cu",
      weight: 0.5, // facePerCoin shared by con-90-half AND con-40-half
      constitutionalEntryMode: "denom",
      constitutionalVariant: "con-90-half",
    };
    const swapped = { ...base, constitutionalVariant: "con-40-half" };
    const hashA = await computeInventoryHash([base]);
    const hashB = await computeInventoryHash([swapped]);
    assert.ok(hashA, "hash should be a non-null hex string (crypto.subtle available)");
    assert.notEqual(hashA, hashB, "a variant change must change the inventory hash");
  });

  test("entry-mode-only change on the same uuid yields a different hash", async () => {
    const computeInventoryHash = buildHashFn();
    const base = {
      uuid: "u-2",
      weightUnit: "cu",
      weight: 1,
      constitutionalEntryMode: "denom",
      constitutionalVariant: "con-90-dollar",
    };
    const swapped = { ...base, constitutionalEntryMode: "face" };
    const hashA = await computeInventoryHash([base]);
    const hashB = await computeInventoryHash([swapped]);
    assert.notEqual(hashA, hashB, "an entry-mode change must change the inventory hash");
  });
});

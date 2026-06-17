// Unit tests for the pure item-price-history companion-vault merge (STRK-147).
//
// item-price-history is UUID-keyed structured JSON
// ({ [uuid]: [{ ts, itemName, retail, spot, melt }, ...] }) that is cloud-synced
// via a dedicated companion vault, NOT the last-write-wins SYNC_SCOPE_KEYS path.
// It must merge by UNION so entries recorded independently on two devices are
// never silently dropped (AC-1, AC-2). The convergence contract mirrors the tag
// merge (_mergeTagData): a logical (decompressed/parsed/sorted) compare+hash that
// is commutative on ties (AC-9) and idempotent (AC-2).
//
// These tests load the REAL pure helpers (canonicalizeItemPriceHistory,
// mergeItemPriceHistories, collectAndHashItemPriceHistory) from the
// "CLOUD-SYNC COMPANION MERGE (STRK-147)" block in js/priceHistory.js via the
// slice-and-eval pattern (mirrors cloud-sync-tag-merge.test.js), with the block's
// free-global dependencies (getSnapshotItemName, applyItemPriceRetention,
// __decompressIfNeeded, simpleHash, itemPriceHistory, saveDataSync, retention
// constants, ITEM_PRICE_HISTORY_KEY) injected so the merge is a pure transform.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/priceHistory.js", import.meta.url), "utf-8");
const start = src.indexOf("const _ITEM_PRICE_UUID_RE");
// End marker: the SETTINGS LOG TABLE banner that immediately follows the A.3 block.
const end = src.indexOf("ITEM PRICE HISTORY", start + 1);
assert.ok(
  start !== -1 && end !== -1 && end > start,
  "could not locate the STRK-147 companion-merge block in js/priceHistory.js"
);
// Trim back to the last full line before the trailing banner's `// ====` fence.
const block = src.slice(start, src.lastIndexOf("// ===", end));

// Injected retention constants (mirror js/constants.js values).
const ITEM_PRICE_HISTORY_MAX_DAYS = 365;
const ITEM_PRICE_HISTORY_MAX_ENTRIES = 1000;
const ITEM_PRICE_HISTORY_KEY = "item-price-history";

// Faithful copy of getSnapshotItemName (js/priceHistory.js): itemName, then
// legacy `name`, else empty string.
const getSnapshotItemName = (entry) => {
  if (!entry || typeof entry !== "object") return "";
  if (typeof entry.itemName === "string" && entry.itemName.trim()) return entry.itemName.trim();
  if (typeof entry.name === "string" && entry.name.trim()) return entry.name.trim();
  return "";
};

// Faithful copy of applyItemPriceRetention (js/priceHistory.js): age cutoff +
// per-UUID newest-N backstop, in place. It uses the real Date.now (module scope,
// outside the sandbox), so fixtures are anchored to the real current time
// (FIXED_NOW) — within-window entries survive, genuinely old entries are dropped.
const applyItemPriceRetention = (history) => {
  if (!history || typeof history !== "object" || Array.isArray(history)) return history;
  const cutoff = Date.now() - ITEM_PRICE_HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000;
  for (const uuid of Object.keys(history)) {
    let entries = Array.isArray(history[uuid]) ? history[uuid] : [];
    entries = entries.filter((e) => e && e.ts >= cutoff);
    if (entries.length > ITEM_PRICE_HISTORY_MAX_ENTRIES) {
      entries = entries.slice(entries.length - ITEM_PRICE_HISTORY_MAX_ENTRIES);
    }
    if (entries.length === 0) delete history[uuid];
    else history[uuid] = entries;
  }
  return history;
};

// Identity decompressor — plain JSON strings pass through unchanged.
const __decompressIfNeeded = (s) => s;

// Deterministic, content-sensitive stand-in for the real simpleHash. We only
// assert hash EQUALITY for logically-identical inputs, so any pure function of
// the canonical string suffices; this mirrors a simple rolling hash.
const simpleHash = (str) => {
  let h = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
};

// Two valid canonical UUIDs (the block drops malformed keys).
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

// Anchor fixtures to the real current time so the real-Date retention cap keeps
// within-window entries (the AC-10 test still pushes one entry 400 days back to
// prove the age cutoff fires post-merge).
const FIXED_NOW = Date.now();

// Build a sandbox per test: inject the block's free globals + a settable
// itemPriceHistory, and return the three pure helpers bound to it. The block's
// canonicalize/merge are time-independent; only the injected retention reads
// Date, which it does from module scope.
function loadHelpers(seedHistory) {
  let itemPriceHistory = seedHistory ? JSON.parse(JSON.stringify(seedHistory)) : {};
  const saveDataSync = () => {};

  const factory = new Function(
    "getSnapshotItemName",
    "applyItemPriceRetention",
    "__decompressIfNeeded",
    "simpleHash",
    "saveDataSync",
    "itemPriceHistory",
    "ITEM_PRICE_HISTORY_KEY",
    "ITEM_PRICE_HISTORY_MAX_DAYS",
    "ITEM_PRICE_HISTORY_MAX_ENTRIES",
    block +
      "\nreturn { canonicalizeItemPriceHistory, mergeItemPriceHistories, collectAndHashItemPriceHistory };"
  );

  return factory(
    getSnapshotItemName,
    applyItemPriceRetention,
    __decompressIfNeeded,
    simpleHash,
    saveDataSync,
    itemPriceHistory,
    ITEM_PRICE_HISTORY_KEY,
    ITEM_PRICE_HISTORY_MAX_DAYS,
    ITEM_PRICE_HISTORY_MAX_ENTRIES
  );
}

// All fixture timestamps are recent so the retention age cutoff never drops them
// (except the dedicated AC-10 age-cutoff test).
const RECENT = FIXED_NOW - 24 * 60 * 60 * 1000; // 1 day ago

// Compact entry factory — collapses the repeated { ts, itemName, retail, spot,
// melt } fixture literal. spot/melt default to the common 9/8 pair; pass them
// explicitly only when a test asserts on a different value.
const e = (ts, itemName, retail, spot = 9, melt = 8) => ({ ts, itemName, retail, spot, melt });

describe("STRK-147 pure item-price-history merge / canonicalize / hash", () => {
  test("AC-1: cross-device union — different entries for the same UUID merge to the union", () => {
    const { mergeItemPriceHistories } = loadHelpers();
    const deviceA = { [U1]: [e(RECENT, "A", 10)] };
    const deviceB = { [U1]: [e(RECENT + 1, "A", 11)] };

    const merged = mergeItemPriceHistories(deviceA, deviceB);

    assert.equal(merged[U1].length, 2, "both devices' distinct entries survive the union");
    assert.deepEqual(
      merged[U1].map((e) => e.ts),
      [RECENT, RECENT + 1],
      "union holds entries from both devices, ordered by ts"
    );
  });

  test("AC-2: idempotent re-merge — merge(X, X) deep-equals canonicalize(X)", () => {
    const { mergeItemPriceHistories, canonicalizeItemPriceHistory } = loadHelpers();
    const X = {
      [U2]: [e(RECENT + 5, "Z", 2, 1, 1)],
      [U1]: [e(RECENT + 1, "A", 10), e(RECENT, "A", 7, 6, 5)],
    };

    const merged = mergeItemPriceHistories(X, X);
    const canon = canonicalizeItemPriceHistory(X);

    assert.deepEqual(
      merged,
      canon,
      "merge(X,X) must converge to canonicalize(X) — no churn on a no-op sync"
    );

    // A second merge over the already-merged result is also a no-op (convergent on ties).
    const reMerged = mergeItemPriceHistories(merged, merged);
    assert.deepEqual(reMerged, merged, "re-merging the converged result changes nothing");
  });

  test("AC-3: same-ts distinct entries both survive; exact duplicates collapse to one", () => {
    const { mergeItemPriceHistories } = loadHelpers();
    const sameTs = RECENT + 42;
    const local = {
      [U1]: [
        e(sameTs, "A", 10), // distinct by retail
        e(sameTs, "A", 99), // exact dup also on remote
      ],
    };
    const remote = {
      [U1]: [
        e(sameTs, "A", 99), // exact duplicate -> collapses
        e(sameTs, "B", 10), // distinct by itemName
      ],
    };

    const merged = mergeItemPriceHistories(local, remote);

    // 3 distinct fingerprints survive: (A,10),(A,99),(B,10) at the same ts; the
    // (A,99) exact duplicate from remote collapses into the local one.
    assert.equal(merged[U1].length, 3, "distinct same-ts entries preserved; exact dup collapsed");
    const fps = merged[U1].map((e) => `${e.itemName}/${e.retail}`).sort();
    assert.deepEqual(
      fps,
      ["A/10", "A/99", "B/10"],
      "exactly the distinct same-ts fingerprints remain"
    );
  });

  test("AC-9: merge is commutative including tie order — merge(A,B) deep-equals merge(B,A)", () => {
    const A = {
      [U1]: [
        e(RECENT, "A", 10),
        e(RECENT, "Z", 10), // same ts, differs by name
      ],
    };
    const B = {
      [U1]: [
        e(RECENT, "M", 10), // same ts, between A and Z
      ],
      [U2]: [e(RECENT + 3, "Q", 1, 1, 1)],
    };

    const ab = loadHelpers().mergeItemPriceHistories(A, B);
    const ba = loadHelpers().mergeItemPriceHistories(B, A);

    assert.deepEqual(ab, ba, "merge must be commutative including same-ts tie ordering");
  });

  test("AC-9: compressed-vs-plain hash equality — collectAndHashItemPriceHistory is input-form-independent", () => {
    const history = {
      [U2]: [e(RECENT + 2, "Z", 5, 4, 3)],
      [U1]: [e(RECENT + 1, "A", 10), e(RECENT, "A", 7, 6, 5)],
    };

    // Plain-object form: seed itemPriceHistory as the object.
    const plain = loadHelpers(history).collectAndHashItemPriceHistory();
    // "Compressed"/serialized form: feed the same logical content as its JSON
    // string (the block's __decompressIfNeeded is identity for plain JSON).
    const asString = loadHelpers(
      JSON.parse(JSON.stringify(history))
    ).collectAndHashItemPriceHistory();

    assert.equal(plain.hash, asString.hash, "object-seeded and re-seeded forms hash identically");

    // Key-order / nesting must not perturb the hash: a reordered-key clone canonicalizes the same.
    const reordered = { [U1]: history[U1].slice().reverse(), [U2]: history[U2] };
    const reorderedHash = loadHelpers(reordered).collectAndHashItemPriceHistory();
    assert.equal(
      reorderedHash.hash,
      plain.hash,
      "UUID/entry key-order and entry-order variants do not produce a phantom hash conflict"
    );
    assert.equal(plain.uuidCount, 2, "uuidCount reflects the canonical content");
    assert.equal(plain.entryCount, 3, "entryCount reflects the canonical content");
  });

  test("AC-10: retention cap is applied AFTER merge (age cutoff + per-UUID limit)", () => {
    const { mergeItemPriceHistories } = loadHelpers();
    const day = 24 * 60 * 60 * 1000;
    const ancient = e(FIXED_NOW - 400 * day, "A", 1, 1, 1);
    const recent = e(FIXED_NOW - 10 * day, "A", 2, 2, 2);

    // Per-UUID limit: 1200 entries on U2 must cap to the newest 1000.
    const many = [];
    for (let i = 0; i < 1200; i++) {
      many.push(e(FIXED_NOW - (1200 - i) * 1000, "B", i, i, i));
    }

    const merged = mergeItemPriceHistories(
      { [U1]: [ancient], [U2]: many.slice(0, 600) },
      { [U1]: [recent], [U2]: many.slice(600) }
    );

    assert.equal(merged[U1].length, 1, "age-expired entry dropped post-merge");
    assert.equal(merged[U1][0].ts, recent.ts, "the within-window entry is the one retained");
    assert.equal(
      merged[U2].length,
      ITEM_PRICE_HISTORY_MAX_ENTRIES,
      "per-UUID entry cap applied after the union"
    );
    assert.ok(
      merged[U2].some((e) => e.retail === 1199),
      "newest entry survives the per-UUID cap"
    );
    assert.ok(!merged[U2].some((e) => e.retail === 0), "oldest entry dropped by the per-UUID cap");
  });

  test("AC-6: acceptedUuids filter drops remote-only orphan UUIDs; local is never filtered", () => {
    const { mergeItemPriceHistories } = loadHelpers();
    const local = { [U1]: [e(RECENT, "A", 10)] };
    const remote = {
      [U1]: [e(RECENT + 1, "A", 11)],
      [U2]: [e(RECENT + 2, "ORPHAN", 5, 4, 3)],
    };

    // Boundary accepts only U1 — the rejected remote Item U2 must not import history.
    const merged = mergeItemPriceHistories(local, remote, new Set([U1]));

    assert.ok(!(U2 in merged), "rejected remote UUID's history is not imported (AC-6)");
    assert.equal(merged[U1].length, 2, "accepted UUID still unions local + remote entries");

    // Array boundary form is accepted too, and local-only UUIDs are never filtered
    // even when absent from the accepted set.
    const localOnly = mergeItemPriceHistories(local, {}, []);
    assert.equal(localOnly[U1].length, 1, "empty acceptedUuids never drops trusted local history");
  });
});

// Unit tests for the convergent per-item tag merge (STRK-155, parent STRK-154).
//
// The cloud-sync tag merge (_mergeTagData in js/cloud-sync.js) was last-write-wins
// keyed on itemTagsLastModified. On a timestamp TIE with differing content it
// no-op'd and kept local — making it non-commutative: merge(A,B) != merge(B,A).
// Two devices whose itemTags/itemRemovedTags diverged while sharing an identical
// itemTagsLastModified map could therefore never reconcile, and computeSettingsHash
// looped forever.
//
// Fix: on a timestamp tie where content differs, take the deterministic UNION of
// both sides' tags (case-insensitive dedup, deterministic representative, sorted),
// and bump the timestamp when content changes. Union is commutative -> both devices
// converge to the same superset.
//
// These tests load the REAL _mergeTagData block from js/cloud-sync.js via the
// slice-and-eval pattern (mirrors storage-compression.test.js) with mock storage
// and a stubbed clock injected, so the merge is a pure data transformation.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/cloud-sync.js", import.meta.url), "utf-8");
const start = src.indexOf("function _tagSyncKeys()");
const end = src.indexOf("function _mergeOneSidedTagSettings");
assert.ok(
  start !== -1 && end !== -1 && end > start,
  "could not locate tag-merge block in cloud-sync.js"
);
const block = src.slice(start, end);

const FIXED_NOW = 9_999_000;

// Build a fresh sandbox (mock storage + stubbed deps) and return _mergeTagData bound to it.
function makeMerge(seed) {
  const store = JSON.parse(JSON.stringify(seed || {}));
  const loadDataSync = (key, def) => (key in store ? store[key] : def);
  const saveDataSync = (key, data) => {
    store[key] = data;
  };
  const loadTagTimestamps = () => store.itemTagsLastModified || {};
  const loadItemTags = () => {};
  const localStorageMock = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  const __decompressIfNeeded = (s) => s;
  function MockDate() {}
  MockDate.now = () => FIXED_NOW;

  const factory = new Function(
    "localStorage",
    "loadDataSync",
    "saveDataSync",
    "loadTagTimestamps",
    "loadItemTags",
    "__decompressIfNeeded",
    "Date",
    block + "\nreturn { _mergeTagData: _mergeTagData };"
  );
  const { _mergeTagData } = factory(
    localStorageMock,
    loadDataSync,
    saveDataSync,
    loadTagTimestamps,
    loadItemTags,
    __decompressIfNeeded,
    MockDate
  );
  return { store, _mergeTagData };
}

// Run a merge: seed local state, apply a remote tag payload, return resulting stores.
function runMerge(localSeed, remote) {
  const { store, _mergeTagData } = makeMerge(localSeed);
  _mergeTagData(remote);
  return {
    itemTags: store.itemTags || {},
    itemRemovedTags: store.itemRemovedTags || {},
    itemTagsLastModified: store.itemTagsLastModified || {},
  };
}

describe("STRK-155 convergent per-item tag merge", () => {
  test("commutativity: divergent tags with EQUAL timestamps converge identically in both directions", () => {
    const A = {
      itemTags: { u1: ["alpha", "beta"] },
      itemRemovedTags: {},
      itemTagsLastModified: { u1: 1000 },
    };
    const B = {
      itemTags: { u1: ["beta", "gamma"] },
      itemRemovedTags: {},
      itemTagsLastModified: { u1: 1000 },
    };

    const r1 = runMerge(A, {
      itemTags: B.itemTags,
      itemRemovedTags: B.itemRemovedTags,
      itemTagsLastModified: B.itemTagsLastModified,
    });
    const r2 = runMerge(B, {
      itemTags: A.itemTags,
      itemRemovedTags: A.itemRemovedTags,
      itemTagsLastModified: A.itemTagsLastModified,
    });

    // merge(A,B) === merge(B,A) — byte-identical including timestamps
    assert.deepEqual(r1, r2, "merge must be commutative on a timestamp tie");
    // Converged to the sorted union superset
    assert.deepEqual(r1.itemTags.u1, ["alpha", "beta", "gamma"]);
    // Content changed on the tie -> timestamp bumped to the stubbed clock
    assert.equal(r1.itemTagsLastModified.u1, FIXED_NOW);
  });

  test("commutativity is case-insensitive: 'Gold' and 'gold' dedup to one deterministic representative", () => {
    const A = {
      itemTags: { u1: ["Gold", "silver"] },
      itemRemovedTags: {},
      itemTagsLastModified: { u1: 5000 },
    };
    const B = {
      itemTags: { u1: ["gold", "Silver", "copper"] },
      itemRemovedTags: {},
      itemTagsLastModified: { u1: 5000 },
    };

    const r1 = runMerge(A, {
      itemTags: B.itemTags,
      itemRemovedTags: B.itemRemovedTags,
      itemTagsLastModified: B.itemTagsLastModified,
    });
    const r2 = runMerge(B, {
      itemTags: A.itemTags,
      itemRemovedTags: A.itemRemovedTags,
      itemTagsLastModified: A.itemTagsLastModified,
    });

    assert.deepEqual(r1, r2, "case-variant union must be commutative");
    // One entry per lowercased tag; both directions pick the same representative
    const tags = r1.itemTags.u1;
    const lowered = tags.map((t) => t.toLowerCase());
    assert.deepEqual([...new Set(lowered)].sort(), ["copper", "gold", "silver"]);
    assert.equal(lowered.length, 3, "no case-duplicate tags survive");
  });

  test("regression: a genuinely newer remote timestamp still wins (LWW preserved when NOT tied)", () => {
    const r = runMerge(
      {
        itemTags: { u1: ["old"] },
        itemRemovedTags: {},
        itemTagsLastModified: { u1: 1000 },
      },
      {
        itemTags: { u1: ["fresh"] },
        itemRemovedTags: {},
        itemTagsLastModified: { u1: 2000 },
      }
    );
    assert.deepEqual(r.itemTags.u1, ["fresh"]);
    assert.equal(r.itemTagsLastModified.u1, 2000);
  });

  test("regression: a genuinely newer LOCAL timestamp still wins (no remote clobber)", () => {
    const r = runMerge(
      {
        itemTags: { u1: ["local-new"] },
        itemRemovedTags: {},
        itemTagsLastModified: { u1: 3000 },
      },
      {
        itemTags: { u1: ["remote-old"] },
        itemRemovedTags: {},
        itemTagsLastModified: { u1: 1000 },
      }
    );
    assert.deepEqual(r.itemTags.u1, ["local-new"]);
    assert.equal(r.itemTagsLastModified.u1, 3000);
  });

  test("idempotency: merging identical content on a tie does NOT bump the timestamp", () => {
    const r = runMerge(
      {
        itemTags: { u1: ["a", "b"] },
        itemRemovedTags: {},
        itemTagsLastModified: { u1: 1000 },
      },
      {
        itemTags: { u1: ["a", "b"] },
        itemRemovedTags: {},
        itemTagsLastModified: { u1: 1000 },
      }
    );
    assert.deepEqual(r.itemTags.u1, ["a", "b"]);
    assert.equal(r.itemTagsLastModified.u1, 1000, "no content change -> no timestamp bump");
  });

  test("removed-tags reconcile via present-vs-removed post-pass after union", () => {
    // u1: local removed 'beta'; remote still has 'beta' present, equal timestamps.
    // Union of present tags includes 'beta' -> it must be dropped from removed.
    const r = runMerge(
      {
        itemTags: { u1: ["alpha"] },
        itemRemovedTags: { u1: ["beta"] },
        itemTagsLastModified: { u1: 1000 },
      },
      {
        itemTags: { u1: ["alpha", "beta"] },
        itemRemovedTags: {},
        itemTagsLastModified: { u1: 1000 },
      }
    );
    assert.deepEqual(r.itemTags.u1, ["alpha", "beta"]);
    assert.equal(r.itemRemovedTags.u1, undefined, "present tag must not remain in removed list");
  });

  // STRK-155 review finding: legacy / Numista-batch tags (applyNumistaTags persist=false,
  // pre-timestamp installs) have tag content but NO itemTagsLastModified entry, so both
  // sides coerce to ts=0. The original tie-gate required a timestamp entry on both sides,
  // leaving these divergent-but-untimestamped tags non-convergent AND re-triggering a
  // silent tag-only merge every poll. The gate must also fire on equal timestamps when the
  // tag content is present on BOTH sides.
  test("untimestamped tags present on both sides still converge to the union", () => {
    const A = {
      itemTags: { u1: ["alpha", "beta"] },
      itemRemovedTags: {},
      itemTagsLastModified: {},
    };
    const B = {
      itemTags: { u1: ["beta", "gamma"] },
      itemRemovedTags: {},
      itemTagsLastModified: {},
    };
    const r1 = runMerge(A, {
      itemTags: B.itemTags,
      itemRemovedTags: B.itemRemovedTags,
      itemTagsLastModified: B.itemTagsLastModified,
    });
    const r2 = runMerge(B, {
      itemTags: A.itemTags,
      itemRemovedTags: A.itemRemovedTags,
      itemTagsLastModified: A.itemTagsLastModified,
    });
    assert.deepEqual(
      r1.itemTags.u1,
      ["alpha", "beta", "gamma"],
      "untimestamped tie converges to union"
    );
    assert.deepEqual(r1, r2, "commutative for the untimestamped case too");
    // content changed -> a timestamp is now stamped, ending the per-poll busy-loop
    assert.equal(r1.itemTagsLastModified.u1, FIXED_NOW);
  });

  test("untimestamped union is idempotent: re-merging the converged superset is a no-op", () => {
    // After convergence the uuid HAS a (bumped) timestamp; a stale untimestamped remote
    // must not clobber it, and identical content must not re-bump.
    const r = runMerge(
      {
        itemTags: { u1: ["alpha", "beta", "gamma"] },
        itemRemovedTags: {},
        itemTagsLastModified: { u1: FIXED_NOW },
      },
      {
        itemTags: { u1: ["alpha", "beta", "gamma"] },
        itemRemovedTags: {},
        itemTagsLastModified: {},
      }
    );
    assert.deepEqual(r.itemTags.u1, ["alpha", "beta", "gamma"]);
    assert.equal(
      r.itemTagsLastModified.u1,
      FIXED_NOW,
      "local stamped value wins over untimestamped remote"
    );
  });

  test("one-sided untimestamped uuid is NOT spuriously adopted (no false tie)", () => {
    // u2 exists only on the remote with no timestamp — must not be force-unioned into local.
    const r = runMerge(
      { itemTags: { u1: ["a"] }, itemRemovedTags: {}, itemTagsLastModified: {} },
      {
        itemTags: { u1: ["a"], u2: ["remote-only"] },
        itemRemovedTags: {},
        itemTagsLastModified: {},
      }
    );
    assert.equal(
      r.itemTags.u2,
      undefined,
      "remote-only untimestamped uuid is not adopted via the tie path"
    );
  });
});

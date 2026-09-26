// Unit tests for the Collections cloud-sync contract (STRK-370, epic STRK-254; invariant STRK-154).
//
// collectionState is a MANAGED sync key: a blind last-write-wins overwrite would drop a Slot
// filled on another device, so it carries its own merge exactly like the tag stores and the
// STRK-223 clear watermark. These tests ENCODE the four-part contract at the unit level:
//
//   SCOPE      — "collectionState" is in SYNC_SCOPE_KEYS, so it rides the sync vault and the
//                settings hash.
//   EXCLUDE    — _isManagedSyncKey covers it, so every settings-diff / apply site skips the
//                blind overwrite (the five existing call sites inherit it).
//   RE-DETECT  — _hasCollectionStateChange compares LOGICAL content (compressed-vs-plain and
//                key order are not changes) and is true only when the remote would CONTRIBUTE
//                something: merge(local, remote) !== local. An older remote that adds nothing
//                is not a change, so it can never trap the manifest path in an apply loop.
//   APPLY/HOLD — _mergeCollectionState routes through collectionsStore.mergeIn (the
//                commutative core merge) and THROWS when the write fails, so the caller rolls
//                back and holds lastPull for a retry.
//
// Loaded via slice-and-eval (see cloud-sync-convergence-audit.test.js) with the real
// collections-core.js, so the merge semantics under test are the shipped ones.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf-8");

const lzModule = { exports: {} };
new Function("module", "exports", "window", read("vendor/lz-string.min.js"))(
  lzModule,
  lzModule.exports,
  undefined
);
const LZString = lzModule.exports;
const utilsSrc = read("js/utils-storage.js");
const { __decompressIfNeeded } = new Function(
  "__LZ",
  "__LZ_REAL",
  utilsSrc.slice(
    utilsSrc.indexOf("const __ST_COMP_PREFIX"),
    utilsSrc.indexOf("// Kick off the one-time")
  ) + "\nreturn { __decompressIfNeeded };"
)(LZString, true);

const syncSrc = read("js/cloud-sync.js");

/** Slice one top-level sync function without copying its implementation into the test. */
function topLevelFunction(name) {
  const start = syncSrc.indexOf(`function ${name}(`);
  const end = syncSrc.indexOf("\nfunction ", start + 1);
  assert.notEqual(start, -1, `could not locate function ${name}`);
  return syncSrc.slice(start, end === -1 ? syncSrc.length : end);
}

/** Require the reconcile hook to follow both input merges and ordinary setting writes. */
function assertReconcileFollows(block, mergeNeedle, settingWriteNeedle) {
  const mergeAt = block.indexOf(mergeNeedle);
  const writeAt = block.lastIndexOf(settingWriteNeedle);
  const reconcileAt = block.lastIndexOf("reconcilePopulated");
  assert.notEqual(mergeAt, -1, `missing ${mergeNeedle}`);
  assert.notEqual(writeAt, -1, `missing ${settingWriteNeedle}`);
  assert.notEqual(reconcileAt, -1, "missing reconcilePopulated call");
  assert.ok(reconcileAt > mergeAt, "reconcilePopulated must follow the Collection merge");
  assert.ok(reconcileAt > writeAt, "reconcilePopulated must follow ordinary setting writes");
}

function slice(from, to) {
  const a = syncSrc.indexOf(from);
  const b = syncSrc.indexOf(to);
  assert.ok(a !== -1 && b !== -1 && b > a, `could not locate block ${from} .. ${to}`);
  return syncSrc.slice(a, b);
}

const coreSurface = {};
new Function("window", read("js/collections-core.js"))(coreSurface);
const core = coreSurface.collectionsCore;

const T1 = "2026-09-18T10:00:00.000Z";
const T2 = "2026-09-18T11:00:00.000Z";
const T3 = "2026-09-18T12:00:00.000Z";
const U = {
  a: "11111111-1111-4111-8111-111111111111",
  b: "22222222-2222-4222-8222-222222222222",
};

/** A state whose "ase-type2" Collection was started at T1. */
function started() {
  const state = core.createEmptyState();
  core.ensureCollection(state, {
    id: "ase-type2",
    kind: "template",
    templateSlug: "ase-type2",
    now: T1,
  });
  return state;
}

/** started() plus one link. */
function linked(slotId, uuid, now) {
  const state = started();
  core.linkItem(state, "ase-type2", slotId, uuid, { now });
  return state;
}

/**
 * Evaluates the real sync block against a storage double and a store double.
 * @param {{local?: Object|string|null, mergeIn?: Function}} [opts] - Local value + store stub
 * @returns {Object} The sync functions under test plus the mergeIn call log
 */
function loadSync(opts = {}) {
  const local =
    opts.local === undefined || opts.local === null
      ? null
      : typeof opts.local === "string"
        ? opts.local
        : JSON.stringify(opts.local);
  const calls = [];
  const windowDouble = {
    collectionsCore: core,
    collectionsStore: {
      mergeIn: (incoming) => {
        calls.push(incoming);
        return opts.mergeIn ? opts.mergeIn(incoming) : { ok: true, changed: true };
      },
    },
  };
  const _stableCanonicalString = new Function(
    slice("function _stableCanonicalString", "function _canonicalizeSettingValue") +
      "\nreturn _stableCanonicalString;"
  )();
  const fns = new Function(
    "window",
    "localStorage",
    "__decompressIfNeeded",
    "_stableCanonicalString",
    "console",
    slice("function _tagSyncKeys()", "function _restoreRawStorageValues") +
      "\nreturn { _isManagedSyncKey, _hasCollectionStateChange, _mergeCollectionState };"
  )(
    windowDouble,
    { getItem: (key) => (key === "collectionState" ? local : null) },
    __decompressIfNeeded,
    _stableCanonicalString,
    { warn: () => {} }
  );
  return Object.assign(fns, { calls });
}

describe("STRK-370 SCOPE + EXCLUDE", () => {
  test("collectionState is in SYNC_SCOPE_KEYS", () => {
    const constants = read("js/constants.js");
    const block = constants.slice(
      constants.indexOf("const SYNC_SCOPE_KEYS"),
      constants.indexOf("];", constants.indexOf("const SYNC_SCOPE_KEYS"))
    );
    assert.match(block, /"collectionState"/);
  });

  test("_isManagedSyncKey covers collectionState and still covers the tag + watermark keys", () => {
    const sync = loadSync();
    assert.equal(sync._isManagedSyncKey("collectionState"), true);
    assert.equal(sync._isManagedSyncKey("itemTags"), true);
    assert.equal(sync._isManagedSyncKey("itemPriceHistoryClearedAt"), true);
    assert.equal(sync._isManagedSyncKey("appTheme"), false);
  });
});

describe("STRK-370 RE-DETECT — _hasCollectionStateChange", () => {
  test("no remote settings, or a remote without the key, is not a change", () => {
    const sync = loadSync({ local: linked("2024", U.a, T2) });
    assert.equal(sync._hasCollectionStateChange(null), false);
    assert.equal(sync._hasCollectionStateChange({ appTheme: "dark" }), false);
  });

  test("identical logical content is not a change: key order and CMP2 compression", () => {
    const state = linked("2024", U.a, T2);
    const reordered = JSON.stringify(
      JSON.parse(JSON.stringify(state), (key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).reverse())
          : value
      )
    );
    const compressed = "CMP2:" + LZString.compressToUTF16(JSON.stringify(state));
    const sync = loadSync({ local: state });

    assert.equal(sync._hasCollectionStateChange({ collectionState: reordered }), false);
    assert.equal(sync._hasCollectionStateChange({ collectionState: compressed }), false);
  });

  test("a Slot filled on the other device is a change", () => {
    const sync = loadSync({ local: linked("2023", U.a, T2) });
    const remote = JSON.stringify(linked("2024", U.b, T2));
    assert.equal(sync._hasCollectionStateChange({ collectionState: remote }), true);
  });

  test("a newer remote unlink (Tombstone) over a local link is a change", () => {
    const remoteState = linked("2024", U.a, T2);
    core.unlinkItem(remoteState, "ase-type2", "2024", U.a, { now: T3 });
    const sync = loadSync({ local: linked("2024", U.a, T2) });

    assert.equal(
      sync._hasCollectionStateChange({ collectionState: JSON.stringify(remoteState) }),
      true
    );
  });

  test("an OLDER remote that contributes nothing is NOT a change (no apply loop)", () => {
    const local = linked("2024", U.a, T2);
    core.linkItem(local, "ase-type2", "2023", U.b, { now: T3 });
    const sync = loadSync({ local });
    const olderRemote = JSON.stringify(linked("2024", U.a, T2));

    assert.equal(sync._hasCollectionStateChange({ collectionState: olderRemote }), false);
  });

  test("a fresh device (no local state) sees any remote Collection as a change", () => {
    const sync = loadSync({ local: null });
    const remote = JSON.stringify(linked("2024", U.a, T2));
    assert.equal(sync._hasCollectionStateChange({ collectionState: remote }), true);
  });
});

describe("STRK-370 APPLY + HOLD — _mergeCollectionState", () => {
  test("hands the PARSED remote state to collectionsStore.mergeIn", () => {
    const sync = loadSync({ local: started() });
    const remote = linked("2024", U.b, T2);

    sync._mergeCollectionState({ collectionState: JSON.stringify(remote) });

    assert.equal(sync.calls.length, 1);
    assert.equal(sync.calls[0].collections["ase-type2"].slots["2024"].primary, U.b);
  });

  test("decompresses a CMP2 remote before merging", () => {
    const sync = loadSync({ local: started() });
    const remote = linked("2024", U.b, T2);
    const compressed = "CMP2:" + LZString.compressToUTF16(JSON.stringify(remote));

    sync._mergeCollectionState({ collectionState: compressed });

    assert.equal(sync.calls[0].collections["ase-type2"].slots["2024"].primary, U.b);
  });

  test("a remote without the key never touches the store", () => {
    const sync = loadSync({ local: started() });

    sync._mergeCollectionState({ appTheme: "dark" });
    sync._mergeCollectionState(null);

    assert.equal(sync.calls.length, 0);
  });

  test("a failed write THROWS so the caller rolls back and holds lastPull", () => {
    const sync = loadSync({
      local: started(),
      mergeIn: () => ({ ok: false, changed: false, reason: "save-failed" }),
    });
    const remote = JSON.stringify(linked("2024", U.b, T2));

    assert.throws(() => sync._mergeCollectionState({ collectionState: remote }), /save-failed/);
  });
});

describe("STRK-370 convergence — the merge the sync path relies on (STRK-154)", () => {
  test("device A fills 2023 while device B fills 2024: both survive, in either order", () => {
    const a = linked("2023", U.a, T2);
    const b = linked("2024", U.b, T2);

    const ab = JSON.parse(JSON.stringify(core.mergeStates(a, b)));
    const ba = JSON.parse(JSON.stringify(core.mergeStates(b, a)));

    assert.deepEqual(ab, ba);
    assert.equal(ab.collections["ase-type2"].slots["2023"].primary, U.a);
    assert.equal(ab.collections["ase-type2"].slots["2024"].primary, U.b);
  });

  test("a newer unlink on A beats an older link on B", () => {
    const a = linked("2024", U.a, T2);
    core.unlinkItem(a, "ase-type2", "2024", U.a, { now: T3 });
    const b = linked("2024", U.a, T2);

    const merged = core.mergeStates(b, a);

    assert.equal(merged.collections["ase-type2"].slots["2024"].primary, null);
  });
});

// ---------------------------------------------------------------------------
// Commit ordering on the vault-first silent pull (PR 1500 review, P1).
//
// restoreImageVaultData() decides whether a remote pattern record is current by
// calling isCurrentArtwork() against the LIVE collections store. On the
// vault-first silent branch the image vault was restored BEFORE
// _mergeCollectionState() ran, so a Collection the device had never seen was
// still absent when its cover art was judged — the art was dropped as orphaned,
// and the branch then recorded the image hash, so no later pull retried it.
//
// The fix is an ordering one, so the test is an ordering one: slice the real
// branch and assert the merge is observed before the image pull.
// ---------------------------------------------------------------------------

describe("STRK-370 commit ordering — Collections merge precedes artwork restore", () => {
  /** Slices the empty-diff "silently record pull" branch out of the real source. */
  function sliceSilentBranch() {
    return slice(
      "if (_noItemChanges && _noSettingsChanges) {",
      "// STRK-224 (Edge 3, D-3): capture the FULL prior lastPull"
    );
  }

  test("_mergeCollectionState runs BEFORE _pullImageVaultIfChanged", async () => {
    const order = [];
    // Free identifier resolved via globalThis: the branch guards it with typeof,
    // exactly as the STRK-234 re-entrancy harness relies on.
    globalThis._previewPullMeta = { syncId: "order-1", timestamp: 1, rev: "r1" };
    globalThis._mergeCollectionState = () => order.push("merge");

    const factory = new Function(
      "_noItemChanges",
      "_noSettingsChanges",
      "remoteMeta",
      "remotePayload",
      "token",
      "password",
      "SYNC_IMAGES_PATH",
      "fetch",
      "vaultDecryptAndRestoreImages",
      "_pullImageVaultIfChanged",
      "syncGetLastPull",
      "syncSetLastPull",
      "_pullAttachmentVault",
      "_pullItemPriceHistoryVault",
      "_currentInventoryUuids",
      "_mergeItemPriceClearWatermark",
      "logCloudSyncActivity",
      "updateSyncStatusIndicator",
      "debugLog",
      "return (async function () {\n" + sliceSilentBranch() + "\n});"
    );

    try {
      await factory(
        true,
        true,
        { imageVault: { hash: "img-hash" } },
        { data: {} },
        "tok",
        "pw",
        "/images.stvault",
        async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
        async () => 1,
        async () => {
          order.push("images");
          return { hash: "img-hash", failed: false };
        },
        () => null,
        () => {},
        async () => ({ hash: "attach" }),
        async () => ({ hash: "iph" }),
        () => [],
        () => {},
        () => {},
        () => {},
        () => {}
      )();
    } finally {
      delete globalThis._previewPullMeta;
      delete globalThis._mergeCollectionState;
    }

    assert.deepEqual(
      order,
      ["merge", "images"],
      "Collections must merge before artwork is judged against the store"
    );
  });
});

describe("STRK-393 post-apply populated Collection reconciliation", () => {
  test("_applyAndFinalize reconciles after Collection merge and ordinary setting writes", () => {
    const apply = topLevelFunction("_applyAndFinalize");
    assertReconcileFollows(
      apply,
      "_mergeCollectionState(opts.remoteRawSettings)",
      "localStorage.setItem(sc.key, writeVal)"
    );
  });

  test("manifest one-sided auto-merge reconciles after both merge and setting writes", () => {
    const start = syncSrc.indexOf(
      "var _tagMerge = _mergeOneSidedTagSettings(manifest.settings || {});"
    );
    const end = syncSrc.indexOf("var _amImage = await _pullImageVaultIfChanged(", start);
    assert.ok(start !== -1 && end > start, "could not locate manifest one-sided apply block");
    assertReconcileFollows(
      syncSrc.slice(start, end),
      "_mergeCollectionState(manifest.settings || {})",
      "localStorage.setItem("
    );
  });

  test("vault-first silent apply reconciles after merge and any ordinary settings writes", () => {
    const start = syncSrc.indexOf("if (_noItemChanges && _noSettingsChanges) {");
    const end = syncSrc.indexOf(
      "// STRK-224 (Edge 3, D-3): capture the FULL prior lastPull",
      start
    );
    assert.ok(start !== -1 && end > start, "could not locate vault-first silent branch");
    const branch = syncSrc.slice(start, end);
    const mergeAt = branch.indexOf("_mergeCollectionState(remotePayload.data)");
    const writes = branch.lastIndexOf("localStorage.setItem(");
    const reconcileAt = branch.lastIndexOf("reconcilePopulated");
    assert.notEqual(mergeAt, -1, "missing vault-first Collections merge");
    assert.notEqual(reconcileAt, -1, "missing vault-first reconcilePopulated call");
    assert.ok(
      reconcileAt > mergeAt,
      "vault-first reconciliation must follow the Collections merge"
    );
    if (writes !== -1) {
      assert.ok(reconcileAt > writes, "vault-first reconciliation must follow settings writes");
    }
  });

  test("a cancelled sync preview never reconciles Collections", () => {
    const applyStart = syncSrc.indexOf("function _applyAndFinalize(");
    const cancelStart = syncSrc.indexOf("onCancel: function () {", applyStart);
    const cancelEnd = syncSrc.indexOf("\n      },", cancelStart);
    assert.ok(applyStart !== -1 && cancelStart > applyStart && cancelEnd > cancelStart);
    assert.doesNotMatch(syncSrc.slice(cancelStart, cancelEnd), /reconcilePopulated/);
  });
});

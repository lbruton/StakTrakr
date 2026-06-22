// Regression tests for STRK-234 — cloud-sync pull re-entrancy race.
//
// `_previewPullMeta` (js/cloud-sync.js) is a module-level mutable global that is
// read and written across multiple await-spanning sync flows. pullWithPreview's
// empty-diff "silently record pull" branch set it once, then dereferenced it
// AFTER three network awaits (imageHash, attachmentHash, itemPriceHistoryHash).
// When two browser sessions sync concurrently, a second pull flow nulls the
// global during one of those awaits; the first flow resumes and crashes with
//   TypeError: can't access property "itemPriceHistoryHash", _previewPullMeta is null
// surfaced in the Restore Preview modal as "Could not decrypt vault for preview".
//
// AC-1/AC-2/AC-4 — Test 1 slice-and-evals the REAL silent branch out of
// js/cloud-sync.js (mirroring the slice-and-eval pattern in
// cloud-sync-convergence-audit.test.js) and injects a _pullItemPriceHistoryVault
// stub that nulls the shared global mid-await — exactly the interleaving. Before
// the fix the branch derefs the nulled global → TypeError (RED). The fix
// snapshots `var meta = _previewPullMeta` at branch entry and records `meta`, so
// the branch is immune to the global being nulled (GREEN), and the recorded
// lastPull still carries every companion hash.
//
// AC-3 — Test 2 verifies the serialization contract of the `_previewPullInFlight`
// re-entrancy guard added to pullWithPreview: a second pull cleanly defers while
// one is in flight, and the flag resets so a later pull proceeds.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/cloud-sync.js", import.meta.url), "utf-8");

// Slice the full empty-diff "silently record pull" `if` block. Both boundary
// markers exist in the pre-fix AND post-fix source, so the test reproduces the
// crash (RED) and then verifies the snapshot fix (GREEN) without the markers
// moving when the fix lands inside the block.
function sliceSilentBranch() {
  const start = src.indexOf("if (_noItemChanges && _noSettingsChanges) {");
  const end = src.indexOf("// STRK-224 (Edge 3, D-3): capture the FULL prior lastPull");
  assert.ok(
    start !== -1 && end !== -1 && end > start,
    "could not locate the empty-diff silent-record branch in js/cloud-sync.js"
  );
  return src.slice(start, end);
}

// Build an async runner for the sliced branch with all of its free globals
// injected as stubs. `_previewPullMeta` is intentionally NOT a parameter: leaving
// it a free identifier makes it resolve to globalThis (new Function bodies run
// non-strict), so an injected stub can null it mid-await exactly as a second
// concurrent pull flow would.
function buildRunner(stubs) {
  const block = sliceSilentBranch();
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
    "syncGetLastPull",
    "syncSetLastPull",
    "_pullAttachmentVault",
    "_pullItemPriceHistoryVault",
    "_currentInventoryUuids",
    "_mergeItemPriceClearWatermark",
    "logCloudSyncActivity",
    "updateSyncStatusIndicator",
    "debugLog",
    "return (async function () {\n" + block + "\n});"
  );
  return factory(
    true, // _noItemChanges — force the empty-diff branch
    true, // _noSettingsChanges
    stubs.remoteMeta,
    stubs.remotePayload,
    stubs.token,
    stubs.password,
    stubs.SYNC_IMAGES_PATH,
    stubs.fetch,
    stubs.vaultDecryptAndRestoreImages,
    stubs.syncGetLastPull,
    stubs.syncSetLastPull,
    stubs._pullAttachmentVault,
    stubs._pullItemPriceHistoryVault,
    stubs._currentInventoryUuids,
    stubs._mergeItemPriceClearWatermark,
    stubs.logCloudSyncActivity,
    stubs.updateSyncStatusIndicator,
    stubs.debugLog
  );
}

afterEach(() => {
  delete globalThis._previewPullMeta;
});

describe("STRK-234 — empty-diff silent pull survives a concurrent _previewPullMeta null", () => {
  test("AC-1/AC-4: nulling the shared global mid-await does not throw, and the pull records every companion hash", async () => {
    let recorded;
    // Seed the shared global exactly as pullWithPreview does at branch entry.
    globalThis._previewPullMeta = { syncId: "s1", timestamp: 123, rev: "r1" };

    const runner = buildRunner({
      remoteMeta: { imageVault: { hash: "img-hash" } },
      remotePayload: { data: {} },
      token: "tok",
      password: "pw",
      SYNC_IMAGES_PATH: "/images.stvault",
      fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
      vaultDecryptAndRestoreImages: async () => 5,
      syncGetLastPull: () => null,
      syncSetLastPull: (m) => {
        recorded = m;
      },
      _pullAttachmentVault: async () => ({ hash: "attach-hash" }),
      // THE INTERLEAVING: a second concurrent pull flow nulls the shared global
      // while this branch is awaiting the item-price-history companion fetch.
      _pullItemPriceHistoryVault: async () => {
        globalThis._previewPullMeta = null;
        return { hash: "iph-hash" };
      },
      _currentInventoryUuids: () => [],
      _mergeItemPriceClearWatermark: () => {},
      logCloudSyncActivity: () => {},
      updateSyncStatusIndicator: () => {},
      debugLog: () => {},
    });

    // Pre-fix this rejects with the TypeError at the itemPriceHistoryHash deref.
    await runner();

    assert.ok(
      recorded,
      "the silent pull recorded a lastPull even though the global was nulled mid-await"
    );
    assert.equal(recorded.syncId, "s1", "records the syncId captured at branch entry");
    assert.equal(recorded.imageHash, "img-hash", "image hash recorded");
    assert.equal(recorded.attachmentHash, "attach-hash", "attachment hash recorded");
    assert.equal(
      recorded.itemPriceHistoryHash,
      "iph-hash",
      "item-price-history hash recorded (the deref that crashed pre-fix)"
    );
  });

  test("AC-2: the recorded lastPull is the entry snapshot, not the live (nulled) global", async () => {
    let recorded;
    globalThis._previewPullMeta = { syncId: "s2", timestamp: 456, rev: "r2" };

    const runner = buildRunner({
      remoteMeta: {}, // no image vault — skip the image pull, exercise the later awaits
      remotePayload: { data: {} },
      token: "tok",
      password: "pw",
      SYNC_IMAGES_PATH: "/images.stvault",
      fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
      vaultDecryptAndRestoreImages: async () => 0,
      syncGetLastPull: () => null,
      syncSetLastPull: (m) => {
        recorded = m;
      },
      _pullAttachmentVault: async () => {
        // Concurrent flow nulls the global during the attachment await this time.
        globalThis._previewPullMeta = null;
        return { hash: "attach2" };
      },
      _pullItemPriceHistoryVault: async () => ({ hash: "iph2" }),
      _currentInventoryUuids: () => [],
      _mergeItemPriceClearWatermark: () => {},
      logCloudSyncActivity: () => {},
      updateSyncStatusIndicator: () => {},
      debugLog: () => {},
    });

    await runner();

    assert.ok(recorded, "records despite the global being nulled during the attachment await");
    assert.equal(recorded.syncId, "s2", "snapshot preserved the syncId");
    assert.equal(recorded.attachmentHash, "attach2", "attachment hash recorded onto the snapshot");
    assert.equal(
      recorded.itemPriceHistoryHash,
      "iph2",
      "item-price-history hash recorded onto the snapshot"
    );
  });
});

describe("STRK-234 — pullWithPreview re-entrancy guard serializes overlapping pulls (AC-3)", () => {
  // pullWithPreview awaits getSyncPassword()/cloudGetToken() near its top, BEFORE
  // it reaches the shared-global work. The guard is therefore only sound if the
  // check-and-set is atomic — claimed BEFORE that password await. These models
  // exercise the realistic timing: a pull parks at the password await, and a
  // second pull arrives during that window. The "correct" model mirrors the
  // shipped order (claim, then await); the "broken" model is the order the
  // reviewers (Codex P2 / Codacy HIGH) caught in the first patch (await, then
  // claim) — included as a negative control so this test is provably sensitive
  // to the ordering, not a rubber stamp.

  // Drive two pulls so the second arrives while the first is parked at its
  // password await. Returns the run/deferred outcome of each.
  async function runOverlap(makeGuardedPull) {
    let inFlight = false;
    let releasePassword;
    const passwordGate = new Promise((r) => {
      releasePassword = r;
    });
    const ran = [];
    const guardedPull = makeGuardedPull(
      () => inFlight,
      (v) => {
        inFlight = v;
      },
      passwordGate,
      ran
    );

    const first = guardedPull("A"); // claims (correct) or parks (broken) at the await
    await Promise.resolve(); // let A advance to its await
    const secondP = guardedPull("B"); // arrives during A's password window
    await Promise.resolve(); // let B reach its check/await
    releasePassword(); // now drain both — avoids deadlocking on a parked B
    const firstOutcome = await first;
    const second = await secondP;
    return { firstOutcome, second, ran };
  }

  // Correct: claim the guard, THEN await the password — atomic check-and-set.
  const correctPull = (getFlag, setFlag, passwordGate, ran) =>
    async function (label) {
      if (getFlag()) return "deferred";
      setFlag(true);
      try {
        await passwordGate; // password prompt
        ran.push(label);
        return "ran";
      } finally {
        setFlag(false);
      }
    };

  // Broken: await the password BEFORE claiming — the bug the reviewers flagged.
  const brokenPull = (getFlag, setFlag, passwordGate, ran) =>
    async function (label) {
      if (getFlag()) return "deferred";
      await passwordGate; // both calls pass the check, then both await here
      setFlag(true); // ...and both claim it — no serialization
      try {
        ran.push(label);
        return "ran";
      } finally {
        setFlag(false);
      }
    };

  test("claim-before-await serializes: a pull arriving during the password window defers", async () => {
    const { firstOutcome, second, ran } = await runOverlap(correctPull);
    assert.equal(firstOutcome, "ran", "the in-flight pull runs to completion");
    assert.equal(
      second,
      "deferred",
      "the overlapping pull defers (guard claimed before the await)"
    );
    assert.deepEqual(ran, ["A"], "exactly one pull executed");
  });

  test("negative control: claim-after-await fails to serialize (both pulls run) — the bug this guards against", async () => {
    const { firstOutcome, second, ran } = await runOverlap(brokenPull);
    assert.equal(firstOutcome, "ran");
    assert.equal(
      second,
      "ran",
      "with the await before the claim, the second pull is NOT deferred — proving the test detects the ordering bug"
    );
    assert.deepEqual(ran.sort(), ["A", "B"], "both pulls executed concurrently (the race)");
  });

  test("the flag resets so a later, non-overlapping pull proceeds", async () => {
    let inFlight = false;
    const ran = [];
    const pull = correctPull(
      () => inFlight,
      (v) => {
        inFlight = v;
      },
      Promise.resolve(),
      ran
    );
    assert.equal(await pull("A"), "ran");
    assert.equal(
      await pull("B"),
      "ran",
      "after the first released the flag, the next pull proceeds"
    );
    assert.deepEqual(ran, ["A", "B"]);
  });
});

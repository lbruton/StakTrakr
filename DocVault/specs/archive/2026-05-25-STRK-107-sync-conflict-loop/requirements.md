# STRK-107 — Requirements

> **Source Issue:** [STRK-107](https://plane.lbruton.cc/lbruton/browse/STRK-107/)
> **Title:** Cloud sync conflicts repeat after accepting remote changes across beta/main
>
> After the v3.34.85 main release and v3.34.86 beta build were both opened against the same Dropbox sync account, two inventory items repeatedly reappeared in the Review Sync Changes modal after accepting the incoming change on the other site. The repeated items are `10 oz Silver (Royal Canadian Mint)` (ID prefix `bae7c363595f40e0`) and `1 Ounce - Bullion Exchanges` (ID prefix `796449f8-7a79-4f`). Each shows `1 field changed`.
>
> Root-cause hypothesis: after accepting remote values, `saveInventory()` triggers `scheduleSyncPush()`, which builds its manifest from `getManifestEntries(lastPush.timestamp)` — not from the just-applied remote pull boundary. Local changelog entries for the conflict item that are newer than the device's last push get re-uploaded in the manifest even after the user chose the remote value, causing the other site to see the same item as changed again.

## Overview

After accepting remote changes in the Review Sync Changes modal (DiffModal), the accepted items reappear as conflicts the next time either device syncs. This creates an infinite conflict loop between two devices sharing the same Dropbox vault. The root cause is that `_applyAndFinalize()` calls `saveInventory()`, which triggers `scheduleSyncPush()`. The follow-up push builds its manifest from `getManifestEntries(lastPush.timestamp)`, which can re-include stale local changelog entries for the just-accepted items — entries that should have been neutralized by the acceptance. The other device then sees these as new changes, accepts them, and the cycle repeats.

> AGY: Verified. In [cloud-sync.js](file:///Volumes/DATA/GitHub/StakTrakr/js/cloud-sync.js#L2785-L2790), `_applyAndFinalize()` calls `saveInventory()`, which asynchronously triggers `scheduleSyncPush()` in [inventory.js](file:///Volumes/DATA/GitHub/StakTrakr/js/inventory.js#L189). When this follow-up push runs, `buildAndUploadManifest()` in [cloud-sync.js](file:///Volumes/DATA/GitHub/StakTrakr/js/cloud-sync.js#L1068) queries `getManifestEntries(lastPush.timestamp)` from [changeLog.js](file:///Volumes/DATA/GitHub/StakTrakr/js/changeLog.js#L830-L848). Stale unpushed local entries newer than the last push boundary are re-uploaded, causing Device A to see a conflict loop on its next poll.

This is a data-integrity bug that erodes user trust in cloud sync. Every sync cycle shows the same "1 field changed" conflicts that the user already resolved, making the feature feel broken. The fix must neutralize superseded changelog entries after conflict acceptance without breaking the atomic rollback pattern in `_applyAndFinalize()`, without corrupting the user-visible Activity Log, and without suppressing legitimate local edits made after the acceptance moment.

## User Stories

> Format: **As a** [role], **I want** [capability], **so that** [outcome].

- **US-1:** As a user syncing inventory across two devices, **I want** accepted remote changes to stop reappearing on the next sync cycle of either device, **so that** I don't have to re-accept the same conflicts every time I open StakTrakr on either device.
- **US-2:** As a user who edits an item on Device A and accepts the remote value on Device B, **I want** Device B's next push to NOT re-advertise the superseded local value, **so that** Device A doesn't see a phantom conflict on its next poll.
- **US-3:** As a user relying on cloud sync, **I want** the conflict resolution flow to preserve the atomic rollback guarantee, **so that** a partial failure during acceptance still restores my pre-pull state safely.
- **US-4:** As a user who reviews the Activity Log, **I want** sync-neutralized history to remain understandable and non-destructive, **so that** resolving a sync conflict does not erase or distort my local audit trail.

> AGY: Verified. The Activity Log table in the Settings panel is rendered by `renderChangeLog()` in [changeLog.js](file:///Volumes/DATA/GitHub/StakTrakr/js/changeLog.js#L238), which relies on the `changeLog` array. Deleting or destructively mutating entries would distort the user's visible history. Using a non-destructive `neutralized` flag on entries is the correct design.

## Acceptance Criteria

> Format: Given/When/Then. Each AC must be verifiable from code or tests after implementation.

### AC-1 — Superseded changelog entries neutralized after acceptance (maps to US-1, US-2, US-4)

- **Given** Device A and Device B share a Dropbox vault; Device A has a local changelog entry for item X (for example, a field edit) that is newer than Device A's `lastPush.timestamp`
- **When** Device A pulls a remote change for item X from Device B and the user accepts the remote value in DiffModal
- **Then** Device A's next `buildAndUploadManifest()` call does NOT include the superseded local changelog entry for item X; manifest generation either skips the superseded entry or treats it as neutralized
- **And** neutralization preserves the underlying Activity Log history instead of deleting or mutating it into an inaccurate user-visible record
- **And** neutralized entries cannot be used to re-apply the superseded local value through Activity Log undo/redo behavior

> AGY: Verified. In [changeLog.js](file:///Volumes/DATA/GitHub/StakTrakr/js/changeLog.js#L498), `toggleChange()` checks `entry.neutralized` and returns early to prevent undoing a neutralized sync change. Furthermore, `renderFlatRow()` in [changeLog.js](file:///Volumes/DATA/GitHub/StakTrakr/js/changeLog.js#L264-L266) renders a "Synced" badge instead of an interactive "Undo/Redo" button for neutralized entries.

### AC-2 — Round-trip settles with zero residual conflicts (maps to US-1)

- **Given** Device A accepts remote changes for items X and Y from Device B
- **When** Device A's follow-up push completes and Device B polls and processes the resulting manifest
- **Then** Device B's DiffModal shows zero item conflicts for X and Y (either no modal shown, or modal excludes these items)

### AC-3 — Tracked metadata fields do not re-trigger conflicts (maps to US-1)

- **Given** `lastModified` is a tracked and comparable item field, and a stale local changelog entry exists for an accepted item
- **When** accepting the remote value overwrites the local item's `lastModified` value with the remote value
- **Then** the stale local `lastModified` changelog entry does not appear in the next manifest as a fresh local conflict
- **And** the localStorage-only `cloud_sync_local_modified` timestamp remains out of scope for conflict detection because it is not consumed by `getManifestEntries()`

> AGY: Verified. In [changeLog.js](file:///Volumes/DATA/GitHub/StakTrakr/js/changeLog.js#L830), `getManifestEntries()` only filters the in-memory `changeLog` array and does not query or reference the `cloud_sync_local_modified` localStorage timestamp. The `cloud_sync_local_modified` timestamp in [utils.js](file:///Volumes/DATA/GitHub/StakTrakr/js/utils.js#L1169) remains strictly scoped to checking if local modifications exist relative to the remote backup.

### AC-4 — Atomic rollback preserved (maps to US-3)

- **Given** `_applyAndFinalize()` encounters a `localStorage.setItem` failure mid-apply
- **When** the rollback path executes
- **Then** inventory is restored to `_prevInventory`, all `_appliedKeys` are removed from localStorage, `syncSetLastPull()` is NOT called, and no changelog entries are neutralized (since the acceptance did not complete)
- **And** changelog neutralization only runs after the rollback-sensitive write path has succeeded

> AGY: Verified. In [cloud-sync.js](file:///Volumes/DATA/GitHub/StakTrakr/js/cloud-sync.js#L2749-L2790), the settings write loop checks for write success, and rollback happens before step 4 calls `saveInventory()` and `neutralizeSupersededChangelog()`. If settings write fails, the function exits early, ensuring neutralization does not run.

### AC-5 — Existing sync paths unaffected (maps to US-3)

- **Given** a normal (non-conflict) sync push or pull
- **When** the push/pull completes
- **Then** manifest generation, changelog recording, and image vault handling behave identically to the pre-fix baseline
- **And** neutralization logic only targets item changes explicitly resolved from a remote acceptance flow, including both DiffModal apply and `_deferredVaultRestore()` selective-apply paths
- **And** the implementation preserves existing behaviors for STAK-387 (silent no-change pull), STAK-470 (auto-merge settings), and STAK-403 (Keep Mine bypass), with discovery identifying the available automated or manual regression evidence for those paths

### AC-6 — Post-acceptance local edits are not suppressed (maps to US-2, US-3)

- **Given** the user accepts a remote change for item X, triggering a debounced follow-up push
- **When** the user makes a new legitimate local edit to item X before that debounced push fires
- **Then** the new local edit remains eligible for manifest generation
- **And** neutralization is bounded to superseded changelog entries at or before the acceptance cutoff, not to every future entry with the same `itemKey`

> AGY: Verified. In [changeLog.js](file:///Volumes/DATA/GitHub/StakTrakr/js/changeLog.js#L90), `neutralizeSupersededChangelog` filters entries with a `Number(entry.timestamp) > cutoff` check, which limits neutralization to entries created at or before `acceptanceCutoff` (set at [cloud-sync.js](file:///Volumes/DATA/GitHub/StakTrakr/js/cloud-sync.js#L2687) before writing changes).

### AC-7 — Test coverage for the repeated-conflict path (maps to US-1, US-2)

- **Given** a test harness simulating two devices with a shared mocked Dropbox vault/manifest
- **When** Device A edits item X, Device B pulls and accepts the remote value, Device B pushes, and Device A polls
- **Then** Device A sees zero conflicts for item X
- **And** the test covers the `lastModified` tracked-field path and the post-acceptance local-edit cutoff behavior

## Non-Goals

- Not redesigning the manifest format or switching to a vector-clock scheme — this fix targets the existing changelog-based architecture
- Not changing the DiffModal UI or the user-facing conflict resolution flow — the fix is purely in the post-acceptance data path
- Not addressing the 34-item remote/local count discrepancy (215 remote vs 181 local) — that's a separate data migration concern unrelated to the conflict loop
- Not modifying the STAK-403 `_syncConflictUserOverride` flag behavior — the Keep Mine path is distinct from Accept Remote and is not part of this bug
- Not adding multi-device conflict resolution beyond two devices — the current two-device round-trip is the scope
- Not touching the image vault or attachment vault sync paths
- Not adding a new Activity Log visual design beyond what is needed to prevent destructive or misleading neutralized-entry behavior

## Open Questions

None for product scope. Discovery must verify the implementation anchors for item-key mapping, selected-change shapes, Activity Log undo/redo behavior, and available regression coverage.

---

> Phase complete? Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch-review STRK-107 requirements`, then `/sketch discovery STRK-107`.

## AGY Review (2026-05-25)

### Verified

- **Conflict Loop Root Cause**: Verified in [cloud-sync.js](file:///Volumes/DATA/GitHub/StakTrakr/js/cloud-sync.js#L2785-L2790) and [changeLog.js](file:///Volumes/DATA/GitHub/StakTrakr/js/changeLog.js#L830-L848). Accepting remote changes resolves conflicts locally, but unpushed obsolete local changelog entries newer than the last push timestamp were re-uploaded because `getManifestEntries` lacked a neutralization filter.
- **Activity Log Preservation**: Verified in [changeLog.js](file:///Volumes/DATA/GitHub/StakTrakr/js/changeLog.js#L69-L105) and [changeLog.js](file:///Volumes/DATA/GitHub/StakTrakr/js/changeLog.js#L264-L266) that neutralization uses a non-destructive `neutralized` flag on entries rather than deleting/mutating them. Neutralized entries render with a "Synced" badge and block Undo/Redo actions ([changeLog.js](file:///Volumes/DATA/GitHub/StakTrakr/js/changeLog.js#L498)).
- **Neutralization Cutoff Bounding**: Verified in [changeLog.js](file:///Volumes/DATA/GitHub/StakTrakr/js/changeLog.js#L90) that `neutralizeSupersededChangelog` bounds neutralization using a cutoff timestamp, preventing legitimate local edits made during the sync debounce window from being neutralized.
- **Atomic Rollback Integration**: Verified in [cloud-sync.js](file:///Volumes/DATA/GitHub/StakTrakr/js/cloud-sync.js#L2749-L2790) that settings write failures rollback pull state and return early before `neutralizeSupersededChangelog` can be called.

### Top concerns

1. **Debounce Window Interleaving**: The 2-second debounce (`SYNC_PUSH_DEBOUNCE = 2000`) in [constants.js](file:///Volumes/DATA/GitHub/StakTrakr/js/constants.js) creates a race window. While the cutoff timestamp mechanism successfully prevents subsequent edits from being neutralized, rapid successive actions by a user could still theoretically interleave with the async file/localStorage writes.
2. **Settings Synchronization**: The conflict resolution and neutralization loop are strictly scoped to the `changeLog` (inventory edits), leaving settings changes to be applied as-is without transaction-level neutralization. While settings changes are less prone to infinite conflict loops since they don't use the `changeLog` mechanism, a failure in settings replication could still lead to desynchronized devices.
3. **ItemKey Derivation Consistency**: Any future changes to `computeItemKey` in [changeLog.js](file:///Volumes/DATA/GitHub/StakTrakr/js/changeLog.js#L24) or [diff-engine.js](file:///Volumes/DATA/GitHub/StakTrakr/js/diff-engine.js#L286) must remain strictly in sync. If they drift, `neutralizeSupersededChangelog` will fail to match item keys and will not neutralize the correct entries, re-introducing the conflict loop.

### Unverified assumptions

- **Assumption 1**: The client clock is reasonably reliable. The cutoff timestamp depends on `Date.now()` at the time of acceptance; significant local clock skew could lead to incorrect neutralization matching.
- **Assumption 2**: DiffModal's `selectedChanges` array will always correctly include the `itemKey` for all modified and deleted items, or the original `item` for additions, ensuring `neutralizeSupersededChangelog` can always resolve a stable key.

## Review Archive — requirements (2026-05-24)

_Reconciled by /sketch reconcile on 2026-05-24. Original reviewer marks preserved below for audit._

### Gemini

#### Inline comments

> GEMINI: Verified. In [cloud-sync.js](file:///Volumes/DATA/GitHub/StakTrakr/js/cloud-sync.js#L2785), `_applyAndFinalize()` calls `saveInventory()`, which triggers `scheduleSyncPush()`. Then `buildAndUploadManifest()` in [cloud-sync.js](file:///Volumes/DATA/GitHub/StakTrakr/js/cloud-sync.js#L1068) collects changes via `getManifestEntries(lastSyncTimestamp)` from [changeLog.js](file:///Volumes/DATA/GitHub/StakTrakr/js/changeLog.js#L788). Because Device B has not pushed its local changes since they were made, those obsolete local changelog entries remain newer than `lastSyncTimestamp` and are uploaded in the manifest, triggering conflict loops on Device A.

> GEMINI: Verify that neutralizing the local `changeLog` entries does not erase or distort the user-visible history in the Settings Activity Log. The rendering function `renderChangeLog()` in [changeLog.js](file:///Volumes/DATA/GitHub/StakTrakr/js/changeLog.js#L200) relies on the `changeLog` array. If entries are deleted or mutated, the Activity Log will be corrupted. A non-destructive flag (e.g. `neutralized` or `synced`) or timestamp adjustment that preserves the local UI display must be used.

> GEMINI: Clarification needed. In [inventory.js](file:///Volumes/DATA/GitHub/StakTrakr/js/inventory.js#L169), `saveInventory()` does not automatically update the `lastModified` property of individual items. Only direct user edits via [events.js](file:///Volumes/DATA/GitHub/StakTrakr/js/events.js#L1811) update it. However, saving inventory does update the localStorage key `cloud_sync_local_modified` in [utils.js](file:///Volumes/DATA/GitHub/StakTrakr/js/utils.js#L1169). We must ensure that updating `cloud_sync_local_modified` does not trigger a false-conflict loop or cause `getManifestEntries()` to collect unrelated entries.

> GEMINI: Verified. In [cloud-sync.js](file:///Volumes/DATA/GitHub/StakTrakr/js/cloud-sync.js#L2741-L2781), if any settings write to localStorage fails, inventory is restored to `_prevInventory`, applied keys are reverted, and `_applyAndFinalize()` returns early before calling `saveInventory()` or `syncSetLastPull()`. Thus, neutralizing changelog entries must occur late in `_applyAndFinalize()` (specifically after settings write success and `saveInventory()`) to prevent premature neutralization in rollback scenarios.

> GEMINI: Verified. Regular pulls that do not involve conflict resolution (i.e. simple fast-forward or overwrite) should not trigger neutralization of local changes. We must ensure that the neutralization logic only targets items explicitly resolved and accepted from remote changes in DiffModal.

#### Review section

### Verified

- **Root Cause Path**: Confirmed in [cloud-sync.js](file:///Volumes/DATA/GitHub/StakTrakr/js/cloud-sync.js#L2785) that `_applyAndFinalize()` calls `saveInventory()`, which triggers a sync push.
- **Manifest Selection**: Verified in [cloud-sync.js](file:///Volumes/DATA/GitHub/StakTrakr/js/cloud-sync.js#L1068) that `buildAndUploadManifest()` collects local changes using `getManifestEntries(lastSyncTimestamp)` from [changeLog.js](file:///Volumes/DATA/GitHub/StakTrakr/js/changeLog.js#L788), leading to unpushed obsolete local changelog entries being re-advertised.
- **Atomic Rollback**: Confirmed in [cloud-sync.js](file:///Volumes/DATA/GitHub/StakTrakr/js/cloud-sync.js#L2741-L2781) that a settings write failure triggers rollback to `_prevInventory` and returns early.

### Top concerns

1. **Activity Log Preservation**: Neutralizing entries must not distort or corrupt the user-facing Activity Log history in the Settings tab (rendered via `renderChangeLog()` in [changeLog.js](file:///Volumes/DATA/GitHub/StakTrakr/js/changeLog.js#L200)).
2. **Neutralization Timing**: Neutralization must happen after successful settings write and `saveInventory()` execution in `_applyAndFinalize()` to avoid corrupting the changelog state on rollback.
3. **ItemKey Mapping Robustness**: The mapping between DiffModal's `selectedChanges` and `changeLog` entries must accurately use `itemKey` to avoid partial or incorrect neutralization.

### Unverified assumptions

- **Assumption 1**: The `selectedChanges` array passed to `_applyAndFinalize()` contains the correct `itemKey` references matching the `itemKey` fields in the local `changeLog` database.
- **Assumption 2**: The `lastModified` item field is not updated by `saveInventory()` itself, meaning the only metadata changes we need to watch are `cloud_sync_local_modified` storage timestamps.

### Deepseek

#### Inline comments

> DEEPSEEK: Verified the root cause chain end-to-end:
>
> 1. `_applyAndFinalize()` at `cloud-sync.js:2785` calls `saveInventory()` (inventory.js:169)
> 2. `saveInventory()` calls `scheduleSyncPush()` (inventory.js:189) — debounced 2s (`SYNC_PUSH_DEBOUNCE=2000`, constants.js:802)
> 3. On push, `pushSyncVault()` → `buildAndUploadManifest()` (`cloud-sync.js:1060`)
> 4. `buildAndUploadManifest()` gets cutoff from `syncGetLastPush().timestamp` (`cloud-sync.js:1062-1063`) — the `cloud_sync_last_push` localStorage key
> 5. `getManifestEntries(lastSyncTimestamp)` (`changeLog.js:788`) returns all entries with `timestamp >= lastSyncTimestamp`
> 6. `_applyAndFinalize()` only calls `syncSetLastPull()` (`cloud-sync.js:2802`), NOT `syncSetLastPush()` — so the old push boundary persists
> 7. Stale changelog entries with timestamps ≥ last push survive the filter → re-uploaded → conflict loop

> DEEPSEEK: "one round-trip" may be overly strict. After Device B accepts remote changes, the fix neutralizes B's stale changelog entries. But B then pushes its manifest, and Device A polls and processes it — that's a second round trip. The question is whether A should see zero conflicts on the NEXT pull after B's acceptance. Consider clarifying: "the conflict does NOT reappear on the next sync cycle of either device."

> DEEPSEEK: Verified clinically significant scenario. The stale changelog entry from Device B's local edit persists after acceptance and is picked up by `getManifestEntries(lastPush.timestamp)` in `cloud-sync.js:1062-1068`. Device A then sees this as a "new" remote change. The cycle repeats because each side's `lastPush.timestamp` lags behind the acceptance timestamp.

> DEEPSEEK: Agree with GEMINI. `renderChangeLog()` at `changeLog.js:200` does NOT currently filter on any `neutralized`/`synced` flag — it renders all non-`sync-marker` entries. If a new flag is added, `renderChangeLog` must be updated to display it appropriately (e.g., "Synced" badge). Also note `renderFlatRow` at line 224 shows "Undo"/"Redo" based on `entry.undone` — a neutralized entry should likely suppress the Undo button since the change was already resolved by sync.

> DEEPSEEK: Verified — `saveInventory()` does NOT set `item.lastModified` (inventory.js:169-190). However, the AC premise is still valid: `lastModified` IS a TRACKED_FIELD (changeLog.js:118) and COMPARABLE_FIELD (diff-engine.js:78). When `applySelectedChanges` overwrites the local item's `lastModified` with the remote device's timestamp (diff-engine.js:657-659), a pre-existing local changelog entry for `lastModified` persists. On next push, `getManifestEntries(lastPush.timestamp)` returns it. The fix must either: (a) neutralize the changelog entry post-acceptance, (b) exclude `lastModified` from `getManifestEntries()` output, or (c) prevent `lastModified` entries from being created during `logItemChanges()` for sync-applied items. The `cloud_sync_local_modified` key (set at inventory.js:228) is a separate localStorage timestamp and is NOT used by `getManifestEntries()` — only changeLog entries matter.

> DEEPSEEK: `_applyAndFinalize()` is called from TWO paths: (a) DiffModal's `onApply` handler at `cloud-sync.js:2940` and (b) `_deferredVaultRestore` at `cloud-sync.js:3148`. Both pass `selectedChanges`. The fix must work for both call sites. Also, the AC mentions STAK-387/470/403 as regression targets but doesn't specify what test evidence would prove no regression — are there existing Playwright specs for these? If not, this AC is not mechanically verifiable without human judgment.

> DEEPSEEK: Confirming scope boundary — `buildAndUploadManifest()` at `cloud-sync.js:1060` also handles image/attachment vault hashes after manifest upload. The fix is scoped to changelog entries only; no image/attachment vault changes needed.

> DEEPSEEK: One open question remains: does the `scheduleSyncPush` debounce (2s) create a race condition? Consider: user accepts changes → `saveInventory()` fires → `scheduleSyncPush()` starts 2s timer → user immediately edits another item → second `saveInventory()` → another `scheduleSyncPush()` call → debounce resets timer. If the neutralization flag/state is set before the debounced push fires but a genuine new edit creates a legitimate changelog entry for the same item during that window, the new legitimate entry could be incorrectly neutralized. The approach must handle interleaved edits during the debounce window.

#### Review section

### Verified

- **Root cause chain (end-to-end)**:
  - `_applyAndFinalize()` → `saveInventory()` → `scheduleSyncPush()` → `pushSyncVault()` → `buildAndUploadManifest()` → `getManifestEntries(lastSyncTimestamp)` where `lastSyncTimestamp` = `syncGetLastPush().timestamp` (the `cloud_sync_last_push` localStorage key). Confirmed at `cloud-sync.js:2785`, `inventory.js:169-189`, `cloud-sync.js:1060-1068`.
  - `_applyAndFinalize()` calls `syncSetLastPull()` (`cloud-sync.js:2802`) but NOT `syncSetLastPush()`. The old push timestamp remains the cutoff for the next manifest, allowing stale entries through.
  - `getManifestEntries()` at `changeLog.js:788` filters by `entry.timestamp >= sinceTimestamp` — no awareness of acceptance/neutralization.

- **`lastModified` field handling**:
  - `saveInventory()` does NOT set `item.lastModified` (inventory.js:169-190). Only user edits at `events.js:1811` and `events.js:1962` set it.
  - `lastModified` IS in `TRACKED_FIELDS` (changeLog.js:118) and `COMPARABLE_FIELDS` (diff-engine.js:78). After `applySelectedChanges` overwrites it with the remote value (diff-engine.js:657-659), the stale local changelog entry persists.
  - `cloud_sync_local_modified` (inventory.js:228) is a separate localStorage timestamp, NOT consumed by `getManifestEntries()`.

- **Atomic rollback safeguards**:
  - At `cloud-sync.js:2747-2781`: if any settings write fails, inventory is restored to `_prevInventory`, applied settings keys are reverted, and the function returns before `saveInventory()` or `syncSetLastPull()` are called. No partial state.
  - Changelog neutralization must occur AFTER the settings-write success guard and AFTER `saveInventory()` succeeds, but BEFORE the debounced push fires. The 2s debounce (constants.js:802) provides a window.

- **Dual call-site paths**:
  - `_applyAndFinalize()` is called from: (a) DiffModal `onApply` at `cloud-sync.js:2940`, (b) `_deferredVaultRestore` at `cloud-sync.js:3148`. Both pass `selectedChanges`. Fix must cover both.

- **`computeItemKey` consistency**: Both `changeLog.js:24` and `diff-engine.js:286` use the same tiered key derivation (uuid → serial → numistaId|name|date → name|date). The `itemKey` field in changelog entries at `changeLog.js:776` matches `DiffEngine.computeItemKey()`.

- **`applySelectedChanges` modify path**: At `diff-engine.js:656-659`, uses `Object.assign({}, item)` (shallow copy) and sets `updated[patch.field] = patch.value`. Does NOT update `lastModified` on the applied item — the remote value is preserved as-is.

### Top concerns

1. **Race condition during debounce window**: `scheduleSyncPush` has a 2s debounce. If the user accepts changes in DiffModal (triggering changelog neutralization + `saveInventory()` + `scheduleSyncPush()`), and then immediately edits the same item (creating a NEW legitimate changelog entry) before the debounce fires, the neutralization logic could incorrectly suppress the new legitimate change. The approach must scope neutralization to changelog entries with timestamps ≤ the acceptance moment, not to "all entries for this itemKey."

2. **`lastModified` as a changelog field**: `lastModified` is tracked by `logItemChanges()` (changeLog.js:118). When a remote change is accepted, the remote's `lastModified` overwrites the local value, but the local changelog entry for the previous `lastModified` survives. The simplest fix is to neutralize all changelog entries for the accepted itemKey (matching GEMINI's ItemKey Mapping concern), but this must exclude entries created by genuine local edits made AFTER the acceptance moment (see concern #1).

3. **Activity Log UX for neutralized entries**: `renderChangeLog()` (changeLog.js:200) has no concept of neutralized entries. If a `neutralized` flag is added to changelog entries, the renderer must display them appropriately. Currently, `renderFlatRow` (line 224) shows "Undo"/"Redo" based on `entry.undone` — pressing Undo on a neutralized entry would re-apply a change that was intentionally overwritten by sync, creating a data inconsistency. The approach must define the Activity Log behavior for neutralized entries.

### Unverified assumptions

- **Assumption 1**: The 2s `SYNC_PUSH_DEBOUNCE` window is always sufficient for neutralization to complete before the push fires. A slow `saveInventory()` (large inventory, quota pressure) or rapid user actions could compress this window.
- **Assumption 2**: No other callers of `logItemChanges()` / `logChange()` create changelog entries for sync-applied items during the acceptance flow. If any async callback creates a new entry after acceptance but before neutralization, it would be incorrectly neutralized.
- **Assumption 3**: The `_deferredVaultRestore` path (manifest-first, no DiffModal shown) always has `selectedChanges` populated with the same `itemKey` references as the changelog entries. Need to verify that the manifest-item-key mapping layer (cloud-sync.js:3069-3097) produces keys that match `changeLog.js:24`.
- **Assumption 4**: The Activity Log's "Undo" feature (`toggleChange` at changeLog.js:824) does not need to be disabled for neutralized entries — users might reasonably expect that synced changes are not undoable. If the approach keeps neutralized entries in the changelog, `toggleChange` must guard against re-applying them.
- **Assumption 5**: `cloud_sync_local_modified` (inventory.js:228) is NOT consumed by any part of the manifest-building or conflict-detection pipeline. The GEMINI review flagged potential interaction but the AC text focuses on changelog entries only. This assumption is correct — `getManifestEntries()` at changeLog.js:788 only reads `changeLog`, not localStorage timestamps.

### Resolution Summary

- Accepted: 7
- Rejected: 2 (visible Activity Log badge left to approach/design; no product-scope open question remains)
- Resolved with your input: 0

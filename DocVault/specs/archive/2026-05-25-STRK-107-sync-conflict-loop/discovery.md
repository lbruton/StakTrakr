---
sketch: "STRK-107-sync-conflict-loop"
phase: discovery
created: 2026-05-24
---

# STRK-107 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

_Files and modules already in the project that this work will touch or build on._

### Primary — the conflict loop chain

| Path | Role | Notes |
|------|------|-------|
| `js/changeLog.js:788` | `getManifestEntries(sinceTimestamp)` | Filters changelog by `timestamp >= sinceTimestamp`, excludes `sync-marker` type only. **No awareness of `undone` or any neutralization flag.** Returns entries shaped `{timestamp, scope, itemKey, type, field, itemName, oldValue, newValue}`. |
| `js/changeLog.js:77` | `logItemChanges(oldItem, newItem)` | Per-field diff logger. Sets `itemKey`, `scope: "inventory"`, `type`, `undone: false`. This is the "new shape" — entries created here are matchable by `itemKey`. |
| `js/changeLog.js:40` | `logChange(itemName, field, ...)` | Older shape — **lacks `itemKey`, `scope`, `type`**. Entries from this path produce `undefined` for those fields in `getManifestEntries` output. Neutralization by `itemKey` will silently miss these. |
| `js/changeLog.js:24` | `computeItemKey(item)` | Tiered key: `uuid → serial → numistaId\|name\|date → name\|date`. Mirrors `DiffEngine.computeItemKey()` at `diff-engine.js:286`. |
| `js/changeLog.js:454` | `toggleChange(logIdx)` | Undo/redo handler. Flips `entry.undone` and applies the reverse mutation to inventory. No guard against operating on a neutralized entry. |
| `js/cloud-sync.js:2686` | `_applyAndFinalize(newInventory, selectedChanges, settingsChanges, remoteMeta, options)` | Central acceptance handler. Called from two sites (see below). Sequence: backup → assign inventory → apply settings → `saveInventory()` → `syncSetLastPull()`. **Does NOT call `syncSetLastPush()`** — this is the root cause gap. |
| `js/cloud-sync.js:2785` | `saveInventory()` call inside `_applyAndFinalize` | Triggers `scheduleSyncPush()` (2s debounce). The debounced push calls `buildAndUploadManifest()`, which queries `getManifestEntries(lastPush.timestamp)`. Because `lastPush` was never advanced by the acceptance, stale entries survive the filter and get re-advertised. |
| `js/cloud-sync.js:1060` | `buildAndUploadManifest(token, password, syncId)` | Reads cutoff from `syncGetLastPush().timestamp` (line 1062–1063). Calls `getManifestEntries(lastSyncTimestamp)` (line 1068). Groups entries by `itemKey` into `changesByKey` map. |
| `js/cloud-sync.js:2088` | `syncSetLastPush(pushMeta)` | Called only at the END of a successful `pushSyncVault()`, not during acceptance. This is why the push boundary lags. |
| `js/cloud-sync.js:309–333` | `syncGetLastPush()` / `syncSetLastPush()` / `syncGetLastPull()` / `syncSetLastPull()` | localStorage-backed timestamp pairs. Keys: `cloud_sync_last_push`, `cloud_sync_last_pull`. |
| `js/diff-engine.js:608` | `DiffEngine.applySelectedChanges(inventory, selectedChanges)` | Applies user-selected changes to inventory. Uses `Object.assign({}, item)` shallow copy. Does NOT update `lastModified` — preserves remote value as-is. |
| `js/inventory.js:169` | `saveInventory()` | Persists inventory to localStorage. Calls `scheduleSyncPush()` at line 189. Does NOT mutate `item.lastModified`. Sets `cloud_sync_local_modified` timestamp at line 228 (separate from changelog system). |
| `js/constants.js:802` | `SYNC_PUSH_DEBOUNCE = 2000` | 2-second debounce window between `saveInventory()` trigger and actual push. |

### Secondary — call sites and special paths

| Path | Role | Notes |
|------|------|-------|
| `js/cloud-sync.js:2880–2942` | DiffModal `onApply` callback | First call site for `_applyAndFinalize`. Builds `selectedChanges` from DiffModal user selections. Extracts `type: "setting"` entries into `settingsChanges`. |
| `js/cloud-sync.js:3021–3155` | `_deferredVaultRestore()` | Second call site. Manifest-first path — downloads vault, resolves stub items (STAK-493-B fix at lines 3060–3097). **Only the selective-apply subpath** (lines 3040–3213, guarded by `selectedChanges && DiffEngine` availability) calls `_applyAndFinalize()` at line 3148. The full-overwrite fallback (lines 3220–3223) calls `restoreVaultData()` and `syncSetLastPull()` directly — bypasses `_applyAndFinalize()` entirely. Similarly, the DiffEngine-unavailable fallback (lines 2895–2910) also bypasses it. Both bypassed paths are safe from this bug — neutralization only needs to hook into `_applyAndFinalize()`. |
| `js/cloud-sync.js:3341–3399` | STAK-387 silent no-change pull | When manifest shows no item changes, sets `syncSetLastPull()` and returns without showing DiffModal. **No changelog interaction — safe from this bug.** |
| `js/cloud-sync.js:3436–3600` | STAK-470 auto-merge settings | One-sided settings diff (version upgrade). Auto-applies settings without DiffModal. Calls `scheduleSyncPush()` at line 3600. **No item changes — not affected by the conflict loop.** |
| `js/cloud-sync.js:35–36` | `_syncConflictUserOverride` | STAK-403 flag for Keep Mine / Push My Data. Cleared at push time (line 1290). Distinct from Accept Remote — not part of this bug. |
| `js/diff-modal.js:3049` | `DiffModal` object definition | The modal UI. `show()` accepts `onApply(selectedChanges)` callback. `selectedChanges` shape: `{type: 'add'\|'delete'\|'modify'\|'setting', itemKey?, item?, field?, value?, key?}`. |

### Tertiary — Activity Log rendering

| Path | Role | Notes |
|------|------|-------|
| `js/changeLog.js:200` | `renderChangeLog()` | Renders all non-`sync-marker` entries in reverse chronological order. Shows Undo/Redo button based on `entry.undone`. **No concept of a "neutralized" state.** |
| `js/changeLog.js:321` | Undo button in `renderFlatRow` | `onclick="toggleChange(${globalIndex})"`. If a neutralized entry retains its Undo button, pressing it would re-apply a value that was intentionally overwritten by sync — creating data inconsistency. |
| `js/changeLog.js:605` | `confirmCascadeUndo()` | Handles transactionId-grouped undo (split+dispose pairs). Neutralized entries with `transactionId` need special care to avoid cascade interactions. |

## Prior Decisions

- **2026-05-24** — STRK-107 requirements reconciled. Key decisions: neutralization bounded by acceptance-cutoff timestamp (not blanket per-itemKey), neutralization must happen after rollback-sensitive writes succeed, both `_applyAndFinalize` callers (DiffModal + `_deferredVaultRestore`) are in scope. (sessionflow: session 019e5c9b, turn 74)
- **2026-04-22** — Changelog dual-shape pattern documented. `logItemChanges()` sets `itemKey`/`scope`/`type`; `logChange()` does not. Any code handling changelog entries must accommodate both shapes. (mem0: d7e68ebc)
- **2026-03-11** — STAK-470 added silent auto-merge for one-sided settings diffs. No item changes involved — confirmed safe from this bug. (sessionflow: agent-a53dfb69)
- **2026-03-11** — STAK-387 added silent no-change return in `pullWithPreview()`. No changelog interaction — confirmed safe. (sessionflow: agent-a53dfb69)
- **2026-03-03** — STAK-403/409/410/411 multi-fix patch. STAK-409 added empty-vault safety guard in `_deferredVaultRestore`. STAK-411 fixed double-modal race via `_syncRemoteChangeActive` flag. (sessionflow: agent-a53dfb69)

## External References

- No external libraries or RFCs apply — this is entirely internal changelog/manifest architecture. The fix will use existing patterns (`undone` flag precedent, `sync-marker` type precedent) rather than introducing external dependencies.

## Constraints

- **Atomic rollback (AC-4):** `_applyAndFinalize` has a settings-write rollback path (lines 2747–2781) that restores `_prevInventory` and returns early. Changelog neutralization must NOT run if this rollback fires — it must execute only after the rollback-sensitive window closes.
- **Debounce race (AC-6, reviewed by DeepSeek):** The 2s `SYNC_PUSH_DEBOUNCE` window creates a race. If the user accepts a remote change and then edits the same item before the debounced push fires, the new edit creates a legitimate changelog entry. Neutralization must be scoped to entries with `timestamp ≤ acceptanceCutoff`, not "all entries for this itemKey."
- **Dual-shape changelog entries:** `logChange()` entries lack `itemKey`. `logChange()` is common in UI mutation paths — inline cell edits (`inventory.js:577`), Add Item (`events.js:2004`), bulk copy/delete (`bulkEdit.js:1618,1663`), and dispose/undo disposition (`inventory.js:973,1028`). Despite this frequency, `logItemChanges()` is the path that creates entries relevant to sync conflict loops — `logChange()` entries lack `itemKey`, so `getManifestEntries` maps them to `undefined`, and `buildAndUploadManifest` groups them under `_settings` key (line 1091: `var key = entry.itemKey || "_settings"`). **Old-shape entries without `itemKey` get grouped under `_settings` key — they produce a noise entry but not a conflict loop** because the remote side's `detectConflicts` matches by `itemKey`. This means neutralization can safely target only entries with a truthy `itemKey` field. However, old-shape `_settings` entries do inflate manifest payloads and summary counts across sync cycles (pruned eventually by `pruneManifestEntries()` at line 1082, `maxSyncs = 10`). **The approach must explicitly decide** whether STRK-107 also neutralizes/filters old-shape entries for manifest hygiene or defers that to a separate `_settings`-entry cleanup issue.
- **Activity Log UX:** `renderChangeLog()` has no concept of neutralization. The `undone` flag is the closest precedent — it toggles the Undo/Redo button label. A neutralized entry should suppress the Undo button entirely (not flip to "Redo") because undoing a sync-resolved change would re-apply a superseded value. The approach must define whether neutralized entries are visible (with a "Synced" badge or similar) or hidden, and how `toggleChange` guards against operating on them.
- **`getManifestEntries` filter gap:** Currently filters only on `type === "sync-marker"` and `timestamp`. Whatever neutralization mechanism is chosen (flag, deletion, timestamp mutation), it must cause `getManifestEntries` to exclude the neutralized entries. The cleanest path is a new filter predicate — but adding a filter also means the existing `undone` entries continue to pass through (which is the existing behavior, arguably correct since an undone change is still a local state change the remote should know about).
- **No `saveInventory()` suppression:** The approach cannot prevent `saveInventory()` from calling `scheduleSyncPush()` — that would break non-conflict push paths. The fix must either neutralize before `saveInventory()` fires (risky — rollback hasn't cleared yet) or ensure `getManifestEntries` skips neutralized entries when the debounced push fires 2s later.
- **Settings-only DiffModal acceptance (AC edge case):** When `_applyAndFinalize` receives `null`/`undefined` `newInventory` (settings-only acceptance from DiffModal), the inventory global is preserved (line 2703–2705 guard), but `saveInventory()` still fires and `syncSetLastPull()` still advances. The debounced push then captures a manifest of stale changelog entries whose timestamps post-date the stale `lastPush`. This reproduces the conflict loop even when no item changes were accepted. Neutralization must account for this path — either by neutralizing all stale entries above the acceptance cutoff regardless of whether items changed, or by having the approach define a separate guard for settings-only acceptance.
- **Existing test infrastructure:** Three Playwright test files cover cloud sync (`cloud-sync-header-button.spec.js`, `cloud-sync-manifest-type.spec.js`, `vault-roundtrip.spec.js`). None test the conflict-loop scenario. The `vault-roundtrip.spec.js` (303 lines) mocks `DiffModal.show` and verifies silent-pull behavior. The `cloud-sync-manifest-type.spec.js` (340 lines) sets up localStorage-based sync state, mocks `DiffModal`, and captures/decrypts uploaded manifests via mocked Dropbox routes. STRK-107's regression test should exercise the full post-acceptance chain: inject changelog entries, mock DiffModal acceptance through `_applyAndFinalize()`, let `saveInventory()` schedule the debounced push, capture the resulting manifest, and verify it omits the accepted stale entries — not merely assert that `getManifestEntries()` in isolation filters correctly.
- **`selectedChanges` shape consistency:** DiffModal `onApply` passes `selectedChanges` with `type: 'modify'` entries having `itemKey` as a string. `_deferredVaultRestore` resolves stub items and passes the same shape. Both call sites provide `itemKey` on modify/delete changes — the key is reliable for mapping accepted changes back to changelog entries.

## Open Questions

_All resolved during discovery — no blockers for approach._

- [x] **Do old-shape `logChange()` entries participate in conflict loops?** No — they lack `itemKey`, so `buildAndUploadManifest` groups them under `_settings` key. They produce noise but not per-item conflicts. Neutralization can target only entries with truthy `itemKey`.
- [x] **Does `getManifestEntries` respect the `undone` flag?** No — it passes undone entries through. This is a pre-existing design choice (undone entries represent local state the remote should be informed about). STRK-107 should not change this behavior.
- [x] **Are there existing Playwright tests for STAK-387/470/403 regression paths?** No automated tests exist for those specific paths. The `vault-roundtrip.spec.js` tests silent-pull behavior (related to STAK-387). AC-5 regression coverage will rely on: (a) existing `vault-roundtrip.spec.js` as baseline, (b) manual verification that the silent-pull and auto-merge paths do not trigger neutralization, and (c) new test assertions verifying neutralization only fires for accepted-item paths.
- [x] **Does `_deferredVaultRestore` produce `selectedChanges` with reliable `itemKey` mapping?** Yes for modify/delete — STAK-493-B fix (lines 3060–3097) resolves stub items to full objects. Modify and delete entries carry `itemKey` at the top level (`diff-modal.js:2782-2867`). **However, add entries are `{ type: "add", item }` without a top-level `itemKey`** (`diff-modal.js:2772-2779`); `_deferredVaultRestore()` resolves add stubs via `change.itemKey || change.item.itemKey || change.item.uuid`. This distinction is safe for STRK-107 because accepted remote adds won't have pre-existing local changelog entries to neutralize — neutralization scopes to modify/delete conflict entries only.
- [x] **Can `toggleChange` on a neutralized entry cause data inconsistency?** Yes — without a guard, pressing Undo on a neutralized entry would re-apply the superseded local value. The approach must add a guard in `toggleChange` to reject operations on neutralized entries (precedent: the existing `type === "attachment-change"` early return at line 467).

## Discovery Summary

The conflict loop lives in a five-step chain: `_applyAndFinalize()` → `saveInventory()` → `scheduleSyncPush()` (2s debounce) → `buildAndUploadManifest()` → `getManifestEntries(lastPush.timestamp)`. The root cause is that acceptance advances `lastPull` but not `lastPush`, so stale changelog entries survive the manifest filter and get re-advertised. The loop also reproduces for settings-only DiffModal acceptance (null `newInventory`), where `saveInventory()` still fires even though no items changed. The fix will add a neutralization mechanism to changelog entries after acceptance, with `getManifestEntries` filtering them out. The tricky parts are: (1) timing neutralization to run **synchronously inside `_applyAndFinalize()`** after the settings-rollback window closes but before the function returns control to the event loop — the 2s debounce window is not the real constraint, synchronous completion before return is; (2) scoping neutralization to entries with `timestamp ≤ acceptanceCutoff` to avoid suppressing legitimate post-acceptance edits; and (3) guarding `toggleChange` against operating on neutralized entries without breaking the Activity Log UX.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-107`.

## Review Archive — discovery (2026-05-24)

_Reconciled by /sketch reconcile on 2026-05-24. Original reviewer marks preserved below for audit._

### Codex

**Verified**

- Confirmed `getManifestEntries()` currently excludes only `sync-marker` and timestamp-filtered entries, then returns `scope`, `itemKey`, `type`, `field`, `itemName`, `oldValue`, and `newValue` directly from the changelog (`js/changeLog.js:788-805`).
- Confirmed `_applyAndFinalize()` rollback returns before save/pull metadata, while the success path calls `saveInventory()` before `syncSetLastPull()` (`js/cloud-sync.js:2713-2785`, `js/cloud-sync.js:2798-2804`).
- Confirmed `saveInventory()` schedules cloud push (`js/inventory.js:184-189`), and cloud sync wraps `pushSyncVault` in the 2-second `SYNC_PUSH_DEBOUNCE` path (`js/constants.js:801-802`, `js/cloud-sync.js:4194-4209`).
- Confirmed manifest generation reads from `syncGetLastPush()` and groups missing `itemKey` entries under `_settings` (`js/cloud-sync.js:1060-1068`, `js/cloud-sync.js:1089-1098`).
- Confirmed old-shape changelog producers still exist in direct UI flows: inline edits, Add Item, and bulk copy (`js/inventory.js:576-580`, `js/events.js:1987-2004`, `js/bulkEdit.js:1616-1624`).
- Confirmed DiffModal selected-change output has `itemKey` for modify/delete and conflict resolution records, but not for add records (`js/diff-modal.js:2772-2883`).
- Confirmed current Playwright sync tests provide Dropbox route mocking, manifest encryption/decryption, and DiffModal mocking patterns but no assertion for accepted remote changes being omitted from the next push manifest (`tests/playwright/cloud-sync-manifest-type.spec.js:78-140`, `tests/playwright/cloud-sync-manifest-type.spec.js:170-311`, `tests/playwright/vault-roundtrip.spec.js:18-303`).

**Top concerns**

1. The discovery correctly identifies old-shape entries as non-item-conflict-loop candidates, but it understates how often `logChange()` still appears in normal inventory mutation paths and should not rely on "rare" as the reason to ignore them.
2. The test recommendation should exercise the real post-acceptance scheduled push/manifest path, not only `getManifestEntries()` in isolation, because the bug is specifically the `_applyAndFinalize()` → `saveInventory()` → debounced push chain.
3. The selected-change shape needs an add-vs-modify/delete distinction so approach does not accidentally require a top-level `itemKey` from every accepted change.

**Unverified assumptions**

- That STRK-107's acceptance scenarios are limited to accepted modify/delete conflicts and do not need neutralization semantics for accepted remote adds.
- That emitting old-shape inventory edits as `_settings` manifest entries is acceptable long term, even if it does not drive the specific conflict loop.
- That neutralization can always be persisted synchronously between `saveInventory()` and the debounced push without quota/storage failure introducing a partially applied acceptance state.
- That Activity Log visibility should show a neutralized/synced state rather than hiding neutralized entries; this is a product/UX choice, not proven by code.
- That transaction-grouped disposition entries will never be selected for sync neutralization despite sharing the same changelog table and cascade undo surface.

### DeepSeek

**Verified**

- Confirmed `_applyAndFinalize()` at line 2686: `newInventory` reassignment at 2703-2705 has a null/undefined guard — when skipped, `saveInventory()` and `syncSetLastPull()` still fire. This settings-only acceptance path also reproduces the conflict loop for stale changelog entries (`js/cloud-sync.js:2703-2705`, `js/cloud-sync.js:2784-2804`).
- Confirmed `_deferredVaultRestore()` has two mutually exclusive sub-paths: selective-apply (`js/cloud-sync.js:3036-3213`) calls `_applyAndFinalize()` at line 3148; full-overwrite fallback (`js/cloud-sync.js:3220-3223`) calls `restoreVaultData()` and `syncSetLastPull()` directly — bypasses `_applyAndFinalize()` entirely. Similarly, the DiffModal fallback for unavailable `DiffEngine` (`js/cloud-sync.js:2895-2910`) also bypasses `_applyAndFinalize()`. Both full-overwrite paths are safe from this bug.
- Confirmed STAK-387 silent pull (`js/cloud-sync.js:3341-3399`) calls only `syncSetLastPull()` — no `saveInventory()`, no push schedule. Safe.
- Confirmed STAK-470 auto-merge (`js/cloud-sync.js:3436-3600`) calls `scheduleSyncPush()` at line 3600 but only for settings changes — item push delta is empty, no conflict loop. Safe.
- Confirmed `buildAndUploadManifest()` runs `pruneManifestEntries()` at line 1082, capping entries at `maxSyncs = 10` (line 1074). Old-shape `_settings` entries that accumulate will eventually be pruned, but they bloat manifests in intervening cycles. Not a conflict-loop driver, but a manifest hygiene concern.
- Confirmed `DiffEngine.computeItemKey()` at `diff-engine.js:286-303` mirrors `computeItemKey()` at `changeLog.js:24-30` identically — tier matches, null-guard behavior matches. Any `itemKey` compute in neutralization will yield the same key as changelog and diff-engine.
- Confirmed `_buildSelectedChanges()` (`diff-modal.js:2772-2883`): adds get `{ type: "add", item }` without top-level `itemKey` (line 2778), modify/delete entries always carry `itemKey` (lines 2819, 2851, 2866). Conflict resolution entries also carry `itemKey` (line 2879). The `itemKey` gap on add entries does NOT impact this bug because accepted remote adds won't have local changelog entries to neutralize.
- Confirmed `getManifestEntries()` (`changeLog.js:788-805`) is the single funnel that all push paths pass through. Adding a neutralization filter here at line 791 protects every push path uniformly — no second site to miss.
- Confirmed `toggleChange()` (`changeLog.js:454`) currently guards on `transactionId` (line 459) and `attachment-change` (line 467) only. A third guard for neutralized entries (checking a `neutralized` or similar flag) follows the same established pattern.
- Confirmed `confirmCascadeUndo()` (`changeLog.js:605`) filters paired entries by `!e.undone` at line 610 but has no neutralization awareness. If a neutralized entry has a `transactionId`, and approach neutralizes by setting a flag rather than clearing `transactionId`, then `confirmCascadeUndo` could still operate on it if it's the trigger entry (but it won't find matching pairs since neutralization should only target individual field-change entries, not transaction-paired splits/dispositions).

**Top concerns**

1. **Missing subtype analysis for `_deferredVaultRestore`:** The discovery says "both callers are in scope" but only the selective-apply subpath inside `_deferredVaultRestore` actually reaches `_applyAndFinalize()`. The full-overwrite fallback (3220-3223) and DiffEngine-unavailable fallback (2895-2910) bypass `_applyAndFinalize()` entirely. Approach.md must be precise: neutralization only needs to hook into `_applyAndFinalize()` — not into every restore path. This is actually a design simplification but it's not stated.
2. **Manifest hygiene from old-shape `_settings` entries:** The discovery correctly concludes old-shape entries don't cause the item conflict loop, but it doesn't address that they produce `_settings` manifest changes (`changesByKey["_settings"]`) on every push that follows an inline edit / Add Item / bulk copy. While `_buildDiffFromManifest()` silently drops them (`_normalizeItemChangeType("")` returns `""`, no matching branch at lines 2978-2996), they inflate manifest payloads and summary counts. The approach should explicitly decide: fix now (neutralize old-shape entries too) or defer to a separate `_settings`-entry cleanup issue.
3. **Edge case: acceptance with `newInventory = null`:** When `_applyAndFinalize` receives a null/undefined `newInventory` (line 2703-2705 guard), the inventory global is preserved, but `saveInventory()` still fires and `syncSetLastPull()` still advances. The debounced push then captures a manifest of changelog entries whose timestamps post-date the stale `lastPush`. This happens for **settings-only** acceptance (e.g., DiffModal apply with only `type: "setting"` changes). The discovery describes settings-only acceptance as safe because of STAK-470's auto-merge path, but doesn't call out that the **user-driven** DiffModal settings-only acceptance path also reproduces the conflict loop for stale non-settings changelog entries. Neutralization should either: neutralize all accepted-item entries (normal case) or, in the settings-only case, still neutralize any stale entries above the acceptance cutoff.

**Unverified assumptions**

- That the debounced push and neutralization-persistence can never race with localStorage quota errors. `saveDataSync` (`changeLog.js:50`) re-throws on quota failure — if neutralization writes its flag via `saveDataSync` and that fails between `saveInventory()` and the 2s push window, the push will still capture un-neutralized entries.
- That `_deferredVaultRestore`'s selective-apply path (the ONLY subpath that reaches `_applyAndFinalize`) will always take the selective branch and never fall through to full-overwrite. The guard at line 3036 requires `DiffEngine` to be available (line 3038) and `payload.data` to be truthy (line 3044). If either fails, the fallback skips `_applyAndFinalize` entirely.
- That the changelog entry neutralization must be a boolean flag (analogous to `undone: false`) rather than a deletion or `"sync-marker"` type change. A deletion risks data loss if the neutralization is reverted; a sentinel type risks conflating neutralization with `markSynced()` boundaries.
- That neutralized entries should remain visible in the Activity Log with a disabled Undo button rather than being hidden entirely. This UX choice is untested against user expectations — a visible "Synced" disabled row may cause alarm ("why can't I undo this?").
- That `confirmCascadeUndo`'s `transactionId` entries (split/dispose pairs) share the same changelog table but will never intersect with sync-accepted item changes. The discovery claims they "should not be touched by sync neutralization" but this is reasoning about intent, not enforced by code constraints.

### Resolution Summary
- Accepted: 7
- Rejected: 4 (Activity Log UX direction — already deferred to approach; getManifestEntries enforcement — confirmatory; toggleChange/cascade detail — approach-level; implementation concerns — approach-level)
- Resolved with your input: 0

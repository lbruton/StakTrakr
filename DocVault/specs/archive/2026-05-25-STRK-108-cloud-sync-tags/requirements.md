---
sketch: "STRK-108-cloud-sync-tags"
phase: requirements
created: 2026-05-25
---

# STRK-108 — Requirements

> **Source Issue:** [STRK-108](https://plane.lbruton.cc/lbruton/browse/STRK-108/)
> **Title:** Cloud sync does not merge tags
>
> When syncing inventory from Browser A to Browser B via Dropbox cloud sync, item tags are not transferred. The merge-diff logic does not detect tag changes, so Browser B receives the synced inventory but tags remain empty.

## Overview

Add tag merging to StakTrakr's selective-apply cloud sync path so that item tags (`itemTags`) and removed-tags (`itemRemovedTags`) are preserved and merged across devices, matching the behavior already implemented in the full-overwrite vault restore path.

US-2 requires two distinct changes: (1) adding `itemRemovedTags` to `SYNC_SCOPE_KEYS` so it is included in Dropbox sync push payloads (it is currently absent from `SYNC_SCOPE_KEYS` despite being in `ALLOWED_STORAGE_KEYS`), and (2) implementing dedicated merge logic in `_applyAndFinalize` for both `itemTags` and `itemRemovedTags`.

## User Stories

- **US-1:** As a StakTrakr user who uses cloud sync across two browsers, I want my item tags to sync between devices, so that I don't have to re-apply tags on each device after a sync.
- **US-2:** As a user who has removed Numista-suggested tags on one device, I want those removals to be respected after a sync, so that unwanted tags don't reappear on the other device after a Numista re-sync.

## Acceptance Criteria

### AC-1 (maps to US-1) — Tags are carried in the selective sync merge

- **Given** Browser A has an item with tags `["Other animal", "Toy or game"]`
- **When** Browser A syncs to Dropbox and Browser B performs a cloud sync restore/merge
- **Then** the same item on Browser B has tags `["Other animal", "Toy or game"]` (not empty)

### AC-2 (maps to US-1) — Tags reflect last-writer-wins per item via timestamp map

- **Given** Browser A and Browser B have different tags for the same item UUID
- **When** Browser B performs a cloud sync merge
- **Then** Browser B applies the tag array from whichever device has the newer entry in `itemTagsLastModified` (a new `{ uuid: timestamp }` localStorage key, updated on every `addItemTag` / `removeItemTag` / `deleteItemTags` call)
- **And** the winning device's tag array is written wholesale for that UUID — no additive merge — so casing variants cannot accumulate across devices

### AC-3 (maps to US-1) — In-memory tag state is refreshed after sync

- **Given** a cloud sync merge has just written new tag data to `localStorage["itemTags"]`
- **When** the merge finalizes (inside `_applyAndFinalize()`)
- **Then** `loadItemTags()` is called so the in-memory tag map reflects the written data (no stale state)
- **Note:** `itemRemovedTags` requires only a localStorage write — no in-memory cache refresh is needed because `loadRemovedTags(uuid)` reads from localStorage on-demand.

### AC-4 (maps to US-2) — `itemRemovedTags` is also merged

- **Given** Browser A has an entry in `itemRemovedTags` indicating a tag was explicitly removed from an item
- **When** Browser B performs a cloud sync merge
- **Then** Browser B's `itemRemovedTags` includes that removal, preventing Numista re-sync from re-adding the tag
- **Scope note:** Implementing this AC requires adding `"itemRemovedTags"` to `SYNC_SCOPE_KEYS` — a sync-payload schema change, not just merge-logic.
- **Conflict rule:** Re-add wins over removal. If a tag is present in `itemTags` on the winning device (per `itemTagsLastModified`), any corresponding entry in `itemRemovedTags` for that tag/UUID pair is discarded. This mirrors `clearRemovedTag()`'s existing local behavior when a user re-adds a previously removed tag.

### AC-5 (maps to US-1 + US-2) — Tag-only remote changes are detected and applied

- **Given** Browser A has changed only tags (no inventory fields, no settings) and pushed to Dropbox
- **When** Browser B performs a cloud sync pull and the manifest shows no item-field changes and `compareSettings` returns empty
- **Then** the early-return guard at `cloud-sync.js:3345–3412` must detect the tag difference (by comparing remote `itemTags` / `itemRemovedTags` against local state) and proceed to `_applyAndFinalize` rather than silently recording a no-op pull

## Non-Goals

- Not changing the `DIFF_FIELDS` list in `diff-engine.js` — tags are not item-object fields; they live in a separate store keyed by item UUID.
- Not implementing UI to resolve tag conflicts manually — last-writer-wins by `itemTagsLastModified` timestamp is sufficient for this scope.
- Not changing vault restore (`vault.js restoreVaultData`) — it already handles tags correctly via full overwrite.
- Not adding new tag UX (tag editing, bulk operations) — purely a sync correctness fix.
- Not addressing other out-of-band stores that may also be skipped in selective sync — separate audit if needed.
- Not adding DiffModal UI visibility for tag changes — tags are merged silently in the background during `_applyAndFinalize`, alongside accepted inventory and settings changes. No DiffModal row is added.
- Not adding per-tag conflict resolution UI — the re-add-wins rule is applied automatically with no user prompt.

## Open Questions

_Resolved during discovery — none blocking._

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-108`.

## Review Archive — requirements (2026-05-25)

_Reconciled by /sketch reconcile on 2026-05-25. Original reviewer marks preserved below for audit._

### Opus

#### Verified

1. **`itemTags` is in `SYNC_SCOPE_KEYS` (`constants.js:855`)** — confirmed. The key IS recognized as in-scope for sync, meaning it's included in the Dropbox vault payload on push.
2. **`itemTags` is explicitly skipped during the settings-diff comparison** — confirmed at `cloud-sync.js:3136`, `3326`, `3772`, `3779`. The selective merge path treats `itemTags` like `metalInventory` (excluded from settings diff), but unlike `metalInventory`, no dedicated merge logic handles it. This is the root bug.
3. **`itemRemovedTags` is NOT in `SYNC_SCOPE_KEYS`** — confirmed. It IS in `ALLOWED_STORAGE_KEYS` (`constants.js:1058`), meaning vault full-restore writes it, but it is never pushed/pulled in selective cloud sync. Zero references in `cloud-sync.js`.
4. **`_applyAndFinalize` does NOT call `loadItemTags()`** — confirmed (`cloud-sync.js:2686–2860`). The `loadItemTags()` call at line 437 is in the override-snapshot-restore path, not the selective merge path.
5. **`restoreVaultData` handles tags via full overwrite** — confirmed (`vault.js:376–405`): writes all `ALLOWED_STORAGE_KEYS` from payload. Non-Goal 3 is accurate.
6. **Tag data shape has no per-entry timestamp** — confirmed (`tags.js:8`): `{ "uuid": ["tag1", "tag2"] }`. No `lastModified` per UUID entry in the tag store itself.

#### Top Concerns

1. **AC-2's "last-writer-wins by `lastModified`" is under-specified and potentially misleading.** The `itemTags` store (`{ uuid: [tags] }`) has NO per-entry timestamp. The inventory item has `lastModified`, but that tracks _item_ changes (price, qty, notes), not _tag_ changes. If Browser A changes only tags (no item field edit), the item's `lastModified` may be older than Browser B's — yet A's tags should win. The acceptance criterion needs to define _what timestamp governs tag merge_: the item's `lastModified`, a new per-UUID tag timestamp, or whole-store comparison. This is a design decision that shapes implementation complexity significantly.

2. **AC-4 (`itemRemovedTags`) requires adding the key to `SYNC_SCOPE_KEYS`.** Currently `itemRemovedTags` is in `ALLOWED_STORAGE_KEYS` but NOT in `SYNC_SCOPE_KEYS`. It won't appear in the Dropbox vault payload during push unless added to `SYNC_SCOPE_KEYS` (or handled via a separate mechanism). The requirements should acknowledge this is a schema change to the sync payload, not just a merge-logic fix.

3. **AC-3 assumes `loadItemTags()` in `_applyAndFinalize` is sufficient, but `_applyAndFinalize` is not the only finalization path.** The deferred vault restore path (`cloud-sync.js:3153`) and the manifest-first path both call `_applyAndFinalize`, but the override-restore path (`cloud-sync.js:437`) has its own finalization. If tag merge is added to `_applyAndFinalize`, it covers the selective path — but the AC should clarify whether it also expects the DiffModal "accept selected changes" path to refresh tags.

#### Unverified Assumptions

- **Assumption: tag changes always co-occur with item `lastModified` updates.** Not verified. A user can add/remove tags without editing any inventory field, leaving `lastModified` unchanged. If the merge strategy relies on item `lastModified`, tag-only changes may be silently dropped.
- **Assumption: whole-store overwrite is acceptable for `itemTags` merge.** The requirements say "last-writer-wins per item" but the simplest implementation (write entire remote `itemTags` blob) would overwrite ALL local tags, not just the ones that changed. Clarify: is per-UUID granularity required, or is whole-store replacement acceptable when remote is newer?
- **Assumption: `itemRemovedTags` conflicts don't need merge semantics.** If Browser A removes tag "X" and Browser B independently adds tag "Y" to the same item, a naive whole-store overwrite of `itemRemovedTags` could lose Browser B's removal. Is additive union merge expected for removed-tags, or is whole-store replacement sufficient?
- **Assumption: the DiffModal preview shows tag differences.** Currently `itemTags` is excluded from `compareSettings` — unclear whether the user will see tag changes in the preview modal before accepting, or if tags are applied silently alongside inventory changes.

### Codex

#### Verified

1. `itemTags` is a separate UUID-keyed localStorage map, loaded into a global `itemTags` object by `loadItemTags()` and saved by `saveItemTags()` (`js/tags.js:7-55`).
2. Tag add/remove paths persist `itemTags` and schedule cloud push, but do not update the inventory item's `lastModified` (`js/tags.js:89-144`, `js/diff-engine.js:32-89`).
3. Sync vault payloads use `SYNC_SCOPE_KEYS` through `collectVaultData("sync")`; `itemTags` is in scope and `itemRemovedTags` is not (`js/vault.js:308-314`, `js/vault.js:487-489`, `js/constants.js:852-921`).
4. Full vault restore writes keys from `ALLOWED_STORAGE_KEYS` and refreshes `loadItemTags()`, which explains why full overwrite restore handles tags differently from selective cloud merge (`js/vault.js:376-409`).
5. The selective merge paths explicitly exclude `itemTags` from settings comparison at the deferred vault path, manifest-first settings path, and vault-first fallback path (`js/cloud-sync.js:3131-3153`, `js/cloud-sync.js:3317-3333`, `js/cloud-sync.js:3765-3791`).
6. `_applyAndFinalize()` applies settings writes, saves inventory, and renders filters/table, but does not call `loadItemTags()` (`js/cloud-sync.js:2686-2860`).
7. `itemRemovedTags` is read on demand through `loadRemovedTags(uuid)` and mutated by `addRemovedTag()` / `clearRemovedTag()`; there is no resident removed-tags map equivalent to `itemTags` (`js/tags.js:324-352`).
8. The Cloud Sync foundation doc confirms sync vaults are `SYNC_SCOPE_KEYS`-scoped and the pull preview path excludes `itemTags` from settings diff pending dedicated handling (`Foundation/cloud-sync.md:101-106`, `Foundation/cloud-sync.md:199-229`, `Foundation/cloud-sync.md:309-313`).

#### Top concerns

1. **AC-2 is not testable as written.** The stated `lastModified` tiebreaker does not reflect tag-only writes in current code, so discovery/approach must choose a real recency model.
2. **AC-4 combines two different requirements.** `itemRemovedTags` must first enter `SYNC_SCOPE_KEYS`, then it needs explicit conflict semantics for remove-vs-readd and independent removals.
3. **The requirements do not say whether tag diffs are user-visible in DiffModal or applied silently.** Current selective paths exclude `itemTags` from `compareSettings`, so the user-preview contract needs to be made explicit.

#### Unverified assumptions

- Tag-only edits are intended to participate in "last writer wins" without modifying the inventory item.
- Per-UUID tag merge is required; whole-store replacement is not acceptable.
- Removed-tags conflicts should not use simple union semantics when one device re-adds a previously removed tag.
- Adding `itemRemovedTags` to `SYNC_SCOPE_KEYS` is acceptable despite changing the encrypted sync payload surface.
- It is acceptable for tag/removed-tag changes to be applied silently alongside accepted inventory/settings changes rather than shown as separate DiffModal rows.

### AGY

#### Verified

1. **`itemTags` is skipped in settings comparison** — Confirmed that `itemTags` is explicitly bypassed in settings comparison in the deferred vault restore path (`js/cloud-sync.js:3135-3136`), manifest-first settings path (`js/cloud-sync.js:3326`), and vault-first settings path (`js/cloud-sync.js:3772`, `3779`).
2. **`itemRemovedTags` is not in `SYNC_SCOPE_KEYS`** — Confirmed at `js/constants.js:852-921` that `itemRemovedTags` is absent from the sync scope, meaning it is currently excluded from Dropbox backups during push operations. It is, however, present in `ALLOWED_STORAGE_KEYS` (`js/constants.js:1058`).
3. **`_applyAndFinalize()` misses `loadItemTags()`** — Confirmed at `js/cloud-sync.js:2686-2860` that the finalization function saves the inventory and updates storage stats but does not refresh the in-memory `itemTags` map, leaving it in a stale state after a selective apply.
4. **Tag operations do not bump item `lastModified`** — Confirmed at `js/tags.js:89-144` that adding, removing, or globally deleting tags calls `saveItemTags()` and triggers a sync push but does not update the parent item's `lastModified` timestamp.

#### Top Concerns

1. **Untestability and Unspecified Conflict Behavior of AC-2**: Tag changes do not update the inventory item's `lastModified`. Therefore, a simple comparison based on the item's `lastModified` will not reflect tag-only updates. We need to decide whether tag operations should bump the item's `lastModified` (which will display the item as modified in the DiffModal), or if we should introduce a dedicated tag timestamp map (e.g. `itemTagsLastModified` in localStorage) to track per-UUID tag modification timestamps cleanly.
2. **Underspecified Merge Semantics for Removed Tags (AC-4)**: If Browser A removes a tag (adding it to `itemRemovedTags`) and Browser B re-adds that tag (removing it from `itemRemovedTags`), a simple union of both lists would result in the tag being removed again. To respect re-additions, we must have conflict resolution logic for removed tags, which is difficult to implement reliably without timestamps.
3. **Silent Merge path vs. User Visibility**: Since `itemTags` and `itemRemovedTags` are currently excluded from settings diffing, tag changes are merged silently in the background rather than being listed as distinct changes in the DiffModal. The requirements should explicitly state if silent background merging is the intended UX, or if these should be visible to the user in some way.

#### Unverified Assumptions

- **Silent merging is acceptable**: We assume that applying tag modifications silently during finalization (without showing them in the DiffModal preview) meets user expectations.
- **Granular tag merges are required**: We assume that a whole-store overwrite of `itemTags` and `itemRemovedTags` is unacceptable because it would discard local tag-only edits that haven't been synced yet, necessitating a per-item UUID merge.
- **Re-additions win in simple merges**: In the absence of per-tag timestamps, we assume that re-adding a tag should override a prior removal.

### OpenCode

#### Verified

1. **`itemTags` is excluded from settings diff at all 3 selective-merge sites, plus a 4th silent-drop on the silent-pull path** — Confirmed exclusions at deferred vault path (`js/cloud-sync.js:3135-3136`), manifest-first settings path (`js/cloud-sync.js:3326`), and vault-first fallback path (`js/cloud-sync.js:3772,3779`). Additionally, the silent-pull path (`js/cloud-sync.js:3345-3412`) returns without calling `_applyAndFinalize` when both item and settings diffs are empty, which means tag-only changes on the remote are silently skipped even after the merge logic is fixed in `_applyAndFinalize`.

2. **`saveItemTags()` already schedules a sync push** — Confirmed at `js/tags.js:54`: `scheduleSyncPush()` is called inside `saveItemTags()`. Tags ARE pushed to Dropbox via `collectVaultData("sync")` (which includes `itemTags` in `SYNC_SCOPE_KEYS` at `constants.js:855`). The push pipeline is intact; only the pull/merge pipeline is broken.

3. **`itemRemovedTags` is in `ALLOWED_STORAGE_KEYS` but NOT `SYNC_SCOPE_KEYS`** — Confirmed at `js/constants.js:1058` vs `js/constants.js:852-921`. Adding it to `SYNC_SCOPE_KEYS` changes the encrypted sync payload surface. The key is read on-demand via `loadRemovedTags()` (`js/tags.js:324-329`) and there is no global in-memory cache for it — only per-uuid loads.

4. **Tag store has no per-entry timestamp** — Confirmed at `js/tags.js:8` comment: `{"uuid-abc": ["Bullion", "Commemorative"]}`. Unlike inventory items (which have `lastModified` in `DIFF_FIELDS`), neither `itemTags` nor `itemRemovedTags` stores have any recency metadata. AC-2's "last-writer-wins by `lastModified`" is not mechanically implementable without new timestamp infrastructure.

5. **`_applyAndFinalize()` does not call `loadItemTags()`** — Confirmed by reading `js/cloud-sync.js:2686-2861`. The function saves inventory, renders the table, and updates storage stats, but never refreshes the in-memory `itemTags` map. The `restoreVaultData()` full-overwrite path at `js/vault.js:409` does call `loadItemTags()`, but this path writes all `ALLOWED_STORAGE_KEYS` and is not used for selective sync merge.

6. **Case-insensitive tag dedup in `addItemTag` but no merge dedup** — Confirmed at `js/tags.js:97-99` that tag deduplication is case-insensitive (`t.toLowerCase() === lowerTrimmed`), but the stored tag preserves original casing. A merge that combines two devices' tag arrays for the same UUID may produce casing-variant duplicates if handled additively rather than as a last-writer-wins replacement.

7. **`numista_tags_auto` is a separate `SYNC_SCOPE_KEYS` entry** — Confirmed at `constants.js:905`. This setting controls auto-apply behavior and would merge as a regular settings key via `compareSettings`. Its independence from `itemTags` in the settings diff exclusion is correct and should be preserved.

#### Top Concerns

1. **The silent-pull path (`cloud-sync.js:3345-3412`) is a gap not covered by any AC.** Even after fixing tag merging in `_applyAndFinalize`, tag-only remote changes will be silently skipped when the manifest shows no item changes and `compareSettings` returns empty (because `itemTags` is excluded). The approach or tasks phase must address whether tag comparison needs to happen _before_ the silent-pull early-return guard, or whether the guard itself should be relaxed to always check tags.

2. **AC-2's recency model is fundamentally underspecified.** The tag stores have zero timestamp metadata (`js/tags.js:8` "Data shape" comment, `js/diff-engine.js:32-89` DIFF_FIELDS), and tag operations do not mutate any `lastModified` (`js/tags.js:89-144`). Three viable recency models exist, each with different implementation cost: (a) introducing per-UUID timestamps in `itemTags` as a `{ uuid: { tags: [], lastModified: ts } }` shape, (b) having tag edits bump the inventory item's `lastModified` (which would surface tag-only edits as item modifications in DiffModal — a UX change), or (c) whole-store-level comparison using the push timestamp as a coarse tiebreaker (simplest but loses per-item granularity). The requirements must pick one before approach/design can proceed.

3. **AC-4 combines a payload schema change with underspecified conflict semantics.** Adding `itemRemovedTags` to `SYNC_SCOPE_KEYS` (required for push, `constants.js:852-921`) and implementing merge logic both need to happen, but the merge rule for remove-vs-readd conflicts is the harder problem. `clearRemovedTag()` (`js/tags.js:343-352`) already handles the local case (re-adding a tag removes its removed-tag entry), but cross-device conflicts have no resolution precedent in the codebase. Requirements should specify whether the removed-tags store follows last-writer-wins (like AC-2 proposes for tags) or a different rule (e.g., "removal loses to re-add").

#### Unverified Assumptions

- **Assumption: tag-only changes will be detected on the manifest-fast-path.** The silent-pull early-return at `cloud-sync.js:3345-3412` fires when `manifestDiff.added + manifestDiff.deleted + settingsDiff.changed` are all empty. Since `itemTags` is excluded from `compareSettings`, a remote with only tag changes produces an empty settings diff, triggering the silent return without merging. The approach must address this gap.

- **Assumption: case-insensitive tag merge is acceptable without explicit specification.** Two devices using different casing for the same logical tag could produce duplicate entries in a naive additive merge. The requirements should state whether merge preserves remote casing as authoritative or performs a case-insensitive deduplication pass.

- **Assumption: `numista_tags_auto` and `itemTags` are independent enough that syncing tags doesn't unintentionally toggle auto-tagging.** Both are in `SYNC_SCOPE_KEYS` but `numista_tags_auto` merges via `compareSettings` while `itemTags` is excluded. The approach must ensure these remain decoupled.

- **Assumption: adding `itemRemovedTags` to `SYNC_SCOPE_KEYS` has no unintended side effects on existing sync payloads, cloud sync quota, or DiffModal preview rendering.** The `itemRemovedTags` store could theoretically grow large if many tags are removed across many items. The requirements should note whether a quota/performance bound is expected.

### Resolution Summary

- Accepted: 3
- Rejected: 0
- Resolved with your input: 5

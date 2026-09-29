---
sketch: STRK-108-cloud-sync-tags
phase: approach
created: "2026-05-25"
---

# STRK-108 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

The fix spans three layers — timestamp infrastructure, sync payload schema, and merge logic — touching `tags.js`, `constants.js`, and `cloud-sync.js`.

**Layer 1 — Timestamp infrastructure (`tags.js`).** A new `itemTagsLastModified` localStorage store (`{ [uuid]: number }`) tracks the last time tags were mutated for each item UUID. A shared helper `stampTagTimestamp(uuids)` updates this store and is called from every tag-mutating function: `addItemTag`, `removeItemTag`, `deleteItemTags`, `renameTag`, `deleteTagGlobal`. This gives the merge logic a per-UUID recency signal that is independent of the inventory item's `lastModified` (which does not update on tag-only edits).

**`persist=false` batch callers — contract obligation.** Multiple call sites use `addItemTag(uuid, tag, false)` to batch mutations without triggering `saveItemTags()` on each call. These callers MUST call `stampTagTimestamp([uuid])` after completing their batch and before calling `saveItemTags()`. Known sites: split/clone (`inventory.js:1253`), edit-modal multi-tag (`inventory.js:1817`), import paths (`inventory-import.js:47`, `:168`, `:561`, `:1444`), and add/clone pending tags (`events.js:2028`, `:2302`). Tasks must add the stamp call at each site.

**Safety note:** `stampTagTimestamp()` writes to `itemTagsLastModified` (its own localStorage key), NOT to `itemTags`. Since `scheduleSyncPush()` is only called inside `saveItemTags()`, a timestamp stamp alone cannot trigger an unwanted sync push. This makes it safe to call during `persist=false` batches.

**Layer 2 — Sync payload schema (`constants.js`).** Two keys are added to `SYNC_SCOPE_KEYS`: `itemRemovedTags` (currently only in `ALLOWED_STORAGE_KEYS`) and `itemTagsLastModified` (new). Both keys are also added to `ALLOWED_STORAGE_KEYS`. This ensures they are included in the encrypted Dropbox vault payload on push and available to the pull side for merge comparison. All three settings-diff loops (deferred vault `:3134`, manifest-first `:3326`, vault-first `:3772/3779`) gain skip guards for these two new keys alongside the existing `itemTags` skip.

**Layer 3 — Merge logic (`cloud-sync.js`).** A new private helper `_mergeTagData(remoteTagData)` performs per-UUID last-writer-wins comparison using `itemTagsLastModified` timestamps. This helper is called from `_applyAndFinalize()` with remote tag data passed through a new `options.remoteTagData` parameter. Each call site (deferred vault, DiffModal preview, vault-first) extracts `itemTags`, `itemRemovedTags`, and `itemTagsLastModified` from the remote payload and passes them in. The silent-pull early-return guard at `:3345` is widened to compare remote tags against local state before returning — if tags differ, execution continues to `_applyAndFinalize()` instead of silently recording a no-op pull.

## Resolved Open Questions (from Discovery)

### OQ-1: Timestamp stamping mechanism

**Decision:** Shared helper `stampTagTimestamp(uuids)` in `tags.js`, called by each mutator after mutation but before `saveItemTags()`.

- `addItemTag(uuid, tag, persist=true)` — calls `stampTagTimestamp([uuid])` when `persist=true`
- `removeItemTag(uuid, tag)` — calls `stampTagTimestamp([uuid])`
- `deleteItemTags(uuid)` — calls `stampTagTimestamp([uuid])` (stamps before delete, so the deletion timestamp is recorded and synced — the remote merge interprets "newer timestamp + empty/missing tag array" as "tags were intentionally deleted")
- `renameTag(oldName, newName)` — collects all affected UUIDs, calls `stampTagTimestamp(affectedUuids)` once after the loop
- `deleteTagGlobal(tag)` — collects `affectedUuids`, calls `stampTagTimestamp(affectedUuids)` once after the loop
- Batch `addItemTag(..., false)` flows — callers (e.g. Numista auto-tag at `tags.js:560-565`) must call `stampTagTimestamp` with the affected UUID after the batch and before `saveItemTags()`. A code comment at the `persist=false` parameter documents this contract.

**Rationale:** Stamping inside each mutator (rather than inside `saveItemTags()`) gives explicit control over which UUIDs are stamped. `saveItemTags()` writes the entire store and doesn't know which UUIDs changed. A central `saveItemTags()`-based stamp would have to diff old vs new to find changed UUIDs — wasteful. The helper approach also naturally handles batch operations via a single call with a UUID list.

### OQ-2: Manifest payload source contract for AC-5

**Decision:** Use the same data source the path already has access to:

- **Manifest-first path:** `manifest.settings["itemTags"]`, `manifest.settings["itemRemovedTags"]`, `manifest.settings["itemTagsLastModified"]` — these are already embedded in the manifest push payload via `collectVaultData("sync")` which iterates `SYNC_SCOPE_KEYS`.
- **Vault-first path:** `remotePayload.data["itemTags"]`, `remotePayload.data["itemRemovedTags"]`, `remotePayload.data["itemTagsLastModified"]` — from the decrypted vault blob.
- **Deferred vault path:** `payload.data["itemTags"]` etc. — same pattern as vault-first.

The tag comparison before the silent-pull guard (manifest-first path) uses `_hasTagChanges(manifestSettings)` which compares three raw localStorage strings: `itemTags`, `itemRemovedTags`, AND `itemTagsLastModified`. All three must match for the guard to return early. This prevents a scenario where tag content matches but remote timestamps are newer — without this check, the local timestamp map would go stale and produce incorrect last-writer-wins results on the next real tag conflict.

### OQ-3: `itemTagsLastModified` SYNC_SCOPE_KEYS scope

**Decision:** Added to `SYNC_SCOPE_KEYS` (pushed to Dropbox). Without syncing timestamps, the pull side has no remote timestamps to compare against, making per-UUID last-writer-wins impossible. The key is also added to `ALLOWED_STORAGE_KEYS` so vault full-restore writes it correctly.

## Key Decisions

| #   | Decision                                                                                | Rationale                                                                                                                                                     | Tradeoff                                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-1 | Per-UUID last-writer-wins via new `itemTagsLastModified` map                            | Tag-only edits don't update item `lastModified`; a dedicated timestamp gives correct recency for tag mutations independently of inventory edits               | Adds a new localStorage key and sync payload field; negligible storage cost (`{ uuid: timestamp }` is small)                                                                                                                                                                                                                                                                   |
| D-2 | Shared `stampTagTimestamp(uuids)` helper in `tags.js`                                   | Centralizes timestamp logic; handles both single-tag and batch operations cleanly; avoids diffing inside `saveItemTags()`                                     | Every mutator must remember to call it — mitigated by code comments and test coverage                                                                                                                                                                                                                                                                                          |
| D-3 | Pass remote tag data via `options.remoteTagData` in `_applyAndFinalize()`               | Avoids adding positional parameters to an already 5-param function; keeps tag data access explicit at each call site                                          | Each call site must extract and pass the tag data — 3 sites, mechanical edit                                                                                                                                                                                                                                                                                                   |
| D-4 | Add `itemRemovedTags` + `itemTagsLastModified` to `SYNC_SCOPE_KEYS`                     | Required for AC-4 (removed tags must be pushed) and AC-2 (timestamps must be available to the pull side)                                                      | Increases sync payload size marginally; both stores are typically small                                                                                                                                                                                                                                                                                                        |
| D-5 | Write directly to localStorage during merge, bypassing `saveItemTags()`                 | `saveItemTags()` calls `scheduleSyncPush()` at `:54` — calling it during a pull would trigger a re-push loop                                                  | Must replicate the STAK-421 corruption guard manually; addressed by writing via `saveDataSync()` which JSON-stringifies correctly. Tag writes participate in `_applyAndFinalize()`'s rollback gate: if any `saveDataSync()` throws (quota error), the function returns failure and the pull is not recorded as successful — same pattern as existing appliedSettings tracking. |
| D-6 | Widen silent-pull guard with `_hasTagChanges()` check                                   | AC-5 requires detecting tag-only remote changes that currently produce false "no changes"                                                                     | Adds a comparison before the guard; cheap (raw string equality on three localStorage keys: itemTags, itemRemovedTags, itemTagsLastModified)                                                                                                                                                                                                                                    |
| D-7 | Re-add wins over removal (AC-4 conflict rule)                                           | Mirrors `clearRemovedTag()` local behavior; if a tag is present in the winning device's `itemTags`, the corresponding `itemRemovedTags` entry is discarded    | Could theoretically lose a removal if the re-add was unintentional; acceptable for v1                                                                                                                                                                                                                                                                                          |
| D-8 | Skip guards for `itemRemovedTags` + `itemTagsLastModified` in all 3 settings-diff loops | Same pattern as existing `itemTags` skip — prevents these stores from falling through generic settings-diff logic into DiffModal                              | Mechanical edit at 3 sites; must be kept in sync with `SYNC_SCOPE_KEYS` additions                                                                                                                                                                                                                                                                                              |
| D-9 | STAK-470 auto-merge path routes tag keys through `_mergeTagData()`                      | Without this, tag keys arriving as "one-sided" settings get raw-written to localStorage, bypassing per-UUID merge and potentially overwriting local tag edits | Adds complexity to the auto-merge branch; requires extracting tag keys from the one-sided diff before iterating remaining keys                                                                                                                                                                                                                                                 |

## File Map

### New

- _(none — no new files)_

### Modified

| File                            | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `js/tags.js`                    | Add `stampTagTimestamp(uuids)` helper, `loadTagTimestamps()`, `saveTagTimestampsDirect(map)`. Update `addItemTag`, `removeItemTag`, `deleteItemTags`, `renameTag`, `deleteTagGlobal` to call `stampTagTimestamp`. Add `persist=false` contract comment for batch callers. Expose `loadTagTimestamps` and `stampTagTimestamp` on `window` for cross-file access.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `js/constants.js`               | Add `ITEM_TAGS_LAST_MODIFIED_KEY` and `ITEM_REMOVED_TAGS_KEY` constants. Add `"itemRemovedTags"` and `"itemTagsLastModified"` to `SYNC_SCOPE_KEYS`. Add `"itemTagsLastModified"` to `ALLOWED_STORAGE_KEYS`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `js/cloud-sync.js`              | Add `_hasTagChanges(remoteSettings)` — three-key equality check (itemTags, itemRemovedTags, itemTagsLastModified) for silent-pull guard widening. Add `_mergeTagData(remoteTagData)` — per-UUID last-writer-wins merge with re-add-wins conflict rule. Widen skip guards at `:3134-3137`, `:3326`, `:3772/3779` to also skip `itemRemovedTags` and `itemTagsLastModified`. Widen silent-pull guard at `:3345` to call `_hasTagChanges()`. Add tag merge + `loadItemTags()` call inside `_applyAndFinalize()`. Pass `remoteTagData` via `options` at all 3 call sites (deferred vault `:3153`, DiffModal preview `:2945`, vault-first). **STAK-470 auto-merge path (`:3441-3609`):** add skip-guard for `itemTags`, `itemRemovedTags`, `itemTagsLastModified` keys — if any of these appear in the one-sided diff, extract them, route through `_mergeTagData()` instead of raw `localStorage.setItem`, then continue the auto-merge for remaining non-tag keys. |
| `js/inventory.js`               | Add `stampTagTimestamp([uuid])` call at split/clone (`:1253`) and edit-modal multi-tag (`:1817`) batch sites, after batch and before `saveItemTags()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `js/inventory-import.js`        | Add `stampTagTimestamp([uuid])` call at import batch sites (`:47`, `:168`, `:561`, `:1444`), after batch and before `saveItemTags()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `js/events.js`                  | Add `stampTagTimestamp([uuid])` call at add-pending-tags (`:2028`) and clone-pending-tags (`:2302`) batch sites, after batch and before `saveItemTags()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `tests/cloud-sync-tags.spec.js` | Playwright tests covering: (1) tags sync from Browser A to B via constructed payloads, (2) per-UUID last-writer-wins by timestamp, (3) `itemRemovedTags` merge with re-add-wins rule, (4) tag-only remote change detection (AC-5 guard), (5) in-memory refresh via `loadItemTags()` after merge, (6) STAK-470 auto-merge path correctly routes tag keys through `_mergeTagData()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Deleted

- _(none)_

## `_mergeTagData()` Design

```
Input: options.remoteTagData = {
  itemTags:             { [uuid]: string[] },   // remote tag store
  itemRemovedTags:      { [uuid]: string[] },   // remote removed-tags store
  itemTagsLastModified: { [uuid]: number }       // remote per-UUID timestamps
}

Algorithm (per UUID present in either local or remote):
  1. localTs  = localTimestamps[uuid]  || 0
     remoteTs = remoteTimestamps[uuid] || 0
  2. if remoteTs > localTs:
       → take remote tags array wholesale for this UUID
       → take remote removedTags array for this UUID
       → update local timestamp to remoteTs
     else:
       → keep local tags array
       → keep local removedTags array
  3. Re-add-wins pass: for each UUID in the merged result,
     if a tag is present in itemTags[uuid], remove it from
     itemRemovedTags[uuid] (mirrors clearRemovedTag() behavior)
  4. Write merged itemTags, itemRemovedTags, itemTagsLastModified
     to localStorage via saveDataSync() (NOT saveItemTags())
  5. Call loadItemTags() to refresh the in-memory global
     (itemRemovedTags needs no refresh — read on demand)
```

## Data / Schema Changes

**New localStorage key:** `itemTagsLastModified` — `{ [uuid]: number }`. Created lazily on first tag mutation after this code ships. Pre-existing users with tag data but no timestamps will have all UUIDs default to timestamp `0` during merge, meaning the remote side wins (correct behavior — the remote may have timestamps if it's already on the new code; if both lack timestamps, `0 > 0` is false so local wins, preserving existing state).

**Sync payload additions:** `itemRemovedTags` and `itemTagsLastModified` added to `SYNC_SCOPE_KEYS`. This is a payload schema expansion — the encrypted vault blob grows by two entries. Both are typically small stores. No migration needed; `collectVaultData("sync")` automatically includes any key in `SYNC_SCOPE_KEYS`.

## Tradeoffs Surfaced for Review

- **D-1: Per-UUID timestamps vs. item `lastModified`.** The reconciled requirements chose `itemTagsLastModified` because tag-only edits don't update item `lastModified`. The tradeoff is a new localStorage key and sync payload field. The alternative (bumping item `lastModified` on tag edits) would surface tag-only changes as item modifications in DiffModal — a UX change outside this scope.
- **D-5: Direct localStorage write vs. `saveItemTags()`.** Bypassing `saveItemTags()` avoids the re-push loop but means the STAK-421 corruption guard in `saveItemTags()` doesn't run on merge writes. Mitigated by writing via `saveDataSync()` which handles JSON encoding correctly. The STAK-421 multi-stringify repair in `loadItemTags()` will catch any pre-existing corruption in the remote payload.
- **Cold-start asymmetry.** When one device is on new code and the other isn't, the old device pushes tags but no timestamps. The new device sees `remoteTs = 0` for all UUIDs. If the new device has also never stamped (both `0`), local wins (no change). If the new device has stamped some UUIDs, local wins for those (correct — local is strictly newer). Upgrade order doesn't matter.

## Out of Scope (follow-up issues)

- Auditing other out-of-band localStorage stores that may also be skipped in selective sync — separate issue if found.
- Union-based tag merge strategy — separate issue if last-writer-wins causes real user pain.
- DiffModal visibility for tag changes — currently merged silently (Non-Goal 6).

## Risk Notes

- **Risk:** `cloud-sync.js` is large and security-sensitive (AES-256-GCM, atomic rollback). CLAUDE.md requires `/sketch-review` (Opus) peer review before merge. → Mitigation: peer review is a closing task.
- **Risk:** STRK-107 recently landed and touched `cloud-sync.js` (`neutralizeSupersededChangelog` in `_applyAndFinalize`). → Mitigation: Cohort 0 branches from fresh `origin/dev` post-STRK-107.
- **Risk:** `stampTagTimestamp` must be called from every mutator — if a mutator is missed, that path's tag edits will have timestamp `0` and always lose in merge. → Mitigation: tests verify timestamps are updated for each mutation path; code review covers the full mutator surface.
- **Risk:** Direct localStorage write during merge bypasses `saveItemTags()` corruption guard. → Mitigation: `saveDataSync()` handles JSON encoding; `loadItemTags()` STAK-421 repair handles incoming corruption.
- **Risk:** STAK-470 auto-merge path adds implementation complexity to an already-large change. → Mitigation: the path is mechanically similar to the existing skip-guard pattern; isolated in its own task with dedicated test coverage (AC-5 + test case 6).

---

> **Phase complete?** Architecture clear, all three discovery open questions resolved, decisions logged with rationale, file map complete. Then advance: `/sketch-review STRK-108 approach`, then `/sketch tasks STRK-108`.

## Review Archive — approach (2026-05-25)

_Reconciled by /sketch reconcile on 2026-05-25. Original reviewer marks preserved below for audit._

### Codex

#### Verified

- Verified tag storage/mutators: `itemTags` is a UUID-keyed localStorage map, `saveItemTags()` persists and schedules sync, `addItemTag()` mutates even when `persist=false`, remove/delete/global operations maintain `itemRemovedTags`, and `applyNumistaTags()` batches tag additions (`js/tags.js:7-58`, `js/tags.js:89-157`, `js/tags.js:183-249`, `js/tags.js:324-417`, `js/tags.js:560-565`).
- Verified broader `persist=false` callers that the approach currently does not enumerate: split/clone, edit modal, import paths, and pending add/clone tags (`js/inventory.js:1250-1255`, `js/inventory.js:1814-1819`, `js/inventory-import.js:37-51`, `js/inventory-import.js:155-173`, `js/inventory-import.js:552-564`, `js/inventory-import.js:1438-1447`, `js/events.js:2021-2029`, `js/events.js:2292-2303`).
- Verified sync payload and manifest/hash sources: `collectVaultData("sync")` uses `SYNC_SCOPE_KEYS`; `itemTags` is currently in scope while `itemRemovedTags` is only in `ALLOWED_STORAGE_KEYS`; manifests and settings hashes include every non-inventory sync key as raw localStorage strings (`js/vault.js:308-314`, `js/vault.js:487-489`, `js/constants.js:852-921`, `js/constants.js:1018-1058`, `js/cloud-sync.js:184-200`, `js/cloud-sync.js:1136-1160`, `js/cloud-sync.js:2035-2038`).
- Verified selective pull paths and skip guards: `_applyAndFinalize()` does not currently merge or refresh tags; deferred vault, manifest-first, and vault-first settings loops skip `itemTags`; the manifest silent-pull guard returns before `_applyAndFinalize()`; the STAK-470 auto-merge path also returns before `_applyAndFinalize()` (`js/cloud-sync.js:2686-2861`, `js/cloud-sync.js:2920-2947`, `js/cloud-sync.js:3133-3155`, `js/cloud-sync.js:3317-3412`, `js/cloud-sync.js:3441-3609`, `js/cloud-sync.js:3765-3791`).
- Verified rollback/storage-write constraints: `_applyAndFinalize()` tracks setting write failures before recording success, the Foundation doc calls that rollback pattern a hard invariant, and `saveDataSync()` throws on storage failures (`js/cloud-sync.js:2715-2783`, `js/utils.js:1207-1226`, `Projects/StakTrakr/Foundation/cloud-sync.md:275-301`).

#### Top concerns

1. The timestamp stamping plan will miss real tag writes unless it handles every successful `addItemTag(..., false)` batch or stamps inside `addItemTag()` independent of `persist`.
2. Tag localStorage writes inside `_applyAndFinalize()` need explicit rollback/success-gate semantics, because the existing pull path treats partial settings writes as a rollback condition.
3. The manifest silent-pull guard and STAK-470 branch need a precise decision for timestamp-only differences and tag-plus-one-sided-settings pulls, or tasks may preserve a known bypass around `_mergeTagData()`.

#### Unverified assumptions

- `stampTagTimestamp()` can safely write timestamp data during `persist=false` batches without creating unwanted sync pushes or localStorage churn.
- Raw-string `_hasTagChanges()` comparison is sufficient even when serialized object key order or compression state differs but semantic tag content does not.
- Timestamp-only remote differences should either trigger `_mergeTagData()` or can be safely ignored without harming future last-writer-wins decisions.
- Tag merge writes can be composed into `_applyAndFinalize()` without weakening the STAK-526 rollback invariant.
- The STAK-470 auto-merge residual gap is acceptable as a follow-up rather than in scope for AC-5.

### Resolution Summary

- Accepted: 4 (persist=false caller enumeration, rollback semantics for D-5, top concerns #1 and #2 — all addressed in body edits)
- Rejected: 1 (raw-string comparison insufficiency — matches existing production pattern)
- Resolved with your input: 3 (guard includes timestamps, STAK-470 brought in scope, explicit stamp safety note added)

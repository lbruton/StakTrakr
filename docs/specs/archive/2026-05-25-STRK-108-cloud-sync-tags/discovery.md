---
sketch: STRK-108-cloud-sync-tags
phase: discovery
created: '2026-05-25'
---

# STRK-108 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

### Tag Storage Layer (`js/tags.js`)

| Path | Role | Notes |
|------|------|-------|
| `js/tags.js:8` | Data shape comment | `{ "uuid-abc": ["Bullion", "Commemorative"] }` — no per-entry timestamp |
| `js/tags.js:14` | `loadItemTags()` | Reads `localStorage["itemTags"]` → global `itemTags` object. Includes STAK-421 multi-stringify repair |
| `js/tags.js:45` | `saveItemTags()` | Writes `itemTags` to localStorage + calls `scheduleSyncPush()` |
| `js/tags.js:89` | `addItemTag(uuid, tag, persist)` | Case-insensitive dedup at `:98-99`. Calls `clearRemovedTag()` at `:113` when `persist=true` |
| `js/tags.js:123` | `removeItemTag(uuid, tag)` | Calls `addRemovedTag()` at `:130` |
| `js/tags.js:151` | `deleteItemTags(uuid)` | Bulk delete + `clearAllRemovedTags()` |
| `js/tags.js:324` | `loadRemovedTags(uuid)` | On-demand read from `localStorage["itemRemovedTags"]` — no global cache |
| `js/tags.js:331` | `addRemovedTag(uuid, tag)` | Case-insensitive dedup, capitalizes first letter, writes via `saveDataSync` |
| `js/tags.js:343` | `clearRemovedTag(uuid, tag)` | Removes single entry from `itemRemovedTags` for a UUID |
| `js/tags.js:355` | `clearAllRemovedTags(uuid)` | Removes all removed-tag entries for a UUID |

**Key observation:** Tag operations (`addItemTag`, `removeItemTag`, `deleteItemTags`) do NOT update the inventory item's `lastModified`. Tag changes are invisible to the item-level diff engine. This is why AC-2 requires a new `itemTagsLastModified` timestamp map.

### Cloud Sync — Skip Guards (`js/cloud-sync.js`)

Three settings-diff sites explicitly skip `itemTags`:

| Path | Context | Guard Logic |
|------|---------|-------------|
| `cloud-sync.js:3134-3137` | Deferred vault restore path | `SYNC_SCOPE_KEYS[_dvs] === "itemTags"` → `continue` |
| `cloud-sync.js:3326` | Manifest-first settings path | `SYNC_SCOPE_KEYS[ms] === "itemTags"` → `continue` |
| `cloud-sync.js:3772,3779` | Vault-first fallback path | `_rsKeys[rs] !== "itemTags"` filter + `SYNC_SCOPE_KEYS[i] === "itemTags"` → `continue` |

All three use the same pattern: skip `itemTags` (and `metalInventory`) when iterating `SYNC_SCOPE_KEYS` for `DiffEngine.compareSettings()`. The original intent (STAK-455) was "dedicated tag handling" — never implemented.

### Cloud Sync — Silent-Pull Early Return (AC-5 gap)

| Path | Role | Notes |
|------|------|-------|
| `cloud-sync.js:3337-3344` | `_mNoChanges` + `_mNoSettingsChanges` computation | Checks manifest item diff + settings diff |
| `cloud-sync.js:3345-3412` | Silent-return guard | If both are empty → record pull, return without calling `_applyAndFinalize()` |

**Critical gap for AC-5:** When the remote has ONLY tag changes (no inventory field edits, no settings changes), this guard fires because:
- `_mNoChanges = true` (no item field diffs in manifest)
- `_mNoSettingsChanges = true` (itemTags is excluded from settings comparison)

Result: tag-only remote changes are silently discarded. The silent-pull path downloads image/attachment vaults but never reaches `_applyAndFinalize()`.

### Cloud Sync — STAK-470 Auto-Merge Path

| Path | Role | Notes |
|------|------|-------|
| `cloud-sync.js:3441-3600` | One-sided settings auto-merge | Fires when `_mNoChanges && !_mNoSettingsChanges` |

This path is NOT a gap for tags — it only fires when settings HAVE changed (`!_mNoSettingsChanges`). When tags are the only change, `_mNoSettingsChanges = true`, so the code hits the silent-return at `:3345` instead. However, when tags change alongside one-sided settings, this path would apply settings but still miss tags (no tag merge logic here either). A secondary concern, not a primary gap.

### Cloud Sync — `_applyAndFinalize()` (AC-3 gap)

| Path | Role | Notes |
|------|------|-------|
| `cloud-sync.js:2686-2861` | Finalization after selective merge | Saves inventory, applies settings, renders table, records pull metadata |

**Missing from `_applyAndFinalize`:**
1. No tag merge logic — `itemTags` and `itemRemovedTags` are never read from the remote payload or written to localStorage here
2. No `loadItemTags()` call — even if tags are written to localStorage by other means, the in-memory `itemTags` object remains stale
3. STRK-107 (merged aed3ce88) added `neutralizeSupersededChangelog` at `:2788-2790` — no structural change to the function signature or flow

### Constants & Scope Keys

| Path | Role | Notes |
|------|------|-------|
| `js/constants.js:630` | `ITEM_TAGS_KEY` | The localStorage key `"itemTags"` |
| `js/constants.js:855` | `SYNC_SCOPE_KEYS` entry | `"itemTags"` IS listed — included in push payload |
| `js/constants.js:1058` | `ALLOWED_STORAGE_KEYS` entry | `"itemRemovedTags"` is here but NOT in `SYNC_SCOPE_KEYS` |

**Payload gap:** `itemRemovedTags` is never pushed to Dropbox because it's absent from `SYNC_SCOPE_KEYS`. Adding it is a sync-payload schema change (AC-4 scope note), and must also receive a corresponding skip/dedicated-merge guard in all three settings-diff loops (deferred vault `:3134-3137`, manifest-first `:3326`, vault-first `:3772/3779`) — without the guard, `itemRemovedTags` would fall through generic settings-diff logic instead of the intended dedicated merge path.

### Working Reference — Full Overwrite Path

| Path | Role | Notes |
|------|------|-------|
| `js/vault.js:376-409` | `restoreVaultData()` | Iterates `ALLOWED_STORAGE_KEYS`, writes each from payload, then calls `loadItemTags()` at `:409` |

This is the model for "write tags to localStorage + refresh in-memory state." The selective sync path needs to replicate this pattern for both `itemTags` and `itemRemovedTags`.

## Prior Decisions

- 2026-05-25 — `/discover` run for STRK-108 confirmed the three skip-guard locations and the missing `loadItemTags()` in `_applyAndFinalize()`. Root cause: tags were deferred to "dedicated handling" (STAK-455) that was never implemented.
- 2026-05-25 — Requirements reconciliation resolved AC-2 timestamp model: new `itemTagsLastModified` per-UUID timestamp map (not item `lastModified`), updated on every `addItemTag`/`removeItemTag`/`deleteItemTags` call.
- 2026-05-25 — Requirements reconciliation resolved AC-4 conflict rule: re-add wins over removal (mirrors `clearRemovedTag()` local behavior).
- 2026-05-25 — STRK-107 merged (aed3ce88) — adds `neutralizeSupersededChangelog` to `_applyAndFinalize()`. Orthogonal but confirms the function's current shape. Branch from `origin/dev` post-merge to avoid conflicts.
- 2026-05-25 — STRK-101 manifest normalization previously landed (20544398) — also touched `cloud-sync.js`. Both STRK-107 and STRK-101 are on `dev`.

## External References

- `vault.js:restoreVaultData` — the canonical in-repo working reference for "write to localStorage + reload memory" pattern. No external links needed.
- Foundation doc `DocVault/Projects/StakTrakr/Foundation/cloud-sync.md` — pull flow diagram at lines 199-229 documents the manifest-first → vault-first fallback architecture. Line 226 explicitly notes: "itemTags excluded from settings diff (STAK-455)".

## Constraints

- **Out-of-band storage:** Tags live in `localStorage["itemTags"]` as `{ [uuid]: string[] }`, NOT on inventory item objects. `DIFF_FIELDS` in `diff-engine.js` must NOT be changed.
- **New timestamp infrastructure required:** `itemTagsLastModified` (a `{ [uuid]: number }` map) does not exist yet — zero references in the codebase. Must be created in `tags.js`, added to `SYNC_SCOPE_KEYS`, and updated on every tag-mutating call: `addItemTag`, `removeItemTag`, `deleteItemTags`, `renameTag()` (`js/tags.js:183-210`, touches all affected UUIDs), `deleteTagGlobal()` (`js/tags.js:218-243`, touches all UUIDs holding the tag), and batched `addItemTag(..., false)` + `saveItemTags()` flows (`js/tags.js:560-565`). Approach must decide the stamping mechanism — inside each individual mutator, inside `saveItemTags()`, or via a shared helper accepting a list of affected UUIDs.
- **`itemRemovedTags` has no in-memory cache:** Unlike `itemTags` (global object), `itemRemovedTags` is read on-demand via `loadRemovedTags(uuid)`. After writing to localStorage during merge, no in-memory refresh is needed (AC-3 note).
- **Case-insensitive dedup in `addItemTag`** (`tags.js:98-99`): merge must use last-writer-wins replacement per UUID (not additive merge) to avoid casing-variant duplicates across devices.
- **Re-add wins over removal** (AC-4 conflict rule): if a tag is present in the winning device's `itemTags` for a UUID, any corresponding `itemRemovedTags` entry for that tag/UUID is discarded. Mirrors `clearRemovedTag()` local behavior.
- **`cloud-sync.js` is security-sensitive:** All patches require `/sketch-review` (Opus or equivalent) peer review per CLAUDE.md.
- **Silent-pull guard must be widened** (AC-5): the early-return at `:3345-3412` currently checks only item diffs + settings diffs. Tag comparison must happen BEFORE this guard to detect tag-only remote changes.
- **STRK-107 already on `dev`:** Worktree must branch from `origin/dev` post-merge to include the `neutralizeSupersededChangelog` addition.
- **`saveItemTags()` triggers `scheduleSyncPush()`** (`tags.js:54`): writing to `itemTags` during a merge could trigger a re-push. The merge path must either write directly to localStorage (bypassing `saveItemTags`) or suppress the push during apply.

## Open Questions

_Three questions surfaced during discovery code review — blocking approach.md:_

1. **Timestamp stamping mechanism** — Should `itemTagsLastModified` be updated inside each individual mutator (`addItemTag`, `removeItemTag`, etc.), inside `saveItemTags()` itself (central but misses direct localStorage writers), or via a shared helper accepting a list of affected UUIDs? The batch mutators (`renameTag()`, `deleteTagGlobal()`) touch many UUIDs at once — the mechanism choice shapes how they integrate.

2. **Manifest payload source contract for AC-5** — When implementing the tag-only detection guard (widening the silent-pull early-return at `:3345-3412`), what is the comparison data source for remote tags? Options: `manifest.settings.itemTags` (already embedded in the manifest push payload via `buildAndUploadManifest`), the downloaded vault blob, or a shared normalized helper used across both manifest-first and vault-first paths. Must be made explicit before the AC-5 guard can be designed.

3. **`itemTagsLastModified` SYNC_SCOPE_KEYS scope** — Should it be added to `SYNC_SCOPE_KEYS` (pushed to Dropbox, available on the receiving device for last-writer-wins comparison) or kept local-only? If local-only, how does the pull side obtain the remote timestamps needed for per-UUID comparison?

_Previously resolved:_

- ~~What timestamp governs tag merge?~~ → New `itemTagsLastModified` per-UUID map (AC-2).
- ~~Is per-UUID granularity required?~~ → Yes — last-writer-wins per UUID, not whole-store replacement.
- ~~How do removed-tag conflicts resolve?~~ → Re-add wins (AC-4 conflict rule).
- ~~Are tag changes visible in DiffModal?~~ → No — merged silently in background (Non-Goal 6).
- ~~Will tag-only changes be detected?~~ → Yes — AC-5 requires widening the silent-pull guard.

## Discovery Summary

The bug has four distinct failure points, each mapped to an AC:

1. **No merge logic** (AC-1/AC-2): `_applyAndFinalize()` never reads or writes tag data from the remote payload. Needs a dedicated tag-merge function using per-UUID last-writer-wins via a new `itemTagsLastModified` timestamp map.
2. **No memory refresh** (AC-3): `loadItemTags()` is never called after merge writes — in-memory `itemTags` stays stale until page reload.
3. **Missing from push payload** (AC-4): `itemRemovedTags` is absent from `SYNC_SCOPE_KEYS`, so removals are never synced. Adding it is a payload schema change.
4. **Silent-pull drops tag-only changes** (AC-5): The early-return guard at `:3345-3412` doesn't compare tags, so tag-only remote edits are silently recorded as "no changes."

The new `itemTagsLastModified` timestamp map is the most significant new infrastructure — it touches `tags.js` (creation + updates on every tag mutation), `constants.js` (`SYNC_SCOPE_KEYS` addition), and `cloud-sync.js` (merge comparison logic). The constraint that `saveItemTags()` calls `scheduleSyncPush()` means the merge path must write directly to localStorage to avoid triggering a re-push loop.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions identified. Then advance: `/sketch approach STRK-108`.

## Review Archive — discovery (2026-05-25)

_Reconciled by /sketch reconcile on 2026-05-25. Original reviewer marks preserved below for audit._

### Codex

#### Verified

- Verified tag storage and mutation behavior in `js/tags.js`: `itemTags` is a UUID-keyed localStorage object loaded into global `itemTags`, `saveItemTags()` persists and schedules sync, add/remove/delete mutate without touching inventory `lastModified`, removed tags are read on demand, and re-add clears removed-tag entries (`js/tags.js:7-58`, `js/tags.js:89-157`, `js/tags.js:324-352`).
- Verified additional tag mutation paths that discovery does not name: `renameTag()` and `deleteTagGlobal()` mutate existing tag arrays and persist them, and inline multi-tag entry can call `addItemTag(..., false)` before one batched `saveItemTags()` (`js/tags.js:183-249`, `js/tags.js:560-565`).
- Verified sync payload scope: sync vault collection uses `SYNC_SCOPE_KEYS`; `itemTags` is included there, while `itemRemovedTags` is currently only in `ALLOWED_STORAGE_KEYS` (`js/vault.js:308-314`, `js/constants.js:852-921`, `js/constants.js:1018-1058`).
- Verified selective pull exclusions and early return behavior: all three settings-diff loops skip `itemTags`; the manifest silent-pull guard returns when item and settings diffs are empty; the STAK-470 branch only runs when settings changed; `_applyAndFinalize()` applies selected settings and saves/renders inventory but does not call `loadItemTags()` (`js/cloud-sync.js:3133-3153`, `js/cloud-sync.js:3323-3412`, `js/cloud-sync.js:3448-3609`, `js/cloud-sync.js:2686-2861`, `js/cloud-sync.js:3769-3791`).
- Verified the full overwrite reference: `restoreVaultData()` writes allowed storage keys and refreshes `loadItemTags()` afterward (`js/vault.js:376-409`).
- Verified the Foundation cloud-sync doc still documents sync vault scope, manifest-first/vault-first pull flow, `itemTags` exclusion from settings diff, and the `_applyAndFinalize()` rollback invariant (`Projects/StakTrakr/Foundation/cloud-sync.md:101-106`, `Projects/StakTrakr/Foundation/cloud-sync.md:199-229`, `Projects/StakTrakr/Foundation/cloud-sync.md:275-301`).

#### Top concerns

1. Adding `itemRemovedTags` to `SYNC_SCOPE_KEYS` is not just a constants edit. Without parallel skip/dedicated-merge handling, current settings-diff loops would treat removed tags as a normal setting and potentially surface/apply them through generic settings logic instead of the intended tag merge path.
2. The timestamp-update surface is understated. A correct `itemTagsLastModified` map must cover `renameTag()`, `deleteTagGlobal()`, batched `addItemTag(..., false)` flows, and likely Numista tag application, not only `addItemTag` / `removeItemTag` / `deleteItemTags`.
3. The manifest-first tag-only fix needs a precise data source contract. Current manifests already carry raw `itemTags` snapshots via `manifest.settings`, while the compare path skips local `itemTags`; after adding new tag keys, the approach should define whether tag comparison reads from `manifest.settings`, vault payload data, or a shared normalized helper across manifest-first and vault-first paths.

#### Unverified assumptions

- The approach can safely apply `itemRemovedTags` silently without showing a DiffModal settings row.
- `itemTagsLastModified` should be part of `SYNC_SCOPE_KEYS`, not only stored locally or embedded in the tag payload shape.
- Whole-array replacement per UUID is still acceptable for rename/global-delete cases that affect many UUIDs in one operation.
- Batched tag writes with `persist=false` should receive one timestamp for all affected UUIDs, rather than per-tag timestamps.
- Remote tag merge writes can bypass `saveItemTags()` and still perform every required UI/search-cache refresh.

### Resolution Summary
- Accepted: 5
- Rejected: 4 (Non-Goal 6 resolves DiffModal assumption; three approach-phase decisions deferred; bypass-saveItemTags concern self-answered by discovery line 19)
- Resolved with your input: 0

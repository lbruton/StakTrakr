# Cloud-Sync Convergence Invariant

Authoritative design note for the StakTrakr cloud-sync compare/merge/hash surfaces.
Read this before adding a `SYNC_SCOPE_KEYS` entry or touching any sync comparison.

## The invariant

> Every cloud-sync **compare**, **merge**, and **hash** operates on **normalized
> logical content** — never raw serialization — and every **merge** is
> **commutative / convergent on ties**.

Two consequences follow, and both are mandatory:

1. **Logical, not raw.** Decompress (`__decompressIfNeeded`) and canonicalize
   (sorted object keys, order-preserved arrays, scalar-as-JSON normalized to its
   logical value) before comparing or hashing. Identical logical content must
   compare/hash equal regardless of: lz-string `CMP2:` compression vs plain. Raw length `> 4096` compresses on one device, not the other. The same equality covers scalar stored as JSON (`"dark"`) vs raw (`dark`), object key insertion order,
   or date-time serialization variant.
2. **Commutative merge.** `merge(A, B)` must equal `merge(B, A)`, **including on a
   timestamp tie**. A last-write-wins no-op on a tie is non-commutative and freezes
   two diverged devices in a permanent "Review Sync Changes" loop. Resolve ties by
   a deterministic union (or another commutative rule). Only bump the
   modification timestamp when content actually changes (so the merge stays
   idempotent once both sides agree).

The fixes are **self-healing**: existing diverged installs reconcile on the next
sync with no user action. This includes tags that diverged with **no
`itemTagsLastModified` entry** (legacy installs, or Numista batch writes via
`applyNumistaTags(persist=false)`). The tie-union converges them by content
presence, not just by an equal timestamp. The one exception is data that cannot
round-trip (`[object Object]` corruption), which a one-time idempotent boot-repair
clears.

**Corruption sentinel is exact-match.** `_isCorruptObjectString` matches the
**entire** value being the `String(obj)` coercion artifact (`[object Object]` or
comma-joined repeats), never a substring. A free-text scope key (`itemTags`,
`tagBlacklist`, `chipCustomGroups`, …) may legitimately hold a user-entered tag or
label named `[object Object]` embedded in valid JSON; that must be preserved and
synced. Detecting the artifact as a substring would let boot-repair delete the
whole store, wiping every tag/group (the corruption-detection failure).

## Surface matrix

| Surface                       | Location                                                                        | Compares / merges on                                                                                                                     | Guarantee                  |
| ----------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Per-item tag merge            | `cloud-sync.js` `_mergeTagData` / `_unionTags`                                  | parsed+decompressed tag stores; sorted, case-insensitive union on tie                                                                    | commutative + convergent   |
| Tag-change gate               | `cloud-sync.js` `_hasTagChanges`                                                | canonicalized logical content                                                                                                            | logical equality           |
| Collections merge             | `collections-core.js` `mergeStates` via `cloud-sync.js` `_mergeCollectionState` | normalized state; per-Slot and per-artwork `modified`, Tombstones, `metaModified`; removals win artwork timestamp ties                   | commutative + idempotent   |
| Collections-change gate       | `cloud-sync.js` `_hasCollectionStateChange`                                     | `merge(local, remote)` vs `local`, canonicalized: true only when the remote contributes                                                  | logical, contribution-only |
| Settings hash                 | `cloud-sync.js` `computeSettingsHash` / `_canonicalizeSettingValue`             | decompressed, JSON-parsed, sorted-key canonical form (push and poll)                                                                     | logical equality           |
| Settings apply                | `cloud-sync.js` `_applyAndFinalize` / `_safeSettingWriteValue`                  | rejects `[object Object]` before persisting                                                                                              | integrity guard            |
| Boot repair                   | `cloud-sync.js` `syncBootRepairCorruptSettings`                                 | removes un-round-trippable corruption                                                                                                    | idempotent self-heal       |
| `.stvault` snapshot / restore | `cloud-sync.js` `syncSaveOverrideBackup` / `syncRestoreOverrideBackup`          | raw strings for backup, but skips corruption; restore drift is invisible because the hash is logical                                     | byte-stable round-trip     |
| Inventory hash                | `cloud-sync.js` `computeInventoryHash`                                          | item key + content fingerprint; `disposition` canonicalized; gated `\|frame:` and `\|legacyFrame:` segments for the image framing fields | logical equality           |
| Inventory item diff           | `diff-engine.js` `compareItems` / `_valuesEqual`                                | logical; instant-aware for `lastModified` (`INSTANT_FIELDS`)                                                                             | logical equality           |
| Attachments diff              | `diff-engine.js` `_diffAttachments`                                             | UUID / fileName keyed (order-independent); pill count reconciled with rendered rows                                                      | order-independent          |
| Settings diff (modal)         | `diff-engine.js` `compareSettings` / `_settingsValuesEqual`                     | type-coerced + sorted-key stringify                                                                                                      | logical equality           |

## Adding a new `SYNC_SCOPE_KEYS` entry

1. **Scalar string preference** (theme, currency): no special handling: store the
   raw string; `_canonicalizeSettingValue` parses-or-keeps it.
2. **Object / array config**: always write with `JSON.stringify`; never let an
   object reach `localStorage.setItem` un-stringified (that is the `[object Object]`
   corruption). Object key order does not matter (the hash canonicalizes), but
   **array element order is meaningful** and is preserved (e.g. `headerBtnOrder`).
3. **Per-item map merged across devices** (like tags): give it a commutative merge
   and reconcile ties by union, mirroring `_mergeTagData`. Do not add a raw
   last-write-wins compare.
4. **Date-time field** compared in the item diff: add it to `INSTANT_FIELDS` in
   `diff-engine.js` so serialization variants are not phantom conflicts.

## Image framing fields

`imageShape`, `obverseImageOrientation` and `reverseImageOrientation` are in `DIFF_FIELDS`
(Images group), the `changeLog.js` field array and a truthiness-gated `|frame:` hash segment.
An absent field and `""` hash and diff identically (`_valuesEqual` normalizes `""`). An
inventory with none of the fields hashes byte-identically to the previous build. The upgrade
raises no spurious sync prompt.

The legacy `obverseImageFrame` / `reverseImageFrame` are in `DIFF_FIELDS`, the `changeLog.js`
field array and a separate `|legacyFrame:` hash segment. The segment counts only `circle` and
`rectangle`. `auto`, `""` and any other value hash as absent. A frame-only edit, such as a
sparse save that removes the legacy keys, changes the hash. An inventory that carries a legacy
frame hashes differently from v3.36.75 and older builds. Its first sync after the upgrade sees a
hash-only mismatch and pushes once.

Known, accepted limits, pinned in `tests/unit/cloud-sync-image-frame-hash.test.js`:

- An older build's hash lacks the segment. For an inventory that carries the fields, the poll
  sees a mismatch with an empty field diff (a hash-only mismatch, matrix H-3). Only inventories
  that carry the fields are affected.
- An older build's edit of a migrated item's frame or Type is not detected (no heuristic). The
  new fields win on read. Therefore, the older build's frame edit is lost (matrix I-3, I-4).
- A device's `modify` diff covers only its own `DIFF_FIELDS`; an `add` or a ZIP restore copies the
  whole record and keeps the new fields (matrix H-5).

## Tests

Each merged/hashed store has a unit test under `tests/unit/`:
`cloud-sync-tag-merge.test.js` (commutativity), `cloud-sync-settings-hash.test.js`
(logical equality, compressed-vs-plain), `cloud-sync-boot-repair.test.js`
(corruption guard + idempotent repair), `diff-engine-normalization.test.js`
(instant-aware + attachments), and `cloud-sync-convergence-audit.test.js`
(inventory-hash canonicalization + logical tag-change gate).

# Cloud-Sync Convergence Invariant (STRK-154)

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
   compare/hash equal regardless of: lz-string `CMP2:` compression vs plain
   (raw length `> 4096` compresses on one device, not the other — STRK-140),
   scalar stored as JSON (`"dark"`) vs raw (`dark`), object key insertion order,
   or date-time serialization variant.
2. **Commutative merge.** `merge(A, B)` must equal `merge(B, A)`, **including on a
   timestamp tie**. A last-write-wins no-op on a tie is non-commutative and freezes
   two diverged devices in a permanent "Review Sync Changes" loop. Resolve ties by
   a deterministic union (or another commutative rule), and only bump the
   modification timestamp when content actually changes (so the merge stays
   idempotent once both sides agree).

The fixes are **self-healing**: existing diverged installs reconcile on the next
sync with no user action. The one exception is data that cannot round-trip
(`[object Object]` corruption), which a one-time idempotent boot-repair clears.

## Surface matrix

| Surface                       | Location                                                               | Compares / merges on                                                                                 | Guarantee                | Issue          |
| ----------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------ | -------------- |
| Per-item tag merge            | `cloud-sync.js` `_mergeTagData` / `_unionTags`                         | parsed+decompressed tag stores; sorted, case-insensitive union on tie                                | commutative + convergent | STRK-155       |
| Tag-change gate               | `cloud-sync.js` `_hasTagChanges`                                       | canonicalized logical content                                                                        | logical equality         | STRK-159       |
| Settings hash                 | `cloud-sync.js` `computeSettingsHash` / `_canonicalizeSettingValue`    | decompressed, JSON-parsed, sorted-key canonical form (push and poll)                                 | logical equality         | STRK-156       |
| Settings apply                | `cloud-sync.js` `_applyAndFinalize` / `_safeSettingWriteValue`         | rejects `[object Object]` before persisting                                                          | integrity guard          | STRK-157       |
| Boot repair                   | `cloud-sync.js` `syncBootRepairCorruptSettings`                        | removes un-round-trippable corruption                                                                | idempotent self-heal     | STRK-157       |
| `.stvault` snapshot / restore | `cloud-sync.js` `syncSaveOverrideBackup` / `syncRestoreOverrideBackup` | raw strings for backup, but skips corruption; restore drift is invisible because the hash is logical | byte-stable round-trip   | STRK-157 / 159 |
| Inventory hash                | `cloud-sync.js` `computeInventoryHash`                                 | item key + content fingerprint; `disposition` canonicalized                                          | logical equality         | STRK-159       |
| Inventory item diff           | `diff-engine.js` `compareItems` / `_valuesEqual`                       | logical; instant-aware for `lastModified` (`INSTANT_FIELDS`)                                         | logical equality         | STRK-158       |
| Attachments diff              | `diff-engine.js` `_diffAttachments`                                    | UUID / fileName keyed (order-independent); pill count reconciled with rendered rows                  | order-independent        | STRK-158       |
| Settings diff (modal)         | `diff-engine.js` `compareSettings` / `_settingsValuesEqual`            | type-coerced + sorted-key stringify                                                                  | logical equality         | pre-existing   |

## Adding a new `SYNC_SCOPE_KEYS` entry

1. **Scalar string preference** (theme, currency): no special handling — store the
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

## Tests

Each merged/hashed store has a unit test under `tests/unit/`:
`cloud-sync-tag-merge.test.js` (commutativity), `cloud-sync-settings-hash.test.js`
(logical equality, compressed-vs-plain), `cloud-sync-boot-repair.test.js`
(corruption guard + idempotent repair), `diff-engine-normalization.test.js`
(instant-aware + attachments), and `cloud-sync-convergence-audit.test.js`
(inventory-hash canonicalization + logical tag-change gate).

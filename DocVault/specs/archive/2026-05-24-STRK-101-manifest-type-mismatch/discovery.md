---
sketch: "STRK-101-manifest-type-mismatch"
phase: discovery
created: 2026-05-23
---

# STRK-101 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

Files touched by or relevant to this work:

| Path | Role | Notes |
|------|------|-------|
| `js/changeLog.js:155` | ChangeLog producer — writes type strings | Writes `"item-add"`, `"item-edit"`, `"item-delete"`. This is the root of the type namespace. |
| `js/cloud-sync.js:1043–1082` | `buildAndUploadManifest()` — summary counting | Checks `entryType === "add"` / `"edit"` / `"delete"`. Never matches the prefixed producer types; summary counts always 0. |
| `js/cloud-sync.js:2925–2959` | `_buildDiffFromManifest()` — diff classification | Checks `change.type === "add"` / `"edit"` / `"delete"`. Never matches; returns `{ added:[], modified:[], deleted:[], unchanged:[] }` for any item-only changeset. |
| `js/cloud-sync.js:3285–3362` | Manifest-first pull — `_mNoChanges` silent-pull gate | Evaluates `manifestDiff.added.length === 0 && deleted.length === 0 && modified.length === 0`. Because `_buildDiffFromManifest()` always returns empty arrays, this condition fires for every item-only sync and takes the silent-pull path. No vault download, no DiffModal, no item changes applied. The silent-pull path (lines 3296–3361) still pulls image vault (3302–3336) and attachment vault (3346–3352) — see "Partial-sync illusion" note below. |
| `js/cloud-sync.js:3596–3611` | Manifest conflict detection | Checks `mc.type === "edit"`. Misses `"item-edit"` entries; conflict detection on manifest path never fires. |
| `js/cloud-sync.js:3710–3741` | Vault-first fallback — `DiffEngine.compareItems()` | Compares actual item arrays; not affected by the type mismatch. Triggers only when manifest diff is incomplete (count guard at line 3374). Edits-only syncs never trip the count guard (no add/delete changes item count), so they take the broken manifest path exclusively. |
| `js/diff-engine.js:32–89` | `DIFF_FIELDS` array | Canonical 44-field list for sync-relevant item data. AC-5 requires the ZIP JSON allowlist to cover this list. |
| `js/inventory-backup.js:22–61` | ZIP JSON `inventory_data` field map | 31 of 44 DIFF_FIELDS present. 13 fields absent (see gap analysis below). |
| `js/inventory-backup.js:131–224` | ZIP CSV export | Headers include `Obverse Image URL`, `Reverse Image URL` but not frame-shape columns (`Obverse Frame`, `Reverse Frame`). |
| `js/inventory-import.js:1062–1166` | Standalone CSV export (`buildCsvContent` / `exportCsv`) | Same frame-column gap as ZIP CSV. Both exports share identical header structure for image data but omit the frame-shape columns. |
| `js/events.js:1584–1629` | Item save path (form → item object) | Authoritative list of currently written item fields. `obverseImageFrame` and `reverseImageFrame` are written here (lines 1617–1618) but absent from the ZIP JSON. `purchasePrice` and `retailPrice` are **not** written here — they exist in DIFF_FIELDS but are not stored as direct item properties via the form. |

## Type Mismatch — Cascade Map

The bug is a single namespace split between the producer (`changeLog.js`) and all consumers (`cloud-sync.js`):

```
changeLog.js (producer)       cloud-sync.js (all consumers)
────────────────────────       ─────────────────────────────
"item-add"    ──╳──►  "add"   (buildAndUploadManifest summary, _buildDiffFromManifest)
"item-edit"   ──╳──►  "edit"  (buildAndUploadManifest summary, _buildDiffFromManifest, conflict detection)
"item-delete" ──╳──►  "delete"(buildAndUploadManifest summary, _buildDiffFromManifest)
"setting"     ──✓──►  "setting" (summary counting — this one matches; settings sync is unaffected)
```

**`_deferredVaultRestore` is NOT a 5th consumer site.** It receives `selectedChanges` from `DiffModal._buildSelectedChanges()`, which hardcodes its own type vocabulary (`"add"`, `"modify"`, `"delete"`) at `diff-modal.js:2778,2818,2866` — independently of the manifest changeLog strings. `DiffEngine.applySelectedChanges()` switches on the same vocabulary at `diff-engine.js:624–643`. Line 3026's `change.type !== "add"` check is correct and must not be changed. (Verified by code inspection; CODEX, GEMINI, and OPUS consensus.)

**Why items-only edits are the worst case:** adds and deletes do change the item count, so they *sometimes* trip the count guard at line 3374 (`_mExpectedAfterApply !== _mRemoteCount`) and fall through to vault-first. Pure edits (`"item-edit"` only) never change count → count guard passes → silent pull fires → all field edits silently discarded.

**Partial-sync illusion:** during the silent-pull path (lines 3296–3361), image vault (3302–3336) and attachment vault (3346–3352) still sync. A user who edits a field AND uploads a new photo on Device A sees the photo appear on Device B but NOT the field edit — an illusion that sync succeeded. This known pre-fix behavior should be verified as eliminated after the fix lands.

**`changesByKey` type-first-wins:** `buildAndUploadManifest()` (lines 1052–1058) stores only the first changeLog entry's type when multiple entries exist for the same item key in a sync window. Post-fix normalization is correct for most combinations (add+edit → `"item-add"` is correct), but edit+delete is wrong — the type is stored as `"item-edit"` and the delete signal is lost. The fix includes a type-priority merge rule (add > edit > delete) to address this. See Constraint 5.

**Affected consumers (4 sites in cloud-sync.js):**
1. `buildAndUploadManifest()` summary, line 1070–1082 — wrong type strings, summary always 0
2. `_buildDiffFromManifest()`, lines 2933, 2935, 2949 — wrong type strings, all arrays empty
3. `_mNoChanges` guard, lines 3288–3295 — evaluates those empty arrays, fires silent pull
4. Conflict detection, line 3601 — misses `"item-edit"` entries, no manifest-path conflicts detected

## ZIP JSON Field Gap Analysis

Comparing `inventory_data` allowlist in `js/inventory-backup.js:22–61` against `DIFF_FIELDS` in `js/diff-engine.js:32–89`:

**Present in ZIP JSON** (31 fields): name, metal, composition, weight, weightUnit, purity, qty, type, date, year, price, marketValue, purchaseLocation, spotPriceAtPurchase, premiumPerOz, totalPremium, storageLocation, notes, grade, gradingAuthority, certNumber, serialNumber, pcgsNumber, pcgsVerified, numistaId, obverseImageUrl, reverseImageUrl, obverseSharedImageId, reverseSharedImageId, disposition, paymentMethod (conditional)

**Missing from ZIP JSON** (13 fields):

| Field | Category | Stored on items? |
|-------|----------|-----------------|
| `purchasePrice` | Financials | Two write paths: CSV import (`inventory-import.js:854`) actively writes it; form save path (`events.js:1584–1629`) does not. Items created via CSV import carry this field; form-created items don't. |
| `retailPrice` | Financials | No confirmed active write path; likely legacy |
| `collectable` | Catalog | No confirmed active write path in events.js; likely set elsewhere |
| `ignorePatternImages` | Images | Written at events.js:1621 — stored, but absent from ZIP JSON |
| `currency` | Financials | Written at events.js:1616 — stored, but absent from ZIP JSON |
| `obverseImageFrame` | Images | Written at events.js:1617 — stored, but absent from ZIP JSON |
| `reverseImageFrame` | Images | Written at events.js:1618 — stored, but absent from ZIP JSON |
| `lastModified` | Metadata | Active modern field — set at `events.js:1811` (edits) and `events.js:1962` (new items) on every add and edit. |
| `capsule` | Storage | Written at events.js:1595 — stored, but absent from ZIP JSON |
| `capsuleNotes` | Storage | Written at events.js:1596 — stored, but absent from ZIP JSON |
| `numistaData` | Catalog | Written at events.js:1624 — stored (nested object), but absent from ZIP JSON |
| `fieldMeta` | Metadata | Active modern field — set at `events.js:1809` (edits) and `events.js:1960` (new items) on every add and edit. |
| `attachments` | Attachments | Tested in `backup-zip.spec.js:60–80` via a mock — but that test does NOT call `createBackupZip()`; it manually serializes a raw item object. The real ZIP JSON allowlist omits attachments. |

**Key note on `purchasePrice` / `retailPrice`:** `purchasePrice` has an active import-origin path (CSV import at `inventory-import.js:854`) and may also exist on legacy items. `retailPrice` has no confirmed write path and is likely legacy. Both must be included in the ZIP JSON allowlist (per AC-5) — `JSON.stringify` omits `undefined` values, so fields absent on modern items produce no noise.

## CSV Frame Column Gap

Both CSV exports are missing image frame columns required by AC-6:

| Export | File | Currently exports | Missing |
|--------|------|-------------------|---------|
| ZIP CSV | `js/inventory-backup.js:132–165` | `Obverse Image URL`, `Reverse Image URL` | `Obverse Frame`, `Reverse Frame` |
| Standalone CSV | `js/inventory-import.js:1064–1102` | `Obverse Image URL`, `Reverse Image URL` | `Obverse Frame`, `Reverse Frame` |

Note: `inventory-backup.js:131` has a comment claiming the two CSVs are "synced with exportCsv()" — but this is aspirational, not actual. The two CSVs already diverge by 6 columns: standalone CSV has `removedTags` and 5 disposition sub-fields (`recipient`, `notes`, `currency`, `disposedAt`, `splitFromUuid`) that ZIP CSV lacks; ZIP CSV has `Attachments` that standalone lacks. This sketch adds frame columns to both (AC-6 minimum) without attempting full parity. Full CSV parity is a candidate for a follow-up issue.

## Test Coverage Gaps

No existing tests cover the type mismatch or ZIP JSON field completeness:

- **`_buildDiffFromManifest()`** — zero direct tests. The manifest-first pull path is exercised only indirectly through high-level Playwright tests that mock the Dropbox API.
- **`buildAndUploadManifest()` summary counting** — zero tests.
- **Manifest conflict detection (`mc.type === "edit"`)** — zero tests.
- **ZIP JSON field completeness against DIFF_FIELDS** — `tests/playwright/attachments/backup-zip.spec.js:60–80` tests that an item with attachments round-trips through a *manually serialized* object, not through the real `createBackupZip()` call. The 13 missing fields are untested.
- **CSV frame columns** — `tests/playwright/image-frame-override.spec.js` tests display behavior; does not verify CSV output columns.

Existing related tests to preserve (AC-7):
- `tests/playwright/attachments/cloud-sync.spec.js` — DIFF_FIELDS and DiffEngine integration, attachment storage keys
- `tests/playwright/cloud-sync-header-button.spec.js` — STAK-549 syncNow return contract

## Prior Decisions

- **Consumer-side normalization (requirements.md, resolved OQ-1):** Type names in the changeLog must not change. All fixes normalize on the read/consumer side. This decision is locked — confirmed as a non-goal.
- **DIFF_FIELDS as canonical (requirements.md AC-5):** Any field in `DIFF_FIELDS` must survive backup/restore. This includes fields that may be `undefined` on modern items (legacy fields).
- **No prior sessions** specifically documenting the type naming scheme — the mismatch was introduced when the producer was renamed from short types to prefixed types (likely during changeLog redesign), without updating the consumers.
- **Cloud Sync Patterns doc** moved to `coding-standards` skill (2026-04-25 session) — not directly relevant to this fix.

## External References

- No external libraries involved — all logic is vanilla JS within the project.
- The `"item-add"` / `"item-edit"` / `"item-delete"` naming mirrors the ChangeLog UI display convention (the change log tab renders these types visually with icons); that naming must be preserved.

## Constraints

1. **Producer type names are frozen:** `changeLog.js` writes `"item-add"`, `"item-edit"`, `"item-delete"`. Every consumer fix must normalize on the read side.
2. **Four consumer sites must all be updated** or the fix is partial: summary counting (line 1070–1082), diff classification (lines 2933/2935/2949), silent-pull gate (implicit via #2), and conflict detection (line 3601).
3. **ZIP JSON allowlist alignment** must include every DIFF_FIELDS entry while preserving existing identity fields (`uuid`, `serial`, which are intentionally excluded from DIFF_FIELDS at `diff-engine.js:11–15` but already exported by `createBackupZip()`). `fieldMeta` and `lastModified` are active modern fields (set on every add and edit at `events.js:1809–1811, 1960–1962`) — they carry real data and must be preserved. Only `retailPrice` and `collectable` have no confirmed active write path; fields absent on modern items will silently omit via `undefined` in `JSON.stringify`, which is acceptable.
4. **CSV scope — frame columns only:** This sketch adds `Obverse Frame` and `Reverse Frame` columns to both CSV exports (AC-6 minimum). The `inventory-backup.js:131` parity comment is aspirational; the two CSVs already diverge by 6 columns. No attempt is made to reconcile that divergence here — file a follow-up issue for full CSV parity.
5. **`changesByKey` type-priority merge:** `buildAndUploadManifest()` currently uses first-wins type assignment when multiple changeLog entries exist for the same item key in a sync window. This must be updated to apply a priority merge: `"item-add"` > `"item-edit"` > `"item-delete"`. Ensures edit+delete → `"item-delete"` (previously the delete signal was lost).
6. **Vault-first fallback (AC-7):** `DiffEngine.compareItems()` at line 3710 must remain untouched — it already works correctly.
7. **TDD required:** Tests must be written before implementation (RED phase first). The four consumer functions in cloud-sync.js and the ZIP JSON/CSV field gap all need Playwright test coverage.

**Assumption for approach phase:** grep confirmed no files outside `changeLog.js` emit or pattern-match on the literal strings `"item-add"` / `"item-edit"` / `"item-delete"`. No regex or `startsWith`-style consumers were found. The approach should state this explicitly as a testing invariant and consider whether an exhaustive-match pattern would make future additions safer.

## Open Questions

_(None — all open questions from requirements.md were resolved before this phase.)_

## Discovery Summary

The bug is a single type namespace split — `changeLog.js` emits `"item-add"` / `"item-edit"` / `"item-delete"` while every consumer in `cloud-sync.js` checks for the unprefixed `"add"` / `"edit"` / `"delete"`. This causes all item changes to fall through every consumer match, producing empty diff arrays that trigger the silent-pull path — silently discarding all item field edits on Device B while still syncing image and attachment vaults (a partial-sync illusion). The fix requires updating 4 consumer sites in `cloud-sync.js` plus a type-priority merge in `buildAndUploadManifest()` for the edit+delete edge case, without touching the producer. Separately, 13 DIFF_FIELDS are absent from the ZIP JSON allowlist and both CSV exports lack image frame columns — straightforward additions once the canonical field list is the guide.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-101`.

---

## Review Archive — discovery (2026-05-23)

_Reconciled by /sketch reconcile on 2026-05-23. Original reviewer marks preserved below for audit._

### OpenCode

#### Verified

- **Producer type strings** (`js/changeLog.js:155`): Confirmed `"item-add"`, `"item-edit"`, `"item-delete"`. Only producer in the codebase (grep confirmed no other file emits these strings).
- **Consumer 1** (`js/cloud-sync.js:1070–1082`): Confirmed `entryType === "add"` / `"edit"` / `"delete"` — unprefixed.
- **Consumer 2** (`js/cloud-sync.js:2933/2935/2949`): Confirmed `change.type === "add"` / `"edit"` / `"delete"` — unprefixed.
- **Consumer 3** (`js/cloud-sync.js:3287–3290`): Confirmed `_mNoChanges` evaluates empty arrays from `_buildDiffFromManifest`.
- **Consumer 4** (`js/cloud-sync.js:3601`): Confirmed `mc.type === "edit"` — unprefixed.
- **Count guard** (`js/cloud-sync.js:3370–3388`): Confirmed `_mExpectedAfterApply = _mLocalCount + manifestDiff.added.length - manifestDiff.deleted.length`. Since both arrays are always empty, the check passes when local and remote item counts match.
- **Vault-first fallback** (`js/cloud-sync.js:3710–3712`): Confirmed `DiffEngine.compareItems(localItems, remoteItems)` is correct and unaffected.
- **DIFF_FIELDS** (`js/diff-engine.js:32–89`): Counted 44 entries. Match confirmed.
- **ZIP JSON field map** (`js/inventory-backup.js:26–60`): Counted 31 DIFF_FIELDS present, 13 missing. The 13-field gap list is accurate.
- **CSV frame column gap** (`js/inventory-backup.js:132–165`, `js/inventory-import.js:1064–1102`): Both exports have `Obverse Image URL` / `Reverse Image URL` but no `Obverse Frame` / `Reverse Frame`. The parity contract comment at `inventory-backup.js:131` is confirmed.
- **Form save path** (`js/events.js:1584–1629`): Confirmed `obverseImageFrame`, `reverseImageFrame`, `ignorePatternImages`, `currency`, `capsule`, `capsuleNotes`, `numistaData` are all written in `buildItemFields()`. Confirmed `purchasePrice` and `retailPrice` are NOT written there.
- **Test coverage gaps**: Confirmed zero grep matches for `_buildDiffFromManifest`, `buildAndUploadManifest`, `mc.type` in `tests/`. Backup zip test at `tests/playwright/attachments/backup-zip.spec.js:60–88` manually serializes; does not call `createBackupZip()`.
- **No other type consumers**: Grep for `"item-add"` / `"item-edit"` / `"item-delete"` across `js/` and `tests/` returned only `changeLog.js` lines. No missed producer or test references.

#### Top Concerns

1. **Missing 5th consumer site**: `_deferredVaultRestore` at `js/cloud-sync.js:3026` checks `change.type !== "add"` (unprefixed). Currently unreachable due to the silent-pull gate, but once sites 1–3 are fixed, this code path activates. Missing this fix would cause stub items for additions to remain unresolved, leading to data corruption via `DiffEngine.applySelectedChanges`. The cascade map acknowledges it but the "4 sites" count is wrong.

2. **`purchasePrice` has two origin paths**: The discovery says it's "not found in item save path" (true for the form), but it IS stored during CSV import at `js/inventory-import.js:854`. Items created via import carry `purchasePrice`; form-created items don't. The ZIP JSON gap analysis treats it uniformly as "may be legacy" — the approach should account for both creation paths.

3. **`lastModified` and `fieldMeta` locations understated**: Both fields ARE set in the item save path at `js/events.js:1804–1811` (edits) and `js/events.js:1950–1962` (new items), just outside the `buildItemFields()` range (1584–1629). The discovery describes them as "not found in item save path directly" — misleading for the approach phase, which might mistakenly think these fields are dead or need new write paths.

#### Unverified Assumptions

- **`type` field in manifest changes tracks producer strings directly**: The discovery assumes `entry.type` at `cloud-sync.js:1056` arrives verbatim from `changeLog.js` entries without any normalization. Confirmed by code inspection — `entries` comes from the changeLog array, and `entry.type` is the original producer value. However, the discovery does not surface whether any intermediate function mutates `type`.
- **No other consumers exist outside `cloud-sync.js`**: Grep confirmed `"item-add"` / `"item-edit"` / `"item-delete"` only appear in `changeLog.js`. Grep for `"add"` / `"edit"` / `"delete"` matching change type patterns only returned `cloud-sync.js` lines. But the grep was for exact string matches with type comparison syntax — a consumer using a different pattern (e.g., `switch(entry.type)` or `if (/^item-/.test(type))`) would be missed. The approach should state this assumption explicitly.
- **The silent-pull path is truly silent for all item fields**: Confirmed for the items path. But the silent-pull path at lines 3296–3361 also pulls the image vault (lines 3302–3336) and attachment vault (lines 3346–3352). An image or attachment change on Device A, paired with an `"item-edit"` change, would trigger the silent-pull which silently applies the image/attachment vault but discards the item field edit. This means a user who updates an item photo AND a field on Device A would see the photo sync to Device B but NOT the field change — a subtle and confusing partial sync. Worth noting as a known behavior for the requirements.
- **`"add"` and `"delete"` types never appear in the manifest from any source**: The discovery assumes all manifest entries come from the changeLog. Verified that `buildAndUploadManifest()` only reads from the stored changeLog array. No other source injects `"add"` / `"edit"` / `"delete"` entries into a manifest. However, the manifest format is also used by the API (StakTrakrApi) — if the API-side merger ever uses these type strings differently, assumptions break. The discovery doesn't mention the API manifest path at all.
- **CSV parity contract is comprehensive**: The comment at `inventory-backup.js:131` says "synced with exportCsv()" — but the two CSVs already diverge: standalone CSV has extra disposition columns (`recipient`, `notes`, `currency`, `disposedAt`, `splitFromUuid`) and a `removedTags` column that the ZIP CSV lacks. Adding only frame columns keeps them divergent. Is full parity a real requirement or a soft guideline?

### Gemini

#### Verified

- **Producer and consumer type mismatch**: Verified that `js/changeLog.js:155` writes `"item-add"`, `"item-edit"`, and `"item-delete"`, while the consumers in `js/cloud-sync.js` (`buildAndUploadManifest` summary count at lines 1070–1082, `_buildDiffFromManifest` diff classification at lines 2933/2935/2949, and conflict detection at line 3601) check for unprefixed `"add"`, `"edit"`, and `"delete"`.
- **Silent-pull path**: Verified that `_buildDiffFromManifest` returning empty arrays causes `_mNoChanges` to evaluate to `true` (lines 3288–3290), triggering the silent pull path (lines 3295-3361) and dropping all item field changes.
- **ZIP JSON Field Gap**: Verified that 13 fields present in the canonical `DIFF_FIELDS` array in `js/diff-engine.js:32–89` (such as `obverseImageFrame`, `reverseImageFrame`, `capsule`, `capsuleNotes`, `currency`, `lastModified`, `numistaData`, `fieldMeta`, `attachments`) are omitted from `createBackupZip` in `js/inventory-backup.js:26–60`.
- **CSV Image Frame Columns**: Verified that both `inventory_export.csv` (`js/inventory-backup.js:132–165`) and standalone CSV (`js/inventory-import.js:1064–1102`) omit columns for `Obverse Frame` and `Reverse Frame`.
- **Item properties check**: Verified that `events.js:1584–1629` and surrounding lines write these fields onto the inventory items (except `purchasePrice` and `retailPrice`, which are legacy/import fields).

#### Top Concerns

1. **Unwarranted change to `_deferredVaultRestore`**: The previous `OPENCODE` review suggests that `js/cloud-sync.js:3026` (`if (change.type !== "add") continue;`) is broken because of the unprefixed `"add"`. However, code inspection shows that `DiffModal._buildSelectedChanges()` hardcodes the types of its output changes to `"add"`, `"delete"`, and `"modify"`. Therefore, `selectedChanges` passed to `_deferredVaultRestore` will have `type: "add"`, and the check `change.type !== "add"` is correct. Changing it to check for `"item-add"` would break stub resolution.
2. **Verification of `purchasePrice` and `retailPrice` origins**: Verified that `purchasePrice` is populated during Numista CSV import (`js/inventory-import.js:854`) but not in the standard form save path (`events.js:1584–1629`). `retailPrice` is not populated by the form either. The approach must ensure these fields are preserved in the JSON allowlist to protect imported or legacy data.
3. **`lastModified` and `fieldMeta` write locations**: Clarified that `lastModified` and `fieldMeta` are set during item commits in `events.js` (lines 1809–1811 for edits and 1960–1962 for adds), so they are active properties on items in memory and in `localStorage`.

#### Unverified Assumptions

- **Direct match of changeLog types**: We assume no intermediate function mutates changeLog types before they reach `buildAndUploadManifest` or `_buildDiffFromManifest`. Code inspection of `changeLog` retrieval confirms this.
- **No other type consumers**: We assume no other consumers in the codebase check for unprefixed `"add"`, `"edit"`, or `"delete"` under other formats (e.g. regexes or switches).
- **Parity is limited to frame columns**: We assume we do not need to bring the two CSV exports into full parity for other diverging fields (like disposition details or removed tags) under this sketch.

### Codex

#### Verified

- Verified the producer emits prefixed item types in `js/changeLog.js:152-172`, and `getManifestEntries()` passes `entry.type` through unchanged at `js/changeLog.js:788-804`.
- Verified manifest summary counting still checks short types in `js/cloud-sync.js:1043-1082`, `_buildDiffFromManifest()` checks short types in `js/cloud-sync.js:2925-2959`, the empty diff triggers the silent-pull path in `js/cloud-sync.js:3285-3361`, and manifest conflict detection still checks `mc.type === "edit"` in `js/cloud-sync.js:3596-3611`.
- Verified `_deferredVaultRestore()` receives DiffModal selected-change types, not raw manifest types: `js/diff-modal.js:2763-2867` emits `"add"`, `"modify"`, and `"delete"`, and `js/diff-engine.js:597-643` consumes those selected-change types.
- Verified ZIP JSON currently exports a hand-maintained inventory map in `js/inventory-backup.js:22-62`, including `serial`/`uuid` but missing several `DIFF_FIELDS` entries from `js/diff-engine.js:32-89`.
- Verified ZIP CSV and standalone CSV both include obverse/reverse image URL columns but no frame columns in `js/inventory-backup.js:131-224` and `js/inventory-import.js:1062-1166`.

#### Top concerns

1. The discovery should remove `_deferredVaultRestore` from the type-mismatch cascade; changing its `change.type !== "add"` guard would conflict with the selected-change contract from `DiffModal` and `DiffEngine`.
2. The ZIP JSON rule should be "include all `DIFF_FIELDS` entries while preserving existing identity/export fields," not "match `DIFF_FIELDS` exactly," because `uuid` and `serial` are intentionally outside `DIFF_FIELDS` but are already exported.
3. The field-origin notes still understate modern write paths: `purchasePrice` is written by Numista CSV import, and `fieldMeta`/`lastModified` are active add/edit item properties.

#### Unverified assumptions

- The implementation will normalize manifest/changeLog type names before constructing the DiffModal diff, but will leave DiffModal selected-change types unchanged.
- ZIP restore should preserve existing identity fields (`uuid`, `serial`) even though AC-5 names `DIFF_FIELDS` as the canonical sync-relevant list.
- Adding only `Obverse Frame` and `Reverse Frame` is the intended CSV scope; the existing ZIP CSV and standalone CSV exports already diverge on other columns such as removed tags and disposition details.
- A future approach can safely choose a shared normalization helper or local per-consumer normalization; discovery proves the mismatches but does not yet choose the abstraction.

### Opus

#### Verified

- **Producer types** (`js/changeLog.js:155`): Confirmed ternary emits `"item-add"`, `"item-edit"`, `"item-delete"`. No intermediate normalization — `getManifestEntries()` at lines 788–804 passes `entry.type` through verbatim via `.map()`.
- **Consumer 1 — summary counting** (`js/cloud-sync.js:1069–1082`): Confirmed `entryType === "add"` / `"edit"` / `"delete"` — never matches `"item-add"` etc. Summary always `{itemsAdded:0, itemsEdited:0, itemsDeleted:0}`.
- **Consumer 2 — diff classification** (`js/cloud-sync.js:2933,2935,2949`): Confirmed `change.type === "add"` / `"edit"` / `"delete"`. Returns `{added:[], modified:[], deleted:[], unchanged:[]}` for all item changes.
- **Consumer 3 — `_mNoChanges` guard** (`js/cloud-sync.js:3287–3290`): Confirmed evaluates empty arrays → `true`. Combined with `_mNoSettingsChanges`, fires silent-pull at line 3295.
- **Consumer 4 — conflict detection** (`js/cloud-sync.js:3601`): Confirmed `mc.type === "edit"` — never matches `"item-edit"`, so `mRemoteChanges` is always empty, and `detectConflicts` never fires on the manifest path.
- **Count guard** (`js/cloud-sync.js:3374`): Formula `_mLocalCount + manifestDiff.added.length - manifestDiff.deleted.length` — with empty arrays, reduces to `_mLocalCount !== _mRemoteCount`. Only trips when device counts differ independently of the diff, not because the diff detected changes.
- **`_deferredVaultRestore` is NOT affected** (`js/cloud-sync.js:3026`): `DiffModal._buildSelectedChanges()` hardcodes output types at `diff-modal.js:2778` (`"add"`), `2818` (`"modify"`), `2866` (`"delete"`). These are re-emitted types, not passthrough from manifest. `DiffEngine.applySelectedChanges()` switches on the same vocabulary at `diff-engine.js:624–643`. Line 3026's `change.type !== "add"` is correct and must not be changed. **GEMINI and CODEX are right; OPENCODE's 5th-site concern is a false alarm.**
- **DIFF_FIELDS count** (`js/diff-engine.js:32–89`): Counted 44 entries. Confirmed.
- **ZIP JSON allowlist** (`js/inventory-backup.js:26–60`): 31 DIFF_FIELDS mapped, plus `serial` and `uuid` (identity fields excluded from DIFF_FIELDS by design at `diff-engine.js:11–15`). 13-field gap confirmed.
- **ZIP CSV vs standalone CSV divergence**: ZIP CSV has 32 headers ending with `"Attachments"` (`inventory-backup.js:132–165`). Standalone CSV has 37 headers with `removedTags` and 5 extra disposition sub-fields but no `Attachments` (`inventory-import.js:1064–1102`). The "synced with exportCsv()" comment at line 131 is aspirational, not actual. Neither has frame columns.
- **`purchasePrice` live import path** (`js/inventory-import.js:853–854`): Confirmed both `price: purchasePrice` and `purchasePrice` are set during CSV import. Not legacy-only.
- **`fieldMeta` and `lastModified` are active fields**: Set at `events.js:1809,1811` (edits) and `events.js:1960,1962` (new items). These are modern, actively written fields — not legacy.
- **No other type consumers exist in `js/`**: Grep for `"item-add"`, `"item-edit"`, `"item-delete"` returned zero matches outside `changeLog.js`.
- **Silent-pull still pulls images/attachments** (`js/cloud-sync.js:3302–3352`): Image vault pull at lines 3302–3336 and attachment vault pull at lines 3346–3352 both execute inside the silent-pull path. Item field changes are discarded, but binary vault changes sync. This creates a partial-sync outcome.
- **`changesByKey` type-first-wins** (`js/cloud-sync.js:1052–1058`): When multiple changeLog entries exist for the same `itemKey`, only the first entry's type is stored on the grouped manifest change. Later entries (e.g., an edit after an add) don't update the type. Pre-existing behavior unrelated to the bug, but post-fix normalization should account for this.

#### Top Concerns

1. **Constraint 3 mischaracterizes 5 of the 13 "missing" fields.** The discovery groups `purchasePrice`, `fieldMeta`, and `lastModified` with "fields not stored on modern items" — this is factually incorrect. `purchasePrice` is written by CSV import (`inventory-import.js:854`); `fieldMeta` and `lastModified` are set on every add and edit (`events.js:1809–1811, 1960–1962`). Only `retailPrice` and `collectable` have no confirmed active write path. The approach must not treat these fields as dead — they carry real data on real items.

2. **The CSV "parity contract" is already broken — scope must be decided.** The `inventory-backup.js:131` comment claims sync with `exportCsv()`, but the two CSVs already diverge by 6 columns (standalone has `removedTags` + 5 disposition sub-fields; ZIP has `Attachments`). If the approach takes the comment literally and attempts full parity, that's significant scope creep. I recommend: add frame columns to both (AC-6), acknowledge the existing divergence in a comment, and file a separate issue for full CSV parity if desired.

3. **Silent-pull partial-sync is a confusing user experience.** When the type mismatch fires the silent-pull path, image and attachment vaults still sync (lines 3302–3352). A user who edits an item's grade AND uploads a new photo on Device A will see the photo appear on Device B but not the grade change. This is arguably worse than total silence because it creates an illusion that sync worked. The approach phase should note this as a known pre-fix behavior and verify the fix eliminates it.

#### Unverified Assumptions

- **No consumers use pattern-matching on type strings.** The grep confirmed no files outside `changeLog.js` contain the literal strings `"item-add"` etc. But a consumer using regex (`/^item-/`) or `startsWith("item-")` would be missed. No such pattern was found, but the approach should state this assumption explicitly as a testing invariant.
- **The `changesByKey` type-first-wins behavior is intentional.** When an item is added then edited in the same sync window, the manifest records it as type `"item-add"` with edit fields appended. Post-normalization, `_buildDiffFromManifest` will classify this as an `"add"` — which is correct (it IS a new item). But if an item is edited then deleted, it becomes type `"item-edit"` with no delete signal — the delete is lost. This is pre-existing behavior, not introduced by this fix, but the approach should decide whether to address it or explicitly scope it out.
- **The manifest format is not consumed by StakTrakrApi.** The discovery doesn't mention whether the API endpoint reads or writes manifests with type strings. If the API round-trips manifest JSON (e.g., for multi-device relay), changing the consumer normalization without API awareness could introduce a new mismatch. Worth a quick check of the API repo in the approach phase.
- **`JSON.stringify` omission of `undefined` is sufficient for missing fields.** The discovery claims fields like `retailPrice` will silently omit from JSON output. This is correct for `undefined`, but if any field is explicitly set to `null` (e.g., `disposition: null` at `inventory-backup.js:59`), it WILL appear in JSON. The approach should decide whether `null` values in the 13 new fields are acceptable in backup JSON or should be filtered.

### Resolution Summary

- Accepted: 8
- Rejected: 0 (OPENCODE's 5th-site concern overruled 3:1 — code-verified)
- Resolved with your input: 1 (changesByKey type-first-wins → scoped in, type-priority merge rule added as Constraint 5)

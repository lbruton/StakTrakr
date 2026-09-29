---
sketch: "STRK-101-manifest-type-mismatch"
phase: approach
created: 2026-05-23
---

# STRK-101 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

The fix has three independent tracks that share no implementation code:

**Track 1 — Type mismatch repair (`js/cloud-sync.js`):** Add a single private helper `_normalizeItemChangeType(type)` that strips the `"item-"` prefix when present, otherwise returns the type unchanged. The helper must guard against `null`/`undefined` inputs (use `String.prototype.startsWith` or `/^item-/` regex, not a naive `.replace`) and must pass the `"setting"` type through unmodified. Apply the **hybrid normalization strategy**: (a) normalize at write — apply at the `changesByKey[key].type` assignment (~line 1056) so manifests written to Dropbox carry clean unprefixed types; (b) normalize at read — apply at all three consumer sites (`buildAndUploadManifest()` summary counting, `_buildDiffFromManifest()` diff classification, conflict detection) for backward compatibility with older prefixed manifests already stored in Dropbox. The `_mNoChanges` guard (Consumer 3 in discovery) is fixed implicitly — it evaluates the arrays returned by `_buildDiffFromManifest()`, so fixing that function is sufficient. `buildAndUploadManifest()` also gets a type-priority merge rule with priority **`delete > add > edit`** (merge operates on raw prefixed types before normalization, since it runs during manifest build): edit+delete → delete ✓, add+edit → add ✓, add+delete → delete (safe no-op on pull — item never existed in Dropbox) ✓, delete+add → add ✓.

**Track 2 — ZIP JSON field completeness (`js/inventory-backup.js`):** The `inventory_data` field allowlist in `createBackupZip()` is extended to cover the 13 DIFF_FIELDS entries it currently omits. Fields are added statically to the allowlist with a comment referencing `js/diff-engine.js:DIFF_FIELDS` as the canonical source. All 13 new fields follow the unconditional-default pattern dominant in the existing allowlist — not the conditional-spread pattern of `paymentMethod` (the intentional exception). Specific defaults: arrays → `|| []` (e.g., `item.attachments || []`), objects → `|| null` (e.g., `item.numistaData || null`, `item.fieldMeta || null`), scalars → `|| ""` / `|| 0` / `|| false` as type-appropriate. Because `JSON.stringify` silently omits `undefined` values, adding fields that are absent on modern items produces no noise in backup JSON. Note: `retailPrice` in DIFF_FIELDS is the rarely-set item-level field (`item.retailPrice`) — distinct from the ZIP CSV "Retail Price" column which maps to `item.marketValue`. A clarifying comment is added in the allowlist to prevent future confusion. The existing identity fields (`uuid`, `serial`) remain in the allowlist even though intentionally excluded from DIFF_FIELDS.

**Track 3 — CSV frame columns (`js/inventory-backup.js`, `js/inventory-import.js`):** Both the ZIP CSV export and the standalone CSV export receive two new columns — `Obverse Frame` and `Reverse Frame` — inserted immediately after the existing `Obverse Image URL` / `Reverse Image URL` columns. The value is read from `item.obverseImageFrame` / `item.reverseImageFrame`, defaulting to empty string when absent. The two CSVs already diverge on 6 other columns (standalone has `removedTags` + 5 disposition sub-fields; ZIP has `Attachments`); this sketch does not attempt full parity — that is a follow-up concern.

The `_deferredVaultRestore` path in `cloud-sync.js` (line 3026) is NOT modified. It receives `selectedChanges` from `DiffModal._buildSelectedChanges()` which independently hardcodes the types `"add"`, `"modify"`, `"delete"` — a separate vocabulary from the manifest changeLog strings. Changing that guard would break stub resolution. (3-reviewer consensus: GEMINI, CODEX, and OPUS all verified this.)

StakTrakrApi does not consume the Dropbox manifest — it serves the spot price / retail price polling API only. Cloud sync stores manifests directly in Dropbox user storage. The type mismatch fix has no API-side footprint.

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | Private helper `_normalizeItemChangeType(type)` in `cloud-sync.js`; hybrid normalization — apply at write (line ~1056 `changesByKey[key].type`) AND at all 3 read-side consumer sites | Write-side normalization produces clean manifests for all future readers; read-side normalization handles backward compatibility with older prefixed manifests. Helper guards against `null`/`undefined` (uses `startsWith` or `/^item-/` regex); `"setting"` type passes through unchanged; single grep-able normalization point for all consumers | Adds a function to an already large file; the helper must be kept updated if the type prefix ever changes (very low risk given the producer types are frozen by non-goal) |
| D-2 | Type-priority merge in `buildAndUploadManifest()` with priority **`delete > add > edit`** (merge operates on raw prefixed types before normalization, since it runs during manifest build) | Correctly handles all compound-type cases in one sync window: edit+delete → delete (item is gone), add+edit → add (new item wins), add+delete → delete (safe no-op on pull — item never existed in Dropbox), delete+add → add (re-addition wins). Fixes the silent delete-signal loss in the edit+delete case where first-wins assignment would otherwise preserve the edit type | Slightly more complex grouping loop; the compound case (same key appearing twice in one sync window) is rare but dangerous if missed |
| D-3 | Static ZIP JSON allowlist extension with unconditional defaults (not dynamic derivation from DIFF_FIELDS at runtime); all 13 new fields use `\|\| ""` / `\|\| []` / `\|\| null` / `\|\| 0` / `\|\| false` as type-appropriate | No new coupling between `inventory-backup.js` and `diff-engine.js`; consistent with the dominant existing style; `JSON.stringify` omits undefined safely. `paymentMethod`'s conditional spread is the intentional exception. Note: `retailPrice` (DIFF_FIELDS) is the rarely-set item-level field — distinct from the ZIP CSV "Retail Price" column which maps to `item.marketValue`; a clarifying comment is added | Requires manual maintenance when DIFF_FIELDS grows; mitigated by the `// canonical source: js/diff-engine.js DIFF_FIELDS` comment |
| D-4 | Frame columns in both CSV exports, no attempt at full CSV parity | AC-6 requires both; the "synced with exportCsv()" comment at `inventory-backup.js:131` is aspirational (the two CSVs already diverge by 6 columns); attempting full parity here is scope creep | Frame-column-only addition means the two CSVs remain divergent; a follow-up issue will address full parity |
| D-5 | No CSV import-side update for frame columns | Frame CSV columns are an export-only addition in this sketch; the CSV import parser will silently ignore unknown columns (existing behavior) | An export → import round-trip will not restore frame data from the CSV; this is an intentional limitation, not a regression — frame data already survives ZIP backup/restore via JSON (AC-5) |

## File Map

### New
- `tests/playwright/cloud-sync-manifest-type.spec.js` — Playwright tests for the 3 manifest consumer sites: `_buildDiffFromManifest()` type classification, `buildAndUploadManifest()` summary counting, and manifest conflict detection. Covers AC-1 through AC-4 and all four type-priority merge cases (edit+delete, add+edit, add+delete, delete+add). **Important:** `buildAndUploadManifest()` and `_buildDiffFromManifest()` are private (not in the `window.*` export block). Tests must drive behavior through exported flows (`pushSyncVault` / `pullSyncVault`) with Dropbox mocks — not by calling private functions directly. If a deliberate test seam is needed, its design belongs in tasks.md.

- `tests/playwright/csv-frame-columns.spec.js` — Playwright tests for AC-6: verifies `Obverse Frame` and `Reverse Frame` columns appear in both ZIP CSV and standalone CSV exports with correct values. Test wording must not imply CSV round-trip losslessness — frame data is NOT preserved through CSV import (D-5); only ZIP JSON restore preserves it (AC-5).

### Modified
- `js/cloud-sync.js` — Add `_normalizeItemChangeType()` private helper; apply at write (line ~1056 `changesByKey[key].type`) for clean manifest JSON; apply at 3 read-side consumer sites (`buildAndUploadManifest()` summary counting lines ~1070–1082, `_buildDiffFromManifest()` type comparisons lines ~2933/2935/2949, conflict detection line ~3601); add type-priority merge (`delete > add > edit`, operating on raw prefixed types) to `buildAndUploadManifest()` grouping loop (~lines 1052–1058).
- `js/inventory-backup.js` — Extend `inventory_data` allowlist in `createBackupZip()` with the 13 missing DIFF_FIELDS entries (insert before closing `})` at line ~61) using unconditional defaults; add `Obverse Frame` and `Reverse Frame` columns to ZIP CSV export after `Reverse Image URL` (header ~line 159, row builder ~line 209).
- `js/inventory-import.js` — Add `Obverse Frame` and `Reverse Frame` columns to standalone CSV export (`buildCsvContent()`) after `Reverse Image URL` (header ~line 1092, row builder ~line 1149).
- `tests/playwright/attachments/backup-zip.spec.js` — Extend with a test that calls the real `createBackupZip()` (not manual serialization) and verifies all DIFF_FIELDS entries survive in the output JSON. Covers AC-5.

### Deleted
- _none_

## Data / Schema Changes

None — no schema, migration, or persisted-data changes. All changes are to runtime JS logic and test coverage. The 13 new ZIP JSON fields are already stored on items in localStorage; this sketch only adds them to the export allowlist. No new fields are introduced to the item schema.

## Testing Invariant

No business-logic code outside `_normalizeItemChangeType()` may match on the prefixed type strings `"item-add"` / `"item-edit"` / `"item-delete"`. All type-switching consumers must call `_normalizeItemChangeType()` first and switch on the returned unprefixed types. Grep confirms no other consumers of prefixed strings exist today (discovery verified, all 4 reviewers). The helper itself uses `startsWith`/regex to strip the prefix — a literal-string grep would not catch consumers using regex patterns; tests should assert at the function-output level rather than grep-time.

## Tradeoffs Surfaced for Review

1. **Static allowlist vs dynamic derivation (D-3):** The static approach is simpler and avoids coupling two files with different concerns. The risk is that DIFF_FIELDS grows after this sketch and the allowlist falls behind again. The `// canonical source:` comment is a mitigation, not a guarantee. An alternative (out-of-scope here) would be a CI lint that compares the allowlist against DIFF_FIELDS — worth filing as a follow-up.

2. **Type-priority merge scope (D-2):** The priority merge is included in Track 1 even though it's a second bug (not the silent-pull bug). Discovery Constraint 5 marked it in-scope because it affects the same function being touched and fixing the type recognition without fixing priority is an incomplete fix for the edit+delete case. If you'd prefer to defer it, it can be split out into a separate task — the main bug fix does not depend on it.

3. **ZIP JSON `attachments` field:** `attachments` is in DIFF_FIELDS but the current `backup-zip.spec.js` test only validates it via manual serialization (not through `createBackupZip()`). Adding `attachments` to the allowlist and writing a real-call test is included. This is the most risk-bearing of the 13 fields because attachments are binary-reference data (stored in a separate vault) — the JSON entry is an array of attachment metadata objects. Verify during implementation that serialization produces the expected structure.

## Out of Scope (follow-up issues)

- **Full CSV parity** — ZIP CSV and standalone CSV currently diverge by 6 columns (`removedTags`, `recipient`, `notes`, `currency`, `disposedAt`, `splitFromUuid` in standalone; `Attachments` in ZIP). Full parity requires a design decision about which export should be considered authoritative. File under STRK.
- **CSV import round-trip for frame columns** — The CSV export now includes `Obverse Frame` / `Reverse Frame`, but the import parser will ignore them (unknown columns pass through silently). To make CSV a lossless round-trip for frame data, the importer needs a separate update. File under STRK.
- **CI lint for ZIP JSON allowlist vs DIFF_FIELDS** — A static check that alerts when DIFF_FIELDS grows without a corresponding allowlist update would prevent the 13-field gap from recurring. File under STRK.
- **`retailPrice` and `collectable` active write paths** — Both fields have no confirmed current write path (likely legacy). Preserving them in the ZIP JSON allowlist is correct (import-origin or older items may carry these fields). Investigating whether they should be formally deprecated or given new write paths is a separate concern.

## Risk Notes

- **`cloud-sync.js` regression risk:** This is the largest and most complex file in the project. The write-side and read-side normalization edits are surgical, but the file has extensive Dropbox-mock Playwright tests that must continue to pass. The existing `tests/playwright/attachments/cloud-sync.spec.js` is the regression oracle for AC-7.
- **`backup-zip.spec.js` test gap:** The existing backup-zip test at lines 60–88 manually constructs a raw item object and validates serialization — it does NOT call `createBackupZip()`. The AC-5 test must call the real function; extending the existing spec to do so correctly requires understanding how the test harnesses the `file:///` page and the `localStorage` seed. Tasks.md should allocate time for this.
- **Frame column CSV import silent-ignore:** Confirmed safe — the CSV importer (`inventory-import.js`) matches columns by header name and ignores unknown ones. No risk of import corruption. But it is worth a smoke-test during implementation.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch tasks STRK-101`.

## Review Archive — approach (2026-05-23)

_Reconciled by /sketch reconcile on 2026-05-23. Original reviewer marks preserved below for audit._

### OPUS

#### Verified

- **Consumer 1 — summary counting** (`js/cloud-sync.js:1069–1082`): Confirmed `entryType === "add"` / `"edit"` / `"delete"` comparisons. The grouped type is stored at line 1056 as `type: entry.type` — raw producer type, not normalized.
- **Consumer 2 — diff classification** (`js/cloud-sync.js:2933,2935,2949`): Confirmed `change.type === "add"` / `"edit"` / `"delete"`. All three branches use strict equality against unprefixed strings.
- **Consumer 3 — `_mNoChanges` guard** (`js/cloud-sync.js:3287–3290`): Verified it evaluates the arrays from `_buildDiffFromManifest()` — no independent fix needed. Implicit fix path is sound.
- **Consumer 4 — conflict detection** (`js/cloud-sync.js:3601`): Confirmed `mc.type === "edit"`. Only fires for edit-type changes, misses `"item-edit"`.
- **`_deferredVaultRestore` exclusion** (`js/cloud-sync.js:3026`): Verified — receives `selectedChanges` from `DiffModal._buildSelectedChanges()` which independently hardcodes `"add"`, `"modify"`, `"delete"`. Correct to exclude from the fix.
- **`changesByKey` first-wins behavior** (`js/cloud-sync.js:1052–1058`): Confirmed — only the first entry's type is stored. The `if (!changesByKey[key])` guard at line 1052 means the type is set once and never updated for subsequent entries with the same key.
- **DIFF_FIELDS count**: 44 entries at `js/diff-engine.js:32–89`. Confirmed.
- **ZIP JSON allowlist gap**: 13 fields missing. Confirmed: `purchasePrice`, `retailPrice`, `collectable`, `ignorePatternImages`, `currency`, `obverseImageFrame`, `reverseImageFrame`, `lastModified`, `capsule`, `capsuleNotes`, `numistaData`, `fieldMeta`, `attachments`.
- **CSV divergence**: ZIP CSV has 32 headers (including `Attachments`); standalone CSV has 37 headers (including `removedTags` + 5 disposition sub-fields, no `Attachments`). The "6 column divergence" claim is confirmed.
- **No `"item-*"` strings in `cloud-sync.js`**: Grep returns zero matches — only `changeLog.js` contains these strings. The mismatch is fully a namespace split between producer and consumer.
- **`cloud-sync.js` file size**: 4,313 lines. Confirmed largest file in the project.
- **Frame field write paths**: `obverseImageFrame` and `reverseImageFrame` are written at `events.js:1617–1618` and used in `image-frame.js:32`. Active fields with real data.
- **`backup-zip.spec.js` test gap** (lines 60–88): Confirmed the test manually constructs a raw item object and checks serialization — does NOT call `createBackupZip()`. The 13 missing fields are untested through the real export path.

#### Top Concerns

1. **D-2 type-priority order is inverted for edit+delete.** The approach states `"item-add" > "item-edit" > "item-delete"`, meaning add always wins, then edit, then delete. For the edit+delete case, this produces `"item-edit"` — but the user deleted the item, so the correct result is `"item-delete"`. The correct priority for compound types should be `add > delete > edit`: an item created in the sync window stays as "add" (it's new), an item edited then deleted should be "delete" (it's gone), and add+delete is a no-op (item appeared and vanished before push). This is the most load-bearing finding — getting the priority wrong means the type-priority merge, which was specifically added to fix the edit+delete edge case, would itself produce the wrong answer.

2. **Normalize-at-write vs normalize-at-read ambiguity.** The approach says to apply `_normalizeItemChangeType()` at "3 consumer sites" but doesn't specify whether to also normalize the `type` stored in the grouped manifest entry at line 1056. If not normalized there, the manifest written to Dropbox carries `"item-edit"` strings. A pulling device reads these via `_buildDiffFromManifest()` which the approach DOES fix — so the pull side would work. But any future consumer reading the manifest JSON directly (e.g., a debug tool, or a new API endpoint) would encounter the prefixed types. Normalizing at line 1056 ("normalize-at-write") is cleaner and eliminates the problem at the source for the manifest payload. The approach should explicitly commit to one strategy.

3. **`attachments` allowlist serialization behavior.** The existing ZIP JSON allowlist uses explicit defaults (`|| ""`, `|| null`, `|| 0`). Bare `item.attachments` without a default will serialize as `null` for items without attachments (since `disposition` above it uses `|| null`). For consistency and to avoid `null` in the backup JSON where callers expect an array, use `item.attachments || []`. Same applies to `numistaData` and `fieldMeta` — decide on `|| null` or `|| {}` defaults.

#### OPUS — Unverified Assumptions

- **The manifest JSON structure written to Dropbox is consumed only by `_buildDiffFromManifest()` and conflict detection on pulling devices.** If any other tool or process reads the manifest JSON directly (debug UI, Dropbox audit script, StakTrakrApi relay), it would encounter the prefixed types. The approach assumes no such consumers exist, which is reasonable (StakTrakrApi does not read manifests per the approach), but worth confirming during implementation.
- **The type-priority merge handles all compound type combinations.** The approach addresses edit+delete but doesn't mention: add+edit (→ add, correct by first-wins), add+delete (item created and destroyed before push — should this emit nothing?), or delete+add (item deleted then re-added — should be add). The priority function needs to handle all 6 pair combinations, not just edit+delete.
- **`paymentMethod` is conditional in the current allowlist** (`inventory-backup.js:37`: `...(item.paymentMethod && { paymentMethod: item.paymentMethod })`). The approach mentions `paymentMethod` is already present but doesn't note the conditional spread pattern. If the 13 new fields use plain `key: item.key` syntax while existing fields use conditional spread, the backup JSON will gain new `null`/`undefined` keys that weren't there before. Decide on one pattern.
- **CSV import silently ignores unknown columns.** The approach states this for frame columns (D-5), and it's correct — `inventory-import.js` matches by header name. But if a user exports a CSV with frame columns and imports it into an older StakTrakr version (without the frame columns), the import will succeed but silently drop the frame data. This is expected behavior for forward-compatibility, but worth noting as a test case.

### GEMINI

#### Verified

- Verified that all manifest consumer sites in `cloud-sync.js` (`buildAndUploadManifest` summary count, `_buildDiffFromManifest` diff classification, and manifest conflict detection) fail to recognize the prefixed `"item-add"`, `"item-edit"`, and `"item-delete"` types.
- Verified that the silent-pull path is triggered when diff classification returns empty arrays, which leads to silent discarding of item-level changes.
- Verified that the ZIP JSON allowlist (`js/inventory-backup.js`) lacks 13 sync-relevant fields tracked by `DIFF_FIELDS` in `js/diff-engine.js`.
- Verified that ZIP CSV export (`js/inventory-backup.js`) and standalone CSV export (`js/inventory-import.js`) both lack columns for `Obverse Frame` and `Reverse Frame`.

#### Top Concerns & Alignment

1. **Type-Priority Merge Logic (D-2):**
   We align with OPUS that the proposed static priority (`add > edit > delete`) is incorrect. A simple static priority is insufficient because we must ensure that a deletion always overrides edits and additions in the same sync window. The hierarchy must be `delete` > `add` > `edit`.
   We recommend implementing a pairwise merge function `_mergeItemChangeTypes(existing, incoming)` to properly handle compound states:
   - `edit` + `delete` -> `delete` (delete wins)
   - `add` + `delete` -> `delete` (safe no-op deletion; or drop entirely)
   - `add` + `edit` -> `add` (addition wins)
   - `delete` + `add` -> `add` (re-addition wins)

2. **Hybrid Normalization Strategy (D-1):**
   To resolve the normalize-at-write vs normalize-at-read ambiguity, we recommend adopting both:
   - **Normalize-at-write:** Storing unprefixed (`"add"`, `"edit"`, `"delete"`) types in the JSON manifest written to Dropbox. This simplifies future and third-party readers.
   - **Normalize-at-read:** Handling both prefixed (`"item-*"`), and unprefixed types in the diff classifier and conflict detection. This ensures complete backward-compatibility with older manifests.

3. **ZIP JSON Allowlist Defaults (D-3):**
   To prevent `null` serialization issues in the exported ZIP JSON, we must explicitly define defaults for all 13 missing fields:
   - Arrays: `attachments: item.attachments || []`
   - Objects: `numistaData: item.numistaData || null`, `fieldMeta: item.fieldMeta || null`
   - Scalars: sensible default fallbacks (e.g. `|| ""`, `|| 0`, `|| false`, `|| null`).

4. **CSV Export Parity (D-4):**
   The CSV exports are already divergent in several other columns (disposition details, attachments). Attempting full parity here is out of scope. Adding only `Obverse Frame` and `Reverse Frame` to both exports is the correct decision. We should add a clarifying comment about this divergence in `js/inventory-backup.js` and `js/inventory-import.js`.

#### Unverified Assumptions

- We assume that standard CSV import/export functions will not raise syntax or validation errors when encountering the new `Obverse Frame` and `Reverse Frame` columns. This must be validated during manual smoke testing.

### DEEPSEEK

#### Verified

- **Consumer 1 — summary counting** (`js/cloud-sync.js:1070–1082`): Confirmed `entryType === "add"` / `"edit"` / `"delete"` — unprefixed. The grouped type at line 1056 (`type: entry.type`) stores the raw producer string without normalization.
- **Consumer 2 — diff classification** (`js/cloud-sync.js:2933,2935,2949`): Confirmed `change.type === "add"` / `"edit"` / `"delete"` — all three unprefixed branches.
- **Consumer 3 — `_mNoChanges` guard** (`js/cloud-sync.js:3287–3290`): Confirmed it evaluates the empty arrays produced by Consumer 2. Implicit fix path is sound.
- **Consumer 4 — conflict detection** (`js/cloud-sync.js:3601`): Confirmed `mc.type === "edit"` — only fires for unprefixed "edit", misses "item-edit".
- **`_deferredVaultRestore` exclusion** (`js/cloud-sync.js:3026`): Confirmed `change.type !== "add"` uses unprefixed. `DiffModal._buildSelectedChanges()` (lines 2778, 2818, 2866) hardcodes `"add"`, `"modify"`, `"delete"` — independent vocabulary. Verified with 3-reviewer consensus: correctly excluded.
- **`changesByKey` first-wins** (`js/cloud-sync.js:1052–1058`): Confirmed type is set once via `if (!changesByKey[key])` guard and never updated for subsequent entries with the same key. Edit+delete → type stays `"item-edit"`, delete lost.
- **Count guard** (`js/cloud-sync.js:3374`): Confirmed `_mExpectedAfterApply = _mLocalCount + manifestDiff.added.length - manifestDiff.deleted.length`. With empty arrays, reduces to item-count comparison — only trips on count mismatch, not on edit detection.
- **DIFF_FIELDS** (`js/diff-engine.js:32–89`): 44 entries confirmed. `paymentMethod` is at line 82 — already present in ZIP JSON allowlist (conditional spread at `js/inventory-backup.js:37`), so correctly not counted among the 13 missing.
- **ZIP JSON allowlist** (`js/inventory-backup.js:26–60`): 31 DIFF_FIELDS present (plus `serial`, `uuid`). 13 missing: `purchasePrice`, `retailPrice`, `collectable`, `ignorePatternImages`, `currency`, `obverseImageFrame`, `reverseImageFrame`, `lastModified`, `capsule`, `capsuleNotes`, `numistaData`, `fieldMeta`, `attachments`. Count confirmed.
- **ZIP CSV vs standalone CSV divergence**: ZIP CSV has 32 headers (`js/inventory-backup.js:132–165`), no `removedTags`. Standalone CSV has 37 headers (`js/inventory-import.js:1064–1102`), includes `removedTags` + 5 disposition sub-fields, no `Attachments`. Neither has frame columns. Confirmed.
- **Frame field write paths** (`js/events.js:1617–1618`): `obverseImageFrame` and `reverseImageFrame` both written. Active fields.
- **Vault-first fallback** (`js/cloud-sync.js:3710–3712`): Confirmed `DiffEngine.compareItems(localItems, remoteItems)` — unaffected.
- **`lastModified` and `fieldMeta` are active**: Set at `js/events.js:1809–1811` (edits) and `js/events.js:1960–1962` (new items). Not legacy fields.
- **`purchasePrice` import path**: Written at `js/inventory-import.js:854` during CSV import. Not legacy-only; items created via import carry this field.

#### Top Concerns

1. **D-2 priority merge is still wrong in the main text.** The approach body and D-2 table both state `"item-add" > "item-edit" > "item-delete"`. With this priority, edit+delete → `"item-edit"` (delete lost), which is the exact bug D-2 claims to fix. The correct order is **`delete > add > edit`** (GEMINI's proposal): edit+delete → delete ✓, add+edit → add ✓, add+delete → delete (safe no-op on pull) ✓, delete+add → add (re-addition) ✓. Both OPUS and GEMINI flagged this above — verify the approach text is updated before tasks are generated.

2. **Testing invariant contradicts itself post-fix.** The invariant (line 87) says no file outside `changeLog.js` may reference the prefixed type strings — but `_normalizeItemChangeType()` in `cloud-sync.js` MUST reference them to strip the prefix. Refine to: "No business-logic code outside the normalization helper may match on prefixed type strings. All type-switching consumers must call `_normalizeItemChangeType()` first."

3. **`_normalizeItemChangeType` must guard against non-string types.** `changeLog.js` emits `"setting"` for settings changes. The approach says the helper "strips the `"item-"` prefix when present, otherwise returns the type unchanged." If called with `undefined` or `null`, `undefined.replace(...)` throws. Use `String.prototype.startsWith` or a regex guard. The `"setting"` type must pass through unmodified — verify this case during implementation.

#### DEEPSEEK — Unverified Assumptions

- **The `type` field at line 1056 is normalized at write.** The approach says to apply the helper at "3 direct consumer sites" but doesn't mention normalizing `changesByKey[key].type = entry.type` (line 1056), which writes the raw producer type into the Dropbox manifest. If not fixed, the manifest JSON persists `"item-edit"` strings that any non-consumer reader (debug tool, future API endpoint) would encounter. GEMINI's hybrid strategy (normalize at write + read) resolves this cleanly.
- **ChangeLog entries are chronologically ordered.** The priority merge assumes entry order matters (first-wins then promotion). If entries within a sync window can arrive out of order, the merge semantics become unpredictable. The `changeLog` array ordering has not been verified in this review.
- **`itemKey` stability within a sync window.** For composite keys (e.g., `numistaId|name|date`), if the item name changes within the same sync window, the key could shift and the priority merge would treat the same logical item as two different keys. This is a pre-existing edge case, not introduced by this fix.
- **`retailPrice` (DIFF_FIELDS) vs "Retail Price" (CSV column) are distinct.** The CSV "Retail Price" column maps to `item.marketValue` (`js/inventory-backup.js:172–194`), while the DIFF_FIELDS entry `retailPrice` is a rarely-set legacy field. The approach is correct to add `retailPrice` to the ZIP JSON allowlist, but the naming collision warrants a clarifying comment.
- **CSV frame column insertion points are unambiguous.** For ZIP CSV: insert after `Reverse Image URL` header (line 159) and after `item.reverseImageUrl` row value (line 209). For standalone CSV: insert after `Reverse Image URL` header (line 1092) and after `i.reverseImageUrl` row value (line 1149). Both positions confirmed in code, but the approach doesn't specify which CSV's row builder has the `|| ""` default pattern — both do.
- **`attachments` serialization in ZIP JSON.** `attachments` is an array of attachment metadata objects stored on items. The approach says the allowlist entry will "just work" because `JSON.stringify` handles arrays. Verified — but the field stores attachment metadata (file names, UUIDs), not binary data. The restore path must handle this correctly; the ZIP restore is out of scope for this sketch but worth a sanity check during implementation.

### CODEX

#### Verified

- Manifest grouping currently stores the first raw change-log type at `js/cloud-sync.js:1052-1058`, summary counting compares unprefixed values at `js/cloud-sync.js:1069-1082`, and `manifestPayload.changes` is built from those grouped entries at `js/cloud-sync.js:1085-1095`.
- Manifest read-side classification and conflict detection compare unprefixed types at `js/cloud-sync.js:2933-2949` and `js/cloud-sync.js:3601`; `_mNoChanges` only observes the arrays returned by `_buildDiffFromManifest()` at `js/cloud-sync.js:3287-3290`.
- `_deferredVaultRestore()` should stay out of the manifest type fix: `DiffModal._buildSelectedChanges()` emits `"add"`, `"modify"`, and `"delete"` at `js/diff-modal.js:2778`, `js/diff-modal.js:2818`, and `js/diff-modal.js:2866`, matching the guard at `js/cloud-sync.js:3026`.
- ZIP JSON export omits the DIFF_FIELDS entries named by the approach: the allowlist ends at `js/inventory-backup.js:26-60`, while `DIFF_FIELDS` includes frame, metadata, capsule, attachment, and import-origin fields at `js/diff-engine.js:32-89`.
- Frame fields are active runtime data (`js/events.js:1617-1618`) and ZIP restore should preserve them once exported because `inventory_data.json` feeds `parsedItems` directly (`js/inventory-backup.js:389-395`) and `sanitizeImportedItem()` starts with `{ ...item }` (`js/utils.js:1374-1375`).
- Standalone CSV export currently exposes `buildCsvContent()` as `window.exportInventoryCSV` (`js/inventory-import.js:1713-1714`), while ZIP export exposes `window.createBackupZip` (`js/inventory-backup.js:889`), so CSV/ZIP export tests have reachable entry points.

#### Top concerns

1. **Tasks need an explicit write-side normalization step.** Consumer normalization is necessary, but the manifest payload is written from `changesByKey[key].type`; normalize that stored grouped type after raw-type merge so new manifests stop carrying `"item-*"` values.
2. **The cloud-sync Playwright test plan has a reachability gap.** `_buildDiffFromManifest()` and `buildAndUploadManifest()` are private, so the approach should choose behavior-level tests through exported sync flows or add a deliberate test seam.
3. **CSV frame export is intentionally lossy on import.** D-5 is accurate, but AC/test wording must not imply standalone CSV round-trip preserves frame shapes; only ZIP JSON restore does after the allowlist fix.

#### CODEX — Unverified Assumptions

- The chosen merge helper will operate on raw prefixed change-log types before write-side normalization, not on a mixed raw/normalized vocabulary.
- Dropbox mock fixtures already available in the Playwright suite are sufficient to exercise manifest upload/pull behavior without adding brittle private-function exports.
- A same-version CSV import silently dropping `Obverse Frame` / `Reverse Frame` remains acceptable product behavior once the export columns become visible to users.
- The ZIP restore diff/apply path will surface frame-field changes cleanly in DiffModal once those properties are present in `inventory_data.json`; I verified the property-preservation path, not the rendered modal row behavior.

### Resolution Summary
- Accepted: 7
- Rejected: 5 (pre-existing edge cases, implementation concerns, or informational unverified assumptions)
- Resolved with your input: 1 (D-2 add+delete compound behavior → `delete > add > edit`; add+delete → delete, safe no-op on pull)

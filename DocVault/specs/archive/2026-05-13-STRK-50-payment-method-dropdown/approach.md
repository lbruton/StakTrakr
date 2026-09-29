---
sketch: "STRK-50-payment-method-dropdown"
phase: approach
created: 2026-05-11
---

# STRK-50 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

Payment Method is a plain string property on inventory items, following the same pattern as `purchaseLocation` and `storageLocation`. A static `<select>` element is added to the edit modal HTML with a fixed 10-value enum (blank through Other). The value flows through the existing form-parse → build → commit pipeline, with explicit blank-omit handling at three sites: edit-mode spread (`events.js:1711–1712`, mirroring image-frame deletion), add-mode push (`events.js:1834–1858`), and bulk-edit direct write (`bulkEdit.js:1263–1266`). These three sites exist because each path commits items differently — edit spreads `oldItem` then mutates, add pushes a fresh built object, bulk writes enabled fields directly — so a single chokepoint isn't available without restructuring.

The feature integrates into six existing subsystems — form/persistence, clone, bulk edit, filter chips, view modal, and export/import — but introduces no new modules, no new globals, and no new storage keys. Every integration point copies a well-established pattern from `purchaseLocation` or `grade`. The only non-trivial pieces are the blank-omit contract (AC-3/AC-9) at three explicit delete sites, and a new `.grid-3` CSS class (with matching mobile collapse rule) added to support the Date/Price/PaymentMethod row layout.

A playground mockup (AC-8) must be reviewed before any HTML changes land. The mockup lives at `Playground/STRK-50-payment-method-row/` and validates the three-column Date/Price/PaymentMethod row at both desktop and mobile widths. Pass/fail is recorded in the AC-8 acceptance line during tasks.

## Key Decisions

| #   | Decision                                                                              | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Tradeoff                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-1 | Static `<select>` in HTML, not JS-built                                               | Keeps `file://` compat, no dynamic DOM construction at init, follows existing modal pattern for grade/grading authority                                                                                                                                                                                                                                                                                                                                             | Enum changes require HTML edit (acceptable — enum is stable)                                                                                                                   |
| D-2 | Payment Method on Date/Price row as third column using a new `.grid-3` class          | A bare `.grid-3` does not exist in the live CSS (only `.grid-2`, `.grid-3-equal` for Numista dimensions, and view-only `.three-col` are present). This work adds `.grid-3` next to `.grid-2` at `css/styles.css:~1188`, plus an entry in the narrow-viewport collapse rule at `css/styles.css:~12982` so the row degrades to single-column on mobile. Keeps the Purchase Location / Storage Location row untouched.                                                 | Date field and Price field lose ~33% width — mitigated by AC-8 mockup gate; new CSS class is small surface area but is required scope, not a "verify"                          |
| D-3 | Blank-omit via post-spread `delete` (not conditional inclusion)                       | Matches the exact pattern at `events.js:1711–1712` for image frames. Conditional inclusion in `buildItemFields()` would also work — that function already does it for `pricingType` and image-frame fields at `events.js:1642–1650` — but the post-delete site is co-located with edit-mode spread logic, so future readers see the contract enforced where the spread happens. The image-frame precedent is the closest match for an optional string-valued field. | Three delete sites (edit, add, bulk) instead of one conditional include; the bulk-edit path needs its own delete regardless because it bypasses `buildItemFields()` (see D-4)  |
| D-4 | Bulk edit blank-delete via post-apply cleanup                                         | `applyBulkEdit()` has no generic delete-key semantic (confirmed at `bulkEdit.js:1263–1266`); adding a `paymentMethod`-specific delete after the generic write loop is the minimal change                                                                                                                                                                                                                                                                            | Slightly asymmetric — but adding a generic "delete-on-blank" semantic would touch every field and is out of scope                                                              |
| D-5 | Filter predicate mirrors `purchaseLocation` exactly                                   | Same normalization pattern: missing/falsy → `"—"`, exact match against `values` array                                                                                                                                                                                                                                                                                                                                                                               | Consistent with existing behavior; no new abstraction needed                                                                                                                   |
| D-6 | `sanitizeImportedItem` `basicFields` array as the import boundary for CSV+JSON        | CSV imports (two paths) and JSON import all funnel raw objects into `sanitizeImportedItem()` at `inventory-import.js:417-447`, `:842-865`, and `:1289-1323`; adding `"paymentMethod"` to `basicFields` at `utils.js:1352` covers them. ZIP restore is handled separately — see ZIP entry in File Map.                                                                                                                                                               | No field-specific validation (acceptable — payment method is a plain string, same as purchaseLocation); ZIP path has its own preservation step rather than a single chokepoint |
| D-7 | View modal: add Payment Method to existing `three-col` grid alongside Date and Source | The grid already uses the `three-col` class at `viewModal.js:473`; adding a third detail fills the layout naturally                                                                                                                                                                                                                                                                                                                                                 | Source field with long URLs may wrap — but it already does today, no regression                                                                                                |
| D-8 | PDF export: abbreviate header to "Pay Method"                                         | The PDF table is a 20-column `autoTable` at `inventory.js:1973-1999` (current headers include `Location`, `Date`, `Price`, etc., not `Purch Loc`); adding a 21st full-width "Payment Method" column would force noticeable column shrink across the row. The "Purch Loc" abbreviation pattern exists in bulk-edit labels at `bulkEdit.js:280` — distinct context, but the precedent for short forms in space-constrained UI is established.                         | Slight readability loss in PDF; if 21 columns prove unusable in practice the fallback is to drop the PDF column entirely with a footnote (noted in Tradeoffs)                  |

## File Map

_Every file this sketch will create, modify, or delete. Tasks.md will reference these paths._

### New

- `Playground/STRK-50-payment-method-row/index.html` — standalone mockup for AC-8 layout gate (Cohort A)
- `tests/playwright/payment-method.spec.js` — Playwright E2E tests for payment method feature (Cohort C)

### Modified

- `index.html` (~line 2167–2230) — change Date/Price row from `grid-2` to `grid-3`, add `<select id="itemPaymentMethod">` with 10 options as third column
- `css/styles.css` (~line 1188, near `.grid-2`) — add `.grid-3` rule (parallel structure to `.grid-2`)
- `css/styles.css` (~line 12982) — extend the narrow-viewport collapse rule to include `.grid-3` alongside `.grid-2` and `.grid-purity-row`
- `js/state.js` (~line 51–88) — add `itemPaymentMethod: null` to element cache
- `js/init.js` (~line 210) — add `safeGetElement("itemPaymentMethod")` initialization
- `js/events.js` (~line 1478) — read `elements.itemPaymentMethod.value` in `parseItemFormFields()`
- `js/events.js` (~line 1640) — add `paymentMethod: f.paymentMethod` to `buildItemFields()` return object
- `js/events.js` (~line 1711) — add post-spread `delete` for blank `paymentMethod` in edit mode
- `js/events.js` (~line 1845) — add post-push `delete` for blank `paymentMethod` in add mode
- `js/events.js` (~line 1717–1750) — add `"paymentMethod"` to `trackedFields` array
- `js/inventory.js` (~line 1381) — populate `itemPaymentMethod` select on edit-open
- `js/inventory.js` (~line 1762) — populate `itemPaymentMethod` select on clone/duplicate form fill
- `js/clone-picker.js` (~line 103–117) — add `{ labelFor: "itemPaymentMethod", key: "paymentMethod", defaultOn: true }` to `CLONE_FIELDS`
- `js/bulkEdit.js` (~line 280) — add `paymentMethod` select field to `BULK_EDITABLE_FIELDS`
- `js/bulkEdit.js` (~line 1266) — add post-apply blank-delete for `paymentMethod` in `applyBulkEdit()`
- `js/filters.js` (~line 145) — add `paymentMethods` counting object in `generateCategorySummary()`
- `js/filters.js` (~line 147–175) — add counting loop for `paymentMethod` (pattern: `purchaseLocation`)
- `js/filters.js` (~line 286) — add `paymentMethods: filteredPaymentMethods` to return object
- `js/filters.js` (~line 362) — add `paymentMethod` descriptor to `categoryDescriptors` map
- `js/filters.js` (~line 387) — add `{ id: "paymentMethod", enabled: true }` to fallback `categoryConfig`
- `js/filters.js` (~line 948) — add `case "paymentMethod":` filter predicate (mirror `purchaseLocation`)
- `js/filters.js` (~line 1250) — add `paymentMethod` to text search `fieldMatch` chain
- `js/constants.js` (~line 1169) — add `{ id: "paymentMethod", label: "Payment Method", enabled: true, group: null }` to `FILTER_CHIP_CATEGORY_DEFAULTS`
- `js/viewModal.js` (~line 480) — add Payment Method detail to `invGrid2` three-col grid
- `js/inventory-backup.js` (~line 40) — add `paymentMethod` to JSON backup field map
- `js/inventory-backup.js` (~line 155) — add `"Payment Method"` to ZIP-internal CSV headers
- `js/inventory-backup.js` (~line 200) — add `item.paymentMethod || ""` to ZIP-internal CSV row
- `js/inventory-backup.js` (~line 240) — add `paymentMethod` to ZIP sample JSON fields
- `js/inventory-backup.js` (~line 385–390) — verify `parsedItems` from `inventory_data.json` carries `paymentMethod` through to `showImportDiffReview()` (ZIP restore preserves the property since it's a passthrough; tasks confirm no transform strips it)
- `js/inventory-backup.js` (~line 780) — add Payment Method column to ZIP HTML report table
- `js/inventory.js` (~line 1860) — add `paymentMethod` to JSON export field map
- `js/inventory.js` (~line 1950) — add "Pay Method" column to PDF table
- `js/inventory-import.js` (~line 1050) — add `"Payment Method"` to CSV export header in `buildCsvContent()`
- `js/inventory-import.js` (~line 1100) — add `item.paymentMethod || ""` to CSV row in `buildCsvContent()` / `exportCsv()` (user-facing CSV export, distinct from ZIP-internal)
- `js/inventory-import.js` (~line 304) — read `row["Payment Method"]` in CSV import
- `js/inventory-import.js` (~line 435) — pass `paymentMethod` to `sanitizeImportedItem()` in CSV import
- `js/inventory-import.js` (~line 842) — same for second CSV import path
- `js/inventory-import.js` (~line 1280) — read `raw.paymentMethod` in JSON import
- `js/inventory-import.js` (~line 1652) — same for ZIP restore import path
- `js/utils.js` (~line 1352) — add `"paymentMethod"` to `basicFields` array in `sanitizeImportedItem()`

### Deleted

- _(none)_

## Data / Schema Changes

No migration and no new localStorage key. The persisted item contract gains an optional `paymentMethod` string property, handled by the existing field maps in JSON export, ZIP backup field maps, and CSV export — each updated explicitly per the File Map. Existing items without the property are handled transparently (dropdown shows blank, filter normalizes missing → `"—"`). Cloud sync and vault sync carry raw inventory payloads; no migration needed.

Export-blank convention: localStorage omits the `paymentMethod` key entirely when blank (the AC-3/AC-9 contract), but exports (CSV, JSON, PDF) emit empty cells / empty strings for items without the property — matching the existing `purchaseLocation` precedent (`item.purchaseLocation || ""`). This keeps export schemas uniform across rows and avoids varying column counts.

## Tradeoffs Surfaced for Review

- **D-2: Three-column row width** — Purchase Date loses its full-width date picker, and Purchase Price loses its spot-lookup button spacing. The AC-8 mockup gate exists to validate this. Layout alternatives explicitly considered and rejected: (a) putting Payment Method beside Purchase Location / Storage Location would push a dropdown into a row of free-text inputs, breaking visual symmetry; (b) a dedicated full-width row would consume vertical real estate and separate the payment context from the price/date context where it belongs; (c) a two-column row with one empty/future field would visually imply a stub. If the mockup reveals cramping on mobile beyond what the responsive collapse handles, the fallback is option (b) — dedicated row.
- **D-3/D-4: Three separate delete sites** — The blank-omit contract requires `delete item.paymentMethod` in edit, add, and bulk edit paths. The conditional-inclusion alternative (per `pricingType` precedent) would eliminate edit and add deletes but bulk would still need its own. For one field, three explicit deletes co-located with their commit logic is more auditable than splitting the contract across `buildItemFields()` and `applyBulkEdit()`.
- **D-8: PDF abbreviation** — "Pay Method" is shorter but less discoverable. Alternative: drop the PDF column entirely and add a `*` footnote pointing to CSV/JSON export. If the 21-column PDF proves unusable in field testing, fall back to the footnote approach.

## Out of Scope (follow-up issues)

- **Column sort/group by payment method** — table column header sorting is a separate feature (noted in requirements non-goals).
- **Custom free-text for "Other"** — a companion text field to store detail when "Other" is selected. File under STRK if user requests it.
- **Monthly spend reports by payment method** — future analytics feature (noted in source issue).
- **Automatic Notes → paymentMethod migration** — parsing existing Notes field to extract payment method mentions. Non-trivial NLP and out of scope.

## Risk Notes

- **Mobile layout regression** — the Date/Price row going from 2 to 3 columns could cramp inputs on narrow screens. Mitigation: AC-8 mockup gate plus the new `.grid-3` mobile collapse rule (required scope, not a "verify"; added at `css/styles.css:~12982` alongside the existing `.grid-2` and `.grid-purity-row` collapse).
- **Bulk edit blank semantics** — the post-apply delete for `paymentMethod` is the only field-specific blank-delete in `applyBulkEdit()`. If the logic runs before `saveInventory()`, it works; if the loop structure changes, the delete could be skipped. Mitigation: the delete goes immediately after the generic write loop at line 1266, before the persist call at line 1293.

---

> **Phase complete.** Architecture clear, decisions logged with rationale, file map complete. Next: `/sketch tasks STRK-50`.

## Review Archive — approach (2026-05-13)

_Reconciled by /sketch reconcile on 2026-05-13. Original reviewer marks preserved below for audit._

### Codex

**Inline marks (verbatim):**

> CODEX (on lead-paragraph framing): Live check supports the edit-mode image-frame analogy: edit mode spreads `oldItem` into `inventory[editIdx]` at `/Volumes/DATA/GitHub/StakTrakr/js/events.js:1690-1712`. But this sentence undercounts the blank-value work: add mode pushes a new object at `/Volumes/DATA/GitHub/StakTrakr/js/events.js:1834-1858`, and bulk edit writes enabled fields directly at `/Volumes/DATA/GitHub/StakTrakr/js/bulkEdit.js:1263-1266`. The approach should not frame this as one pipeline addition unless it also calls out the separate add/bulk deletion or omission sites. Also, the rejected alternative needs a real loser: `buildItemFields()` already conditionally adds `pricingType` and image-frame fields at `/Volumes/DATA/GitHub/StakTrakr/js/events.js:1642-1650`, so conditional inclusion for `paymentMethod` is not obviously a spread-contract break.

> CODEX (D-2): This cites a class that does not exist in the live app. I found `.grid-2` at `/Volumes/DATA/GitHub/StakTrakr/css/styles.css:1188-1190`, `.grid-3-equal` for Numista dimensions at `/Volumes/DATA/GitHub/StakTrakr/css/styles.css:10085-10090` and `/Volumes/DATA/GitHub/StakTrakr/index.html:2584-2590`, and view-only `.view-detail-grid.three-col` at `/Volumes/DATA/GitHub/StakTrakr/css/styles.css:6267-6279`; there is no generic `.grid-3` in `index.html`, `css/styles.css`, or `js/`. Mobile collapse currently covers `.grid-2` and `.grid-purity-row` only at `/Volumes/DATA/GitHub/StakTrakr/css/styles.css:12982-12994`. The approach needs to decide whether to create `.grid-3`, reuse `.grid-3-equal` with a mobile rule, or move Payment Method to a different row.

> CODEX (D-6): Refuted for ZIP restore. CSV and JSON imports do pass explicit objects into `sanitizeImportedItem()` at `/Volumes/DATA/GitHub/StakTrakr/js/inventory-import.js:417-447`, `/Volumes/DATA/GitHub/StakTrakr/js/inventory-import.js:842-865`, and `/Volumes/DATA/GitHub/StakTrakr/js/inventory-import.js:1289-1323`. ZIP backup restore instead parses `inventory_data.json` into `parsedItems` at `/Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js:385-390` and sends those raw items to `showImportDiffReview()` at `/Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js:695-710`. Preserving `paymentMethod` in ZIP still looks feasible, but the rationale should rely on the ZIP JSON field map, not on `utils.js` as a universal boundary.

> CODEX (D-8): The PDF precedent is inaccurate. The current PDF header is `Location`, not `Purch Loc`, in the 20-column `autoTable` header at `/Volumes/DATA/GitHub/StakTrakr/js/inventory.js:1973-1999`; `Purch Loc` appears in the bulk-edit label at `/Volumes/DATA/GitHub/StakTrakr/js/bulkEdit.js:280`, not the PDF export. The abbreviation may still be a reasonable tradeoff, but it should be justified against the actual PDF column count and header set.

> CODEX (File Map gap, AC-7): These two entries cover the ZIP backup's internal `inventory_export.csv` at `/Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js:130-221`, but the user-facing CSV export is `buildCsvContent()` / `exportCsv()` at `/Volumes/DATA/GitHub/StakTrakr/js/inventory-import.js:1039-1168` and is exposed on `window` at `/Volumes/DATA/GitHub/StakTrakr/js/inventory-import.js:1685-1687`. Add that export header and row value to the approach file map, or CSV export will still omit `paymentMethod`.

> CODEX (on `.grid-3` CSS verify-note): Verified not present. There is no `.grid-3` rule in the live CSS; the closest reusable form grid is `.grid-3-equal` at `/Volumes/DATA/GitHub/StakTrakr/css/styles.css:10085-10090`, and the narrow-width override at `/Volumes/DATA/GitHub/StakTrakr/css/styles.css:12982-12994` does not include it. This should be a concrete file-map item, not a later "verify" note.

> CODEX (Data / Schema Changes): This is true only if "schema" means no migration and no new localStorage key. The persisted item contract does change by adding an optional saved property; explicit field maps must be updated in JSON export at `/Volumes/DATA/GitHub/StakTrakr/js/inventory.js:1844-1878`, ZIP JSON/CSV/sample/report exports at `/Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js:26-59`, `/Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js:130-251`, and `/Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js:764-790`, plus import parsing in `/Volumes/DATA/GitHub/StakTrakr/js/inventory-import.js:292-447`, `/Volumes/DATA/GitHub/StakTrakr/js/inventory-import.js:1235-1323`, and `/Volumes/DATA/GitHub/StakTrakr/js/inventory-import.js:1560-1680`. Rephrase as no migration/no new storage key, not no persisted-data change.

> CODEX (D-2 Tradeoff bullet): The tradeoff names a fallback, but it does not weigh the other plausible layouts the author implicitly rejected: putting Payment Method on the Purchase Location / Storage Location row required by AC-1's original positioning language, using a dedicated two-column row with Payment Method plus an empty/future field, or keeping Date/Price as-is and placing Payment Method below as a full-width select. The row-width decision is load-bearing because the current Date and Price controls are composite controls with inline buttons, not two plain inputs; see `/Volumes/DATA/GitHub/StakTrakr/index.html:2167-2230`.

> CODEX (Mobile risk note): This mitigation is currently aspirational. The live mobile rule collapses `.grid-2` and `.grid-purity-row` only at `/Volumes/DATA/GitHub/StakTrakr/css/styles.css:12982-12994`; it does not prove any future `.grid-3` behavior. Treat the responsive rule as required implementation scope.

**Review section (verbatim):**

#### What I Verified

- Current edit form layout: Purchase Date and Purchase Price share `.grid.grid-2` at `/Volumes/DATA/GitHub/StakTrakr/index.html:2167-2230`; Purchase Location and Storage Location remain the next `.grid.grid-2` row at `/Volumes/DATA/GitHub/StakTrakr/index.html:2231-2241`.
- Form persistence path: `parseItemFormFields()` reads purchase/storage fields at `/Volumes/DATA/GitHub/StakTrakr/js/events.js:1429-1517`; `buildItemFields()` creates the shared save object at `/Volumes/DATA/GitHub/StakTrakr/js/events.js:1616-1653`; edit mode spreads old/new fields and deletes image-frame auto keys at `/Volumes/DATA/GitHub/StakTrakr/js/events.js:1690-1712`; add mode pushes the built item at `/Volumes/DATA/GitHub/StakTrakr/js/events.js:1834-1858`.
- Element cache and edit/clone population: form elements are cached in `/Volumes/DATA/GitHub/StakTrakr/js/state.js:51-88` and initialized in `/Volumes/DATA/GitHub/StakTrakr/js/init.js:199-233`; edit-open populates purchase/storage fields at `/Volumes/DATA/GitHub/StakTrakr/js/inventory.js:1314-1388`; duplicate/clone form fill separately populates them at `/Volumes/DATA/GitHub/StakTrakr/js/inventory.js:1748-1770`; clone optional fields are listed at `/Volumes/DATA/GitHub/StakTrakr/js/clone-picker.js:103-117`.
- Bulk edit path: field definitions live at `/Volumes/DATA/GitHub/StakTrakr/js/bulkEdit.js:170-298`; enabled values are written directly to selected items at `/Volumes/DATA/GitHub/StakTrakr/js/bulkEdit.js:1165-1302`, especially `/Volumes/DATA/GitHub/StakTrakr/js/bulkEdit.js:1263-1266`.
- Filter chip/search path: category counts/returns/descriptors/fallback config are at `/Volumes/DATA/GitHub/StakTrakr/js/filters.js:124-297` and `/Volumes/DATA/GitHub/StakTrakr/js/filters.js:351-388`; purchase/storage predicates are at `/Volumes/DATA/GitHub/StakTrakr/js/filters.js:941-955`; text search field matching includes purchase/storage today at `/Volumes/DATA/GitHub/StakTrakr/js/filters.js:1116-1139` and `/Volumes/DATA/GitHub/StakTrakr/js/filters.js:1240-1262`; filter defaults merge new categories at `/Volumes/DATA/GitHub/StakTrakr/js/constants.js:1157-1196`.
- Export/import/sync path: normal CSV export is in `/Volumes/DATA/GitHub/StakTrakr/js/inventory-import.js:1039-1168`; JSON/PDF export is in `/Volumes/DATA/GitHub/StakTrakr/js/inventory.js:1844-1999`; ZIP backup field maps/reports are in `/Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js:26-59`, `/Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js:130-251`, and `/Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js:764-790`; ZIP restore parses raw `inventory_data.json` at `/Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js:385-390` and routes it to `showImportDiffReview()` at `/Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js:695-710`; cloud/vault sync carry raw inventory payloads through `/Volumes/DATA/GitHub/StakTrakr/js/cloud-sync.js:2654-2661`, `/Volumes/DATA/GitHub/StakTrakr/js/vault.js:308-355`, and `/Volumes/DATA/GitHub/StakTrakr/js/vault.js:487-495`.
- CSS reality check: `.grid-2` exists at `/Volumes/DATA/GitHub/StakTrakr/css/styles.css:1188-1190`; `.grid-3-equal` exists at `/Volumes/DATA/GitHub/StakTrakr/css/styles.css:10085-10090`; view modal `three-col` is scoped to `.view-detail-grid` at `/Volumes/DATA/GitHub/StakTrakr/css/styles.css:6267-6279`; narrow viewport collapse currently covers `.grid-2` and `.grid-purity-row` at `/Volumes/DATA/GitHub/StakTrakr/css/styles.css:12982-12994`.

#### Top 3 Issues Raised

1. **File-map drift: the normal CSV export is missing.** The approach updates ZIP backup CSV rows, but AC-7's user-facing CSV export lives in `/Volumes/DATA/GitHub/StakTrakr/js/inventory-import.js:1039-1168` and must be added to the file map.
2. **The selected layout depends on a non-existent `.grid-3` class.** The approach claims it leverages an existing class, but the live app only has `.grid-2`, `.grid-3-equal`, and view-modal-only `three-col`; the responsive behavior must be designed explicitly.
3. **Two key rationales cite inaccurate current behavior.** ZIP restore does not funnel through `sanitizeImportedItem()`, and the PDF export does not use a `Purch Loc` header pattern. Both decisions may still be valid, but their evidence needs correction before tasks inherit them.

#### Unverified Assumptions

- The fixed 10-value enum is stable enough to hard-code in both edit modal and bulk edit. Alternatives not weighed in this phase: native text input plus `<datalist>`, user-configurable enum settings, or using existing tags/custom groups without adding a new item property.
- The Date/Price/Payment Method row is preferable to putting Payment Method beside Purchase Location, in a dedicated one-column row, or in a new two-column row. This is load-bearing because the current Date and Price controls are composite controls with inline buttons, not plain inputs.
- A playground mockup will exist before implementation and will be reviewed as a hard gate. The approach names the gate, but it does not state where the artifact lives, what dimensions to check, or who records pass/fail.
- The blank option is the right bulk-edit clearing affordance. The live bulk-edit framework has enable checkboxes plus values, but no generic delete-key semantic; a separate "clear field" action was not weighed.
- Adding a new enabled-by-default filter category will be acceptable for users with saved chip ordering. The default merge helper appends new defaults, but the UX impact of surfacing Payment Method automatically was not explicitly decided.
- `Other` without companion free text will satisfy the original user need. The requirements make free text out of scope, but the approach does not identify how users distinguish multiple non-enum methods later.
- Exporting blank values as empty strings is acceptable even though localStorage's blank contract is omit-the-key. The approach should make explicit whether export files are allowed to contain empty `Payment Method` cells/properties for items with no stored key.
- Adding one more PDF column will remain usable after the current 20-column table at `/Volumes/DATA/GitHub/StakTrakr/js/inventory.js:1973-1999`; this needs either a mock/export check or a fallback decision.

### Resolution Summary

- **Accepted: 8** — lead-paragraph framing rewritten; D-2 / D-3 / D-6 / D-8 rationales corrected; File Map gained `.grid-3` CSS rule, mobile-collapse rule, user-facing CSV export header + row, and a ZIP-restore passthrough verification entry; "Data / Schema Changes" rephrased to no-migration/no-new-key plus an export-blank convention paragraph; mobile risk-note mitigation promoted from "verify" to required scope.
- **Rejected: 0**
- **Resolved with your input: 2** — (1) layout decision: add new `.grid-3` class plus matching mobile collapse rule (vs. reuse `.grid-3-equal` or move Payment Method off the Date/Price row); (2) D-3 rationale: reword to honestly compare against the conditional-inclusion alternative used by `pricingType` and image-frame fields, while keeping the post-spread `delete` decision because it co-locates the contract with edit-mode spread logic.
- **Unverified Assumptions disposition** — export-blank convention added as a paragraph in Data / Schema Changes (matches `purchaseLocation` precedent); mockup artifact location added to High-Level Architecture (`Playground/STRK-50-payment-method-row/`); layout-alternative weighing folded into the D-2 Tradeoff bullet. Remaining assumptions (enum stability, "Other" free text, default-on filter chip, bulk-edit clear affordance, PDF 21-column usability) noted as already-decided in requirements or properly deferred to tasks/implementation; PDF-column usability has an explicit footnote fallback in the D-8 Tradeoff bullet.

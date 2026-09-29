---
sketch: "STRK-50-payment-method-dropdown"
phase: discovery
created: 2026-05-11
---

# STRK-50 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

### Item form parsing and persistence

| Path | Role | Notes |
|------|------|-------|
| `js/events.js:1429–1510` | `parseItemFormFields()` — reads all form inputs into a parsed object `f` | New field reads from `elements.itemPaymentMethod`. Pattern: `elements.purchaseLocation.value.trim()` at line 1478. |
| `js/events.js:1616–1653` | `buildItemFields(f)` — extracts common fields for both add and edit saves | All non-conditional fields go in the initial object literal (lines 1617–1640). Conditional fields (`pricingType`, image frames) use `if` guards after. |
| `js/events.js:1690–1712` | Edit-mode save — `...oldItem, ...buildItemFields(f)` spread | Spreads `oldItem` first, then `buildItemFields(f)` overwrites. Key implication for AC-3: if `paymentMethod` is in `buildItemFields` unconditionally, it always overwrites. If the dropdown returns `""` for blank, that's what's stored — to **omit** the key when blank, the approach must explicitly `delete` it post-spread (same pattern as image frames at lines 1711–1712). |
| `js/events.js:1717–1749` | `trackedFields` — array of field names whose old→new changes are logged | Must add `"paymentMethod"` here for changelog tracking. |
| `js/state.js:51–88` | Form element cache (`elements.*`) | Must add `itemPaymentMethod: null` entry. |
| `js/init.js:199–233` | `safeGetElement()` initialization of cached elements (purchase/storage at lines 210–211) | Must add `elements.itemPaymentMethod = safeGetElement("itemPaymentMethod")`. |

| `index.html` (~lines 2167–2241) | Edit Item modal — purchase section HTML | New `<select id="itemPaymentMethod">` element goes here, in the Date/Price row per AC-8 layout decision. |

### Clone

| Path | Role | Notes |
|------|------|-------|
| `js/clone-picker.js:86–95` | `cloneItemDeep()` — `structuredClone` or JSON round-trip | Copies all properties automatically. No change needed for deep clone. |
| `js/clone-picker.js:103–117` | `CLONE_FIELDS` — checkbox definitions for optional clone fields | Add `{ labelFor: "itemPaymentMethod", key: "paymentMethod", defaultOn: true }`. Mandatory fields (metal, type, etc.) are excluded from checkboxes; payment method is optional, so it gets one. |

### Bulk edit

| Path | Role | Notes |
|------|------|-------|
| `js/bulkEdit.js:170–298` | `BULK_EDITABLE_FIELDS` — field definitions with `inputType` and `options` | Add as `{ id: "paymentMethod", label: "Payment Method", inputType: "select", options: [...] }`. Pattern matches `grade` (line 228) or `gradingAuthority` (line 266). |
| `js/bulkEdit.js:1165–1302` | `applyBulkEdit()` — dynamically applies changes from field definitions | `applyBulkEdit()` writes `item[fieldId] = coerceFieldValue(...)` (lines 1263–1266); `coerceFieldValue()` returns `""` for blank selects (lines 413–416). A blank bulk Payment Method becomes `paymentMethod: ""`, not key deletion. **Approach must add explicit blank-delete handling here for AC-9.** |


### Filter chips

| Path | Role | Notes |
|------|------|-------|
| `js/filters.js:130–170` | `generateCategorySummary()` — counting loop | Pattern: `const pLoc = (item.purchaseLocation \|\| "").trim(); if (pLoc && ...) { purchaseLocations[item.purchaseLocation] = ... }`. Items with blank/missing `paymentMethod` are skipped (no chip for "blank"). |
| `js/filters.js:237–238` | `applyMinCountThreshold()` — filters below `chipMinCount` (default 3) | Standard threshold applies — chips only appear if ≥3 items share the value. |
| `js/filters.js:286–287` | Return object from `generateCategorySummary()` | Add `paymentMethods: filteredPaymentMethods`. |
| `js/filters.js:362–363` | Category descriptors map — `{ summaryKey, field }` | Add `paymentMethod: { summaryKey: "paymentMethods", field: "paymentMethod" }`. |
| `js/filters.js:370–388` | Fallback `categoryConfig` (inline default when no saved config) | Add `{ id: "paymentMethod", enabled: true }`. |
| `js/constants.js` (~line 1157) | `FILTER_CHIP_CATEGORY_DEFAULTS` | Add `{ id: "paymentMethod", label: "Payment Method", enabled: true, group: null }`. Existing user configs auto-merge new defaults via a merge helper. |
| `js/filters.js:941–956` | Filter predicate `switch` in `filterInventoryAdvanced()` | Add `case "paymentMethod":` — pattern identical to `purchaseLocation` (line 941). Normalize missing values to `"—"`. |
| `js/filters.js:1249–1250` | Text search — `fieldMatch` word-boundary regex | Add `(item.paymentMethod && wordRegex.test(item.paymentMethod))` in the `return (...)` chain. Matches how `storageLocation` participates (truthy guard + regex test). |

### View modal

| Path | Role | Notes |
|------|------|-------|
| `js/viewModal.js:473–481` | Purchase details grid in `_buildInventorySection()` | Currently: `invGrid2` is a `three-col` grid with Date and Source (purchase location). Payment Method needs to appear in this section. The grid already has a `three-col` class — adding a third detail fits naturally. |

### Export paths

| Path | Role | Notes |
|------|------|-------|
| `js/inventory-backup.js:26–59` | JSON backup — explicit field map in `inventory.map(...)` | Add `paymentMethod: item.paymentMethod \|\| ""`. Currently 29 fields listed. |
| `js/inventory-backup.js:131–163` | CSV headers array | Add `"Payment Method"` header. |
| `js/inventory-backup.js:180–218` | CSV row generation | Add `item.paymentMethod \|\| ""` at matching index. |
| `js/inventory.js:1844–1878` | JSON export field map | Add `paymentMethod` to the exported object. |
| `js/inventory.js:1935–1970` | PDF table data | Add column. (PDF column width is already tight — approach should decide positioning.) |
| `js/inventory-backup.js:223–251` | ZIP package — HTML inventory report generation + sample JSON fields | Add `paymentMethod` to sample JSON field map. |
| `js/inventory-backup.js:764–790` | ZIP package — HTML report table (purchase/storage/notes/date columns) | Add Payment Method column to the HTML report table. |


### Import paths

| Path | Role | Notes |
|------|------|-------|
| `js/inventory-import.js:304` | CSV import — `row["Purchase Location"]` | Add `const paymentMethod = row["Payment Method"] \|\| ""`. |
| `js/inventory-import.js:417–447` | CSV import → `sanitizeImportedItem({...})` | Add `paymentMethod` to the object literal. |
| `js/inventory-import.js:803,842` | Second CSV import path (legacy/alternate format) | Same pattern — add `paymentMethod`. |
| `js/inventory-import.js:1247,1289` | JSON import — `raw.paymentMethod` | Add `const paymentMethod = raw.paymentMethod \|\| ""` and pass to `sanitizeImportedItem`. |
| `js/inventory-import.js:1571,1652` | ZIP restore import path | Same pattern. |
| `js/utils.js:1322–1371` | `sanitizeImportedItem()` | String fields sanitized via `basicFields` array (line 1352). Add `"paymentMethod"` to this array — it will be `cleanString()`'d automatically. No special numeric/type coercion needed. |

### Cloud sync

| Path | Role | Notes |
|------|------|-------|
| `js/cloud-sync.js` (~line 2660) | Inventory pull — assigns entire array | No field-level mapping. Sync copies the raw inventory array. `paymentMethod` will round-trip transparently as long as it's in the stored item. **No code change needed.** |
| `js/vault.js:308–355,487–495` | Encrypted vault sync | Same — raw localStorage payload. No change needed. |

### Edit modal form population (opening an existing item for edit)

| Path | Role | Notes |
|------|------|-------|
| `js/inventory.js:1214–1231` | `fieldMap` for Numista data fields | NOT the general item form population — this is specifically for Numista catalog fields. |
| `js/inventory.js:1314–1388` | Form population on edit-open — sets element values from stored item (purchase/storage at lines 1381–1383) | Must add `itemPaymentMethod` → `item.paymentMethod` mapping. |
| `js/inventory.js:1748–1770` | Duplicate/clone form population path (purchase/storage at lines 1762–1764) | Must also populate `itemPaymentMethod` here. Approach should confirm clone-mode setup needs this. |


## Prior Decisions

- 2026-05-13 — Layout decision: Payment Method goes on the existing Date/Price row as a third column: `[Purchase Date] [Purchase Price] [Payment Method]` — Purchase Location/Storage Location row is unchanged. (session e8219443, turn 280524)
- 2026-05-13 — Scope expansion: AC-6 (cloud sync/backup), AC-7 (all exports), AC-8 (playground mockup gate), AC-9 (bulk edit), AC-10 (clone preservation) added during reconciliation. (session e8219443, turn 210272)
- Prior field-addition pattern (from STAK-528): add HTML → `fieldMap` → `trackedFields` → `safeGetElement()` for all DOM access. (session agent-ae3ddfad86e7)
- Filter chip within-field logic is AND (every), cross-field is also AND. Adding a new category requires: counting in `generateCategorySummary`, descriptor in map, default in `FILTER_CHIP_CATEGORY_DEFAULTS`, predicate case in `filterInventoryAdvanced`. (mem0, STAK-551/STAK-546)

## External References

_No external libraries or RFCs needed. The feature uses native `<select>` elements and follows existing in-app patterns._

## Constraints

- **`file://` compatibility** — no fetch, no dynamic imports. The `<select>` element and its `<option>` list must be static HTML or built synchronously in JS at init time.
- **No build step** — all changes are hand-edited in vanilla JS/HTML/CSS. Script-tag globals, `defer` load order.
- **`safeGetElement` timing** — `events.js` top-level code runs before `init.js` defines `safeGetElement`. Any element reference at parse time must use `document.getElementById`. Factory closures called at runtime are safe.
- **Blank-omit contract (three paths)** — AC-3 requires that saving without a selection stores no `paymentMethod` key. This affects three code paths: (1) **Edit mode** — `{ ...oldItem, ...buildItemFields(f) }` at `events.js:1690-1712`; a blank `paymentMethod: ""` overwrites the old value. Must `delete` post-spread (same pattern as `obverseImageFrame`/`reverseImageFrame` at lines 1711–1712). (2) **Add mode** — pushes `{ ...buildItemFields(f), ... }` at `events.js:1834-1858`; an unconditional `paymentMethod: ""` in `buildItemFields()` violates the contract for new items. (3) **Bulk edit** — `applyBulkEdit()` writes `item[fieldId] = coerceFieldValue(...)` at `bulkEdit.js:1263-1266`; blank becomes `""`, not key deletion. Approach must either omit blank `paymentMethod` from `buildItemFields()` entirely, or add explicit delete in all three paths.

- **`sanitizeImportedItem` is the import boundary** — all import paths (CSV, JSON, ZIP restore) funnel through `sanitizeImportedItem()` in `utils.js`. Adding `"paymentMethod"` to its `basicFields` array handles sanitization universally.
- **Filter chip minimum count** — chips only show for values with ≥`chipMinCount` items (default 3). Early adopters with few tagged items won't see chips until the threshold is met. This is expected behavior, not a bug.
- **Filter category default merge** — the merge helper at `constants.js:1177-1196` appends new categories to existing user configs. Adding `paymentMethod` as enabled-by-default will appear in chip rows for all existing users on next load. This is intentional (same behavior as prior category additions).
- **Cloud sync older-tab caveat** — raw inventory assignment at `cloud-sync.js:2654-2661` is transparent; `paymentMethod` round-trips without code changes. Older app tabs that don't know the field will ignore it harmlessly (no migration needed).
- **PDF column width** — the PDF export table is already space-constrained. Adding a Payment Method column may require abbreviation or smaller font. Approach should address.

## Open Questions

_All resolved. No blockers for approach._

- [x] **Blank storage vs filter system** — Resolved: the blank-omit contract must be enforced in all three save paths. (1) **Edit mode**: `delete` the key post-spread if blank (same pattern as image frames at `events.js:1711-1712`). (2) **Add mode**: either omit blank `paymentMethod` from `buildItemFields()` output, or `delete` it from the pushed object at `events.js:1834-1858`. (3) **Bulk edit**: `applyBulkEdit()` at `bulkEdit.js:1263-1266` needs a post-write delete when the value is blank (no generic delete-key semantic exists today — approach must solve). The filter predicate normalizes missing/falsy to `"—"` like `purchaseLocation` does. No special-casing needed on the filter side.

- [x] **All code paths** — Resolved: full trace above covers add, edit, clone (`CLONE_FIELDS` + deep copy), bulk edit (`BULK_EDITABLE_FIELDS`), CSV import (4 paths), JSON import, ZIP restore, cloud sync (transparent), backup (JSON + CSV field maps), PDF export, view modal display, filter chips (counting + descriptor + default + predicate + text search), and changelog tracking (`trackedFields`).

## Discovery Summary

The feature touches ~15 files across 6 subsystems (form/persistence, clone, bulk edit, filters, view, export/import), but every integration point follows a well-established pattern. The heaviest lift is the filter chip wiring (5 locations in `filters.js` + 1 in `constants.js`); everything else is a one-line addition to an existing array or object literal. Cloud sync requires no changes (raw inventory assignment is transparent). The blank-omit contract (AC-3/AC-9) is the main subtle gotcha — it must be enforced in three save paths: edit mode (post-spread delete), add mode (omit or delete), and bulk edit (no generic delete-key semantic today; approach must solve). All exports — including ZIP HTML report and sample JSON — include the new field. The `sanitizeImportedItem` function in `utils.js` centralizes import sanitization, so all four import paths share a single fix.

---

> **Phase complete.** Existing code mapped across all subsystems. Prior decisions surfaced. Open questions from requirements resolved. Review reconciled 2026-05-13. Next: `/sketch approach STRK-50`.

## Review Archive — discovery (2026-05-13)

_Reconciled by /sketch reconcile on 2026-05-13. Original reviewer marks preserved below for audit._

### Codex

#### What I Verified

- Add/edit form save path: `parseItemFormFields()` reads current form values at `js/events.js:1429-1517`; `buildItemFields()` copies known persisted fields at `js/events.js:1616-1653`; edit mode spreads old item then built fields at `js/events.js:1690-1712`; add mode pushes built fields at `js/events.js:1834-1858`; tracked user-modified fields are listed at `js/events.js:1717-1750`.
- Current form DOM and element cache: the purchase date/price row is `index.html:2167-2230`, purchase/storage row is `index.html:2231-2241`, cached form elements are declared at `js/state.js:51-88`, and initialized at `js/init.js:199-233`.
- Edit/clone population: edit-open population is in `js/inventory.js:1314-1388`, not `js/events.js`; duplicate/clone population has a separate form-fill path at `js/inventory.js:1748-1770`.
- Clone support: deep clone copies all item properties at `js/clone-picker.js:86-95`; optional clone field checkboxes are defined at `js/clone-picker.js:103-117`.
- Bulk edit: field definitions are at `js/bulkEdit.js:170-298`; select inputs are generated generically at `js/bulkEdit.js:353-367`; `applyBulkEdit()` writes enabled fields directly at `js/bulkEdit.js:1165-1302`, especially `js/bulkEdit.js:1263-1266`.
- Filter chips/search: counts are built at `js/filters.js:136-245`, returned at `js/filters.js:283-297`, category descriptors/fallback config are `js/filters.js:351-388`, purchase/storage predicates are `js/filters.js:941-955`, text search includes purchase/storage at `js/filters.js:1244-1251`, and defaults merge new categories at `js/constants.js:1157-1170` plus `js/constants.js:1177-1196`.
- View/export/import/sync: view purchase details are `js/viewModal.js:473-481`; ZIP JSON and CSV maps are `js/inventory-backup.js:26-59` and `js/inventory-backup.js:130-220`; ZIP HTML/sample exports are `js/inventory-backup.js:223-251` and `js/inventory-backup.js:764-790`; JSON/PDF exports are `js/inventory.js:1844-1878` and `js/inventory.js:1935-1999`; CSV/JSON/ZIP import paths pass explicit fields through `sanitizeImportedItem()` at `js/inventory-import.js:292-447`, `js/inventory-import.js:790-860`, `js/inventory-import.js:1238-1305`, and `js/inventory-import.js:1564-1668`; `sanitizeImportedItem()` string sanitization is `js/utils.js:1351-1373`; cloud/vault sync carries raw inventory payloads through `js/cloud-sync.js:2654-2661`, `js/vault.js:308-355`, and `js/vault.js:487-495`.

#### Top 3 Issues Raised

1. The blank-value contract is under-specified for add mode and bulk edit. Discovery only calls out edit-mode deletion, but add mode and bulk edit can still store `paymentMethod: ""` unless the approach adds a shared omit/delete rule.
2. The edit-open file map is stale. General form population is in `js/inventory.js`, and the duplicate/clone population path should be considered separately.
3. The export sweep may be incomplete if "all exports" includes the ZIP's human-readable HTML report or sample JSON. If those are intentionally out of scope, discovery should say that explicitly before approach narrows the file map.

#### Unverified Assumptions

- A fixed 10-value enum remains the right shape after reconciliation. Alternatives the author should have weighed: a native `<datalist>` over a text input, a user-configurable enum setting reused by add/edit and bulk edit, or tags/custom filter groups with no new item field.
- The Payment Method select can fit on the Purchase Date / Purchase Price row without making the price control or spot lookup button cramped. The code proves the row is currently `.grid.grid-2` (`index.html:2167-2230`) and mobile collapses `.grid-2` to one column (`css/styles.css:12990-12993`), but the proposed three-column layout still needs the mockup gate from AC-8.
- "Blank" should mean the property is absent everywhere, not just visually blank. This is load-bearing because add, edit, bulk edit, import, and export may otherwise disagree between omitted key and empty string.
- Bulk edit should support clearing `paymentMethod` by selecting the blank option instead of needing a separate "clear field" affordance. The current bulk framework has enable/disable checkboxes plus field values, but no generic delete-key semantic.
- ZIP backup "includes paymentMethod" may only need `inventory_data.json` for restore correctness. The ZIP also contains `inventory_report.html` and `sample_data.json`; whether those need the new field is a product/export-contract decision.
- Text search should include payment method values. Requirements say yes, and the current purchase/storage pattern supports it (`js/filters.js:1244-1251`), but there is no prior reusable search field registry, so approach must add another explicit predicate.
- The new filter category should be enabled by default for all existing users. The default merge helper appends new categories (`js/constants.js:1177-1196`), but this may still change existing chip rows for users with saved category ordering.
- Existing cloud sync is transparent enough that no migration or schema compatibility handling is needed. The raw inventory assignment supports this (`js/cloud-sync.js:2654-2661`), but long-lived older app tabs that do not know `paymentMethod` were not analyzed here.

### Resolution Summary

- Accepted: 9
- Rejected: 2 (fixed enum alternatives — requirements already settled; row layout fit — AC-8 mockup gate covers)
- Resolved with your input: 1 (ZIP HTML report + sample_data.json included in scope)

---
sketch: STRK-91-bulk-editor-mobile
phase: discovery
created: '2026-05-22'
---

# STRK-91 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

### Primary: Bulk Editor Module

| Path | Role | Notes |
|------|------|-------|
| `js/bulkEdit.js:1-1850` | Entire bulk edit module | 1850 lines. Self-contained: state, field defs, table render, actions, Numista integration, image upload popover |
| `js/bulkEdit.js:27-58` | `BULK_COLUMN_PRIORITY` | 30-key array controlling column order in the table. Currently flat keys only — no `numistaData.*` dot-path entries |
| `js/bulkEdit.js:92-104` | `getBulkTableDataKeys()` | Scans `Object.keys(item)` across inventory. Only surfaces top-level keys; `numistaData` appears as a single object column and is not in `BULK_COLUMN_PRIORITY`, so items with catalog data can produce a raw JSON blob column in the remaining-column section |
| `js/bulkEdit.js:114-117` | `getBulkSortableValue()` | Flat `item[key]` lookup for sort values. Synthetic `numistaData.*` keys would currently sort as empty strings |
| `js/bulkEdit.js:119-146` | `formatBulkCellValue()` | Flat `item[key]` lookup. Objects fall through to `JSON.stringify`. No dot-path traversal support |
| `js/bulkEdit.js:152-163` | `getFilteredItems()` | Search text is built from flat `Object.keys(item)` values. Synthetic `numistaData.*` keys would currently be invisible to search |
| `js/bulkEdit.js:170-315` | `BULK_EDITABLE_FIELDS` | 23 field definitions. Missing: `shape`, `capsule`, `capsuleNotes`. All use flat `id` strings — no nested property support |
| `js/bulkEdit.js:430-434` | `coerceFieldValue()` | Falls through to `sanitizeHtml(value)` for string fields. Shape/capsule/capsuleNotes are all strings, so no new coercion is expected |
| `js/bulkEdit.js:1272-1285` | `applyBulkEdit()` apply loop | `item[fieldId] = coerceFieldValue(...)` — flat assignment only. Writing `shape` here would create `item.shape` (wrong), not `item.numistaData.shape` (correct). Empty `paymentMethod` is deleted as a special case |
| `js/bulkEdit.js:1277` | Change-log snapshot | `Object.assign({}, item)` creates a shallow snapshot. Nested `numistaData` mutations can mutate both old and new references before `logItemChanges()` compares them |
| `js/bulkEdit.js:881-898` | Table column construction | Columns built as `[{ key: "cb" }, { key: "img" }, ...dataColumns]`. The `cb` and `img` columns are prepended but have no sticky CSS |
| `js/bulkEdit.js:926-958` | `<thead>` rendering | `position: sticky; top: 0` already applied via CSS. No `left` stickiness on any column |
| `js/bulkEdit.js:1849-1850` | Window exports | Exports `window.openBulkEdit` and `window.closeBulkEdit`. Module is otherwise self-contained via closures |

### Secondary: Modal Field Definitions & Save Path

| Path | Role | Notes |
|------|------|-------|
| `index.html:2588-2595` | `#numistaShape` select | Options: Round, Rectangular, Square, Oval, Other. These are the canonical shape values |
| `index.html:2630-2631` | `#itemCapsule` input | Text input, placeholder "e.g. A-32, X-38-Ring" |
| `index.html:2644-2649` | `#itemCapsuleNotes` input | Text input (NOT textarea), placeholder "e.g. Guardhouse 38mm — tight fit" |
| `js/events.js:1537` | Top-level `composition` | Derived from the Metal selector via `getCompositionFirstWords()`. This is the user-selected composition used by existing calculations and is separate from Numista catalog composition |
| `js/events.js:1651-1673` | `numistaData` field collection | Builds `fields` object from modal inputs. `composition`, `shape`, `diameter`, dimensions, and other catalog fields live inside `item.numistaData` |
| `js/events.js:1595-1596` | Capsule field collection | `capsule` and `capsuleNotes` are saved as top-level item properties: `item.capsule`, `item.capsuleNotes` |
| `js/events.js:1681-1684` | Lean `numistaData` storage | Empty, false, and zero-valued catalog fields are stripped before storing `numistaData` |
| `js/events.js:1903,1978` | `registerCapsule()` call | After save, capsule values are registered for autocomplete suggestions |
| `js/events.js:3036-3089` | Shape dropdown dimension toggle | `toggleDimensionFields()` clears incompatible dimensions when shape category changes in the form. Bulk shape edits need equivalent data-model cleanup |
| `js/autocomplete.js:1120-1132` | `registerCapsule()` | Tracks capsule names from `#itemCapsule` only; capsule notes do not participate in autocomplete |
| `js/changeLog.js:80-119` | `logItemChanges()` tracked fields | Fixed comparison list currently omits `capsule` and `capsuleNotes` |
| `js/diff-engine.js:32-83` | `DIFF_FIELDS` | Cloud sync matched-item diff fields currently omit `capsule` and `capsuleNotes` |

### CSS: Bulk Editor Styles

| Path | Role | Notes |
|------|------|-------|
| `css/styles.css:12538-12546` | `.bulk-edit-content` | `width: 95vw; max-width: 1400px; max-height: 92vh; display: flex` |
| `css/styles.css:12562-12568` | `.bulk-edit-body` | `display: flex; gap: 1.5rem; overflow: hidden` — side-by-side layout |
| `css/styles.css:12571-12578` | `.bulk-edit-fields` | `width: 300px; flex-shrink: 0; overflow-y: auto; max-height: 70vh; border-right: 1px solid` |
| `css/styles.css:12602-12609` | Field panel checkboxes | `width: 16px; height: 16px` — below WCAG 2.5.8 24×24px minimum |
| `css/styles.css:12703-12710` | `.bulk-edit-table-wrap` | `overflow-x: auto; -webkit-overflow-scrolling: touch` — horizontal scroll exists but no sticky columns inside |
| `css/styles.css:12712-12718` | `.bulk-edit-table` | `width: max-content; min-width: 100%; table-layout: auto; border-collapse: collapse` — `border-collapse: collapse` blocks reliable sticky columns |
| `css/styles.css:12720-12725` | `.bulk-edit-table thead` | `position: sticky; top: 0; z-index: 2` — vertical sticky header already works |
| `css/styles.css:12740-12744` | Table checkboxes | `width: 16px; height: 16px` — same undersized problem |
| `css/styles.css:13014-13030` | `@media (max-width: 768px)` responsive | Stacks field panel above table, sets `width: 100%` on panel, removes border-right. No collapsible behavior — panel always visible |
| `css/styles.css:13086-13096` | Mobile fullscreen override | Bulk edit content gets `100vw, 100dvh` fullscreen treatment |
| `css/styles.css:13114-13123` | Item/view modal safe-area headers | Safe-area padding exists for item and view modal headers, but not for the bulk edit modal header |
| `css/styles.css:13213-13237` | Bulk edit mobile phase 6 | Panel inputs/selects get `min-height: 44px` but checkboxes do not receive the same effective tap area |

### Prior Art: Main Inventory Table Sticky Columns

| Path | Role | Notes |
|------|------|-------|
| `css/styles.css:5129-5142` | `#inventoryTable` | Uses `border-collapse: separate; border-spacing: 0` — prerequisite for sticky columns. Comment explicitly notes this enables `position: sticky` |
| `css/styles.css:5090-5098` | `.table-section` | `overflow: visible` — prevents creating an intermediate scroll container that would break sticky |
| `css/styles.css:5101-5113` | `.portal-scroll` | The actual scroll container. `overflow-x: auto; overflow-y: auto; -webkit-overflow-scrolling: touch` |

### HTML Structure

| Path | Role | Notes |
|------|------|-------|
| `index.html:8034-8058` | Bulk edit modal DOM | Structure: `#bulkEditModal > .bulk-edit-content > [.modal-header, .bulk-edit-body > [.bulk-edit-fields, .bulk-edit-items > [.bulk-edit-toolbar, .bulk-edit-table-wrap]], .bulk-edit-footer]` |
| `index.html:8054` | `.bulk-edit-footer` | Contains Apply/Cancel/Close actions. No mobile safe-area bottom padding is currently applied |
| `index.html:8060-8080` | `#bulkConfirmModal` | Inline confirmation dialog (custom DOM modal, not `window.confirm`) |

### Test Coverage

| Path | Role | Notes |
|------|------|-------|
| `tests/playwright/goldback-type.spec.js:98-126,233-254,341` | Goldback bulk edit tests | Opens bulk editor and tests goldback denomination picker swap. Uses `openBulkEditModal()` helper |
| `tests/playwright/payment-method.spec.js:64-92,184-207` | Payment method bulk edit test | Tests bulk set/clear of paymentMethod field |
| `tests/playwright/silverback.spec.js:78-106,173-192` | Silverback bulk edit test | Tests silverback unit handling in bulk editor |
| `tests/playwright/mobile-modal-safe-area.spec.js:196-414` | Mobile modal safe-area prior art | Provides viewport/source assertion patterns for fullscreen mobile modal behavior |
| _(no dedicated file)_ | No bulk editor test suite | No `bulk-edit.spec.js` exists. Coverage is incidental through feature-specific test files. No current test asserts mobile sticky offsets, checkbox/tap target geometry, collapsible panel behavior, nested `shape` persistence, or `numistaData.*` table column behavior |

### Existing Collapsible Pattern

| Path | Role | Notes |
|------|------|-------|
| `css/styles.css:1262-1290` | `.form-section` collapsible | Uses `<details>/<summary>` for zero-JS collapsible sections. `.form-section-header` with `min-height: 36px` |

## Prior Decisions

- 2026-04-25 — Fullscreen modals need `height: 100dvh` with `100vh` fallback for Android gesture-pill clearance (STAK-578). The bulk editor already has this via the `@media (max-width: 768px)` override at `css/styles.css:13086-13096`.
- 2026-04-25 — CodeRabbit detected R5.2 fallback regression on mobile modal headers (STAK-578). Safe-area-inset padding was added to item and view modals but not to the bulk edit modal header or footer.
- 2026-04-19 — `toggleBulkGbPicker` in `bulkEdit.js` mirrors `toggleGbDenomPicker` in `events.js`. Changes in one must be reflected in the other (retro-learning). Relevant because adding new fields to the bulk editor panel must not break this mirroring.
- 2026-05-08 — STRK-51 expanded Numista import modal to 26 fields. Established `numistaData` as the canonical nested storage for catalog metadata (shape, dimensions, Numista composition, etc.). Capsule/capsuleNotes confirmed as top-level item fields.
- 2026-04-17 — Inline grid styles block mobile responsive media queries. CSS classes must be used instead of inline `grid-template-columns` (retro-learning from SITE project, applicable here).

## External References

- [CSS `position: sticky` on table cells (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/position#sticky) — sticky columns require `border-collapse: separate` (not `collapse`), the scroll container must be an ancestor (not the table itself), and stacking context must be managed with `z-index` to prevent data cells from painting over sticky cells.
- [WCAG 2.2 SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) — 24×24 CSS pixel minimum for pointer targets. The 44×44px value (Apple HIG / WCAG 2.5.5 Enhanced) is the project's mobile target per AC-2 reconciliation.
- [`<details>`/`<summary>` disclosure widget (MDN)](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/details) — native HTML disclosure. Project already uses this pattern for `.form-section` collapsible sections (`css/styles.css:1262`). Zero-JS, keyboard-accessible, has `open` attribute and ARIA support when wired explicitly.

## Constraints

- **`border-collapse: collapse` must change to `separate`**: The bulk edit table currently uses `border-collapse: collapse`. CSS `position: sticky` on `<td>`/`<th>` elements does not work reliably with `collapse` because the browser merges cell borders into a shared border model that cannot move independently. The main inventory table already solved this (`border-collapse: separate; border-spacing: 0` at `styles.css:5140-5141`). Switching requires verifying visual borders across light, dark, and sepia themes because no theme-specific bulk-table border overrides currently exist.
- **Sticky identity region scope is checkbox + image + name**: The identity region named in AC-1 maps to the synthetic `cb` and `img` columns plus the first data column `name`. The name column's `left` offset must account for the checkbox and image column widths.
- **Bulk editor safe-area coverage is incomplete**: The mobile fullscreen override exists, but the bulk editor header and footer lack the safe-area padding added to item/view modals. The footer contains primary actions, so bottom inset coverage matters on home-indicator devices.
- **`applyBulkEdit()` flat assignment breaks `shape`**: The apply loop does `item[fieldId] = coerceFieldValue(...)`. For `shape`, this creates `item.shape` instead of writing to `item.numistaData.shape`. The apply path needs a mapping from field ID to the correct storage path, with `numistaData` initialization when absent.
- **Shape edits need dimension cleanup and lean storage**: The single-item form clears incompatible dimensions when shape category changes. Bulk shape edits need equivalent data-model cleanup: rectangular/square shapes should clear diameter, while round/oval/other should clear length/width. If a bulk edit initializes `numistaData`, it should preserve existing catalog fields and strip empty catalog objects in the same spirit as `parseNumistaDataFields()`.
- **Nested mutations need a real old snapshot**: Because the current bulk apply snapshot is shallow, mutating `item.numistaData.shape` can also mutate `oldItem.numistaData.shape` before `logItemChanges()` runs. Nested writes need a deep enough snapshot for `logItemChanges()` to see the change.
- **Nested display columns require dot-path support in three places**: For Numista catalog display columns, `getBulkTableDataKeys()` must produce explicit nested column keys, `formatBulkCellValue()` must resolve dot paths, `getBulkSortableValue()` must sort nested values, and `getFilteredItems()` must include nested values if the columns are meant to participate in search. Missing any one of display, sort, or search makes the table behavior inconsistent.
- **Raw `numistaData` should not render beside nested catalog columns**: Today `numistaData` can appear as a JSON blob in the remaining-column section. If synthetic `numistaData.*` columns are added, the raw object column should be suppressed to avoid duplicate/confusing data.
- **User composition and Numista composition are distinct values**: Top-level `item.composition` is the user-selected calculation value derived from the Metal selector. `item.numistaData.composition` is separate catalog metadata stored from the Numista section. They should be treated as separate display fields/columns with distinct labels, not as a fallback chain. This supersedes the earlier AC-5 wording that described top-level composition with Numista fallback.
- **Diameter is Numista catalog data, manually editable in item modals**: `item.numistaData.diameter` comes from the Catalog Data section and can be manually edited in the add/edit modal. Current requirements keep diameter display-only in bulk to avoid overwriting per-item measurements, but discovery should not describe it as API-only data.
- **No bundler / no modules**: All JS is script-tag globals. New functions added to `bulkEdit.js` are file-scoped closures unless explicitly exported via `window.*`. Utility functions like `classifyShape` (defined in `catalog-api.js`) and `registerCapsule` (defined in `autocomplete.js`) are available at bulk edit runtime.
- **`file://` protocol support**: The app runs on `file://`. CSS features used must not require HTTP; sticky positioning itself is not an issue here.
- **`capsule` writes must call `registerCapsule()`**: When bulk-applying capsule values, `registerCapsule()` must be called to maintain the autocomplete suggestion registry. `capsuleNotes` does not participate in autocomplete and should not be registered as a capsule name.
- **Empty capsule fields should be deleted rather than persisted as empty strings**: `paymentMethod` already follows a delete-when-empty pattern in `applyBulkEdit()`. New top-level string fields `capsule` and `capsuleNotes` should follow the same pattern unless approach intentionally chooses otherwise.
- **Capsule fields cross shared diff/history surfaces**: `capsule` and `capsuleNotes` are real top-level item fields, but they are absent from `logItemChanges()` and `DIFF_FIELDS`. Bulk editing them should include these shared field lists so activity/undo and matched-item cloud sync can observe the changes.
- **Existing 768px breakpoint**: The bulk editor's responsive break is at 768px (field panel stacks above table). AC-3's collapsible behavior activates at this same breakpoint. The `<details>` element must be injected only at narrow viewports, or always present but styled to look like the current panel at wide viewports.
- **z-index stacking**: The thead already uses `z-index: 2`. Sticky left columns need a z-index between the thead corner cells (highest — both row-sticky and column-sticky) and normal data cells (lowest). Three tiers: corner cells (z-index: 3), sticky column body cells (z-index: 1), data cells (z-index: auto).

## Open Questions

_None — all blocking questions resolved during codebase analysis and reconciliation._

## Discovery Summary

The work concentrates in two runtime files plus shared field-list surfaces: `js/bulkEdit.js` (field definitions, table rendering, search/sort/display value resolution, apply logic), `css/styles.css` (responsive rules, sticky positioning, safe-area padding, touch targets), `js/changeLog.js`, and `js/diff-engine.js`. The trickiest UI part is the **sticky column implementation**: the table must switch from `border-collapse: collapse` to `separate` (matching the main inventory table's proven pattern), and three z-index tiers must be managed so the checkbox + image + name identity region does not paint under scrolling data columns or above the sticky thead. The trickiest data part is the **nested write-path for `shape`**: `applyBulkEdit()` currently does flat assignment, so it needs a mapped write to `item.numistaData.shape`, dimension cleanup, lean-storage handling, and a deep enough old snapshot for change logging. The **catalog display columns** require explicit separation between user composition (`item.composition`) and Numista composition (`item.numistaData.composition`), plus dot-path support across display, sorting, and search. The collapsible field panel has strong prior art in the existing `<details>/<summary>` pattern used throughout the app.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch-review STRK-91 discovery`, then `/sketch approach STRK-91`.

## Review Archive — discovery (2026-05-23)

_Reconciled by /sketch reconcile on 2026-05-23. Original reviewer marks preserved below for audit._

### Opus

#### Inline marks

> OPUS: BULK_COLUMN_PRIORITY actually contains **30** entries (neither 28 as stated here, nor 32 as GEMINI claimed). Verified by extracting quoted strings from lines 27–58.

> OPUS: Two exports, not one: `window.openBulkEdit` (line 1849) **and** `window.closeBulkEdit` (line 1850). The file is exactly 1850 lines — that claim is accurate.

> OPUS: Verified. Note that `composition` is also a top-level property derived from the Metal selector via `getCompositionFirstWords(elements.itemMetal.value)` at `events.js:1537` — it is NOT nested inside `numistaData`. The `numistaData.composition` field (line 1654) is the Numista-sourced version. These are two independent composition values — critical for AC-5.

> OPUS: Confirmed — `css/styles.css` lines 13114-13123 add `safe-area-inset-*` padding to `#itemModal .modal-header` and `#viewItemModal .modal-header`, but no equivalent rule exists for `.bulk-edit-content .modal-header`. This is a real gap that should be addressed as part of this ticket's mobile work, not deferred.

> OPUS: Verified `registerCapsule` at `autocomplete.js:1120`, exported via `window.registerCapsule` at line 1132. The function is available at bulk edit runtime since `autocomplete.js` loads before `bulkEdit.js` (both `defer`). No load-order risk here — correct to call `window.registerCapsule()` from the bulk apply path.

> OPUS: GEMINI's concern about naive `||` masking is valid but under-diagnosed. The top-level `item.composition` is always derived from the Metal selector at save time (`events.js:1537` → `getCompositionFirstWords()`). It defaults to base metal names like "Silver", "Gold", etc. The Numista `numistaData.composition` holds specifics like "Silver (.999)" or "Cupronickel". A naive `item.composition || item.numistaData.composition` will **always** mask the richer Numista value because `item.composition` is never empty. The approach phase must decide: (a) prefer `numistaData.composition` when it exists (Numista wins), (b) always show `item.composition` (user wins), or (c) concatenate/differentiate. This is a UX decision, not just a code fix.

#### Review section

### Verified

- **BULK_COLUMN_PRIORITY** (`js/bulkEdit.js:27-58`): actually 30 entries, not 28 as stated. GEMINI's claim of 32 is also incorrect.
- **getBulkTableDataKeys()** (lines 92-104): confirmed flat `Object.keys(item)` scan, no dot-path traversal.
- **formatBulkCellValue()** (lines 119-146): confirmed `item[key]` lookup with objects falling through to `normalizeBulkValue()` (which calls `JSON.stringify`).
- **BULK_EDITABLE_FIELDS** (lines 170-315): confirmed 23 field definitions. Missing `shape`, `capsule`, `capsuleNotes` as stated.
- **coerceFieldValue()** (lines 430-434): confirmed fallback to `sanitizeHtml(value)` for unrecognized field IDs.
- **applyBulkEdit()** (lines 1272-1282): confirmed flat `item[fieldId] = coerceFieldValue(...)` assignment. Zero `numistaData` references anywhere in `bulkEdit.js`.
- **Window exports** (lines 1849-1850): two exports (`openBulkEdit` + `closeBulkEdit`), not one as stated.
- **CSS `border-collapse: collapse`** (`css/styles.css:12716`): confirmed. Main inventory table uses `separate` + `border-spacing: 0` (lines 5140-5141) — valid prior art.
- **Checkbox touch targets**: confirmed 16×16px at `styles.css:12602-12608` and `:12740-12744`. The Phase 6 mobile override (lines 13229-13232) targets `input` and `select` with `min-height: 44px` but **not** `input[type="checkbox"]` — the gap is real.
- **safe-area-inset gap**: confirmed. `#itemModal .modal-header` and `#viewItemModal .modal-header` have safe-area padding (lines 13114-13123). `.bulk-edit-content .modal-header` has none. This should be fixed as part of this ticket.
- **`<details>/<summary>` pattern**: 29 instances in `index.html`, styled at `css/styles.css:1262-1290`. Strong prior art for collapsible field panel.
- **Script load order**: `autocomplete.js` (line 8496) → `catalog-api.js` (line 8527) → `bulkEdit.js` (line 8546), all `defer`. `window.registerCapsule` and `window.classifyShape` are available at bulk edit runtime — no load-order risk.
- **`toggleDimensionFields()`** (`events.js:3037-3071`): confirmed it clears stale dimensions (diameter when going rectangular, length/width when going round). Uses `window.classifyShape` from `catalog-api.js:528`.
- **Composition derivation** (`events.js:1537`): `item.composition` = `getCompositionFirstWords(elements.itemMetal.value)` — always set to a base metal string like "Silver" or "Gold". `item.numistaData.composition` = catalog-sourced, more specific (e.g. "Silver (.999)").

### Top concerns

1. **Composition column UX decision is unresolved.** The discovery correctly identifies that two composition sources exist, and GEMINI correctly flags the masking problem. But the constraint section frames it as a technical fallback-chain issue when it's actually a UX decision: should the bulk edit column show the user-set metal (always present), the Numista-sourced composition (richer but optional), or differentiate them? The approach phase must resolve this with a design choice, not just a code fix. The rest of the app (`inventoryTable`, `viewModal`, `filters`, `sorting`) consistently uses `item.composition || item.metal` — there is no precedent anywhere in the codebase for preferring `numistaData.composition` over top-level `composition`.

2. **Dimension cleansing on shape bulk edit is more complex than stated.** GEMINI correctly identifies the need to clear conflicting dimensions, but the discovery doesn't account for items that have **no `numistaData` object at all**. Many older or manually-added items won't have `item.numistaData`. The apply path must: (a) initialize `item.numistaData = {}` if absent, (b) set `shape`, (c) clear conflicting dimension keys, (d) strip empty `numistaData` back out if shape was the only key (matching the lean-storage pattern from `parseNumistaDataFields` at `events.js:1681-1684`). This is four operations, not one.

3. **`applyBulkEdit()` change logging will miss nested writes.** The current snapshot (`Object.assign({}, item)` at line 1277) does a shallow copy — `oldItem.numistaData` will be the **same reference** as `item.numistaData`. After writing `item.numistaData.shape = "Round"`, `oldItem.numistaData.shape` will also be `"Round"`, and `logItemChanges()` will see no diff for the `numistaData` field. The apply path needs a deep copy of `numistaData` (or at least of the keys being modified) before mutating.

### Unverified assumptions

1. **The `collectable` field in BULK_COLUMN_PRIORITY (line 54) vs `BULK_EDITABLE_FIELDS`** — `collectable` appears in the column priority but is not in the editable fields. The discovery doesn't mention whether this is intentional or a gap. If AC scope includes editing `collectable` in bulk, it's missing from the field list.
2. **`numistaData` stripping behavior** — `parseNumistaDataFields` strips empty values to keep storage lean (events.js:1681-1684). The bulk apply path for `shape` should follow the same pattern, but the discovery doesn't call out whether the approach phase should replicate or centralize this logic.
3. **Theme-specific border rendering** — switching from `border-collapse: collapse` to `separate` may affect border rendering in the dark and sepia themes. The discovery notes this constraint but doesn't identify whether any theme-specific border overrides exist for the bulk edit table.
4. **`paymentMethod` deletion pattern** — `applyBulkEdit()` already has a special-case deletion for empty `paymentMethod` (line 1283-1285). New string fields (`capsule`, `capsuleNotes`) may need the same delete-when-empty pattern to avoid storing empty strings — the discovery doesn't address this.

### Gemini

#### Inline marks

> GEMINI: Verified all 10 code references in `js/bulkEdit.js`. Note that `BULK_COLUMN_PRIORITY` (lines 27-58) actually contains 32 items, not 28. Confirmed `applyBulkEdit()` (lines 1272-1282) uses flat assignment, which is a key bottleneck for the nested `shape` field write-path.

> GEMINI: Verified secondary modal field definitions and save paths in `index.html` and `js/events.js`. `toggleDimensionFields()` is at lines 3037-3071, and shape change listeners are at lines 3073-3089.

> GEMINI: Verified bulk editor CSS references. Confirmed the 16x16px checkboxes lack the mobile `min-height: 44px` target size overrides, leaving a touch target gap.

> GEMINI: Verified main inventory table sticky styles (lines 5133-5143) and scroll container rules (lines 5105-5113) as valid prior art.

> GEMINI: Verified HTML DOM structures for `#bulkEditModal` and `#bulkConfirmModal` at the specified lines in `index.html`.

> GEMINI: Verified test coverage references. The bulk edit helper assertions and feature E2E integration test flows exist exactly as cited.

> GEMINI: Verified `<details>/<summary>` styling patterns exist at `css/styles.css:1262-1290`.

> GEMINI: Verified constraints. Two critical edge cases surfaced: (1) Conflicting dimension properties must be cleared from `numistaData` if a shape bulk edit changes the category (e.g. Round -> Rectangular). (2) Since `item.composition` is derived from Metal and always set to a non-empty string, a naive `item.composition || item.numistaData.composition` fallback will always mask the specific Numista-sourced composition. The formatting engine must account for this.

#### Review section

### Verified

- Checked codebase paths and line numbers:
  - Verified `js/bulkEdit.js:27-58` (`BULK_COLUMN_PRIORITY`), `92-104` (`getBulkTableDataKeys()`), `119-146` (`formatBulkCellValue()`), `170-315` (`BULK_EDITABLE_FIELDS`), `430-434` (`coerceFieldValue()`), `1272-1282` (`applyBulkEdit()` apply loop), `881-898` (column prepend), and `926-958` (thead sticky).
  - Verified `index.html` shape select (`2588-2595`), capsule inputs (`2630-2631`, `2644-2649`), modal DOM (`8034-8058`), and confirmation modal (`8060-8080`).
  - Verified `js/events.js` for shape dropdown toggling and capsule registrations.
  - Verified `css/styles.css` selectors and mobile overrides (including `min-height: 44px` target size overrides and fullscreen overrides).
  - Verified Playwright spec files (`tests/playwright/goldback-type.spec.js`, `tests/playwright/payment-method.spec.js`, and `tests/playwright/silverback.spec.js`).

### Top concerns

1. **Conflicting Physical Dimension Cleansing**: In the single item form, changing shape via `toggleDimensionFields` automatically clears incompatible fields (e.g., clearing `diameter` when transitioning to a rectangular shape). When bulk-applying the `shape` field, we should mirror this logic: if shape is set to rectangular or square, we must delete `item.numistaData.diameter` if it exists. If set to round/oval/other, we must delete `item.numistaData.length` and `item.numistaData.width`. Failing to do this will result in corrupted catalog metadata.
2. **Composition Fallback Masking**: The top-level `item.composition` is derived automatically from the Metal selector and is always set to a non-empty value (e.g. "Silver" or "Gold"). If the display column naive-falls back using `item.composition || item.numistaData.composition`, it will _never_ display the specific catalog composition (e.g. "Silver (.999)") because the top-level property is never empty. The cell formatting lookup must account for this.
3. **Autocompletion Registry**: Bulk-applying a capsule value must call `registerCapsule()` to sync autocomplete suggestions. However, capsule notes do not participate in autocomplete (autocomplete.js only tracks `#itemCapsule`), which is correct but should be explicitly kept out of scope.

### Unverified assumptions

1. We assume that if `numistaData` is initialized for an item during `shape` bulk edit, other metadata properties (like `country` or `mintage`) are left undefined, and only `shape` is set.
2. We assume that `border-collapse: separate` with `border-spacing: 0` will not cause subtle rendering differences in custom themes (light, dark, sepia) for the bulk table borders, and we will style the borders to match the existing look.
3. We assume that no visual regression testing or new Playwright helpers are needed for mobile-specific sticky/scrolling verification, but standard E2E assertions can verify elements are in the DOM and visible.

### Codex

#### Inline marks

> CODEX: The test inventory is accurate, but the discovery should call out the missing verification shape for this specific ticket: existing bulk coverage opens the modal and checks field behavior (`tests/playwright/payment-method.spec.js:184-207`, `tests/playwright/goldback-type.spec.js:233-254`, `tests/playwright/silverback.spec.js:173-192`), while no current test asserts mobile sticky offsets, checkbox target geometry, collapsible panel behavior, or `shape` writing into `item.numistaData.shape`. The adjacent `mobile-modal-safe-area.spec.js` shows a source/viewport assertion pattern for fullscreen mobile modal rules (`tests/playwright/mobile-modal-safe-area.spec.js:196-414`) that could be reused instead of leaving AC-1 through AC-3 as manual-only.

> CODEX: Add `getBulkSortableValue()` to this constraint. The bulk header click path sorts via `getBulkSortableValue(item, bulkSortCol)` (`js/bulkEdit.js:902-915`), and that helper currently returns `normalizeBulkValue(item[key])` (`js/bulkEdit.js:114-117`). If AC-5 adds synthetic `numistaData.*` column keys but only updates display formatting, those columns will render correctly while sorting as empty strings.

> CODEX: The capsule write path also needs change-log and sync coverage. `capsule`/`capsuleNotes` are saved by the item modal (`js/events.js:1595-1596`, `js/events.js:1746-1747`) and sanitized as item fields (`js/utils.js:1403-1432`), but neither appears in `logItemChanges()`'s field list (`js/changeLog.js:80-119`) or `DIFF_FIELDS` (`js/diff-engine.js:32-83`). Bulk-applying these top-level fields would persist locally, but undo/activity history and matched-item cloud sync can miss the change unless those shared field lists are updated too.

#### Review section

### Verified

- Re-checked the active sketch file and confirmed existing GEMINI/OPUS reviews are additive and no active CODEX review was present before this pass.
- Verified the bulk editor's flat column/data flow in `js/bulkEdit.js`: `BULK_COLUMN_PRIORITY` (`27-58`), top-level key discovery (`92-104`), flat sortable lookup (`114-117`), flat cell lookup (`119-146`), field definitions (`170-315`), field panel rendering (`521-588`), table columns (`881-958`), and apply loop (`1181-1295`).
- Verified capsule and Numista storage paths in `js/events.js:1532-1685`, `js/events.js:1729-1747`, `js/events.js:1888-1904`, and `js/events.js:1950-1979`; `shape` is nested under `numistaData`, while `capsule` and `capsuleNotes` are top-level item fields.
- Verified responsive/sticky/touch CSS in `css/styles.css:12538-12753`, main-table sticky prior art in `css/styles.css:5089-5142`, and mobile bulk-editor rules in `css/styles.css:13013-13237`.
- Verified shared field tracking surfaces: `logItemChanges()` compares a fixed list in `js/changeLog.js:80-119`, and cloud sync diffing uses `DIFF_FIELDS` in `js/diff-engine.js:32-83`.

### Top concerns

1. **Synthetic nested columns need sortable-value support too.** Discovery names `getBulkTableDataKeys()` and `formatBulkCellValue()`, but the live table header path also calls `getBulkSortableValue()` when sorting (`js/bulkEdit.js:902-915`). That helper is currently flat (`js/bulkEdit.js:114-117`), so nested display columns can render but sort as empty values unless the approach includes it.
2. **Capsule parity crosses shared item-diff contracts.** `capsule` and `capsuleNotes` are real top-level item fields in modal save and sanitization paths, but they are absent from `logItemChanges()` and `DIFF_FIELDS`. Bulk editing them should not stop at UI/apply support; otherwise activity/undo and matched-item cloud sync can miss the new values.
3. **The verification plan is under-specified for the risky mobile behavior.** Current bulk-editor tests cover field-specific flows, not sticky column geometry, tap-target sizing, collapsible panel behavior, or nested `shape` persistence. Discovery should hand approach/tasks a concrete test target so AC-1 through AC-5 do not land as visual/manual assertions only.

### Unverified assumptions

1. The intended UX is that synthetic `composition` and `diameter` columns remain sortable like every other data column rendered by the bulk table.
2. Bulk-applying an empty `capsule` or `capsuleNotes` value should delete the stored key, matching `paymentMethod`, rather than persist an empty string.
3. Updating `DIFF_FIELDS` and `logItemChanges()` for capsule fields is in scope for STRK-91/STRK-90 even though those lists were already missing capsule support before this sketch.
4. The mobile sticky-column implementation can be covered with deterministic Playwright geometry/source assertions rather than a screenshot-only/manual QA pass.

### Deepseek

#### Inline marks

> DEEPSEEK: The `numistaData` key is **not** in `BULK_COLUMN_PRIORITY` (lines 27-58; verified: 30 flat entries, no `numistaData`). Therefore any item with a `numistaData` object produces a raw JSON-blob column in the "remaining" section of the table (line 100-102). This is already undesirable UI (a wall of JSON stringified at `formatBulkCellValue` line 143), and adding synthetic `numistaData.*` dot-path columns will leave you with **both** the JSON blob column AND the individual columns unless the approach phase suppresses `numistaData` from the column list.

> DEEPSEEK: Verified the gap is real and also applies to the **footer**. The bulk edit footer (`.bulk-edit-footer` at `index.html:8054`) contains the Apply/Cancel/Close buttons and has no safe-area-inset-bottom padding. On notched iPhones, the Cancel button can render behind the home indicator. The PR comment at STAK-578 says "Footers/action-bars cover all three axes since commit 7def3d3f" (CSS comment at line 13112), but that commit only covered item/view modals — not the bulk edit modal.

> DEEPSEEK: This is worse than CODEX describes — it's a **triple-path gap**, not a single-function gap. The search filter (`getFilteredItems` at `js/bulkEdit.js:152-163`) also calls `normalizeBulkValue(item[key])` for each key at line 158. With synthetic `numistaData.*` keys, `item["numistaData.diameter"]` is `undefined` → `normalizeBulkValue(undefined)` returns `""` (line 78), making synthetic columns invisible in search. Three flat-lookup consumers exist: display (`formatBulkCellValue`, line 121), sorting (`getBulkSortableValue`, line 116), and search filtering (`getFilteredItems`, line 158). All three need dot-path resolution, not just the first two.

> DEEPSEEK: The discovery should also flag the **delete-when-empty contract**. The existing `applyBulkEdit()` deletes `item.paymentMethod` when the value is empty (`bulkEdit.js:1283-1285`). New string fields `capsule` and `capsuleNotes` should follow the same pattern to avoid persisting empty strings. Additionally, `capsuleNotes` does NOT participate in autocomplete (verified: `registerCapsule` at `autocomplete.js:1120` only reads `#itemCapsule` input, never `#itemCapsuleNotes`), so the approach should confirm that calling `registerCapsule(capsuleNotes)` is out of scope.

> DEEPSEEK: There is a **column name collision** to resolve first. `composition` already appears in `BULK_COLUMN_PRIORITY` (line 30, verified) — it is currently rendered as a flat `item.composition` column via `formatBulkCellValue(item, "composition")` at line 121. If the approach phase enhances the *existing* composition column's display logic to check `numistaData.composition` (fallback), no collision. But if it adds a *new synthetic column* keyed `numistaData.composition`, the user sees **two** composition columns — the original flat `item.composition` (from BULK_COLUMN_PRIORITY) and the synthetic one (from the key-extension logic). The approach should enhance the existing column rather than add a duplicate.

#### Review section

### Verified

- **BULK_COLUMN_PRIORITY** (`js/bulkEdit.js:27-58`): confirmed 30 entries (OPUS is correct; discovery's "28" and GEMINI's "32" are both wrong). Counted: name, metal, composition, type, qty, weight, weightUnit, purity, price, marketValue, spotPriceAtPurchase, premiumPerOz, totalPremium, year, grade, gradingAuthority, certNumber, pcgsNumber, serialNumber, numistaId, purchaseLocation, storageLocation, date, notes, collectable, pcgsVerified, obverseImageUrl, reverseImageUrl, serial, uuid = 30.
- **getBulkTableDataKeys()** (lines 92-104): confirmed flat `Object.keys(item)` scan. The `numistaData` key is NOT in BULK_COLUMN_PRIORITY and will appear as a JSON-blob column in the "remaining" section for any item that has it — confirmed by tracing the filter path at line 99-103.
- **getBulkSortableValue()** (lines 114-117): confirmed flat `normalizeBulkValue(item[key])` — no dot-path support. **Additionally confirmed that `getFilteredItems()` (lines 152-163) at line 158 also calls `normalizeBulkValue(item[key])`**, so search filtering shares the same flat-lookup gap as sorting.
- **formatBulkCellValue()** (lines 119-146): confirmed `item[key]` flat lookup at line 121. Objects at line 143 fall through to `normalizeBulkValue(value)` which does `JSON.stringify`.
- **BULK_EDITABLE_FIELDS** (lines 170-315): confirmed 23 entries. `collectable` appears in BULK_COLUMN_PRIORITY (line 52) but NOT in BULK_EDITABLE_FIELDS — OPUS's observation is correct.
- **applyBulkEdit()** (lines 1272-1298): confirmed flat `item[fieldId] = coerceFieldValue(...)` at line 1281. Confirmed `paymentMethod` delete-when-empty pattern at lines 1283-1285. Confirmed shallow `Object.assign({}, item)` snapshot at line 1277.
- **normalizeBulkValue()** (lines 77-90): `undefined`/`null` → `""`, objects → `JSON.stringify`. Synthetic `numistaData.*` lookup would pass `undefined` as `item["numistaData.diameter"]`, returning `""`.
- **Window exports** (lines 1849-1850): two exports confirmed (`openBulkEdit`, `closeBulkEdit`).
- **CSS `border-collapse: collapse`** (`css/styles.css:12716`): confirmed. Main inventory table at lines 5140-5141 uses `separate` + `border-spacing: 0`. The comment at line 5136-5139 explicitly documents the sticky prerequisite.
- **Checkbox touch targets**: confirmed 16×16px at lines 12602-12608 (field panel) and 12740-12744 (table). The Phase 6 mobile override (lines 13229-13232) targets `input, select` with `min-height: 44px` — CSS specificity means `input[type="checkbox"]` is NOT matched (the `[type="checkbox"]` attribute selector at 12602 has higher specificity). This is a real gap.
- **safe-area-inset gap**: confirmed `#itemModal .modal-content .modal-header` (lines 13114-13118) and `#viewItemModal .modal-header` (lines 13119-13123). No `.bulk-edit-content .modal-header` rule. Also no `.bulk-edit-footer` safe-area rule exists for the home indicator on notched phones.
- **`<details>/<summary>` pattern**: confirmed 29 `<details>` instances in `index.html`, styled at lines 1262-1290. `.form-section-header` at `min-height: 36px`.
- **Composition two-source**: confirmed `item.composition` derived from Metal selector at `events.js:1537` (`getCompositionFirstWords()`). `item.numistaData.composition` from Numista at `events.js:1654` (`parseNumistaDataFields`). Two independent values with different semantics.
- **Shape nested storage**: confirmed shape lives in `item.numistaData.shape` via `parseNumistaDataFields` at `events.js:1655`.
- **Capsule top-level storage**: confirmed `item.capsule` (line 1595) and `item.capsuleNotes` (line 1596) as top-level properties in `parseItemFormFields`.
- **toggleDimensionFields()** (lines 3037-3071): confirmed diameter cleared on rectangular/square transition (line 3060), length/width cleared on round/oval transition (lines 3068-3069). The bulk apply path has no equivalent cleanup.
- **Change log + DIFF_FIELDS**: confirmed neither `capsule` nor `capsuleNotes` appear in `logItemChanges()` field list (`changeLog.js:80-119`) or `DIFF_FIELDS` (`diff-engine.js:32-83`).
- **`registerCapsule`** (`autocomplete.js:1120-1132`): confirmed it only tracks `#itemCapsule` input, never `#itemCapsuleNotes`. Calling `registerCapsule(capsuleNotes)` would be a no-op.
- **Script load order**: `autocomplete.js` (line 8496) → `catalog-api.js` (line 8527) → `bulkEdit.js` (line 8546), all `defer`. `window.registerCapsule` and `window.classifyShape` available at bulk edit runtime.
- **Theme-specific bulk edit styles**: confirmed only `.bulk-edit-selected` and `.bulk-edit-pinned` have theme variants (lines 12774, 12798, 12802, 12823). No theme-specific border rules for the table itself exist, but switching from `collapse` to `separate` may still affect border rendering differently in dark/sepia themes since the browser's border model changes entirely.

### Top concerns

1. **Composition column UX deadlock with no codebase precedent.** The existing `composition` column (BULK_COLUMN_PRIORITY line 30) already renders `item.composition` which is always non-empty (derived from Metal selector). No code anywhere in the app (`inventoryTable`, `viewModal`, `filters`, `sorting`) prefers `numistaData.composition` over `item.composition`. The approach phase must pick a UX winner — or this becomes a phantom feature that looks correct in code but is invisible to users because the flat column already wins the display race. Adding a *second* composition column (keyed `numistaData.composition`) would make the table look broken with duplicate headers.

2. **The `numistaData` JSON-blob column is a pre-existing visual defect that synthetic columns will exacerbate.** Since `numistaData` is not in BULK_COLUMN_PRIORITY, `getBulkTableDataKeys()` places it in the "remaining" section for any item that has one. The table currently shows a `JSON.stringify` blob in that column (via `formatBulkCellValue` line 143 → `normalizeBulkValue` line 84). Adding synthetic `numistaData.*` columns without suppressing the raw `numistaData` column means users see both the individual columns AND the JSON blob — worse than today. The approach should explicitly suppress `numistaData` from the column list when synthetic sub-keys are present.

3. **Three flat-lookup sites share the dot-path gap — not just two.** The discovery and CODEX both flag `formatBulkCellValue()` and `getBulkSortableValue()`, but `getFilteredItems()` at `bulkEdit.js:158` also calls `normalizeBulkValue(item[key])` for **every key in `Object.keys(item)`** during search. With synthetic `numistaData.*` keys, `item["numistaData.diameter"]` is `undefined` and the search term never matches. The approach must update display, sorting, AND search filtering — missing any one makes the feature feel broken in a different way.

### Unverified assumptions

1. **The intended UX is that synthetic `numistaData.*` columns can be sorted and searched like native columns.** The discovery frames them as "display-only" but doesn't confirm that search/sort support is in scope. If out of scope, they should visibly indicate non-sortable status (like the `nosort` flag on `img`/`cb` columns at line 895-896).
2. **The `numistaData` key will be suppressed from `getBulkTableDataKeys()` output when synthetic sub-columns are present.** Without suppression, users see duplicate data (JSON blob + per-field columns).
3. **The `composition` column will be enhanced in-place rather than duplicated.** The word "synthetic" in the discovery could be read either way. Adding a new column key collides with the existing BULK_COLUMN_PRIORITY entry.
4. **Empty `capsule`/`capsuleNotes` values in bulk apply should delete the key** (matching `paymentMethod` at lines 1283-1285), not persist an empty string. This is stated in the `parseNumistaDataFields` stripping logic (events.js:1681-1684 `v !== "" && v !== false && v !== 0`) but not in the capsule write path.
5. **Dimension cleansing on shape bulk edit should mirror `toggleDimensionFields` behavior** — but the functions operate at different layers (DOM form input vs. data model). The discovery doesn't address whether `classifyShape` can be called from the bulk apply loop (it can — verified `window.classifyShape` at `catalog-api.js:528,2685`), or whether the approach should centralize the cleanup logic into a shared helper.
6. **The `border-collapse: collapse` → `separate` switch won't cause visual regressions across themes.** Verified no theme-specific border rules for `.bulk-edit-table` exist, but the browser's border model changes fundamentally: with `separate`, adjacent cell borders are independent (not merged), and without explicit border rules on every cell, the table may look different in dark/sepia themes where `--border` renders against different backgrounds.
7. **Sticky columns are scoped to the checkbox (`cb`) + image (`img`) + name columns only.** The discovery implies a "sticky identity region" but never enumerates which columns get `position: sticky; left: 0`. The `name` column is column index 2 (after cb and img), so its sticky offset must account for the width of the checkbox and image columns.
8. **The bulk edit footer needs safe-area-inset-bottom on mobile.** The CSS comment at line 13112 says footers were addressed in commit 7def3d3f, but that only covered item/view modals. The bulk edit footer (Apply/Cancel/Close buttons at `index.html:8054`) can be occluded by the iPhone home indicator.

### Resolution Summary

- Accepted: 11
- Rejected: 2 (collectable bulk-editability is outside current requirements scope; `capsuleNotes` should not be registered as a capsule autocomplete value)
- Resolved with your input: 1 (top-level user composition and Numista catalog composition are separate values and should be treated as separate fields/columns, not fallback values)

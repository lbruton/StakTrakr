---
sketch: STRK-91-bulk-editor-mobile
phase: requirements
created: "2026-05-22"
---

# STRK-91 & STRK-90 — Requirements

> **Source Issues:**
>
> - [STRK-91](https://plane.lbruton.cc/lbruton/browse/STRK-91/) (Bulk editor not usable on mobile/small viewports)
> - [STRK-90](https://plane.lbruton.cc/lbruton/browse/STRK-90/) (Bulk editor field parity audit + mobile viewport fixes)
>
> ### Bug Report / Audit Details
>
> The bulk editor page does not adapt to mobile or narrow window sizes. The table-based layout breaks or becomes unusable on small viewports. Additionally, we need to ensure the bulk editor contains all the fields available in the standard add/edit modal (feature parity).
>
> ### Context
>
> PumpkinCrouton is a heavy bulk editor user (85" TV at 300% scaling, and eventually mobile). The main inventory table already has responsive handling with card-view fallback at narrow widths, but the bulk editor has no equivalent adaptation. Furthermore, recent feedback suggests user friction because some fields (such as payment method, purity dropdown options, purchase location, storage location, capsule fields, shape/display mode) may be missing or hard to discover/edit in bulk.
>
> ### Actions
>
> 1. **Field Parity Audit:** Compare add/edit modal fields with bulk editor columns. Ensure any field editable in the modal is bulk-editable. (Purity options, storage/purchase locations, capsule fields, shape/display mode, etc.)
> 2. **Mobile/Small Viewport Adaptation:** Support responsive behavior for the bulk editor layout (e.g. horizontal scroll with sticky first column, card fallback, or column spacing/tap target optimization).

## Overview

The bulk editor is a power-user feature for editing multiple inventory items at once. It currently renders a wide table with 23 editable fields — but it has **no mobile/responsive adaptation** beyond a minimal CSS rule that stacks the field panel above the table at 768px. On phones and zoomed-in desktops (PumpkinCrouton's 85" TV at 300%), the table's horizontal scroll wrapper (`overflow-x: auto`) exists but lacks a sticky identity region, so users lose track of which row they're editing while scrolling through columns. Tap targets for checkboxes (16×16px) are too small for touch use.

Separately, a **field parity gap** exists: the add/edit modal exposes shape, capsule, and capsule notes fields that the bulk editor cannot set. This blocks bulk workflows for collectors who need to update physical details across many items (e.g., after measuring and capsuling a batch). The following fields are explicitly **in scope** for bulk editing: **shape** (select), **capsule** (text input), and **capsuleNotes** (text input). Other Catalog Data fields (country, denomination, thickness, length, width, orientation, technique, mintage, rarity, KM reference, commemorative, and obverse/reverse/edge descriptions) are **out of scope** — they are either Numista-sourced metadata or rarely bulk-edited attributes. Additionally, composition and diameter will be added as **display-only** reference columns (see AC-5).

This sketch delivers both fixes: (1) add the missing fields to the bulk editor, and (2) make the entire bulk editor usable on mobile and zoomed viewports.

## User Stories

- **US-1:** As an investor editing items on mobile, I want the bulk editor table to scroll horizontally with a sticky identity region (checkbox, thumbnail, and item name pinned at the left edge), so that I can identify which row I'm editing while scrolling through data columns.
- **US-2:** As a collector bulk-editing on a phone, I want the bulk editor field panel, toolbar, and footer to be usable at narrow widths (≤480px), so that I can check fields, apply values, and confirm changes without elements overlapping or being untappable.
- **US-3:** As a collector who just capsuled a batch, I want to bulk-set shape, capsule, and capsule notes across selected items, so that I don't have to open each item's edit modal individually.
- **US-4:** As a user on an 85" TV at 300% zoom, I want the bulk editor to remain functional when the effective viewport is narrow (~640px), so that zoomed desktop use doesn't break the layout.

## Acceptance Criteria

### AC-1 — Sticky identity region (maps to US-1)

- **Given** the bulk editor is open on a viewport narrower than the table's natural width
- **When** the user scrolls the table horizontally
- **Then** the checkbox (`cb`), image thumbnail (`img`), and item name (`name`) columns remain fixed at the left edge as a single sticky identity region with appropriate stacked `left` offsets, data columns scroll beneath a visible header row, and a subtle visual indicator (shadow or border) appears at the sticky boundary to communicate scroll depth

### AC-2 — Touch-friendly tap targets (maps to US-2)

- **Given** the bulk editor is open on a viewport ≤480px wide
- **When** the user views the field panel checkboxes and the table row checkboxes
- **Then** all interactive elements meet a 24×24 CSS pixel minimum target size (WCAG 2.2 SC 2.5.8), and on viewports ≤768px, inputs, selects, buttons, and checkboxes provide a 44×44 CSS pixel effective tap area via enlarged clickable labels and padding

### AC-3 — Field panel stacking (maps to US-2)

- **Given** the bulk editor is open on a viewport ≤768px wide
- **When** the field panel renders
- **Then** the field panel stacks above the table (existing behavior), the field panel is collapsible/expandable via a keyboard-accessible disclosure control with appropriate ARIA attributes (`aria-expanded`, `aria-controls`) so it doesn't consume excessive vertical space, and the toolbar search + action buttons remain accessible

### AC-4 — Missing bulk-editable fields (maps to US-3)

- **Given** the user opens the bulk editor field panel
- **When** they scroll the field list
- **Then** the following fields are present and functional: **shape** (select, same options as modal's `numistaShape`), **capsule** (text input, same as modal's `itemCapsule`), **capsuleNotes** (text input, same as modal's `itemCapsuleNotes`). When applied, `shape` must write to `item.numistaData.shape` (initializing `numistaData` if absent), while `capsule` and `capsuleNotes` write to top-level item fields (`item.capsule`, `item.capsuleNotes`).

### AC-5 — Composition and diameter display columns (maps to US-3)

- **Given** an inventory item has composition or diameter data populated
- **When** the bulk editor table renders
- **Then** composition and diameter appear as read-only display columns in the table using **two distinct columns** for composition: the existing top-level `Composition` column (sourced from `item.composition`, user-set via Metal selector) and a new `Catalog Composition` column (sourced from `item.numistaData.composition`, Numista-sourced). Diameter renders as a single `Diameter` column sourced from `item.numistaData.diameter`. The columns are independent — neither falls back to the other. These require engine changes: `getBulkTableDataKeys()` must synthesize column keys for nested `numistaData` properties (only when nested data exists), `formatBulkCellValue()` must support dot-path value retrieval, and the raw `numistaData` object must not render as a JSON blob column.

### AC-6 — Zoomed desktop layout (maps to US-4)

- **Given** the user is on a desktop browser at ≥200% zoom (effective viewport ~640–768px)
- **When** the bulk editor opens
- **Then** the layout matches the responsive behavior from AC-1 through AC-3 — no overlapping elements, no broken grid, scrollable table with sticky column

### AC-7 — No regression on wide viewports

- **Given** the bulk editor is open on a viewport ≥1024px wide
- **When** the user interacts with the table
- **Then** the existing side-by-side field-panel + table layout, sorting, selection, search, apply, copy, delete, and Numista lookup all function identically to current behavior

## Non-Goals

- **Not implementing card-view fallback for bulk editor** — the main inventory table uses a card renderer at ≤1350px, but bulk editing inherently requires a tabular layout (checkbox column, multi-field visibility). Horizontal scroll with sticky columns is the right pattern here.
- **Not adding inline cell editing** — the bulk editor's interaction model is "select items → check fields → set value → apply." This sketch preserves that model; inline/spreadsheet-style editing is a separate feature.
- **Not making disposition fields bulk-editable** — disposition (sold/gifted/lost) is a destructive per-item action with its own confirmation flow. Bulk disposition is out of scope.
- **Not adding diameter/composition as editable bulk fields** — although these are editable in the individual item modal (via the Catalog Data section's `numistaComposition` and `numistaDiameter` inputs), bulk-editing distinct physical measurements across many items risks silently overwriting correct per-item values. They are added as display-only reference columns (AC-5) as a deliberate safety constraint.
- **Not changing the field panel's checkbox-enable-then-set UX** — PumpkinCrouton's friction ("took quite a while") may partly stem from discoverability of this pattern, but changing the fundamental interaction model is a larger UX project. The collapsible field panel (AC-3) will include a keyboard-accessible disclosure control to improve navigation.

## Open Questions

_None — all blocking questions resolved during codebase analysis._

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Next: `/sketch discovery STRK-91`.

## Review Archive — requirements (2026-05-22)

_Reconciled by /sketch reconcile on 2026-05-22. Original reviewer marks preserved below for audit._

### Codex

**Verified**

- Bulk editor field panel, table generation, toolbar/footer, and apply path in `js/bulkEdit.js:170-315`, `js/bulkEdit.js:881-898`, and `js/bulkEdit.js:1279-1282`.
- Bulk editor modal shell in `index.html:8034-8058` and responsive/touch CSS in `css/styles.css:12538-13237`.
- Add/edit modal Catalog Data, capsule fields, and Numista persistence path in `index.html:2572-2709`, `js/events.js:1595-1628`, `js/events.js:1651-1663`, and `js/events.js:1804-1809`.

**Top concerns**

- AC-4 can implement the wrong storage shape unless it explicitly says `shape` updates `item.numistaData.shape`, while `capsule` and `capsuleNotes` update top-level item fields.
- The "field parity" framing is incomplete: the modal exposes more Catalog Data fields than the three editable fields named here, so the requirements need a deliberate include/exclude boundary.
- AC-1's sticky-column wording does not match the current checkbox/image/name column order, making overlap or lost row identity likely on narrow viewports.

**Unverified assumptions**

- The desired sticky identity region includes checkbox + image + item name, not just checkbox + name.
- 44x44 CSS pixels is a product target for all bulk-editor controls, even though the cited WCAG 2.5.8 minimum is not 44px.
- Numista-sourced Catalog Data should be visible in bulk edit for context but not generally bulk-editable, apart from shape.
- A collapsible field panel should preserve the existing checkbox-enable-then-set interaction and expose a keyboard-accessible disclosure control.
- Existing Playwright coverage for bulk edit can be extended for mobile/sticky behavior without introducing a new visual-regression helper.

### Deepseek

**Verified**

- `BULK_EDITABLE_FIELDS` defines 23 field-panel rows at `js/bulkEdit.js:170-315` (requirements say "22").
- `applyBulkEdit()` writes `item[fieldId] = coerceFieldValue(...)` — flat assignment only, no nested property traversal (`js/bulkEdit.js:1273-1282`).
- `getBulkTableDataKeys()` only scans `Object.keys(item)` — no recursive `numistaData.*` extraction (`js/bulkEdit.js:92-104`).
- `formatBulkCellValue()` does flat `item[key]` lookup; objects fall through to `JSON.stringify` — no dot-path support (`js/bulkEdit.js:119-146`).
- Column prepend order: `{ key: "cb" }`, `{ key: "img" }`, then `...dataColumns` (`js/bulkEdit.js:894-898`).
- `.bulk-edit-table-wrap` already has `overflow-x: auto` + `-webkit-overflow-scrolling: touch` (`css/styles.css:12703-12710`).
- Current checkbox size: 16×16px in both panel and table (`css/styles.css:12602-12609`, `css/styles.css:12740-12744`).
- Responsive `min-height: 44px` at ≤768px applies only to `.bulk-edit-fields input, select` — NOT to checkboxes (`css/styles.css:13229-13232`).
- Modal's `capsuleNotes` is `<input type="text">`, not textarea (`index.html:2643-2649`).
- Catalog Data section exposes `numistaComposition` and `numistaDiameter` as **editable** text inputs — non-goal's "not user-editable in the modal" is false (`index.html:2582-2604`, `js/events.js:1651-1657`).
- Top-level `composition` is auto-derived from Metal selector (`js/events.js:1537-1538`), distinct from `numistaData.composition`.
- No dedicated bulk editor Playwright test file exists; only incidental modal-open checks in `payment-method.spec.js`, `goldback-type.spec.js`, and `silverback.spec.js`.

**Top concerns**

1. **AC-4 `shape` write-path is silently broken**: `applyBulkEdit()` writes `item[fieldId] = value` which for `shape` would set `item.shape` (a key that doesn't exist on items). The field must write to `item.numistaData.shape`, requiring either dot-path traversal in the apply loop or a special-case mapping. Without this, bulk-setting shape will appear to succeed but produce zero data change.
2. **AC-5 requires two interdependent engine changes**: `getBulkTableDataKeys()` must produce synthetic column keys for nested properties (`numistaData.diameter`, `numistaData.composition`), AND `formatBulkCellValue()` must handle dot-path value retrieval. Neither function currently supports this. The AC should explicitly note these are pre-requisite implementation changes, not just CSS/HTML additions.
3. **Non-goal justification is factually wrong**: The non-goal states composition/diameter are "not user-editable in the modal either." Both are editable text inputs in the Catalog Data section. If the product decision is "display-only in bulk as a safety constraint," state that directly. The current wording will confuse implementers who verify against the modal.

**Unverified assumptions**

- `coerceFieldValue()` (`js/bulkEdit.js:430`) needs no changes for the new `shape` selector since select values are strings — but the nested write-path issue (AC-4) means coercion isn't the bottleneck; storage location is.
- No existing user items in localStorage have conflicting top-level `shape`, `composition`, or `diameter` keys that could collide with the proposed new fields.
- `formatBulkCellValue()` can be extended to handle dot-path traversal without breaking the existing weight/currency formatting switch cases.
- The existing `overflow-x: auto` scroll wrapper is structurally sufficient as a foundation for CSS sticky columns — sticky positioning requires the scroll container to be the direct ancestor of the sticky elements, which may or may not hold depending on how the table wrapper interacts with the modal body's flex layout.
- The `BULK_COLUMN_PRIORITY` array (28 defined keys at `js/bulkEdit.js:27-58`) will gain `diameter` as a new priority entry for consistent column ordering.

### Resolution Summary

- Accepted: 11
- Rejected: 2 (test infrastructure gap → discovery.md; column priority order → approach phase)
- Resolved with your input: 1 (tap target hybrid: 24px WCAG minimum + 44px effective on mobile)

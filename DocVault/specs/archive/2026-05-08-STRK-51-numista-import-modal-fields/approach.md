---
sketch: "STRK-51-numista-import-modal-fields"
phase: approach
created: 2026-05-07
---

# STRK-51 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

Keep the change centered on the existing Numista field-picker pipeline. The picker already has the right user-facing contract: every row has a checkbox, label, candidate value, current-value hint, and edited badge/default-off behavior when `fieldMeta[field].userModified` is true. STRK-51 expands that same contract from the current 8 visible rows to the Numista-backed fields that are already normalized, displayed in the Numista Data tab, and saved in `item.numistaData`.

The implementation should treat the modal as the decision point for both main form fields and Numista Data tab fields. Checked rows write candidate values into the matching form controls; unchecked rows leave the current local values alone. The async cache repopulation path must respect the same decision, because today it can repopulate Numista Data tab fields after the picker applies the checked main fields.

Field-level protection should continue to use the existing `fieldMeta` model rather than introducing a new preference or import-state store. The missing piece is broader caller coverage: save-time comparison needs to mark edited Numista Data fields, picker rendering needs to consult those keys, and force-overwriting a checked user-modified row needs to clear the same key.

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | Keep field-picker behavior Numista-only; apply shared import-modal scroll CSS to both Numista and PCGS | Requirements and acceptance criteria are about Numista, but discovery confirmed both modals share `.numista-results-modal-content`, making scroll behavior the trivially shared case requirements allow. PCGS lacks equivalent `fieldMeta` plumbing, so implementing PCGS protection would be a second feature | PCGS functional field coverage/userModified behavior remains a follow-up |
| D-2 | Expand the existing Numista picker with an explicit field-definition list in `js/catalog-api.js` | Fits the current vanilla JS pattern and keeps per-field availability, formatting, warnings, and target form IDs easy to audit | More verbose than a fully generic renderer |
| D-3 | Use existing normalized field keys as picker keys wherever possible (`diameter`, `mintage`, `kmRef`, `obverseDesc`, etc.) | Aligns picker rows with `fieldMeta` keys, `item.numistaData` keys, and saved userModified state | A few values need adapters because normalized API keys and form fields are not always one-to-one |
| D-4 | Preserve unchecked Numista Data rows by passing both the editing item's stored `numistaData` and a skip/preserve field set into `populateNumistaDataFields()` | Prevents the async cache layer from overwriting fields the user chose not to import, while preserving existing edit-open behavior for all other callers | Adds one optional preservation contract between `catalog-api.js` and `inventory.js` |
| D-5 | Add nested `numistaData` comparison during edit save for the STRK-51 fields | Current save-time tracking compares top-level fields only; fields like `mintage`, `rarityIndex`, `kmRef`, and side descriptions live under `numistaData` | Requires careful field-key mapping so top-level and nested names do not drift |
| D-6 | Use existing conversion behavior for special candidate values | `populateNumistaDataFields()` already formats `mintageByYear` and `kmReferences`; matching that keeps picker values consistent with the Numista Data tab | Multi-year mintage and structured references remain flattened as they are today |
| D-7 | Scope scrolling to the stacked import modals and make picker actions remain reachable | The expanded field list will exceed small viewports; the details modal already provides the flex/scroll precedent | CSS changes must be checked against results-list mode, field-picker mode, and PCGS modal reuse |

## File Map

_Every file this sketch will create, modify, or delete. Tasks.md will reference these paths._

### New

- _none required_

### Modified

- `js/catalog-api.js` — expand Numista picker field definitions, current-value hints, checked-field application, userModified clearing, and the `populateNumistaDataFields()` re-sync call contract
- `js/inventory.js` — extend `populateNumistaDataFields()` with an optional preserve/skip contract that avoids clearing or cache-filling fields the picker left unchecked
- `js/events.js` — compare saved `numistaData` fields and mark matching fieldMeta keys as user-modified when users edit them manually
- `css/styles.css` — add import-modal max-height/flex/overflow behavior and keep picker action buttons reachable with long field lists
- `tests/playwright/numista-picker-tags.spec.js` or `tests/playwright/numista-modal-fields.spec.js` — add focused coverage for expanded rows, edited defaults, preservation, and scroll/action visibility

### Deleted

- _none_

## Data / Schema Changes

- None — no schema, migration, or new persisted fields.
- Existing `item.numistaData` remains the stored metadata object.
- Existing `item.fieldMeta` remains the userModified tracking store; this work only broadens which existing keys are marked and read.

## Tradeoffs Surfaced for Review

- **Explicit field list vs. new abstraction:** The field-definition list will be longer, but it is easier to verify against STRK-51 and safer than a broad picker refactor.
- **Bulk edit:** The current bulk-edit path receives checked picker keys through `window._bulkEditNumistaCallback`. This approach keeps it from breaking, but does not require expanded bulk-edit behavior unless the same field rows work naturally with the existing callback.
- **PCGS:** Shared scroll CSS should cover the PCGS picker because it uses the same modal content class. PCGS field expansion and userModified protection should remain a follow-up issue.
- **Fineness:** Requirements mention fineness, but discovery did not find a distinct stored `fineness` field. Treat fineness as part of existing composition/purity behavior unless implementation finds a real stored field.

## Out of Scope (follow-up issues)

- Future issue: Expand PCGS import modal field coverage and add userModified protection if users can re-sync PCGS-backed values.
- Future issue: Add a distinct `fineness`/purity field only if the data model already has, or later needs, a separate stored value outside composition/purity.
- Future issue: Generalize import picker definitions across Numista, PCGS, and bulk-edit if the same pattern repeats after STRK-51.

## Risk Notes

- Risk: `populateNumistaDataFields()` currently clears fields before layering data sources. The preserve/skip contract must skip both clearing and cache fill for unchecked rows.
- Risk: Some candidate values are derived rather than direct API fields (`mintage`, `kmRef`, dimensions). The picker should use the same display conversion as the Numista Data tab.
- Risk: `commemorative` is a checkbox with a conditional description textarea, not a plain text field. The picker can show an import row for the boolean, but application must set the checkbox and description UI consistently.
- Risk: `fieldMeta` keys are flat while several saved values live under `numistaData`. Save-time tracking must map nested changes to the same flat keys the picker reads.
- Risk: Sticky actions inside a scrolling modal can overlap the final rows if padding is not adjusted. Verify small viewport behavior before shipping.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch tasks STRK-51`.

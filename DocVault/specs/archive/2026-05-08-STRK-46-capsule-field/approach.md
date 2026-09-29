---
sketch: "STRK-46-capsule-field"
phase: approach
created: 2026-05-08
---

# STRK-46 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

Two new top-level fields — `item.capsule` (string) and `item.capsuleNotes` (string) — follow the same lifecycle as existing user-entered fields like `notes` and `tags`. They are declared in `state.js`, bound in `init.js`, read on save in `events.js`, populated on edit/duplicate in `inventory.js`, and displayed in `viewModal.js`. No new JS files are needed — the feature distributes across existing modules.

The autocomplete and suggestion subsystem lives entirely in `autocomplete.js`, co-located with the existing `attachAutocomplete` infrastructure. A static `AIRTITE_CAPSULE_SIZES` array (~25 entries mapping mm diameters to Air-Tite model codes) powers both the autocomplete dropdown (AC-4) and the diameter-based suggestion hint (AC-3). The `LookupTable` typedef gains a `capsules` field populated by merging static Air-Tite entries with user-entered values extracted from inventory via `extractUniqueValues(data, "capsule")`. A `getNearestAirtiteSize(diameterMm)` function finds the closest match for the suggestion hint.

The HTML adds a new `grid grid-2` row in the Catalog Data section of Edit/Create modals, placed immediately after the existing Diameter/Thickness/Orientation row. This preserves the `grid-3-equal` layout of existing fields (AC-7) while visually grouping capsule data near the physical dimensions it relates to. A small suggestion hint element (e.g., `<span>`) appears below or beside the Capsule input, updated dynamically when the Diameter field changes.

## Key Decisions

| #   | Decision                                                                      | Rationale                                                                                                                                                                                                                               | Tradeoff                                                                                                                       |
| --- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| D-1 | Top-level `item.capsule` / `item.capsuleNotes`, not nested in `numistaData`   | `parseNumistaDataFields()` clears all nested fields when the Numista catalog number changes — would wipe user-entered capsule data. Search/filter arrays join top-level fields. `itemX` naming convention applies to user-entered data. | Slightly wider item object, but auto-handled by `structuredClone`, cloud sync, and clone-picker with zero code changes.        |
| D-2 | Air-Tite data + suggestion function co-located in `autocomplete.js`           | Keeps all autocomplete-related data and logic in one module. `PREBUILT_LOOKUP_DATA` is the existing pattern for static seed data.                                                                                                       | `autocomplete.js` grows by ~80 lines, but all additions are coherent with the file's purpose.                                  |
| D-3 | New `grid grid-2` row below Diameter/Thickness/Orientation for capsule fields | Preserves existing `grid-3-equal` layout integrity. Capsule + Capsule Notes are a natural pair (structured value + free-text annotation).                                                                                               | A fourth grid row in Catalog Data makes the section taller, but capsule is directly related to the physical dimension cluster. |
| D-4 | No field-meta integration for capsule                                         | `field-meta.js` tracks per-field Numista-vs-manual origin. Capsule is always manual — no Numista source exists. Adding it to field-meta would be dead code.                                                                             | If Numista ever adds capsule data (unlikely), field-meta would need retroactive wiring.                                        |
| D-5 | No new JS file                                                                | All changes fit within existing module boundaries. A dedicated `capsule.js` would fragment logic that belongs with its consumers.                                                                                                       | `autocomplete.js` carries the bulk of new code (~80 lines for data + suggestion logic).                                        |
| D-6 | Suggestion hint is display-only text, not a clickable chip                    | Clickable chip (auto-fill on click) adds event wiring, focus management, and accessibility concerns for modest UX gain. The hint text includes the model code so users can type it quickly.                                             | Users must manually type/paste the suggested value rather than clicking to accept it. Revisit if user feedback warrants.       |

## File Map

_Every file this sketch will create, modify, or delete. Tasks.md will reference these paths._

### New

- _none_

### Modified

- `index.html` — Add Capsule input (`itemCapsule`), Capsule Notes textarea (`itemCapsuleNotes`), and suggestion hint span in a new `grid grid-2` row after Diameter/Thickness/Orientation in the Catalog Data section (~line 2593).
- `js/state.js` — Register `itemCapsule: null` and `itemCapsuleNotes: null` in the `elements` object.
- `js/init.js` — Bind `elements.itemCapsule` and `elements.itemCapsuleNotes` via `safeGetElement`. Wire a diameter-change listener that calls `getNearestAirtiteSize()` and updates the suggestion hint.
- `js/autocomplete.js` — Add `AIRTITE_CAPSULE_SIZES` static array (~25 entries). Add `getNearestAirtiteSize(diameterMm)` function. Extend `LookupTable` typedef with `capsules` field. Extend `generateLookupTable` to extract and merge capsule values. Add `attachAutocomplete` call for `elements.itemCapsule`.
- `js/events.js` — Add `capsule` and `capsuleNotes` to item object construction on save (~line 1289).
- `js/inventory.js` — Populate `capsule` and `capsuleNotes` on edit modal open (~line 1328) AND duplicate modal open (~line 1679). Trigger suggestion hint update when populating an item with a known diameter.
- `js/viewModal.js` — Add capsule and capsuleNotes display rows in the Catalog Data section after Diameter/Thickness (~line 1191).
- `js/search.js` — Add `item.capsule || ""` to the `itemText` join array (~line 81).
- `js/filters.js` — Add `item.capsule || ""` to the filter `itemText` array (~line 1116) and ensure `searchCache` invalidation covers the new field.

### Deleted

- _none_

## Data / Schema Changes

None — no schema, migration, or persisted-data changes. New fields are simply absent (`undefined`) on existing items and defaulted to `""` on read. `structuredClone` in clone-picker auto-copies them. Cloud sync serializes the full `metalInventory` blob — new fields ride along automatically.

## Tradeoffs Surfaced for Review

- **Suggestion hint is display-only (D-6).** A clickable "Apply" chip would be nicer UX but adds event wiring, focus management, and accessibility (keyboard nav, ARIA). The current approach shows text like `Suggested: A-32 (32mm)` — users manually type the value. Worth revisiting post-launch if users request one-click apply.

- **Pre-existing `extractUniqueValues` key mismatch (out of scope).** During discovery, confirmed that `extractUniqueValues(data, "purchase_location")` and `"storage_location"` use snake_case keys while items store `purchaseLocation` / `storageLocation` (camelCase). The extraction silently returns empty arrays, masked by static fallback lists. This is a pre-existing bug unrelated to capsule work — the capsule call `extractUniqueValues(data, "capsule")` uses camelCase matching `item.capsule` and works correctly. Additionally, `extractUniqueValues` defaults `caseSensitive: false` — the capsule call must use `{ caseSensitive: true }` to preserve user-entered casing like `X-38-Ring`. The existing snake_case bug should be filed as a separate issue.

## Out of Scope (follow-up issues)

- **Fix `extractUniqueValues` key mismatch** — `"purchase_location"` / `"storage_location"` should be `"purchaseLocation"` / `"storageLocation"`. Causes user-entered purchase/storage locations to never appear in autocomplete. Separate bug.
- **Clickable suggestion chip** — One-click "Apply suggested capsule" UX enhancement if user feedback warrants it.
- **Capsule column in inventory table** — The field lives in Edit/Create/View modals only per requirements non-goals.
- **CSV import/export for capsule fields** — Incremental follow-up per requirements non-goals.

## Risk Notes

- **Two populate paths in `inventory.js`:** Both the edit (~1328) and duplicate (~1679) code paths independently populate form fields. Missing either one means capsule data silently doesn't appear when editing vs. duplicating. Tasks must cover both paths with explicit verification.
- **Diameter listener timing:** The diameter field is Numista-sourced and populated by `populateNumistaDataFields()`. The suggestion hint listener must fire on both manual input AND programmatic population. Use a named `updateCapsuleSuggestion()` function (exposed from `autocomplete.js`) shared by the input listener and the edit/duplicate populate paths — direct call after diameter normalization settles, not synthetic event dispatch.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch tasks STRK-46`.

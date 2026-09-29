---
sketch: "STRK-51-numista-import-modal-fields"
phase: discovery
created: 2026-05-07
---

# STRK-51 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

| Path                                               | Role                                             | Notes                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `js/catalog-api.js:302`                            | `USER_MODIFIED_TRACKED_FIELDS`                   | Drives the re-sync edited-field behavior for picker rows. It currently includes only `name`, `type`, `weight`, `year`, and `metal`; catalog and image rows are not tracked here.                                                                                                                                       |
| `js/catalog-api.js:642`                            | `normalizeItemData()`                            | Normalizes Numista results into the rich metadata shape used elsewhere: country, denomination, dimensions, thickness, mintage-by-year, references, shape, orientation, commemorative fields, technique, and side descriptions.                                                                                         |
| `js/catalog-api.js:731`                            | `fieldMeta` initialization                       | Calls `window.initFieldMeta(result, "numista")` on normalized API results, so normalized non-empty fields already get origin/userModified metadata.                                                                                                                                                                    |
| `js/catalog-api.js:1406`                           | `renderNumistaFieldCheckboxes()`                 | Builds the "Fields to fill" modal rows from a local hard-coded `fields` array. The current array is limited to Name, Catalog N#, Year, Type, Weight, Obverse Image, Reverse Image, and Metal.                                                                                                                          |
| `js/catalog-api.js:1497`                           | `currentFormValues` map                          | Supplies the "Current:" value hints for only the existing 8 picker rows. Numista Data tab fields are not represented.                                                                                                                                                                                                  |
| `js/catalog-api.js:1903`                           | `fillFormFromNumistaResult()`                    | Applies only checked picker rows, but its `switch` only handles the existing 8 keys. Bulk-edit mode also forwards only checked row keys.                                                                                                                                                                               |
| `js/catalog-api.js:1996`                           | re-sync data-tab population                      | After filling checked picker fields, the code caches selected metadata and calls `populateNumistaDataFields(catId)` without passing the editing item's stored `numistaData`.                                                                                                                                           |
| `js/catalog-api.js:2040`                           | userModified clearing                            | Clears `userModified` only for checked keys present in `USER_MODIFIED_TRACKED_FIELDS`, so unlisted fields cannot participate in force-overwrite clearing.                                                                                                                                                              |
| `js/inventory.js:1158`                             | `populateNumistaDataFields(catalogId, itemData)` | Knows the full Numista Data tab field map and preserves stored `itemData` before cache values when `itemData` is passed. It also formats `mintageByYear` and `kmReferences` for flat form fields.                                                                                                                      |
| `js/inventory.js:1498`                             | edit modal population                            | Existing edit flow calls `populateNumistaDataFields(item.numistaId \|\| item.catalog \|\| "", item.numistaData)`, so normal edit-open behavior preserves saved user metadata.                                                                                                                                          |
| `js/events.js:1320`                                | `parseNumistaDataFields()`                       | Saves Numista Data tab values into `item.numistaData`, including the fields named by STRK-51. It stores only non-empty/true values.                                                                                                                                                                                    |
| `js/events.js:1492`                                | edit save userModified list                      | Marks top-level edited fields such as `composition`, `country`, `denomination`, `shape`, `diameter`, `thickness`, `length`, `width`, `orientation`, and `technique`; it does not currently track nested `numistaData` keys such as `mintage`, `rarityIndex`, `kmRef`, commemorative description, or side descriptions. |
| `js/field-meta.js:29`                              | `initFieldMeta()`                                | Generic metadata generator for every non-empty normalized key except internal metadata fields. No DOM coupling.                                                                                                                                                                                                        |
| `js/field-meta.js:59`                              | `markUserModified()`                             | Can create or update metadata entries for any field name; the limiting factor is which callers invoke it.                                                                                                                                                                                                              |
| `index.html:7707`                                  | Numista modal markup                             | `#numistaResultsModal` uses `.numista-results-modal-content` with a header, `.modal-body`, result list, field picker, and action buttons.                                                                                                                                                                              |
| `index.html:7748`                                  | PCGS modal markup                                | PCGS reuses `.numista-results-modal-content`, so modal sizing changes to that class can affect both Numista and PCGS stacked modals.                                                                                                                                                                                   |
| `css/styles.css:4575`                              | details modal scroll pattern                     | `#detailsModal .modal-content` is already flex-column with viewport-height constraints, and `#detailsModal .modal-body` scrolls independently.                                                                                                                                                                         |
| `css/styles.css:10050`                             | Numista modal sizing                             | `.numista-results-modal-content` currently sets only `max-width: 600px` and `width: 90%`; the results list has its own `max-height`, but the field picker/modal body does not.                                                                                                                                         |
| `js/pcgs-api.js:403`                               | `renderPcgsFieldCheckboxes()`                    | Parallel field-picker pattern for PCGS, with 7 fields. It does not use `fieldMeta`/`USER_MODIFIED_TRACKED_FIELDS` today.                                                                                                                                                                                               |
| `tests/playwright/numista-picker-tags.spec.js:429` | userModified picker coverage                     | Existing Playwright coverage proves a scalar `fieldMeta.name.userModified=true` picker row defaults unchecked with an edited hint.                                                                                                                                                                                     |
| `tests/playwright/numista-picker-tags.spec.js:466` | force-overwrite coverage                         | Existing Playwright coverage proves checking a userModified scalar field and filling clears the flag for `name`.                                                                                                                                                                                                       |

## Prior Decisions

- 2026-04-19, commit `89f8e357` (`v3.34.12 — STAK-556`) — added Numista picker tag checkboxes and `userModified` picker behavior. The current tracking set was intentionally narrow to the picker scalar fields available at that time.
- 2026-04-16, commit `91dddbd3` — expanded the Numista Data field map in `populateNumistaDataFields()` and added formatting for mintage and KM references.
- 2026-02-19, commit `9038e679` — established `populateNumistaDataFields()` as a layered data population path: stored item data first, cached API metadata second.
- Existing Playwright tests for STAK-556 are good precedent for STRK-51: they assert visible edited hints, default checked/unchecked state, and userModified clearing through the actual modal path.

## External References

- None needed for library behavior. This is a vanilla JS/CSS workflow and data-wiring change using existing StakTrakr modal patterns.

## Constraints

- The implementation must not add new persisted data fields; requirements limit the work to fields already normalized, displayed, or stored by StakTrakr.
- Missing Numista candidate values must not become checked overwrite options. `initFieldMeta()` and the existing picker already skip/disable empty values in different places, so approach should preserve that behavior.
- Some normalized Numista values are not form-ready one-to-one values. `mintage` comes from `mintageByYear[0].mintage`; `kmRef` comes from `kmReferences`; `commemorative` is boolean with a separate description field.
- Dimension handling has shape-aware follow-up behavior in the edit modal. Diameter, length, and width should be treated carefully because rectangular values can migrate between fields after population.
- Scroll changes to `.numista-results-modal-content` may affect the Numista results modal, Numista field picker state, PCGS field picker, and any other stacked modal sharing that class.
- Bulk-edit mode uses the same Numista field checkbox rows but routes checked values through `window._bulkEditNumistaCallback`. Discovery did not verify whether STRK-51 should expand bulk-edit behavior; approach should explicitly decide whether it is in scope.
- PCGS has a similar picker shape but lacks the same fieldMeta tracking path. Requirements treat PCGS as discovery-only unless a shared modal-size change or helper naturally covers it.

## Open Questions

None blocking approach. Approach should make explicit scope decisions for bulk-edit behavior and for shared CSS effects on the PCGS modal.

## Discovery Summary

The missing protection is not in Numista normalization or storage: rich Numista data is already normalized, cached, displayed in the Numista Data tab, and saved into inventory items. The gap is concentrated in the picker path, where only 8 rows are offered, only 5 scalar keys participate in userModified protection, and re-sync repopulates cached Numista Data fields without the stored item metadata that normal edit-open uses for preservation. CSS has an existing scroll precedent in the details modal, but the shared `.numista-results-modal-content` class means sizing changes need to be checked across Numista and PCGS stacked modals.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-51`.

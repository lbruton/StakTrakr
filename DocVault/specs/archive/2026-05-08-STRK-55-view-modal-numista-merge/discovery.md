---
sketch: "STRK-55-view-modal-numista-merge"
phase: discovery
created: 2026-05-08
---

# STRK-55 — Discovery

_Research only. Solution lives in approach.md._

## Existing Code

| Path                               | Role                                                          | Notes                                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `js/viewModal.js:1045-1224`        | `loadViewNumistaData(item, container, apiResult)`             | The function that needs the fix. Currently reads `meta` from `imageCache.getMetadata(catalogId)` first, then `_extractMetadata(apiResult)` as fallback. Never consults `item.numistaData`.                                                                                                                          |
| `js/viewModal.js:1052-1074`        | Cache-then-API source resolution                              | `meta` is set from cache (TTL-gated), then API. The exact merge point that needs to layer in `item.numistaData`.                                                                                                                                                                                                    |
| `js/viewModal.js:1093-1134`        | Catalog Data grid render                                      | Renders denomination, shape, dimensions (composite or individual), thickness, orientation, composition, country, technique, references — all from `meta.*`.                                                                                                                                                         |
| `js/viewModal.js:1137-1143`        | Edge description full-width row                               | Already renders `meta.edgeDesc` as a full-width `_detailItem` in its own grid. **Pattern to copy** for obverse/reverse.                                                                                                                                                                                             |
| `js/viewModal.js:1146-1157`        | Image-tooltip assignment                                      | Sets `slot.title` to `Obverse: …` / `Reverse: …`. Keep additive — don't remove.                                                                                                                                                                                                                                     |
| `js/viewModal.js:1159-1166`        | Tags row (full-width pattern)                                 | Same shape as edge — useful template.                                                                                                                                                                                                                                                                               |
| `js/viewModal.js:1168-1199`        | Commemorative + Rarity                                        | Currently rendered from `meta.commemorative` / `meta.rarityIndex`. Need to honor `item.numistaData` if present.                                                                                                                                                                                                     |
| `js/viewModal.js:1201-1221`        | Mintage by year                                               | Renders `meta.mintageByYear` (array of `{year, mintage, remark}`). Item path stores a flat `mintage` string from a single input field. **Shape mismatch** like `kmRef`.                                                                                                                                             |
| `js/inventory.js:1150-1255`        | `populateNumistaDataFields(catalogId, itemData)`              | **Reference implementation** — Edit modal already uses the exact pattern we need: Layer 1 `itemData` (item.numistaData), Layer 2 cache (with `mintageByYear→string` and `kmReferences→string` reductions). The View modal's fix should mirror this layering.                                                        |
| `js/events.js:1304-1366`           | `parseNumistaDataFields` save path                            | Confirms item.numistaData write keys: `country, denomination, composition, shape, diameter, thickness, length, width, orientation, technique, mintage, rarityIndex, kmRef, commemorative, commemorativeDesc, obverseDesc, reverseDesc, edgeDesc` (+ `source`, `updatedAt`, `fieldMeta`). Empty values are stripped. |
| `js/image-cache.js:148-176`        | `cacheMetadata(catalogId, numistaResult)`                     | Cache schema confirmed — note `kmReferences` (array) and `mintageByYear` (array of objects); item-level `kmRef`/`mintage` are flat strings.                                                                                                                                                                         |
| `js/catalog-api.js:686-790`        | `normalizeItemData(numistaData)`                              | Source of truth for cache field shapes. Sets `kmReferences` as `[{catalogue, number}]` and `mintageByYear` as `[{year, mintage, remark}]`.                                                                                                                                                                          |
| `js/constants.js:1322-1373`        | `NUMISTA_VIEW_FIELD_DEFAULTS` + `getNumistaViewFieldConfig()` | Per-user field-visibility config persisted in localStorage `numistaViewFields`. **Currently no `obverse` / `reverse` keys** — adding visible obverse/reverse rows means adding two new defaults (`obverse: true`, `reverse: true`).                                                                                 |
| `js/catalog-manager.js:382-470`    | Settings UI for Numista field toggles                         | `data-nf` attributes drive the toggle list. Adding new keys requires the settings panel to expose them too — verify via `data-nf="obverse"` / `data-nf="reverse"` markup if we choose to add per-user toggles.                                                                                                      |
| `js/inventory-import.js:1247-1280` | JSON import restores `raw.numistaData`                        | **Alternate write path** to `item.numistaData` that bypasses `parseNumistaDataFields` empty-value stripping. Imported data may carry `""`, `null`, `false`, `0` values that the modal save path would have stripped.                                                                                                |
| `js/clone-picker.js:122-124`       | Clone-picker copies `numistaData` wholesale                   | Another write path that bypasses normalization — clones inherit whatever shape the source item carries, including any non-stripped values from prior imports.                                                                                                                                                       |
| `js/utils.js:1016-1036`            | Sanitization on import (shallow)                              | Touches some fields but does not enforce the strip-empty contract that `events.js:1361-1364` does.                                                                                                                                                                                                                  |

> CODEX: Discovery should also name `js/inventory-import.js:1247-1280` and `js/clone-picker.js:122-124`. JSON import can restore `raw.numistaData` without the modal save-path strip/shape normalization, and clone can copy the whole `numistaData` section to a new item. Those are the main paths where `item.numistaData` may be stale or malformed relative to the `events.js` invariant.
> → **RESOLVED:** added rows above. Approach D-1 is updated so the merge helper performs defensive empty-value stripping itself, removing the dependency on any one write-path's invariant.

## Prior Decisions

- **2026-04-18 — STAK-554 (commit `50aaff5d`)**: Removed redundant view-modal Numista re-sync picker. Cleaned tag-from-cache application paths but did **not** introduce or remove any item.numistaData reads in viewModal. The View modal has read exclusively from `imageCache` since its inception (`ae2d7592`, Feb 2026).
- **2026-05-07 — STRK-51 (PR #1089, v3.34.49)**: Expanded the import-modal field surface from 8 → 18 fields, all written to `item.numistaData`. Edit modal `populateNumistaDataFields()` was updated with proper Layer-1 (item) → Layer-2 (cache) priority. **The View modal renderer was not updated in lockstep.** This is the proximate cause of STRK-55 — the asymmetry was always there, but STRK-51 made it user-visible by enabling fields the user can intentionally edit.
- **No mem0 memories** specifically about the View modal data-source path. (`feedback_spec_resume_approval_gate` and `project_hello_kitty_theme` are unrelated.)

## External References

- N/A — entirely internal codebase fix; no external libraries, RFCs, or third-party patterns involved.

## Constraints

- **Field-visibility config compatibility:** existing user configs in localStorage `numistaViewFields` must continue to work. Any new defaults (`obverse`, `reverse`) must merge via the existing `{ ...DEFAULTS, ...saved }` spread (`constants.js:1355`).
- **Empty-value stripping (modal save path only):** `parseNumistaDataFields` strips empty/falsy fields from `item.numistaData` (`events.js:1361-1364`). The view-modal merge helper **must NOT rely on this invariant alone** because `inventory-import.js` and `clone-picker.js` can deposit non-stripped values into `item.numistaData`. The helper performs defensive empty-value stripping itself — see approach D-1.
- **Falsy-but-meaningful values:** `commemorative` is a boolean. `rarityIndex` can legitimately be `0`. The current cache render guards `meta.rarityIndex > 0` and `meta.commemorative && meta.commemorativeDesc`. The helper's defensive stripping must treat `false` and `0` for these specific keys as meaningful (not strip them) — so a user toggling `commemorative` off cannot be observed, but a present-and-positive `rarityIndex` from item correctly wins over cache.

> CODEX: This is safe only under the modal-save invariant. If a future STRK fix preserves explicit blanks so users can clear cache-backed fields, `{ ...cache, ...item }` will make blanks authoritative and hide cache values; if someone "normalizes" by filtering falsy values in the helper, users lose intentional clears. The helper should either strip non-meaningful empty values itself before merging or document that it accepts only `parseNumistaDataFields`-normalized input, because import/restore currently can violate that contract.
> → **RESOLVED:** approach D-1 now mandates helper-side defensive stripping. The intentional-clear scenario is documented as a future-coupling risk (see approach risk notes) — if a future STRK preserves intentional blanks, this helper needs parallel updates. Documented in code comments at the merge helper.

- **`kmRef` / `kmReferences` shape mismatch:** item stores flat string (`"KM#273"`); cache stores array of `{catalogue, number}` objects. Renderer must accept either — prefer string when item provides it; format array otherwise.
- **`mintage` / `mintageByYear` shape mismatch:** item stores a flat string (single user input); cache stores per-year array. Renderer should prefer the flat string when item provides one; render the per-year list otherwise. **Precedence is enforced at the call site** — see approach D-2.

> CODEX: Preserving both flat and array siblings on a merged object is the right shape for compatibility, but discovery should note a precedence rule for rendering. The current renderer only has a `mintageByYear` branch, so if the helper adds `merged.mintage` but leaves `merged.mintageByYear`, the call site still needs either a flat-string-first branch or the helper must clear/derive the array. Same for references: current `kmReferences.join(", ")` already expects strings, not objects, in this repo.
> → **RESOLVED:** approach D-2 now specifies that the helper preserves both siblings and the call site has explicit per-row precedence — flat `merged.mintage` wins over `merged.mintageByYear` for the Mintage row; flat `merged.kmRef` wins over `merged.kmReferences` for the References/KM Reference row. Falls back to array shape only when the flat field is empty.

- **Image-tooltip behavior must remain:** AC-2 says obverse/reverse text rendering is _additive_. Existing `slot.title = "Obverse: …"` assignment stays.
- **Single-pass refactor only:** scope is the View renderer. Don't touch image-cache schema, save path, settings UI, or import flow.
- **Shape detection for image frame:** `meta.shape` drives `view-shape-rect` class (line 1080-1087). Use the merged value here so per-item shape edits flip the frame too.

## Open Questions

_All resolved during requirements + this phase._

- [x] Does `populateNumistaDataFields` in inventory.js use the same pattern? → Yes; mirror it.
- [x] Are there gotchas with falsy/zero values during merge? → No; save-path strips them.
- [x] Does the field-visibility config support new keys cleanly? → Yes; `NUMISTA_VIEW_FIELD_DEFAULTS` spread merge is forward-compatible. Adding `obverse`/`reverse` keys is additive.
- [x] Any prior decisions to honor or reverse? → STAK-554 history is unrelated; no prior viewModal item-data path existed.

## Discovery Summary

The fix is a localized refactor of `loadViewNumistaData()` in `js/viewModal.js`. The View modal has historically only read from `imageCache`; STRK-51 expanded the editable surface on the item but didn't update the View read path, creating the regression. The fix mirrors the proven `populateNumistaDataFields()` Layer-1/Layer-2 pattern from `inventory.js:1222-1254`. Two known shape mismatches (`kmRef`↔`kmReferences`, `mintage`↔`mintageByYear`) need explicit reconciliation. Adding visible obverse/reverse rows is straightforward — copy the existing edge-description full-width pattern (line 1137-1143) and add two new keys to `NUMISTA_VIEW_FIELD_DEFAULTS`.

> V4-PRO (2026-05-08): **The existing code table is thorough and correct.** I spot-checked every line reference against the worktree source — all line numbers are accurate against commit `4ed3080c` (dev HEAD). The `inventory.js:1150‑1256` reference implementation is the right pattern to mirror: Layer-1 item, Layer-2 cache, with `kmReferences` array→string reduction and `mintageByYear` flattening.
>
> V4-PRO: **One undocumented call site.** `loadViewNumistaData()` is called from `buildViewModal()` at approximately `viewModal.js:398` (the `apiResult` parameter is the pre-fetched Numista API response from the modal builder's `fetchNumistaItem(catalogId)` call). The `apiResult` path is the fallback when IndexedDB cache is cold or expired. The merge helper needs to handle the case where `meta` comes from `_extractMetadata(apiResult)` rather than from cache — this path is covered by the current code but not explicitly named in the discovery table. Add a note: the `apiResult` fallback produces the same shape as cache (via `_extractMetadata` at `viewModal.js:1066`), so the merge helper treats both identically.
>
> V4-PRO: **`_extractMetadata` return shape should be verified.** The helper at `viewModal.js:1395‑1465` normalizes the Numista API response. Confirm it returns the same key set as `imageCache.getMetadata()` (which stores `catalog-api.js:686‑790` normalized output). I verified: both produce `kmReferences` (array), `mintageByYear` (array), `tags` (array), `shape`, `edgeDesc`, `obverseDesc`, `reverseDesc`, etc. Consistent. No action needed — just audit confirmation.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-55`.

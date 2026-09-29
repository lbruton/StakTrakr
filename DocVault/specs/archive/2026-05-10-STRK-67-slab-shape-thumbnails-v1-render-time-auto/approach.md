---
sketch: "STRK-67-slab-shape-thumbnails"
phase: approach
created: 2026-05-10
---

# STRK-67 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

A collector with a slabbed coin — say a round platinum piece in an NGC assay slab — uploads a photo of the slab. The slab is rectangular, but StakTrakr clips the thumbnail to a circle because all coins get circular rendering. The user sees their slab edges cut off in the inventory table, in the card grid, and in the item view modal. The only workaround today is changing the item type to "bar," which is wrong. This patch makes all three views shape-aware and slab-aware so the right frame shape is chosen automatically.

The fix uses a **two-phase shape resolution** strategy applied consistently across all three views (inventory table, card grid, item view modal):

**Phase 1 — Sync render (shape-awareness).** When building the initial HTML/DOM for a thumbnail or image section, extend the existing type-only rectangular check to also consult `item.numistaData?.shape`, normalized through `classifyShape()` from `catalog-api.js:528`. The category is treated as round only when it equals `"round"`; everything else (`"rectangular"`, `"square"`, `"oval"`, `"other"`) gets the rectangular class. This handles non-round coins with zero async overhead — `numistaData` is already on the inventory item at render time. Items with no `numistaData.shape` produce `classifyShape("")` → `"round"` (its no-input default), which preserves current behavior for un-synced/manually entered items.

- **Inventory table:** extend `_isRectThumb` at `inventory-table.js:513`. The lowercased item type is already in scope; add a shape branch using `classifyShape(item.numistaData?.shape) !== "round"`.
- **Card grid:** extend `isRect` in `_cardImageHTML` at `card-view.js:551`. Same predicate. The existing `fitStyle` ternary at `card-view.js:569` (`object-fit: cover` for round, `contain` for rect) automatically follows from the broader `isRect`, so non-round Numista coins get the correct fit at sync time too.
- **View modal:** extend `isRectShape` in `_buildImageSection` at `viewModal.js:255`. The late override at `viewModal.js:1174` (inside `_renderNumistaSection`) stays in place as a safety net for items where `numistaData` is empty but Numista API metadata fills in shape on-the-fly; at that point the broader sync check has already fired so the late override usually no-ops.

**Phase 2 — Async override (slab + user image).** All three views have an async image loading path that resolves images from IndexedDB. For items with `gradingAuthority` set (any TPG; `certNumber` is informational), the async loader probes for a user-uploaded image via `imageCache.getUserImage(uuid)` (returns the record `{ uuid, obverse, reverse, ... }` without allocating an object URL — see `image-cache.js:474`) and inspects `rec?.[side]?.size > 0`. If that's true, the loader toggles the rectangular shape class onto the DOM element. A user-uploaded photo of a graded coin is overwhelmingly a slab photo, which is always rectangular regardless of the coin's natural shape. If no user image exists (Numista catalog image or pattern image shows the coin itself, not the slab), the shape stays as the sync render decided it.

- **Inventory table:** add override in `_loadThumbImage` at ~line 323 — toggle `table-thumb-rect` on the `<img>`'s coin-image wrapper.
- **Card grid:** add override in `_loadCardImage` at ~line 1120 — toggle `bar-shape` on the wrapping `.coin-img` element AND set `img.style.objectFit = "contain"` (overriding the sync default `"cover"` baked in at `card-view.js:569`). Without the `objectFit` flip the wrapper becomes rectangular but the slab image still gets center-cropped, defeating the fix.
- **View modal:** add override in `loadViewImages` at ~line 1033, toggling `view-shape-rect` on `#viewImageSection`.

No changes are needed to `image-cache.js` — the existing `getUserImage()` API already provides the exact signal needed. No new CSS is needed either — the existing rectangular classes (`table-thumb-rect`, `bar-shape`, `view-shape-rect`) already produce the correct rendering in each view.

## Key Decisions

| #   | Decision                                                                                                                             | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Tradeoff                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Normalize `numistaData.shape` through `classifyShape()` for the round-vs-rectangular decision                                        | `classifyShape()` (catalog-api.js:528) already handles the prefixes Numista actually returns: `"Circular ..."` and `"Round ..."` collapse to `"round"`; `"Rectangular (41.8mm wide)"` collapses to `"rectangular"`; `"Square"`, `"Oval"`, `"Other"` are categorized too. A raw `s !== "round" && s !== "circular"` compare misses `"Round (with hole)"`, `"Circular pattern"`, etc. Using `classifyShape()` keeps the three views consistent with the rest of the catalog code and is exposed on `window` (catalog-api.js:2661) so all three call sites can use it | One extra function call per row — sub-microsecond, immaterial vs the IntersectionObserver render gating                                                                                                     |
| D-2 | Guard against empty shape via `classifyShape()`'s built-in default rather than a manual `if (shapeStr)`                              | `classifyShape("")` and `classifyShape(null)` both return `"round"` (catalog-api.js:529). Comparing the result to `"round"` correctly defaults un-synced/empty items to round without a separate guard                                                                                                                                                                                                                                                                                                                                                             | Couples our predicate to `classifyShape`'s default behavior. Acceptable — that default is the existing convention used elsewhere in the codebase                                                            |
| D-3 | Probe for user images via `imageCache.getUserImage(uuid)` (returns the record), not `getUserImageUrl()`                              | `getUserImageUrl()` always allocates a new object URL via `URL.createObjectURL(blob)` (image-cache.js:419) and the API contract requires the caller to revoke it. Using it as a boolean leaks one URL per slab item per render. `getUserImage(uuid)` returns `{ uuid, obverse, reverse, ... }` with raw blobs; checking `rec?.[side]?.size > 0` is the same signal with no allocation                                                                                                                                                                              | Reads the full record (both blobs) instead of just the side we care about. Blob handles are cheap (no decode); negligible memory cost vs the leak risk of the URL probe                                     |
| D-4 | Slab override triggered by `gradingAuthority` only — `certNumber` is informational                                                   | A populated `gradingAuthority` is the canonical signal that the coin is in a TPG slab. `certNumber` can be present on raw coins as a self-recorded reference, or absent on slabs where the user didn't bother to type the long number. The user confirmed this scoping in the requirements review                                                                                                                                                                                                                                                                  | Items with `certNumber` set but no `gradingAuthority` (rare, user-error / partial entry) won't trigger the slab override. They'll fall through to the shape rule, which is the correct conservative default |
| D-5 | In card grid view, the async slab override sets `img.style.objectFit = "contain"` in addition to toggling `bar-shape` on the wrapper | `_cardImageHTML()` (card-view.js:569) inlines `object-fit: cover` for round items into the `<img>` `style` attribute. The `bar-shape` class only changes border-radius. Without the `objectFit` flip, the wrapper becomes rectangular but the slab image still gets cropped to fill (center-cropped), hiding the slab edges — which is the original bug. Inventory table and view modal don't have this issue because their CSS classes drive `object-fit` (no inline style override)                                                                              | Mutates inline style instead of toggling a class. Acceptable for an async one-off; if a future refactor moves card-view to class-based fit, this line can be removed                                        |

## File Map

_Every file this sketch will create, modify, or delete. Tasks.md will reference these paths._

### New

- _none_

### Modified

- `js/inventory-table.js` — (1) extend `_isRectThumb` at line 513 to include `classifyShape(item.numistaData?.shape) !== "round"`; (2) add slab+user-image override in `_loadThumbImage` at ~line 323 (probe via `imageCache.getUserImage(uuid)`, toggle `table-thumb-rect`)
- `js/card-view.js` — (1) extend `isRect` in `_cardImageHTML` at line 551 to include the same `classifyShape` predicate (the existing `fitStyle` ternary at line 569 then automatically picks `contain` for sync-detected non-round items); (2) add slab+user-image override in `_loadCardImage` at ~line 1120 — toggle `bar-shape` on the `.coin-img` wrapper AND set `img.style.objectFit = "contain"`
- `js/viewModal.js` — (1) extend `isRectShape` in `_buildImageSection` at line 255 to include the same predicate against `item.numistaData?.shape`; (2) add slab+user-image override in `loadViewImages` at ~line 1033, toggling `view-shape-rect` on `#viewImageSection`. The late override at line 1174 stays as-is — it now usually no-ops but remains a safety net for items where `numistaData.shape` was empty at sync time and the Numista API fills it in via `_renderNumistaSection`.

### Deleted

- _none_

## Data / Schema Changes

None — no schema, migration, or persisted-data changes. The `shape`, `certNumber`, and `gradingAuthority` fields already exist on inventory items.

## Tradeoffs Surfaced for Review

**Brief shape flash for slabbed coins with user photos.** The sync render (Phase 1) does not know whether a user image exists — that requires an async IDB lookup. So a slabbed coin with a user-uploaded slab photo will initially render with whatever shape the sync check produces (round if the coin is round), then snap to rectangular once the async loader confirms a user image exists. This is the same visual pattern already present for image loading (thumbnails appear after IntersectionObserver fires), and the 200px rootMargin pre-load buffer means the snap happens before the user scrolls to the row in most cases. Not worth adding a sync flag to avoid — it would require a synchronous IDB check or a new `item.hasUserImage` property maintained on every save.

## Out of Scope (follow-up issues)

- **Per-shape CSS clip paths** (oval, square) — current binary round/rectangle model is sufficient. See requirements non-goals.
- **Enroll `obverseImageUrl`/`reverseImageUrl` in fieldMeta tracking** — would allow distinguishing Numista-synced URLs from user-pasted URLs, but adds complexity with no clear user benefit for this fix.

## Risk Notes

- **Low risk.** The shape check is additive — it only widens the set of items that get `table-thumb-rect` / `bar-shape` / `view-shape-rect`. Existing type-based rectangular items (bars, notes, aurum, sets, goldbacks, silverbacks) are unaffected because they already pass the first condition in the `||` chain.
- **D-2 (empty-shape default) is the one correctness-critical detail.** Routing through `classifyShape()` and comparing the result to `"round"` automatically covers the empty case (`classifyShape("")` → `"round"`). If a future refactor changes that default, items with no Numista shape would flip to rectangular en masse. Sketch tasks must include a unit-level assertion for the empty-shape case.
- **D-3 (no object-URL leak) is the second correctness-critical detail.** Implementations must use `getUserImage(uuid)` and inspect the blob `size`, not call `getUserImageUrl()` and discard the URL. A reviewer scanning for `getUserImageUrl(` near the new override code is a sufficient check.
- **D-5 (card-view objectFit) must not be skipped.** A PR that toggles `bar-shape` but leaves `object-fit: cover` on the `<img>` will pass shape-class assertions but still ship the original visual bug.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch tasks STRK-67`.

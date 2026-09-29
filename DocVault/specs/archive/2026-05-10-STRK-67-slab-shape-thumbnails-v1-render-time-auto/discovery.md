---
sketch: "STRK-67-slab-shape-thumbnails"
phase: discovery
created: 2026-05-10
---

# STRK-67 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

### Thumbnail shape logic — the three views

| Path                            | Role                                                    |                      Shape-Aware?                       |
| ------------------------------- | ------------------------------------------------------- | :-----------------------------------------------------: |
| `js/viewModal.js:1173-1180`     | View modal image section shape override                 | Yes — checks `merged.shape` via `mergeNumistaSources()` |
| `js/viewModal.js:253-263`       | View modal initial image section (`_buildImageSection`) |            Partial — checks `item.type` only            |
| `js/inventory-table.js:512-520` | Inventory table thumbnail shape class                   |              No — checks `item.type` only               |
| `js/inventory-table.js:544-551` | Applies `table-thumb-rect` class to `<img>` tag         |                 N/A — consumer of above                 |
| `js/card-view.js:550-560`       | Card grid thumbnail shape (`_cardImageHTML`)            |              No — checks `item.type` only               |

**The bug:** `inventory-table.js:512` and `card-view.js:550` both use this identical pattern:

```javascript
const _thumbType = (item.type || "").toLowerCase();
const _isRectThumb =
  _thumbType === "bar" ||
  _thumbType === "note" ||
  _thumbType === "aurum" ||
  _thumbType === "set" ||
  item.weightUnit === "gb" ||
  item.weightUnit === "sb";
```

No `item.shape` check. No slab awareness.

**The fix reference:** `viewModal.js:1173` already has the binary shape check:

```javascript
const shapeStr = (typeof merged.shape === "string" ? merged.shape : "").toLowerCase();
const isNonRound = shapeStr !== "round" && shapeStr !== "circular";
```

### Shape classification and storage

| Path                        | Role                                                         | Notes                                                                                                       |
| --------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `js/catalog-api.js:528-536` | `classifyShape(shapeStr)` — normalizes Numista shape strings | Returns: "round", "rectangular", "square", "oval", "other". Exported as `window.classifyShape` at line 2661 |
| `js/events.js:1371`         | Reads shape from form field `#numistaShape` on save          | `shape: getOrPrev("numistaShape", prev.shape)`                                                              |
| `js/catalog-api.js:760`     | Stores raw shape from Numista API import                     | `shape: numistaData.shape \|\| ""`                                                                          |

**Data path:** Shape lives in `item.numistaData.shape` (raw Numista string like "Circular", "Rectangular 41.8mm wide"). The view modal accesses it via `mergeNumistaSources(item.numistaData, meta)` which returns a `merged` object with `.shape`. For grid views, the raw value is available as `item.numistaData?.shape`.

### User-uploaded images (IndexedDB)

| Path                        | Role                                 | Notes                                                         |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------- |
| `js/image-cache.js:75-76`   | `userImages` object store creation   | Keyed by `item.uuid`                                          |
| `js/image-cache.js:413-420` | `getUserImageUrl(uuid, side)`        | Returns object URL for user-uploaded image                    |
| `js/image-cache.js:475-479` | `getUserImage(uuid)`                 | Retrieves full record (obverse/reverse Blobs)                 |
| `js/image-cache.js:337-371` | `resolveImageForItem()`              | Returns `{ catalogId, source: "user"                          | "pattern" }` — knows the source |
| `js/image-cache.js:382-404` | `resolveImageUrlForItem(item, side)` | Returns blob URL only — does NOT expose source type to caller |

**Record shape:** `{ uuid, obverse: Blob|null, reverse: Blob|null, sharedImageId, cachedAt, size }`

### Async image resolution pipeline (grid views)

Both inventory table and card grid use the same pattern:

1. **Sync HTML render** — builds `<img>` with `data-item-uuid`, `data-catalog-id`, etc. Shape class (`table-thumb-rect` / `bar-shape`) decided here, currently type-only.
2. **IntersectionObserver** — fires when thumbnail scrolls into view (`inventory-table.js:288-296`, `card-view.js:1071-1086`).
3. **Async resolution** — `_loadThumbImage()` (`inventory-table.js:299-352`) / `_loadCardImage()` (`card-view.js:1093-1130`) calls `imageCache.resolveImageUrlForItem(item, side)` which internally tries user image first, then pattern image.
4. **Image swap** — blob URL set on `img.src`, fallback to CDN URL, fallback to placeholder.

**Key insight:** The async resolution step already has access to the DOM element AND already determines whether it's showing a user image. The shape class can be applied/adjusted at this point. However, `resolveImageUrlForItem` currently returns only a URL string — it doesn't tell the caller whether the URL came from user upload vs pattern image. Either the return value needs enriching, or the slab check can call `getUserImageUrl` directly before the cascade.

### Image source detection — three sources, two storage mechanisms

| Source                            | Storage                                                       |                     Detectable?                      |
| --------------------------------- | ------------------------------------------------------------- | :--------------------------------------------------: |
| User-uploaded photo (camera/file) | IndexedDB `userImages` store, keyed by `item.uuid` (Blob)     | Yes — `getUserImageUrl(uuid, side)` returns non-null |
| Numista-synced URL                | `item.obverseImageUrl` / `item.reverseImageUrl` (string)      |     No — indistinguishable from user-pasted URLs     |
| User-pasted URL                   | Same `item.obverseImageUrl` / `item.reverseImageUrl` (string) |     No — identical storage path to Numista URLs      |

The `fieldMeta` system (`js/field-meta.js`) tracks per-field origin (`numista`, `pcgs`, `manual`) and `userModified` status, but `obverseImageUrl` / `reverseImageUrl` are **not enrolled** in the tracked fields list (`events.js:1530-1563`). Adding them is possible but out of scope for this sketch.

**Decision:** The slab-to-rectangle override fires ONLY for IndexedDB user-uploaded images (Blob source). All URL-based images — whether Numista-synced or user-pasted — are treated as catalog-like and respect the coin's `shape` field. This avoids a false positive where Numista serves a non-round image for a round coin and we'd wrongly force it rectangular. A user who pastes a slab photo URL instead of uploading it gets round treatment — an acceptable edge case.

### Certification/grading fields

| Path                            | Role                           | Notes                                                        |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| `js/events.js:1329-1330`        | Set from form on save          | `gradingAuthority`, `certNumber` — top-level item properties |
| `js/inventory-table.js:439-440` | Displayed in cert info tooltip | Already accessed in table rendering                          |
| `js/constants.js:273-274`       | PCGS/NGC cert URL templates    | Uses `{certNumber}` and `{grade}`                            |
| `js/bulkEdit.js:43-44, 66-67`   | Bulk edit field definitions    | Both fields editable in bulk                                 |

### CSS classes

| Class                                 | File:Line                    | Effect                                                       |
| ------------------------------------- | ---------------------------- | ------------------------------------------------------------ |
| `.table-thumb` (base)                 | `css/styles.css`             | `border-radius: 50%` — circular by default                   |
| `.table-thumb.table-thumb-rect`       | `css/styles.css:5261-5265`   | `border-radius: var(--radius)` — rectangular override        |
| `.coin-img` (base)                    | `css/styles.css:13415`       | `border-radius: 50%` — circular by default                   |
| `.coin-img.bar-shape`                 | `css/styles.css:13425-13427` | `border-radius: var(--radius)` — rectangular override        |
| `.view-image-section.view-shape-rect` | `css/styles.css:6047-6060`   | View modal rectangular override with adjusted max dimensions |

## Prior Decisions

- **2026-05-10 (this session):** PumpkinCrouton (beta tester) reported his platinum coin in an NGC/PCGS assay slab was clipping to a circle in the inventory grid. He tried changing `item.shape` to "rectangular" — no effect. Had to change `item.type` to "bar" as a workaround. Root cause confirmed: grid views ignore `item.shape`.
- **2026-05-10 (this session):** Confirmed the view modal vs grid discrepancy — user tested shape changes in view modal (which works), PumpkinCrouton tested in inventory grid (which doesn't). Both were correct.
- **2026-05-10 (this session):** Key design decision locked in: slab-to-rectangle override fires ONLY when the item has `certNumber`/`gradingAuthority` AND has a user-uploaded image. Numista catalog images show the coin itself (not the slab), so they should respect the coin's natural shape.
- **Binary round/not-round model** is intentional — CSS `border-radius: 50%` only does circles. Adding true oval `clip-path` was deemed not worth the complexity. All non-round shapes → rectangle.

## External References

- None — this is internal rendering logic with no external dependencies.

## Constraints

- **Script load order:** `classifyShape()` is defined in `catalog-api.js` and exported as `window.classifyShape`. Both `inventory-table.js` and `card-view.js` load after `catalog-api.js` (all `defer`), but the shape check runs at render time (inside functions), not at parse time — so `classifyShape` is available.
- **Async resolution already handles user images:** Both grid views already use an IntersectionObserver → async `_loadThumbImage` / `_loadCardImage` pipeline that calls `imageCache.resolveImageUrlForItem()`. This internally checks user images first, then pattern images. The slab+user-image shape override can piggyback on this existing async path — no new async pattern needed.
- **`resolveImageUrlForItem` doesn't expose source type:** The async pipeline returns a blob URL string, not a `{ url, source }` tuple. To know whether the resolved image came from user upload (slab photo) vs pattern/catalog, the caller either needs to call `getUserImageUrl()` separately first, or the return value needs enriching. Either approach is straightforward.
- **No new CSS needed:** The existing `table-thumb-rect` and `bar-shape` classes already produce the correct rectangular rendering. Only the JS logic that decides when to apply them needs to change.
- **`item.numistaData?.shape` vs form field:** The view modal accesses shape via `mergeNumistaSources()` which returns `merged.shape`. The grid views don't call this function but DO have access to the full inventory item (via `inventory[parseInt(idx, 10)]`), so shape is reachable at `invItem.numistaData?.shape` or whatever property the form save writes to. Need to confirm the exact property name at render time.
- **Performance is not a concern:** The IntersectionObserver already throttles image resolution to visible rows only. Adding a shape class toggle to the existing per-thumbnail async callback adds negligible cost.

## Open Questions

_All resolved — no blockers for approach phase._

## Discovery Summary

The fix is well-scoped: port the binary `isNonRound` shape check from `viewModal.js:1173` into the type-check blocks at `inventory-table.js:512` and `card-view.js:550`, then layer a slab+user-image override on top. The slab override piggybacks on the existing async image resolution pipeline (`_loadThumbImage` / `_loadCardImage`) which already determines whether it's showing a user-uploaded image — so no new async pattern is needed. No new CSS is needed either; the existing `table-thumb-rect` and `bar-shape` classes already do the right thing. The `classifyShape()` utility is already globally available.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-67`.

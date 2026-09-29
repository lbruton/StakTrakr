---
sketch: "STRK-38-rect-image-sizing"
phase: approach
created: 2026-05-14
---

# STRK-38 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

The fix operates on two layers — CSS and JS — across three surfaces: card views (A/B/C), table view, and the table SVG placeholder generator.

**Card views:** The `.coin-img` container's `background: var(--bg-tertiary)` is the visible dead-space box. Removing it for `.bar-shape` items is the primary CSS fix. The inline styles emitted by `_cardImageHTML()` (`width:100%;height:100%;object-fit:…;border-radius:inherit;` at `js/card-view.js:573`) provide the `<img>` content box — no `.cv-thumb` CSS rule exists, so these inline dimensions are load-bearing for `object-fit` behavior. The approach is a **hybrid fix**: for rect items, `_cardImageHTML()` will emit `width:100%;height:100%;object-fit:contain;border-radius:inherit;` (keeping dimensions, switching only the fit style from `cover` to `contain`), and CSS will handle background removal plus per-style `.bar-shape` dimension overrides on the `.coin-img` wrapper. This avoids `!important` hacks while staying within the existing HTML structure (no new elements, no card layout redesign). Card A needs a `.bar-shape` override at matching specificity (`.card-a .cv-images-sm .coin-img.bar-shape`) because its current rule re-declares `border-radius: 50%`. Card B needs a new `.card-b .coin-img.bar-shape` rule. Card C already has a `.bar-shape` override — it only needs the background fix.

**Table view:** The thumbnail container is 28×28px. At this size, auto-sizing produces negligible visual benefit — a `contain`-fitted image inside a 28px rect container is sufficient. The fix here is CSS-only: remove `background: var(--bg-tertiary)` for `.table-thumb-rect`. The `object-fit: contain` rule already exists at `css/styles.css:13541`. No JS changes to the thumbnail HTML generation.

**Table SVG placeholder:** `_getThumbPlaceholder()` always generates a circular `<circle>` outer background (`js/inventory-table.js:267`). The fix adds a `shape` parameter (resolved frame string: `"round"` or `"rect"`) to the function signature. When `shape === "rect"`, the outer SVG element becomes `<rect>` with rounded corners. The cache key expands from `metal:type` to `metal:type:shape`. Both call sites (`:331`, `:346`) already have access to the `item` object, but `_loadThumbImage()` reconstructs a reduced `item` from dataset fields (`:299-307`) that omits `obverseImageFrame`, `reverseImageFrame`, `weightUnit`, `gradingAuthority`, and `numistaData.shape`. The full `invItem` is already looked up at `:314-320` for CDN URL — the placeholder fallback path must use this `invItem` (not the reduced `item`) when calling `resolveImageFrame()` to resolve shape. This ensures AC-7 compliance — manual per-side overrides, grading authority, and Numista shape all flow through `resolveImageFrame()` into the placeholder.

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | Hybrid JS+CSS for card rect sizing: `_cardImageHTML()` emits `width:100%;height:100%;object-fit:contain` for rect items (keeping inline dimensions, changing only fit style); CSS handles container wrapper dimensions and background | Avoids `!important`; keeps inline style as the coordination point for round vs rect behavior; inline width/height are load-bearing because no `.cv-thumb` CSS rule defines the image content box | Slightly more JS change than CSS-only, but CSS-only is blocked by the existing inline styles |
| D-2 | Keep fixed container dimensions per card style for rect items (not modal-like `width:auto;height:auto`) | Card layouts require predictable grid sizing — auto-width images would cause layout shifts across cards with different aspect-ratio items. The modal is a single-item view where auto-sizing is safe. | Rect images are `contain`-fitted inside a fixed box rather than driving container size from intrinsic dimensions. Acceptable because `contain` + transparent background eliminates the dead-space visual problem. |
| D-3 | Card A rect: 36×24px (landscape ratio within the 36px width constraint) | Card A thumbnails are small (36px). A square 36×36 `contain` box wastes vertical space for landscape bars/notes. A 3:2 ratio gives rect items a visually distinct landscape footprint while fitting the row height. | Slightly different aspect ratio than Card B/C rect containers, but Card A's compact layout demands tighter dimensions. |
| D-4 | Card B rect: 80×56px (same ratio as Card C) | Card B's current 80×80 square is oversized for landscape items. 80×56 matches Card C's existing `.bar-shape` dimensions for consistency across the two larger card styles. | Round items keep 80×80; rect items get a visually distinct shorter container. |
| D-5 | Table placeholder: full resolver path via `resolveImageFrame()`, not type-only branching | Type-only (`isBar`) misses explicit per-side overrides, grading authority, and Numista shape — failing AC-7. The resolver is available globally; the placeholder fallback path in `_loadThumbImage()` must use the full `invItem` from `inventory[idx]` (already looked up at `:314-320`) rather than the reduced dataset-derived `item`, since the reduced object lacks the fields `resolveImageFrame()` needs. | Cache key expands from 2-part to 3-part (`metal:type:shape`), marginally more cache entries. Negligible perf impact. |
| D-6 | No responsive (mobile) overrides for card rect sizing | Cards already respond to viewport via grid column count, not per-card image dimensions. The modal's responsive rect rules (`:6608`, `:6664`) are modal-specific layout constraints, not a pattern to propagate to cards. | Mobile card images may feel slightly small for landscape items, but this matches existing round-item behavior and avoids scope creep. |
| D-7 | Remove `background: var(--bg-tertiary)` for `.bar-shape` via `background: transparent` override, not by removing the base rule | The base `.coin-img` background is intentional for round items (backdrop behind circular mask). Overriding to `transparent` for `.bar-shape` is surgical; editing the base rule risks round-item regression. | One more CSS declaration per `.bar-shape` override. |

## File Map

_Every file this sketch will create, modify, or delete. Tasks.md will reference these paths._

### New

- `tests/playwright/rect-image-card-table.spec.js` — Playwright tests for AC-1 through AC-7 (card A/B/C rect sizing, table rect thumbnails, no-image placeholders, round-item regression, frame override in Card B/C). Must include explicit no-image table placeholder cases for: (1) manual `obverseImageFrame: "rectangle"` item, (2) `gradingAuthority`-driven rect, and (3) `numistaData.shape` non-round item — these exercise the `_loadThumbImage` → `resolveImageFrame` → `_getThumbPlaceholder` path that image-URL-only tests would miss.

### Modified

- `css/styles.css` — Add `.bar-shape` background/dimension overrides for: base `.coin-img.bar-shape` (background), `.card-a .cv-images-sm .coin-img.bar-shape` (dimensions + radius), `.card-b .coin-img.bar-shape` (dimensions), `.table-thumb.table-thumb-rect` (background). Existing `.card-c .coin-img.bar-shape` needs only background fix.
- `js/card-view.js` — Modify `_cardImageHTML()` (~line 573): for rect items, emit `width:100%;height:100%;object-fit:contain;border-radius:inherit;` (keeping inline dimensions, changing only `object-fit` from `cover` to `contain`). No removal of width/height — they are load-bearing since no `.cv-thumb` CSS rule exists.
- `js/inventory-table.js` — Modify `_getThumbPlaceholder()` (`:245-274`): add `shape` parameter, branch outer SVG to `<rect>` when shape is `"rect"`, expand cache key. Update both call sites (`:331`, `:346`) to pass resolved frame. Also modify `_loadThumbImage()`: move the `invItem` lookup (currently at `:314-320`) earlier so the full inventory record is available on the placeholder fallback path, enabling `resolveImageFrame(invItem, side)` to receive all required fields.
- `tests/playwright/image-frame-override.spec.js` — Extend the existing mixed-side frame test to cover Card B and Card C (AC-7 gap identified in discovery).

### Deleted

- _none_

## Data / Schema Changes

None — no schema, migration, or persisted-data changes.

## Tradeoffs Surfaced for Review

1. **Fixed containers vs modal-like auto-sizing (D-2):** Cards keep fixed rect dimensions (36×24 / 80×56 / 80×56) with `object-fit: contain` and transparent background. This is visually good (no dead-space box) but not pixel-identical to the modal's intrinsic sizing. The alternative — auto-sizing in card grid — risks layout shifts when items have different aspect ratios. Recommended: fixed containers.

2. **Card A rect dimensions (D-3):** 36×24 is a judgment call. 36×28 (taller) or 36×20 (shorter) are alternatives. The exact dimensions can be tuned visually during implementation without architectural impact.

3. **Table thumbnail size stays 28px (no widen):** At 28px, rect `contain` images are small but visually adequate — the thumbnail is a quick identifier, not a showcase. Widening rect thumbnails would require column width changes in the table layout. Recommended: keep 28px, fix background only.

## Out of Scope (follow-up issues)

- Per-item image layout configuration (horizontal vs vertical stacking in the image block) — separate future issue per STRK-38 source issue
- Portrait-vs-landscape intrinsic aspect-ratio sizing — `resolveImageFrame()` returns only `"round"` / `"rect"`, no orientation data. Deferred per requirements reconciliation.
- Mobile-specific responsive overrides for card rect images (D-6)

## Risk Notes

- Risk: Card A `.bar-shape` specificity may conflict with other card-a overrides in responsive media queries → mitigation: grep for all `.card-a` rules in styles.css and confirm no conflicting media-query selectors before writing the override.
- Risk: `_getThumbPlaceholder` cache invalidation — changing the cache key format means previously cached entries (from earlier page renders within the same session) won't match new keys → mitigation: the cache is an in-memory object (`_thumbPlaceholders`), not persisted. Page reload clears it. No migration needed.
- Risk: Inline style change in `_cardImageHTML()` could affect image loading/error behavior → mitigation: the `onerror` handler (`:574`) and display toggling reference `this.style.display`, not width/height. The change only modifies `object-fit` (from `cover` to `contain`) for rect items while keeping `width:100%;height:100%`; the error/loading path and image content box are unaffected.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Next: `/sketch review STRK-38 approach`, then `/sketch tasks STRK-38`.

## Review Archive — approach (2026-05-14)

_Reconciled by /sketch reconcile on 2026-05-14. Original reviewer marks preserved below for audit._

### Codex

**Verified**

- `_cardImageHTML()` resolves per-side rect state and emits `.bar-shape` plus inline `width:100%;height:100%;object-fit:...;border-radius:inherit` at `js/card-view.js:549-578`.
- Card A/B/C wrappers are fixed-size CSS boxes at `css/styles.css:13609-13615`, `css/styles.css:13680-13684`, and `css/styles.css:13729-13737`; the shared `.coin-img` background/overflow lives at `css/styles.css:13494-13505`.
- The detail modal's reference behavior uses `.view-shape-rect` from `js/viewModal.js:2185-2189` plus `max-width`/`max-height` and `width:auto;height:auto` CSS at `css/styles.css:6079-6098`, with mobile overrides at `css/styles.css:6608-6615` and `css/styles.css:6664-6666`.
- Table thumbnails get `.table-thumb-rect` from `resolveImageFrame()` during table render at `js/inventory-table.js:513-541`; the no-image fallback uses `_getThumbPlaceholder(metal, type)` at `js/inventory-table.js:245-274`, `:331`, and `:346`.
- `_loadThumbImage()` reconstructs a reduced item object from thumbnail dataset fields at `js/inventory-table.js:299-307`, which omits frame overrides, weight unit, grading authority, and Numista shape before the fallback placeholder path.
- `resolveImageFrame()` requires those omitted fields for full AC-7 behavior at `js/image-frame.js:30-65`.
- Existing Playwright coverage verifies resolver priority and table/Card A/modal mixed-side classes at `tests/playwright/image-frame-override.spec.js:77-159`; it does not cover Card B/C or no-image table placeholder shape.

**Top concerns**

1. D-1/D-2 currently conflict: fixed rect wrappers are reasonable, but removing inline image width/height leaves no live `.cv-thumb` sizing rule for `object-fit: contain` to operate against.
2. The table placeholder plan overstates AC-7 coverage because the fallback loader does not currently carry full item data into `resolveImageFrame()`.
3. Test scope needs explicit no-image placeholder coverage for resolver-driven shapes; image-url thumbnail class tests will not catch the reduced-item fallback bug.

**Unverified assumptions**

- Fixed 36x24 and 80x56 rect wrapper sizes are visually acceptable across real bar, note, Goldback/Silverback, and proof-set image assets.
- Keeping table thumbnails at 28x28 is acceptable without screenshot or pixel-level QA for the dead-space background in all themes.
- No mobile-specific card overrides are needed after Card A/B/C rect wrappers change.
- Card placeholders should keep the existing `.cv-no-image` full-size metal-tint effect even when real images become transparent-background rect thumbnails.
- A new `tests/playwright/rect-image-card-table.spec.js` is preferable to expanding `tests/playwright/image-frame-override.spec.js` for all STRK-38 coverage.

### Resolution Summary

- Accepted: 5
- Rejected: 1 (D-1 alternative phrasing subsumed by accepted resolution — we keep width/height, so the "keep width/height" alternative is moot)
- Resolved with your input: 0

---
sketch: "STRK-38-rect-image-sizing"
phase: discovery
created: 2026-05-14
---

# STRK-38 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

### Image Frame Resolution

| Path                              | Role                                                    | Notes                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `js/image-frame.js` (entire file) | `resolveImageFrame(item, side)` → `"round"` or `"rect"` | Window-exposed. Priority: explicit override → type/weightUnit → gradingAuthority → numistaData.shape → round. Shipped with STRK-67 (v3.34.57, PR #1099). |
| `js/image-frame.js:8-9`           | `normalizeImageFrame(value)`                            | Normalizes stored per-side frame values to `"auto"` / `"circle"` / `"rectangle"`.                                                                        |
| `js/image-frame.js:17-22`         | `cycleFrame(value)`                                     | Cycles auto → circle → rectangle for the add/edit modal toggle.                                                                                          |

### Card View Rendering

| Path                         | Role                                     | Notes                                                                                                                                                               |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `js/card-view.js:549-578`    | `_cardImageHTML(item, extraClass, side)` | Calls `resolveImageFrame()`. Adds `.bar-shape` class when rect. Sets inline `object-fit: contain` (rect) or `cover` (round). Generates `.cv-no-image` fallback div. |
| `css/styles.css:13494-13503` | `.card-view-grid .coin-img`              | Base rule: `border-radius: 50%`, `background: var(--bg-tertiary)`, flex centering. This background is the visible "dead space" rectangle for rect items.            |
| `css/styles.css:13504-13506` | `.card-view-grid .coin-img.bar-shape`    | Only changes `border-radius` to `var(--radius)`. Does **not** remove `background: var(--bg-tertiary)` — the dead-space box persists.                                |
| `css/styles.css:13509-13525` | `.cv-no-image`                           | Metal-tinted glass orb placeholder. Uses `border-radius: inherit` so it follows `.bar-shape` when present.                                                          |
| `css/styles.css:13527-13538` | `.metal-* .cv-no-image`                  | Per-metal tint overrides (silver #c0c0c0, gold #ffd700, etc.).                                                                                                      |

### Card Style A (Sparkline Header)

| Path                         | Role                              | Notes                                                                                                                                                                                                                                                                                     |
| ---------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `css/styles.css:13609-13615` | `.card-a .cv-images-sm .coin-img` | Fixed `width: 36px; height: 36px; border-radius: 50%`. **Problem:** Re-declares `border-radius: 50%` with higher specificity than the global `.bar-shape` rule, so rect items render circular at 36px even though `.bar-shape` class is present. No `.card-a .bar-shape` override exists. |

### Card Style B (Full-Bleed Overlay)

| Path                         | Role                | Notes                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `css/styles.css:13680-13684` | `.card-b .coin-img` | Fixed `width: 80px; height: 80px; border: 2px solid var(--border)`. **Problem:** No `.card-b .coin-img.bar-shape` rule exists. Rect items get 80×80 square with the base `.bg-tertiary` background. The global `.bar-shape` rule at `:13504` does apply `border-radius: var(--radius)`, but the background and fixed square dimensions remain. |

### Card Style C (Split Card)

| Path                         | Role                          | Notes                                                                                                                                                  |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `css/styles.css:13717-13727` | `.card-c .cv-image-col`       | Image column: `flex: 0 0 100px`, `background: var(--bg-secondary)`, centered flex layout.                                                              |
| `css/styles.css:13729-13733` | `.card-c .coin-img.bar-shape` | Explicit rect override: `width: 80px; height: 56px; border-radius: var(--radius)`. This is the **only** card style with a per-style `.bar-shape` rule. |
| `css/styles.css:13734-13737` | `.card-c .coin-img`           | Round fallback: `width: 56px; height: 56px`.                                                                                                           |

### Table View

| Path                            | Role                                        | Notes                                                                                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `js/inventory-table.js:513-516` | `_thumbShapeClass(side)`                    | Closure that calls `resolveImageFrame()` per-side. Adds `" table-thumb-rect"` class when rect.                                                                                                                                                                                       |
| `js/inventory-table.js:531-543` | Thumbnail HTML generation                   | Generates per-side `<img class="table-thumb...">` elements with lazy loading.                                                                                                                                                                                                        |
| `js/inventory-table.js:245-274` | `_getThumbPlaceholder(metal, type)`         | Generates SVG data URI. **Problem:** Line 267 — outer shape is always `<circle cx="16" cy="16" r="15" .../>` regardless of item type. The inner icon varies (bar icon for bar/ingot, coin circles for all else), but the outer background is always circular.                        |
| `css/styles.css:5290-5299`      | `.table-thumb`                              | Base: `28px × 28px`, `border-radius: 50%`, `object-fit: cover`, `background: var(--bg-tertiary)`.                                                                                                                                                                                    |
| `css/styles.css:5307-5312`      | `.table-thumb.table-thumb-rect`             | Only changes `border-radius` to `var(--radius)`. Does **not** change `object-fit` here.                                                                                                                                                                                              |
| `css/styles.css:13541-13543`    | `.table-thumb.table-thumb-rect` (duplicate) | Sets `object-fit: contain`. This is a second rule block later in the file that adds `contain` — combined with the `:5307` block, rect thumbs get `border-radius: var(--radius)` + `object-fit: contain`. But `background: var(--bg-tertiary)` from the base rule is **not** removed. |

### Detail Modal (Reference Implementation)

| Path                        | Role                                       | Notes                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `js/viewModal.js:2185-2190` | `_applyViewSlotFrame(slot, item, side)`    | Toggles `.view-shape-rect` class on the `.view-image-slot` wrapper. Per-side resolution.                                                                                                                                       |
| `css/styles.css:6093-6098`  | `.view-shape-rect img`                     | `border-radius: var(--radius); max-width: 200px; max-height: 260px; width: auto; height: auto;` — the pattern that works. Uses auto dimensions so the image's intrinsic aspect ratio drives sizing. No fixed square container. |
| `css/styles.css:6101-6105`  | `.view-shape-rect .view-image-placeholder` | Rectangular placeholder: `140px × 200px` with `var(--radius)`.                                                                                                                                                                 |
| `css/styles.css:6608-6615`  | `.view-shape-rect img` (≤768px)            | Responsive override: `max-width: 100%; max-height: 200px`. Placeholder switches to `width: 100%; aspect-ratio: 3/4`.                                                                                                           |
| `css/styles.css:6664-6666`  | `.view-shape-rect img` (≤480px)            | Extra-small override: `max-height: 180px`. Further constrains rect images on narrow viewports.                                                                                                                                 |

### Tests

| Path                                                    | Role                      | Notes                                                                                                                                           |
| ------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/playwright/image-frame-override.spec.js:77-121`  | Resolver priority tests   | Covers all resolution levels (explicit, type, weight, grading, Numista, fallback).                                                              |
| `tests/playwright/image-frame-override.spec.js:123-159` | Mixed per-side frame test | Verifies table (`.table-thumb-rect`), Card A (`.bar-shape` + `object-fit`), and modal (`.view-shape-rect`). **Does not test Card B or Card C.** |

## Prior Decisions

- **2026-05-10** — STRK-67 shipped `resolveImageFrame()` in v3.34.57 (PR #1099). The STRK-67 approach doc noted decision D-7: "Card view's resolver result drives both the wrapper class (bar-shape) AND the `<img>` inline object-fit style — both must move together." Decision D-10 flagged "Promote shape-class application from item-level to per-slot" as debt for table and modal views. (mem0 + archived sketch at `DocVault/Projects/StakTrakr/sketches/archive/2026-05-10-STRK-67-image-frame-override/approach.md`)
- **2026-05-04** — STRK-38 filed as part of a batch of four UI issues (STRK-35 through STRK-38). (mem0)

## External References

- None required. The fix is purely internal — the detail modal's own pattern (`width: auto; height: auto; max-width/max-height`) is the prior art. No external libraries or standards needed.

## Constraints

- **CSS specificity:** Card A's `.card-a .cv-images-sm .coin-img` has 3-class specificity and re-declares `border-radius: 50%`, overriding the lower-specificity global `.coin-img.bar-shape`. Any fix must match or exceed this specificity.
- **No layout redesign:** Changes are scoped to `.coin-img` sizing and background within existing card HTML structure (per non-goal in requirements).
- **Inline styles from JS:** `_cardImageHTML()` sets `object-fit`, `width:100%`, `height:100%`, `display`, and `border-radius:inherit` as inline styles (`js/card-view.js:573`). CSS-only fixes for object-fit or intrinsic sizing would be overridden by these inline values. Any sizing or `object-fit` changes must coordinate with the JS helper — CSS alone cannot achieve modal-like `width:auto;height:auto` behavior while these inline dimensions are emitted.
- **`background: var(--bg-tertiary)` is on the base rule:** The dead-space background is inherited from `.card-view-grid .coin-img`. Removing it globally would affect round items (which use it as the backdrop behind circular masks). The fix must selectively remove it for `.bar-shape` only.
- **Table SVG placeholder needs resolver-backed signature:** `_getThumbPlaceholder(metal, type)` caches SVG data URIs in `_thumbPlaceholders` by `metal:type` key. It does not currently consider the image frame shape — only `type` (bar/ingot test for the inner icon). A shape-aware placeholder that honors AC-7 manual overrides, grading authority, and Numista shape requires passing the resolved frame into the function (not just expanding the cache key). Both call sites (`:331`, `:346`) currently pass only `item.metal, item.type` and must be updated to pass the resolved frame from `resolveImageFrame()`.
- **28px table thumbnails:** At 28×28, a rectangular "contain" image inside a rect-shaped container will be very small. The detail modal uses 200×260 — not directly transferable. The approach phase needs to decide whether to widen the rect thumbnail or accept the aspect-ratio penalty at 28px.
- **`file://` protocol:** StakTrakr runs on `file://` — no server-side rendering, no build step. All changes must work with static files.
- **Pre-commit hook:** `stamp-sw-cache` auto-stages `sw.js` when CSS/JS files change. CSS-only changes will still trigger it.

## Open Questions

All three open questions from requirements are now answerable:

- [x] **Q1 — Table placeholder SVGs:** `_getThumbPlaceholder()` (`:245-274`) generates a circular `<circle>` outer background for all items. The inner icon already varies (bar icon for bar/ingot, coin circles for others). **Resolution:** use the full resolver path — pass the resolved frame from `resolveImageFrame()` into `_getThumbPlaceholder` so the outer SVG shape (`<rect>` vs `<circle>`) honors all resolver sources (explicit per-side overrides, grading authority, Numista shape), not just item type. This requires changing the function signature and both call sites (`:331`, `:346`).
- [x] **Q2 — Card B/C wrapper constraints:** Card C already has a dedicated `.card-c .coin-img.bar-shape` rule (80×56) — it works but still has the `--bg-tertiary` background. Card A and Card B have **no** `.bar-shape` overrides at their specificity level. Card A's `.card-a .cv-images-sm .coin-img` rule re-declares `border-radius: 50%` which overrides the global `.bar-shape` radius. **Answer:** a shared CSS rule alone is insufficient — Card A and Card B each need per-style `.bar-shape` overrides to counter their specificity. Card C's dimensions are already correct but needs the background fix. **Additional constraint:** `_cardImageHTML()` emits inline `width:100%;height:100%` on the `<img>` (`js/card-view.js:573`), so CSS-only `.bar-shape` overrides cannot achieve modal-like intrinsic sizing without JS coordination. The approach phase must weigh sizing alternatives with this inline-style blocker in mind.
- [x] **Q3 — CSS-only or JS changes needed:** The fix is **not CSS-only**. `_cardImageHTML()` sets `object-fit`, `width:100%`, `height:100%`, and `border-radius:inherit` inline (`js/card-view.js:573`), so CSS cannot override any of these without `!important` or JS coordination. Additionally, `_getThumbPlaceholder()` needs JS changes to accept the resolved frame and generate `<rect>` SVG for rect items. The HTML structure and class-toggling logic in `_cardImageHTML()` and `_thumbShapeClass()` are already correct — no new JS class-toggling is needed.

## Discovery Summary

The root cause is a two-layer gap: (1) **CSS** — `.coin-img.bar-shape` changes `border-radius` but never removes `background: var(--bg-tertiary)`, so the dead-space box persists; Card A and Card B lack per-style `.bar-shape` overrides, so Card A renders rect items circular. (2) **JS** — `_getThumbPlaceholder()` always generates a circular SVG outer shape regardless of resolved frame; `_cardImageHTML()` emits inline `width:100%;height:100%;object-fit;border-radius:inherit` which blocks CSS-only sizing fixes. The detail modal's pattern (`width: auto; height: auto; max-width/max-height; no background`) is the proven fix — but adapting it requires: per-style CSS at the right specificity level, JS coordination in `_cardImageHTML()` to emit rect-appropriate inline styles (or defer to CSS), and a resolver-backed `_getThumbPlaceholder` signature change with updated call sites (`:245`, `:331`, `:346`). The work is a combined JS + CSS effort across both card and table views.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Next: `/sketch approach STRK-38`.

## Review Archive — discovery (2026-05-14)

_Reconciled by /sketch reconcile on 2026-05-14. Original reviewer marks preserved below for audit._

### Codex

**Verified**

- `resolveImageFrame()` exists and resolves explicit overrides, type/weight-unit rules, grading authority, Numista shape, and fallback in `js/image-frame.js:30-65`.
- Card view renders per-side `.bar-shape` wrappers and inline image styles from `_cardImageHTML()` in `js/card-view.js:549-578`; Card A/B/C consume that helper in `js/card-view.js:663-716`.
- Card CSS base/background and style-specific image dimensions are in `css/styles.css:13494-13505`, `css/styles.css:13609-13615`, `css/styles.css:13680-13684`, and `css/styles.css:13729-13737`.
- Table thumbnails use per-side `.table-thumb-rect` classes in `js/inventory-table.js:513-541`, while fallback placeholders are generated by `_getThumbPlaceholder(metal, type)` and cached by metal/type in `js/inventory-table.js:243-274`.
- The modal reference applies per-slot `.view-shape-rect` in `js/viewModal.js:2185-2190` and desktop/mobile rect image sizing in `css/styles.css:6093-6105`, `css/styles.css:6608-6615`, and `css/styles.css:6664-6666`.
- Current Playwright coverage verifies resolver priority plus table/Card A/modal mixed-side rendering in `tests/playwright/image-frame-override.spec.js:77-159`; it does not cover Card B or Card C.

**Top concerns**

1. Q1 resolves toward a rectangular table SVG from type-based branching, but the live resolver contract is broader and per-side; approach must decide whether placeholders need full `resolveImageFrame()` semantics or only a narrower type-based cleanup.
2. Q2 focuses on CSS specificity, but Card A/B fixed square wrappers and `_cardImageHTML()` inline `width:100%;height:100%` mean `.bar-shape` overrides alone may not satisfy the modal-like natural sizing requested by AC-1 through AC-3.
3. The discovery summary calls the work "primarily CSS with two small JS touches"; that may be true only for the transparent-background path. A resolver-backed table placeholder plus modal-like card sizing is a larger JS/CSS contract change.

**Unverified assumptions**

- The desired table no-image behavior must honor manual per-side `obverseImageFrame` / `reverseImageFrame` overrides, not just item type.
- A type-only rectangular SVG placeholder is acceptable for graded slabs, Numista non-round shapes, Goldbacks/Silverbacks, and explicit override cases.
- Card A/B should actually adopt modal-like intrinsic sizing rather than keeping fixed dimensions and removing the contrasting background.
- The modal's responsive rect-image rules are reference behavior for card/table surfaces, not only modal-specific constraints.
- Visual acceptance can be proven with DOM/computed-style assertions alone; the "dead-space box" may still require screenshot or pixel-level QA to catch theme/background regressions.

**Inline marks (verbatim)**

- (at Detail Modal `:6093` row): "Verified the desktop modal rule at `css/styles.css:6093-6098`, but the modal reference also has responsive overrides at `css/styles.css:6608-6615` and `css/styles.css:6664-6666`. If approach copies the modal pattern into cards/table, it should decide whether the mobile max-height/aspect behavior is part of the reference implementation or just modal-only behavior."
- (at Table SVG constraint): "This constraint is correct but understates the contract change. `_getThumbPlaceholder(metal, type)` receives only metal/type today (`js/inventory-table.js:245-247`) and both fallback call sites pass only `item.metal, item.type` (`js/inventory-table.js:331`, `js/inventory-table.js:346`). A shape-aware placeholder that respects AC-7 manual overrides, grading authority, and Numista shape needs the resolved frame or side/item data in the function signature, not just an expanded cache key."
- (at Q1): "The visual recommendation is plausible, but it should not be framed as fully answered from type-based branching alone. `resolveImageFrame()` can return rect from explicit `obverseImageFrame/reverseImageFrame`, weight unit, grading authority, or Numista shape (`js/image-frame.js:30-65`), while `_getThumbPlaceholder()` currently only knows `metal` and `type` (`js/inventory-table.js:245-247`). Approach needs to choose between a true resolver-backed placeholder path and a narrower type-only placeholder improvement, because those have different AC-7 coverage."
- (at Q2): "This answers specificity but jumps past sizing alternatives. Card A and B use fixed square wrapper dimensions (`css/styles.css:13609-13615`, `css/styles.css:13680-13684`), and `_cardImageHTML()` also emits inline `width:100%;height:100%` on the `<img>` (`js/card-view.js:573`). A per-style `.bar-shape` radius/background override may remove the visible box, but it will not by itself reproduce the modal's `width:auto;height:auto;max-*` behavior from `css/styles.css:6093-6098`. Approach should explicitly weigh at least: fixed wrapper plus transparent background, per-style rectangular aspect boxes, and modal-like auto-sized images."
- (at Q3): "Correct that this is not CSS-only, but the inline JS issue is broader than `object-fit`: `_cardImageHTML()` emits `width:100%;height:100%;...border-radius:inherit` in the same inline style (`js/card-view.js:573`). If the chosen approach wants modal-like intrinsic sizing, JS must coordinate width/height too, or CSS will still be fighting inline dimensions."
- (at Summary): "The summary should carry the resolver contract into the JS touch count. For table placeholders, a type-only `<rect>` branch is smaller but does not honor explicit per-side overrides; a resolver-backed placeholder needs function/caller changes around `js/inventory-table.js:245-247`, `js/inventory-table.js:331`, and `js/inventory-table.js:346`. For card views, modal-like intrinsic sizing needs coordination with the inline width/height/object-fit style at `js/card-view.js:563` and `js/card-view.js:573`, not only `object-fit`."

### Resolution Summary

- Accepted: 5
- Rejected: 1 (sizing alternatives enumeration — belongs in approach phase, not discovery)
- Resolved with your input: 1 (full resolver path for table placeholders)

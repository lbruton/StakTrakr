---
sketch: "STRK-67-image-frame-override"
phase: requirements
created: 2026-05-10
---

# STRK-67 — Requirements

> **Source Issue:** [STRK-67](https://plane.lbruton.cc/lbruton/browse/STRK-67/)
> **Title:** Slabbed coins clip to circle in inventory — shape-aware thumbnail rendering
>
> **Reported by:** Beta tester PumpkinCrouton (Reddit) — platinum coin in NGC assay slab; user-uploaded slab photo clipped to circle in inventory grid.
>
> **Issue body's "Proposed Fix" section is superseded by this sketch.** The original three-condition heuristic (type + Numista shape + slab-with-upload IDB probe) was scoped in a v1 sketch (archived `2026-05-10-STRK-67-slab-shape-thumbnails-v1-render-time-auto/`) and rejected for two reasons: (1) the IDB-blob probe couldn't distinguish a Numista CDN URL from a user-pasted slab CDN URL because image origin is not tracked in `fieldMeta`, leaving URL-pasted slabs broken; (2) automating shape inference removed user agency over edge cases. This v2 sketch replaces render-time inference with a persisted per-side override field plus a simpler, fully-synchronous default rule.

## Overview

The inventory table and card grid views use a type-only check (`item.type === "bar"`, etc.) to decide whether a thumbnail displays as round or rectangular. All coins regardless of physical shape or slab status get circular clipping. The view modal already has shape-aware logic (`viewModal.js:1173`) that is partially correct but only fires late, after Numista metadata enrichment.

Rather than make the grid views as smart as the view modal, this sketch flips the design: introduce a per-side `obverseImageFrame` / `reverseImageFrame` field on each inventory item. Values are `auto | circle | rectangle`. The default (`auto` or absent) resolves synchronously from existing fields on the item (type, weightUnit, gradingAuthority, numistaData.shape) — no IndexedDB lookup, no async probe, no shape flash. A small toggle in the lower-right corner of each image slot in the add/edit modal lets the user override the default for that side. All three views (inventory table, card grid, item view modal) read the resolved frame from the same shared helper, eliminating the split-brain between views.

This solves PumpkinCrouton's case (graded coin gets rectangular by default because `gradingAuthority` is set), solves the URL-pasted slab gap (override mechanism is identical regardless of image source), and provides a stable foundation for the user's longer-term roadmap (vertical-vs-horizontal note distinction, image cropping/masking).

**Behavioral change envelope for existing items:** Existing inventory renders identically to today **except** for the intentional new `gradingAuthority` → rectangle auto-rule (AC-4). All other render decisions (type-based, weightUnit-based, Numista shape-based) preserve current behavior. Trade-offs flowing from this single intentional change are documented in the Trade-offs Accepted section below.

> CODEX: This resolves the prior contradiction. AC-10 no longer promises perfect visual identity for every legacy item while also introducing the graded-auto rule; it now scopes the intentional behavior change clearly enough for approach/tasks.

## User Stories

> Format: **As a** [role], **I want** [capability], **so that** [outcome].

- **US-1:** As a collector with a slabbed/graded coin (NGC, PCGS, ANACS, ICG, etc.), I want my thumbnails in the inventory grid views to render as rectangles by default whenever a grading authority is recorded, so I don't have to misuse `type=bar` or fight the UI to see my full slab photo.
- **US-2:** As a collector who disagrees with the auto-detected frame for any item or any side, I want a per-side override I can set in the add/edit modal, so I can force a specific image to display as a circle or rectangle regardless of the item's type, shape, or grading status.
- **US-3:** As a collector with a coin whose Numista catalog data records a non-round shape (rectangular, square, oval, etc.), I want the inventory grid views to honor that shape automatically, so my thumbnails aren't clipped to circles.
- **US-4:** As a collector who pastes a CDN URL of a slab photo (instead of uploading a file), I want the same override mechanism to work, so I can present my image correctly without needing the system to infer image origin.
- **US-5:** As an existing user with inventory data that predates this feature, I want my items to render identically to how they render today by default, so a software update doesn't visually disrupt my collection.

## Acceptance Criteria

> Format: Given/When/Then. Each AC must be verifiable from code or tests after implementation.

### AC-1 — Manual override forces circle (maps to US-2)
- **Given** an inventory item where `obverseImageFrame === "circle"` (or `reverseImageFrame === "circle"` for the reverse side)
- **When** that side is rendered in the inventory table view, card grid view, or item view modal
- **Then** the thumbnail renders with circular clipping, **regardless** of `type`, `weightUnit`, `gradingAuthority`, or `numistaData.shape`

### AC-2 — Manual override forces rectangle (maps to US-2)
- **Given** an inventory item where `obverseImageFrame === "rectangle"` (or `reverseImageFrame === "rectangle"`)
- **When** that side is rendered in any of the three views
- **Then** the thumbnail renders with rectangular framing (`table-thumb-rect` / `bar-shape` / `view-shape-rect` class as appropriate per view), **regardless** of `type`, `weightUnit`, `gradingAuthority`, or `numistaData.shape`

### AC-3 — Auto resolves to rectangle for type-based items (maps to US-5)
- **Given** an inventory item with no Frame override (field absent or value `"auto"`) AND `type` ∈ {`"Bar"`, `"Note"`, `"Aurum"`, `"Set"`} (case-insensitive) OR `weightUnit` ∈ {`"gb"`, `"sb"`}
- **When** the item is rendered in any of the three views
- **Then** the thumbnail is rectangular — preserving today's behavior exactly

### AC-4 — Auto resolves to rectangle for graded coins (maps to US-1)
- **Given** an inventory item with no Frame override AND `gradingAuthority` is a non-empty string AND no other rectangular trigger fires
- **When** the item is rendered in any of the three views
- **Then** the thumbnail is rectangular
- **Note:** This is the new automation rule. It deliberately fires whether or not the user has uploaded a slab photo — see Trade-offs below.

### AC-5 — Auto resolves to rectangle for non-round Numista shape (maps to US-3)
- **Given** an inventory item with no Frame override AND `classifyShape(item.numistaData?.shape)` (catalog-api.js:528) returns any value other than `"round"`
- **When** the item is rendered in any of the three views
- **Then** the thumbnail is rectangular

### AC-6 — Auto fallback is round (maps to US-5)
- **Given** an inventory item with no Frame override AND none of AC-3, AC-4, or AC-5 conditions fires
- **When** the item is rendered in any of the three views
- **Then** the thumbnail is round (current default behavior preserved)

### AC-7 — Override toggle UI in add/edit modal (maps to US-2, US-4)
- **Given** a user has uploaded a file or pasted a URL into the obverse or reverse image slot in the Add Item or Edit Item modal AND the image preview is visible
- **When** the user clicks the lower-right corner Frame-toggle icon on that slot
- **Then** the value cycles through `auto → circle → rectangle → auto`, the icon's visual state reflects the current value, and on save the corresponding `obverseImageFrame` or `reverseImageFrame` field is persisted on the item

### AC-8 — Override toggle hidden when slot is empty (maps to US-2)
- **Given** a slot has no image present (`image-upload-preview` is `display: none`)
- **When** the modal renders or the image is removed
- **Then** the Frame-toggle icon is not visible for that slot — overriding a frame for a non-existent image is meaningless

### AC-9 — Override toggle scope is add/edit modal only
- **Given** the user is viewing the inventory table thumbnail, the card grid thumbnail, or the item view modal
- **When** any item is rendered
- **Then** the Frame-toggle icon does **not** appear on that thumbnail/image — frame editing happens only via the Add/Edit Item modal

### AC-10 — Migration / backwards compatibility (maps to US-5)
- **Given** an inventory item that pre-dates this feature (no `obverseImageFrame` and no `reverseImageFrame` keys present, OR keys present with empty/null/undefined values)
- **When** loaded by `loadData()` and rendered in any of the three views
- **Then** both fields are treated as `"auto"` and the item renders according to the auto-resolution rule (AC-3 through AC-6). For most legacy items the resulting visual matches today's output unchanged; the only intentional behavioral change for existing items is the new `gradingAuthority` → rectangle default introduced in AC-4 (graded coins gain rectangular auto-frames). See Trade-offs Accepted for the rationale.
- **And** existing items must NOT be retroactively stamped with explicit `auto` values on disk — absence is the canonical default. The first time a user opens the edit modal and saves, the fields may be persisted with their then-current values.

### AC-11 — Cross-view consistency (maps to all stories)
- **Given** any combination of (`type`, `weightUnit`, `gradingAuthority`, `numistaData.shape`, `obverseImageFrame`, `reverseImageFrame`)
- **When** the same item is rendered in the inventory table, card grid, and item view modal
- **Then** all three views produce the same round/rectangular decision per side (consuming the same `resolveImageFrame(item, side)` helper). The view modal's existing late override at `viewModal.js:1173` may continue to exist as a safety net but must produce the same final result as the synchronous resolver.

### AC-12 — Persistence round-trip
- **Given** a user saves an item with `obverseImageFrame === "rectangle"` and `reverseImageFrame === "circle"`
- **When** the item is exported via the cloud-sync backup, re-imported into a fresh client, and reopened
- **Then** both Frame values survive the round-trip with the same string values, and the item renders accordingly. Backups created before this feature shipped must restore cleanly with the absent fields treated as `"auto"`.

### AC-13 — Frame travels with the image on swap (maps to US-2 — per-image semantics)
- **Given** an item being edited with images and/or URL values on either side, with any combination of `obverseImageFrame` / `reverseImageFrame` values (including `auto`)
- **When** the user clicks the existing swap button (`#swapImagesBtn`, handler at `events.js:2336`)
- **Then** the per-side Frame values swap atomically along with the existing swap operations (pending blobs, preview URLs, delete flags, visible `<img>.src`, URL field values, size-info text, file-input clearing). After swap: `obverseImageFrame` holds the previous `reverseImageFrame` value, and vice versa.
- **Note:** This makes the override semantically attached to the image, not to the slot. Implementations must extend the swap handler; tests must include a frame-pair assertion before/after swap.

> CODEX: This addresses the swap trap cleanly. Approach should name both state and UI update responsibilities here: swap the pending frame variables and immediately re-render the two toggle buttons/classes so the modal cannot show stale state after the image swap.

### AC-14 — Live preview for URL-pasted images (maps to US-4)
- **Given** the URL input field for a side is visible (the user has clicked the URL pill button — see `events.js:2207-2217`) and currently has no live image preview rendered for that side
- **When** the user types or pastes a URL whose value matches the existing valid-URL pattern (`/^https?:\/\/.+\..+/i`)
- **Then** the corresponding image preview element (`itemImagePreviewObv` / `itemImagePreviewRev`) becomes visible (display un-set from `none`) with the URL as the `<img>.src`, AND the Frame toggle becomes available per AC-7
- **And** if the image fails to load (broken URL, CORS error, decode failure), the preview hides again and the Frame toggle hides per AC-8
- **Rationale:** Without this enabling step, a URL-pasted slab image has no visible preview in edit mode — by AC-8 the Frame toggle would be unreachable until the user saved and reopened the item. Adding live URL preview closes that gap and makes US-4 (URL-pasted slab override) fully realizable in a single modal session.
- **Implementation hint for approach.md:** debounced `input` listener on `#itemObverseImageUrl` / `#itemReverseImageUrl` is sufficient; on `blur` is also acceptable. Approach decides the listener pattern.

> CODEX: I recommend keeping AC-14 in this sketch. It is a small UX addition, but without it US-4 is only technically solvable after save/reopen, which makes the new override feel broken exactly for URL-pasted slab images. If you still choose to defer it, the alternative AC-7 wording should be explicit: "For URL-pasted images, the override toggle is available once a preview exists, including after saving and reopening the item; live preview while typing/pasting the URL is out of scope."

> GEMINI: For URL pasting (AC-14), consider the 300ms debounce window and loading state. Does the user need a "loading" spinner affordance during the fetch? Also, if the URL fails to load, simply hiding the preview might be confusing; consider a one-line error hint like "couldn't load image — check the URL" so they know it failed, rather than thinking the paste didn't register.

### AC-15 — Remove resets the frame (maps to US-2 — per-image semantics)
- **Given** a side has an image (uploaded or URL-pasted) and any `obverseImageFrame` / `reverseImageFrame` value (including a non-`auto` override)
- **When** the user clicks the existing Remove button on that side (handler near `events.js:2280`)
- **Then** in addition to clearing the existing image data (preview, size info, URL field, pending blob, delete flag, file input), the corresponding Frame field is reset to `"auto"`
- **Rationale:** The override is semantically a property of the image, not the slot. Removing the image clears its preferences; the next image uploaded into that slot starts from the `auto` default. Preserving a hidden override across removal would cause surprising behavior when the user uploads a different kind of image into the same slot.

> CODEX: This resolves the remove-image concern. Approach should make sure both the hidden persisted value path and the visible toggle state reset together; otherwise the next image can inherit a stale stored value even if the button face says auto.

> GEMINI: On silent reset for AC-15: consider if a "you had an override on the previous image" warning is warranted. A silent reset might be jarring if they're just re-uploading a higher quality photo of the same slab. However, resetting to auto is safer than inheriting a stale rectangle override on a newly uploaded round coin.

## Non-Goals

- **Not adding `landscape` or `portrait` enum values to v1** — preserved as a future expansion of `rectangle`. The current scope intentionally ships only `auto / circle / rectangle`. The user's longer-term goal of distinguishing horizontal from vertical notes is acknowledged and explicitly deferred to a follow-up issue.
- **Not adding image cropping, masking, rotation, or other per-image transformation UI** — separate future work, well beyond this sketch's scope.
- **Not tracking origin (`source: "numista" | "user"`) of `obverseImageUrl` / `reverseImageUrl` in `fieldMeta`** — the override mechanism makes origin tracking unnecessary for this issue. May still be valuable for other features (resync UX, conflict detection); file separately if pursued.
- **Not auto-detecting slab photos via image analysis** — the v1 sketch's IDB-blob probe is deleted entirely. Slab detection is purely field-based via `gradingAuthority`.
- **Not changing the Numista shape classification logic in `catalog-api.js`** — this sketch consumes `classifyShape()`; it does not modify it.
- **Not adding bulk-edit support for `obverseImageFrame` / `reverseImageFrame`** — could be a follow-up if users request it. Single-item edit is sufficient for v1.
- **Not surfacing the Frame toggle on read-only thumbnails** — overrides are set in the add/edit modal exclusively. Inline toggle on table/card thumbnails is a possible future ergonomics improvement.

> GEMINI: Regarding "Not surfacing the Frame toggle on read-only thumbnails": If a user sets an override in the edit modal and returns to the inventory grid, the shape changes but there is no visual indicator *why*. Consider if a read-only indicator (e.g., a tiny lock/override icon on the thumbnail) is needed so users understand their explicit override is active, separate from edit UI.
- **Not changing the inventory data export/import format beyond two new optional string fields** — backups carry the new fields when present and tolerate their absence (per AC-10 / AC-12).
- **Not stamping existing items with explicit `auto` on load** — absence and `"auto"` are equivalent at render time. Stamping on load would dirty every item the first time it's read after the update, polluting cloud-sync diffs and undo/redo stacks.

## Trade-offs Accepted

> _These are the design choices that warrant a one-line note in the requirements so future readers (and reviewers) understand they were intentional, not oversights._

- **Graded coins with only Numista catalog (round-coin) images now render rectangular by default.** The new `gradingAuthority` → rectangle rule (AC-4) fires regardless of which image is present. This is the **only intentional behavioral change for existing items** (see Overview "Behavioral change envelope") and is the source of the AC-10 caveat. A user who sees this and disagrees clicks the override to `circle` (AC-1). The trade: most users with `gradingAuthority` set have a slab photo (they took the trouble to grade-track), so the default is right for them; the minority with catalog-only images get a one-click fix.
- **Auto-detection cannot distinguish a user-pasted slab CDN URL from a Numista catalog URL.** Both are stored in `obverseImageUrl` / `reverseImageUrl` with no origin metadata. The override (settable via the live URL preview added in AC-14) is the user's lever for this case. The design accepts this asymmetry rather than introducing `fieldMeta` tracking for image URLs.
- **Brief shape "flash" for items relying on Numista metadata enrichment.** When an item's `numistaData.shape` arrives via late catalog API enrichment (rather than being persisted on the item), the synchronous resolver at first paint may resolve to round; once the API result merges, a re-render is needed for the rectangle to appear. This is the same pattern as today's late shape override at `viewModal.js:1173` and is acceptable. The approach phase will decide whether to keep that late override as a safety net.
- **Per-image (not per-slot) override semantics.** AC-13 (swap travels with the image) and AC-15 (remove resets the frame) together commit to "the override is a property of the image, not the slot." The alternative (per-slot persistence — slot remembers preference even after image is removed/swapped) was rejected because it would surprise users who upload a different type of image into the same slot. Implementations must respect this throughout the swap, remove, and re-upload flows.

## Open Questions

> _Anything that blocks the next phase. Empty by the time discovery starts._

- [x] **UI affordance for the corner toggle.** **Resolved 2026-05-10 — Variant A (single-glyph cycle button with face showing current value: `A` / `○` / `▭`) selected.** Decision artifacts: `artifacts/frame-toggle-mockups.html` (4-variant comparison) and `artifacts/variant-a-in-modal.html` (Variant A integrated into a faithful reproduction of the production Add/Edit Item modal at `index.html:1858`). Rationale: smallest footprint, simplest implementation, and the cycle interaction is sufficient given that override is an occasional action, not a primary one. Discovery and approach phases must respect: 28×28px round button, positioned at `bottom: 6px; right: 6px` of `.image-upload-preview` (which therefore needs `position: relative`); muted color for `auto` state, gold accent for explicit override states; toggle hidden when slot is empty (AC-8); cycle order `auto → circle → rectangle → auto`.

> GEMINI: On Variant A's discoverability: will a user with a slabbed coin actually find a 28x28 corner toggle without onboarding? Also, consider the brand fit for a "precision instrument" vs "gamified app" — does a cycling corner toggle feel like a pro trading terminal, or does an explicit 3-button row (Variant D) communicate state more clearly at a glance? Finally, ensure the tooltip/aria-label explicitly reads out the cycle state and next action.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-67`.

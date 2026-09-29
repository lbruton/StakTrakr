---
sketch: "STRK-67-slab-shape-thumbnails"
phase: requirements
created: 2026-05-10
---

# STRK-67 — Requirements

> **Source Issue:** [STRK-67](https://plane.lbruton.cc/lbruton/browse/STRK-67/)
> **Title:** Slabbed coins clip to circle in inventory — shape-aware thumbnail rendering
>
> **Summary:** Inventory table and card grid views determine image shape (round vs rectangle) based solely on `item.type` (bar, note, aurum, set). Coins always get circular clipping. But when a user uploads a photo of a slabbed/graded coin (NGC/PCGS), the image shows a rectangular slab and gets clipped to a circle, cutting off the slab edges. The view modal already handles this correctly by also checking `item.shape` from Numista metadata. Reported by beta tester PumpkinCrouton — platinum coin in assay slab with user-uploaded image clipped to circle in inventory view.

## Overview

The inventory table and card grid views use a type-only check (`item.type === "bar"`, etc.) to decide whether a thumbnail displays as round or rectangular. This means all coins — regardless of their actual shape or slab status — get circular clipping. The view modal already has shape-aware logic that respects the Numista `item.shape` field, but the two grid views were never updated to match. Additionally, no view currently accounts for slabbed coins where the user has uploaded their own photo of the slab (which is always rectangular, even if the coin inside is round).

## User Stories

> Format: **As a** [role], **I want** [capability], **so that** [outcome].

- **US-1:** As a collector with non-round coins (shaped, rectangular, square), I want the inventory grid to display my coin thumbnails with the correct shape, so that images aren't clipped to circles and cut off important visual details.
- **US-2:** As a collector with slabbed/graded coins (NGC/PCGS), I want my uploaded slab photos to display as rectangles in the inventory grid, so that the full slab including label and cert info is visible in the thumbnail.
- **US-3:** As a collector viewing Numista catalog images for slabbed coins, I want the thumbnail to remain round (matching the coin's actual shape), so that the catalog coin image isn't awkwardly stretched into a rectangle when there's no slab photo.

## Acceptance Criteria

> Format: Given/When/Then. Each AC must be verifiable from code or tests after implementation.

### AC-1 — Shape-aware grid thumbnails (maps to US-1)

- **Given** an inventory item where `item.numistaData?.shape` is set to a value that `classifyShape()` (catalog-api.js:528) normalizes to anything other than `"round"` (e.g., raw values `"Rectangular"`, `"Rectangular (41.8mm wide)"`, `"Square"`, `"Oval"`, `"Other"`)
- **When** the item is displayed in the inventory table view, card grid view, or item view modal
- **Then** the thumbnail renders with rectangular clipping (`table-thumb-rect` / `bar-shape` / `view-shape-rect` class), not circular
- **Note:** Items with no `numistaData.shape` value (manually added coins, un-synced entries) default to round — matches existing behavior.

### AC-2 — Slabbed coin with user-uploaded image (maps to US-2)

- **Given** an inventory item with `gradingAuthority` set (any TPG: NGC, PCGS, ANACS, ICG, etc.; `certNumber` is informational and not required), AND the item has a user-uploaded image present in the `userImages` IndexedDB store (`getUserImage(uuid)` returns a record where `rec[side]` is a Blob with `size > 0`)
- **When** the item is displayed in the inventory table view, card grid view, or item view modal
- **Then** the thumbnail renders with rectangular clipping, regardless of `numistaData.shape`. In card grid view this also includes flipping the `<img>` `object-fit` from `cover` to `contain` so the full slab is visible.

### AC-3 — Slabbed coin with Numista-only image (maps to US-3)

- **Given** an inventory item with `gradingAuthority` set, BUT the item has NO user-uploaded image (only Numista catalog image or pattern image — `getUserImage(uuid)` returns null OR the record's blob for that side is missing/empty)
- **When** the item is displayed in any of the three views
- **Then** the thumbnail respects `numistaData.shape` as in AC-1 (round coins stay round, non-round go rectangular) — the slab override does NOT apply

### AC-4 — Existing type-based logic preserved

- **Given** an inventory item with `type` of "Bar", "Note", "Aurum", "Set", or `weightUnit` of "gb"/"sb"
- **When** the item is displayed in any view
- **Then** the thumbnail continues to render as rectangular (existing behavior unchanged)

### AC-5 — Cross-view consistency

- **Given** any combination of (type, `numistaData.shape`, `gradingAuthority`, user-image presence)
- **When** the same item is rendered in the inventory table, card grid, and item view modal
- **Then** all three views produce the same round/rectangular decision. (The view modal currently flips to rectangular only late, in `_renderNumistaSection` at `viewModal.js:1174`, after the initial build at `_buildImageSection` at `viewModal.js:255` — this sketch makes the initial build path shape-aware so the brief round-flash before the late override is eliminated.)

## Non-Goals

- **Not adding oval or square CSS clip shapes** — the binary round/not-round model is sufficient. Non-round shapes all render as rectangles. Adding per-shape CSS (oval clip-path, square aspect ratio) is visual polish for a follow-up, not this fix.
- **Not changing the Numista shape classification logic** — `classifyShape()` in `catalog-api.js` is correct; this sketch _consumes_ it from the grid views (which currently ignore shape entirely) and from the view modal's initial build (which currently fixes shape only after the async Numista enrichment runs).
- **Not auto-detecting slab photos via image analysis** — slab detection is field-based (`gradingAuthority`), not image-based. If a user uploads a slab photo but hasn't filled in `gradingAuthority`, the thumbnail follows the shape rule (US-3 / AC-3). That's acceptable.
- **Not introducing a synchronous `hasUserImage` flag on inventory items** — would eliminate the brief round-flash for slabbed user-image items in grid views, but requires a write-path migration and a maintained invariant on every save. Out of scope; tradeoff documented in approach.md.

## Open Questions

_None — all questions resolved in conversation prior to sketch creation._

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-67`.

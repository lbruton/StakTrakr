---
spec: "STRK-427-unified-image-framing"
phase: requirements
created: 2026-10-10
---

# STRK-427 — Requirements

> **Source Issue:** [STRK-427](https://plane.lbruton.cc/lbruton/browse/STRK-427/)
> **Title:** Unify item + collection image framing: shared shape selector, live preview, swap, type-driven defaults, mixed orientation
>
> **Summary:** The Add/Edit Item modal (`*ImageFrame`: auto|circle|rectangle, STRK-67) and the Custom Collection builder (`imageShape` round|bar|note|slab + `imageOrientation`, STRK-424) frame images with unrelated systems. Goals: one shared image-frame component, live-shaped preview, swap in both modals, one type→shape source of truth, per-side orientation, larger desktop previews. Delivered in 3 phases (shared component + UI; item data migration; renderers adopt fixed frames). The full Discovery Brief (2026-10-10) is in the Plane issue description and supersedes the original text where they disagree.

## Overview

The Add/Edit Item modal and the Custom Collection builder frame images with two unrelated systems, and the item side gives no live feedback. This spec delivers one shared image-frame editor that both modals mount (obverse/reverse cards, live-shaped preview, shape control, per-side orientation, swap, larger desktop previews) and a single type-to-shape resolver. It ships in three phases, each its own patch PR: **P1** shared component, live preview, swap, larger previews and one type-to-shape source (item storage unchanged); **P2** item data migration to `imageShape` plus per-side orientation; **P3** table, card and view-modal renderers adopt the fixed Bar/Note/Slab frames. Terminology follows `.context/GLOSSARY.md` (Image Shape, Image Orientation, Custom Collection, Slot).

## User Stories

- **US-1:** As a stacker adding an item, I want to see the image take its frame shape the moment I pick it, so that I know how it will look before I save.
- **US-2:** As a stacker, I want picking a Type to set a sensible frame, with every shape (Slab included) still selectable, so that I rarely have to touch the control.
- **US-3:** As a stacker whose obverse and reverse photos differ in aspect, I want a portrait/landscape choice per side, so that a portrait obverse can sit beside a landscape reverse.
- **US-4:** As a stacker, I want to swap obverse and reverse in both the item and collection modals, so that a mis-ordered pair is a one-click fix.
- **US-5:** As a desktop user, I want larger edit-modal previews, so that I can judge cropping without opening the view modal.
- **US-6:** As a user with several devices, I want frame choices to survive sync, backup and export/import, so that an older build never silently loses or flips them.
- **US-7:** As a user browsing the table, cards and view modal, I want items to appear in the same frame I chose in the modal, so that what I set is what I see.

## Acceptance Criteria

> EARS. Each line is individually testable. Phase tag in brackets: P1, P2, P3.

### AC-1 Shared component (US-1, US-4, US-5)
- AC-1.1 [P1] The Add/Edit Item modal and the Edit Collection builder SHALL mount the same image-frame editor (`js/image-frame-editor.js`), registered in `index.html` and in `sw.js` `CORE_ASSETS` in script-tag order.
- AC-1.2 [P1] The editor SHALL own presentation, shape and per-side orientation state, and SHALL leave image I/O (Upload, URL, Camera, size info, Remove) to host callbacks.
- AC-1.3 [P1] The item modal's existing swap race guards and Upload/URL/Camera behavior SHALL be unchanged.
- AC-1.4 [P1] The editor's CSS SHALL be scoped under its own class so Settings → Images (`.image-card`, `.image-upload-preview`) is unaffected.
- AC-1.5 [P1] The shape and orientation controls SHALL be visible before any image is chosen.

### AC-2 Live preview (US-1)
- AC-2.1 [P1] WHEN the user changes shape or orientation, the editor SHALL reshape the preview frame immediately, without a save.
- AC-2.2 [P1] The preview SHALL use the same ratio tokens as the collection medallion and builder, moved to a shared CSS scope, with one `--frame-slab` value replacing the 0.68 / 3:4 disagreement.
- AC-2.3 [P1] WHILE the shape is Round or Slab, the editor SHALL show no orientation control.

### AC-3 Swap (US-4)
- AC-3.1 [P1] WHEN the user presses Swap in the item modal, the editor SHALL exchange obverse and reverse images together with their per-side orientation.
- AC-3.2 [P1] WHEN the user presses Swap in the collection builder, the editor SHALL exchange the two sides' images and per-side orientation.
- AC-3.3 [P1] WHEN the user removes one side's image, the editor SHALL reset that side's orientation to its default and leave the shared shape unchanged.

### AC-4 Type-driven default (US-2)
- AC-4.1 [P1] The system SHALL derive the default shape from one resolver used by both items and `collectionsCore`; the picker's `suggestedShape` and the inline map behind `imageShapeTouched` SHALL be deleted.
- AC-4.2 [P1] The resolver SHALL return Slab WHEN `gradingAuthority` is set; otherwise Bar for Bar and Set; Note for Note, Aurum, Goldback and Silverback; Bar for a Coin with a non-round Numista shape; else Round.
- AC-4.3 [P1] WHEN the user changes Type, and the current shape equals the shape the previous Type derived, the editor SHALL re-derive the shape for the new Type.
- AC-4.4 [P1] IF the user has chosen a shape that differs from the previous Type's derived shape, THEN a Type change SHALL leave that shape unchanged.

> CODEX: [P2] The resolver depends on gradingAuthority and Numista shape as well as Type, but these ACs only specify Type changes. Define whether adding/removing grading authority or applying catalog metadata re-derives an automatic shape immediately while preserving a manual override. js/image-frame.js:52-70 currently consumes those signals at render time; the shared editor needs a testable rule for changes during an open modal.

- AC-4.5 [P1] WHEN the user changes Type from Coin to Goldback with an untouched shape, the editor SHALL show Note (regression for the reported Coin → Goldback-stays-Round case).
- AC-4.6 [P1] The editor SHALL allow any of Round, Bar, Note and Slab for any Type.
- AC-4.7 [P1] WHEN a shape that rotates is chosen, the editor SHALL start it at its default orientation (Bar portrait, Note landscape).

### AC-5 Per-side orientation (US-3)
- AC-5.1 [P1] WHERE the shape is Bar or Note, the editor SHALL show a Portrait/Landscape toggle on each side's card, following playground Option C (`playground/STRK-424-orientation-toggle.html`).
- AC-5.2 [P1, collections] The Custom Collection definition SHALL keep `imageOrientation` as the obverse/shared value for older builds and SHALL add a reverse-side key that falls back to it when absent; the reverse key SHALL be in the `normalizeDefinition` whitelist.

> CODEX: [P1] Persisting a reverse key does not specify where it must be consumed in P1. js/collections-album.js:105-117 currently passes the same entry.imageOrientation to both title sides, and js/collections-ui.js:734-738 exposes only one orientation. Require the saved mixed pair to render with the chosen per-side orientations when reopening the builder and viewing the Album title pair; discovery can inventory additional surfaces. Otherwise P1 can satisfy the storage AC while the visible reverse still uses obverse orientation.

- AC-5.3 [P1, collections] WHEN the builder writes a definition, the system SHALL bump `metaModified`, so an older build's stripped copy cannot win the merge tie-break.

> CODEX: [P1] Bumping metaModified on a new-builder write does not by itself protect against an older build stripping the reverse key. A normalized old copy may retain the same stamp, or a later edit in the old builder may advance it; js/collections-core.js:1190-1219 selects the entire definition by timestamp, then stable-string tie-break. Specify the supported downgrade/edit scenario and its expected preservation or deliberate fallback, with merge(A,B) = merge(B,A) on ties. The current guarantee is stronger than this mechanism establishes.

- AC-5.4 [P1, items] WHILE item storage is unchanged (P1), the item modal's per-side orientation controls SHALL be hidden.
- AC-5.5 [P2] The system SHALL store item per-side orientation as `obverseImageOrientation` and `reverseImageOrientation`, enabling the item modal's controls.
- AC-5.6 A Bar or Note saved without an orientation SHALL render landscape (existing `imageOrientationFor` pin).

> CODEX: [P1] Scope this landscape pin to legacy Collections, or define a distinct rule for new Items. AC-4.7 makes a newly chosen Bar portrait, while AC-8.1 omits derived orientation values; saving a new Bar at its default can therefore reopen/render landscape under this unqualified AC. Require save/reopen stability for each new shape default and explicitly distinguish legacy absence from new sparse defaults.


### AC-6 Desktop preview size (US-5)
- AC-6.1 [P1] WHERE the viewport is 768px or wider, the edit-modal previews SHALL be larger than today's 140px cap, using the horizontal space; the exact size is set in the approved `/ui-mockup` playground.
- AC-6.2 [P1] WHERE the viewport is under 768px, the mobile layout SHALL be unchanged.
- AC-6.3 [P1] The editor SHALL render correctly in the light, dark, slate and sepia themes at desktop width and 390px.

### AC-7 P1 item storage
- AC-7.1 [P1] The item modal SHALL keep writing `obverseImageFrame` / `reverseImageFrame`: Round → `circle`, any other shape → `rectangle`, derived values never persisted (sparse `auto`).
- AC-7.2 [P1] A saved item SHALL reopen in the modal showing the shape implied by its stored frame values.

> CODEX: [P1] P1 cannot round-trip all four selectable shapes through circle/rectangle alone: an ungraded Coin explicitly set to Slab or Note saves rectangle, which cannot identify the original choice on reopen. Existing items can also have different per-side overrides (js/events.js:3258-3261 swaps them independently), but P1 does not state how the shared shape loads or preserves that pair; AC-8.5 only applies in P2. Define the intentional P1 fallback and user-visible limitation, or revise the phase boundary. Pin save/reopen and unchanged-edit behavior for these cases rather than treating a lossy projection as full fidelity.


### AC-8 Item data migration (US-6)
- AC-8.1 [P2] Item records SHALL gain `imageShape`, `obverseImageOrientation` and `reverseImageOrientation`, written sparsely; derived values SHALL never be stored.
- AC-8.2 [P2] On every save, the system SHALL also write the legacy `*ImageFrame` projection of the new fields so older builds render the same.

> CODEX: [P1] Clarify the legacy projection for automatic shapes. Writing circle/rectangle on every save of an automatic Item creates an explicit override for older builds, so a later Type change there no longer follows the default (js/image-frame.js:35-38 returns the override first). Distinguish projecting an explicit choice from retaining sparse auto. Also qualify "render the same": older renderers support only round/rect and cannot reproduce fixed Slab/Bar/Note ratios or mixed orientation.

- AC-8.3 [P2] The reader SHALL resolve in order: new field, else legacy value mapped (`circle` → Round; `rectangle` → Bar or Note by Type), else derived; legacy items SHALL keep following Type changes.
- AC-8.4 [P2] IF the stored legacy value disagrees with the legacy projection of the new field, THEN the reader SHALL treat the item as edited by an older build and legacy SHALL win.

> CODEX: [P1] A projection mismatch does not prove an older edit, and a matching projection does not prove there was none. Example: save automatic Coin as sparse Round with legacy circle; an older build changes Type to Bar and keeps circle, which now disagrees with newly derived Bar. Conversely Note and Slab both project to rectangle, so edits between their meanings are undetectable. Specify precedence for missing/auto values, each side disagreeing, and Type/grade/catalog edits, plus what happens to stale new orientation after legacy wins. Add a cross-version save/edit/read acceptance matrix so US-6 has a bounded, verifiable guarantee.

- AC-8.5 [P2] A legacy item whose two sides differ SHALL map to the obverse frame's shape.
- AC-8.6 [P2] The system SHALL migrate an item only when the user saves it; no bulk rewrite at load.
- AC-8.7 [P2] The new fields SHALL be registered in `DIFF_FIELDS` and `changeLog`, and appended to `computeInventoryHash` only for items that carry them, so unaffected inventories keep their existing hash (STRK-154, STRK-241/242 precedent).
- AC-8.8 [P2] The new fields SHALL round-trip through ZIP backup, JSON export/import and CSV export/import; JSON and CSV import SHALL no longer drop the frame fields.
- AC-8.9 [P2] CSV column names and positions SHALL keep existing columns stable and Attachments last (STRK-371).

### AC-9 Renderers (US-7)
- AC-9.1 [P3] The inventory table, card view and view modal SHALL frame item images with the shape and orientation classes on the shared ratio tokens instead of `=== "rect"` / natural aspect.
- AC-9.2 [P3] The table thumb placeholder SHALL follow the same frame.
- AC-9.3 [P3] A legacy rect item SHALL render in the Bar or Note frame its resolver output implies, checked in all four themes.
- AC-9.4 [P3] WHERE a Custom Collection Slot shows a linked Item's photo, the collection's shape SHALL govern the Slot frame (album grid stays uniform).

### AC-10 Regression and safety
- AC-10.1 Existing Custom Collections, including those saved before STRK-424, SHALL render unchanged.

> CODEX: [P1] This conflicts with AC-2.2: existing Slab medallions use 0.68 (css/styles.css:18023-18024), while the builder uses 3/4 (:19647-19648); choosing one token necessarily changes one existing surface. State the allowed Slab visual change and preserve the remaining legacy shape/orientation behavior, instead of requiring all existing Collections to render unchanged.

- AC-10.2 STRK-426's dark-theme remove-badge fix is already merged (v3.36.45); the editor SHALL reuse its tokens and not reintroduce `--surface` on the badge.
- AC-10.3 Each phase's PR SHALL add Playwright coverage for its user-visible workflow (item-modal frame coverage today exists only in archived `strk-121-*` matrices), update `coverage-map.csv`, and include the test inventory delta.

## Non-Goals

- Not adding a shape field to bulk edit (no frame field exists there today); revisit as a follow-up.
- Not changing Settings → Images (`.image-card` / `.image-upload-preview` reuse stays as is).
- Not persisting derived shapes; legacy items keep following Type changes.
- Not changing the Numista/graded detection signals themselves, only the single resolver that consumes them.
- Not adding a "mixed" orientation enum; per-side orientation replaces the P/L, L/P proposal.
- Not re-architecting image upload, camera, or storage (IndexedDB image handling).
- Not changing where a Custom Collection's reverse face renders beyond what AC-5.2 requires, unless the question below resolves otherwise.

## Open Questions

> None block phase 2. Each is resolved in the named phase.

- [ ] Exact desktop preview size and two-modal layout. Resolved by the `/ui-mockup` playground (desktop + 390px, 4 themes) before P1 implementation.
- [ ] Where a Custom Collection's reverse face renders besides the title pair (`js/collections-album.js:105-117`), which scopes the reverse orientation in Collections. Resolved in `/spec-discovery`.
- [ ] CSV column names and order after P2. Resolved in `/spec-approach`, pinned by tests.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Then advance: `/spec-review STRK-427 requirements`, then `/spec-discovery STRK-427`.

## CODEX Review (2026-10-10)

### Verified

- Read the live STRK-427 Plane issue, including its superseding 2026-10-10 Discovery Brief; the three-patch scope and one-shape/per-side-orientation decision match this artifact.
- Checked current Item legacy normalization, overrides and derived signals in `js/image-frame.js:8-70`; sparse save/deletion in `js/events.js:1835-1839,1930-1931`; Remove reset at `:3137-3145`; image-swap generation guards and per-side frame movement at `:3210-3261`.
- Checked Collection default/new/stored orientation rules in `js/collections-core.js:231-270`, definition whitelist at `:323-341`, update defaults at `:695-709`, and metadata merge/tie behavior at `:1190-1219`. Verified duplicate picker maps and live orientation handling in `js/collections-picker.js:1193-1286`.
- Checked Album title-side orientation consumption in `js/collections-album.js:105-117`, entry projection in `js/collections-ui.js:734-738`, and conflicting Slab ratios in `css/styles.css:18023-18024,19647-19648`.
- Checked scoped inventory hash precedent in `js/cloud-sync.js:123-164` and raw field comparisons in `js/diff-engine.js:669-692`, against `.context/cloud-sync-convergence.md`. Registration alone does not establish cross-version logical equivalence; the compatibility matrix should also pin hash/diff behavior for equivalent and genuinely different records.
- Read repo instructions, spec conventions, glossary, design guidance, relevant downgrade guidance, `ui-standards/style.html` image-upload patterns, and the referenced STRK-424 orientation playground source.

### Top concerns

1. P1 exposes choices its unchanged Item storage cannot preserve, and lacks an explicit contract for existing mixed legacy frames.
2. Sparse defaults, unconditional legacy projection, and landscape-on-absence can change automatic behavior or saved orientation across save/reopen and older-build edits.
3. The legacy-wins heuristic and Collection metadata bump do not establish US-6's no-loss guarantee; supported cross-version behavior must be bounded and testable.
4. P1 mixed Collection orientation needs visible renderer acceptance; universal legacy visual preservation conflicts with Slab ratio unification.
5. Automatic shape updates for grading/catalog changes remain unspecified.

### Unverified assumptions

- No browser rendering or automated tests were run for this requirements-only peer review; theme, cropping, geometry and accessibility behavior remain implementation verification gates.
- The final approved STRK-427 two-modal mockup, preview size, unified Slab ratio and CSV additions are not yet specified here. The referenced STRK-424 playground provides prior control design, not verification of the new shared editor.
- No cross-version execution proved field preservation or convergence. The findings above identify missing acceptance contracts from live source and the current issue, rather than claiming observed end-to-end failures.

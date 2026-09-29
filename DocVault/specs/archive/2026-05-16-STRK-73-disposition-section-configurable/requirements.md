---
sketch: "STRK-73-disposition-section-configurable"
phase: requirements
created: 2026-05-14
---

# STRK-73 — Requirements

> **Source Issue:** [STRK-73](https://plane.lbruton.cc/lbruton/browse/STRK-73/)
> **Title:** Item detail modal: make Disposition section position-configurable in Appearance settings
>
> **Summary:** When an item is disposed, the Disposition section is always rendered last in the item detail modal — it is hardcoded to append after all other sections and cannot be reordered or positioned by the user. The Appearance > Item Detail Modal settings panel should include a **Disposition** entry so users can move it to their preferred position (e.g., between Valuation and Price History, or below Price History).
>
> **Current Behaviour:** `buildViewContent()` in `js/viewModal.js` calls `_appendSectionsInConfiguredOrder()` first, then unconditionally appends the disposition block at the end (lines 1152–1158) if `isDisposed(item)` is true. The section is not present in `VIEW_MODAL_SECTION_DEFAULTS` and has no entry in the `sectionBuilders` map, so it bypasses the user-configurable order entirely.
>
> **Desired Behaviour:** The Disposition section participates in the same reorder UI as the other nine sections. Users can position it anywhere in the stack using the existing up/down arrow controls. The section only renders content when the item is actually disposed; for non-disposed items the builder returns `null` and the section is silently skipped regardless of its configured position.
>
> **Implementation Notes (from issue):**
> - Add `{ id: "disposition", label: "Disposition", enabled: true }` to `VIEW_MODAL_SECTION_DEFAULTS` in `js/constants.js` (~line 1322). New defaults are appended to existing saved configs by `getViewModalSectionConfig()`, so existing users get the entry appended to their current order on first load — no migration needed.
> - Add a `disposition` entry to the `sectionBuilders` map in `js/viewModal.js`, delegating directly: `disposition: () => _buildDispositionSection(item)`. The builder already returns `null` when `!item.disposition`, so no separate `isDisposed()` guard is needed. `_appendSectionsInConfiguredOrder()` already skips `null`-returning builders.
> - Remove the hardcoded disposition append block at `js/viewModal.js:1152–1158`.
> - The section should **not** have a meaningful enable/disable toggle for non-disposed items — the chip in settings can remain toggleable, but the section renders nothing when the item is not disposed regardless of the enabled flag.
> - The `renderViewModalSectionConfigTable()` UI in `js/settings.js` (~line 2660) requires no changes — it reads from `VIEW_MODAL_SECTION_DEFAULTS` automatically.

## Overview

_One paragraph: what this sketch delivers and why it matters now._

## User Stories

> Format: **As a** [role], **I want** [capability], **so that** [outcome].

- **US-1:** As a user who tracks disposed items, I want to move the Disposition section to my preferred position in the item detail modal, so that I can see disposal details in context alongside the sections I care about most.
- **US-2:** As a casual stacker with no disposed items, I want the Disposition section to remain invisible in the item modal, so that my view is not cluttered by an irrelevant section regardless of settings.

## Acceptance Criteria

> Format: Given/When/Then. Each AC must be verifiable from code or tests after implementation.

### AC-1 — Disposition row appears in settings
- **Given** the user opens Settings > Appearance > Item Detail Modal
- **When** the section config table renders
- **Then** a "Disposition" row is present and can be moved to any position using the existing reorder controls

### AC-2 — Configured order persists
- **Given** the user moves the Disposition row to a new position
- **When** the page reloads
- **Then** the saved position is read from `viewModalSectionConfig` in localStorage and the Disposition section renders at that position for disposed items

### AC-3 — Disposed item renders at configured position
- **Given** an item with `isDisposed(item) === true` AND the Disposition section is enabled in settings
- **When** the item detail modal opens
- **Then** the Disposition section appears at the user-configured position (not hardcoded last)

### AC-4 — Non-disposed item shows no Disposition section
- **Given** an item with `isDisposed(item) === false`
- **When** the item detail modal opens
- **Then** no Disposition section is rendered, regardless of the section's configured position or enabled state

### AC-5 — Graceful default for existing users
- **Given** a user whose `viewModalSectionConfig` in localStorage pre-dates this change (no `disposition` entry)
- **When** the item detail modal or settings panel loads for the first time after the update
- **Then** `getViewModalSectionConfig()` appends the Disposition entry after existing sections with `enabled: true`, without requiring any manual migration or data reset

### AC-6 — Empty disposition object does not render
- **Given** an item with `item.disposition` set to an empty object `{}`
- **When** the item detail modal opens
- **Then** no Disposition section is rendered — the builder treats an empty disposition object as equivalent to no disposition

## Non-Goals

- Not adding any new visual design to the Disposition section itself — this sketch only changes its positional plumbing.
- Not adding enable/disable semantics that are meaningful for non-disposed items — the chip may be toggleable, but toggling it off for non-disposed items has no observable effect (section already renders nothing).
- Not changing the content or layout of the Disposition section UI.
- Not addressing any other hardcoded sections that may bypass `_appendSectionsInConfiguredOrder()` — those are separate concerns.
- Not adding drag-and-drop reordering to the settings UI — this sketch uses the existing arrow-button controls.

## Open Questions

_Anything that blocks the next phase. Empty by the time discovery starts._

- [x] ~~Confirm the exact line range of the hardcoded append block in `viewModal.js` (issue says 1117–1123 — verify against current code).~~ **Resolved:** actual range is `js/viewModal.js:1152–1158` (`buildViewContent` body). Lines 1117–1123 are close-X button wiring in `_renderFooterActions` — unrelated.
- [x] ~~Confirm `getViewModalSectionConfig()` truly handles unknown-key append without special-casing.~~ **Resolved:** `_loadSectionConfig()` at `js/constants.js:1268` appends default entries missing from saved config via `if (!savedMap.has(def.id)) merged.push({ ...def })`. No special-casing required.

---

> **Phase complete.** Acceptance criteria are concrete and verifiable. Open questions resolved. Next: `/sketch review STRK-73 requirements`, then `/sketch discovery STRK-73`.

## Review Archive — requirements (2026-05-15)

_Reconciled by /sketch reconcile on 2026-05-15. Original reviewer marks preserved below for audit._

### DeepSeek

**DEEPSEEK Review (2026-05-15)**

#### Verified

- **`VIEW_MODAL_SECTION_DEFAULTS`** at `js/constants.js:1315-1325`: 9 entries, no `disposition`. Confirmed.
- **`getViewModalSectionConfig()`** at `js/constants.js:1328-1329`: delegates to `_loadSectionConfig()` (line 1260) which appends missing defaults at line 1268. Unknown-key append works without special-casing.
- **Hardcoded disposition append**: actual location is `js/viewModal.js:1152-1158` (`buildViewContent` body), NOT 1117-1123 (`_renderFooterActions` close-X button). Confirmed by direct read.
- **`sectionBuilders` map** at `js/viewModal.js:1138-1148`: 9 entries, no `disposition`. Confirmed.
- **`_appendSectionsInConfiguredOrder()`** at `js/viewModal.js:1021-1033`: skips null-returning builders (line 1031) and missing builders (line 1029). Confirmed.
- **`renderViewModalSectionConfigTable()`** at `js/settings.js:2660-2666`: reads from `getViewModalSectionConfig`. No changes needed. Confirmed.
- **`_buildDispositionSection()`** at `js/viewModal.js:636`: already returns `null` when `!item.disposition` (line 637). Confirmed.
- **`isDisposed()`** at `js/constants.js:497`: pure check `!!item?.disposition`. Confirmed.

#### Top Concerns

1. **Wrong line range in implementation notes.** The requirements and implementation notes reference `js/viewModal.js:1117–1123` as the hardcoded disposition block, but the actual block is at lines 1152–1158. Following the given line range would remove the close-X button wiring in `_renderFooterActions`, breaking the modal close button. This must be corrected before implementation.

2. **`enabled` toggle gate-keeping for disposed items.** AC-3 asserts the Disposition section appears for disposed items "at the user-configured position," but `_appendSectionsInConfiguredOrder()` silently skips disabled sections at line 1027 (`if (!sec.enabled) continue`). If a user disables the Disposition chip in settings, it won't render even for disposed items. The acceptance criteria should explicitly state the enabled precondition, or the non-goal section should clarify that disable means "never show" (even for disposed items) rather than "no effect for non-disposed items."

3. **Empty disposition object edge case.** Both `isDisposed()` (`!!item?.disposition`) and `_buildDispositionSection()` (`!item.disposition`) use truthy checks. An item with `disposition: {}` (empty object) would pass `item?.disposition` truthiness but fail `!item.disposition` — resulting in a Disposition section rendered with all "—" placeholders. This is an unlikely but realistic data corruption edge case not addressed in the requirements.

#### Unverified Assumptions

- **Section builder collision**: The requirements assume no other code path adds a `disposition` key to the `sectionBuilders` map. Grep confirms this — no collision exists today.
- **`_loadSectionConfig` stability**: The append-on-missing-defaults logic in `_loadSectionConfig` (line 1268) is assumed to remain unchanged. This is the sole mechanism providing AC-5's backward compatibility.
- **Default position**: The requirements assume adding `disposition` to the end of `VIEW_MODAL_SECTION_DEFAULTS` is the right default position. No user research is cited, but given all nine existing sections precede it today, appending is a conservative choice.
- **In-memory-only state**: The sketch assumes `sectionBuilders` is rebuilt on every `buildViewContent` call (it's a local `const`, line 1138) and doesn't persist across calls — so adding `disposition` to it is safe. Confirmed: it's function-local, not module-scoped.
- **`_buildDispositionSection` wrapper neutrality**: The sketch proposes a wrapper around `_buildDispositionSection` that calls `isDisposed()` as a guard. But `_buildDispositionSection` already returns `null` for non-disposed items — the `isDisposed()` check is functionally redundant. Using the direct call `disposition: () => _buildDispositionSection(item)` is simpler and equivalent.
- **No layout section interaction**: The requirements assume Disposition belongs only to `viewModalSectionConfig`, not `layoutSectionConfig`. Confirmed: layout config (`js/constants.js:1296-1303`) is a separate namespace with different defaults.

### Codex

**CODEX Review (2026-05-16)**

#### Verified

- `VIEW_MODAL_SECTION_DEFAULTS` currently has nine entries and no `disposition` entry at `js/constants.js:1315-1325`.
- `_loadSectionConfig()` appends missing default entries to saved configs at `js/constants.js:1260-1270`, and `getViewModalSectionConfig()` uses that helper for `viewModalSectionConfig` at `js/constants.js:1327-1329`.
- `saveViewModalSectionConfig()` persists immediately to localStorage and schedules sync at `js/constants.js:1331-1335`.
- `_buildDispositionSection()` returns `null` only when `item.disposition` is falsy at `js/viewModal.js:636-637`; `isDisposed()` is the same truthy disposition check at `js/constants.js:497-499`.
- `_appendSectionsInConfiguredOrder()` skips disabled sections, missing builders, and null-returning builders at `js/viewModal.js:1021-1032`.
- `buildViewContent()` defines the current section builder map without `disposition`, appends configured sections, then hardcodes the disposition append at `js/viewModal.js:1138-1158`.
- Settings > Appearance > Item Detail Modal renders a section config container at `index.html:4205-4214`, and `_renderSectionConfigTable()` implements checkbox plus up/down button controls, not drag/drop, at `js/settings.js:2560-2645`.

#### Top concerns

1. The requirements still promise drag-to-reorder and "saves" behavior, but the live shared control is immediate-persist arrow-button reordering. Either the wording should match the existing UI, or the sketch should explicitly include a new drag/drop settings feature.
2. The stale `js/viewModal.js:1117-1123` implementation target remains in the source issue notes and phase-complete guidance despite review comments proving the real disposition block is `js/viewModal.js:1152-1158`.
3. AC-3 needs the enabled precondition and a focused happy-path test so the implementation proves Disposition is rendered through the configured builder position after the hardcoded fallback append is removed.

#### Unverified assumptions

- Literal drag/drop is not intended for this issue; the desired product outcome is configurable ordering through the existing Appearance section controls.
- Appending Disposition to the end of `VIEW_MODAL_SECTION_DEFAULTS` is the preferred default for existing users, rather than placing it near Valuation or Price History by default.
- A malformed saved `viewModalSectionConfig` that omits `disposition` is acceptable to repair through `_loadSectionConfig()` only, with no separate defensive fallback in `buildViewContent()`.
- Tests for this sketch will cover both the settings row/order persistence and the actual disposed-item modal order, not just the presence of a new default constant.

### Resolution Summary

- Accepted: 8
- Rejected: 0
- Resolved with your input: 1 (empty disposition object → AC-6 added)

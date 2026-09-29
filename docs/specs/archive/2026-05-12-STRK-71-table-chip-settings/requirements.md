---
sketch: "STRK-71-table-chip-settings"
phase: requirements
created: 2026-05-12
---

# STRK-71 — Requirements

> **Source Issue:** [STRK-71](https://plane.lbruton.cc/lbruton/browse/STRK-71/)
>
> **Title:** Table view: user settings to sort/hide inline chips in Name column (attachments, catalog ID, year)
>
> **Summary from issue:** Deferred work from the file-attachments feature. The table view (View D) Name column now renders a set of inline chips — catalog ID badge (e.g. `N#321786`), year badge, and the new attachment-count chip (📎 paperclip + count). Settings/sort options were intentionally punted at the time we shipped attachments and are owed back to users.
>
> **Goal:** Give users explicit control over which inline chips appear in the table-view Name cell, and the order they render in.
>
> **Scope (per issue):** Table view (View D) Name column only. Card views A/B/C chip parity is tracked in a separate sibling issue.

## Overview

STRK-71 closes a single gap in the table view (View D) Name column: the attachment-count chip (📎) is currently rendered unconditionally, outside the `chipMap`/`orderedChips` pipeline that already controls 9 other chip types. The full inline-chip settings infrastructure already exists and is wired end-to-end — `INLINE_CHIP_DEFAULTS` at `js/constants.js:1096`, `getInlineChipConfig()`/`saveInlineChipConfig()` at `:1113`/`:1140`, the "Inline Name Chips" settings panel at `index.html:4181-4188` rendered by `renderInlineChipConfigTable()` at `js/settings.js:2025`. The actual change is narrow: add one `attachment` entry to `INLINE_CHIP_DEFAULTS`, move `attachChip` inside the `chipMap`/`orderedChips` pipeline in `js/inventory-table.js`, and drop the trailing `${attachChip}` concatenation at `:603`. Discovery must treat the existing infrastructure as a constraint, not as something to redesign.

## User Stories

- **US-1:** As a user, I want the attachment chip (📎, currently always-on) to participate in the same visibility-toggle and reorder settings that already govern the 9 other inline chips in the Name cell, so that I can control table layout density the same way I do for every other chip type.
- **US-2:** As a user, I want to set the display order of visible chips in the table view Name column, so that the most important metadata appears closest to the item name.
- **US-3:** As a user, I want my chip visibility and order preferences to persist across app sessions, so that I do not need to reconfigure them every time I use the app. *(Note: persistence via the existing `inlineChipConfig` localStorage key is already implemented — discovery must not redesign it; the only delta is that the attachment chip preference rides on the same key.)*
- **US-4:** As a user upgrading from a version that has no attachment chip settings, I want to see exactly the same chip display I had before — attachment chip visible, in its current rightmost position — so that nothing changes without my involvement. *(Note: the pre-existing chip defaults are chip-by-chip, not "all on"; the new attachment entry will default to `enabled: true`, preserving current always-on behavior.)*

## Acceptance Criteria

### AC-1 — Hide a chip type (maps to US-1)
- **Given** the user opens the preferences/settings panel for table chip display
- **When** they toggle off a specific chip type (e.g., the attachments chip)
- **Then** that chip type no longer appears in any Name cell in the table view, even for rows that have attachment data
- **Fixture note:** The test must use at least one row that has actual attachment data; a row without attachments cannot prove the chip is being suppressed.

### AC-2 — Restore a hidden chip type (maps to US-1)
- **Given** a chip type has been toggled off by the user
- **When** they toggle it back on
- **Then** that chip reappears in all Name cells where its data is present

### AC-3 — All chips hidden (maps to US-1)
- **Given** the user has hidden every configurable chip type
- **When** the table view renders
- **Then** Name cells display no configurable metadata chips (the `disposition-badge` system status indicator, if present, is not a configurable chip and remains unaffected)

### AC-4 — Reorder chips (maps to US-2)
- **Given** the user is viewing chip order settings with at least two chip types enabled
- **When** they change the order of chips via the existing up/down reorder controls in the Inline Name Chips panel
- **Then** table view Name cells reflect the new order: chips render left-to-right matching the user-specified sequence
- **Attachment ordering:** The attachment chip must participate in the configured order. Moving "Attachments" to position 1 in the settings UI must render 📎 to the left of all other chips in the Name cell — it must not be pinned rightmost regardless of settings.

### AC-5 — Preferences persist across sessions (maps to US-3)
- **Given** the user has configured chip visibility and/or order preferences
- **When** they close the browser tab and reopen the app (or reload the page)
- **Then** the table view renders chips exactly as the user last configured them — no revert to defaults

### AC-6 — No-settings default preserves current behavior (maps to US-4)

Two upgrade paths:

**(a) Fresh install (no saved `inlineChipConfig`):**
- **Given** a user has no chip preferences stored
- **When** the table view renders
- **Then** chips appear per the chip-by-chip defaults in `INLINE_CHIP_DEFAULTS`: grade, numista, year are `enabled: true` (as today); the new `attachment` entry is also `enabled: true`, at the end of the default order — preserving the current always-on, rightmost behavior

**(b) Existing user with saved config (pre-STRK-71 upgrade):**
- **Given** a user has a saved `inlineChipConfig` from before STRK-71
- **When** the table view renders after upgrade
- **Then** the `getInlineChipConfig()` merge logic at `js/constants.js:1119-1128` automatically appends the new `attachment` entry at the end of the user's saved order — no migration code is needed; the attachment chip appears rightmost (as before) and is now user-controllable

### AC-7 — Settings do not affect non-table views (maps to US-1, scoping)
- **Given** the user has hidden or reordered chips for the table view
- **When** they switch to any card view (A, B, or C)
- **Then** card views are unaffected — specifically, hiding the table attachment chip must NOT suppress attachment badges in card views (A/B/C)

### AC-8 — Settings UI accessible from the existing preferences panel (maps to US-1, US-2)
- **Given** the user opens the existing settings/preferences panel
- **When** they navigate to Settings → Appearance → Layout → **Inline Name Chips** panel (`#inlineChipConfigContainer`, rendered by `renderInlineChipConfigTable()` at `js/settings.js:2025`)
- **Then** they can see and modify chip visibility and order without any new standalone settings modal or panel being introduced

## Non-Goals

- **Card view chip parity (A/B/C)** — tracked in a separate sibling issue; table view scope only
- **Adding new chip types** — this feature controls existing chips; adding new chip types is out of scope
- **Per-row chip overrides** — settings are global (apply to all table rows), not per-item
- **Chip styling or redesign** — visibility and order only; no restyling
- **Hiding the year/catalog ID columns themselves** — column-level visibility is a different feature; this is only the inline chip in the Name cell
- **Sorting by chip presence or value** — the "sort" in the issue title refers to chip display order, not table column sort behavior
- **`disposition-badge` configurability** — the system status badge rendered in the Name cell for disposed items (`inventory-table.js:603`) is not a metadata chip; it remains always-on and out of scope
- **PCGS chip default-enabled flip** — `pcgs` ships `enabled: false`; no change here
- **numista/pcgs grouping** — numista (`N#…`) and pcgs (`PCGS#…`) remain separate chip controls; no grouped "Catalog ID" toggle
- **`inlineChipConfig` plumbing redesign** — backup, import, diff surfaces already cover this key; no changes needed to `inventory-backup.js`, `diff-modal.js`, or `inventory-import.js`
- **`saveData()`/`loadData()` wrapper refactor** — `saveInlineChipConfig()` currently uses raw `localStorage.setItem`; STRK-71 will not refactor this. A follow-up issue will revisit the wrapper alignment.
- **Card chip config key reuse** — the sibling card-view chip parity issue will use its own separate localStorage key. STRK-71 must not put anything in `inlineChipConfig` that would break card chip settings if the sibling later reads the same key.

## Open Questions

_All open questions resolved during requirements review._

- [x] **OQ-1 — Resolved:** 10 chips render in the Name cell today. 9 are config-controlled via `chipMap` at `js/inventory-table.js:552-562` (grade, numista, pcgs, year, serial, storage, notes, purity, tags). The attachment chip is the 10th, appended unconditionally outside that pipeline at `:567-577`. STRK-71 closes this one gap.
- [x] **OQ-2 — Resolved:** The new `attachment` entry in `INLINE_CHIP_DEFAULTS` will be `enabled: true`, matching current always-on behavior. Zero regression for existing users.
- [x] **OQ-3 — Resolved:** The `attachment` entry is appended at the END of `INLINE_CHIP_DEFAULTS`, matching the current rightmost position (`${orderedChips}${attachChip}` at `:603`). Default order is unchanged.
- [x] **OQ-4 — Resolved:** The card-view chip parity sibling issue will use a separate localStorage key. See Non-Goals for the explicit constraint.

---

> **Phase complete.** Acceptance criteria are concrete and verifiable. Open questions are resolved. Advance: `/sketch review STRK-71 requirements`, then `/sketch discovery STRK-71`.

---

## Review Archive — requirements (2026-05-12)

_Reconciled by /sketch reconcile on 2026-05-12. Original reviewer marks preserved below for audit._

### Opus

**Reviewer:** Opus 4.7 — peer review of Phase = `requirements`. No edits to user stories, acceptance criteria, or non-goals (per role contract); inline comments only, plus the additions to **Open Questions** and the new **Unverified Assumptions** section below.

#### What I verified against the live codebase

| Claim in requirements.md | Verdict | Evidence |
| --- | --- | --- |
| "Table view (View D) Name column renders inline chips" | TRUE | `js/inventory-table.js:597-604` — chips inserted inside `.name-cell-content` |
| "Three chips today: attachments, catalog ID, year" | FALSE — there are **10** chips | `js/inventory-table.js:552-577` enumerates grade, numista, pcgs, year, serial, storage, notes, purity, tags, attachment |
| "Settings/sort options were intentionally punted" | PARTIALLY TRUE | Settings *are* shipped for 9 of 10 chips (`js/settings.js:2025`, `index.html:4181-4188`); only the attachment chip is punted |
| "Persist preferences via `saveData()/loadData()` under `ALLOWED_STORAGE_KEYS`" | ALREADY DONE | `inlineChipConfig` is in `ALLOWED_STORAGE_KEYS` (`js/constants.js:848`,`:937`); persisted via direct `localStorage.setItem` (`js/constants.js:1142`) — NB: not via `saveData()` wrapper, contradicting the issue notes |
| "Default settings preserve current behavior" | DEPENDS on the default chosen for the new `attachment` entry (see OQ-2) — current defaults differ chip-by-chip; see comments on US-4 / AC-6 |
| "Don't invent a new panel — extend the existing one" | Existing panel = "Inline Name Chips" in Settings → Grouping at `index.html:4181` |

#### Top 3 concerns

1. **Massive scope inflation risk.** Reading the doc cold, an implementer (or AI agent) will build a settings panel, persistence layer, and 10-chip rendering loop that already exist. The actual change is on the order of ~20 lines: add one entry to `INLINE_CHIP_DEFAULTS`, move `attachChip` into the `chipMap`, drop the trailing `${attachChip}` concat at `inventory-table.js:603`. The Overview must be rewritten to reflect this before discovery, or the design phase will document a phantom system.
2. **AC-4 reorder claim is currently unfalsifiable for the attachment chip.** The attachment chip is concatenated after `orderedChips`, so it is always rightmost regardless of config. AC-4 needs an explicit clause requiring the attachment chip to participate in user-defined order, or the implementer can leave the bug in place and still pass the test.
3. **Inconsistent default-behavior claim.** US-4 / AC-6 say "all chips appear in their pre-existing default order". The pre-existing defaults are explicitly NOT "all chips on" — pcgs/serial/storage/notes/purity/tags ship `enabled: false`. Either reword to "the chip-by-chip defaults already coded in `INLINE_CHIP_DEFAULTS` are preserved, plus the new `attachment` entry's default is X", or pick a different framing. Without this fix, the upgrade-regression criterion is contradictory.

#### Issues I raised inline (count)

- 8 inline `<!-- OPUS ... -->` comments anchored to specific lines in Overview, US-1, US-3, US-4, AC-4, AC-6, AC-8, Non-Goals, and OQ-1.
- 3 new open questions added (OQ-2, OQ-3, OQ-4).

#### OPUS — Unverified Assumptions

Load-bearing assumptions in the current requirements that are NOT backed by code, docs, or a prior decision visible to me:

1. **A1 — "The current always-on attachment chip is the desired default."** The doc implies `attachment` should default to visible (US-4 / AC-6), but the issue body never states this — it only says "default settings preserve current behavior". Reasonable, but unverified.
2. **A2 — "Discovery should enumerate all current chips."** OQ-1 implies discovery has not done this; in fact, the enumeration is trivial from `chipMap` in `inventory-table.js:552-562`. Discovery time should be spent on the integration design, not re-enumeration.
3. **A3 — Settings UI placement.** Doc says "settings/preferences panel" generically. Concrete location is **Settings → Grouping → "Inline Name Chips"** (`index.html:4181`). Discovery may otherwise propose a "Table Display" subsection that conflicts with the issue's "don't invent a new panel" guidance.
4. **A4 — Persistence key reuse.** The doc does not name the key. Reusing the existing `inlineChipConfig` localStorage key is the correct call (and the `getInlineChipConfig` merge logic at `js/constants.js:1119-1128` already supports forward-additive defaults). Discovery should treat this as a constraint, not a design choice.
5. **A5 — Card views are completely independent.** AC-7 / Non-Goals assert this, but the codebase does not currently call `getInlineChipConfig()` from `js/card-view.js` at all (grep returned zero hits). So today AC-7 is trivially true. The risk is that the sibling card-view issue later REUSES the same key — see OQ-4. Worth a sentence pinning the scope.
6. **A6 — `saveData()`/`loadData()` requirement.** Issue body says "Persist preferences via `saveData()` / `loadData()`". Current `saveInlineChipConfig` uses raw `localStorage.setItem` — same physical effect, different wrapper. Either the issue is wrong, or there is an undocumented preference for the wrapper. Resolve before discovery, otherwise an implementer may either (a) refactor existing 9-chip persistence to satisfy the issue verbiage, or (b) keep raw `localStorage` and trip on review.

#### Alternatives the requirements author did not weigh

The doc narrows to a single solution shape (toggle + reorder UI per chip). Two alternatives worth at least naming before /sketch advances:

- **A. Minimal-fix scope** — just add `attachment` to `INLINE_CHIP_DEFAULTS` and route it through the existing `chipMap`. No new UI work, no new tests beyond the AC for attachment-specific behavior. Estimated complexity: trivial.
- **B. "Density preset" approach** — a single dropdown ("Compact / Default / Verbose") that maps to pre-curated chip subsets, instead of per-chip toggles. Cheaper for users to discover and use, but discards the existing per-chip UX. Probably rejected, but worth a one-line "considered and rejected because…".
- **C. Status quo + smarter overflow** — keep all chips always-on but truncate/wrap intelligently when the Name cell exceeds a width budget. Different solution to the same "visual density" pain point in the Goal. Probably rejected because the issue explicitly asks for user control, not auto-layout.

---

### Codex

#### CODEX Review (2026-05-12)

##### What I verified

- Plane STRK-71 exists and its body asks for visibility toggles, display-order controls, persistence under an allowed key, unchanged defaults, and table-view-only scope.
- The existing app already has an Inline Name Chips config path: `inlineChipConfig` is in sync/allowed storage (`js/constants.js:848`, `js/constants.js:937`), defaults and merge/save logic live at `js/constants.js:1096-1147`, the settings UI is rendered by `renderInlineChipConfigTable()` (`js/settings.js:2025-2033`), and the live panel sits under Settings > Appearance > Layout (`index.html:3366-3385`, `index.html:3862-3864`, `index.html:4127-4188`).
- The table Name cell currently renders nine config-controlled chips through `chipMap` / `orderedChips` (`js/inventory-table.js:552-566`) plus an unconditional attachment chip outside that pipeline (`js/inventory-table.js:567-577`, `js/inventory-table.js:603`).
- Backup/import/diff plumbing for the existing key is already present (`js/inventory-backup.js:81`, `js/inventory-backup.js:421-422`, `js/diff-modal.js:59-65`, `js/diff-modal.js:149-153`, `js/inventory-import.js:1466-1473`).
- Card views have a separate attachment-chip path and do not use `getInlineChipConfig()` (`js/card-view.js:627-631`, `js/card-view.js:672-720`).

##### Top 3 issues raised

1. **Scope is still too broad for the live codebase.** The requirements read like the settings system is missing, but the verified gap is narrower: the attachment chip needs to join the existing `INLINE_CHIP_DEFAULTS` / `chipMap` / `orderedChips` flow.
2. **Default behavior is under-specified.** Fresh installs and existing users with saved `inlineChipConfig` take different code paths (`js/constants.js:1119-1133`), so the attachment chip needs explicit default visibility and default placement for both paths.
3. **Several acceptance criteria are not yet falsifiable enough.** AC-1 needs an attachment-bearing row fixture, AC-3 needs disposed/status badge behavior clarified, AC-4 must require attachment ordering through existing up/down controls, and AC-7 should explicitly protect card attachment badges.

##### CODEX — Unverified Assumptions

- **A1 — Attachment defaults visible.** The issue says preserve current behavior, which implies `attachment` should default to enabled, but that exact product choice is not yet stated in requirements.
- **A2 — Attachment default position is rightmost.** Current behavior appends `${attachChip}` after `${orderedChips}` (`js/inventory-table.js:603`), but requirements do not state whether the new default should preserve that rightmost position for fresh installs and saved-config upgrades.
- **A3 — Catalog ID remains two controls.** Code treats Numista and PCGS separately (`js/constants.js:1098-1100`; `js/inventory-table.js:474-486`), while prose says "catalog ID badge" as if it might be one control.
- **A4 — Existing storage key is the intended key.** Reusing `inlineChipConfig` is strongly supported by the code, but the issue text says "add to `ALLOWED_STORAGE_KEYS`" as if a new key might be expected.
- **A5 — Disposition badges are not configurable chips.** The Name cell can include a `disposition-badge` (`js/inventory-table.js:603`), but requirements do not say whether "all chips hidden" leaves status badges visible.
- **A6 — Card parity will use a separate setting.** Card views currently have independent attachment-chip rendering (`js/card-view.js:627-631`), but the sibling card-view issue could later reuse `inlineChipConfig` unless this scope boundary is explicit.
- **A7 — No storage/import/export redesign is wanted.** The existing key already participates in backup, import, and diff surfaces; requirements do not yet say this work must avoid creating a parallel persistence path.
- **A8 — Existing up/down reorder controls are acceptable.** The app already has reorder buttons in `_renderSectionConfigTable()` (`js/settings.js:2616-2633`), but the requirements do not explicitly reject drag-and-drop, numeric ordering, or a new Table Display panel.
- **Alternatives not weighed:** minimal attachment-only integration into the existing config path; a separate `tableInlineChipConfig` key to preserve future card-view independence; density presets instead of per-chip controls; grouped Catalog ID control versus separate Numista and PCGS controls.

---

### Resolution Summary
- Accepted: 14
- Rejected: 1 (OPUS alternatives block — issue already specifies per-chip toggle UX; alternatives considered and rejected)
- Resolved with your input: 4 (OQ-2 → `enabled: true`; Catalog ID → keep numista/pcgs separate; OQ-4 → card parity uses its own key; saveData() wrapper → no refactor in STRK-71, follow-up issue to be filed)

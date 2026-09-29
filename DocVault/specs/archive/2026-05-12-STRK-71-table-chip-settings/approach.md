---
sketch: "STRK-71-table-chip-settings"
phase: approach
created: 2026-05-12
---

# STRK-71 — Approach

## High-Level Architecture

STRK-71 is a surgical integration of one chip into a fully-built pipeline. The inline-chip infrastructure (`INLINE_CHIP_DEFAULTS` → `getInlineChipConfig()` → `chipMap` → `orderedChips`) already exists, is wired end-to-end, and handles all settings UI, persistence, backup/import/diff, and cloud-sync concerns automatically for any chip registered in it. The attachment chip today bypasses this pipeline: it is constructed after `chipMap` at `js/inventory-table.js:567-577` and appended unconditionally as `${attachChip}` in the Name cell template at `:603`.

The entire runtime change is: (1) add one entry to `INLINE_CHIP_DEFAULTS` in `js/constants.js`, (2) relocate the `attachChip` construction block in `js/inventory-table.js` so it precedes `chipMap`, (3) add `attachment: attachChip` to `chipMap`, and (4) drop the trailing `${attachChip}` from the Name cell template. No new modules, no new settings UI, no new persistence logic. The `getInlineChipConfig()` forward-additive merge (`js/constants.js:1123-1127`) automatically gives upgraded users the new entry at the end of their saved config — no migration code needed.

The test surface is entirely greenfield. No existing Playwright spec exercises `inlineChipConfig` toggle or reorder behavior against the table view. A new integration spec will cover AC-1 through AC-8, seeding at least one item with attachments, toggling the attachment chip via the existing Settings panel at `#inlineChipConfigContainer`, and asserting `.attach-count-chip` presence/absence and relative position in the Name cell.

## Key Decisions

| #   | Decision                                                                                                         | Rationale                                                                                                                                                                                                                                                                                                                                        | Tradeoff                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | **Block reorder** (move `attachChip` construction block above `chipMap`)                                         | Minimum diff — 11 lines relocated, no new abstractions, consistent with every other chip being computed inline before `chipMap`. The block already has access to `item` and `originalIdx` as loop-local variables, so no signature change is needed.                                                                                             | Breaks co-location: `attachChip` construction moves away from the attachment-specific code that currently follows `chipMap`. Accepted — the coupling is physical proximity, not a logical contract. Note: in the **disabled-attachment** case the badge is still constructed via `renderAttachmentBadge()` (which does DOM work via `document.createElement`) and then discarded by the `c.enabled && chipMap[c.id]` filter at `js/inventory-table.js:563-566`. This matches the eager evaluation pattern of every other chip (e.g. `tagsChip` at `:547-550`), but the residual cost is wasted construction, not a rendering bug. The tasks phase will include a regression sanity check with a high-row-count fixture. |
| D-2 | **Inline `onclick` attribute preserved** — do NOT switch to `renderAttachmentBadge`'s `{ onClick }` callback API | `inventory-table.js` builds row HTML via string concatenation and `.outerHTML`. `renderAttachmentBadge`'s `onClick` path uses `addEventListener` — event listeners are stripped when the element is serialized via `.outerHTML`. The existing inline `onclick` string attribute at `:571-575` is doing real work and must be preserved verbatim. | A third option exists in this codebase — **delegated `tbody` click handling** (via a `data-` attribute on the chip plus a handler in the existing delegated listener at `js/inventory-table.js:707-742`). It is viable but touches the table event model and is rejected for STRK-71 scope. Not "no tradeoff" — a scoped rejection.                                                                                                                                                                                                                                                                                                                                                                                     |
| D-3 | **`attachment` defaults to `enabled: true`, appended last in `INLINE_CHIP_DEFAULTS`**                            | Preserves current always-on, rightmost behavior for fresh installs and upgraded users. The `getInlineChipConfig()` merge appends new defaults at the end of any saved config (`:1123-1127`), replicating the current `${orderedChips}${attachChip}` ordering automatically.                                                                      | None — this is the only default that does not regress existing users.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D-4 | **`inlineChipConfig` key reused, no new key**                                                                    | The attachment entry belongs in the existing key. Backup, import, diff, and cloud-sync surfaces are already shape-agnostic over this array — a 10-entry array round-trips identically to a 9-entry one.                                                                                                                                          | Constraint: the sibling card-view chip parity issue MUST use a separate key (already agreed in requirements). This decision does not affect that; it is a constraint, not a risk.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D-5 | **No refactor of `saveInlineChipConfig` to use `saveData()` wrapper**                                            | Pre-existing inconsistency; STRK-71 does not own it. New entry rides the same raw `localStorage.setItem` path as the existing 9.                                                                                                                                                                                                                 | Technical debt persists. A follow-up issue should track the wrapper alignment (see Out of Scope).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## File Map

### New

- `tests/playwright/03-settings/04-inline-chip-attachment.spec.js` — integration spec covering AC-1 (hide), AC-2 (restore), AC-3 (all hidden + disposition badge unaffected), AC-4 (reorder via existing up/down controls — **including an explicit assertion that moving "Attachments" to position 1 in the settings UI renders `.attach-count-chip` LEFT of all other chips in the Name cell, not pinned rightmost; mirrors requirements.md:52**), AC-5 (persist across reload), AC-6 (default preserves current behavior), AC-7 (card views unaffected), AC-8 (settings UI accessible from the existing "Inline Name Chips" panel; assert the 10th row labeled "Attachments" is visible and the panel container does not overflow at default viewport).
  - **Fixture seeding:** the shared `tests/fixtures/seed-inventory.js` (221 lines, 8 items) has **zero** `attachments` or `disposition` fields (verified). The new spec cannot rely on `injectSeedInventory()` to prove AC-1, AC-3, or AC-4. It must seed at least one attachment-bearing row and at least one disposed row directly via `page.evaluate(() => localStorage.setItem(...))` or an equivalent test-local seed helper before navigation.

### Modified

- `js/constants.js` — two edits:
  1. Add `{ id: "attachment", label: "Attachments", enabled: true }` as the 10th entry in `INLINE_CHIP_DEFAULTS` (line 1106, after `tags`).
  2. Optional nice-to-have (not blocking): update the stale comment at `js/constants.js:848` (`// inline chip config (grade, year, etc.)`) to either include `attachment` in the example list or drop the parenthetical. Cosmetic only.
- `js/inventory-table.js` — three edits in the row-render loop:
  1. Move `attachChip` construction block (currently lines 567-577) to before `chipMap` (currently line 552), immediately after the `tagsChip` construction at line 550.
  2. Add `attachment: attachChip` to `chipMap` (after `tags: tagsChip`).
  3. At line 603, drop `${attachChip}` from the Name cell template — surviving template is `...${isDisposed(item) ? '<span class="disposition-badge...">' : ""}${orderedChips}` (disposition badge unmodified, `${attachChip}` removed).
- `css/styles.css` — add `.attach-count-chip` to the no-shrink selector at `css/styles.css:5369-5380`. **Real defect surfaced by AC-4, not optional polish.** The current selector enumerates every chip class explicitly (`.year-tag`, `.numista-tag`, `.pcgs-tag`, `.grade-tag`, `.serial-tag`, `.storage-tag`, `.notes-indicator`, `.purity-tag`, `.tags-inline-chip`) and omits `.attach-count-chip`. Today this is invisible because the attachment chip is always rightmost. After STRK-71, AC-4 lets a user place Attachments at position 1, sandwiched between `.filter-text` (which is `flex: 1 1 0`) and other chips. Without `flex-shrink: 0` the attachment chip can compress or clip under flex pressure. One-line edit, single CSS rule.

### Deleted

- None

### Optional (courtesy, zero test impact)

- `tests/fixtures/settings-diff-test.json` — add `attachment` entry to reflect current defaults; orphan doc with no consuming tests (see Constraints in discovery, and Risk Notes below).

## Data / Schema Changes

The `inlineChipConfig` localStorage key gains one entry (`{ id: "attachment", label: "Attachments", enabled: true }`) appended by the forward-additive merge in `getInlineChipConfig()`. No explicit migration. Backup/import/diff/cloud-sync surfaces have been verified end-to-end for the **static paths**: sync-scope key inclusion (`js/constants.js:937`), backup capture/restore (`js/inventory-backup.js:81,421-422`), import (`js/inventory-import.js:176-190`), and diff rendering/merge (`js/diff-modal.js:149-153,270-367,2650-2691`) all treat the key shape-agnostically over array length. A **live cloud-sync round trip** has not been run; treating it as an implementation assumption — the tasks phase should include a smoke check during apply.

## Tradeoffs Surfaced for Review

Four implementation shapes were considered for routing the attachment chip into the existing pipeline. Block-move (D-1) is the chosen shape; the remaining three are named and explicitly rejected so future readers can see why:

- **Block reorder (chosen, D-1).** Move the `attachChip` construction block above `chipMap`. ~11 lines relocated, no new abstractions. Cost: physical-proximity coupling with the attachment-specific code that currently follows `chipMap` is broken; eager `renderAttachmentBadge()` runs even when the chip is disabled (residual cost: wasted DOM construction, no rendering bug).
- **Extracted helper (rejected — premature abstraction).** Pull `attachChip` construction into a named helper (e.g. `buildTableAttachmentChip(item, idx)`). Restores locality at the cost of a new function and a larger diff. For 11 lines of loop-local code, not worth the indirection.
- **Lazy `chipMap` factory (rejected — out of scope; future work).** Change `chipMap` values to factory functions evaluated only when `c.enabled` is true. This is the only shape that addresses the eager-DOM-construction concern raised in review, but it refactors the entire chipMap pipeline (all 9 existing chips + the new one). Correct future-work shape; wrong scope for STRK-71.
- **Delegated `tbody` click handler (rejected — touches existing event model).** Replace the inline `onclick` string attribute with a `data-` attribute on `.attach-count-chip` and a handler in the existing delegated listener at `js/inventory-table.js:707-742`. Compatible with the `.outerHTML` string-render path (unlike `renderAttachmentBadge`'s `{ onClick }` callback). Rejected because expanding the table event model is broader than STRK-71's chip-routing goal.

Additional UX delta surfaced for review:

- **Settings UI gains a visible new row.** After STRK-71, the "Inline Name Chips" panel shows an "Attachments" row that did not exist before. This is the intended outcome — users who want to toggle or reorder the attachment chip now can. There is no way to register the chip with the pipeline without it appearing in settings; that is the correct design.

## Out of Scope (follow-up issues)

- **`saveData()` / `loadData()` wrapper alignment for `saveInlineChipConfig`** — the raw `localStorage.setItem` inconsistency pre-dates STRK-71. A follow-up issue should own this. _(No issue currently filed; the tasks phase will schedule the filing.)_
- **Card view chip parity (A/B/C)** — sibling issue; own localStorage key; independent scope.
- **Lazy `chipMap` factory refactor** — see Tradeoffs above; correct future-work shape, wrong scope for STRK-71.

## Risk Notes

- **`chipMap[c.id]` falsy filter, no-attachment rows** — when `attachChip = ""` (item has no attachments), the `orderedChips` filter (`c.enabled && chipMap[c.id]`) correctly excludes it. Identical to all other chips (e.g., `gradeTag = ""` when no grade). No special handling needed; the existing pipeline already does the right thing. Risk: none.
- **`chipMap[c.id]` falsy filter, disabled-attachment rows** — under D-1, `attachChip` is non-empty for attachment-bearing rows when the user has disabled the chip; the filter excludes it via `c.enabled` (not via the empty-string check). Behavior is correct; residual cost is wasted badge construction per disabled row. Risk: performance only, not correctness; tasks phase to add a regression sanity check.
- **Orphan fixture** — `tests/fixtures/settings-diff-test.json` has no consuming tests (`rg "settings-diff-test"` returns zero hits). Updating it is a courtesy. Skipping it will not break any test. Risk: none either way.
- **`scheduleSyncPush()` and cloud-sync round trip** — the 10-entry shape will be serialized through cloud sync. Static paths (sync-scope key inclusion at `js/constants.js:937,1140-1147`, diff renderer, import restore) are shape-agnostic and verified. A live remote round trip has not been run. Risk: low; tasks phase should include a smoke check, not "already verified" end to end.
- **Settings-panel layout for a 10-row table** — `_renderSectionConfigTable` renders entries via `config.forEach` at `js/settings.js:2582` with no hardcoded row count; the maxSortable bound is computed dynamically. The 10-row panel needs no HTML/CSS change. Visual sanity check belongs in the new Playwright spec (AC-8 assertion: the 10th row labeled "Attachments" is visible and the panel container does not overflow at default viewport). Risk: low.

---

> **Phase complete.** Architecture clear, decisions logged with rationale, file map complete. Next: `/sketch tasks STRK-71`.

## Review Archive — approach (2026-05-12)

_Reconciled by /sketch reconcile on 2026-05-12. Original reviewer marks preserved below for audit._

### Codex

#### CODEX Review (2026-05-12)

##### What I Verified

- `INLINE_CHIP_DEFAULTS`, `getInlineChipConfig()`, and `saveInlineChipConfig()` are in `js/constants.js:1096-1147`; `inlineChipConfig` is in sync/allowed storage at `js/constants.js:848` and `js/constants.js:937`; the API is exposed at `js/constants.js:1913-1916`.
- Table rendering loads chip config at `js/inventory-table.js:403-405`; current `chipMap` / `orderedChips` are at `js/inventory-table.js:552-566`; `attachChip` is built separately at `js/inventory-table.js:567-577`; the Name cell appends `${orderedChips}${attachChip}` at `js/inventory-table.js:597-604`.
- `renderAttachmentBadge()` returns the table `.attach-count-chip` element and uses `addEventListener` for its optional callback at `js/attachment-ui.js:262-280`; the table serializes rows through `tbody.innerHTML = rows.join("")` at `js/inventory-table.js:703`.
- The existing settings UI is real: Settings > Appearance > Layout > Inline Name Chips is in `index.html:3366-3385` and `index.html:4127-4188`; `renderInlineChipConfigTable()` delegates to `_renderSectionConfigTable()` at `js/settings.js:2025-2033` and `js/settings.js:2560-2647`.
- Card views are currently independent of `getInlineChipConfig()`: card attachment chips render in `js/card-view.js:627-631`, and `rg "getInlineChipConfig" js/card-view.js tests/playwright` returned no matches.
- Backup/import/diff have static support for the existing key: `js/inventory-backup.js:81`, `js/inventory-backup.js:421-422`, `js/inventory-import.js:176-190`, `js/inventory-import.js:1466-1473`, `js/diff-modal.js:149-153`, `js/diff-modal.js:270-367`, and `js/diff-modal.js:2650-2691`.
- Existing tests do not cover the new behavior: `tests/playwright/03-settings/03-appearance.spec.js:120-135` only checks the container, `tests/playwright/attachments/ui.spec.js:6-57` only checks default/card badge helper behavior, and `tests/fixtures/seed-inventory.js:1-221` has no attachment or disposition fixture rows.

##### Top 3 Issues Raised

1. **Test-plan drift from requirements.** The approach says the new spec covers AC-1 through AC-7, but requirements now include AC-8 for existing settings-panel access. The file map should include that assertion.
2. **Fixture assumptions are under-specified.** The proposed Playwright spec needs custom seeded rows for attachments and disposition badges because the shared seed inventory cannot prove AC-1 or AC-3.
3. **The inline-handler decision overstates the tradeoff.** Keeping the current inline `onclick` is a reasonable narrow choice, but delegated handling is a real alternative in this codebase and should be rejected explicitly for scope rather than treated as impossible.

#### CODEX — Unverified Assumptions

- **A1 — Eager badge construction is cheap enough.** The block-move approach will construct `attachChip` before the enabled filter for every attachment-bearing row; no performance check is specified.
- **A2 — Live cloud-sync round trip is shape-agnostic.** Static key inclusion, backup/import, and diff rendering are verified, but no actual cloud-sync push/pull was run.
- **A3 — The new settings row needs no visual/layout adjustment.** `_renderSectionConfigTable()` should pick up the new entry automatically, but the approach does not require a visual check of the 10-row panel.
- **A4 — Card-view parity remains separate by future discipline.** Current card views do not call `getInlineChipConfig()`, but the sibling issue still needs to avoid reusing this key.
- **A5 — Inline `onclick` debt is acceptable for STRK-71.** Existing code uses inline handlers heavily, but the approach should treat that as scoped technical debt rather than no tradeoff.

### Gemini

#### GEMINI Review (2026-05-12)

##### What I Verified (with citations)

- **`INLINE_CHIP_DEFAULTS`**: Verified it exists at `js/constants.js:1096-1106` with 9 entries, ending with `tags`.
- **Merge Logic**: Verified `getInlineChipConfig()` at `js/constants.js:1113-1134` uses a forward-additive merge (`:1123-1127`) that appends new defaults not present in the saved config.
- **`chipMap` & `orderedChips`**: Verified they are constructed at `js/inventory-table.js:552-566`.
- **`attachChip` Block**: Verified it exists at `js/inventory-table.js:567-577` and is currently evaluated after `chipMap`.
- **Name Cell Template**: Verified it is exactly `${isDisposed(item) ? '<span class="disposition-badge...">' : ""}${orderedChips}${attachChip}` at `js/inventory-table.js:603`.
- **`onClick` serialization limitation**: Verified that `renderAttachmentBadge` utilizes `addEventListener` (`js/attachment-ui.js`), which `.outerHTML` in the table rendering loop strips out, making the inline `onclick` attribute necessary.
- **Testing Scope**: Confirmed that `inlineChipConfig` table interactions are currently un-tested in Playwright.

##### Top 3 Concerns / Issues Raised

1. **Performance of Eager DOM Creation**: `renderAttachmentBadge` creates DOM elements. Moving this above `chipMap` evaluates it unconditionally for all rows with attachments, even if the user toggled the chip off. This matches the eager evaluation pattern of other chips, but DOM creation is heavier than the string interpolation used by other chips.
2. **Missing UI Regression Check in Playwright**: While AC-1 through AC-7 are covered by the proposed integration spec, there should be an explicit check that the "Inline Name Chips" settings panel correctly renders the new "Attachments" label without visually breaking the panel layout.
3. **Card-View Key Collision Risk**: The decision correctly identifies the need for a separate key for card views, but we must ensure `getInlineChipConfig` is not accidentally imported/called by `card-view.js` during this change, which could couple them prematurely.

##### Unverified Assumptions

1. **A1 - Eager Evaluation is Performant Enough:** The approach assumes evaluating `renderAttachmentBadge` unconditionally for every attachment-bearing row (even when hidden) won't cause table rendering performance regressions.
2. **A2 - Settings UI Dynamic Binding:** Assumes `renderInlineChipConfigTable()` at `js/settings.js:2025` will automatically pick up the new 10th entry without CSS or layout adjustments to the `#inlineChipConfigContainer`.
3. **A3 - Playwright Test Isolation:** Assumes the new integration test `04-inline-chip-attachment.spec.js` will not conflict with the existing `03-appearance.spec.js` if run in parallel (e.g. they don't clobber the same localStorage state in the same browser context).

##### Alternative Alternatives Not Weighed

- **Alternative 1: Lazy Chip Evaluation:** Instead of evaluating `attachChip` as a string upfront, alter `chipMap` values to be factory functions (e.g., `attachment: () => { ... }`). The `orderedChips` pipeline would evaluate them only if `c.enabled` is true. This prevents DOM creation overhead for hidden chips.
- **Alternative 2: Extracted Helper with Visibility Check:** `buildTableAttachmentChip(item, isEnabled)`. This would keep the block out of the main loop body but only execute DOM creation if `isEnabled` is true.

### Opus

#### OPUS Review (2026-05-12)

##### What I Verified

- `INLINE_CHIP_DEFAULTS` is a 9-entry array at `js/constants.js:1096-1106`, ordered `grade, numista, pcgs, year, serial, storage, notes, purity, tags`. Of these, only `grade`, `numista`, `year` default `enabled: true`; the other six default `enabled: false`. So the rendered chip set for a fresh-install user today is `grade, numista, year, attachChip` (post-STRK-71: `grade, numista, year, attachment`) — preserving the current rightmost position ✓.
- `getInlineChipConfig()` at `js/constants.js:1113-1134` confirmed forward-additive (appends new defaults at `:1123-1127`) **and** backward-filtering (drops unknown ids at `:1121`). Approach's no-migration claim verified.
- `saveInlineChipConfig()` at `js/constants.js:1140-1147` uses raw `localStorage.setItem` and conditionally calls `scheduleSyncPush()` — confirmed wrapper drift; approach correctly punts to follow-up.
- `chipMap` at `js/inventory-table.js:552-562` and `orderedChips` at `:563-566` confirmed; filter is `c.enabled && chipMap[c.id]` so empty-string chips (`""`) are correctly excluded.
- `attachChip` construction at `js/inventory-table.js:567-577` confirmed; uses loop-local `item` and `originalIdx`. The block-move target location (immediately after `tagsChip` at `:550`) has both variables in scope. ✓ no closure refactor needed.
- Name cell template at `js/inventory-table.js:603` confirmed: `${disposition-badge-conditional}${orderedChips}${attachChip}`.
- `renderAttachmentBadge` at `js/attachment-ui.js:262-281` confirmed — `onClick` uses `addEventListener` at `:274` which is stripped by `.outerHTML` serialization at `js/inventory-table.js:703`. D-2's `.outerHTML` reasoning verified.
- Settings UI: `renderInlineChipConfigTable` at `js/settings.js:2025-2033` delegates to `_renderSectionConfigTable` at `:2560-2647`. The generic renderer iterates over the config array via `config.forEach` at `:2582` — automatically renders one new "Attachments" row for the 10th entry. AC-8 trivially satisfied ✓.
- Settings panel `#inlineChipConfigContainer` exists at `index.html:4185` inside "Inline Name Chips" group at `index.html:4181`. No HTML change needed.
- `inlineChipConfig` registered in both allowed-storage (`js/constants.js:848`) and sync-scope (`js/constants.js:937`). The comment at line 848 reads `"// inline chip config (grade, year, etc.)"` — stale but cosmetic.
- `tests/fixtures/seed-inventory.js` is 221 lines, 8 items, **zero** `attachments` or `disposition` fields (confirmed via grep). CODEX's fixture concern is correct: the test plan cannot rely on the shared seed; the new spec must seed attachment-bearing and disposed rows directly.
- `css/styles.css:5369-5380` flex-shrink-0 selector enumerates **every chip class explicitly** but omits `.attach-count-chip`. See Issue #1 below.

##### Top 3 Issues

1. **CSS flex-shrink gap — `.attach-count-chip` is not in the no-shrink selector list.** `css/styles.css:5369-5380` lists every chip class explicitly (`.year-tag`, `.numista-tag`, `.pcgs-tag`, `.grade-tag`, `.serial-tag`, `.storage-tag`, `.notes-indicator`, `.purity-tag`, `.tags-inline-chip`) to set `flex-shrink: 0`. The attachment chip uses `.attach-count-chip` (`css/styles.css:15152`) which has its own styling but no `flex-shrink: 0` rule. Today this is invisible because `attachChip` is always rightmost and only butts up against the right edge of the cell. After STRK-71, AC-4 lets a user reorder Attachments to **position 1**, where it sits between `.filter-text` (a `flex: 1 1 0` consumer) and other chips. Under flex pressure on narrow viewports or long names, the unprotected `.attach-count-chip` can compress or be clipped. The file map must include `css/styles.css` and add `.attach-count-chip` to the selector at line 5378. **This is the single concrete defect in the current approach.**
2. **Alternatives narrative is too narrow.** The "Tradeoffs Surfaced for Review" section presents block-move vs extracted helper as the only two shapes. Discovery surfaced **three** options (block-move, lazy chipMap value, extracted helper at `discovery.md:53-56`) and Gemini's inline review proposed a **fourth** (lazy chipMap factory evaluated only when `c.enabled`, line 111-112). The lazy-factory approach is the only one that addresses Gemini's "unconditional DOM creation" perf concern. Approach should explicitly name and reject it (probably "out of scope — refactors the whole chipMap pipeline") rather than implying it doesn't exist.
3. **AC-4 attachment-specific assertion not surfaced in the test plan.** The file-map entry for the new spec lists "AC-4 (reorder via existing up/down controls)" generically. But the requirements doc at `requirements.md:52` specifically requires: "Moving 'Attachments' to position 1 in the settings UI must render 📎 to the left of all other chips … it must not be pinned rightmost regardless of settings." A generic reorder test against, say, grade and numista, would pass even if an implementer left `${attachChip}` as a trailing suffix. The test plan must require an explicit assertion that the attachment chip can be reordered out of the rightmost position.

##### OPUS — Unverified Assumptions

1. **A1 — CSS without flex-shrink-0 works in practice for attachment.** I have not visually tested an item with a long name + attachment chip in position 1 on a narrow viewport. The theoretical risk is real (the selector explicitly enumerates and the attach class is absent); the practical impact may be small for items with short names. Either way, the fix is one-line.
2. **A2 — `scheduleSyncPush()` end-to-end propagation.** Approach states "already verified in discovery" for cloud-sync; CODEX correctly downgraded this to "static paths verified, no live round trip". I echo: the 10-entry shape is statically compatible but no live sync test has been run.
3. **A3 — The `.attach-count-chip` `cursor: pointer` (`css/styles.css:15163`) remains correct in non-rightmost positions.** Likely fine — cursor is position-independent — but worth a visual check during implementation.
4. **A4 — The settings-panel `_renderSectionConfigTable` `idx` closure works correctly at idx=9.** The handlers at `js/settings.js:2596-2604` and `:2624-2634` use `cfg.at(idx)` / `cfg.splice(idx, ...)`. Indexing should work uniformly for 10 entries vs 9, but the maxSortable bound (`cfg.filter((c) => !c.locked).length`) is computed dynamically — no hardcoded 9 anywhere. ✓ should hold, not verified by simulation.
5. **A5 — The `_renderSectionConfigTable` does not need any visual/layout adjustment for a 10-row table.** Echo Gemini A2. The panel is unbounded vertically so this should hold; not visually verified.
6. **A6 — No follow-up issue currently filed for `saveData()` wrapper alignment.** Approach references this as Out of Scope. Discovery already noted the follow-up isn't filed. If STRK-71 ships without filing it, the wrapper drift quietly persists indefinitely (Opus discovery assumption #2 still unresolved).
7. **A7 — The `// inline chip config (grade, year, etc.)` comment at `js/constants.js:848` should be updated.** Trivial; not a blocker. Either update it to include attachment, or remove the example list entirely. Approach is silent.

### Resolution Summary

- Accepted: 12
- Rejected: 3 — (1) GEMINI top-3 #3 "Card-view key collision risk" already addressed by D-4 and verified-zero `getInlineChipConfig` references in `card-view.js`; (2) GEMINI A1 "Eager evaluation performant enough" absorbed into D-1 wording, not tracked separately; (3) OPUS A6 "Filing the saveData() follow-up" already noted as Out of Scope, filing belongs to tasks phase not approach phase.
- Resolved with your input: 0 — judgment calls applied directly per the "make the reasonable call" instruction. Notable: stale-comment cleanup added as nice-to-have not blocking; settings-panel layout assertion routed into the new Playwright spec rather than a separate manual-check task; saveData() follow-up filing deferred to tasks phase.

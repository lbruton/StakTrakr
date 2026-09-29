---
sketch: "STRK-73-disposition-section-configurable"
phase: discovery
created: 2026-05-14
---

# STRK-73 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

_Files and modules already in the project that this work will touch or build on. Include paths and a one-line note on each._

| Path                                                                                                                                       | Role                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `js/constants.js:1260-1279`                                                                                                                | Section config loader           | `_loadSectionConfig()` merges saved config with defaults and appends any default section missing from the saved array, which is the backward-compatibility path for existing users.                                                                                                                                                                                                                    |
| `js/constants.js:1315-1329`                                                                                                                | View-modal section defaults     | `VIEW_MODAL_SECTION_DEFAULTS` currently has nine entries and no `disposition` row; `getViewModalSectionConfig()` reads these defaults through `_loadSectionConfig()`.                                                                                                                                                                                                                                  |
| `js/constants.js:1331-1335`                                                                                                                | View-modal section persistence  | `saveViewModalSectionConfig()` writes `viewModalSectionConfig` and calls `scheduleSyncPush()` when available, so order changes already participate in the existing sync path.                                                                                                                                                                                                                          |
| `js/constants.js:831-852`, `js/constants.js:975-988`                                                                                       | Storage allowlists              | `viewModalSectionConfig` is already included in both sync scope and allowed localStorage keys; no new key is needed for this sketch.                                                                                                                                                                                                                                                                   |
| `js/constants.js:1948-1951`                                                                                                                | Browser globals                 | `VIEW_MODAL_SECTION_DEFAULTS`, `getViewModalSectionConfig()`, and `saveViewModalSectionConfig()` are exported on `window` for settings and tests.                                                                                                                                                                                                                                                      |
| `js/viewModal.js:636-692`                                                                                                                  | Disposition section builder     | `_buildDispositionSection(item)` returns `null` only when `item.disposition` is falsy, then builds the visible `Disposition` section from the disposition payload. Lines 640-665 render the main 3-col grid (type, date, amount); lines 667-678 render optional fields (recipient, notes); lines 680-689 render the realized gain/loss row with color-coded `gain`/`loss` CSS classes.                 |
| `js/viewModal.js:1021-1032`                                                                                                                | Configured section appender     | `_appendSectionsInConfiguredOrder()` skips disabled sections, missing builders, and null-returning builders; this is the shared ordering gate for item detail sections.                                                                                                                                                                                                                                |
| `js/viewModal.js:1132-1162`                                                                                                                | Item detail modal assembly      | `buildViewContent()` defines the current `sectionBuilders` map without `disposition`, appends configured sections, then hardcodes Disposition last at `js/viewModal.js:1152-1158`. Adding `disposition` to `sectionBuilders` while the hardcoded block still exists would render the section twice — the approach must treat builder-map addition and hardcoded-block removal as a single atomic swap. |
| `js/viewModal.js:1106`                                                                                                                     | Footer actions — Restore button | `_renderFooterActions` checks `isDisposed(item)` and renders a "Restore to Inventory" button for disposed items. This is a second view-modal code path downstream of the `isDisposed()` predicate.                                                                                                                                                                                                     |
| `js/settings.js:2560-2647`                                                                                                                 | Shared settings table renderer  | `_renderSectionConfigTable()` renders checkbox toggles plus up/down arrow reorder buttons, immediately persists changes, and re-renders after moves.                                                                                                                                                                                                                                                   |
| `js/settings.js:2659-2666`                                                                                                                 | View-modal settings binding     | `renderViewModalSectionConfigTable()` points the shared renderer at `getViewModalSectionConfig()` and `saveViewModalSectionConfig()`; it does not hardcode section ids.                                                                                                                                                                                                                                |
| `index.html:4205-4214`                                                                                                                     | Appearance settings markup      | The Item Detail Modal settings container already exists under Settings > Appearance and says "Reorder and toggle sections in the item view modal."                                                                                                                                                                                                                                                     |
| `tests/playwright/03-settings/03-appearance.spec.js`                                                                                       | Appearance settings coverage    | Existing tests verify the Appearance modal and nearby config containers; this is the closest current settings test surface for a new view-modal section row.                                                                                                                                                                                                                                           |
| `tests/playwright/view-modal-no-auto-resync.spec.js`, `tests/playwright/view-modal-numista-merge.spec.js`, `tests/playwright/tags.spec.js` | View-modal test helpers         | These specs already seed inventory, open `window.showViewModal(index)`, and assert modal content, giving reusable patterns for disposed/non-disposed modal-order coverage.                                                                                                                                                                                                                             |
| `tests/playwright/inventory/partial-stack-disposition.spec.js`                                                                             | Disposition data coverage       | Existing disposition tests cover creation, undo, backup/export/import, and sync behavior, but do not currently test item-detail section ordering.                                                                                                                                                                                                                                                      |

## Prior Decisions

_Search mem0 and recent sessions for related decisions. Quote the relevant memory or commit, with date._

- 2026-05-15/16 — STRK-73 requirements review/reconcile corrected the live implementation target: the hardcoded disposition append is `js/viewModal.js:1152-1158`, while `js/viewModal.js:1117-1123` is header close-X wiring and must not be treated as the target block.
- 2026-05-15/16 — STRK-73 requirements review/reconcile narrowed the UI language from literal drag/drop to the existing arrow-button settings table. The current settings renderer confirms this at `js/settings.js:2616-2638`.
- 2026-05-15/16 — STRK-73 requirements added AC-6 for empty disposition objects after review identified that the current truthiness checks would otherwise render placeholder-only Disposition content for `{}`.
- 2026-05-13 — STRK-71 established a useful adjacent pattern: when a feature is joining an existing configurable settings pipeline, discovery should first prove the existing storage/settings/rendering infrastructure and then scope the sketch to the one missing integration point. Memory specifically notes that STRK-71 was "a narrow integration change, not a new settings system."

## External References

_Libraries, RFCs, design docs, third-party patterns worth borrowing from._

- _none — this is internal vanilla-JS configuration plumbing. No third-party API or library behavior is involved._

## Constraints

_Things the implementation must respect: existing APIs, performance budgets, browser support, data shapes._

- Constraint 1: Preserve saved `viewModalSectionConfig` arrays. `_loadSectionConfig()` filters saved entries to known defaults, preserves saved order for known ids, and appends missing defaults at the end (`js/constants.js:1264-1269`).
- Constraint 2: Preserve the existing enable/disable semantics. `_appendSectionsInConfiguredOrder()` currently skips any section with `enabled: false` before calling its builder (`js/viewModal.js:1026-1031`), so disabled Disposition should not render for disposed items unless approach intentionally changes that contract.
- Constraint 3: Avoid widening the settings UI. The shared renderer already provides checkbox toggles and up/down arrows (`js/settings.js:2586-2638`), and the Item Detail Modal settings container already exists (`index.html:4205-4214`).
- Constraint 4: Use the existing sync/storage key. `viewModalSectionConfig` is already in `SYNC_SCOPE_KEYS` (`js/constants.js:831-852`) and `ALLOWED_STORAGE_KEYS` (`js/constants.js:975-988`), and saving already calls `scheduleSyncPush()` (`js/constants.js:1331-1335`).
- Constraint 5: Be precise about non-disposed and malformed data. Current `isDisposed(item)` at `js/constants.js:497-498` uses `!!item?.disposition` — truthy for `{}`. `_buildDispositionSection(item)` at `js/viewModal.js:637` uses `!item.disposition` — also truthy for `{}`. AC-6 requires a stricter empty-object guard, and the placement is a load-bearing approach decision with three options: (a) tighten `isDisposed()` globally — affects **19 call sites across 5 files** (inventory-table.js ×4, card-view.js ×6, viewModal.js ×2, filters.js ×1, inventory.js ×4, plus definition and export in constants.js ×2), changing behavior for row CSS, badges, totals calculations, undo buttons, card layouts, filters, and dispose/undo/redo guards project-wide; (b) guard inside `_buildDispositionSection()` — view-modal scoped but leaves `isDisposed()` leaky for other callers; (c) guard at the new pipeline integration point only — narrowest scope but doesn't fix the underlying predicate. Additionally, `filters.js:908` uses a direct `!item.disposition` check for the "show active-only" filter, while `filters.js:912` uses `isDisposed(item)` for "show-only disposed". If AC-6 tightens only `isDisposed()` and the direct check remains, these two filter states will disagree about whether `{disposition:{}}` is active or disposed. The approach phase must weigh the guard placement and filter-alignment tradeoffs explicitly.
- Constraint 6: Do not treat `js/viewModal.js:1117-1123` as removal scope. Those lines wire the modal close-X button; the disposition append block is at `js/viewModal.js:1152-1158`. The hardcoded append was introduced by `STAK-72` (per code comments at line 1152). Removing it as part of STRK-73 completes the migration of Disposition into the standard rendering pipeline.
- Constraint 7: Default position is end-of-list. When users with saved `viewModalSectionConfig` arrays get the new `disposition` default appended by `_loadSectionConfig()`, it lands at the bottom of their order. This is the intended UX — no special insert logic needed. The `disposition` default entry needs no `locked: true` property; absence means it is reorderable and toggleable, matching the feature request.
- Constraint 8: 10-entry `sortableCount` is an untested state. The `maxSortable` recalculation at `js/settings.js:2626` and arrow-bound check at `2638` (`idx >= sortableCount - 1`) both work dynamically, so adding a 10th unlocked entry should be safe — but no current test exercises this count. Tasks phase should include coverage.

## Open Questions

_Things that need answering before approach.md can be written. If non-empty, stop here and resolve with the user._

- [x] Confirm exact line range of the hardcoded disposition append block in current `js/viewModal.js`. **Resolved:** actual range is `js/viewModal.js:1152-1158`; `js/viewModal.js:1117-1123` is close-X wiring.
- [x] Confirm `getViewModalSectionConfig()` appends new default entries without special-casing. **Resolved:** `_loadSectionConfig()` appends any default id missing from saved config at `js/constants.js:1264-1269`.
- [x] Confirm whether the settings UI is drag/drop or arrow-button reorder. **Resolved:** `_renderSectionConfigTable()` uses up/down arrow buttons at `js/settings.js:2616-2638`; there is no drag/drop implementation in this shared control.
- [x] Confirm whether cloud sync needs a new key. **Resolved:** `viewModalSectionConfig` is already in sync scope and the localStorage allowlist.
- [x] Confirm whether existing tests already cover Disposition section ordering. **Resolved:** disposition behavior has broad inventory coverage, and view-modal/settings helper patterns exist, but no current test asserts configurable Disposition order in the item-detail modal.
- [x] Confirm `_buildDispositionSection` has no hidden callers. **Resolved:** grep confirms only 2 references — definition at line 636 and call at line 1156. No dynamic or eval-based callers.

## Discovery Summary

_2–3 sentences: where the work will land, what looks tricky, what's already easy._

The work lands in the existing view-modal section configuration path: `VIEW_MODAL_SECTION_DEFAULTS`, the `buildViewContent()` section builder map, the hardcoded disposition append block, and focused Playwright coverage around settings persistence plus disposed/non-disposed modal rendering. The existing settings/storage/sync infrastructure is already present, so the main implementation risk is behavioral precision: adding `disposition` to the pipeline and removing the hardcoded block must be an atomic swap to prevent double-render, and AC-6's empty-object guard placement is an approach-phase design decision with project-wide implications (19 `isDisposed()` call sites + a `filters.js:908` direct property check that must be aligned). No approach-blocking questions remain, though the guard placement tradeoff and filter-alignment strategy are approach-pending decisions that will shape the implementation scope.

---

> **Phase complete.** Existing code mapped. Prior decisions surfaced. Open questions resolved. Next: `/sketch review STRK-73 discovery`, then `/sketch approach STRK-73`.

## Review Archive — discovery (2026-05-15)

_Reconciled by /sketch reconcile on 2026-05-15. Original reviewer marks preserved below for audit._

### OPUS46

#### Verified

- `_loadSectionConfig()` at `js/constants.js:1260-1280`: confirmed merge-and-append logic for backward compat. Saved entries filtered to known defaults, missing defaults appended at end.
- `VIEW_MODAL_SECTION_DEFAULTS` at `js/constants.js:1315-1325`: confirmed 9 entries, no `disposition` row.
- `saveViewModalSectionConfig()` at `js/constants.js:1332-1335`: confirmed `scheduleSyncPush()` call.
- `viewModalSectionConfig` in `SYNC_SCOPE_KEYS` (line 851) and `ALLOWED_STORAGE_KEYS` (line 988): confirmed. No new storage key needed.
- Window exports at `js/constants.js:1948-1951`: `VIEW_MODAL_SECTION_DEFAULTS`, `getViewModalSectionConfig`, `saveViewModalSectionConfig` all exported.
- `_buildDispositionSection()` at `js/viewModal.js:636-692` (not 665): confirmed falsy guard at 637, main grid 640-665, optional fields 667-691, return at 691.
- `_appendSectionsInConfiguredOrder()` at `js/viewModal.js:1021-1032`: confirmed skip-disabled, skip-missing-builder, skip-null-return logic.
- Hardcoded disposition append at `js/viewModal.js:1152-1158`: confirmed — `isDisposed()` check, then `_buildDispositionSection()`, appended outside the configured pipeline.
- `_renderSectionConfigTable()` at `js/settings.js:2560-2647`: confirmed arrow-button reorder (not drag/drop), checkbox toggles, immediate persist.
- `renderViewModalSectionConfigTable()` at `js/settings.js:2660-2666`: confirmed generic binding, no hardcoded section IDs.
- `index.html:4205-4214` under Settings > Appearance: confirmed container exists.
- `isDisposed()` at `js/constants.js:497-498`: confirmed `!!item?.disposition` — truthy for `{}`.
- All 5 test files cited in the Existing Code table: confirmed present on disk.

#### Top concerns

1. **`_buildDispositionSection` line range understated (630-665 vs actual 630-692).** The function's optional-fields section (recipient, notes, realized G/L with color classes) spans another 27 lines. The approach phase needs the full range to scope the builder integration correctly — particularly because the realized-G/L color logic at lines 686-687 adds `gain`/`loss` CSS classes that could interact with theme rendering if the section moves position.

2. **Double-render transition risk not explicitly flagged.** Adding `disposition` to the `sectionBuilders` map while the hardcoded block at 1152-1158 still exists would render the section twice for disposed items. Discovery identifies both code paths but doesn't call out the atomicity requirement. The approach phase must treat builder-map addition and hardcoded-block removal as a single atomic change.

3. **AC-6 empty-object guard placement is a design decision, not just a constraint.** Discovery correctly identifies that `{}` passes both `isDisposed()` and `_buildDispositionSection()`'s truthiness checks. But the WHERE matters: tightening `isDisposed()` has global ripple effects across all disposition features, while scoping the guard to `_buildDispositionSection()` or the pipeline integration point is narrower but leaves the predicate leaky. Approach should weigh these tradeoffs explicitly.

#### Unverified assumptions

- **No other callers of `_buildDispositionSection`.** Discovery implies this function is only called from the hardcoded block at 1152-1158. I verified via the visible code that this is the case, but if any dynamic or eval-based call exists outside the grepped surface, moving it into the pipeline could break that caller. Low risk given vanilla-JS codebase structure, but worth a `grep -rn _buildDispositionSection` during approach.
- **`_loadSectionConfig` append-at-end is the desired UX for new sections.** When a user with saved config gets the `disposition` default appended, it lands at the bottom of their order. This is probably correct (matches their mental model of "new feature appears at end") but is unstated — the approach should confirm this is intentional vs. whether Disposition should default to a specific position.
- **Settings table arrow bounds work correctly with a 10th entry.** The current `sortableCount` logic at `js/settings.js:2580,2638` filters `!c.locked` before bounding. Adding an unlocked `disposition` row increases `sortableCount` from 9 to 10. This should work but hasn't been tested at that count.

### DEEPSEEK

#### Verified

- `_loadSectionConfig()` at `js/constants.js:1260-1280`: confirmed merge logic — saved entries filtered by `defaults.some()`, missing defaults appended via `merged.push({ ...def })` at line 1268. Backward compat path confirmed.
- `VIEW_MODAL_SECTION_DEFAULTS` at `js/constants.js:1315-1325`: confirmed exactly 9 entries, no `disposition` row, no `locked` properties.
- `saveViewModalSectionConfig()` at `js/constants.js:1332-1335`: confirmed `_saveSectionConfig` + conditional `scheduleSyncPush()`.
- `SYNC_SCOPE_KEYS` at `js/constants.js:851`: confirmed `"viewModalSectionConfig"` present.
- `ALLOWED_STORAGE_KEYS` at `js/constants.js:988`: confirmed `"viewModalSectionConfig"` present.
- Window exports at `js/constants.js:1948-1951`: all three symbols confirmed on `window`.
- `_buildDispositionSection()` at `js/viewModal.js:636-692`: confirmed falsy-guard at 637, main grid 640-665, optional fields 667-691, realized-G/L color logic at 686-687. OPUS46's line range correction is accurate.
- `_appendSectionsInConfiguredOrder()` at `js/viewModal.js:1021-1032`: confirmed skip-disabled, skip-missing-builder, skip-null-return.
- `buildViewContent()` at `js/viewModal.js:1132-1162`: confirmed `sectionBuilders` map (lines 1138-1148) has 8 entries, no `disposition`. Hardcoded disposition append at 1152-1158 confirmed — checks `isDisposed()` then appends `_buildDispositionSection()` unconditionally outside the pipeline.
- `_renderFooterActions()` at `js/viewModal.js:1053-1123`: confirmed `isDisposed(item)` at line 1106 controls "Restore to Inventory" button. **This caller is not in the discovery's Existing Code table.**
- `_renderSectionConfigTable()` at `js/settings.js:2560-2647`: confirmed arrow-button reorder (not drag/drop), checkbox toggles, immediate persist on change, and `sortableCount` filter at 2580 — `!c.locked` only. Arrow bounds at 2637-2638 use `idx >= sortableCount - 1` for down arrow disable.
- `renderViewModalSectionConfigTable()` at `js/settings.js:2660-2666`: confirmed data-driven — binds to `getViewModalSectionConfig()`/`saveViewModalSectionConfig()` with no hardcoded IDs.
- `index.html:4205-4214`: confirmed container `#viewModalSectionConfigContainer` under Settings > Appearance.
- `isDisposed()` at `js/constants.js:497-498`: confirmed `!!item?.disposition` — truthy for `{}`, `{disposition:{}}` etc.
- **`isDisposed()` blast radius** — `grep -n isDisposed js/*.js` confirms 19 call sites across 5 files: `inventory-table.js` (4), `viewModal.js` (2), `filters.js` (1), `inventory.js` (4), `card-view.js` (6), plus definition and window export in `constants.js` (2). Discovery only documents 2 of these call sites (viewModal.js:1155 and viewModal.js:637).
- **`filters.js:908` inconsistency**: The "show active-only" filter at line 908 uses `!item.disposition` (direct property check) rather than `!isDisposed(item)`. Both return the same result today, but if `isDisposed()` is tightened for AC-6 and this direct check remains, the filter would treat `{disposition:{}}` as active while `isDisposed({disposition:{}})` returns false. This inconsistency is not mentioned in the discovery.
- **`_buildDispositionSection` callers** — `grep -rn _buildDispositionSection js/` confirms only 2 references: definition at line 636 and call at line 1156. No hidden callers.
- All 5 test files cited: confirmed present.

#### Top concerns

1. **`isDisposed` blast radius is 10× what discovery suggests.** Discovery documents 2 `isDisposed()` call sites but there are 19 across 5 files, each with different behavioral consequences if the predicate changes. Table rendering (disposed-row CSS, badge, undo button, metal-totals), card view rendering (all 3 layouts), footer actions, inventory operations, and filter predicates are all downstream consumers. The AC-6 empty-object guard placement decision has a 19-site impact radius on option (a) — approach MUST weigh this explicitly, not just as a footnote to Constraint 5.

2. **`_renderFooterActions` and `filters.js:908` are undocumented disposition consumers.** The footer's "Restore to Inventory" button at `viewModal.js:1106` is a second view-modal code path that depends on `isDisposed()` but isn't in the Existing Code table. The filters.js active-only filter uses a direct property check (`!item.disposition`) instead of the `isDisposed()` helper, creating an inconsistency that would persist even after an AC-6 guard is added to one path but not the other.

3. **Two implicit questions remain unresolved.** (a) Is end-of-list the intentional default position for Disposition, or should it have a specific default position? `_loadSectionConfig` provides the mechanism but the product decision is absent. (b) The `filters.js:908` direct property check needs alignment with whatever AC-6 guard strategy is chosen in approach — otherwise the filtering layer and the view-modal rendering layer will disagree about whether `{disposition:{}}` constitutes a disposed item.

#### Unverified assumptions

- **`_loadSectionConfig` append-at-end is the desired UX.** When users with saved configs get the `disposition` default appended at the end, this matches the mental model of "new feature appears at end." But no prior decision or issue comment confirms this is intentional vs. positioning Disposition between Valuation and Price History (a UX concern the Plane issue specifically mentions). Approach should make this explicit.
- **10-entry `sortableCount` is safe.** The recalculated `maxSortable` at `settings.js:2626` and the arrow-bound check at `2638` (`idx >= sortableCount - 1`) both work dynamically. Adding a 10th unlocked entry should Just Work, but hasn't been exercised at 10 entries in any test.
- **No other modules access `viewModalSectionConfig` directly.** The discovery assumes only `getViewModalSectionConfig()` and `saveViewModalSectionConfig()` touch this storage key. Verified via `grep viewModalSectionConfig` — only the constants definitions and the settings renderer access it. No hidden consumers.
- **The `disposition` default entry needs no `locked: true` property.** The existing 9 defaults have no `locked` field. Adding a 10th without `locked` means it's reorder-able and toggle-able, which aligns with the feature request. No change needed, but the absence of `locked` semantics should be intentional rather than incidental.

### GEMINI

#### Verified

- `isDisposed()` call sites: Confirmed 19 sites across `js/constants.js`, `js/viewModal.js`, `js/inventory-table.js`, `js/card-view.js`, `js/filters.js`, and `js/inventory.js`.
- `filters.js:908` inconsistency: Confirmed line 908 uses `!item.disposition` for the "hide" filter, while line 912 uses `isDisposed(item)` for "show-only".
- `_loadSectionConfig()` logic: Confirmed it preserves saved order and appends missing defaults via `merged.push({ ...def })` at `js/constants.js:1268`.
- `_renderSectionConfigTable()` arrow logic: Confirmed dynamic sorting count and bounds checking at `js/settings.js:2560-2647`.
- `STAK-72` reference: Confirmed code comments at `js/viewModal.js:1152` attribute the hardcoded append to `STAK-72`.

#### Top concerns

1. **`isDisposed()` blast radius is a high-impact architectural transition.** Updating the predicate to handle AC-6 (empty object guard) isn't just a constraint; it's a project-wide behavioral change affecting totals, badges, and filters. Discovery should flag this as a major transition point.

2. **Alignment of direct property checks.** Beyond `isDisposed()`, multiple sites (e.g., `filters.js:908`, `viewModal.js:637`) use direct `!item.disposition` checks. If the truthiness logic changes, these sites must be aligned to prevent inconsistent UI states (e.g., an item filtered as active but rendered as disposed).

3. **Standard Closing Tasks omission.** While the project has no build step, the tasks should account for pre-commit hooks like `stamp-sw-cache` which updates `sw.js` automatically.

#### Unverified assumptions

- **`_loadSectionConfig` append-at-end is the desired UX.** While consistent with how new features are typically added, it hasn't been explicitly confirmed if `disposition` should default to the end or a specific position (like after Valuation).
- **10-entry sortable count performance.** The settings table should handle 10 entries without issue, but it's an unexercised state in current tests.
- **No other `disposition` consumers.** Verified via grep that `_buildDispositionSection` only has two references, but other logic might rely on the `disposition` property presence without using `isDisposed()`.

### Resolution Summary

- Accepted: 12
- Rejected: 1 (GEMINI's Standard Closing Tasks note — out of scope for discovery phase; belongs in tasks phase)
- Resolved with user input: 1 (default position = end-of-list)

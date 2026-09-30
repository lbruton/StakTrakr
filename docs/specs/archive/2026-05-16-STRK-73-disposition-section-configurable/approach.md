---
sketch: "STRK-73-disposition-section-configurable"
phase: approach
created: 2026-05-14
---

# STRK-73 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

The work is a narrow integration change, not a new settings system. The view-modal already has a configurable-sections pipeline — `VIEW_MODAL_SECTION_DEFAULTS` (defaults), `_loadSectionConfig()` (merge with saved order, append missing defaults), `sectionBuilders` (id → builder fn), and `_appendSectionsInConfiguredOrder()` (gate on `enabled`, skip null returns). The Disposition section is the only modal section that bypasses this pipeline today; it's hardcoded to append last at `js/viewModal.js:1152-1158`. STRK-73 deletes that bypass and routes Disposition through the same pipeline as the other nine sections.

The change has three moving parts that must land in a single commit so disposed items never render the Disposition section twice or zero times during transition: (1) add the `disposition` default entry at the end of `VIEW_MODAL_SECTION_DEFAULTS`, (2) add `disposition: () => _buildDispositionSection(item)` to the `sectionBuilders` map inside `buildViewContent()`, and (3) delete the hardcoded append block at lines 1152-1158. Persistence, sync, and the settings UI need no edits — `viewModalSectionConfig` is already in `SYNC_SCOPE_KEYS` and `ALLOWED_STORAGE_KEYS`, and `_renderSectionConfigTable()` is data-driven off whatever entries come out of `getViewModalSectionConfig()`.

AC-6 (empty-object `{disposition:{}}` must not render the section) is handled at the *builder* level by tightening `_buildDispositionSection()`'s falsy guard to also reject empty objects. This deliberately leaves `isDisposed()` untouched — the global predicate has a 19-site blast radius and tightening it for STRK-73 would balloon the sketch into a project-wide behavioral change unrelated to the user-visible feature. The cost of scoping the guard locally is one pre-existing inconsistency (the Restore button in `_renderFooterActions` and the `filters.js:908` active-only filter still treat `{}` as "disposed" by the old truthy definition). That inconsistency exists today, is not user-facing for the feature in this sketch, and is named below as a follow-up.

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | Add `disposition` to `VIEW_MODAL_SECTION_DEFAULTS` as the **last** entry (`{ id: "disposition", label: "Disposition", enabled: true }`), no `locked` property. | End-of-list placement matches `_loadSectionConfig()`'s append-on-missing behavior for existing users, so first load after the update is a no-op visually (the section stays last by default — same place it was hardcoded). Users who want it elsewhere reorder it through the existing settings UI. Confirmed in discovery as the intended UX. | New users get Disposition at the bottom by default, even though for some workflows (e.g., "see disposal context next to valuation") putting it higher would be more useful. Mitigated by it being one-click reorderable. |
| D-2 | Land the three edits — defaults entry, builder-map entry, hardcoded-block deletion — as a **single atomic commit**. No intermediate state where any two are present without the third. | Adding the builder entry while the hardcoded block still exists produces a double-render for disposed items; removing the hardcoded block before adding the builder entry produces a zero-render. The pipeline transition only has one safe shape. | Slightly larger diff than three sequential commits would be — acceptable for a same-file change. |
| D-3 | Use the direct delegation form `disposition: () => _buildDispositionSection(item)` in `sectionBuilders`. No wrapper, no extra `isDisposed()` guard. | `_buildDispositionSection()` already returns `null` when the disposition payload is falsy (line 637), and `_appendSectionsInConfiguredOrder()` already skips null-returning builders (line 1031). An extra `isDisposed()` check would be redundant and would re-introduce the predicate-divergence risk D-4 is trying to contain. | None — the existing skip-null path is the canonical mechanism for "render nothing." |
| D-4 | Handle AC-6 by tightening **`_buildDispositionSection()`'s own guard** (option **b** from discovery Constraint 5) from `if (!item.disposition) return null` to a guard that also rejects empty objects. Do NOT touch `isDisposed()` and do NOT touch `filters.js:908`. | Option (a) — tightening `isDisposed()` — would ripple through 19 call sites across 5 files (inventory-table totals, card-view layouts, table-row CSS, badges, undo buttons, filters) for a feature whose user-visible scope is one modal section. That's not the change STRK-73 is paying for. Option (b) satisfies AC-6 exactly where the symptom would appear (the view modal) and keeps the diff bounded to the two files already in the file map. | Pre-existing predicate inconsistency persists: `_renderFooterActions` still renders the Restore button for `{disposition:{}}`, and `filters.js:908` (active-only filter, direct `!item.disposition`) and `filters.js:912` (disposed-only filter, `isDisposed()`) continue to disagree about empty-object items. Named explicitly as out-of-scope below — recommend a follow-up issue. |
| D-5 | The `disposition` settings chip remains user-toggleable (it inherits the standard `enabled` checkbox from the shared settings renderer), but disabling it for non-disposed items has no observable effect — the builder returns `null` regardless. | Matches the existing per-section UX uniformly; calling out "disposition is special and only sometimes toggleable" would be a divergent affordance with no upside. | If a user disables the Disposition chip while looking at non-disposed items, then later disposes one, the section won't render until they re-enable it. This is consistent with how every other section works, so we treat it as expected behavior rather than a defect. |
| D-6 | Add Playwright coverage with the following assertions, each tied to a specific AC and written as an **exact-count** check rather than presence/order: (i) AC-1/AC-2: the settings row appears, the move/reorder arrows behave at the 10-entry `sortableCount`, and saved order persists across reload; (ii) AC-3: a disposed item renders **exactly one** Disposition section, in the user-configured position (not appended last after the configured slot); (iii) AC-4: a non-disposed item renders **exactly zero** Disposition sections regardless of configured position; (iv) AC-6: an item with `disposition: {}` renders **exactly zero** Disposition sections — verified by DOM absence (the section node is not in the modal), not by CSS hiding; (v) AC-5: the legacy-user merge path is exercised by seeding localStorage with a **nine-entry `viewModalSectionConfig` missing `disposition`** before the modal opens, then asserting Disposition is appended after the saved order and that the appended entry persists through a move-and-reload cycle. | Exact-count assertions (i)–(iv) catch the double-render failure mode in D-2 directly — a presence/order check that only inspects the first match can pass even when the deleted hardcoded block accidentally remains. The AC-6 DOM-absence requirement closes a second false-pass mode where a CSS-hidden section could satisfy a visual check while still rendering. The seeded-legacy-config setup in (v) is what actually proves AC-5; without it, a from-blank test only exercises the no-storage path, not `_loadSectionConfig()`'s append-on-missing branch (`js/constants.js:1264-1269`). | Coverage adds the first test in the codebase that exercises a 10-entry `sortableCount`. That's a feature, not a cost — discovery flagged this as an untested state. |

## File Map

_Every file this sketch will create, modify, or delete. Tasks.md will reference these paths._

### New
- `tests/playwright/03-settings/05-disposition-section-config.spec.js` — covers AC-1/AC-2/AC-3/AC-4/AC-6 from D-6. (Numeric prefix follows the neighboring `03-settings/03-appearance.spec.js` / `04-market-controls.spec.js` convention.)

### Modified
- `js/constants.js` — add `{ id: "disposition", label: "Disposition", enabled: true }` as the final entry of `VIEW_MODAL_SECTION_DEFAULTS` at lines 1315-1325.
- `js/viewModal.js` —
  - Tighten the falsy guard at line 637 in `_buildDispositionSection()` to also reject empty objects (D-4).
  - Add `disposition: () => _buildDispositionSection(item)` to the `sectionBuilders` map at lines 1138-1148 in `buildViewContent()` (D-3).
  - Delete the hardcoded append block at lines 1152-1158 in `buildViewContent()` (D-2).

### Deleted
- _none — the hardcoded-block deletion is an inline removal within `js/viewModal.js`, not a file deletion._

## Data / Schema Changes

- `viewModalSectionConfig` in localStorage acquires a 10th entry (`disposition`) for any user who saves settings after this change. Users with pre-existing saved configs (no `disposition` key) get the entry appended automatically on first load via `_loadSectionConfig()` at `js/constants.js:1268`. No data migration, no version bump on the storage key, no defensive code in `buildViewContent()` — the append-on-missing path is the sole back-compat mechanism, and it already exists.
- `viewModalSectionConfig` is already in `SYNC_SCOPE_KEYS` (`js/constants.js:851`) and `ALLOWED_STORAGE_KEYS` (`js/constants.js:988`). No allowlist changes.

## Tradeoffs Surfaced for Review

> The two items below were resolved during discovery reconciliation but are restated here so the tasks-phase reviewer has them in one place.

- **Pre-existing `isDisposed()` predicate inconsistency is NOT being fixed.** `isDisposed()` returns `true` for `{disposition:{}}`. After STRK-73, the view-modal Disposition section will skip empty-object items (AC-6), but the Restore button (`_renderFooterActions`), the active-only filter (`filters.js:908`, direct `!item.disposition`), and the disposed-only filter (`filters.js:912`, via `isDisposed()`) will continue to disagree about whether `{disposition:{}}` is a disposed item. This is a pre-existing, non-user-visible-for-this-feature inconsistency. Recommend a follow-up issue (see Out of Scope).
- **Default position is end-of-list, not after Valuation — and the choice is sticky after release.** The Plane issue's free-text example ("e.g. between Valuation and Price History") is illustrative, not prescriptive. Discovery confirmed end-of-list as the intentional default: it matches the existing append-on-missing UX, lands the entry in the same slot users see today (the hardcoded append put it last), and is one click away from any other position via the settings UI. **This decision is sticky.** Once a user saves any settings change after release, their `viewModalSectionConfig` will contain a `disposition` entry, and `_loadSectionConfig()` will preserve that saved order on every subsequent load — it only appends ids that are absent (`js/constants.js:1264-1269`). Changing `VIEW_MODAL_SECTION_DEFAULTS` after release would therefore only reposition users who have never touched settings, splitting the user base. We are accepting end-of-list as the chosen default and treating a future placement change as a non-trivial migration, not a one-character edit. No migration path is planned in this sketch.

## Out of Scope (follow-up issues)

- **Align `isDisposed()` and direct `!item.disposition` checks for empty-object disposition payloads.** File a separate STRK issue covering: (1) tightening `isDisposed()` to reject `{}`, (2) auditing the 19 call sites for behavioral changes, (3) replacing `filters.js:908`'s direct property check with `isDisposed()`. Estimated scope: 3–5 files, full inventory/table/card-view regression run. Not blocking STRK-73 because the empty-object case is a data corruption edge that does not occur in normal user flow.
- **Drag-and-drop reordering for the section config table.** The current arrow-button UI is the shared control for all section-config tables in StakTrakr. A drag/drop upgrade would be a global UX change, not specific to Disposition.
- **Default-position UX research for new modal sections.** Whether new sections should default to end-of-list or to a curated position is a recurring question — worth a small design note in `DocVault/Projects/StakTrakr/Foundation/design-philosophy.md`, but not part of this sketch.

## Risk Notes

- **Risk: Double-render during a botched landing.** If only the builder-map entry lands and the hardcoded-block deletion is forgotten, every disposed-item modal renders Disposition twice. Mitigation: the atomic-commit constraint in D-2, plus the AC-3 / AC-6 Playwright tests in D-6 catch double-render the moment the suite runs. Tasks phase should keep the three edits in one cohort and one commit, not spread across cohorts.
- **Risk: Settings table arrow bounds at `sortableCount === 10`.** Discovery flagged that no current test exercises a 10-entry sortable count. The `maxSortable` recalculation at `js/settings.js:2626` and the arrow-bound check at line 2638 (`idx >= sortableCount - 1`) are both dynamic, so this should Just Work — but the AC-1/AC-2 test (settings row appears and persists order) implicitly exercises the 10-entry state, which converts an unverified assumption into tested behavior.
- **Risk: Empty-object guard divergence between view modal and footer Restore button.** Named in Tradeoffs Surfaced for Review. Out of scope for STRK-73, but worth a one-line note in the PR body so reviewers don't expect a global predicate change.
- **Risk: Reordering UI bug surfaces only at the new 10th position.** If `_renderSectionConfigTable()`'s up/down arrow logic has any off-by-one at `idx === sortableCount - 1`, it would manifest first on the disposition entry. Mitigated by the AC-2 reload test — moving the entry off the bottom and back validates both arrows at the boundary.

---

> **Phase complete?** Architecture clear, six decisions logged with rationale and tradeoff, file map covers all three edit sites plus the new test file, AC-6 placement decided with blast-radius justification, and the pre-existing predicate inconsistency is named as a follow-up rather than silently expanding scope. Next: `/sketch review STRK-73 approach`, then `/sketch tasks STRK-73`.

## Review Archive — approach (2026-05-16)

_Reconciled by /sketch reconcile on 2026-05-16. Original reviewer marks preserved below for audit._

### Codex

**Inline marks (originally placed in the body):**

> CODEX (under D-6): Make the AC-5 test setup explicit here. `_loadSectionConfig()` does append missing defaults to a saved array (`js/constants.js:1264-1269`), but I did not find an existing unit-level guarantee for `viewModalSectionConfig`; current Appearance coverage only verifies nearby containers and controls (`tests/playwright/03-settings/03-appearance.spec.js:115-145`). If the new Playwright spec starts from no saved config, it will not prove the legacy-user path. Seed localStorage with a nine-entry `viewModalSectionConfig` missing `disposition`, then verify Disposition is appended after the saved order and still persists after a move/reload.

> CODEX (under D-6): Also make the double-render assertion mechanical. The risky failure mode at `js/viewModal.js:1152-1158` is "configured Disposition renders, then the old hardcoded append renders a second copy." A presence/order assertion can miss that if it only looks at the first section. The disposed-item case should assert exactly one "Disposition" section; the non-disposed and `{ disposition: {} }` cases should assert exactly zero.

> CODEX (under Tradeoffs Surfaced for Review, second bullet): The "easy to revisit post-merge" part is only true before users have saved a config containing `disposition`. `_loadSectionConfig()` preserves saved entries and only appends defaults whose ids are absent (`js/constants.js:1264-1269`), while the settings table writes immediately on toggle/move (`js/settings.js:2596-2603`, `js/settings.js:2624-2633`). After release, changing `VIEW_MODAL_SECTION_DEFAULTS` would not reposition users whose localStorage already includes `disposition`; that would need a migration/reset decision. If default placement matters, settle it before tasks.

**Verified**

- `VIEW_MODAL_SECTION_DEFAULTS` currently has nine entries and no `disposition` entry at `js/constants.js:1315-1325`; `getViewModalSectionConfig()` delegates to `_loadSectionConfig()` at `js/constants.js:1327-1329`.
- `_loadSectionConfig()` preserves saved known entries and appends missing defaults at `js/constants.js:1264-1269`; `saveViewModalSectionConfig()` writes localStorage and schedules sync at `js/constants.js:1331-1335`.
- `viewModalSectionConfig` is already included in `SYNC_SCOPE_KEYS` and `ALLOWED_STORAGE_KEYS` at `js/constants.js:831-852` and `js/constants.js:975-988`.
- `_buildDispositionSection()` currently returns `null` only for falsy `item.disposition` at `js/viewModal.js:636-637`, then builds the section through `js/viewModal.js:640-691`.
- `_appendSectionsInConfiguredOrder()` skips disabled sections, missing builders, and null-returning builders at `js/viewModal.js:1021-1032`.
- `buildViewContent()` has no `disposition` builder today and still appends Disposition through the hardcoded block at `js/viewModal.js:1138-1158`.
- `_renderFooterActions()` still gates the Restore button on `isDisposed(item)` at `js/viewModal.js:1105-1116`; `isDisposed()` is the truthy disposition predicate at `js/constants.js:497-498`.
- `filters.js` uses direct `!item.disposition` for hide-active mode and `isDisposed(item)` for show-only mode at `js/filters.js:906-913`.
- The settings UI is data-driven: `showSettingsModal()` calls `syncSettingsUI()` at `js/settings.js:10-15`, `syncSettingsUI()` calls `syncLayoutVisibilityUI()` at `js/settings.js:1677-1680`, and that renders `renderViewModalSectionConfigTable()` at `js/settings.js:2540-2542`.
- `_renderSectionConfigTable()` provides the checkbox and arrow-button reorder controls at `js/settings.js:2560-2647`; the Appearance container exists at `index.html:4205-4214`.
- Current nearby tests exist for Settings Appearance containers (`tests/playwright/03-settings/03-appearance.spec.js:115-145`) and view-modal helper patterns (`tests/playwright/view-modal-no-auto-resync.spec.js:97-110`, `tests/playwright/tags.spec.js:101-106`, `tests/playwright/inventory/partial-stack-disposition.spec.js:104-113`).

**Top concerns**

1. AC-5 is not actually guaranteed by existing tests. The approach should require a legacy saved `viewModalSectionConfig` fixture missing `disposition`, not just a default no-storage load.
2. The double-render mitigation needs an exact-count assertion. A disposed-item order test can miss the old hardcoded append if it only checks that one Disposition section appears in the configured position.
3. Default-position changes are not a one-character post-merge tweak for users who have already saved config; `_loadSectionConfig()` preserves saved order once `disposition` exists in localStorage.

**Unverified assumptions**

- The new Playwright spec will seed enough item data for `_getViewMetrics()` and all enabled default builders to run without unrelated null/placeholder failures before it inspects section order.
- The intended AC-6 scope is only the visible Disposition section, not all other UI affordances that still treat `{ disposition: {} }` as disposed through `isDisposed()` or direct truthiness checks.
- The project is comfortable deciding end-of-list as the default now, knowing that changing default placement later would not automatically affect already-saved configs.

### Gemini

**Inline marks (originally placed in the File Map):**

> GEMINI (under `js/constants.js` entry): Verified. Current `VIEW_MODAL_SECTION_DEFAULTS` ends at line 1325 with `attachments`. Adding `disposition` here correctly ensures it appends for legacy users via `_loadSectionConfig`.

> GEMINI (under the `_buildDispositionSection` guard edit): Verified. Existing code at `js/viewModal.js:637` is `if (!item.disposition) return null;`. Replacing with `if (!item.disposition || Object.keys(item.disposition).length === 0) return null;` satisfies AC-6.

> GEMINI (under the hardcoded-block deletion entry): Verified. Lines 1152-1158 currently contain the `isDisposed(item)` guard and manual `appendChild`. Removing this while adding the builder to `sectionBuilders` is critical for preventing double-renders (D-2).

**Verified**

- `VIEW_MODAL_SECTION_DEFAULTS` contains 9 items and currently lacks `disposition` (`js/constants.js:1315-1325`).
- `_loadSectionConfig` merge logic correctly appends new defaults to existing saved configs (`js/constants.js:1268-1270`).
- `buildViewContent` in `js/viewModal.js` (lines 1152-1158) contains a hardcoded append block that bypasses the `sectionBuilders` pipeline, confirming the legacy "always last" behavior.
- `_buildDispositionSection` truthy check `if (!item.disposition) return null` (`js/viewModal.js:637`) is where AC-6 will be implemented.
- `isDisposed(item)` uses a simple truthy check `!!item?.disposition` (`js/constants.js:498`), confirming the inconsistency with empty objects `{}`.
- `js/filters.js:908` and `js/filters.js:912` indeed use different checks for "active" vs "disposed", which supports the D-4 rationale to avoid global predicate changes for now.

**Top concerns**

1. **Test Coverage for Empty Objects:** The approach mentions testing `disposition: {}` (D-6). It's critical that the Playwright test specifically verifies that the section is *absent* from the DOM, not just hidden via CSS, to satisfy AC-6.
2. **Double Render Risk:** As CODEX noted, an exact-count assertion in Playwright is necessary. If the hardcoded block isn't deleted, two "Disposition" sections will appear for disposed items.
3. **Legacy User Migration:** While `_loadSectionConfig` handles the append, we should ensure the Playwright tests explicitly simulate a legacy user (one with 9 sections already saved) to verify the "default to bottom" behavior (AC-5).

**Unverified assumptions**

- The `item` object passed to `_buildDispositionSection` always has a `disposition` property if it's considered "disposed" by other parts of the system, even if that property is `{}`.
- The reordering UI (`js/settings.js`) doesn't have hardcoded bounds that would break with a 10th item (D-6 notes this is dynamic, but it remains untested at that scale).

### Resolution Summary

- Accepted: 3 (D-6 test plan: legacy-user seed, exact-count assertions, AC-6 DOM-absence requirement)
- Rejected: 0
- Resolved with your input: 1 (D-1 default-position stickiness: kept end-of-list, rewrote the tradeoff line to acknowledge that the choice is sticky after first user-saved config; no migration path planned in this sketch)

---
sketch: STRK-84-numista-tags-first-fill
phase: approach
created: 2026-05-18T00:00:00.000Z
---

# STRK-84 — Approach

## High-Level Architecture

Add a **picker-state snapshot** mechanism to `catalog-api.js` that captures the user's intended tag selection at Fill Fields time and exposes it on `window` for the submit handler to consume. The snapshot is a small object — `{ resultId, checked: string[], removed: string[] }` — captured from the rendered checkboxes at the moment Fill Fields fires, BEFORE `closeNumistaResultsModal()` tears down the picker DOM. The submit handler in `events.js`, **in its Add branch only**, reads the snapshot immediately after `commitItemToInventory()` has minted the new UUID, then calls `applyNumistaTags(newUuid, snapshot.checked)` and (for each entry in `snapshot.removed`) `addRemovedTag(newUuid, tag)`. The Edit branch ignores the snapshot — it continues to write tags through the existing `_fillUuid`-gated block at `catalog-api.js:2380-2432`, so AC-3 (no Edit regression) is satisfied by leaving that block untouched and by NOT introducing a second post-submit Edit consumer.

`snapshot.removed` is populated only from checkboxes that carry a new `data-user-touched="1"` attribute. The attribute is set in two places: (1) a `change` event listener attached to each tag checkbox when rendered, and (2) the Check all / Uncheck all action handlers in `renderNumistaFieldCheckboxes` (`catalog-api.js:1966-1980`), which mark every affected checkbox before performing the programmatic `cb.checked = true/false` assignment. This is necessary because programmatic checkbox-state changes do not fire DOM `change` events; without the explicit marking, AC-2 would silently miss the Uncheck all path.

Orphan-cleanup is solved by an **explicit cleanup contract** with two owners (belt and suspenders):

1. `closeNumistaResultsModal` accepts a `{ clearPendingSnapshot?: boolean }` option. Cancel button, results-close button, no-results / quick-pick close paths, and the external `window.closeNumistaResultsModal` exposure all pass `true`. The Fill Fields handler passes `false` — it has already captured the snapshot and needs it preserved for the submit consumer.
2. The `#newItemBtn` handler in `events.js:3938` clears `window.pendingNumistaPickerSnapshot = null` at Add-modal-open time, defending against any stale state that survived an unusual close path.

The snapshot is consumed-and-cleared by the submit handler on success, so the steady-state lifetime is: capture → submit-consume → null. If the user cancels the Add modal, the submit handler never runs; the next picker invocation overwrites the snapshot, the next #newItemBtn click clears it, or the Cancel path through `closeNumistaResultsModal({ clearPendingSnapshot: true })` clears it explicitly. No `itemTags` or `itemRemovedTags` write ever occurs without a submit, so neither localStorage nor the Dropbox sync queue is touched on cancel.

## Key Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                     | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                    | Tradeoff                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Snapshot picker state at Fill Fields time into `window.pendingNumistaPickerSnapshot`, consume in submit handler after `commitItemToInventory()`                                                                                                                                                                                                                                              | Mirrors clone-mode precedent at `events.js:2069-2089` (act on `inventory[length-1]` right after commit). Avoids bridging `selectedNumistaResult` to `window`, which would activate dormant image/fieldMeta fallbacks in `events.js` (7 sites) and balloon regression surface. Keeps the bug fix scoped to tags.                                                                                                              | Adds one new `window`-namespaced piece of state; slightly less elegant than a closure-based design, but matches the script-tag-globals architecture (`coding-standards.md`) the rest of the codebase uses.                                                                                         |
| D-2 | Snapshot consumer in `events.js` runs in the **Add branch only**. Edit branch uses the existing `_fillUuid`-gated write at `catalog-api.js:2380-2432`, unchanged.                                                                                                                                                                                                                            | A unified consumer would broaden Edit-mode behavior: `addRemovedTag()` writes unconditionally, while Edit's existing removal walk (`catalog-api.js:2416-2427`) intentionally records removals only for tags carrying `data-on-item="1"`. Sharing the post-submit consumer with Edit would record opt-outs for default Numista tags the user merely unchecked, violating AC-3.                                                | Two code paths instead of one. Acceptable cost — AC-3 is non-negotiable, and Add and Edit have genuinely different semantics (Add has no pre-existing on-item set to diff against).                                                                                                                |
| D-3 | Track user-uncheck intent via a `data-user-touched="1"` dataset attribute. Set from BOTH (a) a `change` listener on each tag checkbox, and (b) the Check all / Uncheck all action handlers (`catalog-api.js:1966-1980`), which loop through affected checkboxes and mark them BEFORE the programmatic `cb.checked` assignment. `snapshot.removed` includes only touched-then-unchecked tags. | Implements AC-2 with minimal state — one DOM attribute, two write sites. Covers both direct user clicks AND the bulk picker actions; without (b), Uncheck all would be a silent gap because programmatic checkbox writes do not fire DOM `change`.                                                                                                                                                                           | Adds a small piece of UI state that lives only in DOM and two write sites that must stay in sync. If the picker is ever re-rendered mid-session without preserving the attribute, intent is lost — but `closeNumistaResultsModal()` always tears down the DOM, so this is a non-issue in practice. |
| D-4 | Delete the dead STAK-126 fallback at `events.js:1894-1898` as part of this sketch                                                                                                                                                                                                                                                                                                            | Zero-risk per discovery (`window.selectedNumistaResult` is never set, fallback never fires). Leaving inert code in place creates future maintenance confusion ("is this load-bearing?"). Removing it inside STRK-84 also clarifies the commit history: this PR is the canonical "Add-mode tag write path" landing.                                                                                                           | Couples a cleanup to a bug fix. Mitigation: cleanup is documented in commit message and reviewer notes; reverting it is a 4-line restore.                                                                                                                                                          |
| D-5 | Snapshot is captured ONLY when Fill Fields is clicked, NOT on every checkbox change. Cleanup has two explicit owners: `closeNumistaResultsModal({ clearPendingSnapshot: true })` (called from Cancel / close / no-results paths) and `#newItemBtn` click (defensive clear at Add-modal-open time).                                                                                           | Cheaper than per-checkbox serialization; matches user mental model (Fill Fields is the commit point); the dual-cleanup contract closes the stale-snapshot window without coupling cleanup to picker close semantics that vary by caller.                                                                                                                                                                                     | Two cleanup sites to keep in sync. Worth it — single-site cleanup either has to thread a parameter through every `closeNumistaResultsModal` caller (which is what D-6 specifies anyway) or relies on `#newItemBtn` alone, which would leak across modal-reopens within the same Add session.       |
| D-6 | `closeNumistaResultsModal` gains a `{ clearPendingSnapshot?: boolean }` option. Default behavior preserves the snapshot (caller must opt in to clear). Cancel button, results-close button, no-results / quick-pick close handlers, and external `window.closeNumistaResultsModal` callers pass `true`; the Fill Fields handler passes `false`.                                              | The shared close function is invoked from at least five sites with different intents (`catalog-api.js:2453-2457`, `2855-2889`, `2933-2944`, `2648-2655`, plus the global window exposure). Making the snapshot-clear behavior an explicit per-call option is clearer than a side-channel flag, and the Fill Fields path REQUIRES preservation — the snapshot must outlive the close call for the submit consumer to read it. | Touches several call sites at once. Mechanical change; tasks phase will enumerate them.                                                                                                                                                                                                            |

## File Map

### New

- _none_ — all changes land in existing files. The new Playwright test case lives in the existing spec; the new helper extends the existing `tests/playwright/numista-picker-tags.spec.js` helper block.

### Modified

- `js/catalog-api.js` —
  (1) In `renderNumistaFieldCheckboxes` (1840-1981), attach a `change` listener to each tag checkbox that sets `cb.dataset.userTouched = "1"`.
  (2) In the Check all / Uncheck all action handlers (1966-1980), loop the affected checkboxes and set `cb.dataset.userTouched = "1"` BEFORE the programmatic `cb.checked = true/false` assignment.
  (3) In the Fill Fields button handler (2873-2890), BEFORE `closeNumistaResultsModal({ clearPendingSnapshot: false })`, capture `window.pendingNumistaPickerSnapshot = { resultId: <numista catalogId>, checked: [...], removed: [...] }` by walking `input[name="numistaTag"]`. `removed` includes only inputs where `dataset.userTouched === "1"` AND `checked === false`.
  (4) Update `closeNumistaResultsModal` signature (~2456) to accept `{ clearPendingSnapshot?: boolean }`; when true, set `window.pendingNumistaPickerSnapshot = null`. Update every other caller (Cancel button, results-close button, no-results / quick-pick close at 2855-2889, 2933-2944, 2648-2655, and the `window.closeNumistaResultsModal` exposure at 2453-2457) to pass `{ clearPendingSnapshot: true }`.
  (5) Keep the existing `_fillUuid`-gated block at 2380-2432 unchanged — it continues to serve the Edit flow synchronously.

- `js/events.js` —
  (1) In the submit handler (2039-2089), in the **Add branch only** (not Edit), AFTER `commitItemToInventory(...)` succeeds and `newUuid = inventory[inventory.length - 1].uuid` is known: read `snap = window.pendingNumistaPickerSnapshot`. If `snap` is present, compare `snap.resultId` to `fields.catalog` (parsed via `parseItemFormFields`) BEFORE clearing. If they match, call `applyNumistaTags(newUuid, snap.checked)` and loop `snap.removed` through `addRemovedTag(newUuid, tag)`. Whether match or mismatch, then `window.pendingNumistaPickerSnapshot = null`.
  (2) In the `#newItemBtn` click handler (3938-4008), as a defensive first step, `window.pendingNumistaPickerSnapshot = null` to clear any stale snapshot from a previous abandoned session.
  (3) Delete the dead STAK-126 fallback at lines 1894-1898 (per D-4).

- `tests/playwright/numista-picker-tags.spec.js` —
  (1) Add a new helper `openAddItemPicker(page, numistaId)` that starts from empty inventory (no `seedData` call) and opens the picker through the Add Item modal entry point (`#newItemBtn` → fill Numista ID field → search).
  (2) Add a test case "Fill Fields applies tags on first click for new Add Item" that uses the helper, leaves a default-checked tag ticked, clicks Fill Fields once, submits the form, then asserts the saved row contains the tag via `page.evaluate(() => JSON.parse(localStorage.getItem('itemTags')))`.
  (3) Add a companion AC-2 test case: same flow but unchecks one default-on tag (covering both a direct click AND, in a sub-case, the Uncheck all action), asserts `itemRemovedTags` contains that tag for the new UUID.
  (4) **First-class negative test:** Add Item flow with NO tag-checkbox interaction (neither click nor Check all / Uncheck all), submit, assert `itemRemovedTags` for the new UUID is empty. Proves AC-2 does not over-record default-left-alone tags.

### Deleted

- _none_ — STAK-126 fallback removal is a 4-line deletion inside `events.js`, not a file delete.

## Data / Schema Changes

None — no new localStorage keys, no `SYNC_SCOPE_KEYS` / `ALLOWED_STORAGE_KEYS` additions, no migration. The fix writes to the existing `itemTags` and `itemRemovedTags` stores through the existing `applyNumistaTags()` and `addRemovedTag()` functions. The new `window.pendingNumistaPickerSnapshot` is transient runtime state, not persisted.

## Tradeoffs Surfaced for Review

- **D-1: `window`-namespaced state vs. closure-based design.** Using `window.pendingNumistaPickerSnapshot` is consistent with how the rest of the script-tag-globals codebase passes data between modules (the project has no module system). A closure-based design would be cleaner in a bundled app but would require introducing a new IIFE or module boundary that doesn't otherwise exist in this surface. Flagging for explicit user signoff: **OK to add one more `window` global, or prefer a different mechanism?**
- **D-2: Add-only consumer (narrowed from unified per reviewer consensus).** Edit branch's existing `_fillUuid` path remains the sole Edit-mode tag writer. AC-3 forbids Edit-mode regression, and a unified consumer would broaden Edit's removal semantics (per `catalog-api.js:2416-2427` analysis). No remaining tradeoff to surface — this is the correct shape.
- **D-4: Cleanup-coupling.** Removing the dead STAK-126 fallback inside this PR couples a cleanup to a bug fix. The cleanup is zero-risk and documented, but if the user prefers strict bug-fix-only PRs, this can be split into a follow-up issue. Flagging: **fold cleanup into STRK-84, or split into a new issue?**

## Out of Scope (follow-up issues)

- **`defaultOn` config for scalar field checkboxes** (Year/Type/Orientation/Technique/Obverse/Reverse/Edge). The issue body's secondary observation about defaults at `catalog-api.js:1592-1593`. Per requirements Q1 decision: split out. _*Action: file a new STRK-* issue post-merge_* ("Numista Fill Fields scalar field checkboxes default to unchecked — review defaults"). Link from this sketch's PR.
- **Bridging `selectedNumistaResult` to `window`** to activate dormant image URL / `fieldMeta` fallbacks in `events.js` (7 dormant sites). Not needed for STRK-84 (we use the snapshot mechanism instead), but the dormant sites are technical debt. **Action: file a follow-up issue** ("Reconcile dormant `window.selectedNumistaResult` references in events.js — bridge or delete"). Discovery has the full site list.

## Risk Notes

- **Risk:** Snapshot capture order — if `closeNumistaResultsModal()` tears down checkboxes before we serialize them, the snapshot is empty. **Mitigation:** capture is the FIRST line of the Fill Fields handler, before any DOM teardown, and the Fill Fields close passes `{ clearPendingSnapshot: false }`.
- **Risk:** Stale snapshot across modal reopen or unusual close paths. **Mitigation:** the cleanup contract has two owners — every non-Fill-Fields call into `closeNumistaResultsModal` passes `{ clearPendingSnapshot: true }`, AND the `#newItemBtn` click handler clears the snapshot defensively at Add-modal-open time. The `resultId === fields.catalog` match in the submit handler is a third line of defense: if a stale snapshot ever survives both cleanups, a mismatched `resultId` causes the snapshot to be cleared without writing.
- **Risk:** Race between snapshot consumption and Dropbox sync push — `applyNumistaTags` calls `saveItemTags` which calls `scheduleSyncPush`. If consumption runs synchronously inside the submit handler, the sync push queues immediately. **Mitigation:** this is the existing behavior of the Edit path; no new sync semantics introduced.
- **Risk:** Playwright test stability — the new Add-mode helper must not depend on `openEditForm()` / `window.showNumistaResults()` (per AC-4). **Mitigation:** explicitly route through `#newItemBtn` and the Numista ID input field; tasks phase will spec the exact selector chain.
- **Risk:** AC-2 over-recording — if the `change` listener also fires for programmatic checkbox state changes during initial render, `data-user-touched` could be set spuriously. **Mitigation:** the first-class negative test case (Add flow with zero tag-checkbox interaction → empty `itemRemovedTags`) proves this directly. Plus, since programmatic writes don't fire `change`, the only spurious-set risk is explicit; the Check all / Uncheck all handlers mark only their affected checkboxes.

---

> **Phase complete.** Architecture clear, 6 decisions logged with rationale + tradeoffs, file map covers 3 modified files (no new, no deleted). Next: `/sketch tasks STRK-84`.

## Review Archive — approach (2026-05-18)

_Reconciled by /sketch reconcile on 2026-05-18. Original reviewer marks preserved below for audit._

### Codex

**Inline marks (verbatim, in document order):**

1. On the high-level Add-only paragraph:

   > This Add-only statement is the safer architecture and matches AC-3, but it conflicts with D-2 and the `events.js` file map below, which both say the Edit branch consumes the snapshot too. Live code already applies Edit tags synchronously through `_fillUuid` at `js/catalog-api.js:2380-2432`, while the submit handler runs later at `js/events.js:2039-2067`; a second post-submit consumer is a new Edit path, not "unchanged." Please reconcile the approach to one explicit shape before tasks.

2. On the `change` listener for user-touched intent:

   > A checkbox `change` listener will catch direct checkbox clicks, but it will not catch the picker's own Check all / Uncheck all actions as currently written. Those handlers set `cb.checked = true/false` programmatically at `js/catalog-api.js:1966-1980`, and programmatic assignment does not fire a DOM `change` event. If AC-2 should honor the user clicking Uncheck all, those action handlers also need to mark `data-user-touched`, or the tests need to state that only direct checkbox interaction is covered.

3. On the orphan-cleanup paragraph:

   > The "Add modal's own reset path" does not currently clear arbitrary `window` state. `#newItemBtn` resets the form and `editingIndex` at `js/events.js:3938-4008`, while item cancel/close only clears attachment/upload/autocomplete state and `editingIndex` at `js/events.js:2326-2343`; ESC closes the item modal at `js/events.js:4387-4391`. None of those paths would clear `window.pendingNumistaPickerSnapshot` unless this approach explicitly adds that cleanup. The no-write claim is still true before submit, but stale snapshot lifetime needs a concrete owner.

4. On D-2 / D-3 (the "BOTH branches" decision):

   > D-2's "BOTH branches" decision is the main approach smell. `applyNumistaTags()` is add-only/idempotent for checked tags (`js/tags.js:366-418`), but `snapshot.removed` would call `addRemovedTag()` directly (`js/tags.js:331-340`). In Edit mode that can broaden behavior for a touched unchecked default Numista tag that was not already on the item, because the existing Edit removal walk only records unchecked tags with `data-on-item="1"` (`js/catalog-api.js:2416-2427`). That would violate AC-3's "Edit Item flow unchanged" unless the snapshot consumer is Add-only or the Edit branch filters removals to exactly the existing on-item contract.

5. On the catalog-api.js file map bullet:

   > The Cancel-vs-Fill distinction is not optional if stale snapshots are part of the risk model. Current `closeNumistaResultsModal()` has no reason parameter and is shared by the results close button, picker Cancel button, Fill Fields handler, no-results/quick-pick flows, and external `window.closeNumistaResultsModal` exposure (`js/catalog-api.js:2453-2457`, `2855-2889`, `2933-2944`, `2648-2655`). Tasks should specify the API shape, e.g. `closeNumistaResultsModal({ clearPendingSnapshot: true })` for cancel/close callers and `false` for Fill Fields after capture.

6. On the events.js file map bullet:

   > The Add branch has a stable post-commit UUID at `inventory[inventory.length - 1]` (`js/events.js:1838-1848`, `2039-2067`), but the proposed "resultId matches the current picker context" needs an exact comparison target. `selectedNumistaResult` is nulled by `closeNumistaResultsModal()` at `js/catalog-api.js:2453-2457`; `events.js` can see parsed form fields such as `fields.catalog`, not the module-scoped selected result. Please define whether `snapshot.resultId` means `catalogId` and whether it compares to `fields.catalog` before or after `commitItemToInventory()`.

7. On the Playwright test bullet:
   > Please include a "no interaction" negative assertion as a first-class test, not only as a risk-note mitigation. Current `itemRemovedTags` is local-only allowlisted storage (`js/constants.js:1037`) and `addRemovedTag()` writes it directly through `saveDataSync()` (`js/tags.js:331-340`), so AC-2 should prove both that touched unchecked tags are recorded and that untouched default-off/default-left-alone tags do not create noisy opt-outs.

**Codex review summary section (verbatim):**

#### Verified

- `js/catalog-api.js:1840-1981` renders Numista tag checkboxes, sets `data-tag`, sets `data-on-item="1"` only for already-on-item tags, and wires Check all / Uncheck all by direct `cb.checked` assignment.
- `js/catalog-api.js:2380-2432` applies checked tags and the STRK-52 removal walk only when `_fillUuid` resolves from the current `editingIndex`.
- `js/catalog-api.js:2453-2457`, `2855-2889`, and `2915-2922` show that `selectedNumistaResult` is module-scoped state, nulled on close, and `closeNumistaResultsModal()` is shared by Fill Fields and cancel/close callers.
- `js/events.js:1838-1848` mints the Add-mode UUID during `commitItemToInventory()`, and `js/events.js:2039-2067` gives the submit handler a post-commit hook point similar to the clone handling at `js/events.js:2068-2088`.
- `js/events.js:2326-2343`, `3938-4008`, and `4387-4391` clear modal/editing state but do not currently clear arbitrary `window` pending state.
- `js/tags.js:331-340` writes `itemRemovedTags` directly, while `js/tags.js:366-418` shows `applyNumistaTags()` is add-only and clears matching removed-tag entries after successful add.
- `tests/playwright/numista-picker-tags.spec.js:93-199` still uses seeded/edit-oriented helpers, and `tests/playwright/numista-picker-tags.spec.js:486-517` covers the existing UUID-backed Edit path, not the missing-UUID Add path.
- DocVault foundation confirms the app is a zero-build script-tag SPA with strict load order and storage-key discipline (`Projects/StakTrakr/Foundation/architecture.md:98-110`, `Projects/StakTrakr/Foundation/coding-standards.md:222-294`).

#### Top concerns

1. D-2 conflicts with the high-level Add-only architecture and can change Edit behavior. A unified post-submit snapshot consumer is not a no-op for removals, because `addRemovedTag()` can record touched unchecked default tags that the existing Edit removal walk intentionally ignores unless `data-on-item="1"`.
2. `data-user-touched` via checkbox `change` events misses the picker's Check all / Uncheck all controls unless those handlers are also updated to mark user intent.
3. Snapshot cleanup is underspecified. Current modal reset/close paths do not clear a pending `window` snapshot, and `closeNumistaResultsModal()` cannot currently distinguish Fill Fields from Cancel/close callers.

#### Unverified assumptions

- `snapshot.resultId` will be the Numista `catalogId`, and the submit handler will compare it to the parsed form catalog (`fields.catalog`) because `selectedNumistaResult` is gone by submit time.
- AC-2 should cover direct checkbox unchecking and the Uncheck all UI as equivalent user intent.
- Removing the dead STAK-126 fallback inside this bug-fix PR is acceptable product/process scope, not a separate cleanup issue.
- The Add-mode Playwright helper can submit a valid minimal item after Fill Fields without relying on seeded inventory or `window.showNumistaResults()` shortcuts.
- `itemRemovedTags` remaining local-only is intentional for STRK-84; this review verified current constants, not product intent for future sync behavior.

### Gemini

**Inline marks (verbatim, in document order):**

1. On D-2 (unified consumer):

   > A unified consumer is not a no-op for removals. Existing Edit logic at `js/catalog-api.js:2416-2427` only records removals for tags with `data-on-item=\"1\"`. If the `events.js` consumer calls `addRemovedTag()` for _all_ touched-then-unchecked tags, it introduces a behavior change: Edit-mode users will now record opt-outs for default Numista tags that weren't previously on the item. This technically violates AC-3 (\"Edit Item flow unchanged\"). I recommend narrowing the snapshot consumer in `events.js` to the Add branch only, or updating AC-3 to allow this parity.

2. On D-3 (programmatic interactions):

   > Programmatic interactions (Check all / Uncheck all) at `js/catalog-api.js:1966-1980` do not fire `change` events. To satisfy AC-2 for users who click \"Uncheck all,\" those button handlers must also be updated to set `cb.dataset.userTouched = \"1\"`.

3. On D-5 (snapshot lifecycle):

   > For robust snapshot lifecycle management, `window.pendingNumistaPickerSnapshot` should also be cleared when the Add Item modal is opened (e.g., at the start of `#newItemBtn` handler in `js/events.js:3938`) to ensure no stale state from a previously cancelled/abandoned session persists.

4. On the events.js file map bullet:
   > For the `resultId` comparison, I verified that `fields.catalog` (populated by `parseItemFormFields`) is the correct target, as it reflects the `#itemCatalog` input value which is set by `fillFormFromNumistaResult()`. This check should happen BEFORE clearing the snapshot.

**Gemini review summary section (verbatim):**

#### Verified

- `js/catalog-api.js:1840-1981`: Confirmed `renderNumistaFieldCheckboxes` renders checkboxes and `Check all` / `Uncheck all` buttons. Programmatic assignment of `cb.checked` without event dispatch verified at lines 1966-1980.
- `js/catalog-api.js:2380-2432`: Verified `_fillUuid` gate and existing Edit-mode removal logic (restricted to `data-on-item=\"1\"`).
- `js/events.js:1429-1550`: Verified `parseItemFormFields` reads `#itemCatalog` into `fields.catalog`.
- `js/events.js:1894-1898`: Confirmed STAK-126 fallback is dead because `window.selectedNumistaResult` is indeed undefined (lexical scope isolation).
- `js/tags.js`: Confirmed `addRemovedTag` and `applyNumistaTags` are exported to `window` (lines 600-624).

#### Top concerns

1. **Edit mode behavior drift:** Decision D-2 (unified consumer) introduces a behavior change for Edit mode. By calling `addRemovedTag()` for _all_ touched-then-unchecked tags, it will record opt-outs for default Numista tags that were NOT previously on the item. Existing Edit logic at `js/catalog-api.js:2416-2427` intentionally ignores these. This violates AC-3 ("Edit Item flow unchanged"). I recommend narrowing the `events.js` consumer to the Add branch only (`!isEditing`).
2. **Programmatic interaction gap:** The `change` listener proposed in D-3 will miss the picker's "Uncheck all" action. To satisfy AC-2 for these users, the programmatic handlers in `js/catalog-api.js` must also set `cb.dataset.userTouched = \"1\"`.
3. **Snapshot lifecycle leakage:** If a user clicks "Fill Fields" then cancels the Add modal, the snapshot remains on `window`. It should be explicitly cleared when the Add modal is opened (`#newItemBtn` click) to prevent stale state from leaking into subsequent manual Add flows.

#### Unverified assumptions

- Assumption that `fields.catalog` is the stable identifier for comparison; verified it reflects the DOM state populated by the picker.
- Assumption that parity between Add and Edit removal logic is NOT desired; AC-3 explicitly forbids Edit regression.
- Assumption that `itemRemovedTags` is the correct place for these opt-outs; confirmed it is the established local-only store for this intent.

### Resolution Summary

- Accepted: 7
- Rejected: 0
- Resolved with your input: 0

**Accept summary:**

1. Narrowed snapshot consumer in `events.js` to the Add branch only (D-2 rewritten; high-level paragraph clarified).
2. Check all / Uncheck all handlers now also mark `data-user-touched` (D-3 extended; file map updated).
3. Explicit cleanup contract introduced (D-5 extended + new D-6); two owners — `closeNumistaResultsModal({ clearPendingSnapshot: true })` from non-Fill-Fields callers, AND defensive clear at `#newItemBtn` open.
4. `snapshot.resultId` defined as the Numista `catalogId`.
5. `resultId` compared to `fields.catalog` BEFORE clearing the snapshot.
6. "No interaction" negative test promoted to a first-class test case (file map test bullet 4).
7. D-2 "keep unified" recommendation in the Tradeoffs section replaced with the narrowed-Add-only resolution.

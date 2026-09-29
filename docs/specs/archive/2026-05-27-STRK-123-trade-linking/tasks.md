---
sketch: STRK-123-trade-linking
phase: tasks
created: 2026-05-26
approved: 2026-05-26
---

# STRK-123 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

- [x] **0.1** — Ensure patch worktree exists via `/start-patch`
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows `.worktrees/patch-<VERSION>/` on branch `patch/<VERSION>`. Working directory is that worktree, not the main checkout. `devops/version.lock` contains a claim for this version.
  - **If the worktree does not exist yet:** Invoke `/start-patch` to claim version lock, create worktree, and install dependencies. This is expected on the first run.
  - **Leverage:** `/start-patch` skill; AGENTS.md §Issue + Worktree Gates.

---

## Sprint Cohort A — Foundation (parallel-safe)

_Structural scaffolding: HTML markup, helper functions, field registrations, type definitions, CSS. No behavioral logic yet — these are the surfaces that Cohort B tests will reference and Cohort C implementation will wire up._

- [x] **A.1 [P]** — Add trade-link helper functions to utils
  - **File(s):** `js/utils.js`
  - **Acceptance:** `findItemByUuid(uuid)` returns the item object or `null` (O(n) scan of `inventory`). `computeTradeValue(item, dateStr)` calls `computeMeltValue(item, lookupHistoricalSpot(metalName, dateStr))` and returns `{ meltValue, spotPrice, isCustom: false }` or `null` when `lookupHistoricalSpot()` returns `null`. The `isCustom: false` flag marks spot-derived values per D-3's `tradeValues` schema. Both are exported on `window` for cross-module access.
  - **Leverage:** Existing `computeMeltValue()` at `js/utils.js:1457`, `lookupHistoricalSpot()` at `js/spot.js:664`.
  - **Maps to:** AC-8

- [x] **A.2 [P]** — Update InventoryItem JSDoc typedef
  - **File(s):** `js/types.js`
  - **Acceptance:** `@typedef InventoryItem` documents: `tradedFromUuid` (top-level, `string|undefined`), `disposition.tradedForUuids` (`string[]|undefined`), `disposition.tradeValues` (`Object.<string, {meltValue: number, spotPrice: number, isCustom: boolean}>|undefined`).
  - **Leverage:** Existing typedef at `js/types.js:1`.
  - **Maps to:** AC-2

- [x] **A.3 [P]** — Register `tradedFromUuid` in persistence field lists (4 files)
  - **File(s):** `js/diff-engine.js`, `js/changeLog.js`, `js/cloud-sync.js`, `js/inventory-backup.js`
  - **Acceptance:** All four surfaces include the new field:
    1. `DIFF_FIELDS` array at `js/diff-engine.js:32` contains `"tradedFromUuid"`.
    2. `logItemChanges()` field list at `js/changeLog.js:115` contains `"tradedFromUuid"`.
    3. `computeInventoryHash()` content sample at `js/cloud-sync.js:114` appends `(item.tradedFromUuid || "")`.
    4. ZIP JSON backup field map at `js/inventory-backup.js:24` includes `tradedFromUuid: item.tradedFromUuid || null`.
  - **Leverage:** STAK-493 precedent — missing one surface = silent data loss. Discovery §Constraints enumerates all six surfaces; this task covers 4 of 6 (the remaining 2 — CSV export/import — are in A.4).
  - **Maps to:** AC-2, AC-11

- [x] **A.4 [P]** — Add trade-link columns to standalone CSV export and import
  - **File(s):** `js/inventory-import.js`
  - **Acceptance:** Standalone CSV export at `buildCsvContent()` includes `"Traded For UUIDs"` (comma-separated UUID list from `disposition.tradedForUuids`) and `"Traded From UUID"` columns in header and row builder. CSV import at `sanitizeImportedItem()` parses these columns back into `disposition.tradedForUuids` (split on comma) and top-level `tradedFromUuid`. ZIP CSV is intentionally unchanged (D-10).
  - **Leverage:** Existing CSV export at `js/inventory-import.js:1080`, import at `:360`.
  - **Maps to:** AC-11

- [x] **A.5 [P]** — Add trade-linking section markup to dispose modal
  - **File(s):** `index.html`
  - **Acceptance:** Inside `#removeItemDisposeFields`, a new section (hidden by default, shown when type is "Traded") contains: (1) searchable text input for item picker with suggestion list container, (2) linked items list with per-item name, value field, spot/custom label, and remove (×) button, (3) value summary line, (4) "+ Add new item to inventory" action button, (5) save/cancel controls for edit mode. All elements have unique IDs for Playwright targeting. Section does not render for non-trade dispose types.
  - **Leverage:** Existing `#removeItemDisposeFields` at `index.html:8347`. Use `sanitizeHtml()` for item name display.
  - **Maps to:** AC-1, AC-6

- [x] **A.6 [P]** — Add trade section CSS styling
  - **File(s):** `css/styles.css`
  - **Acceptance:** Styles cover: trade comparison table layout, provenance line (compact, muted), item picker dropdown (search input + filtered list), "spot value" / "custom" value labels (muted text), linked-item list with remove buttons, trade gain/loss label. All styles use existing design tokens (`--bg-secondary`, `--text-primary`, `--border-color`, etc.) and respect all four themes (light, dark, slate, sepia). No hardcoded colors.
  - **Leverage:** Existing disposition badge styling at `css/styles.css:968-990`. Design tokens in `css/styles.css` root/theme blocks.
  - **Maps to:** AC-3, AC-5

---

## Sprint Cohort B — Tests · RED (sequential)

_TDD red phase. Write Playwright tests encoding the acceptance criteria. Tests MUST fail because the behavioral logic (Cohort C) does not exist yet. Cohort A scaffolding (HTML, helpers, field registration) must be committed first._

- [x] **B.1** — Write failing trade-linking tests in disposition spec
  - **File(s):** `tests/playwright/core/disposition.spec.js`
  - **Acceptance:** New `test.describe("trade-linking")` block with tests covering:
    - AC-1: Dispose with type "Traded" shows link section; search and select items; "+ Add new item" flow
    - AC-2: After trade, disposed item has `tradedForUuids` and `tradeValues`; received items have `tradedFromUuid`
    - AC-3: Disposed item view shows "TRADE" section with comparison table
    - AC-4: Unlinked traded item shows standard disposition (no regression)
    - AC-5: Received item shows provenance line with link to source
    - AC-6: Edit Trade — add/remove links post-disposal from disposed side
    - AC-7: Unlink from received side
    - AC-8: Trade values auto-fill from spot; cache-miss shows "—"
    - AC-9: Missing/re-disposed/restored linked items handled gracefully
    - AC-10: Trade Gain/Loss label and calculation
    - D-12 coverage (re-link conflict): Confirmation dialog when linking already-linked item — maps to AC-1 (line 37: confirmation dialog for already-linked items) and AC-6 (line 70: reassign confirmation)
    All new tests fail (red). Update `tests/playwright/coverage-map.csv` with new test entries.
  - **Depends on:** A.1–A.6 (HTML markup, helpers, field registrations exist)
  - **Leverage:** Existing disposition tests at `tests/playwright/core/disposition.spec.js:296`. Use `showAppConfirm` DOM-based dialog testing pattern (not `page.on("dialog")`).
  - **Maps to:** AC-1 through AC-10

- [x] **B.2** — Write failing CSV round-trip tests for trade fields
  - **File(s):** `tests/playwright/core/import-export.spec.js`
  - **Acceptance:** Tests assert: (1) standalone CSV export includes `Traded For UUIDs` and `Traded From UUID` columns with correct values, (2) CSV import round-trip preserves `tradedForUuids` and `tradedFromUuid`, (3) standalone CSV round-trip intentionally loses `tradeValues` (D-10 — assert lossy behavior), (4) ZIP JSON backup/restore round-trip preserves all trade fields including `tradeValues`. All new tests fail (red). Update `tests/playwright/coverage-map.csv`.
  - **Depends on:** B.1 (uses trade-linking test setup patterns)
  - **Leverage:** Existing import/export tests at `tests/playwright/core/import-export.spec.js:62`.
  - **Maps to:** AC-11

- [x] **B.3** — Write failing cloud sync hash test for trade links
  - **File(s):** `tests/playwright/core/attachments-cloud.spec.js`
  - **Acceptance:** Test asserts: a received-side-only edit (setting `tradedFromUuid` on an active item) produces a change in `computeInventoryHash()` output, making the edit sync-visible. Test fails (red). Update `tests/playwright/coverage-map.csv`.
  - **Depends on:** B.1 (uses trade-linking test setup patterns)
  - **Leverage:** Existing cloud sync tests at `tests/playwright/core/attachments-cloud.spec.js:151`.
  - **Maps to:** AC-11

---

## Sprint Cohort C — Implementation · GREEN (sequential with parallel pair)

_TDD green phase. Write the minimum behavioral logic to make all Cohort B tests pass. Core mutation logic first, then view + undo in parallel, then event wiring._

- [x] **C.1** — Implement core trade-link mutation logic in inventory
  - **File(s):** `js/inventory.js`
  - **Acceptance:** Three new helper functions: `linkTradeItems(disposedItem, receivedUuids, tradeDate)` — sets `disposition.tradedForUuids`, computes and stores `disposition.tradeValues` via `computeTradeValue()`, sets `tradedFromUuid` on each received item, writes change-log entries per D-6. `unlinkTradeItem(disposedItem, receivedUuid)` — removes UUID from `tradedForUuids`, deletes entry from `tradeValues`, clears `tradedFromUuid` on received item, writes change-log entries. `clearTradeLinks(disposedItem)` — iterates all `tradedForUuids`, clears each received item's `tradedFromUuid`, removes `tradedForUuids` and `tradeValues` from disposition, writes change-log entries. **Save boundary:** full-stack dispositions — helpers complete all mutations then callers save via `saveInventory()` (single save boundary = no orphans). Partial-stack dispositions — link mutations and trade-log entries are injected inside `splitInventoryItem()` before `tryPersistInventory()` with no second save boundary, matching the existing clone/transaction persistence flow.
    - `confirmRemoveItem()` full-stack path: after writing `disposition`, calls `linkTradeItems()` if trade items were selected.
    - `confirmRemoveItem()` partial-stack path: trade-link writes injected inside `splitInventoryItem()` after `clone.uuid` is assigned but before `tryPersistInventory()` — binds received items' `tradedFromUuid` to clone UUID, not original.
    - `restoreInPlace()`: calls `clearTradeLinks()` before clearing `disposition`.
    - `undoDisposition()`: calls `clearTradeLinks()` in both the merge-back and separate-item paths.
    - Re-link conflict: when linking an item that already has `tradedFromUuid`, confirms via `showAppConfirm()`, then clears old trade's reference before establishing new link (D-12, 3 change-log entries).
  - **Depends on:** A.1 (helper functions), A.3 (field registration), A.5 (HTML markup for trade picker state)
  - **Leverage:** `splitInventoryItem()` at `js/inventory.js:1119`. `restoreInPlace()` at `:1016`. `undoDisposition()` at `:1036`. `showAppConfirm` DOM modal pattern per CLAUDE.md. `instanceof HTMLElement` guards for new DOM elements.
  - **Maps to:** AC-1, AC-2, AC-6, AC-7, AC-8, AC-9, AC-12

- [x] **C.2 [P]** — Add `tradeLink` undo/redo branch in changeLog
  - **File(s):** `js/changeLog.js`
  - **Acceptance:** `toggleChange()` has a new branch for `entry.field === "tradeLink"` that reads structured JSON old/new values (containing both UUIDs) and correctly updates `disposition.tradedForUuids`/`tradeValues` on the disposed side and `tradedFromUuid` on the received side. Does NOT fall through to the generic scalar `item[entry.field] = entry.oldValue` path (which would create a spurious `item.tradeLink` property). Per-entry undo works independently (D-7).
  - **Depends on:** C.1 (change-log entry shape established)
  - **Leverage:** Existing `toggleChange()` at `js/changeLog.js:495`. `priceHistoryDelete` branch as pattern for structured-JSON undo.
  - **Maps to:** AC-6, AC-7

- [x] **C.3 [P]** — Implement trade section rendering and provenance in view modal
  - **File(s):** `js/viewModal.js`
  - **Acceptance:** The `disposition` section builder dispatches: when `disposition.type === "traded"` AND `tradedForUuids` has valid entries → renders "TRADE" section header, existing disposition fields, "TRADE GAIN/LOSS" label (AC-10), linked items table (name, qty, current melt, current retail via `computeItemValuation()`), summary comparison line (current value of disposed item vs. total current value of received items). When `disposition.type === "traded"` but no links → standard disposition section (AC-4 fallback). "Edit Trade" button triggers inline edit mode (AC-6). Received-item provenance: when `item.tradedFromUuid` is set, renders compact "Acquired via trade" line with clickable link to disposed item's view modal (AC-5). "Unlink from Trade" action available (AC-7). Missing-item placeholder for deleted UUIDs; "Disposed" badge for re-disposed items (AC-9). All item names sanitized via `sanitizeHtml()`.
  - **Depends on:** C.1 (trade data exists on items), A.6 (CSS classes)
  - **Leverage:** Existing `_buildDispositionSection()` at `js/viewModal.js:739`. `computeItemValuation()` at `js/utils.js:1538`. `findItemByUuid()` from A.1. `sanitizeHtml()` for display safety.
  - **Maps to:** AC-3, AC-4, AC-5, AC-9, AC-10

- [x] **C.4** — Wire up trade-picker events and edit/unlink actions
  - **File(s):** `js/events.js`
  - **Acceptance:** Trade picker: text input filters active inventory items by name (case-insensitive), clicking a suggestion adds the item to the linked list. "+ Add new item" opens the standard Add Item modal; on save, the new item is auto-linked via the `commitItemToInventory()` UUID capture at `js/events.js:2427`. Remove (×) button on linked items calls `unlinkTradeItem()`. Save/cancel in edit mode persists or reverts changes. Value fields auto-fill via `computeTradeValue()` with trade date; editable with "spot value"/"custom" label toggle. "—" shown on cache miss with manual entry prompt. Amount field auto-sums linked items' values (user can override). "Edit Trade" button in disposed item view toggles edit mode. "Unlink from Trade" button on received item view calls `unlinkTradeItem()` from disposed side. Trade section visibility toggles with dispose type selector (show for "Traded", hide otherwise). All event handlers reset cleanly in `openRemoveItemModal()`.
  - **Depends on:** C.1 (mutation functions), C.3 (DOM elements to bind to)
  - **Leverage:** `commitItemToInventory()` at `js/events.js:1775`. `openRemoveItemModal()` at `js/inventory.js:747` for reset.
  - **Maps to:** AC-1, AC-6, AC-7, AC-8

---

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File(s):** _no file changes — verification only_
  - Run `npm test` (core Playwright gate). All existing tests pass; all new Cohort B tests pass (green after Cohort C implementation). Run `npm run test:unit` if unit tests exist.
  - If anything fails: fix the implementation, not the test. Tests are the spec.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File(s):** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.
  - **Post-scan:** run `git diff .codacy/codacy.yaml` and revert any tool additions (PMD, Python, Java stanzas, ESLint version bump) before commit — these are CLI side effects, not real config changes.

- [ ] **CLOSE-3. Generate verification stamp**
  - **File(s):** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1 through AC-11), write exactly one line:
    - `- [x] AC-N — verified at <path>:<line>` or `- [x] AC-N — verified by <test name>`, OR
    - `- [ ] AC-N — gap: <reason>` (when not yet verified).
  - Refuse to proceed to CLOSE-4 if any `[ ]` gap remains.

- [x] **CLOSE-4. Version bump**
  - **File(s):** project version files
  - **MUST invoke `/release patch`** — not a manual version edit.
  - **MUST invoke `/update-spot-bundle`** in the same closing cohort — run before the version-bump commit, then copy bundle files to worktree.

- [x] **CLOSE-5. Vault update + close issue**
  - **MUST invoke `/vault-update`** — this feature adds new data model fields, new UI patterns, and new persistence surfaces; foundation docs likely need updates.
  - Mark STRK-123 Done in Plane: `mcp__plane__update_issue` to state "Done".

- [x] **CLOSE-6. Open PR**
  - Use worktree branch from task 0.1. Title: `feat(STRK-123): trade linking — link disposed items to received inventory items`.
  - Body: link to STRK-123 issue, link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-123-trade-linking/`), test plan checklist, test inventory delta (`+N -M tests, +X -Y files`).
  - PR targets `dev`.

- [x] **CLOSE-7. Resolve PR review threads**
  - **File(s):** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** — scan both inline diff threads AND review-body/summary findings.
  - All Critical/High: fix or mark false-positive with reasoning. Medium: fix or document. Low/Info: advisory.
  - Re-check for auto-scanner re-posts after each push.

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-123`** — moves folder to `archive/YYYY-MM-DD-STRK-123-trade-linking/` and saves mem0 summary.

---

## File-Map Cross-Check

| Approach File Map entry | Task(s) | Status |
|-------------------------|---------|--------|
| `index.html` | A.5 | Covered |
| `js/inventory.js` | C.1 | Covered |
| `js/viewModal.js` | C.3 | Covered |
| `js/events.js` | C.4 | Covered |
| `js/utils.js` | A.1 | Covered |
| `js/changeLog.js` | A.3 (field list), C.2 (toggleChange) | Covered |
| `js/diff-engine.js` | A.3 | Covered |
| `js/cloud-sync.js` | A.3 | Covered |
| `js/inventory-backup.js` | A.3 | Covered |
| `js/inventory-import.js` | A.4 | Covered |
| `js/types.js` | A.2 | Covered |
| `css/styles.css` | A.6 | Covered |
| `tests/playwright/core/disposition.spec.js` | B.1 | Covered |
| `tests/playwright/core/import-export.spec.js` | B.2 | Covered |
| `tests/playwright/core/attachments-cloud.spec.js` | B.3 | Covered |

**Result:** All 15 approach File Map entries have corresponding tasks. No task references files outside the File Map.

**Note:** `tests/playwright/coverage-map.csv` is not in approach.md's File Map but is required by AGENTS.md for any PR touching Playwright tests. This is included as an acceptance line within B.1/B.2/B.3 rather than a separate File(s) entry, since it's a project convention artifact, not a behavioral code change.

---

> **Phase complete?** All tasks defined, cohorts grouped, `[P]` markers validated. Then stamp `approved:` and run `/sketch apply STRK-123`.

## Review Archive — tasks (2026-05-26)

_Reconciled by /sketch reconcile on 2026-05-26. Original reviewer marks preserved below for audit._

### Codex

**Verified**

- Confirmed the target task files and anchors exist: `index.html` loads `js/utils.js` before `js/spot.js` and exports both helpers on `window` later (`index.html:8487-8518`, `js/utils.js:3427-3429`, `js/spot.js:1610`); `computeMeltValue()` and `lookupHistoricalSpot()` are live at `js/utils.js:1457-1468` and `js/spot.js:664-685`.
- Confirmed the persistence and diff surfaces named by A.3/A.4 are real and currently omit `tradedFromUuid`: `DIFF_FIELDS` (`js/diff-engine.js:32-89`), `logItemChanges()` fields (`js/changeLog.js:115-162`), `computeInventoryHash()` content sample (`js/cloud-sync.js:114-135`), ZIP JSON backup map (`js/inventory-backup.js:23-74`), standalone CSV export (`js/inventory-import.js:1080-1181`), and CSV import disposition parsing (`js/inventory-import.js:369-425`).
- Confirmed the partial-stack mutation boundary in `js/inventory.js`: full-stack disposition saves at `js/inventory.js:970-973`, but split disposition persists through the clone/transaction path at `js/inventory.js:1119-1288`, including clone UUID assignment before persistence.
- Confirmed view-modal disposition rendering still routes through `_buildDispositionSection()` and the configured `disposition` section (`js/viewModal.js:739-790`, `js/viewModal.js:1247-1260`, `js/constants.js:1337-1348`).
- Confirmed the proposed Playwright targets exist and the coverage map is a single shared file: `tests/playwright/core/disposition.spec.js:296`, `tests/playwright/core/import-export.spec.js:62`, `tests/playwright/coverage-map.csv:1-68`.

**Top concerns**

1. A.1's helper return shape omits `isCustom`, while A.2/D-3/C.1 require every persisted trade value to carry that flag.
2. B.1 introduces `AC-12`, but `requirements.md` only defines AC-1 through AC-11; the re-link conflict test needs either a real requirement or an explicit D-12 mapping so CLOSE-3 can verify it.
3. The B-cohort `[P]` markers collide on `tests/playwright/coverage-map.csv`, and C.1's blanket `saveInventory()` wording conflicts with the existing split-disposition transaction boundary.

**Unverified assumptions**

- The implementer will remember that `computeTradeValue()` in `utils.js` is safe to call only after `spot.js` has loaded and `window.lookupHistoricalSpot` exists at runtime.
- The generated trade-picker markup can be static in `index.html`; all user-controlled item-name rendering and `sanitizeHtml()` usage will happen later in JS event/rendering code.
- The chosen `tradeLink` change-log entry payload will include enough UUID/value data for `toggleChange()` to update both sides without relying on inventory indices.
- The coverage-map delta can be reconciled cleanly if three test files are edited by parallel workers.
- The verification stamp format will be updated if re-link conflict behavior remains a D-12 decision instead of a numbered acceptance criterion.

### Resolution Summary

- Accepted: 4
- Rejected: 0
- Resolved with your input: 0

## Verification Stamp

- [x] AC-1 — verified by `core/disposition › trade-linking › dispose flow links received items, supports add-new, and records bidirectional fields`
- [x] AC-2 — verified by `core/disposition › trade-linking › dispose flow links received items, supports add-new, and records bidirectional fields`
- [x] AC-3 — verified by `core/disposition › trade-linking › view modal renders linked and unlinked trade sections plus received provenance`
- [x] AC-4 — verified by `core/disposition › trade-linking › view modal renders linked and unlinked trade sections plus received provenance`
- [x] AC-5 — verified by `core/disposition › trade-linking › view modal renders linked and unlinked trade sections plus received provenance`
- [x] AC-6 — verified by `core/disposition › trade-linking › edit trade add/remove, received-side unlink, and relink conflict use DOM confirms`
- [x] AC-7 — verified by `core/disposition › trade-linking › edit trade add/remove, received-side unlink, and relink conflict use DOM confirms`
- [x] AC-8 — verified by `core/disposition › trade-linking › spot values, cache misses, missing links, and re-disposed links degrade gracefully`
- [x] AC-9 — verified by `core/disposition › trade-linking › spot values, cache misses, missing links, and re-disposed links degrade gracefully`
- [x] AC-10 — verified by `core/disposition › trade-linking › view modal renders linked and unlinked trade sections plus received provenance`
- [x] AC-11 — verified by `core/import-export › trade-link fields round-trip through standalone CSV and ZIP JSON backup` and `core/attachments-cloud › trade received-side back-reference changes inventory hash`

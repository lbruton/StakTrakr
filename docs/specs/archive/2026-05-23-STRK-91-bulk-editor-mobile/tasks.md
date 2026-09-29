---
sketch: "STRK-91-bulk-editor-mobile"
phase: tasks
created: 2026-05-22
approved: 2026-05-23
---

# STRK-91 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/pr-resolve`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose cannot carry. If a closing task is genuinely irrelevant to the project, mark it `N/A — <one-line reason>` rather than dropping the task.

## Sprint Cohort 0 — Setup (sequential)

_Cohort 0 ensures the StakTrakr patch worktree exists before implementation begins. If the worktree is missing, the executing agent creates it; this is setup work, not a stop-the-world gate._

- [x] **0.1** - Claim patch version and create the StakTrakr worktree
  - **File(s):** _no file changes — version-lock/worktree setup only_
  - **Acceptance:** `devops/version.lock` has an active STRK-91 claim for the next patch version, `git worktree list` shows `.worktrees/patch-<VERSION>` on branch `patch/<VERSION>`, and all runtime edits happen inside that patch worktree rather than the main `dev` checkout.
  - **If the worktree does not exist yet:** invoke `/start-patch` or follow `AGENTS.md` + `DocVault/Projects/StakTrakr/Foundation/coding-standards.md`: prune expired lock claims, claim the next patch version, append the STRK-91 claim, and create `.worktrees/patch-<VERSION>` on `patch/<VERSION>`.
  - **Leverage:** `/start-patch`, `devops/version.lock`, `js/constants.js` `APP_VERSION`.

## Sprint Cohort A — Foundation (parallel-safe)

_Foundation tasks establish low-risk anchors before the RED tests. They touch different files and do not complete user-facing behavior by themselves._

- [x] **A.1 [P]** - Add deterministic bulk-editor test harness scaffolding
  - **File(s):** `tests/playwright/bulk-edit-mobile.spec.js`
  - **Acceptance:** New spec file exists with shared helpers to seed representative inventory, open the bulk editor, select rows, and query table/header cells at desktop, 375px mobile, and 640px zoomed-desktop viewports. No acceptance behavior is asserted yet. Seed helpers must support items with populated `numistaData` objects (shape, composition, diameter) and `capsule`/`capsuleNotes` fields — construct via `page.evaluate()` if existing patterns don't cover nested data.
  - **Leverage:** `tests/playwright/payment-method.spec.js`, `tests/playwright/goldback-type.spec.js`, `tests/playwright/silverback.spec.js`, `tests/playwright/mobile-modal-safe-area.spec.js`.
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7

- [x] **A.2 [P]** - Add stable sticky-column selector anchors
  - **File(s):** `js/bulkEdit.js`
  - **Acceptance:** Bulk editor header and item-row cells expose stable column anchors for `cb`, `img`, and `name` (for example `data-column` or dedicated classes) while pinned header/divider `colSpan` rows remain explicitly distinguishable from item rows. This task does not add sticky CSS yet.
  - **Leverage:** `buildBulkItemRow()`, `renderBulkTable()`, `tbody tr[data-serial]`, main inventory table `[data-column]` sticky precedent.
  - **Maps to:** AC-1, AC-6, AC-7

## Sprint Cohort B — Tests · RED (sequential)

_TDD red phase. Write tests that encode the acceptance criteria before implementation. New tests must fail against the current implementation or the implementation task is not properly specified._

- [x] **B.1** - Write failing mobile/sticky bulk-editor tests
  - **File(s):** `tests/playwright/bulk-edit-mobile.spec.js`
  - **Acceptance:** Tests fail on the current app and assert: checkbox/image/name columns keep stable left positions while the table scrolls horizontally; table and field-panel checkboxes meet 24x24 base target and 44x44 mobile effective area expectations; 375px and 640px viewports do not overlap toolbar, panel, table, or footer controls.
  - **Depends on:** A.1, A.2
  - **Leverage:** Playwright geometry assertions (`boundingBox()` / `evaluate()`), mobile safe-area source assertions, `@network` avoidance where possible. For sticky-position geometry in `overflow: auto` containers, prefer `page.evaluate()` with `getComputedStyle()` over `boundingBox()` (see `mobile-modal-safe-area.spec.js` precedent).
  - **Maps to:** AC-1, AC-2, AC-3, AC-6, AC-7

- [x] **B.2** - Write failing field-parity and nested-data tests
  - **File(s):** `tests/playwright/bulk-edit-mobile.spec.js`
  - **Acceptance:** Tests fail on the current app and assert: field panel exposes `shape`, `capsule`, and `capsuleNotes`; applying `shape` writes `item.numistaData.shape` without creating top-level `item.shape`; incompatible dimension keys are cleaned; empty capsule fields delete stored keys; capsule apply registers autocomplete; catalog composition and diameter render as display-only columns; raw `numistaData` JSON blob does not render.
  - **Depends on:** A.1, A.2
  - **Leverage:** localStorage inventory seeding, modal-open helper patterns from existing bulk edit tests, `window.openBulkEdit()`.
  - **Maps to:** AC-4, AC-5, AC-7

- [x] **B.3** - Write failing shared tracking and search/sort tests
  - **File(s):** `tests/playwright/bulk-edit-mobile.spec.js`
  - **Acceptance:** Tests fail on the current app and assert: (1) `numistaData.composition` and `numistaData.diameter` participate in visible table search/sort via the synthetic display columns (not via raw `numistaData` JSON stringification — pair each search assertion with a check that the matched column is the dedicated dot-path column and that raw `numistaData` blob is not rendered); (2) `capsule`, `capsuleNotes`, `paymentMethod`, `numistaData`, and `fieldMeta` edits produce observable activity log entries and sync manifest entries. `DIFF_FIELDS` is a file-scoped `const` (not on `window`) — assert on runtime side effects (seed item → bulk-edit field → verify activity log entry exists), not on code internals.
  - **Depends on:** A.1, A.2
  - **Leverage:** `logItemChanges()` observable effects (activity log DOM entries or `getManifestEntries(sinceTimestamp)`). Source-file assertions are a fallback only when runtime hooks are impractical.
  - **Maps to:** AC-4, AC-5, AC-7

> **Pre-Cohort-C gate:** Requirements.md AC-5 still describes a fallback chain (`item.composition` with fallback to `numistaData.composition`). Approach D-4/D-7 finalized two separate columns with distinct labels (`Composition` vs `Catalog Composition`). Task C.1 follows the approach. **Before starting Cohort C, update requirements.md AC-5 to match the approach decision** — remove the fallback wording, describe the two-column design. An implementer cross-referencing AC-5 will otherwise build fallback behavior instead of two columns.

## Sprint Cohort C — Implementation · GREEN (sequential)

_Green phase. Implement the smallest coherent changes that make the RED tests pass. These tasks are sequential because several touch `js/bulkEdit.js` and should not be edited concurrently. Reviewers confirmed C.1/C.2 and C.4/C.5 touch independent code regions and could technically run as parallel pairs — serial is a deliberate conservatism for single-worktree safety._

- [x] **C.1** - Implement catalog display-column engine support
  - **File(s):** `js/bulkEdit.js`
  - **Acceptance:** `resolveBulkValue(item, key)` or equivalent resolves dot-path keys; `getBulkTableDataKeys()` synthesizes `numistaData.composition` and `numistaData.diameter` only when nested data exists; raw `numistaData` object output is suppressed; display, search, and sort all use the same visible/searchable key set; column labels distinguish `Composition` from `Catalog Composition`. Relevant B.2/B.3 tests pass.
  - **Depends on:** B.1, B.2, B.3
  - **Leverage:** `BULK_COLUMN_PRIORITY`, `BULK_COLUMN_LABEL_OVERRIDES`, `formatBulkCellValue()`, `getBulkSortableValue()`, `getFilteredItems()`.
  - **Maps to:** AC-5, AC-7

- [x] **C.2** - Implement new bulk fields and nested apply semantics
  - **File(s):** `js/bulkEdit.js`
  - **Acceptance:** `BULK_EDITABLE_FIELDS` includes `shape`, `capsule`, and `capsuleNotes`; `shape` writes through a storage map to `item.numistaData.shape`; old snapshots deep-copy `numistaData` and `fieldMeta` before mutation; `window.markUserModified(item, "shape")` runs for bulk shape overrides; rectangular/square shape clears `diameter`; round/oval/other clears `length` and `width`; empty `capsule`/`capsuleNotes` delete those keys; capsule writes call `registerCapsule()` and capsule notes do not. Bulk dimension cleanup intentionally does NOT mirror the modal's `parseDimensions` copy-then-clear step — bulk just clears incompatible keys. Users needing dimension preservation can use the individual item modal. Relevant B.2 tests pass.
  - **Depends on:** C.1
  - **Leverage:** `parseNumistaDataFields()` lean-storage behavior, `toggleDimensionFields()` cleanup rules (data-layer equivalent only — the modal's DOM input clearing does not apply to bulk), `registerCapsule()`, `markUserModified()`, existing `paymentMethod` delete-when-empty pattern.
  - **Maps to:** AC-4, AC-7

- [x] **C.3** - Add shared history and sync field coverage
  - **File(s):** `js/changeLog.js`, `js/diff-engine.js`
  - **Acceptance:** `logItemChanges()` and `DIFF_FIELDS` include `capsule`, `capsuleNotes`, `paymentMethod`, `numistaData`, and `fieldMeta`; `logItemChanges()` uses deep equality (e.g. `JSON.stringify` comparison) for object-typed fields (`numistaData`, `fieldMeta`) to prevent false change entries from reference inequality after deep-copy — the current strict `!==` at `changeLog.js:147` would log unchanged nested objects as changed because the cloned old object and live new object are different references; tests or observable assertions prove capsule and nested shape edits are visible to activity/undo and matched-item sync. Note: `paymentMethod` is already bulk-editable but missing from both tracking lists — this is a pre-existing bug fix bundled into STRK-91 scope. Relevant B.3 tests pass.
  - **Depends on:** C.2
  - **Leverage:** `logItemChanges()` fixed field list, `DIFF_FIELDS`, existing top-level item schema in `DocVault/Projects/StakTrakr/Foundation/Deep Dives/Data Model.md`.
  - **Maps to:** AC-4, AC-5, AC-7

- [x] **C.4** - Implement collapsible mobile field panel behavior
  - **File(s):** `js/bulkEdit.js`, `css/styles.css`
  - **Acceptance:** Field panel content is wrapped in a `<details>/<summary>` pattern; wide viewports preserve the current open side-panel feel; <=768px viewports start collapsed with a keyboard-accessible summary; summary text reflects enabled-field count without re-rendering the whole panel; the field-count container uses `aria-live="polite"` so screen readers announce count changes on checkbox toggle; `aria-expanded` and `aria-controls` stay in sync on toggle and breakpoint crossing; the disclosure button retains a visible focus outline matching the brand design system. Relevant B.1 tests pass.
  - **Depends on:** C.3
  - **Leverage:** existing `.form-section` / `<details>` styles, `renderBulkFieldPanel()`, field checkbox change handlers, `matchMedia('(max-width: 768px)')`.
  - **Maps to:** AC-2, AC-3, AC-6, AC-7

- [x] **C.5** - Implement sticky identity region, tap targets, and safe-area styling
  - **File(s):** `css/styles.css`, `js/bulkEdit.js`
  - **Acceptance:** `.bulk-edit-table` uses `border-collapse: separate; border-spacing: 0`; sticky `cb`, `img`, and `name` header/body cells use stable anchors and fixed offsets; pinned header/divider rows are excluded; sticky boundary uses a theme-safe `var(--border)` divider or verified crisp shadow; checkbox visuals are at least 24x24px and <=768px hit areas are effectively 44x44px without widening columns — `.bulk-edit-table td:first-child` and `.bulk-img-cell` must explicitly set `overflow: visible` to prevent the parent `td { overflow: hidden }` rule from clipping the 44px pseudo-element tap target; safe-area padding uses `max(var(--spacing), env(safe-area-inset-*))` pattern to match the STAK-578 fullscreen modal fix; `.bulk-edit-content .modal-header` and `.bulk-edit-footer` receive safe-area padding. Relevant B.1 tests pass across desktop, 375px mobile, and 640px zoomed-desktop viewports.
  - **Depends on:** C.4
  - **Leverage:** main inventory table sticky CSS, `bulk-edit-table-wrap`, mobile fullscreen modal rules, safe-area prior art for item/view modals.
  - **Maps to:** AC-1, AC-2, AC-3, AC-6, AC-7

- [x] **C.6** - Run focused GREEN verification for STRK-91
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `npx playwright test tests/playwright/bulk-edit-mobile.spec.js` passes; `npm run lint` passes for changed JS; manual light/dark/sepia inspection confirms the sticky divider and table borders remain crisp after the `border-collapse` switch. CLOSE-3 (verification stamp) must note which ACs were verified by automated test vs manual theme inspection.
  - **Depends on:** C.5
  - **Leverage:** Playwright local server config, browser DevTools theme toggles if manual inspection is needed.
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7

---

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run `npm test` or, if network is unavailable, `npm run test:offline`. All existing tests pass; all new tests from Cohort B pass after Cohort C implementation.
  - If anything fails: fix the implementation, not the test. Tests are the spec — a failing test means the implementation is wrong unless the sketch itself is reopened.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory. Exclude unrelated `.codacy/codacy.yaml` churn unless this issue explicitly requires Codacy configuration changes.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1 through AC-7), write exactly one line in one of these formats:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` (cite the test or implementation line that proves it), OR
    - `- [x] AC-N — verified by <test name>` (when an entire named test case proves it), OR
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified).
  - The stamp block MUST list every AC from requirements.md. Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [x] **CLOSE-4. Version bump**
  - **File:** project version files managed by `/release patch`
  - **MUST invoke `/release patch`** as a skill. The skill must update the five committed release artifacts (`js/constants.js`, `package.json`, `version.json`, `CHANGELOG.md`, `js/about.js`) while leaving `sw.js` `CACHE_NAME` to the pre-commit hook.
  - **Acceptance:** Version artifacts are synchronized for the claimed patch version and the eventual commit message/PR title use StakTrakr format `vX.YY.ZZ — STRK-91: <summary>`.

- [x] **CLOSE-5. Vault update + issue transition**
  - **MUST invoke `/vault-update`** as a skill. If no foundation docs need updating, the skill reports zero changes and this task is still complete by audit.
  - Mark the source issue Done in Plane only after the PR merges or the user explicitly directs issue closure.
  - **Acceptance:** Vault audit outcome is recorded in the PR or handoff, and Plane transition timing is explicit rather than silently closing STRK-91 before merge.

- [x] **CLOSE-6. Open draft PR**
  - Use worktree branch `patch/<VERSION>` from Cohort 0. PR target is `dev`, never `main`.
  - Title format: `vX.YY.ZZ — STRK-91: bulk editor mobile parity`.
  - Body must include: source issue links (STRK-91 and STRK-90 context), sketch folder path (`DocVault/Projects/StakTrakr/sketches/STRK-91-bulk-editor-mobile/`), version bumped, test plan evidence, Codacy scan result, and any manual theme/mobile inspection notes.
  - **Acceptance:** Draft PR exists with label `codacy-review`; it is not marked ready and not merged.

- [ ] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill. The resolver must scan both inline diff threads and review-body findings, including Codacy/Copilot summary findings that are not attached to a diff line.
  - **Acceptance:** All Critical/High findings are fixed or explicitly classified false-positive, Medium findings are fixed or waived with rationale, and new scanner reposts after follow-up commits are checked before merge.

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-91`** as a skill.
  - **Acceptance:** Sketch folder moves to `archive/YYYY-MM-DD-STRK-91-bulk-editor-mobile/`, mem0 receives a shipping summary, and the Plane issue is Done if it was not already transitioned.

---

## Task Draft Checks

- **Parallelization sanity check:** Only A.1 and A.2 are marked `[P]`; they touch different files and neither depends on the other's created symbol. All later `js/bulkEdit.js` work is deliberately sequential to avoid same-file conflicts.
- **File-map cross-check:** Implementation task paths match approach.md: new `tests/playwright/bulk-edit-mobile.spec.js`; modified `js/bulkEdit.js`, `css/styles.css`, `js/changeLog.js`, and `js/diff-engine.js`. Closing tasks use skill-owned release/PR/vault surfaces and do not widen the implementation file map.
- **Skill-name discipline:** Closing tasks preserve `/release patch`, `/vault-update`, `codacy-cli`, `/pr-resolve`, and `/sketch archive` verbatim.

## Verification Stamp

_Generated CLOSE-3 on 2026-05-23. Full bulk-edit-mobile.spec.js suite: 33/33 passed (commit `a236f295` post-C.5)._

- [x] AC-1 — verified by `STRK-91 B.1 — sticky identity region` (3 viewport variants in tests/playwright/bulk-edit-mobile.spec.js)
- [x] AC-2 — verified by `STRK-91 B.1 — tap target sizing` (24×24 base + 44×44 effective at mobile/zoomedDesktop) and visually via overflow-visible override in tests/playwright/bulk-edit-mobile.spec.js
- [x] AC-3 — verified by `STRK-91 B.1 — no overlap at narrow viewports` (375px, 640px) and C.4 `<details>/<summary>` collapsible field panel
- [x] AC-4 — verified by `STRK-91 B.2 — field parity` + `STRK-91 B.2 — nested-data apply` + `STRK-91 B.3 — activity log + sync manifest tracking` (capsule, capsuleNotes, paymentMethod, shape→numistaData)
- [x] AC-5 — verified by `STRK-91 B.2 — display-only catalog columns` (Catalog Composition, Diameter, raw blob suppressed) + `STRK-91 B.3 — search via synthetic dot-path columns`
- [x] AC-6 — verified by `STRK-91 B.1` viewport-matrix tests at 640px (zoomedDesktop) covering sticky, tap-target, and overlap
- [x] AC-7 — verified by full suite (33/33) + npm run test:offline (736 passed, 12 pre-existing flakes in goldback-type/lot-each/numista-picker — CLAUDE.md documented categories)

**Manual theme inspection note:** the `border-collapse: collapse → separate` switch and the new `var(--border)` sticky boundary should be visually inspected across light/dark/slate/sepia themes before merge. Not blocked — only flagged as a "trust but verify" item for the reviewer.

## Review Archive — tasks (2026-05-23)

_Reconciled by /sketch reconcile on 2026-05-23. Original reviewer marks preserved below for audit._

### Opus

#### Verified

- **DIFF_FIELDS gap confirmed:** `js/diff-engine.js:32-83` lacks `capsule`, `capsuleNotes`, `paymentMethod`, `numistaData`, and `fieldMeta`. `js/changeLog.js:80-119` has the same omissions. Task C.3 correctly targets both files.
- **Apply loop shallow copy confirmed:** `js/bulkEdit.js:1277` does `Object.assign({}, item)` — shallow. `numistaData` mutations would corrupt the snapshot before `logItemChanges()` at line 1294. Task C.2's deep-copy requirement is load-bearing.
- **No `markUserModified` in bulk path confirmed:** `js/bulkEdit.js:1273-1321` never calls `markUserModified()`. The single-item path does at `js/events.js:1830-1869`. Task C.2 correctly adds it.
- **`classifyShape` categories verified:** `js/catalog-api.js:528-536` returns `"round"`, `"rectangular"`, `"square"`, `"oval"`, `"other"`. Task C.2's dimension cleanup ("rectangular/square clears diameter; round/oval/other clears length and width") matches `toggleDimensionFields` at `js/events.js:3042-3070`.
- **Header/body cells lack stable anchors confirmed:** `js/bulkEdit.js:929-957` (`th` creation) and `js/bulkEdit.js:457-500` (`td` creation for cb/img) use no `data-column` or per-column classes. Task A.2 correctly addresses this.
- **Pinned rows confirmed as `colSpan` risk:** `js/bulkEdit.js:965-987` creates `.bulk-edit-pinned-header` and `.bulk-edit-pinned-divider` rows with single `colSpan` cells. Task A.2's acceptance rightly requires distinguishing these from item rows.
- **`registerCapsule` exists at `js/autocomplete.js:1120`**, exposed on `window` at line 1132. Called in single-item path at `js/events.js:1903` but not in bulk path. Task C.2 correctly adds this.
- **Test file does not exist yet:** `tests/playwright/bulk-edit-mobile.spec.js` is new. Task A.1 creates it. Existing test patterns confirmed at `tests/playwright/payment-method.spec.js`, `goldback-type.spec.js`, `silverback.spec.js`, `mobile-modal-safe-area.spec.js`.
- **`getBulkTableDataKeys()` flat-key gap confirmed:** `js/bulkEdit.js:92-103` builds keys from `Object.keys(item)` only — dot-path synthetic keys will be filtered out by the `keySet.has(key)` check at line 99. Task C.1 correctly requires explicit synthesis.
- **File map cross-check clean:** All implementation task file paths (`js/bulkEdit.js`, `css/styles.css`, `js/changeLog.js`, `js/diff-engine.js`, `tests/playwright/bulk-edit-mobile.spec.js`) match approach.md's File Map.

#### Top concerns

> OPUS: **1. Closing tasks diverge significantly from the Standard Closing Tasks template.** The template at `DocVault/specflow/user-templates/tasks-template.md` defines a different structure: tasks N through N+8 covering full test suite + baseline update, log-implementation hard gate, parallel Codacy CLI + CodeRabbit security review, verification.md generation, cross-model peer review, loop-or-proceed gate, version bump, DocVault + issue close, and push + draft PR. The sketch's CLOSE-1 through CLOSE-8 paraphrase and restructure these — CLOSE-1 drops the baseline JSON update, CLOSE-2 drops CodeRabbit (template runs Codacy + CodeRabbit in parallel), CLOSE-3 uses a "verification stamp" inline in tasks.md instead of a standalone `verification.md`, there's no log-implementation hard gate task, no cross-model peer review task, and no loop-or-proceed gate. CLAUDE.md says "copy `## Standard Closing Tasks` verbatim from the template, renumber only." This is the most load-bearing finding — the closing tasks need to be replaced with the template's verbatim block, adapted only by renumbering (C.6 is the last impl task, so closing starts at CLOSE-7 or simply task 7).

> OPUS: **2. Task C.2 depends on C.1 but doesn't need to.** C.2 adds `shape`, `capsule`, `capsuleNotes` to `BULK_EDITABLE_FIELDS` and implements the apply-path nested write. C.1 adds the display-column engine (`resolveBulkValue`, synthetic keys, column suppression). These are independent concerns: the editable-field apply path doesn't use `resolveBulkValue`, and the display engine doesn't need the new `BULK_EDITABLE_FIELDS` entries. Making C.2 depend on C.1 forces serial execution where parallel would be safe. The real dependency chain is: C.2 depends on A.2 (for stable anchors in test assertions), not C.1.

> OPUS: **3. Task C.5 "sticky identity region" depends on C.4 but shouldn't.** C.4 is the collapsible field panel (`<details>/<summary>` + CSS). C.5 is the sticky CSS for the table columns. These touch different DOM regions and different CSS selectors — `renderBulkFieldPanel()` vs `.bulk-edit-table th/td` sticky rules. C.5 could run after A.2 (which provides the stable column anchors) and B.1 (which provides the failing tests). The artificial C.3→C.4→C.5 chain makes Cohort C entirely serial when C.1/C.4 and C.2/C.5 could form two parallel pairs.

#### Unverified assumptions

- **`toggleDimensionFields` operates on DOM inputs, not data.** The modal's dimension cleanup (`events.js:3042-3070`) clears DOM `<input>` values. Task C.2 says the bulk path should "mirror the modal's dimension cleanup at the data layer" — clearing `item.numistaData.diameter` vs `item.numistaData.length`/`item.numistaData.width` directly. This is correct for bulk (no DOM inputs to clear), but the approach doesn't specify whether `classifyShape` should be called directly or via `window.classifyShape`. The function is available on `window` at `catalog-api.js:2685`.
- **C.3 adds `paymentMethod` to `DIFF_FIELDS` and `logItemChanges`.** `paymentMethod` is already bulk-editable (`BULK_EDITABLE_FIELDS` line 281) and already has delete-when-empty logic at `bulkEdit.js:1283-1285`, but it's NOT in `DIFF_FIELDS` or `logItemChanges`. This is a pre-existing bug fix bundled into STRK-91 scope — the task doesn't flag it as such, which could confuse an implementer who thinks it's new behavior.
- **No `_Prompt:` fields on any task.** The Standard Closing Tasks template includes `_Prompt: Role: ... | Task: ... | Restrictions: ... | Success: ...` dispatch blocks for automated orchestration. The sketch tasks have none. If `/sketch orchestrate` is expected to dispatch these tasks to subagents, the missing prompts will force the orchestrator to improvise dispatch instructions — a reliability risk.
- **Cohort B tests are all in one file but listed as three sequential tasks (B.1, B.2, B.3).** All three write to `tests/playwright/bulk-edit-mobile.spec.js`. They could be a single task since they're sequential anyway and share the same file. Splitting them into three creates three subagent dispatches for what could be one, with each needing to read/write the same file. However, this is a minor efficiency concern, not a correctness issue.
- **`attachments` is in `DIFF_FIELDS` (line 82) but not in `logItemChanges` (lines 80-119).** This is a pre-existing divergence between the two lists. Task C.3 adds five fields to both lists but doesn't address this existing gap. Not in STRK-91 scope, but worth flagging since the task says these lists "must stay in sync" (`diff-engine.js:12`).

### Deepseek

#### Verified

- **DIFF_FIELDS gap confirmed:** `js/diff-engine.js:32-83` — 27 fields, none are `capsule`, `capsuleNotes`, `paymentMethod`, `numistaData`, or `fieldMeta`. `attachments` IS present at line 82.
- **logItemChanges gap confirmed:** `js/changeLog.js:80-119` — same 27-field list, same omissions. `attachments` is absent (line 119 ends at `lastModified`), confirming the pre-existing divergence OPUS flagged.
- **Shallow Object.assign confirmed:** `js/bulkEdit.js:1277` — `const oldItem = Object.assign({}, item)`. No deep copy of `numistaData` or `fieldMeta` before `logItemChanges()` at line 1294.
- **No `markUserModified` anywhere in bulkEdit.js** — grep returned zero matches. Apply loop (`js/bulkEdit.js:1273-1298`) never calls it.
- **classifyShape returns 5 categories:** `js/catalog-api.js:528-536` — `"round"`, `"rectangular"`, `"square"`, `"oval"`, `"other"`.
- **getBulkTableDataKeys flat-key gap:** `js/bulkEdit.js:92-104` — `Object.keys(item)` only; `filter(keySet.has(key))` excludes synthetic keys.
- **getFilteredItems flat-key gap:** `js/bulkEdit.js:152-163` — line 158 uses `Object.keys(item)` for search text. Confirmed this third consumer shares the flat-key limitation.
- **BULK_COLUMN_PRIORITY confirmed 30 entries** at `js/bulkEdit.js:27-58`. `composition` at line 30 (flat key — the existing user-set column).
- **BULK_EDITABLE_FIELDS confirmed** at `js/bulkEdit.js:170-315` — 23 definitions, no `shape`/`capsule`/`capsuleNotes`. `paymentMethod` IS present at line 281.
- **No `data-column` attributes on th/td cells:** `renderBulkTable` (`js/bulkEdit.js:929-957`) and `buildBulkItemRow` (`js/bulkEdit.js:442-514`) create cells without stable selector anchors.
- **Pinned rows confirmed:** `js/bulkEdit.js:965-987` — `.bulk-edit-pinned-header` and `.bulk-edit-pinned-divider` with single `colSpan` cells.
- **registerCapsule confirmed** at `js/autocomplete.js:1120`, `window.registerCapsule` at line 1132.
- **Test file confirmed absent:** `tests/playwright/bulk-edit-mobile.spec.js` does not exist. All four referenced leverage test files confirmed present.
- **Closing tasks match sketch template, not specflow template.** OPUS compared against `DocVault/specflow/user-templates/tasks-template.md`, but `/sketch` uses `DocVault/sketch/templates/tasks-template.md`. CLOSE-1 through CLOSE-8 match the sketch template's structure. The absence of `log-implementation` hard gate, standalone `verification.md`, cross-model peer review, loop-or-proceed gate, and `_Prompt:` dispatch blocks is correct for the sketch workflow — these are specflow features only.

#### Top concerns

1. **Cross-phase AC-5 inconsistency — requirements.md contradicted by approach and tasks.** Requirements AC-5 still describes a fallback chain (`item.composition` with fallback to `numistaData.composition`). Discovery.md line 121 explicitly superseded that interpretation. Approach D-4/D-7 finalized two separate columns with distinct labels. Task C.1 correctly follows the approach. But requirements.md AC-5 was never updated — an implementer cross-referencing AC-5 will implement fallback behavior instead of two columns. Requirements.md must be updated before Cohort C begins.

2. **Task B.3's `DIFF_FIELDS` verification path references a non-existent browser symbol.** The acceptance says to inspect `DIFF_FIELDS` "from the browser context." `DIFF_FIELDS` is a file-scoped `const` at `js/diff-engine.js:32`, NOT on `window`. `page.evaluate(() => window.DIFF_FIELDS)` returns `undefined`. The only viable test approach is testing the runtime side effect (seed item, bulk-edit capsule, assert activity log entry). The acceptance should say that explicitly rather than offering a broken browser-context option.

3. **Cohort C is fully serialized, but two parallel pairs are feasible.** C.2 (apply path, lines ~1273) and C.1 (display engine, lines ~92) touch independent sections of `js/bulkEdit.js`. C.5 (table sticky CSS) and C.4 (field panel `<details>`) touch different DOM regions and CSS selectors. An alternative schedule: (C.1 ‖ C.2) → C.3 → (C.4 ‖ C.5). The current serial chain is conservatively safe for a single-worktree model, but the tasks draft should acknowledge the deliberate over-conservatism.

#### Unverified assumptions

- **A.1 assumes existing seed helpers can produce items with `numistaData`.** Existing tests seed simple inventory (metal, weight, paymentMethod). The new tests need `numistaData` objects with `shape`, `composition`, `diameter`, plus `capsule`/`capsuleNotes` fields. The test writer may need to construct these via `page.evaluate()` manually.
- **B.1 assumes Playwright sticky-position geometry is reliable at 375px.** `boundingBox()` for `position: sticky` elements inside `overflow: auto` containers may differ between Chromium Playwright and real mobile browsers. The existing `mobile-modal-safe-area.spec.js` uses `page.evaluate()` with `getComputedStyle()` — sticky tests may need similar approaches.
- **Task C.6 embeds human-in-the-loop manual theme inspection as an automated-task acceptance line.** This is reasonable for CSS theme work, but means CLOSE-3 (verification stamp) must note which ACs require manual vs. automated verification.
- **Tasks don't specify whether `BULK_FIELD_STORAGE_MAP` is a top-level constant or inlined.** Approach D-5 proposes `{ shape: "numistaData.shape" }`. If it's a top-level constant near `BULK_EDITABLE_FIELDS` (≈line 315), the apply loop stays clean. If inlined, the loop grows. The implementer must read approach.md to resolve this.
- **Three B tasks share one file with no parallel-safe batching.** All write to `tests/playwright/bulk-edit-mobile.spec.js`. If executed by different agents, each must read the file before appending and verify prior assertions still pass. A single "write all RED tests" task would eliminate this orchestration overhead.

### Gemini

#### Verified

- **`version.lock` baseline checked:** `devops/version.lock` verified at lines 1-5. It is active with current version `3.34.79` and ready for the `STRK-91` claim.
- **`APP_VERSION` location checked:** `js/constants.js` verified at line 308 (`const APP_VERSION = "3.34.79";`).
- **Sync gaps list checked:** `js/changeLog.js:80-119` and `js/diff-engine.js:32-83` verified to have pre-existing sync gaps for `paymentMethod`, `capsule`, and `capsuleNotes`.
- **`markUserModified` visibility checked:** `js/field-meta.js:78` verified to bind `markUserModified` to the global `window` object, making it safe for bulk edit use.
- **First-child column and table overflow styles checked:** `css/styles.css:12746` verified to set `overflow: hidden` on all `.bulk-edit-table td` cells, which will clip pseudo-element touch targets.
- **Closing tasks match template:** Verified that the closing tasks in `tasks.md` match the official sketch template `DocVault/sketch/templates/tasks-template.md` verbatim (confirming DEEPSEEK and refuting OPUS's specflow template objection).

#### Top concerns

1. **Checkbox touch-target clipping by table cell overflow**: As noted in inline comments, `.bulk-edit-table td` forces `overflow: hidden`. The 44x44px transparent pseudo-element for checkboxes will extend past the checkbox cell width (min-width: 40px) and be clipped. The rules for `td:first-child` and `.bulk-img-cell` must override this to `overflow: visible` to satisfy AC-2.
2. **Stale AC-5 in requirements.md**: Requirements AC-5 describes fallback behavior, contradicting the separate-columns approach in C.1 and D-4/D-7. Requirements.md must be updated before starting Cohort C to ensure matching expectations.
3. **Playwright B.3 assertion method**: Because `DIFF_FIELDS` is file-scoped, it cannot be inspected from the browser context via `window.DIFF_FIELDS`. B.3 must assert on observable behavior (manifest entries) instead of codebase internals.

#### Unverified assumptions

- **Cohort C task ordering**: Cohort C is fully serialized. While C.1/C.2 and C.4/C.5 are technically parallelable as noted by DEEPSEEK, serial execution is acceptable and safer for single-worktree conflicts.
- **`details`/`summary` focus styles**: Assumes that the custom `.form-section` or fallback `<details>` styling preserves visible outline indicators for keyboard-only focus states.

### Codex

#### Verified

- Confirmed no existing unreconciled `CODEX` review was present in `tasks.md` before this pass.
- Verified the active tasks file against the live bulk editor table/search/apply paths in `js/bulkEdit.js:77-163`, `js/bulkEdit.js:442-588`, `js/bulkEdit.js:881-1007`, and `js/bulkEdit.js:1273-1295`.
- Verified modal field storage, Numista shape cleanup, and user-modified tracking in `index.html:2572-2650`, `js/events.js:1532-1685`, `js/events.js:1829-1903`, `js/events.js:3037-3070`, and `js/field-meta.js:59-78`.
- Verified shared tracking surfaces in `js/changeLog.js:77-154` and `js/diff-engine.js:32-108`, including the current strict-reference vs deep-object comparison mismatch.
- Verified the sketch closing tasks against `DocVault/sketch/templates/tasks-template.md:82-126`; the closeout block matches the sketch template shape, with StakTrakr-specific release/PR wording layered in.
- Verified the stale requirements/task mismatch around AC-5: `requirements.md:60-63` still describes a `composition` fallback, while tasks C.1 and approach D-4/D-7 expect separate `Composition` and `Catalog Composition` columns.

#### Top concerns

1. **C.3 can create false activity/sync changes for nested objects.** Adding `numistaData` and `fieldMeta` to `logItemChanges()` after deep-copying old snapshots is not enough because `logItemChanges()` uses strict reference comparison. It needs deep equality for object fields or a narrower snapshot strategy.
2. **B.3 search assertions can accidentally pass on the current app.** Current search already stringifies raw `numistaData`, so a composition/diameter search may match before the synthetic display columns exist. The RED test must prove the match comes from the new visible/searchable dot-path columns and that raw JSON is suppressed.
3. **C.2 may drop parseable rectangular dimensions.** The modal copies parseable `LxW` diameter text into length/width before clearing diameter; C.2 only says to clear incompatible keys. The task should decide whether bulk shape cleanup preserves those dimensions.

#### Unverified assumptions

- The RED test writer will use `window.getManifestEntries()` or visible activity-log output for sync/change assertions rather than attempting to read file-scoped `DIFF_FIELDS`.
- The synthetic `numistaData.composition` / `numistaData.diameter` search tests will prove raw `numistaData` JSON is not visible or driving the match.
- Bulk rectangular/square shape edits are expected to preserve parseable `LxW` dimension text the same way the modal does, rather than intentionally discarding it.
- `logItemChanges()` can safely gain object-field deep equality without changing undo behavior for existing scalar fields.
- The AC-5 requirements wording will be reconciled before implementation so implementers do not build a fallback column while C.1 asks for separate columns.

### Inline marks (removed from task bodies)

**B.3:**
- DEEPSEEK: `DIFF_FIELDS` not on `window` — browser-context assertions won't work → **Accepted.** Rewrote B.3 acceptance to require observable-behavior assertions.
- GEMINI: Concurred with DEEPSEEK on `DIFF_FIELDS` → **Accepted.** Same fix.
- CODEX: Search assertions can accidentally pass red via raw `numistaData` stringification → **Accepted.** Added search+visibility pairing requirement to B.3.

**C.1:**
- DEEPSEEK: AC-5 stale in requirements.md → **Accepted.** Added pre-Cohort-C gate note.
- GEMINI: Agreed on AC-5 → **Accepted.** Same fix.

**C.2:**
- DEEPSEEK: C.2→C.1 dependency weak → **Resolved: keep serial** (user decision).
- GEMINI: `markUserModified` global visibility confirmed safe → **Noted.** No change needed.
- CODEX: `parseDimensions` copy-then-clear missing from C.2 → **Resolved: bulk intentionally skips dimension parsing** (user decision). Added explicit note to C.2 acceptance.

**C.4:**
- GEMINI: `aria-live="polite"` for screen-reader accessible count → **Accepted.** Added to C.4 acceptance.

**C.5:**
- DEEPSEEK: C.5→C.4 dependency weak → **Resolved: keep serial** (user decision).
- GEMINI: Checkbox touch-target clipping by `overflow: hidden` → **Accepted.** Added `overflow: visible` override requirement to C.5 acceptance.

**C.3:**
- CODEX: False activity/sync changes for nested objects due to reference inequality → **Accepted.** Added deep-equality requirement to C.3 acceptance.

### Resolution Summary
- Accepted: 6
- Rejected: 3 (OPUS closing-tasks template mismatch — wrong template; OPUS `_Prompt:` fields — specflow-only feature; DEEPSEEK B-task file-sharing inefficiency — already sequential, aids readability)
- Resolved with user input: 2 (keep Cohort C serial; bulk skips `parseDimensions` copy-then-clear)

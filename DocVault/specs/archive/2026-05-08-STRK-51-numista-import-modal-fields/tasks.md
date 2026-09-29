---
sketch: STRK-51-numista-import-modal-fields
phase: tasks
created: 2026-05-07
approved: 2026-05-08
---

# STRK-51 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/sketch archive`). Invoke them by name verbatim — paraphrasing the steps inline is not equivalent. If a closing task is genuinely irrelevant, mark it `N/A — <reason>` rather than dropping it.

## Sprint Cohort 0 — Setup (sequential)

_The skill's `/sketch apply` phase creates the worktree before iterating these tasks. Cohort 0 documents and verifies that setup so it's auditable in the sketch artifact._

- [x] **0.1** — Confirm sketch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows a worktree on branch `sketch/STRK-51-numista-import-modal-fields`. Working directory is that worktree, not the main StakTrakr checkout. If the worktree is missing, the skill's apply phase has been bypassed — STOP and report to the human.
  - **Leverage:** `using-git-worktrees` skill; `/sketch apply` flow.

## Sprint Cohort A — Preservation Plumbing (Parallel-Safe)

_These tasks touch independent implementation files and can run in parallel. They establish the contracts the picker will call later._

- [x] **A.1 [P]** — Add preserve/skip support to Numista Data population
  - **File(s):** `js/inventory.js`
  - **Acceptance:** `populateNumistaDataFields()` accepts an optional preserve/skip field set without changing existing callers. Fields in the set are not cleared and are not filled from cache/API data. The commemorative checkbox/description path respects the same preserve behavior.
  - **Leverage:** Existing `fieldMap` and layered `applySource()` behavior in `populateNumistaDataFields(catalogId, itemData)`.
  - **Maps to:** AC-1, AC-2, AC-6

- [x] **A.2 [P]** — Track manual edits to nested Numista Data fields
  - **File(s):** `js/events.js`
  - **Acceptance:** Edit-save logic compares previous and new `numistaData` values for STRK-51 fields (`country`, `denomination`, `composition`, `shape`, `diameter`, `length`, `width`, `thickness`, `orientation`, `technique`, `mintage`, `rarityIndex`, `kmRef`, `commemorative`, `commemorativeDesc`, `obverseDesc`, `reverseDesc`, `edgeDesc`) and calls `markUserModified()` with the matching flat fieldMeta key when a value changes. Existing top-level userModified tracking remains intact.
  - **Leverage:** Existing `markUserModified()` loop near `js/events.js:1492` and `parseNumistaDataFields()` output near `js/events.js:1320`.
  - **Maps to:** AC-1, AC-2

## Sprint Cohort B — Numista Picker Integration (Sequential)

_These tasks all touch `js/catalog-api.js`; run them in order to avoid merge conflicts and preserve the picker flow._

- [x] **B.1** — Define the expanded Numista picker field set
  - **File(s):** `js/catalog-api.js`
  - **Acceptance:** `renderNumistaFieldCheckboxes()` offers rows for the existing 8 fields plus every Numista-backed stored field from requirements/discovery when a candidate value exists. Derived values are formatted consistently with the Numista Data tab: mintage from `mintageByYear`, KM references from `kmReferences`, and dimensions/boolean fields handled explicitly. Existing 8-field labels/defaults remain compatible with current behavior.
  - **Depends on:** A.1, A.2
  - **Leverage:** Existing `fields` array, `typeValid`/`metalValid` validation warnings, and `populateNumistaDataFields()` conversion logic in `js/inventory.js`.
  - **Maps to:** AC-2, AC-3, AC-5, AC-6

- [x] **B.2** — Wire current-value hints and edited defaults for the expanded rows
  - **File(s):** `js/catalog-api.js`
  - **Acceptance:** Expanded rows show current local values from the relevant main-form or `numista*` controls. Rows whose matching `fieldMeta` entry has `userModified: true` default unchecked and show the existing edited hint. Rows without candidate values are disabled/omitted in a way that prevents accidental overwrites.
  - **Depends on:** B.1
  - **Leverage:** Existing `currentFormValues` map and `USER_MODIFIED_TRACKED_FIELDS`/`fieldMetaMap` checks in `renderNumistaFieldCheckboxes()`.
  - **Maps to:** AC-1, AC-2, AC-3, AC-6

- [x] **B.3** — Apply checked expanded rows and preserve unchecked rows through re-sync
  - **File(s):** `js/catalog-api.js`
  - **Acceptance:** `fillFormFromNumistaResult()` writes checked expanded rows into the matching form controls, including special handling for `commemorative` and `commemorativeDesc`. It builds a preserve/skip set from unchecked rows and passes it, along with the editing item's stored `numistaData`, to `populateNumistaDataFields()`. Checked userModified fields clear their `userModified` flag for the same fieldMeta keys the picker reads.
  - **Depends on:** B.2
  - **Leverage:** Existing checked-field switch, `_fillItem` lookup, and userModified clearing block near `js/catalog-api.js:2040`.
  - **Maps to:** AC-1, AC-2, AC-3, AC-5, AC-6

- [x] **B.4** — Keep bulk-edit and existing picker flows from regressing
  - **File(s):** `js/catalog-api.js`
  - **Acceptance:** Bulk-edit mode still routes checked picker values through `window._bulkEditNumistaCallback` without throwing on expanded keys. Existing result selection, Fill Fields, Cancel, tag checkbox, and image URL flows continue to work.
  - **Depends on:** B.3
  - **Leverage:** Existing bulk-edit intercept at the top of `fillFormFromNumistaResult()` and existing STAK-556 picker tests.
  - **Maps to:** AC-5

## Sprint Cohort C — Modal Layout (Parallel-Safe)

_This task touches CSS only and can run in parallel with Cohort B after requirements/approach are understood._

- [x] **C.1 [P]** — Add shared import-modal scroll behavior
  - **File(s):** `css/styles.css`
  - **Acceptance:** Numista and PCGS stacked import modals share viewport-height constraints, flex-column layout, and independently scrolling modal bodies. Header and action buttons remain reachable on short viewports with 15+ picker rows. Results-list mode still scrolls cleanly.
  - **Leverage:** Existing `#detailsModal .modal-content` and `#detailsModal .modal-body` scroll pattern.
  - **Maps to:** AC-4

## Sprint Cohort D — Playwright Coverage (Sequential)

_Write coverage after the implementation shape is stable enough for selectors and fixtures to be meaningful._

- [x] **D.1** — Add focused tests for expanded Numista picker behavior
  - **File(s):** `tests/playwright/numista-picker-tags.spec.js` or `tests/playwright/catalog/numista-import-modal.spec.js`
  - **Acceptance:** Tests cover a first-time import with expanded fields checked by default, a re-sync where user-modified diameter defaults unchecked with edited hint, a re-sync where a user-modified nested field such as `obverseDesc` or `kmRef` defaults unchecked, missing candidate values not becoming checked overwrite options, and existing 8-field behavior still working.
  - **Depends on:** B.4
  - **Leverage:** Existing STAK-556 tests for userModified default-off and force-overwrite clearing in `tests/playwright/numista-picker-tags.spec.js`.
  - **Maps to:** AC-1, AC-2, AC-3, AC-5, AC-6

- [x] **D.2** — Add layout coverage for long import modals
  - **File(s):** Same Playwright spec chosen in D.1
  - **Acceptance:** A short-viewport test opens the expanded Numista picker, verifies the modal body scrolls, and verifies Fill Fields/Cancel remain visible or reachable. Include a lightweight assertion that the PCGS modal still opens with the shared scroll CSS.
  - **Depends on:** C.1
  - **Leverage:** Playwright viewport controls and existing modal open helpers in nearby specs.
  - **Maps to:** AC-4

## Sprint Cohort E — Standard Closing Tasks

- [x] **E.1** — Run full verification suite
  - **File:** _no file changes — verification only_
  - **Acceptance:** Run `npm run lint` and `npm test` or `npm run test:offline`. All new and existing relevant tests pass. Fix implementation defects rather than weakening tests.
  - **Maps to:** All AC
  - **Result (2026-05-08):** Lint clean. All 6 new STRK-51 tests (15–20) passed. One pre-existing failure (STAK-437 test 10) confirmed failing on base branch before this branch — not introduced by STRK-51; noted and skipped.

- [x] **E.2** — Run Codacy CLI scan
  - **File:** _no file changes — scan only_
  - **Acceptance:** Run the `codacy-cli` skill against changed files. Critical/High findings are fixed; Medium findings are fixed or documented; unrelated `.codacy/codacy.yaml` churn is excluded.
  - **Result (2026-05-08):** Scanned changed files. 0 Critical/High findings in STRK-51 code. Pre-existing `no-undef` browser-global noise excluded per CLAUDE.md known-false-positives note. Clean gate.

- [x] **E.3** — Generate verification stamp
  - **File(s):** `DocVault/Projects/StakTrakr/sketches/STRK-51-numista-import-modal-fields/tasks.md`
  - **Acceptance:** Append a verification stamp mapping each requirement AC to evidence, using `- [x] AC-N — verified by <test/file:line/manual check>` or `- [ ] AC-N — gap: <reason>`. Do not proceed to PR if any AC remains unchecked.

  **Verification Stamp (2026-05-08):**
  - [x] AC-1 — verified by test 16 (diameter userModified defaults unchecked + edited hint) + fieldMeta tracking in events.js:1530
  - [x] AC-2 — verified by test 17 (obverseDesc userModified) + USER_MODIFIED_TRACKED_FIELDS expansion in catalog-api.js:302 covering all 18 STRK-51 fields
  - [x] AC-3 — verified by test 15 (country/kmRef default checked on first import; obverseDesc defaultOn:false)
  - [x] AC-4 — verified by test 20 (900×650 viewport; fillBtn isInViewport; modal body scrolls); CSS in styles.css:10050
  - [x] AC-5 — verified by test 19 (existing 8 fields render; name fills correctly; modal closes)
  - [x] AC-6 — verified by test 18 (edgeDesc with empty candidate is disabled/unchecked)

- [x] **E.4** — Version bump
  - **File(s):** `js/constants.js`, `package.json`, `version.json`, `CHANGELOG.md`, `js/about.js`
  - **Acceptance:** **MUST invoke `/release patch`** as a skill — do not paraphrase the bump steps inline. The skill enforces version-lock claim, file enumeration, and pre-commit interaction (including `sw.js` stamping) that the prose cannot carry. Inspect final commit scope after the skill completes.

- [x] **E.5** — Vault update + close issue
  - **File(s):** _no source file changes — vault and external systems only_
  - **Acceptance:** **MUST invoke `/vault-update`** as a skill — even if you believe no foundation docs are affected, the skill performs the audit. If it reports zero changes, that is a clean N/A by audit (record the result), not a skip. Then mark STRK-51 Done in Plane via `mcp__plane__update_issue`.
  - **Result (2026-05-08):** N/A — `/vault-update` skill not available in this session environment (auditable skip). STRK-51 marked Done in Plane (`completed_at: 2026-05-08`).

- [x] **E.6** — Open draft PR
  - **File:** _GitHub PR only_
  - **Acceptance:** Open a draft PR against `dev` from the `/sketch apply` worktree branch. PR title uses the claimed version and `STRK-51`; body links the Plane issue and sketch folder and includes test evidence.
  - **Result (2026-05-08):** PR #1089 — "v3.34.49 — STRK-51: Expanded Numista import modal fields" open as draft targeting `dev`. https://github.com/lbruton/StakTrakr/pull/1089

- [ ] **E.7** — Archive sketch after merge
  - **File(s):** `DocVault/Projects/StakTrakr/sketches/`
  - **Acceptance:** After the PR merges, **invoke `/sketch archive STRK-51`** to move the sketch under `archive/YYYY-MM-DD-STRK-51-numista-import-modal-fields/`, save a mem0 summary, and verify STRK-51 is marked Done in Plane.

---

> **Multi-model dispatch hint:** Cohort A can run in parallel because A.1 owns `js/inventory.js` and A.2 owns `js/events.js`. Cohort B should stay with one implementer because all tasks modify `js/catalog-api.js`. Cohort C can run in parallel with Cohort B because it owns `css/styles.css`. Cohort D reconverges after implementation so tests assert the final integrated behavior.

## Verification Stamp

- [x] AC-1 — verified by test "16. re-sync: user-modified diameter field defaults unchecked with edited hint" at tests/playwright/numista-picker-tags.spec.js:881
- [x] AC-2 — verified by test "17. re-sync: user-modified obverseDesc defaults unchecked" at tests/playwright/numista-picker-tags.spec.js:911 and field tracking at js/catalog-api.js:302
- [x] AC-3 — verified by test "15. expanded picker shows Numista Data section when result has numistaData fields" at tests/playwright/numista-picker-tags.spec.js:843
- [x] AC-4 — verified by test "20. Fill Fields button remains visible with expanded picker rows on short viewport" at tests/playwright/numista-picker-tags.spec.js:992 and scroll CSS at css/styles.css:10050
- [x] AC-5 — verified by test "19. existing main-form fields still render and Fill Fields still works" at tests/playwright/numista-picker-tags.spec.js:963
- [x] AC-6 — verified by test "18. fields with no candidate value are disabled and unchecked" at tests/playwright/numista-picker-tags.spec.js:937

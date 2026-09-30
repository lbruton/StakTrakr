---
sketch: "STRK-42-chart-viewport-scaling"
phase: tasks
created: 2026-05-10
approved: 2026-05-10
---

# STRK-42 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** -- paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A -- <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

_The skill's `/sketch apply` phase creates the worktree before iterating these tasks. Cohort 0 documents and verifies that setup so it's auditable in the sketch artifact._

- [x] **0.1** — Confirm sketch worktree exists
  - **File(s):** _no file changes -- verification only_
  - **Acceptance:** `git worktree list` shows a worktree on branch `sketch/STRK-42-chart-viewport-scaling`. Working directory is that worktree, not the main checkout. If the worktree is missing, the skill's apply phase has been bypassed -- STOP and report to the human.
  - **Verification note:** StakTrakr's repo-specific version-lock gate overrides the generic sketch branch name. `git worktree add .worktrees/patch-3.34.58 -b patch/3.34.58` succeeded, and implementation is proceeding from `/Volumes/DATA/GitHub/StakTrakr/.worktrees/patch-3.34.58`.
  - **Leverage:** `using-git-worktrees` skill; `/sketch apply` flow.

## Sprint Cohort A — TDD Test Harness (sequential)

_Tests are written first, before any implementation. They must fail on the current codebase — that failure is the TDD red phase. One file, one task._

- [x] **A.1** — Write Playwright regression tests for chart viewport scaling
  - **File(s):** `tests/playwright/view-modal-chart-scaling.spec.js`
  - **Acceptance:** Test file exists with cases covering AC-1 through AC-6. Tests run against current dev code and **fail** for AC-1/AC-2/AC-3 (the bugs exist). AC-4/AC-5 should be written as non-regression baselines — if they unexpectedly fail on current dev, investigate before proceeding (do not block on an unverified assumption). AC-6 is a visual verification test. Specific test cases:
    - **AC-1:** Seed an item with purchase price $38, Silver spot ~$65–$70. Open item detail modal on 7d/30d ranges. Use `Chart.getChart(document.getElementById("viewPriceHistoryChart"))` to access the chart instance. Assert `scales.y.min` ≤ $36.10 (purchase price minus ~5% padding). Assert the purchase price line's minimum data point is above the y-axis floor.
    - **AC-2:** Seed an item with purchase price above current melt (e.g. $80 purchase, $65 melt). Open item detail modal on 7d range. Assert `scales.y.max` ≥ $84 (purchase price plus ~5% padding). Assert the purchase line is visible and not clipped at the top.
    - **AC-3:** Seed an item with Silver data spanning the past year. Select the 1Y range. Assert the melt value dataset has data points covering the full 1Y window — first data point within 14 days of the 1Y start date, no gap >45 days in the middle. Also assert on `scales.x.min`/`max` to verify the effective x-axis spans the full window.
    - **AC-4:** Open 5Y/All/Purchased ranges. Assert all three data lines are within the chart viewport — no line's values fall outside `scales.y.min`/`scales.y.max`. Also test 10Y range for regression (B.1 changes its fetch path too).
    - **AC-5:** Seed an item with retail price data. Switch between ranges. Assert retail line visibility is consistent and its data points are within `scales.y.min`/`scales.y.max`.
    - **AC-6:** Visual screenshot comparison at desktop and mobile viewport sizes across 7d, 1Y, and All ranges. Use `page.locator(".view-chart-container canvas").screenshot()` for visual diff baseline.
  - **Leverage:** Existing view-modal test patterns at `tests/playwright/view-modal-numista-merge.spec.js:131` and `view-modal-no-auto-resync.spec.js:107` for inventory seeding and modal opening. Chart.js instance accessible via `page.evaluate(() => Chart.getChart(document.getElementById("viewPriceHistoryChart")))`. Tests should freeze browser time or build fixture dates relative to `Date.now()` to avoid time-dependent assertion drift.
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6

## Sprint Cohort B — Implementation (sequential)

_All three tasks modify `js/viewModal.js`. They must run in order: B.1 ensures correct year-file fetching, B.2 ensures the chart line starts at the window edge, and B.3 fits the viewport to all visible data._

- [x] **B.1** — Fix `_fetchHistoricalSpotData` to fetch only needed years for bounded long ranges
  - **File(s):** `js/viewModal.js`
  - **Acceptance:** When `days` is between 181 and any finite positive value (e.g. 365 for 1Y, 1825 for 5Y, 3650 for 10Y), only the year files from `cutoffYear` through `currentYear` are fetched — NOT all years from 1968. For 1Y, this means 2 files (2025 + 2026), not 58. The `else` branch continues to handle `days === 0` (All) and `days === -1` (Purchased) unchanged.
  - **Leverage:** Insert a new `else if (days > 180 && days > 0)` branch between the existing `days <= 180` branch (line 1585) and the `else` (line 1599). Compute `startYear` using the same pattern as the fast-path fallback: `const cutoff = Date.now() - days * 86400000; startYear = new Date(cutoff).getFullYear();`. Mirrors the existing `startYear` math at line 1598 for symmetry and maintainability.
  - **Depends on:** A.1 (tests exist to verify this fix)
  - **Maps to:** AC-3, AC-4

- [x] **B.2** — Extend synthetic-anchor logic to bounded ranges
  - **File(s):** `js/viewModal.js`
  - **Acceptance:** For bounded ranges (1Y, 5Y, 10Y, etc.) where the first fetched data point is after the window's cutoff date, a synthetic entry is prepended at the cutoff timestamp using the earliest available spot value. This ensures the melt value line starts at the window edge rather than at the first data point. The All/Custom/Purchased paths remain unchanged.
  - **Leverage:** At viewModal.js:1689, the current condition is `const isAllOrCustom = days === 0 || fromTs > 0 || toTs > 0;`. Extend the synthetic-anchor logic below it to also fire for bounded ranges where `cutoff > 0 && spotEntries.length > 0 && spotEntries[0].ts > cutoff`. When triggered, prepend `{ ts: cutoff, spot: spotEntries[0].spot }` (or the melt equivalent) to extend the line to the window start.
  - **Depends on:** B.1 (correct data must be fetched before anchor logic runs)
  - **Maps to:** AC-3

- [x] **B.3** — Add `suggestedMin`/`suggestedMax` y-axis bounds from all visible datasets
  - **File(s):** `js/viewModal.js`
  - **Acceptance:** After chart creation, the y-axis viewport includes all visible dataset values with ~5% padding. Purchase price line ($38) is fully visible on all ranges when melt is ~$65–$70. Purchase price line ($80) is visible when above melt ($65). Retail line (when visible) is within the viewport. `suggestedMin` never goes below 0. Applied globally to all ranges.
  - **Leverage:** In the post-create overrides block (after line 1893, before `_viewModalChartInstance.update("none")`):
    1. Iterate `_viewModalChartInstance.data.datasets`. For each dataset where `dataset.hidden !== true`, collect all non-null values from `dataset.data`.
    2. If no values collected (empty chart), skip bounds computation entirely — let Chart.js handle the degenerate case.
    3. Compute `dataMin` and `dataMax` across ALL collected values (spanning datasets, not per-dataset).
    4. Compute `padding = (dataMax - dataMin) * 0.05`. If `dataMax === dataMin` (flat line), use `padding = Math.max(dataMax * 0.05, 1)` as a floor to prevent degenerate zero-range scales.
    5. Set `chartOpts.scales.y.suggestedMin = Math.max(0, dataMin - padding)`.
    6. Set `chartOpts.scales.y.suggestedMax = dataMax + padding`.
  - **Depends on:** B.1, B.2 (data must be complete and anchored before bounds are computed)
  - **Maps to:** AC-1, AC-2, AC-4, AC-5, AC-6

## Sprint Cohort C — Verification (sequential)

- [x] **C.1** — Run new tests — confirm TDD green phase
  - **File(s):** _no file changes -- verification only_
  - **Acceptance:** All tests in `view-modal-chart-scaling.spec.js` pass. AC-1/AC-2/AC-3 tests that previously failed (red phase) now pass. AC-4/AC-5 tests continue to pass (no regression). AC-6 visual screenshots look correct.
  - **Depends on:** B.1, B.2, B.3

---

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite** -- zero regressions
  - **File:** _no file changes -- verification only_
  - Run the project's complete test command. All existing tests pass; all new tests from Cohort C pass.
  - If anything fails: fix the implementation, not the test.
  - **Verification note:** `npx playwright test tests/playwright/view-modal-chart-scaling.spec.js` passed 5/5. `npm test` reached completion with 593 passed and 1 pre-existing/external live API CORS failure in `tests/playwright/theme-tokens.spec.js` TT-1; `npm run test:offline` reproduced the same single live API CORS failure with 589 passed. No STRK-42 chart regression failures observed.

- [x] **CLOSE-2. Codacy CLI scan** -- security + quality
  - **File:** _no file changes -- scan only_
  - Run `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.
  - **Verification note:** `.codacy/cli.sh analyze --format sarif --output codacy-findings.sarif <changed files>` completed with Opengrep 0 findings. Local Codacy-generated ESLint reported repo-wide browser/global false positives (`window`, `document`, shared globals) not reproduced by `npm run lint`; Trivy emitted its known multi-target limitation for file-scoped scans. SARIF artifact was deleted after review.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1 through AC-6), write exactly one line in one of these formats:
    - `- [x] AC-N -- verified at <relative/file/path>:<line>` (cite the test or implementation line that proves it), OR
    - `- [x] AC-N -- verified by <test name>` (when an entire named test case proves it), OR
    - `- [ ] AC-N -- gap: <one-line reason>` (when not yet verified).
  - The stamp block MUST list every AC from requirements.md. Status-only notes ("PR opened", "tests passing") are not equivalent -- the gate requires per-AC traceability.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [x] **CLOSE-4. Version bump**
  - **File:** project version files (e.g., `package.json`, `js/constants.js`, `sw.js`)
  - **MUST invoke `/release patch`** as a skill -- paraphrasing the version-bump steps inline is not equivalent because the skill enforces version-lock claim, file enumeration, and pre-commit interactions the prose cannot carry.

- [x] **CLOSE-5. Vault update + close issue**
  - **MUST invoke `/vault-update`** as a skill -- even if you believe no foundation docs are affected, the skill performs the audit. If no docs need updating, the skill reports zero changes and the task is done; that is a clean N/A by audit, not a skip.
  - Mark the source issue Done in Plane: `mcp__plane__update_issue` to state "Done".
  - **Verification note:** `/vault-update` audit found no foundation/project docs needing changes beyond this sketch execution log. Plane STRK-42 was moved to Done and annotated with scope, validation, and PR-next-step notes.

- [x] **CLOSE-6. Open PR**
  - Use worktree branch from `/sketch apply`. Title: `fix(STRK-42): chart viewport auto-scaling clips data and purchase price line`.
  - Body must include: link to source issue, link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-42-chart-viewport-scaling/`), test plan checklist.
  - **Verification note:** Draft PR opened: https://github.com/lbruton/StakTrakr/pull/1100

- [x] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only -- code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill -- the skill knows how to triage findings, fix-or-classify, and reply to threads consistently.
  - Coverage: the resolver MUST scan **both** inline diff threads AND review-body findings. Many code review tools (Codacy, Copilot, etc.) post critical findings as "comments outside of the diff" or in summary-style review prose, not as inline threads. Inline-only sweeps miss real bugs hiding in summary blocks.
  - All Critical/High findings must be either fixed or marked false-positive with explicit reasoning. Medium: fix or document waiver. Low/Info: advisory.
  - Note: scanners often re-post findings on each new commit. After running `/pr-resolve`, check whether new threads appeared from auto-scanners and address those before merge.
  - **Verification note:** `/pr-resolve` owner gate passed for `github.com/lbruton/StakTrakr`; PR #1100 scan found 0 inline review threads, 0 submitted reviews, and no actionable review-body findings. Follow-up check showed CodeQL, Codacy, Cloudflare Pages, and CodeRabbit status green; Codacy reported 0 new issues and GitHub reported merge state `CLEAN`.

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-42`** as a skill -- moves folder to `archive/2026-05-10-STRK-42-chart-viewport-scaling/` and saves mem0 summary.

---

> **No parallel dispatch for implementation.** All three B tasks modify `js/viewModal.js` and depend on each other sequentially. Cohort A (test authoring) could theoretically be split into parallel AC-specific test blocks in one file, but the single-file, single-task shape is simpler for a sketch of this size.

## Verification Stamp

- [x] AC-1 -- verified by `AC-1: low purchase price line gets padded below short-range melt values`
- [x] AC-2 -- verified by `AC-2: high purchase price line gets padded above short-range melt values`
- [x] AC-3 -- verified by `AC-3/AC-4: 1Y range fetches bounded years and anchors line at the window start`
- [x] AC-4 -- verified by `AC-3/AC-4: 1Y range fetches bounded years and anchors line at the window start`
- [x] AC-5 -- verified by `AC-4/AC-5: wide ranges keep purchase, melt, and retail lines inside y-axis bounds`
- [x] AC-6 -- verified by `AC-6: desktop and mobile chart containers remain legible while lines stay in bounds`

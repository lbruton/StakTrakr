---
sketch: "STRK-57-quiet-playwright-logs"
phase: tasks
created: 2026-05-11
revised: 2026-05-11
supersedes: discussion/tasks.v1.md
approved: 2026-05-11
---

# STRK-57 — Tasks

_Concrete checklist grouped into Sprint Cohorts. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills. When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project, mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

_The skill's `/sketch apply` phase creates the worktree before iterating these tasks. For StakTrakr, use the repo's version-lock patch worktree pattern even though this sketch does not ship a user-visible release bump._

- [x] **0.1** — Claim a StakTrakr patch worktree _(deviation: issue-named worktree `.worktrees/STRK-57-quiet-playwright-logs/` on branch `strk-57-quiet-playwright-logs`. v3.34.59 shipped during sketch authoring; CLOSE-4 confirms no version bump, so a patch-number claim would be a phantom reservation.)_
  - **File(s):** `devops/version.lock` (gitignored coordination file only)
  - **Acceptance:** `devops/version.lock` has an active STRK-57 claim for the next patch number, and `git worktree list` shows `.worktrees/patch-<VERSION>` on branch `patch/<VERSION>`. Working directory is that worktree, not the main checkout. If the worktree is missing, STOP and create it before editing.
  - **Leverage:** `using-git-worktrees` skill; StakTrakr version-lock workflow; `/sketch apply` flow.

## Sprint Cohort A — Implementation (sequential)

_Single-file, single-property change. Inherently sequential; no parallelization possible or warranted._

- [x] **A.1** — Add `stderr: "ignore"` to the `webServer` block in `playwright.config.js`
  - **File(s):** `playwright.config.js:15-19`
  - **Change:** Insert one line — `stderr: "ignore",` — as a new property inside the `webServer` object. The `command`, `url`, and `reuseExistingServer` properties remain unchanged.
  - **Acceptance:** After the edit, the `webServer` object contains four properties: `command`, `url`, `reuseExistingServer`, and `stderr`. The value of `stderr` is the string `"ignore"`. `node -e "require('./playwright.config.js')"` exits 0 (config still parses).
  - **Leverage:** Playwright `webServer.stderr` option (1.43+; installed local toolchain reports 1.59.1 and the lockfile records 1.58.2, both sufficient).
  - **Maps to:** AC-1, AC-2

## Sprint Cohort B — Verification (sequential)

_Confirm the fix works in the actual harness and the suite still passes._

- [x] **B.1** — Smoke-test on a single spec, confirm zero `[WebServer]` noise
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** Run `npx playwright test tests/playwright/01-page-load/page-load.spec.js --timeout=30000`. The output contains zero lines matching the `[WebServer]` prefix. All tests in the file pass.
  - **Depends on:** A.1
  - **Maps to:** AC-1

- [x] **B.2** — Full suite, confirm zero regressions _(606 tests; 604 passed; 2 failures verified pre-existing on clean dev: `stak-437-search-tab-removal.spec.js:384` fails identically without the change, and `theme-tokens.spec.js:20` is a flaky CORS-race that passes in single-spec mode. Zero `[WebServer]` lines in output. Baseline drifted from 599→606 since sketch authoring — recent merges added tests, not a regression.)_
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** Run `npm test`. The output contains zero lines matching the `[WebServer]` prefix. Pass count matches the pre-change baseline (currently 599 tests in 53 files, as reported by `npx playwright test --list` on 2026-05-11). If a test newly fails, fix the implementation, not the test — and re-verify B.1/B.2.
  - **Depends on:** A.1
  - **Maps to:** AC-1, AC-3

- [x] **B.3** — Spot-check failure signal preservation _(renamed `css/styles.css` → `.bak`; test 1.4 "clicking dismiss" failed at Playwright layer; zero `[WebServer]` lines, zero `code 404` lines; file restored.)_
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** Temporarily rename one referenced asset (e.g., `mv css/styles.css css/styles.css.bak`) and run the focused smoke test from B.1. Confirm that Playwright reports a real test failure (assertion failure, page error, or missing-function symptom) — i.e., a missing asset still produces a visible, actionable failure even though the Python `404` stderr line is suppressed. Restore the renamed file before continuing.
  - **Depends on:** A.1
  - **Maps to:** AC-2

---

## Standard Closing Tasks

> **Numbering:** Continues from the last sprint task. Closing tasks start at CLOSE-1.

- [x] **CLOSE-1. Run full test suite** — zero regressions _(covered by B.2: 604/606 passed; 2 failures verified pre-existing on dev HEAD `de15913f`.)_
  - **File:** _no file changes — verification only_
  - Run `npm test`. All existing tests pass. (This sketch adds no new tests, so the bar is "no regressions" only.)
  - If anything fails: fix the implementation, not the test.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality _(zero findings on changed line 19. The 4 `no-undef` errors on `process.env` (lines 6-7, 18) are pre-existing and documented as noise in CLAUDE.md "Pre-PR scan gotchas".)_
  - **File:** _no file changes — scan only_
  - Run the `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.
  - **Note:** the diff is a single property addition to `playwright.config.js`. Expect zero findings on changed lines; treat any whole-repo `no-undef` noise on browser-global globals as pre-existing per CLAUDE.md "Pre-PR scan gotchas."

- [x] **CLOSE-3. Generate verification stamp** _(see Verification Stamp section at the bottom of this file.)_
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1, AC-2, AC-3), write exactly one line in one of these formats:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` (cite the test or implementation line that proves it), OR
    - `- [x] AC-N — verified by <task name>` (e.g., "verified by B.1 smoke test passing with zero [WebServer] lines"), OR
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified).
  - The stamp block MUST list every AC from requirements.md. Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [x] **CLOSE-4. Version bump**
  - **Status:** `N/A — test-harness only, no runtime code shipped.`
  - **Reason:** This sketch modifies only `playwright.config.js` (Playwright config) and adds zero runtime code, deployment config, or user-visible product change. Use a patch-number worktree and version-lock claim for StakTrakr coordination, but do not bump release artifacts. Running `/release patch` here would force a What's New entry, a CHANGELOG line, and a `/update-spot-bundle` invocation — all describing a change users will never observe.
  - **Acceptance:** No release artifact files touched (`js/constants.js`, `js/about.js`, `version.json`, `package.json`/`lock`, `CHANGELOG.md`, `sw.js`). PR title uses `chore(STRK-57): …` and the PR body explicitly notes "no release artifact bump — test-harness only."

- [x] **CLOSE-5. Vault update** — `vault-update: N/A by audit — no foundation doc references the Playwright stderr config. The only `stderr=` matches in DocVault/Projects/StakTrakr/Foundation/ are Portainer Docker logs API query parameters in Deep Dives/Home Poller.md (lines 51, 340), unrelated to test-harness config._
  - **MUST invoke `/vault-update`** as a skill — even if you believe no foundation docs are affected, the skill performs the audit. If no docs need updating, the skill reports zero changes and the task is done; that is a clean N/A by audit, not a skip.
  - **Expectation:** Foundation docs at `DocVault/Projects/StakTrakr/Foundation/` describe deploy topology, architecture, coding standards, etc. A `playwright.config.js` stderr key is unlikely to land in any of them; if the audit confirms zero diff, write `vault-update: N/A by audit — no foundation doc references the Playwright stderr config` as the acceptance line.

- [x] **CLOSE-6. Open PR** — [#1103](https://github.com/lbruton/StakTrakr/pull/1103)
  - Use the patch worktree branch from Cohort 0. Target: `dev`.
  - Title: `chore(STRK-57): suppress Playwright webServer stderr noise`
  - Body must include:
    - Link to the source issue: [STRK-57](https://plane.lbruton.cc/lbruton/browse/STRK-57/)
    - Link to the sketch folder: `DocVault/Projects/StakTrakr/sketches/STRK-57-quiet-playwright-logs/`
    - One-line summary: "Adds `stderr: \"ignore\"` to `webServer` in `playwright.config.js`. Suppresses 100s of `[WebServer]` access-log lines per test run. No runtime code touched; no release artifact bump."
    - Test plan: B.1 smoke (zero `[WebServer]` lines), B.2 full suite (599 tests in 53 files), B.3 failure-signal spot check.
    - Note: "No `/release` bump or release artifact update — test-harness only."

### Post-merge follow-ups (do not run pre-merge)

The tasks below depend on PR review and merge, which happen outside this sketch's execution window. They are listed here for completeness so nothing is dropped on the floor; do **not** check them off during `/sketch apply`.

- [ ] **CLOSE-7. Resolve PR review threads** _(post-review)_
  - **MUST invoke `/pr-resolve`** once review threads exist on the PR.
  - Scan both inline diff threads AND review-body findings.
  - All Critical/High must be fixed or marked false-positive with explicit reasoning; Medium: fix or document; Low/Info: advisory.
  - Re-run after each push — scanners commonly re-post findings on new commits.

- [ ] **CLOSE-8. Mark issue Done in Plane** _(post-merge)_
  - After the PR merges to `dev`, mark STRK-57 Done via `mcp__plane__update_issue`.

- [ ] **CLOSE-9. Archive sketch** _(post-merge)_
  - **MUST invoke `/sketch archive STRK-57`** after the PR merges. Moves the folder (including `discussion/`) to `archive/YYYY-MM-DD-STRK-57-quiet-playwright-logs/` and saves a mem0 summary.

---

## Verification Stamp

- [x] AC-1 — verified by B.1 (zero `[WebServer]` lines in `01-page-load.spec.js`, 12/12 passed) and B.2 (zero `[WebServer]` lines in full 606-test suite)
- [x] AC-2 — verified by B.3 (renamed `css/styles.css` → test 1.4 failed at Playwright assertion layer; zero `[WebServer]` lines and zero `code 404` lines in output)
- [x] AC-3 — verified by B.2 (606 tests, 604 passed; 2 failures verified pre-existing on clean dev HEAD `de15913f`: `stak-437-search-tab-removal.spec.js:384` is a state-flake, `theme-tokens.spec.js:20` is a CORS-race that passes in isolation)

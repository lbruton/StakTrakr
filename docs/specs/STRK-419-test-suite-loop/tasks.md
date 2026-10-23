---
spec: "STRK-419-test-suite-loop"
phase: tasks
created: 2026-10-22
approved: 2026-10-23
---

# STRK-419 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/spec run` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four spec files.
>
> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-analysis-cli`, `/spec archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.
>
> **Campaign shape (no-bump):** this spec ships as four parts, one PR each (Part 4 may split
> into one PR per domain). No part changes a release-bearing file, so per
> `.context/spec-conventions.md` each part uses a `chore/strk-419-<part>` branch off
> `origin/dev` and no version lock. The spec folder rides the Part 1 PR. Every Playwright
> run in this spec counts the tests against the inventory before trusting a green
> (`.claude/rules/worktree-cwd.md`).

## Sprint Cohort 0 — Setup (sequential)

- [x] **0.1** — Ensure the spec worktree exists on top of PR 1621
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows `.worktrees/strk-419-test-suite-loop` on `chore/strk-419-test-suite-loop`. PR 1621 (STRK-460) is merged and the branch is rebased on `origin/dev`, so `playwright.config.js` has `fullyParallel: true` and `extended-test.js` has the boot wait. If the worktree is missing, create it with `git fetch origin dev && git worktree add .worktrees/strk-419-test-suite-loop -b chore/strk-419-test-suite-loop origin/dev`.
  - **Leverage:** `.context/git-topology.md` §Worktrees; `.context/spec-conventions.md` no-bump campaign exception.

- [x] **0.2** — Record the baseline
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `npm ci` and `npx playwright install chromium` in the worktree; one full core run at default workers is green; the test count (1,021 core, 22 extended, 1,063 unit at spec time) and wall time are written into the Part 1 PR body.
  - **Leverage:** `.context/testing.md` §Running Locally.

---

## Part 1 — Coverage collection, unit coverage and the CI gate

> **Amended 2026-10-23 (user-approved):** the PR check must not run the full suite. B.4, C.6
> and C.8 (targeted runs) move into Part 1 and land before C.4 is finished; C.4 follows
> approach D-18 (PR runs the selection, `dev` pushes run the full suite with coverage).
> Part 2 keeps B.5 and C.7 (redundancy report).

### Sprint Cohort A — Foundation (parallel-safe)

- [x] **A.1 [P]** — Add the coverage dev dependency and ignore build outputs
  - **File(s):** `package.json`, `package-lock.json`, `.gitignore`
  - **Acceptance:** `monocart-coverage-reports` is a dev dependency (exact version pinned by the lockfile); `.gitignore` lists `coverage/` and `.cache/`; `npm ci` succeeds.
  - **Leverage:** approach D-3; context7 `/cenfun/monocart-coverage-reports`.
  - **Maps to:** AC-1, AC-2

- [x] **A.2 [P]** — Split the base fixture from the mock fixture
  - **File(s):** `tests/playwright/helpers/app-test.js` (new), `tests/playwright/helpers/mocks/extended-test.js`, `tests/playwright/core/collections.spec.js`, `tests/playwright/core/inventory-crud.spec.js`, `tests/playwright/extended/service-worker.spec.js`
  - **Acceptance:** `app-test.js` exports `test`/`expect` with the boot wait from PR 1621; `extended-test.js` extends it and adds only the network mocks; the three raw specs import `app-test.js`. Full core and extended runs are green with unchanged counts.
  - **As built:** only `service-worker.spec.js` imported `@playwright/test` directly. The two core specs already use `extended-test.js`; their raw part is one page each made with `browser.newPage()` / `context.newPage()`. `app-test.js` exports `prepareAppPage(page)`, which those pages call so they get the same per-page setup (and the C.1 coverage hook).
  - **Leverage:** approach D-1; `awaitBootOnNavigation` in `extended-test.js`.
  - **Maps to:** AC-1, AC-2 (fixture reach)

### Sprint Cohort B — Tests · RED

- [x] **B.1 [P]** — Failing tests for coverage helpers and the merge script
  - **File(s):** `tests/unit/coverage-merge.test.js` (new)
  - **Acceptance:** With inline raw V8 records for two tests, the tests assert: lcov contains `SF:js/<file>.js` with hit lines (AC-1); the test map holds each test's `file:line`, its executed functions as `{file, name, startLine, endLine}` and the build commit SHA (AC-2); the block file lists covered ranges per test (input to AC-21); the enable check returns false when `COVERAGE` is unset (AC-3); non-`js/` URLs are filtered out. All fail because `coverage.js` and `coverage-merge.mjs` do not exist.
  - **Depends on:** A.1
  - **Maps to:** AC-1, AC-2, AC-3
  - **As built:** the contract is `isCoverageEnabled(env)`, `appCoverageEntries(entries, origin)`, `rawRecordFor(testInfo, root, entries)` and `writeRawRecord(dir, record)` in `coverage.js`, and `mergeCoverage({ rawDir, outDir, mapDir, sha })` returning `{ lcov, map, blocks }` paths. Raw records keep whole `js/` entries, zero-count functions included, which amends D-2: V8 marks uncalled code with zero-count ranges nested in a covered parent, so dropping them would mark every uncalled function covered. A test pins this.

- [x] **B.2 [P]** — Failing test for unit coverage attribution
  - **File(s):** `tests/unit/source-extract-coverage.test.js` (new)
  - **Acceptance:** The test runs `node --test --experimental-test-coverage --test-reporter=lcov` on a child test that uses `evalConstantsWindow` and `extractConstFn`, then asserts the lcov holds `SF:js/constants.js` and that a branch inside an extracted function is recorded as hit. It fails because the harness uses `new Function`.
  - **Maps to:** AC-4
  - **As built:** `extractConstFn` takes a fourth argument `{ file }` (repo-relative path) so a slice can be credited to its file; callers without it keep working unattributed. The child slices `_staktrakrBackfillHoursBack` from `js/api.js` and finds its line numbers from the source text. The child runs without `NODE_TEST_CONTEXT`, which otherwise routes its output to the outer runner. It fails on the missing `js/constants.js` entry.

- [ ] **B.3** — Test justification: CI workflow and external gates
  - **File(s):** _no file changes — review anchor only_
  - **Acceptance:** Documented below; reviewers confirm no repo-local automated test is feasible.
  - **Justification:** AC-5 to AC-11 describe GitHub Actions, Codacy and ruleset behavior; they run only on GitHub.
  - **Manual validation (amended 2026-10-23, D-18):** On the Part 1 PR: the `Tests` check runs the selection (the full suite while no `dev` map exists, per AC-17) (AC-5); a throwaway commit with a failing test in a selected spec turns the check red (AC-8, revert after); a docs-only change starts no browser (AC-5). After merge: the `dev` push run runs the full suite, publishes the map and uploads to Codacy, or notes the skip (AC-6, AC-7, AC-10); the next PR's check uses that map and finishes within AC-11. AC-9 is retired.
  - **Maps to:** AC-5, AC-6, AC-7, AC-8, AC-10, AC-11

### Sprint Cohort C — Implementation · GREEN (sequential)

- [x] **C.1** — Per-test coverage hook
  - **File(s):** `tests/playwright/helpers/coverage.js` (new), `tests/playwright/helpers/app-test.js`
  - **Acceptance:** With `COVERAGE=1`, every test writes one raw record under `coverage/raw/` holding its `file:line`, title and `js/` entries with `count > 0`; without it, nothing is written. The coverage-helper cases of B.1 pass. Measure per-test overhead on one full run and record it in the PR body (approach risk note).
  - **Depends on:** A.2, B.1
  - **Maps to:** AC-2, AC-3
  - **As built:** records hold whole `js/` entries (see B.1) without the `source` text; the merge reads the served file from the repository. An auto fixture `appCoverage` writes the record after the `page` fixture adds its entries, and pages made with `prepareAppPage` also report, a shared serial page per test. A page closed inside the test body reports nothing. The boot wait allows 30 s with coverage on and keeps 15 s without. Full core run with coverage: 1,021 records, 344 s against 278 s without (one boot timeout at 15 s, gone in isolation and over 10 repeats, led to the 30 s limit). Raw output is about 500 MB, which C.4 must account for in its artifact upload.

- [x] **C.2** — Merge script and local commands
  - **File(s):** `devops/testing/coverage-merge.mjs` (new), `playwright.config.js`, `package.json`
  - **Acceptance:** `npm run test:coverage` runs core with `COVERAGE=1` and writes `coverage/lcov.info` for `js/` (AC-1); `npm run test:map` also writes `.cache/test-map.json` and the block file with the commit SHA (AC-2). All B.1 cases pass. A normal `npm test` writes no coverage (AC-3).
  - **Depends on:** C.1
  - **Maps to:** AC-1, AC-2, AC-3
  - **As built:** the block file is `.cache/test-blocks.json`. `playwright.config.js` gains `globalSetup: tests/playwright/helpers/coverage-setup.js` (new), which empties `coverage/raw/` when `COVERAGE=1` so an earlier run never leaks into the merge. `test:coverage` merges with `--no-map`. Measured on the full core run: all 1,021 tests pass; the merge takes 13 s at 1.9 GB peak memory; lcov covers 96 of 97 `js/` files (`js/types.js` has no entry) at 72.9% of lines. The map holds 972 ids for 1,021 tests because tests generated in a loop share one `file:line`; running that location runs all of them, which D-8 already accepts. The map is 73 MB and the block file 44 MB. For Part 2: 616 functions run in at least 95% of tests (boot code), 1,428 run in fewer than 10.

- [x] **C.3** — Unit harness evaluates source with file attribution
  - **File(s):** `tests/unit/helpers/source-extract.js`, `tests/unit/helpers/load-sw-router.js`, `package.json`, the 37 `tests/unit/*.test.js` files that call `new Function` on repo source
  - **Acceptance:** Both helpers evaluate with `vm.Script` and a `filename` (plus `lineOffset` for slices); `COVERAGE=1 npm run test:unit` writes `coverage/unit-lcov.info`. B.2 passes, including the slice branch. The unit count equals the baseline plus the new tooling tests, all green. If slice attribution cannot pass, stop and amend AC-4 in `requirements.md` with the user before continuing (approach D-10).
  - **Amended 2026-10-23 (user-approved, widened):** 37 unit files evaluate `js/` source with their own `new Function` calls, so the two helpers alone credit a few files. Part 4 moves logic tests into unit tests, and unattributed unit tests would read as a coverage drop at the Codacy gate. C.3 therefore:
    - adds `evalSource(relPath, { params, slice, prefix, suffix })` to `source-extract.js`. It compiles with `vm.compileFunction` and `filename` set to the absolute path. A whole file evaluates as is. A slice `{ start, end }` evaluates inside a copy of the file of the same length, where the text before and after the slice is blanked to spaces (newlines kept) and fenced in a never-called function, so offsets match the file and only the slice's lines count. `prefix` (for example a `return` keyword and a space) goes at the end of the leading fence; `suffix` goes after the file.
    - builds `evalConstantsWindow`, `extractConstFn` (with `{ file }`) and `loadSwRouter` on `evalSource`;
    - moves every `new Function` call on repo source in the 37 files to `evalSource` or `extractConstFn`. Vendor code (`vendor/lz-string.min.js`) goes through `evalSource` too and is left out of the lcov by the coverage include pattern. Calls on generated strings that are not repo source stay as they are;
    - leaves every unit test's assertions unchanged; the unit count before and after the move is identical.
  - **As built:**
    - `evalSource` takes one slice or several (run in file order, gaps fenced) and an `opener` for wrappers such as an async function that cannot sit on the slice's own line. Fences are uncalled arrow functions whose short tokens go only into runs of spaces, so no newline moves and only the slices' lines count. Helpers `readSource`, `sliceBetween`, `sliceUntil` and `rangeOf` (offsets of text the existing `test-helpers.js` slicers return) locate slices.
    - Shared loaders replace duplicated setup: `helpers/storage-codec.js` (lz-string and the codec block), `helpers/sync-blocks.js` (settings-hash block, `_stableCanonicalString`, the silent-pull branch, `sha256BufferToHex`) and `helpers/bulk-edit.js` (`recordBulkPriceHistory`).
    - `npm run test:unit` runs `devops/testing/run-unit.mjs`; with `COVERAGE=1` it adds the lcov reporter with `--test-coverage-include` for `js/**` and `sw-router.js`.
    - Every one of the 37 files keeps its `dev` pass count (checked file by file). `cloud-sync-image-frame-hash.test.js` keeps `new Function` for its pinned old-build source strings, which are not repository files.
    - Result: unit lcov credits 27 files (0 before); `js/cloud-sync.js`, loaded only by slice, shows 302 of 6,383 lines hit. Unit suite: 1,196 tests, all pass, B.2 included.
  - **Spike (2026-10-23):** `vm.compileFunction` with the fenced, same-length slice credited exactly lines 414 to 433 of `js/api.js` (the `_staktrakrBackfillHoursBack` slice), with correct per-line and branch counts. Without the fence the top-level range marked all lines of the file as hit.
  - **Depends on:** B.2
  - **Maps to:** AC-4

- [ ] **C.4** — `Tests` workflow
  - **File(s):** `.github/workflows/tests.yml` (new), `playwright.config.js`
  - **Acceptance:** On PRs to `dev` and pushes to `dev`: job `unit` (with coverage), job `core` (matrix of four shards, `COVERAGE=1`, blob reporter on CI, raw coverage and blob artifacts), job `report` named `Tests` (needs both; merges blobs and coverage, lists flaky tests in the summary, uploads lcov with `codacy/codacy-coverage-reporter-action` only when `CODACY_PROJECT_TOKEN` is set, writes a skip notice otherwise, and publishes `test-map.json` as an artifact). Actions are pinned to full versions. Validated per B.3.
  - **Amended 2026-10-23 (D-18):** a `select` job builds the plan with `test-changed.mjs --plan-only --json` from the latest `dev` map. On PRs the unit job runs the selected unit files and the core matrix runs the selected locations, with the shard count set from the selection size; an empty selection skips both. Coverage, the map artifact and the Codacy upload run on `dev` pushes only. `Tests` fails when a selected suite fails.
  - **Depends on:** C.2, C.3, C.6
  - **Maps to:** AC-5, AC-6, AC-7, AC-8, AC-10, AC-11

- [ ] **C.5** — User gate steps and Part 1 PR
  - **File(s):** _no file changes — PR body and external settings_
  - **Acceptance:** The Part 1 PR body lists the user steps: create a Codacy repository API token and store it as the `CODACY_PROJECT_TOKEN` Actions secret; add `Tests` to the `Protect Dev` ruleset's required checks after the first green run. The agent verifies each step on GitHub after the user reports it done, and completes the B.3 manual validation. (Amended 2026-10-23: no Codacy PR coverage gate; AC-9 retired.)
  - **Depends on:** C.4
  - **Maps to:** AC-7, AC-8

---

## Part 2 — Targeted runs and the redundancy report

### Sprint Cohort B — Tests · RED

- [ ] **B.4 [P]** — Failing tests for test selection (moved to Part 1, 2026-10-23)
  - **File(s):** `tests/unit/test-changed.test.js` (new)
  - **Amended 2026-10-23 (D-18):** also asserts that docs and config paths (`*.md`, `docs/`, `.context/`, `.claude/`, `.agents/`, `.github/` other than `tests.yml`, `playground/`) select nothing, that a changed path a unit test or its helper names selects that unit file, and that the plan serializes to JSON (`full`, `core`, `unit`, reasons) for CI.
  - **Acceptance:** With an inline test map and inline diffs, the tests assert: a changed line inside a mapped function selects exactly the tests that executed it (AC-13); a changed spec file selects that whole file (AC-14); a changed unit file, or a `js/` file a unit file reads by path, selects those unit files (AC-15); a changed line outside every function, or an unmapped file (`index.html`, `css/styles.css`, a helper, `playwright.config.js`), selects the full core suite and names the file (AC-16, approach D-7); a missing map selects the full suite and prints the `npm run test:map` command (AC-17); a map SHA that is not an ancestor of the merge base yields a stale warning (AC-18); the printed plan lists each selected test with the changed file that selected it (AC-19); untracked files are included (AC-12). All fail because the script does not exist.
  - **Depends on:** C.2
  - **Maps to:** AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19

- [ ] **B.5 [P]** — Failing tests for the redundancy report
  - **File(s):** `tests/unit/test-redundancy.test.js` (new)
  - **Acceptance:** With an inline block file for three tests in one spec (one unique, one a subset of another), the tests assert per-spec unique coverage, the subset pair, a ranked candidate list with zero-unique tests first, valid JSON output, and Markdown that states equal coverage does not prove equal assertions. All fail because the script does not exist.
  - **Depends on:** C.2
  - **Maps to:** AC-21, AC-22

### Sprint Cohort C — Implementation · GREEN (sequential)

- [ ] **C.6** — `test:changed` (moved to Part 1, 2026-10-23; adds `--plan-only` and `--json <path>` for CI)
  - **File(s):** `devops/testing/test-changed.mjs` (new), `package.json`
  - **Acceptance:** `npm run test:changed` diffs against the map commit plus untracked files (approach D-6), prints the plan, runs selected Playwright tests by `file:line` and selected unit files, and supports `--fetch` to download the latest `dev` map artifact with `gh run download` (approach D-5). All B.4 cases pass.
  - **Depends on:** B.4
  - **Maps to:** AC-12 to AC-19

- [ ] **C.7** — Redundancy report
  - **File(s):** `devops/testing/test-redundancy.mjs` (new), `package.json`
  - **Acceptance:** `npm run test:redundancy` reads the block file and writes `coverage/redundancy.json` and `coverage/redundancy.md`. All B.5 cases pass.
  - **Depends on:** B.5, C.6
  - **Maps to:** AC-21, AC-22

- [ ] **C.8** — Measure the targeted run (moved to Part 1, 2026-10-23; results go in the Part 1 PR body)
  - **File(s):** _no file changes — measurement only_
  - **Acceptance:** On the reference machine, with a fresh map, a one-line change inside a function in one `js/` file runs through `npm run test:changed` in 60 s or less; three such files (one hot, one mid, one cold by test count) are measured and listed in the Part 2 PR body.
  - **Depends on:** C.6
  - **Maps to:** AC-20

---

## Part 3 — Archive removal, map retirement, docs and the template

### Sprint Cohort B — Tests · RED

- [ ] **B.6** — Test justification: deletions and policy text
  - **File(s):** _no file changes — review anchor only_
  - **Acceptance:** Documented below.
  - **Justification:** These tasks delete files and edit docs and templates; no runtime behavior changes.
  - **Manual validation:** `git grep -n "playwright/archive\|test:legacy\|test:offline\|coverage-map"` returns no hit outside `CHANGELOG.md` and `docs/specs/archive/`; `npm run` lists no `test:legacy` or `test:offline`; `diff` of both deployed template copies against the master is empty; `npx agentlinter --local` passes.
  - **Maps to:** AC-27 to AC-34

### Sprint Cohort C — Implementation · GREEN (sequential)

- [ ] **C.9** — Delete the archive and the hand-kept map
  - **File(s):** `tests/playwright/archive/` (delete), `tests/playwright/coverage-map.csv` (delete), `tests/playwright/consolidation-audit.md` (delete), `package.json`, `.codacy/codacy.config.json`
  - **Acceptance:** The three paths are gone; `test:legacy` and `test:offline` are removed from `package.json` (approach D-15); the Codacy mirror is regenerated with `codacy-analysis init --remote` and lists no archive file. Core and unit counts are unchanged.
  - **Depends on:** B.6
  - **Maps to:** AC-27, AC-28, AC-29, AC-34

- [ ] **C.10** — Policy and docs
  - **File(s):** `.context/testing.md`, `.context/review-and-ci.md`, `.context/coding-standards.md`, `.context/deep-dives/playwright-suite-rationalization.md`, `AGENTS.md`, `CLAUDE.md`, `.github/skills/code-review/SKILL.md`, `tests/playwright/core/retail-market.spec.js`
  - **Acceptance:** `testing.md` states "extend an existing test before adding one", the `test:changed` and `test:map` workflow, and the `Tests` check plus the Codacy coverage gate; the coverage-map and archive rules are gone from every listed file; `CLAUDE.md` and `review-and-ci.md` name the `dev` required checks as the ruleset holds them; the `retail-market.spec.js` comment no longer points at the coverage map. B.6 manual validation passes.
  - **Depends on:** C.9
  - **Maps to:** AC-28, AC-33, AC-34

- [ ] **C.11** — Template change in the master and the deployed copies
  - **File(s):** `Devops/skill-library/skills/spec/references/templates/tasks-template.md` (Devops repo, commit to `main`), `.claude/skills/spec/references/templates/tasks-template.md`, `.agents/skills/spec/references/templates/tasks-template.md`
  - **Acceptance:** The master B.1 acceptance tells the RED task to search for an existing test of the same behavior and extend it before adding one (AC-30); a new Standard Closing Task after the full test run folds each new test into its domain suite, or justifies it by unique coverage or a new assertion, and records the net test-count delta (AC-31); `skills-deploy` refreshes both StakTrakr copies, byte-identical to the master (AC-32).
  - **Depends on:** C.10
  - **Maps to:** AC-30, AC-31, AC-32

---

## Part 4 — Consolidation to the 3-minute target

### Sprint Cohort B — Tests · RED

- [ ] **B.7** — Test justification: consolidation keeps behavior
  - **File(s):** _no file changes — review anchor only_
  - **Acceptance:** Documented below.
  - **Justification:** Consolidation rewrites tests, not app code; there is no new behavior to make red. The proof is coverage that does not drop and an assertion-by-assertion merge plan.
  - **Manual validation:** Each consolidation PR body holds the merge plan (each old test → the test or table row that replaces it, and why) built from `npm run test:redundancy`; the Codacy gate passes against the `dev` baseline.
  - **Maps to:** AC-23, AC-24, AC-25, AC-26

### Sprint Cohort C — Implementation · GREEN (sequential, one PR per domain)

- [ ] **C.12** — Consolidate Collections
  - **File(s):** `tests/playwright/core/collections.spec.js`, `tests/playwright/core/collections-data-paths.spec.js`, `tests/unit/*.test.js`
  - **Acceptance:** Logic-only checks move to unit tests (through the C.3 harness) or one table-driven `page.evaluate` test per behavior group (approach D-14); each table row carries a message naming its case; the domain is green; the Codacy gate passes (AC-24); the PR body records domain test count and time before and after.
  - **Depends on:** C.11, B.7
  - **Maps to:** AC-24, AC-25

- [ ] **C.13** — Consolidate inventory math and CRUD
  - **File(s):** `tests/playwright/core/inventory-math.spec.js`, `tests/playwright/core/inventory-crud.spec.js`, `tests/unit/*.test.js`
  - **Acceptance:** As C.12 for these two files.
  - **Depends on:** C.12
  - **Maps to:** AC-24, AC-25

- [ ] **C.14** — Merge the issue-prefixed specs into their domains
  - **File(s):** `tests/playwright/core/*.spec.js` (the eight `strk-NNN-*.spec.js` files and their target domain specs)
  - **Acceptance:** No `strk-NNN-*.spec.js` remains in `core/` (AC-26); each merged case is reshaped per D-14 where it is logic-only; the Codacy gate passes.
  - **Depends on:** C.13
  - **Maps to:** AC-24, AC-25, AC-26

- [ ] **C.15** — Consolidate the remaining domains by measured cost
  - **File(s):** `tests/playwright/core/*.spec.js`, `tests/unit/*.test.js`
  - **Acceptance:** Domains are taken in order of total time from the latest JSON report (image-frame-editor, details-modal, import-export, item-price-history-cloud, then the rest) until AC-23 holds; each PR meets the C.12 acceptance.
  - **Depends on:** C.14
  - **Maps to:** AC-24, AC-25

- [ ] **C.16** — Confirm the full-suite target
  - **File(s):** _no file changes — measurement only_
  - **Acceptance:** Three consecutive full core runs on the reference machine at default workers are green and each finishes in 3 minutes or less (AC-23); the counts and times go in the final PR body.
  - **Depends on:** C.15
  - **Maps to:** AC-23

---

## Standard Closing Tasks

- [ ] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run `npm test` (core Playwright PR gate) and `npm run test:unit`, then `npm run test:extended`. All pass with counts matching the final inventory.
  - If anything fails: fix the implementation, not the test. Tests are the spec — a failing test means the implementation is wrong, not the test.

- [ ] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-analysis-cli` skill against changed files (`codacy-analysis analyze --diff`). Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.

- [ ] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1 to AC-34), write exactly one line in one of these formats:
    - `- [x] AC-N — verified at <relative/file/path>:<line>`, OR
    - `- [x] AC-N — verified by <test name>`, OR
    - `- [ ] AC-N — gap: <one-line reason>`.
  - The stamp block MUST list every AC from requirements.md. Status-only notes ("PR opened", "tests passing") are not equivalent — the gate requires per-AC traceability.
  - **UI verification requirement:** N/A — `approach.md` has no UI surface.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [ ] **CLOSE-4. Version bump**
  - N/A — no part changes a release-bearing file (tests, CI, tooling and docs only); the no-bump campaign rule in `.context/spec-conventions.md` applies. `/release patch` is not invoked.

- [ ] **CLOSE-5. Vault update + close issue**
  - **MUST invoke `/vault-update`** as a skill. This repo keeps project docs in `.context/` (updated in C.10); the skill audits the shared vault for cross-project testing references.
  - Mark STRK-419 Done in Plane: `mcp__plane__workitem` (`action: "update"`) to state "Done"; cross-link STRK-460 and STRK-461.

- [ ] **CLOSE-6. Open PR**
  - Each part opens its own PR from its `chore/strk-419-<part>` branch to `dev`. Title: `chore(STRK-419): <short summary>`.
  - Body must include: link to STRK-419, link to `docs/specs/STRK-419-test-suite-loop/`, test plan checklist, test inventory delta (`+N -M tests, +X -Y files`).

- [ ] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill on each part's PR.
  - Coverage: the resolver MUST scan **both** inline diff threads AND review-body findings.
  - All Critical/High findings must be either fixed or marked false-positive with explicit reasoning. Medium: fix or document waiver. Low/Info: advisory.
  - After running `/pr-resolve`, check whether new threads appeared from auto-scanners and address those before merge.

- [ ] **CLOSE-8. Archive spec** (after the last PR merges)
  - **MUST invoke `/spec archive STRK-419`** as a skill.

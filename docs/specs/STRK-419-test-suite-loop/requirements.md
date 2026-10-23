---
spec: "STRK-419-test-suite-loop"
phase: requirements
created: 2026-10-22
---

# STRK-419 — Requirements

> **Source Issue:** [STRK-419](https://plane.lbruton.cc/lbruton/browse/STRK-419/)
> Test suite consolidation loop: per-test coverage, Codacy coverage, and a recurring
> fold-in/sweep cycle. The issue body proposes five phases: instrumentation, Codacy upload,
> a redundancy report, a first consolidation pass, and a loop (fold-in closing task,
> "extend before add", `/test-sweep`, ledger).
>
> **Revised scope (2026-10-22):** coverage-driven targeted runs (`test:changed`), Playwright
> with coverage in CI plus the Codacy upload, consolidation to cut app boots, archive
> deletion, and the tasks-template change. `/test-sweep` and the ledger are out (see
> Non-Goals). STRK-460 (PR 1621: parallel workers, boot-wait fixture, race fixes) is a
> prerequisite and lands first.

## Overview

The core Playwright suite is the only regression check, and it runs only on the developer
machine. It holds 1,021 tests. Each test boots the full app, which costs about 0.35 s and
does not get cheaper. After STRK-460 a full run takes about 4.5 minutes on the reference
machine, and every change waits for it. The suite keeps growing because the spec template
asks for at least one new test per acceptance criterion, and nothing folds those tests
back in. This spec makes a small change cost a small run, puts the full suite and its
coverage in CI as a required gate, cuts the number of boots, and changes the template so
the suite stops regrowing.

**Reference machine:** the developer Mac (10 cores, 4 performance cores), default worker
count from `playwright.config.js`.

## User Stories

- **US-1:** As the developer, I want to run only the tests that a change can affect, so
  that a minor change gives me an answer in about a minute.
- **US-2:** As the developer, I want every PR to `dev` to run the full suite and report
  coverage in CI, so that a change cannot merge if it breaks a test or drops coverage.
- **US-3:** As the developer, I want the full core suite to finish in 3 minutes, so that a
  full local run before a PR is practical.
- **US-4:** As the developer, I want a report of tests that add no unique coverage, so that
  consolidation removes tests by evidence, not by guess.
- **US-5:** As a spec author in any project, I want the spec template to extend existing
  tests before it adds new ones, so that each spec does not leave a pile of one-off tests.
- **US-6:** As the developer, I want the archived acceptance-matrix tests gone, so that the
  repo holds only tests that run.

## Acceptance Criteria

### Coverage collection (US-2, US-1, US-4)

- **AC-1:** WHEN the core Playwright suite runs with `COVERAGE=1`, the test runner SHALL
  write a merged lcov report for the `js/` files.
- **AC-2:** WHEN the core Playwright suite runs with `COVERAGE=1`, the test runner SHALL
  write a per-test coverage record that maps each test (spec file and title) to the `js/`
  functions it executed.
- **AC-3:** WHILE `COVERAGE` is unset, the test runner SHALL NOT collect coverage.
- **AC-4:** WHEN `npm run test:unit` runs with `COVERAGE=1`, the unit runner SHALL write an
  lcov report for the unit suite.

### CI gate and Codacy (US-2)

- **AC-5:** WHEN a PR targets `dev`, CI SHALL run the unit suite and the full core
  Playwright suite with coverage on.
- **AC-6:** WHEN a commit lands on `dev`, CI SHALL run the same job, so that Codacy holds a
  coverage baseline for `dev`.
- **AC-7:** WHEN the CI job finishes, CI SHALL upload the Playwright and unit lcov reports
  to Codacy with the `CODACY_PROJECT_TOKEN` repository secret.
- **AC-8:** IF any test in the CI job fails, THEN the CI check SHALL fail, and the `dev`
  ruleset SHALL block the merge.
- **AC-9:** IF a PR lowers total coverage below the `dev` baseline, THEN the Codacy quality
  gate SHALL fail the PR.
- **AC-10:** IF the `CODACY_PROJECT_TOKEN` secret is missing, THEN the CI job SHALL still
  run the tests and SHALL report that the upload was skipped.
- **AC-11:** The CI job SHALL finish in 10 minutes or less wall time.

### Targeted runs (US-1)

- **AC-12:** WHEN the developer runs `npm run test:changed`, the runner SHALL select tests
  from the files changed against the merge base with `origin/dev`, including uncommitted
  and untracked changes.
- **AC-13:** WHEN a changed file is a `js/` file in the coverage map, the runner SHALL
  select every test whose coverage record executed a function in a changed line range.
- **AC-14:** WHEN a changed file is a Playwright spec, the runner SHALL select that whole
  spec file.
- **AC-15:** WHEN a changed file is a unit test or a `js/` file that a unit test loads, the
  runner SHALL run those unit tests.
- **AC-16:** IF a changed file is not in the coverage map (for example `index.html`,
  `css/styles.css`, a test helper or `playwright.config.js`), THEN the runner SHALL run the
  full core suite and SHALL name the file that caused it.
- **AC-17:** IF the coverage map is missing, THEN the runner SHALL run the full core suite
  and SHALL print the command that builds the map.
- **AC-18:** IF the coverage map was built from a commit that is not an ancestor of the
  current merge base with `origin/dev`, THEN the runner SHALL warn that the map is stale.
- **AC-19:** The runner SHALL print, before it runs, the selected tests and the changed
  file that selected each one.
- **AC-20:** WHEN the change touches one `js/` file in the coverage map, `test:changed`
  SHALL finish in 60 seconds or less on the reference machine.

### Redundancy report (US-4)

- **AC-21:** WHEN the developer runs the redundancy report against a per-test coverage
  record, the report SHALL list, per spec file, each test's unique coverage and the tests
  whose coverage is a subset of another test's.
- **AC-22:** The redundancy report SHALL write JSON and Markdown, and the Markdown SHALL
  state that equal coverage does not prove equal assertions.

### Consolidation (US-3)

- **AC-23:** WHEN consolidation is complete, the full core suite SHALL finish in 3 minutes
  or less on the reference machine.
- **AC-24:** WHEN a consolidation PR merges, the Codacy coverage for `js/` SHALL be equal to
  or higher than the `dev` baseline before that PR.
- **AC-25:** WHERE a core Playwright test checks only computed values with no DOM, layout or
  interaction assertion, the test SHALL move to the unit suite or merge into a table-driven
  browser test that boots once.
- **AC-26:** The core suite SHALL contain no spec file named with an issue prefix
  (`strk-NNN-*.spec.js`); each such file SHALL merge into its domain spec.

### Archive removal (US-6)

- **AC-27:** The repo SHALL NOT contain `tests/playwright/archive/`.
- **AC-28:** `package.json` SHALL NOT define `test:legacy`, and no doc under `.context/`,
  `AGENTS.md` or `CLAUDE.md` SHALL refer to it or to the archive path.
- **AC-29:** `npm run test:offline` SHALL either select only non-archive tests or SHALL be
  removed with its doc references.

### Spec template and policy (US-5)

- **AC-30:** The tasks template master in `Devops/skill-library` SHALL tell the RED-phase
  task to extend an existing test of the same behavior before it adds a new test.
- **AC-31:** The tasks template master SHALL include a closing task, after the full test
  run, that folds each new test into its domain suite or justifies it by unique coverage
  or a new assertion, and records the net test-count delta.
- **AC-32:** WHEN the template change ships, the deployed copies in this repo
  (`.claude/skills/spec/` and `.agents/skills/spec/`) SHALL match the master.
- **AC-33:** `.context/testing.md` SHALL state the "extend before add" rule, the
  `test:changed` workflow and the coverage gate.
- **AC-34:** WHERE the generated coverage map records which tests cover each `js/` file,
  `tests/playwright/coverage-map.csv` and the rule that requires editing it SHALL be
  removed.

## Non-Goals

- No `/test-sweep` skill and no sweep ledger. The CI coverage gate and the closing fold-in
  task keep the suite in check per PR; a periodic sweep can follow if growth returns.
- No mutation testing (Stryker). Per-test coverage is the redundancy signal.
- No Firefox or WebKit projects. Coverage collection is Chromium-only.
- No change to app boot cost (script count, lazy loading). That is runtime work with its
  own issue if wanted.
- No fix for STRK-461 (reduced-motion transitions). It is a separate runtime patch.
- No consolidation of the extended suite (`tests/playwright/extended/`) beyond what the
  archive removal and the coverage map require.
- No coverage percentage target. The gate is "does not drop", from the first `dev`
  baseline.

## Open Questions

- [x] Template change scope: global master in `Devops/skill-library` (decided 2026-10-22).
- [x] CI strictness: required check on `dev`, full core suite (decided 2026-10-22).
- [x] Archive: delete; git history keeps the files (decided 2026-10-22).
- [x] Targets: 60 s targeted, 3 min full core (decided 2026-10-22).
- [x] Coverage gate threshold: "does not drop" against the `dev` baseline (issue body).

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is
> empty. Then advance: `/spec-discovery STRK-419`.

---
issue: STRK-97
slug: playwright-core-consolidation
phase: tasks
created: 2026-05-25
approved:
---

# Tasks - STRK-97 Playwright Core Consolidation

## Sprint Cohort 0 - Setup

- [x] Create StakTrakr patch worktree and claim version lock.
  - Files: `devops/version.lock`, `.worktrees/patch-3.34.92/`
  - Acceptance: work happens on branch `patch/3.34.92`, not `dev`.

## Sprint Cohort 1 - Tier Structure and Commands

- [x] Add Playwright tier commands.
  - Files: `package.json`, `package-lock.json`
  - Acceptance: `npm test` delegates to `npm run test:core`; `test:core`, `test:extended`, `test:legacy`,
    and `test:all` exist.
- [x] Add the empty tier directories.
  - Files: `tests/playwright/core/`, `tests/playwright/extended/.gitkeep`,
    `tests/playwright/archive/issue-ac-matrices/`
  - Acceptance: the tier paths exist and are addressable by scripts.

## Sprint Cohort 2 - Coverage Map and Core Replacement

- [x] Add coverage map for the live 67-file suite.
  - Files: `tests/playwright/coverage-map.csv`
  - Acceptance: each file has test count, domain, risk class, decision, replacement target, and rationale.
- [x] Add compact core replacements for the first issue-prefixed cluster.
  - Files: `tests/playwright/core/inventory-crud.spec.js`,
    `tests/playwright/core/settings-api.spec.js`,
    `tests/playwright/core/settings-search-images.spec.js`
  - Acceptance: durable settings/API, settings search/images, and required inventory field behavior is covered.

## Sprint Cohort 3 - Archive Historical Specs

- [x] Move the selected issue-prefixed specs into archive.
  - Files: `tests/playwright/archive/issue-ac-matrices/*.spec.js`
  - Acceptance: no selected issue-prefixed spec remains in the Playwright root or `retail/`.
- [x] Repair archived helper import paths.
  - Files: `tests/playwright/archive/issue-ac-matrices/*.spec.js`
  - Acceptance: `npm run test:legacy -- --list --reporter=list` discovers 83 tests in 7 files.

## Sprint Cohort 4 - Release Metadata

- [x] Bump release artifacts for v3.34.92.
  - Files: `js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `CHANGELOG.md`, `js/about.js`
  - Acceptance: release metadata is synchronized for STRK-97.

## Sprint Cohort 5 - Verification

- [x] Run `npm run test:core -- --reporter=list`.
  - Acceptance: 8 passed.
- [x] Run `npm test`.
  - Acceptance: default gate runs the 8-test core suite and passes.
- [x] Run `npm run test:legacy -- --reporter=list`.
  - Acceptance: 83 archived issue-matrix tests pass.
- [x] Run `npm run test:all`.
  - Acceptance: unit, core, and empty extended tiers pass.
- [x] Run `npm run lint`.
  - Acceptance: no errors; only existing eslint-disable warnings remain.

## Standard Closing Tasks

- [x] `/release patch`
  - Acceptance: N/A - version artifacts were updated directly for this patch worktree.
- [x] `/vault-update`
  - Acceptance: N/A - this sketch is the DocVault tracking artifact.
- [x] `codacy-cli`
  - Acceptance: run before PR if the branch is being published from this session.
- [x] `/pr-resolve`
  - Acceptance: run after PR review threads or checks exist.
- [ ] `/sketch archive`
  - Acceptance: run only after the PR merges and STRK-97 is closed.

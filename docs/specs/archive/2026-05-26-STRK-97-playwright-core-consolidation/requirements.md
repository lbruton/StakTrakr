---
issue: STRK-97
slug: playwright-core-consolidation
phase: requirements
created: 2026-05-25
---

# Requirements - STRK-97 Playwright Core Consolidation

## Source Issue

STRK-97: Consolidate to ~100 core tests - build core/, map issue-prefixed specs to domain suites.

Parent: STRK-94. This follows STRK-95 mock migration and STRK-96 failing-suite repair.

## Goal

Establish the first safe slice of StakTrakr's Playwright tier model without trying to finish the
entire 767-test cleanup in one PR.

## User Stories

- As a maintainer, I want `npm test` to run a small core Playwright gate so normal PR validation is fast.
- As a maintainer, I want old issue acceptance matrices archived rather than deleted so a future regression can
  pull a historical assertion back.
- As a reviewer, I want a coverage map explaining each test file's intended tier and rationale.
- As a future contributor, I want issue-prefixed specs to move toward domain suites instead of continuing to
  accumulate in the Playwright root.

## Acceptance Criteria

- Given the current suite, when the cleanup lands, then `tests/playwright/core/`,
  `tests/playwright/extended/`, and `tests/playwright/archive/issue-ac-matrices/` exist.
- Given the default test command, when `npm test` runs, then it executes `npm run test:core`.
- Given archived historical specs, when `npm run test:legacy` runs, then it targets
  `tests/playwright/archive/`.
- Given the first issue-prefixed cluster, when the PR is reviewed, then those original files live under
  `tests/playwright/archive/issue-ac-matrices/`.
- Given durable behavior from that cluster, when the core suite runs, then compact domain coverage exists for
  settings/API, settings search/images, and required inventory fields.
- Given future cleanup work, when planning the next slice, then `tests/playwright/coverage-map.csv` documents
  file counts, risk class, decision, replacement target, and rationale.

## Non-Goals

- Do not delete archived tests in STRK-97.
- Do not finish the whole ~100-test target in this PR.
- Do not change app runtime behavior.
- Do not move every non-issue test into core or extended yet.

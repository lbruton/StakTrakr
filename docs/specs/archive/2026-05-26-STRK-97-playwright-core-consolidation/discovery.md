---
issue: STRK-97
slug: playwright-core-consolidation
phase: discovery
created: 2026-05-25
---

# Discovery - STRK-97 Playwright Core Consolidation

## Live Baseline

- `npx playwright test --list` reported 767 tests in 67 files before implementation.
- The May 21 deep dive recorded 703 tests in 61 files, so counts were stale and had to be refreshed.
- `tests/playwright/core/`, `tests/playwright/extended/`, and `tests/playwright/archive/` did not exist.
- `package.json` still had `npm test` mapped to the full Playwright suite.

## Relevant Policy

- `Foundation/coding-standards.md` already defines the tier model:
  - core: `tests/playwright/core/`
  - extended: `tests/playwright/extended/`
  - archive: `tests/playwright/archive/`
- The same policy defines a two-step archive workflow: move old issue matrices to
  `tests/playwright/archive/issue-ac-matrices/` first, delete only in a later PR after one release.
- The Playwright Suite Rationalization deep dive recommends a risk-based core suite plus unit/extended/archive tiers.

## First Cluster

Issue-prefixed specs selected for the pilot:

- `stak-437-search-tab-removal.spec.js`
- `stak-439-images-tab-redesign.spec.js`
- `stak-443-api-tab.spec.js`
- `stak-573-api-tab-qa.spec.js`
- `stak-580-required-metal-type.spec.js`
- `strk-89-gold-api.spec.js`
- `retail/stak-582-market-survivors.spec.js`

Together they accounted for 83 historical tests. Their durable behavior maps mainly to settings/API,
settings search/images, inventory CRUD validation, and retail-market follow-up work.

## Constraints

- Keep archived specs runnable through `test:legacy`.
- Preserve helper imports after moving files deeper under `archive/issue-ac-matrices/`.
- Keep `extended/` present even if empty so scripts and future cleanup have a stable target.
- Treat existing unrelated DocVault changes as out of scope.

## Open Follow-Ups

- Build the remaining target domain suites: smoke, inventory math, disposition, valuation, import/export,
  retail-market, numista-catalog, attachments-cloud, and mobile/layout.
- Extract `config-validation.spec.js` into a Node/unit layer.
- Decide when archived issue matrices are safe to delete after a release.

---
issue: STRK-97
slug: playwright-core-consolidation
phase: approach
created: 2026-05-25
---

# Approach - STRK-97 Playwright Core Consolidation

## Strategy

Implement STRK-97 as a pilot slice. The PR establishes the tier structure and default command contract,
then archives one obvious issue-prefixed cluster while replacing its durable product coverage with compact
core tests. It intentionally leaves the rest of the suite in place for later domain-by-domain passes.

## Key Decisions

- Use `tests/playwright/archive/issue-ac-matrices/` for old tests because StakTrakr's coding standards
  already define that rollback path.
- Make `npm test` call `npm run test:core` now, even though the core suite is intentionally small, so the
  default gate starts matching the documented policy.
- Keep `npm run test:legacy` available so archived specs can still be run when investigating regressions.
- Add a CSV coverage map rather than a prose-only list because future cleanup needs sortable decisions.
- Keep the first core coverage compact and risk-focused; do not copy old acceptance matrices verbatim.

## File Map

New:

- `tests/playwright/core/inventory-crud.spec.js`
- `tests/playwright/core/settings-api.spec.js`
- `tests/playwright/core/settings-search-images.spec.js`
- `tests/playwright/coverage-map.csv`
- `tests/playwright/extended/.gitkeep`

Moved:

- `tests/playwright/archive/issue-ac-matrices/stak-437-search-tab-removal.spec.js`
- `tests/playwright/archive/issue-ac-matrices/stak-439-images-tab-redesign.spec.js`
- `tests/playwright/archive/issue-ac-matrices/stak-443-api-tab.spec.js`
- `tests/playwright/archive/issue-ac-matrices/stak-573-api-tab-qa.spec.js`
- `tests/playwright/archive/issue-ac-matrices/stak-580-required-metal-type.spec.js`
- `tests/playwright/archive/issue-ac-matrices/stak-582-market-survivors.spec.js`
- `tests/playwright/archive/issue-ac-matrices/strk-89-gold-api.spec.js`

Modified:

- `package.json`
- `package-lock.json`
- `js/constants.js`
- `version.json`
- `CHANGELOG.md`
- `js/about.js`

## Tradeoffs

- The default gate becomes very fast, but not yet representative of the full desired ~100-test core suite.
- Archived specs still exist and can run, but they no longer protect the default PR gate.
- The first core suites cover durable behavior from the migrated cluster, while retail-market consolidation is
  recorded in the coverage map for a follow-up slice.

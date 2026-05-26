# Playwright Consolidation Audit

Issue: STRK-122
Date: 2026-05-26
Base stack: `patch/3.34.98`

## Final Inventory

The STRK-97 through STRK-122 consolidation map covers 67 source specs and 767
source tests. After STRK-122, the active root-level Playwright spec set is empty.

| Tier                               | Files | Tests | Command                          |
| ---------------------------------- | ----: | ----: | -------------------------------- |
| Core Playwright                    |    13 |   140 | `npm test` / `npm run test:core` |
| Extended Playwright                |     3 |    10 | `npm run test:extended`          |
| Archived issue AC matrices         |    58 |   607 | `npm run test:legacy`            |
| Root-level active Playwright specs |     0 |     0 | Not used                         |

The default PR gate remains `npm test`, which delegates to
`npm run test:core`. Historical issue acceptance matrices remain available
through `npm run test:legacy`, but they are intentionally outside the default
gate.

## Decision Summary

| Coverage-map decision                             | Source tests |
| ------------------------------------------------- | -----------: |
| Consolidated into core, extended, or unit targets |          683 |
| Retained only as archive replay coverage          |           84 |
| Still marked keep/move                            |            0 |

No archive deletion happened in this closeout patch. The archive should remain
for at least one release window with no traced regressions before any deletion
proposal.

## STRK-122 Closeout Delta

| Source spec                                      | Source tests | Final decision                                                                                                               |
| ------------------------------------------------ | -----------: | ---------------------------------------------------------------------------------------------------------------------------- |
| `tests/playwright/settings-currency.spec.js`     |            7 | Consolidated into `tests/playwright/core/settings-api.spec.js`; source archived as `strk-122-settings-currency.spec.js`.     |
| `tests/playwright/settings-data-reset.spec.js`   |            2 | Consolidated into `tests/playwright/core/settings-api.spec.js`; source archived as `strk-122-settings-data-reset.spec.js`.   |
| `tests/playwright/settings-print-button.spec.js` |            5 | Consolidated into `tests/playwright/core/settings-api.spec.js`; source archived as `strk-122-settings-print-button.spec.js`. |

STRK-122 removes the last three active Playwright specs at the root of
`tests/playwright/` and replaces their durable behavior with three compact
settings API core checks.

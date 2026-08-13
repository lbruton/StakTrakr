---
title: "StakTrakr — Testing Policy"
project: StakTrakr
audience: agent
canonical: .context/testing.md
updated: "2026-08-12"
---

# Testing Policy — StakTrakr

Single authority for test-tier rules. CLAUDE.md and AGENTS.md point here; do not duplicate
these rules elsewhere. Read before editing or running any Playwright test.

## TDD Rules

- Never modify a TDD test to make it pass.
- A failing test means the implementation is wrong — fix the implementation.
- If the test itself is flawed, the spec was wrong — stop and restart the spec from Phase 1.

## Framework & Tiers

- Framework: Playwright (`@playwright/test`), configured in `playwright.config.js`.
- Default PR gate: `npm test`, which runs only `tests/playwright/core/`.
- Core browser coverage belongs under `tests/playwright/core/<domain>.spec.js`.
- Slower or edge coverage belongs under `tests/playwright/extended/`.
- Archived issue acceptance-criteria (AC) matrices belong under
  `tests/playwright/archive/issue-ac-matrices/`.
- Unit tests run via `npm run test:unit`; `npm run test:all` = unit + core + extended.
- `npm run test:offline` runs the legacy full suite with `--grep-invert @network`. **No spec
  currently carries an `@network` tag**, so the filter is a no-op and this is equivalent to a
  full run. Tag a spec `@network` if it genuinely needs live network, or the command has no
  purpose.
- **Playwright route mocks for api-health need a trailing `*`.** `fetchApiHealth` appends a
  `?_t=` cache buster (`js/api-health.js:136`), so a `page.route` pattern without the wildcard
  silently never matches and the test exercises the real endpoint.
- CI runs no Playwright gate — `npm test` is local-only. Re-run the covering spec after a
  force-push.

## File Placement & Inventory

- Before adding a Playwright file, check `tests/playwright/coverage-map.csv`.
- Add a new file only when assertions do not fit an existing domain suite.
- Do not add new issue-prefixed specs at the Playwright root.
- Reconcile temporary issue AC matrices into core/extended coverage before merge, or
  archive them.
- **Update `tests/playwright/coverage-map.csv` when a PR changes the Playwright test
  inventory.** The CSV is keyed by file (one row per spec): a new spec file adds a row;
  adding or removing cases in an existing spec updates that file's row (`test_count`).
  A missing or stale row is caught only by review, not by any local gate.
  - Exception: non-functional edits (comments, formatting, refactors) that leave the
    inventory unchanged do not require a coverage-map entry.
- Include a test inventory delta in the PR body (`+N -M tests, +X -Y files`).

## Assertions & Fixtures

- Use stable, user-visible assertions. Storage-only assertions are insufficient for
  layout, labels, visual sections, inline editing, or modal-behavior acceptance criteria.
- Keep data fixtures in `tests/fixtures/` and shared binary/image fixtures
  (e.g. `test-obverse.png`) in `tests/playwright/helpers/`.
- Custom dialogs (`showAppConfirm` etc.) are DOM modals, not native dialogs — see the
  dialog-testing pattern in `.context/implementation-gotchas.md`.
- Wait on `window.appListenersReady` before header clicks — never sleep; early clicks
  silently no-op.

## Running Locally

- Quick check: `npx playwright test tests/playwright/core/inventory-crud.spec.js`.
- If Chromium fails with the macOS Mach port sandbox error, rerun the same Playwright
  command with escalation.
- Do not pipe test output through `| tail` — it masks failures (exit 0). Redirect to a
  file and check `$?`.

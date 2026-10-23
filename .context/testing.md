---
title: "StakTrakr — Testing Policy"
project: StakTrakr
audience: agent
canonical: .context/testing.md
updated: "2026-10-22"
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
  `_t=` cache-buster query param (joined with `?` or `&` depending on the URL), so a
  `page.route` pattern without the wildcard silently never matches and the test exercises the
  real endpoint instead of the mock. Grep `fetchApiHealth` in `js/api-health.js` for the
  current form.
- `npm run test:changed` runs only the core and unit tests a change can affect, selected from
  the test map (`.cache/test-map.json`). `npm run test:changed -- --fetch` downloads the map
  from the latest `dev` run first. `npm run test:map` builds the map locally with a full
  coverage run.
- CI (`.github/workflows/tests.yml`): a PR to `dev` runs the `test:changed` selection; a push
  to `dev` runs the full unit and core suites with coverage, publishes the map and uploads lcov
  to Codacy. The `Tests` job is the single check to require.

## Parallel Runs

- `playwright.config.js` sets `fullyParallel: true` and `workers: "50%"`. Tests from one
  file run on different workers in any order.
- Every test must pass alone and in any order. A test that shares state with another
  belongs in a `test.describe.serial` block.
- Workers above the performance-core count make each test slower, not the run faster.
  `PW_WORKERS=<n>` overrides the default; use `PW_WORKERS=1` to debug an order problem.
- A test that fails only under parallel load is a race in the test or the app. Fix the
  wait; do not lower the worker count.

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
- Import `test` and `expect` from `tests/playwright/helpers/mocks/extended-test.js`. Its
  `page` fixture installs the network mocks, and its `goto`/`reload` resolve only after
  `appListenersReady`. Pass `{ waitForApp: false }` to assert on the page before boot ends.
- Boot finishes in a deferred timer after `DOMContentLoaded`. A helper that waits only for
  `typeof window.someFn === "function"` races the rest of boot.
- Poll layout and computed-style reads (`expect.poll`). A box measured before layout reads
  `0/0`, and a colour read during a theme transition holds the old value.
- Assert a whole array once (`expect(outOfRange).toEqual([])`), not one `expect()` per
  element: per-element calls cost seconds on large chart datasets.
- Hash a displayed image from its decoded pixels, not by re-fetching its `blob:` URL. The
  app revokes blob URLs when it re-renders.

## Running Locally

- Quick check: `npx playwright test tests/playwright/core/inventory-crud.spec.js`.
- A worktree with its own `npm ci` can pin a newer Playwright than the main checkout. If
  every test fails with "Executable doesn't exist", run `npx playwright install chromium`
  in that worktree.
- If Chromium fails with the macOS Mach port sandbox error, rerun the same Playwright
  command with escalation.
- Do not pipe test output through `| tail` — it masks failures (exit 0). Redirect to a
  file and check `$?`.

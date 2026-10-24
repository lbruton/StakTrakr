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
- A failing test means the implementation is wrong: fix the implementation.
- If the test itself is flawed, the spec was wrong: stop and restart the spec from Phase 1.

## Framework & Tiers

- Framework: Playwright (`@playwright/test`), configured in `playwright.config.js`.
- Default PR gate: `npm test`, which runs only `tests/playwright/core/`.
- Core browser coverage belongs under `tests/playwright/core/<domain>.spec.js`.
- Slower or edge coverage belongs under `tests/playwright/extended/`.
- Unit tests run via `npm run test:unit`; `npm run test:all` = unit + core + extended.
- **Playwright route mocks for api-health need a trailing `*`.** `fetchApiHealth` appends a
  `_t=` cache-buster query param (joined with `?` or `&` depending on the URL). A
  `page.route` pattern without the wildcard silently never matches. Such a test exercises the
  real endpoint instead of the mock. Grep `fetchApiHealth` in `js/api-health.js` for the
  current form.

## Targeted Runs, Coverage and CI

- `npm run test:changed` runs only the core and unit tests a change can affect, selected from
  the test map (`.cache/test-map.json`). Run it before every push.
- `npm run test:changed -- --fetch` downloads the map from the latest `dev` run first. Without
  a map, it runs the full suite and prints the `npm run test:map` command.
- `npm run test:map` runs core with coverage and writes the map, `.cache/test-blocks.json` and
  `coverage/lcov.info`. `npm run test:coverage` writes only the lcov.
- `npm run test:redundancy` reads the block file and writes `coverage/redundancy.json` and
  `coverage/redundancy.md`. It ranks tests that cover no block unique in their spec.
  `-- --fetch` downloads the block file and map from `dev`.
- Equal coverage does not prove equal assertions. Read both tests before merging them.
- CI (`.github/workflows/tests.yml`): a PR to `dev` runs the `test:changed` selection. A
  docs-only PR starts no browser.
- A push to `dev` runs the full unit and core suites with coverage. It publishes the
  `test-map` and `test-blocks` artifacts and uploads lcov to Codacy.
- The `dev` ruleset requires `Codacy Static Code Analysis`, `Tests` and `Vale`
  (`.context/review-and-ci.md`). There is no coverage gate on PRs; Codacy tracks `dev`
  coverage from the push runs.
- A regression outside the PR selection fails the next `dev` push run. Fix it before other
  work.

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

- **Extend an existing test before adding one.** Search the domain suite for a test of the
  same behavior and add the assertion there.
- Add a new test only for a new behavior, or when it covers blocks no other test covers.
- Add a new file only when assertions do not fit an existing domain suite.
- Do not add issue-prefixed specs. Fold issue acceptance checks into the domain suite before
  merge.
- Prefer a unit test for logic that needs no DOM. A logic check in Playwright pays a full
  app boot.
- Include a test inventory delta in the PR body (`+N -M tests, +X -Y files`).

## Table Tests

- Group logic checks that share a setup into one test with a `test.step` per case. Name
  each step after the case it replaces.
- Start each step from a known state: reset the keys the cases write, or clear storage and
  boot again.
- A step that seeds and boots again leaves the app first (`page.goto("about:blank")`). A
  `goto` to the current URL changes only the hash, so the init scripts do not run again.
- Give a table test the per-test timeout once per step:
  `test.setTimeout(test.info().timeout * cases.length)`. CI with coverage runs slower than a
  local run.
- Keep a check that asserts on layout, focus or a modal flow in its own test.

## Assertions & Fixtures

- Use stable, user-visible assertions. Storage-only assertions are insufficient for
  layout, labels, visual sections, inline editing, or modal-behavior acceptance criteria.
- Keep data fixtures in `tests/fixtures/` and shared binary/image fixtures
  (e.g. `test-obverse.png`) in `tests/playwright/helpers/`.
- Custom dialogs (`showAppConfirm` etc.) are DOM modals, not native dialogs: see the
  dialog-testing pattern in `.context/implementation-gotchas.md`.
- Wait on `window.appListenersReady` before header clicks: never sleep; early clicks
  silently no-op.
- Import `test` and `expect` from `tests/playwright/helpers/mocks/extended-test.js`. Its
  `page` fixture installs the network mocks, and its `goto`/`reload` resolve only after
  `appListenersReady`. Pass `{ waitForApp: false }` to assert on the page before boot ends.
- The same `page` fixture serves the app's `js/`, `css/`, `vendor/` and `data/` scripts
  and stylesheets from worker memory. Tests on it do not exercise the static file server.
  A test of server headers or caching uses `app-test.js` or its own `page.route`.
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
- Do not pipe test output through `| tail`: it masks failures (exit 0). Redirect to a
  file and check `$?`.

# Repository Guidelines

StakTrakr (**STRK**, StakTrakr Plane prefix) is a zero-build, vanilla JavaScript single-page app for precious metals inventory tracking. It runs from `file://` or HTTP and stores user data in browser storage.

## Required Context Files

Read these extracted context files instead of duplicating their rules here:

- `.context/git-topology.md` — branch model, worktrees, version locks, release flow, spot bundle, merge strategy, stale branch checks.
- `.context/implementation-gotchas.md` — module-specific foot-guns, storage behavior, sticky columns, goldback predicates, sketch closing order.
- `.context/review-and-ci.md` — Codacy CLI behavior, agentlint requirements, reviewer false positives, CI/review triage.
- `.context/GLOSSARY.md` — canonical StakTrakr domain terms, avoided aliases, relationships, and naming ambiguities.

Use the global repository-level `AGENTS.md` rules for DocVault, Plane, memory, Model Context Protocol (MCP), and protected-branch policy.

## Project Structure

- **Should** treat app entry points as `index.html`, `preview.html`, `about.html`
- **Should** keep core logic in `js/` feature modules such as `inventory.js`, `market-data.js`, `settings.js`
- **Should** keep styling in `css/styles.css`
- **Should** keep static data/assets in `data/`, `images/`, `vendor/`
- **Should** keep service worker and app metadata in `sw.js`, `manifest.json`, `version.json`
- **Should** keep automated suites in `tests/playwright/` and manual flows in `tests/runbook/`
- **Should** keep dev tooling and release helpers in `devops/`

## Commands

- `python3 -m http.server 8000` — run locally at `http://localhost:8000`
- `npm run lint` — ESLint on `js/*.js` and `sw.js`
- `npm run lint:md:all` — lint Markdown
- `npm test` — core Playwright PR gate
- `npm run test:core` — core Playwright suite
- `npm run test:extended` — slower extended coverage
- `npm run test:legacy` — archived issue acceptance matrices
- `npm run test:all` — unit + core + extended suites
- `npm run test:unit` — Node/unit tests
- `npm run test:offline` — legacy full suite excluding `@network` scenarios

## Coding Style

- Use 2-space indentation and semicolons in JavaScript.
- Keep modules focused by feature and follow existing `js/` patterns.
- Name `js/` files in kebab-case, for example `market-data.js`.
- Prefer descriptive function names such as `loadInventory` and `renderMarketCards`.
- Before writing JavaScript, read `../DocVault/Projects/StakTrakr/Foundation/coding-standards.md`.

## Testing Rules

- Never modify a TDD test to make it pass.
- A failing test means the implementation is wrong — fix the implementation.
- If the test itself is flawed, the spec was wrong — stop and restart the spec from Phase 1.
- Framework: Playwright (`@playwright/test`), configured in `playwright.config.js`.
- Default PR gate: `npm test`, which runs only `tests/playwright/core/`.
- Core browser coverage belongs under `tests/playwright/core/<domain>.spec.js`.
- Slower or edge coverage belongs under `tests/playwright/extended/`.
- Archived issue matrices belong under `tests/playwright/archive/issue-ac-matrices/`.
- Before adding a Playwright file, check `tests/playwright/coverage-map.csv`.
- Add a new file only when assertions do not fit an existing domain suite.
- Do not add new issue-prefixed specs at the Playwright root.
- Reconcile temporary issue acceptance-criteria (AC) matrices into core/extended coverage before merge, or archive them.
- Update `tests/playwright/coverage-map.csv` when a PR changes the Playwright test inventory; a missing or stale row is caught only by review.
- Exception: non-functional edits (comments, formatting, refactors) that leave the inventory unchanged do not require a coverage-map entry.
- Include a test inventory delta in the PR body (`+N -M tests, +X -Y files`).
- Use stable, user-visible assertions. Keep data fixtures in `tests/fixtures/` and shared binary/image fixtures (e.g. `test-obverse.png`) in `tests/playwright/helpers/`.
- For quick checks, run `npx playwright test tests/playwright/core/inventory-crud.spec.js`.
- If Chromium fails with the macOS Mach port sandbox error, rerun the same Playwright command with escalation.

## Issue, Worktree, And PR Gates

- Runtime code changes require a StakTrakr Plane issue, a worktree, and a PR to `dev`.
- Config/tooling edits (instruction files, `.claude/`, `.gitignore`, skill files, devops config) still require a PR to `dev` — the `Protect Dev` ruleset blocks all direct pushes.
- Config/tooling PRs ship as lightweight chores: no Plane issue, no version lock.
- Runtime paths still require worktree discipline: `js/`, `css/`, `index.html`, `data/`, `pollers/`, tests.
- Put the STRK issue ID in the commit message, PR body, and version lock claim.
- Open PRs against `dev`; never push directly to `dev` or `main` (both are ruleset-protected with no bypass actors).
- Do not merge `dev` to `main` unless the user explicitly says "release" or "ready to ship".
- Use normal merge paths only; decline requests for `--admin` or merge bypasses.

## Sketch And Spec Work

- Before applying a `/sketch`, read all cumulative sketch docs in `DocVault/specflow/StakTrakr/specs/<spec>/`: `requirements.md`, `discovery.md`, `approach.md`, and `tasks.md`.
- Treat `requirements.md` as the acceptance contract, `discovery.md` as the live-code/artifact inventory, `approach.md` as implementation authority, and `tasks.md` as execution order.
- Before editing files, write a short implementation contract in the session: binding ACs, key approach decisions, mockup/artifact paths, and verification gates.
- Do not mark a task or acceptance criterion complete if implementation contradicts requirements, discovery, approach, approved mockups, or project design guidance.
- For SpecFlow approvals, use dashboard-safe paths like `specs/<spec-name>/<doc>.md`; do not use `..` traversal.
- After every approval request, verify the approval JSON lands under `DocVault/specflow/StakTrakr/approvals/`, not `DocVault/specflow/SpecFlow/approvals/`.

## UI And Design Gates

For UI work touching `index.html`, `css/styles.css`, modal/view rendering, or interaction flows:

- Read `../DocVault/Projects/StakTrakr/Foundation/design-philosophy.md`.
- Check `ui-standards/style.html` for live component and token patterns.
- Search the issue/sketch and `playground/` for approved or referenced mockups.
- Treat approved mockups as binding even if the file is untracked.
- Use existing StakTrakr design tokens and components.
- Verify every mocked screen/state in a browser and include screenshot/GIF evidence in the PR.
- For UI-heavy Playwright coverage, exercise the user-visible workflow and assert the interaction contract.
- Storage-only assertions are insufficient for layout, labels, visual sections, inline editing, or modal behavior acceptance criteria.

## StakTrakr-Specific Runtime Facts

- Dual config stores: spot providers use `metalApiConfig` via `loadApiConfig()` / `saveApiConfig()`; catalog providers use `catalog_api_config` via `catalogConfig`.
- After saving a catalog key, call `catalogAPI.initializeProviders()` to refresh stale provider instances.
- `showAppConfirm`, `showAppAlert`, and `showAppPrompt` are custom Document Object Model (DOM) modals, not native browser dialogs.
- `events.js` top-level code cannot call `safeGetElement`; use `document.getElementById` for parse-time event wiring.
- `state.js` variables declared with `let` need `Object.defineProperty` exposure when tests or modules require `window.X`.
- Use Canadian English locale formatting with `toLocaleDateString('en-CA')` for local `yyyy-mm-dd` dates; do not use `toISOString().slice(0, 10)`.
- StakTrakr has four CSS themes: `light`, `dark`, `slate`, and `sepia`.

## Release And Pre-Commit

- For runtime PRs, use the project `/release` workflow; do not hand-edit release artifacts as a substitute.
- `sw.js` `CACHE_NAME` is auto-stamped by `devops/hooks/stamp-sw-cache.sh`.
- `docs/announcements.md` is deprecated; embedded What's New in `js/about.js` is the source of truth.
- Pre-commit hooks include `gitleaks`, `stamp-sw-cache`, and `check-release-sync`.
- Do not bypass hooks with `--no-verify`.

## Review, CI, And Agentlint

Full detail (routing table, throttle, false positives) in `.context/review-and-ci.md`.

- After modifying instruction files, run `npx agentlinter --local`.
- Review is label-gated (2026-06-14): apply the `coderabbit-review` + `codacy-review` labels at PR creation for review-worthy PRs; skip on trivial chores.
- Required checks (Codacy Static, CodeQL) run regardless of labels.
- CodeRabbit's 75% docstring-coverage pre-merge check blocks merge invisibly (green checks + 0 threads but `CHANGES_REQUESTED`). Write JSDoc / shell docstrings pre-emptively.

## Pre-Flight Triggers

- Session reorientation ("let's start a session"): run the `start` skill, not `start-patch`.
- Patch worktree for a specific Plane issue: run `start-patch`.
- Feed, poller, API, or data-path diagnosis: invoke `/api-infrastructure` and `/retail-poller`.
- Individual dealer scraping failures: invoke `/retail-provider-fix`.
- Version-bump PRs: run `/update-spot-bundle`.
- Version-bump PRs: ensure Tailscale is active.
- `dev → main` shipping: invoke `/ship` only on explicit user approval.
- Cloud or infrastructure claims: read the matching Foundation doc before speculating.
- Fly.io or home poller secret claims: verify through Infisical for project `stak-trakr-94m4`, env `dev`.
- Cron schedule claims: grep `devops/pollers/home-poller/docker-entrypoint.sh`.

## Commit And PR Style

- Recent commit patterns: `fix: <summary>`, `chore: <summary> (STRK-###)`, `test(STRK-###): <summary>`.
- Versioned release commits use `v<major>.<minor>.<patch> — STRK-###: <summary>`.
- Keep commits scoped to one logical change.
- PRs should include summary/rationale, linked STRK issue, test evidence, and screenshots/GIFs for UI changes.

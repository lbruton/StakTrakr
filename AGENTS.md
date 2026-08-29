# Repository Guidelines

StakTrakr (**STRK**, StakTrakr Plane prefix) is a zero-build, vanilla JavaScript single-page app for precious metals inventory tracking. It runs from `file://` or HTTP and stores user data in browser storage.

## Required Context Files

Canonical agent-facing docs live in-repo at `.context/`. Read the matching file instead of
duplicating its rules here; on any conflict with source code, code wins.

- `.context/architecture.md` — system design, frontend/API/data model, sqld schema.
- `.context/infrastructure.md` — deploy topology, Fly.io, home poller, secrets, CI/CD.
- `.context/coding-standards.md` — JS style, module boundaries, DOM/storage patterns. **Read before writing JavaScript.**
- `.context/design-philosophy.md` — brand, tokens, four-theme rules, anti-references.
- `.context/reusable-patterns.md` — vendor normalization, providers.json, retail modal, chart abstractions.
- `.context/data-pipelines.md` — spot/retail/goldback/image pipelines, cron, failure modes.
- `.context/cloud-sync.md` — Dropbox OAuth, AES-GCM encryption, rollback, backup/restore.
- `.context/cloud-sync-convergence.md` — STRK-154 sync compare/merge/hash invariant.
- `.context/testing.md` — test tiers, TDD rules, coverage-map requirement. **Read before editing or running tests.**
- `.context/issue-tracking.md` — Plane state UUIDs, epic conventions.
- `.context/git-topology.md` — branch model, worktrees, version locks, release flow, spot bundle, merge strategy, stale branch checks.
- `.context/implementation-gotchas.md` — runtime and module foot-guns (dual config store, script load order, date frames, storage behavior, sticky columns, goldback predicates, sketch closing order).
- `.context/review-and-ci.md` — Codacy CLI behavior, agentlint requirements, reviewer false positives, CI/review triage.
- `.context/sketch-conventions.md` — per-project `/sketch-*` overrides, branch naming, closing tasks.
- `.context/GLOSSARY.md` — canonical StakTrakr domain terms, avoided aliases, relationships, and naming ambiguities.
- `.context/deep-dives/` — 13 deep-dive docs (data model, DOM patterns, pollers, API reference, health checks, vendor quirks, …) for subsystem-deep work.

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
- `npm run format` / `npm run format:check` — Prettier, repo-wide.
- Prettier scope is governed by `.prettierignore` (excludes `data/`, `vendor/`, minified assets).
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
- Before writing JavaScript, read `.context/coding-standards.md`.

## Testing Rules

Full policy in `.context/testing.md` — read it before editing or running any test.
Non-negotiables:

- Never modify a TDD test to make it pass; a failing test means the implementation is wrong.
- Update `tests/playwright/coverage-map.csv` whenever a PR changes the Playwright test inventory.
- Include a test inventory delta in the PR body (`+N -M tests, +X -Y files`).

## Issue, Worktree, And PR Gates

Full rules in `.context/git-topology.md`. Non-negotiables:

- Runtime code changes (`js/`, `css/`, `index.html`, `data/`, `pollers/`, tests) require a StakTrakr Plane issue, a worktree, and a PR to `dev`.
- Config/tooling edits still require a PR to `dev` (the `Protect Dev` ruleset blocks all direct pushes) but ship as lightweight chores: no Plane issue, no version lock.
- Create worktrees with `git fetch origin dev && git worktree add .worktrees/<name> -b <branch> origin/dev` (the `EnterWorktree` tool is denied in this repo).
- Put the STRK issue ID in the commit message, PR body, and version lock claim.
- Never push directly to `dev` or `main`; use normal merge paths only and decline `--admin` or merge-bypass requests.
- Do not merge `dev` to `main` unless the user explicitly says "release" or "ready to ship".

## Sketch And Spec Work

- Before applying a `/sketch`, read all cumulative sketch docs in `DocVault/specflow/StakTrakr/specs/<spec>/`: `requirements.md`, `discovery.md`, `approach.md`, and `tasks.md`, plus `.context/sketch-conventions.md`.
- Treat `requirements.md` as the acceptance contract, `discovery.md` as the live-code/artifact inventory, `approach.md` as implementation authority, and `tasks.md` as execution order.
- Before editing files, write a short implementation contract in the session: binding ACs, key approach decisions, mockup/artifact paths, and verification gates.
- Do not mark a task or acceptance criterion complete if implementation contradicts requirements, discovery, approach, approved mockups, or project design guidance.
- For SpecFlow approvals, use dashboard-safe paths like `specs/<spec-name>/<doc>.md`; do not use `..` traversal.
- After every approval request, verify the approval JSON lands under `DocVault/specflow/StakTrakr/approvals/`, not `DocVault/specflow/SpecFlow/approvals/`.

## UI And Design Gates

For UI work touching `index.html`, `css/styles.css`, modal/view rendering, or interaction flows:

- Read `.context/design-philosophy.md`.
- Check `ui-standards/style.html` for live component and token patterns.
- Search the issue/sketch and `playground/` for approved or referenced mockups.
- Treat approved mockups as binding even if the file is untracked.
- Use existing StakTrakr design tokens and components.
- Verify every mocked screen/state in a browser and include screenshot/GIF evidence in the PR.
- For UI-heavy Playwright coverage, exercise the user-visible workflow and assert the interaction contract.
- Storage-only assertions are insufficient for layout, labels, visual sections, inline editing, or modal behavior acceptance criteria.

## Runtime Gotchas

All runtime and module foot-guns live in `.context/implementation-gotchas.md` — dual
config stores, `showAppConfirm` DOM modals, `events.js` script load order, `state.js`
window exposure, `en-CA`/UTC date frames, and the four-theme rule (`light`, `dark`,
`slate`, `sepia`). Read it before touching the code it names; do not restate its rules here.

## Release And Pre-Commit

- For runtime PRs, use the project `/release` workflow; do not hand-edit release artifacts as a substitute.
- `sw.js` `CACHE_NAME` is auto-stamped by `devops/hooks/stamp-sw-cache.sh`.
- `docs/announcements.md` is deprecated; embedded What's New in `js/about.js` is the source of truth.
- Pre-commit hooks include `gitleaks`, `stamp-sw-cache`, and `check-release-sync`.
- Do not bypass hooks with `--no-verify`.

## Review, CI, And Agentlint

Full detail (routing table, throttle, false positives) in `.context/review-and-ci.md`.

- After modifying instruction files, run `npx agentlinter --local`.
- CodeRabbit is **label-gated**: it reviews only a PR carrying the `coderabbit-review` label. Untagged, it still flags and approves but omits the full review — that is expected.
- Codacy AI is **automatic**, now running as part of the Codacy static-analysis stage.
- Copilot is **automatic** in **lite** mode.
- Codex is **dynamic** — it may or may not weigh in; its absence is not a signal.
- A skipped CodeRabbit run still posts an empty `APPROVED` review, so the reviewers list is not proof a review happened — check the review body.
- Every one of these gates is configured **outside this repo** (CodeRabbit UI, Codacy dashboard, GitHub Copilot settings, Codex cloud settings). A repo-only audit will wrongly conclude all bots are ungated.
- Required status checks differ by branch: `dev` requires **only** `Codacy Static Code Analysis`; `main` requires `Codacy Static Code Analysis` **and** `CodeRabbit`, plus a CodeQL code-scanning rule. Both branches block merges on unresolved review threads, not on approvals.
- CodeRabbit's 75% docstring-coverage pre-merge check blocks merge invisibly (green checks + 0 threads but `CHANGES_REQUESTED`). Write JSDoc / shell docstrings pre-emptively.

## Pre-Flight Triggers

- Session reorientation ("let's start a session"): run the `start` skill, not `start-patch`.
- Patch session for a specific Plane issue: run `start-patch` — it picks the issue, then hands off to `release patch` for the version lock + worktree.
- Feed, poller, API, or data-path diagnosis: invoke `/api-infrastructure` and `/retail-poller`.
- Individual dealer scraping failures: invoke `/retail-provider-fix`.
- Version-bump PRs: run `/update-spot-bundle`.
- Version-bump PRs: ensure Tailscale is active.
- `dev → main` shipping: invoke `/ship` only on explicit user approval.
- Cloud or infrastructure claims: read the matching `.context/` doc before speculating.
- Fly.io or home poller secret claims: verify through Infisical with `projectId` = UUID `319a1db5-207d-49d0-a61d-3f3e6b440ded`, env `dev`. Pass the UUID, not the slug `stak-trakr-94m4` (slug → `404 "bot lookup"`); `list-projects` is 422-broken.
- Cron schedule claims: grep `devops/pollers/home-poller/docker-entrypoint.sh`.

## Commit And PR Style

- Recent commit patterns: `fix: <summary>`, `chore: <summary> (STRK-###)`, `test(STRK-###): <summary>`.
- Versioned release commits use `v<major>.<minor>.<patch> — STRK-###: <summary>`.
- Keep commits scoped to one logical change.
- PRs should include summary/rationale, linked STRK issue, test evidence, and screenshots/GIFs for UI changes.

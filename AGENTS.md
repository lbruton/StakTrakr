# Repository Guidelines

## Project Structure & Module Organization

StakTrakr is a zero-build, vanilla JavaScript single-page app.

- App entry points: `index.html`, `preview.html`, `about.html`
- Core logic: `js/` (feature modules like `inventory.js`, `market-data.js`, `settings.js`)
- Styling: `css/styles.css`
- Static data/assets: `data/`, `images/`, `vendor/`
- Service worker and app metadata: `sw.js`, `manifest.json`, `version.json`
- Tests: `tests/playwright/` (automated), `tests/runbook/` (manual test flow docs)
- Dev tooling and release helpers: `devops/`

## Build, Test, and Development Commands

No application build step is required.

- `python3 -m http.server 8000` — run locally, then open `http://localhost:8000`
- `npm run lint` — run ESLint on `js/*.js` and `sw.js`
- `npm run lint:md:all` — lint all Markdown files
- `npm test` — run the core Playwright PR gate (`tests/playwright/core/`)
- `npm run test:core` — run the core Playwright suite explicitly
- `npm run test:extended` — run slower extended Playwright coverage (`tests/playwright/extended/`)
- `npm run test:legacy` — run archived issue acceptance matrices (`tests/playwright/archive/`)
- `npm run test:all` — run unit + core + extended suites
- `npm run test:unit` — run Node/unit tests
- `npm run test:offline` — legacy full-suite command excluding `@network` scenarios

## Coding Style & Naming Conventions

- Use 2-space indentation and semicolons in JavaScript.
- Keep modules focused by feature (follow existing `js/` patterns).
- Filenames in `js/` use kebab-case (for example `market-data.js`, `inventory-table.js`).
- Prefer descriptive function names (`loadInventory`, `renderMarketCards`) and avoid single-letter variables.
- Run `npm run lint` before committing.

## Testing Guidelines

- Framework: Playwright (`@playwright/test`), configured in `playwright.config.js`.
- Default PR gate: `npm test` delegates to `npm run test:core`.
- Do not treat it as the full historical suite.
- Put always-run browser coverage in `tests/playwright/core/<domain>.spec.js`, slower
  or edge coverage in `tests/playwright/extended/`, and archived issue matrices in
  `tests/playwright/archive/issue-ac-matrices/`.
- Before adding a new Playwright file, check `tests/playwright/coverage-map.csv`.
- Add a new file only when assertions do not fit an existing domain suite.
- Do not add new issue-prefixed specs at the Playwright root.
- Temporary issue acceptance-criteria (AC) matrices should be reconciled into
  core/extended coverage before merge.
- If reconciliation is not possible, move the matrix to archive.
- Every PR touching Playwright tests must update `tests/playwright/coverage-map.csv`.
- Include a test inventory delta in the PR body (`+N -M tests, +X -Y files`).
- Use stable, user-visible assertions and keep fixtures in `tests/fixtures/`.
- In Codex sandboxed sessions on macOS, Playwright/Chromium may fail with
  `bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)`;
  rerun the same Playwright command with sandbox escalation instead of retrying
  inside the sandbox.
- For quick local checks, run a focused file:
  - `npx playwright test tests/playwright/core/inventory-crud.spec.js`

## Commit & Pull Request Guidelines

- Use `STRK-###` (StakTrakr Plane issue identifier) for current work.
- Follow recent commit style:
  - `fix: <summary>`
  - `chore: <summary> (STRK-###)`
  - `test(STRK-###): <summary>`
  - Versioned releases: `v<major>.<minor>.<patch> — STRK-###: <summary>` (em dash `—`, not hyphen)
- Keep commits scoped to one logical change.
- PRs should include:
  - clear summary and rationale
  - linked Plane issue (`STRK-###`)
  - test evidence (`npm test`, `npm run lint`)
  - screenshots/GIFs for UI changes
- PRs target `dev`, never `main`. Never push directly to `main` — fully branch-protected (PR required).
- `dev` allows direct push for config/tooling only: instruction files (CLAUDE.md, AGENTS.md, GEMINI.md), `.claude/` config, `.gitignore`, skill files, devops config. Runtime code (`js/`, `css/`, `index.html`, `data/`, `pollers/`, tests) still requires worktree → PR → dev.
- Never use `--admin` or any bypass to merge PRs.

## Issue + Worktree Gates (hard gates)

Every **runtime code** change requires:

1. A Plane issue in the StakTrakr project with a `STRK-###` ID. The ID goes into the commit message, PR body, and version lock claim. Legacy `STAK-###` (StakTrakr pre-Plane issue identifier) references are historical only. Parent epics use the **Epic** Plane state (`0d1317b4-883f-44f0-b277-8f1f7f0388c0`); child issues use the standard states (Todo → In Progress → In Review → Done). Full state UUID table in `CLAUDE.md` under Issue Tracking.
2. A git worktree at `.worktrees/patch-<VERSION>/` on branch `patch/<VERSION>`. All edits/commits happen inside the worktree. Zero edits on `dev`.
3. A version lock claim in `devops/version.lock` (gitignored — edit directly, never commit). Format and lifecycle in the Release Workflow doc below.

Config/tooling edits (instruction files, `.claude/`, `.gitignore`, skill files, devops config) may commit directly to `dev` without a worktree or PR.

## Sketch Apply Contract

When applying a `/sketch`, the four sketch documents are cumulative and binding:

1. Read all four spec documents before coding: `<spec>/requirements.md`, `<spec>/discovery.md`, `<spec>/approach.md`, and `<spec>/tasks.md` (located in `DocVault/specflow/StakTrakr/specs/`).
2. Treat the spec's `requirements.md` as the acceptance contract, `discovery.md` as the live-code and artifact inventory, `approach.md` as the implementation authority, and `tasks.md` as the execution order.
3. Before editing files, write a short implementation contract in the session: binding ACs, key approach decisions, mockup/artifact paths, and verification gates.
4. Do not mark a task or AC complete if the implementation only satisfies `tasks.md` text while contradicting requirements, discovery, approach, approved mockups, or project design guidance.

## UI / Mockup Gates

For UI work touching `index.html`, `css/styles.css`, modal/view rendering, or interaction flows:

- Read `../DocVault/Projects/StakTrakr/Foundation/design-philosophy.md`.
- Check `ui-standards/style.html` for live component and token patterns.
- Search the issue/sketch and `playground/` for mockups. If a mockup is approved or referenced by the sketch/user, treat it as binding even if the file is untracked.
- Use existing StakTrakr design tokens and components; do not invent generic token names.
- Verify every mocked screen/state in a browser and include screenshot/GIF evidence in the PR.
- For UI-heavy Playwright coverage, tests must exercise the user-visible workflow and assert the interaction contract. Storage-only assertions are insufficient for ACs about layout, labels, visual sections, inline editing, or modal behavior.

## Release Workflow — Required on Every Code PR

**Canonical reference:** `../DocVault/Projects/StakTrakr/Foundation/coding-standards.md` from the repo root — read the Release Process section before your first release of the session.

The old `../DocVault/Projects/StakTrakr/Depreciated/Release Workflow.md` page is archived and may contain stale Linear/DocVault issue references. The DocVault folder is currently named `Depreciated`; treat it as a pre-Plane archive even though the spelling is unusual.

Every PR that ships runtime code must bump the version and update the 5 release artifacts below. The `check-release-sync` pre-commit hook fails the commit if any artifact is out of sync.

| #   | File              | What to change                                                                                                                                                     |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `js/constants.js` | `const APP_VERSION = "X.YY.ZZ"` — bump PATCH component                                                                                                             |
| 2   | `package.json`    | `"version": "X.YY.ZZ"` — match APP_VERSION                                                                                                                         |
| 3   | `version.json`    | `"version"` + `"releaseDate"` (today, ISO date)                                                                                                                    |
| 4   | `CHANGELOG.md`    | Prepend `## [X.YY.ZZ] - YYYY-MM-DD` section with `### Changed — STRK-###: <title>` and bullets                                                                     |
| 5   | `js/about.js`     | Prepend entry to `getEmbeddedWhatsNew()`: `<li><strong>vX.YY.ZZ &ndash; STRK-###: <Title></strong>: <summary></li>` — this is the in-app "What's New" announcement |

Automatic (do NOT edit manually):

- `sw.js` `CACHE_NAME` — stamped by `devops/hooks/stamp-sw-cache.sh` pre-commit hook.
- `docs/announcements.md` — deprecated per STAK-513. The embedded `getEmbeddedWhatsNew()` in `js/about.js` is the single source of truth. Do not re-sync the external file.

Version lock (`devops/version.lock`) claim lifecycle:

1. Read the file. Prune entries whose `expires_at` < now. Find the highest `version` among remaining active claims (or read `APP_VERSION` from `js/constants.js` if none).
2. Increment PATCH by 1 — that is your claimed version.
3. Append your claim (`version`, `claimed_by`, `issue`, `claimed_at`, `expires_at` — 30min TTL).
4. Create the worktree: `git worktree add .worktrees/patch-<VERSION> -b patch/<VERSION>`.
5. After PR merges, remove your claim entry. Delete file only if the array is empty.

Commit message format: `vX.YY.ZZ — STRK-###: <summary>` (em dash).

PR: `gh pr create --base dev --head patch/<VERSION> --draft --title "vX.YY.ZZ — …" --body "…"`.

## Pre-commit Hooks

Install once per clone:

```bash
pip install pre-commit  # or: pipx install pre-commit
pre-commit install
```

Configured hooks (`.pre-commit-config.yaml`):

- `gitleaks` — secret scan (blocks on leaked credentials).
- `stamp-sw-cache` — auto-stamps `sw.js` `CACHE_NAME` with the current version + build timestamp. May add `sw.js` to your commit automatically.
- `check-release-sync` — fails if `APP_VERSION` (`js/constants.js`) disagrees with `version.json`, `package.json`, a `## [<version>]` section in `CHANGELOG.md`, or a `v<version>` entry in `js/about.js` `getEmbeddedWhatsNew()`.

If `check-release-sync` fails, fix the listed artifact and re-stage. Do not pass `--no-verify`.

## Spec → Tasks → Draft PR Flow (Codex handoff)

When handed a spec at the Tasks phase, the expected flow is:

1. Read the spec at `DocVault/specflow/StakTrakr/specs/<spec-name>/` — `requirements.md`, `design.md`, `tasks.md`.
2. Verify the SpecFlow approval postcondition for every approval (see "SpecFlow Approval Guardrail" below).
3. Claim a version in `devops/version.lock` and create the worktree before editing any file.
4. Implement each task. After each task, call `mcp__specflow__log-implementation` BEFORE marking the task `[x]` in `tasks.md` — this is a hard gate.
5. Run `npm run lint` and `npm test` (or `npm run test:offline` when network is unavailable). Fix failures before committing.
6. Bump the 5 release artifacts above and commit with `vX.YY.ZZ — STRK-###: <summary>`. The pre-commit hooks must all pass.
7. Push to `patch/<VERSION>` and open a **draft** PR against `dev`. Do not mark ready — leave the PR as draft for user review.
8. Post a summary comment on the PR listing: version bumped, tasks completed, test results, any spec tasks deferred.

Do not merge. Do not mark ready. Do not delete the worktree — user does final review and ship.

## SpecFlow Approval Path Note

- In this repo, `mcp__specflow__approvals` resolves StakTrakr approval paths from:
  - `/Volumes/DATA/GitHub/DocVault/specflow/StakTrakr`
- For StakTrakr specs, use dashboard-safe workflow-root paths with no `..` segments:
  - `specs/<spec-name>/<doc>.md`
- Do **not** use:
  - `../StakTrakr/specs/<spec-name>/<doc>.md` (approval records may be created, but the dashboard approval preview rejects stored paths containing `..` and can render blank)
  - `../DocVault/specflow/StakTrakr/...` (this resolves to a non-existent nested path and shows blank approval docs in dashboard)

## SpecFlow Approval Guardrail

`mcp__specflow__approvals` currently has a known routing quirk for this repo: even when the
`filePath` is correct for StakTrakr, the approval JSON may still be written under
`DocVault/specflow/SpecFlow/approvals/...` instead of `DocVault/specflow/StakTrakr/approvals/...`.

For Codex runs in this repository:

- Always create StakTrakr spec documents under `DocVault/specflow/StakTrakr/specs/...`
- Always call `mcp__specflow__approvals` with:
  - `filePath: specs/<spec-name>/<doc>.md`
- After every approval request, immediately verify where the approval JSON was written
- Open the approval preview in the dashboard before telling the user to review it; if the preview is blank but the spec document page works, check the stored `filePath` for `..`
- Expected approval location for StakTrakr:
  - `DocVault/specflow/StakTrakr/approvals/<spec-name>/...`
- Suspicious or misrouted approval location:
  - `DocVault/specflow/SpecFlow/approvals/<spec-name>/...`
- If the approval record lands under `SpecFlow/approvals/...`, STOP and report it as a routing bug
- Do not present the approval as correctly filed for StakTrakr if the record lives under `SpecFlow/approvals/...`
- Do not continue to the next spec phase on a misrouted approval without explicit user confirmation

Approval success from the MCP tool is not sufficient in this repo. The storage location must be
checked as a postcondition.

## Perplexity MCP Usage

Perplexity MCP is available for live web research, but it is a paid service. Use it
sparingly and intentionally:

- Use Perplexity when the user explicitly asks for it, asks for web research, or needs
  current external context that local docs/source cannot answer.
- Use Perplexity during research/discovery work where citations, recent facts, product
  changes, library status, or market/news context materially affect the answer.
- Do not use Perplexity for routine repo navigation, local code questions, simple facts,
  formatting, or tasks that can be answered from DocVault, memory, source files, or standard
  local tooling.
- Prefer `perplexity_search` to find URLs and source candidates, `perplexity_ask` for quick
  cited answers, `perplexity_reason` for questions requiring step-by-step logic with web sources, and
  `perplexity_research` for deeper multi-source investigation (30s+ latency, use only for `/discover` phases).
- When Perplexity results influence an architectural choice, dependency selection, or technical
  decision, cite or summarize the relevant sources and make clear what came from live web
  research.

## Session Lessons

### Playwright Agent Concurrency Guardrail

Playwright and browser-heavy tasks open many file descriptors through Chromium,
Node, pipes, logs, and MCP/runtime streams. To avoid `Too many open files
(os error 24)` during spec or review work:

- If Chromium launch fails with the macOS Mach port permission error, treat it
  as a sandbox boundary and rerun the exact Playwright command with escalation.
- Run no more than 2 subagents in parallel when any active task runs Playwright,
  starts a browser, inspects browser output, or reviews Playwright artifacts.
- Prefer serial review after Playwright runs when the task already launched
  Chromium in the same worktree.
- Close completed subagents before starting another Playwright batch.
- On `Too many open files` (EMFILE) error: stop dispatching new agents immediately. Close all finished agents, wait for Playwright/Chromium processes to exit, then resume with batches of 2 or fewer agents.

### Stale Worktree Lock Guardrail

When working in a StakTrakr worktree, `git` operations may fail with a stale lock such as:

- `.git/worktrees/<worktree-name>/index.lock`

Treat this as a coordination artifact first, not an unknown git failure.

- Verify no active git process is still using that worktree
- If the lock is stale, remove it and continue
- Re-check `git status` immediately after clearing the lock before staging, committing, or pushing

This is expected to happen occasionally when agents hand off work or a prior git operation exits unexpectedly.

### Commit Hook PR Scope Guardrail

StakTrakr has commit hooks that can modify tracked files during commit. In particular:

- `stamp-sw-cache` may update `sw.js` automatically at commit time

For publish/PR flows in this repo:

- Expect `sw.js` to appear in the final commit even if it was not manually staged
- When a patch PR is refreshed after another PR merges, `sw.js` cache stamps may be the only conflict. Keep the active patch version's cache name, finish the merge, then let `stamp-sw-cache` restamp `CACHE_NAME` during the merge/review-fix commit.
- Always inspect `git show --stat HEAD` after commit and before opening the PR
- Do not assume the staged file list before commit exactly matches the committed PR scope

### Codacy CLI Noise Guardrail

Running Codacy CLI locally can introduce unrelated config churn, especially in:

- `.codacy/codacy.yaml`

For implementation tasks that are not explicitly about Codacy configuration:

- Treat `.codacy/codacy.yaml` changes as out of scope unless the task requires them
- Restore or exclude Codacy tool-version churn before committing application changes

### Codacy Agentlint

Codacy runs agentlint policies on instruction files (CLAUDE.md, AGENTS.md, GEMINI.md, skill files). These policies are modeled on real-world failure patterns and their intent is worth honoring:

- When agentlint flags a pattern, evaluate whether the underlying concern is valid for this project. If it is, adjust the instructions to address the concern.
- Do not weaken project-specific instructions to satisfy a generic policy. Our instructions encode hard-won lessons; agentlint policies encode general best practices. When they conflict, project instructions win — but note the tension.
- Do not reflexively dismiss every finding as a false positive. If a policy catches a genuine gap, fix it.
- Do not add the `codacy-review` label to PRs — it triggers review-loop feedback cycles with agentlint.

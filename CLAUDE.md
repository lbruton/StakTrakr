# StakTrakr

Precious metals inventory tracker (**STRK** Plane prefix). Single HTML page, vanilla JS, localStorage. Runs on `file://` and HTTP. Zero build, zero install. **DOM** = Document Object Model throughout.

## Identity

Senior engineering partner for a solo-dev precious metals tracker. Direct, opinionated, verify-before-asserting.

## Commands

```bash
npm test              # Core Playwright PR gate
npm run test:core     # Core Playwright suite
npm run test:extended # Slower/edge Playwright suite
npm run test:legacy   # Archived issue acceptance-criteria (AC) matrices
npm run test:all      # Unit + core + extended
npm run test:unit     # Node/unit tests
npm run test:offline  # Legacy full-suite command excluding @network-tagged tests
npm run lint          # ESLint
npm run format        # Prettier (js/ + css/ only — not data/, vendor/)
npm run format:check
```

## Playwright Test Tier Rules

- Before editing or running Playwright tests, read the Playwright policy reference in `AGENTS.md`.
- Archived issue acceptance-criteria (AC) matrices are located in
  `tests/playwright/archive/issue-ac-matrices/`.
- Any PR that adds, renames, or removes a Playwright spec must update `tests/playwright/coverage-map.csv` (an `AGENTS.md` requirement) — neither ESLint nor `check-release-sync` catches a missing or stale row.

## Documentation

Foundation docs at `DocVault/Projects/StakTrakr/Foundation/`. Run `/vault-drift` after architectural/infra work.

| Doc                    | What's there                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `infrastructure.md`    | Deploy topology, Fly.io, home poller, secrets, CI/CD, health thresholds                                          |
| `architecture.md`      | System design, frontend/API/data model, sqld schema                                                              |
| `coding-standards.md`  | JS style, module boundaries, DOM/storage patterns, CSS/design tokens, service worker, release, testing           |
| `design-philosophy.md` | Brand, colors, typography, component patterns, themes, anti-references                                           |
| `reusable-patterns.md` | Vendor normalization, providers.json, retail modal, chart abstractions                                           |
| `data-pipelines.md`    | Spot / retail / goldback / image pipelines — cron, thresholds, failure modes                                     |
| `cloud-sync.md`        | Dropbox OAuth, Advanced Encryption Standard with Galois/Counter Mode encryption, atomic rollback, backup/restore |

Tier 2: 11 deep-dive docs at `Foundation/Deep Dives/`. Authoritative cron/config: `devops/pollers/home-poller/docker-entrypoint.sh`, `devops/pollers/remote-poller/fly.toml`.

## Issue Tracking

Plane project: `https://plane.lbruton.cc/lbruton/projects/026dbe54-fe52-4a9f-9f1b-7edcb9bbdceb/`.
Pre-migration issues archived at `DocVault/Archive/Issues-Pre-Plane/StakTrakr/`. Create new issues via `/issue` or `mcp__plane__create_issue`.

**Plane state conventions:**

| State       | UUID (re-fetch if stale)                         | Use for                                               |
| ----------- | ------------------------------------------------ | ----------------------------------------------------- |
| Epic        | `0d1317b4-883f-44f0-b277-8f1f7f0388c0`           | Parent epic issues — appears in its own Kanban column |
| Todo        | `6f8780df-5ca8-4dc1-9951-fd96e9886647` (default) | Normal child issues not yet started                   |
| In Progress | `36cd8909-caa7-48ca-aeab-9f6cd4913740`           | Actively being worked                                 |
| In Review   | `1a90f64f-be80-42ae-aa82-dd8d3f28db88`           | Complete, awaiting review                             |
| Done        | `b6039898-c1c1-46ea-8396-1ae8b52f0692`           | Merged / closed                                       |
| Backlog     | `fc9a6f2f-7152-43ee-8f8d-95a05d9b2480`           | Parked, not yet scheduled                             |
| Cancelled   | `7645f387-5f01-4395-9f40-03d75fda6fda`           | Won't fix                                             |

When creating an epic, set state to **Epic**.
Child issues inherit the standard states: Todo → In Progress → In Review → Done.
UUIDs are convenience references. Re-fetch via `mcp__plane__list_states` if a session boundary or compaction may have introduced drift.

## Git Topology

- Branch model: `feature/* → dev → main`.
- Runtime code changes require worktree → PR → dev.
- `main` is fully protected and requires PR review.
- **Every change to `dev` goes through a PR — no exceptions.** The `Protect Dev` ruleset enforces required status checks (`Codacy Static Code Analysis`), code scanning (CodeQL), and signed commits with **no bypass actors** (`current_user_can_bypass: never`). These are ref-level gates a direct push can never satisfy, so **no file type — instruction files and AI-agent configs included — can be pushed straight to `dev`.** (Verified 2026-06-06: a docs-only push was rejected with "Required status check 'Codacy Static Code Analysis' is expected" / "Code scanning is waiting for results from CodeQL".)
- Config/tooling edits (`.claude/`, `.Codex/`, `.opencode/`, `.agents/`, `CLAUDE.md`, `AGENTS.md`, `.geminiignore`, `.gitignore`, skill files, devops config) are still **lightweight** — a small chore PR to `dev`, no Plane issue or version lock required.
- Runtime code (`js/`, `css/`, `index.html`, `data/`, `pollers/`, tests) requires the **full discipline**: Plane issue → worktree → PR to `dev`.
- **`EnterWorktree` base-ref caveat:** the harness `EnterWorktree` tool defaults to branching from `origin/main`, but PRs target `dev`. Create the worktree on `origin/dev` first (`git worktree add .claude/worktrees/<branch> -b <branch> origin/dev`) and enter it via `EnterWorktree` `path:`, or `git reset --hard origin/dev` immediately after creating — **before any edits**. Verify `git merge-base origin/dev HEAD` equals `git rev-parse origin/dev` before any PR. Full caveat in `.context/git-topology.md`.
- `devops/version.lock` is gitignored — it exists only in the main checkout, never in a worktree. Claim the version lock by writing to `<main-checkout>/devops/version.lock`, not the worktree path.
- **Full rules:** `.context/git-topology.md` — merge strategy, worktree naming, spot bundle, branch staleness, sketch overrides.

## Model Context Protocol Notes

- **Web search: Brave (default) vs Perplexity (paid, restricted)**
  - **Brave Search** (`mcp__brave-search__*`) — monthly plan, use for all general web searches, fact-checking, URL lookups, and ad-hoc queries.
  - **Perplexity** (`mcp__perplexity__*`) — pay-per-query API, restrict to:
    1. `/discover` research phases (deep investigation before spec work)
    2. Explicit user request ("use perplexity", "research this deeply")
  - Use Brave for routine lookups that Brave can handle. Tool ladder by cost: `perplexity_search` (ranked results) → `perplexity_ask` (quick AI answer) → `perplexity_reason` (chain-of-thought) → `perplexity_research` (deep multi-source, 30s+).
  - Pass `strip_thinking: true` on `perplexity_research`/`perplexity_reason` to save context tokens.
- StakTrakrApi config (Fly.io `fly.toml`) lives in the StakTrakrApi repo — use `mcp__github__*` to access it.
- `/codex:rescue` is disabled; see global CLAUDE.md Peer Review.
- Code-search hint: the project uses script-tag globals.
- When claude-context returns thin results for a global, fall back to Code Graph Context structural query before Grep.
- When calling `mcp__specflow__approvals` with `action: "request"`, set `filePath` relative to the specflow workflow root.
- Example: `specs/<issue>-foo/requirements.md`.
- Do not use a project-root path with `../DocVault/...` traversal; the dashboard content endpoint rejects paths containing `..`.

## Skills

| Skill                             | Use When                                                            |
| --------------------------------- | ------------------------------------------------------------------- |
| `/api-infrastructure`             | Feed / poller / API / data-path work                                |
| `/update-spot-bundle`             | Rebuild `data/spot-history-bundle.js` — run before every release PR |
| `/ship`                           | Ship `dev → main` (only on explicit "ready to ship")                |
| `/retail-poller`                  | Retail pipeline — scraping, confidence, providers.json              |
| `/retail-provider-fix`            | Diagnose scraping failures for individual dealers                   |
| `/deploy-verify`                  | Post-deploy health (Portainer home + Fly.io cloud)                  |
| `/faq`                            | In-app FAQ entries                                                  |
| `/finishing-a-development-branch` | Implementation complete — merge/PR/cleanup                          |
| `/pr-ready`                       | Pre-PR checklist                                                    |
| `/release`                        | Version bump (project override of global `/release`)                |
| `/start-patch`                    | Pick Plane issue, claim version lock, create worktree               |
| `/ui-mockup`                      | New multi-element UI — Playground prototype first                   |

**Skill authoring:** filename must be `SKILL.md` (`.gitignore` silently excludes other `.md` names).

**Skill copies:** every `.claude/skills/<name>/SKILL.md` has a tracked twin under `.agents/skills/<name>/SKILL.md`. When fixing a skill doc, `git grep` the sibling and apply the identical fix to both — Copilot flags stale twins.

## Required Context

### Dual Config Store — CRITICAL

Two separate localStorage stores. Confusing them = silent data loss.

| Store             | Key                  | Manages                                                       | Read                                                   | Write                                                  |
| ----------------- | -------------------- | ------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Spot providers    | `metalApiConfig`     | METALS_DEV, METALS_API, METAL_PRICE_API, CUSTOM               | `loadApiConfig()`                                      | `saveApiConfig()`                                      |
| Catalog providers | `catalog_api_config` | Numista apiKey, Professional Coin Grading Service bearerToken | `catalogConfig.getNumistaConfig()` / `getPcgsConfig()` | `catalogConfig.setNumistaConfig()` / `setPcgsConfig()` |

Reading catalog keys via `loadApiConfig().keys["numista"]` returns `undefined`; that is the wrong store and the root cause of STRK-573.
`saveData()` wraps in `JSON.stringify`.
Read saved data via `loadData()` / `loadDataSync()`.
After saving a catalog key, call `catalogAPI.initializeProviders()` to refresh stale provider instances.

### `check-release-sync` hook is a SUBSET

Validates `constants.js ↔ package.json ↔ package-lock.json ↔ version.json ↔ CHANGELOG.md`, plus the `js/about.js` What's New block — it asserts the current-version `<li>` entry is present **and** enforces the 5-entry cap (STRK-194, #1262).
Does not check `manifest.json`, README badges, or `sw.js` cache.
**Hook green ≠ release complete.**
`/release` is the only path that touches all release-bearing files.

### Script load order — `safeGetElement` unavailable in `events.js` top-level

`init.js` defines `safeGetElement` and loads after `events.js`; both scripts use `defer`.
Top-level code in `events.js` that calls `safeGetElement` throws a silent ReferenceError.
Use `document.getElementById` for event wiring that runs at parse time.
Factory closures such as `createLotEachToggle` are fine because they call `safeGetElement` at runtime.

### Playwright dialog testing — `showAppConfirm` is not `window.confirm`

`showAppConfirm` (`js/dialogs.js`) is a custom Document Object Model modal (`#appDialogModal`), not native `window.confirm`.
`page.on("dialog", ...)` does not intercept it.
Tests start the async function via `page.evaluate` without awaiting it first.
Then call `waitForSelector("#appDialogModal", {state:"visible"})`.
Then click `#appDialogOk` or `#appDialogCancel`.
Use the same pattern for `showAppAlert` and `showAppPrompt`.

### `state.js` variable exposure — `let` needs `Object.defineProperty`

Variables declared with `let` in `state.js` are not on `window`.
`inventory` and `changeLog` have explicit `Object.defineProperty` getter/setters.
Any new state variable that tests or other modules need via `window.X` should follow the same pattern.

### Worktree Edit discipline

Before calling `Edit`/`Write` inside a worktree session, verify `EnterWorktree` has been invoked for that path.
If the Edit tool is blocked, the root cause is missing `EnterWorktree` registration; call it first.
Do not fall back to Python/subprocess file writes as a workaround.

### Date formatting — Canadian English locale

Use `toLocaleDateString('en-CA')` (Canadian English) to produce local dates in year-month-day format.
Do not use `toISOString().slice(0, 10)`; it returns a UTC date and causes off-by-one errors for users in negative UTC offsets.

### Theme count — four themes, not three

StakTrakr has **four** CSS themes: `light`, `dark`, `slate`, `sepia`. There is no `contrast` theme. AI reviewers frequently hallucinate "three themes" or a "contrast" theme — both are wrong.

### Extended gotchas

Read the file `.context/implementation-gotchas.md` before touching: `applyBulkEdit`, `loadDataSync`, CSS sticky columns, `--warning` color, `_isMarketItemEnabled`, goldback predicates, closing task ordering, or `// duplication-ok`.

### Review & CI

Read the file `.context/review-and-ci.md` before: Codacy CLI scans, agentlint runs, pre-PR quality checks, or triaging reviewer false positives.

**Review routing (updated 2026-06-14 — tag-gated to conserve review credits).** AI reviewers are now **opt-in per PR via labels** — none auto-review an untagged PR. Add labels at PR creation for review-worthy PRs (runtime patches, version bumps); omit them on trivial chores (docs/config) to skip the AI review cycle. The required status checks (`Codacy Static Code Analysis`, CodeQL) run regardless of labels. **CodeRabbit** runs only with the `coderabbit-review` label (auto re-review is **paused after the first review** — follow-up commits don't trigger a fresh pass, so re-trigger manually if you need another; `request_changes_workflow: true`, so a `CHANGES_REQUESTED` clears only on a clean re-review and a `COMMENTED` re-review does not flip it; ~4–8 reviews/hour throttle → 5–10 min lag). **Codacy AI** (security layer) runs only with the `codacy-review` label. **Copilot** is on-demand; label-based triggering is the planned direction but is not yet wired up. **Add both `coderabbit-review` and `codacy-review` at PR creation** for any PR you want reviewed — CodeRabbit no longer auto-applies `codacy-review` for untagged PRs, so add them explicitly rather than relying on the old auto-apply chain. The tag-gate and re-review pause are managed in CodeRabbit's **cloud** config (org/dashboard) — there is nothing to edit in the repo `.coderabbit.yaml` for this.

**CodeRabbit 75% docstring-coverage pre-merge gate.** New or modified JS **and shell** functions need docstrings (JSDoc, or a `#` comment line directly above a shell function) or the PR sticks at `reviewDecision: CHANGES_REQUESTED` / `mergeStateStatus: BLOCKED` **with every GitHub status check green and 0 unresolved threads**. The failing check lives only in CodeRabbit's "Pre-merge checks" issue-comment panel — invisible to `statusCheckRollup`, the status API, and the `reviewThreads` GraphQL query. When a PR is `CHANGES_REQUESTED` but threads == 0 and checks are green, read that panel for `❌ Error` rows. Write docstrings pre-emptively. (Gate is org-level via `inheritance: true`, not in the repo yaml.)

**Codacy state is authoritative via the Cloud CLI, not the dashboard UI.** Before claiming a Codacy tool toggle or pattern suppression is done, confirm it with the Codacy Cloud CLI (`/codacy-skills:codacy-cloud-cli`) — the dashboard UI and backend can diverge, and a UI-only check has been wrong repeatedly in a single session. The Codacy MCP server is retired; use the `codacy-skills` plugin CLIs (`codacy-cloud-cli` for cloud state, `codacy-analysis-cli` for local scans).

**Async bot reviewers land after checks go green.** Copilot and Codacy AI post review threads 1–3 min _after_ required checks pass — often after the merge window opens. Before merging: confirm required checks are green, pause ~2–3 min, then re-query review threads. Treat a `null` result or `errors` array from a `gh api graphql` query as a failure (a malformed query can silently return `null`); an empty `nodes` array is the valid "no active threads" state — confirm the response is a valid list before merging.

### Dual ESLint config — `.eslintrc.json` is Codacy-only

The repo carries two ESLint configs: `eslint.config.cjs` (flat — used by local `npm run lint`) and `.eslintrc.json` (legacy — read only by Codacy's server-side ESLint). With a flat config present, ESLint 9 ignores the legacy file locally.
The `no-restricted-globals` ban on native `alert`/`confirm`/`prompt` (use `showAppAlert`/`showAppConfirm`/`showAppPrompt`) lives **only** in `.eslintrc.json`, so a native `confirm()` passes `npm run lint` but Codacy flags it.
Before deleting `.eslintrc.json` or bumping to ESLint 10 (Dependabot PR #1228 is deferred pending Codacy support), migrate that rule into `eslint.config.cjs`.

## Pre-flight (StakTrakr-specific)

- **Before writing any JavaScript** → read `Foundation/coding-standards.md` (DocVault).
- **Before any feed/poller/API/data-path diagnosis** → invoke `/api-infrastructure` and `/retail-poller` first.
- **Before speculating on infra failure mode** → read matching Foundation doc.
- **Before claiming what env/secret is set on Fly.io or home poller** → `mcp__infisical__get-secret` (project `stak-trakr-94m4`, env `dev`).
- **Before any version-bump PR**:
  - Run `/update-spot-bundle`.
  - Ensure Tailscale is active.
  - Stage and commit before executing `gh pr create`.
- **Before `dev → main`** → `/ship`, only on explicit user "ready to ship".
- **Before citing any cron schedule** → grep `devops/pollers/home-poller/docker-entrypoint.sh` for the authoritative value.

## Design Context

Users span casual stackers → serious investors → preppers. Primary context: home desktop, mobile matters.
Brand voice: **sharp, capable, empowering** — pro trading terminal, not toy.
Full design system, four-theme rules (light, dark, slate, sepia), and anti-references in `DocVault/Projects/StakTrakr/Foundation/design-philosophy.md`.
Anti-references: not generic fintech, not crypto/Web3, not spreadsheet clone.

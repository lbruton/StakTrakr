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
- Update `tests/playwright/coverage-map.csv` when a PR changes the Playwright test inventory.
  - This is an `AGENTS.md` requirement; a missing or stale row is caught only by review, not by any local gate.
  - Exception: non-functional edits (comments, formatting, refactors) that leave the inventory unchanged do not require a coverage-map entry.

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
- **Every change to `dev` needs a PR — no exceptions.** The `Protect Dev` ruleset (required `Codacy Static Code Analysis` + CodeQL checks, signed commits, no bypass actors) blocks direct pushes of any file type, instruction files included.
- Config/tooling edits (`.claude/`, `.Codex/`, `.opencode/`, `.agents/`, `CLAUDE.md`, `AGENTS.md`, `.geminiignore`, `.gitignore`, skill files, devops config) are still **lightweight** — a small chore PR to `dev`, no Plane issue or version lock required.
- Runtime code (`js/`, `css/`, `index.html`, `data/`, `pollers/`, tests) requires the **full discipline**: Plane issue → worktree → PR to `dev`.
- **`EnterWorktree` is denied in this repo** (`.claude/settings.json`) — it cannot be based on `dev`. Create worktrees with git: `git fetch origin dev && git worktree add .claude/worktrees/<name> -b <branch> origin/dev`. Rationale + merge-base verification in `.context/git-topology.md`.
- **Fetch `origin/dev` before searching a worktree.** A stale worktree makes `grep` return empty for code that exists on `dev` — a false negative that reads exactly like "this identifier does not exist."
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
- When claude-context returns thin results for a global, Grep the identifier directly — script-tag globals have no import graph, so Grep is the authoritative way to find every reference.
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

Validates `constants.js ↔ package.json ↔ version.json ↔ CHANGELOG.md`, plus the `js/about.js` What's New block — it asserts the current-version `<li>` entry is present **and** enforces the 5-entry cap (STRK-194, #1262).
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

Use `toLocaleDateString('en-CA')` (Canadian English) to produce **local, user-facing** dates in year-month-day format (form defaults, filenames, display).
Do not use `toISOString().slice(0, 10)` for those; it returns a UTC date and shifts a day for users in negative UTC offsets.
**Inverse case — UTC-keyed data values** (publisher feed business days, chart time keys): keep the UTC calendar date.
Derive it from the feed row's ISO timestamp field (`row.t.split("T")[0]`) or `toLocaleDateString('en-CA', { timeZone: 'UTC' })`.
Local `en-CA` on a UTC-stamped key shifts a day for users in positive UTC offsets.
Do not mix frames (local `new Date(y, m, d)` construction followed by `toISOString()` formatting) unless the conversion is deliberate and commented at the call site.

### Theme count — four themes, not three

StakTrakr has **four** CSS themes: `light`, `dark`, `slate`, `sepia`. There is no `contrast` theme. AI reviewers frequently hallucinate "three themes" or a "contrast" theme — both are wrong.

### Extended gotchas

Read the file `.context/implementation-gotchas.md` before touching: `applyBulkEdit`, `loadDataSync`, CSS sticky columns, `--warning` color, `_isMarketItemEnabled`, goldback predicates, closing task ordering, or `// duplication-ok`.

### Review & CI

Read `.context/review-and-ci.md` before Codacy CLI scans, agentlint runs, pre-PR quality checks, or triaging reviewer false positives. Key rules it covers:

- **Review is label-gated** (2026-06-14): apply the `coderabbit-review` + `codacy-review` labels at PR creation for review-worthy PRs; skip on trivial chores.
- Required checks (`Codacy Static Code Analysis`, CodeQL) run regardless of labels.
- **75% docstring-coverage gate** blocks merge invisibly — `CHANGES_REQUESTED` with green checks and 0 threads. Write JSDoc / shell docstrings pre-emptively.
- **Async bot reviewers** (Copilot, Codacy AI) post threads 1–3 min after checks go green. Re-query threads before merging.
- **Codacy state** is authoritative via the Cloud CLI, not the dashboard UI.
- **Dual ESLint config:** `no-restricted-globals` (native `alert`/`confirm`/`prompt` ban) lives only in legacy `.eslintrc.json`, so a native `confirm()` passes `npm run lint` but Codacy flags it.

## Pre-flight (StakTrakr-specific)

- **Before writing any JavaScript** → read `Foundation/coding-standards.md` (DocVault).
- **Before any feed/poller/API/data-path diagnosis** → invoke `/api-infrastructure` and `/retail-poller` first.
- **Before speculating on infra failure mode** → read matching Foundation doc.
- **Before claiming what env/secret is set on Fly.io or home poller** → `mcp__infisical__get-secret` with `projectId` = UUID `319a1db5-207d-49d0-a61d-3f3e6b440ded`, env `dev`. Pass the UUID, not the slug `stak-trakr-94m4` (slug → `404 "bot lookup"`); `list-projects` is 422-broken, so discovery is unavailable.
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

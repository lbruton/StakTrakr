# StakTrakr

Precious metals inventory tracker (**STRK** Plane prefix). Single HTML page, vanilla JS, localStorage. Runs on `file://` and HTTP. Zero build, zero install. **DOM** = Document Object Model throughout.

## Identity

Senior engineering partner for a solo-dev precious metals tracker. Direct, opinionated, verify-before-asserting.

## Commands

```bash
python3 -m http.server 8000   # Run locally at http://localhost:8000
npm test              # Core Playwright PR gate
npm run test:core     # Core Playwright suite
npm run test:extended # Slower/edge Playwright suite
npm run test:legacy   # Archived issue acceptance-criteria (AC) matrices
npm run test:all      # Unit + core + extended
npm run test:unit     # Node/unit tests
npm run test:offline  # Legacy full-suite command excluding @network-tagged tests
npm run lint          # ESLint
npm run lint:md:all   # Markdown lint
npm run format        # Prettier (js/ + css/ only — not data/, vendor/)
npm run format:check
```

## Foundation Context

Canonical agent-facing docs live in-repo at `.context/` — they travel with the code and
every worktree. Three tiers of truth:

- **Tier 1 — `.context/*.md`**: canonical foundation + policy docs. Read the matching doc
  before working in its area (table below).
- **Tier 2 — `.context/deep-dives/`**: 13 deep-dive docs (data model, DOM patterns,
  pollers, API reference, health checks, vendor quirks, …). Read when Tier 1 points there
  or the task is deep in that subsystem.
- **Tier 3 — source code wins.** On any conflict, code is truth; fix the doc.
  Authoritative cron/config: `devops/pollers/home-poller/docker-entrypoint.sh`,
  `devops/pollers/remote-poller/fly.toml`.

Run `/context-drift` after architectural/infra work (replaces `/vault-drift` for this
project). DocVault Foundation originals remain as human-dev guides only — never cite them
as authority.

| Doc                                  | Read before                                                            |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `.context/architecture.md`           | System-design questions — frontend/API/data model, sqld schema         |
| `.context/infrastructure.md`         | Deploy/infra claims — Fly.io, home poller, secrets, CI/CD, thresholds  |
| `.context/coding-standards.md`       | **Writing any JavaScript** — style, module boundaries, DOM/storage     |
| `.context/design-philosophy.md`      | UI work — brand, tokens, four themes, anti-references                  |
| `.context/reusable-patterns.md`      | Vendor normalization, providers.json, retail modal, chart abstractions |
| `.context/data-pipelines.md`         | Spot/retail/goldback/image pipeline work — cron, thresholds, failures  |
| `.context/cloud-sync.md`             | Dropbox sync — OAuth, AES-GCM encryption, rollback, backup/restore     |
| `.context/cloud-sync-convergence.md` | Any sync compare/merge/hash change — STRK-154 invariant                |
| `.context/testing.md`                | **Editing or running any test** — tiers, TDD rules, coverage-map       |
| `.context/issue-tracking.md`         | Plane issue work — state UUIDs, epic conventions                       |
| `.context/git-topology.md`           | Worktrees, merges, releases, version lock, spot bundle                 |
| `.context/implementation-gotchas.md` | The modules/patterns in the gotcha index below                         |
| `.context/review-and-ci.md`          | Codacy scans, agentlint, pre-PR checks, reviewer false positives       |
| `.context/sketch-conventions.md`     | Any `/sketch-*` phase work — branch naming, closing tasks              |
| `.context/GLOSSARY.md`               | Writing requirements, ACs, issue descriptions, commit messages         |

## Testing

Read `.context/testing.md` before editing or running any test — it is the single authority
for test tiers, TDD rules, file placement, and the coverage-map requirement.
Never modify a TDD test to make it pass; a failing test means the implementation is wrong.

## Issue Tracking

Plane project: `https://plane.lbruton.cc/lbruton/projects/026dbe54-fe52-4a9f-9f1b-7edcb9bbdceb/`.
Create issues via `/issue` or `mcp__plane__create_issue`. State UUIDs, epic conventions,
and the pre-Plane archive path: `.context/issue-tracking.md`.

## Git Topology

- Branch model: `feature/* → dev → main`. **Every change to `dev` needs a PR — no
  exceptions.** The `Protect Dev` ruleset (required `Codacy Static Code Analysis` + CodeQL
  checks, signed commits, no bypass actors) blocks direct pushes of any file type.
- Config/tooling edits (`.claude/`, `.agents/`, instruction files, skill files, devops
  config) are **lightweight** — a small chore PR to `dev`, no Plane issue or version lock.
- Runtime code (`js/`, `css/`, `index.html`, `data/`, `pollers/`, tests) requires the
  **full discipline**: Plane issue → worktree → PR to `dev`.
- `EnterWorktree` is denied in this repo — it cannot express a `dev` base. Create worktrees
  with git: `git fetch origin dev && git worktree add .worktrees/<name> -b <branch> origin/dev`.
- **Full rules:** `.context/git-topology.md` — merge strategy, version lock high-water
  mark, spot bundle, stale-branch detection, sketch overrides, EnterWorktree rationale.

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
| `/glossary`                       | Harvest/list/search domain terms in `.context/GLOSSARY.md`          |
| `/ui-mockup` (global)             | New multi-element UI — Playground prototype first                   |
| `/context-drift` (global)         | Audit `.context/` docs against source truth after infra work        |

**Skill authoring:** filename must be `SKILL.md` (`.gitignore` silently excludes other `.md` names).

**Skill copies:** every `.claude/skills/<name>/SKILL.md` has a tracked twin under `.agents/skills/<name>/SKILL.md`. When fixing a skill doc, `git grep` the sibling and apply the identical fix to both — Copilot flags stale twins.

## Gotcha Index

Detail lives in `.context/implementation-gotchas.md` — read it before touching anything
listed here. One hook line each:

- **Dual config store (CRITICAL)** — spot (`metalApiConfig`) and catalog
  (`catalog_api_config`) are separate localStorage stores; confusing them = silent data
  loss (STRK-573 root cause).
- **`check-release-sync` hook is a subset** — hook green ≠ release complete; only
  `/release` touches all release-bearing files.
- **Script load order** — `events.js` top-level cannot call `safeGetElement`; use
  `document.getElementById` for parse-time wiring.
- **`showAppConfirm`/`showAppAlert`/`showAppPrompt`** — custom DOM modals, not native
  dialogs; `page.on("dialog")` never fires.
- **`state.js` `let` variables** — not on `window` without `Object.defineProperty`.
- **Date frames** — `en-CA` local for user-facing dates; UTC frame for feed-keyed values;
  never mix frames silently.
- **Four themes** — `light`, `dark`, `slate`, `sepia`. No `contrast` theme; reviewers
  hallucinate it.
- **Module foot-guns** — `applyBulkEdit`, `loadDataSync`, CSS sticky columns,
  `--warning`/`--success` contrast, `_isMarketItemEnabled`, goldback predicates,
  `// duplication-ok`, closing-task ordering.

**Review & CI:** read `.context/review-and-ci.md` before Codacy scans, agentlint runs,
pre-PR checks, or triaging reviewer feedback — label-gated review, the invisible 75%
docstring gate, async bot reviewers, and the dual ESLint config all live there.

## Pre-flight (StakTrakr-specific)

- **Before writing any JavaScript** → read `.context/coding-standards.md`.
- **Before any feed/poller/API/data-path diagnosis** → invoke `/api-infrastructure` and `/retail-poller` first.
- **Before speculating on infra failure mode** → read the matching `.context/` doc.
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
Full design system, four-theme rules (light, dark, slate, sepia), and anti-references in `.context/design-philosophy.md`.
Anti-references: not generic fintech, not crypto/Web3, not spreadsheet clone.

---
tags: []
doc_type: overview
project: StakTrakr
source: manual
created: "2026-04-26"
updated: "2026-09-28"
---

# StakTrakr

Precious metals inventory tracker — vanilla-JS PWA with offline-first localStorage, real-time spot prices, retail dealer monitoring, and encrypted Dropbox sync. Frontend on Cloudflare Pages; thin publisher API on Fly.io; price/scraping pollers on home Docker + Fly.io.

## At a Glance

| Field         | Value                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------ |
| Repo          | [lbruton/StakTrakr](https://github.com/lbruton/StakTrakr)                                        |
| Language      | Vanilla JS (script-tag globals) — no framework, no build step                                    |
| Branches      | `dev` (PR target), `main` (release)                                                              |
| Version       | Read `version.json` at the repo root — not repeated here so it cannot go stale                   |
| Issue Tracker | [Plane STRK](https://plane.lbruton.cc/lbruton/) (migrated 2026-04-26 — was `STAK-` historically) |
| PR Target     | `dev` (signed commits + PR + status checks required)                                             |

## Where the docs live

| Location                 | Audience | Holds                                                                |
| ------------------------ | -------- | -------------------------------------------------------------------- |
| `.context/*.md`          | Agents   | Canonical foundation + policy docs (architecture, infrastructure, …) |
| `.context/deep-dives/`   | Agents   | Subsystem reference (data model, pollers, API, vendor quirks, …)     |
| `DocVault/` (this vault) | Humans   | This overview, `specs/`, research notes, dated reports and audits    |

Source code wins over every document. When a doc and the code disagree, fix the doc.

## Architecture

PWA frontend on Cloudflare Pages consuming three feeds:

1. **Spot prices** — provider APIs → home poller + Fly.io poller → sqld → JSON manifests
2. **Retail prices** — home poller scrapes vendor sites (3-phase CF bypass) → sqld → manifests
3. **Goldback prices** — per-state slugs scraped on the home poller

Data flows through a thin publisher API on Fly.io and GitHub Pages JSON. The frontend tries `api.staktrakr.com` first, then `api2.staktrakr.com` (`V2_API_ENDPOINTS` in `js/constants.js`). Cloud sync uses Dropbox OAuth + AES-256-GCM with atomic rollback.

## Foundation docs (`.context/`)

| Doc                                  | What's there                                                  |
| ------------------------------------ | ------------------------------------------------------------- |
| `.context/architecture.md`           | System design, frontend/API/data model, sqld schema           |
| `.context/infrastructure.md`         | Deploy topology, Fly.io, home poller, secrets, CI/CD          |
| `.context/coding-standards.md`       | DOM patterns, localStorage rules, service worker              |
| `.context/design-philosophy.md`      | Brand, tokens, four themes, anti-references                   |
| `.context/reusable-patterns.md`      | Vendor normalization, providers.json, retail modal, charts    |
| `.context/data-pipelines.md`         | Spot / retail / goldback / image — cron, thresholds, failures |
| `.context/cloud-sync.md`             | Dropbox OAuth, AES-256-GCM, rollback, backup/restore          |
| `.context/cloud-sync-convergence.md` | Sync compare/merge/hash invariant                             |
| `.context/testing.md`                | Test tiers, TDD rules, coverage map                           |
| `.context/git-topology.md`           | Worktrees, merges, releases, version lock, spot bundle        |
| `.context/implementation-gotchas.md` | Module-level foot-guns                                        |
| `.context/review-and-ci.md`          | Codacy, agentlint, reviewer routing                           |

Drift audit: `/context-drift` (replaced `/vault-drift`, which is retired).

## Deep dives (`.context/deep-dives/`)

`api-reference`, `data-model`, `dom-patterns`, `health-checks`, `home-poller`, `image-pipeline`, `playwright-suite-rationalization`, `provider-database`, `remote-poller`, `retail-modal`, `secret-keys`, `vendor-quirks`, `webscale-cookie-re-solve`.

## Workflow

- Worktree + PR mandatory; PRs target `dev`.
- `dev → main` merges only on explicit "release" / "ready to ship" signal.
- Version bumps via `/release patch|minor|major`; lock and worktree rules in `.context/git-topology.md`.
- Pre-Plane issues live in the frozen central DocVault archive (`.trash/Issues-Pre-Plane/StakTrakr/`); see `.context/issue-tracking.md`.

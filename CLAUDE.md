# CLAUDE.md

**For Claude Code (Desktop CLI)** — Local Mac development with MCP servers and skills.
**For Claude.ai (Web)** — Use `AGENTS.md` instead. This file contains local-only tooling instructions.

> See `~/.claude/CLAUDE.md` for global workflow rules, mandatory gates, skill trigger matrix, and MCP servers.

---

## Project at a Glance

**StakTrakr** — precious metals inventory tracker. Single HTML page, vanilla JS, localStorage persistence.
Works on `file://` and HTTP. Runtime artifact: zero build step, zero install. See `coding-standards` skill for patterns.

**Portfolio model**: Purchase Price / Melt Value / Retail Price. `meltValue` = `weight * qty * spot`.
**Version format**: `BRANCH.RELEASE.PATCH` in `js/constants.js`. Use `/release` skill to bump (touches 7 files).
**Patch habit**: One meaningful change = one patch tag. Run `/release patch` after every committed fix/feature.

## Documentation

Technical docs live in **DocVault** at `DocVault/Projects/StakTrakr/`. This is the single source of truth.

- **DocVault updates are mandatory before PR push** — run `/vault-update` to auto-detect affected pages via frontmatter `sourceFiles`
- Source file → page mapping is encoded in each DocVault page's YAML frontmatter — `/vault-update` reads it automatically
- Infrastructure pages (tagged `owner/staktrakr-api`) are maintained by StakTrakrApi agents — don't rewrite their content

Key pages: Start at `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/_Index.md` and follow the index.

## API Infrastructure

Three feeds at `api.staktrakr.com` via GitHub Pages. See DocVault pages (Health Checks, Remote Poller, Spot Pipeline) for full details.

| Feed | Stale threshold | Poller |
|---|---|---|
| Market prices (`manifest.json`) | 30 min | Fly.io retail cron |
| Spot prices (`hourly/YYYY/MM/DD/HH.json`) | 75 min | Fly.io spot cron |
| Goldback (`goldback-spot.json`) | 25h | Fly.io hourly :20 |

**Critical:** `spot-history-YYYY.json` is a **seed file** (noon UTC daily), NOT live data.
All poller code lives in `devops/pollers/` (shared + home-poller + remote-poller). See `/repo-boundaries` and `/api-infrastructure` skills.

## Critical Patterns

These are the patterns Jules/Copilot commonly miss. Non-negotiable:

- **DOM**: `safeGetElement(id)` — never raw `document.getElementById()` (except startup in `about.js` / `init.js`)
- **Storage**: `saveData()`/`loadData()` from `js/utils.js` — never direct `localStorage`
- **Storage keys**: must be in `ALLOWED_STORAGE_KEYS` in `js/constants.js`
- **New JS files**: add to `sw.js` CORE_ASSETS AND script load order in `index.html` (71 external scripts: 63 JS + 7 vendor + 1 data bundle)
- **innerHTML**: always `sanitizeHtml()` on user content
- **sw.js CACHE_NAME**: auto-stamped by pre-commit hook (`devops/hooks/stamp-sw-cache.sh`)
- **Duplicate check**: when editing frontend code, check `events.js` AND `api.js` for duplicate function definitions — edits to the wrong file are a recurring source of lost time

## Testing

**Dual test model:**

**Playwright (primary):** `@playwright/test` — local TDD layer. Tests in `tests/playwright/`. Run with `npx playwright test` (or `npm test`). Config in `playwright.config.js`. Offline tests (non-`@network`) require no credentials. Network tests tagged `@network` require live connectivity. TDD enforced: write failing tests BEFORE implementation code.

**Browserbase/Stagehand (secondary):** `/bb-test` via Browserbase/Stagehand against PR preview URLs — reserved for live-site verification and cloud-only features. Runbook tests at `tests/runbook/*.md` — 84 NL E2E tests across 8 sections, run with `/bb-test sections=NN`.

**Test API keys** stored in Infisical — use `/secrets` skill. Inject via Stagehand after navigating to app.

**Cloud sync/OAuth cannot be tested via Browserbase** — different origin breaks Dropbox OAuth. Test manually at `beta.staktrakr.com` after merging to `dev`.

## Branch Protection Gotchas

- **Dev branch requires PRs** — direct push to `dev` is blocked by ruleset. Every commit needs a branch + PR cycle.
- **Main branch: 0 approvals required** — solo dev can't self-approve. Quality gates are Codacy, CodeQL, CODEOWNERS, and thread resolution.
- **Signed commits on main** — `required_signatures` ruleset is active. Pre-existing unsigned commits will block merges; temporarily disable the ruleset for ship PRs that include unsigned history.
- **CODEOWNERS** — `.github/workflows/` and `.github/CODEOWNERS` require owner review.
- **CodeQL languages** — only `javascript-typescript` and `python`. Do NOT re-add `actions` (no workflow files to scan).
- **Zero GitHub repo secrets** — all secrets removed post-STAK-531. Fly.io has its own secrets via `fly secrets`. Infisical is the secrets store. Do NOT add secrets back to GitHub repo settings.

## Hooks

- **gitleaks**: Pre-commit hook scans for accidental secret commits (`github-pat`, `aws`, `stripe`, etc.). Runs via `pre-commit` framework. Installed 2026-04-14 (OPS-116).
- **stamp-sw-cache**: Local pre-commit hook auto-updates `sw.js CACHE_NAME` when cached assets change. Preserved in `.pre-commit-config.yaml`.

## Issue Tracking

Issues tracked in DocVault. Prefix: `STAK` (see `/issue` skill).
**Jules PRs**: always draft, always context-blind. Verify PR targets `dev` not `main`. Run `/pr-resolve` before approving.

## Project Skills

In `.claude/skills/`: `api-infrastructure`, `bb-test`, `brainstorming`, `browserbase-test-maintenance`, `bug-report`, `coding-standards`, `finishing-a-development-branch`, `firecrawl-infra`, `gsd`, `release`, `repo-boundaries`, `retail-poller`, `retail-provider-fix`, `seed-sync`, `ship`, `start-patch`, `sw-cache`, `sync-instructions`.

User-level skills: `home-infrastructure`, `cloud-infrastructure`, `proxmox`, `secrets`, `prime`.

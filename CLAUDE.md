# CLAUDE.md

**For Claude Code (Desktop CLI)** — Local Mac development with MCP servers and skills.
**For Claude.ai (Web)** — Use `AGENTS.md` instead. This file contains local-only tooling instructions.

> See `~/.claude/CLAUDE.md` for global workflow rules (push safety, version checkout gate, PR lifecycle, MCP tools, code search tiers, UI design workflow, plugins).

---

## Project at a Glance

**StakTrakr** — precious metals inventory tracker. Single HTML page, vanilla JS, localStorage persistence.
Works on `file://` and HTTP. Runtime artifact: zero build step, zero install. See `coding-standards` skill for patterns.

**Portfolio model**: Purchase Price / Melt Value / Retail Price. `meltValue` = `weight * qty * spot`.
**Version format**: `BRANCH.RELEASE.PATCH` in `js/constants.js`. Use `/release` skill to bump (touches 7 files).

**Patch versioning habit**: Run `/release patch` after every meaningful committed change — bug fix, UX tweak, feature addition. Each patch tag (`v3.32.03`) is a breadcrumb that lets us reconstruct a clean changelog at release time. Don't batch multiple changes under one version bump. The rule: **one meaningful change = one patch tag**.

## DocVault — Project Technical Documentation

Technical documentation lives in **DocVault** (Obsidian vault) at `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/`. This is the single source of truth — there is no in-repo wiki. **DocVault updates MUST be committed BEFORE pushing or creating a PR.** Use `/vault-update` to auto-detect affected pages via frontmatter `sourceFiles`. For widespread changes, use `/wiki-sweep` (adapted for DocVault).

If a DocVault page would become inaccurate after your change, updating it is not optional — treat it as part of the PR diff.

### Source File → DocVault Page Matrix

When you change a file, update every DocVault page listed in its row. All pages are at `DocVault/Projects/StakTrakr/`.

| Source File | DocVault Pages to Update |
|---|---|
| `index.html` | Frontend Overview |
| `sw.js` | Frontend Overview, Service Worker |
| `devops/hooks/stamp-sw-cache.sh` | Service Worker |
| `devops/version.lock` | Release Workflow |
| `.claude/skills/release/SKILL.md` | Release Workflow |
| `.claude/skills/ship/SKILL.md` | Release Workflow |
| `js/constants.js` | Frontend Overview, Data Model, Storage Patterns, Release Workflow |
| `js/types.js` | Data Model |
| `js/utils.js` | Data Model, Storage Patterns, DOM Patterns, Backup & Restore |
| `js/about.js` | DOM Patterns |
| `js/init.js` | DOM Patterns |
| `js/file-protocol-fix.js` | Frontend Overview |
| `js/api.js` | API Consumption, Vendor Quirks |
| `js/api-health.js` | API Consumption |
| `js/cloud-sync.js` | Cloud Sync, Backup & Restore |
| `js/cloud-storage.js` | Cloud Sync, Backup & Restore |
| `js/retail.js` | Retail Modal, Vendor Quirks |
| `js/retail-view-modal.js` | Retail Modal, Vendor Quirks |
| `js/image-cache.js` | Image Pipeline |
| `js/image-processor.js` | Image Pipeline |
| `js/image-cache-modal.js` | Image Pipeline |
| `js/bulk-image-cache.js` | Image Pipeline |
| `js/seed-images.js` | Image Pipeline |

**Infrastructure pages** (tagged `owner/staktrakr-api`) are maintained by StakTrakrApi agents — only update their frontmatter, never rewrite technical content from this repo.

## Code Search Paths

- `mcp__claude-context__search_code` path: `/Volumes/DATA/GitHub/StakTrakr`
- DocVault search: `mcp__claude-context__search_code` with path `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr`
- Full vault search: `mcp__claude-context__search_code` with path `/Volumes/DATA/GitHub/DocVault`
- **CGC setup**: `cd devops/cgc && docker compose up -d`

## API Infrastructure

> **Poller code ownership:** All poller scripts live in `StakTrakr/devops/pollers/` (shared core + home-poller + remote-poller). Home VM deploys via Portainer API from git. Fly.io deploys from `devops/pollers/remote-poller/` in this same repo — `StakTrakrApi/devops/fly-poller/` no longer exists. See `repo-boundaries` skill for full ownership map.

**Runbook:** See DocVault for current runbooks: Health Checks, Remote Poller, Spot Pipeline (all in `DocVault/Projects/StakTrakr/`).

Three feeds served from `lbruton/StakTrakrApi` **api branch** via GitHub Pages at `api.staktrakr.com`:

| Feed | File | Poller | Stale threshold |
|---|---|---|---|
| Market prices | `data/api/manifest.json` | Fly.io retail cron | 30 min |
| Spot prices | `data/hourly/YYYY/MM/DD/HH.json` | Fly.io `run-spot.sh` cron | 75 min |
| Goldback | `data/api/goldback-spot.json` | Fly.io `run-goldback.sh` hourly :20 | 25h |

**Critical:** `spot-history-YYYY.json` is a **seed file** (noon UTC daily), NOT live data.

**Portainer VM**: Runs all Docker stacks — home-poller, firecrawl, tinyproxy, tailscale-sidecar, plus other projects. Managed exclusively via Portainer REST API or web UI. No SSH, no docker CLI. See `home-infrastructure` skill for IPs, stack registry, and API reference. Dashboard at port 3010 (HTTP) / 3011 (HTTPS).

**Quick health check:**

```bash
# API feed freshness
curl -s https://api.staktrakr.com/data/api/manifest.json | python3 -c "
import sys,json; from datetime import datetime,timezone; d=json.load(sys.stdin)
age=(datetime.now(timezone.utc)-datetime.fromisoformat(d['generated_at'].replace('Z','+00:00'))).total_seconds()/60
print(f'Market: {age:.0f}m ago  {\"OK\" if age<=30 else \"STALE\"}')"

# Fly.io logs
fly logs --app staktrakr | grep -E 'spot|run-spot' | tail -5
```

**mem0 recall:** `/remember api infrastructure` or `/remember active poller failures`

## Critical Patterns (Jules/Copilot commonly miss these)

- **DOM**: `safeGetElement(id)` — never raw `document.getElementById()` (except startup in `about.js` / `init.js`)
- **Storage**: `saveData()`/`loadData()` from `js/utils.js` — never direct `localStorage`
- **Storage keys**: must be in `ALLOWED_STORAGE_KEYS` in `js/constants.js`
- **New JS files**: add to `sw.js` CORE_ASSETS AND script load order in `index.html` (67 script tags: 59 JS + 7 vendor + 1 data bundle)
- **innerHTML**: always `sanitizeHtml()` on user content
- **sw.js CACHE_NAME**: auto-stamped by pre-commit hook (`devops/hooks/stamp-sw-cache.sh`)
- **Duplicate check**: when editing frontend code, check `events.js` AND `api.js` for duplicate function definitions before making changes — edits to the wrong file are a recurring source of lost time

## Testing

**Single test model:** `tests/runbook/*.md` — NL E2E tests run via `/bb-test` through Browserbase/Stagehand MCP against PR preview URLs. 84 tests across 8 section files: `01-page-load`, `02-crud`, `03-backup-restore`, `04-import-export`, `05-market`, `06-ui-ux`, `07-activity-log`, `08-spot-prices`. No Playwright, no browserless, no scripted specs.

**TDD enforcement:** Write runbook test blocks BEFORE implementing code. Run `/bb-test sections=NN` after implementation to verify. Use `/browserbase-test-maintenance` to add test blocks after shipping a spec.

**Ralph Loop oracle:** `/bb-test sections=NN` is the natural completion oracle for iterative bug fixes via `/ralph-loop` — set `--completion-promise` to the expected pass output so the loop exits automatically when tests go green.

**Test API keys** are stored in Infisical for tests requiring authentication (Numista, PCGS, etc.). Use the `secrets` skill to fetch them before running tests. Inject keys into localStorage via Stagehand after navigating to the app.

**Cloud sync and OAuth flows cannot be tested via Browserbase** — Cloudflare preview deployments use a different origin, which breaks Dropbox OAuth (the registered redirect URI only matches `beta.staktrakr.com`). Cloud sync fixes must be merged to `dev` first and tested manually by the user at `beta.staktrakr.com`.

**Deprecated tests:** `tests/depreciated/` contains archived Playwright `.spec.js` files and legacy Browserbase TypeScript tests (`tests/depreciated/browserbase-legacy/`). These are kept as reference only — do not add to or run them.

## Issue Tracking

Issues tracked in DocVault vault. Prefix: `STAK` (see `issue` skill).

**Jules PRs**: always draft, always context-blind. Verify PR targets `dev` not `main`. Run `/pr-resolve` before approving.

## Project Skills

In `.claude/skills/`: `api-infrastructure`, `bb-test`, `brainstorming`, `browserbase-test-maintenance`, `bug-report`, `coding-standards`, `finishing-a-development-branch`, `firecrawl-infra`, `gsd`, `release`, `repo-boundaries`, `retail-poller`, `retail-provider-fix`, `seed-sync`, `ship`, `start-patch`, `sw-cache`, `sync-instructions`.

User-level infrastructure skills: `home-infrastructure`, `cloud-infrastructure`, `proxmox`, `secrets`.

Note: `/prime` is now a user-level skill (`~/.claude/skills/prime/`) that works across all projects.

Use `/sync-instructions` after significant codebase changes.

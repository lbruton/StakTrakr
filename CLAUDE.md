# CLAUDE.md

---

## Project at a Glance

**StakTrakr** — precious metals inventory tracker. Single HTML page, vanilla JS, localStorage persistence.
Works on `file://` and HTTP. Runtime artifact: zero build step, zero install. See `coding-standards` skill for patterns.

**Version format**: `BRANCH.RELEASE.PATCH` in `js/constants.js`. Use `/release` skill to bump (touches 7 files).


## Cloud Sync Patterns

- **Atomic rollback**: Settings write loops must snapshot `localStorage.getItem()` before each `setItem`, restore on failure (not `removeItem`). Dual arrays: `_appliedKeys` (compensate), `_failedKeys` (log).
- **Codex peer review**: All `cloud-sync.js` patches require `/codex:rescue` review before merge.
- **`ALLOWED_STORAGE_KEYS` guard**: `typeof ALLOWED_STORAGE_KEYS !== 'undefined'` is defensive coding — the constant IS defined at `constants.js:871`. Automated reviewer flags on this are false positives.

## Data Feed Gotchas

> **Before diagnosing any feed/poller/API/data-path issue:** invoke `/api-infrastructure` first — it loads the mandatory DocVault update list (`API Reference.md`, `Remote Poller.md`), the Fly.io two-phase manual-deploy procedure, and `stale_after` conventions. Skipping this routing is the most common way sessions ship wrong-layer fixes.

- **Goldback scrapes DAILY at 16:05 UTC** (cron `05 16 * * *` in `devops/pollers/home-poller/docker-entrypoint.sh`), NOT hourly. `goldback-scraper.js` has no in-script skip-guard — the daily cron is the dedup.
- **Goldback UI "~2m ago" is publisher health, not scrape age** — `api-health.js` reads v2 envelope `generated_at` (rewritten each publish cycle by `api-export.js`), not `scraped_at`. For a daily feed, `scraped_at` can legitimately be ~24h old while the badge stays green.
- **Poller cron source of truth: `devops/pollers/home-poller/docker-entrypoint.sh`** — grep this file before citing any cron schedule. DocVault `Home Poller.md` has drifted from code in the past; always verify against the entrypoint.
- **v1→v2 API migration is incomplete** — STAK-503 moved spot/retail/goldback to `data/v2/` but left `providers.json` stranded at `data/retail/` and `data/api/` until 2026-04-11 (PR #951). Frontend fetches `${apiBase}/providers.json` which resolves to `data/v2/providers.json`. **For any "frontend data is wrong" bug, `curl` the exact URL the frontend constructs (or check DevTools Network) BEFORE analyzing parse/schema logic — a 404 beats any schema analysis, and stale `localStorage` on your dev browser can mask fresh-browser regressions for months.**

## Known Automated Reviewer False Positives

- `ALLOWED_STORAGE_KEYS` "fail-open" / "undefined guard" — constant exists at `constants.js:871`, guard is defensive pattern
- DESIGN.md / preview.html markdown lint — chore files, defer unless explicitly requested
- `.spec-workflow/` Playwright references — files migrated to DocVault, being deleted from repo

## Documentation

Technical docs live in **DocVault** at `DocVault/Projects/StakTrakr/`. This is the single source of truth. Full index with one-line summaries: `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/_Index.md`.

**Key pages by topic** — read the relevant page(s) when a session touches that area. All paths are relative to `DocVault/Projects/StakTrakr/`:

- **System + feeds:** `Architecture.md`, `Architecture.canvas`, `Health Checks.md`, `Poller Parity.md`
- **Pollers:** `Home Poller.md` (Portainer stack, retail/spot/goldback scrape), `Remote Poller.md` (Fly.io thin publisher)
- **Pipelines:** `Retail Pipeline.md`, `Retail Pipeline.canvas`, `Spot Pipeline.md`, `Spot Pipeline.canvas`, `Goldback Pipeline.md`
- **API:** `API Reference.md` (endpoints + schemas), `API Consumption.md` (frontend consumer, health badge logic)
- **Data + config:** `Turso Schema.md`, `Provider Database.md`, `Providers Config.md`, `Vendor Quirks.md`, `Secret Keys.md`
- **Frontend:** `Frontend Overview.md`, `DOM Patterns.md`, `Image Pipeline.md`, `Service Worker.md`, `Retail Modal.md`, `Style Guide.md`
- **Workflow:** `Release Workflow.md`

**Before citing architecture facts from the vault, verify against code.** DocVault has drifted from code in the past (see "Data Feed Gotchas" above). For poller crons specifically, grep `devops/pollers/home-poller/docker-entrypoint.sh` — the entrypoint is authoritative over any vault page.





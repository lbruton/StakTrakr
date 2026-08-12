---
title: "Remote Poller"
project: StakTrakr
audience: agent
canonical: .context/deep-dives/remote-poller.md
source: "DocVault/Projects/StakTrakr/Foundation/Deep Dives/Remote Poller.md" # migrated 2026-08-12
updated: "2026-04-11"
---

# Remote Poller (Thin Publisher)

> **STAK-478 (2026-03-21):** Fly.io is now a **slim thin publisher** (1GB/1CPU, spot+publish only). The Dockerfile was rewritten to remove Firecrawl, Playwright, Redis, RabbitMQ, and PostgreSQL — image reduced from ~2GB to ~150MB. Old Dockerfile archived as `Dockerfile.full` for rollback. Retail and goldback scraping handled by the Home Poller.

Single Cloud - Fly.io app (`staktrakr`) that runs **spot price polling** and **data publishing** to the `api` branch on GitHub Pages. Managed by **supervisord** inside one container.

**Database connectivity (STAK-486):** The Fly.io container connects to **sqld** on the Home VM (`http://192.168.1.81:8080`) via **Tailscale subnet routing**. The Home VM's Tailscale sidecar advertises `192.168.1.0/24` as a subnet route (`TS_ROUTES` in `docker-compose.tinyproxy.yml`), and the Fly.io container accepts those routes (`--accept-routes` in `supervisord.conf`). The `TURSO_DATABASE_URL` Fly secret points to the Home VM IP. Tailscale must be connected and the subnet route approved in the Tailscale admin console for DB reads to succeed.

**Goldback data flow (STAK-491):** The Home Poller scrapes goldback.com and writes the G1 rate to sqld as `coin_slug=goldback-g1`. The Fly.io publisher's `api-export.js` reads this from sqld and generates `goldback-spot.json` + `goldback-{YYYY}.json` as part of its normal publish cycle. The old `run-goldback.sh` (git-commit-and-push) path is disabled via `GOLDBACK_ENABLED=0`.

---

## App Config

| Key       | Value                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| App name  | `staktrakr`                                                                                                                             |
| Region    | `dfw`                                                                                                                                   |
| Memory    | 1024 MB (raised from 512 on 2026-07-25 after the STRK-277 VM wedge; profiled at 512 on 2026-04-11 — idle ~250 MB, publish peak <400 MB) |
| CPUs      | 1 shared                                                                                                                                |
| Volume    | `staktrakr_data` mounted at `/data`                                                                                                     |
| HTTP port | 8080 (proxied by Fly, force HTTPS)                                                                                                      |
| Mode      | Thin publisher (spot + publish + serve.js)                                                                                              |

**Persistent volume** (`/data`) holds the cloned `StakTrakrApi` repo at `/data/staktrakr-api-export` and Tailscale state at `/data/tailscale/tailscaled.state`.

---

## Services (supervisord-slim.conf)

Slim image runs only 4 services. Config: `supervisord-slim.conf`.

| Service        | Command                                              | Priority | Status                                                       |
| -------------- | ---------------------------------------------------- | -------- | ------------------------------------------------------------ |
| `tailscaled`   | `tailscaled --state=/data/tailscale/...`             | 4        | Active — provides subnet routing to home LAN for sqld access |
| `tailscale-up` | `tailscale up --authkey=... --accept-routes --reset` | 5        | Active — one-shot Tailscale auth                             |
| `cron`         | `cron -f`                                            | 10       | Active — runs spot + publish + provider export               |
| `http-server`  | `node /app/serve.js` on port 8080                    | 10       | Active — health/proxy endpoint                               |

> **Rollback:** `cp Dockerfile.full Dockerfile && fly deploy` from `devops/pollers/` with `--config remote-poller/fly.toml --dockerfile remote-poller/Dockerfile`.

---

## Cron Schedule

Written by `docker-entrypoint-slim.sh` at container start. Slim image has no retail/goldback toggles — only spot, publish, and provider export.

**Current state** (slim publisher):

| Schedule                    | Script                          | Log                                | Status                          |
| --------------------------- | ------------------------------- | ---------------------------------- | ------------------------------- |
| `0,30 * * * *`              | `/app/run-spot.sh`              | `/var/log/spot-poller.log`         | **Active**                      |
| `8,23,38,53 * * * *`        | `/app/run-publish.sh`           | `/var/log/publish.log`             | **Active**                      |
| `*/5 * * * *`               | `node export-providers-json.js` | `/var/log/provider-export.log`     | **Active**                      |
| ~~`CRON_SCHEDULE * * * *`~~ | ~~`/app/run-local.sh`~~         | ~~`/var/log/retail-poller.log`~~   | Disabled (`RETAIL_ENABLED=0`)   |
| ~~`15 * * * *`~~            | ~~`/app/run-retry.sh`~~         | ~~`/var/log/retail-retry.log`~~    | Disabled (follows retail)       |
| ~~`1 * * * *`~~             | ~~`/app/run-goldback.sh`~~      | ~~`/var/log/goldback-poller.log`~~ | Disabled (`GOLDBACK_ENABLED=0`) |

**Data flow:**

1. `run-spot.sh` polls MetalPriceAPI at `:00` and `:30` → writes to sqld
2. `run-publish.sh` runs at `:08`, `:23`, `:38`, `:53` → exports all data from sqld via `api-export.js` → generates static JSON files (manifest, per-coin, spot hourly, goldback) → commits and force-pushes to `api` branch → GitHub Pages serves at `api.staktrakr.com`

---

## Publish Pipeline (`run-publish.sh`)

This is the Fly.io container's primary job. Runs 4x/hour, ~3 min after spot polls complete.

1. **`api-export.js`** — Syncs `price_snapshots` from sqld into a local SQLite cache, then generates:
   - `data/api/manifest.json` — coin list, last updated, window counts
   - `data/api/latest.json` — all coins, current 15-min window prices
   - `data/api/{slug}/latest.json` — per-coin detail + 24h series
   - `data/api/{slug}/history-7d.json`, `history-30d.json` — daily aggregates
   - `data/api/goldback-spot.json` — G1 rate from `goldback-g1` rows in sqld (STAK-491)
   - `data/goldback-{YYYY}.json` — daily goldback history from sqld (STAK-491)
   - `data/api/providers.json` — frontend provider URLs
   - `data/hourly/YYYY/MM/DD/HH.json` — spot price hourly files
2. **`api-export-v2.js`** (STAK-503) — generates v2 endpoints under `data/v2/` (spot, retail, goldback, providers, manifest). Called after v1 export. **Non-fatal** — if v2 export throws, it is caught and logged; v1 publish continues unaffected. `providers.json` was added to the v2 surface to fix a frontend 404 regression (2026-04-11) — v1 already had `data/api/providers.json` but v2 never got its equivalent during the STAK-503 redesign, so frontend clicks on vendor prices silently fell back to vendor homepages for fresh-browser users.
3. **`git add data/ && git commit && git push --force origin HEAD:api`** — sole Git writer for `api` branch

---

## Scrape Pipeline (Archival Context — Now on Home Poller)

> **Archival context:** The scrape pipeline described below ran on Fly.io before STAK-478. It is now the Home Poller's responsibility. Kept here for historical reference since the shared code (`price-extract.js`) is identical. None of this runs on the current slim image.

See Poller Parity (deprecated DocVault page) for the current comparison between pollers.

### Phase 0: Playwright direct (tried first)

`scrapeWithPlaywrightDirect(url, providerId)` — lightweight scrape using the poller's own IP. 15-second timeout, no retries, no proxy.

### Phase 1: Firecrawl with proxy (fallback)

Only runs if Phase 0 fails. Routes through Firecrawl (self-hosted on home VM at `http://firecrawl-api:3002`).

### Phase 2: CF-clearance bypass (home-poller only)

Calls a Byparr sidecar (`http://staktrakr-byparr:8191`) to solve Cloudflare challenges. Home-poller-only component — not available on Fly.io.

---

## Tiered Recovery (T1-T4) — Archival Context

> **Archival context:** Tiered recovery was relevant when Fly.io ran retail scraping. Now that retail is on the Home Poller, these tiers apply there instead. T4 (Turso last-known-good) still applies in `api-export.js` on Fly.io during the publish step.

| Tier | Method                               | Current Status                                                              |
| ---- | ------------------------------------ | --------------------------------------------------------------------------- |
| T1   | Tailscale exit node (residential IP) | Inactive on Fly.io — no retail scraping                                     |
| T2   | Fly.io datacenter IP fallback        | Inactive — no retail scraping                                               |
| T3   | `:15` cron retry of failed SKUs      | Disabled (`RETAIL_ENABLED=0`)                                               |
| T4   | Turso last-known-good price fill     | **Active** — `api-export.js` still fills stale vendor slots at publish time |

---

## Environment Variables

### Active (Slim Image)

| Variable                            | Source                                    | Purpose                                                                              |
| ----------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `POLLER_ID`                         | `fly.toml` (hardcoded `api`)              | Written to sqld rows to identify this poller                                         |
| `API_EXPORT_DIR` / `DATA_REPO_PATH` | `fly.toml` (`/data/staktrakr-api-export`) | Working copy of StakTrakrApi repo                                                    |
| `GITHUB_TOKEN`                      | Fly secret                                | Push to `api` branch via `run-publish.sh`                                            |
| `TURSO_DATABASE_URL`                | Fly secret                                | sqld on Home VM (`http://192.168.1.81:8080` via Tailscale subnet route)              |
| `TURSO_AUTH_TOKEN`                  | Fly secret                                | Empty — sqld has no auth by default                                                  |
| `METAL_PRICE_API_KEY`               | Fly secret                                | Spot price API (MetalPriceAPI)                                                       |
| `TS_AUTHKEY`                        | Fly secret                                | Tailscale reusable ephemeral auth key (also in Infisical as `FLY_TAILSCALE_AUTHKEY`) |

### Legacy / Full-Image Environment

These variables were used by the full retail+goldback image before STAK-478. They are not scheduled or used in slim mode — the slim Dockerfile copies only `run-spot.sh` and `run-publish.sh`.

| Variable             | Source                               | Notes                                                                                                                                                 |
| -------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RETAIL_ENABLED`     | Fly secret                           | Set to `0` — retail + retry crons not scheduled in slim mode                                                                                          |
| `GOLDBACK_ENABLED`   | Fly secret                           | Not scheduled in slim mode — slim Dockerfile copies only `run-spot.sh` and `run-publish.sh`. Goldback data comes via sqld from Home Poller (STAK-491) |
| `VISION_ENABLED`     | Fly secret                           | `0` — vision pipeline not available in slim image                                                                                                     |
| `GEMINI_API_KEY`     | Fly secret                           | Not used in slim image (vision pipeline removed)                                                                                                      |
| `FIRECRAWL_BASE_URL` | `fly.toml` (`http://localhost:3002`) | Not used — no Firecrawl in slim image                                                                                                                 |
| `BROWSER_MODE`       | `fly.toml` (`local`)                 | Not used — no Playwright in slim image                                                                                                                |
| `PLAYWRIGHT_LAUNCH`  | `fly.toml` (`1`)                     | Not used — no Playwright in slim image                                                                                                                |
| `HOME_PROXY_URL`     | `fly.toml` (empty)                   | Not needed — no retail scraping                                                                                                                       |

See Secret Keys for rotation procedures and secret stores.

---

## Deployment

All poller code lives in **StakTrakr** at `devops/pollers/`. The build context must be `devops/pollers/` (parent directory). **Do not run `fly deploy` from `remote-poller/`** — the `context = ".."` in fly.toml does not resolve correctly with Depot or Docker Desktop.

```bash
# Deploy from StakTrakr repo (MUST run from pollers/ dir)
cd /Volumes/DATA/GitHub/StakTrakr/devops/pollers
fly deploy --config remote-poller/fly.toml --dockerfile remote-poller/Dockerfile

# After deploy, verify cron schedule
fly ssh console --app staktrakr -C "cat /etc/cron.d/retail-poller"

# Watch logs
fly logs --app staktrakr
fly logs --app staktrakr | grep -E 'publish|spot|ERROR'

# Verify Tailscale connectivity (needed for sqld access)
fly ssh console --app staktrakr -C "tailscale status"
```

**Code changes** require `fly deploy`. **Provider URL changes** do not — pollers read from sqld on each run. Use the dashboard at `http://192.168.1.81:3010/providers` or `provider-db.js` CRUD functions.

> **Migration note (2026-03-07):** Fly.io code was previously deployed from `StakTrakrApi/devops/fly-poller/`. All code has been consolidated into `StakTrakr/devops/pollers/` with shared JS in `shared/` and Fly-specific files in `remote-poller/`.

---

## Volume and Git Repo

The persistent volume at `/data/staktrakr-api-export` is a clone of `StakTrakrApi` on the `api` branch. `run-publish.sh` expects a pre-existing git repo on the mounted volume — it exits with an error if `.git` is missing. The repo must be seeded manually on first deploy. After that it persists across deploys.

`run-publish.sh` commits from this directory and force-pushes `HEAD:api`. This is the **sole Git writer** for the `api` branch data files.

Tailscale state lives at `/data/tailscale/tailscaled.state` — also on the persistent volume, so node identity survives redeploys without re-registering in the Tailscale admin console.

---

## Common Issues

| Symptom                      | Check                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Services not running         | `fly ssh console --app staktrakr -C "supervisorctl status"`                                                                    |
| Spot prices stale            | Check `run-spot.sh` cron in logs; verify `METAL_PRICE_API_KEY` is set                                                          |
| Publish not pushing          | Check `run-publish.sh` logs; verify `GITHUB_TOKEN` is set; check git repo at `/data/staktrakr-api-export`                      |
| Goldback stale               | Verify Home Poller goldback cron is running and writing to sqld; check `api-export.js` logs for `goldback-g1`                  |
| Tailscale not connecting     | `tailscale status` in container; check `TS_AUTHKEY` is valid; verify subnet route approved in admin console                    |
| Volume not mounted           | `fly volumes list --app staktrakr`; verify `staktrakr_data` exists                                                             |
| Git push rejected in publish | Run `git fetch origin api && git rebase origin/api` inside the volume                                                          |
| OOM despite 1GB              | Concurrent processes — check if idle services (Firecrawl, Postgres) are consuming memory; future slim Dockerfile will fix this |
| Deploy context "2B" error    | Run from `devops/pollers/` dir, not `remote-poller/`; use `--config` and `--dockerfile` flags                                  |

---

## Related

- Home Poller — retail + goldback scraping, dashboard, metrics
- Poller Parity (deprecated DocVault page) -- scrape pipeline comparison between pollers
- Cloud - Fly.io -- Fly.io platform reference, deploy workflow
- Architecture -- system diagram, repo boundaries, data feeds
- API Reference -- REST endpoint documentation
- Secret Keys -- environment variables and rotation procedures
- Health Checks -- diagnosing cron and poller issues
- Portainer -- home VM container management

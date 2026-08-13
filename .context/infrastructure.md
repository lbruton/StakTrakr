---
title: "StakTrakr — Infrastructure"
project: StakTrakr
audience: agent
canonical: .context/infrastructure.md
source: "DocVault/Projects/StakTrakr/Foundation/infrastructure.md" # migrated 2026-08-12
updated: "2026-06-28"
---

# StakTrakr — Infrastructure

Authoritative reference for all infrastructure components. For deep dives, follow the wikilinks to the source documents.

---

## Deployment Topology

```text
┌─────────────────────────────────────────────────────────┐
│  Fly.io — Thin Publisher (staktrakr, dfw, 1024MB)        │
│  spot polling + data export + HTTP health endpoint       │
│                                                          │
│  run-spot.sh (0,30 * * * *)                              │
│  run-publish.sh (8,23,38,53 * * * *)                     │
│  export-providers-json.js (*/5 * * * *)                  │
└──────────────────┬───────────────────────────────────────┘
                   │ Tailscale subnet route (192.168.1.0/24)
                   │ sqld reads via http://192.168.1.81:8080
                   ▼
┌─────────────────────────────────────────────────────────┐
│  Home VM — Ubuntu 24.04 LXC (192.168.1.81)              │
│  Portainer: https://192.168.1.81:9443                    │
│                                                          │
│  staktrakr-sqld        → sqld (libSQL, port 8080)        │
│  staktrakr-home-poller → retail + spot + goldback        │
│  staktrakr-byparr      → CF bypass sidecar (port 8191)   │
│  firecrawl-api         → Firecrawl self-hosted (3002)    │
│  tailscale-staktrakr   → exit node + subnet router       │
│  tinyproxy-staktrakr   → residential HTTP proxy (8888)   │
└──────────────────┬───────────────────────────────────────┘
                   │ run-publish.sh force-pushes HEAD:api
                   ▼
       StakTrakrApi — api branch
                   │
                   ▼ GitHub Pages
       api.staktrakr.com  (static JSON API)
                   │
                   ▼
       StakTrakr frontend — Cloudflare Pages
```

**Division of responsibility (post STAK-478):**

| Responsibility              | Fly.io                     | Home Poller                 |
| --------------------------- | -------------------------- | --------------------------- |
| Retail scraping             | No                         | Yes (sole scraper)          |
| Goldback scraping           | No                         | Yes (sole scraper, daily)   |
| Spot price polling          | Yes (`:00, :30`)           | Yes (`:15, :45`, staggered) |
| Data export to GitHub Pages | Yes (sole Git writer)      | No                          |
| Database                    | Reads only (via Tailscale) | Writes (co-located)         |

---

## Fly.io Remote Poller (Thin Publisher)

Source: .context/deep-dives/remote-poller.md

### Machine Configuration

Values verified against `devops/pollers/remote-poller/fly.toml` (authoritative):

| Property                    | Value                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| App name                    | `staktrakr`                                                                                                                     |
| Region                      | `dfw` (machine + volume pinned; `primary_region` is decorative)                                                                 |
| Memory                      | `1024` MB (raised from 512 on 2026-07-25, STRK-277 — see below. Profiled 2026-04-11 at 512: idle ~250 MB, publish peak <400 MB) |
| CPU                         | 1 shared                                                                                                                        |
| Volume name                 | `staktrakr_data`                                                                                                                |
| Volume size                 | `3` GB (extended 1→3 GB 2026-06-11 after inode exhaustion outage, STRK-187)                                                     |
| Volume mountpoint           | `/data`                                                                                                                         |
| Internal HTTP port          | `8080` (force HTTPS via Fly proxy)                                                                                              |
| HTTP concurrency soft limit | `200` requests                                                                                                                  |
| HTTP concurrency hard limit | `250` requests                                                                                                                  |
| `auto_stop_machines`        | `off`                                                                                                                           |
| `min_machines_running`      | `1`                                                                                                                             |
| `POLLER_ID`                 | `api`                                                                                                                           |

### Persistent Volume Contents

| Path                               | Purpose                                                   |
| ---------------------------------- | --------------------------------------------------------- |
| `/data/staktrakr-api-export`       | Clone of `StakTrakrApi` on `api` branch (sole Git writer) |
| `/data/tailscale/tailscaled.state` | Tailscale node identity (survives redeploys)              |

The Git repo at `/data/staktrakr-api-export` must be seeded manually on first deploy. It persists across subsequent deploys on the same volume.

**Git memory caps (2026-06-11, STRK-187 incident):** uncapped git OOM-dies on the 512 MB machine (gc, fetch, and push pack-objects were all killed with signal 9). The repo config in `/data/staktrakr-api-export` sets `pack.threads=1`, `pack.windowMemory=32m`, `pack.deltaCacheSize=16m`, and `gc.auto=0`. Re-apply these after any re-clone or volume re-seed. History was reset to an orphan commit on 2026-06-11. **Self-cleaning shipped in STRK-187 (2026-06-13):** a weekly `cleanup-export.sh` (Sun 03:17 UTC) runs a retention sweep — pruning `data/15min` day-dirs older than 90 days and `data/hourly` day-dirs older than 365 days (path-derived dates, not mtime, so a re-clone can't defeat it) — then memory-capped git maintenance (`git reflog expire --all → git repack -a -d --threads=1 --window-memory=32m → git prune → git pack-refs`; never `git gc`, which OOMs on the 512 MB machine). `run-publish.sh` runs the same `cleanup-export.sh` inline as a pre-flight backstop when the volume drops below 25000 free inodes or 300 MB free.

**VM wedge → 1024 MB (2026-07-25, STRK-277 incident):** the machine wedged with `fly machine status` still reporting `State: started, HostStatus: ok` while HTTP _and_ `fly ssh console` both hung and logs went silent. The machine event log is the discriminator — `oom_killed=false, requested_stop=true` proves the VM itself never crashed, only a process inside it. Logs showed `monitor: time jump detected (slept 28s)` as the freeze marker. The publish cron stalled 00:53–02:15 UTC. Recovery required `fly machine stop --signal SIGKILL` then `start`; a plain restart held for only ~6 minutes. Memory was raised 512 → 1024 MB as mitigation on the strongest available hypothesis (~100 MB headroom left no room for git pack spikes). **This is a mitigation, not a confirmed root cause** — SSH was dead, so actual memory pressure was never observed directly. Evidence since: 5 consecutive on-schedule publish cycles at 1024 MB vs. a re-wedge within ~6 minutes at 512 MB. If it wedges again at 1024 MB, the cause is something else.

**Deploy window:** with crons at spot `0,30`, publish `8,23,38,53`, and provider-export `*/5`, the `:08:30 → :23:00` gap is the only 15-minute stretch per hour containing no spot cron — deploy there. A full `fly deploy` takes ~2 minutes. The `app is not listening on 0.0.0.0:8080` warning Fly prints at the end is a benign race (it checks before supervisord starts `serve.js`); verify with a real `curl`, not the warning.

### Supervisord Services (slim image)

| Service        | Command                                              | Notes                                                  |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| `tailscaled`   | `tailscaled --state=/data/tailscale/...`             | Provides subnet routing to home LAN for sqld access    |
| `tailscale-up` | `tailscale up --authkey=... --accept-routes --reset` | One-shot auth at startup                               |
| `cron`         | `cron -f`                                            | Runs spot + publish + provider export + weekly cleanup |
| `http-server`  | `node /app/serve.js` on port 8080                    | Health/proxy endpoint                                  |

### Cron Schedule (Remote Poller)

Written by `docker-entrypoint-slim.sh` at container start:

| Schedule             | Script                          | Log                            | Status                                   |
| -------------------- | ------------------------------- | ------------------------------ | ---------------------------------------- |
| `0,30 * * * *`       | `/app/run-spot.sh`              | `/var/log/spot-poller.log`     | Active                                   |
| `8,23,38,53 * * * *` | `/app/run-publish.sh`           | `/var/log/publish.log`         | Active                                   |
| `*/5 * * * *`        | `node export-providers-json.js` | `/var/log/provider-export.log` | Active                                   |
| `17 3 * * 0`         | `/app/cleanup-export.sh`        | `/var/log/cleanup.log`         | Active (weekly, Sun 03:17 UTC, STRK-187) |
| ~~`CRON_SCHEDULE`~~  | ~~`run-local.sh`~~              | —                              | Disabled (`RETAIL_ENABLED=0`)            |
| ~~`15 * * * *`~~     | ~~`run-retry.sh`~~              | —                              | Disabled                                 |
| ~~`1 * * * *`~~      | ~~`run-goldback.sh`~~           | —                              | Disabled (`GOLDBACK_ENABLED=0`)          |

### Publish Pipeline (`run-publish.sh`)

Runs 4x/hour. Lockfile-guarded (`/tmp/retail-publish.lock`, atomic `noclobber`). Sequence (STRK-187 rewrote this — it is **no longer** a blind `add && commit && push`):

1. **Pre-flight space backstop (STRK-187)** — if `/data` has < 25000 free inodes or < 300 MB free, runs `cleanup-export.sh` inline (`CLEANUP_SKIP_LOCK=1`, lock already held) before exporting. Still below floor after cleanup → logs CRITICAL and publishes anyway.
2. `api-export.js` — reads `price_snapshots` from sqld, generates all v1 JSON endpoints under `data/api/` and `data/hourly/`
3. `api-export-v2.js` (STAK-503) — generates v2 endpoints under `data/v2/` (non-fatal; v1 continues if v2 throws)
4. `git add data/` — stages adds **and deletions** (the retention sweep relies on `git add` staging tracked-file deletions; do not "fix" this). Exits early if nothing is staged and nothing is unpushed.
5. **Verify-then-push freshness gate (STRK-187)** — fetches `http://localhost:8080/data/api/manifest.json` (api2 / `serve.js`, the by-design primary), requires a parseable `generated_at`; when this cycle staged exports, rejects a manifest older than **30 min** (`exit 1`, no push). api2 stays fresh regardless — only the published GitHub Pages feed waits for a later cycle. (A push-only retry cycle skips the freshness check, since it legitimately re-pushes an older-but-verified manifest.)
6. **`git commit` — only after the gate passes** (STRK-187 fix `1a8bffc2`). Committing _before_ the gate left an unpushed local commit on any gate `exit 1`; the next push-only cycle would skip the freshness check and force-push that stale commit. The commit lives behind the gate so a rejected cycle leaves nothing to resurrect.
7. `git push --force "$REMOTE" HEAD:api`, where `$REMOTE` = `https://<GITHUB_TOKEN>@github.com/lbruton/StakTrakrApi.git` — sole writer to `api` (push to `api`, never `main`). Push failure logs an isolated error and `exit 1` (api2 remains fresh; only the published feed goes stale until a later cycle succeeds).

### Fly.io Environment Variables (Active)

| Variable                                  | Source                                       | Purpose                                                                                                                                                                                                                                                        |
| ----------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POLLER_ID`                               | `fly.toml` (hardcoded `api`)                 | Identifies this poller in sqld rows                                                                                                                                                                                                                            |
| `API_EXPORT_DIR` / `DATA_REPO_PATH`       | `fly.toml` (`/data/staktrakr-api-export`)    | Working copy of StakTrakrApi                                                                                                                                                                                                                                   |
| `GITHUB_TOKEN`                            | Fly secret                                   | Push to `api` branch                                                                                                                                                                                                                                           |
| `SQLD_URL`                                | Fly secret                                   | `http://192.168.1.81:8080` (via Tailscale subnet route) — primary DB                                                                                                                                                                                           |
| `SQLD_AUTH_TOKEN`                         | Fly secret                                   | Empty — sqld has no auth                                                                                                                                                                                                                                       |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | **Set as Fly secrets** (verified 2026-08-13) | Read only if `SQLD_URL` is unset. Both exist in `fly secrets list --app staktrakr`; `TURSO_DATABASE_URL`'s digest is identical to `SQLD_URL`'s, so it currently mirrors the same target. Self-hosters pointing at Turso Cloud use these instead of `SQLD_URL`. |
| `METAL_PRICE_API_KEY`                     | Fly secret                                   | MetalPriceAPI spot prices                                                                                                                                                                                                                                      |
| `TS_AUTHKEY`                              | Fly secret                                   | Tailscale ephemeral reusable auth key                                                                                                                                                                                                                          |

Legacy full-image variables (`RETAIL_ENABLED`, `GOLDBACK_ENABLED`, `VISION_ENABLED`, `GEMINI_API_KEY`, `FIRECRAWL_BASE_URL`, `PLAYWRIGHT_LAUNCH`, `HOME_PROXY_URL`) are present in `fly.toml` env block but inactive in the slim image.

### Fly.io Deployment

```bash
# MUST run from devops/pollers/ — context = ".." in fly.toml does not resolve from remote-poller/
cd /Volumes/DATA/GitHub/StakTrakr/devops/pollers
fly deploy --config remote-poller/fly.toml --dockerfile remote-poller/Dockerfile
```

Rollback to full image: `cp Dockerfile.full Dockerfile && fly deploy` (same flags).

---

## Home Poller (Docker / Portainer)

Source: .context/deep-dives/home-poller.md

### Docker Stacks

All stacks run on `staktrakr-net` bridge network. Managed via Portainer at `https://192.168.1.81:9443`.

| Stack       | Container(s)                                  | Purpose                                                                                                                                                                                                                        | Ports                                     | Stack ID |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | -------- |
| home-poller | `staktrakr-home-poller`                       | Retail/spot/goldback + dashboard + metrics                                                                                                                                                                                     | 3010 (HTTP), 3011 (HTTPS), 9100 (metrics) | 7        |
| byparr      | `staktrakr-byparr`                            | CF bypass sidecar (Camoufox Firefox → `cf_clearance` cookie)                                                                                                                                                                   | 8191                                      | —        |
| firecrawl   | `firecrawl-api` + workers                     | Self-hosted Firecrawl web scraping engine                                                                                                                                                                                      | 3002                                      | 4        |
| tinyproxy   | `tailscale-staktrakr` + `staktrakr-tinyproxy` | Combined stack (`docker-compose.tinyproxy.yml`): Tailscale exit node + subnet router for `192.168.1.0/24`, plus the residential HTTP proxy that shares its network namespace via `network_mode: container:tailscale-staktrakr` | 8888 (Tailscale IPs only)                 | 5        |
| sqld        | `staktrakr-sqld`                              | Self-hosted libSQL primary database (port 8080)                                                                                                                                                                                | 8080 (Docker DNS + Tailscale subnet)      | 23       |

**Docker install:** snap-installed. Volume mountpoint: `/var/snap/docker/common/var-lib-docker/volumes/`

### Home Poller Supervisord Services

| Service            | Purpose                                                      |
| ------------------ | ------------------------------------------------------------ |
| `cron`             | Retail, spot, goldback, provider export, Fly.io health check |
| `dashboard`        | Provider editor + status UI (HTTP 3010, HTTPS 3011)          |
| `metrics-exporter` | Prometheus metrics (port 9100)                               |

### Cron Schedule (Home Poller)

Verified against `devops/pollers/home-poller/docker-entrypoint.sh` (authoritative):

| Schedule                             | Script                                                    | Log                              |
| ------------------------------------ | --------------------------------------------------------- | -------------------------------- |
| `30 * * * *`                         | `/app/run-home.sh` (retail scrape)                        | `/data/logs/retail-poller.log`   |
| `15,45 * * * *`                      | `node /app/spot-extract.js` (POLLER_ID=home-spot)         | `/data/logs/spot-poller.log`     |
| `5 * * * *` (hourly at :05, STRK-58) | `node goldback-scraper.js`                                | `/data/logs/goldback-poller.log` |
| `*/5 * * * *`                        | `node export-providers-json.js`                           | `/data/logs/provider-export.log` |
| `*/5 * * * *`                        | `/app/check-flyio.sh`                                     | `/data/logs/flyio-check.log`     |
| `0 3 * * *` (nightly, 03:00 UTC)     | `node /app/turso-backup-sync.js` (DR sync to Turso Cloud) | `/data/logs/turso-sync.log`      |

Retail runs at `:30` (staggered from Fly.io spot at `:00/:30`). Spot runs at `:15/:45` (staggered from Fly.io spot at `:00/:30`). Goldback runs hourly at `:05` (STRK-58) — the CurrencyLayer-backed rate can shift intraday.

### Scraping Pipeline (3-Phase Cascade)

`shared/price-extract.js` — for vendors with `cf_clearance_fallback: true` in `PROVIDER_CONFIG`:

| Phase | Method                                               | Triggers When                    |
| ----- | ---------------------------------------------------- | -------------------------------- |
| 0     | Playwright direct (local Chromium)                   | Always first                     |
| 1     | Firecrawl (self-hosted, `http://firecrawl-api:3002`) | Phase 0 fails or returns empty   |
| 2     | CF sidecar Byparr (`http://staktrakr-byparr:8191`)   | Phase 0 + 1 both return no price |

Phase 2 uses Byparr's already-fetched HTML (avoids TLS fingerprint mismatch from re-requesting with Chromium after Firefox solved the CF challenge).

### Key Paths (Inside Container)

| Path                      | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| `/app/`                   | All poller scripts (shared + home-specific)        |
| `/data/`                  | Persistent Docker volume (`staktrakr-poller-data`) |
| `/data/logs/`             | All log files (persistent)                         |
| `/etc/cron.d/home-poller` | Cron schedule (written by entrypoint at startup)   |

### Home Poller Environment Variables

Injected via Portainer stack env (must be passed on every git-based redeploy):

| Variable                                  | Required       | Value / Notes                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SQLD_URL`                                | Yes            | `http://staktrakr-sqld:8080` (Docker DNS) — primary DB                                                                                                                                                                                                                                                                                       |
| `SQLD_AUTH_TOKEN`                         | No             | Empty                                                                                                                                                                                                                                                                                                                                        |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Conditional    | **Not required for the home stack** — `docker-compose.home.yml` declares them optional (`${...:-}`) and `SQLD_URL` is the primary DB config. Read only if `SQLD_URL` is unset; self-hosters on Turso Cloud set these instead. (They _are_ set as Fly secrets, but that is a separate environment — do not copy credentials between the two.) |
| `TURSO_BACKUP_URL`                        | Yes            | Turso Cloud DR target URL                                                                                                                                                                                                                                                                                                                    |
| `TURSO_BACKUP_TOKEN`                      | Yes            | Turso Cloud auth token (DR sync only)                                                                                                                                                                                                                                                                                                        |
| `METAL_PRICE_API_KEY`                     | Yes            | MetalPriceAPI                                                                                                                                                                                                                                                                                                                                |
| `POLLER_ID`                               | Set in compose | `home`                                                                                                                                                                                                                                                                                                                                       |
| `DATA_DIR`                                | Set in compose | `/data`                                                                                                                                                                                                                                                                                                                                      |
| `FIRECRAWL_BASE_URL`                      | Yes            | `http://firecrawl-api:3002`                                                                                                                                                                                                                                                                                                                  |
| `FLYIO_TAILSCALE_IP`                      | Yes            | `100.90.171.110`                                                                                                                                                                                                                                                                                                                             |
| `FLYIO_HTTP_URL`                          | Yes            | `https://api2.staktrakr.com/data/retail/providers.json`                                                                                                                                                                                                                                                                                      |
| `CF_CLEARANCE_SCRAPER_URL`                | No             | Defaults to `http://staktrakr-byparr:8191`                                                                                                                                                                                                                                                                                                   |
| `CF_CLEARANCE_ENABLED`                    | No             | `1` to enable Phase 2 (default), `0` to disable                                                                                                                                                                                                                                                                                              |
| `GEMINI_API_KEY`                          | No             | Enables vision pipeline                                                                                                                                                                                                                                                                                                                      |
| `VISION_ENABLED`                          | No             | `1` to enable                                                                                                                                                                                                                                                                                                                                |
| `MB_API_KEY`                              | No             | MintBuilder direct price feed key (STRK-321) — unset = page-scrape fallback. Compose-declared + cron re-export required (see .context/deep-dives/home-poller.md)                                                                                                                                                                             |

### Home Poller Deployment

```bash
# 1. Push code changes
git push origin <branch>

# 2. Redeploy via Portainer API (stack ID 7, endpoint 3)
curl -sk -X PUT \
  "https://192.168.1.81:9443/api/stacks/7/git/redeploy?endpointId=3" \
  -H "X-API-Key: $PORTAINER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pullImage": true, "prune": true, "env": [...]}'
```

**Critical:** Always pass the full `env` array on redeploy — Portainer does not persist env vars across git-based redeployments.

### Tailscale Network Topology

| Node                                | Tailscale IP     | Role                                         |
| ----------------------------------- | ---------------- | -------------------------------------------- |
| `stacktrckr-home` (home VM sidecar) | `100.112.198.50` | Exit node + subnet router (`192.168.1.0/24`) |
| `staktrakr-fly` (Fly.io container)  | `100.90.171.110` | Client (`--accept-routes`)                   |

The tinyproxy container shares the Tailscale sidecar's network namespace (`network_mode: container:tailscale-staktrakr`). Fly.io routes outbound scraper traffic through tinyproxy (`http://100.112.198.50:8888`) for residential IP egress.

> Gotcha (mitigated): The upstream Tailscale `containerboot` entrypoint drops `TS_ROUTES` from prefs on restart when the persistent state volume is present, silently breaking Fly.io→sqld reads. The sidecar now uses a wrapper image at `devops/pollers/tailscale/` that backgrounds containerboot and re-applies `tailscale set --advertise-routes=192.168.1.0/24 --advertise-exit-node` on every start (STRK-6). If the route ever disappears again, check the wrapper logs (`[tailscale-wrapper]` lines in `docker logs tailscale-staktrakr`) and confirm Portainer rebuilt the image on the last redeploy.

---

## Database

| Component                    | Role                                         | Location            | Access                                                                                     |
| ---------------------------- | -------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------ |
| `staktrakr-sqld`             | Primary database (libSQL / sqld self-hosted) | Home VM port `8080` | Docker DNS: `http://staktrakr-sqld:8080`; Fly.io via Tailscale: `http://192.168.1.81:8080` |
| Turso Cloud (`staktrakrapi`) | DR backup only (nightly sync from sqld)      | AWS us-east-2       | libsql://staktrakrapi-lbruton.aws-us-east-2.turso.io                                       |

The home-poller container connects to sqld via Docker DNS. Fly.io connects via Tailscale subnet routing. The `TURSO_AUTH_TOKEN` is empty on sqld (no auth by default).

DR sync runs nightly at 03:00 UTC via `turso-backup-sync.js` on the home poller.

---

## Data Feeds

| Feed          | File                             | Writer                                                                            | Cadence                                                    |
| ------------- | -------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Market prices | `data/api/manifest.json`         | Home poller scrapes at `:30` → sqld; Fly.io publishes at `:08/:23/:38/:53`        | Hourly scrape, 4×/hr publish                               |
| Spot prices   | `data/hourly/YYYY/MM/DD/HH.json` | Fly.io `run-spot.sh` + `spot-extract.js` → sqld + JSON                            | `0,30 * * * *`                                             |
| Goldback      | `data/api/goldback-spot.json`    | Home poller `goldback-scraper.js` hourly → sqld; Fly.io reads every publish cycle | Hourly scrape, republished 4×/hr with fresh `generated_at` |

---

## Frontend Hosting

| Component       | Platform                                      | URL                 |
| --------------- | --------------------------------------------- | ------------------- |
| Frontend app    | Cloudflare Pages                              | `staktrakr.com`     |
| Static JSON API | GitHub Pages (`api` branch of `StakTrakrApi`) | `api.staktrakr.com` |

The `api` branch is force-pushed exclusively by `run-publish.sh` on Fly.io. The `Merge Poller Branches` GitHub Actions workflow is retired (manual-only).

---

## Health Check Thresholds

Source: .context/deep-dives/health-checks.md

### Stale Thresholds (Operational)

| Feed                             | Stale at | Critical at | Notes                                                                   |
| -------------------------------- | -------- | ----------- | ----------------------------------------------------------------------- |
| Market prices (`manifest.json`)  | 30 min   | 4 hours     |                                                                         |
| Spot prices — UI freshness badge | 20 min   | —           | `api-health.js` hardcoded threshold                                     |
| Spot prices — operational        | 75 min   | 3 hours     | Used by health-check scripts                                            |
| Goldback                         | 2 hours  | 48 hours    | v2 envelope `stale_after` 7200 s (STRK-248); scrape is hourly (STRK-58) |

### v2 `stale_after` Envelope Values

v2 endpoints embed their freshness threshold in the response envelope:

| Type     | `stale_after` (seconds) | Equivalent                             |
| -------- | ----------------------- | -------------------------------------- |
| Spot     | 1200                    | 20 min                                 |
| Retail   | 1800                    | 30 min                                 |
| Goldback | 7200                    | 2 h (was 90000 / 25 h before STRK-248) |
| Manifest | 1800                    | 30 min                                 |

When `USE_V2_API` is enabled, `api-health.js` reads `stale_after` from the v2 envelope instead of hardcoded constants.

### Publish-Freshness Watchdog (STRK-187)

The 2026-06-11 outage was invisible for ~7h because nothing watched the published manifest's age — HTTP and sqld checks stayed green while publishing was frozen. `check-flyio.sh` (home poller, `*/5 * * * *`) now also monitors publish freshness:

- Fetches `generated_at` from **both** `api.staktrakr.com` (published / GitHub Pages) and `api2.staktrakr.com` (`serve.js`, reads the export dir directly).
- Threshold: `PUBLISH_FRESH_MAX_MIN` (default **45** min).
- Writes 6 fields to `/tmp/flyio-health.json`: `published_fresh_ok`, `published_age_min`, `api2_fresh_ok`, `api2_age_min`, `publish_fresh_last_success` (carried forward on FAIL so the dashboard can render "Xm ago" elapsed time), plus `published_manifest_url`.
- The dashboard (`dashboard.js`) distinguishes **PUSH STALE** (api2 fresh, published stale → git push broken) from **STALE** (both stale → publish pipeline broken).

### Quick Health Check (CLI)

```python
python3 << 'EOF'
import urllib.request, json, re
from datetime import datetime, timezone, timedelta

def age_min(ts):
    ts = ts.strip()
    if not re.search(r'[zZ]$|[+-]\d{2}:?\d{2}$', ts):
        ts = ts.replace(' ', 'T') + 'Z'
    return (datetime.now(timezone.utc) - datetime.fromisoformat(ts.replace('Z','+00:00'))).total_seconds()/60

def fetch(url):
    with urllib.request.urlopen(url, timeout=10) as r: return json.load(r)

print(f"API Health — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n")
try:
    d = fetch('https://api.staktrakr.com/data/api/manifest.json')
    age = age_min(d['generated_at'])
    print(f"Market   {'OK' if age<=30 else 'WARN'}  {age:.0f}m ago  ({len(d.get('coins',[]))} coins)")
except Exception as e: print(f"Market   FAIL  {e}")
try:
    now = datetime.now(timezone.utc)
    def url(dt): return f"https://api.staktrakr.com/data/hourly/{dt.year}/{dt.month:02d}/{dt.day:02d}/{dt.hour:02d}.json"
    try: d = fetch(url(now))
    except: d = fetch(url(now - timedelta(hours=1)))
    age = age_min(d[-1]['timestamp'])
    print(f"Spot     {'OK' if age<=75 else 'WARN'}  {age:.0f}m ago")
except Exception as e: print(f"Spot     FAIL  {e}")
try:
    d = fetch('https://api.staktrakr.com/data/api/goldback-spot.json')
    age = age_min(d['scraped_at'])
    print(f"Goldback {'OK' if age<=1500 else 'WARN'}  {age/60:.1f}h ago  (${d.get('g1_usd')} G1)")
except Exception as e: print(f"Goldback FAIL  {e}")
EOF
```

### Database Freshness Check

```bash
curl -s http://192.168.1.81:8080/v2/pipeline -H 'Content-Type: application/json' -d '{
  "requests": [{"type":"execute","stmt":{"sql":"SELECT poller_id, COUNT(*) as rows, MAX(scraped_at) as latest FROM price_snapshots WHERE scraped_at > datetime('"'"'now'"'"', '"'"'-2 hours'"'"') GROUP BY poller_id"}}]
}' | jq '.results[0].response.result.rows'
```

Expected: rows from `home` (retail), `home-spot` (home spot), `fly-spot` (Fly.io spot) within the last 2 hours.

> **`POLLER_ID` gotcha:** Fly.io's `fly.toml` sets `POLLER_ID=api`, but `run-spot.sh:26` locally overrides it to `fly-spot` for the spot insert — so the same machine writes spot rows as `fly-spot` while publish/provider-export identify as `api`. Query for `fly-spot`, not `api`, when checking Fly.io spot freshness.

---

## Secret Keys Inventory

Source: .context/deep-dives/secret-keys.md

Three secret stores:

| Store                                               | Used by                                 |
| --------------------------------------------------- | --------------------------------------- |
| Fly.io secrets (`fly secrets`)                      | Fly.io container — all runtime secrets  |
| Infisical (`stak-trakr-94m4`, env: `dev`)           | Local dev, agent contexts               |
| Portainer stack env (via `docker-compose.home.yml`) | Home poller — injected on each redeploy |

### Fly.io Secrets (Active)

| Secret                                    | Purpose                                                                                                                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`                            | Push to `api` branch (`contents: write` on `StakTrakrApi`)                                                                                                                                          |
| `SQLD_URL`                                | sqld URL (`http://192.168.1.81:8080` via Tailscale) — primary DB                                                                                                                                    |
| `SQLD_AUTH_TOKEN`                         | sqld auth (empty — kept for client compat)                                                                                                                                                          |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | **Deployed Fly secrets** (verified 2026-08-13) — not unset, as this table previously claimed. Fallback read only if `SQLD_URL` is unset; `TURSO_DATABASE_URL` currently shares `SQLD_URL`'s digest. |
| `METAL_PRICE_API_KEY`                     | Spot price API (MetalPriceAPI)                                                                                                                                                                      |
| `TS_AUTHKEY`                              | Tailscale reusable ephemeral auth key (also in Infisical as `FLY_TAILSCALE_AUTHKEY`)                                                                                                                |
| `GEMINI_API_KEY`                          | Vision pipeline (inactive in slim image by default)                                                                                                                                                 |
| `VISION_ENABLED`                          | Vision pipeline gate (`1` = on)                                                                                                                                                                     |

### Infisical

- **Project:** StakTrakr
- **Project ID:** `319a1db5-207d-49d0-a61d-3f3e6b440ded`
- **Slug:** `stak-trakr-94m4`
- **Environment:** `dev` (production env is empty — all secrets in `dev`)

Mirrors all Fly.io secrets plus additional dev-only keys. Access via `mcp__infisical__*` or `infisical` CLI.

### Home Docker Environment (Key Vars)

```text
# Primary DB — Option A (our deploy): local sqld
SQLD_URL=http://staktrakr-sqld:8080
SQLD_AUTH_TOKEN=

# Option B (self-hosters without sqld): Turso Cloud primary — leave unset in our deploy
# TURSO_DATABASE_URL=libsql://your-db.turso.io
# TURSO_AUTH_TOKEN=<turso-auth-token>

# Turso Cloud DR backup — independent of primary DB choice
TURSO_BACKUP_URL=libsql://staktrakrapi-lbruton.aws-us-east-2.turso.io
TURSO_BACKUP_TOKEN=<turso-cloud-token>

POLLER_ID=home
DATA_DIR=/opt/poller/data
```

---

## CI/CD

### GitHub Actions (StakTrakrApi)

| Workflow                | Status                | Purpose                                |
| ----------------------- | --------------------- | -------------------------------------- |
| `Merge Poller Branches` | Retired / manual-only | Previously merged poller data branches |
| `spot-poller.yml`       | Retired / manual-only | Previously ran spot polling via GHA    |

The `api` branch is now written directly by `run-publish.sh` on Fly.io. No GHA workflows are in the active publish path.

### Pre-commit Hooks (StakTrakr)

- Pre-commit guard for gitignored `CLAUDE.md` (commit `65fe6e22`)
- Standard linting (see `.pre-commit-config.yaml` if present)

### Deployment Paths by Change Type

| Change type                      | Action                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Fly.io code change               | `cd devops/pollers && fly deploy --config remote-poller/fly.toml --dockerfile remote-poller/Dockerfile` |
| Home poller code change          | Push to git branch + Portainer API redeploy (stack ID 7)                                                |
| Provider URL fix                 | Dashboard at `http://192.168.1.81:3010/providers` — no redeploy needed                                  |
| New Fly.io secret                | `fly secrets set KEY=value --app staktrakr`                                                             |
| Home poller env var              | Pass updated `env` array on next Portainer redeploy                                                     |
| GHA workflow                     | Push to `main` on `StakTrakrApi`                                                                        |
| Fly.io deploy during active cron | Kills in-progress spot poll or publish cycle silently                                                   |

### Home Poller Env Var Propagation (gotchas, verified 2026-06-20)

A new/changed env var must clear **three** hops before the scraper sees it. Each silently swallows it if skipped:

1. **`docker-compose.home.yml` `environment:` is an explicit allow-list.** A var in the Portainer stack env reaches the container **only if compose names it** (`- FOO=${FOO:-}`). Adding a var to the Portainer UI alone is not enough — add it to compose too.
2. **Env is baked at container start, not read live.** The entrypoint does `printenv > /etc/environment` once at boot; cron jobs source that snapshot. Changing a value requires a **recreate** ("Pull and redeploy" / "Update the stack") — a plain **Restart reuses the old env**. `StartedAt` advancing is not proof; verify with `grep -oE '^VAR' /etc/environment` via exec.
3. **Sourced `/etc/environment` vars are not exported to child processes.** `run-home.sh` (cron child) only inherits exported vars; most vendors work via in-code defaults. Scripts needing a var must re-export it (see `run-home.sh`'s `WEBSCALE_*` loop).

Related: **provider enable/disable** (`provider_vendors.enabled` in sqld) only takes effect after `providers.json` regenerates (cron `export-providers-json.js` every `*/5`, or run it manually) — the poller reads the file, not live sqld.

### Webscale-Protected Vendors (JM Bullion, Provident)

JM Bullion + Provident sit behind **Webscale Protection Mode** (Google reCAPTCHA v2 on product pages — NOT Cloudflare; Byparr/Firecrawl can't solve it). Bypass = an operator-solved `wspc` cookie injected into the phase-0 Playwright path (STRK-230). Needs a **~weekly manual re-solve**. Procedure: .context/deep-dives/webscale-cookie-re-solve.md. Automation follow-up: STRK-231.

---

## Environment Differences (Prod vs Dev)

| Property           | Fly.io (prod)                              | Home Poller (prod)                                 | Local Dev             |
| ------------------ | ------------------------------------------ | -------------------------------------------------- | --------------------- |
| sqld URL           | `http://192.168.1.81:8080` (via Tailscale) | `http://staktrakr-sqld:8080` (Docker DNS)          | Infisical-sourced     |
| Secrets source     | Fly secrets                                | Portainer stack env                                | Infisical (`dev` env) |
| Git push           | Yes (`run-publish.sh`)                     | No                                                 | No                    |
| Tailscale          | Client (`--accept-routes`)                 | Server (exit node + subnet router)                 | N/A                   |
| Node.js            | `node:20-slim` (Docker base)               | `node:20-slim` (Docker base)                       | Local                 |
| Playwright         | Slim image (no Playwright)                 | Local Chromium (`npx playwright install chromium`) | N/A                   |
| Dashboard          | None                                       | `http://192.168.1.81:3010`                         | N/A                   |
| Prometheus metrics | None                                       | `http://192.168.1.81:9100/metrics`                 | N/A                   |

---

## Monitoring & Observability

| Tool                  | URL                                                 | Data                                                                               |
| --------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Home poller dashboard | `http://192.168.1.81:3010` (HTTP) / `:3011` (HTTPS) | System stats, container status, Fly.io health, spot trend, log tail, failure queue |
| Prometheus metrics    | `http://192.168.1.81:9100/metrics`                  | Uptime, CPU/mem, service up/down, sqld stats, provider failure counts              |
| Fly.io logs           | `fly logs --app staktrakr`                          | All supervisord service output                                                     |
| Portainer             | `https://192.168.1.81:9443`                         | Docker container status, logs, console access                                      |

Portainer API key: `PORTAINER_TOKEN` from Infisical (all projects, dev env). Endpoint ID: `3`.

---

## Repo Boundaries

| Repo                   | Owns                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `lbruton/StakTrakr`    | Frontend, all poller code (`devops/pollers/`), Docker configs, Cloudflare Pages deployment |
| `lbruton/StakTrakrApi` | `api` branch data files (written by Fly.io), GHA workflows, fly.toml (transitioning)       |

All poller code was consolidated into `StakTrakr/devops/pollers/` as of 2026-03-07 (`stakscrapr` repo retired).

---

## Common Troubleshooting

| Symptom                        | Check                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `manifest.json` > 30 min stale | Home poller `run-home.sh` missed cycle or Fly.io `run-publish.sh` not running                 |
| `manifest.json` > 4h stale     | Container down — check Portainer + `fly status --app staktrakr`                               |
| Spot hourly > 75 min stale     | `METAL_PRICE_API_KEY` expired or quota exceeded                                               |
| Goldback > 2h stale (STRK-248) | Home poller `goldback-scraper.js` failed — check home poller logs                             |
| Only 1-2 vendors per coin      | Home poller down — home is sole retail scraper                                                |
| Services not running on Fly    | `fly ssh console --app staktrakr -C "supervisorctl status"`                                   |
| Tailscale not connecting       | `tailscale status` in container; check `TS_AUTHKEY`; verify subnet route approved in admin    |
| sqld unreachable from Fly.io   | Verify Tailscale connected; subnet route approved; home VM `staktrakr-sqld` container running |
| Git push rejected on publish   | `git fetch origin api && git rebase origin/api` inside `/data/staktrakr-api-export`           |
| Stuck lockfile (Fly.io)        | `fly ssh console --app staktrakr -C "rm -f /tmp/retail-poller.lock /tmp/retail-publish.lock"` |
| Stuck lockfile (home)          | Portainer web UI Console: `rm -f /tmp/retail-poller.lock`                                     |
| CF vendor failures             | Check `CF_CLEARANCE_ENABLED=1`; check `docker logs staktrakr-byparr`                          |
| Deploy context error           | Run `fly deploy` from `devops/pollers/` dir, not `remote-poller/`                             |

---

## Related Pages

- .context/deep-dives/remote-poller.md— Fly.io container in depth: supervisord, publish pipeline, tiered recovery
- .context/deep-dives/home-poller.md— Docker stacks, dashboard, CF bypass sidecar, Portainer API commands
- .context/deep-dives/health-checks.md— diagnostic scripts, incident log, manual trigger commands
- .context/deep-dives/secret-keys.md— rotation procedures for each secret
- Poller Parity (deprecated DocVault page) — Fly.io vs home poller capability and code drift comparison
- architecture — system diagram, data feed summary, branch strategy
- .context/deep-dives/api-reference.md — REST endpoint documentation

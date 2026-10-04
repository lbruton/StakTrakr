---
title: "StakTrakr — Infrastructure"
project: StakTrakr
audience: agent
canonical: .context/infrastructure.md
migration_source: "DocVault/Projects/StakTrakr/Foundation/infrastructure.md" # historical provenance; migrated 2026-08-12
updated: "2026-09-29"
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

| Property                    | Value                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| App name                    | `staktrakr`                                                                                                                    |
| Region                      | `dfw` (machine + volume pinned; `primary_region` is decorative)                                                                |
| Memory                      | `1024` MB (raised from 512 on 2026-07-25, STRK-277. Kept at 1024 by choice — see "Memory floor" below for what it can drop to) |
| CPU                         | 1 shared                                                                                                                       |
| Volume name                 | `staktrakr_data`                                                                                                               |
| Volume size                 | `3` GB (extended 1→3 GB 2026-06-11 after inode exhaustion outage, STRK-187)                                                    |
| Volume mountpoint           | `/data`                                                                                                                        |
| Internal HTTP port          | `8080` (force HTTPS via Fly proxy)                                                                                             |
| HTTP concurrency soft limit | `200` requests                                                                                                                 |
| HTTP concurrency hard limit | `250` requests                                                                                                                 |
| `auto_stop_machines`        | `off`                                                                                                                          |
| `min_machines_running`      | `1`                                                                                                                            |
| `POLLER_ID`                 | `api`                                                                                                                          |

### Persistent Volume Contents

| Path                               | Purpose                                                   |
| ---------------------------------- | --------------------------------------------------------- |
| `/data/staktrakr-api-export`       | Clone of `StakTrakrApi` on `api` branch (sole Git writer) |
| `/data/tailscale/tailscaled.state` | Tailscale node identity (survives redeploys)              |

The Git repo at `/data/staktrakr-api-export` must be seeded manually on first deploy. It persists across subsequent deploys on the same volume.

**Git memory caps (2026-06-11, STRK-187 incident):** uncapped git OOM-dies on the machine (gc, fetch, and push pack-objects were all killed with signal 9). The repo config in `/data/staktrakr-api-export` sets `pack.threads=1`, `pack.windowMemory=32m`, `pack.deltaCacheSize=16m`, and `gc.auto=0`. Re-apply these after any re-clone or volume re-seed. History was reset to an orphan commit on 2026-06-11. **Self-cleaning shipped in STRK-187 (2026-06-13):** a scheduled `cleanup-export.sh` (03:17 UTC — weekly at first, daily since STRK-402) runs a retention sweep — pruning `data/15min` day-dirs older than 90 days and `data/hourly` day-dirs older than 365 days (path-derived dates, not mtime, so a re-clone can't defeat it). `run-publish.sh` runs the same `cleanup-export.sh` inline as a pre-flight backstop when the volume drops below 25000 free inodes or 300 MB free.

**Full-history OOM loop (2026-09-26, STRK-402 incident):** `--window-memory` only caps `git repack -a`'s per-delta window, not the object list it must enumerate first — years of 4x/hour publish commits (10k+ commits, ~3M objects) made that enumeration itself OOM the machine, 86 minutes into a repack that then never reached `prune`, leaving the low-inode condition in place so the _next_ publish re-entered the same repack forever. A plain `fly machine restart` did not break the loop. **Fixed in STRK-402:** `cleanup-export.sh`'s git maintenance is no longer `git reflog expire --all → git repack -a -d --threads=1 --window-memory=32m → git prune → git pack-refs` against full history. It now re-shallows first — builds a fresh depth-1 `git init --bare` clone of the current tip in a sibling directory, and only swaps it in as `.git` (atomic rename) after `fetch` + `reset FETCH_HEAD` both succeed, so a transient network failure during cleanup leaves the existing repo completely untouched — then repacks the now-tiny (~16k object) result. `run-publish.sh` also re-shallows on bootstrap if `.git/shallow` is missing, rather than waiting for the scheduled cron.

**Inode growth rate → daily cleanup (STRK-402 soak, 2026-10-02):** each publish leaves ~325 loose git objects, so the export repo grows by ~31k inodes/day on top of a ~16.5k-inode clean baseline. On the 195,840-inode volume that reaches the 25000-free-inode floor in ~5 days — sooner than the original weekly cron — so on 2026-10-02 01:23 UTC the `run-publish.sh` pre-flight backstop ran the cleanup inside a publish slot (153,757 loose objects, 83 s, inodes 88% → 9%, that publish landed ~1 min late, none skipped). The cron is now daily (`17 3 * * *`), which keeps each run near ~31k loose objects (~15 s) and peak usage near 48k inodes (~25%). If the pre-flight `WARN: low space` line appears in `/var/log/publish.log` again, the scheduled cleanup is not keeping the volume above its floors — it does not by itself say why. The line logs both values (`free inodes=`, `free kb=`), so read which floor tripped, then check `/var/log/cleanup.log`: no recent run means the cron stopped; `Publish lock held, skipping` means it lost the lock to a publish; a run without a closing `Done.` means it failed part-way; and a block-floor trip with healthy inodes points at something other than loose git objects filling `/data`.

**`api` branch size → monthly history squash (STRK-406):** the 15-minute publish cycle adds ~200 blobs per run, so `lbruton/StakTrakrApi` was 3.33 GB (2026-10-03, `gh api repos/lbruton/StakTrakrApi --jq .size`) against a ~92 MB served tip, growing ~0.85 GB/month toward GitHub's 5 GB guideline. Pages serves only the tip tree and sqld is the durable record, so `cleanup-export.sh` ends by calling `squash-api-history.sh`, which pushes one orphan commit carrying the **identical tree** and moves the local `api` ref onto it straight away (otherwise the next publish would force-push the old chain back). It runs once per UTC month, gated by the month marker `/data/.api-squash-month` rather than a day-of-month test because the cron is daily. A failure logs `WARN`, leaves the repo and marker untouched, and retries on the next run. Manual run (via `fly ssh console`, inside a publish-safe window `:08–:23` / `:38–:53`): the script does not take the publish lock itself and a bare ssh session has no `GITHUB_TOKEN`, so first `set -a; . /etc/environment; set +a`, then run the script as the command of a single `flock` invocation: `flock -w 120 /tmp/retail-publish.flock env FORCE_SQUASH=1 /app/squash-api-history.sh`. Do not split the lock and the script into two steps: a bare `flock -w` that times out (publish runs may hold the lock up to 720 s, cleanup up to 1800 s) returns nonzero without the lock, and a separate next command would then run unlocked. With the one-command form a timeout means the script never starts. Push any local-only commit before squashing: the push lease expects local `HEAD` to equal the remote tip, so an unpushed commit makes it reject. GitHub's reported `.size` follows the squash only after GitHub's own GC reclaims the unreachable objects. After the first squash, the reported size dropped in under 14 hours: 3,335,145 KB at 2026-10-03 23:24 UTC, 21,149 KB (~21 MB) at 2026-10-04 13:08 UTC, with no support request (STRK-418). The timing is GitHub's to choose, so treat one observation as a data point, not a guarantee; if `.size` has not dropped ~30 days after a squash, ask GitHub support to run GC. The stale 55 MB `prices.db` at the `api` root is not published by anything (`run-publish.sh` stages only `data/`) and is removed once by hand before the first squash. **Prerequisite — GitHub ruleset:** `lbruton/StakTrakrApi` carries a ruleset named `No Delete` (id 13108042, `refs/heads/api`, rules `deletion` + `non_fast_forward`, created 2026-06-11). A squash is a non-fast-forward push, so on 2026-10-03 the repository Admin role was added to it as an `always` bypass actor (deletion stays blocked for everyone else); without that the push fails with `GH013 … Cannot force-push to this branch` and the script logs git's error under its `WARN`. Normal publishes only fast-forward, which is why the rule never showed up before. First production squash: 2026-10-03 23:19 UTC, `964afd86` → `0cb0b600`, tree unchanged; the 23:23 publish fast-forwarded on top of it.

**VM wedge → 1024 MB (2026-07-25, STRK-277 incident):** the machine wedged with `fly machine status` still reporting `State: started, HostStatus: ok` while HTTP _and_ `fly ssh console` both hung and logs went silent. The machine event log is the discriminator — `oom_killed=false, requested_stop=true` proves the VM itself never crashed, only a process inside it. Logs showed `monitor: time jump detected (slept 28s)` as the freeze marker. The publish cron stalled 00:53–02:15 UTC. Recovery required `fly machine stop --signal SIGKILL` then `start`; a plain restart held for only ~6 minutes. Memory was raised 512 → 1024 MB as mitigation on the strongest available hypothesis (~100 MB headroom left no room for git pack spikes). **This is a mitigation, not a confirmed root cause** — SSH was dead, so actual memory pressure was never observed directly. Evidence since: 5 consecutive on-schedule publish cycles at 1024 MB vs. a re-wedge within ~6 minutes at 512 MB. If it wedges again at 1024 MB, the cause is something else.

**Memory floor (STRK-402, measured 2026-10-03):** the machine stays at 1024 MB by owner decision — usage sits inside Fly's free allowance, so there is no cost pressure to shrink it. If that changes, these are the numbers to size against. At 1024 MB the guest sees 962 MB. Sampled every 2 s for 31 minutes (926 samples) across two publish cycles and one spot poll, with the export repo shallow: idle ~350 MB in use, peak ~406 MB in use (556 MB still available). The largest processes are `serve.js` (~85 MB) and the export `node` (~80–85 MB).

| Size    | Verdict                                                                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1024 MB | Current. ~556 MB free at peak.                                                                                                                                   |
| 768 MB  | Safe drop on these numbers (~300 MB headroom at peak). Not trialled; confirm Fly accepts the size when scaling.                                                  |
| 512 MB  | **Not a safe floor.** ~450 MB visible against a ~406 MB peak leaves ~45 MB — the same margin as the STRK-277 wedge, and the 2026-04-11 profile agrees (<400 MB). |

Not measured: the `cleanup-export.sh` peak (the 2026-10-02 backstop run over 153,757 loose objects completed at 1024 MB with no OOM, but its RSS was not recorded), and 2 s sampling can miss short spikes. Re-measure before dropping, and change `memory` in `fly.toml` in the same step — a live `fly machine update` alone is reverted by the next `fly deploy`.

**Deploy window:** with crons at spot `0,30`, publish `8,23,38,53`, and provider-export `*/5`, the `:08:30 → :23:00` gap is the only 15-minute stretch per hour containing no spot cron — deploy there. A full `fly deploy` takes ~2 minutes. The `app is not listening on 0.0.0.0:8080` warning Fly prints at the end is a benign race (it checks before supervisord starts `serve.js`); verify with a real `curl`, not the warning.

### Supervisord Services (slim image)

| Service        | Command                                              | Notes                                                 |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| `tailscaled`   | `tailscaled --state=/data/tailscale/...`             | Provides subnet routing to home LAN for sqld access   |
| `tailscale-up` | `tailscale up --authkey=... --accept-routes --reset` | One-shot auth at startup                              |
| `cron`         | `cron -f`                                            | Runs spot + publish + provider export + daily cleanup |
| `http-server`  | `node /app/serve.js` on port 8080                    | Health/proxy endpoint                                 |

### Cron Schedule (Remote Poller)

Written by `docker-entrypoint-slim.sh` at container start:

| Schedule             | Script                          | Log                            | Status                                      |
| -------------------- | ------------------------------- | ------------------------------ | ------------------------------------------- |
| `0,30 * * * *`       | `/app/run-spot.sh`              | `/var/log/spot-poller.log`     | Active                                      |
| `8,23,38,53 * * * *` | `/app/run-publish.sh`           | `/var/log/publish.log`         | Active                                      |
| `*/5 * * * *`        | `node export-providers-json.js` | `/var/log/provider-export.log` | Active                                      |
| `17 3 * * *`         | `/app/cleanup-export.sh`        | `/var/log/cleanup.log`         | Active (daily, 03:17 UTC, STRK-187/402/406) |
| ~~`CRON_SCHEDULE`~~  | ~~`run-local.sh`~~              | —                              | Disabled (`RETAIL_ENABLED=0`)               |
| ~~`15 * * * *`~~     | ~~`run-retry.sh`~~              | —                              | Disabled                                    |
| ~~`1 * * * *`~~      | ~~`run-goldback.sh`~~           | —                              | Disabled (`GOLDBACK_ENABLED=0`)             |

### Publish Pipeline (`run-publish.sh`)

Runs 4x/hour. Lockfile-guarded via `flock` on `/tmp/retail-publish.flock` (STRK-402 — replaced an atomic-`noclobber` lockfile whose cleanup depended on an `EXIT` trap that never fires on SIGKILL/OOM-kill; `flock` releases automatically when the holding process dies for any reason). Each cron invocation is also wrapped in its own `flock -n <job>.flock timeout -k 30 <N>` (STRK-402) so a single hung run can't occupy a cron slot indefinitely. Sequence (STRK-187 rewrote this — it is **no longer** a blind `add && commit && push`):

1. **Pre-flight space backstop (STRK-187)** — if `/data` has < 25000 free inodes or < 300 MB free, runs `cleanup-export.sh` inline (`CLEANUP_SKIP_LOCK=1`, lock already held) before exporting. Still below floor after cleanup → logs CRITICAL and publishes anyway.
2. `api-export.js` — reads `price_snapshots` from sqld, generates all v1 JSON endpoints under `data/api/` and `data/hourly/`
3. `api-export-v2.js` (STAK-503) — generates v2 endpoints under `data/v2/` (non-fatal; v1 continues if v2 throws)
4. `git add data/` — stages adds **and deletions** (the retention sweep relies on `git add` staging tracked-file deletions; do not "fix" this). Exits early if nothing is staged and nothing is unpushed.
5. **Verify-then-push freshness gate (STRK-187)** — fetches `http://localhost:8080/data/api/manifest.json` (api2 / `serve.js`, the by-design primary), requires a parseable `generated_at`; when this cycle staged exports, rejects a manifest older than **30 min** (`exit 1`, no push). api2 stays fresh regardless — only the published GitHub Pages feed waits for a later cycle. (A push-only retry cycle skips the freshness check, since it legitimately re-pushes an older-but-verified manifest.)
6. **`git commit` — only after the gate passes** (STRK-187 fix `1a8bffc2`). Committing _before_ the gate left an unpushed local commit on any gate `exit 1`; the next push-only cycle would skip the freshness check and force-push that stale commit. The commit lives behind the gate so a rejected cycle leaves nothing to resurrect.
7. `git push --force "$REMOTE" HEAD:api` using the configured publisher remote — sole writer to `api` (push to `api`, never `main`). Push failure logs an isolated error and `exit 1` (api2 remains fresh; only the published feed goes stale until a later cycle succeeds).

### Fly.io Configuration (Active)

`fly.toml` contains non-secret operational settings. The Fly.io secret store supplies the
credentials needed by the slim image's database, publishing, external-feed, and network
integrations. Inspect the enabled scripts and the operator's secret store when troubleshooting;
do not add the deployed inventory to this document.

The former full retail-and-goldback image is historical. Its browser, proxy, retail, and vision
configuration is inactive in the slim image and must not be restored merely because it remains in
historical source.

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
| firecrawl   | `firecrawl-api` + backing services            | Self-hosted Firecrawl (`devops/firecrawl-docker/`)                                                                                                                                                                             | 3002                                      | 4        |
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

`shared/price-extract.js` — for vendors whose resolved `providerCfg()` configuration enables `cf_clearance_fallback`:

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

### Home Poller Configuration

Portainer injects the home poller's secret-backed database, backup, feed, optional-integration,
and service-discovery configuration during a git-based redeploy. For a self-hosted deployment,
use the enabled compose and poller scripts as the authority for its required configuration.
`docker-compose.home.yml` must explicitly pass through each required variable, and cron needs a
recreated container to receive a changed environment.

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

The home-poller container connects to sqld via Docker DNS. Fly.io connects via Tailscale subnet
routing. Authentication behavior is deployment-specific and belongs in the operator-managed
configuration store.

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

Surveyed 2026-09-29 (Cloudflare API, `gh api`, `curl -sI`); unused `staktrakr` Pages project deleted 2026-09-30.

| Host                 | Serves                                                                | DNS (zone `staktrakr.com`, Cloudflare)     |
| -------------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| `staktrakr.com`      | 301 to `https://www.staktrakr.com/` (dashboard redirect, not in repo) | CNAME `stacktrackr.pages.dev`, proxied     |
| `www.staktrakr.com`  | Cloudflare Pages project **`stacktrackr`**, production branch `main`  | CNAME `stacktrackr.pages.dev`, proxied     |
| `beta.staktrakr.com` | Cloudflare Pages project `stacktrackr`, **`dev` branch alias**        | CNAME `dev.stacktrackr.pages.dev`, proxied |
| `api.staktrakr.com`  | GitHub Pages on `StakTrakrApi`, branch `api`, HTTPS enforced          | CNAME `lbruton.github.io`, DNS-only        |
| `api2.staktrakr.com` | Fly.io `serve.js` (see Fly.io section)                                | A/AAAA to Fly, DNS-only                    |

The `api` branch is force-pushed exclusively by `run-publish.sh` on Fly.io. The `Merge Poller Branches` GitHub Actions workflow is retired (manual-only). GitHub Pages on `lbruton/StakTrakr` was disabled on 2026-09-30 and its repo-root `CNAME` file removed; only `StakTrakrApi` still uses GitHub Pages.

**Beta moved to Cloudflare Pages (2026-09-30).** `beta.staktrakr.com` is a custom domain on `stacktrackr` whose CNAME targets the **branch alias** `dev.stacktrackr.pages.dev`; that CNAME target is what pins it to `dev`. A Pages custom domain whose CNAME targets `stacktrackr.pages.dev` serves the production branch (`main`) instead. Adding the domain in the dashboard offers to write that production target, so re-check the DNS record afterwards (on 2026-09-30 beta briefly served `main` 3.36.24 until the CNAME was corrected). Previously beta was GitHub Pages on `lbruton/StakTrakr` (`dev`, `/`, legacy build). Rollback to GitHub Pages is no longer instant: it would need Pages re-enabled on the repo (branch `dev`, path `/`, custom domain `beta.staktrakr.com`), the CNAME pointed back at `lbruton.github.io` (proxied), and the custom domain removed from `stacktrackr`.

### Cloudflare Pages projects

One project, `stacktrackr`, Git-connected to `lbruton/StakTrakr`. It has **no build command, no output dir and no root dir**, so the whole repo root is published as-is (repo-internal paths are 404'd by `functions/_middleware.js`, below). Branch control (set 2026-09-30): production = `main`; preview deployments = **custom**, including only `dev` (serves beta), `fix/*` and `patch/*`. Other branches (`chore/*`, `claude/*`, dependabot) do not build.

| Project       | Created    | Production branch | Custom domains                                                                                         | Deployments (prod / preview / total, 2026-09-29) |
| ------------- | ---------- | ----------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `stacktrackr` | 2026-02-07 | `main`            | `staktrakr.com`, `www.staktrakr.com`, `beta.staktrakr.com` (→ `dev` alias); `stackrtrackr.com` + `www` | 192 / 3,672 / 3,864                              |

- **Despite the typo'd name, `stacktrackr` is the live production project.** Deleting it takes `www.staktrakr.com` down. Renaming is not possible; a clean name would mean a new project, moving both custom domains and repointing both CNAMEs.
- **Retired 2026-09-30:** a second project, `staktrakr` (created 2026-02-20, production branch `dev`, only `staktrakr.pages.dev`, ~3,200 deployments), was an unused `dev` mirror that doubled every build. Its deployments were purged and the project deleted; `staktrakr.pages.dev` no longer exists. `beta.staktrakr.com` was never served by it.
- Never set preview deployments to "None": beta is the `dev` preview alias and would stop updating. Existing historical preview deployments (~3,700) were left in place; purge them with the delete-all-deployments approach below if ever needed, skipping the active production and current `dev` deployments.
- The typo domains `stackrtrackr.com` and `stackertrackr.com` do not resolve publicly and their zones are not in the account. `stacktrackr.com` is a Namecheap parking page and is not attached to any project.
- Cloudflare refuses to delete a project with a large deployment history from the dashboard. The working path (used for the 2026-09-30 retirement) pages through `GET .../pages/projects/{name}/deployments`, calls `DELETE .../deployments/{id}?force=true` for each one (the active production deployment returns error 8000034 and is skipped), then `DELETE .../pages/projects/{name}`.
- `functions/api/token-exchange.js` (Dropbox OAuth token exchange) is a Pages Function served by the project.

### Repo-internal files are publicly served (STRK-410)

Because the repo root is the published directory, repo-internal files are reachable on every frontend host. Verified 200s for `/.context/infrastructure.md`, `/CLAUDE.md` and `/package.json` on `www.staktrakr.com` and `beta.staktrakr.com` (and on the since-deleted `staktrakr.pages.dev`). Directory URLs such as `/devops/` and `/tests/` return the SPA `index.html` fallback on Cloudflare (404 on GitHub Pages), but individual files beneath them are served.

Fixes:

- **Cloudflare Pages — fixed in-repo by PR #1535 (STRK-410), no build step.** `functions/_middleware.js` decodes and normalizes the path (percent-encoding, duplicate slashes, `..`, backslashes, case) and returns 404 for dot-segments (except `/.well-known/`), `artifacts/ devops/ docs/ DocVault/ functions/ playground/ tests/ ui-standards/`, root tooling files and any `*.md`. `_routes.json` includes `/*` but excludes the public static surface (page HTML and their pretty URLs, `sw.js`, `manifest.json`, `css/ data/ fonts/ images/ js/ ratios/ screenshots/ vendor/`, …), so ordinary page loads never invoke a Function. **When adding a new public top-level file or directory, add it to the `_routes.json` exclude list**; `tests/unit/pages-internal-paths.test.js` fails until every tracked top-level entry is classified as public or blocked. Takes effect on www once it ships to `main`.
- **Beta — fixed 2026-09-30 by moving it to Cloudflare Pages** (`dev` branch alias, above), so the same middleware applies. Verified on `beta.staktrakr.com`: internal paths 404, app/assets 200, `/api/token-exchange` reachable. A legacy GitHub Pages branch deploy could not exclude files.

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

The frontend always consumes v2. `api-health.js` reads `stale_after` from a valid v2 envelope and falls back to its per-feed constants only when that field is unavailable.

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

## Secret Configuration Boundary

Secret-backed configuration belongs in its deployment authority, not in this public context
corpus: Fly.io secrets for the managed cloud runtime, Infisical for local development and
managed-secret administration, and Portainer stack environment for the home poller. See
`.context/deep-dives/secret-keys.md` for the safe self-hosting and troubleshooting boundary.

Do not add secret inventories, deployment identifiers, internal addresses, rotation procedures,
or secret-reading commands here. Determine an enabled service's required configuration from its
source and deployment configuration, then inspect the operator-controlled store without exposing
values.

---

## CI/CD

### API data publishing

`run-publish.sh` on Fly.io writes the `api` branch directly. The API repository currently
exposes only that publisher-managed branch; do not use retired poller workflow names or a
nonexistent `main` branch as an operational control surface.

### Pre-commit Hooks (StakTrakr)

- Pre-commit guard for gitignored `CLAUDE.md` (commit `65fe6e22`)
- Standard linting (see `.pre-commit-config.yaml` if present)

### Deployment Paths by Change Type

| Change type                           | Action                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Fly.io code change                    | `cd devops/pollers && fly deploy --config remote-poller/fly.toml --dockerfile remote-poller/Dockerfile` |
| Home poller code change               | Push to git branch + Portainer API redeploy (stack ID 7)                                                |
| Provider URL fix                      | Dashboard at `http://192.168.1.81:3010/providers` — no redeploy needed                                  |
| New secret-backed cloud configuration | Add it through the operator's Fly.io secret store, then deploy normally.                                |
| Home poller env var                   | Update the Portainer stack environment and compose allow-list, then recreate the stack.                 |
| Fly.io deploy during active cron      | Kills in-progress spot poll or publish cycle silently                                                   |

### Home Poller Env Var Propagation (gotchas, verified 2026-06-20)

A new/changed env var must clear **three** hops before the scraper sees it. Each silently swallows it if skipped:

1. **`docker-compose.home.yml` `environment:` is an explicit allow-list.** A var in the Portainer stack env reaches the container **only if compose names it** (`- FOO=${FOO:-}`). Adding a var to the Portainer UI alone is not enough — add it to compose too.
2. **Env is baked at container start, not read live.** The entrypoint snapshots the configured environment once at boot and cron jobs source that snapshot. Changing a value requires a **recreate** ("Pull and redeploy" / "Update the stack") — a plain **Restart reuses the old env**. Do not verify by printing environment values; use deployment status and service health instead.
3. **Sourced `/etc/environment` vars are not exported to child processes.** `run-home.sh` (cron child) only inherits exported vars; most vendors work via in-code defaults. Scripts needing a var must re-export it (see `run-home.sh`'s `WEBSCALE_*` loop).

Related: **provider enable/disable** (`provider_vendors.enabled` in sqld) only takes effect after `providers.json` regenerates (cron `export-providers-json.js` every `*/5`, or run it manually) — the poller reads the file, not live sqld.

### Webscale-Protected Vendors (JM Bullion, Provident)

JM Bullion + Provident sit behind **Webscale Protection Mode** (Google reCAPTCHA v2 on product pages — NOT Cloudflare; Byparr/Firecrawl can't solve it). Bypass = an operator-solved `wspc` cookie injected into the phase-0 Playwright path (STRK-230). Needs a **~weekly manual re-solve**. Procedure: .context/deep-dives/webscale-cookie-re-solve.md. Automation follow-up: STRK-231.

---

## Environment Differences (Prod vs Dev)

| Property           | Fly.io (prod)                 | Home Poller (prod)                                 | Local Dev        |
| ------------------ | ----------------------------- | -------------------------------------------------- | ---------------- |
| sqld URL           | Deployment-managed connection | Deployment-managed connection                      | Operator-managed |
| Secrets source     | Fly.io secrets                | Portainer stack environment                        | Infisical        |
| Git push           | Yes (`run-publish.sh`)        | No                                                 | No               |
| Tailscale          | Client (`--accept-routes`)    | Server (exit node + subnet router)                 | N/A              |
| Node.js            | `node:20-slim` (Docker base)  | `node:20-slim` (Docker base)                       | Local            |
| Playwright         | Slim image (no Playwright)    | Local Chromium (`npx playwright install chromium`) | N/A              |
| Dashboard          | None                          | `http://192.168.1.81:3010`                         | N/A              |
| Prometheus metrics | None                          | `http://192.168.1.81:9100/metrics`                 | N/A              |

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

| Symptom                        | Check                                                                                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json` > 30 min stale | Home poller `run-home.sh` missed cycle or Fly.io `run-publish.sh` not running                                                                                                                             |
| `manifest.json` > 4h stale     | Container down — check Portainer + `fly status --app staktrakr`                                                                                                                                           |
| Spot hourly > 75 min stale     | External price-feed credential expired or quota exceeded                                                                                                                                                  |
| Goldback > 2h stale (STRK-248) | Home poller `goldback-scraper.js` failed — check home poller logs                                                                                                                                         |
| Only 1-2 vendors per coin      | Home poller down — home is sole retail scraper                                                                                                                                                            |
| Services not running on Fly    | `fly ssh console --app staktrakr -C "supervisorctl status"`                                                                                                                                               |
| Tailscale not connecting       | Check container status, operator-managed network identity, and approved subnet routes                                                                                                                     |
| sqld unreachable from Fly.io   | Verify Tailscale connected; subnet route approved; home VM `staktrakr-sqld` container running                                                                                                             |
| Git push rejected on publish   | `git fetch origin api && git rebase origin/api` inside `/data/staktrakr-api-export`                                                                                                                       |
| Stuck lockfile (Fly.io)        | Should self-clear (STRK-402 — `flock` releases on process death, unlike the old `noclobber` lockfile). If still wedged: `fly ssh console --app staktrakr -C "rm -f /tmp/retail-poller.lock /tmp/*.flock"` |
| Stuck lockfile (home)          | Portainer web UI Console: `rm -f /tmp/retail-poller.lock`                                                                                                                                                 |
| CF vendor failures             | Check `CF_CLEARANCE_ENABLED=1`; check `docker logs staktrakr-byparr`                                                                                                                                      |
| Deploy context error           | Run `fly deploy` from `devops/pollers/` dir, not `remote-poller/`                                                                                                                                         |

---

## Related Pages

- .context/deep-dives/remote-poller.md— Fly.io container in depth: supervisord, publish pipeline, tiered recovery
- .context/deep-dives/home-poller.md— Docker stacks, dashboard, CF bypass sidecar, Portainer API commands
- .context/deep-dives/health-checks.md— diagnostic scripts, incident log, manual trigger commands
- .context/deep-dives/secret-keys.md— secret configuration boundary and safe troubleshooting
- Poller Parity (deprecated DocVault page) — Fly.io vs home poller capability and code drift comparison
- architecture — system diagram, data feed summary, branch strategy
- .context/deep-dives/api-reference.md — REST endpoint documentation

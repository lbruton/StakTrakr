---
title: "Home Poller"
project: StakTrakr
audience: agent
canonical: .context/deep-dives/home-poller.md
migration_source: "DocVault/Projects/StakTrakr/Foundation/Deep Dives/Home Poller.md" # historical provenance; migrated 2026-08-12
updated: "2026-04-11"
---

# Home Poller (Docker/Portainer)

> **Last verified:** 2026-03-22 — Docker containers on Ubuntu 24.04 LXC at 192.168.1.81, managed by Portainer. Five stacks on `staktrakr-net` bridge network.

---

## Overview

A secondary poller host running as Docker containers on an Ubuntu Server LXC. The home-poller container runs three cron-driven pollers: a **retail scraper** (`run-home.sh` at `:30`), a **spot price poller** (`spot-extract.js` at `:15/:45`), and a **goldback scraper** (`goldback-scraper.js` hourly at `:05` — `5 * * * *`, STRK-58: the CurrencyLayer-backed rate can shift intraday). Retail and spot offsets are staggered from Cloud - Fly.io to avoid write collisions.

Both pollers write to the **same sqld database** (`staktrakr-sqld` on the Home VM, port 8080). The home-poller connects via Docker DNS (`http://staktrakr-sqld:8080`). `run-publish.sh` on Fly.io merges their data using `readLatestPerVendor()`. The home poller never touches Git. A nightly DR sync job (`turso-backup-sync.js`) replicates data from sqld to Turso Cloud (free tier).

Code lives in `StakTrakr/devops/pollers/` and deploys via Portainer API from git.

---

## Remote Management (Portainer API)

All container management goes through the **Portainer REST API** at `https://192.168.1.81:9443/api` or the **Portainer web UI** at `https://192.168.1.81:9443`. No SSH, no docker CLI.

**API key:** `PORTAINER_TOKEN` from Infisical (all projects, dev environment). Endpoint ID: `3`.

```bash
# List containers
curl -sk -H "X-API-Key: $PORTAINER_TOKEN" \
  "https://192.168.1.81:9443/api/endpoints/3/docker/containers/json?all=true"

# Container logs (replace <id> with container ID)
curl -sk -H "X-API-Key: $PORTAINER_TOKEN" \
  "https://192.168.1.81:9443/api/endpoints/3/docker/containers/<id>/logs?stdout=true&stderr=true&tail=50"
```

For interactive commands inside containers (e.g., `supervisorctl status`, running scripts), use the **Portainer web UI Console**: Containers > select container > Console.

See `portainer` skill for full API reference.

---

## Docker Stacks

Five Portainer-managed stacks on the `staktrakr-net` bridge network:

| Stack       | Container                 | Purpose                                                                                                         | Ports                                                                              | Stack ID |
| ----------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------- |
| home-poller | `staktrakr-home-poller`   | Retail/spot/goldback pollers + dashboard + metrics                                                              | 3010, 3011, 9100                                                                   | 7        |
| byparr      | `staktrakr-byparr`        | Cloudflare bypass sidecar (Camoufox Firefox, returns `cf_clearance` cookie)                                     | 8191 (host-exposed for debugging and Fly.io → Tailscale → Byparr CF bypass access) | —        |
| firecrawl   | `firecrawl-api` + workers | Web scraping engine (Firecrawl self-hosted)                                                                     | 3002                                                                               | 4        |
| tinyproxy   | `tinyproxy-staktrakr`     | HTTP proxy for Cloud - Fly.io residential IP routing                                                            | 8888                                                                               | 5        |
| tailscale   | `tailscale-staktrakr`     | Tailscale sidecar — exit node + **subnet router** for `192.168.1.0/24` (tinyproxy shares its network namespace) | —                                                                                  | 8        |

**Portainer UI:** `https://192.168.1.81:9443` (HTTPS only, self-signed cert)

**Docker:** snap-installed. Volume mountpoint: `/var/snap/docker/common/var-lib-docker/volumes/`

### Home-Poller Container Services (supervisord)

| Service          | Purpose                                                           |
| ---------------- | ----------------------------------------------------------------- |
| cron             | Runs retail, spot, goldback, provider export, Fly.io health check |
| dashboard        | Provider editor + status UI (HTTP 3010, HTTPS 3011)               |
| metrics-exporter | Prometheus metrics (port 9100)                                    |

---

## Dashboard & Monitoring

### Dashboard (`http://192.168.1.81:3010` / `https://...:3011`)

Node.js HTTP/HTTPS server (`/app/dashboard.js` inside container) showing:

- System stats (CPU, memory, network, uptime)
- Docker container status (all StakTrakr/Firecrawl/Tailscale/tinyproxy containers)
- Fly.io health (sqld DB status, HTTP endpoint check, 1-hour run summary)
- Spot price trend (15-min increments)
- Home poller log tail (last 300 lines from persistent volume)
- Failure trend (7-day chart)
- **`/providers`** — Provider URL editor (inline CRUD against sqld — see Provider Database)
- **`/failures`** — Failure queue (URLs with 3+ failures in last 7 days from sqld)

HTTPS on port 3011 uses a self-signed certificate generated at Docker build time. Used for iframe embedding in the spec-workflow MCP dashboard.

### Metrics Exporter (`http://192.168.1.81:9100/metrics`)

`/app/metrics-exporter.js` — Prometheus text format. Exposes:

- System: `poller_uptime_seconds`, `poller_cpu_load1/5/15`, `poller_mem_used_pct`, `poller_net_rx/tx_bytes`
- Services: `poller_service_up{service, manager}` for supervisord services
- sqld: `poller_turso_up`, last-run stats per poller, provider failure counts

---

## Residential Proxy (tinyproxy)

Tinyproxy runs in its own container (`tinyproxy-staktrakr`), sharing the Tailscale sidecar's network namespace via `network_mode: container:tailscale-staktrakr`.

| Property                 | Value                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Proxy URL                | `http://100.112.198.50:8888` (referenced as `HOME_PROXY_URL` / `PROXY_SERVER` on Fly) |
| Accepts connections from | Tailscale IPs only                                                                    |
| Residential egress IP    | Home ISP IP                                                                           |

The Cloud - Fly.io container routes scraper traffic through this proxy for residential IP egress. Retail bullion dealers don't block residential IPs.

### Tailscale Sidecar

| Node                                | Tailscale IP   |
| ----------------------------------- | -------------- |
| Home VM sidecar (`stacktrckr-home`) | 100.112.198.50 |
| Fly.io container (`staktrakr-fly`)  | 100.90.171.110 |

The Tailscale sidecar (`tailscale-staktrakr`) runs in its own container with two roles:

1. **Exit node** — Fly.io routes outbound traffic through the home residential IP
2. **Subnet router** — advertises `192.168.1.0/24` via `TS_ROUTES` so Fly.io can reach home-network services (sqld at `192.168.1.81:8080`) without exit-node routing

The compose file (`docker-compose.tinyproxy.yml`) sets `TS_ROUTES=192.168.1.0/24` and enables `net.ipv4.ip_forward=1` / `net.ipv6.conf.all.forwarding=1` via `sysctls`. The subnet route must be approved in the Tailscale admin console. On the Fly.io side, `--accept-routes` in `supervisord.conf` enables the container to use the advertised routes.

> **Gotcha:** The `containerboot` entrypoint in the Tailscale Docker image does not re-apply `TS_ROUTES` when existing state exists in the volume. If the route is missing after a redeploy, manually run `tailscale set --advertise-routes=192.168.1.0/24` inside the container.

Tinyproxy shares the sidecar's network namespace. The home-poller container does NOT share the Tailscale network — it uses the standard Docker bridge. Tailscale is needed for the proxy path from Fly.io and for subnet-routed access to home LAN services.

---

## CF-Clearance-Scraper Sidecar

`staktrakr-byparr` runs `ghcr.io/thephaseless/byparr:latest` — a Camoufox (hardened Firefox) sidecar that solves Cloudflare challenges and returns a valid `cf_clearance` cookie.

| Property      | Value                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Image         | `ghcr.io/thephaseless/byparr:latest`                                                                                  |
| Internal URL  | `http://staktrakr-byparr:8191` (Docker DNS via container name)                                                        |
| Host URL      | `http://192.168.1.81:8191` (host-exposed on port 8191 for debugging and Fly.io → Tailscale → Byparr CF bypass access) |
| Purpose       | Phase 2 fallback for CF-protected vendors (Bullion Exchanges, JM Bullion)                                             |
| Network       | `staktrakr-net` bridge, port 8191 exposed to host                                                                     |
| Shared memory | `/dev/shm` mounted from host (required by Camoufox Firefox)                                                           |

### 3-Phase Scraping Pipeline

`shared/price-extract.js` uses a 3-phase fallback cascade for vendors whose resolved `providerCfg()` configuration enables `cf_clearance_fallback`:

| Phase | Method              | Triggers When                                                                |
| ----- | ------------------- | ---------------------------------------------------------------------------- |
| 0     | Playwright direct   | Always attempted first                                                       |
| 1     | Firecrawl           | Phase 0 fails or returns empty                                               |
| 2     | CF sidecar (Byparr) | Phase 0+1 both return no price (including 200 Cloudflare JS-challenge pages) |

Phase 2 calls `getCFClearanceCookie(url)` from `shared/cf-clearance.js`, which POSTs to Byparr's FlareSolverr-compatible `POST /v1` endpoint. Byparr returns the page HTML (`solution.response`) along with the `cf_clearance` cookie. The HTML is tag-stripped and parsed directly — **no second Playwright request** is needed. Results written to Turso with `source: "cf-clearance"`.

> **Why HTML-first:** Byparr uses Camoufox (Firefox) to solve the challenge. Re-requesting the page via Playwright/Chromium would cause a TLS fingerprint mismatch (Firefox fingerprint on the `cf_clearance` cookie, Chromium browser making the request). Using Byparr's already-fetched HTML avoids this entirely.

### Price Extraction Strategy (`extractPrice` + JSON-LD)

After scraping, `price-extract.js` extracts the wire/ACH price via:

1. **JSON-LD first** — `extractJsonLdPrice()` reads `<script type="application/ld+json">` Product schemas (`offers.price`). Authoritative price set by the merchant; avoids spot ticker / related-product false positives. Applies in Phase 0 and Phase 2.
2. **Pipe-table first row** — `firstTableRowFirstPrice()` — standard pricing grid layout. Only matches Firecrawl markdown (which produces `| $price |` pipe tables). Phase 0 plain `innerText` has no pipe characters — configure the vendor module or `providerCfg()` resolution with `phase: "firecrawl"` when table parsing is required.
3. **Prose price scan** — `firstInRangePriceProse()` — first `$XX.XX` value in the metal's price range (SPA fallback).
4. **As Low As** — `asLowAsPrices()` — bulk-discount price as last resort.

**Nav stripping (Phase 0 + Phase 2):** Before capturing `innerText`, Phase 0 (`scrapeWithPlaywrightDirect`) removes `nav, header, footer, [role='navigation'], [role='banner']` from the DOM — the same treatment applied in Phase 2 (`scrapeViaCFClearance`). This prevents site-wide spot price tickers (e.g. Provident Metals gold ticker ~$5,320) from appearing before the product price in the text stream and being matched by `firstInRangePriceProse`.

**Vendor routing (`providerCfg()`):** Vendors where Phase 0 `innerText` extraction is structurally insufficient use `phase: "firecrawl"`:

- `herobullion` — "As Low As" bulk price appears before the 1-unit table; pipe-table extraction via Firecrawl returns the correct 1-unit price.
- `gainesvillecoins` — Phase 0 Playwright always times out; Firecrawl succeeds reliably.
- `apmex`, `monumentmetals`, `jmbullion`, `bullionexchanges` — already Firecrawl-preferred (JS-rendering, bot-detection, or table-parsing requirements).

### Enabling / Disabling

Controlled by `CF_CLEARANCE_ENABLED` env var on the home-poller container. Set to `0` to disable Phase 2 without stopping the sidecar container.

---

## Fly.io Health Check

`/app/check-flyio.sh` runs every 5 min via cron inside the container. Checks:

- HTTP GET to `https://api2.staktrakr.com/data/retail/providers.json`
- Best-effort ICMP ping to Fly.io Tailscale IP (may fail from Docker bridge — expected)

Results are displayed on the dashboard Fly.io card (Turso run summary + HTTP status).

---

## Browser / Playwright Setup

The home poller runs Playwright with **local Chromium** inside the Docker container.

| Property        | Home Poller                                          | Fly.io Container               |
| --------------- | ---------------------------------------------------- | ------------------------------ |
| `BROWSER_MODE`  | `local`                                              | `local`                        |
| Chromium source | `npx playwright install chromium` (in Dockerfile)    | Dockerfile-installed           |
| Browser path    | `/root/.cache/ms-playwright/`                        | `/usr/local/share/playwright/` |
| System deps     | Dockerfile `apt-get install` (libnss3, libatk, etc.) | Dockerfile `apt-get install`   |

Playwright version is locked to whatever is in `shared/package.json` at build time.

---

## Key Paths (Inside Container)

| Path                                    | Purpose                                                |
| --------------------------------------- | ------------------------------------------------------ |
| `/app/`                                 | All poller scripts (shared + home-specific)            |
| `/data/`                                | Persistent Docker volume (`staktrakr-poller-data`)     |
| `/data/retail/`                         | Local retail data                                      |
| `/data/logs/retail-poller.log`          | Retail poller output                                   |
| `/data/logs/spot-poller.log`            | Spot poller output                                     |
| `/data/logs/goldback-poller.log`        | Goldback poller output                                 |
| `/data/logs/provider-export.log`        | Provider export output                                 |
| `/data/logs/flyio-check.log`            | Fly.io health check output                             |
| `/var/log/supervisor/`                  | Supervisord service logs (ephemeral)                   |
| `/etc/cron.d/home-poller`               | Cron schedule (written by entrypoint)                  |
| `/app/tls-cert.pem`, `/app/tls-key.pem` | Self-signed TLS for HTTPS dashboard                    |
| `/app/tracker-blocklist.txt`            | Ad/tracker domain blocklist (injected into /etc/hosts) |

### Source Code (Repo)

| Repo Path                                | Maps To                       |
| ---------------------------------------- | ----------------------------- |
| `devops/pollers/shared/`                 | `/app/` (shared scraper core) |
| `devops/pollers/home-poller/`            | `/app/` (home-specific files) |
| `devops/pollers/docker-compose.home.yml` | Portainer stack definition    |

---

## Environment Variables

Injected via Portainer stack env vars (must be passed on every redeploy):

| Variable                   | Required       | Notes                                                                                                                                                                                                                                                                                  |
| -------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TURSO_DATABASE_URL`       | Yes            | sqld connection string (`http://staktrakr-sqld:8080` via Docker DNS)                                                                                                                                                                                                                   |
| `TURSO_AUTH_TOKEN`         | No             | Empty — sqld has no auth by default                                                                                                                                                                                                                                                    |
| `SQLD_URL`                 | Yes            | `http://staktrakr-sqld:8080` — used by DR sync job                                                                                                                                                                                                                                     |
| `TURSO_BACKUP_URL`         | Yes            | Turso Cloud DR target URL                                                                                                                                                                                                                                                              |
| `TURSO_BACKUP_TOKEN`       | Yes            | Turso Cloud auth token (DR sync only)                                                                                                                                                                                                                                                  |
| `METAL_PRICE_API_KEY`      | Yes            | For spot-extract.js                                                                                                                                                                                                                                                                    |
| `POLLER_ID`                | Set in compose | `home`                                                                                                                                                                                                                                                                                 |
| `DATA_DIR`                 | Set in compose | `/data`                                                                                                                                                                                                                                                                                |
| `FIRECRAWL_BASE_URL`       | Yes            | `http://firecrawl-api:3002` (Docker DNS)                                                                                                                                                                                                                                               |
| `FLYIO_TAILSCALE_IP`       | Yes            | `100.90.171.110` — used by check-flyio.sh                                                                                                                                                                                                                                              |
| `FLYIO_HTTP_URL`           | Yes            | `https://api2.staktrakr.com/data/retail/providers.json`                                                                                                                                                                                                                                |
| `GEMINI_API_KEY`           | No             | Enables vision pipeline                                                                                                                                                                                                                                                                |
| `VISION_ENABLED`           | No             | Set to `1` to enable vision pipeline                                                                                                                                                                                                                                                   |
| `CF_CLEARANCE_SCRAPER_URL` | No             | Defaults to `http://staktrakr-byparr:8191` (Docker DNS via container name). `CF_CLEARANCE_SIDECAR_URL` is accepted as a legacy alias in `cf-clearance.js`.                                                                                                                             |
| `CF_CLEARANCE_ENABLED`     | No             | Set to `1` (default) to enable Phase 2; `0` to disable                                                                                                                                                                                                                                 |
| `CF_CLEARANCE_TIMEOUT_MS`  | No             | Sidecar request timeout; defaults to `30000` (30 s)                                                                                                                                                                                                                                    |
| `MB_API_KEY`               | No             | MintBuilder direct price feed (STRK-321) — unset falls back to page scraping. Must stay declared in `docker-compose.home.yml` AND covered by the `run-home.sh` cron re-export (STRK-230 pattern); missing either hop = "works from dashboard retry, falls back under cron" half-state. |

---

## Cron Schedule (Inside Container)

> **Architecture note (STAK-478):** The home poller is the **sole retail and goldback scraper**. Fly.io does NOT run retail or goldback scraping — it only polls spot prices and publishes all data from sqld. The "Offset" column shows stagger timing for spot polls (both pollers write spot data to sqld). See Remote Poller for Fly.io's current slim publisher schedule.

| Job                                             | Schedule                             | Notes                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retail scrape (`run-home.sh`)                   | `:30` every hour                     | **Home only** — Fly.io does not scrape retail                                                                                                                                                                                                                                                                                                      |
| Spot prices (`spot-extract.js`)                 | `:15, :45` every hour                | Staggered from Fly.io spot at `:00, :30`                                                                                                                                                                                                                                                                                                           |
| Goldback (`goldback-scraper.js`)                | `5 * * * *` (hourly at :05, STRK-58) | **Home only.** Scrapes hourly because the CurrencyLayer-backed rate can shift intraday. Fly.io's `api-export.js` reads the cached `goldback-g1` row from sqld **every publish cycle** (4×/hr) and republishes it with a fresh `generated_at`; goldback.com's upstream rate (`data.t`) can lag the scrape, so `g1_usd` may repeat across publishes. |
| Provider export (`export-providers-json.js`)    | Every 5 min                          | Same schedule as Fly.io                                                                                                                                                                                                                                                                                                                            |
| Fly.io health check (`check-flyio.sh`)          | Every 5 min                          | —                                                                                                                                                                                                                                                                                                                                                  |
| DR sync to Turso Cloud (`turso-backup-sync.js`) | Nightly (03:00 UTC)                  | Home only                                                                                                                                                                                                                                                                                                                                          |

---

## Deploying Code Changes

Code deploys via Portainer's git-based stack redeploy. See `sync-poller` skill for the full workflow.

```bash
# 1. Push code changes to git
git push origin <branch>

# 2. Redeploy via Portainer API (direct from Mac)
curl -sk -X PUT \
  "https://192.168.1.81:9443/api/stacks/7/git/redeploy?endpointId=3" \
  -H "X-API-Key: $PORTAINER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pullImage": true, "prune": true, "env": [...]}'

# 3. Verify via Portainer API or web UI
curl -sk -H "X-API-Key: $PORTAINER_TOKEN" \
  "https://192.168.1.81:9443/api/endpoints/3/docker/containers/json" | python3 -c "
import sys,json
for c in json.load(sys.stdin):
  if 'home-poller' in c['Names'][0]: print(c['Names'][0], c['State'])"
```

**Critical:** Always pass env vars on redeploy. Portainer does not persist them across git-based redeployments.

---

## Common Tasks

### Check container health

```bash
# List all StakTrakr containers via Portainer API
curl -sk -H "X-API-Key: $PORTAINER_TOKEN" \
  "https://192.168.1.81:9443/api/endpoints/3/docker/containers/json?all=true" | \
  python3 -c "import sys,json; [print(c['Names'][0], c['State'], c['Status']) for c in json.load(sys.stdin)]"
```

For `supervisorctl status` and other interactive commands, use the Portainer web UI Console.

### Test a single coin

Use the Portainer web UI Console on the `staktrakr-home-poller` container:

```bash
COINS=ase bash /app/run-home.sh
```

### View recent logs

```bash
# Via Portainer API (replace <id> with container ID)
curl -sk -H "X-API-Key: $PORTAINER_TOKEN" \
  "https://192.168.1.81:9443/api/endpoints/3/docker/containers/<id>/logs?stdout=true&stderr=true&tail=100"
```

Or use the Portainer web UI: Containers > staktrakr-home-poller > Logs.

### Restart container

```bash
# Via Portainer API (replace <id> with container ID)
curl -sk -X POST -H "X-API-Key: $PORTAINER_TOKEN" \
  "https://192.168.1.81:9443/api/endpoints/3/docker/containers/<id>/restart"
```

### Clear stuck lockfile

Use the Portainer web UI Console on the `staktrakr-home-poller` container:

```bash
rm -f /tmp/retail-poller.lock
```

---

## Diagnosing Issues

| Symptom                           | Check                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| No rows from home poller in sqld  | Container running? Env vars present? `docker logs staktrakr-home-poller`                                   |
| sqld queries fail                 | Missing env vars after redeploy — always pass `env` array. Check sqld container is running.                |
| Dashboard not loading             | `docker exec staktrakr-home-poller supervisorctl status dashboard`                                         |
| Logs empty after redeploy         | Verify logs go to `/data/logs/` (persistent volume), not `/var/log/`                                       |
| Firecrawl not responding          | `curl -sf http://localhost:3002/health` from VM                                                            |
| Lockfile stuck                    | `docker exec staktrakr-home-poller rm -f /tmp/retail-poller.lock`                                          |
| Container crash loop              | `docker logs --tail 50 staktrakr-home-poller` — check entrypoint errors                                    |
| Tailscale sidecar down            | `docker logs tailscale-staktrakr` — check for auth issues                                                  |
| Tinyproxy unreachable from Fly.io | Verify tailscale sidecar is up, tinyproxy shares its network namespace                                     |
| CF sidecar not resolving 403s     | Check `CF_CLEARANCE_ENABLED=1` on home-poller; `docker logs staktrakr-byparr` for Camoufox errors          |
| CF sidecar crashes on start       | Verify `/dev/shm` volume is mounted in compose; container needs shared memory for Chromium                 |
| Phase 2 never attempted           | Confirm the resolved `providerCfg()` enables `cf_clearance_fallback` in `price-extract-provider-config.js` |

---

## Related

- Poller Parity (deprecated DocVault page) — Fly.io vs Home Poller comparison
- Cloud - Fly.io — cron schedule and deployment
- Provider Database — Turso provider CRUD and dashboard
- Turso Schema — database tables

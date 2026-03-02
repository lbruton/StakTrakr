---
title: Home Poller (Ubuntu VM)
category: infrastructure
owner: staktrakr-api
lastUpdated: v3.33.19
date: 2026-03-02
sourceFiles: []
relatedPages: []
---

# Home Poller (Ubuntu VM)

> **Last verified:** 2026-03-02 — Ubuntu 24.04.3 LTS LXC at 192.168.1.81, user `stakpoller`. Verified from VM console. Home spot poller (`/etc/cron.d/spot-poller` at `15,45`) confirmed active.

---

## Overview

A secondary poller host running on an Ubuntu Server LXC container. Hosts two cron-driven pollers: a **retail scraper** (`run-home.sh` at `:30`) and a **spot price poller** (`run-spot-home.sh` at `:15/:45`). The retail scraper offsets 30 min from Fly.io retail at `:00`. The spot poller interleaves with Fly.io spot at `:00/:30`, giving fresh spot prices every 15 minutes across both hosts.

Both pollers write to the **same Turso database**. `run-publish.sh` on Fly.io merges their data using `readLatestPerVendor()`. The home poller never touches Git.

As of 2026-02-25, this VM also hosts the full monitoring stack: dashboard, Grafana, Prometheus, and a Prometheus metrics exporter.

---

## SSH Remote Management

As of 2026-02-25, Claude Code on the Mac can SSH directly into this VM — no need for a separate Claude agent running in the VM's terminal.

| Alias | Network | Host | Latency |
|-------|---------|------|---------|
| `homepoller` | LAN | 192.168.1.81 | ~0.5ms |
| `homepoller-ts` | Tailscale | 100.112.198.50 | ~36ms |

**User:** `stakpoller` — has `NOPASSWD: ALL` sudo via `/etc/sudoers.d/stakpoller`.

**Key:** `~/.ssh/stakpoller_ed25519` (on Mac) — sourced from Infisical prod environment.

**Usage:** Always use `-T` flag for non-interactive commands:

```bash
ssh -T homepoller 'sudo /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf status'
ssh -T homepoller 'tail -50 /var/log/retail-poller.log'
```

See `homepoller-ssh` skill in the StakTrakr repo for full diagnostic commands and common tasks.

---

## Specs

| Property | Value |
|----------|-------|
| Host | Ubuntu Server LXC (Proxmox) |
| IP | 192.168.1.81 |
| OS | Ubuntu 24.04 |
| User | `stakpoller` (SSH) / `lbruton` (Proxmox console) |
| Install path | `/opt/poller/` |
| Config repo | `github.com/lbruton/stakscrapr` (Claude config, CLAUDE.md) |
| Poller source | `github.com/lbruton/StakTrakrApi` → `devops/fly-poller/` (source of truth) |
| Retail log | `/var/log/retail-poller.log` |
| Spot log | `/var/log/spot-poller.log` |
| Retail cron | `30 * * * *` — `/etc/cron.d/retail-poller` (runs as `root`) |
| Spot cron | `15,45 * * * *` — `/etc/cron.d/spot-poller` (runs as `root`) |

---

## Stack

| Component | How it runs | Port |
|-----------|-------------|------|
| Redis | systemd (`redis-server`) | localhost:6379 |
| RabbitMQ | systemd (`rabbitmq-server`) | localhost:5672 |
| Playwright Service | supervisord | localhost:3003 |
| Firecrawl API | supervisord | localhost:3002 |
| Firecrawl Worker | supervisord | — |
| Dashboard | supervisord (`dashboard`) | 0.0.0.0:3010 |
| Metrics Exporter | supervisord (`metrics-exporter`) | 0.0.0.0:9100 |
| Grafana | systemd (`grafana-server`) | 0.0.0.0:3000 |
| Prometheus | systemd (`prometheus`) | 0.0.0.0:9090 |
| Tailscale | systemd (`tailscaled`) | tailscale0 |
| tinyproxy | systemd (`tinyproxy`) | 0.0.0.0:8888 |
| Cron | systemd (`cron`) | — |
| Node.js 22.22.0 | system | — |
| Playwright + Chromium | npm package (local) | — |

Supervisord config: `/etc/supervisor/conf.d/staktrakr.conf`

---

## Dashboard & Monitoring

### Dashboard (`http://192.168.1.81:3010`)

Node.js HTTP server (`/opt/poller/dashboard.js`) showing:
- System stats (CPU, memory, network, uptime)
- Service health (supervisord + systemd)
- Fly.io container health (Tailscale + HTTP ping, `/tmp/flyio-health.json`)
- All poller runs from Turso (`poller_runs` table — home + Fly.io)
- Home poller log tail (last 300 lines)
- **`/providers`** — Provider URL editor (inline CRUD against Turso — see [Provider Database](provider-database.md))
- **`/failures`** — Failure queue (URLs with 3+ failures in last 7 days from Turso)

### Grafana (`http://192.168.1.81:3000`)

Grafana OSS 12.4.0, default login `admin/admin`. Three provisioned dashboards in `StakTrakr` folder:
- **StakTrakr — System** — CPU load, memory, network rate, uptime, service health grid
- **StakTrakr — Poller Runs** — capture rate over time, failures per run, duration, home vs Fly.io
- **StakTrakr — Failure Queue** — failing provider count, per-provider breakdown

Datasource: Prometheus at `http://localhost:9090`. Provisioning files at `/etc/grafana/provisioning/`.

### Prometheus (`http://192.168.1.81:9090`)

Scrapes `localhost:9100` (metrics exporter) every 15s. Config: `/etc/prometheus/prometheus.yml`.

### Metrics Exporter (`http://192.168.1.81:9100/metrics`)

`/opt/poller/metrics-exporter.js` — Prometheus text format. Exposes:
- System: `poller_uptime_seconds`, `poller_cpu_load1/5/15`, `poller_mem_used_pct`, `poller_net_rx/tx_bytes`
- Services: `poller_service_up{service, manager}` for all supervisord + systemd services
- Turso: `poller_turso_up`, last-run stats per poller, provider failure counts

---

## Residential Proxy (tinyproxy)

As of 2026-02-24, this VM runs **tinyproxy** as an HTTP proxy for the Fly.io container, routing its scraper traffic through the home residential IP.

| Property | Value |
|----------|-------|
| Proxy URL | `http://100.112.198.50:8889` (referenced as `HOME_PROXY_URL_2` on Fly) |
| Accepts connections from | Tailscale IPs only (100.112.198.50, 100.90.171.110) |
| Residential egress IP | `98.184.142.225` |
| Config | `/etc/tinyproxy/tinyproxy.conf` |
| `DisableViaHeader` | Yes (no proxy fingerprint) |

The Fly.io container sets `HOME_PROXY_URL_2=http://100.112.198.50:8889` and the Playwright service routes scraper traffic through it. The home VM exits as a residential IP — retail bullion dealers don't block residential IPs.

**Previous approach (deprecated):** Tailscale exit node — `sudo tailscale set --advertise-exit-node=true`. This was replaced by tinyproxy in Feb 2026 for better reliability and selective routing.

### Tailscale mesh

| Node | Tailscale IP |
|------|-------------|
| Home VM (`stacktrckr`) | 100.112.198.50 |
| Fly.io container (`staktrakr-fly`) | 100.90.171.110 |

IPv4/IPv6 forwarding enabled via `/etc/sysctl.d/99-tailscale.conf`.

---

## Fly.io Health Check

`/opt/poller/check-flyio.sh` runs every 5 min via `/etc/cron.d/flyio-health`. Checks:
- Tailscale ping to `100.90.171.110`
- HTTP GET to `https://api2.staktrakr.com/data/retail/providers.json`

Writes `/tmp/flyio-health.json` — dashboard reads this for the Fly.io status card.

---

## Browser / Playwright Setup

The home poller runs Playwright with **local Chromium** — no Docker, no Browserless, no Playwright Service microservice.

| Property | Home Poller | Fly.io Container |
|----------|-------------|------------------|
| `BROWSER_MODE` | `local` | `local` |
| Playwright package | `playwright` (full, from npm) | `playwright-core` with local Chromium launch (`PLAYWRIGHT_LAUNCH=1`) |
| Chromium source | Playwright-managed (`npx playwright install chromium`) | Dockerfile-installed Chromium; separate Playwright service (port 3003) is used by Firecrawl, not by `price-extract.js` directly |
| Browser path | `/usr/local/share/playwright/` + `/root/.cache/ms-playwright/` | `/usr/local/share/playwright/` (copied from Docker stage) |
| System deps | Ubuntu apt packages (pre-installed) | Dockerfile `apt-get install` |

### Updating Playwright / Chromium

```bash
cd /opt/poller && sudo npm install playwright && sudo npx playwright install --with-deps chromium
```

> **Drift risk:** When the Fly.io Dockerfile pins a new Playwright version, the home poller will not automatically follow. Run the update command above after any `fly deploy` that bumps the Playwright version. Check with: `ssh -T homepoller 'node -e "import(\"playwright\").then(p=>console.log(p.chromium.name(),\"—\",p.chromium.executablePath()))"'`

---

## Key Paths

| Path | Purpose |
|------|---------|
| `/opt/poller/` | Poller scripts, JS source, package.json |
| `/opt/poller/dashboard.js` | Dashboard + provider editor + failure queue |
| `/opt/poller/metrics-exporter.js` | Prometheus metrics exporter |
| `/opt/poller/.env` | Secrets (Turso creds, POLLER_ID) — **never commit** |
| `/opt/poller/data/retail/providers.json` | Dealer URLs — local fallback copy (primary source is Turso) |
| `/opt/poller/docs/plans/` | Implementation plan docs |
| `/opt/firecrawl/` | Firecrawl API + worker binaries |
| `/opt/playwright-service/` | Playwright microservice |
| `/usr/local/share/playwright/` | Chromium for Playwright |
| `/etc/supervisor/conf.d/staktrakr.conf` | Supervisord config |
| `/etc/cron.d/retail-poller` | Retail poller cron (`30 * * * *`) |
| `/etc/cron.d/spot-poller` | Spot poller cron (`15,45 * * * *`) |
| `/etc/cron.d/flyio-health` | Fly.io health check cron (every 5 min) |
| `/etc/tinyproxy/tinyproxy.conf` | tinyproxy config |
| `/etc/grafana/provisioning/` | Grafana datasource + dashboard provisioning |
| `/etc/prometheus/prometheus.yml` | Prometheus scrape config |
| `/var/log/retail-poller.log` | Retail poller output (written by root) |
| `/var/log/spot-poller.log` | Spot poller output (written by root) |
| `/var/log/supervisor/` | Firecrawl/Playwright/dashboard/metrics service logs |
| `/tmp/flyio-health.json` | Fly.io health check result (read by dashboard) |

---

## Environment (`.env`)

| Variable | Required | Notes |
|----------|----------|-------|
| `TURSO_DATABASE_URL` | Yes | Turso/libSQL connection string |
| `TURSO_AUTH_TOKEN` | Yes | From Infisical `dev` env |
| `POLLER_ID` | Yes | Set to `home` |
| `DATA_DIR` | Yes | `/opt/poller/data` |
| `FIRECRAWL_BASE_URL` | Yes | `http://localhost:3002` |
| `FLYIO_TAILSCALE_IP` | Yes | `100.90.171.110` — used by `check-flyio.sh` |
| `GEMINI_API_KEY` | No | Enables vision pipeline (`capture.js` + `extract-vision.js`) |
| `PLAYWRIGHT_BROWSERS_PATH` | No | Default `/usr/local/share/playwright` — override if browsers installed elsewhere |
| `COINS` | No | Restrict to specific coins for testing |
| `DRY_RUN` | No | Set to `1` to skip DB writes |

---

## run-home.sh

1. Lockfile guard at `/tmp/retail-poller.lock` — skips if previous run still active
2. Loads `.env` from script directory
3. Providers loaded from **Turso** (file sync removed — STAK-348)
4. Runs `price-extract.js` — writes retail prices + run logs + failure logs to Turso

The vision pipeline (`capture.js` → `extract-vision.js`) runs on the home poller when `GEMINI_API_KEY` is set in `.env`. It uses `BROWSER_MODE=local` with Playwright's bundled Chromium.

---

## Common Tasks

### Check service health

```bash
sudo /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf status
systemctl status redis-server rabbitmq-server cron tailscaled tinyproxy grafana-server prometheus
```

### Test a single coin

```bash
COINS=ase bash /opt/poller/run-home.sh
```

### View recent logs

```bash
tail -100 /var/log/retail-poller.log
tail -50 /var/log/supervisor/firecrawl-api.log
sudo tail -20 /var/log/supervisor/metrics-exporter.log
```

### Restart Firecrawl stack

```bash
sudo /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf restart all
```

### Manual run after reboot or stale lock

```bash
sudo rm -f /tmp/retail-poller.lock
bash /opt/poller/run-home.sh
```

### Fix log file permissions

```bash
sudo touch /var/log/retail-poller.log
sudo chmod 666 /var/log/retail-poller.log
```

---

## Updating Poller Code

```bash
BASE=https://raw.githubusercontent.com/lbruton/StakTrakrApi/main/devops/fly-poller
for f in price-extract.js capture.js db.js turso-client.js provider-db.js merge-prices.js api-export.js \
          export-providers-json.js serve.js vision-patch.js extract-vision.js import-from-log.js \
          goldback-scraper.js run-home.sh run-fbp.sh run-spot.sh run-publish.sh run-goldback.sh \
          monitor-oos.sh package.json; do
  curl -sf "$BASE/$f" -o "/opt/poller/$f" || echo "WARN: $f not found upstream"
done
npm install
```

## Updating Firecrawl/Playwright Binaries

```bash
sudo docker run --rm ghcr.io/firecrawl/firecrawl:latest tar -cf - -C / app | sudo tar -xf - -C /opt/ && sudo mv /opt/app /opt/firecrawl
sudo docker run --rm ghcr.io/firecrawl/playwright-service:latest tar -cf - -C /usr/src app | sudo tar -xf - -C /opt/ && sudo mv /opt/app /opt/playwright-service
sudo /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf restart all
```

---

## Diagnosing Issues

| Symptom | Check |
|---------|-------|
| No rows from home poller in Turso | Cron running? Log shows errors? Turso auth valid? |
| Firecrawl/Playwright not responding | `supervisorctl status` — restart if needed |
| Turso provider load fails | Check Turso creds in `.env`; falls back to local `providers.json` automatically |
| Lockfile stuck after reboot | `sudo rm -f /tmp/retail-poller.lock` |
| Log file missing/unreadable | `sudo touch /var/log/retail-poller.log && sudo chmod 666 /var/log/retail-poller.log` |
| Dashboard not loading | `supervisorctl status dashboard` — restart; check `/var/log/supervisor/dashboard.log` |
| Grafana not loading | `systemctl status grafana-server` |
| Metrics exporter returning no supervisord services | Verify `/usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf status` works as root |
| Fly.io scraper traffic not through residential IP | Check `tinyproxy` running; verify `PROXY_SERVER` set on Fly.io |
| `ERR_MODULE_NOT_FOUND: playwright` | `npm install playwright && npx playwright install --with-deps chromium` in `/opt/poller/` |
| jmbullion returns fractional weights | Provider URL/selector issue — not a scraper bug |
| monumentmetals shows PRE-ORDER | FBP backfill usually covers it |

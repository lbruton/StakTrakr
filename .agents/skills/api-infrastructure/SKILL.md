---
name: api-infrastructure
description: API feeds, pollers, feed thresholds, data paths, StakTrakrApi structure, Fly.io and health badge issues.
---

# API Infrastructure

## Three-Feed Architecture

All feeds served from `lbruton/StakTrakrApi` `api` branch via GitHub Pages at `api.staktrakr.com`.

| Feed              | File                             | Poller                                                                                                                                         | Threshold       |
| ----------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Market prices** | `data/api/manifest.json`         | Fly.io `run-local.sh` + `run-publish.sh`                                                                                                       | 30 min          |
| **Spot prices**   | `data/hourly/YYYY/MM/DD/HH.json` | Fly.io `run-spot.sh` cron (`5,20,35,50 * * * *`)                                                                                               | 75 min          |
| **Goldback**      | `data/api/goldback-spot.json`    | Home poller scrapes → sqld → Fly.io `api-export.js` publishes (STAK-491)                                                                       | 25h (info only) |
| **sqld**          | `price_snapshots` table          | Dual-poller write-through (Fly.io `POLLER_ID=api` + Portainer VM `POLLER_ID=home`). Manage via Portainer API — see `home-infrastructure` skill | internal        |

**Critical:** `spot-history-YYYY.json` is a **seed file** (noon UTC daily) — never use it for freshness checks. Live spot data is always in `data/hourly/`.

---

## Feed Debugging Gotchas

- **Goldback scrapes HOURLY at :05** (cron `5 * * * *` in `devops/pollers/home-poller/docker-entrypoint.sh`) — changed from daily by **STRK-58** (CurrencyLayer-backed rate shifts intraday). `goldback-scraper.js` has no in-script skip-guard — the hourly cron is the dedup. Note: goldback.com's published rate (the `data.t`/`t` field in the v2 envelope) can lag the scrape time by hours, so `g1_usd` may be unchanged across several consecutive hourly publishes.
- **`api-health.js` reads `generated_at`, not `scraped_at`** — `generated_at` is rewritten each publish cycle by `api-export.js`. The goldback `scraped_at` is now refreshed hourly, but the 25h "info only" threshold is intentionally loose so a multi-hour scrape outage keeps the badge green.
- **Poller cron source of truth** — always grep `devops/pollers/home-poller/docker-entrypoint.sh` before citing any cron schedule.
- **API base is `data/v2/`** — set in `js/constants.js`.
- **For "frontend data is wrong" bugs** — `curl` the exact URL the frontend constructs BEFORE analyzing parse/schema logic. A 404 beats any schema analysis, and stale `localStorage` on a dev browser can mask fresh-browser regressions for months.

---

## Fly.io Container (`staktrakr`) — Thin Publisher (STAK-478)

- **App:** `staktrakr` — region `iad`, 1024MB RAM, 1 shared CPU
- **Config:** `StakTrakr/devops/pollers/remote-poller/fly.toml` + `Dockerfile`
- **Runs:** Spot cron (`0,30`), publish cron (`8,23,38,53`), provider export (`*/5`), serve.js. Retail/goldback disabled — handled by home poller.
- **Deploy:** From StakTrakr repo: `cd devops/pollers && fly deploy --config remote-poller/fly.toml --dockerfile remote-poller/Dockerfile`
- **NEVER deploy from StakTrakrApi** (code migrated to StakTrakr)
- **Logs:** `fly logs --app staktrakr`
- **SSH:** `fly ssh console --app staktrakr`

---

## GitHub Actions

| Workflow                | Repo           | Schedule                                          | Purpose                                            |
| ----------------------- | -------------- | ------------------------------------------------- | -------------------------------------------------- |
| `spot-poller.yml`       | `StakTrakr`    | **RETIRED 2026-02-23** — `workflow_dispatch` only | Was Python→MetalPriceAPI; now Fly.io `run-spot.sh` |
| `Merge Poller Branches` | `StakTrakrApi` | `*/15 min`                                        | Merges `api` → `main` → triggers GH Pages          |

---

## Database (sqld)

sqld is a self-hosted libSQL server on the home VM (`192.168.1.81:8080`). Both pollers write to it. Turso Cloud is retained as a nightly DR backup only.

- **Primary:** `http://staktrakr-sqld:8080` (Docker) / `http://192.168.1.81:8080` (Tailscale)
- **DR backup:** `staktrakrapi-lbruton.aws-us-east-2.turso.io` (Turso Cloud free tier, nightly sync)
- **Credentials:** `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (Infisical)
- **Table:** `price_snapshots` — one row per scrape attempt, per vendor, per 15-min window
- **Used by:** `price-extract.js`, `extract-vision.js`, `api-export.js` (retail-poller only)
- **NOT used by:** spot-poller (Python, writes to files directly — see STAK-331)
- **Schema:** see `turso-schema.md` (sqld schema page — filename retained from pre-migration)

---

## When Making Changes — Update ALL of These

| Location                                                        | What to update                                         |
| --------------------------------------------------------------- | ------------------------------------------------------ |
| `js/api-health.js`                                              | Stale thresholds, feed URLs, `_normalizeTs` logic      |
| DocVault (`/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/`): |                                                        |
| — `Health Checks.md`                                            | Health checks, stale thresholds, diagnosis commands    |
| — `Remote Poller.md`                                            | Fly config, crons, VM spec, GHA workflow table         |
| — `API Reference.md`                                            | Endpoint map, schemas, confidence tiers                |
| — `Turso Schema.md`                                             | Database tables, indexes, key queries                  |
| — `Home Poller.md`                                              | Home poller crons, dashboard, Firecrawl                |
| — `Poller Parity.md`                                            | Scrape pipeline comparison between pollers             |
| `lbruton/StakTrakrApi` `README.md`                              | If endpoints, branches, or directory structure changes |

> **Lookup:** `Read /Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/<page>.md` or `Grep` on the vault.
> **Deprecated:** In-repo `wiki/` and `docs/devops/api-infrastructure-runbook.md` — do not update.

---

## Quick Health Check

```bash
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
    print(f"Market   {'✅' if age<=30 else '⚠️'}  {age:.0f}m ago  ({len(d.get('coins',[]))} coins)")
except Exception as e: print(f"Market   ❌  {e}")
try:
    now = datetime.now(timezone.utc)
    def url(dt): return f"https://api.staktrakr.com/data/hourly/{dt.year}/{dt.month:02d}/{dt.day:02d}/{dt.hour:02d}.json"
    try: d = fetch(url(now))
    except: d = fetch(url(now - timedelta(hours=1)))
    age = age_min(d[-1]['timestamp'])
    print(f"Spot     {'✅' if age<=75 else '⚠️'}  {age:.0f}m ago")
except Exception as e: print(f"Spot     ❌  {e}")
try:
    d = fetch('https://api.staktrakr.com/data/api/goldback-spot.json')
    age = age_min(d['scraped_at'])
    print(f"Goldback {'✅' if age<=1500 else '⚠️'}  {age:.0f}m ago  (${d.get('g1_usd')} G1)")
except Exception as e: print(f"Goldback ❌  {e}")
EOF
```

---

## Deprecated Sources — Do NOT Update

| Source                                      | Status                                             |
| ------------------------------------------- | -------------------------------------------------- |
| Notion infrastructure pages                 | Deprecated 2026-02-25 — do not update              |
| `docs/devops/api-infrastructure-runbook.md` | Deprecated — will be deleted after next wiki audit |

**DocVault is the single source of truth.** All documentation changes go there via `/vault-update`.

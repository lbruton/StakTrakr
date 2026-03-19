---
name: api-infrastructure
description: Use when making any change to API feeds, pollers, feed thresholds, data file paths, or StakTrakrApi repo structure. Also use when diagnosing stale health badges, feed failures, or Fly.io/GHA poller issues. Triggers on any mention of manifest.json, goldback-spot.json, hourly files, spot-poller, retail-poller, Fly.io staktrakr app, or api.staktrakr.com.
---

# API Infrastructure

## Three-Feed Architecture

All feeds served from `lbruton/StakTrakrApi` `main` branch via GitHub Pages at `api.staktrakr.com`.

| Feed | File | Poller | Threshold |
|------|------|--------|-----------|
| **Market prices** | `data/api/manifest.json` | Fly.io `run-local.sh` + `run-publish.sh` | 30 min |
| **Spot prices** | `data/hourly/YYYY/MM/DD/HH.json` | Fly.io `run-spot.sh` cron (`5,20,35,50 * * * *`) | 75 min |
| **Goldback** | `data/api/goldback-spot.json` | Fly.io via `goldback-g1` coin in `run-local.sh` | 25h (info only) |
| **sqld** | `price_snapshots` table | Dual-poller write-through (Fly.io `POLLER_ID=api` + Portainer VM `POLLER_ID=home`). Manage via Portainer API — see `home-infrastructure` skill | internal |

**Critical:** `spot-history-YYYY.json` is a **seed file** (noon UTC daily) — never use it for freshness checks. Live spot data is always in `data/hourly/`.

---

## Fly.io Container (`staktrakr`)

- **App:** `staktrakr` — region `dfw`, 4096MB RAM, 4 shared CPUs
- **Config:** `StakTrakrApi/devops/fly-poller/fly.toml` + `Dockerfile` — **not in the StakTrakr repo**
- **Runs:** Firecrawl + Playwright + Redis + RabbitMQ + PostgreSQL + retail cron + spot cron + goldback + serve.js
- **Spot prices run here** — `run-spot.sh` at `5,20,35,50 * * * *` (NOT GHA)
- **Deploy:** From `lbruton/StakTrakrApi` repo: `cd devops/fly-poller && fly deploy`
- **NEVER run `fly deploy` from the StakTrakr or stakscrapr repos**
- **Logs:** `fly logs --app staktrakr`
- **SSH:** `fly ssh console --app staktrakr`

---

## GitHub Actions

| Workflow | Repo | Schedule | Purpose |
|----------|------|----------|---------|
| `spot-poller.yml` | `StakTrakr` | **RETIRED 2026-02-23** — `workflow_dispatch` only | Was Python→MetalPriceAPI; now Fly.io `run-spot.sh` |
| `Merge Poller Branches` | `StakTrakrApi` | `*/15 min` | Merges `api` → `main` → triggers GH Pages |

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

| Location | What to update |
|----------|---------------|
| `js/api-health.js` | Stale thresholds, feed URLs, `_normalizeTs` logic |
| `CLAUDE.md` API Infrastructure table | Feed/threshold/healthy-check summary |
| `wiki/` (in-repo, single source of truth): | |
| — `wiki/health.md` | Health checks, stale thresholds, diagnosis commands |
| — `wiki/fly-container.md` | Fly config, crons, VM spec, GHA workflow table |
| — `wiki/rest-api-reference.md` | Endpoint map, schemas, confidence tiers |
| — `wiki/turso-schema.md` | Database tables, indexes, key queries |
| — `wiki/cron-schedule.md` | Full cron timeline |
| — `wiki/spot-pipeline.md` | Spot poller architecture |
| — `wiki/goldback-pipeline.md` | Per-state slugs, denomination generation |
| — `wiki/retail-pipeline.md` | Dual-poller, T1–T5 resilience |
| `lbruton/StakTrakrApi` `README.md` | If endpoints, branches, or directory structure changes |

> **Lookup:** Search via `mcp__claude-context__search_code` with `path: /Volumes/DATA/GitHub/StakTrakr/wiki`.
> **Deprecated:** `docs/devops/api-infrastructure-runbook.md` — do not update, will be deleted.

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

| Source | Status |
|--------|--------|
| Notion infrastructure pages | Deprecated 2026-02-25 — do not update |
| `docs/devops/api-infrastructure-runbook.md` | Deprecated — will be deleted after next wiki audit |

**`wiki/` (in-repo) is the single source of truth.** All documentation changes go there.
See `/wiki-search` for how to search the wiki.

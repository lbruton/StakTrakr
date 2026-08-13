---
title: "Health Checks"
project: StakTrakr
audience: agent
canonical: .context/deep-dives/health-checks.md
source: "DocVault/Projects/StakTrakr/Foundation/Deep Dives/Health Checks.md" # migrated 2026-08-12
updated: "2026-08-12"
---

# Health & Diagnostics

> **Last verified:** 2026-08-12 — v2 endpoints, envelope-driven staleness (STAK-509: v1 no longer consumed)

---

## Quick Health Check

v2 envelopes carry their own `stale_after`, so the script needs no hardcoded thresholds
(goldback resolves to 7200 s = 120 min):

```python
python3 << 'EOF'
import urllib.request, json
from datetime import datetime, timezone

BASE = 'https://api.staktrakr.com/data/v2'

def fetch(path):
    with urllib.request.urlopen(f"{BASE}/{path}", timeout=10) as r: return json.load(r)

def check(name, path, detail=lambda d: ''):
    try:
        env = fetch(path)
        gen = datetime.fromisoformat(env['generated_at'].replace('Z', '+00:00'))
        age = (datetime.now(timezone.utc) - gen).total_seconds()
        limit = env.get('stale_after', 1800)
        state = 'OK' if age <= limit else 'STALE'
        print(f"{name:9s}{state:6s}{age/60:5.0f}m ago  (stale_after {limit//60}m){detail(env['data'])}")
    except Exception as e:
        print(f"{name:9s}FAIL  {e}")

print(f"API Health (v2) — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n")
check('Manifest', 'manifest.json', lambda d: f"  ({d.get('coin_count', '?')} coins)")
check('Spot', 'spot/latest.json')
check('Goldback', 'goldback/latest.json', lambda d: f"  (${d.get('g1_usd')} G1)")
EOF
```

> Raw pipeline paths (`data/hourly/`, `data/15min/`) are still written 4×/hr and can be
> spot-checked directly when diagnosing the writers rather than the serving layer.

---

## Stale Thresholds

| Feed                             | Stale at | Critical at | Notes                                                                         |
| -------------------------------- | -------- | ----------- | ----------------------------------------------------------------------------- |
| Market prices (`manifest.json`)  | 30 min   | 4 hours     |                                                                               |
| Spot prices — UI freshness badge | 20 min   | —           | Threshold in `api-health.js`                                                  |
| Spot prices — operational stale  | 75 min   | 3 hours     | Used by health-check scripts and diagnostics                                  |
| Goldback                         | 2 hours  | 48 hours    | v2 envelope `stale_after` 7200 s when `USE_V2_API` (was 25 h before STRK-248) |

---

## Container Status

```bash
# Fly.io machine and service status
fly status --app staktrakr
fly ssh console --app staktrakr -C "supervisorctl status"

# Logs (all services)
fly logs --app staktrakr

# Filter by pipeline
fly logs --app staktrakr | grep -E 'retail|publish|spot|goldback|ERROR|WARN'

# Log files inside container (slim image: spot, publish, HTTP server, provider-export only)
fly ssh console --app staktrakr -C "tail -50 /var/log/spot-poller.log"
fly ssh console --app staktrakr -C "tail -50 /var/log/publish.log"
fly ssh console --app staktrakr -C "tail -50 /var/log/provider-export.log"
```

---

## GitHub Actions Status

```bash
# Merge Poller Branches (retired/manual-only)
gh run list --repo lbruton/StakTrakrApi --workflow "Merge Poller Branches" --limit 5

# Spot poller (retired — manual trigger only)
gh run list --repo lbruton/StakTrakrApi --workflow "spot-poller.yml" --limit 5
```

---

## Database (sqld)

Check for recent rows from both pollers:

```bash
# Query sqld via HTTP API
curl -s http://192.168.1.81:8080/v2/pipeline -H 'Content-Type: application/json' -d '{
  "requests": [{"type":"execute","stmt":{"sql":"SELECT poller_id, COUNT(*) as rows, MAX(scraped_at) as latest FROM price_snapshots WHERE scraped_at > datetime('"'"'now'"'"', '"'"'-2 hours'"'"') GROUP BY poller_id"}}]
}' | jq '.results[0].response.result.rows'
```

Expected: rows from `home` (retail), `home-spot` (spot from home poller), and `fly-spot` (spot from Fly.io) pollers within the last 2 hours. Only `home` produces retail rows since STAK-478.

---

## Diagnosing by Symptom

| Symptom                               | Likely cause                                                                  | Action                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `v2/manifest.json` > 30 min stale     | Home poller `run-home.sh` missed cycle or Fly.io `run-publish.sh` not running | Check home poller logs via Portainer dashboard; `fly logs --app staktrakr \| grep publish`                        |
| `v2/manifest.json` > 4h stale         | Home poller or Fly.io container down                                          | Check home poller container in Portainer; `fly status --app staktrakr`                                            |
| Spot hourly > 75 min stale            | `METAL_PRICE_API_KEY` expired or quota exceeded                               | Check MetalPriceAPI dashboard                                                                                     |
| Goldback > 2h stale (STRK-248)        | Home poller `goldback-scraper.js` failed                                      | Check home poller logs via Portainer dashboard (goldback runs on home only, not Fly.io)                           |
| Only 1-2 vendors per coin             | Home poller down or OOS                                                       | Check home poller container; verify sqld has recent rows (home is sole retail scraper)                            |
| Vendor missing multiple cycles        | URL changed or bot-blocked                                                    | Update vendor URL via [dashboard](http://192.168.1.81:3010/providers) or `provider-db.js` — see Provider Database |
| OOM on Fly.io                         | Concurrent api-export.js invocations                                          | Verify publish lockfile; `fly scale show` — expect 1 shared CPU / 1024 MB (STAK-478 slim image)                   |
| Monument Metals missing at year-start | Random-year SKU on pre-order                                                  | Switch to year-specific SKU in providers.json                                                                     |
| JMBullion presale coins show OOS      | Pre-order pattern matching                                                    | Verify `preorderTolerant` on the vendor descriptor, or `LEGACY_PREORDER_TOLERANT_PROVIDERS`                       |
| Merge workflow failing                | Branch conflict or jq parse error                                             | Retired/manual-only — `api` branch is now served directly by GitHub Pages                                         |
| ~~Both pollers firing at same time~~  | Historical (pre-STAK-478) — Fly.io no longer runs retail scraping             | N/A — only home poller scrapes retail                                                                             |
| `api-export.js` import crash          | `db.js` missing export after refactor                                         | `fly ssh console -C "sh -c 'tail -5 /var/log/publish.log'"` — look for `SyntaxError`                              |

---

## Manual Triggers

```bash
# Force a publish cycle (Fly.io)
fly ssh console --app staktrakr -C "/app/run-publish.sh"

# Force a spot poll (Fly.io)
fly ssh console --app staktrakr -C "/app/run-spot.sh"

# Home poller — use Portainer web UI Console on staktrakr-home-poller container:
#   Force retail scrape:  bash /app/run-home.sh
#   Force goldback scrape: node /app/goldback-scraper.js
#   Force spot poll:       node /app/spot-extract.js
```

> **Note:** Retail and goldback scraping run on the home poller only (STAK-478). `run-local.sh` and `run-goldback.sh` do not exist on the Fly.io slim image.

---

## Lockfile Issues

If a script was killed mid-run, its lockfile may remain:

```bash
# Fly.io
fly ssh console --app staktrakr -C "rm -f /tmp/retail-poller.lock /tmp/retail-publish.lock /tmp/goldback-poller.lock"

# Home poller — use Portainer web UI Console on staktrakr-home-poller container:
#   rm -f /tmp/retail-poller.lock
```

---

## Incident Log

### 2026-02-25: Publish pipeline down + cron collision (4h outage)

**Impact:** API JSON files stopped updating for ~4 hours. Market prices 50+ min stale. Both pollers colliding on same schedule.

**Root cause:** The `retail-poller -> fly-poller` rename (commit `4e23633`) introduced two regressions:

1. **`db.js` missing `readLatestPerVendor` export** -- `api-export.js` imports this function to merge data from both pollers into vendor maps. Without it, `run-publish.sh` crashed on every cycle with `SyntaxError: The requested module './db.js' does not provide an export named 'readLatestPerVendor'`. No new JSON was written to the `api` branch.

2. **`docker-entrypoint.sh` defaulted `CRON_SCHEDULE` to `*/15`** instead of `15,45` (the schedule at the time). This fired the Fly.io retail poller at `:00/:15/:30/:45` instead of just `:15/:45`, colliding with the home poller at `:00/:30`. Both pollers wrote to the same Turso `window_start` simultaneously, and the `:15/:45` windows were empty. (Note: schedule has since been relaxed to `0` / `30` — see Cloud - Fly.io.)

3. **`db.js` also missing `startRunLog`/`finishRunLog`** -- `price-extract.js` imports these for Turso run logging. The scraper crashed before executing any scrape logic. (Home poller was unaffected -- separate codebase.)

**Fix:** Commit `c80442f` on StakTrakrApi main:

- Added `readLatestPerVendor()` to `db.js` (latest non-failed row per vendor within lookback window)
- Changed `CRON_SCHEDULE` default from `*/15` to `15,45`
- Three deploys total to restore full pipeline

**Lesson:** After any `git mv` refactor that touches the Fly.io deploy path, verify all ES module imports resolve on the deployed container before moving on. The `SyntaxError` is fatal at parse time -- nothing runs.

---

## v2 Health Check Path (STAK-503)

v2 endpoints embed their own staleness threshold via the `stale_after` field in the envelope. Instead of comparing against hardcoded thresholds, v2 health checks compute freshness dynamically:

```text
stale = (now_utc - generated_at) > stale_after
```

Each endpoint type declares its own `stale_after` value (in seconds):

| Type     | `stale_after` | Equivalent                             |
| -------- | ------------- | -------------------------------------- |
| Spot     | 1200          | 20 min                                 |
| Retail   | 1800          | 30 min                                 |
| Goldback | 7200          | 2 h (was 90000 / 25 h before STRK-248) |
| Manifest | 1800          | 30 min                                 |

The v2 manifest also publishes these thresholds in `data.stale_thresholds`. Since STAK-506/509 (`USE_V2_API` flag shipped as default, then removed — v2 is the sole consumed layer), `api-health.js` always reads `stale_after` from the v2 envelope; the hardcoded `API_HEALTH_*_STALE_MIN` era is over. Per STRK-331, both the data paths and the badge resolve freshness from the **freshest `generated_at` per feed** across serving endpoints.

---

## Related

- Home Poller — home poller container and dashboard
- Remote Poller — Fly.io container deployment and environment

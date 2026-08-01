---
name: retail-poller
description: Retail market price poller — scraping failures, confidence scores, providers.json, data pipeline.
---

# StakTrakr Retail Price Poller

Reference guide for the retail market price polling system. Scrapes dealer websites, scores confidence, exports REST JSON served from the `api` branch.

---

## Architecture Overview

```text
providers.json (api branch)
       ↓
price-extract.js  (Firecrawl → sqld)
       +
capture.js  (Browserbase/browserless → screenshots)
       +
extract-vision.js  (Gemini Vision → per-coin vision JSON)
       ↓
api-export.js  (sqld + vision JSON → data/api/ REST endpoints → api branch)
```

> **Repo:** All poller scripts now live in `StakTrakr/devops/pollers/` — shared core in `shared/`, Fly.io config in `remote-poller/`, home VM config in `home-poller/`. Deploy: `cd devops/pollers && fly deploy --config remote-poller/fly.toml`. The old `StakTrakrApi/devops/fly-poller/` location is deprecated.

**Home poller is the sole retail scraper (STAK-478) — Fly.io only publishes:**

| Pipeline                      | Browser                               | Role                          | Trigger                            |
| ----------------------------- | ------------------------------------- | ----------------------------- | ---------------------------------- |
| **Home VM** (`run-home.sh`)   | Playwright local + Firecrawl + Byparr | **Sole retail scraper**       | Hourly at `:30` via container cron |
| **Fly.io** (`run-publish.sh`) | —                                     | Publisher (sqld → api branch) | `8,23,38,53 * * * *`               |

**Exception — MintBuilder is feed-first (STRK-321/325):** resolved against the direct vendor API (one memoized GET per run) with page-scrape fallback; see the Direct API Access table below.

**No GHA cloud failsafe for retail.** `retail-price-poller.yml` was deleted 2026-02-22 (was sending requests to public Firecrawl cloud API, burning paid credits — STAK-268). Manage containers via Portainer REST API — see `home-infrastructure` skill.

**Key constraint:** `providers.json` lives on the **`api` branch**, not `main` or `dev`.
Path on disk: `$DATA_REPO_PATH/data/retail/providers.json`

**Vision verification + fallback:** Vision runs inline — no separate follow-up step. Screenshots go to `ARTIFACT_DIR` (`/tmp/retail-screenshots/{date}` on Fly.io). `extract-vision.js` reads `MANIFEST_PATH` AND reads Firecrawl prices from sqld to pass as context in the Gemini prompt. Vision JSON writes to `DATA_DIR/retail/{slug}/{date}-vision.json` with fields: `firecrawl_by_site` (Firecrawl prices for comparison) and `agreement_by_site` (per-vendor boolean: does Vision confirm Firecrawl's price?). `api-export.js` loads via `loadVisionData()` and resolves via `resolveVendorPrice()` — 99% confidence when both agree, Vision-only fallback when Firecrawl returns null, median-based tiebreaker when they disagree. `merge-prices.js` is legacy and not called.

---

## File Map

| File                                                        | Purpose                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `devops/pollers/shared/price-extract.js`                    | Primary scraper — Firecrawl + Playwright fallback → sqld                       |
| `devops/pollers/shared/capture.js`                          | Screenshot capture — `BROWSER_MODE=browserless` / `browserbase` / `local`      |
| `devops/pollers/shared/extract-vision.js`                   | Gemini Vision price extraction from screenshots → per-coin JSON files          |
| `devops/pollers/shared/api-export.js`                       | sqld + vision JSON → `data/api/` static JSON endpoints with confidence scoring |
| `devops/pollers/shared/export-providers-json.js`            | sqld → `/data/retail/providers.json` (runs every 5 min via cron)               |
| `devops/pollers/shared/turso-client.js`                     | sqld/libSQL client factory                                                     |
| `devops/pollers/shared/provider-db.js`                      | Provider CRUD + export from sqld                                               |
| `devops/pollers/shared/price-extract-vendors.js`            | Vendor module registry + `scrapeVendor()` dispatch (STRK-32/314)               |
| `devops/pollers/shared/price-extract-vendor-mintbuilder.js` | MintBuilder feed-first `scrape()` with page-scrape fallback (STRK-321/325)     |
| `devops/pollers/shared/price-extract-mintbuilder-feed.js`   | MintBuilder feed client — memoized index, URL matching, hybrid stock predicate |
| `devops/pollers/remote-poller/run-local.sh`                 | Full Fly.io run: extract → capture → vision → export → push                    |
| `devops/pollers/remote-poller/run-publish.sh`               | API export + git push to api branch                                            |
| `devops/pollers/remote-poller/docker-entrypoint.sh`         | Container startup (creates `/data/retail/`, writes crontab, exports env)       |
| `devops/pollers/remote-poller/Dockerfile`                   | Fly.io all-in-one container image                                              |
| `devops/pollers/home-poller/run-home.sh`                    | Home VM retail scrape run                                                      |
| `devops/pollers/home-poller/docker-entrypoint.sh`           | Home container startup                                                         |

---

## Vendor API Endpoints (Structured Data)

### Direct API Access (No Scraping Needed)

| Vendor          | Platform        | API                                          | Auth         | Notes                                                                                                                                                                              |
| --------------- | --------------- | -------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MintBuilder** | Custom          | `GET /feed/api/prices?key=…&mintbuilder=all` | `MB_API_KEY` | **LIVE (STRK-321/325)** — feed-first vendor module, ~314 products; `tiers[].qty_max` = live inventory; hybrid stock rule: `max(qty_max) ≤ 1` is ambiguous → that item page-scrapes |
| **SD Bullion**  | Magento 2       | REST `/rest/V1/nfusions/cache/pricing`       | None         | Full catalog (6,003 SKUs), tiered pricing, cash/BTC/CC — documented, not wired                                                                                                     |
| **APMEX**       | Traditional SSR | JSON-LD in HTML                              | None         | `schema.org/Product` with price + availability                                                                                                                                     |

### Cloudflare-Gated APIs (Need CF Cookie)

| Vendor                | Platform              | API                | Notes                                                          |
| --------------------- | --------------------- | ------------------ | -------------------------------------------------------------- |
| **Bullion Exchanges** | Magento 2 PWA         | GraphQL `/graphql` | `route()` → product ID, `LivePrices(ids:[ID])` → tier pricing  |
| **Monument Metals**   | Magento 2 + ScandiPWA | GraphQL `/graphql` | `getProductDetailForProductPage` → tiers, `metalPrices` → spot |

### HTML Scraping Only

| Vendor           | Platform           | Notes                                                                |
| ---------------- | ------------------ | -------------------------------------------------------------------- |
| **JM Bullion**   | Next.js App Router | Spot API only at `contentapi-managed.jmbullion.com/api/spot/summary` |
| **Hero Bullion** | WooCommerce        | REST API exists but returns 401                                      |

### CF Bypass Stack

- Primary: FlareSolverr nodriver fork (`21hsmw/flaresolverr:nodriver`) — Docker, HTTP API port 8191
- Fallback: Byparr (drop-in replacement, Firefox/Camoufox-based, same API)
- `cf_clearance` cookies bound to IP + User-Agent + TLS fingerprint
- Use `curl_cffi` (not Python `requests`) for cookie reuse — matches browser TLS fingerprint

---

## Provider Sync (export-providers-json.js)

Both pollers run `export-providers-json.js` every 5 minutes via cron to sync `providers.json` from sqld to local volume.

| Poller  | Cron          | Log Path                         | Volume Path                   |
| ------- | ------------- | -------------------------------- | ----------------------------- |
| Fly.io  | `*/5 * * * *` | `/var/log/provider-export.log`   | `/data/retail/providers.json` |
| Home VM | `*/5 * * * *` | `/data/logs/provider-export.log` | `/data/retail/providers.json` |

The `/data/retail/` directory must exist before the script runs. The Fly.io entrypoint creates it via `mkdir -p /data/retail` at startup. The script also does `mkdirSync(dirname(outPath), { recursive: true })` as a safety net. Non-fatal — if the database is down, the existing file is kept as-is.

---

## providers.json Structure

Located at `$DATA_REPO_PATH/data/retail/providers.json` on the **api branch**.

```json
{
  "coins": {
    "ase": {
      "name": "American Silver Eagle",
      "metal": "silver",
      "weight_oz": 1,
      "fbp_url": "https://findbullionprices.com/p/american-silver-eagle/",
      "providers": [
        {
          "id": "apmex",
          "enabled": true,
          "url": "https://www.apmex.com/product/..."
        },
        {
          "id": "sdbullion",
          "enabled": true,
          "url": "https://sdbullion.com/..."
        }
      ]
    }
  }
}
```

**Coin fields:** `name`, `metal` (`silver`/`gold`/`platinum`/`palladium`), `weight_oz`, `fbp_url` (FindBullionPrices fallback URL)

**Provider fields:** `id` (the vendor id dispatched through the `price-extract-vendors.js` registry — migrated modules or the legacy adapter), `enabled`, `url`, plus optional `selector`, `hints` (free-form JSON; carries `{"mbProductId"}` for MintBuilder feed pinning), `skipPriceBounds`

To add a new vendor: add its rows via the dashboard (`/providers`, writes sqld `provider_vendors`); write a vendor module + register it in `price-extract-vendors.js` only when it needs custom behavior. (`FBP_DEALER_NAME_MAP` no longer exists.)

---

## Price Extraction Logic

### Extraction Strategy (price-extract.js)

Two provider groups with different strategies:

**`USES_AS_LOW_AS` providers** (jmbullion, monumentmetals):

1. Scan all `"As Low As $XX.XX"` matches → filter by weight-adjusted metal range → take **minimum**
2. Fallback: table cell prices

**All other providers** (apmex, sdbullion, etc.):

1. Pricing table cells first (avoids picking up related-product "As Low As")
2. Fallback: "As Low As" scan

**Metal price ranges** (per oz, used to filter out accessories/spot tickers):

```text
silver:    $40–200/oz
gold:      $1,500–15,000/oz
platinum:  $500–6,000/oz
palladium: $300–6,000/oz
```

Range is multiplied by `weight_oz` for multi-oz products (e.g. 10oz bar = $400–2000).

### SDB Fix Applied (2026-02-20)

SDB pages show "As Low As" only in add-on accessories and carousel sections — NOT for the main product. The main product price is in a pricing table.

**Root cause (was):** `sdbullion` was in `USES_AS_LOW_AS` → `Math.min()` picked carousel/add-on prices.
**Fix applied:**

1. `sdbullion` removed from `USES_AS_LOW_AS` → now uses table-first strategy (same as APMEX).
2. `preprocessMarkdown(markdown, providerId)` added — truncates SDB markdown at `**Add on Items**` / `Customers Also Purchased` before any price extraction. Covers both Firecrawl markdown and Playwright HTML variants.

### Playwright Fallback

If Firecrawl returns no price, `scrapeWithPlaywright()` tries a browserless remote browser (`BROWSERLESS_URL` env var). `SLOW_PROVIDERS = {jmbullion, herobullion, summitmetals}` get an extra 4s wait.

### FBP Gap-Fill

After primary scrapes, any coin with failures scrapes `fbp_url` (FindBullionPrices comparison table). `extractFbpPrices()` parses FBP table rows, maps FBP dealer names to vendor ids, writes as `source: "fbp"` to sqld.

`run-fbp.sh` (the PM cron at 3pm ET) runs `PATCH_GAPS=1 node price-extract.js` to fill only today's gaps.

---

## Database (sqld)

**Provider:** sqld (self-hosted libSQL server on home VM at `192.168.1.81:8080`). Both pollers connect via Docker DNS (`http://staktrakr-sqld:8080`) or Tailscale subnet routing (`http://192.168.1.81:8080` from Fly.io). Turso Cloud is retained as DR backup only (nightly sync). Credentials in Infisical + Fly secrets (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`).

**Dual-poller write-through:** Both Fly.io (`POLLER_ID=api`) and Portainer VM (`POLLER_ID=home`) write to the same sqld database. `api-export.js` uses `readLatestPerVendor()` to merge — most recent row per vendor within last 2h wins. Check home poller logs via Portainer API — see `home-infrastructure` skill.

**Table:** `price_snapshots`

| Column         | Type    | Notes                                      |
| -------------- | ------- | ------------------------------------------ |
| `scraped_at`   | TEXT    | ISO8601 UTC timestamp of actual scrape     |
| `window_start` | TEXT    | 15-min floor (e.g. `2026-02-20T14:15:00Z`) |
| `coin_slug`    | TEXT    | Matches providers.json key (e.g. `ase`)    |
| `vendor`       | TEXT    | Provider id (e.g. `apmex`)                 |
| `price`        | REAL    | null if scrape failed                      |
| `source`       | TEXT    | `firecrawl` \| `playwright` \| `fbp`       |
| `confidence`   | INTEGER | Score from `scoreVendorPrice()`; nullable  |
| `is_failed`    | INTEGER | 1 if price is null                         |
| `in_stock`     | INTEGER | 0 if OOS patterns matched                  |

> **No `poller_id` column on `price_snapshots`.** `POLLER_ID` is an env var used for
> run bookkeeping and retry backoff, and it _is_ a real column on `poller_runs` and
> `spot_prices` — but not here. Schema of record: `initSqldSchema()` in
> `devops/pollers/shared/sqld-client.js`. Do not write queries that group
> `price_snapshots` by `poller_id` (STRK-255).

**Window floor:** every scrape is bucketed to the nearest 15-min UTC floor. The 24h history chart uses 96 windows.

---

## Confidence Scoring

### api-export.js (live scoring per window)

`scoreVendorPrice(price, windowMedian, prevMedian)`:

| Condition                          | Score delta |
| ---------------------------------- | ----------- |
| Base (single source)               | +50         |
| Within 3% of window median         | +30         |
| >8% from window median             | -15         |
| >10% day-over-day from prev median | -20         |

**Result:** 80% = no outlier (50+30), 50% = mild outlier (50), 35% = strong outlier (50-15), 15% = outlier AND large day-over-day shift (50-15-20).

### merge-prices.js (when both Firecrawl + Vision are available)

`scorePrice({firecrawlPrice, visionPrice, visionConfidence, prevPrice, medianPrice})`:

| Condition                         | Score delta |
| --------------------------------- | ----------- |
| Both methods within 2%            | +40         |
| Both within 5%                    | +20         |
| Methods disagree >5%              | +5          |
| Single method only                | +50         |
| Vision confidence high/medium/low | +15/+5/-10  |
| Within 3% of today's median       | +10         |
| >8% from today's median           | -15         |
| >10% day-over-day                 | -20         |

High confidence threshold: ≥70 pts.

---

## API Output Files

Written to `$DATA_REPO_PATH/data/api/` and served from the `api` branch.

| File                               | Contents                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `data/api/latest.json`             | All coins, current window: `median_price`, `lowest_price`, `vendor_count` |
| `data/api/{slug}/latest.json`      | Single coin: vendors map with price + confidence, 24h windows series      |
| `data/api/{slug}/history-7d.json`  | Daily aggregates, 7 days                                                  |
| `data/api/{slug}/history-30d.json` | Daily aggregates, 30 days                                                 |
| `data/api/manifest.json`           | Coin list, last updated, window count                                     |

The StakTrakr app fetches `data/api/{slug}/latest.json` in `retail-view-modal.js` and `data/api/latest.json` in `retail.js`.

---

## Environment Variables

| Var                      | Used by                      | Notes                                                                                                                                                                                  |
| ------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATA_REPO_PATH`         | run-local.sh, run-fbp.sh     | Path to git checkout of api branch                                                                                                                                                     |
| `DATA_DIR`               | all scripts                  | `$DATA_REPO_PATH/data`                                                                                                                                                                 |
| `FIRECRAWL_API_KEY`      | price-extract.js             | Cloud Firecrawl; omit for self-hosted                                                                                                                                                  |
| `FIRECRAWL_BASE_URL`     | price-extract.js             | Self-hosted: `http://localhost:3002`; default: cloud                                                                                                                                   |
| `BROWSERLESS_URL`        | price-extract.js, capture.js | `ws://host.docker.internal:3000/chromium/playwright?token=local_dev_token` — Playwright fallback in price-extract AND browserless CDP in capture.js (`BROWSER_MODE=browserless`)       |
| `BROWSER_MODE`           | capture.js                   | `browserbase` (cloud, default in Action), `browserless` (self-hosted Docker), or `local` (local Chromium via `playwright.launch()`)                                                    |
| `ARTIFACT_DIR`           | capture.js                   | Screenshots output dir. Action: `DATA_DIR/retail/_artifacts/{date}`. Local: `/tmp/retail-screenshots/{date}`. capture.js writes `manifest.json` here.                                  |
| `MANIFEST_PATH`          | extract-vision.js            | Full path to `manifest.json` written by capture.js. `run-local.sh` sets this to `$ARTIFACT_DIR/manifest.json`. Action passes as `${{ steps.ctx.outputs.artifact_dir }}/manifest.json`. |
| `BROWSERBASE_API_KEY`    | capture.js                   | Cloud Browserbase only — not needed when using browserless Docker                                                                                                                      |
| `BROWSERBASE_PROJECT_ID` | capture.js                   | Cloud Browserbase only                                                                                                                                                                 |
| `GEMINI_API_KEY`         | extract-vision.js            | Google AI Studio key for vision extraction                                                                                                                                             |
| `COINS`                  | all scripts                  | Comma-separated slug filter (default: all)                                                                                                                                             |
| `PROVIDERS`              | capture.js                   | Comma-separated provider filter                                                                                                                                                        |
| `DRY_RUN`                | all scripts                  | `1` = skip writes                                                                                                                                                                      |
| `PATCH_GAPS`             | price-extract.js             | `1` = gap-fill mode (FBP only for failed vendors)                                                                                                                                      |

---

## Running Locally

```bash
cd devops/pollers

# Full run against self-hosted Firecrawl (port 3002)
DATA_REPO_PATH=/path/to/api-branch-checkout \
FIRECRAWL_BASE_URL=http://localhost:3002 \
node price-extract.js

# Dry-run single coin
COINS=ase DRY_RUN=1 DATA_DIR=/path/to/api-branch/data node price-extract.js

# Export API JSON from existing sqld data
DATA_DIR=/path/to/api-branch/data node api-export.js

# Gap-fill only (FBP scrape for failed vendors)
PATCH_GAPS=1 DATA_DIR=/path/to/api-branch/data node price-extract.js
```

---

## API Branch Git Safety

**The api branch is a write-only output channel for the poller.** It must be treated with extra care — multiple agents (Fly.io container, home VM, manual commits) push to it concurrently.

### Known Fragility: `git pull --rebase` at run start

`run-local.sh` uses `git pull --rebase origin api` before each scrape. If another agent commits to the api branch **between** the poller's pull and its final push, the rebase of the local export commit will fail with:

```text
fatal: It seems that there is already a rebase-merge directory
```

Every subsequent 15-minute cron tick will hit the same error and silently no-op. **Retail prices freeze while spot prices continue normally** — the key symptom.

### Safer pre-run sync (recommended future fix)

Replace the start-of-run `git pull --rebase` with a hard reset — since the container's local branch is regenerated from scratch every run, preserving local commits before a pull is unnecessary:

```bash
# Instead of: git pull --rebase origin api
git fetch origin api && git reset --hard origin/api
```

Keep the final `git pull --rebase origin api` before push (that one is correct — it replays the fresh export commit on top of any commits that landed during the scrape).

### Pausing GHA workflows during manual api branch work

No retail GHA workflow is active. `retail-price-poller.yml` was deleted. If you need to work on the api branch manually (backfilling data, patching providers.json), the only active writers are:

- Fly.io `run-publish.sh` (every 15 min)
- Home VM (writes to sqld only, never pushes to git)

You can safely push to the api branch without disabling any GHA workflow.

### After any commit directly to the api branch

**Always verify the retail-poller container recovered.** A commit to api can race with a running poll and leave a stuck rebase. After pushing any commit to api (providers.json updates, manual patches, backfill scripts):

```bash
# 1. Check container logs for rebase errors
fly ssh console --app staktrakr -C "tail -20 /var/log/retail-poller.log"

# 2. If you see "rebase-merge directory" errors:
fly ssh console --app staktrakr -C "
  cd /data/staktrakr-api-export
  git rebase --abort 2>/dev/null || true
  git fetch origin api && git reset --hard origin/api
  echo 'API branch reset OK'
  git log --oneline -3
"

# 3. Confirm next cron tick runs clean (watch for ~15 min)
fly logs --app staktrakr | grep retail
```

### Verifying retail data freshness

Check the api branch directly — `window_start` should be within the last 20 minutes:

```bash
curl -s https://api.staktrakr.com/data/api/ase/latest.json | python3 -m json.tool | grep window_start
```

Or check the last 5 api branch commits:

```bash
gh api "repos/lbruton/StakTrakrApi/commits?sha=api&per_page=5" \
  --jq '.[].commit | {message: .message, date: .author.date}'
```

If the most recent `retail: YYYY-MM-DD api export` commit is >15 minutes old, the container is stuck — run the recovery steps above.

### sqld row count verification

If the database appears suspect, verify the row count:

```bash
# Verify sqld row count
fly ssh console --app staktrakr -C "node -e \"
const {createClient} = require('@libsql/client');
const db = createClient({url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN});
db.execute('SELECT COUNT(*) as n FROM price_snapshots').then(r => { console.log('rows:', r.rows[0].n); process.exit(0); });
\""
```

---

## Common Debugging Patterns

**Low confidence on SDB prices (fixed 2026-02-20):** `sdbullion` was removed from `USES_AS_LOW_AS` and now uses table-first strategy. `preprocessMarkdown()` strips the "Add on Items" carousel before price extraction. If SDB prices still look wrong, check that the page pricing table structure hasn't changed — use `DRY_RUN=1 COINS=ase` with console logging to inspect what's extracted.

**80% confidence ceiling:** Single-source only (no Vision). 50 base + 30 (within 3% of median) = 80. This is the ceiling without Vision data. Normal for Firecrawl-only runs.

**15% confidence:** Vendor price is far from median AND large day-over-day change. Usually wrong extraction. Check FBP or the actual URL.

**price = null:** Firecrawl got a page but no parseable price, AND Playwright fallback also failed. Check if the URL is still valid and page structure changed.

**FBP fallback triggered:** Check `source: "fbp"` in sqld — means primary scrape failed. FBP prices are wire/ACH prices (lowest available).

**Retail prices frozen, spot still updating:** Stuck rebase in the container. See API Branch Git Safety section above.

---
title: "StakTrakr — Data Pipelines"
project: StakTrakr
audience: agent
canonical: .context/data-pipelines.md
migration_source: "DocVault/Projects/StakTrakr/Foundation/data-pipelines.md" # historical provenance; migrated 2026-08-12
updated: "2026-06-28"
---

# StakTrakr — Data Pipelines

Authoritative reference for all four data pipelines. Each section covers data source → transform → storage → API export → frontend consumption, with verified cron schedules, stale thresholds, sqld tables, and failure modes.

**Cron schedule source of truth:** `devops/pollers/home-poller/docker-entrypoint.sh` — schedules below are verified against that file.

---

## Cron Schedule Summary

### Home Poller (sole retail + goldback scraper, 192.168.1.81)

| Script                     | Cron            | Verified | Purpose                                    |
| -------------------------- | --------------- | -------- | ------------------------------------------ |
| `run-home.sh`              | `30 * * * *`    | yes      | Retail scrape — all vendors                |
| `spot-extract.js`          | `15,45 * * * *` | yes      | Spot price poll (staggered from Fly.io)    |
| `goldback-scraper.js`      | `5 * * * *`     | yes      | Goldback G1 rate — hourly at :05 (STRK-58) |
| `export-providers-json.js` | `*/5 * * * *`   | yes      | Sync providers.json from sqld              |
| `turso-backup-sync.js`     | `0 3 * * *`     | yes      | Nightly DR sync to Turso Cloud             |
| `check-flyio.sh`           | `*/5 * * * *`   | yes      | Fly.io health probe                        |

### Fly.io (thin publisher — spot + publish only, `staktrakr` app, dfw)

| Script                     | Cron                 | Purpose                                                                          |
| -------------------------- | -------------------- | -------------------------------------------------------------------------------- |
| `run-spot.sh`              | `0,30 * * * *`       | Spot price poll (MetalPriceAPI → sqld + JSON), `POLLER_ID=fly-spot`              |
| `run-publish.sh`           | `8,23,38,53 * * * *` | Export sqld → JSON, verify-then-push to `api` branch                             |
| `export-providers-json.js` | `*/5 * * * *`        | Sync providers.json from sqld                                                    |
| `cleanup-export.sh`        | `17 3 * * 0`         | Weekly retention sweep + memory-capped git maintenance (Sun 03:17 UTC, STRK-187) |

> Retail (`run-local.sh`), retry (`run-retry.sh`), and goldback (`run-goldback.sh`) are **disabled** on Fly.io since STAK-478 (2026-03-21). Fly.io is a thin publisher only.

---

## Stale Thresholds

| Feed                             | Stale (warning) | Critical | Source                               |
| -------------------------------- | --------------- | -------- | ------------------------------------ |
| Spot prices — UI freshness badge | 20 min          | —        | `api-health.js` constant             |
| Spot prices — operational        | 75 min          | 3 hours  | Health-check scripts / diagnostics   |
| Market prices (`manifest.json`)  | 30 min          | 4 hours  | Health-check scripts                 |
| Goldback                         | 2 hours         | 48 hours | v2 envelope `stale_after` (STRK-248) |

### v2 `stale_after` values (STAK-503)

v2 endpoints embed their freshness threshold in the envelope. The frontend always consumes v2; `api-health.js` uses an envelope's `stale_after` when it is present and retains hardcoded constants only as a defensive fallback for a malformed envelope.

| Endpoint type            | `stale_after` | Equivalent                          |
| ------------------------ | ------------- | ----------------------------------- |
| Spot                     | 1200 s        | 20 min                              |
| Retail                   | 1800 s        | 30 min                              |
| Goldback `latest.json`   | 7200 s        | 2 h (was 90000 s / 25 h — STRK-248) |
| Goldback `intraday.json` | 7200 s        | 2 h (STRK-248)                      |
| Manifest                 | 1800 s        | 30 min                              |

---

## Spot Pipeline

### Overview

Spot prices (gold, silver, platinum, palladium, copper in USD per troy oz) are polled **4× per hour** (every 15 minutes) by **two independent writers**: the Fly.io container and the home poller. Both write to the sqld `spot_prices` table and JSON files on the Fly.io persistent volume. Published to GitHub Pages via `run-publish.sh`.

### Flow

```text
MetalPriceAPI (/v1/latest?base=USD&currencies=XAU,XAG,XPT,XPD,XCU)
        │
        ├──► Fly.io run-spot.sh  (0,30 * * * *)   POLLER_ID=fly-spot
        │         spot-extract.js
        │
        └──► Home VM spot-extract.js (15,45 * * * *)  POLLER_ID=home-spot
                  (staggered — fires between Fly.io polls)
                        │
               ┌────────┴────────────────┐
               ▼                         ▼
          sqld spot_prices          JSON files on Fly volume
               │                   data/hourly/YYYY/MM/DD/HH.json  (mutable)
               │                   data/15min/YYYY/MM/DD/HHMM.json (immutable)
               │
               ▼
      Fly.io run-publish.sh (8,23,38,53 * * * *)
          api-export.js reads spot_prices from sqld
               │
               ▼
      StakTrakrApi api branch → GitHub Pages → api.staktrakr.com
```

### Data Source

**MetalPriceAPI** (`metalpriceapi.com`) — requires a managed external-feed credential in the deployment's secret store.

| Symbol | Metal     |
| ------ | --------- |
| `XAU`  | Gold      |
| `XAG`  | Silver    |
| `XPT`  | Platinum  |
| `XPD`  | Palladium |
| `XCU`  | Copper    |

The tracked set is defined once, in `devops/pollers/shared/spot-metals.js`. Every other list — the API query string, the database key set, the JSON entry order, the exporter's ISO map, the manifest `metals` array — is derived from it. Do not add a metal by editing those directly.

**Rate conversion logic in `spot-extract.js`:**

A `/v1/latest?base=USD` response carries every figure twice:

| Key      | Meaning                                                    |
| -------- | ---------------------------------------------------------- |
| `USDXAU` | Direct USD price per troy ounce — **this is what we read** |
| `XAU`    | Its reciprocal: troy ounces per USD                        |

`derivePrice()` reads the `USD`-prefixed key and falls back to inverting the bare one. Both paths are deterministic.

> **Corrected 2026-08-15 (STRK-303).** This section previously documented a magnitude heuristic — `rate >= 1 ? rate : 1 / rate` — that guessed which of the two forms it had been handed. The guess was only ever right because every tracked metal was worth far more than $1/ozt, which put the two candidates orders of magnitude apart. Copper trades near $0.41/ozt, so its reciprocal (~2.42) sits above the threshold and the heuristic silently returned $2.42. It existed only because the code read the bare key while its own comment claimed to read the `USD`-prefixed one. It has been deleted.

Sanity bounds are **per metal** (`METAL_PRICE_BOUNDS` in `spot-metals.js`), not one global range. A single `$5 < price < $50,000` window cannot span metals four orders of magnitude apart: it rejected every correct copper quote, and because that rejection throws and is caught upstream into `process.exit(1)`, it killed the whole poll run rather than dropping one metal.

Prices are rounded by magnitude — two decimals at or above $1, four below. Two decimals quantises copper by roughly 0.6% per tick, and that error is permanent once written to history.

### Storage

**sqld table: `spot_prices`**

Primary data store. `spot-extract.js` inserts one row per tracked metal via `insertSpotPrices()`, keyed on `(metal, timestamp_floor)` with a floored 15-minute window timestamp. The metal set comes from `spot-metals.js`; `insertSpotPrices` validates every requested metal is a finite number before writing any row, so a partial payload fails before it can half-commit.

**JSON files on Fly volume:**

| File            | Pattern                           | Notes                                                                                                  |
| --------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Hourly          | `data/hourly/YYYY/MM/DD/HH.json`  | Overwritten each poll; frontend fetches for live spot. Day-dirs pruned after 365 days (STRK-187)       |
| 15-min snapshot | `data/15min/YYYY/MM/DD/HHMM.json` | Immutable; one file per window; used for historical analysis. Day-dirs pruned after 90 days (STRK-187) |

### API Export

`api-export.js` (and `api-export-v2.js` for STAK-503 v2 endpoints) reads from sqld and produces:

- **v1:** `data/hourly/` and `data/15min/` JSON files
- **v2:** `data/v2/spot/` endpoints with OHLCA aggregates (open, high, low, close, avg, n) and dual timestamps (`t` ISO 8601, `ts` Unix epoch)

v2 envelope format:

```json
{ "v": 2, "generated_at": "...", "stale_after": 1200, "data": { ... } }
```

### Frontend Consumption

Frontend fetches `data/hourly/YYYY/MM/DD/HH.json` for live spot prices. `api-health.js` compares `timestamp` of the latest entry against the 20-minute UI freshness threshold to drive the health badge.

### Failure Modes

| Symptom                      | Likely cause                                       | Fix                                                            |
| ---------------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| Hourly file > 75 min stale   | External-feed credential expired or quota exceeded | Check the provider dashboard and operator-managed secret store |
| Hourly file missing entirely | `run-spot.sh` not running                          | `fly logs --app staktrakr \| grep spot`                        |
| Stale data after deploy      | Cron schedule wiped by deploy                      | `fly ssh console -C "crontab -l"` to verify                    |

### Frontend Spot Source Selection (STAK-443)

The frontend user-selectable spot source (v3.34.24+) replaces the legacy fallback-chain model. Stored in `spotPricingSource` localStorage key.

| Source        | Value             | Behavior                                                                                                           |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| StakTrakr API | `STAKTRAKR`       | Fetch from `data/v2/spot/latest.json` (primary)                                                                    |
| Metals.Dev    | `METALS_DEV`      | Fetch from metals.dev API                                                                                          |
| MetalsAPI     | `METALS_API`      | Fetch from MetalsAPI service                                                                                       |
| MetalPriceAPI | `METAL_PRICE_API` | Fetch from MetalPriceAPI service                                                                                   |
| Custom API    | `CUSTOM`          | User-provided custom endpoint URL                                                                                  |
| Manual        | `MANUAL`          | User-entered manual prices {gold, silver, platinum, palladium} stored in `metalSpotPrices` — zero network activity |

**Migration:** Existing frontends with legacy `providerPriority` / `apiProviderOrder` keys trigger `migrateSpotPricingSource()` on startup (defined in `js/init.js`). Migration preserves fallback intent by mapping to the primary provider, then deleting legacy keys.

**Manual mode disables all background spot fetches** including `backfillStaktrakrHourly` and any other spot-price sync operations. Use this for air-gapped deployments or when you want complete pricing control.

### Legacy Note

`poller.py` (Python) is **inactive**. Replaced by `spot-extract.js`. The daily seed file `data/spot-history-YYYY.json` is present on disk but not written by the active path — do not use it for freshness checks.

**Gap-healing backfiller (STRK-187):** `shared/backfill-spot-files.js` regenerates hourly spot JSON files **from sqld** — the reverse of `backfill-spot.js` (which imports files _into_ sqld). Use it when spot rows kept landing in sqld but file writes failed (e.g. the 2026-06-11 inode-exhaustion outage). Usage: `DATA_DIR=/data/staktrakr-api-export/data node backfill-spot-files.js --from 2026-06-11T06 --to 2026-06-11T13 [--overwrite] [--dry-run]` (hours UTC, inclusive; existing files skipped unless `--overwrite`; output byte-compatible with `spot-extract.js`).

---

## Retail Pipeline

### Overview

The retail pipeline scrapes coin dealer prices from **7 active vendors × 11 bullion coins** every hour via the home poller only (Fly.io retail was disabled STAK-478). Results are written to sqld, exported to JSON by the Fly.io publisher, and pushed to GitHub Pages.

### Flow

```text
Home VM run-home.sh  (30 * * * *)
    price-extract.js — 3-phase scrape pipeline
         │
         Phase 0: Playwright direct (all URLs, tried first)
         Phase 1: Firecrawl (residential IP, no proxy needed)
         Phase 2: CF-clearance bypass (Byparr sidecar for CF-protected vendors)
         │
         ▼
    sqld price_snapshots  (POLLER_ID=home)
         │
         ▼
    Fly.io run-publish.sh  (8,23,38,53 * * * *)
        api-export.js
            readLatestPerVendor(db, coinSlug, lookbackHours=2)
                 │  — most recent row per vendor within last 2h
                 ▼
        data/api/{slug}/latest.json
        data/api/manifest.json
                 │
                 ▼ verify-then-push HEAD:api  (see gate below)
    StakTrakrApi api branch → GitHub Pages → api.staktrakr.com
```

> **Publish gate (STRK-187):** the flow diagrams above are simplified — `run-publish.sh` does not blindly force-push. It runs a pre-flight space backstop (inline `cleanup-export.sh` when `/data` is low on inodes/space), then a verify-then-push freshness gate: it fetches `localhost:8080/data/api/manifest.json` (api2, the by-design primary) and, when the cycle exported, skips the push if `generated_at` is older than 30 min. The `git commit` happens **after** the gate passes (fix `1a8bffc2`), so a rejected cycle leaves no stale commit to resurrect. Full step-by-step flow: infrastructure#Publish Pipeline (`run-publish.sh`).

### Data Source

Provider configuration lives in **sqld** (`provider_coins` + `provider_vendors` tables), with file fallback to `data/retail/providers.json`. URL corrections go directly to the database via `provider-db.js` or the dashboard at `http://192.168.1.81:3010/providers` — no redeploy needed.

**URL strategy:** Prefer random-year SKUs when in stock. At year-start, Monument Metals random-year SKUs go pre-order — switch to year-specific (e.g., `2026-american-silver-eagle.html`) until bulk stock arrives.

See Providers Config (deprecated DocVault page) and .context/deep-dives/vendor-quirks.md for per-vendor details.

### Transform — 3-Phase Scrape Pipeline (`price-extract.js`)

Each provider entry supports a `urls` array (tried in sequence). Single `url` entries are treated as a 1-element list.

**Phase routing:**

| Phase | Method              | Trigger                                     |
| ----- | ------------------- | ------------------------------------------- |
| 0     | Playwright direct   | Default for most vendors                    |
| 1     | Firecrawl           | Fallback; residential IP, no proxy needed   |
| 2     | CF-clearance bypass | Byparr sidecar for Cloudflare-gated vendors |

`providerCfg()` composes `PROVIDER_DEFAULTS`, the transitional `LEGACY_PROVIDER_CONFIG`, and any vendor-module configuration to control which phase a vendor enters. New vendor-specific behavior belongs with that vendor module.

### MintBuilder Direct API Feed (STRK-321 / STRK-325)

MintBuilder is the **first vendor with a first-party price feed** (offered by MintBuilder after finding the Reddit post, 2026-08-01) — it is not scraped when the feed is available. `price-extract-vendor-mintbuilder.js` `scrape()` resolves each target against a per-process memoized index of `GET https://mintbuilder.com/feed/api/prices?key=$MB_API_KEY&mintbuilder=all` (client: `price-extract-mintbuilder-feed.js`; one request per hourly run ≈ 24 calls/day; ~314 products).

- **Matching:** feed product `link` ↔ `provider_vendors.url` by canonicalized-URL comparison (protocol/www/case/query/fragment/trailing-slash collapsed). A per-row `hints {"mbProductId": "…"}` pin (dashboard gear row) overrides URL matching. Adding/removing items stays the normal dashboard flow — there are no per-item endpoints.
- **Hybrid stock rule (STRK-325):** the feed **retains sold-out listings** and has no stock field. `tiers[].qty_max` tracks live sellable inventory (validated against 119 product pages). A hit with `max(qty_max) > 1` across ALL tiers records `source: "mintbuilder-api"`, `in_stock=1`; a degenerate cap (≤ 1) is ambiguous (zero-floored vs genuine last unit), so that item falls through to the page scrape, whose JSON-LD availability is authoritative. Max is across all tiers because some in-stock products lead with a qty-1 discount tier (1 oz Gold Eagle).
- **Fallback = the unchanged scrape path** (feed miss, outage, HTTP 401, key unset). **Rollback: unset `MB_API_KEY`** in the Portainer stack env and redeploy — no code change.
- **Feed price semantics:** `price` == the page's qty-1 check/wire price exactly (verified 14/14 tracked SKUs at 0.00% delta on cutover) — no history discontinuity.
- **Key hygiene:** `MB_API_KEY` lives only in container env (compose declaration + `run-home.sh` cron re-export, STRK-230 pattern; Infisical `dev` is the source of record). `provider_vendors.url` keeps the human product-page URL — it is republished into public JSON (Buy links); the feed request URL is never logged and error messages are key-redacted.
- **Pending vendor ask:** an explicit availability field (or `qty_max: 0` on sold-out) would eliminate the residual per-item scrapes; `feedStockIsConfident()` in the feed client is the single consumption point when it arrives.

### STRK-32 Vendor Module Boundary

As of v3.35.6, `devops/pollers/shared/price-extract.js` is the orchestrator, not the
owner of every vendor-specific parser and routing rule. Vendor-agnostic parsers and
stock helpers live in `price-extract-shared.js`, routing/config constants live in
`price-extract-provider-config.js`, and `price-extract-vendors.js` dispatches each
scrape through a standard Vendor module interface.

Migrated Vendors:

| Vendor         | Module                                | Notes                                                                                                                               |
| -------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apmex`        | `price-extract-vendor-apmex.js`       | Owns APMEX Firecrawl-preferred config and delegates to shared generic scraping                                                      |
| `goldback`     | `price-extract-vendor-goldback.js`    | Owns the Goldback Phase 0 bypass predicate and delegates to shared generic scraping                                                 |
| `summitmetals` | `price-extract-vendor-summit.js`      | Owns Summit cutoff patterns + qty-tier-first extract strategy (JSON-LD offer price untrusted — it is the 100+ bulk tier)            |
| `mintbuilder`  | `price-extract-vendor-mintbuilder.js` | **Feed-first (STRK-321/325)** — direct vendor API with page-scrape fallback; see #MintBuilder Direct API Feed (STRK-321 / STRK-325) |

All not-yet-migrated Vendors still route through `price-extract-vendor-legacy.js`,
which preserves the pre-refactor generic scrape behavior. To migrate another Vendor,
add one module exposing `id`, `config`, and `scrape(context)`, then register it in
`price-extract-vendors.js`; do not add new vendor-specific branches to the
orchestrator.

`runFullPoller()` catches Vendor module exceptions per target. A thrown or malformed
Vendor result is normalized into a failed result (`source: "vendor-error"`,
`price: null`, `is_failed=1` when written), allowing the run to continue and finish
run-log accounting. This guard is separate from `safeWriteSnapshot()`, which remains
the non-fatal database write guard.

Dashboard single-Vendor retry imports the orchestrator's `extractPrice()` entry point
for one coin/Vendor URL instead of launching the full poller. Direct CLI execution is
guarded so importing `price-extract.js` does not start a scrape run.

Deploy packaging must keep all shared modules together. The poller Dockerfiles use
`COPY shared/*.js ./`, and the home sync manifest explicitly lists the new
`price-extract-*` shared modules.

**OOS detection (`detectStockStatus()`):** Checks scraped text for patterns (`out of stock`, `sold out`, `pre-order`, etc.) before price extraction. Exception: `jmbullion` is preorder-tolerant — resolved per vendor by `resolvePreorderTolerant()` (`price-extract-shared.js:106-110`), with `LEGACY_PREORDER_TOLERANT_PROVIDERS` (`:72`, holding `jmbullion` and `monumentmetals`) as the fallback. For those, the `pre-?order` pattern is skipped because JMBullion marks presale coins (buffalo, maple-silver, etc.) as Pre-Order while still showing live prices.

**Price bounds guard (`writeSnapshot()` in `shared/db.js`):** Applied before every database write.

| Direction     | Threshold             | Effect                      |
| ------------- | --------------------- | --------------------------- |
| Too high      | > +50% above baseline | `price=null`, `is_failed=1` |
| Too low       | < −30% below baseline | `price=null`, `is_failed=1` |
| Within bounds | 70%–150% of baseline  | Written normally            |

Baseline sources:

| Metal                             | Baseline source                                | Formula                            |
| --------------------------------- | ---------------------------------------------- | ---------------------------------- |
| Gold, silver, platinum, palladium | `readSpotCurrent()` from `spot_prices`         | `spot × coin.weight_oz`            |
| Goldback                          | `goldback-spot.json` `g1_usd` field            | `g1_usd × denomination_multiplier` |
| Goldback fallback                 | When goldback-spot.json absent / `g1_usd` zero | `gold_spot × 0.003085` (G1 weight) |

Set `row.skipPriceBounds = true` or `provider.skipPriceBounds: true` to bypass for a target.

### Storage

**sqld table: `price_snapshots`**

| Column         | Description                                                               |
| -------------- | ------------------------------------------------------------------------- |
| `scraped_at`   | ISO 8601 UTC timestamp of scrape                                          |
| `window_start` | 15-min window bucket (legacy, kept for compatibility)                     |
| `coin_slug`    | e.g. `ase`, `age`, `maple-silver`                                         |
| `vendor`       | Provider ID, e.g. `jmbullion`, `apmex`                                    |
| `price`        | Scraped price (null if OOS or failed)                                     |
| `source`       | `playwright_direct`, `firecrawl`, `playwright`, `gemini-vision`, or `fbp` |
| `in_stock`     | false if OOS patterns matched                                             |
| `is_failed`    | true if scrape threw an error or price rejected by bounds guard           |

### API Export

`api-export.js` calls `readLatestPerVendor(db, coinSlug, lookbackHours=2)` — returns the most recent row **per vendor** within the last 2 hours. Both pollers' data appears regardless of which time window they ran in.

**Last-known-good fallback (v1):** When all scrape phases fail, `api-export.js` fills from the most recent successful `price_snapshots` row at publish time:

```json
{ "price": 34.21, "source": "turso_last_known", "stale": true, "stale_since": "..." }
```

**Carry-forward mechanism (v2, STAK-503):** 24-hour lookback for absent vendors. Carried entries are marked:

```json
{ "price": 35.19, "carried": true, "carried_from": "2026-03-24T22:30:00Z", "source": "firecrawl" }
```

Vendors absent for more than 24 hours are omitted entirely.

**Daily history buckets are stamped at synthetic noon UTC (STRK-260).** `buildDailyWithVendors()` in `devops/pollers/shared/api-export-v2.js` writes every `history-30d.json` / `history-90d.json` daily aggregate at `<date>T12:00:00Z`, and `floorTimestamp(…, "daily")` in `devops/pollers/shared/v2-utils.js` normalizes to the same. The timestamp is a **calendar-day label, not an observation time**.

Consequence for any consumer: comparing those rows against a millisecond wall-clock window is always wrong. Before 12:00 UTC today's bucket looks like a future row and is dropped; after 12:00 UTC the oldest bucket falls outside the rolling cutoff and is dropped. Either way the point count stays correct while the window silently slides off by one calendar day, so the bug is invisible in the UI. **Bound daily rows by UTC calendar date** (start exclusive, end inclusive, so an N-day period spans exactly N dates) and keep the millisecond compare only for intraday. See `_buildMarketDetailRangeModel` / `_utcDateKey` in `js/market-data.js`.

### Frontend Consumption

Frontend retail cards display live per-item prices sourced from `data/api/manifest.json` and per-coin `latest.json` endpoints. OOS vendors shown dimmed. The `_isSlugResolved` predicate in `getActiveRetailSlugs()` (STAK-521) quarantines unresolved slugs (those falling through to the default `{name: slug, metal: "unknown"}` shape) at the `js/retail.js` chokepoint before any downstream plane.

### Vision Pipeline (optional, soft-disabled by default)

Requires the operator to configure the vision integration and enable it for the deployment. Non-fatal — failure is logged and scrape continues.

| Scenario                            | Confidence score                                  |
| ----------------------------------- | ------------------------------------------------- |
| Scrape + Vision agree (≤3% diff)    | 99                                                |
| Vision only (scrape null)           | ~70                                               |
| Scrape + Vision disagree (>3% diff) | ≤70, scaled by divergence                         |
| Scrape only, no Vision              | ~80 max via `scoreVendorPrice()` vs 30-day median |

Expected run timing:

| Configuration            | Duration |
| ------------------------ | -------- |
| Without vision (default) | ~16 min  |
| With vision enabled      | ~28 min  |

### Failure Modes

| Symptom                               | Likely cause                                     | Fix                                                                                         |
| ------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Vendor missing prices multiple cycles | URL changed, OOS, or bot-blocked                 | Add backup URLs via `urls` array — auto-synced next cycle, no redeploy                      |
| Only 1–2 vendors per coin             | Home poller down or sqld connectivity            | Check Portainer dashboard; verify sqld has recent rows                                      |
| JMBullion presale coins show OOS      | Pre-order pattern matching before provider check | Verify `preorderTolerant` on the vendor descriptor, or `LEGACY_PREORDER_TOLERANT_PROVIDERS` |
| OOM on Fly.io                         | Concurrent `api-export.js` invocations           | Verify `run-publish.sh` lockfile; `fly scale show`                                          |
| Monument Metals missing at year-start | Random-year SKU on pre-order                     | Switch to year-specific SKU in providers dashboard                                          |
| Vendor price marked `stale: true`     | All scrape phases failed; last-known-good in use | Check home poller logs; verify Byparr sidecar running                                       |

---

## Goldback Pipeline

### Overview

Goldback pricing flows through **two independent paths**:

1. **Denomination spot path** — `goldback-scraper.js` runs hourly at :05 (`5 * * * *`, STRK-58) on the home poller, fetches the official G1 rate from `goldback.com`, writes to sqld. Fly.io publisher regenerates `goldback-spot.json` on every publish cycle (4×/hr) with a fresh `generated_at` envelope — republishing the cached value, not re-scraping. goldback.com's upstream rate (`data.t`) can lag the scrape, so `g1_usd` may repeat across publishes even though the scrape now runs hourly. As of STRK-248 (v3.35.62) the v2 `goldback/latest.json` `data.t` is stamped at the actual scrape **hour** (was a daily-noon "daily" granularity), its envelope `stale_after` dropped to **7200 s (2 h)** (was 90000 s / 25 h), and a companion raw intraday endpoint (`goldback/intraday.json`) was added — see [API Export](#api-export-2) below.

2. **Retail path** — Per-state Goldback coins (`goldback-{state}-g{denom}`) are tracked in `providers.json` and scraped from vendor product pages by `run-home.sh` at `:30`, flowing through the standard retail pipeline.

> Both paths run on the **home poller only** (STAK-478/491). Fly.io does not scrape goldback.

### Flow — Denomination Spot Path

```text
goldback.com/gb-proxy.php  (JSON API, primary)
goldback.com/wp-admin/admin-ajax.php?action=get_goldback_data  (history fallback)
        │
        ▼
Home VM goldback-scraper.js  (5 * * * *  — :05 hourly, STRK-58)
        │  G1 USD rate → all denomination multipliers
        ▼
sqld price_snapshots  (coin_slug=goldback-g1)
        │
        ▼
Fly.io run-publish.sh  (8,23,38,53 * * * *)
    api-export.js reads latest goldback-g1 row
        │  generates denominations: g1 × multiplier
        ▼
data/api/goldback-spot.json
data/goldback-YYYY.json  (rolling annual log, STAK-491)
        │
        ▼
StakTrakrApi api branch → GitHub Pages → api.staktrakr.com
```

### Flow — Retail (Per-State) Path

```text
Vendor product pages (state × denomination URLs)
        │
        ▼
Home VM run-home.sh  (30 * * * *)  via price-extract.js
        │  [same 3-phase scrape as retail pipeline]
        ▼
sqld price_snapshots  (coin_slug=goldback-{state}-g{denom})
        │
        ▼
Fly.io run-publish.sh (8,23,38,53 * * * *)
    api-export.js → data/api/goldback-{state}-g{denom}/latest.json
```

### States and Denominations

**9 states** currently issue Goldbacks:

| State         | Slug prefix               |
| ------------- | ------------------------- |
| Utah          | `goldback-utah-`          |
| Nevada        | `goldback-nevada-`        |
| Wyoming       | `goldback-wyoming-`       |
| New Hampshire | `goldback-new-hampshire-` |
| South Dakota  | `goldback-south-dakota-`  |
| Arizona       | `goldback-arizona-`       |
| Oklahoma      | `goldback-oklahoma-`      |
| Washington DC | `goldback-dc-`            |
| Idaho         | `goldback-idaho-`         |

The current v2 Goldback rate envelope publishes six denomination prices. The retail slug parser accepts additional historical denominations when they occur in catalog data; do not infer the v2 API shape from that compatibility surface.

| Slug suffix | Denomination | Gold content |
| ----------- | ------------ | ------------ |
| `g0.25`     | 1/4 Goldback | 1/4000 oz    |
| `g1`        | 1 Goldback   | 1/1000 oz    |
| `g5`        | 5 Goldback   | 1/200 oz     |
| `g10`       | 10 Goldback  | 1/100 oz     |
| `g25`       | 25 Goldback  | 1/40 oz      |
| `g50`       | 50 Goldback  | 1/20 oz      |

The v2 rate payload uses `g0.25`, `g1`, `g5`, `g10`, `g25`, and `g50`; `buildGoldbackDenominations()` is authoritative. Per-state catalog slugs are driven by `providers.json`, not a hardcoded total in this document.

### Cron Detail

`goldback-scraper.js` cron: `5 * * * *` (hourly at :05, verified in `docker-entrypoint.sh` line 31, STRK-58).

**No in-script skip guard.** Each hourly run writes the current goldback.com G1 rate to sqld; if the upstream rate (`data.t`) hasn't moved, it simply overwrites the row with the same `g1_usd` (fresh `scraped_at`, unchanged value). STRK-58 moved this from a daily to an hourly cron because the CurrencyLayer-backed rate can shift intraday — hourly scraping catches those mid-day moves rather than locking in a single snapshot.

### Goldback badge freshness — `generated_at` is the scrape time (STRK-257)

`api-health.js` reads `generated_at` from the v2 envelope. Since **STRK-257** that value is
**always** the normalized `scraped_at`, not publish time: `resolveGoldbackGeneratedAt()`
(`devops/pollers/shared/api-export-v2.js:894-920`, used at `:948-960`) uses publish time
only as a last resort when no usable scrape timestamp exists.

This supersedes the earlier STRK-250 behavior, where the scrape timestamp was written only
on the outage path (freshest row older than the 7200 s realtime budget) and normal operation
kept publish time. The badge therefore reflects scrape age at all times, and a slow-moving
feed reads as its true age rather than "~2m ago". `g1_usd` repeating across publishes is
still expected — goldback.com's upstream rate (`data.t`) can lag — but the timestamp no
longer refreshes independently of the scrape.

### Storage

**sqld table: `price_snapshots`** — same schema as retail. Denomination spot uses `coin_slug=goldback-g1`, `vendor=goldback` (official rate). Per-state retail uses `coin_slug=goldback-{state}-g{denom}`.

### API Export

| Endpoint                                         | Description                                                                  | Updated                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------- |
| `data/api/goldback-spot.json`                    | G1 USD rate + all denomination prices (v1)                                   | Every publish cycle (4×/hr) |
| `data/goldback-YYYY.json`                        | Rolling annual history log (STAK-491)                                        | Every publish cycle         |
| `data/api/goldback-{state}-g{denom}/latest.json` | Per-vendor retail prices                                                     | Once slugs are enabled      |
| `data/v2/goldback/latest.json`                   | G1 rate + denomination multipliers + OHLCA (v2 envelope, `stale_after` 7200) | Every publish cycle         |
| `data/v2/goldback/intraday.json`                 | Raw hourly point series for the last 72 h (STRK-248)                         | Every publish cycle         |

`goldback-spot.json` example output:

```json
{
  "date": "2026-02-25",
  "scraped_at": "2026-02-25T19:08:01.756Z",
  "g1_usd": 10.43,
  "denominations": { "g1": 10.43, "g5": 52.15, "g10": 104.3, "g25": 260.75, "g50": 521.5 },
  "source": "goldback.com",
  "confidence": "high"
}
```

All denomination prices: `G1 × multiplier`, rounded to 2 decimal places.

**v2 envelope (STAK-503):** `data/v2/goldback/latest.json` includes OHLCA aggregates and six denomination prices (`g0.25`, `g1`, `g5`, `g10`, `g25`, `g50`). `stale_after: 7200` (2 h) as of STRK-248, and `data.t` is stamped at the actual scrape hour rather than a daily-noon timestamp. `resolveGoldbackGeneratedAt()` uses normalized `scraped_at` whenever available, so the envelope freshness reflects the scrape rather than a publish loop.

**Raw intraday endpoint (STRK-248, v3.35.62):** `data/v2/goldback/intraday.json` is a **raw hourly point series** — `data: [{ t, ts, g1_usd }]` for the last 72 h — built by `buildGoldbackIntradayEntries()` in `api-export-v2.js` (reuses `queryGoldbackRange`; points are hourly-floored, **not** OHLCA-bucketed). Envelope `stale_after: 7200` (2 h). The legacy v1 exporter prunes `price_snapshots` older than 31 days; treat that as implementation behavior, not a blanket retention guarantee for every output.

### Enabling a State/Vendor

1. Find the slug in `providers.json` (e.g., `goldback-oklahoma-g1`)
2. Set the vendor's `url` to the product page URL
3. Set `enabled: true`

Changes auto-sync next cycle — no redeploy needed.

### Failure Modes

| Symptom                                                  | Likely cause                                                   | Fix                                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `goldback/latest.json` > 2h stale (STRK-248)             | Home poller `goldback-scraper.js` failing or goldback.com down | Check home poller logs via Portainer (goldback runs on home only)                                      |
| G1 price null in manifest                                | Firecrawl timeout on JS-rendered page                          | timing comes from `price-extract-provider-config.js` (`SLOW_PROVIDERS` was retired) — verify `waitFor` |
| Denomination prices wrong                                | G1 base rate incorrect                                         | Check `goldback-spot.json` G1 value; compare to goldback.com/exchange-rates/                           |
| Per-denomination retail prices differ from computed spot | Normal — retail vendor prices ≠ official exchange rate         | Expected: `goldback-spot.json` uses official G1 rate; retail endpoints track actual vendor prices      |

---

## Image Pipeline

### Overview

StakTrakr stores item images entirely **client-side** using IndexedDB. There is **no server component** — no uploads, no CDN, no cron. The image pipeline is a browser-only system involving five JavaScript modules.

### Flow

```text
User upload / Pattern rule / Numista CDN URL
        │
        ▼  (for uploads and pattern images)
ImageProcessor.processFile()
    createImageBitmap(file)
    → scale to maxDim (500 px)
    → draw to Canvas
    → encode: WebP (preferred) or JPEG fallback
    → iterative quality loop until blob.size ≤ 500 KB
        │
        ▼
imageCache.cacheUserImage() / imageCache.cachePatternImage()
    → IDB store: userImages / patternImages
        │
        ▼
imageCache.resolveImageUrlForItem(item, side)
    Resolution cascade (per side, independently):
      1. userImages[item.uuid][side]       — user upload
      2. patternImages[ruleId][side]       — pattern rule image
      3. item.obverseImageUrl / reverseImageUrl  — Numista CDN URL (string, not IDB)
        │
        ▼
Object URL → rendered in UI
(caller must revoke after use)
```

### IDB Storage Architecture

Database: **`StakTrakrImages`**, schema version **3**

| Store           | Key                        | Status                                                             |
| --------------- | -------------------------- | ------------------------------------------------------------------ |
| `userImages`    | `uuid` (item UUID)         | Active                                                             |
| `patternImages` | `ruleId` (pattern rule ID) | Active                                                             |
| `coinMetadata`  | `catalogId` (Numista N#)   | Active                                                             |
| `coinImages`    | `catalogId`                | Legacy — retained for cleanup/reporting only (deprecated STAK-339) |

**Storage quota (computed at IDB init):**

```text
quota = min(60% of available browser storage, 4 GB)
        with floor of min(available, 500 MB)
```

Default when `navigator.storage.estimate` unavailable (e.g. `file://`): **500 MB**.

### Key Constants (`js/constants.js`)

| Constant          | Value           | Meaning                          |
| ----------------- | --------------- | -------------------------------- |
| `IMAGE_MAX_DIM`   | 500 px          | Max width or height after resize |
| `IMAGE_QUALITY`   | 0.75            | Initial compression quality      |
| `IMAGE_MAX_BYTES` | 512000 (500 KB) | Max output size per image side   |

### Module Responsibilities

| File                      | Role                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `js/image-cache.js`       | IDB lifecycle, CRUD for all stores, image resolution cascade, resize/compress pipeline                |
| `js/image-processor.js`   | Canvas-based resize → WebP/JPEG → iterative byte-budget enforcement                                   |
| `js/image-cache-modal.js` | Settings UI for Numista bulk metadata sync: stats bar, eligible items table, activity log             |
| `js/bulk-image-cache.js`  | Batch metadata sync engine: resolves Numista catalog IDs, calls Numista API, applies tags             |
| `js/seed-images.js`       | First-run demo: embeds base64 WebP images for ASE + CML pattern rules, loads into IDB on first launch |

### ImageProcessor Pipeline Detail

```text
processFile(file, opts)
  → createImageBitmap(file)
  → _processSource(bitmap, opts)
      → scale dimensions (maxDim=500, maintain aspect ratio)
      → draw to Canvas
      → supportsWebP() — cached 1px canvas probe
      → format = 'image/webp' | 'image/jpeg'
      → iterative quality loop:
          while (blob.size > maxBytes && quality > minQuality=0.30)
              quality -= qualityStep (0.05)
              re-encode
      → return { blob, width, height, originalSize, compressedSize, format }
```

### Bulk Metadata Sync (`bulk-image-cache.js`)

`BulkImageCache.cacheAll()` syncs **Numista metadata only** (not image blobs) for all inventory items with a Numista catalog ID. Image blobs are not downloaded — images come from stored CDN URLs or user uploads.

Per-item loop:

1. Repair malformed obverse/reverse URLs on item (clear empty strings)
2. Check if metadata already cached
3. If cached + URLs present → apply tags from cache → skip
4. Try local provider cache (free, no API call)
5. Fall back to `catalogAPI.lookupItem(catalogId)` (Numista API)
6. Write metadata to IDB
7. Apply Numista tags to all items sharing this `catalogId`
8. Wait `delay` ms (default 200 ms) before next item

### Seed Images (`seed-images.js`)

First-run demo: creates two pattern rules (American Silver Eagle + Canadian Gold Maple Leaf) with real coin photos embedded as base64 WebP data URIs. Gated by `localStorage` key `seedImagesVer` — version-checked on each app load, only runs if version has changed.

### Storage Limits and Overflow

- `cacheUserImage()` returns `false` if IDB `put()` throws (quota exceeded).
- `ImageProcessor` reduces quality iteratively (down to `minQuality=0.30`) before failing.
- No automatic eviction — user must manually clear via Settings > API > Numista (Clear API Cache).
- `getStorageUsage()` returns per-store breakdown: `numistaBytes`, `userImageBytes`, `patternImageBytes`, `metadataBytes`, `totalBytes`, `limitBytes`.

### Key Rules

- Never write directly to the `userImages` IDB store — always use `imageCache.cacheUserImage()`.
- Always revoke object URLs after use — uncollected object URLs leak memory.
- Call `renderTable()` after any IDB write so thumbnails update.
- Do not add new code that touches the `coinImages` store — legacy, cleanup-only.
- `resolveImageForItem()` is the legacy item-level function. Use `resolveImageUrlForItem(item, side)` for all new code.
- Numista CDN URLs (`item.obverseImageUrl`, `item.reverseImageUrl`) are stored as plain strings on inventory items — no blob is fetched or stored for CDN images.

### No Server Component

There is no server-side image storage, upload endpoint, or CDN. All images are local to the user's browser. Cross-device sync of user images is not supported; backup/restore is done via ZIP export/import through the IDB bulk operations methods.

---

## Related Pages

- Spot Pipeline (deprecated DocVault page) — full spot price architecture
- Retail Pipeline (deprecated DocVault page) — full retail scrape architecture
- Goldback Pipeline (deprecated DocVault page) — denomination generation and per-state slugs
- .context/deep-dives/image-pipeline.md— full client-side image system
- .context/deep-dives/health-checks.md— stale thresholds and quick health script
- Turso Schema (deprecated DocVault page) — sqld table definitions
- .context/deep-dives/home-poller.md— home VM container and dashboard
- .context/deep-dives/remote-poller.md— Fly.io container deployment
- .context/deep-dives/api-reference.md — full endpoint schemas
- Providers Config (deprecated DocVault page) — vendor URL configuration
- .context/deep-dives/vendor-quirks.md— per-vendor scraping notes

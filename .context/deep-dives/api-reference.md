---
title: "API Reference"
project: StakTrakr
audience: agent
canonical: .context/deep-dives/api-reference.md
migration_source: "DocVault/Projects/StakTrakr/Foundation/Deep Dives/API Reference.md" # historical provenance; migrated 2026-08-12
updated: "2026-08-12"
---

# API Reference

**Base URL:** `https://api.staktrakr.com`
**Fallback URL:** `https://api2.staktrakr.com`

---

## Overview

All endpoints are static JSON files served via GitHub Pages from the `api` branch of
`lbruton/StakTrakrApi`. Feed generation code lives in `devops/pollers/` in the `StakTrakr`
repo; `StakTrakrApi` hosts the `api` branch for GitHub Pages serving. There is no dynamic
server — `serve.js` on Fly.io port 8080 is a redundancy proxy serving the same files.

**v2 is the sole API layer consumed by the frontend.** v2 (STAK-503) shipped as default in
STAK-506 and v1 was removed from frontend code in STAK-509 (v3.33.92) — all frontend
fetches target `data/v2/`. The v1 exporter (`api-export.js`) still _writes_ `data/api/`
files each publish cycle for external/legacy consumers, but nothing in the app reads them
(see Legacy v1 API below).

**Update cadence:** Every 15 minutes via `run-publish.sh` (cron `8,23,38,53 * * * *`) —
it runs `api-export.js` (legacy v1) then `api-export-v2.js` (v2, non-fatal on error).

---

## v2 API (primary)

Publisher: `devops/pollers/shared/api-export-v2.js`.

### Endpoint Tree

All v2 endpoints live under `data/v2/`:

| Endpoint                                 | Description                                                                               | Updated             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------- |
| `data/v2/manifest.json`                  | Self-describing index: coin list, endpoint templates, stale thresholds per type           | Every 15 min        |
| `data/v2/spot/latest.json`               | Current spot prices (5 metals) with OHLCA aggregates                                      | Every 15 min        |
| `data/v2/spot/history-24h.json`          | 24h spot time series (96 windows)                                                         | Every 15 min        |
| `data/v2/retail/{slug}/latest.json`      | Per-coin vendor prices with carry-forward metadata                                        | Every 15 min        |
| `data/v2/retail/{slug}/history-7d.json`  | 7-day hourly OHLCA buckets                                                                | Every 15 min        |
| `data/v2/retail/{slug}/history-30d.json` | 30-day daily aggregates with OHLCA and per-vendor breakdown                               | Every 15 min        |
| `data/v2/retail/{slug}/history-90d.json` | 90-day daily aggregates with OHLCA and per-vendor breakdown                               | Every 15 min        |
| `data/v2/goldback/latest.json`           | G1 rate + denomination multipliers with OHLCA; `data.t` stamped at scrape hour (STRK-248) | Every publish cycle |
| `data/v2/goldback/intraday.json`         | Raw hourly G1 point series `[{ t, ts, g1_usd }]` for the last 72 h (STRK-248)             | Every publish cycle |
| `data/v2/goldback/{slug}/latest.json`    | Per-state goldback vendor prices                                                          | Every 15 min        |
| `data/v2/providers.json`                 | Vendor to product URL mapping per coin (reference data — stable)                          | Every 15 min        |

### v2 Envelope Format

Every v2 endpoint returns a self-describing envelope:

```json
{
  "v": 2,
  "generated_at": "2026-03-25T14:08:01.756Z",
  "stale_after": 1800,
  "data": { ... }
}
```

- `v` — schema version (always `2`)
- `generated_at` — ISO 8601 UTC publish timestamp
- `stale_after` — seconds after `generated_at` before this endpoint should be considered stale
- `data` — payload (varies by endpoint type)

Health logic reads `stale_after` from the envelope — no hardcoded thresholds in the
frontend (see Health Checks deep dive). Per STRK-331, data paths and the health badge
resolve freshness from the freshest `generated_at` per feed across serving endpoints.

### Stale Thresholds (per endpoint type)

| Type      | `stale_after` (seconds)                              |
| --------- | ---------------------------------------------------- |
| Spot      | 1200 (20 min)                                        |
| Retail    | 1800 (30 min)                                        |
| Goldback  | 7200 (2 h) — was 90000 (25 h) before STRK-248        |
| Manifest  | 1800 (30 min)                                        |
| Providers | 86400 (24 h) — vendor URLs are stable reference data |

### Dual Timestamps

All time-series entries carry both formats:

| Field | Format               | Example                  |
| ----- | -------------------- | ------------------------ |
| `t`   | ISO 8601 UTC         | `"2026-03-25T14:00:00Z"` |
| `ts`  | Unix epoch (seconds) | `1742911200`             |

### OHLCA Fields

Time-series data includes OHLCA aggregates per window:

| Field   | Description                     |
| ------- | ------------------------------- |
| `open`  | First price in the window       |
| `high`  | Highest price in the window     |
| `low`   | Lowest price in the window      |
| `close` | Last price in the window        |
| `avg`   | Mean price across all samples   |
| `n`     | Number of samples in the window |

### v2 Manifest Schema

```json
{
  "v": 2,
  "generated_at": "2026-03-25T14:08:01.756Z",
  "stale_after": 1800,
  "data": {
    "coin_count": 15,
    "coins": ["ase", "age", "..."],
    "endpoints": {
      "spot_latest": "v2/spot/latest.json",
      "spot_history_24h": "v2/spot/history-24h.json",
      "retail_latest": "v2/retail/{slug}/latest.json",
      "retail_history_7d": "v2/retail/{slug}/history-7d.json",
      "retail_history_30d": "v2/retail/{slug}/history-30d.json",
      "retail_history_90d": "v2/retail/{slug}/history-90d.json",
      "goldback_latest": "v2/goldback/latest.json",
      "goldback_intraday": "v2/goldback/intraday.json",
      "providers": "v2/providers.json"
    },
    "stale_thresholds": {
      "spot": 1200,
      "retail": 1800,
      "goldback": 7200
    }
  }
}
```

### Coin Slugs

The slug catalog is manifest-driven and grows as coins/vendors are enabled in the provider
database. Representative slugs include:

**Silver (1 oz):** `ase`, `maple-silver`, `britannia-silver`, `krugerrand-silver`, `generic-silver-round`
**Silver (10 oz):** `generic-silver-bar-10oz`
**Gold (1 oz):** `age`, `buffalo`, `maple-gold`, `krugerrand-gold`
**Platinum (1 oz):** `ape`
**Goldback:** `goldback-oklahoma-g1`, `goldback-utah-g50`, `goldback-wyoming-g5`, `goldback-wyoming-g50`, and others as enabled

#### Goldback Per-State Catalog Endpoints

Per-state retail endpoints use `goldback-{state}-{denomination}` slugs and appear only when
enabled by the provider catalog. Do not hard-code a state list, denomination count, or slug
total here. The rate envelope's generated denomination keys are authoritative for the v2
Goldback price API; catalog slugs can include compatibility forms accepted by `retail.js`.

### Vendor Source Values (retail `latest.json`)

| Source             | Meaning                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| `firecrawl+vision` | Both Firecrawl and Gemini Vision agreed (<=3% diff) — 99 confidence                     |
| `firecrawl`        | Firecrawl text extraction only                                                          |
| `vision`           | Gemini Vision screenshot extraction only                                                |
| `turso_last_known` | T4 fallback — most recent in-stock price from database history (includes `stale: true`) |

### Confidence Tiers

| Range | Meaning                            |
| ----- | ---------------------------------- |
| 90-99 | Firecrawl + Vision cross-validated |
| 60-89 | Single source, agrees with median  |
| 30-59 | Single source, moderate deviation  |
| 0-29  | Outlier or disagreement            |

---

## Raw Spot Pipeline Paths

These are writer-side paths (still actively written), not part of the v2 serving contract:

| Endpoint Pattern                  | Description                                                                               | Updated                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| `data/hourly/YYYY/MM/DD/HH.json`  | Hourly spot prices (5 metals) — overwritten each poll                                     | 4x/hr (remote at `0,30`, home at `15,45`) |
| `data/15min/YYYY/MM/DD/HHMM.json` | Immutable 15-min spot snapshots                                                           | Per poll (immutable)                      |
| `data/spot-history-YYYY.json`     | Annual daily spot history (legacy seed — no longer actively written by `spot-extract.js`) | Legacy                                    |

### Hourly File Schema

```json
[
  {
    "spot": 2945.12,
    "metal": "Gold",
    "source": "hourly",
    "provider": "StakTrakr",
    "timestamp": "2026-02-25 19:05:00"
  },
  {
    "spot": 33.41,
    "metal": "Silver",
    "source": "hourly",
    "provider": "StakTrakr",
    "timestamp": "2026-02-25 19:05:00"
  }
]
```

**Metals:** Gold (XAU), Silver (XAG), Platinum (XPT), Palladium (XPD), Copper (XCU) — all quoted USD per troy oz (STRK-303)
**Data source:** MetalPriceAPI (`metalpriceapi.com`)
**Rate conversion:** `derivePrice()` in `devops/pollers/shared/spot-metals.js` prefers the direct `USD{code}` key from the `base=USD` response; only if absent does it invert the bare-symbol reciprocal (`1 / rate`). The old `rate >= 1` magnitude heuristic was removed in STRK-303 — it misread sub-dollar metals like copper (~$0.41/ozt). A per-metal `assertPriceInRange()` sanity check follows.

---

## Goldback Data Flow

> **Post-STAK-491:** Goldback data flows through sqld, not a direct git-commit path.
> `run-goldback.sh` on Fly.io is **disabled** (`GOLDBACK_ENABLED=0`) — the home poller's
> `goldback-scraper.js` writes `goldback-g1` to sqld hourly (`5 * * * *`, STRK-58), and
> Fly.io's exporters read that row during the normal publish cycle. goldback.com's
> upstream rate (`data.t`) can lag the scrape, so `g1_usd` may repeat across publishes.

Serving endpoints are the v2 goldback rows in the table above. `data/goldback-YYYY.json`
(rolling annual history, newest first) is also regenerated each publish cycle from the
sqld `goldback-g1` rows.

---

## Vendor Reference

7 primary vendors tracked across all bullion coins:

| Vendor ID          | Name              | Notes                                |
| ------------------ | ----------------- | ------------------------------------ |
| `jmbullion`        | JM Bullion        | JS-heavy (Next.js), 10s render wait  |
| `apmex`            | APMEX             | Standard extraction                  |
| `sdbullion`        | SD Bullion        | Standard extraction                  |
| `monumentmetals`   | Monument Metals   | React Native Web SPA, 7s render wait |
| `herobullion`      | Hero Bullion      | 6s render wait                       |
| `bullionexchanges` | Bullion Exchanges | React/Magento SPA, 8s render wait    |
| `summitmetals`     | Summit Metals     | ASE only                             |

Goldback-specific vendors: `goldback` (official exchange rate)

> The live vendor map has grown beyond this original seven (e.g. `mintbuilder` via the
> MintBuilder API feed, STRK-321) — `data/v2/providers.json` and the four vendor maps in
> `js/retail.js`/`VENDOR_META` are the authoritative roster.

---

## HTTP Server Details

`serve.js` runs on Fly.io port 8080 as a redundancy endpoint:

- **CORS:** `Access-Control-Allow-Origin: *`
- **Cache:** `Cache-Control: public, max-age=300` (5 minutes)
- **Methods:** GET and OPTIONS only
- **Security:** Directory traversal (`..`) rejected
- **Content types:** `.json` → `application/json`, `.db` → `application/x-sqlite3`

---

## Legacy v1 API (`data/api/` — still published, not consumed)

> **Status:** v1 endpoints are still written by `api-export.js` every publish cycle for
> external/legacy consumers, but **no frontend code reads them** (removed in STAK-509,
> v3.33.92). Do not build new features against v1. Schemas below are kept for pipeline
> diagnostics and external-consumer reference only.

| Endpoint                                               | Description                                                       | Updated      |
| ------------------------------------------------------ | ----------------------------------------------------------------- | ------------ |
| `data/api/manifest.json`                               | Index: coin list, latest window, endpoint templates               | Every 15 min |
| `data/api/latest.json`                                 | All coins' current median/lowest prices                           | Every 15 min |
| `data/api/providers.json`                              | Vendor to product URL mapping per coin (auto-generated from sqld) | Every 15 min |
| `data/api/goldback-spot.json`                          | Goldback G1 rate + denomination multipliers                       | Every 15 min |
| `data/api/{slug}/latest.json`                          | Per-vendor prices, confidence, availability, 24h series           | Every 15 min |
| `data/api/{slug}/history-7d.json` / `history-30d.json` | Daily aggregates                                                  | Every 15 min |

### v1 manifest.json Schema

```json
{
  "generated_at": "2026-02-25T19:08:01.756Z",
  "latest_window": "2026-02-25T19:00:00Z",
  "window_count": 96,
  "coin_count": 11,
  "coins": ["age", "ape", "ase", "..."],
  "coins_meta": { ... },
  "endpoints": {
    "latest": "api/latest.json",
    "slug_latest": "api/{slug}/latest.json",
    "history_7d": "api/{slug}/history-7d.json",
    "history_30d": "api/{slug}/history-30d.json",
    "providers": "api/providers.json"
  }
}
```

> `coins_meta` is an optional object containing per-coin metadata (display name, metal,
> weight). Present when the exporter has metadata available from the provider database.

### v1 latest.json Schema

```json
{
  "window_start": "2026-02-25T19:00:00Z",
  "generated_at": "2026-02-25T19:08:01.756Z",
  "coin_count": 11,
  "coins": {
    "ase": {
      "window_start": "2026-02-25T19:00:00Z",
      "median_price": 36.42,
      "lowest_price": 35.19,
      "vendor_count": 7
    }
  }
}
```

### v1 goldback-spot.json Schema

```json
{
  "date": "2026-02-25",
  "scraped_at": "2026-02-25T19:08:01.756Z",
  "g1_usd": 10.43,
  "denominations": {
    "g1": 10.43,
    "g5": 52.15,
    "g10": 104.3,
    "g25": 260.75,
    "g50": 521.5
  },
  "source": "goldback.com",
  "confidence": "high"
}
```

### v1 Per-Coin latest.json Schema

```json
{
  "slug": "ase",
  "window_start": "2026-02-25T19:00:00Z",
  "median_price": 36.42,
  "lowest_price": 35.19,
  "vendors": {
    "jmbullion": {
      "price": 35.19,
      "confidence": 99,
      "source": "firecrawl+vision",
      "inStock": true
    },
    "apmex": {
      "price": 36.99,
      "confidence": 80,
      "source": "firecrawl",
      "inStock": true
    }
  },
  "availability_by_site": {
    "jmbullion": true,
    "apmex": true
  },
  "last_known_price_by_site": {},
  "last_available_date_by_site": {},
  "windows_24h": [
    {
      "window": "2026-02-24T19:15:00Z",
      "median": 36.5,
      "low": 35.2,
      "vendors": { "jmbullion": 35.2, "apmex": 37.01 }
    }
  ]
}
```

### Deprecated Goldback Compat Slugs

`goldback-g1` … `goldback-g50` (mixed-state, backward compat) are scaffolded v1-era slugs,
not in the committed manifest.

---

## Best Practices Audit

**Strengths:**

- Static file serving — zero dynamic attack surface
- Proper CORS configuration with preflight handling
- Cache-Control headers appropriate for 15-min update cycle
- sqld as single source of truth for retail data
- Dual-source verification (Firecrawl + Vision) with confidence scoring
- v2 self-describing envelopes — thresholds travel with the data

**Recommendations:**

1. _(Aspirational)_ Add `/_health` endpoint returning `{"status":"ok","generated_at":"..."}` for Fly.io health checks
2. Add `Last-Modified` header from `stat.mtime` for conditional caching (`If-Modified-Since`)
3. Retire the v1 exporter once external consumers (if any) confirm migration — dual-publishing doubles the publish surface for no frontend benefit

---

## Related

- Architecture — system diagram, repo boundaries, v1-vs-v2 status
- Health Checks — envelope-driven staleness, diagnostic script
- Remote Poller — scraping pipeline, Firecrawl, tiered recovery

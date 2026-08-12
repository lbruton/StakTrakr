---
title: "API Reference"
project: StakTrakr
audience: agent
canonical: .context/deep-dives/api-reference.md
source: "DocVault/Projects/StakTrakr/Foundation/Deep Dives/API Reference.md" # migrated 2026-08-12
updated: "2026-06-28"
---

# API Reference

**Base URL:** `https://api.staktrakr.com`
**Fallback URL:** `https://api2.staktrakr.com`

---

## Overview

All endpoints are static JSON files served via Cloud - GitHub Pages from the `api` branch of `lbruton/StakTrakrApi`. Feed generation code lives in `devops/pollers/` in the `StakTrakr` repo; `StakTrakrApi` hosts the `api` branch for GitHub Pages serving. There is no dynamic server — `serve.js` on Cloud - Fly.io port 8080 is a redundancy proxy serving the same files.

**Update cadence:** Every 15 minutes via `run-publish.sh` (cron `8,23,38,53 * * * *`).

---

## Global Endpoints

| Endpoint                      | Description                                                       | Updated      |
| ----------------------------- | ----------------------------------------------------------------- | ------------ |
| `data/api/manifest.json`      | Index: coin list, latest window, endpoint templates               | Every 15 min |
| `data/api/latest.json`        | All coins' current median/lowest prices                           | Every 15 min |
| `data/api/providers.json`     | Vendor to product URL mapping per coin (auto-generated from sqld) | Every 15 min |
| `data/api/goldback-spot.json` | Goldback G1 rate + denomination multipliers                       | Every 15 min |

### manifest.json Schema

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

> `coins_meta` is an optional object containing per-coin metadata (display name, metal, weight). Present when the exporter has metadata available from the provider database.

### latest.json Schema

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

### goldback-spot.json Schema

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

---

## Per-Coin Endpoints

**Manifest-driven bullion coin slugs** (currently 15+ as of 2026-03-22, dynamically generated from Turso/provider data via `data/api/manifest.json`). Each coin has three endpoint files:

| Endpoint Pattern                   | Description                                                               | Updated      |
| ---------------------------------- | ------------------------------------------------------------------------- | ------------ |
| `data/api/{slug}/latest.json`      | Per-vendor prices, confidence, availability, 24h time series (96 windows) | Every 15 min |
| `data/api/{slug}/history-7d.json`  | Daily aggregates, last 7 days                                             | Every 15 min |
| `data/api/{slug}/history-30d.json` | Daily aggregates, last 30 days                                            | Every 15 min |

### Example Coin Slugs

The slug catalog is manifest-driven and grows as coins/vendors are enabled in the provider database. Representative slugs include:

**Silver (1 oz):** `ase`, `maple-silver`, `britannia-silver`, `krugerrand-silver`, `generic-silver-round`
**Silver (10 oz):** `generic-silver-bar-10oz`
**Gold (1 oz):** `age`, `buffalo`, `maple-gold`, `krugerrand-gold`
**Platinum (1 oz):** `ape`
**Goldback:** `goldback-oklahoma-g1`, `goldback-utah-g50`, `goldback-wyoming-g5`, `goldback-wyoming-g50`, and others as enabled

### Planned/Future: Goldback Per-State Matrix

The following Goldback slugs are scaffolded but **not yet in the committed manifest**:

**Goldback (deprecated -- backward compat):** `goldback-g1`, `goldback-g2`, `goldback-g5`, `goldback-g10`, `goldback-g25`, `goldback-g50`
**Goldback (per-state -- STAK-335):** `goldback-{state}-g{denom}` where state is one of `utah`, `nevada`, `wyoming`, `new-hampshire`, `south-dakota`, `arizona`, `oklahoma`, `dc` and denom is `ghalf`, `g1`, `g2`, `g5`, `g10`, `g25`, `g50` (56 slugs total). These endpoints will populate as vendors are enabled in the database.

### Per-Coin latest.json Schema

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

**Vendor source values:**

| Source             | Meaning                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| `firecrawl+vision` | Both Firecrawl and Gemini Vision agreed (<=3% diff) — 99 confidence                     |
| `firecrawl`        | Firecrawl text extraction only                                                          |
| `vision`           | Gemini Vision screenshot extraction only                                                |
| `turso_last_known` | T4 fallback — most recent in-stock price from database history (includes `stale: true`) |

**Confidence tiers:**

| Range | Meaning                            |
| ----- | ---------------------------------- |
| 90-99 | Firecrawl + Vision cross-validated |
| 60-89 | Single source, agrees with median  |
| 30-59 | Single source, moderate deviation  |
| 0-29  | Outlier or disagreement            |

---

## Spot Price Endpoints

| Endpoint Pattern                  | Description                                                                               | Updated                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| `data/hourly/YYYY/MM/DD/HH.json`  | Hourly spot prices (4 metals) — overwritten each poll                                     | 4x/hr (remote at `0,30`, home at `15,45`) |
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

**Metals:** Gold (XAU), Silver (XAG), Platinum (XPT), Palladium (XPD)
**Data source:** MetalPriceAPI (`metalpriceapi.com`)
**Rate conversion:** Conditional — `rate >= 1` uses value directly; `rate < 1` inverts (`1 / rate`) to get USD per troy oz

---

## Goldback-Specific Endpoints

### Active

| Endpoint                      | Description                                | Updated                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/api/goldback-spot.json` | G1 USD rate + all denomination multipliers | Home cron `5 * * * *` (hourly at :05, STRK-58) via `node goldback-scraper.js` writes `goldback-g1` to sqld; `api-export.js` regenerates the file **every publish cycle** (4×/hr) from the cached sqld row with a fresh `generated_at`. goldback.com's upstream rate (`data.t`) can lag the scrape, so `g1_usd` may repeat across publishes. Conditionally written when `coinSlugs` includes `goldback-g1`. |
| `data/goldback-YYYY.json`     | Rolling annual history log (newest first)  | Regenerated by `api-export.js` each publish cycle from the sqld `goldback-g1` rows.                                                                                                                                                                                                                                                                                                                        |

> **Note (post-STAK-491):** Goldback data flows through sqld, not a direct git-commit path. `run-goldback.sh` on Fly.io is **disabled** (`GOLDBACK_ENABLED=0`) — the home poller's `goldback-scraper.js` writes `goldback-g1` to sqld hourly (`5 * * * *`, STRK-58), and Fly.io's `api-export.js` reads that row during its normal publish cycle to generate `goldback-spot.json`. No scraper commits directly to the `api` branch anymore.

### Planned/Future: Per-State Goldback Endpoints

The following endpoint families are scaffolded but **not yet populated** — `goldback-g1` is not in the committed manifest, and per-state slugs have no enabled vendors:

| Endpoint                                              | Description                                            |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `data/api/goldback-g1/latest.json`                    | Mixed-state G1 vendor prices (legacy, backward compat) |
| `data/api/goldback-g{N}/latest.json`                  | Mixed-state denomination prices (legacy)               |
| `data/api/goldback-{state}-g{denom}/latest.json`      | Per-vendor prices for a specific state + denomination  |
| `data/api/goldback-{state}-g{denom}/history-7d.json`  | 7-day daily aggregates                                 |
| `data/api/goldback-{state}-g{denom}/history-30d.json` | 30-day daily aggregates                                |

**8 states x 7 denominations = 56 per-state slugs**, each with 3 endpoint files = **168 potential endpoint files** (only populated when vendors are enabled in the database).

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

---

## HTTP Server Details

`serve.js` runs on Cloud - Fly.io port 8080 as a redundancy endpoint:

- **CORS:** `Access-Control-Allow-Origin: *`
- **Cache:** `Cache-Control: public, max-age=300` (5 minutes)
- **Methods:** GET and OPTIONS only
- **Security:** Directory traversal (`..`) rejected
- **Content types:** `.json` → `application/json`, `.db` → `application/x-sqlite3`

---

## Best Practices Audit

**Strengths:**

- Static file serving — zero dynamic attack surface
- Proper CORS configuration with preflight handling
- Cache-Control headers appropriate for 15-min update cycle
- sqld as single source of truth for retail data
- Dual-source verification (Firecrawl + Vision) with confidence scoring

**Recommendations:**

1. _(Aspirational)_ Add `/_health` endpoint returning `{"status":"ok","generated_at":"..."}` for Fly.io health checks
2. Add `Last-Modified` header from `stat.mtime` for conditional caching (`If-Modified-Since`)
3. Consider adding `schema_version` to `manifest.json` for client-side breaking change detection

---

## v2 API (STAK-503)

> **Status:** v2 publisher (`devops/pollers/shared/api-export-v2.js`) generates endpoints alongside v1. Frontend migration behind `USE_V2_API` feature flag (default `false`). v2 pipeline is non-fatal — v1 continues to publish regardless of v2 outcome.

### Endpoint Tree

All v2 endpoints live under `data/v2/`:

| Endpoint                                 | Description                                                                               | Updated             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------- |
| `data/v2/manifest.json`                  | Self-describing index: coin list, endpoint templates, stale thresholds per type           | Every 15 min        |
| `data/v2/spot/latest.json`               | Current spot prices (4 metals) with OHLCA aggregates                                      | Every 15 min        |
| `data/v2/spot/history-24h.json`          | 24h spot time series (96 windows)                                                         | Every 15 min        |
| `data/v2/retail/{slug}/latest.json`      | Per-coin vendor prices with carry-forward metadata                                        | Every 15 min        |
| `data/v2/retail/{slug}/history-7d.json`  | 7-day hourly OHLCA buckets                                                                | Every 15 min        |
| `data/v2/retail/{slug}/history-30d.json` | 30-day daily aggregates with OHLCA and per-vendor breakdown                               | Every 15 min        |
| `data/v2/retail/{slug}/history-90d.json` | 90-day daily aggregates with OHLCA and per-vendor breakdown                               | Every 15 min        |
| `data/v2/goldback/latest.json`           | G1 rate + denomination multipliers with OHLCA; `data.t` stamped at scrape hour (STRK-248) | Every publish cycle |
| `data/v2/goldback/intraday.json`         | Raw hourly G1 point series `[{ t, ts, g1_usd }]` for the last 72 h (STRK-248)             | Every publish cycle |
| `data/v2/goldback/{slug}/latest.json`    | Per-state goldback vendor prices                                                          | Every 15 min        |
| `data/v2/providers.json`                 | Vendor to product URL mapping per coin (reference data — stable)                          | Every 15 min        |

### Stale Thresholds (per endpoint type)

| Type      | `stale_after` (seconds)                              |
| --------- | ---------------------------------------------------- |
| Spot      | 1200 (20 min)                                        |
| Retail    | 1800 (30 min)                                        |
| Goldback  | 7200 (2 h) — was 90000 (25 h) before STRK-248        |
| Manifest  | 1800 (30 min)                                        |
| Providers | 86400 (24 h) — vendor URLs are stable reference data |

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

---

## Related

- Architecture — system diagram, repo boundaries
- Remote Poller — scraping pipeline, Firecrawl, tiered recovery
- Cloud - GitHub Pages — hosting for static JSON feeds
- Cloud - Fly.io — container that produces the feeds

---
title: "Provider Database"
project: StakTrakr
audience: agent
canonical: .context/deep-dives/provider-database.md
migration_source: "DocVault/Projects/StakTrakr/Foundation/Deep Dives/Provider Database.md" # historical provenance; migrated 2026-08-12
updated: "2026-03-22"
---

# Provider Database (sqld)

> **Last verified:** 2026-03-22 — bulk vendor operations + goldback cleanup deployed, coverage stats added

---

## Overview

Provider data (which vendors to scrape, URLs, coin metadata) is stored in **sqld** as the single source of truth. Prior to 2026-02-25, this data lived in a static `providers.json` file on the `api` branch — pollers curled it before each run, and the home dashboard wrote edits back to the file. This caused race conditions when multiple writers edited the file simultaneously.

The shared query module `provider-db.js` provides all read/write operations. All consumers — Cloud - Fly.io publisher/runtime (publish and export, spot support), home poller (retail scraping), and the dashboard — import from this module.

**Current stats (runtime-observed -- re-verify against live DB):** 73 coins in live sqld (silver, gold, goldback, platinum), 377 vendors. The committed `main` branch manifest reports 11 coins.

---

## Schema

### `provider_coins`

```sql
CREATE TABLE IF NOT EXISTS provider_coins (
  slug       TEXT PRIMARY KEY,
  metal      TEXT NOT NULL,        -- "gold", "silver", "platinum"
  name       TEXT NOT NULL,        -- "American Silver Eagle"
  weight_oz  REAL NOT NULL,        -- troy ounces (e.g. 1, 10)
  fbp_url    TEXT,                 -- FindBullionPrices product URL, hand-assigned (nullable)
  notes      TEXT,                 -- free-form notes
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### `provider_vendors`

```sql
CREATE TABLE IF NOT EXISTS provider_vendors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  coin_slug  TEXT NOT NULL REFERENCES provider_coins(slug),
  vendor_id  TEXT NOT NULL,        -- "jmbullion", "apmex", etc.
  vendor_name TEXT NOT NULL,                -- display name
  url        TEXT,                 -- scrape URL (null = disabled/no URL)
  enabled    INTEGER NOT NULL DEFAULT 1,
  selector   TEXT,                 -- CSS selector override (nullable)
  hints      TEXT,                 -- JSON hints for scraper (nullable)
  skip_bounds INTEGER NOT NULL DEFAULT 0,  -- 1 = exempt from price bounds guard (STAK-496)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(coin_slug, vendor_id)
);
```

### `provider_failures`

```sql
CREATE TABLE IF NOT EXISTS provider_failures (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  coin_slug  TEXT NOT NULL,
  vendor_id  TEXT NOT NULL,
  url        TEXT,
  error      TEXT,
  failed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Added in STAK-349. Populated by `recordFailure()` in `db.js` — called from `price-extract.js` whenever a scrape returns no price for an in-stock vendor.

### Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_pv_coin ON provider_vendors(coin_slug);
CREATE INDEX IF NOT EXISTS idx_pv_vendor ON provider_vendors(vendor_id);
CREATE INDEX IF NOT EXISTS idx_pv_enabled ON provider_vendors(coin_slug, enabled);
CREATE INDEX IF NOT EXISTS idx_pf_coin_vendor ON provider_failures(coin_slug, vendor_id);
CREATE INDEX IF NOT EXISTS idx_pf_failed_at ON provider_failures(failed_at);
```

---

## provider-db.js API

Shared module at `StakTrakr/devops/pollers/shared/provider-db.js`. Most functions take a database `client` as the first argument. Exceptions: `loadProvidersFromFile(dataDir)` reads from the local filesystem, and `loadProviders(client, dataDir)` uses sqld-first with file fallback.

| Function                                                              | Description                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initProviderSchema(client)`                                          | Idempotent DDL — creates tables, indexes, and runs `skip_bounds` column migration (STAK-496)                                                      |
| `getProviders(client)`                                                | Returns `{ coins: { [slug]: { metal, name, weight_oz, providers: [...] } } }` — vendors include `skipPriceBounds: true` when `skip_bounds=1`      |
| `getProvidersByCoin(client, coinSlug)`                                | Vendors for a single coin — includes `skipPriceBounds` flag                                                                                       |
| `getAllCoins(client)`                                                 | Coin list without vendor detail                                                                                                                   |
| `upsertCoin(client, coin)`                                            | Insert or update a coin row                                                                                                                       |
| `upsertVendor(client, vendor)`                                        | Insert or update a vendor row                                                                                                                     |
| `toggleVendor(client, coinSlug, vendorId, enabled)`                   | Enable/disable a vendor                                                                                                                           |
| `updateVendorUrl(client, coinSlug, vendorId, url)`                    | Change a vendor's scrape URL                                                                                                                      |
| `deleteCoin(client, slug)`                                            | Delete coin + all its vendors (batch)                                                                                                             |
| `deleteVendor(client, coinSlug, vendorId)`                            | Delete a single vendor row                                                                                                                        |
| `updateVendorFields(client, coinSlug, vendorId, { selector, hints })` | Update selector/hints metadata                                                                                                                    |
| `getVendorScrapeStatus(client)`                                       | Latest scrape result per vendor (window function query)                                                                                           |
| `getFailureStats(client)`                                             | Vendors with 3+ failures in last 7 days                                                                                                           |
| `getRunStats(client)`                                                 | Poller run aggregates (last 24h)                                                                                                                  |
| `batchToggleVendor(client, { vendorId, metal, enabled })`             | Toggle all vendors of a vendor ID + metal type. Returns `{ rowsAffected }`                                                                        |
| `batchDeleteVendor(client, { vendorId, metal })`                      | Delete all vendor entries for a vendor ID + metal type. Returns `{ rowsAffected }`                                                                |
| `batchToggleVendorByCoins(client, { vendorId, coinSlugs, enabled })`  | Toggle vendor across specific coin slugs. Returns `{ rowsAffected }`                                                                              |
| `getVendorSummary(client)`                                            | Grouped counts by vendor ID and metal. Returns `{ [vendorId]: { total, enabled, disabled, byMetal: { [metal]: { total, enabled, disabled } } } }` |
| `getCoverageStats(client, hours?)`                                    | Hourly coverage — how many enabled pairs had a successful price. Returns `{ totalEnabled, hours: [{ hour, covered, pct }] }`                      |
| `getMissingItems(client)`                                             | Enabled pairs with no successful price this hour. Returns `[{ coinSlug, coinName, metal, vendor, url }]`                                          |
| `exportProvidersJson(client)`                                         | Returns JSON string matching `providers.json` format                                                                                              |
| `loadProvidersFromFile(dataDir)`                                      | File fallback — reads `{dataDir}/retail/providers.json`                                                                                           |
| `loadProviders(client, dataDir)`                                      | sqld-first with file fallback; logs which path taken                                                                                              |

---

## Sync Between Pollers

`provider-db.js` lives in `StakTrakr/devops/pollers/shared/` and is the single source of truth for both pollers. Both Dockerfiles `COPY shared/*.js` into the container at build time — no manual sync needed.

**Sync procedure:**

Code deploys via Portainer's GitOps stack redeploy — push to the tracked git branch and Portainer auto-deploys within 5 minutes. For immediate deploys, use the Portainer REST API:

```bash
curl -sk -X PUT \
  "https://192.168.1.81:9443/api/stacks/7/git/redeploy?endpointId=3" \
  -H "X-API-Key: $PORTAINER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pullImage": true, "prune": true, "env": [...]}'
```

See `sync-poller` skill for the full workflow including required env vars.

---

## Data Flow

```text
Dashboard (CRUD)  ──→  sqld provider tables  ←── migrate-providers.js (one-time import)
                            │
                            ├──→ price-extract.js (reads providers for scraping)
                            ├──→ capture.js (reads providers for vision pipeline)
                            ├──→ api-export.js (reads providers for manifest generation)
                            │
                            └──→ run-publish.sh → exportProvidersJson() → providers.json on api branch
```

`providers.json` on the `api` branch is now **auto-generated** from sqld every publish cycle. It serves as a read-only snapshot for backward compatibility. Direct edits to the file will be overwritten.

---

## Dashboard CRUD

The Home Poller dashboard at `http://192.168.1.81:3010/providers` provides full CRUD against the sqld provider tables. Rebuilt in STAK-349 (2026-02-26).

### Layout

- **Stats bar** — total coins, total vendors, enabled vendors, poller run stats (last 24h)
- **Search/filter** — client-side filter by coin name, metal, or vendor name
- **Collapsible accordion** — each coin is a collapsible section (73 coins, collapsed by default)
- **Per-vendor scrape status** — green/red dots showing latest scrape result from `price_snapshots`

### Operations

| Action              | Trigger                 | Backend                           |
| ------------------- | ----------------------- | --------------------------------- |
| Add coin            | Modal form              | `upsertCoin()`                    |
| Edit coin           | Inline fields           | `upsertCoin()`                    |
| Delete coin         | Button + confirm dialog | `deleteCoin()` (cascades vendors) |
| Add vendor          | Modal form              | `upsertVendor()`                  |
| Edit vendor URL     | Blur-to-save on input   | `updateVendorUrl()`               |
| Edit selector/hints | Save button per vendor  | `updateVendorFields()`            |
| Toggle vendor       | Checkbox click          | `toggleVendor()`                  |
| Delete vendor       | Button + confirm dialog | `deleteVendor()`                  |
| Export JSON         | Button                  | `exportProvidersJson()`           |

All writes are individual database calls — no batch "Save All" button. Changes take effect on the next poller cycle.

### Bulk Operations

The providers page includes a **bulk action bar** (visible when filtering by metal type). Select a vendor from the dropdown and apply Enable All / Disable All / Remove All across all items of that metal.

| Action                               | Endpoint                        | Backend               |
| ------------------------------------ | ------------------------------- | --------------------- |
| Enable all vendor items for a metal  | `POST /providers/bulk-toggle`   | `batchToggleVendor()` |
| Disable all vendor items for a metal | `POST /providers/bulk-toggle`   | `batchToggleVendor()` |
| Remove all vendor items for a metal  | `POST /providers/bulk-delete`   | `batchDeleteVendor()` |
| Get vendor summary counts            | `GET /providers/vendor-summary` | `getVendorSummary()`  |

Confirmation modal shows the affected item count before executing. Added 2026-02-26 (goldback-vendor-cleanup + bulk-vendor-management-ui specs).

### Coverage Stats

The main dashboard shows hourly coverage cards and a missing items table:

- **Coverage cards** — latest hour coverage %, 12-hour average, spark bars
- **Missing Items table** — enabled vendor-coin pairs with no successful price this hour, with Diagnose and Browserbase action buttons

Powered by `getCoverageStats()` and `getMissingItems()` in `provider-db.js`.

### Failure Queue

A dedicated page at `/failures` shows vendors with repeated scrape failures:

- Aggregated from `provider_failures` table (3+ failures in last 7 days)
- Shows coin name, vendor ID, failure count, last error, and scrape URL
- Links back to the vendor's entry in `/providers` for editing

### Read-only fallback

If the database is unreachable, the dashboard renders in read-only mode with a warning banner. Data is loaded from the local `providers.json` file via `loadProvidersFromFile()`.

---

## Fallback Strategy

All poller scripts use `loadProviders(client, dataDir)` which:

1. Tries `getProviders(client)` from sqld
2. On failure, falls back to `loadProvidersFromFile(dataDir)` — reads the local `providers.json`
3. Logs which path was taken (sqld vs file fallback)

The local `providers.json` files are kept on both pollers as a safety net but are no longer the primary data source.

---

## Migration

**One-time migration script:** `migrate-providers.js`

Run the script in an environment where the target deployment's database configuration has been
provided through its secret store:

```bash
# Dry run (safe)
node devops/pollers/shared/migrate-providers.js --dry-run --production

# Execute
node devops/pollers/shared/migrate-providers.js --production
```

- `--production` required when the database URL is not localhost
- `--dry-run` prints what would be inserted without writing
- Uses `INSERT OR REPLACE` — fully idempotent
- Migrated 2026-02-25: 11 coins, 67 vendors, verified round-trip fidelity

**STAK-496 migration (v3.33.81):** `initProviderSchema()` now includes an idempotent `ALTER TABLE provider_vendors ADD COLUMN skip_bounds INTEGER NOT NULL DEFAULT 0`. The migration runs on every startup — the `catch` block silently handles the expected "duplicate column" error on subsequent runs. If the ALTER truly fails (permissions, schema lock), the subsequent SELECT including `skip_bounds` will throw immediately.

---

## Rollback

If sqld provider tables need to be abandoned:

1. All poller scripts automatically fall back to `loadProvidersFromFile()` if the database is unreachable
2. Restore `curl` lines in `run-local.sh` and `run-home.sh` (see git history pre-STAK-348)
3. Remove `exportProvidersJson()` call from `run-publish.sh`
4. Edit `providers.json` on the `api` branch directly (old workflow)

---

## Related

- Turso Schema — all database tables including `price_snapshots`
- Providers Config — file format reference (now auto-generated)
- Cloud - Fly.io — deployment and environment
- Home Poller — dashboard and secondary poller
- Health Checks — monitoring and troubleshooting

---
title: Data Model
category: frontend
owner: staktrakr
lastUpdated: v3.33.59
date: 2026-03-07
sourceFiles:
  - js/constants.js
  - js/utils.js
  - js/types.js
relatedPages:
  - storage-patterns.md
  - frontend-overview.md
---
# Data Model

> **Last updated:** v3.33.55 — 2026-03-06
> **Source files:** `js/constants.js`, `js/utils.js`, `js/types.js`

## Overview

StakTrakr tracks precious metals inventory using three value dimensions per item. All state is persisted to `localStorage` through a strict allowlist guard. There is no backend database; the browser is the source of truth.

## Key Rules (read before touching this area)

1. **`meltValue` is never stored.** It is always computed at render time: `meltValue = weightOz * qty * spot * purity` (where `weightOz` converts Goldback `gb` units via `weight * GB_TO_OZT`, and `purity` defaults to `1.0`). Storing it would produce stale values.
2. **Every localStorage key must be registered in `ALLOWED_STORAGE_KEYS`** (`js/constants.js`) before use. `ALLOWED_STORAGE_KEYS` is a cleanup/restore allowlist enforced by `cleanupStorage()` at startup — it is not a write-time guard inside `saveData()` or `saveDataSync()`. Unregistered keys are silently deleted on the next app startup.
3. **`saveData` / `loadData` are the standard localStorage accessors for JSON-serialized data.** Raw `localStorage.getItem` / `setItem` is intentional for plain scalar string preferences (e.g., `cloud_kraken_seen`, `CLOUD_VAULT_IDLE_TIMEOUT_KEY`) where async JSON serialization is inappropriate.
4. **`spotPrices` is runtime state, not stored state.** It is fetched from the API and held in the `spotPrices` variable (defined in `js/state.js`, one property per metal). It is not written to the inventory object.
5. **`disposition` is stored on the item record.** When an item is disposed (sold/traded/lost/gifted/returned), a `disposition` object is written to the item. The `realizedGainLoss` is computed once at disposition time and stored — it is not re-derived at render.

## Architecture

### Portfolio Value Model

| Dimension | Source | Stored? |
|---|---|---|
| `purchasePrice` | User entry | Yes (in item record as `price`) |
| `meltValue` | `weightOz * qty * spot * purity` | **No — computed at render** |
| `retailPrice` | Live market ask from API | No (cached separately in `retailPrices`) |

`price` (purchase price) is the historical cost basis — what the user actually paid. It never changes after entry.

`meltValue` reflects the current intrinsic metal value and changes every time spot moves. Computing it at render time avoids stale data and keeps the stored schema simple.

`retailPrice` is the current market ask for that specific product. It is fetched from the retail price API and stored in its own cache key (`retailPrices`), not inside the inventory item.

### meltValue Formula

```js
// From js/utils.js — computeMeltValue()
const weightOz = (item.weightUnit === 'gb') ? weight * GB_TO_OZT : weight;
meltValue = weightOz * qty * spot * purity;
```

- `GB_TO_OZT = 0.001` — 1 Goldback denomination equals 0.001 troy oz of 24K gold
- `purity` defaults to `1.0` if not set
- `weight` is always the fine metal content in troy ounces (for non-Goldback items)

## Item Schema

### Full InventoryItem Field List

Defined via JSDoc typedef in `js/types.js`. All fields persist on the item object in `metalInventory` localStorage.

```js
{
  // --- Identity ---
  uuid:                  String,         // UUID v4 — primary key (required)
  name:                  String,         // display name, e.g. "2024 American Gold Eagle 1 oz" (required)
  type:                  String,         // "Coin" | "Round" | "Bar" | etc. (required)
  metal:                 String,         // "Silver" | "Gold" | "Platinum" | "Palladium" (required)
  composition:           String,         // optional — "Gold" | "Silver" | "Platinum" | "Palladium" | "Alloy"

  // --- Physical properties ---
  weight:                Number,         // fine troy ounces per unit, or Goldback denomination when weightUnit is 'gb' (required)
  weightUnit:            String,         // "oz" (default) | "g" | "kg" | "lb" | "gb" (Goldback)
  purity:                Number,         // metal purity factor 0.0–1.0 (default 1.0)
  qty:                   Number,         // integer quantity held (required)

  // --- Purchase ---
  price:                 Number,         // total purchase cost in USD across all units (required)
  date:                  String,         // purchase date "YYYY-MM-DD" (required)
  purchaseLocation:      String,         // optional — where the item was purchased
  spotPriceAtPurchase:   Number,         // optional — spot price at time of purchase
  premiumPerOz:          Number,         // optional — premium paid per troy oz
  totalPremium:          Number,         // optional — total premium paid across all units

  // --- Storage & Identification ---
  storageLocation:       String,         // optional — where the item is physically stored
  notes:                 String,         // optional — free-text user notes
  year:                  String,         // optional — year of issue
  mintmark:              String,         // optional — mint or issuer label

  // --- Grading & Certification ---
  grade:                 String,         // optional — item grade (e.g. "MS70", "PR69")
  gradingAuthority:      String,         // optional — "PCGS" | "NGC" | etc.
  certNumber:            String,         // optional — certification number
  serialNumber:          String,         // optional — serial number
  serial:                String,         // optional — original serial string from import
  pcgsNumber:            String,         // optional — PCGS coin number for API lookup
  pcgsVerified:          Boolean,        // optional — whether PCGS data has been verified

  // --- Catalog lookup ---
  numistaId:             String,         // optional — Numista ID for lookup
  marketValue:           Number,         // optional — manual retail override (else computed from retail API)
  collectable:           Boolean,        // optional — whether item is marked as collectable

  // --- Images (v3.32.27) ---
  obverseImageUrl:       String,         // optional — URL or data URI for obverse image
  reverseImageUrl:       String,         // optional — URL or data URI for reverse image
  obverseSharedImageId:  String|null,    // optional — UUID of source item if obverse was tagged from shared library; null for original uploads
  reverseSharedImageId:  String|null,    // optional — UUID of source item if reverse was tagged from shared library; null for original uploads

  // --- Disposition (v3.33.17 / STAK-72) ---
  disposition:           Object|null     // disposition record — null for active items (see below)
}
```

**Field notes:**

- `weight` is always **fine metal content** in troy ounces for standard items. For a 1 oz Gold Eagle, `weight = 1.0`. For a 90% silver dime, `weight ≈ 0.07234`. For Goldbacks, `weight` holds the denomination (e.g. `1`, `5`, `25`) and `weightUnit = 'gb'`.
- `price` is the **total** purchase cost for all units, not per-unit price.
- Per-item tags are stored separately under the `itemTags` localStorage key (keyed by UUID), not on the inventory item object itself.
- There is no `spotPrice` field on the item. Spot is always read from `spotPrices[item.metal]` at render time.

### Disposition Record Shape (v3.33.17 — STAK-72)

When an item is disposed, a `disposition` object is written to the item record:

```js
{
  type:             String,   // "sold" | "traded" | "lost" | "gifted" | "returned"
  date:             String,   // ISO date string "YYYY-MM-DD"
  amount:           Number,   // sale/trade/refund amount in USD (0 for lost/gifted)
  currency:         String,   // always "USD" currently
  recipient:        String,   // optional — who received the item
  notes:            String,   // optional — free-text notes
  realizedGainLoss: Number,   // amount - (price * qty) — computed once at disposition
  disposedAt:       String    // ISO timestamp — when the disposition was recorded
}
```

**Key behaviors:**

- `isDisposed(item)` (in `js/constants.js`) returns `true` if `item.disposition` is truthy.
- Disposed items are excluded from active portfolio totals (melt value, purchase total, weight, item count). They are tracked in a separate `disposedItems` counter and `realizedGainLoss` accumulator per metal in `updateSummary()`.
- `realizedGainLoss` is computed once at disposition time (`confirmDisposition()` in `js/inventory.js`): `amount - (item.price * item.qty)`. It is stored, not re-derived.
- `undoDisposition(idx)` sets `item.disposition = null`, restoring the item to active inventory.
- The filter system (`js/filters.js`) strips disposed items by default; a toggle (`#showDisposedToggle`) reveals them.

### Disposition Types

Defined in `DISPOSITION_TYPES` (frozen object in `js/constants.js`):

| Key | Label | `requiresAmount` |
|---|---|---|
| `sold` | Sold | `true` |
| `traded` | Traded | `true` |
| `lost` | Lost | `false` |
| `gifted` | Gifted | `false` |
| `returned` | Returned | `true` |

Types where `requiresAmount` is `false` do not require a monetary amount — the disposition modal hides the amount input for these types.

## Portfolio Model

### Value Dimensions

| Dimension | Field / Source | Formula | Stored? |
|---|---|---|---|
| Purchase Price | `item.price` | User entry — total cost all units | Yes |
| Melt Value | computed | `weightOz * qty * spot * purity` | No — render-time |
| Retail Price | `retailPrices[slug]` | Live market ask from API manifest | No — separate cache |

### Spot Price Access

```js
// Reading spot at render time — never from a stored field:
const spot = spotPrices?.[item.metal] ?? 0;
const meltValue = computeMeltValue(item, spot);
```

`spotPrices` is defined in `js/state.js` and populated by the spot-price fetch in `js/api.js`. It is not written to `localStorage` under the inventory key. Individual per-metal spot values are cached under `spotGold`, `spotSilver`, `spotPlatinum`, and `spotPalladium`.

### Data Flow

```
API fetch (api.js)
  → spotPrices (state.js, runtime)
  → computeMeltValue(item, spot) at render
  → DOM update (inventory table / card view)

User edit (inventory form)
  → item object updated in memory
  → saveData('metalInventory', inventory) → localStorage (compressed)
  → UI re-render

App startup (init.js)
  → cleanupStorage() — removes unregistered keys
  → loadData('metalInventory') → inventory array
  → spot fetch → spotPrices populated
  → renderInventory()
```

## Storage Layer

**Async API (preferred for large data):**

```js
await saveData(key, value);          // js/utils.js — JSON-serialises, compresses if needed
const data = await loadData(key, defaultValue);
```

**Sync API (used for UI preferences and non-blocking reads):**

```js
saveDataSync(key, value);
const data = loadDataSync(key, defaultValue);
```

Both variants are exported to `window` (`window.saveDataSync`, `window.loadDataSync`). Both transparently handle LZ compression for large payloads. `loadData` / `loadDataSync` return `defaultValue` on missing or corrupt keys — they never throw to the caller.

## ALLOWED_STORAGE_KEYS

All keys currently registered in `js/constants.js`. `cleanupStorage()` enforces this list at startup — any key not listed here is silently deleted. Keys are grouped by domain below.

**Core inventory:**

| Key | Type | Description |
|---|---|---|
| `metalInventory` | JSON array | Primary inventory — array of item objects (includes `disposition` field per item when disposed) |
| `inventorySerial` | Number string | Monotonic serial for change detection |
| `catalogMap` | JSON object | Catalog metadata keyed by item ID |
| `item-price-history` | JSON object | Per-item price history keyed by UUID |
| `itemTags` | JSON object | Per-item tags keyed by UUID |

**Spot prices:**

| Key | Type | Description |
|---|---|---|
| `metalSpotHistory` | JSON array | Hourly spot price history |
| `spotGold` | Number string | Cached gold spot price |
| `spotSilver` | Number string | Cached silver spot price |
| `spotPlatinum` | Number string | Cached platinum spot price |
| `spotPalladium` | Number string | Cached palladium spot price |
| `spotTrendRange` | String | Selected spot trend range |
| `spotCompareMode` | String | Spot chart compare mode |
| `spotTrendPeriod` | String | Trend period: `"1"` \| `"7"` \| `"30"` \| `"90"` \| `"365"` \| `"1095"` |

**Retail prices:**

| Key | Type | Description |
|---|---|---|
| `retailPrices` | JSON object | Current retail ask prices keyed by item slug |
| `retailPriceHistory` | JSON array | Historical retail price entries |
| `retailProviders` | JSON array | Active retail data provider list |
| `retailIntradayData` | JSON object | Intraday retail price data |
| `retailSyncLog` | JSON array | Retail sync event log |
| `retailAvailability` | JSON object | Per-item availability data |
| `retailManifestGeneratedAt` | String | ISO timestamp — cached market manifest `generated_at` |
| `retailManifestSlugs` | JSON array | Cached manifest coin slug list |

**Goldback:**

| Key | Type | Description |
|---|---|---|
| `goldback-prices` | JSON object | Current Goldback prices |
| `goldback-price-history` | JSON array | Historical Goldback prices |
| `goldback-enabled` | Boolean string | Goldback feature toggle |
| `goldback-estimate-enabled` | Boolean string | Goldback estimate display toggle |
| `goldback-estimate-modifier` | Number string | Goldback estimate adjustment modifier |

**API / catalog:**

| Key | Type | Description |
|---|---|---|
| `metalApiConfig` | JSON object | API provider credentials |
| `metalApiCache` | JSON object | General API response cache |
| `lastCacheRefresh` | Timestamp | Last cache refresh time |
| `lastApiSync` | Timestamp | Last API sync time |
| `catalog_api_config` | JSON object | Catalog API configuration |
| `staktrakr.catalog.cache` | JSON object | Catalog item cache |
| `staktrakr.catalog.settings` | JSON object | Catalog display settings |
| `staktrakr.catalog.history` | JSON array | Catalog browse history |
| `numista_response_cache` | JSON object | Numista API response cache |
| `pcgs_response_cache` | JSON object | PCGS API response cache |
| `autocomplete_lookup_cache` | JSON object | Autocomplete suggestion cache |
| `autocomplete_cache_timestamp` | Timestamp | Autocomplete cache age |
| `numistaLookupRules` | JSON array | Custom Numista search rules |
| `numistaViewFields` | JSON object | View modal Numista field visibility |
| `enabledSeedRules` | JSON array | Enabled built-in Numista lookup rule IDs |
| `seedImagesVer` | String | Seed images version for cache invalidation |
| `numista_tags_auto` | Boolean string | Auto-tag items from Numista data |

**UI / display preferences:**

| Key | Type | Description |
|---|---|---|
| `appTheme` | String | UI theme name |
| `displayCurrency` | String | Display currency code (e.g. `"USD"`) |
| `exchangeRates` | JSON object | Cached exchange rates |
| `appTimeZone` | String | `"auto"` \| `"UTC"` \| IANA zone |
| `settingsItemsPerPage` | Number string | Table rows per page |
| `cardViewStyle` | String | `"A"` \| `"B"` \| `"C"` — card display variant |
| `desktopCardView` | Boolean string | Desktop card view toggle |
| `defaultSortColumn` | Number string | Default table sort column index |
| `defaultSortDir` | String | `"asc"` \| `"desc"` — default sort direction |
| `metalOrderConfig` | JSON array | Metal order/visibility configuration |
| `layoutVisibility` | JSON object | Legacy section visibility (migrated to `layoutSectionConfig`) |
| `layoutSectionConfig` | JSON array | Ordered section config `[{ id, label, enabled }]` |
| `viewModalSectionConfig` | JSON array | Ordered view modal section config |
| `tableImagesEnabled` | Boolean string | Show thumbnail images in table rows |
| `tableImageSides` | String | `"both"` \| `"obverse"` \| `"reverse"` — table image sides |
| `headerThemeBtnVisible` | Boolean string | Header theme button visibility |
| `headerCurrencyBtnVisible` | Boolean string | Header currency button visibility |
| `headerTrendBtnVisible` | Boolean string | Header trend button visibility |
| `headerSyncBtnVisible` | Boolean string | Header sync button visibility |
| `headerMarketBtnVisible` | Boolean string | Header market button visibility |
| `headerVaultBtnVisible` | Boolean string | Header vault button visibility |
| `headerRestoreBtnVisible` | Boolean string | Header restore button visibility |
| `headerCloudSyncBtnVisible` | Boolean string | Header cloud sync button visibility |
| `headerBtnShowText` | Boolean string | Show text labels under header icons |
| `headerBtnOrder` | JSON array | Header button card order (STAK-320) |
| `headerAboutBtnVisible` | Boolean string | About button visibility (STAK-320) |
| `showRealizedGainLoss` | Boolean string | Show realized G/L in summary cards (STAK-72) |
| `tagBlacklist` | JSON array | Tags excluded from auto-tagging |
| `chipMinCount` | Number string | Minimum item count for chip display |
| `chipMaxCount` | Number string | Maximum item count for chip display |
| `chipCustomGroups` | JSON array | Custom chip grouping definitions |
| `chipBlacklist` | JSON array | Hidden chip values |
| `inlineChipConfig` | JSON object | Inline chip display configuration |
| `chipSortOrder` | String | Chip sort order preference |
| `apiProviderOrder` | JSON array | API provider display order |
| `providerPriority` | JSON object | API provider priority map |
| `filterChipCategoryConfig` | JSON object | Filter chip category configuration |

**Version / app state:**

| Key | Type | Description |
|---|---|---|
| `currentAppVersion` | String | Installed app version string |
| `ackVersion` | String | Last acknowledged version for changelog |
| `ackDismissed` | Boolean string | Dismissal state for acknowledgement banner |
| `featureFlags` | JSON object | Feature flag overrides |
| `lastVersionCheck` | Timestamp | Last remote version check time |
| `latestRemoteVersion` | String | Cached latest remote version string |
| `latestRemoteUrl` | String | Cached latest remote release URL |
| `changeLog` | JSON array | Cached changelog entries |
| `staktrakr.debug` | Boolean string | Debug mode toggle |
| `stackrtrackr.debug` | Boolean string | Legacy debug key (typo alias kept for compatibility) |

**Image storage (v3.32.27):**

| Key | Constant | Type | Description |
|---|---|---|---|
| `storagePersistGranted` | `STORAGE_PERSIST_GRANTED_KEY` | Boolean string | `"true"` / `"false"` — whether the browser has granted persistent storage via `navigator.storage.persist()` |

**Cloud sync:**

| Key | Type | Description |
|---|---|---|
| `cloud_token_dropbox` | JSON | Dropbox OAuth token data |
| `cloud_token_pcloud` | JSON | pCloud OAuth token data |
| `cloud_token_box` | JSON | Box OAuth token data |
| `cloud_last_backup` | JSON | `{ provider, timestamp }` last backup info — only written by sync operations (manual backups with `skipLatestUpdate` skip this key) |
| `cloud_kraken_seen` | Boolean string | Easter egg seen flag |
| `staktrakr_oauth_result` | JSON | Transient OAuth callback relay (cleared after read) |
| `cloud_activity_log` | JSON | Cloud sync activity log entries |
| `cloud_sync_enabled` | Boolean string | Master auto-sync toggle |
| `cloud_sync_last_push` | JSON | `{ syncId, timestamp, rev, itemCount }` |
| `cloud_sync_last_pull` | JSON | `{ syncId, timestamp, rev }` |
| `cloud_sync_device_id` | UUID string | Stable per-device identifier |
| `cloud_sync_cursor` | String | Dropbox rev string for change detection |
| `cloud_sync_override_backup` | JSON | Pre-pull local snapshot |
| `cloud_vault_idle_timeout` | Number string | Vault idle lock timeout in minutes |
| `cloud_vault_password` | String | Vault password for persistent unlock |
| `cloud_dropbox_account_id` | String | Dropbox account_id for key derivation |
| `cloud_dropbox_email` | String | Dropbox account email for multi-account UX (STAK-449) |
| `cloud_dropbox_display_name` | String | Dropbox display name for multi-account UX (STAK-449) |
| `cloud_sync_mode` | String | DEPRECATED — kept for migration only |
| `cloud_sync_migrated` | String | Cloud folder migration flag — `"v2"` indicates flat-to-subfolder migration complete |
| `cloud_backup_history_depth` | String | Max cloud backups to retain (`"3"`, `"5"`, `"10"`, or `"20"`) |
| `manifestPruningThreshold` | Number string | Max sync cycles retained in manifest before pruning older entries (STAK-184) |

**Cloud backup filename constants** (not localStorage keys — defined in `js/constants.js`, STAK-419):

| Constant | Value | Purpose |
|---|---|---|
| `MANUAL_BACKUP_PREFIX` | `'staktrakr-backup-'` | Filename prefix for user-initiated manual backups |
| `SYNC_BACKUP_PREFIX` | `'pre-sync-'` | Filename prefix for automatic sync pre-push snapshots |

These prefixes are used by `cloudListBackups(provider, type)` to filter backups by type and by `cloudPruneBackups(provider, maxKeep, type)` to ensure auto-pruning only targets sync snapshots (manual backups are never auto-pruned).

**Vault export exclusion list** (not localStorage keys — defined in `js/constants.js`, STAK-425):

| Constant | Value | Purpose |
|---|---|---|
| `VAULT_EXCLUDE_KEYS` | 14-element string array | Keys excluded from portable full-vault exports (`collectVaultData('full')` in `js/vault.js`). Includes OAuth tokens, vault password, and device-specific cloud sync state. These keys remain in `ALLOWED_STORAGE_KEYS` for runtime use but are stripped from `.stvault` files to prevent leaking credentials in portable exports. |

**One-time migrations:**

| Key | Type | Description |
|---|---|---|
| `ff_migration_fuzzy_autocomplete` | Flag | Fuzzy autocomplete migration (v3.26.01) |
| `migration_hourlySource` | Flag | Re-tag StakTrakr hourly entries |

### Feature Flags

Ten feature flags defined in `FEATURE_FLAGS` (`js/constants.js`). All stored as a JSON object under `featureFlags`. All support `urlOverride: true` (URL param override) and most support `userToggle: true` (Settings UI toggle).

| Flag | Default | Phase | Description |
|---|---|---|---|
| `FUZZY_AUTOCOMPLETE` | `true` | stable | Fuzzy search autocomplete for item names and locations |
| `DEBUG_UI` | `false` | dev | Debug UI indicators and development tools |
| `GROUPED_NAME_CHIPS` | `true` | beta | Group item names into combined chips (e.g. "American Silver Eagle (3)") |
| `DYNAMIC_NAME_CHIPS` | `false` | beta | Auto-extract text from parentheses and quotes in item names as filter chips |
| `CHIP_QTY_BADGE` | `true` | stable | Show item count badge on filter chips |
| `NUMISTA_SEARCH_LOOKUP` | `false` | beta | Pattern-based Numista search improvement |
| `COIN_IMAGES` | `true` | beta | Coin image caching and item view modal |
| `MARKET_LIST_VIEW` | `true` | beta | Full-width market card layout with search, sort, inline 7-day trend charts, spike detection, vendor price chips, computed stats, and card click-to-expand |
| `MARKET_DASHBOARD_ITEMS` | `false` | beta | Show goldback and dashboard items in the market list |
| `MARKET_AUTO_RETAIL` | `false` | beta | Auto-update inventory retail prices from linked market data |

## Common Mistakes

**Storing `meltValue` in the item record.**
Never do this. Spot moves constantly; a stored `meltValue` is wrong the moment spot changes. Always derive it at render via `computeMeltValue(item, spotPrices[item.metal])`.

**Adding a new localStorage key without registering it.**
`ALLOWED_STORAGE_KEYS` is enforced by `cleanupStorage()` at startup — not by `saveData`/`saveDataSync` at write time. The write succeeds, but the key is silently deleted on the next startup. The symptom is settings that appear to save but reset on reload. Fix: add the key to the array in `js/constants.js` first.

**Calling `localStorage.setItem` / `getItem` directly.**
Only `saveData` / `saveDataSync` and `loadData` / `loadDataSync` are permitted for structured JSON app data. Direct calls bypass compression and are not portable to future storage backends.

**Assuming `loadData` returns the same type as written.**
`loadData` returns the `defaultValue` argument (default: `[]`) when the key is absent or parse fails. Always pass an explicit default that matches the expected type (e.g., pass `{}` for objects, `[]` for arrays, `null` for nullable scalars).

**Reading spot from the item record.**
There is no `spotPrice` field on the item. Always read from `spotPrices[item.metal]` (defined in `js/state.js`) or the per-metal keys (`spotGold`, `spotSilver`, etc.) via `loadDataSync`.

**Hardcoding a storage quota.**
Do not use a fixed byte limit. As of v3.32.27, quota is derived dynamically from `navigator.storage.estimate()` in `js/image-cache.js`. Use the runtime estimate so the limit scales with the device's actual available storage.

**Re-computing `realizedGainLoss` at render time.**
`realizedGainLoss` is calculated once at disposition time (`amount - price * qty`) and stored in `item.disposition.realizedGainLoss`. Do not re-derive it — the stored value is the authoritative figure. To update it, the user must undo the disposition and re-dispose.

**Filtering without checking `disposition`.**
Active portfolio calculations (totals, weight, melt value) must skip disposed items. The `updateSummary()` function in `js/inventory.js` uses `isDisposed(item)` to partition items into active vs. disposed buckets. If you add a new summary calculation, ensure disposed items are excluded from the active totals and their `realizedGainLoss` is accumulated separately.

**Using `item.price` as per-unit cost.**
`price` is the **total** purchase cost across all units (`price * qty` is NOT correct — `price` already includes all units). To get the per-unit cost, use `item.price / item.qty`.

## Related Pages

- [storage-patterns.md](storage-patterns.md) — `saveData` / `loadData` usage patterns, compression, and the allowlist guard implementation
- [frontend-overview.md](frontend-overview.md) — module load order, `index.html` script sequence, and `sw.js` asset list

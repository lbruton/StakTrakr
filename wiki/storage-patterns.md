---
title: Storage Patterns
category: frontend
owner: staktrakr
lastUpdated: v3.33.59
date: 2026-03-07
sourceFiles:
  - js/utils.js
  - js/constants.js
relatedPages:
  - data-model.md
  - sync-cloud.md
---
# Storage Patterns

> **Last updated:** v3.33.55 — 2026-03-06
> **Source files:** `js/utils.js`, `js/constants.js`

## Overview

StakTrakr persists all application state in `localStorage`. For structured JSON app data, direct calls to `localStorage.setItem` / `localStorage.getItem` are **forbidden** — all reads and writes must go through the wrapper functions `saveData` / `loadData` (async) or `saveDataSync` / `loadDataSync` (sync), defined in `js/utils.js`.

Direct `localStorage` access is permitted only for intentional scalar string cases (e.g., cloud sync cursor, idle timeout keys) where JSON serialization and compression overhead is unnecessary. All other cases must use the wrappers.

The wrappers enforce three invariants:

1. **Allowlist enforcement** — `cleanupStorage()` iterates every key in `localStorage` and deletes anything not listed in `ALLOWED_STORAGE_KEYS` (`js/constants.js`). A key written outside the wrappers still lives in `localStorage`, but it will be silently wiped the next time `cleanupStorage` runs (called at `DOMContentLoaded`).
2. **Transparent compression** — Values longer than 4,096 characters are automatically compressed with LZString (`CMP1:` prefix) via `__compressIfNeeded` on write and decompressed via `__decompressIfNeeded` on read. Bypassing the wrappers breaks this transparently — reads of compressed values will return corrupt data.
3. **Consistent error handling** — Parse errors and `QuotaExceededError` are caught in one place. Callers always receive `defaultValue` rather than an uncaught exception.

---

## Key Rules

These rules apply before touching any storage-related code:

- **Never** call `localStorage.setItem()` or `localStorage.getItem()` directly for structured JSON app data. Intentional scalar string cases (cloud sync cursor, idle timeout keys) are the only permitted exceptions.
- **Never** introduce a new storage key without first adding it to `ALLOWED_STORAGE_KEYS` in `js/constants.js`. Keys written before registration are deleted by `cleanupStorage()` on next startup.
- Prefer `saveData` / `loadData` (async) for all new code. Use `saveDataSync` / `loadDataSync` only where the call site genuinely cannot be made async (e.g., `beforeunload` handlers, initialization code that runs before the event loop is established).
- Define a named constant for every new key in `js/constants.js`. Never hardcode the key string in two places — key name drift causes silent allowlist mismatches.

---

## API Reference

### `saveData(key, data)` — async

```js
const saveData = async (key, data) => {
  try {
    const raw = JSON.stringify(data);
    const out = __compressIfNeeded(raw);
    localStorage.setItem(key, out);
  } catch(e) {
    console.error('saveData failed', e);
  }
};
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | `string` | Must be present in `ALLOWED_STORAGE_KEYS`. |
| `data` | `any` | Any JSON-serializable value. |

**Returns:** `Promise<void>`. Errors are caught internally; no rejection is propagated to the caller. A `console.error` is emitted on failure (e.g. `QuotaExceededError`).

If `key` is not in `ALLOWED_STORAGE_KEYS`, the write still succeeds at the `localStorage` level — there is no runtime guard inside `saveData` itself. The key is removed the next time `cleanupStorage()` runs. Always add the key to the allowlist first.

---

### `loadData(key, defaultValue)` — async

```js
const loadData = async (key, defaultValue = []) => {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return defaultValue;
    const str = __decompressIfNeeded(raw);
    return JSON.parse(str);
  } catch(e) {
    console.warn(`loadData failed for ${key}, returning default:`, e);
    return defaultValue;
  }
};
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `key` | `string` | — | Storage key to read. |
| `defaultValue` | `any` | `[]` | Returned when the key is missing or parsing fails. |

**Returns:** `Promise<any>`. Never rejects. If the key is absent (`null`) the `defaultValue` is returned. If the stored string is corrupt or decompression fails, `defaultValue` is returned and a `console.warn` is emitted.

The default for `defaultValue` is an **empty array** (`[]`). For keys that hold objects, booleans, or strings, always pass an explicit default to avoid type surprises:

```js
// Correct — explicit default for a non-array value
const theme = await loadData(THEME_KEY, 'light');

// Risky — returns [] when key is absent, not null/undefined
const theme = await loadData(THEME_KEY);
```

---

### `saveDataSync(key, data)` — sync

```js
const saveDataSync = (key, data) => {
  try {
    const raw = JSON.stringify(data);
    const out = __compressIfNeeded(raw);
    localStorage.setItem(key, out);
  } catch(e) {
    console.error('saveDataSync failed', e);
    throw e;  // re-throws, unlike the async version
  }
};
```

Identical behavior to `saveData` except it is synchronous and **re-throws** on error. Use only at call sites that cannot be made async. Note: `saveDataSync` is exposed on `window` (STAK-222) for testing and cache utilities.

---

### `loadDataSync(key, defaultValue)` — sync

```js
const loadDataSync = (key, defaultValue = []) => {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return defaultValue;
    const str = __decompressIfNeeded(raw);
    return JSON.parse(str);
  } catch(e) {
    return defaultValue;
  }
};
```

Synchronous equivalent of `loadData`. Same `defaultValue = []` caveat applies. Errors are swallowed silently (no `console.warn`).

---

### `cleanupStorage()` — the allowlist enforcer

```js
const cleanupStorage = () => {
  if (typeof localStorage === 'undefined') return;
  const allowed = new Set(ALLOWED_STORAGE_KEYS);
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!allowed.has(key)) {
      localStorage.removeItem(key);
    }
  }
};
```

Called automatically during app startup (`DOMContentLoaded`). Any key not present in `ALLOWED_STORAGE_KEYS` is permanently deleted. This is the primary mechanism that enforces the allowlist contract. Iterates in reverse to avoid index shifts during deletion.

---

### Compression internals

```js
const __ST_COMP_PREFIX = 'CMP1:';

function __compressIfNeeded(str) {
  if (!str || str.length < 4096) return str;
  const comp = LZString.compressToUTF16(str);
  return __ST_COMP_PREFIX + comp;
}

function __decompressIfNeeded(stored) {
  if (typeof stored !== 'string') return stored;
  if (stored.startsWith(__ST_COMP_PREFIX)) {
    return LZString.decompressFromUTF16(stored.slice(__ST_COMP_PREFIX.length));
  }
  return stored;
}
```

- Compression is applied only when the serialized string exceeds **4,096 characters**.
- Compressed values are prefixed with `CMP1:` so decompression can be applied conditionally on read.
- The current `LZString` implementation is a no-op stub (compressToUTF16/decompressFromUTF16 are identity functions) — the prefix and branching logic are in place for a future real implementation with no API changes required.

---

## Storage Keys Registry

All permitted keys are defined in `ALLOWED_STORAGE_KEYS` in `js/constants.js`. As of v3.33.44 the list contains ~90 entries. Keys are grouped by function:

### Core inventory

| Constant | Key string | Type | Description |
|----------|-----------|------|-------------|
| `LS_KEY` | `metalInventory` | JSON array | All inventory items |
| `SERIAL_KEY` | _(defined in constants)_ | number | Inventory serial counter |
| `ITEM_PRICE_HISTORY_KEY` | _(defined in constants)_ | JSON object | Per-item price history |
| `ITEM_TAGS_KEY` | `itemTags` | JSON object | Per-item tags keyed by UUID |

### Spot and market prices

| Constant | Key string | Type | Description |
|----------|-----------|------|-------------|
| `SPOT_HISTORY_KEY` | _(defined in constants)_ | JSON array | Spot price history |
| — | `spotGold` | number | Current gold spot |
| — | `spotSilver` | number | Current silver spot |
| — | `spotPlatinum` | number | Current platinum spot |
| — | `spotPalladium` | number | Current palladium spot |
| `SPOT_TREND_KEY` | _(defined in constants)_ | string | Trend period: `"1"` \| `"7"` \| `"30"` \| `"90"` \| `"365"` \| `"1095"` |
| `RETAIL_PRICES_KEY` | _(defined in constants)_ | JSON object | Retail price data |
| `RETAIL_PRICE_HISTORY_KEY` | _(defined in constants)_ | JSON object | Retail price history |
| `RETAIL_PROVIDERS_KEY` | _(defined in constants)_ | JSON array | Active retail providers |
| `RETAIL_INTRADAY_KEY` | _(defined in constants)_ | JSON object | Intraday retail data |
| `RETAIL_SYNC_LOG_KEY` | _(defined in constants)_ | JSON array | Retail sync log |
| `RETAIL_AVAILABILITY_KEY` | _(defined in constants)_ | JSON object | OOS detection state |
| `RETAIL_MANIFEST_TS_KEY` | _(defined in constants)_ | string (ISO timestamp) | Market manifest `generated_at` cache |
| `RETAIL_MANIFEST_SLUGS_KEY` | _(defined in constants)_ | JSON array | Cached manifest coin slug list |
| `GOLDBACK_PRICES_KEY` | _(defined in constants)_ | JSON object | Goldback price data |
| `GOLDBACK_PRICE_HISTORY_KEY` | _(defined in constants)_ | JSON object | Goldback price history |
| `API_CACHE_KEY` | _(defined in constants)_ | JSON object | API response cache |
| `LAST_CACHE_REFRESH_KEY` | _(defined in constants)_ | JSON object | Last cache refresh metadata |
| `LAST_API_SYNC_KEY` | _(defined in constants)_ | JSON object | Last API sync metadata |

### UI preferences

| Constant / string | Type | Description |
|-------------------|------|-------------|
| `THEME_KEY` (`appTheme`) | string | `"light"` \| `"dark"` \| `"sepia"` \| `"system"` |
| `DISPLAY_CURRENCY_KEY` | string | Active display currency code |
| `EXCHANGE_RATES_KEY` | JSON object | Exchange rate data |
| `ITEMS_PER_PAGE_KEY` | number string | Pagination rows per page |
| `CARD_STYLE_KEY` | string | `"A"` \| `"B"` \| `"C"` — card view style |
| `DESKTOP_CARD_VIEW_KEY` | boolean string | Desktop card view enabled |
| `DEFAULT_SORT_COL_KEY` | number string | Default sort column index |
| `DEFAULT_SORT_DIR_KEY` | string | `"asc"` \| `"desc"` |
| `SHOW_REALIZED_KEY` | boolean string | Show realized G/L in summary cards |
| `METAL_ORDER_KEY` | JSON array | Metal order/visibility config |
| `SPOT_TREND_RANGE_KEY` | string | Spot trend range selection |
| `SPOT_COMPARE_MODE_KEY` | string | Spot comparison mode |
| `"inlineChipConfig"` | JSON array | Inline chip display config |
| `"filterChipCategoryConfig"` | JSON array | Filter chip category config |
| `"chipSortOrder"` | string | Chip sort order |
| `"chipMinCount"` | number string | Min count for filter chips |
| `"chipMaxCount"` | number string | Max count for filter chips |
| `"chipCustomGroups"` | JSON object | Custom chip groupings |
| `"chipBlacklist"` | JSON array | Chips excluded from display |
| `"layoutSectionConfig"` | JSON array | Ordered layout section config |
| `"viewModalSectionConfig"` | JSON array | View modal section visibility |
| `"tableImagesEnabled"` | boolean string | Show thumbnail images in table |
| `"tableImageSides"` | string | `"both"` \| `"obverse"` \| `"reverse"` |
| `"headerThemeBtnVisible"` | boolean string | Theme button visibility |
| `"headerCurrencyBtnVisible"` | boolean string | Currency button visibility |
| `"headerAboutBtnVisible"` | boolean string | About button visibility |
| `"headerBtnOrder"` | JSON array | Header button card order |
| `HEADER_TREND_BTN_KEY` | boolean string | Header trend button visibility |
| `HEADER_SYNC_BTN_KEY` | boolean string | Header sync button visibility |
| `HEADER_MARKET_BTN_KEY` | boolean string | Header market button visibility |
| `HEADER_VAULT_BTN_KEY` | boolean string | Vault button visibility |
| `HEADER_RESTORE_BTN_KEY` | boolean string | Restore button visibility |
| `HEADER_CLOUD_SYNC_BTN_KEY` | boolean string | Cloud sync button visibility |
| `HEADER_BTN_SHOW_TEXT_KEY` | boolean string | Show text labels under header icons |
| `TIMEZONE_KEY` | string | `"auto"` \| `"UTC"` \| IANA zone |

### Cloud sync and vault

| Key string | Type | Description |
|-----------|------|-------------|
| `"cloud_token_dropbox"` | JSON | Dropbox OAuth token data |
| `"cloud_token_pcloud"` | JSON | pCloud OAuth token data |
| `"cloud_token_box"` | JSON | Box OAuth token data |
| `"cloud_last_backup"` | JSON | `{ provider, timestamp }` last cloud backup — only written by sync operations (manual backups with `skipLatestUpdate` skip this key) |
| `"cloud_activity_log"` | JSON array | Cloud sync activity log |
| `"cloud_sync_enabled"` | boolean string | Master auto-sync toggle |
| `"cloud_sync_last_push"` | JSON | `{ syncId, timestamp, rev, itemCount }` |
| `"cloud_sync_last_pull"` | JSON | `{ syncId, timestamp, rev }` |
| `"cloud_sync_device_id"` | UUID string | Stable per-device identifier |
| `"cloud_sync_cursor"` | string | Dropbox rev string for change detection |
| `"cloud_sync_override_backup"` | JSON | Pre-pull local snapshot |
| `"cloud_dropbox_account_id"` | string | Dropbox account_id for key derivation |
| `"cloud_dropbox_email"` | string | Dropbox account email for multi-account UX (STAK-449) |
| `"cloud_dropbox_display_name"` | string | Dropbox display name for multi-account UX (STAK-449) |
| `"cloud_vault_password"` | string | Vault password for persistent unlock |
| `CLOUD_VAULT_IDLE_TIMEOUT_KEY` | number string | Vault idle lock timeout in minutes |
| `"cloud_backup_history_depth"` | string | Max cloud backups to retain |
| `"cloud_kraken_seen"` | boolean string | Easter egg flag |
| `"staktrakr_oauth_result"` | JSON | Transient OAuth callback relay |
| `"cloud_sync_mode"` | — | DEPRECATED — kept for migration only, removal planned after v3.33 |
| `"cloud_sync_migrated"` | string | Cloud folder migration flag |
| `"manifestPruningThreshold"` | number string | Max sync cycles before pruning |
| `STORAGE_PERSIST_GRANTED_KEY` | boolean string | Storage persistence grant flag |

### Catalog and lookup caches

| Key string | Type | Description |
|-----------|------|-------------|
| `CATALOG_MAP_KEY` | JSON object | Catalog provider mapping |
| `CATALOG_HISTORY_KEY` (`staktrakr.catalog.history`) | JSON array | Catalog lookup history |
| `"catalog_api_config"` | JSON object | Catalog API configuration |
| `"staktrakr.catalog.cache"` | JSON object | Catalog response cache |
| `"staktrakr.catalog.settings"` | JSON object | Catalog settings |
| `"autocomplete_lookup_cache"` | JSON object | Autocomplete lookup cache |
| `"autocomplete_cache_timestamp"` | string | Autocomplete cache timestamp |
| `NUMISTA_RESPONSE_CACHE_KEY` | JSON object | Numista API response cache |
| `PCGS_RESPONSE_CACHE_KEY` | JSON object | PCGS API response cache |
| `"numistaLookupRules"` | JSON array | Custom Numista search rules |
| `"numistaViewFields"` | JSON object | Numista field visibility config |
| `"numista_tags_auto"` | boolean string | Auto-tag from Numista data |
| `"enabledSeedRules"` | JSON array | Enabled built-in lookup rule IDs |
| `"seedImagesVer"` | string | Seed images version for cache invalidation |
| `"tagBlacklist"` | JSON array | Tags excluded from auto-tagging |

### Feature flags and version

| Constant | Key string | Type | Description |
|----------|-----------|------|-------------|
| `FEATURE_FLAGS_KEY` | _(defined in constants)_ | JSON object | All feature flag states |
| `GOLDBACK_ENABLED_KEY` | _(defined in constants)_ | boolean string | Goldback feature enabled |
| `GOLDBACK_ESTIMATE_ENABLED_KEY` | _(defined in constants)_ | boolean string | Goldback estimate enabled |
| `GB_ESTIMATE_MODIFIER_KEY` | _(defined in constants)_ | number string | Goldback estimate modifier |
| `API_KEY_STORAGE_KEY` | _(defined in constants)_ | string | Third-party API key |
| `APP_VERSION_KEY` | _(defined in constants)_ | string | Current app version |
| `VERSION_ACK_KEY` | _(defined in constants)_ | string | Acknowledged version |
| `LAST_VERSION_CHECK_KEY` | _(defined in constants)_ | string | Timestamp of last remote version check |
| `LATEST_REMOTE_VERSION_KEY` | _(defined in constants)_ | string | Cached latest remote version |
| `LATEST_REMOTE_URL_KEY` | _(defined in constants)_ | string | Cached latest remote release URL |
| `ACK_DISMISSED_KEY` | _(defined in constants)_ | string | Acknowledgment dismissal state |
| `"changeLog"` | _(raw string)_ | JSON | Changelog data |
| `"chipMinCount"` | _(raw string)_ | number string | Minimum chip count |
| `"chipMaxCount"` | _(raw string)_ | number string | Maximum chip count |
| `"apiProviderOrder"` | _(raw string)_ | JSON array | API provider display order |
| `"providerPriority"` | _(raw string)_ | JSON object | Provider priority weighting |
| `"staktrakr.debug"` | _(raw string)_ | boolean string | Debug mode (staktrakr.com) |
| `"stackrtrackr.debug"` | _(raw string)_ | boolean string | Debug mode (stackrtrackr.com) |

### One-time migration flags

| Key string | Description |
|-----------|-------------|
| `"ff_migration_fuzzy_autocomplete"` | Re-enable FUZZY_AUTOCOMPLETE for users who had it disabled (v3.26.01) |
| `"migration_hourlySource"` | Re-tag StakTrakr hourly entries with correct source |

---

## Cloud Sync Integration

A subset of storage keys participate in cloud sync. These are defined in `SYNC_SCOPE_KEYS` in `js/constants.js`:

```js
const SYNC_SCOPE_KEYS = [
  'metalInventory',          // LS_KEY — inventory items
  'itemTags',                // ITEM_TAGS_KEY — per-item tags
  'displayCurrency',         // DISPLAY_CURRENCY_KEY — active display currency
  'appTheme',                // THEME_KEY — light/dark/sepia/system theme
  'inlineChipConfig',        // inline chip display config
  'filterChipCategoryConfig',// filter chip category config
  'viewModalSectionConfig',  // view modal section visibility
  'chipMinCount',            // minimum count for filter chips
];
```

Only inventory data and display preferences meaningful across devices are included. API keys, OAuth tokens, spot history, and device-specific state are excluded from sync.

**Triggering a sync push after a write:** Features that modify sync-scoped data should call `scheduleSyncPush()` after saving. Example from `saveDisplayCurrency`:

```js
const saveDisplayCurrency = (code) => {
  displayCurrency = code;
  saveDataSync(DISPLAY_CURRENCY_KEY, code);
  if (typeof scheduleSyncPush === 'function') scheduleSyncPush();
};
```

Check that `scheduleSyncPush` is a function before calling — it is defined in `cloud-sync.js` and may not be loaded in all environments.

See [sync-cloud.md](sync-cloud.md) for the full cloud sync architecture.

### Vault Export Exclusions (STAK-425, v3.33.46)

`VAULT_EXCLUDE_KEYS` in `js/constants.js` lists 16 keys that are stripped from portable full-vault exports (`collectVaultData('full')` in `js/vault.js`). These keys remain in `ALLOWED_STORAGE_KEYS` (so `cleanupStorage` does not delete them) but are excluded from `.stvault` exports to prevent shipping live OAuth tokens, vault passwords, and device-specific sync state:

```js
const VAULT_EXCLUDE_KEYS = [
  'cloud_token_dropbox',
  'cloud_token_pcloud',
  'cloud_token_box',
  'cloud_dropbox_account_id',
  'cloud_dropbox_email',
  'cloud_dropbox_display_name',
  'cloud_vault_password',
  'cloud_sync_device_id',
  'cloud_sync_cursor',
  'cloud_sync_last_push',
  'cloud_sync_last_pull',
  'cloud_sync_override_backup',
  'cloud_sync_mode',
  'cloud_sync_local_modified',
  'cloud_sync_migrated',
  'staktrakr_oauth_result',
];
```

Sync-scoped exports (`collectVaultData('sync')`) are unaffected -- they use `SYNC_SCOPE_KEYS` which already excludes these keys.

---

## How to Add a New Storage Key

1. **Define a constant** in `js/constants.js`:

   ```js
   const MY_NEW_SETTING_KEY = 'myNewSetting';
   ```

2. **Add it to `ALLOWED_STORAGE_KEYS`** in the same file, with a comment describing the type and purpose:

   ```js
   const ALLOWED_STORAGE_KEYS = [
     // ... existing keys ...
     MY_NEW_SETTING_KEY, // string: description of what this stores
   ];
   ```

3. **Expose the constant** if it needs to be accessed from other files (add inside the `window` assignment block at the bottom of `constants.js`):

   ```js
   window.MY_NEW_SETTING_KEY = MY_NEW_SETTING_KEY;
   ```

4. **Use the wrappers** in your feature code:

   ```js
   // Write
   await saveData(MY_NEW_SETTING_KEY, value);

   // Read (always pass an explicit default for non-array values)
   const value = await loadData(MY_NEW_SETTING_KEY, 'default');
   ```

Do not use the key anywhere before step 2 is complete — `cleanupStorage()` will delete it on next startup.

---

## Migration Pattern — Renaming a Key

When a key must be renamed (e.g., to fix a typo or consolidate settings):

```js
// 1. Read the old value
const oldValue = await loadData('oldKeyName', null);

// 2. If present, migrate to the new key
if (oldValue !== null) {
  await saveData(NEW_KEY, oldValue);
  localStorage.removeItem('oldKeyName'); // direct remove is OK for cleanup
}

// 3. Keep 'oldKeyName' in ALLOWED_STORAGE_KEYS until the migration
//    flag is confirmed written, then remove it in the next release.
```

Add a one-time migration flag so the migration runs only once:

```js
const MIGRATION_FLAG = 'migration_myKeyRename';
// Also add MIGRATION_FLAG to ALLOWED_STORAGE_KEYS

if (!loadDataSync(MIGRATION_FLAG, false)) {
  // ... migration logic ...
  saveDataSync(MIGRATION_FLAG, true);
}
```

Existing migration flags in the codebase follow the `migration_` prefix convention (e.g., `migration_hourlySource`, `ff_migration_fuzzy_autocomplete`).

---

## Common Mistakes

| Mistake | Consequence | Fix |
|---------|-------------|-----|
| `localStorage.setItem('myKey', JSON.stringify(val))` | Bypasses compression; key deleted by `cleanupStorage` if not in allowlist | Use `saveData` / `saveDataSync` |
| `JSON.parse(localStorage.getItem('myKey'))` | Bypasses decompression; crashes on compressed (`CMP1:`) values | Use `loadData` / `loadDataSync` |
| Omitting explicit `defaultValue` for non-array keys | Caller receives `[]` instead of `null` / `false` / `''` | Always pass the correct default |
| Writing a new key before adding it to `ALLOWED_STORAGE_KEYS` | Value is silently deleted on next `cleanupStorage` run | Add to allowlist first |
| Using `saveDataSync` in async code paths | Works but re-throws on error, unlike the async version which only logs | Prefer `saveData` for async code |
| Hardcoding a key string in two places | Key name drift and allowlist mismatches | Define a constant in `constants.js`, reference the constant everywhere |
| Modifying sync-scoped data without calling `scheduleSyncPush` | Cloud sync not triggered; remote copy goes stale | Call `scheduleSyncPush()` after writes to `SYNC_SCOPE_KEYS` data |
| Adding a key to `SYNC_SCOPE_KEYS` without adding it to `ALLOWED_STORAGE_KEYS` | Key survives sync but gets wiped by `cleanupStorage` | Both lists must be updated together |

---

## Related Pages

- [data-model.md](data-model.md) — shape of the inventory objects stored under `LS_KEY`
- [sync-cloud.md](sync-cloud.md) — cloud sync architecture, `SYNC_SCOPE_KEYS`, push/pull lifecycle

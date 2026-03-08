---
title: Backup & Restore
category: frontend
owner: staktrakr
lastUpdated: v3.33.59
date: 2026-03-07
sourceFiles:
  - js/cloud-storage.js
  - js/cloud-sync.js
  - js/utils.js
  - js/vault.js
relatedPages:
  - sync-cloud.md
  - storage-patterns.md
---
# Backup & Restore

> **Last updated:** v3.33.58 — 2026-03-07
> **Source files:** `js/cloud-storage.js`, `js/cloud-sync.js`, `js/utils.js`, `js/vault.js`

## Overview

StakTrakr has **4 backup/restore mechanisms**. Each covers a different slice of application data — no single mechanism backs up everything. Full recovery requires combining mechanisms (typically ZIP + vault, or vault + image vault).

There is no dedicated `backup.js` or `restore.js`. All backup and restore logic lives in:

- `js/cloud-storage.js` — OAuth token management, manual cloud backup upload/download/delete, vault upload to Dropbox/pCloud/Box, conflict detection, activity logging
- `js/cloud-sync.js` — Auto-sync push/pull, override backup snapshots, password management, multi-tab coordination, manifest building
- `js/inventory.js` — ZIP backup creation and restore (`createBackupZip`, `restoreBackupZip`)
- `js/vault.js` — AES-256-GCM encryption/decryption for vault and image vault files

| Mechanism | Format | Encrypted | Trigger |
|-----------|--------|-----------|---------|
| ZIP Backup | `.zip` | No | Settings → "Backup All Data" button |
| Encrypted Vault | `.stvault` | Yes (AES-256-GCM) | Settings → Vault → "Export Vault" |
| Image Vault | `.stvault` | Yes (AES-256-GCM) | Cloud auto-sync (automatic) |
| Cloud Sync | Dropbox | Yes (vault-wrapped) | Settings → Cloud → Auto-sync toggle |

---

## Snapshot Terminology

| Term | Description |
|------|-------------|
| **Override backup** | Pre-pull localStorage snapshot saved before applying remote changes. Used for rollback if a pull goes wrong. Stored in IDB as `cloud_sync_override_backup`. |
| **Pre-push backup** | Full encrypted vault uploaded to `/backups/pre-sync-TIMESTAMP.stvault` before each push. Provides disaster recovery if a push corrupts remote state. |
| **Image vault** | Companion file to the sync vault containing user-uploaded coin photos (`userImages` IDB). Uploaded alongside inventory during auto-sync push (conditional). |
| **Manual vault** | Encrypted backup created on-demand from the Settings → Cloud → Backup button. Covers all localStorage keys except credentials. Optional "Include photos" checkbox uploads the image vault alongside the manual backup (STAK-427). |

---

## Key Rules

- **Full recovery requires two steps.** Vault alone restores localStorage only. User-uploaded photo blobs live in IndexedDB (IDB) and need a ZIP restore or image vault restore separately.
- **CDN image URLs survive a vault restore.** Numista-enriched images (`obverseImageUrl`, `reverseImageUrl`) are stored on the inventory items in localStorage, so they come back immediately with any vault or ZIP restore. Only user-uploaded blobs need IDB restore.
- **`coinImages` IDB store is legacy — never touch it.** The schema is retained to avoid a forced migration but is never read or written. ZIP restore explicitly skips this folder.
- **`SYNC_SCOPE_KEYS`** intentionally excludes API keys, OAuth tokens, and spot history. Cloud sync is scoped to inventory + display prefs.
- When modifying restore logic, always verify the post-restore call sequence: `loadInventory()` → `renderTable()` → `renderActiveFilters()` → `loadSpotHistory()`.
- **All imports go through `buildImportValidationResult()` before DiffModal opens.** Items that fail validation are surfaced as a pre-validation warning toast and excluded from the DiffModal. If all items are invalid, the import is aborted with an error toast.
- **All exports embed `exportOrigin` (`window.location.origin`).** On import, if the file's `exportOrigin` differs from the current domain, a cross-domain warning toast is shown before the DiffModal opens. This is informational only and never blocks the import.
- **DiffModal shows a live count header** (Backup / Current / After import) and a warning when the projected count is less than the backup count.
- **A toast notification appears after every import** showing added / updated / removed / skipped counts. The former persistent `showImportSummaryBanner()` was removed in v3.33.58 — all post-import feedback now uses the standard toast system.

---

## Architecture

### cloud-storage.js Role

`cloud-storage.js` handles the **OAuth layer and manual vault operations**:

- OAuth PKCE flow for Dropbox, pCloud, and Box (`cloudAuthStart`, `cloudExchangeCode`)
- Token storage, refresh, and expiry management (`cloudGetToken`, `cloudStoreToken`, `cloudClearToken`)
- Manual vault upload to cloud provider (`cloudUploadVault`) — writes a versioned `.stvault` file and a `staktrakr-latest.json` pointer
- Cloud backup listing (`cloudListBackups`), download by name (`cloudDownloadVaultByName`), and deletion (`cloudDeleteBackup`)
- Conflict detection via `cloudCheckConflict()` comparing remote `latest.json` timestamp against `cloud_last_backup` in localStorage
- Cloud activity log: all transactions recorded to `cloud_activity_log` (capped at 500 entries, max 180 days)
- UI state management via `syncCloudUI()`
- OAuth state validation in the localStorage relay path (`cloudCheckOAuthRelay`) — rejects relayed OAuth codes whose `state` does not match `cloud_oauth_state` in `sessionStorage`, guarding against CSRF

**Manual cloud backup flow (updated STAK-419, v3.33.41):**

1. User clicks "Backup" → vault modal opens (always prompts for password; no cached password reuse for manual backups)
2. `vaultEncryptToBytes(password)` encrypts all `ALLOWED_STORAGE_KEYS` into a binary `.stvault`
3. `cloudUploadVault(provider, fileBytes, { skipLatestUpdate: true })` uploads the vault as `staktrakr-backup-YYYYMMDD-HHmmss.stvault` to the `/backups/` subfolder
4. `staktrakr-latest.json` pointer is NOT updated (manual backups do not affect sync state)
5. `cloud_last_backup` is NOT written (manual backups are independent of sync tracking)
6. Password is NOT cached to `sessionStorage` (each manual backup requires re-entry)

> **Photos optional (STAK-427):** When the `userImages` IDB store has entries, the vault modal shows an "Include photos" checkbox. If checked, `collectAndHashImageVault()` + `vaultEncryptImageVault()` uploads the image vault to `/StakTrakr/sync/staktrakr-images.stvault` after the inventory vault succeeds. Image upload failure shows a warning toast but does not fail the overall backup. Without checking this box, user-uploaded coin photos (`userImages`), pattern rule images (`patternImages`), and Numista metadata (`coinMetadata`) are NOT included — use ZIP backup for full coverage.

### cloud-sync.js Role

`cloud-sync.js` handles **automatic background sync** (auto-sync mode):

- Debounced push on inventory change via `scheduleSyncPush` (debounced `pushSyncVault`)
- Leader election across multiple open tabs via `BroadcastChannel` — only one tab syncs at a time
- Pre-pull local snapshot via `syncSaveOverrideBackup()` (rollback-only backup, enables "Restore Override Backup" button)
- Post-push cloud-side backup-before-overwrite: copies existing cloud vault to `/StakTrakr/backups/pre-sync-TIMESTAMP.stvault` before overwriting
- Sync manifest building and encrypted upload (`buildAndUploadManifest`) for diff-merge support
- Multi-tab coordination via `BroadcastChannel('staktrakr-sync')` — push/pull events broadcast to all tabs
- Password management (`getSyncPassword`, `getSyncPasswordSilent`, `changeVaultPassword`)
- Empty-vault push guard: blocks push when local is empty but remote has items
- All user confirmation dialogs use `await appConfirm()` — no `window.confirm` calls

**Remote change flow (STAK-413):**

All remote changes (both sync updates and conflicts) flow directly into `handleRemoteChange()`, which routes to `pullWithPreview()` showing the DiffModal. The former intermediate dialogs `showSyncUpdateModal()` and `showSyncConflictModal()` have been removed — DiffModal is the sole review UI.

`_syncRemoteChangeActive` is managed exclusively by `handleRemoteChange()` via `try/finally`, guaranteeing the flag is always cleared even if `pullWithPreview()` throws.

**Auto-sync file layout on Dropbox:**

| File | Path | Contents |
|------|------|----------|
| Inventory vault | `/StakTrakr/sync/staktrakr-sync.stvault` | Sync-scoped vault (inventory + display prefs) |
| Image vault | `/StakTrakr/sync/staktrakr-images.stvault` | `userImages` IDB blobs (base64) |
| Metadata pointer | `/StakTrakr/sync/staktrakr-sync.json` | `rev`, `itemCount`, `syncId`, `deviceId`, `imageVault` hash |
| Manifest | `/StakTrakr/sync/staktrakr-manifest.stvault` | Encrypted field-level change log for diff-merge |
| Pre-push backups | `/StakTrakr/backups/pre-sync-TIMESTAMP.stvault` | Auto-backups before each vault overwrite (prefix: `SYNC_BACKUP_PREFIX`) |
| Manual backups | `/StakTrakr/backups/staktrakr-backup-YYYYMMDD-HHmmss.stvault` | User-initiated vault backups (prefix: `MANUAL_BACKUP_PREFIX`) |

> **Legacy paths:** Flat-root paths (`/StakTrakr/staktrakr-sync.*`) are retained as `*_LEGACY` constants in `js/constants.js` for migration only. Active sync uses `/StakTrakr/sync/`. Migration runs once on first push (`cloudMigrateToV2`).
>
> **Backup isolation (STAK-419, v3.33.41):** Manual backups and sync snapshots share the `/StakTrakr/backups/` folder but are distinguished by filename prefix. `cloudListBackups(provider, type)` filters by prefix; `cloudPruneBackups` defaults to pruning only sync snapshots. Manual backups are never automatically deleted.

### utils.js Role

`js/utils.js` provides the import validation pipeline shared across all import paths:

- `buildImportValidationResult(items, skippedNonPM)` — batch validation before DiffModal

- `saveData(key, value)` / `loadData(key)` — all localStorage reads/writes go through these (never direct `localStorage.setItem`)
- `sanitizeImportedItem(item)` — sanitizes raw imported item before validation

---

## Export Format

### JSON Export (inventory items only)

`exportJson()` in `js/inventory.js` wraps the item array in an envelope object:

```json
{
  "items": [ /* inventory items */ ],
  "exportMeta": {
    "exportOrigin": "https://www.staktrakr.com",
    "exportDate": "2026-03-02T00:00:00.000Z",
    "version": "3.33.25",
    "itemCount": 47
  }
}
```

`importJson` handles both the new wrapped format and the legacy plain array format. Old files still import correctly.

### ZIP Backup (full, non-encrypted)

**Output filename:** `precious_metals_backup_YYYYMMDD.zip`

| File in ZIP | Contents | Storage restored to |
|-------------|----------|---------------------|
| `inventory_data.json` | Full inventory array (includes CDN URLs: `obverseImageUrl`, `reverseImageUrl`) | localStorage (`LS_KEY`) |
| `settings.json` | Theme, catalog mappings, feature flags, chip config, table settings, `exportOrigin` | localStorage (multiple keys) |
| `spot_price_history.json` | Historical spot prices | localStorage (`SPOT_HISTORY_KEY`) |
| `item_price_history.json` | Per-item price history | Merged via `mergeItemPriceHistory()` |
| `item_tags.json` | Item tags | localStorage |
| `retail_prices.json` | Retail price data | localStorage |
| `retail_price_history.json` | Retail price history | localStorage |
| `image_metadata.json` | Numista enrichment metadata | IDB `coinMetadata` store |
| `user_images/` | User-uploaded photo blobs (obverse/reverse per UUID) | IDB `userImages` store |
| `user_image_manifest.json` | UUID→filename mapping | Used during restore |
| `pattern_images/` | Pattern rule image blobs | IDB `patternImages` store |
| `inventory_export.csv` | Human-readable CSV (includes Tags and Storage Location columns as of v3.33.44) | Not restored (report only) |
| `inventory_report.html` | HTML report | Not restored (report only) |

What is NOT included: `coinImages` IDB store (legacy/dead, explicitly skipped), API keys, OAuth tokens, cloud sync state.

### Encrypted Vault (.stvault — full scope)

**Crypto:** AES-256-GCM, PBKDF2 (600K iterations), 56-byte binary header

**Full scope** (`vaultEncryptToBytes`) includes all `ALLOWED_STORAGE_KEYS` (~80+ keys) **minus `VAULT_EXCLUDE_KEYS`** (STAK-425, v3.33.46):

- Inventory items with CDN URLs
- Spot history, theme, all settings

**Excluded from full exports** (14 keys in `VAULT_EXCLUDE_KEYS`): OAuth tokens (`cloud_token_dropbox`, `cloud_token_pcloud`, `cloud_token_box`), `cloud_dropbox_account_id`, `cloud_vault_password`, `cloud_sync_device_id`, `cloud_sync_cursor`, `cloud_sync_last_push`, `cloud_sync_last_pull`, `cloud_sync_override_backup`, `cloud_sync_mode`, `cloud_sync_local_modified`, `cloud_sync_migrated`, `staktrakr_oauth_result`. These are device-specific credentials and sync state that should not be included in portable exports.

Does NOT include: `userImages`, `patternImages`, or `coinMetadata` IDB blobs.

### Sync-Scoped Vault (.stvault — sync scope)

**Sync scope** (`vaultEncryptToBytesScoped`) includes only `SYNC_SCOPE_KEYS`:

- `metalInventory`, `itemTags`, display preferences, `chipMinCount`

Intentionally excludes: API keys, OAuth tokens, spot price history.

### Image Vault (.stvault — images only)

Built by `collectAndHashImageVault()` → encrypted by `vaultEncryptImageVault()`.

**Payload shape:**

```json
{
  "_meta": {
    "appVersion": "3.33.25",
    "exportTimestamp": "2026-03-02T...",
    "imageCount": 42
  },
  "records": [
    {
      "uuid": "abc123",
      "obverse": "<base64>",
      "reverse": "<base64>",
      "cachedAt": "...",
      "size": 12345
    }
  ]
}
```

**Hash tracking:** `simpleHash(uuid + ':' + size + ':' + obverse.slice(0, 32))` — detects content changes even when file size is identical.

### Export Origin Metadata

All export formats embed `exportOrigin` (`window.location.origin`) for cross-domain detection:

| Format | Where stored |
|--------|-------------|
| JSON (`exportJson`) | `exportMeta.exportOrigin` in the wrapper object |
| ZIP (`createBackupZip`) | `exportOrigin` field in `settings.json` |
| Vault (`collectVaultData`) | `_meta.exportOrigin` in the vault payload |
| CSV (`exportCsv`) | Comment line at top: `# exportOrigin: https://...` |

Old exports without `exportOrigin` import silently with no warning.

### Export Format UI Labels

The backup/export panel shows a `<small class="format-desc">` beneath each option:

| Format | Description label |
|--------|------------------|
| CSV | "Inventory items only — spreadsheet compatible" |
| JSON | "Inventory items only — no settings or price history" |
| HTML report | "Inventory items only — printable report" |
| ZIP | "Full backup — inventory, settings, price history, and images" |
| .stvault | "Encrypted full backup — inventory, settings, price history, and images" |

---

## Import/Restore Flow

### JSON Import (`importJson`)

1. Parse file: detect new wrapped format (`{ items, exportMeta }`) vs legacy plain array
2. Check `exportMeta.exportOrigin` — show cross-domain warning toast if origin differs
3. Sanitize each item via `sanitizeImportedItem()`
4. Run `buildImportValidationResult(items, skippedNonPM)` — filter invalid items
5. If all invalid: abort with error toast
6. If some invalid: show warning toast, proceed with valid items only
7. Open `DiffModal` with `backupCount` and `localCount` for live count header
8. On apply: merge items, call post-restore sequence, show import summary toast

### ZIP Restore (`restoreBackupZip`)

> **Destructive restore:** ZIP restore replaces all data — all localStorage keys are overwritten with backup values, and all IDB image stores (`userImages`, `patternImages`, `coinMetadata`) are replaced. There is no merge option. If cloud sync is active when you initiate a ZIP restore, the restore will be blocked until sync completes (STAK-427).

1. Unzip all files
2. Restore localStorage keys from `inventory_data.json`, `settings.json`, `spot_price_history.json`, etc.
3. Restore `userImages` IDB from `user_images/` using `user_image_manifest.json`; falls back to filename parsing for old ZIPs pre-STAK-226
4. Restore `patternImages` IDB from `pattern_images/`
5. Restore `coinMetadata` IDB from `image_metadata.json`
6. Explicitly skip `coinImages/` folder (logs: `"skipping legacy coinImages folder (store deprecated)"`)
7. Post-restore sequence: `loadInventory()` → `renderTable()` → `renderActiveFilters()` → `loadSpotHistory()`

### Vault Restore (`vaultDecryptAndRestore`)

1. Read 56-byte binary header to extract salt, IV, and version
2. Derive key via PBKDF2 (600K iterations, SHA-256)
3. Decrypt AES-256-GCM payload
4. Parse JSON and write all scoped localStorage keys
5. Check `_meta.exportOrigin` — show cross-domain warning if origin differs
6. Post-restore sequence: `loadInventory()` → `renderTable()` → `renderActiveFilters()` → `loadSpotHistory()`

Image blobs are NOT restored via vault — requires a separate ZIP or image vault restore.

### Image Vault Restore (`vaultDecryptAndRestoreImages` → `restoreImageVaultData`)

1. Decrypt image vault `.stvault` using same AES-256-GCM scheme
2. Parse records array
3. Decode each base64 blob back to a `Blob` object
4. Write each record to `userImages` IDB via `imageCache.importUserImageRecord()`

### Auto-Sync Pull (`pullSyncVault` in `cloud-sync.js`)

1. Guard: `cloud_dropbox_account_id` must be present — if missing, a toast is shown and the pull aborts before any network call
2. `syncSaveOverrideBackup()` — snapshot all `SYNC_SCOPE_KEYS` to `cloud_sync_override_backup` in localStorage (rollback-only backup)
3. Download inventory vault from `/StakTrakr/sync/staktrakr-sync.stvault`
4. `vaultDecryptAndRestore(fileBytes, password)` — decrypt and write sync-scoped localStorage keys
5. Check remote `staktrakr-sync.json` `imageVault.hash` vs last pull hash
6. If image hash changed: download image vault → `vaultDecryptAndRestoreImages()`
7. Post-restore sequence: `loadInventory()` → `renderTable()` → `renderActiveFilters()` → `loadSpotHistory()`

### Auto-Sync Push (`pushSyncVault` in `cloud-sync.js`)

1. Empty-vault guard: if local inventory is empty and remote has items, block push and prompt to pull instead
2. Migration check: run `cloudMigrateToV2()` if not yet migrated (once per device)
3. `vaultEncryptToBytesScoped(password)` — encrypt sync-scope vault
4. Cloud-side backup-before-overwrite: copy existing cloud vault to `/StakTrakr/backups/pre-sync-TIMESTAMP.stvault` (non-blocking; uses `SYNC_BACKUP_PREFIX`)
5. Upload inventory vault to `/StakTrakr/sync/staktrakr-sync.stvault` (overwrite)
6. `collectAndHashImageVault()` — compute image hash; if changed, encrypt and upload image vault (non-fatal on failure)
7. Upload `staktrakr-sync.json` metadata pointer (`rev`, `itemCount`, `syncId`, `deviceId`, `imageVault`)
8. `buildAndUploadManifest()` — encrypt and upload field-level change log for diff-merge (non-blocking)

---

## Key Functions

### cloud-storage.js

| Function | Signature | Purpose |
|----------|-----------|---------|
| `cloudUploadVault` | `async (provider, fileBytes, opts?)` | Upload a pre-built `.stvault` to cloud; writes versioned file + `latest.json` pointer (unless `opts.skipLatestUpdate` is true — used for manual backups). All 4 provider upload responses (Dropbox vault, Dropbox latest pointer, pCloud, Box) are validated via `.ok` check and throw on failure (STAK-425). |
| `cloudDownloadVaultByName` | `async (provider, filename)` | Download a named `.stvault` from cloud; returns `Uint8Array` |
| `cloudDownloadVault` | `async (provider)` | Download the latest vault (reads `latest.json` pointer first, falls back to newest in folder) |
| `cloudListBackups` | `async (provider, type?)` | List `.stvault` files in the cloud backups folder; paginates via `files/list_folder/continue` when Dropbox returns `has_more` (STAK-425). Optional `type` filters by prefix: `'manual'`, `'sync'`, or `undefined` (all). Returns array sorted newest-first |
| `cloudDeleteBackup` | `async (provider, filename)` | Delete a named vault file. If the deleted file was the `cloud_last_backup` pointer target, updates remote `staktrakr-latest.json` to point to the next most recent backup, or deletes the pointer if no backups remain (STAK-425). |
| `cloudCheckConflict` | `async (provider)` | Compare remote `latest.json` timestamp vs `cloud_last_backup`; returns conflict info object |
| `cloudCheckOAuthRelay` | `()` | Reads `staktrakr_oauth_result` from localStorage (relay path when popup loses `window.opener`); validates `state` against `sessionStorage` before calling `cloudExchangeCode`. Rejects with a warning on state mismatch (CSRF guard). |
| `cloudGetToken` | `async (provider)` | Get OAuth access token; auto-refreshes if expired; clears token on refresh failure |
| `cloudIsConnected` | `(provider)` | Returns `true` if a stored token exists for the provider |
| `cloudAuthStart` | `(provider)` | Opens OAuth popup; initiates PKCE flow for Dropbox |
| `cloudExchangeCode` | `async (code, state)` | Exchanges OAuth auth code for access token; stores in localStorage |
| `cloudPruneBackups` | `async (provider, maxKeep, type?)` | Prune old backups, keeping newest `maxKeep`. Defaults to `type='sync'` — manual backups are never auto-pruned |
| `cloudDisconnect` | `(provider)` | Full disconnect: clears token + all 13 cloud state keys; cancels pending `scheduleSyncPush` debounce (STAK-425) |
| `recordCloudActivity` | `(entry)` | Appends to `cloud_activity_log` (max 500 entries, 180-day rolling window) |
| `syncCloudUI` | `()` | Refreshes cloud card UI state (connected badge, backup status, button states) |

### cloud-sync.js

| Function | Signature | Purpose |
|----------|-----------|---------|
| `pushSyncVault` | `async ()` | Encrypt and push sync-scoped vault to Dropbox; includes empty-vault guard, image vault, and manifest |
| `handleRemoteChange` | `async (remoteMeta)` | Entry point for all remote change events (both sync updates and conflicts). Sets `_syncRemoteChangeActive = true`, cancels any queued push, then calls `pullWithPreview()`. Uses `try/finally` to guarantee `_syncRemoteChangeActive` is cleared on exit, including on error. |
| `pullWithPreview` | `async (remoteMeta)` | Primary pull path. Shows DiffModal (manifest-first or vault-first) and awaits user action (Apply or Cancel) before returning. Runs within `handleRemoteChange`'s `_syncRemoteChangeActive` scope, blocking concurrent pushes while the user reviews the diff. |
| `syncSaveOverrideBackup` | `()` | Snapshot all `SYNC_SCOPE_KEYS` raw strings to `cloud_sync_override_backup` |
| `syncRestoreOverrideBackup` | `async ()` | Restore pre-pull snapshot with confirmation; clears scope keys then rewrites from snapshot |
| `getSyncPassword` | `()` → `Promise<string\|null>` | Interactively prompt for vault password; stores in localStorage; returns composite key |
| `getSyncPasswordSilent` | `()` → `string\|null` | Return composite key (`password:accountId`) without UI; returns `null` if either missing |
| `changeVaultPassword` | `async (newPassword)` → `boolean` | Store new password; triggers debounced push to re-encrypt vault. Password-change overwrites require `appConfirm()` confirmation before blind-overwriting remote. |
| `syncIsEnabled` | `()` → `boolean` | Returns `true` when `cloud_sync_enabled === 'true'` in localStorage |
| `syncGetLastPush` | `()` → `object\|null` | Read `cloud_sync_last_push` from localStorage |
| `syncSetLastPush` | `(meta)` | Write `cloud_sync_last_push` to localStorage |
| `syncGetLastPull` | `()` → `object\|null` | Read `cloud_sync_last_pull` from localStorage |
| `getSyncDeviceId` | `()` → `string` | Get or create stable per-device UUID in localStorage |
| `buildAndUploadManifest` | `async (token, password, syncId)` | Build encrypted field-level manifest from changeLog; upload to Dropbox (non-blocking) |
| `initSyncTabCoordination` | `()` | Initialize `BroadcastChannel` leader election; falls back gracefully |
| `updateSyncStatusIndicator` | `(state, detail)` | Update sync status dot (`idle`/`syncing`/`error`/`disabled`) |
| `refreshSyncUI` | `()` | Refresh "Last synced" text, toggle state, and sync history section |
| `computeInventoryHash` | `async (items)` → `string\|null` | SHA-256 of sorted item keys; used for change detection |
| `computeSettingsHash` | `async ()` → `string\|null` | SHA-256 of sync-scoped settings values |

### utils.js (import/restore pipeline)

| Function | Signature | Purpose |
|----------|-----------|---------|
| `buildImportValidationResult` | `(items, skippedNonPM)` → `object` | Batch-validate sanitized items; returns `{ valid, invalid, skippedNonPM, skippedCount }` |
| `saveData` | `(key, value)` | Write to localStorage via allowed-key guard |
| `loadData` | `(key, defaultValue)` | Read from localStorage with JSON parse |

---

## Conflict Resolution During Restore

### Manual cloud backup conflict

`cloudCheckConflict(provider)` compares `latest.json` remote timestamp against `cloud_last_backup.timestamp` in localStorage. Returns `{ conflict: true, reason, remote, local }` when remote is newer. The UI renders a conflict modal; user chooses to download remote or keep local.

### Auto-sync conflict

Conflict detection is driven by `syncHasLocalChanges()`, which checks whether both local and remote have diverged (last push timestamp is more recent than last pull timestamp). When both sides have diverged, the conflict modal appears. It is not triggered by item-count differences alone.

All remote changes — both routine updates and conflicts — are routed through `handleRemoteChange()`, which calls `pullWithPreview()` (DiffModal). The former intermediate dialogs (`showSyncUpdateModal`, `showSyncConflictModal`) were removed in STAK-413. DiffModal is the sole review UI for all remote sync changes.

`syncSaveOverrideBackup()` stores a pre-pull snapshot enabling the "Restore Override Backup" button in the sync history section. If the user accepts a conflicting pull and wants to revert, `syncRestoreOverrideBackup()` writes the pre-pull snapshot back.

**Override backup guard:** `syncRestoreOverrideBackup()` only clears scope keys if the snapshot is non-empty — an empty snapshot is treated as corruption and does not wipe localStorage.

### Cloud restore list UI (STAK-419, v3.33.41)

The cloud restore picker in Settings shows a two-tier list:

1. **Manual backups** (top section) — shown by default, listed newest-first. These are user-initiated backups with the `staktrakr-backup-` prefix.
2. **Sync snapshots** (collapsible section) — collapsed by default. These are automatic `pre-sync-` backups created by the sync system.

The backup count badge on the restore button shows the count of **manual backups only**, not total backups. This gives the user a clear signal of how many deliberate restore points exist.

### Merge strategy during import

All JSON/CSV/vault imports use a **merge strategy** (not replace-all):

- Items in the import are merged into the existing inventory using `DiffEngine`
- DiffModal shows added / modified / removed diffs; user selects which to apply
- The apply callback calls `saveData` with the merged result
- Post-apply summary banner shows final counts

---

## Manual Backup vs Automatic Cloud Sync

| Aspect | Manual Backup (cloud-storage.js) | Auto-Sync (cloud-sync.js) |
|--------|----------------------------------|---------------------------|
| Trigger | User clicks "Backup" button | Debounced on every inventory change |
| Vault scope | Full (`ALLOWED_STORAGE_KEYS`) | Sync-scope (`SYNC_SCOPE_KEYS`) only |
| What's included | All `ALLOWED_STORAGE_KEYS` minus `VAULT_EXCLUDE_KEYS` (API keys and spot history included; OAuth tokens and cloud sync state excluded) | Inventory + display prefs only |
| Filename prefix | `MANUAL_BACKUP_PREFIX` (`staktrakr-backup-`) | `SYNC_BACKUP_PREFIX` (`pre-sync-`) for pre-push snapshots |
| Filename | Versioned: `staktrakr-backup-YYYYMMDD-HHmmss.stvault` | Fixed: `staktrakr-sync.stvault` (live); `pre-sync-TIMESTAMP.stvault` (snapshots) |
| Pointer file | None (manual backups skip `staktrakr-latest.json` update) | `staktrakr-sync.json` (rev + hash + syncId) |
| `cloud_last_backup` | Not written (`skipLatestUpdate: true`) | Written on each sync push |
| Password caching | Disabled — always prompts for password | Cached in `sessionStorage` via `cloudCachePassword` |
| Auto-pruning | Never auto-pruned | Pruned by `cloudPruneBackups(provider, max, 'sync')` |
| Image vault | Optional via "Include photos" checkbox (STAK-427) | Pushed when `userImages` hash changes |
| Conflict check | `cloudCheckConflict()` on manual download | `syncHasLocalChanges()` on pull |
| Pre-restore snapshot | No | Yes: `syncSaveOverrideBackup()` before every pull |
| Provider support | Dropbox, pCloud, Box | Dropbox only |

---

## Coverage Matrix

| Data | ZIP Backup | Encrypted Vault (full) | Image Vault | Cloud Auto-Sync |
|------|:----------:|:----------------------:|:-----------:|:---------------:|
| Inventory items | Yes | Yes | No | Yes (sync scope) |
| CDN image URLs on items | Yes (in items) | Yes (in items) | No | Yes (in items) |
| User-uploaded photo blobs | Yes `user_images/` | No | Yes | Yes (conditional) |
| Pattern rule image blobs | Yes `pattern_images/` | No | No | No |
| Numista metadata cache | Yes `image_metadata.json` | No | No | No |
| API keys | No | Yes (full scope) | No | No |
| OAuth tokens / cloud sync state | No | No (excluded by `VAULT_EXCLUDE_KEYS`) | No | No |
| Spot price history | Yes | Yes (full scope) | No | No |
| Settings / theme / prefs | Yes | Yes | No | Yes (display prefs only) |
| `coinImages` (legacy) | No (SKIPPED) | No | No | No |

**Key takeaway:** Full recovery requires BOTH a ZIP backup (for IDB blobs) AND a vault (for localStorage including API keys). Cloud sync alone does not cover pattern images or Numista metadata. As of v3.33.46, full vault exports no longer include OAuth tokens or cloud sync state (`VAULT_EXCLUDE_KEYS`).

---

## Full Recovery Playbook

### Scenario A: Full restore from ZIP backup

1. Settings → "Backup All Data" produces the ZIP
2. Settings → Restore → select the `.zip` file → `restoreBackupZip(file)`
3. Restores: localStorage keys + `userImages` + `patternImages` + `coinMetadata`
4. Verify inventory loads and photos appear

### Scenario B: Full restore from vault + image vault

1. Restore encrypted vault → `vaultDecryptAndRestore(fileBytes, password)`
   - Restores: all localStorage (inventory, settings, API keys, spot history)
   - CDN image URLs come back immediately (stored on items)
2. Restore image vault → `vaultDecryptAndRestoreImages(fileBytes, password)`
   - Restores: `userImages` IDB blobs
3. Pattern images and Numista metadata are NOT recovered via this path

### Scenario C: Cloud auto-sync pull only

- Restores inventory + display prefs (sync scope)
- CDN image URLs come back immediately
- If remote image hash differs from local, image vault is pulled and `userImages` restored
- Pattern images and API keys are NOT restored

---

## Common Mistakes

| Symptom | Cause | Fix |
|---------|-------|-----|
| "My photos are gone after restoring vault" | Vault only restores localStorage. User-uploaded blobs live in IDB and require a separate restore. CDN URLs survive, but locally uploaded images do not. | Also restore from ZIP (`user_images/`) or from the image vault. |
| "Pattern images disappeared after restore" | Only the ZIP backup includes `pattern_images/`. Cloud sync and the image vault do not cover this store. | Restore from ZIP backup to recover pattern images. |
| "Numista images came back immediately after vault restore" | Expected behavior. Numista CDN URLs (`obverseImageUrl`, `reverseImageUrl`) are stored on the inventory items in localStorage, so they survive any vault restore without touching IDB. | No action needed — this is correct. |
| "Image vault upload failed during cloud push" | Image vault upload is non-fatal — the inventory vault still succeeds. | Check Dropbox token validity. The next successful push will retry the image vault if the hash changed. |
| "Conflict prompt appeared after cloud pull" | Both local and remote have diverged — last push is more recent than last pull, meaning both sides have independent changes. | Review the DiffModal and choose which version to keep. |
| "DiffModal shows fewer items than I expected" | Pre-validation in `buildImportValidationResult()` filters out invalid items before DiffModal opens. The count header shows backup count (including skipped) vs. projected count. | Check the pre-validation warning toast for the number of skipped items and their reasons. |
| "I see a yellow cross-domain warning on import" | The file's `exportOrigin` (e.g., `https://beta.staktrakr.com`) differs from the current domain. | The warning is informational only. Proceed if you intentionally want to merge across environments. |
| "The JSON file I exported doesn't look like a plain array anymore" | `exportJson()` now wraps items in an object with `items` and `exportMeta` fields. | Both the wrapped format and the legacy plain-array format are supported on import. Old files still import correctly. |
| "Import only shows a toast, not the old banner" | The persistent `showImportSummaryBanner()` was removed in v3.33.58. All post-import feedback now uses standard toast notifications. | This is expected behavior. The toast shows added/updated/removed counts. |
| "Push was blocked with 'Empty vault — pull first'" | Empty-vault guard in `pushSyncVault()` detected remote has items but local is empty. | Pull from cloud first to restore local inventory, then push will proceed normally. |
| "OAuth relay rejected with 'state mismatch'" | `cloudCheckOAuthRelay` validates the `state` parameter from the localStorage relay against `cloud_oauth_state` in `sessionStorage`. A mismatch means the relay entry is stale or from a different OAuth session. | Re-initiate the OAuth flow from Settings → Cloud → Connect. |

> **Never modify the `coinImages` IDB store.** It is a legacy store retained only to avoid a forced migration. It is never read or written. ZIP restore explicitly skips `coinImages/` and logs: `"skipping legacy coinImages folder (store deprecated)"`.

---

## Related Pages

- [sync-cloud.md](sync-cloud.md) — Dropbox OAuth setup and auto-sync troubleshooting
- [storage-patterns.md](storage-patterns.md) — localStorage key patterns, `saveData`/`loadData`, `ALLOWED_STORAGE_KEYS`

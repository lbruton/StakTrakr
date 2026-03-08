---
title: Cloud Sync
category: frontend
owner: staktrakr
lastUpdated: v3.33.59
date: 2026-03-07
sourceFiles:
  - js/cloud-sync.js
  - js/cloud-storage.js
relatedPages:
  - storage-patterns.md
  - backup-restore.md
---
# Cloud Sync

> **Last updated:** v3.33.59 — 2026-03-07
> **Source files:** `js/cloud-sync.js`, `js/cloud-storage.js`

---

## Overview

StakTrakr supports Dropbox-based cloud sync that automatically pushes an encrypted vault snapshot whenever inventory changes, and polls for remote updates on other devices.

The active provider is Dropbox (`_syncProvider = 'dropbox'`). pCloud and Box are defined in `CLOUD_PROVIDERS` but are partially implemented (token URLs use a `/api/` proxy that does not exist in production). Treat them as future-facing stubs.

Three files live in Dropbox under `/StakTrakr/sync/`:

| File | Purpose |
|---|---|
| `staktrakr-sync.stvault` | Full encrypted inventory snapshot |
| `staktrakr-sync.json` | Lightweight metadata pointer, polled for change detection |
| `staktrakr-sync.stmanifest` | Encrypted field-level changelog (manifest-first diff path) |

A separate image vault lives at:

| File | Purpose |
|---|---|
| `staktrakr-images.stvault` | Encrypted image vault (user photos only, not pattern assets) |

> **Legacy paths:** Flat-root paths (`/StakTrakr/staktrakr-sync.*`) are retained as `*_LEGACY` constants in `js/constants.js` for migration only. Active sync uses `/StakTrakr/sync/`; auto-backups go to `/StakTrakr/backups/`. The `cloudMigrateToV2()` function runs once per device (guarded by `cloud_sync_migrated === 'v2'` in localStorage) to move existing files.

---

## Key Rules (read before touching this area)

1. **Never bypass `getSyncPasswordSilent()`** — do not add your own `localStorage.getItem('cloud_vault_password')` reads inline. All key derivation logic (Simple mode migration, Unified mode construction) is encapsulated there.
2. **`.catch()` on `pushSyncVault()` is optional** — it catches internally and all guard conditions return silently. **`.catch()` on `pullSyncVault()` is required** — the token check at the top fires before the internal try/catch, so callers must handle rejection.
3. **Cancel the debounced push before pulling** — `handleRemoteChange()` calls `scheduleSyncPush.cancel()` before routing to `pullWithPreview()`. If you add a new pull path, replicate this cancel guard or the vault overwrite race will reopen. `handleRemoteChange()` also sets `_syncRemoteChangeActive = true` for the entire duration of the pull (including while the DiffModal is open, awaiting user action), which blocks concurrent `pushSyncVault()` calls. Both guards are required: the cancel prevents the queued debounce from firing, and the `_syncRemoteChangeActive` flag blocks any new push triggered while the user is reviewing the diff. The flag is managed solely by try/finally inside `handleRemoteChange()` — it must not be set at call sites.
4. **Do not duplicate `getSyncPassword()` logic** — the fast-path check at the top delegates to `getSyncPasswordSilent()`, which handles both modes and the migration edge case. Adding a second localStorage read before it breaks Simple-mode migration.
5. **Only the leader tab pushes and polls** — `_syncIsLeader` guards both `pushSyncVault()` and `pollForRemoteChanges()`. Do not call the underlying network operations directly from UI code without this guard, or multi-tab races occur.
6. **`cloud_dropbox_account_id` is required on every pull/poll path** — `pollForRemoteChanges()`, `pullSyncVault()`, and `pullWithPreview()` all check for a present `cloud_dropbox_account_id` before attempting any decrypt. Missing accountId yields an early-return with a "setup incomplete" toast instead of a misleading "Wrong Vault Password" error.
7. **All confirmations use `appConfirm`** — there are no `window.confirm` calls in this module. The password-change blind-overwrite confirmation at line 1144 uses `await appConfirm(..., 'Cloud Sync')`.

---

## Architecture

### File Responsibilities

| File | Role |
|---|---|
| `js/cloud-sync.js` | Auto-sync orchestration: push/pull, polling loop, conflict resolution, manifest generation, multi-tab coordination, password management |
| `js/cloud-storage.js` | Provider layer: OAuth flow, token storage/refresh, manual backup upload/download, vault list/delete, activity log, cloud UI rendering |

`cloud-sync.js` depends on `cloud-storage.js` for token operations (`cloudGetToken`, `cloudIsConnected`, `cloudStoreToken`). `cloud-storage.js` does not depend on `cloud-sync.js`.

### Supported Providers

Defined in `CLOUD_PROVIDERS` constant (in `cloud-storage.js`):

| Provider | Auth | PKCE | Refreshable | Status |
|---|---|---|---|---|
| `dropbox` | OAuth2 popup | Yes | Yes | Production |
| `pcloud` | OAuth2 popup | No | No (lifetime tokens) | Stub |
| `box` | OAuth2 popup | No | Yes | Stub |

### Two Sync Modes

#### Unified Mode (default)

The encryption key combines the user-chosen vault password and the Dropbox account ID:

```
key = vaultPassword + ':' + accountId
```

- `cloud_vault_password` and `cloud_dropbox_account_id` are both required.
- `getSyncPasswordSilent()` returns null on a new device until the user enters the password at least once — this triggers `getSyncPassword()` which opens the password modal.
- After first entry, the password is cached in `cloud_vault_password` (localStorage) so subsequent page loads are silent.
- Zero-knowledge: Dropbox OAuth access alone is insufficient to decrypt the vault.

#### Simple Mode (legacy migration only)

```
key = STAKTRAKR_SIMPLE_SALT + ':' + accountId
```

- Only applies when `cloud_sync_mode === 'simple'` is present in localStorage.
- `STAKTRAKR_SIMPLE_SALT` is a fixed hex string baked into `js/cloud-sync.js`.
- Any device with the same Dropbox OAuth token can derive the key — weaker security.
- `cloud_sync_mode === 'simple'` will be removed after v3.33. Devices on this mode will silently re-encrypt to Unified mode on the next push once a password is set.

### Key Derivation Flow

```
getSyncPasswordSilent()
  ├─ vaultPw + accountId present → return vaultPw + ':' + accountId   (Unified)
  ├─ accountId only + cloud_sync_mode==='simple' → return SALT + ':' + accountId  (Simple migration)
  └─ null → caller must call getSyncPassword() to open the password modal
```

`getSyncPassword()` checks `getSyncPasswordSilent()` first. If null, opens `cloudSyncPasswordModal`. On confirm, re-reads `cloud_dropbox_account_id` — if still absent, an in-modal error is displayed ("No Dropbox account ID found. Please cancel and reconnect your Dropbox account.") and the modal stays open; if present, writes `cloud_vault_password` to localStorage and resolves the composite key.

### Multi-Tab Coordination

`initSyncTabCoordination()` (called from `initCloudSync()`) sets up a `BroadcastChannel('staktrakr-sync')` for leader election:

- The oldest open tab (lowest `_syncTabOpenedAt` timestamp) wins leadership.
- Only the leader tab polls and pushes.
- If the leader tab is hidden for >60 seconds, leadership is released so another tab can take over.
- When a tab becomes visible again it reclaims leadership if no other leader is present.
- When a push or pull completes, the leader broadcasts `sync-push-complete` or `sync-pull-complete` so other tabs refresh their UI without performing duplicate operations.
- Falls back gracefully to "every tab is leader" when `BroadcastChannel` is unavailable (Safari < 15.4).

---

## Key Functions

### `cloud-sync.js`

| Function | Signature | Purpose |
|---|---|---|
| `initCloudSync()` | `() → void` | Entry point (called from `init.js` Phase 13). Creates debounced push, starts poller if sync was enabled. |
| `enableCloudSync(provider?)` | `(string?) → Promise<void>` | Enable auto-sync: initial push + start poller. |
| `disableCloudSync()` | `() → void` | Disable auto-sync: persist flag, stop poller, update UI. |
| `pushSyncVault()` | `() → Promise<void>` | Encrypt and upload inventory to Dropbox. Includes empty-vault guard, backup-before-overwrite, image vault upload, manifest upload, metadata pointer write. |
| `scheduleSyncPush` | `debounced fn` | Debounced wrapper around `pushSyncVault` (2000ms delay). Exposed on `window` so `saveInventory()` can call it. |
| `pullSyncVault(remoteMeta)` | `(object) → Promise<void>` | Download, decrypt, and restore vault. Throws if no token — callers must `.catch()`. |
| `pullWithPreview(remoteMeta)` | `(object) → Promise<void>` | Primary pull path. Manifest-first: downloads `.stmanifest`, builds diff, shows `DiffModal` and awaits user action before returning. Falls back to vault-first if manifest unavailable; vault-first path also awaits user action. Does not return until Apply or Cancel is selected. |
| `pollForRemoteChanges()` | `() → Promise<void>` | Download `staktrakr-sync.json`, compare `syncId` with last pull, call `handleRemoteChange()` on change. Only runs if leader tab + visible. |
| `handleRemoteChange(remoteMeta)` | `(object) → Promise<void>` | Route a detected remote change: cancel debounced push, then go directly to `pullWithPreview()`. Sets `_syncRemoteChangeActive = true` via try/finally for the full duration. |
| `getSyncPasswordSilent()` | `() → string\|null` | Non-interactive key derivation — safe to call from background loops. |
| `getSyncPassword()` | `() → Promise<string\|null>` | Interactive key prompt — opens password modal; shows in-modal error if `cloud_dropbox_account_id` is absent at confirm time. |
| `changeVaultPassword(newPassword)` | `(string) → Promise<boolean>` | Update vault password in localStorage and trigger re-encrypt push. |
| `syncSaveOverrideBackup()` | `() → void` | Snapshot all `SYNC_SCOPE_KEYS` from localStorage before a pull overwrites them. |
| `syncRestoreOverrideBackup()` | `() → Promise<void>` | Restore the pre-pull snapshot (with `appConfirm` dialog). |
| `getSyncDeviceId()` | `() → string` | Get or create stable per-device UUID (persisted in `cloud_sync_device_id`). |
| `syncHasLocalChanges()` | `() → boolean` | True if last push timestamp is newer than last pull timestamp. |
| `buildAndUploadManifest(token, password, syncId)` | `(...) → Promise<void>` | Build and encrypt a field-level changelog from `changeLog`, upload to Dropbox. Non-blocking (failure does not prevent vault push). |
| `pruneManifestEntries(entries, maxSyncs)` | `(array, number) → array` | Trim manifest entries to the last N sync cycles (default: 10). |
| `computeInventoryHash(items)` | `(object[]) → Promise<string\|null>` | SHA-256 hash of sorted item keys for change detection. Returns null on `file://`. |
| `computeSettingsHash()` | `() → Promise<string\|null>` | SHA-256 hash of `SYNC_SCOPE_KEYS` settings (excluding `metalInventory`). |
| `initSyncTabCoordination()` | `() → void` | Set up BroadcastChannel leader election. |
| `startSyncPoller()` / `stopSyncPoller()` | `() → void` | Start/stop the background `setTimeout` polling loop. |
| `refreshSyncUI()` | `() → void` | Update toggle, last-synced label, Sync Now button state, status dot in Settings. |
| `updateSyncStatusIndicator(state, detail?)` | `('idle'\|'syncing'\|'error'\|'disabled', string?) → void` | Update the status badge in the cloud card + header button. |

### `cloud-storage.js`

| Function | Signature | Purpose |
|---|---|---|
| `cloudAuthStart(provider, options?)` | `(string, object?) → void` | Open OAuth popup (PKCE for Dropbox). Must be called from a click handler to avoid popup blockers. Optional `options.forceReauth` adds `force_reauthentication=true` to the Dropbox OAuth URL, forcing the login/account-picker screen (STAK-449). |
| `cloudExchangeCode(code, state)` | `(string, string) → Promise<void>` | Exchange OAuth code for access/refresh tokens. Validates state parameter against saved session. For Dropbox, always calls `/2/users/get_current_account` to fetch and store `email` and `display_name` in localStorage (STAK-449). |
| `cloudCheckOAuthRelay()` | `() → void` | Fallback relay handler when popup loses `window.opener`. Reads `staktrakr_oauth_result` from localStorage, validates `data.state` against `sessionStorage.getItem('cloud_oauth_state')` before calling `cloudExchangeCode` — rejects with a CSRF warning on mismatch. |
| `cloudGetToken(provider)` | `(string) → Promise<string\|null>` | Return valid access token. Attempts refresh if expired (with 60s buffer). Clears token and returns null on refresh failure. |
| `cloudIsConnected(provider)` | `(string) → boolean` | True if a stored token exists for the provider. |
| `cloudStoreToken(provider, tokenData)` | `(string, object) → void` | Persist token to localStorage under `cloud_token_<provider>`. |
| `cloudClearToken(provider)` | `(string) → void` | Remove stored token. |
| `cloudDisconnect(provider)` | `(string) → void` | Full disconnect: clears token, then removes all 15 cloud state keys (`cloud_last_backup`, `cloud_dropbox_account_id`, `cloud_dropbox_email`, `cloud_dropbox_display_name`, `cloud_vault_password`, `cloud_sync_enabled`, `cloud_sync_device_id`, `cloud_sync_cursor`, `cloud_sync_last_push`, `cloud_sync_last_pull`, `cloud_sync_override_backup`, `cloud_sync_mode`, `cloud_sync_local_modified`, `cloud_sync_migrated`, `staktrakr_oauth_result`). Cancels any pending `scheduleSyncPush` debounce. Updates UI. |
| `cloudUploadVault(provider, fileBytes, opts)` | `(string, ArrayBuffer, object?) → Promise<void>` | Manual backup upload. Writes versioned `.stvault` file + `staktrakr-latest.json` pointer (unless `opts.skipLatestUpdate` is true). All provider upload responses are validated (`.ok` check) and throw on failure. Records to activity log. |
| `cloudDownloadVault(provider)` | `(string) → Promise<Uint8Array>` | Download latest backup by pointer, or by listing if no pointer. |
| `cloudDownloadVaultByName(provider, filename)` | `(string, string) → Promise<Uint8Array>` | Download a specific named backup file. |
| `cloudListBackups(provider, type)` | `(string, string?) → Promise<object[]>` | List `.stvault` files in the provider's backups folder, sorted newest-first. Fetches all pages via `files/list_folder/continue` when Dropbox returns `has_more`. Optional `type` param filters by prefix: `'manual'` (matches `MANUAL_BACKUP_PREFIX`), `'sync'` (matches `SYNC_BACKUP_PREFIX`), or `undefined` (all backups). |
| `cloudDeleteBackup(provider, filename)` | `(string, string) → Promise<void>` | Delete a specific backup file. If the deleted file was the `cloud_last_backup` pointer target, updates the remote `staktrakr-latest.json` to point to the next most recent backup, or deletes the pointer entirely if no backups remain. |
| `cloudCheckConflict(provider)` | `(string) → Promise<object>` | Compare remote `staktrakr-latest.json` timestamp against local last-backup record. Returns `{conflict: bool, ...}`. |
| `recordCloudActivity(entry)` | `(object) → void` | Append an entry to the cloud activity log (capped at 500 entries, purges >180 days old). |
| `renderCloudActivityTable()` | `() → void` | Render the sortable activity table in Settings → Cloud. |
| `renderSyncHistorySection()` | `() → void` | Render the Sync History section (override backup metadata + restore button). |
| `syncCloudUI()` | `() → void` | Refresh provider card UI (connect/disconnect buttons, status badge, backup metadata). For Dropbox, also shows/hides account identity row, Switch Account button, and Sign Out link based on connection state (STAK-449). |
| `cloudCachePassword(provider, password)` | `(string, string) → void` | XOR-obfuscated session-only password cache (sessionStorage). Starts idle lock timer. |
| `cloudGetCachedPassword(provider)` | `(string) → string\|null` | Retrieve session-cached password. |
| `cloudClearCachedPassword()` | `() → void` | Clear session cache and stop idle lock timer. |
| `cloudPruneBackups(provider, maxKeep, type)` | `(string, number, string?) → Promise<void>` | Prune old backups, keeping only the newest `maxKeep`. Defaults to `type='sync'` so manual backups are never auto-pruned. |
| `showCloudToast(message, durationMs?)` | `(string, number?) → void` | Display a transient toast notification. |

---

## Sync Flow

### Push (inventory → Dropbox)

Triggered by `scheduleSyncPush()` (debounced, 2000ms) from `saveInventory()`.

```
saveInventory()
  └─ scheduleSyncPush()   ← debounced 2000ms
       └─ pushSyncVault()
            ├─ Guard: syncIsEnabled() + _syncIsLeader + token + getSyncPasswordSilent()
            ├─ Empty-vault guard (REQ-1): if local is empty, check remote — block push if remote has items
            ├─ cloudMigrateToV2() if not yet migrated
            ├─ Backup-before-overwrite (REQ-2): copy existing vault to /backups/pre-sync-<ts>.stvault
            ├─ Encrypt with vaultEncryptToBytesScoped() or vaultEncryptToBytes()
            ├─ Upload: /sync/staktrakr-sync.stvault (overwrite)
            ├─ Upload image vault if hash changed (non-fatal)
            ├─ Upload: /sync/staktrakr-sync.json (metadata pointer, includes inventoryHash, settingsHash)
            ├─ buildAndUploadManifest() — field-level changelog (non-fatal)
            ├─ syncSetLastPush() + syncSetCursor()
            ├─ Auto-prune old sync backups: cloudPruneBackups(provider, max, 'sync') (fire-and-forget)
            └─ Broadcast sync-push-complete to other tabs
```

Rate limiting (HTTP 429): exponential backoff doubles `_syncRetryDelay` on each 429, caps at 5 minutes. Resets to `SYNC_POLL_INTERVAL` on success.

### Poll (check for remote changes)

`pollForRemoteChanges()` runs on a `setTimeout` loop:

```
pollForRemoteChanges()
  ├─ Guard: syncIsEnabled() + _syncIsLeader + !document.hidden + token
  ├─ Guard: cloud_dropbox_account_id present (toast + return if missing)
  ├─ Download: /sync/staktrakr-sync.json
  ├─ Legacy fallback: if 404/409, retry at SYNC_META_PATH_LEGACY
  ├─ Echo detection: if remoteMeta.deviceId === getSyncDeviceId() → skip (our own push)
  ├─ No change: if remoteMeta.syncId === lastPull.syncId → skip
  ├─ Hash check (REQ-4): if inventoryHash matches local → skip notification, record pull silently
  └─ handleRemoteChange(remoteMeta)
```

### Remote Change Handling

`handleRemoteChange()` no longer routes through intermediate update or conflict modals. All remote changes — whether or not the local device has unsaved changes — go directly to `pullWithPreview()`:

```
handleRemoteChange(remoteMeta)
  ├─ Defer if password prompt is active
  ├─ _syncRemoteChangeActive = true   ← set here; cleared only by try/finally inside this function
  ├─ scheduleSyncPush.cancel()   ← CRITICAL: prevents vault overwrite race
  ├─ await pullWithPreview(remoteMeta)   ← handles all cases (update, conflict, diff preview)
  └─ finally: _syncRemoteChangeActive = false   ← clears only after pull is fully applied
```

> **Note:** `showSyncUpdateModal` and `showSyncConflictModal` were removed in STAK-413. The DiffModal used by `pullWithPreview()` presents all necessary conflict and update information in a single unified interface.

### Pull (Dropbox → inventory)

`pullWithPreview()` is the primary entry point for all remote pulls:

```
pullWithPreview(remoteMeta)
  ├─ getSyncPasswordSilent() or getSyncPassword()
  ├─ Guard: cloud_dropbox_account_id present (toast + return if missing)
  │
  ├─ Manifest-first path (preferred):
  │    ├─ Download /sync/staktrakr-sync.stmanifest
  │    ├─ decryptManifest() → build diff from changelog entries
  │    ├─ await new Promise(resolveModal):
  │    │    DiffModal.show() with manifest diff
  │    │    └─ onApply: _deferredVaultRestore().finally(resolveModal)
  │    │         — download full vault, decrypt, selective apply
  │    │    └─ onCancel: resolveModal() — no vault downloaded
  │    └─ returns only after user selects Apply or Cancel
  │
  └─ Vault-first fallback (if manifest unavailable or DiffModal missing):
       ├─ Download /sync/staktrakr-sync.stvault
       ├─ vaultDecryptToData() → DiffEngine.compareItems() + compareSettings()
       ├─ itemTags excluded from settings diff (STAK-455): both remoteSettings and localSettings
       │    filter out `itemTags` before `DiffEngine.compareSettings()` — UUID-to-tag mappings
       │    flow through item comparison instead, preventing a massive "Other" category blob
       ├─ await showRestorePreviewModal(diffResult, settingsDiff, ...)
       │    ├─ returns Promise<void> — resolves on Apply or Cancel
       │    └─ onApply: _applyAndFinalize() → resolve()
       │    (returns null if DiffModal unavailable → falls back below)
       └─ null fallback: direct pullSyncVault() if modal unavailable
```

`pullSyncVault()` is the lower-level restore function (full overwrite, no preview):

```
pullSyncVault(remoteMeta)
  ├─ getSyncPasswordSilent() or getSyncPassword()
  ├─ Guard: cloud_dropbox_account_id present (toast + return if missing)
  ├─ token guard (THROWS if no token — callers MUST .catch())
  ├─ Download /sync/staktrakr-sync.stvault
  ├─ syncSaveOverrideBackup()
  ├─ vaultDecryptAndRestore()
  ├─ Pull image vault if hash differs (non-fatal)
  └─ syncSetLastPull()
```

### Image Vault

Runs as part of push and pull, non-fatally:

- **Push:** `collectAndHashImageVault()` → compare hash with `lastPush.imageHash` → skip if unchanged → `vaultEncryptImageVault()` → upload to `/sync/staktrakr-images.stvault`.
- **Pull:** compare `remoteMeta.imageVault.hash` with `lastPull.imageHash` → skip if unchanged → download → `vaultDecryptAndRestoreImages()`.
- Only `userImages` IDB records are synced. `patternImages` (built-in catalog assets) are not included.

---

## Conflict Resolution

**Default: DiffModal always shown** — `handleRemoteChange()` routes all remote changes directly to `pullWithPreview()`, which presents the DiffModal. The user chooses Apply or Cancel regardless of whether the local device has unsaved changes.

`syncHasLocalChanges()` returns true if `lastPush.timestamp > lastPull.timestamp` — meaning the local device has pushed changes that predated the remote update, so both sides have diverged. This flag is checked internally within the pull/preview flow.

The override backup (`syncSaveOverrideBackup`) is written before any pull, enabling "Restore This Snapshot" in the Sync History section.

### Keep Mine / Push My Data — conflict bypass flag (STAK-403, v3.33.32)

**Problem:** Choosing to overwrite the remote vault (from within the DiffModal or a conflict prompt) triggered `pushSyncVault()`, which immediately re-ran the Layer 0 pre-push remote check. That check detected the same unacknowledged remote change the user had just explicitly dismissed and re-routed back to `handleRemoteChange()` — creating an infinite conflict-resolution loop.

**Fix:** A module-level one-shot flag `_syncConflictUserOverride` (initialized `false`, line 36 of `cloud-sync.js`) is set `true` at call sites that represent explicit user intent to overwrite. At the start of the Layer 0 try block, the flag is snapshot-and-cleared atomically:

```js
var _prePushOverride = _syncConflictUserOverride;
_syncConflictUserOverride = false;
```

Clearing before the async fetch ensures the flag cannot survive a network error or early return and affect a subsequent push call.

After the remote metadata is decrypted and the device/syncId comparison runs, the bypass branch is evaluated first:

```js
if (_prePushOverride) {
  console.warn('[CloudSync] Pre-push check: BYPASS — user explicitly resolved conflict, overwriting remote');
  logCloudSyncActivity('auto_sync_push', 'info', 'Pre-push conflict check bypassed — user resolved conflict');
  // fall through to push
} else if (prePushMeta.deviceId !== myDeviceId && (!lastPull || lastPull.syncId !== prePushMeta.syncId)) {
  // normal conflict routing
}
```

The flag is purely one-shot: it is consumed (cleared) at the top of the next `pushSyncVault()` call regardless of outcome, so no permanent bypass accumulates.

---

## Backup/Restore Relationship

Cloud sync and manual backups are parallel systems with distinct file prefixes and independent lifecycles (STAK-419, v3.33.41):

| Operation | File location | Prefix | Who calls |
|---|---|---|---|
| Auto-sync push | `/StakTrakr/sync/staktrakr-sync.stvault` | — | `pushSyncVault()` — triggered by `saveInventory()` debounce |
| Backup-before-overwrite | `/StakTrakr/backups/pre-sync-<ts>.stvault` | `SYNC_BACKUP_PREFIX` | Inside `pushSyncVault()`, each push cycle |
| Manual backup | `/StakTrakr/backups/staktrakr-backup-<ts>.stvault` | `MANUAL_BACKUP_PREFIX` | `cloudUploadVault()` — user-initiated |
| Override backup (pre-pull snapshot) | `cloud_sync_override_backup` localStorage key | — | `syncSaveOverrideBackup()` — before every pull |

### Two-tier backup isolation (STAK-419, v3.33.41)

Manual backups and sync snapshots are separated by filename prefix and treated independently:

- **`MANUAL_BACKUP_PREFIX` (`staktrakr-backup-`)** — user-initiated backups via the "Backup" button. These are never auto-pruned by the sync system. The user must delete them explicitly.
- **`SYNC_BACKUP_PREFIX` (`pre-sync-`)** — automatic pre-push snapshots created by `pushSyncVault()`. These are pruned by `cloudPruneBackups()` which defaults to `type='sync'`.

**Key behavioral notes:**

- `cloudListBackups(provider, type)` accepts an optional `type` parameter (`'manual'` | `'sync'` | `undefined`) for client-side prefix filtering.
- `cloudPruneBackups(provider, maxKeep, type)` defaults to `type='sync'`, so auto-pruning only touches sync snapshots. Manual backups are preserved regardless of the backup history depth setting.
- `cloudUploadVault(provider, fileBytes, opts)` accepts an `opts` parameter. When `opts.skipLatestUpdate` is true, the `cloud_last_backup` pointer is not updated — this prevents manual backups from interfering with sync state tracking.
- The vault modal password is not cached for manual backups (password caching via `cloudCachePassword` is skipped for `isManualBackup: true` contexts). Each manual backup requires the user to re-enter their vault password.

The override backup is the safety net for unwanted sync pulls. It restores raw localStorage strings (not Dropbox files) directly back to the pre-pull state.

---

## localStorage Keys

| Key | Purpose |
|---|---|
| `cloud_vault_password` | User vault password (Unified mode) |
| `cloud_dropbox_account_id` | Dropbox account ID (used in key derivation for both modes) |
| `cloud_dropbox_email` | Dropbox account email, displayed in Cloud settings card (STAK-449). Excluded from vault backups via `VAULT_EXCLUDE_KEYS`. |
| `cloud_dropbox_display_name` | Dropbox display name, displayed alongside email in Cloud settings card (STAK-449). Excluded from vault backups via `VAULT_EXCLUDE_KEYS`. |
| `cloud_sync_mode` | `'simple'` — deprecated, kept for migration only, will be removed after v3.33 |
| `cloud_sync_enabled` | `'true'` when auto-sync is active |
| `cloud_sync_device_id` | Stable per-device UUID |
| `cloud_sync_last_push` | JSON: `{syncId, timestamp, rev, itemCount, imageHash?}` |
| `cloud_sync_last_pull` | JSON: `{syncId, timestamp, rev, imageHash?}` |
| `cloud_sync_cursor` | Last-seen remote revision (from Dropbox vault upload response `.rev`) |
| `cloud_sync_override_backup` | JSON snapshot of `SYNC_SCOPE_KEYS` taken before a pull |
| `cloud_sync_migrated` | `'v2'` when flat-layout migration is complete |
| `cloud_token_<provider>` | JSON: `{access_token, refresh_token, expires_at}` |
| `cloud_last_backup` | JSON: last backup metadata (only written by sync operations; manual backups with `skipLatestUpdate` do not update this key) |
| `cloud_activity_log` | JSON array: cloud activity entries (max 500, 180-day TTL) |
| `cloud_kraken_seen` | `'true'` after first successful backup (suppresses easter-egg toast) |

**Disconnect cleanup (STAK-425, v3.33.46; updated STAK-449, v3.33.55):** `cloudDisconnect(provider)` removes all cloud state keys (including `cloud_dropbox_email` and `cloud_dropbox_display_name`) except `cloud_kraken_seen`, `cloud_activity_log`, `cloud_backup_history_depth`, and `cloud_vault_idle_timeout`. It also cancels any pending `scheduleSyncPush` debounce to prevent a ghost push after disconnect.

### Multi-account UX (STAK-449, v3.33.55)

Users with multiple Dropbox accounts can now see which account is connected and switch between them:

- **Account identity display**: `cloudExchangeCode()` always calls `/2/users/get_current_account` after token exchange to fetch `email` and `name.display_name`. These are stored in `cloud_dropbox_email` and `cloud_dropbox_display_name` and displayed in the Cloud settings card below the "Connected" status indicator.
- **Switch Account button**: Visible when connected. Calls `cloudDisconnect(provider)` then `cloudAuthStart(provider, { forceReauth: true })`. The `force_reauthentication=true` OAuth parameter forces Dropbox to show the login/account-picker screen instead of auto-selecting the active browser session.
- **Sign out of Dropbox link**: Opens `https://www.dropbox.com/logout` in a new tab. Does not affect StakTrakr's OAuth state — it only clears the Dropbox browser session so the next Connect or Switch Account starts fresh.

---

## Security Notes

### Console output sanitization (STAK-430, v3.33.51)

Console and debug output has been hardened to avoid leaking credential material:

- **`cloud-sync.js`** — `console.warn` calls no longer emit `password.length`, `key.length`, byte counts, or hash values. Crypto-diagnostic logs are routed through `debugLog()` (suppressed in production). The pre-decrypt diagnostic (`_logDecryptAttempt`) logs only boolean presence of `cloud_vault_password` and `'present'`/`'MISSING'` for `cloud_dropbox_account_id` — never the actual value or its length.
- **`cloud-storage.js`** — Account ID logged as `'present'` rather than a slice of the actual value. Response status codes are not included in failure log messages.

### OAuth state parameter validation (STAK-430, v3.33.51)

`cloudCheckOAuthRelay()` now validates the OAuth state parameter before processing relay results:

```js
var savedState = sessionStorage.getItem('cloud_oauth_state');
if (!savedState || savedState !== data.state) {
  console.warn('[CloudStorage] OAuth relay: state mismatch — possible CSRF, rejecting');
  return;
}
```

If the state stored in `sessionStorage` is missing or does not match `data.state` from the relay payload, the relay is rejected and `cloudExchangeCode` is never called. This prevents a CSRF attacker from injecting a crafted OAuth result into localStorage and having it auto-processed.

### All confirmations use `appConfirm`

There are no `window.confirm` calls anywhere in `cloud-sync.js` or `cloud-storage.js`. The password-change blind-overwrite prompt uses `await appConfirm(..., 'Cloud Sync')`, which renders in the app's modal system rather than the browser's native dialog (consistent with all other sync confirmations).

---

## Error Handling Patterns

- **`pushSyncVault()`** — all errors caught internally; sets status indicator to `'error'`; returns silently. No caller catch required.
- **`pullSyncVault()`** — token guard THROWS before the internal try/catch. All callers must `.catch()` or wrap in try/catch.
- **`pullWithPreview()`** — catches internally; falls back to `pullSyncVault()` on outer error; sets status indicator to `'error'`. Awaits the DiffModal user action (Apply or Cancel) before returning, so `_syncRemoteChangeActive` stays `true` until the pull is fully applied.
- **Missing `cloud_dropbox_account_id`** — `pollForRemoteChanges()`, `pullSyncVault()`, and `pullWithPreview()` all guard against a missing accountId. Each fires a `console.warn('[CloudSync] … cloud_dropbox_account_id missing')` and a `showCloudToast('Cloud sync setup is incomplete on this device. Please reconnect Dropbox…')` then returns early. No decrypt is attempted.
- **`getSyncPassword()` missing accountId at confirm time** — the onConfirm handler re-reads `cloud_dropbox_account_id`; if absent, it injects an error message into the modal's error element and returns without closing (modal stays open for the user to cancel and reconnect). The `appPrompt` fallback path resolves `null` when accountId is missing.
- **`buildAndUploadManifest()`** — must be called inside try/catch; failure is intentionally non-blocking relative to the vault push.
- **Image vault** — all image upload/download errors are caught with `console.warn`; inventory sync continues uninterrupted.
- **Rate limiting (429)** — `pushSyncVault()` and `pollForRemoteChanges()` both handle 429 by doubling `_syncRetryDelay` (capped at 5 min). Resets to `SYNC_POLL_INTERVAL` on success.
- **Activity log** — `recordCloudActivity()` is called on every meaningful cloud operation (connect, disconnect, push, pull, backup, restore, refresh, auth failure) with action, provider, result, detail, and duration.

### Pre-decrypt diagnostics

`_tryDecryptVault(fileBytes, artifactLabel?)` and `_tryDecryptMetadata(parsed)` each emit a structured `console.warn` **before entering the key-candidate loop** via `_logDecryptAttempt()`:

```
[CloudSync] decrypt attempt: artifact=stvault vaultPw: true accountId: present candidates: 3
[CloudSync] decrypt attempt: artifact=metadata vaultPw: true accountId: MISSING candidates: 0
```

Fields logged:

- `artifact` — `'stvault'` (all `_tryDecryptVault` call sites), `'metadata'` (`_tryDecryptMetadata`)
- `vaultPw` — boolean presence of `cloud_vault_password` (never the value or its length)
- `accountId` — `'present'` if set, or `'MISSING'` (never the account ID value or a slice of it)
- `candidates` — count from `_getSyncKeyCandidates()` (0 when accountId is missing, since no valid composite key can be formed)

---

## Common Mistakes

### Adding a raw localStorage read for the vault password

```js
// WRONG — breaks Simple-mode migration and Unified mode
var pw = localStorage.getItem('cloud_vault_password');

// CORRECT — handles all modes and migration edge cases
var pw = getSyncPasswordSilent();
```

### Adding a pull path without cancelling the debounced push

```js
// WRONG — vault overwrite race (STAK fix: v3.32.24)
async function myNewPullPath(remoteMeta) {
  await pullWithPreview(remoteMeta);
}

// CORRECT
async function myNewPullPath(remoteMeta) {
  if (typeof scheduleSyncPush === 'function' && typeof scheduleSyncPush.cancel === 'function') {
    scheduleSyncPush.cancel();
  }
  await pullWithPreview(remoteMeta);
}
```

### Calling `pullSyncVault()` without `.catch()`

```js
// WRONG — token guard throws before try/catch
pullSyncVault(remoteMeta);

// CORRECT
pullSyncVault(remoteMeta).catch(function (err) {
  updateSyncStatusIndicator('error', err.message);
});
```

### Calling push/poll operations without checking leadership

```js
// WRONG — bypasses multi-tab guard
await pushSyncVault();

// CORRECT — use the public entry points which include _syncIsLeader check
scheduleSyncPush(); // for inventory changes
// or call enableCloudSync() / disableCloudSync() to start/stop the system
```

### Assuming the manifest path succeeds for all pulls

`pullWithPreview()` has two distinct paths: manifest-first (lightweight) and vault-first (full download). The manifest path is best-effort. Code that hooks into the pull flow must handle both paths.

### Setting `_syncRemoteChangeActive` at a call site

`_syncRemoteChangeActive` is managed exclusively by `handleRemoteChange()` via try/finally. Setting it to `true` before calling `handleRemoteChange()` — a pattern that previously existed — was removed in STAK-430 because it caused the flag to remain `true` if `handleRemoteChange()` threw before reaching its own try block, permanently blocking all future pushes.

---

## Vault Overwrite Race (fixed v3.32.24, extended v3.33.34)

**Symptom:** On two-device setups, choosing "Keep Theirs" in the conflict modal silently discarded the remote device's changes.

**Root cause:** `initSyncModule()` builds `scheduleSyncPush` with a 2000ms debounce. If the poller detected a remote change within that 2-second window, the debounced push fired during or after the conflict modal, overwriting the remote vault before the pull could complete.

**Fix (v3.32.24):** `handleRemoteChange()` calls `scheduleSyncPush.cancel()` as its first substantive action — before routing to `pullWithPreview()`. This prevents the *queued debounce* from firing.

**Extended fix (v3.33.34, STAK-406):** A second race path remained: `pullWithPreview()` previously returned as soon as it handed off to `DiffModal.show()`, clearing `_syncRemoteChangeActive` before the user had applied or cancelled. A new push triggered while the DiffModal was open (e.g., from another tab broadcast or user action) would not be blocked. The fix makes `pullWithPreview()` await the DiffModal user action in both the manifest-first and vault-first paths before returning, so `_syncRemoteChangeActive` stays `true` until the pull is fully applied. Similarly, `showRestorePreviewModal()` now returns a `Promise<void>` (resolved on Apply or Cancel) instead of a boolean, enabling callers to await it. It returns `null` only when DiffModal is unavailable.

**Both devices must be on v3.32.24+.** A device on v3.32.23 will still exhibit the original debounce-race bug on its own debounced push, even if the other device is updated.

---

## Keep Mine Conflict Resolution Infinite Loop (fixed v3.33.32, STAK-403)

**Symptom:** Choosing to overwrite the remote vault caused the conflict resolution flow to immediately re-trigger, preventing the user from ever overwriting the remote vault.

**Root cause:** The Layer 0 pre-push check (added in STAK-398) downloads and inspects remote metadata before every push. When the user chose to overwrite, the resulting `pushSyncVault()` call hit Layer 0, detected the same unacknowledged remote change the user had just dismissed, and re-routed to `handleRemoteChange()` — triggering the conflict flow again in a loop.

**Fix (v3.33.32):** A module-level one-shot flag `_syncConflictUserOverride` is set `true` at call sites that represent explicit user intent to overwrite. At the start of the Layer 0 try block the flag is snapshot-and-cleared; if the snapshot is `true` the conflict check is bypassed and the push proceeds. See the "Keep Mine / Push My Data — conflict bypass flag" section under Conflict Resolution for full details.

---

## Related Pages

- `storage-patterns.md` — `saveData()` / `loadData()` patterns, `ALLOWED_STORAGE_KEYS`, `SYNC_SCOPE_KEYS`
- `backup-restore.md` — ZIP backup, encrypted vault, image vault, cloud sync coverage matrix

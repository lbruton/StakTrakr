---
title: "StakTrakr — Cloud Sync"
project: StakTrakr
audience: agent
canonical: .context/cloud-sync.md
source: "DocVault/Projects/StakTrakr/Foundation/cloud-sync.md" # migrated 2026-08-12
updated: "2026-06-21"
---

# StakTrakr — Cloud Sync

Foundation reference for the cloud sync subsystem. This document synthesizes ../Depreciated/Cloud Sync and ../Depreciated/Backup & Restore into a single authoritative source for agents working on `js/cloud-sync.js` and `js/cloud-storage.js`.

> **Codex review gate:** All `cloud-sync.js` patches require Codex peer review before merge (per CLAUDE.md). The atomic rollback pattern (snapshot → apply → compensate on failure) must be preserved in any sync loop modification.

---

## Overview

StakTrakr supports Dropbox-based cloud sync that automatically pushes an encrypted vault snapshot whenever inventory changes, and polls for remote updates on other devices.

The active provider is `dropbox` (`_syncProvider = 'dropbox'`). pCloud and Box are defined in `CLOUD_PROVIDERS` but are not production-ready — folder creation and upload code exists but token exchange is incomplete.

### Source Files

| File                  | Role                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `js/cloud-sync.js`    | Auto-sync orchestration: push/pull, polling loop, conflict resolution, manifest generation, multi-tab coordination, password management |
| `js/cloud-storage.js` | Provider layer: OAuth flow, token storage/refresh, manual backup upload/download, vault list/delete, activity log, cloud UI rendering   |
| `js/vault.js`         | AES-256-GCM encryption/decryption for vault and image vault files                                                                       |

`cloud-sync.js` depends on `cloud-storage.js` for token operations (`cloudGetToken`, `cloudIsConnected`, `cloudStoreToken`). `cloud-storage.js` has a one-way runtime dependency on `cloud-sync.js`: `cloudDisconnect()` reaches across to `scheduleSyncPush.cancel()` to prevent a queued push from firing after disconnect.

---

## Dropbox File Layout

Active sync uses `/StakTrakr/sync/`. Auto-backups go to `/StakTrakr/backups/`.

| File                     | Path                                                          | Purpose                                                                                                                       |
| ------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Inventory vault          | `/StakTrakr/sync/staktrakr-sync.stvault`                      | Sync-scoped encrypted vault (inventory + display prefs)                                                                       |
| Image vault              | `/StakTrakr/sync/staktrakr-images.stvault`                    | `userImages` IDB blobs (base64), user photos only                                                                             |
| Attachment vault         | `/StakTrakr/sync/staktrakr-attachments.stvault`               | `userAttachments` IDB blobs (PDF/PNG/JPG), opt-out via `syncAttachments` toggle (STRK-45)                                     |
| Item-price-history vault | `/StakTrakr/sync/staktrakr-item-price-history.stvault`        | Per-Item price history (`item-price-history`), always-on, UUID-aware union merge (STRK-147)                                   |
| Metadata pointer         | `/StakTrakr/sync/staktrakr-sync.json`                         | `rev`, `itemCount`, `syncId`, `deviceId`, `imageVault` hash, `itemPriceHistoryVault` `{hash,uuidCount,entryCount}` (STRK-147) |
| Manifest                 | `/StakTrakr/sync/staktrakr-sync.stmanifest`                   | Encrypted field-level change log for diff-merge                                                                               |
| Pre-push backups         | `/StakTrakr/backups/pre-sync-TIMESTAMP.stvault`               | Auto-backups before each vault overwrite (`SYNC_BACKUP_PREFIX`)                                                               |
| Manual backups           | `/StakTrakr/backups/staktrakr-backup-YYYYMMDD-HHmmss.stvault` | User-initiated vault backups (`MANUAL_BACKUP_PREFIX`)                                                                         |

> **Legacy paths:** Flat-root paths (`/StakTrakr/staktrakr-sync.*`) are retained as `*_LEGACY` constants in `js/constants.js` for migration only. `cloudMigrateToV2()` runs once per device (guarded by `cloud_sync_migrated === 'v2'` in localStorage) to move existing files.

---

## Encryption

### Algorithm

AES-256-GCM with PBKDF2 key derivation (600K iterations, SHA-256). Binary `.stvault` files use a 56-byte header containing salt, IV, and version.

### Key Derivation — Two Modes

#### Unified Mode (default)

The encryption key combines the user-chosen vault password with the Dropbox account ID:

```text
key = vaultPassword + ':' + accountId
```

- Both `cloud_vault_password` and `cloud_dropbox_account_id` are required.
- `getSyncPasswordSilent()` returns `null` on a new device until the user enters the password at least once — this triggers `getSyncPassword()` which opens the password modal.
- After first entry, the password is cached in `cloud_vault_password` (localStorage) so subsequent page loads are silent.
- **Zero-knowledge:** Dropbox OAuth access alone is insufficient to decrypt the vault.

#### Simple Mode (legacy migration only)

```text
key = STAKTRAKR_SIMPLE_SALT + ':' + accountId
```

- Only applies when `cloud_sync_mode === 'simple'` is present in localStorage.
- `STAKTRAKR_SIMPLE_SALT` is a fixed hex string baked into `js/cloud-sync.js`.
- Any device with the same Dropbox OAuth token can derive the key — weaker security.
- `cloud_sync_mode === 'simple'` will be removed after v3.33. Devices on this mode silently re-encrypt to Unified mode on the next push once a password is set.

### Key Derivation Flow

```text
getSyncPasswordSilent()
  ├─ vaultPw + accountId present → return vaultPw + ':' + accountId   (Unified)
  ├─ accountId only + cloud_sync_mode==='simple' → return SALT + ':' + accountId  (Simple migration)
  └─ null → caller must call getSyncPassword() to open the password modal
```

`getSyncPassword()` checks `getSyncPasswordSilent()` first. If null, opens `cloudSyncPasswordModal`. On confirm, re-reads `cloud_dropbox_account_id` — if still absent, an in-modal error is displayed and the modal stays open; if present, writes `cloud_vault_password` to localStorage and resolves the composite key.

### What Is Encrypted

| Vault type                 | Scope function              | Contents                                                                                                           |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Sync vault                 | `vaultEncryptToBytesScoped` | `SYNC_SCOPE_KEYS` only: inventory, item tags, tag tombstones/timestamps, display prefs, `chipMinCount`, API config |
| Full vault (manual backup) | `vaultEncryptToBytes`       | All `ALLOWED_STORAGE_KEYS` minus `VAULT_EXCLUDE_KEYS`                                                              |
| Image vault                | `vaultEncryptImageVault`    | `userImages` IDB records as base64                                                                                 |

**`VAULT_EXCLUDE_KEYS`** (16 keys excluded from full exports): OAuth tokens (`cloud_token_dropbox`, `cloud_token_pcloud`, `cloud_token_box`), `cloud_dropbox_account_id`, `cloud_dropbox_email`, `cloud_dropbox_display_name`, `cloud_vault_password`, `cloud_sync_device_id`, `cloud_sync_cursor`, `cloud_sync_last_push`, `cloud_sync_last_pull`, `cloud_sync_override_backup`, `cloud_sync_mode`, `cloud_sync_local_modified`, `cloud_sync_migrated`, `staktrakr_oauth_result`.

---

## OAuth Flow

### Dropbox PKCE Flow

1. `cloudAuthStart(provider)` — opens OAuth popup with PKCE parameters. Must be called from a click handler to avoid popup blockers. Optional `forceReauth: true` adds `force_reauthentication=true` to the URL (forces account picker; used by Switch Account).
2. `cloudExchangeCode(code, state)` — exchanges OAuth code for access/refresh tokens. Validates `state` against `sessionStorage` before exchange. Always calls `/2/users/get_current_account` after exchange to fetch and store `email` and `display_name` in localStorage.
3. `cloudCheckOAuthRelay()` — fallback relay handler when popup loses `window.opener`. Reads `staktrakr_oauth_result` from localStorage, validates `data.state` against `sessionStorage.getItem('cloud_oauth_state')` before calling `cloudExchangeCode`. Rejects with a CSRF warning on mismatch — **`cloudExchangeCode` is never called on state mismatch**.

### Token Storage

Tokens are stored in `cloud_token_<provider>` as JSON: `{access_token, refresh_token, expires_at}`.

`cloudGetToken(provider)` returns a valid access token, attempting refresh if expired (with a 60s buffer). On refresh failure, the token is cleared and `null` is returned.

### Multi-Account UX (STAK-449)

- **Account identity display**: `cloud_dropbox_email` and `cloud_dropbox_display_name` are stored after token exchange and displayed in the Cloud settings card.
- **Switch Account button**: Calls `cloudDisconnect(provider)` then `cloudAuthStart(provider, { forceReauth: true })`.
- **Sign out link**: Opens `https://www.dropbox.com/logout` in a new tab. Does not affect StakTrakr OAuth state.

---

## Sync Flow

### Push (inventory → Dropbox)

Triggered by `scheduleSyncPush()` (debounced, 2000ms) from `saveInventory()`.

```text
saveInventory()
  └─ scheduleSyncPush()   ← debounced 2000ms
       └─ pushSyncVault()
            ├─ Guard: window._initFailed → return early (STAK-485)
            ├─ Guard: syncIsEnabled() + _syncIsLeader + token + getSyncPasswordSilent()
            ├─ Empty-vault guard: if local is empty, check remote — block push if remote has items
            ├─ cloudMigrateToV2() if not yet migrated
            ├─ Backup-before-overwrite: copy existing vault to /backups/pre-sync-<ts>.stvault
            ├─ vaultEncryptToBytesScoped() or vaultEncryptToBytes()
            ├─ Upload: /sync/staktrakr-sync.stvault (overwrite)
            ├─ Image vault (5-way condition chain, STAK-497):
            │    ├─ Local photos + hash changed → upload + log success
            │    ├─ Local photos + hash unchanged → skip (carry forward meta)
            │    ├─ No local photos + remote metadata has imageVault → preserve remote reference
            │    ├─ No local photos + no remote + lastPush.imageHash set → delete remote (genuine deletion)
            │    └─ No local photos + no remote + no lastPush.imageHash → skip
            ├─ Upload: /sync/staktrakr-sync.json (metadata pointer)
            ├─ buildAndUploadManifest() — field-level changelog (non-fatal)
            ├─ syncSetLastPush() + syncSetCursor()
            ├─ Auto-prune old sync backups: cloudPruneBackups(provider, max, 'sync')
            └─ Broadcast sync-push-complete to other tabs
```

Rate limiting: exponential backoff doubles `_syncRetryDelay` on each HTTP 429, caps at 5 minutes. Resets to `SYNC_POLL_INTERVAL` on success.

### Poll (check for remote changes)

`pollForRemoteChanges()` runs on a `setTimeout` loop:

```text
pollForRemoteChanges()
  ├─ Guard: window._initFailed → return early (STAK-485)
  ├─ Guard: syncIsEnabled() + _syncIsLeader + !document.hidden + token
  ├─ Guard: cloud_dropbox_account_id present (toast + return if missing)
  ├─ Download: /sync/staktrakr-sync.json
  ├─ Legacy fallback: if 404/409, retry at SYNC_META_PATH_LEGACY
  ├─ Echo detection: if remoteMeta.deviceId === getSyncDeviceId() → skip
  ├─ No change: if remoteMeta.syncId === lastPull.syncId → skip
  ├─ Hash check: if inventoryHash matches local → record pull silently
  └─ handleRemoteChange(remoteMeta)
```

### Remote Change Handling

`handleRemoteChange()` routes all remote changes directly to `pullWithPreview()`:

```text
handleRemoteChange(remoteMeta)
  ├─ Defer if password prompt is active
  ├─ _syncRemoteChangeActive = true   ← set here via try/finally; DO NOT set at call sites
  ├─ scheduleSyncPush.cancel()   ← CRITICAL: prevents vault overwrite race
  ├─ await pullWithPreview(remoteMeta)
  └─ finally: _syncRemoteChangeActive = false   ← clears only after pull is fully applied
```

> `showSyncUpdateModal` and `showSyncConflictModal` were removed in STAK-413. DiffModal is the sole review UI for all remote sync changes.

### Pull (Dropbox → inventory)

`pullWithPreview()` is the primary entry point:

```text
pullWithPreview(remoteMeta)
  ├─ Guard: window._initFailed → return early (STAK-485)
  ├─ Guard: cloud_dropbox_account_id present (toast + return if missing)
  ├─ getSyncPasswordSilent() or getSyncPassword()
  │
  ├─ Manifest-first path (preferred):
  │    ├─ Download staktrakr-sync.stmanifest
  │    ├─ decryptManifest() → build diff from changelog entries
  │    ├─ DiffEngine.compareSettings(localSettings, manifest.settings)
  │    │
  │    ├─ STAK-387: No item changes AND no settings/tag changes
  │    │    → pull image vault if hash differs → syncSetLastPull() → return silently
  │    │
  │    ├─ STAK-470: No item changes AND ALL non-tag settings diffs are one-sided
  │    │    → auto-merge: apply remote-only keys; keep local-only keys; queue push
  │    │    → pull image vault if hash differs → return (no DiffModal shown)
  │    │
  │    ├─ Tag-only manifests → apply `_mergeTagData()` silently, record pull, return
  │    └─ DiffModal shown for item/non-tag settings conflicts; await user Apply or Cancel before returning
  │
  └─ Vault-first fallback (if manifest unavailable):
       ├─ Download staktrakr-sync.stvault
       ├─ vaultDecryptToData() → DiffEngine.compareItems() + compareSettings()
       ├─ itemTags, itemRemovedTags, itemTagsLastModified excluded from settings diff (tag merge handles them)
       ├─ Empty diff guard: pull image vault + return silently
       └─ await showRestorePreviewModal(); pull image vault after apply
```

`pullSyncVault()` is the lower-level restore (full overwrite, no preview). **Its token guard THROWS before the internal try/catch — all callers must `.catch()`.**

---

## Conflict Resolution

### Default: DiffModal for all remote changes

`handleRemoteChange()` routes all remote changes to `pullWithPreview()`, which presents the DiffModal. The user chooses Apply or Cancel.

### Silent Auto-Merge Exceptions (no DiffModal)

Two cases resolve without user interaction inside the manifest-first path:

1. **STAK-387 — no changes at all:** Manifest confirms no item or settings changes. Pull recorded silently.
2. **STAK-470 — version-upgrade settings drift:** No item changes, and every non-tag settings diff is one-sided (key exists on only one side). Remote-only keys are applied immediately; local-only keys kept and a push queued. If any key has genuine values on both sides, STAK-470 is skipped and DiffModal shown normally.
3. **STRK-108 — tag-only changes:** No item changes and only tag scope keys changed. `_mergeTagData()` applies the timestamp merge silently and records the pull without showing DiffModal.

### Keep Mine / Push My Data Bypass Flag (STAK-403)

A module-level one-shot flag `_syncConflictUserOverride` (line 36 of `cloud-sync.js`) prevents the infinite conflict loop that occurred when "Keep Mine" triggered a `pushSyncVault()` that re-detected the same unacknowledged remote change.

**Pattern:**

```js
// At the top of the Layer 0 try block — snapshot-and-clear atomically:
var _prePushOverride = _syncConflictUserOverride;
_syncConflictUserOverride = false; // cleared before any async work

// After remote metadata check:
if (_prePushOverride) {
  // bypass conflict routing — fall through to push
} else if (
  prePushMeta.deviceId !== myDeviceId &&
  (!lastPull || lastPull.syncId !== prePushMeta.syncId)
) {
  // normal conflict routing
}
```

The flag is consumed (cleared) at the top of the next `pushSyncVault()` call regardless of outcome — no permanent bypass accumulates.

### Override Backup (Pre-Pull Snapshot)

`syncSaveOverrideBackup()` snapshots all `SYNC_SCOPE_KEYS` raw strings to `cloud_sync_override_backup` in localStorage before every pull. `syncRestoreOverrideBackup()` restores the pre-pull snapshot with an `appConfirm()` dialog. Only clears scope keys if the snapshot is non-empty — an empty snapshot is treated as corruption.

---

## Atomic Rollback Pattern

> **This pattern is a hard invariant. Do not modify the settings write loop without preserving it.**

Implemented in `_applyAndFinalize()` (vault-first pull apply path, STAK-526):

```text
_applyAndFinalize():
  1. Snapshot inventory: const _prevInventory = inventory
  2. Settings write loop:
     a. null guard: if (!sc || !sc.key) continue
     b. ALLOWED_STORAGE_KEYS guard: if (!ALLOWED_STORAGE_KEYS.includes(sc.key)) continue
     c. Try localStorage.setItem(sc.key, sc.value)
     d. On success: _appliedKeys.push(sc.key), _appliedCount++
     e. On failure: _failedKeys.push(sc.key), _failedCount++
  3. If _failedCount > 0:
     a. inventory = _prevInventory  (rollback)
     b. forEach _appliedKeys: localStorage.removeItem(key)  (compensate)
     c. logCloudSyncActivity('partial', ...)
     d. return early — do NOT call syncSetLastPull() or broadcast success
  4. If _failedCount === 0:
     a. saveInventory() + syncSetLastPull() + broadcast success
```

Both the STAK-470 auto-merge path and `_applyAndFinalize()` enforce the same three guards before any settings write:

**null guard → `ALLOWED_STORAGE_KEYS` check → `_failedCount` tracking with atomic rollback on failure**

### ALLOWED_STORAGE_KEYS Guard

The guard `typeof ALLOWED_STORAGE_KEYS !== 'undefined'` is **intentional defensive coding** — the constant IS defined in `js/constants.js` (`ALLOWED_STORAGE_KEYS`). Automated reviewer flags on this are false positives. Do not remove the guard.

---

## Auto-Sync Triggers and ALLOWED_STORAGE_KEYS

`scheduleSyncPush` is a debounced (2000ms) wrapper around `pushSyncVault`, exposed on `window` so `saveInventory()` can call it. Every public sync entry point (`initCloudSync`, `pushSyncVault`, `pullSyncVault`, `pollForRemoteChanges`, `scheduleSyncPush`) checks `window._initFailed` as its first guard and returns early with a console warning if true (STAK-485).

`SYNC_SCOPE_KEYS` defines what auto-sync includes: inventory, item tags, tag tombstones (`itemRemovedTags`), per-item tag timestamps (`itemTagsLastModified`), the item-price-history clear watermark (`itemPriceHistoryClearedAt` — STRK-223), display preferences, `chipMinCount`, `metalApiConfig` (spot provider keys), and `catalog_api_config` (Numista/PCGS keys — added STAK-533). Auto-sync intentionally excludes OAuth tokens, spot price history, and device-specific state.

**Volatile-subfield exclusion (STRK-313, v3.35.81; extended STRK-315, v3.35.82):** **two** synced blobs carry per-device usage counters alongside credentials, and both are stripped before change detection.

| Key                  | Volatile fields                      | Strip shape                                                                   |
| -------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| `catalog_api_config` | `numistaUsage`, `pcgsUsage`          | whole objects dropped — they are purely volatile                              |
| `metalApiConfig`     | `usage[provider].used`, `usageMonth` | **nested** — `used` dropped, `quota` KEPT (user-editable via the quota modal) |

Both change-detection layers strip them before comparing — `computeSettingsHash` via `_stripVolatileSettingFields` (cloud-sync.js) and `DiffEngine.compareSettings` via `_normalizeSettingForCompare` (diff-engine.js). **These twins must be updated together**: if only one learns about a new volatile field, the hash and the diff disagree and the Review Sync Changes modal opens with zero rows in it.

`metalApiConfig` was the more damaging of the two. STAKTRAKR is the keyless provider (`requiresKey: false`) and `autoRefresh` defaults on, so `usage.STAKTRAKR.used++` fires on **every app boot even when the user has saved no API keys at all** — two devices diverged within a session or two and the modal opened every time. STRK-313 fixed only the catalog store, so the symptom persisted until STRK-315.

On a genuine credential apply, each blob merges its counters so applying a change never under-reports quota consumption:

- `_mergeCatalogUsageCounters` — `max(used)` within the same period, per provider, **only when that provider's credential is unchanged**.
- `_mergeSpotUsageCounters` — `quota` always comes from `remote` in every branch. Remote in a later `usageMonth` → remote returned untouched. Local later → adopt local's `usageMonth`, and carry local's `used` per provider only when that provider's key is unchanged, else reset to `0` (a fresh credential in a fresh period must not inherit either side's count). Same month → `max(used)`, same credential gate. Keyless providers compare `"" === ""` and always count as unchanged.

The `changed` entries from `compareSettings` still carry the full original blob, so apply paths write counters through unchanged.

**Diff-modal display (STRK-315):** `unchanged` entries from `compareSettings` now carry `localVal`/`remoteVal` in the same shape as `changed` entries. Previously they emitted `{key, val}` while `diff-modal.js` read `mEntry.localVal` for both lists, so **every matched settings row rendered `undefined`** — "not set" for the masked API-key rows, "—" for everything else, regardless of what was actually stored. That false "not set" on a demonstrably configured Numista key is what sent STRK-313 after the wrong store. `metalApiConfig` is also relabeled **"Spot API Config"** (it holds twelve fields, only one of which is credentials) and renders provider + key count rather than a blanket `••• configured`.

### Tag Sync Merge (STRK-108)

Item tags are excluded from DiffModal settings comparisons and merge through `_mergeTagData()` instead of the generic settings write loop.

Tag mutations stamp `itemTagsLastModified[uuid]` with an ISO timestamp whenever a user adds, removes, renames, deletes, or bulk-imports tags. `itemRemovedTags[uuid]` is a tombstone map used to prevent older remote tag arrays from resurrecting locally removed tags.

On pull, remote tag scope keys are parsed from the encrypted vault or manifest settings and compared per UUID:

- If `remoteTimestamp > localTimestamp`, the remote tag array replaces the local tag array for that UUID.
- If the remote timestamp is older or equal, local tags win.
- Removed-tag tombstones merge by the same timestamp rule.
- Re-add wins locally: if a tag exists in the final tag array, any matching tombstone is removed.

All tag writes are part of the `_applyAndFinalize()` rollback surface. The function snapshots raw tag localStorage values before applying a pull, restores them if `_mergeTagData()` fails, and also restores them if a later settings write fails. After a successful tag merge, `loadItemTags()` refreshes the in-memory `itemTags` cache.

### Item-Price-History Companion Vault (STRK-147)

Per-Item price history (`item-price-history` — shape `{ [uuid]: [{ ts, itemName, retail, spot, melt }, ...] }`) syncs through a dedicated, **always-on** encrypted companion vault (`SYNC_ITEM_PRICE_HISTORY_PATH`), modeled on the image vault — **not** `SYNC_SCOPE_KEYS`. The LWW settings path would silently drop entries recorded on a second device; history is append-only and must merge by **union**. It stays in `ALLOWED_STORAGE_KEYS` (cleanup + manual backup) but is never added to `SYNC_SCOPE_KEYS`.

**Push.** When the companion hash differs from the remote pointer (or remote meta is absent), `collectAndHashItemPriceHistory()` canonicalizes → hashes → `vaultEncryptItemPriceHistory()` (AES-256-GCM) → uploads to the `.stvault` path. A `{hash, uuidCount, entryCount}` pointer is attached to `metaPayload.itemPriceHistoryVault`; the full history JSON never enters the change-detection manifest. A debounced `scheduleSyncPush()` call inside `saveItemPriceHistory()` makes history-only changes sync even when inventory is unchanged.

**Merge.** `mergeItemPriceHistories(local, remote, acceptedUuids)` (`js/priceHistory.js`) is a pure, commutative, idempotent fingerprint-union: UUID-keyed union; remote filtered to `acceptedUuids`; entries deduped by **full fingerprint** (`ts, itemName, retail, spot, melt`) so equal-`ts` distinct snapshots survive while exact duplicates collapse; output canonicalized (sorted UUIDs + full-fingerprint comparator) so `merge(A,B) === merge(B,A)`; the retention cap (`applyItemPriceRetention`, 365d / 1000 per UUID) is applied **after** merging. The ZIP-restore `mergeItemPriceHistory()` (ts-only dedupe) is intentionally left unchanged (manual-restore behavior preserved).

**Pull (six companion-pull call sites).** The companion vault is fetched only when its remote hash ≠ `lastPull.itemPriceHistoryHash`, then merged. The hash check is wired into every pull path so a companion-only remote change is never missed: the **poll hash-shortcut** (`_pollCompanionItemPriceHistory()`), **manifest-first silent-pull**, **manifest-first deferred** (`_deferredVaultRestore` `newInv` boundary), **vault-first silent-pull**, **vault-first post-apply** (post-apply inventory UUIDs), and — since STRK-224 — the **STAK-470 settings-only version-upgrade auto-merge** branch (which has no companion call of its own and previously relied on the poll pre-merge). Each path supplies the accepted-inventory `acceptedUuids` boundary, so a remote Item rejected in the DiffModal imports **no orphan history**.

**STRK-224 (v3.35.40) — Edge 1, cancel semantics.** The poll hash-shortcut previously pre-merged the companion **unconditionally**, ahead of `handleRemoteChange()`, so a Cancel on a DiffModal that _also_ carried companion changes could not undo the merge. The pre-merge now runs **only on the no-modal poll exits** — the silent fast-path and the STAK-414 local-newer branch; when the poll routes to the DiffModal, the merge is deferred to `pullWithPreview`'s STRK-225 `_vfApplied`-gated companion pull (Apply merges, Cancel skips). A companion-**only** change (no inv/settings diff → no DiffModal) still merges silently on the fast-path (preserved as an explicit non-regression guard).

**Partial-failure safety.** The merge persists via a throwing write path (`writeItemPriceHistoryStrict()`) — unlike `saveItemPriceHistory()`, which swallows `saveDataSync` errors. On a write failure (e.g. quota), `lastPull` (incl. `itemPriceHistoryHash`) is **not** advanced and a partial/error state is recorded, so the next poll retries. Shipped in **v3.35.26** (PR #1285).

**STRK-224 (v3.35.40) — transient-failure & post-apply retry.** Two further watermark-advance gaps were closed. _Edge 2:_ a transient companion download/decrypt failure is non-throwing but previously returned the same `{hash:null, skipped:false}` shape as a benign precondition-miss no-op, so the watermark advanced and the `lastPull.syncId === remoteMeta.syncId` poll shortcut then blocked the retry. `_pullItemPriceHistoryVault` now returns an explicit `failed` flag (set **only** on the two transient returns — download `!resp.ok` and decrypt-catch); every call site declines to advance `lastPull` when it is set. _Edge 3:_ in the manifest-first (`_deferredVaultRestore`) and vault-first (`pullWithPreview`) apply paths, `_applyAndFinalize` records `syncId` **before** the post-apply companion write, so a write throw left `syncId` falsely advanced. Both paths now snapshot the full prior `lastPull` before the apply and restore it on a companion failure/throw, so the next poll retries. The merge algorithm is unchanged — only _when_ and _whether_ the watermark advances.

**STRK-223 (v3.35.41) — propagating a "clear all".** Clearing all history is the one mutation the union merge cannot express (it only adds), so a clear on one device never reached the others. The fix is a synced tombstone: a new scalar **`itemPriceHistoryClearedAt`** (ms timestamp) that — unlike the companion vault data — **is** in `SYNC_SCOPE_KEYS`, riding the main vault like `itemTagsLastModified`. `clearItemPriceHistory()` stamps `Date.now()`; `applyItemPriceRetention()` then drops every entry with `ts <= clearedAt` on every save/merge/strict-write, so the clear converges through the existing commutative merge (a fresh device's `clearedAt` of 0 drops nothing; entries recorded _after_ the clear survive). **Push:** when local history is empty **and** the watermark post-dates the remote companion's last write, the push deletes the `.stvault` (`files/delete_v2`, mirroring the STAK-426 image path) and drops the pointer; a fresh/empty device with no watermark still preserves a populated remote companion. **Receive:** like the tag keys, the watermark is excluded from the blind settings-overwrite (`_isManagedSyncKey`, applied at all five settings-diff/apply sites) and reconciled by `_mergeItemPriceClearWatermark()` — a max-arbitration (an older remote can never un-clear a newer local watermark) that applies the drop immediately even when no companion is pulled. It is wired at both tag-merge chokepoints (`_applyAndFinalize` via the new `remoteRawSettings` option, and the manifest one-sided path) and is idempotent, so the deliberate double-coverage is safe. Cancel-safety is inherited: the hook only runs on apply paths, never on a cancelled preview (the `_vfApplied` gate). Shipped in **v3.35.41** (PR #1313).

---

## Multi-Tab Coordination

`initSyncTabCoordination()` sets up a `BroadcastChannel('staktrakr-sync')` for leader election:

- Oldest open tab (lowest `_syncTabOpenedAt` timestamp) wins leadership.
- Only the leader tab polls and pushes. `_syncIsLeader` guards both `pushSyncVault()` and `pollForRemoteChanges()`.
- If the leader tab is hidden for >60 seconds, leadership is released.
- When a tab becomes visible again it reclaims leadership if no other leader is present.
- On push/pull complete, the leader broadcasts `sync-push-complete` or `sync-pull-complete` so other tabs refresh UI without duplicate operations.
- Falls back gracefully to "every tab is leader" when `BroadcastChannel` is unavailable (Safari < 15.4).

---

## Backup and Restore

### Post-Restore UI Refresh (STAK-517)

`restoreVaultData()` in `js/vault.js` is the final step of both the manual vault restore path (`vaultDecryptAndRestore`) and the vault-first fallback path in `vaultRestoreWithPreview` (when DiffEngine/DiffModal is unavailable). After writing localStorage keys and reloading inventory, its UI refresh block calls:

1. `loadInventory()` + `renderTable()` + `renderActiveFilters()` + `loadSpotHistory()` + `fetchSpotPrice()`
2. `_invalidateMarketFilterCache()` — clears the in-memory market filter cache in `retail.js`
3. `renderMarketFilterMatrix()` — re-renders the Market Filter Matrix in Settings to reflect the restored `staktrakr.market_filter` localStorage value

This means a vault restore or cloud sync pull that writes `staktrakr.market_filter` will reflect the restored state immediately without a page reload. `restoreVaultData` is also exposed as `window.restoreVaultData` for Playwright testing.

> **Note:** The cloud sync auto-merge and `_applyAndFinalize()` paths (manifest-first and vault-first DiffModal paths) do not call `restoreVaultData` — they call `saveInventory()` directly. Market filter cache invalidation only applies to the `restoreVaultData` code path.

---

### Four Backup Mechanisms

| Mechanism        | Format     | Encrypted           | Trigger                                                                              |
| ---------------- | ---------- | ------------------- | ------------------------------------------------------------------------------------ |
| ZIP Backup       | `.zip`     | No                  | Settings → "Backup All Data"                                                         |
| Encrypted Vault  | `.stvault` | Yes (AES-256-GCM)   | Settings → Vault → "Export Vault"                                                    |
| Image Vault      | `.stvault` | Yes (AES-256-GCM)   | Cloud auto-sync (automatic)                                                          |
| Attachment Vault | `.stvault` | Yes (AES-256-GCM)   | `staktrakr_backup_{ts}-attachments.stvault` companion alongside main vault (STRK-45) |
| Cloud Sync       | Dropbox    | Yes (vault-wrapped) | Settings → Cloud → Auto-sync toggle                                                  |

No single mechanism backs up everything. Full recovery requires combining mechanisms (ZIP + vault, or vault + image vault + attachment vault).

**Attachment sync opt-out (STRK-45):** The `syncAttachments` localStorage key (default: `true` when absent) controls whether attachment binaries traverse the cloud sync channel. When `false`, item metadata still syncs but blobs are skipped. When total attachment size exceeds `SYNC_ATTACHMENT_SIZE_WARN_BYTES` (default 100 MB), a one-time warning prompts the user to confirm or opt out (`syncAttachmentsWarnSeen` key gates the prompt).

### Manual Cloud Backup vs Auto-Sync

| Aspect                      | Manual Backup                        | Auto-Sync                                  |
| --------------------------- | ------------------------------------ | ------------------------------------------ |
| Vault scope                 | Full (`ALLOWED_STORAGE_KEYS`)        | Sync-scope (`SYNC_SCOPE_KEYS`) only        |
| Pointer file                | None (`skipLatestUpdate: true`)      | `staktrakr-sync.json`                      |
| `cloud_last_backup` written | No                                   | Yes                                        |
| Password caching            | Disabled — always prompts            | Cached via `cloudCachePassword`            |
| Auto-pruning                | Never                                | `cloudPruneBackups(provider, max, 'sync')` |
| Image vault                 | Optional ("Include photos" checkbox) | Pushed when `userImages` hash changes      |

### Backup Isolation (STAK-419)

Manual backups (`staktrakr-backup-` prefix) and sync snapshots (`pre-sync-` prefix) share the `/StakTrakr/backups/` folder but are distinguished by filename prefix. `cloudListBackups(provider, type)` filters by prefix. `cloudPruneBackups` defaults to `type='sync'` — manual backups are never auto-pruned.

### Coverage Matrix

| Data                                      | ZIP | Full Vault | Image Vault |  Cloud Auto-Sync  |
| ----------------------------------------- | :-: | :--------: | :---------: | :---------------: |
| Inventory items                           | Yes |    Yes     |     No      | Yes (sync scope)  |
| CDN image URLs                            | Yes |    Yes     |     No      |        Yes        |
| User-uploaded photo blobs                 | Yes |     No     |     Yes     | Yes (conditional) |
| Pattern rule image blobs                  | Yes |     No     |     No      |        No         |
| Numista metadata cache                    | Yes |     No     |     No      |        No         |
| API keys                                  | No  |    Yes     |     No      |        No         |
| OAuth tokens                              | No  |     No     |     No      |        No         |
| Spot history (`metalSpotHistory`)         | No  |     No     |     No      |        No         |
| Retail history (`v2RetailHistory`)        | No  |     No     |     No      |        No         |
| Item price history (`item-price-history`) | Yes |    Yes     |     No      |        No         |

Full recovery requires BOTH a ZIP (for IDB blobs) AND a vault (for localStorage including API keys).

**Market-history backup scope (STRK-141, v3.35.3):** Spot (`metalSpotHistory`) and retail (`v2RetailHistory`) history moved from localStorage to the `StakTrakrHistory` IndexedDB store (see architecture#IndexedDB Stores) and are now **excluded from both manual vault export and ZIP export** — they are API-reproducible, so there is no value in carrying them in a backup. Exclusion is driven by a dedicated `HISTORY_IDB_KEYS` skip set in `js/constants.js` (skipped on export **and** on restore — an older backup that still contains these keys is ignored, written to neither localStorage nor IDB), **not** by removing the keys from `ALLOWED_STORAGE_KEYS` (which stays the cleanup/fallback allowlist). `item-price-history` is **not** in the skip set, so it is still included in manual vault + ZIP backup (it is user-authored, not reproducible). **Cloud auto-sync scope is unchanged** — no market-history key was added to `SYNC_SCOPE_KEYS`; cross-device item-price sync is deferred to STRK-147.

### Encrypted Vault (.stvault) Binary Format

56-byte binary header: magic `"STVAULT"` (7 bytes) + format version (1 byte) + PBKDF2 iterations as uint32 big-endian (4 bytes) + salt (32 bytes) + IV (12 bytes). AES-256-GCM encrypted payload (ciphertext includes the 16-byte auth tag). PBKDF2 key derivation, 600K iterations, SHA-256.

### Image Vault Payload Shape

```json
{
  "_meta": { "appVersion": "3.33.x", "exportTimestamp": "...", "imageCount": 42 },
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

Hash tracking: `simpleHash(uuid + ':' + size + ':' + obverse.slice(0, 32))` — detects content changes even when file size is identical.

---

## Security Notes

### Console Output Sanitization (STAK-430)

- `cloud-sync.js` — `console.warn` calls never emit password values, key lengths, or hash values. `_logDecryptAttempt()` logs only boolean presence of `cloud_vault_password` and `'present'`/`'MISSING'` for `cloud_dropbox_account_id`.
- `cloud-storage.js` — account ID logged as `'present'`, never as a slice of the actual value.

### Pre-Decrypt Diagnostics Format

```text
[CloudSync] decrypt attempt: artifact=stvault vaultPw: true accountId: present candidates: 3
[CloudSync] decrypt attempt: artifact=metadata vaultPw: true accountId: MISSING candidates: 0
```

Fields: `artifact`, `vaultPw` (boolean), `accountId` (`'present'` or `'MISSING'`), `candidates` (count, 0 when accountId is missing).

### All Confirmations Use `appConfirm`

There are no `window.confirm` calls anywhere in `cloud-sync.js` or `cloud-storage.js`. All user confirmation dialogs — including the password-change blind-overwrite prompt — use `await appConfirm(..., 'Cloud Sync')`.

### Disconnect Cleanup (STAK-425, updated STAK-449)

`cloudDisconnect(provider)` removes all 15 cloud state keys (including `cloud_dropbox_email` and `cloud_dropbox_display_name`) except `cloud_kraken_seen`, `cloud_activity_log`, `cloud_backup_history_depth`, and `cloud_vault_idle_timeout`. It also cancels any pending `scheduleSyncPush` debounce.

---

## localStorage Keys

| Key                          | Purpose                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `cloud_vault_password`       | User vault password (Unified mode)                                                             |
| `cloud_dropbox_account_id`   | Dropbox account ID (required for key derivation)                                               |
| `cloud_dropbox_email`        | Dropbox account email (display only; excluded from vault exports)                              |
| `cloud_dropbox_display_name` | Dropbox display name (display only; excluded from vault exports)                               |
| `cloud_sync_mode`            | `'simple'` — deprecated, migration only, removed after v3.33                                   |
| `cloud_sync_enabled`         | `'true'` when auto-sync is active                                                              |
| `cloud_sync_device_id`       | Stable per-device UUID                                                                         |
| `cloud_sync_last_push`       | JSON: `{syncId, timestamp, rev, itemCount, imageHash?}`                                        |
| `cloud_sync_last_pull`       | JSON: `{syncId, timestamp, rev, imageHash?}`                                                   |
| `cloud_sync_cursor`          | Last-seen remote revision (from Dropbox vault upload response `.rev`)                          |
| `cloud_sync_override_backup` | JSON snapshot of `SYNC_SCOPE_KEYS` taken before a pull                                         |
| `cloud_sync_migrated`        | `'v2'` when flat-layout migration is complete                                                  |
| `cloud_token_<provider>`     | JSON: `{access_token, refresh_token, expires_at}`                                              |
| `cloud_last_backup`          | JSON: last backup metadata (sync ops only; manual backups do not update this)                  |
| `cloud_activity_log`         | JSON array: cloud activity entries (max 500, 180-day TTL)                                      |
| `cloud_kraken_seen`          | `'true'` after first successful backup (suppresses easter-egg toast)                           |
| `itemRemovedTags`            | JSON map of item UUID to removed tag tombstones used by cloud sync tag merge                   |
| `itemTagsLastModified`       | JSON map of item UUID to last tag mutation timestamp used for per-item tag conflict resolution |

---

## Error Handling Patterns

| Function                           | Error Behavior                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pushSyncVault()`                  | All errors caught internally; sets status indicator to `'error'`; returns silently. No caller catch required. |
| `pullSyncVault()`                  | Token guard **THROWS** before internal try/catch. All callers **must** `.catch()`.                            |
| `pullWithPreview()`                | Catches internally; falls back to `pullSyncVault()` on outer error. Awaits DiffModal before returning.        |
| `buildAndUploadManifest()`         | Non-blocking — failure does not prevent vault push. Must be called inside try/catch.                          |
| Image vault upload/download        | Non-fatal — caught with `console.warn`; inventory sync continues.                                             |
| 429 rate limiting                  | Exponential backoff; `_syncRetryDelay` doubles, caps at 5 minutes. Resets on success.                         |
| Missing `cloud_dropbox_account_id` | All pull/poll paths show toast and return early — no decrypt attempted.                                       |

---

## Known Bugs Fixed (Historical Reference)

### Vault Overwrite Race (fixed v3.32.24, extended v3.33.34, STAK-406)

The debounced push fired during or after a conflict modal, overwriting the remote vault before the pull could complete.

**Fix:** `handleRemoteChange()` calls `scheduleSyncPush.cancel()` before routing to `pullWithPreview()`. `pullWithPreview()` awaits the DiffModal user action before returning, keeping `_syncRemoteChangeActive = true` for the full duration.

### Keep Mine Infinite Loop (fixed v3.33.32, STAK-403)

Choosing to overwrite the remote vault triggered `pushSyncVault()`, which re-detected the same remote change and re-triggered the conflict flow.

**Fix:** `_syncConflictUserOverride` one-shot flag bypasses Layer 0 conflict check once when set explicitly by user intent.

### DIFF_FIELDS Silent Data Loss (fixed v3.33.75, STAK-493)

Items enriched with Numista image URLs on one device lost those URLs after syncing. `DIFF_FIELDS` only covered 16 of 30+ item fields; unlisted-field changes were invisible to `DiffEngine`.

**Fix:** `DIFF_FIELDS` expanded to cover the full `InventoryItem` schema (since grown to 45 fields). `logItemChanges()` field list matched to `DIFF_FIELDS` for manifest parity.

### API Key Destruction + storageLocation Sync Loop (fixed v3.33.91, STAK-519)

API keys in `metalApiConfig` became `[object Object]` after cloud sync. `_parseSetting()` JSON-parsed the localStorage string into a JS object; `localStorage.setItem` then coerced the object to the string.

**Fix:** Removed `_parseSetting()` from the whole-setting fallback path. Added a stringify guard in `_applyAndFinalize()`: `typeof val === 'string' ? val : JSON.stringify(val)`.

### Catalog API Keys Not Synced (fixed v3.33.94, STAK-533)

`catalog_api_config` was in `ALLOWED_STORAGE_KEYS` but not in `SYNC_SCOPE_KEYS`, so Numista/PCGS keys never synced across devices.

**Fix:** Added `catalog_api_config` to `SYNC_SCOPE_KEYS` and to DiffModal's `SETTINGS_GROUPS['API & Numista']`.

### Manifest Type Mismatch — Silent Item Edit Drop (fixed v3.34.84, STRK-101)

Manifest-first pulls silently dropped all item-level field edits. The changeLog producer wrote prefixed types (`"item-edit"`, `"item-add"`, `"item-delete"`) but four manifest consumer sites checked for unprefixed types (`"edit"`, `"add"`, `"delete"`). Since none matched, all item changes were classified as no-ops and the pull completed silently with no DiffModal.

**Affected consumer sites:** `_buildDiffFromManifest()` diff classification, `buildAndUploadManifest()` summary counting, manifest conflict detection (`mc.type === "edit"` guard), and implicitly the `_mNoChanges` guard that evaluates the classified arrays.

**Fix:** Added `_normalizeItemChangeType(type)` private helper that strips the `"item-"` prefix via `startsWith`. Wired to all four consumer sites. Added `_mergeItemChangeTypes(existing, incoming)` for chronological pairwise type-priority merge when multiple changeLog entries exist for the same item key within a sync window (`delete+add → add`, `add+delete → delete`, `edit+delete → delete`, `add+edit → add`). Write-side normalization at `changesByKey` grouping ensures new manifests carry clean types; read-side normalization at all consumer sites handles both old prefixed and new unprefixed manifests in Dropbox.

**Secondary fix:** ZIP export `inventory_data.json` allowlist expanded with 13 missing `DIFF_FIELDS` entries (`purchasePrice`, `retailPrice`, `collectable`, `ignorePatternImages`, `currency`, `obverseImageFrame`, `reverseImageFrame`, `lastModified`, `capsule`, `capsuleNotes`, `numistaData`, `fieldMeta`, `attachments`). Both ZIP CSV and standalone CSV exports gained `Obverse Frame` and `Reverse Frame` columns.

### Cloud Sync Tag Conflict Resolution (fixed v3.34.88, STRK-108)

Tag edits were vulnerable to one-sided overwrite behavior because `itemTags` was skipped by DiffModal but lacked a dedicated cloud merge path.

**Fix:** Added sync-scoped `itemRemovedTags` and `itemTagsLastModified` stores. Tag mutators stamp per-item timestamps, cloud pulls parse tag scope keys separately from generic settings, and `_mergeTagData()` resolves tags per UUID with remote-wins-only-if-newer semantics. Tag-only manifests now merge silently instead of being treated as no-op pulls.

---

## Common Mistakes

### Raw localStorage read for vault password

```js
// WRONG — breaks Simple-mode migration and Unified mode
var pw = localStorage.getItem("cloud_vault_password");

// CORRECT
var pw = getSyncPasswordSilent();
```

### New pull path without cancelling the debounced push

```js
// WRONG — vault overwrite race
async function myNewPullPath(remoteMeta) {
  await pullWithPreview(remoteMeta);
}

// CORRECT
async function myNewPullPath(remoteMeta) {
  if (typeof scheduleSyncPush === "function" && typeof scheduleSyncPush.cancel === "function") {
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
  updateSyncStatusIndicator("error", err.message);
});
```

### Calling push/poll without checking leadership

```js
// WRONG — bypasses multi-tab guard
await pushSyncVault();

// CORRECT
scheduleSyncPush(); // for inventory changes; includes _syncIsLeader check
```

### Setting `_syncRemoteChangeActive` at a call site

`_syncRemoteChangeActive` is managed exclusively by `handleRemoteChange()` via try/finally. Do not set it at call sites — if `handleRemoteChange()` throws before its own try block, the flag stays permanently `true` and blocks all future pushes.

### Assuming manifest path succeeds for all pulls

`pullWithPreview()` has two distinct paths: manifest-first (lightweight) and vault-first (full download). The manifest path is best-effort. Code that hooks into the pull flow must handle both paths.

---

## Related

- ../Depreciated/Cloud Sync — full source doc (auto-sync subsystem detail)
- ../Depreciated/Backup & Restore — full source doc (all four backup mechanisms)
- ../Depreciated/Storage Patterns
- Deep Dives/DOM Patterns

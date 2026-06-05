// =============================================================================
// CLOUD AUTO-SYNC — Real-Time Encrypted Inventory Sync (STAK-149)
// =============================================================================
//
// Automatic background sync: when inventory changes, pushes an encrypted
// .stvault to Dropbox. On other devices, a background poller detects the
// new file via staktrakr-sync.json and prompts the user to pull.
//
// Sync file:  /StakTrakr/sync/staktrakr-sync.stvault  (full encrypted snapshot)
// Metadata:   /StakTrakr/sync/staktrakr-sync.json     (lightweight pointer, polled)
// Backups:    /StakTrakr/backups/                      (pre-sync + manual backups)
//
// Depends on: cloud-storage.js, vault.js, constants.js, utils.js
// =============================================================================

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** @type {number|null} setInterval handle for the polling loop */
var _syncPollerTimer = null;

/** @type {boolean} Whether a push is currently in progress */
var _syncPushInFlight = false;

/** @type {boolean} Whether the sync password prompt is currently open */
var _syncPasswordPromptActive = false;

/** @type {boolean} Whether handleRemoteChange is actively running (blocks pushes) */
var _syncRemoteChangeActive = false;

/** @type {boolean} Whether vault password was just changed — skip pre-push metadata decryption */
var _syncPasswordJustChanged = false;

/** @type {boolean} Set true when user explicitly chose Keep Mine or Push My Data — bypasses the pre-push conflict re-detection exactly once. */
var _syncConflictUserOverride = false;

/** @type {number} Retry backoff multiplier for 429 / network errors */
var _syncRetryDelay = 2000;

/** @type {Function} Debounced version of pushSyncVault */
var scheduleSyncPush = null;

/** @type {string} Currently active sync provider */
var _syncProvider = "dropbox";

/** @type {BroadcastChannel|null} Multi-tab coordination channel */
var _syncChannel = null;

/** @type {boolean} Whether this tab is the sync leader */
var _syncIsLeader = false;

/** @type {number} Timestamp when this tab was opened (used for leader election) */
var _syncTabOpenedAt = Date.now();

/** @type {number|null} Timer for visibility-based leadership handoff */
var _syncLeaderHiddenTimer = null;

/** @type {object|null} Pull metadata stashed for deferred recording after preview apply */
var _previewPullMeta = null;

// ---------------------------------------------------------------------------
// Device identity
// ---------------------------------------------------------------------------

/**
 * Get or create a stable per-device UUID, persisted in localStorage.
 * @returns {string}
 */
function getSyncDeviceId() {
  var stored = localStorage.getItem("cloud_sync_device_id");
  if (stored) return stored;
  var id = typeof generateUUID === "function" ? generateUUID() : _syncFallbackUUID();
  try {
    localStorage.setItem("cloud_sync_device_id", id);
  } catch (_) {
    /* ignore */
  }
  return id;
}

/** Fallback UUID generator when generateUUID from utils.js is unavailable */
function _syncFallbackUUID() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, function (c) {
    return (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16);
  });
}

// ---------------------------------------------------------------------------
// Manifest helpers (Layer 4 — REQ-4)
// ---------------------------------------------------------------------------

/**
 * Convert a SHA-256 ArrayBuffer to a hex string.
 * Shared by computeInventoryHash and computeSettingsHash.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function sha256BufferToHex(buffer) {
  var hashArray = new Uint8Array(buffer);
  var hex = "";
  for (var j = 0; j < hashArray.length; j++) {
    hex += ("0" + hashArray[j].toString(16)).slice(-2);
  }
  return hex;
}

/**
 * Compute a deterministic SHA-256 hash of sorted item keys.
 * Returns hex string or null if hashing is unavailable (file:// protocol).
 * @param {object[]} items
 * @returns {Promise<string|null>}
 */
async function computeInventoryHash(items) {
  try {
    if (!crypto || !crypto.subtle || !crypto.subtle.digest) return null;
    var arr = Array.isArray(items) ? items : [];
    var keys = [];
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      var itemKey = typeof DiffEngine !== "undefined" ? DiffEngine.computeItemKey(item) : String(i);
      // Include a content fingerprint so field-level changes (image URLs,
      // numistaId, grade, disposition) produce a different hash even when
      // the item key (name+metal+weight+date) is unchanged.
      var contentSample =
        (item.obverseImageUrl || "") +
        "|" +
        (item.reverseImageUrl || "") +
        "|" +
        (item.numistaId || "") +
        "|" +
        (item.grade || "") +
        "|" +
        (item.tradedFromUuid || "") +
        "|" +
        (item.disposition ? JSON.stringify(item.disposition) : "");
      keys.push(itemKey + "::" + contentSample);
    }
    keys.sort();
    var joined = keys.join("|");
    var encoded = new TextEncoder().encode(joined);
    var hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
    return sha256BufferToHex(hashBuffer);
  } catch (e) {
    debugLog("[CloudSync] computeInventoryHash failed:", e.message);
    return null;
  }
}

/**
 * Summarize inventory by metal type.
 * @param {object[]} items
 * @returns {object} e.g. { gold: 12, silver: 45 }
 */
function summarizeMetals(items) {
  var result = {};
  var arr = Array.isArray(items) ? items : [];
  for (var i = 0; i < arr.length; i++) {
    var metal = arr[i].metal || "unknown";
    result[metal] = (result[metal] || 0) + 1;
  }
  return result;
}

/**
 * Compute total weight in troy ounces (weight * qty for each item).
 * @param {object[]} items
 * @returns {number}
 */
function computeTotalWeight(items) {
  var total = 0;
  var arr = Array.isArray(items) ? items : [];
  for (var i = 0; i < arr.length; i++) {
    var w = parseFloat(arr[i].weight) || 0;
    var q = parseInt(arr[i].qty, 10) || 1;
    total += w * q;
  }
  return total;
}

/**
 * STRK-156: Recursively stable-stringify a logical value. Sorts plain-object
 * keys at every depth so key-insertion-order variants collapse to one form;
 * PRESERVES array element order (array order is meaningful for settings like
 * headerBtnOrder, so a genuine reorder must remain a real difference); and
 * normalizes undefined/empty-string to null. The output is a canonical string
 * suitable for hashing, not a re-parseable JSON document.
 * @param {*} val
 * @returns {string}
 */
function _stableCanonicalString(val) {
  if (val === null || val === undefined || val === "") return "null";
  if (typeof val !== "object") return JSON.stringify(val);
  if (Array.isArray(val)) {
    return "[" + val.map(_stableCanonicalString).join(",") + "]";
  }
  var keys = Object.keys(val).sort();
  return (
    "{" +
    keys
      .map(function (k) {
        return JSON.stringify(k) + ":" + _stableCanonicalString(val[k]);
      })
      .join(",") +
    "}"
  );
}

/**
 * STRK-156: Normalize a raw localStorage settings string into canonical logical
 * content for hashing. Decompresses CMP2/CMP1 bodies (so a value compressed on
 * one device hashes the same as its plain twin on another — the STAK-497 hazard
 * resurfaced through lz-string, STRK-140), then JSON-parses — falling back to the
 * raw string for scalar prefs stored without quotes (e.g. appTheme "dark") so
 * they match a JSON-quoted twin — then canonicalizes via _stableCanonicalString.
 * @param {string} rawValue
 * @returns {string} canonical string of the logical value
 */
function _canonicalizeSettingValue(rawValue) {
  if (rawValue === null || rawValue === undefined) return "null";
  var decoded =
    typeof __decompressIfNeeded === "function" ? __decompressIfNeeded(rawValue) : rawValue;
  if (typeof decoded !== "string") decoded = String(decoded);
  var parsed;
  try {
    parsed = JSON.parse(decoded);
  } catch (_e) {
    parsed = decoded;
  }
  return _stableCanonicalString(parsed);
}

/**
 * Compute SHA-256 hash of sync-scoped settings (non-inventory localStorage keys).
 * Hashes NORMALIZED logical content (decompressed, JSON-parsed, key-sorted) via
 * _canonicalizeSettingValue rather than the raw localStorage strings, so two
 * devices holding identical logical settings — one CMP2-compressed, one plain;
 * scalar-as-JSON vs raw; differing object key-order — compute the SAME hash and
 * stop looping (STRK-156). Both the push (manifest) and poll sides call this one
 * function, so they stay consistent by construction.
 * Rollout note: an old-build device (raw hash) and a new-build device (logical
 * hash) mismatch once; both converge after both update.
 * Returns hex string or null if hashing is unavailable.
 * @returns {Promise<string|null>}
 */
async function computeSettingsHash() {
  try {
    if (!crypto || !crypto.subtle || !crypto.subtle.digest) return null;
    var keys = typeof SYNC_SCOPE_KEYS !== "undefined" ? SYNC_SCOPE_KEYS : [];
    var settings = {};
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === "metalInventory") continue; // skip inventory — covered by inventoryHash
      var val = localStorage.getItem(keys[i]);
      if (val !== null) settings[keys[i]] = _canonicalizeSettingValue(val);
    }
    var sortedKeys = Object.keys(settings).sort();
    var canonical =
      "{" +
      sortedKeys
        .map(function (k) {
          // settings[k] is already a canonical string from _canonicalizeSettingValue
          return JSON.stringify(k) + ":" + settings[k];
        })
        .join(",") +
      "}";
    var encoded = new TextEncoder().encode(canonical);
    var hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
    return sha256BufferToHex(hashBuffer);
  } catch (e) {
    debugLog("[CloudSync] computeSettingsHash failed:", e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Multi-tab sync coordination (Layer 7)
// ---------------------------------------------------------------------------

/**
 * Initialize BroadcastChannel-based leader election so only one tab
 * performs sync operations at a time. Falls back gracefully when
 * BroadcastChannel is unavailable (e.g. Safari < 15.4) — every tab
 * acts as leader in that case (no regression from current behavior).
 */
function initSyncTabCoordination() {
  if (typeof BroadcastChannel === "undefined") {
    _syncIsLeader = true;
    debugLog("[CloudSync] BroadcastChannel unavailable — this tab is leader (fallback)");
    return;
  }

  try {
    _syncChannel = new BroadcastChannel("staktrakr-sync");
  } catch (e) {
    _syncIsLeader = true;
    debugLog("[CloudSync] BroadcastChannel creation failed — this tab is leader (fallback)");
    return;
  }

  // Claim leadership immediately
  _syncIsLeader = true;
  debugLog("[CloudSync] Tab opened at", _syncTabOpenedAt, "— claiming leadership");
  _syncChannel.postMessage({
    type: "leader-claim",
    tabId: getSyncDeviceId(),
    ts: _syncTabOpenedAt,
  });

  _syncChannel.onmessage = function (event) {
    var msg = event.data;
    if (!msg || !msg.type) return;

    if (msg.type === "leader-claim") {
      // Yield to older tab (lower timestamp = opened earlier = wins)
      if (msg.ts < _syncTabOpenedAt && _syncIsLeader) {
        _syncIsLeader = false;
        debugLog("[CloudSync] Yielding leadership to older tab (ts:", msg.ts, ")");
      } else if (msg.ts > _syncTabOpenedAt && !_syncIsLeader) {
        // We are older — reclaim
        _syncIsLeader = true;
        _syncChannel.postMessage({
          type: "leader-claim",
          tabId: getSyncDeviceId(),
          ts: _syncTabOpenedAt,
        });
        debugLog("[CloudSync] Reclaiming leadership (we are older)");
      }
    } else if (msg.type === "sync-push-complete") {
      debugLog("[CloudSync] Broadcast received: push complete from another tab");
      refreshSyncUI();
    } else if (msg.type === "sync-pull-complete") {
      debugLog("[CloudSync] Broadcast received: pull complete from another tab");
      if (typeof loadInventory === "function") loadInventory();
      refreshSyncUI();
    }
  };

  // Visibility-based leadership handoff
  document.addEventListener("visibilitychange", function () {
    if (!_syncChannel) return;

    if (document.hidden && _syncIsLeader) {
      // Leader tab hidden — start 60s handoff timer
      _syncLeaderHiddenTimer = setTimeout(function () {
        if (document.hidden && _syncIsLeader) {
          _syncIsLeader = false;
          debugLog("[CloudSync] Leader hidden >60s — releasing leadership");
          _syncChannel.postMessage({ type: "leader-claim", tabId: "yield", ts: Infinity });
        }
      }, 60000);
    } else if (!document.hidden) {
      // Tab became visible
      if (_syncLeaderHiddenTimer) {
        clearTimeout(_syncLeaderHiddenTimer);
        _syncLeaderHiddenTimer = null;
      }
      // If no leader, claim it
      if (!_syncIsLeader) {
        _syncIsLeader = true;
        _syncChannel.postMessage({
          type: "leader-claim",
          tabId: getSyncDeviceId(),
          ts: _syncTabOpenedAt,
        });
        debugLog("[CloudSync] Tab visible — claiming leadership");
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Sync state helpers
// ---------------------------------------------------------------------------

function syncGetLastPush() {
  try {
    return JSON.parse(localStorage.getItem("cloud_sync_last_push") || "null");
  } catch (_) {
    return null;
  }
}

function syncSetLastPush(meta) {
  try {
    localStorage.setItem("cloud_sync_last_push", JSON.stringify(meta));
  } catch (_) {
    /* ignore */
  }
}

function syncGetLastPull() {
  try {
    return JSON.parse(localStorage.getItem("cloud_sync_last_pull") || "null");
  } catch (_) {
    return null;
  }
}

function syncSetLastPull(meta) {
  try {
    localStorage.setItem("cloud_sync_last_pull", JSON.stringify(meta));
  } catch (_) {
    /* ignore */
  }
}

function syncGetCursor() {
  return localStorage.getItem("cloud_sync_cursor") || null;
}

function syncSetCursor(rev) {
  try {
    localStorage.setItem("cloud_sync_cursor", rev || "");
  } catch (_) {
    /* ignore */
  }
}

function syncIsEnabled() {
  return localStorage.getItem("cloud_sync_enabled") === "true";
}

// ---------------------------------------------------------------------------
// Settings serialization integrity + boot-repair (STRK-157)
// ---------------------------------------------------------------------------

/**
 * STRK-157: Corruption sentinel. An object/array written to localStorage via
 * String()/coercion instead of JSON.stringify becomes the literal "[object Object]"
 * (or "[object Object],[object Object]" for arrays). No legitimate settings value
 * contains this substring, so it is a safe marker for un-round-trippable corruption.
 * @param {*} value
 * @returns {boolean}
 */
function _isCorruptObjectString(value) {
  return typeof value === "string" && value.indexOf("[object Object]") !== -1;
}

/**
 * STRK-157: Compute the string to persist for a synced setting, rejecting values
 * that cannot round-trip. Returns the clean string to write, or null when the
 * value is "[object Object]"-corrupt and must be skipped — so a corrupt remote can
 * never overwrite a good local value or re-stick itself on every pull.
 * @param {*} remoteVal
 * @returns {string|null}
 */
function _safeSettingWriteValue(remoteVal) {
  var str = typeof remoteVal === "string" ? remoteVal : JSON.stringify(remoteVal);
  if (_isCorruptObjectString(str)) return null;
  return str;
}

/**
 * STRK-157: One-time, idempotent boot repair. Scans SYNC_SCOPE_KEYS for values
 * corrupted into "[object Object]" form (an object written without JSON.stringify).
 * The load paths parse-fail and fall back to defaults in memory, but the corrupt
 * string never leaves localStorage, so it perpetually diverges the settings hash —
 * the one value class that cannot self-heal via convergent compare. Removes each
 * corrupt key so its load path uses defaults. Idempotent: a second run finds nothing.
 * @returns {string[]} keys that were repaired
 */
function syncBootRepairCorruptSettings() {
  var repaired = [];
  try {
    if (typeof localStorage === "undefined") return repaired;
    var keys = typeof SYNC_SCOPE_KEYS !== "undefined" ? SYNC_SCOPE_KEYS : [];
    for (var i = 0; i < keys.length; i++) {
      var raw = localStorage.getItem(keys[i]);
      if (raw === null) continue;
      var decoded = typeof __decompressIfNeeded === "function" ? __decompressIfNeeded(raw) : raw;
      if (_isCorruptObjectString(decoded)) {
        localStorage.removeItem(keys[i]);
        repaired.push(keys[i]);
      }
    }
    if (repaired.length > 0) {
      debugLog("[CloudSync] STRK-157 boot-repair removed corrupt keys:", repaired.join(", "));
    }
  } catch (e) {
    debugLog("[CloudSync] syncBootRepairCorruptSettings failed:", e.message);
  }
  return repaired;
}

// ---------------------------------------------------------------------------
// Override backup — snapshot local data before a remote pull overwrites it
// ---------------------------------------------------------------------------

/**
 * Snapshot all SYNC_SCOPE_KEYS raw localStorage strings into a single JSON blob.
 * Called immediately before vaultDecryptAndRestore() in pullSyncVault().
 */
function syncSaveOverrideBackup() {
  try {
    var keys = typeof SYNC_SCOPE_KEYS !== "undefined" ? SYNC_SCOPE_KEYS : [];
    var data = {};
    for (var i = 0; i < keys.length; i++) {
      var raw = localStorage.getItem(keys[i]);
      if (raw === null) continue;
      // STRK-157: never snapshot a corrupt "[object Object]" value — restore would
      // reintroduce it. Skip it so restore falls back to the load-path default.
      var decodedSnap =
        typeof __decompressIfNeeded === "function" ? __decompressIfNeeded(raw) : raw;
      if (_isCorruptObjectString(decodedSnap)) continue;
      data[keys[i]] = raw;
    }
    var backup = {
      timestamp: Date.now(),
      itemCount: typeof cloudSafeItemCount === "function" ? cloudSafeItemCount() : 0,
      appVersion: typeof APP_VERSION !== "undefined" ? APP_VERSION : "unknown",
      data: data,
    };
    localStorage.setItem("cloud_sync_override_backup", JSON.stringify(backup));
    debugLog("[CloudSync] Override backup saved:", Object.keys(data).length, "keys");
  } catch (err) {
    debugLog("[CloudSync] Override backup failed:", err);
  }
}

/**
 * Restore the pre-pull local snapshot saved by syncSaveOverrideBackup().
 * Prompts for confirmation, writes raw strings back, and refreshes the UI.
 */
async function syncRestoreOverrideBackup() {
  var backup = null;
  try {
    backup = JSON.parse(localStorage.getItem("cloud_sync_override_backup") || "null");
  } catch (_) {}

  if (!backup || !backup.data) {
    if (typeof showAppAlert === "function")
      await showAppAlert("No snapshot available.", "Sync History");
    return;
  }

  var ts = new Date(backup.timestamp).toLocaleString();
  var msg =
    "Restore local snapshot from " +
    ts +
    "?\n\n" +
    "Items at snapshot: " +
    (backup.itemCount || "?") +
    "\n" +
    "App version: v" +
    (backup.appVersion || "?") +
    "\n\n" +
    "This will overwrite your current inventory and cannot be undone.";

  var confirmed =
    typeof showAppConfirm === "function" ? await showAppConfirm(msg, "Restore Snapshot") : false;
  if (!confirmed) return;

  try {
    var bkeys = Object.keys(backup.data);
    // Guard: only clear scope keys when the snapshot is non-empty.
    // An empty snapshot likely indicates corruption — don't wipe localStorage.
    if (bkeys.length > 0 && typeof SYNC_SCOPE_KEYS !== "undefined") {
      for (var k = 0; k < SYNC_SCOPE_KEYS.length; k++) {
        localStorage.removeItem(SYNC_SCOPE_KEYS[k]);
      }
      debugLog("[CloudSync] Cleared", SYNC_SCOPE_KEYS.length, "scope keys before restore");
    }
    for (var j = 0; j < bkeys.length; j++) {
      if (
        typeof ALLOWED_STORAGE_KEYS !== "undefined" &&
        ALLOWED_STORAGE_KEYS.indexOf(bkeys[j]) !== -1
      ) {
        // STRK-157: don't reintroduce "[object Object]" corruption on restore.
        var restoreVal = backup.data[bkeys[j]];
        var restoreDecoded =
          typeof __decompressIfNeeded === "function"
            ? __decompressIfNeeded(restoreVal)
            : restoreVal;
        if (_isCorruptObjectString(restoreDecoded)) continue;
        localStorage.setItem(bkeys[j], restoreVal);
      }
    }
    if (typeof loadItemTags === "function") loadItemTags();
    if (typeof loadInventory === "function") await loadInventory();
    if (typeof updateSummary === "function") updateSummary();
    if (typeof renderTable === "function") renderTable();
    if (typeof renderActiveFilters === "function") renderActiveFilters();
    if (typeof loadSpotHistory === "function") loadSpotHistory();
    logCloudSyncActivity("override_restore", "success", "Snapshot from " + ts + " restored");
    if (typeof showCloudToast === "function")
      showCloudToast("Local snapshot restored successfully.");
    if (typeof renderSyncHistorySection === "function") renderSyncHistorySection();
  } catch (err) {
    debugLog("[CloudSync] Restore failed:", err);
    if (typeof showAppAlert === "function")
      await showAppAlert("Restore failed: " + String(err.message || err), "Sync History");
  }
}

// ---------------------------------------------------------------------------
// Sync status indicator (small badge in Settings cloud card)
// ---------------------------------------------------------------------------

/**
 * Update the auto-sync status indicator in the Settings UI.
 * @param {'idle'|'syncing'|'error'|'disabled'} state
 * @param {string} [detail] optional status text (e.g. "Just now", error message)
 */
function updateSyncStatusIndicator(state, detail) {
  var el = safeGetElement("cloudAutoSyncStatus");
  if (!el) return;

  var dot = el.querySelector(".cloud-sync-dot");
  var text = el.querySelector(".cloud-sync-status-text");

  if (dot) {
    dot.className = "cloud-sync-dot";
    if (state === "syncing") dot.classList.add("cloud-sync-dot--syncing");
    else if (state === "error") dot.classList.add("cloud-sync-dot--error");
    else if (state === "idle") dot.classList.add("cloud-sync-dot--ok");
    // 'disabled' = no extra class (grey)
  }

  if (text) {
    var label = "";
    if (state === "syncing") label = "Syncing\u2026";
    else if (state === "error") label = detail || "Sync error";
    else if (state === "idle") label = detail || "Synced";
    else label = "Auto-sync off";
    text.textContent = label;
  }

  // Keep header icon in sync
  updateCloudSyncHeaderBtn();
}

/**
 * Updates the header cloud sync button state (green/orange/gray) based on
 * connection status, vault password, and Dropbox account ID presence.
 * Called on init, password change, and sync enable/disable.
 */
function _cloudProviderNeedsAccountId(provider) {
  return provider === "dropbox";
}

function resolveHeaderCloudAction(provider) {
  provider = provider || _syncProvider || "dropbox";
  var connected = typeof cloudIsConnected === "function" ? cloudIsConnected(provider) : false;
  var hasVaultPassword = !!localStorage.getItem("cloud_vault_password");
  var hasAccountId =
    !_cloudProviderNeedsAccountId(provider) || !!localStorage.getItem("cloud_dropbox_account_id");
  var autoSyncOn = syncIsEnabled();
  var syncCapable = connected && hasVaultPassword && hasAccountId;

  return {
    provider: provider,
    connected: connected,
    hasVaultPassword: hasVaultPassword,
    hasAccountId: hasAccountId,
    autoSyncOn: autoSyncOn,
    syncCapable: syncCapable,
    buttonState: syncCapable ? (autoSyncOn ? "green" : "ready") : connected ? "orange" : "gray",
    action: syncCapable ? "sync-now" : "open-settings",
  };
}

function updateCloudSyncHeaderBtn() {
  var btn = safeGetElement("headerCloudSyncBtn");
  var dot = safeGetElement("headerCloudDot");
  if (!btn) return;

  var headerState = resolveHeaderCloudAction();

  // Always show the Cloud button — it is the entry point for cloud setup and status.
  // The gray dot state handles the "not connected" case visually.
  btn.style.display = "";
  if (!dot) return;
  dot.className = "cloud-sync-dot header-cloud-dot";

  if (headerState.buttonState === "green") {
    // Green: fully operational — connected, credentials set, auto-sync enabled
    dot.classList.add("header-cloud-dot--green");
    btn.title = "Cloud sync active";
    btn.setAttribute("aria-label", "Cloud sync active");
    btn.dataset.syncState = "green";
  } else if (headerState.buttonState === "orange") {
    // Orange: connected but missing password or account ID
    dot.classList.add("header-cloud-dot--orange");
    btn.title = "Cloud sync needs setup — tap to configure";
    btn.setAttribute("aria-label", "Cloud sync needs setup");
    btn.dataset.syncState = "orange";
  } else if (headerState.buttonState === "ready") {
    // Orange: connected and ready but auto-sync is off (distinct from 'orange' setup-needed)
    dot.classList.add("header-cloud-dot--orange");
    btn.title = "Cloud sync ready — tap to sync now";
    btn.setAttribute("aria-label", "Cloud sync ready to sync now");
    btn.dataset.syncState = "ready";
  } else {
    dot.classList.add("header-cloud-dot--gray");
    btn.title = "Cloud sync — tap to configure";
    btn.setAttribute("aria-label", "Cloud sync not configured");
    btn.dataset.syncState = "gray";
  }
}

/**
 * Refresh the "Last synced" text and toggle state in the cloud card.
 * Called by syncCloudUI() when switching to the Cloud settings panel.
 */
function refreshSyncUI() {
  // Sync toggle
  var toggle = safeGetElement("cloudAutoSyncToggle");
  if (toggle) toggle.checked = syncIsEnabled();

  // Last synced label
  var lastPush = syncGetLastPush();
  var lastSyncEl = safeGetElement("cloudAutoSyncLastSync");
  if (lastSyncEl) {
    if (lastPush && lastPush.timestamp) {
      lastSyncEl.textContent = _syncRelativeTime(lastPush.timestamp);
    } else {
      lastSyncEl.textContent = "Never";
    }
  }

  // Sync Now button — enabled when connected (works regardless of auto-sync toggle)
  var syncNowBtn = safeGetElement("cloudSyncNowBtn");
  if (syncNowBtn) {
    var connected =
      typeof cloudIsConnected === "function" ? cloudIsConnected(_syncProvider) : false;
    var hasSyncPw = !!getSyncPasswordSilent();
    syncNowBtn.disabled = !(connected && hasSyncPw);
  }

  // Status dot
  if (!syncIsEnabled()) {
    updateSyncStatusIndicator("disabled");
  } else {
    var lp = syncGetLastPush();
    if (lp && lp.timestamp) {
      updateSyncStatusIndicator("idle", _syncRelativeTime(lp.timestamp));
    } else {
      updateSyncStatusIndicator("idle", "Not yet synced");
    }
  }

  if (typeof renderSyncHistorySection === "function") renderSyncHistorySection();
}

/** Format a timestamp as a relative time string ("just now", "5 min ago", etc.) */
function _syncRelativeTime(ts) {
  var diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return diff + "s ago";
  if (diff < 3600) return Math.floor(diff / 60) + " min ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  var d = new Date(ts);
  var pad = function (n) {
    return n < 10 ? "0" + n : String(n);
  };
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

// ---------------------------------------------------------------------------
// Password management
// ---------------------------------------------------------------------------

/**
 * Interactively prompt for / confirm the vault password.
 * Called when getSyncPasswordSilent() returns null (new device, first connection).
 * On success: stores password in localStorage, returns combined key string.
 * @param {boolean} [forcePrompt=false] - Always show the interactive modal even
 *   if a cached password exists.  Used by enableCloudSync() so the user can
 *   confirm/correct the password when they explicitly toggle auto-sync on.
 * @returns {Promise<string|null>}
 */
function getSyncPassword(forcePrompt) {
  // If getSyncPasswordSilent already has a valid key and we're NOT being forced
  // to show the prompt, return it immediately.
  if (!forcePrompt) {
    var silent = getSyncPasswordSilent();
    if (silent) return Promise.resolve(silent);
  }

  var accountId = localStorage.getItem("cloud_dropbox_account_id");
  var isNewAccount = !localStorage.getItem("cloud_vault_password");

  return new Promise(function (resolve) {
    var modal = safeGetElement("cloudSyncPasswordModal");
    var input = safeGetElement("syncPasswordInput");
    var confirmBtn = safeGetElement("syncPasswordConfirmBtn");
    var cancelBtn = safeGetElement("syncPasswordCancelBtn");
    var cancelBtn2 = safeGetElement("syncPasswordCancelBtn2");
    var errorEl = safeGetElement("syncPasswordError");
    var titleEl = safeGetElement("syncPasswordModalTitle");
    var subtitleEl = safeGetElement("syncPasswordModalSubtitle");

    if (!modal || !input || !confirmBtn) {
      var prompt = isNewAccount
        ? "Set a vault password for cloud sync:"
        : "Enter your vault password:";
      if (typeof appPrompt === "function") {
        appPrompt(prompt, "", "Cloud Sync").then(function (pw) {
          if (pw && pw.length >= 8) {
            var freshId = localStorage.getItem("cloud_dropbox_account_id");
            try {
              // codeql[js/clear-text-storage-of-sensitive-data]
              // The user vault password is intentionally remembered on the user's own device.
              localStorage.setItem("cloud_vault_password", pw);
            } catch (_) {}
            resolve(freshId ? pw + ":" + freshId : null);
          } else {
            resolve(null);
          }
        });
      } else {
        resolve(null);
      }
      return;
    }

    // Update modal copy based on new vs returning user
    if (titleEl) titleEl.textContent = isNewAccount ? "Set Vault Password" : "Enter Vault Password";
    if (subtitleEl)
      subtitleEl.textContent = isNewAccount
        ? "Choose a password to encrypt your Dropbox backups. It will be remembered in this browser."
        : "Enter your vault password to unlock cloud sync on this device.";

    input.value = "";
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.style.display = "none";
    }

    var cleanup = function () {
      _syncPasswordPromptActive = false;
      confirmBtn.removeEventListener("click", onConfirm);
      if (cancelBtn) cancelBtn.removeEventListener("click", onCancel);
      if (cancelBtn2) cancelBtn2.removeEventListener("click", onCancel);
      input.removeEventListener("keydown", onKeydown);
      if (typeof closeModalById === "function") closeModalById("cloudSyncPasswordModal");
      else modal.style.display = "none";
    };

    var onConfirm = function () {
      var pw = input.value;
      if (!pw || pw.length < 8) {
        if (errorEl) {
          errorEl.textContent = "Password must be at least 8 characters.";
          errorEl.style.display = "";
        }
        return;
      }
      // Re-read accountId at confirm time — it may have been stored after the modal opened
      // (e.g., async Dropbox token exchange completing while the user types their password).
      var freshAccountId = localStorage.getItem("cloud_dropbox_account_id");
      if (!freshAccountId) {
        if (errorEl) {
          errorEl.textContent =
            "No Dropbox account ID found. Please cancel and reconnect your Dropbox account.";
          errorEl.style.display = "";
        }
        return;
      }
      try {
        // codeql[js/clear-text-storage-of-sensitive-data]
        // The user vault password is intentionally remembered on the user's own device.
        localStorage.setItem("cloud_vault_password", pw);
      } catch (_) {}
      cleanup();
      if (typeof updateCloudSyncHeaderBtn === "function") updateCloudSyncHeaderBtn();
      // Do NOT push here — the caller (enableCloudSync / initCloudSync) handles sync after resolving.
      resolve(pw + ":" + freshAccountId);
    };

    var onCancel = function () {
      cleanup();
      resolve(null);
    };
    var onKeydown = function (e) {
      if (e.key === "Enter") onConfirm();
      if (e.key === "Escape") onCancel();
    };

    confirmBtn.addEventListener("click", onConfirm);
    if (cancelBtn) cancelBtn.addEventListener("click", onCancel);
    if (cancelBtn2) cancelBtn2.addEventListener("click", onCancel);
    input.addEventListener("keydown", onKeydown);

    _syncPasswordPromptActive = true;
    if (typeof openModalById === "function") openModalById("cloudSyncPasswordModal");
    else modal.style.display = "flex";
    setTimeout(function () {
      input.focus();
    }, 50);
  });
}

/**
 * Emit a structured pre-decrypt console.warn for QA isolation of identity vs crypto failures.
 * @param {string} artifact - Label for what is being decrypted (e.g. 'metadata', 'stvault')
 * @param {Array} candidates - Key candidates from _getSyncKeyCandidates()
 */
function _logDecryptAttempt(artifact, candidates) {
  var _diagPw = !!localStorage.getItem("cloud_vault_password");
  var _diagAid = localStorage.getItem("cloud_dropbox_account_id");
  console.warn(
    "[CloudSync] decrypt attempt:",
    "artifact=" + artifact,
    "vaultPw:",
    _diagPw,
    "accountId:",
    _diagAid ? "present" : "MISSING",
    "candidates:",
    candidates.length
  );
}

/**
 * Guard that cloud_dropbox_account_id is present before any pull/poll operation.
 * Logs a warning and shows a reconnect toast when the accountId is missing.
 * Returns true when the accountId is present (safe to proceed), false when absent (caller must return).
 * @param {string} context - Caller label for the console warning (e.g. 'Poll', 'pullSyncVault')
 * @returns {boolean}
 */
function _assertSyncAccountId(context) {
  if (localStorage.getItem("cloud_dropbox_account_id")) return true;
  console.warn("[CloudSync]", context + ": cloud_dropbox_account_id missing — aborting");
  if (typeof showCloudToast === "function") {
    showCloudToast(
      "Cloud sync setup is incomplete on this device. Please reconnect Dropbox to refresh your account identity."
    );
  }
  return false;
}

/**
 * Try to decrypt a vault file using all known key variants.
 * Returns the decrypted payload on success, throws on total failure.
 * @param {Uint8Array} fileBytes
 * @param {string} [artifactLabel] - Label for pre-decrypt log (e.g. 'stvault', 'stmanifest')
 * @returns {Promise<Object>} Parsed vault payload
 */
async function _tryDecryptVault(fileBytes, artifactLabel) {
  var candidates = _getSyncKeyCandidates();
  _logDecryptAttempt(artifactLabel || "stvault", candidates);
  for (var i = 0; i < candidates.length; i++) {
    try {
      var payload = await vaultDecryptToData(fileBytes, candidates[i].key);
      console.warn("[CloudSync] Vault decrypted with", candidates[i].label, "key");
      return payload;
    } catch (_) {
      // Next candidate
    }
  }
  throw new Error("All key variants failed to decrypt vault");
}

/**
 * Build an ordered list of key candidates for decryption.
 * Tries composite first (most likely), then password-only, then simple-mode.
 * @returns {Array<{key: string, label: string}>}
 */
function _getSyncKeyCandidates() {
  var vaultPw = localStorage.getItem("cloud_vault_password");
  var accountId = localStorage.getItem("cloud_dropbox_account_id");
  var candidates = [];
  if (vaultPw && accountId) candidates.push({ key: vaultPw + ":" + accountId, label: "composite" });
  if (vaultPw) candidates.push({ key: vaultPw, label: "password-only" });
  if (accountId)
    candidates.push({ key: STAKTRAKR_SIMPLE_SALT + ":" + accountId, label: "simple-mode" });
  return candidates;
}

/**
 * Try to decrypt a parsed .stvault structure using all known key variants.
 * Returns { meta, keyUsed } on success, throws on total failure.
 * @param {Object} parsed - Output of parseVaultFile (salt, iv, iterations, ciphertext)
 * @returns {Promise<{meta: Object, keyUsed: string}>}
 */
async function _tryDecryptMetadata(parsed) {
  var candidates = _getSyncKeyCandidates();
  _logDecryptAttempt("metadata", candidates);
  for (var i = 0; i < candidates.length; i++) {
    try {
      var derivedKey = await vaultDeriveKey(candidates[i].key, parsed.salt, parsed.iterations);
      var decrypted = await vaultDecrypt(parsed.ciphertext, derivedKey, parsed.iv);
      var meta = JSON.parse(new TextDecoder().decode(decrypted));
      console.warn(
        "[CloudSync] Metadata decrypted with",
        candidates[i].label,
        "key (attempt",
        i + 1 + "/" + candidates.length + ")"
      );
      return { meta: meta, keyUsed: candidates[i].label };
    } catch (_) {
      console.warn("[CloudSync] Decrypt attempt", i + 1, "failed (" + candidates[i].label + ")");
    }
  }
  throw new Error("All " + candidates.length + " key variants failed to decrypt metadata");
}

/**
 * Get the sync password/key without any user interaction.
 * Unified mode: combines vault_password (localStorage) + account_id (Dropbox OAuth).
 * Returns null if either value is missing — caller must prompt user.
 * Never opens a modal or popover — safe to call from background processes.
 * @returns {string|null}
 */
function getSyncPasswordSilent() {
  var vaultPw = localStorage.getItem("cloud_vault_password");
  var accountId = localStorage.getItem("cloud_dropbox_account_id");

  debugLog(
    "[CloudSync] getSyncPasswordSilent:",
    "vaultPw:",
    vaultPw ? "present" : "NULL",
    "| accountId:",
    accountId ? "present" : "NULL",
    "| compositeKey:",
    vaultPw && accountId ? "present" : "N/A"
  );

  // Unified mode: both required
  if (vaultPw && accountId) {
    return vaultPw + ":" + accountId;
  }

  // Migration: old Simple mode (account_id only) — re-encrypt on next push
  if (!vaultPw && accountId && localStorage.getItem("cloud_sync_mode") === "simple") {
    return STAKTRAKR_SIMPLE_SALT + ":" + accountId;
  }

  return null;
}

/**
 * Change the stored vault password and re-encrypt the vault on Dropbox.
 * Called from the Advanced sub-modal "Change Password" flow.
 * @param {string} newPassword
 * @returns {Promise<boolean>} true on success
 */
async function changeVaultPassword(newPassword) {
  if (!newPassword || newPassword.length < 8) return false;

  try {
    // Write new password first; next push will re-encrypt the vault with the new key.
    // If the page closes before the push fires, the next session's getSyncPasswordSilent()
    // will use the new password — the remote vault remains decryptable with the old key until overwritten.
    // codeql[js/clear-text-storage-of-sensitive-data]
    // The user vault password is intentionally remembered on the user's own device.
    localStorage.setItem("cloud_vault_password", newPassword);
    logCloudSyncActivity("password_change", "success", "Vault password updated");
    if (typeof updateCloudSyncHeaderBtn === "function") updateCloudSyncHeaderBtn();
    // STAK-398: Set flag so pushSyncVault skips pre-push metadata decryption.
    // The remote metadata is encrypted with the OLD password — decryption would fail
    // and block the push, creating a deadlock where the password can never be changed.
    _syncPasswordJustChanged = true;
    let pushScheduled = false;
    if (syncIsEnabled() && typeof scheduleSyncPush === "function") {
      scheduleSyncPush();
      pushScheduled = true;
    }
    // If no push was scheduled (e.g., auto-sync is disabled), do not leave the
    // flag stuck true indefinitely; it should only apply to the next push.
    if (!pushScheduled) {
      _syncPasswordJustChanged = false;
    }
    if (typeof showCloudToast === "function")
      showCloudToast("Vault password updated — syncing now", 3000);
    return true;
  } catch (err) {
    if (typeof debugLog === "function") debugLog("[CloudSync] changeVaultPassword failed:", err);
    if (typeof showCloudToast === "function")
      showCloudToast("Failed to update password — try again", 3000);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Activity logging
// ---------------------------------------------------------------------------

function logCloudSyncActivity(action, result, detail, duration) {
  if (typeof recordCloudActivity === "function") {
    recordCloudActivity({
      action: action,
      provider: _syncProvider,
      result: result || "success",
      detail: detail || "",
      duration: duration != null ? duration : null,
    });
  }
}

// ---------------------------------------------------------------------------
// Manifest generation (diff-merge architecture — STAK-184 Task 4)
// ---------------------------------------------------------------------------

/**
 * Prune manifest entries to only include those from the last N sync cycles.
 * Prevents the manifest from growing unbounded.
 * @param {Array} entries - Full array of changeLog entries
 * @param {number} maxSyncs - Number of sync cycles to retain (default: 10)
 * @returns {Array} Pruned entries (subset of input)
 */
function pruneManifestEntries(entries, maxSyncs) {
  if (!entries || entries.length === 0) return entries;
  if (!maxSyncs || maxSyncs <= 0) maxSyncs = 10;

  // Scan changeLog for sync-marker entries to find the cutoff timestamp
  // getManifestEntries already filters by timestamp, but we need to find
  // the Nth-most-recent sync-marker to establish the pruning boundary
  var changeLog = typeof loadDataSync === "function" ? loadDataSync("changeLog", []) : [];

  // Find all sync-marker entries, sorted by timestamp descending
  var syncMarkers = [];
  for (var i = 0; i < changeLog.length; i++) {
    if (changeLog[i].type === "sync-marker" && changeLog[i].timestamp) {
      syncMarkers.push(changeLog[i]);
    }
  }
  syncMarkers.sort(function (a, b) {
    return b.timestamp - a.timestamp;
  });

  // If fewer than maxSyncs markers exist, keep all entries (no pruning needed)
  if (syncMarkers.length < maxSyncs) return entries;

  // The Nth sync-marker timestamp is the cutoff
  var cutoffTimestamp = syncMarkers[maxSyncs - 1].timestamp;

  // Filter entries to only include those at or after the cutoff
  var pruned = [];
  for (var j = 0; j < entries.length; j++) {
    if (entries[j].timestamp >= cutoffTimestamp) {
      pruned.push(entries[j]);
    }
  }

  debugLog(
    "[CloudSync] Manifest pruned:",
    entries.length,
    "→",
    pruned.length,
    "entries (maxSyncs:",
    maxSyncs + ")"
  );
  return pruned;
}

/**
 * Normalize item-scoped changelog type names for manifest consumers.
 * Producers keep their "item-*" vocabulary; manifest diffs use add/edit/delete.
 * @param {*} type - Raw changelog or manifest change type.
 * @returns {string} Normalized type, or the original string for unknown types.
 */
function _normalizeItemChangeType(type) {
  if (type == null) return "";
  var normalized = String(type);
  if (normalized.startsWith("item-")) {
    return normalized.slice("item-".length);
  }
  return normalized;
}

/**
 * Merge sequential change types for one item into the final manifest action.
 * Order matters: delete+add means a re-add, while add+delete means deleted.
 * @param {*} existingType - Current grouped type.
 * @param {*} incomingType - Next changelog entry type.
 * @returns {string} Merged normalized item change type.
 */
function _mergeItemChangeTypes(existingType, incomingType) {
  var existing = _normalizeItemChangeType(existingType);
  var incoming = _normalizeItemChangeType(incomingType);

  if (!existing) return incoming;
  if (!incoming) return existing;
  if (existing === "setting" || incoming === "setting") return incoming;

  if (incoming === "add") return "add";
  if (incoming === "delete") return "delete";
  if (incoming === "edit") {
    if (existing === "add") return "add";
    if (existing === "delete") return "delete";
    return "edit";
  }

  return incoming;
}

/**
 * Build a sync manifest from the changeLog and upload it encrypted to Dropbox.
 * The manifest captures field-level changes since the last push so that
 * diff-merge can resolve conflicts without downloading the full vault.
 *
 * Failure here is non-blocking — the caller wraps this in try/catch so that
 * a manifest error never prevents the vault push from completing.
 *
 * @param {string} token   - Dropbox OAuth bearer token
 * @param {string} password - Vault encryption password (composite key)
 * @param {string} syncId  - The syncId generated for this push
 * @returns {Promise<void>}
 */
async function buildAndUploadManifest(token, password, syncId) {
  // 1. Determine the cutoff timestamp from the last successful push
  var lastPush = syncGetLastPush();
  var lastSyncTimestamp = lastPush ? lastPush.timestamp : null;

  // 2. Collect changeLog entries since the last push
  var entries = [];
  if (typeof getManifestEntries === "function") {
    entries = getManifestEntries(lastSyncTimestamp) || [];
  } else {
    debugLog("[CloudSync] getManifestEntries not available — manifest will have empty changes");
  }

  // 2b. Prune entries to prevent manifest from growing unbounded
  var maxSyncs = 10;
  if (typeof loadDataSync === "function") {
    var threshold = loadDataSync("manifestPruningThreshold", null);
    if (threshold != null) {
      var parsed = parseInt(threshold, 10);
      if (!isNaN(parsed) && parsed > 0) maxSyncs = parsed;
    }
  }
  entries = pruneManifestEntries(entries, maxSyncs);

  // 3. Transform entries: group by itemKey, collect field-level changes
  var changesByKey = {};
  var summary = { itemsAdded: 0, itemsEdited: 0, itemsDeleted: 0, settingsChanged: 0 };
  var countedKeys = { add: {}, edit: {}, delete: {}, setting: {} };

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var key = entry.itemKey || "_settings";

    if (!changesByKey[key]) {
      changesByKey[key] = {
        itemKey: key,
        itemName: entry.itemName || null,
        type: _normalizeItemChangeType(entry.type),
        fields: [],
      };
    } else {
      changesByKey[key].type = _mergeItemChangeTypes(changesByKey[key].type, entry.type);
    }

    changesByKey[key].fields.push({
      field: entry.field || null,
      oldValue: entry.oldValue != null ? entry.oldValue : null,
      newValue: entry.newValue != null ? entry.newValue : null,
      timestamp: entry.timestamp,
    });
  }

  // Convert grouped changes object to array
  var transformedEntries = [];
  var keys = Object.keys(changesByKey);
  for (var k = 0; k < keys.length; k++) {
    var groupedChange = changesByKey[keys[k]];
    transformedEntries.push(groupedChange);

    // Count unique items by final normalized type for the summary.
    var entryType = _normalizeItemChangeType(groupedChange.type);
    if (entryType === "add" && !countedKeys.add[groupedChange.itemKey]) {
      countedKeys.add[groupedChange.itemKey] = true;
      summary.itemsAdded++;
    } else if (entryType === "edit" && !countedKeys.edit[groupedChange.itemKey]) {
      countedKeys.edit[groupedChange.itemKey] = true;
      summary.itemsEdited++;
    } else if (entryType === "delete" && !countedKeys.delete[groupedChange.itemKey]) {
      countedKeys.delete[groupedChange.itemKey] = true;
      summary.itemsDeleted++;
    } else if (entryType === "setting" && !countedKeys.setting[groupedChange.itemKey]) {
      countedKeys.setting[groupedChange.itemKey] = true;
      summary.settingsChanged++;
    }
  }

  // 4. Build manifest JSON (schema v1)
  var manifestPayload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    deviceId: getSyncDeviceId(),
    syncId: syncId,
    previousSyncId: lastPush ? lastPush.syncId : null,
    changes: transformedEntries,
    summary: summary,
  };

  // 4b. STAK-426: Embed settings snapshot so manifest-first pulls can compare
  // settings without downloading the full vault.
  // Use raw localStorage.getItem() so scalar string preferences (appTheme, appTimeZone,
  // cardViewStyle, sort columns, etc.) stored via localStorage.setItem are captured —
  // loadDataSync() JSON-parses and would return null for those raw-string values.
  var settingsSnapshot = {};
  if (typeof SYNC_SCOPE_KEYS !== "undefined" && typeof localStorage !== "undefined") {
    for (var s = 0; s < SYNC_SCOPE_KEYS.length; s++) {
      if (SYNC_SCOPE_KEYS[s] === "metalInventory") continue;
      var sv = localStorage.getItem(SYNC_SCOPE_KEYS[s]);
      if (sv !== null) settingsSnapshot[SYNC_SCOPE_KEYS[s]] = sv;
    }
  }
  manifestPayload.settings = settingsSnapshot;

  // 5. Encrypt the manifest
  if (typeof encryptManifest !== "function") {
    throw new Error("encryptManifest not available — cannot build manifest");
  }
  var manifestBytes = await encryptManifest(manifestPayload, password);

  // 6. Upload encrypted manifest to Dropbox
  debugLog("[CloudSync] Uploading manifest to", SYNC_MANIFEST_PATH, "…");
  var manifestArg = JSON.stringify({
    path: SYNC_MANIFEST_PATH,
    mode: "overwrite",
    autorename: false,
    mute: true,
  });
  var manifestResp = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": manifestArg,
    },
    body: manifestBytes,
  });

  if (!manifestResp.ok) {
    var respBody = await manifestResp.text().catch(function () {
      return "";
    });
    throw new Error("Manifest upload failed: " + manifestResp.status + " " + respBody);
  }

  debugLog(
    "[CloudSync] Manifest uploaded:",
    transformedEntries.length,
    "change groups,",
    entries.length,
    "total entries"
  );
}

// ---------------------------------------------------------------------------
// Push (upload encrypted vault to Dropbox)
// ---------------------------------------------------------------------------

/**
 * Encrypt the sync-scoped inventory and upload to Dropbox.
 * Also updates the lightweight staktrakr-sync.json metadata pointer.
 * Skips silently if not connected or sync is disabled.
 */
async function pushSyncVault() {
  // Guard: skip sync if app initialization failed (STAK-485)
  if (window._initFailed) {
    console.warn("[CloudSync] Skipping push — app initialization failed");
    return;
  }
  debugLog(
    "[CloudSync] pushSyncVault called. enabled:",
    syncIsEnabled(),
    "provider:",
    _syncProvider
  );

  if (!syncIsEnabled()) {
    debugLog("[CloudSync] Push skipped — sync not enabled");
    return;
  }

  if (!_syncIsLeader) {
    debugLog("cloud-sync", "Not leader tab — skipping push");
    return;
  }

  var token = typeof cloudGetToken === "function" ? await cloudGetToken(_syncProvider) : null;
  debugLog("[CloudSync] Token obtained:", !!token);
  if (!token) {
    debugLog("[CloudSync] No token — push skipped");
    updateSyncStatusIndicator("error", "Not connected");
    return;
  }

  if (_syncPushInFlight) {
    debugLog("[CloudSync] Push already in flight — skipped");
    return;
  }

  if (_syncRemoteChangeActive) {
    console.warn("[CloudSync] Remote change handling in progress — push deferred");
    return;
  }

  var password = getSyncPasswordSilent();
  debugLog("[CloudSync] Password obtained (silent):", !!password);
  if (!password) {
    debugLog("[CloudSync] No password — push deferred (tap cloud icon to unlock)");
    return;
  }

  _syncPushInFlight = true;
  updateSyncStatusIndicator("syncing");
  var pushStart = Date.now();
  var _remoteImageVaultMeta = null; // Preserve remote image vault reference across pushes
  var _remoteAttachmentVaultMeta = null; // Preserve remote attachment vault reference across pushes

  try {
    // -----------------------------------------------------------------------
    // Layer 3 — Folder migration check (REQ-3)
    // Migrate legacy flat /StakTrakr/ layout to /sync/ + /backups/ on first run.
    // -----------------------------------------------------------------------
    if (loadDataSync("cloud_sync_migrated", "") !== "v2") {
      debugLog("[CloudSync] Migration needed — running cloudMigrateToV2");
      try {
        await cloudMigrateToV2(_syncProvider);
      } catch (migErr) {
        debugLog("[CloudSync] Migration error (non-blocking):", migErr.message);
      }
    }

    // -----------------------------------------------------------------------
    // Layer 0 — Pre-push remote check (STAK-398 fix)
    // Before pushing, check if another device has pushed since our last pull.
    // If so, route to handleRemoteChange() instead of overwriting.
    // This prevents the push-races-poll bug where pushSyncVault (2s debounce)
    // always beats pollForRemoteChanges (10min interval).
    // -----------------------------------------------------------------------
    try {
      // [STAK-403] Snapshot + clear override flag before the async fetch so any early
      // exit (network error, etc.) does not leave the flag stale across calls.
      var _prePushOverride = _syncConflictUserOverride;
      _syncConflictUserOverride = false;
      console.warn("[CloudSync] Pre-push check: starting metadata download from", SYNC_META_PATH);
      var prePushApiArg = JSON.stringify({ path: SYNC_META_PATH });
      var prePushResp = await fetch("https://content.dropboxapi.com/2/files/download", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Dropbox-API-Arg": prePushApiArg,
        },
      });
      console.warn("[CloudSync] Pre-push check: metadata response status:", prePushResp.status);

      // Try legacy path if new path not found
      if (prePushResp.status === 409 || prePushResp.status === 404) {
        console.warn(
          "[CloudSync] Pre-push check: new path not found, trying legacy path",
          SYNC_META_PATH_LEGACY
        );
        var prePushLegacyArg = JSON.stringify({ path: SYNC_META_PATH_LEGACY });
        var prePushLegacyResp = await fetch("https://content.dropboxapi.com/2/files/download", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Dropbox-API-Arg": prePushLegacyArg,
          },
        });
        console.warn(
          "[CloudSync] Pre-push check: legacy response status:",
          prePushLegacyResp.status
        );
        if (prePushLegacyResp.ok) prePushResp = prePushLegacyResp;
      }

      if (prePushResp.ok) {
        // Decrypt metadata (encrypted format) or fall back to legacy plaintext JSON
        var prePushMeta = null;
        var prePushBuffer = await prePushResp.arrayBuffer();
        var prePushBytes = new Uint8Array(prePushBuffer);
        debugLog("[CloudSync] Pre-push check: metadata downloaded,", prePushBytes.length, "bytes");

        // First, try to interpret the metadata as an encrypted .stvault file
        var prePushParsed = null;
        try {
          prePushParsed = parseVaultFile(prePushBytes);
          console.warn(
            "[CloudSync] Pre-push check: parsed as .stvault, iterations:",
            prePushParsed.iterations
          );
        } catch (prePushParseErr) {
          // Not a .stvault — likely legacy plaintext JSON
          console.warn(
            "[CloudSync] Pre-push check: not .stvault format, trying legacy JSON:",
            prePushParseErr.message
          );
        }

        if (prePushParsed) {
          // Cap iterations to prevent a tampered remote file from hanging the UI
          var prePushMaxIterations =
            (typeof VAULT_PBKDF2_ITERATIONS !== "undefined" ? VAULT_PBKDF2_ITERATIONS : 600000) * 2;
          if (prePushParsed.iterations > prePushMaxIterations) {
            console.warn(
              "[CloudSync] Pre-push check: ABORT — iterations exceed cap:",
              prePushParsed.iterations,
              ">",
              prePushMaxIterations
            );
            logCloudSyncActivity(
              "auto_sync_push",
              "error",
              "Remote metadata iterations exceed safe limit — possible tampering"
            );
            _syncPushInFlight = false;
            updateSyncStatusIndicator("error", "Sync metadata invalid");
            return;
          }

          // Encrypted metadata exists; decryption must succeed or we abort the push
          // (wrong password ≠ legacy plaintext — do not fail-open)
          // Exception: after a password change, the remote metadata is encrypted with the
          // OLD password. In that case we cannot reliably decrypt with the NEW password.
          if (_syncPasswordJustChanged) {
            console.warn(
              "[CloudSync] Pre-push check: password just changed — remote metadata likely encrypted with old password"
            );
            var confirmBlindOverwrite = await appConfirm(
              "Your sync password was just changed.\n\n" +
                "StakTrakr cannot verify whether the cloud copy of your vault is newer than this device. " +
                "Continuing may overwrite newer remote data.\n\n" +
                "Do you want to overwrite the cloud copy with the data from this device now?",
              "Cloud Sync"
            );
            if (!confirmBlindOverwrite) {
              console.warn(
                "[CloudSync] Pre-push check: user cancelled blind overwrite after password change"
              );
              logCloudSyncActivity(
                "auto_sync_push",
                "cancelled",
                "User cancelled potential overwrite after vault password change"
              );
              _syncPushInFlight = false;
              updateSyncStatusIndicator("idle", "Sync cancelled");
              return;
            }
            // User explicitly accepted the risk; treat as no prior metadata and proceed.
            _syncPasswordJustChanged = false;
            prePushMeta = null; // Treat as no prior metadata — allow push
          } else {
            try {
              var prePushResult = await _tryDecryptMetadata(prePushParsed);
              prePushMeta = prePushResult.meta;
              console.warn(
                "[CloudSync] Pre-push check: decrypted OK (" +
                  prePushResult.keyUsed +
                  ") — deviceId:",
                prePushMeta.deviceId,
                "syncId:",
                prePushMeta.syncId,
                "itemCount:",
                prePushMeta.itemCount
              );
            } catch (prePushDecryptErr) {
              console.warn(
                "[CloudSync] Pre-push check: ABORT — all key variants failed:",
                prePushDecryptErr.message
              );
              logCloudSyncActivity(
                "auto_sync_push",
                "error",
                "Encrypted sync metadata exists but could not be decrypted. Check your sync password."
              );
              _syncPushInFlight = false;
              updateSyncStatusIndicator("error", "Wrong vault password?");
              return;
            }
          }
        } else {
          // No valid .stvault header — attempt legacy plaintext JSON metadata
          try {
            var prePushFallbackText = new TextDecoder().decode(prePushBytes);
            prePushMeta = JSON.parse(prePushFallbackText);
            console.warn(
              "[CloudSync] Pre-push check: parsed legacy JSON — deviceId:",
              prePushMeta.deviceId,
              "syncId:",
              prePushMeta.syncId
            );
          } catch (prePushJsonErr) {
            console.warn(
              "[CloudSync] Pre-push check: legacy JSON parse failed:",
              prePushJsonErr.message
            );
            prePushMeta = null;
          }
        }

        if (prePushMeta && prePushMeta.syncId && prePushMeta.deviceId) {
          var myDeviceId = getSyncDeviceId();
          var lastPull = syncGetLastPull();
          console.warn(
            "[CloudSync] Pre-push check: comparing — remote.deviceId:",
            prePushMeta.deviceId,
            "myDeviceId:",
            myDeviceId,
            "remote.syncId:",
            prePushMeta.syncId,
            "lastPull:",
            lastPull ? lastPull.syncId : "null"
          );

          // If a DIFFERENT device pushed AND we haven't pulled this syncId yet
          if (_prePushOverride) {
            console.warn(
              "[CloudSync] Pre-push check: BYPASS — user explicitly resolved conflict, overwriting remote"
            );
            logCloudSyncActivity(
              "auto_sync_push",
              "info",
              "Pre-push conflict check bypassed — user resolved conflict"
            );
            // fall through to push
          } else if (
            prePushMeta.deviceId !== myDeviceId &&
            (!lastPull || lastPull.syncId !== prePushMeta.syncId)
          ) {
            console.warn(
              "[CloudSync] Pre-push check: BLOCKING — remote change from device",
              prePushMeta.deviceId.slice(0, 8),
              "— routing to handleRemoteChange"
            );
            logCloudSyncActivity(
              "auto_sync_push",
              "deferred",
              "Remote change detected from device " +
                prePushMeta.deviceId.slice(0, 8) +
                " — showing diff"
            );
            _syncPushInFlight = false;
            updateSyncStatusIndicator("idle");
            await handleRemoteChange(prePushMeta);
            return; // Do NOT push — let the user decide via the update/conflict modal
          } else {
            console.warn(
              "[CloudSync] Pre-push check: PASSED —",
              prePushMeta.deviceId === myDeviceId
                ? "same device"
                : "already pulled syncId " + prePushMeta.syncId
            );
          }
        } else {
          console.warn(
            "[CloudSync] Pre-push check: metadata incomplete — syncId:",
            prePushMeta ? prePushMeta.syncId : "null",
            "deviceId:",
            prePushMeta ? prePushMeta.deviceId : "null"
          );
        }
      } else {
        console.warn(
          "[CloudSync] Pre-push check: no metadata file found (status:",
          prePushResp.status,
          ") — first push, proceeding"
        );
      }
    } catch (prePushErr) {
      // Only fail-open for network errors; log prominently so we can diagnose
      console.warn("[CloudSync] Pre-push check: EXCEPTION (fail-open):", prePushErr.message);
      debugLog("[CloudSync] Pre-push remote check failed (non-blocking):", prePushErr.message);
    }

    // Capture remote imageVault metadata so we can preserve it when this
    // device has no local photos (prevents erasing another device's uploads).
    if (typeof prePushMeta !== "undefined" && prePushMeta && prePushMeta.imageVault) {
      _remoteImageVaultMeta = prePushMeta.imageVault;
      debugLog(
        "[CloudSync] Pre-push: remote has image vault —",
        _remoteImageVaultMeta.imageCount,
        "photos, hash:",
        _remoteImageVaultMeta.hash
      );
    }
    if (typeof prePushMeta !== "undefined" && prePushMeta && prePushMeta.attachmentVault) {
      _remoteAttachmentVaultMeta = prePushMeta.attachmentVault;
      debugLog(
        "[CloudSync] Pre-push: remote has attachment vault —",
        _remoteAttachmentVaultMeta.attachmentCount,
        "attachments, hash:",
        _remoteAttachmentVaultMeta.hash
      );
    }

    // -----------------------------------------------------------------------
    // Layer 1 — Empty-vault push guard (REQ-1)
    // If local inventory is empty, check remote metadata before allowing push.
    // Prevents overwriting a populated cloud vault from a fresh/empty browser.
    // -----------------------------------------------------------------------
    var localItemCount = typeof inventory !== "undefined" ? inventory.length : 0;
    if (localItemCount === 0) {
      debugLog("[CloudSync] Empty-vault guard: local inventory is 0 — checking remote metadata");
      var guardBlocked = false;
      try {
        var guardApiArg = JSON.stringify({ path: SYNC_META_PATH });
        var guardResp = await fetch("https://content.dropboxapi.com/2/files/download", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Dropbox-API-Arg": guardApiArg,
          },
        });
        if (guardResp.status === 409) {
          // No remote meta file — first push, allow
          debugLog("[CloudSync] Empty-vault guard: no remote meta (first push) — allowing");
        } else if (guardResp.ok) {
          // Decrypt metadata (encrypted format) or fall back to legacy plaintext JSON
          var guardMeta;
          var guardBuffer = await guardResp.arrayBuffer();
          try {
            var guardParsed = parseVaultFile(new Uint8Array(guardBuffer));
            var guardResult = await _tryDecryptMetadata(guardParsed);
            guardMeta = guardResult.meta;
          } catch (guardDecryptErr) {
            // Legacy plaintext metadata — fall back to JSON parse
            debugLog(
              "[CloudSync] Guard: metadata not encrypted, falling back to JSON parse:",
              guardDecryptErr.message
            );
            try {
              var guardFallbackText = new TextDecoder().decode(new Uint8Array(guardBuffer));
              guardMeta = JSON.parse(guardFallbackText);
            } catch (guardJsonErr) {
              debugLog("[CloudSync] Guard: metadata parse failed entirely:", guardJsonErr.message);
              guardMeta = null;
            }
          }
          if (guardMeta && guardMeta.itemCount && guardMeta.itemCount > 0) {
            // Remote has items, local is empty — hard block
            debugLog(
              "[CloudSync] Empty-vault guard: BLOCKED — remote has",
              guardMeta.itemCount,
              "items"
            );
            logCloudSyncActivity(
              "auto_sync_push",
              "blocked",
              "Empty local vault, remote has " + guardMeta.itemCount + " items"
            );
            updateSyncStatusIndicator("error", "Empty vault — pull first");
            guardBlocked = true;
            _syncPushInFlight = false;
            // STAK-410: showAppConfirm is Promise-based (message, title) — use .then()
            // instead of passing the callback as arg 2 (old callback-style API).
            showAppConfirm(
              "Your local vault is empty but the cloud has " +
                guardMeta.itemCount +
                " items. " +
                "Push cancelled to prevent data loss. Pull from cloud instead?",
              "Sync Update"
            ).then(function (confirmed) {
              if (confirmed) pullWithPreview();
            });
            return;
          } else {
            debugLog("[CloudSync] Empty-vault guard: remote is also empty — allowing");
          }
        } else {
          // Network/API error — fail-safe: block push
          debugLog(
            "[CloudSync] Empty-vault guard: BLOCKED — meta check failed with status",
            guardResp.status
          );
          logCloudSyncActivity(
            "auto_sync_push",
            "blocked",
            "Empty vault guard: meta check failed (" + guardResp.status + ")"
          );
          updateSyncStatusIndicator("error", "Sync check failed");
          _syncPushInFlight = false;
          return;
        }
      } catch (guardErr) {
        // Network failure — fail-safe: block push
        debugLog("[CloudSync] Empty-vault guard: BLOCKED — network error:", guardErr.message);
        logCloudSyncActivity(
          "auto_sync_push",
          "blocked",
          "Empty vault guard: network error — " + String(guardErr.message || guardErr)
        );
        updateSyncStatusIndicator("error", "Sync check failed");
        _syncPushInFlight = false;
        return;
      }
    }

    // Encrypt sync-scoped payload
    debugLog("[CloudSync] Encrypting payload…");
    var fileBytes =
      typeof vaultEncryptToBytesScoped === "function"
        ? await vaultEncryptToBytesScoped(password)
        : await vaultEncryptToBytes(password);
    debugLog("[CloudSync] Encrypted:", fileBytes.byteLength, "bytes");

    // -----------------------------------------------------------------------
    // Layer 2 — Full backup-before-overwrite (STAK-419)
    // Create a FULL encrypted backup (all localStorage keys) and upload to
    // /backups/ before overwriting the sync vault. This ensures every pre-sync
    // snapshot is a complete restore point, not a partial sync-scoped copy.
    // Non-blocking: if backup fails (first push, encryption error), log and continue.
    // -----------------------------------------------------------------------
    try {
      var backupTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
      var backupPath = SYNC_BACKUP_FOLDER + "/" + SYNC_BACKUP_PREFIX + backupTimestamp + ".stvault";
      debugLog("[CloudSync] Full backup-before-overwrite: encrypting…");
      var fullBackupBytes = await vaultEncryptToBytes(password);
      debugLog(
        "[CloudSync] Full backup-before-overwrite: uploading",
        fullBackupBytes.byteLength,
        "bytes to",
        backupPath
      );
      var backupArg = JSON.stringify({
        path: backupPath,
        mode: "add",
        autorename: true,
        mute: true,
      });
      var backupResp = await fetch("https://content.dropboxapi.com/2/files/upload", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": backupArg,
        },
        body: fullBackupBytes,
      });
      if (backupResp.ok) {
        debugLog("[CloudSync] Full backup-before-overwrite: created", backupPath);
      } else {
        debugLog("[CloudSync] Full backup-before-overwrite: upload returned", backupResp.status);
      }
    } catch (backupErr) {
      debugLog(
        "[CloudSync] Full backup-before-overwrite: failed (non-blocking):",
        backupErr.message
      );
    }

    var syncId = typeof generateUUID === "function" ? generateUUID() : _syncFallbackUUID();
    var now = Date.now();
    var itemCount = typeof cloudSafeItemCount === "function" ? cloudSafeItemCount() : 0;
    var appVersion = typeof APP_VERSION !== "undefined" ? APP_VERSION : "unknown";
    var deviceId = getSyncDeviceId();

    // Upload the vault file (overwrite)
    debugLog("[CloudSync] Uploading vault to", SYNC_FILE_PATH, "…");
    var vaultArg = JSON.stringify({
      path: SYNC_FILE_PATH,
      mode: "overwrite",
      autorename: false,
      mute: true,
    });
    var vaultResp = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": vaultArg,
      },
      body: fileBytes,
    });
    debugLog("[CloudSync] Vault upload response:", vaultResp.status);

    if (vaultResp.status === 429) {
      _syncRetryDelay = Math.min(_syncRetryDelay * 2, 300000); // cap at 5 min
      throw new Error("Rate limited (429). Retry in " + Math.round(_syncRetryDelay / 1000) + "s");
    }

    if (!vaultResp.ok) {
      var errBody = await vaultResp.text().catch(function () {
        return "";
      });
      throw new Error("Vault upload failed: " + vaultResp.status + " " + errBody);
    }
    _syncRetryDelay = 2000; // reset backoff on success

    var vaultResult = await vaultResp.json();
    var rev = vaultResult.rev || "";
    debugLog("[CloudSync] Vault uploaded, rev:", rev);

    // Upload image vault if user photos exist and have changed (STAK-181)
    var imageVaultMeta = null;
    var _imageVaultPreserved = false; // True when carrying forward another device's metadata
    try {
      if (typeof collectAndHashImageVault === "function") {
        var imgData = await collectAndHashImageVault();
        var lastPush = syncGetLastPush();
        var lastImageHash = lastPush ? lastPush.imageHash : null;
        if (imgData) {
          // Upload if hash changed OR remote metadata is missing imageVault
          // (the file may have been deleted by another device's stale push).
          var _remoteFileMissing = !_remoteImageVaultMeta;
          if (imgData.hash !== lastImageHash || _remoteFileMissing) {
            debugLog(
              "[CloudSync] Image vault",
              _remoteFileMissing ? "missing from remote — re-uploading" : "changed — uploading",
              imgData.imageCount,
              "photos"
            );
            var imageBytes = await vaultEncryptImageVault(password, imgData.payload);
            var imgArg = JSON.stringify({
              path: SYNC_IMAGES_PATH,
              mode: "overwrite",
              autorename: false,
              mute: true,
            });
            var imgResp = await fetch("https://content.dropboxapi.com/2/files/upload", {
              method: "POST",
              headers: {
                Authorization: "Bearer " + token,
                "Content-Type": "application/octet-stream",
                "Dropbox-API-Arg": imgArg,
              },
              body: imageBytes,
            });
            if (!imgResp.ok) throw new Error("Image vault upload failed: " + imgResp.status);
            imageVaultMeta = { imageCount: imgData.imageCount, hash: imgData.hash };
            debugLog("[CloudSync] Image vault uploaded:", imgData.imageCount, "photos");
            logCloudSyncActivity(
              "image_vault_push",
              "success",
              imgData.imageCount +
                " photos, " +
                Math.round(imageBytes.byteLength / 1024) +
                " KB" +
                (_remoteFileMissing ? " (re-upload)" : "")
            );
          } else {
            // Hash unchanged — carry forward existing meta so other devices can still detect it
            imageVaultMeta = lastImageHash
              ? { imageCount: imgData.imageCount, hash: imgData.hash }
              : null;
            debugLog("[CloudSync] Image vault unchanged — skipping upload");
            logCloudSyncActivity(
              "image_vault_push",
              "skipped",
              "Hash unchanged — " + imgData.imageCount + " photos"
            );
          }
        } else if (_remoteImageVaultMeta) {
          // STAK-497: No local images but remote has an image vault from
          // another device. Preserve the reference so pulling devices can
          // still find it. Do NOT delete, and do NOT store imageHash in
          // local pushMeta (to avoid triggering the deletion path next push).
          imageVaultMeta = _remoteImageVaultMeta;
          _imageVaultPreserved = true;
          debugLog(
            "[CloudSync] No local photos — preserving remote image vault reference:",
            _remoteImageVaultMeta.imageCount,
            "photos"
          );
          logCloudSyncActivity(
            "image_vault_push",
            "skipped",
            "No local photos — preserved remote reference (" +
              _remoteImageVaultMeta.imageCount +
              " photos)"
          );
        } else if (lastImageHash) {
          // STAK-426: This device previously uploaded photos and they were
          // all deleted locally. Propagate deletion to remote.
          try {
            var delArg = JSON.stringify({ path: SYNC_IMAGES_PATH });
            var delResp = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
              method: "POST",
              headers: {
                Authorization: "Bearer " + token,
                "Content-Type": "application/json",
              },
              body: delArg,
            });
            if (delResp.ok || delResp.status === 409) {
              debugLog("[CloudSync] Remote image vault deleted (all local photos removed)");
              logCloudSyncActivity(
                "image_vault_push",
                "success",
                "All local photos removed — remote vault deleted"
              );
            } else {
              debugLog("[CloudSync] Image vault deletion returned status:", delResp.status);
            }
          } catch (delErr) {
            debugLog("[CloudSync] Image vault deletion failed (non-blocking):", delErr.message);
          }
          // imageVaultMeta stays null → imageHash cleared in pushMeta
        } else {
          logCloudSyncActivity("image_vault_push", "skipped", "No user photos on this device");
        }
      }
    } catch (imgErr) {
      // Image vault failure is non-fatal — inventory sync continues
      var imgErrMsg = String(imgErr.message || imgErr);
      console.warn("[CloudSync] Image vault push error (non-fatal):", imgErrMsg);
      logCloudSyncActivity("image_vault_push", "fail", imgErrMsg);
    }

    // Upload attachment vault if user attachments exist and have changed (STRK-45, STRK-65)
    var attachmentVaultMeta = null;
    var _attachmentVaultPreserved = false;
    try {
      // STRK-65: Respect syncAttachments opt-out
      var _syncAttachPref =
        typeof loadDataSync === "function" ? loadDataSync("syncAttachments", null) : null;
      if (_syncAttachPref === "false" || _syncAttachPref === false) {
        debugLog("[CloudSync] Attachment binary sync disabled by user preference — skipping");
      } else if (typeof collectAndHashAttachmentVault === "function") {
        // STRK-65: Preflight size check before Base64 serialization
        var _attachUsage = window.attachmentManager?.isAvailable()
          ? await window.attachmentManager.getStorageUsage()
          : null;
        if (
          _attachUsage &&
          _attachUsage.totalBytes >
            (typeof SYNC_ATTACHMENT_SIZE_WARN_BYTES !== "undefined"
              ? SYNC_ATTACHMENT_SIZE_WARN_BYTES
              : 100 * 1024 * 1024) &&
          loadDataSync("syncAttachmentsWarnSeen", null) !== "true" &&
          loadDataSync("syncAttachmentsWarnSeen", null) !== true
        ) {
          debugLog(
            "[CloudSync] Attachment vault exceeds size threshold (" +
              Math.round(_attachUsage.totalBytes / 1024 / 1024) +
              " MB) — skipping binary upload until user confirms via Settings"
          );
          logCloudSyncActivity(
            "attachment_vault_push",
            "skipped",
            "Size threshold exceeded — awaiting user confirmation"
          );
        } else {
          var attachData = await collectAndHashAttachmentVault();
          var _lastPushForAttach = syncGetLastPush();
          var lastAttachmentHash = _lastPushForAttach ? _lastPushForAttach.attachmentHash : null;
          if (attachData) {
            var _remoteAttachMissing = !_remoteAttachmentVaultMeta;
            if (attachData.hash !== lastAttachmentHash || _remoteAttachMissing) {
              debugLog(
                "[CloudSync] Attachment vault",
                _remoteAttachMissing ? "missing from remote — re-uploading" : "changed — uploading",
                attachData.attachmentCount,
                "attachments"
              );
              var attachmentBytes = await vaultEncryptAttachmentVault(password, attachData.payload);
              var attachArg = JSON.stringify({
                path: SYNC_ATTACHMENTS_PATH,
                mode: "overwrite",
                autorename: false,
                mute: true,
              });
              var attachResp = await fetch("https://content.dropboxapi.com/2/files/upload", {
                method: "POST",
                headers: {
                  Authorization: "Bearer " + token,
                  "Content-Type": "application/octet-stream",
                  "Dropbox-API-Arg": attachArg,
                },
                body: attachmentBytes,
              });
              if (!attachResp.ok)
                throw new Error("Attachment vault upload failed: " + attachResp.status);
              attachmentVaultMeta = {
                attachmentCount: attachData.attachmentCount,
                hash: attachData.hash,
              };
              debugLog(
                "[CloudSync] Attachment vault uploaded:",
                attachData.attachmentCount,
                "attachments"
              );
              logCloudSyncActivity(
                "attachment_vault_push",
                "success",
                attachData.attachmentCount +
                  " attachments, " +
                  Math.round(attachmentBytes.byteLength / 1024) +
                  " KB" +
                  (_remoteAttachMissing ? " (re-upload)" : "")
              );
            } else {
              attachmentVaultMeta = lastAttachmentHash
                ? { attachmentCount: attachData.attachmentCount, hash: attachData.hash }
                : null;
              debugLog("[CloudSync] Attachment vault unchanged — skipping upload");
              logCloudSyncActivity(
                "attachment_vault_push",
                "skipped",
                "Hash unchanged — " + attachData.attachmentCount + " attachments"
              );
            }
          } else if (_remoteAttachmentVaultMeta) {
            attachmentVaultMeta = _remoteAttachmentVaultMeta;
            _attachmentVaultPreserved = true;
            debugLog(
              "[CloudSync] No local attachments — preserving remote attachment vault reference:",
              _remoteAttachmentVaultMeta.attachmentCount,
              "attachments"
            );
            logCloudSyncActivity(
              "attachment_vault_push",
              "skipped",
              "No local attachments — preserved remote reference (" +
                _remoteAttachmentVaultMeta.attachmentCount +
                " attachments)"
            );
          } else if (lastAttachmentHash) {
            // Attachments all deleted locally — propagate deletion
            try {
              var attachDelArg = JSON.stringify({ path: SYNC_ATTACHMENTS_PATH });
              var attachDelResp = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
                method: "POST",
                headers: {
                  Authorization: "Bearer " + token,
                  "Content-Type": "application/json",
                },
                body: attachDelArg,
              });
              if (attachDelResp.ok || attachDelResp.status === 409) {
                debugLog(
                  "[CloudSync] Remote attachment vault deleted (all local attachments removed)"
                );
                logCloudSyncActivity(
                  "attachment_vault_push",
                  "success",
                  "All local attachments removed — remote vault deleted"
                );
              } else {
                debugLog(
                  "[CloudSync] Attachment vault deletion returned status:",
                  attachDelResp.status
                );
              }
            } catch (attachDelErr) {
              debugLog(
                "[CloudSync] Attachment vault deletion failed (non-blocking):",
                attachDelErr.message
              );
            }
          } else {
            logCloudSyncActivity(
              "attachment_vault_push",
              "skipped",
              "No user attachments on this device"
            );
          }
        } // close size-check else
      }
    } catch (attachPushErr) {
      var attachPushErrMsg = String(attachPushErr.message || attachPushErr);
      console.warn("[CloudSync] Attachment vault push error (non-fatal):", attachPushErrMsg);
      logCloudSyncActivity("attachment_vault_push", "fail", attachPushErrMsg);
    }

    // Upload the metadata pointer JSON
    var metaPayload = {
      rev: rev,
      timestamp: now,
      appVersion: appVersion,
      itemCount: itemCount,
      syncId: syncId,
      deviceId: deviceId,
    };
    if (imageVaultMeta) metaPayload.imageVault = imageVaultMeta;
    if (attachmentVaultMeta) metaPayload.attachmentVault = attachmentVaultMeta;

    // Layer 4 — Manifest schema v2 enrichment (REQ-4)
    metaPayload.manifestVersion = 2;
    metaPayload.vaultSizeBytes = fileBytes.byteLength;
    var _inv = typeof inventory !== "undefined" ? inventory : [];
    metaPayload.metals = summarizeMetals(_inv);
    metaPayload.totalWeight = computeTotalWeight(_inv);
    try {
      var invHash = await computeInventoryHash(_inv);
      if (invHash) metaPayload.inventoryHash = invHash;
    } catch (_hashErr) {
      debugLog("[CloudSync] Inventory hash failed (omitting):", _hashErr.message);
    }
    try {
      var setHash = await computeSettingsHash();
      if (setHash) metaPayload.settingsHash = setHash;
    } catch (_sHashErr) {
      debugLog("[CloudSync] Settings hash failed (omitting):", _sHashErr.message);
    }

    // Encrypt metadata before upload (same AES-256-GCM as vault files)
    // STAK-398 diagnostic: log the key used for metadata encryption (for cross-device comparison)
    debugLog(
      "[CloudSync] Metadata ENCRYPT: using",
      password.indexOf(":") !== -1 ? "composite key" : "password-only"
    );
    var metaJson = JSON.stringify(metaPayload);
    var metaSalt = vaultRandomBytes(32);
    var metaIv = vaultRandomBytes(12);
    var metaKey = await vaultDeriveKey(password, metaSalt, VAULT_PBKDF2_ITERATIONS);
    var metaCiphertext = await vaultEncrypt(new TextEncoder().encode(metaJson), metaKey, metaIv);
    var metaBytes = serializeVaultFile(metaSalt, metaIv, VAULT_PBKDF2_ITERATIONS, metaCiphertext);

    var metaArg = JSON.stringify({
      path: SYNC_META_PATH,
      mode: "overwrite",
      autorename: false,
      mute: true,
    });
    var metaResp = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": metaArg,
      },
      body: metaBytes,
    });
    if (!metaResp.ok) throw new Error("Metadata upload failed: " + metaResp.status);

    // Upload manifest (non-blocking — failure must NOT prevent push completion)
    try {
      await buildAndUploadManifest(token, password, syncId);
    } catch (manifestErr) {
      debugLog("[CloudSync] Manifest upload failed (non-blocking):", manifestErr.message);
    }

    // Persist push state
    var pushMeta = { syncId: syncId, timestamp: now, rev: rev, itemCount: itemCount };
    // Only store imageHash when this device actually uploaded images (not when
    // preserving another device's reference). Storing a preserved hash would
    // cause the next push to enter the "all local photos deleted" path and
    // erroneously delete the remote image vault file.
    if (imageVaultMeta && !_imageVaultPreserved) pushMeta.imageHash = imageVaultMeta.hash;
    if (attachmentVaultMeta && !_attachmentVaultPreserved)
      pushMeta.attachmentHash = attachmentVaultMeta.hash;
    syncSetLastPush(pushMeta);
    syncSetCursor(rev);

    var duration = Date.now() - pushStart;
    logCloudSyncActivity(
      "auto_sync_push",
      "success",
      itemCount + " items, " + Math.round(fileBytes.byteLength / 1024) + " KB",
      duration
    );
    debugLog("[CloudSync] Push complete:", syncId, "rev:", rev, "(" + duration + "ms)");
    updateSyncStatusIndicator("idle", "just now");
    refreshSyncUI();

    // Auto-prune old backups (fire-and-forget)
    if (typeof cloudPruneBackups === "function") {
      var pruneMax = parseInt(
        loadDataSync(CLOUD_BACKUP_HISTORY_KEY, String(CLOUD_BACKUP_HISTORY_DEFAULT)),
        10
      );
      cloudPruneBackups(_syncProvider, pruneMax, "sync").catch(function (e) {
        debugLog("[CloudSync] Prune error (non-blocking):", e.message);
      });
    }

    // Broadcast push completion to other tabs
    if (_syncChannel) {
      try {
        _syncChannel.postMessage({ type: "sync-push-complete", tabId: getSyncDeviceId() });
      } catch (_) {
        /* ignore */
      }
    }
  } catch (err) {
    var errMsg = String(err.message || err);
    console.error("[CloudSync] Push failed:", errMsg, err);
    logCloudSyncActivity("auto_sync_push", "fail", errMsg);
    updateSyncStatusIndicator("error", errMsg.slice(0, 60));
  } finally {
    _syncPushInFlight = false;
    _syncPasswordJustChanged = false; // Clear after push attempt (success or fail)
  }
}

// ---------------------------------------------------------------------------
// Poll (check remote for changes)
// ---------------------------------------------------------------------------

/**
 * Download staktrakr-sync.json and compare syncId with last pull.
 * If different, hand off to handleRemoteChange().
 * Skips silently if not connected or sync is disabled.
 */
async function pollForRemoteChanges() {
  // Guard: skip sync if app initialization failed (STAK-485)
  if (window._initFailed) {
    console.warn("[CloudSync] Skipping poll — app initialization failed");
    return;
  }
  if (!syncIsEnabled()) return;
  if (!_syncIsLeader) {
    debugLog("cloud-sync", "Not leader tab — skipping poll");
    return;
  }
  if (document.hidden) return; // Page Visibility API: skip background polls

  var token = typeof cloudGetToken === "function" ? await cloudGetToken(_syncProvider) : null;
  if (!token) return;

  if (!_assertSyncAccountId("Poll")) return;

  // Layer 3 — Folder migration check (REQ-3)
  if (loadDataSync("cloud_sync_migrated", "") !== "v2") {
    debugLog("[CloudSync] Poll: migration needed — running cloudMigrateToV2");
    try {
      await cloudMigrateToV2(_syncProvider);
    } catch (migErr) {
      debugLog("[CloudSync] Poll: migration error (non-blocking):", migErr.message);
    }
  }

  try {
    var apiArg = JSON.stringify({ path: SYNC_META_PATH });
    var resp = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Dropbox-API-Arg": apiArg,
      },
    });

    // Layer 3d — Legacy fallback: if new path returns 404/409, retry at legacy path
    if (resp.status === 409 || resp.status === 404) {
      debugLog("[CloudSync] Poll: new meta path not found — trying legacy path");
      var legacyApiArg = JSON.stringify({ path: SYNC_META_PATH_LEGACY });
      var legacyResp = await fetch("https://content.dropboxapi.com/2/files/download", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Dropbox-API-Arg": legacyApiArg,
        },
      });
      if (legacyResp.ok) {
        debugLog("[CloudSync] Poll: found metadata at legacy path");
        resp = legacyResp;
      } else if (legacyResp.status === 409 || legacyResp.status === 404) {
        // No sync file at either path — first device
        debugLog("[CloudSync] No remote sync file yet (checked both paths)");
        return;
      }
      // If legacy also failed with other status, fall through to existing error handling
      if (!legacyResp.ok && legacyResp.status !== 409 && legacyResp.status !== 404) {
        resp = legacyResp;
      }
    }
    if (resp.status === 429) {
      _syncRetryDelay = Math.min(_syncRetryDelay * 2, 300000);
      debugLog("[CloudSync] Poll rate limited — backing off");
      return;
    }
    if (!resp.ok) {
      debugLog("[CloudSync] Poll meta fetch failed:", resp.status);
      return;
    }
    _syncRetryDelay = SYNC_POLL_INTERVAL;

    // Decrypt metadata (encrypted format) or fall back to legacy plaintext JSON
    var remoteMeta;
    var metaBuffer;
    try {
      metaBuffer = await resp.arrayBuffer();
      var metaBytes = new Uint8Array(metaBuffer);
      debugLog("[CloudSync] Poll: metadata downloaded,", metaBytes.length, "bytes");
      var metaParsed = parseVaultFile(metaBytes);
      // Check we have at least a password before trying decrypt
      if (!localStorage.getItem("cloud_vault_password")) {
        console.warn("[CloudSync] Poll: no vault password — skipping");
        return;
      }
      var pollResult = await _tryDecryptMetadata(metaParsed);
      remoteMeta = pollResult.meta;
      console.warn("[CloudSync] Poll: metadata decrypted OK (" + pollResult.keyUsed + ")");
    } catch (decryptErr) {
      // Legacy plaintext metadata — fall back to JSON parse
      console.warn(
        "[CloudSync] Poll: encrypted decrypt failed, trying legacy JSON:",
        decryptErr.message
      );
      try {
        // Response body already consumed by arrayBuffer() — re-parse from the buffer
        var fallbackText = new TextDecoder().decode(new Uint8Array(metaBuffer));
        remoteMeta = JSON.parse(fallbackText);
        console.warn("[CloudSync] Poll: legacy JSON parse OK");
      } catch (jsonErr) {
        console.warn("[CloudSync] Poll: metadata parse FAILED ENTIRELY:", jsonErr.message);
        return;
      }
    }
    if (!remoteMeta || !remoteMeta.syncId) {
      console.warn("[CloudSync] Poll: metadata missing syncId — skipping");
      return;
    }

    var lastPull = syncGetLastPull();
    console.warn(
      "[CloudSync] Poll: remote — deviceId:",
      remoteMeta.deviceId,
      "syncId:",
      remoteMeta.syncId,
      "itemCount:",
      remoteMeta.itemCount,
      "| local — myDeviceId:",
      getSyncDeviceId(),
      "lastPull:",
      lastPull ? lastPull.syncId : "null"
    );

    // Echo detection: if this device pushed this syncId, just record the pull
    if (remoteMeta.deviceId === getSyncDeviceId()) {
      console.warn("[CloudSync] Poll: echo detection — this is our own push, recording lastPull");
      if (!lastPull || lastPull.syncId !== remoteMeta.syncId) {
        syncSetLastPull({
          syncId: remoteMeta.syncId,
          timestamp: remoteMeta.timestamp,
          rev: remoteMeta.rev,
        });
      }
      return;
    }

    // No change since last pull
    if (lastPull && lastPull.syncId === remoteMeta.syncId) {
      console.warn("[CloudSync] Poll: already pulled this syncId — no new changes");
      return;
    }

    // Layer 4 — Hash-based change detection (REQ-4)
    // Skip notification if BOTH inventory AND settings hashes match.
    // STAK-416: Previously only checked inventoryHash — settings-only changes
    // were silently swallowed because the poll recorded the pull and returned
    // without showing the DiffModal.
    if (remoteMeta.inventoryHash) {
      try {
        var localInv = typeof inventory !== "undefined" ? inventory : [];
        var localHash = await computeInventoryHash(localInv);
        var invMatch = localHash && localHash === remoteMeta.inventoryHash;

        // Also compare settings hash when available
        var settingsMatch = true; // default true if no remote hash (backward compat)
        if (remoteMeta.settingsHash) {
          try {
            var localSetHash = await computeSettingsHash();
            settingsMatch = localSetHash && localSetHash === remoteMeta.settingsHash;
          } catch (_sErr) {
            settingsMatch = false;
          }
        }

        console.warn(
          "[CloudSync] Poll: hash comparison — inv:",
          invMatch,
          "settings:",
          settingsMatch,
          "| local:",
          localInv.length,
          "items vs remote:",
          remoteMeta.itemCount,
          "items"
        );

        if (invMatch && settingsMatch) {
          console.warn(
            "[CloudSync] Poll: inventory + settings hashes MATCH — silently recording pull"
          );
          syncSetLastPull({
            syncId: remoteMeta.syncId,
            timestamp: remoteMeta.timestamp,
            rev: remoteMeta.rev,
          });
          return;
        }
        if (invMatch && !settingsMatch) {
          console.warn(
            "[CloudSync] Poll: inventory matches but SETTINGS DIFFER — proceeding to pull"
          );
        }
      } catch (_hashErr) {
        console.warn(
          "[CloudSync] Poll: hash comparison failed (falling through):",
          _hashErr.message
        );
      }
    }

    // STAK-414: Before pulling, check if local inventory was modified more
    // recently than the remote vault. If so, the hash mismatch is because WE
    // changed — not the remote. Trigger a push instead of a pull to avoid
    // showing the user's own new items as deletions.
    var localModStr = localStorage.getItem("cloud_sync_local_modified");
    if (localModStr && remoteMeta.timestamp) {
      var localModTime = new Date(localModStr).getTime();
      var remoteTime = new Date(remoteMeta.timestamp).getTime();
      if (localModTime > remoteTime) {
        console.warn(
          "[CloudSync] Poll: local inventory is NEWER than remote (" +
            localModStr +
            " > " +
            remoteMeta.timestamp +
            ") — triggering push instead of pull"
        );
        logCloudSyncActivity("auto_sync_poll", "success", "Local newer than remote — pushing");
        if (typeof scheduleSyncPush === "function") scheduleSyncPush();
        return;
      }
    }

    console.warn(
      "[CloudSync] Poll: REMOTE CHANGE DETECTED — calling handleRemoteChange. syncId:",
      remoteMeta.syncId,
      "itemCount:",
      remoteMeta.itemCount
    );
    logCloudSyncActivity(
      "auto_sync_poll",
      "success",
      "Remote change detected: " + remoteMeta.itemCount + " items"
    );
    await handleRemoteChange(remoteMeta);
  } catch (err) {
    debugLog("[CloudSync] Poll error:", err);
  }
}

// ---------------------------------------------------------------------------
// Conflict detection & resolution
// ---------------------------------------------------------------------------

/**
 * Determine whether we have local unpushed changes.
 * We consider local "dirty" if our last push was more recent than our last pull
 * (meaning we've pushed something that predates the remote change, so both
 * sides have diverged independently).
 * @returns {boolean}
 */
function syncHasLocalChanges() {
  var lastPush = syncGetLastPush();
  var lastPull = syncGetLastPull();
  if (!lastPush) return false;
  if (!lastPull) return true; // pushed but never pulled
  return lastPush.timestamp > lastPull.timestamp;
}

/**
 * Handle a detected remote change.
 * If no local changes → show update-available modal, then pull on Accept.
 * If both sides changed → show conflict modal.
 * @param {object} remoteMeta - The parsed staktrakr-sync.json content
 */
async function handleRemoteChange(remoteMeta) {
  console.warn(
    "[CloudSync] handleRemoteChange called — remote deviceId:",
    remoteMeta.deviceId,
    "syncId:",
    remoteMeta.syncId,
    "itemCount:",
    remoteMeta.itemCount
  );

  // Don't interrupt the user mid-password-entry — retry on next poll cycle
  if (_syncPasswordPromptActive) {
    console.warn("[CloudSync] handleRemoteChange: password prompt active — DEFERRING");
    return;
  }

  // Set flag to block pushes while we show the modal
  _syncRemoteChangeActive = true;

  // Cancel any queued debounced push before showing the update/conflict modal.
  // Without this, the debounced push can fire while the modal is open, overwriting
  // the remote vault with stale local data. The pull then downloads our own just-pushed
  // data instead of the remote device's changes — silently discarding them.
  if (typeof scheduleSyncPush === "function" && typeof scheduleSyncPush.cancel === "function") {
    scheduleSyncPush.cancel();
    debugLog("[CloudSync] Cancelled queued push — remote change takes priority");
  }

  try {
    // STAK-413: Go directly to the DiffModal (Review Sync Changes) for ALL
    // remote changes — both conflict and non-conflict. The intermediate dialogs
    // (Sync Update Available, Sync Conflict) were redundant layers that confused
    // users without adding information the DiffModal doesn't already provide.
    console.warn("[CloudSync] handleRemoteChange: going directly to pull preview");
    await pullWithPreview(remoteMeta);
  } finally {
    _syncRemoteChangeActive = false;
  }
}

// ---------------------------------------------------------------------------
// Shared attachment vault pull helper (STRK-65)
// ---------------------------------------------------------------------------

async function _pullAttachmentVault(remoteMeta, token, password, pathLabel) {
  var result = { hash: null, restored: null, skipped: false };
  if (!remoteMeta?.attachmentVault || typeof vaultDecryptAndRestoreAttachments !== "function") {
    return result;
  }
  try {
    var syncAttachPref =
      typeof loadDataSync === "function" ? loadDataSync("syncAttachments", null) : null;
    if (syncAttachPref === "false" || syncAttachPref === false) {
      debugLog("[CloudSync] " + pathLabel + ": attachment binary sync disabled — skipping pull");
      result.skipped = true;
      return result;
    }
    var lastPull = syncGetLastPull();
    var localHash = lastPull ? lastPull.attachmentHash : null;
    if (remoteMeta.attachmentVault.hash === localHash) {
      debugLog("[CloudSync] " + pathLabel + ": attachment vault hash matches — skipping");
      return { hash: localHash, restored: null, skipped: true };
    }
    debugLog(
      "[CloudSync] " + pathLabel + ": attachment vault changed — pulling",
      remoteMeta.attachmentVault.attachmentCount,
      "attachments"
    );
    var apiArg = JSON.stringify({ path: SYNC_ATTACHMENTS_PATH });
    var resp = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Dropbox-API-Arg": apiArg },
    });
    if (resp.ok) {
      var bytes = new Uint8Array(await resp.arrayBuffer());
      var count = await vaultDecryptAndRestoreAttachments(bytes, password);
      result.hash = remoteMeta.attachmentVault.hash;
      result.restored = count || 0;
      debugLog("[CloudSync] " + pathLabel + ": attachment vault restored:", count, "attachments");
      logCloudSyncActivity(
        "attachment_vault_pull",
        "success",
        (count || "?") + " attachments restored (" + pathLabel + ")"
      );
    } else if (resp.status === 404) {
      result.hash = remoteMeta.attachmentVault.hash;
      debugLog("[CloudSync] " + pathLabel + ": attachment vault not found (404) — skipping");
    } else {
      console.warn("[CloudSync] " + pathLabel + ": attachment vault download failed:", resp.status);
      logCloudSyncActivity("attachment_vault_pull", "fail", "HTTP " + resp.status);
    }
  } catch (err) {
    var msg = String(err.message || err);
    console.warn("[CloudSync] " + pathLabel + ": attachment vault pull error (non-fatal):", msg);
    logCloudSyncActivity("attachment_vault_pull", "fail", pathLabel + ": " + msg);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pull (download and restore remote vault)
// ---------------------------------------------------------------------------

/**
 * Download staktrakr-sync.stvault, decrypt, and restore inventory.
 * @param {object} remoteMeta - Remote sync metadata (from pollForRemoteChanges)
 */
async function pullSyncVault(remoteMeta) {
  debugLog("[CloudSync] pullSyncVault invoked as DiffEngine fallback — full overwrite path");
  // Try silent key first (Simple mode or cached Secure password)
  var password = getSyncPasswordSilent();
  if (!password) {
    // Secure mode with no cached password — prompt interactively
    password = await getSyncPassword();
  }
  if (!password) {
    debugLog("[CloudSync] Pull cancelled — no password");
    return;
  }

  if (!_assertSyncAccountId("pullSyncVault")) return;

  var token = typeof cloudGetToken === "function" ? await cloudGetToken(_syncProvider) : null;
  if (!token) throw new Error("Not connected to cloud provider");

  var pullStart = Date.now();
  updateSyncStatusIndicator("syncing");

  try {
    var apiArg = JSON.stringify({ path: SYNC_FILE_PATH });
    var resp = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Dropbox-API-Arg": apiArg,
      },
    });

    if (!resp.ok) throw new Error("Vault download failed: " + resp.status);

    var bytes = new Uint8Array(await resp.arrayBuffer());

    syncSaveOverrideBackup();

    if (typeof vaultDecryptAndRestore === "function") {
      // Try all key variants — the vault may have been encrypted with a different
      // key variant than the metadata (e.g., password-only vs composite)
      var vaultDecrypted = false;
      var vaultCandidates = _getSyncKeyCandidates();
      for (var vi = 0; vi < vaultCandidates.length; vi++) {
        try {
          await vaultDecryptAndRestore(bytes, vaultCandidates[vi].key);
          console.warn("[CloudSync] Vault decrypted with", vaultCandidates[vi].label, "key");
          vaultDecrypted = true;
          password = vaultCandidates[vi].key; // use this key for image vault too
          break;
        } catch (_vaultErr) {
          console.warn(
            "[CloudSync] Vault decrypt attempt",
            vi + 1,
            "failed (" + vaultCandidates[vi].label + ")"
          );
        }
      }
      if (!vaultDecrypted) throw new Error("All key variants failed to decrypt vault");
    } else {
      throw new Error("vaultDecryptAndRestore not available");
    }

    // Pull image vault if remote has photos we don't have (STAK-181)
    var pulledImageHash = null;
    if (remoteMeta && remoteMeta.imageVault && typeof vaultDecryptAndRestoreImages === "function") {
      try {
        var lastPull = syncGetLastPull();
        var localImageHash = lastPull ? lastPull.imageHash : null;
        if (remoteMeta.imageVault.hash !== localImageHash) {
          debugLog(
            "[CloudSync] Image vault changed — pulling",
            remoteMeta.imageVault.imageCount,
            "photos"
          );
          var imgApiArg = JSON.stringify({ path: SYNC_IMAGES_PATH });
          var imgPullResp = await fetch("https://content.dropboxapi.com/2/files/download", {
            method: "POST",
            headers: { Authorization: "Bearer " + token, "Dropbox-API-Arg": imgApiArg },
          });
          if (imgPullResp.ok) {
            var imgBytes = new Uint8Array(await imgPullResp.arrayBuffer());
            var restoredCount = await vaultDecryptAndRestoreImages(imgBytes, password);
            pulledImageHash = remoteMeta.imageVault.hash;
            debugLog("[CloudSync] Image vault restored:", restoredCount, "photos");
            logCloudSyncActivity("image_vault_pull", "success", restoredCount + " photos restored");
          } else if (imgPullResp.status === 404) {
            // File not yet uploaded (fresh account or first push in progress) — not an error.
            // Set hash sentinel to stop retry loop until manifest changes.
            pulledImageHash = remoteMeta.imageVault.hash;
            debugLog("[CloudSync] Image vault not found on remote (404) — skipping");
          } else {
            console.warn("[CloudSync] Image vault download failed:", imgPullResp.status);
            logCloudSyncActivity("image_vault_pull", "fail", "HTTP " + imgPullResp.status);
          }
        } else {
          debugLog("[CloudSync] Image vault hash matches — no image pull needed");
          pulledImageHash = localImageHash;
        }
      } catch (imgErr) {
        var imgPullErrMsg = String(imgErr.message || imgErr);
        console.warn("[CloudSync] Image vault pull error (non-fatal):", imgPullErrMsg);
        logCloudSyncActivity("image_vault_pull", "fail", imgPullErrMsg);
      }
    }

    // Pull attachment vault if remote has attachments we don't have (STRK-45, STRK-65)
    var _attachResult = await _pullAttachmentVault(remoteMeta, token, password, "auto-sync");
    var pulledAttachmentHash = _attachResult.hash;

    // Record the pull
    var pullMeta = {
      syncId: remoteMeta ? remoteMeta.syncId : null,
      timestamp: remoteMeta ? remoteMeta.timestamp : Date.now(),
      rev: remoteMeta ? remoteMeta.rev : null,
    };
    if (pulledImageHash) pullMeta.imageHash = pulledImageHash;
    if (pulledAttachmentHash) pullMeta.attachmentHash = pulledAttachmentHash;
    syncSetLastPull(pullMeta);

    var duration = Date.now() - pullStart;
    logCloudSyncActivity(
      "auto_sync_pull",
      "success",
      (remoteMeta ? remoteMeta.itemCount : "?") + " items restored",
      duration
    );
    debugLog("[CloudSync] Pull complete (" + duration + "ms)");

    if (typeof showCloudToast === "function") {
      showCloudToast("Auto-sync: inventory updated from another device.");
    }
    updateSyncStatusIndicator("idle", "just now");
    refreshSyncUI();

    // Broadcast pull completion to other tabs
    if (_syncChannel) {
      try {
        _syncChannel.postMessage({ type: "sync-pull-complete", tabId: getSyncDeviceId() });
      } catch (_) {
        /* ignore */
      }
    }
  } catch (err) {
    var errMsg = String(err.message || err);
    debugLog("[CloudSync] Pull failed:", errMsg);
    logCloudSyncActivity("auto_sync_pull", "fail", errMsg);
    updateSyncStatusIndicator("error", errMsg.slice(0, 60));
    if (typeof showCloudToast === "function") showCloudToast("Auto-sync pull failed: " + errMsg);
  }
}

// ---------------------------------------------------------------------------
// Restore preview (Layer 5 — REQ-5)
// ---------------------------------------------------------------------------

function _tagSyncKeys() {
  return [
    typeof ITEM_TAGS_KEY !== "undefined" ? ITEM_TAGS_KEY : "itemTags",
    typeof ITEM_REMOVED_TAGS_KEY !== "undefined" ? ITEM_REMOVED_TAGS_KEY : "itemRemovedTags",
    typeof ITEM_TAGS_LAST_MODIFIED_KEY !== "undefined"
      ? ITEM_TAGS_LAST_MODIFIED_KEY
      : "itemTagsLastModified",
  ];
}

function _isTagSyncKey(key) {
  return _tagSyncKeys().indexOf(key) !== -1;
}

function _normalizeRawStorageValue(value) {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function _parseTagStore(rawValue, fallback) {
  if (rawValue === undefined || rawValue === null) return fallback || {};
  try {
    var raw = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
    var decoded = typeof __decompressIfNeeded === "function" ? __decompressIfNeeded(raw) : raw;
    var parsed = typeof decoded === "string" ? JSON.parse(decoded) : decoded;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : fallback || {};
  } catch (_e) {
    return fallback || {};
  }
}

function _extractRemoteTagData(remoteSettings) {
  remoteSettings = remoteSettings || {};
  return {
    itemTags: remoteSettings[_tagSyncKeys()[0]],
    itemRemovedTags: remoteSettings[_tagSyncKeys()[1]],
    itemTagsLastModified: remoteSettings[_tagSyncKeys()[2]],
  };
}

function _hasTagChanges(remoteSettings) {
  if (!remoteSettings) return false;
  var keys = _tagSyncKeys();
  for (var i = 0; i < keys.length; i++) {
    var localVal = typeof localStorage !== "undefined" ? localStorage.getItem(keys[i]) : null;
    var remoteVal = _normalizeRawStorageValue(remoteSettings[keys[i]]);
    if (localVal !== remoteVal) return true;
  }
  return false;
}

function _restoreRawStorageValues(priorValues) {
  if (!priorValues || typeof localStorage === "undefined") return { failed: 0, total: 0 };
  var keys = Object.keys(priorValues);
  var failed = 0;
  for (var i = 0; i < keys.length; i++) {
    try {
      if (priorValues[keys[i]] === null) localStorage.removeItem(keys[i]);
      else localStorage.setItem(keys[i], priorValues[keys[i]]);
    } catch (_e) {
      failed++;
    }
  }
  if (failed > 0) {
    console.warn(
      "[CloudSync] _restoreRawStorageValues: " +
        failed +
        "/" +
        keys.length +
        " keys failed to restore"
    );
  }
  return { failed: failed, total: keys.length };
}

/**
 * STRK-155: Deterministic, commutative union of two tag arrays.
 * Dedups case-insensitively (matching addItemTag's case-insensitive dedup in
 * tags.js), picks the lexicographically-smallest original string as the
 * representative so merge(A,B) and merge(B,A) yield byte-identical output, and
 * returns the result sorted by lowercased key. Trims and drops blank/non-string
 * entries. Commutativity is the whole point: it is what lets two diverged
 * devices converge to the same superset on a timestamp tie.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {string[]}
 */
function _unionTags(a, b) {
  var byLower = {};
  var all = (Array.isArray(a) ? a : []).concat(Array.isArray(b) ? b : []);
  for (var i = 0; i < all.length; i++) {
    if (typeof all[i] !== "string") continue;
    var trimmed = all[i].trim();
    if (!trimmed) continue;
    var key = trimmed.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(byLower, key) || trimmed < byLower[key]) {
      byLower[key] = trimmed;
    }
  }
  return Object.keys(byLower)
    .sort()
    .map(function (k) {
      return byLower[k];
    });
}

function _mergeTagData(remoteTagData) {
  var keys = _tagSyncKeys();
  remoteTagData = remoteTagData || {};

  var localTags =
    typeof loadDataSync === "function" ? loadDataSync(keys[0], {}) : _parseTagStore(null, {});
  var localRemoved =
    typeof loadDataSync === "function" ? loadDataSync(keys[1], {}) : _parseTagStore(null, {});
  var localTimestamps =
    typeof loadTagTimestamps === "function"
      ? loadTagTimestamps()
      : typeof loadDataSync === "function"
        ? loadDataSync(keys[2], {})
        : {};

  var remoteTags = _parseTagStore(remoteTagData.itemTags, {});
  var remoteRemoved = _parseTagStore(remoteTagData.itemRemovedTags, {});
  var remoteTimestamps = _parseTagStore(remoteTagData.itemTagsLastModified, {});

  localTags =
    typeof localTags === "object" && localTags !== null && !Array.isArray(localTags)
      ? localTags
      : {};
  localRemoved =
    typeof localRemoved === "object" && localRemoved !== null && !Array.isArray(localRemoved)
      ? localRemoved
      : {};
  localTimestamps =
    typeof localTimestamps === "object" &&
    localTimestamps !== null &&
    !Array.isArray(localTimestamps)
      ? localTimestamps
      : {};

  var mergedTags = Object.assign({}, localTags);
  var mergedRemoved = Object.assign({}, localRemoved);
  var mergedTimestamps = Object.assign({}, localTimestamps);
  var uuidSet = new Set();
  [localTags, localRemoved, localTimestamps, remoteTags, remoteRemoved, remoteTimestamps].forEach(
    function (store) {
      Object.keys(store || {}).forEach(function (uuid) {
        uuidSet.add(uuid);
      });
    }
  );

  var updated = 0;
  uuidSet.forEach(function (uuid) {
    var localTs = Number(localTimestamps[uuid] || 0);
    var remoteTs = Number(remoteTimestamps[uuid] || 0);
    if (remoteTs > localTs) {
      if (Array.isArray(remoteTags[uuid]) && remoteTags[uuid].length > 0) {
        mergedTags[uuid] = remoteTags[uuid].slice();
      } else {
        delete mergedTags[uuid];
      }
      if (Array.isArray(remoteRemoved[uuid]) && remoteRemoved[uuid].length > 0) {
        mergedRemoved[uuid] = remoteRemoved[uuid].slice();
      } else {
        delete mergedRemoved[uuid];
      }
      mergedTimestamps[uuid] = remoteTs;
      updated++;
    } else if (
      remoteTs === localTs &&
      Object.prototype.hasOwnProperty.call(remoteTimestamps, uuid) &&
      Object.prototype.hasOwnProperty.call(localTimestamps, uuid)
    ) {
      // STRK-155: timestamp tie with potentially divergent content. A plain
      // last-write-wins no-op here is non-commutative and freezes two diverged
      // devices in a permanent "Review Sync Changes" loop. Take the deterministic
      // union of both sides instead — union is commutative, so both devices
      // converge to the same superset within one round-trip. Only the side(s)
      // whose content actually changes bump the timestamp, so once both agree the
      // merge is idempotent. Known trade-off (confirmed): a tag removed on one
      // device without bumping its timestamp can reappear (data-loss-averse).
      var unionedTags = _unionTags(localTags[uuid], remoteTags[uuid]);
      var unionedRemoved = _unionTags(localRemoved[uuid], remoteRemoved[uuid]);
      var canonicalLocalTags = _unionTags(localTags[uuid], []);
      var canonicalLocalRemoved = _unionTags(localRemoved[uuid], []);
      var tagsChanged = unionedTags.join(" ") !== canonicalLocalTags.join(" ");
      var removedChanged = unionedRemoved.join(" ") !== canonicalLocalRemoved.join(" ");

      if (unionedTags.length > 0) mergedTags[uuid] = unionedTags;
      else delete mergedTags[uuid];
      if (unionedRemoved.length > 0) mergedRemoved[uuid] = unionedRemoved;
      else delete mergedRemoved[uuid];

      if (tagsChanged || removedChanged) {
        mergedTimestamps[uuid] = Date.now();
        updated++;
      }
    }
  });

  Object.keys(mergedTags).forEach(function (uuid) {
    if (!Array.isArray(mergedTags[uuid]) || mergedTags[uuid].length === 0) {
      delete mergedTags[uuid];
      return;
    }
    if (!Array.isArray(mergedRemoved[uuid])) return;
    var presentTags = new Set(
      mergedTags[uuid].map(function (tag) {
        return String(tag).toLowerCase();
      })
    );
    mergedRemoved[uuid] = mergedRemoved[uuid].filter(function (tag) {
      return !presentTags.has(String(tag).toLowerCase());
    });
    if (mergedRemoved[uuid].length === 0) delete mergedRemoved[uuid];
  });

  if (typeof saveDataSync === "function") {
    saveDataSync(keys[0], mergedTags);
    saveDataSync(keys[1], mergedRemoved);
    saveDataSync(keys[2], mergedTimestamps);
  } else if (typeof localStorage !== "undefined") {
    localStorage.setItem(keys[0], JSON.stringify(mergedTags));
    localStorage.setItem(keys[1], JSON.stringify(mergedRemoved));
    localStorage.setItem(keys[2], JSON.stringify(mergedTimestamps));
  }

  if (typeof loadItemTags === "function") loadItemTags();
  return { merged: true, uuidsUpdated: updated };
}

function _mergeOneSidedTagSettings(remoteSettings) {
  var tagKeysMerged = 0;
  var tagData = _extractRemoteTagData(remoteSettings);
  Object.keys(tagData).forEach(function (key) {
    if (tagData[key] !== undefined && tagData[key] !== null) tagKeysMerged++;
  });
  if (tagKeysMerged === 0) return { tagKeysMerged: 0, mergeResult: null };
  return {
    tagKeysMerged: tagKeysMerged,
    mergeResult: _mergeTagData(tagData),
  };
}

/**
 * Consolidated post-apply sequence for sync and vault restore paths.
 * Handles backup, inventory assignment, settings application, save/render,
 * pull metadata recording, toast summary, status indicator, UI refresh,
 * and cross-tab broadcast.
 *
 * Extracted to eliminate duplication between showRestorePreviewModal onApply,
 * _deferredVaultRestore, and the manifest-first pull path (STAK-DiffMerge).
 *
 * @param {object[]} newInventory - Result of DiffEngine.applySelectedChanges() (array)
 * @param {object[]} selectedChanges - Changes array from DiffModal (for toast summary counts)
 * @param {object[]|null} settingsChanges - Array of {key, remoteVal} for checked settings, or null
 * @param {object|null} remoteMeta - For syncSetLastPull() recording, or null
 * @param {object} [options] - Configuration options
 * @param {string} [options.source='sync'] - 'sync' or 'vault' — controls toast prefix
 * @param {boolean} [options.showToast=true] - Whether to show the summary toast
 * @param {boolean} [options.broadcastPull=true] - Whether to broadcast pull-complete to other tabs
 * @param {object} [options.remoteTagData] - Raw remote tag stores from sync payload
 */
function _applyAndFinalize(newInventory, selectedChanges, settingsChanges, remoteMeta, options) {
  var acceptanceCutoff = Date.now();

  // Normalize options with defaults
  var opts = options || {};
  var source = opts.source || "sync";
  var shouldToast = opts.showToast !== false;
  var shouldBroadcast = opts.broadcastPull !== false;
  var tagPriorValues = null;

  // 1. Pre-apply backup
  if (typeof syncSaveOverrideBackup === "function") {
    syncSaveOverrideBackup();
  }

  // 2. Assign new inventory
  // _prevInventory captures pre-pull state for rollback if settings writes fail (STAK-526).
  // Snapshot is taken unconditionally; if newInventory is null the inventory global is never
  // mutated so rollback is a safe no-op in that branch (REQ-5.3 — zero practical impact).
  var _prevInventory = inventory;
  if (typeof newInventory !== "undefined" && newInventory !== null) {
    inventory = newInventory;
  }

  if (opts.remoteTagData) {
    var tagKeys = _tagSyncKeys();
    tagPriorValues = {};
    for (var tk = 0; tk < tagKeys.length; tk++) {
      tagPriorValues[tagKeys[tk]] =
        typeof localStorage !== "undefined" ? localStorage.getItem(tagKeys[tk]) : null;
    }
    try {
      _mergeTagData(opts.remoteTagData);
    } catch (tagErr) {
      inventory = _prevInventory;
      _restoreRawStorageValues(tagPriorValues);
      if (typeof loadItemTags === "function") loadItemTags();
      console.warn("[CloudSync] Tag merge failed — rolling back pull:", tagErr);
      logCloudSyncActivity(
        "cloud_sync_pull",
        "partial",
        { failedCount: 1, failedKeys: tagKeys },
        null
      );
      if (typeof updateSyncStatusIndicator === "function") {
        updateSyncStatusIndicator("error", "rollback");
      }
      if (typeof refreshSyncUI === "function") refreshSyncUI();
      return;
    }
  }

  // 3. Apply settings changes.
  // remoteVal is typically a raw localStorage string (from vault payload.data or
  // manifest.settings snapshot), but DiffModal may pass non-string values for
  // merged objects. The stringify guard below ensures non-strings are JSON-encoded
  // before writing, while scalar string preferences (appTheme, appTimeZone, etc.)
  // are written as-is to match the format expected by theme.js and settings-listeners.js.
  if (settingsChanges && Array.isArray(settingsChanges)) {
    var _failedCount = 0;
    var _failedKeys = [];
    var _appliedKeys = [];
    var _priorValues = {};
    for (var i = 0; i < settingsChanges.length; i++) {
      var sc = settingsChanges[i];
      if (!sc || !sc.key) {
        continue;
      }
      if (
        typeof ALLOWED_STORAGE_KEYS !== "undefined" &&
        ALLOWED_STORAGE_KEYS.indexOf(sc.key) === -1
      ) {
        continue;
      }
      if (
        sc.remoteVal !== null &&
        sc.remoteVal !== undefined &&
        typeof localStorage !== "undefined"
      ) {
        // STRK-157: reject "[object Object]" corruption — never persist a value
        // that cannot round-trip and would re-stick on every pull. Skip it and
        // leave the good local value intact (not counted as a write failure).
        var writeVal = _safeSettingWriteValue(sc.remoteVal);
        if (writeVal === null) {
          debugLog("[CloudSync] STRK-157: skipped corrupt settings value for key:", sc.key);
          continue;
        }
        _priorValues[sc.key] = localStorage.getItem(sc.key);
        try {
          localStorage.setItem(sc.key, writeVal);
          _appliedKeys.push(sc.key);
        } catch (_e) {
          _failedCount++;
          _failedKeys.push(sc.key);
        }
      }
    }
    if (_failedCount > 0) {
      inventory = _prevInventory;
      _restoreRawStorageValues(tagPriorValues);
      if (typeof loadItemTags === "function") loadItemTags();
      for (var r = 0; r < _appliedKeys.length; r++) {
        try {
          var prior = _priorValues[_appliedKeys[r]];
          if (prior === null) {
            localStorage.removeItem(_appliedKeys[r]);
          } else {
            localStorage.setItem(_appliedKeys[r], prior);
          }
        } catch (_re) {
          /* ignore — best-effort restore */
        }
      }
      console.warn(
        "[CloudSync] STAK-526: " +
          _failedCount +
          " settings write(s) failed (" +
          _failedKeys.join(", ") +
          ") — rolling back pull, will retry on next cycle"
      );
      logCloudSyncActivity(
        "cloud_sync_pull",
        "partial",
        { failedCount: _failedCount, failedKeys: _failedKeys },
        null
      );
      if (typeof updateSyncStatusIndicator === "function") {
        updateSyncStatusIndicator("error", "rollback");
      }
      if (typeof refreshSyncUI === "function") {
        refreshSyncUI();
      }
      return;
    }
  }

  // 4. Save & render
  if (typeof saveInventory === "function") saveInventory();
  if (typeof window.neutralizeSupersededChangelog === "function") {
    window.neutralizeSupersededChangelog(selectedChanges, acceptanceCutoff);
  }
  if (typeof reconcileAttachmentOrphans === "function") reconcileAttachmentOrphans();
  if (typeof fetchSpotPrice === "function") {
    try {
      fetchSpotPrice();
    } catch (_e) {
      debugLog("fetchSpotPrice threw during sync pull");
    }
  }
  if (typeof renderTable === "function") renderTable();
  if (typeof renderActiveFilters === "function") renderActiveFilters();
  if (typeof updateStorageStats === "function") updateStorageStats();

  // 5. Record pull metadata — prefer explicit remoteMeta arg, fall back to global _previewPullMeta
  var meta = remoteMeta || (typeof _previewPullMeta !== "undefined" ? _previewPullMeta : null);
  if (meta) {
    if (typeof syncSetLastPull === "function") {
      syncSetLastPull(meta);
    }
    if (typeof _previewPullMeta !== "undefined") _previewPullMeta = null;
  }

  // 6. Toast summary
  if (shouldToast && typeof showCloudToast === "function") {
    var addCount = 0;
    var modCount = 0;
    var delCount = 0;

    if (selectedChanges && Array.isArray(selectedChanges)) {
      for (var t = 0; t < selectedChanges.length; t++) {
        var changeType = selectedChanges[t] ? selectedChanges[t].type : "";
        if (changeType === "add") addCount++;
        else if (changeType === "modify") modCount++;
        else if (changeType === "delete") delCount++;
      }
    }

    var parts = [];
    if (addCount > 0) parts.push(addCount + " added");
    if (modCount > 0) parts.push(modCount + " modified");
    if (delCount > 0) parts.push(delCount + " removed");

    var prefix = source === "vault" ? "Backup applied: " : "Sync applied: ";
    var summary = parts.length > 0 ? parts.join(", ") : "no changes";
    showCloudToast(prefix + summary);
  }

  // 7. Update status indicator
  if (typeof updateSyncStatusIndicator === "function") {
    updateSyncStatusIndicator("idle", "just now");
  }

  // 8. Refresh sync UI
  if (typeof refreshSyncUI === "function") {
    refreshSyncUI();
  }

  // 9. Broadcast pull-complete to other tabs
  if (shouldBroadcast && _syncChannel) {
    try {
      _syncChannel.postMessage({
        type: "sync-pull-complete",
        tabId: getSyncDeviceId(),
        ts: Date.now(),
      });
    } catch (e) {
      /* ignore broadcast errors */
    }
  }

  debugLog("[CloudSync] _applyAndFinalize complete (source=" + source + ")");
}

/**
 * Show a modal previewing what will change when applying a remote vault.
 * @param {object} diffResult - From DiffEngine.compareItems()
 * @param {object} settingsDiff - From DiffEngine.compareSettings()
 * @param {object} remotePayload - Decrypted remote vault payload
 * @param {object} remoteMeta - Remote sync metadata
 */
function showRestorePreviewModal(diffResult, settingsDiff, remotePayload, remoteMeta, conflicts) {
  // Delegate to DiffModal (STAK-184) — falls back to null if unavailable.
  // Returns a Promise that resolves when the user completes their modal action
  // (Apply or Cancel), so callers can await the full pull before clearing
  // _syncRemoteChangeActive. Returns null when DiffModal is unavailable.
  if (typeof DiffModal === "undefined" || !DiffModal.show) {
    debugLog("[CloudSync] DiffModal not available — falling back");
    return null;
  }

  var addedCount = diffResult.added ? diffResult.added.length : 0;
  var removedCount = diffResult.deleted ? diffResult.deleted.length : 0;
  var modifiedCount = diffResult.modified ? diffResult.modified.length : 0;

  return new Promise(function (resolve) {
    DiffModal.show({
      source: { type: "sync", label: _syncProvider || "Cloud" },
      diff: diffResult,
      settingsDiff: settingsDiff || null,
      conflicts: conflicts || null,
      meta: {
        deviceId: remoteMeta.deviceId,
        timestamp: remoteMeta.timestamp,
        itemCount: remoteMeta.itemCount,
        appVersion: remoteMeta.appVersion,
      },
      onApply: function (selectedChanges) {
        var p;
        try {
          // Guard: fall back to full overwrite if DiffEngine unavailable
          if (typeof DiffEngine === "undefined" || !DiffEngine.applySelectedChanges) {
            debugLog("[CloudSync] DiffEngine not available — falling back to full overwrite");
            syncSaveOverrideBackup();
            p = restoreVaultData(remotePayload)
              .then(function () {
                updateSyncStatusIndicator("idle", "just now");
                if (typeof refreshSyncUI === "function") refreshSyncUI();
                debugLog("[CloudSync] Full overwrite restore completed via fallback");
              })
              .catch(function (restoreErr) {
                debugLog("[CloudSync] Full overwrite restore failed:", restoreErr);
                updateSyncStatusIndicator("error", "Restore failed");
                if (typeof showCloudToast === "function") {
                  showCloudToast("Restore failed: " + (restoreErr.message || "Unknown error"));
                }
              });
          } else {
            // Apply only the user-selected changes via DiffEngine
            var newInv = DiffEngine.applySelectedChanges(inventory, selectedChanges);

            // Build settings changes from selectedChanges (DiffModal includes them as type:'setting')
            var settingsChanges = null;
            if (selectedChanges) {
              var extracted = [];
              for (var i = 0; i < selectedChanges.length; i++) {
                if (selectedChanges[i].type === "setting") {
                  extracted.push({
                    key: selectedChanges[i].key,
                    remoteVal: selectedChanges[i].value,
                  });
                }
              }
              if (extracted.length > 0) settingsChanges = extracted;
            } else if (settingsDiff && settingsDiff.changed && settingsDiff.changed.length > 0) {
              // Fallback for null selectedChanges (full overwrite / empty diff case)
              settingsChanges = [];
              for (var j = 0; j < settingsDiff.changed.length; j++) {
                settingsChanges.push({
                  key: settingsDiff.changed[j].key,
                  remoteVal: settingsDiff.changed[j].remoteVal,
                });
              }
            }

            // Delegate everything to _applyAndFinalize (backup, save, render, toast, status, broadcast)
            _applyAndFinalize(newInv, selectedChanges, settingsChanges, remoteMeta, {
              source: "sync",
              remoteTagData:
                remotePayload && remotePayload.data
                  ? _extractRemoteTagData(remotePayload.data)
                  : null,
            });
            debugLog("[CloudSync] Restore preview: applied selected changes via DiffEngine");
            p = Promise.resolve();
          }
        } catch (applyErr) {
          debugLog("[CloudSync] Restore preview: apply failed:", applyErr);
          updateSyncStatusIndicator("error", "Restore failed");
          if (typeof showCloudToast === "function")
            showCloudToast("Restore failed: " + applyErr.message);
          p = Promise.resolve();
        }
        p.then(resolve).catch(resolve);
      },
      onCancel: function () {
        resolve();
      },
    });
  });
}

/**
 * Build a diff-like result from a decrypted manifest payload.
 * Converts manifest.changes into the {added, modified, deleted, unchanged}
 * format that DiffModal expects.
 * @param {object} manifest - Decrypted manifest object from decryptManifest()
 * @returns {object} DiffModal-compatible diff result
 */
function _buildDiffFromManifest(manifest) {
  var added = [];
  var modified = [];
  var deleted = [];
  var changes = manifest.changes || [];

  for (var i = 0; i < changes.length; i++) {
    var change = changes[i];
    var changeType = _normalizeItemChangeType(change.type);
    if (changeType === "add") {
      added.push({ name: change.itemName || change.itemKey, itemKey: change.itemKey });
    } else if (changeType === "edit") {
      var modChanges = [];
      var fields = change.fields || [];
      for (var f = 0; f < fields.length; f++) {
        modChanges.push({
          field: fields[f].field,
          localVal: fields[f].oldValue,
          remoteVal: fields[f].newValue,
        });
      }
      modified.push({
        item: { name: change.itemName || change.itemKey, itemKey: change.itemKey },
        changes: modChanges,
      });
    } else if (changeType === "delete") {
      deleted.push({ name: change.itemName || change.itemKey, itemKey: change.itemKey });
    }
  }

  // We can't know the exact unchanged count from the manifest alone, so use
  // an empty array — DiffModal handles empty unchanged gracefully.
  var unchanged = [];

  return { added: added, modified: modified, deleted: deleted, unchanged: unchanged };
}

/**
 * Deferred vault restore — downloads the full vault, decrypts, and applies.
 * Called from the manifest-first pull path's onApply callback, so the heavy
 * vault download only happens when the user confirms the diff preview.
 *
 * When selectedChanges is provided and DiffEngine is available, performs a
 * selective merge (only the user-approved changes). Otherwise falls back to
 * the legacy full-overwrite path.
 *
 * @param {string} token - Dropbox OAuth bearer token
 * @param {string} password - Vault encryption password
 * @param {object} remoteMeta - Remote sync metadata
 * @param {Array} [selectedChanges] - User-approved changes from DiffModal
 * @returns {Promise<void>}
 */
async function _deferredVaultRestore(token, password, remoteMeta, selectedChanges) {
  try {
    updateSyncStatusIndicator("syncing");
    var apiArg = JSON.stringify({ path: SYNC_FILE_PATH });
    var resp = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Dropbox-API-Arg": apiArg,
      },
    });
    if (!resp.ok) throw new Error("Vault download failed: " + resp.status);
    var bytes = new Uint8Array(await resp.arrayBuffer());

    // ── Selective apply path ──
    if (
      selectedChanges &&
      typeof DiffEngine !== "undefined" &&
      typeof DiffEngine.applySelectedChanges === "function"
    ) {
      var payload =
        typeof vaultDecryptToData === "function" ? await _tryDecryptVault(bytes, "stvault") : null;

      if (payload && payload.data) {
        // Extract remote items from the vault payload
        // Vault stores raw localStorage strings which may be CMP1-compressed for large inventories
        var remoteItems = [];
        try {
          var rawInv = payload.data.metalInventory || "[]";
          var decompressedInv =
            typeof __decompressIfNeeded === "function" ? __decompressIfNeeded(rawInv) : rawInv;
          remoteItems = JSON.parse(decompressedInv);
          if (typeof migrateLegacySilverbackWeightUnit === "function") {
            migrateLegacySilverbackWeightUnit(remoteItems);
          }
        } catch (parseErr) {
          debugLog("[CloudSync] Could not parse metalInventory from vault:", parseErr.message);
        }

        // STAK-493-B: For 'add' changes from the manifest-first path, the
        // DiffModal receives stub items ({ name, itemKey }) — not full item
        // objects. Resolve full items from the decrypted vault before
        // applySelectedChanges inserts them.
        //
        // Detection: a stub item lacks core fields like 'uuid' or 'metal'.
        // The original condition (change.itemKey && !change.item) never fired
        // because DiffModal sets change.item to the stub and doesn't set
        // change.itemKey at the top level of the change object.
        for (var i = 0; i < selectedChanges.length; i++) {
          var change = selectedChanges[i];
          if (change.type !== "add") continue;

          // Determine the lookup key: prefer top-level itemKey, fall back to
          // item.itemKey (manifest stub), or compute from the item object.
          var lookupKey =
            change.itemKey ||
            (change.item && change.item.itemKey) ||
            (change.item && change.item.uuid) ||
            null;

          // Resolve if: no item at all, or item is a manifest stub (missing uuid/metal)
          var needsResolve = !change.item || (!change.item.uuid && !change.item.metal);

          if (
            needsResolve &&
            lookupKey &&
            typeof DiffEngine !== "undefined" &&
            typeof DiffEngine.computeItemKey === "function"
          ) {
            for (var j = 0; j < remoteItems.length; j++) {
              if (DiffEngine.computeItemKey(remoteItems[j]) === lookupKey) {
                change.item = remoteItems[j];
                break;
              }
            }
          }
        }

        var localItems = typeof inventory !== "undefined" ? inventory : [];
        var newInv = DiffEngine.applySelectedChanges(localItems, selectedChanges);
        // STAK-409: Safety guard — if selective apply would empty the vault but the
        // remote has items, the manifest-first diff missed remote-only additions
        // (items the local device has never seen). Fall through to full overwrite
        // to prevent silent data loss.
        if (newInv.length === 0 && remoteItems.length > 0) {
          debugLog(
            "[CloudSync] Selective apply would empty vault but remote has",
            remoteItems.length,
            "items — falling back to full overwrite"
          );
          // fall through to full-overwrite path below
        } else {
          // STAK-426: Extract settings from vault payload and compare.
          // Use raw localStorage.getItem() for local settings so scalar string
          // preferences (appTheme, appTimeZone, etc.) are included — loadDataSync()
          // JSON-parses and returns null for those raw-string values. payload.data
          // also contains raw localStorage strings, so both sides use the same
          // serialization format and the comparison is stable.
          var _dvSettingsChanges = null;
          if (
            payload.data &&
            typeof SYNC_SCOPE_KEYS !== "undefined" &&
            typeof DiffEngine !== "undefined" &&
            DiffEngine.compareSettings
          ) {
            var _dvLocalSettings = {};
            var _dvRemoteSettings = {};
            for (var _dvs = 0; _dvs < SYNC_SCOPE_KEYS.length; _dvs++) {
              if (
                SYNC_SCOPE_KEYS[_dvs] === "metalInventory" ||
                _isTagSyncKey(SYNC_SCOPE_KEYS[_dvs])
              )
                continue;
              var _dvlv =
                typeof localStorage !== "undefined"
                  ? localStorage.getItem(SYNC_SCOPE_KEYS[_dvs])
                  : null;
              if (_dvlv !== null) _dvLocalSettings[SYNC_SCOPE_KEYS[_dvs]] = _dvlv;
              if (payload.data[SYNC_SCOPE_KEYS[_dvs]] !== undefined) {
                _dvRemoteSettings[SYNC_SCOPE_KEYS[_dvs]] = payload.data[SYNC_SCOPE_KEYS[_dvs]];
              }
            }
            var _dvsDiff = DiffEngine.compareSettings(_dvLocalSettings, _dvRemoteSettings);
            if (_dvsDiff && _dvsDiff.changed && _dvsDiff.changed.length > 0) {
              _dvSettingsChanges = _dvsDiff.changed;
            }
          }
          _applyAndFinalize(newInv, selectedChanges, _dvSettingsChanges, remoteMeta, {
            source: "sync",
            remoteTagData: _extractRemoteTagData(payload.data),
          });
          debugLog(
            "[CloudSync] Deferred vault restore complete (selective apply, settings:",
            _dvSettingsChanges ? _dvSettingsChanges.length + " changes" : "none",
            ")"
          );

          // STAK-426: Restore image vault on manifest-first path (previously skipped)
          try {
            if (
              remoteMeta &&
              remoteMeta.imageVault &&
              typeof vaultDecryptAndRestoreImages === "function"
            ) {
              var _dvLastPull = syncGetLastPull();
              var _dvLocalImageHash = _dvLastPull ? _dvLastPull.imageHash : null;
              if (remoteMeta.imageVault.hash !== _dvLocalImageHash) {
                debugLog(
                  "[CloudSync] Manifest-path: image vault changed — pulling",
                  remoteMeta.imageVault.imageCount,
                  "photos"
                );
                var _dvImgArg = JSON.stringify({ path: SYNC_IMAGES_PATH });
                var _dvImgResp = await fetch("https://content.dropboxapi.com/2/files/download", {
                  method: "POST",
                  headers: {
                    Authorization: "Bearer " + token,
                    "Dropbox-API-Arg": _dvImgArg,
                  },
                });
                if (_dvImgResp.ok) {
                  var _dvImgBytes = new Uint8Array(await _dvImgResp.arrayBuffer());
                  var _dvRestoredCount = await vaultDecryptAndRestoreImages(_dvImgBytes, password);
                  debugLog("[CloudSync] Manifest-path: image vault restored");
                  logCloudSyncActivity(
                    "image_vault_pull",
                    "success",
                    (_dvRestoredCount || "?") + " photos restored (manifest path)"
                  );
                }
              }
            }
          } catch (_dvImgErr) {
            debugLog(
              "[CloudSync] Manifest-path image restore failed (non-blocking):",
              _dvImgErr.message
            );
            logCloudSyncActivity("image_vault_pull", "fail", "Manifest path: " + _dvImgErr.message);
          }

          // STRK-45/STRK-65: Restore attachment vault on manifest-first path
          var _dvAttachResult = await _pullAttachmentVault(
            remoteMeta,
            token,
            password,
            "manifest-path"
          );
          if (_dvAttachResult.hash) {
            var _dvPullMeta = syncGetLastPull() || {};
            _dvPullMeta.attachmentHash = _dvAttachResult.hash;
            syncSetLastPull(_dvPullMeta);
          }

          return;
        }
      }
      // payload missing or corrupt — fall through to full overwrite
      debugLog("[CloudSync] Selective apply failed (bad payload) — falling back to full overwrite");
    }

    // ── Full-overwrite fallback (try all key variants) ──
    syncSaveOverrideBackup();
    var fbPayload = await _tryDecryptVault(bytes, "stvault");
    await restoreVaultData(fbPayload);
    debugLog("[CloudSync] Deferred vault restore complete (full overwrite)");

    if (_previewPullMeta) {
      syncSetLastPull(_previewPullMeta);
      _previewPullMeta = null;
    }
    if (typeof showCloudToast === "function") {
      showCloudToast("Sync update applied");
    }
    updateSyncStatusIndicator("idle", "just now");
    refreshSyncUI();
    if (_syncChannel) {
      try {
        _syncChannel.postMessage({
          type: "sync-pull-complete",
          tabId: getSyncDeviceId(),
          ts: Date.now(),
        });
      } catch (e) {
        /* ignore */
      }
    }
  } catch (err) {
    debugLog("[CloudSync] Deferred vault restore failed:", err.message);
    updateSyncStatusIndicator("error", "Restore failed");
    if (typeof showCloudToast === "function") showCloudToast("Restore failed: " + err.message);
  }
}

/**
 * Download remote vault, decrypt without restoring, compute diff, and show preview.
 * Attempts manifest-first path (lightweight diff preview without full vault download).
 * Falls back to vault-first path if manifest is unavailable or fails.
 * @param {object} remoteMeta - Remote sync metadata
 */
async function pullWithPreview(remoteMeta) {
  var password = getSyncPasswordSilent();
  if (!password) {
    password = await getSyncPassword();
  }
  if (!password) {
    debugLog("[CloudSync] Pull preview cancelled — no password");
    return;
  }

  if (!_assertSyncAccountId("pullWithPreview")) return;

  var token = typeof cloudGetToken === "function" ? await cloudGetToken(_syncProvider) : null;
  if (!token) {
    debugLog("[CloudSync] Pull preview — no token");
    updateSyncStatusIndicator("error", "Not connected");
    return;
  }

  updateSyncStatusIndicator("syncing");

  try {
    // ── Manifest-first pull attempt ──
    // Try downloading the lightweight .stmanifest first so we can show a
    // diff preview without fetching the full vault. If the manifest is
    // unavailable (404, decrypt failure, DiffModal missing) we fall through
    // to the vault-first path below.
    try {
      if (
        typeof decryptManifest === "function" &&
        typeof DiffModal !== "undefined" &&
        DiffModal.show
      ) {
        var manifestApiArg = JSON.stringify({ path: SYNC_MANIFEST_PATH });
        var manifestResp = await fetch("https://content.dropboxapi.com/2/files/download", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Dropbox-API-Arg": manifestApiArg,
          },
        });

        if (manifestResp.ok) {
          var manifestBytes = new Uint8Array(await manifestResp.arrayBuffer());
          var manifest = await decryptManifest(manifestBytes, password);

          // Build diff-like result from manifest data
          var manifestDiff = _buildDiffFromManifest(manifest);

          // STAK-426: Compare settings from manifest snapshot (if present).
          // Use raw localStorage.getItem() to match the manifest snapshot format —
          // the snapshot is also built from raw localStorage strings (scalar string
          // prefs like appTheme would not be found by loadDataSync() which JSON-parses).
          var manifestSettingsDiff = null;
          if (
            manifest.settings &&
            typeof DiffEngine !== "undefined" &&
            DiffEngine.compareSettings
          ) {
            var _mLocalSettings = {};
            if (typeof SYNC_SCOPE_KEYS !== "undefined" && typeof localStorage !== "undefined") {
              for (var ms = 0; ms < SYNC_SCOPE_KEYS.length; ms++) {
                if (SYNC_SCOPE_KEYS[ms] === "metalInventory" || _isTagSyncKey(SYNC_SCOPE_KEYS[ms]))
                  continue;
                var msv = localStorage.getItem(SYNC_SCOPE_KEYS[ms]);
                if (msv !== null) _mLocalSettings[SYNC_SCOPE_KEYS[ms]] = msv;
              }
            }
            manifestSettingsDiff = DiffEngine.compareSettings(_mLocalSettings, manifest.settings);
          }

          // STAK-417 + STAK-426: If manifest has no item changes AND no settings
          // changes, fall through to vault-first for a full comparison.
          var _mNoChanges =
            (manifestDiff.added || []).length === 0 &&
            (manifestDiff.deleted || []).length === 0 &&
            (manifestDiff.modified || []).length === 0;
          var _mNoSettingsChanges =
            !manifestSettingsDiff ||
            !manifestSettingsDiff.changed ||
            manifestSettingsDiff.changed.length === 0;
          var _mHasTagChanges = _hasTagChanges(manifest.settings);
          if (_mNoChanges && _mNoSettingsChanges && !_mHasTagChanges) {
            // STAK-387: Silent return — no vault download needed when manifest confirms no changes
            var _silentPullMeta = {
              syncId: remoteMeta ? remoteMeta.syncId : null,
              timestamp: remoteMeta ? remoteMeta.timestamp : Date.now(),
              rev: remoteMeta ? remoteMeta.rev : null,
            };
            // STAK-497: Even when items/settings are unchanged, the image vault
            // may need syncing (e.g. new photos uploaded on another device).
            try {
              if (
                remoteMeta &&
                remoteMeta.imageVault &&
                typeof vaultDecryptAndRestoreImages === "function"
              ) {
                var _spLastPull = syncGetLastPull();
                var _spLocalHash = _spLastPull ? _spLastPull.imageHash : null;
                if (remoteMeta.imageVault.hash !== _spLocalHash) {
                  debugLog(
                    "[CloudSync] Silent-pull path: image vault changed — pulling",
                    remoteMeta.imageVault.imageCount,
                    "photos"
                  );
                  var _spImgArg = JSON.stringify({ path: SYNC_IMAGES_PATH });
                  var _spImgResp = await fetch("https://content.dropboxapi.com/2/files/download", {
                    method: "POST",
                    headers: { Authorization: "Bearer " + token, "Dropbox-API-Arg": _spImgArg },
                  });
                  if (_spImgResp.ok) {
                    var _spImgBytes = new Uint8Array(await _spImgResp.arrayBuffer());
                    var _spRestored = await vaultDecryptAndRestoreImages(_spImgBytes, password);
                    _silentPullMeta.imageHash = remoteMeta.imageVault.hash;
                    debugLog(
                      "[CloudSync] Silent-pull path: image vault restored:",
                      _spRestored,
                      "photos"
                    );
                    logCloudSyncActivity(
                      "image_vault_pull",
                      "success",
                      (_spRestored || "?") + " photos restored (silent-pull path)"
                    );
                  }
                }
              }
            } catch (_spImgErr) {
              debugLog(
                "[CloudSync] Silent-pull path: image vault pull failed (non-blocking):",
                _spImgErr.message
              );
            }
            // STRK-45/STRK-65: Silent-pull path — attachment vault
            var _spAttachResult = await _pullAttachmentVault(
              remoteMeta,
              token,
              password,
              "silent-pull"
            );
            if (_spAttachResult.hash) _silentPullMeta.attachmentHash = _spAttachResult.hash;
            syncSetLastPull(_silentPullMeta);
            logCloudSyncActivity(
              "auto_sync_pull",
              "success",
              "No changes — pull recorded silently (manifest)"
            );
            updateSyncStatusIndicator("idle", "just now");
            return;
          }

          if (_mNoChanges && _mNoSettingsChanges && _mHasTagChanges) {
            _applyAndFinalize(inventory, [], null, remoteMeta, {
              source: "sync",
              showToast: false,
              remoteTagData: _extractRemoteTagData(manifest.settings),
            });
            logCloudSyncActivity(
              "auto_sync_pull",
              "success",
              "Tag-only changes merged silently (manifest)"
            );
            return;
          }

          // STAK-402 + STAK-412: Verify the manifest diff is complete by checking
          // whether the expected post-apply count matches the remote item count.
          // The manifest changelog only records changes the pushing device made — it
          // cannot enumerate items the local device has never seen. If the math
          // doesn't add up, fall through to vault-first which does a full
          // DiffEngine.compareItems comparison with the actual inventory arrays.
          var _mRemoteCount = remoteMeta ? remoteMeta.itemCount || 0 : 0;
          var _mLocalCount = typeof inventory !== "undefined" && inventory ? inventory.length : 0;
          var _mExpectedAfterApply =
            _mLocalCount + manifestDiff.added.length - manifestDiff.deleted.length;
          if (_mExpectedAfterApply !== _mRemoteCount) {
            debugLog(
              "[CloudSync] Manifest diff incomplete: expected " +
                _mExpectedAfterApply +
                " items after apply but remote has " +
                _mRemoteCount +
                " (" +
                _mLocalCount +
                " local + " +
                manifestDiff.added.length +
                " added - " +
                manifestDiff.deleted.length +
                " deleted) — using vault-first"
            );
            throw new Error("Manifest stale: post-apply count mismatch");
          }

          // STAK-470: If inventory has no changes but settings changes are ALL
          // one-sided (key exists on only one side), this is a version upgrade —
          // one device has newer SYNC_SCOPE_KEYS the other doesn't know about.
          // Auto-merge silently: apply remote-only keys locally, keep local-only
          // keys (they'll be pushed on next sync). No DiffModal needed.
          // Placed AFTER the manifest completeness guard so a stale manifest
          // cannot cause this branch to skip real inventory changes.
          if (_mNoChanges && !_mNoSettingsChanges) {
            var _allOneSided = manifestSettingsDiff.changed.every(function (c) {
              return c.localVal === null || c.remoteVal === null;
            });
            if (_allOneSided) {
              var _appliedCount = 0;
              var _failedCount = 0;
              var _tagKeys = _tagSyncKeys();
              var _premergeSnapshot = {};
              for (var _pk = 0; _pk < _tagKeys.length; _pk++) {
                try {
                  _premergeSnapshot[_tagKeys[_pk]] = localStorage.getItem(_tagKeys[_pk]);
                } catch (_e) {
                  /* best-effort */
                }
              }
              try {
                localStorage.setItem("__sync_recovery_snapshot", JSON.stringify(_premergeSnapshot));
              } catch (_e) {
                /* best-effort — quota full is not fatal here */
              }
              try {
                var _tagMerge = _mergeOneSidedTagSettings(manifest.settings || {});
                _appliedCount += _tagMerge.tagKeysMerged;
              } catch (_tagMergeErr) {
                _failedCount++;
              }
              for (var _si = 0; _si < manifestSettingsDiff.changed.length; _si++) {
                var _sc = manifestSettingsDiff.changed[_si];
                if (_isTagSyncKey(_sc.key)) {
                  continue;
                }
                // Guard: only apply keys in the ALLOWED_STORAGE_KEYS allowlist
                if (
                  typeof ALLOWED_STORAGE_KEYS !== "undefined" &&
                  ALLOWED_STORAGE_KEYS.indexOf(_sc.key) === -1
                ) {
                  continue;
                }
                if (
                  _sc.remoteVal !== null &&
                  _sc.remoteVal !== undefined &&
                  _sc.localVal === null
                ) {
                  // Write raw localStorage value directly — remoteVal is the exact
                  // stored form from the remote device (may include JSON encoding or
                  // compression from saveDataSync). Re-encoding via saveDataSync
                  // would double-encode.
                  try {
                    localStorage.setItem(
                      _sc.key,
                      typeof _sc.remoteVal === "string"
                        ? _sc.remoteVal
                        : JSON.stringify(_sc.remoteVal)
                    );
                    _appliedCount++;
                  } catch (_e) {
                    _failedCount++;
                  }
                }
              }
              // Only record the pull if all writes succeeded — if any failed
              // (e.g. QuotaExceededError), leave lastPull stale so the next
              // poll cycle retries
              if (_failedCount === 0) {
                if (typeof fetchSpotPrice === "function") {
                  try {
                    fetchSpotPrice();
                  } catch (_e) {
                    debugLog("fetchSpotPrice threw during sync pull");
                  }
                }
                syncSetLastPull({
                  syncId: remoteMeta ? remoteMeta.syncId : null,
                  timestamp: remoteMeta ? remoteMeta.timestamp : Date.now(),
                  rev: remoteMeta ? remoteMeta.rev : null,
                });
              }
              console.warn(
                "[CloudSync] STAK-470: Version-upgrade settings diff — auto-merged " +
                  _appliedCount +
                  " remote-only keys, " +
                  (manifestSettingsDiff.changed.length - _appliedCount) +
                  " local-only keys kept" +
                  (_failedCount > 0 ? ", " + _failedCount + " failed" : "")
              );
              logCloudSyncActivity(
                "auto_sync_pull",
                _failedCount > 0 ? "partial" : "success",
                "Version-upgrade settings merged silently (" +
                  _appliedCount +
                  " applied, " +
                  (manifestSettingsDiff.changed.length - _appliedCount) +
                  " local-only" +
                  (_failedCount > 0 ? ", " + _failedCount + " failed" : "") +
                  ")"
              );
              updateSyncStatusIndicator("idle", "just now");
              // STAK-497: Pull image vault on the auto-merge path (previously skipped).
              // Without this, a device that only has settings diffs (no item changes)
              // never downloads uploaded photos from the remote image vault.
              try {
                if (
                  remoteMeta &&
                  remoteMeta.imageVault &&
                  typeof vaultDecryptAndRestoreImages === "function"
                ) {
                  var _amLastPull = syncGetLastPull();
                  var _amLocalHash = _amLastPull ? _amLastPull.imageHash : null;
                  if (remoteMeta.imageVault.hash !== _amLocalHash) {
                    debugLog(
                      "[CloudSync] STAK-470 path: image vault changed — pulling",
                      remoteMeta.imageVault.imageCount,
                      "photos"
                    );
                    var _amImgArg = JSON.stringify({ path: SYNC_IMAGES_PATH });
                    var _amImgResp = await fetch(
                      "https://content.dropboxapi.com/2/files/download",
                      {
                        method: "POST",
                        headers: { Authorization: "Bearer " + token, "Dropbox-API-Arg": _amImgArg },
                      }
                    );
                    if (_amImgResp.ok) {
                      var _amImgBytes = new Uint8Array(await _amImgResp.arrayBuffer());
                      var _amRestored = await vaultDecryptAndRestoreImages(_amImgBytes, password);
                      debugLog(
                        "[CloudSync] STAK-470 path: image vault restored:",
                        _amRestored,
                        "photos"
                      );
                      logCloudSyncActivity(
                        "image_vault_pull",
                        "success",
                        (_amRestored || "?") + " photos restored (auto-merge path)"
                      );
                      // Update pull metadata with image hash
                      if (_failedCount === 0) {
                        syncSetLastPull({
                          syncId: remoteMeta ? remoteMeta.syncId : null,
                          timestamp: remoteMeta ? remoteMeta.timestamp : Date.now(),
                          rev: remoteMeta ? remoteMeta.rev : null,
                          imageHash: remoteMeta.imageVault.hash,
                        });
                      }
                    }
                  }
                }
              } catch (_amImgErr) {
                debugLog(
                  "[CloudSync] STAK-470 path: image vault pull failed (non-blocking):",
                  _amImgErr.message
                );
                logCloudSyncActivity(
                  "image_vault_pull",
                  "fail",
                  "Auto-merge path: " + _amImgErr.message
                );
              }
              // STRK-45/STRK-65: Auto-merge path — attachment vault
              var _amAttachResult = await _pullAttachmentVault(
                remoteMeta,
                token,
                password,
                "auto-merge"
              );
              if (_amAttachResult.hash && _failedCount === 0) {
                var _amPrevPull = syncGetLastPull() || {};
                syncSetLastPull(
                  Object.assign({}, _amPrevPull, {
                    syncId: remoteMeta ? remoteMeta.syncId : null,
                    timestamp: remoteMeta ? remoteMeta.timestamp : Date.now(),
                    rev: remoteMeta ? remoteMeta.rev : null,
                    attachmentHash: _amAttachResult.hash,
                  })
                );
              }
              // Push to update remote manifest with local-only keys
              if (
                _appliedCount < manifestSettingsDiff.changed.length &&
                typeof scheduleSyncPush === "function"
              ) {
                scheduleSyncPush();
              }
              return;
            }
          }

          // Stash pull metadata
          _previewPullMeta = {
            syncId: remoteMeta ? remoteMeta.syncId : null,
            timestamp: remoteMeta ? remoteMeta.timestamp : Date.now(),
            rev: remoteMeta ? remoteMeta.rev : null,
          };

          // Detect conflicts: manifest changes vs local changes since last pull
          var manifestConflicts = null;
          try {
            if (
              typeof DiffEngine !== "undefined" &&
              DiffEngine.detectConflicts &&
              typeof getManifestEntries === "function"
            ) {
              var mLastPull = syncGetLastPull();
              var mLastPullTs = mLastPull ? mLastPull.timestamp : null;
              var mLocalEntries = getManifestEntries(mLastPullTs) || [];

              // Local changes from changeLog
              var mLocalChanges = [];
              for (var ml = 0; ml < mLocalEntries.length; ml++) {
                var mle = mLocalEntries[ml];
                if (mle.itemKey && mle.field) {
                  mLocalChanges.push({
                    itemKey: mle.itemKey,
                    field: mle.field,
                    localVal: mle.oldValue,
                    remoteVal: mle.newValue,
                  });
                }
              }

              // Remote changes from manifest
              var mRemoteChanges = [];
              var mChanges = manifest.changes || [];
              for (var mr = 0; mr < mChanges.length; mr++) {
                var mc = mChanges[mr];
                if (_normalizeItemChangeType(mc.type) === "edit" && mc.fields) {
                  for (var mf = 0; mf < mc.fields.length; mf++) {
                    mRemoteChanges.push({
                      itemKey: mc.itemKey,
                      field: mc.fields[mf].field,
                      localVal: mc.fields[mf].oldValue,
                      remoteVal: mc.fields[mf].newValue,
                    });
                  }
                }
              }

              if (mLocalChanges.length > 0 && mRemoteChanges.length > 0) {
                manifestConflicts = DiffEngine.detectConflicts(mLocalChanges, mRemoteChanges);
                if (
                  manifestConflicts &&
                  manifestConflicts.conflicts &&
                  manifestConflicts.conflicts.length === 0
                ) {
                  manifestConflicts = null;
                }
              }
            }
          } catch (mcErr) {
            debugLog(
              "[CloudSync] Manifest conflict detection failed (non-blocking):",
              mcErr.message
            );
            manifestConflicts = null;
          }

          // STAK-406: Await user decision in DiffModal before returning.
          // This keeps _syncRemoteChangeActive=true (set by handleRemoteChange)
          // until the full pull is applied, preventing a concurrent push from
          // racing and overwriting the remote vault with stale local data.
          await new Promise(function (resolveModal) {
            DiffModal.show({
              source: { type: "sync", label: _syncProvider || "Cloud" },
              diff: manifestDiff,
              settingsDiff: manifestSettingsDiff || null,
              conflicts: manifestConflicts || null,
              meta: {
                deviceId: manifest.deviceId || (remoteMeta ? remoteMeta.deviceId : null),
                timestamp: remoteMeta ? remoteMeta.timestamp : null,
                itemCount: remoteMeta ? remoteMeta.itemCount : null,
                appVersion: remoteMeta ? remoteMeta.appVersion : null,
              },
              onApply: function (selectedChanges) {
                // Deferred: download full vault, decrypt, selective apply.
                // Resolve after _deferredVaultRestore completes so the caller
                // keeps _syncRemoteChangeActive=true until pull is fully applied.
                _deferredVaultRestore(token, password, remoteMeta, selectedChanges).finally(
                  resolveModal
                );
              },
              onCancel: function () {
                debugLog("[CloudSync] Manifest preview cancelled — no vault download");
                resolveModal();
              },
            });
          });
          updateSyncStatusIndicator("idle", "just now");
          return; // manifest path succeeded — skip vault-first path
        }
      }
    } catch (manifestErr) {
      debugLog(
        "[CloudSync] Manifest-first pull failed, falling back to vault-first:",
        manifestErr.message
      );
    }

    // ── Vault-first fallback (existing path) ──
    var apiArg = JSON.stringify({ path: SYNC_FILE_PATH });
    var resp = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Dropbox-API-Arg": apiArg,
      },
    });

    if (!resp.ok) throw new Error("Vault download failed: " + resp.status);

    var bytes = new Uint8Array(await resp.arrayBuffer());

    // Attempt to decrypt and preview
    try {
      var remotePayload = await _tryDecryptVault(bytes, "stvault");
      // STAK-412: remotePayload.data is a dict of localStorage keys (e.g.
      // {metalInventory: "CMP1:...", itemTags: "...", ...}), NOT an inventory
      // array. Extract and decompress metalInventory to get the actual items.
      var remoteItems = [];
      try {
        var _vfRaw =
          remotePayload.data && remotePayload.data.metalInventory
            ? remotePayload.data.metalInventory
            : "[]";
        var _vfDecompressed =
          typeof __decompressIfNeeded === "function" ? __decompressIfNeeded(_vfRaw) : _vfRaw;
        remoteItems = JSON.parse(_vfDecompressed);
        if (typeof migrateLegacySilverbackWeightUnit === "function") {
          migrateLegacySilverbackWeightUnit(remoteItems);
        }
      } catch (_vfErr) {
        debugLog("[CloudSync] Vault-first: could not parse metalInventory:", _vfErr.message);
      }
      var localItems = typeof inventory !== "undefined" ? inventory : [];

      var diffResult =
        typeof DiffEngine !== "undefined"
          ? DiffEngine.compareItems(localItems, remoteItems)
          : { added: [], deleted: [], modified: [], unchanged: [] };

      // Compare settings — settings are stored inside remotePayload.data as
      // individual localStorage keys (everything except metalInventory).
      var localSettings = {};
      var remoteSettings = {};
      if (remotePayload.data) {
        var _rsKeys = Object.keys(remotePayload.data);
        for (var rs = 0; rs < _rsKeys.length; rs++) {
          if (_rsKeys[rs] !== "metalInventory" && !_isTagSyncKey(_rsKeys[rs])) {
            remoteSettings[_rsKeys[rs]] = remotePayload.data[_rsKeys[rs]];
          }
        }
      }
      if (typeof SYNC_SCOPE_KEYS !== "undefined") {
        for (var i = 0; i < SYNC_SCOPE_KEYS.length; i++) {
          if (SYNC_SCOPE_KEYS[i] === "metalInventory" || _isTagSyncKey(SYNC_SCOPE_KEYS[i]))
            continue;
          // STAK-497: Use raw localStorage.getItem to match vault payload format.
          // loadDataSync JSON-parses values, which fails for scalar settings
          // stored as raw strings, causing false diffs.
          var v = localStorage.getItem(SYNC_SCOPE_KEYS[i]);
          if (v !== null) localSettings[SYNC_SCOPE_KEYS[i]] = v;
        }
      }
      var settingsDiff =
        typeof DiffEngine !== "undefined"
          ? DiffEngine.compareSettings(localSettings, remoteSettings)
          : { changed: [], unchanged: [] };

      // Stash pull metadata for deferred recording (applied by preview modal or fallback)
      _previewPullMeta = {
        syncId: remoteMeta ? remoteMeta.syncId : null,
        timestamp: remoteMeta ? remoteMeta.timestamp : Date.now(),
        rev: remoteMeta ? remoteMeta.rev : null,
      };

      // Detect bidirectional conflicts (vault-first path)
      var conflicts = null;
      try {
        if (
          typeof DiffEngine !== "undefined" &&
          DiffEngine.detectConflicts &&
          typeof getManifestEntries === "function"
        ) {
          var lastPull = syncGetLastPull();
          var lastPullTimestamp = lastPull ? lastPull.timestamp : null;
          var localEntries = getManifestEntries(lastPullTimestamp) || [];

          // Transform local changeLog entries into detectConflicts format
          var localChanges = [];
          for (var lc = 0; lc < localEntries.length; lc++) {
            var le = localEntries[lc];
            if (le.itemKey && le.field) {
              localChanges.push({
                itemKey: le.itemKey,
                field: le.field,
                localVal: le.oldValue,
                remoteVal: le.newValue,
              });
            }
          }

          // Transform modified items from diffResult into remoteChanges format
          var remoteChanges = [];
          var modifiedItems = diffResult.modified || [];
          for (var rc = 0; rc < modifiedItems.length; rc++) {
            var mod = modifiedItems[rc];
            var itemKey =
              typeof DiffEngine !== "undefined" && DiffEngine.computeItemKey
                ? DiffEngine.computeItemKey(mod.item)
                : mod.item.serial || mod.item.name || "";
            for (var fc = 0; fc < mod.changes.length; fc++) {
              var ch = mod.changes[fc];
              remoteChanges.push({
                itemKey: itemKey,
                field: ch.field,
                localVal: ch.localVal,
                remoteVal: ch.remoteVal,
              });
            }
          }

          if (localChanges.length > 0 && remoteChanges.length > 0) {
            conflicts = DiffEngine.detectConflicts(localChanges, remoteChanges);
            if (conflicts && conflicts.conflicts && conflicts.conflicts.length === 0) {
              conflicts = null;
            }
          }
        }
      } catch (conflictErr) {
        debugLog("[CloudSync] Conflict detection failed (non-blocking):", conflictErr.message);
        conflicts = null;
      }

      // STAK-417: If the diff is completely empty (no item changes AND no settings
      // changes), silently record the pull and skip the DiffModal entirely.
      // This prevents the annoying "No changes detected" popup when both sides
      // are already in sync but the poll fell through the hash comparison.
      var _noItemChanges =
        (diffResult.added || []).length === 0 &&
        (diffResult.deleted || []).length === 0 &&
        (diffResult.modified || []).length === 0;
      var _noSettingsChanges =
        !settingsDiff || !settingsDiff.changed || settingsDiff.changed.length === 0;
      if (_noItemChanges && _noSettingsChanges) {
        console.warn(
          "[CloudSync] Pull preview: diff is EMPTY (no item or settings changes) — silently recording pull"
        );
        // STAK-497: Pull image vault even when items/settings are unchanged
        try {
          if (
            remoteMeta &&
            remoteMeta.imageVault &&
            typeof vaultDecryptAndRestoreImages === "function"
          ) {
            var _vfSpLastPull = syncGetLastPull();
            var _vfSpLocalHash = _vfSpLastPull ? _vfSpLastPull.imageHash : null;
            if (remoteMeta.imageVault.hash !== _vfSpLocalHash) {
              debugLog("[CloudSync] Vault-first silent-pull: image vault changed — pulling");
              var _vfSpImgArg = JSON.stringify({ path: SYNC_IMAGES_PATH });
              var _vfSpImgResp = await fetch("https://content.dropboxapi.com/2/files/download", {
                method: "POST",
                headers: { Authorization: "Bearer " + token, "Dropbox-API-Arg": _vfSpImgArg },
              });
              if (_vfSpImgResp.ok) {
                var _vfSpImgBytes = new Uint8Array(await _vfSpImgResp.arrayBuffer());
                var _vfSpRestored = await vaultDecryptAndRestoreImages(_vfSpImgBytes, password);
                _previewPullMeta.imageHash = remoteMeta.imageVault.hash;
                logCloudSyncActivity(
                  "image_vault_pull",
                  "success",
                  (_vfSpRestored || "?") + " photos restored (vault-first silent)"
                );
              }
            }
          }
        } catch (_vfSpImgErr) {
          debugLog(
            "[CloudSync] Vault-first silent-pull: image vault failed (non-blocking):",
            _vfSpImgErr.message
          );
        }
        // STRK-45/STRK-65: Vault-first silent-pull — attachment vault
        var _vfSpAttachResult = await _pullAttachmentVault(
          remoteMeta,
          token,
          password,
          "vault-first silent"
        );
        if (_vfSpAttachResult.hash) _previewPullMeta.attachmentHash = _vfSpAttachResult.hash;
        syncSetLastPull(_previewPullMeta);
        _previewPullMeta = null;
        logCloudSyncActivity("auto_sync_pull", "success", "No changes — pull recorded silently");
        updateSyncStatusIndicator("idle", "just now");
        return;
      }

      // STAK-406: shownPromise resolves only after user completes Apply/Cancel,
      // keeping _syncRemoteChangeActive=true until the pull is fully applied.
      var shownPromise = showRestorePreviewModal(
        diffResult,
        settingsDiff,
        remotePayload,
        remoteMeta,
        conflicts
      );
      if (!shownPromise) {
        // Modal not in DOM — fall back to direct restore (try all key variants)
        debugLog("[CloudSync] Preview modal unavailable — falling back to direct restore");
        syncSaveOverrideBackup();
        var fbPayload2 = await _tryDecryptVault(bytes, "stvault");
        await restoreVaultData(fbPayload2);
        syncSetLastPull(_previewPullMeta);
        _previewPullMeta = null;
      } else {
        await shownPromise;
      }

      // STAK-497: Pull image vault after vault-first DiffModal or fallback restore.
      // showRestorePreviewModal's onApply only handles items + settings — not images.
      try {
        if (
          remoteMeta &&
          remoteMeta.imageVault &&
          typeof vaultDecryptAndRestoreImages === "function"
        ) {
          var _vfLastPull = syncGetLastPull();
          var _vfLocalHash = _vfLastPull ? _vfLastPull.imageHash : null;
          if (remoteMeta.imageVault.hash !== _vfLocalHash) {
            debugLog("[CloudSync] Vault-first path: pulling image vault");
            var _vfImgArg = JSON.stringify({ path: SYNC_IMAGES_PATH });
            var _vfImgResp = await fetch("https://content.dropboxapi.com/2/files/download", {
              method: "POST",
              headers: { Authorization: "Bearer " + token, "Dropbox-API-Arg": _vfImgArg },
            });
            if (_vfImgResp.ok) {
              var _vfImgBytes = new Uint8Array(await _vfImgResp.arrayBuffer());
              var _vfRestored = await vaultDecryptAndRestoreImages(_vfImgBytes, password);
              debugLog(
                "[CloudSync] Vault-first path: image vault restored:",
                _vfRestored,
                "photos"
              );
              logCloudSyncActivity(
                "image_vault_pull",
                "success",
                (_vfRestored || "?") + " photos restored (vault-first path)"
              );
              // Update pull meta with image hash
              var _vfPullMeta = syncGetLastPull();
              if (_vfPullMeta) {
                _vfPullMeta.imageHash = remoteMeta.imageVault.hash;
                syncSetLastPull(_vfPullMeta);
              }
            }
          }
        }
      } catch (_vfImgErr) {
        debugLog(
          "[CloudSync] Vault-first path: image vault failed (non-blocking):",
          _vfImgErr.message
        );
        logCloudSyncActivity("image_vault_pull", "fail", "Vault-first path: " + _vfImgErr.message);
      }
      // STRK-45/STRK-65: Vault-first DiffModal post-restore — attachment vault
      var _vfAttachResult = await _pullAttachmentVault(remoteMeta, token, password, "vault-first");
      if (_vfAttachResult.hash) {
        var _vfAttachPullMeta = syncGetLastPull();
        if (_vfAttachPullMeta) {
          _vfAttachPullMeta.attachmentHash = _vfAttachResult.hash;
          syncSetLastPull(_vfAttachPullMeta);
        }
      }
    } catch (decryptErr) {
      // Decryption or diff failed — offer fallback
      debugLog("[CloudSync] Preview decryption failed:", decryptErr.message);
      var errorEl = safeGetElement("restorePreviewError");
      var modal = safeGetElement("restorePreviewModal");
      if (modal && errorEl) {
        errorEl.textContent = "Could not decrypt vault for preview: " + decryptErr.message;
        errorEl.style.display = "";
        var diffListEl = safeGetElement("restorePreviewDiffList");
        if (diffListEl) diffListEl.innerHTML = "";
        var summaryEl = safeGetElement("restorePreviewSummary");
        if (summaryEl) summaryEl.textContent = "";

        // Show modal with just error + fallback restore button
        var applyBtn = safeGetElement("restorePreviewApplyBtn");
        if (applyBtn) {
          applyBtn.textContent = "Restore without preview";
          applyBtn.onclick = function () {
            modal.style.display = "none";
            if (typeof closeModalById === "function") closeModalById("restorePreviewModal");
            applyBtn.textContent = "Apply Changes";
            pullSyncVault(remoteMeta).catch(function (err) {
              debugLog("[CloudSync] Fallback restore failed:", err);
              updateSyncStatusIndicator("error", "Restore failed");
            });
          };
        }

        if (typeof openModalById === "function") {
          openModalById("restorePreviewModal");
        } else {
          modal.style.display = "flex";
        }
      } else {
        // No modal at all — direct restore
        await pullSyncVault(remoteMeta);
      }
    }

    updateSyncStatusIndicator("idle", "just now");
  } catch (err) {
    var errMsg = String(err.message || err);
    debugLog("[CloudSync] Pull preview failed:", errMsg);
    updateSyncStatusIndicator("error", errMsg.slice(0, 60));
    // Fall back to direct pull
    await pullSyncVault(remoteMeta);
  }
}

// ---------------------------------------------------------------------------
// Poller lifecycle
// ---------------------------------------------------------------------------

/** Schedule the next poll using the current _syncRetryDelay (respects backoff). */
function _schedulePoll() {
  _syncPollerTimer = setTimeout(async function () {
    await pollForRemoteChanges();
    if (_syncPollerTimer !== null) _schedulePoll();
  }, _syncRetryDelay);
}

/** Start the background polling loop. Uses setTimeout so backoff delay is honoured. */
function startSyncPoller() {
  stopSyncPoller();
  _syncRetryDelay = SYNC_POLL_INTERVAL;
  _schedulePoll();
  debugLog("[CloudSync] Poller started (initial delay", SYNC_POLL_INTERVAL / 60000, "min)");
}

/** Stop the background polling loop. */
function stopSyncPoller() {
  if (_syncPollerTimer !== null) {
    clearTimeout(_syncPollerTimer);
    _syncPollerTimer = null;
    debugLog("[CloudSync] Poller stopped");
  }
}

// ---------------------------------------------------------------------------
// Enable / disable
// ---------------------------------------------------------------------------

/**
 * Enable auto-sync: do an initial push, then start the poller.
 * @param {string} [provider='dropbox']
 */
async function enableCloudSync(provider) {
  // Guard: skip sync if app initialization failed (STAK-485)
  if (window._initFailed) {
    console.warn("[CloudSync] Skipping enable — app initialization failed");
    return;
  }
  _syncProvider = provider || "dropbox";
  try {
    localStorage.setItem("cloud_sync_enabled", "true");
  } catch (_) {
    /* ignore */
  }

  debugWarn("[CloudSync] Enabling auto-sync for", _syncProvider);

  // Ensure we have a device ID
  getSyncDeviceId();

  // Update UI immediately so Sync Now button is enabled before the async push
  refreshSyncUI();

  // -----------------------------------------------------------------------
  // STAK-398 fix: Prompt for password BEFORE any sync operations.
  // forcePrompt=true ensures the user always sees the modal when they
  // explicitly enable sync, even if a stale password is cached in localStorage.
  // This prevents silently reusing a wrong/stale password from a prior session.
  // -----------------------------------------------------------------------
  var password = await getSyncPassword(true);
  var hasAccountId = !!localStorage.getItem("cloud_dropbox_account_id");
  debugWarn(
    "[CloudSync] enableCloudSync: password obtained:",
    !!password,
    "accountId:",
    hasAccountId
  );
  if (!password) {
    // User cancelled password prompt — revert sync enabled flag
    debugWarn("[CloudSync] No password set — reverting auto-sync enable");
    try {
      localStorage.setItem("cloud_sync_enabled", "false");
    } catch (_) {
      /* ignore */
    }
    refreshSyncUI();
    if (typeof showCloudToast === "function") {
      showCloudToast("Cloud sync requires a vault password. Please try again.");
    }
    return;
  }
  // Guard: account_id must be present for composite key derivation
  if (!hasAccountId) {
    debugWarn("[CloudSync] No account_id — cannot derive sync key, reverting");
    try {
      localStorage.setItem("cloud_sync_enabled", "false");
    } catch (_) {
      /* ignore */
    }
    refreshSyncUI();
    if (typeof showCloudToast === "function") {
      showCloudToast("Cloud sync setup incomplete — please reconnect your Dropbox account.");
    }
    return;
  }

  // Poll first to check for existing remote data before pushing (STAK-398 fix).
  // This ensures a second browser joining sync sees the first browser's data
  // instead of blindly overwriting it.
  await pollForRemoteChanges();

  // Push local data (the pre-push check inside pushSyncVault will detect if
  // pollForRemoteChanges already handled a remote change and skip if needed)
  await pushSyncVault();

  // Start the poller
  startSyncPoller();

  // Update UI again with post-push state (last-synced timestamp)
  refreshSyncUI();

  if (typeof showCloudToast === "function")
    showCloudToast("Auto-sync enabled. Your inventory will sync automatically.");
  logCloudSyncActivity("auto_sync_enable", "success", "Auto-sync enabled");
}

/**
 * Disable auto-sync: persist the disabled flag, stop the poller, and update UI.
 */
function disableCloudSync() {
  try {
    localStorage.setItem("cloud_sync_enabled", "false");
  } catch (_) {
    /* ignore */
  }
  stopSyncPoller();
  refreshSyncUI();
  updateSyncStatusIndicator("disabled");
  logCloudSyncActivity("auto_sync_disable", "success", "Auto-sync disabled");
  debugLog("[CloudSync] Auto-sync disabled");
}
// ---------------------------------------------------------------------------
// Initialization (called from init.js Phase 13)
// ---------------------------------------------------------------------------

/**
 * Initialize the cloud sync module.
 * Creates the debounced push function and starts the poller if sync was enabled.
 */
function initCloudSync() {
  // Guard: skip sync if app initialization failed (STAK-485)
  if (window._initFailed) {
    console.warn("[CloudSync] Skipping init — app initialization failed");
    return;
  }
  // STRK-157: repair any "[object Object]"-corrupt scope keys before sync compares
  // hashes — this corruption can't self-heal via convergent compare, so clear it
  // once at boot (idempotent). Runs even when sync is disabled so a later enable
  // starts clean.
  syncBootRepairCorruptSettings();

  // Initialize multi-tab coordination (Layer 7)
  initSyncTabCoordination();

  // Build the debounced push wrapper
  if (typeof debounce === "function") {
    scheduleSyncPush = debounce(pushSyncVault, SYNC_PUSH_DEBOUNCE);
  } else {
    // Fallback: simple delayed call (no de-duplication)
    scheduleSyncPush = (function () {
      var _timer = null;
      return function () {
        clearTimeout(_timer);
        _timer = setTimeout(pushSyncVault, SYNC_PUSH_DEBOUNCE);
      };
    })();
  }

  // Expose globally so saveInventory() hook can reach it
  window.scheduleSyncPush = scheduleSyncPush;

  if (!syncIsEnabled()) {
    debugLog("[CloudSync] Auto-sync is disabled — poller not started");
    updateCloudSyncHeaderBtn();
    return;
  }

  var connected = typeof cloudIsConnected === "function" ? cloudIsConnected(_syncProvider) : false;
  if (!connected) {
    debugLog("[CloudSync] Auto-sync enabled but not connected to", _syncProvider);
    updateCloudSyncHeaderBtn();
    return;
  }

  debugLog("[CloudSync] Resuming auto-sync from previous session");

  var hasPw = getSyncPasswordSilent();
  debugWarn(
    "[CloudSync] initCloudSync: password available:",
    !!hasPw,
    "accountId:",
    !!localStorage.getItem("cloud_dropbox_account_id")
  );
  updateCloudSyncHeaderBtn();

  if (!hasPw) {
    // No password available — prompt interactively instead of just showing a toast.
    // STAK-398 fix: the toast-and-return pattern left sync silently broken.
    debugWarn("[CloudSync] No vault password — prompting user");
    getSyncPassword().then(function (pw) {
      if (pw) {
        debugWarn("[CloudSync] Password set via prompt — starting sync");
        updateCloudSyncHeaderBtn();
        startSyncPoller();
        // Poll + push after a short delay to let UI settle
        setTimeout(function () {
          pollForRemoteChanges().then(function () {
            pushSyncVault();
          });
        }, 1000);
      } else {
        debugWarn("[CloudSync] User cancelled password prompt — sync paused");
        updateCloudSyncHeaderBtn();
        if (typeof showCloudToast === "function") {
          showCloudToast("Cloud sync paused — tap the cloud icon to set your vault password", 5000);
        }
      }
    });
    return;
  }

  startSyncPoller();
  setTimeout(function () {
    pollForRemoteChanges();
  }, 3000);
}

// ---------------------------------------------------------------------------
// Page Visibility API: pause/resume poller
// ---------------------------------------------------------------------------

document.addEventListener("visibilitychange", function () {
  if (!syncIsEnabled()) return;
  if (document.hidden) {
    // Tab hidden: pause is automatic since pollForRemoteChanges() checks document.hidden
    debugLog("[CloudSync] Tab hidden — polls will skip");
  } else {
    // Tab visible again: fire an immediate poll
    debugLog("[CloudSync] Tab visible — polling for remote changes");
    setTimeout(function () {
      pollForRemoteChanges();
    }, 500);
  }
});

// ---------------------------------------------------------------------------
// Sync Now — smart bi-directional sync (STAK-398 fix)
// Polls for remote changes first, then pushes if no conflict detected.
// ---------------------------------------------------------------------------

/**
 * Smart sync: poll for remote changes first, then push local data.
 * Called by the "Sync Now" button. Replaces the old blind-push behavior.
 * Ensures a valid password exists before attempting any sync operations.
 */
async function syncNow() {
  // Guard: skip sync if app initialization failed (STAK-485)
  if (window._initFailed) {
    console.warn("[CloudSync] Skipping syncNow — app initialization failed");
    return { synced: false };
  }
  // Ensure we have a password before attempting sync.  If no silent password
  // is available, prompt the user interactively.
  var pw = getSyncPasswordSilent();
  if (!pw) {
    pw = await getSyncPassword();
    if (!pw) {
      debugWarn("[CloudSync] syncNow: no password — aborting");
      if (typeof showCloudToast === "function") {
        showCloudToast("Cloud sync requires a vault password.");
      }
      return { synced: false };
    }
  }

  debugLog("[CloudSync] syncNow: polling for remote changes first…");
  await pollForRemoteChanges();
  // pushSyncVault has its own pre-push remote check, so even if poll missed
  // something (race), the push will catch it and route to handleRemoteChange.
  await pushSyncVault();
  return { synced: true };
}

// ---------------------------------------------------------------------------
// Window exports
// ---------------------------------------------------------------------------

window.initCloudSync = initCloudSync;
window.enableCloudSync = enableCloudSync;
window.disableCloudSync = disableCloudSync;
window.syncNow = syncNow;
window.pushSyncVault = pushSyncVault;
window.pullSyncVault = pullSyncVault;
window.pollForRemoteChanges = pollForRemoteChanges;
window.showRestorePreviewModal = showRestorePreviewModal;
window.pullWithPreview = pullWithPreview;
window.computeInventoryHash = computeInventoryHash;

// STAK-427: Read-only sync state accessor for restore isolation guards
function isSyncActive() {
  return _syncRemoteChangeActive;
}
window.CloudSync = window.CloudSync || {};
window.CloudSync.isSyncActive = isSyncActive;
window.summarizeMetals = summarizeMetals;
window.computeTotalWeight = computeTotalWeight;
window.computeSettingsHash = computeSettingsHash;
window.refreshSyncUI = refreshSyncUI;
window.updateSyncStatusIndicator = updateSyncStatusIndicator;
window.updateCloudSyncHeaderBtn = updateCloudSyncHeaderBtn;
window.resolveHeaderCloudAction = resolveHeaderCloudAction;
window.getSyncDeviceId = getSyncDeviceId;
window.getSyncPasswordSilent = getSyncPasswordSilent;
window.syncIsEnabled = syncIsEnabled;
window.syncSaveOverrideBackup = syncSaveOverrideBackup;
window.syncRestoreOverrideBackup = syncRestoreOverrideBackup;
window.syncBootRepairCorruptSettings = syncBootRepairCorruptSettings;
window.changeVaultPassword = changeVaultPassword;
window.syncGetLastPush = syncGetLastPush;
window._syncRelativeTime = _syncRelativeTime;
if (window.location && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
  window.CloudSyncTest = window.CloudSyncTest || {};
  window.CloudSyncTest.hasTagChanges = _hasTagChanges;
  window.CloudSyncTest.mergeTagData = _mergeTagData;
  window.CloudSyncTest.mergeOneSidedTagSettings = _mergeOneSidedTagSettings;
}

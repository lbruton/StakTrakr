/**
 * Encrypted Vault Backup Module (.stvault)
 *
 * Provides AES-256-GCM encrypted export/import of all localStorage data.
 * Uses Web Crypto API (primary) with forge.js fallback for file:// protocol.
 *
 * Binary format (56-byte header + ciphertext):
 *   0-6   : "STVAULT" magic bytes
 *   7     : format version (0x01)
 *   8-11  : PBKDF2 iterations (uint32 big-endian)
 *   12-43 : 32-byte random salt
 *   44-55 : 12-byte random IV/nonce
 *   56+   : AES-256-GCM ciphertext (includes 16-byte auth tag)
 */

// =============================================================================
// CONSTANTS
// =============================================================================

const VAULT_MAGIC = new Uint8Array([0x53, 0x54, 0x56, 0x41, 0x55, 0x4c, 0x54]); // "STVAULT"
const VAULT_VERSION = 0x01;
const VAULT_HEADER_SIZE = 56;
const VAULT_PBKDF2_ITERATIONS = 600000;
const VAULT_MIN_PASSWORD_LENGTH = 8;
const VAULT_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// =============================================================================
// CRYPTO ABSTRACTION LAYER → js/vault-crypto.js (STRK-176)
// =============================================================================
// getCryptoBackend, vaultRandomBytes, vaultDeriveKey, vaultEncrypt, vaultDecrypt
// were extracted verbatim to the sibling js/vault-crypto.js (loaded before this
// file). They remain bare globals, so the call sites below are unchanged.
// =============================================================================

// =============================================================================
// BINARY FORMAT
// =============================================================================

/**
 * Serialize vault header + ciphertext into a single binary blob.
 * @param {Uint8Array} salt - 32 bytes
 * @param {Uint8Array} iv - 12 bytes
 * @param {number} iterations
 * @param {Uint8Array} ciphertext
 * @returns {Uint8Array}
 */
function serializeVaultFile(salt, iv, iterations, ciphertext) {
  var file = new Uint8Array(VAULT_HEADER_SIZE + ciphertext.length);
  // Magic bytes
  file.set(VAULT_MAGIC, 0);
  // Version
  file[7] = VAULT_VERSION;
  // Iterations (uint32 big-endian)
  file[8] = (iterations >>> 24) & 0xff;
  file[9] = (iterations >>> 16) & 0xff;
  file[10] = (iterations >>> 8) & 0xff;
  file[11] = iterations & 0xff;
  // Salt
  file.set(salt, 12);
  // IV
  file.set(iv, 44);
  // Ciphertext
  file.set(ciphertext, VAULT_HEADER_SIZE);
  return file;
}

/**
 * Parse a .stvault binary file into its components.
 * @param {Uint8Array} fileBytes
 * @returns {{salt: Uint8Array, iv: Uint8Array, iterations: number, ciphertext: Uint8Array}}
 * @throws {Error} On invalid format
 */
function parseVaultFile(fileBytes) {
  if (fileBytes.length < VAULT_HEADER_SIZE + 16) {
    throw new Error("Not a valid .stvault file.");
  }
  // Check magic bytes
  for (var i = 0; i < VAULT_MAGIC.length; i++) {
    if (fileBytes[i] !== VAULT_MAGIC[i]) {
      throw new Error("Not a valid .stvault file.");
    }
  }
  // Check version
  var version = fileBytes[7];
  if (version > VAULT_VERSION) {
    throw new Error("Created by a newer StakTrakr version. Please update.");
  }
  // Parse iterations
  var iterations =
    (fileBytes[8] << 24) | (fileBytes[9] << 16) | (fileBytes[10] << 8) | fileBytes[11];
  iterations = iterations >>> 0; // ensure unsigned

  var salt = fileBytes.slice(12, 44);
  var iv = fileBytes.slice(44, 56);
  var ciphertext = fileBytes.slice(VAULT_HEADER_SIZE);

  return {
    salt: salt,
    iv: iv,
    iterations: iterations,
    ciphertext: ciphertext,
  };
}

/**
 * Parse a raw vault/localStorage setting value.
 * Settings may be stored as raw strings, JSON strings, or CMP1/CMP2-compressed strings.
 * @param {*} rawValue
 * @returns {*} Parsed JSON value, or the raw/decompressed value when parsing fails
 */
function parseVaultSettingValue(rawValue) {
  if (typeof rawValue !== "string") return rawValue;
  var value =
    typeof __decompressIfNeeded === "function" ? __decompressIfNeeded(rawValue) : rawValue;
  try {
    return JSON.parse(value);
  } catch (_e) {
    return value;
  }
}

// =============================================================================
// DATA COLLECTION / RESTORATION
// =============================================================================

/**
 * Collect localStorage data for vault export.
 * @param {string} [scope='full'] - 'full' collects all ALLOWED_STORAGE_KEYS;
 *   'sync' collects only SYNC_SCOPE_KEYS (inventory + display prefs, no API keys or tokens)
 * @returns {object|null} Payload object or null if empty
 */
/**
 * Collects vault data for export or sync.
 * When scope is 'full', collects all ALLOWED_STORAGE_KEYS except those in
 * VAULT_EXCLUDE_KEYS (OAuth tokens, vault password, device-specific sync state).
 * When scope is 'sync', collects only SYNC_SCOPE_KEYS (unaffected by exclusions).
 */
function collectVaultData(scope) {
  scope = scope || "full";

  var keysToCollect =
    scope === "sync" && typeof SYNC_SCOPE_KEYS !== "undefined"
      ? SYNC_SCOPE_KEYS
      : ALLOWED_STORAGE_KEYS;

  var payload = {
    _meta: {
      appVersion: typeof APP_VERSION !== "undefined" ? APP_VERSION : "unknown",
      exportTimestamp: new Date().toISOString(),
      exportOrigin: typeof window !== "undefined" && window.location ? window.location.origin : "",
      scope: scope,
    },
    data: {},
  };

  var hasData = false;

  for (var i = 0; i < keysToCollect.length; i++) {
    var key = keysToCollect[i];
    // Skip market histories now owned by IndexedDB — never written to a backup (STRK-141, R7.2).
    // item-price-history is not in this set, so it is still exported (R7.1).
    if (
      typeof HISTORY_IDB_KEYS !== "undefined" &&
      Array.isArray(HISTORY_IDB_KEYS) &&
      HISTORY_IDB_KEYS.indexOf(key) !== -1
    ) {
      continue;
    }
    // Skip credentials and device-specific state in portable full exports
    if (
      scope === "full" &&
      typeof VAULT_EXCLUDE_KEYS !== "undefined" &&
      VAULT_EXCLUDE_KEYS.indexOf(key) !== -1
    ) {
      continue;
    }
    try {
      var val = localStorage.getItem(key);
      if (val !== null) {
        payload.data[key] = val;
        hasData = true;
      }
    } catch (e) {
      debugLog("Vault: could not read key", key, e);
    }
  }

  if (!hasData) return null;

  // Compute checksum of the data section
  var dataJson = JSON.stringify(payload.data);
  payload._meta.checksum = simpleHash(dataJson);

  return payload;
}

/**
 * Simple hash for integrity check (not cryptographic — just detects corruption).
 * @param {string} str
 * @returns {string}
 */
function simpleHash(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    var ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return "sh:" + (hash >>> 0).toString(16);
}

/**
 * Restore vault data into localStorage and refresh UI.
 * @param {object} payload - Decrypted vault payload
 */
async function restoreVaultData(payload) {
  var data = payload.data;
  if (!data || typeof data !== "object") {
    throw new Error("Vault file appears corrupted.");
  }

  // Write each key to localStorage
  var keys = Object.keys(data);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    // Ignore market histories from older backups — they are reproducible from the
    // API and now owned by IndexedDB; write to neither localStorage nor IDB (STRK-141, R7.3).
    if (
      typeof HISTORY_IDB_KEYS !== "undefined" &&
      Array.isArray(HISTORY_IDB_KEYS) &&
      HISTORY_IDB_KEYS.indexOf(key) !== -1
    ) {
      continue;
    }
    // Only restore recognized keys
    if (ALLOWED_STORAGE_KEYS.indexOf(key) !== -1) {
      try {
        // STAK-421: Compress before writing — raw vault payloads can exceed
        // localStorage quota (e.g. metalSpotHistory at 9 MB uncompressed).
        // Skip if already compressed (CMP1 legacy or CMP2 real) to avoid double-wrapping. (STRK-140)
        var value = data[key];
        if (
          typeof value === "string" &&
          typeof __compressIfNeeded === "function" &&
          !value.startsWith("CMP1:") &&
          !value.startsWith("CMP2:")
        ) {
          value = __compressIfNeeded(value);
        }
        localStorage.setItem(key, value);
      } catch (e) {
        debugLog("Vault: could not write key", key, e);
      }
    }
  }

  // Refresh the full UI
  try {
    if (typeof loadItemTags === "function") loadItemTags();
    if (typeof loadInventory === "function") await loadInventory();
    if (typeof renderTable === "function") renderTable();
    if (typeof renderActiveFilters === "function") renderActiveFilters();
    if (typeof loadSpotHistory === "function") loadSpotHistory();
    if (typeof fetchSpotPrice === "function") fetchSpotPrice();
    if (typeof _invalidateMarketFilterCache === "function") _invalidateMarketFilterCache();
    if (typeof renderMarketFilterMatrix === "function") renderMarketFilterMatrix();
  } catch (e) {
    debugLog("Vault: UI refresh error", e);
  }
}

// =============================================================================
// PASSWORD STRENGTH
// =============================================================================

/**
 * Evaluate password strength.
 * @param {string} password
 * @returns {{score: number, label: string, color: string}}
 */
function getPasswordStrength(password) {
  if (!password || password.length < VAULT_MIN_PASSWORD_LENGTH) {
    return { score: 0, label: "Too short", color: "var(--danger)" };
  }
  var score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  // Cap at 4
  if (score > 4) score = 4;

  var labels = ["Weak", "Fair", "Good", "Strong", "Very Strong"];
  var colors = [
    "var(--danger)",
    "var(--warning)",
    "var(--info)",
    "var(--success)",
    "var(--success)",
  ];

  return {
    score: score,
    label: labels[score],
    color: colors[score],
  };
}

// =============================================================================
// SHARED ENCRYPT / DECRYPT HELPERS
// =============================================================================

/**
 * Encrypt inventory data with the given password and return raw vault bytes.
 * @param {string} password
 * @returns {Promise<Uint8Array>} serialized vault file bytes
 */
async function vaultEncryptToBytes(password) {
  var payload = collectVaultData("full");
  if (!payload) throw new Error("No data to export.");
  var plaintext = new TextEncoder().encode(JSON.stringify(payload));
  var salt = vaultRandomBytes(32);
  var iv = vaultRandomBytes(12);
  var key = await vaultDeriveKey(password, salt, VAULT_PBKDF2_ITERATIONS);
  var ciphertext = await vaultEncrypt(plaintext, key, iv);
  return serializeVaultFile(salt, iv, VAULT_PBKDF2_ITERATIONS, ciphertext);
}

/**
 * Encrypt sync-scoped data (inventory + display prefs only) and return raw vault bytes.
 * Used by cloud auto-sync to avoid pushing API keys or cloud tokens to remote storage.
 * @param {string} password
 * @returns {Promise<Uint8Array>} serialized vault file bytes
 */
async function vaultEncryptToBytesScoped(password) {
  var payload = collectVaultData("sync");
  if (!payload) throw new Error("No inventory data to sync.");
  var plaintext = new TextEncoder().encode(JSON.stringify(payload));
  var salt = vaultRandomBytes(32);
  var iv = vaultRandomBytes(12);
  var key = await vaultDeriveKey(password, salt, VAULT_PBKDF2_ITERATIONS);
  var ciphertext = await vaultEncrypt(plaintext, key, iv);
  return serializeVaultFile(salt, iv, VAULT_PBKDF2_ITERATIONS, ciphertext);
}

/**
 * Decrypt raw vault bytes with the given password and restore data.
 * @param {Uint8Array|ArrayBuffer} fileBytes
 * @param {string} password
 * @returns {Promise<void>}
 */
async function vaultDecryptAndRestore(fileBytes, password) {
  // STAK-427: Block restore while cloud sync is applying remote changes
  if (window.CloudSync && window.CloudSync.isSyncActive()) {
    showToast("Cloud sync is in progress — please wait a moment and try again.", "warning");
    return;
  }
  var payload = await vaultDecryptToData(fileBytes, password);
  await restoreVaultData(payload);
}

/**
 * Decrypt raw vault bytes and return the parsed payload WITHOUT restoring.
 * Identical to vaultDecryptAndRestore() but returns data instead of side effects.
 * Used by the restore preview flow (Layer 5) to compute diffs before applying.
 * @param {Uint8Array|ArrayBuffer} fileBytes
 * @param {string} password
 * @returns {Promise<object>} Parsed vault payload { data, settings, ... }
 */
async function vaultDecryptToData(fileBytes, password) {
  var parsed = parseVaultFile(new Uint8Array(fileBytes));
  var key = await vaultDeriveKey(password, parsed.salt, parsed.iterations);
  var plainBytes = await vaultDecrypt(parsed.ciphertext, key, parsed.iv);
  var payload = JSON.parse(new TextDecoder().decode(plainBytes));
  if (!payload || !payload.data) throw new Error("Vault file appears corrupted.");
  return payload;
}

/**
 * Decrypt a .stvault file and show a DiffEngine + DiffModal preview instead
 * of silently overwriting all data.  Falls back to the legacy full-overwrite
 * path when DiffEngine or DiffModal are not loaded.
 *
 * @param {Uint8Array|ArrayBuffer} fileBytes - Raw .stvault bytes
 * @param {string} password
 * @returns {Promise<void>}
 */
async function vaultRestoreWithPreview(fileBytes, password) {
  // Capture image vault file before closeVaultModal() can nullify it —
  // the onApply callback fires later, after the vault modal is closed
  var capturedImageFile = _vaultPendingImageFile;

  // 1. Decrypt without side effects
  var payload = await vaultDecryptToData(fileBytes, password);

  // 2. Guard: fall back to legacy restore if DiffEngine / DiffModal unavailable
  if (typeof DiffEngine === "undefined" || typeof DiffModal === "undefined") {
    debugLog("[Vault] DiffEngine/DiffModal not available — falling back to full restore");
    if (typeof showToast === "function") {
      showToast("Diff preview unavailable — restoring full backup");
    }
    await restoreVaultData(payload);
    return;
  }

  // 3. Extract inventory items from the payload
  // Vault stores raw localStorage strings which may be CMP1/CMP2-compressed for large inventories
  var backupItems = [];
  try {
    var rawInv = payload.data.metalInventory || "[]";
    var decompressedInv =
      typeof __decompressIfNeeded === "function" ? __decompressIfNeeded(rawInv) : rawInv;
    backupItems = JSON.parse(decompressedInv);
    if (typeof migrateLegacySilverbackWeightUnit === "function") {
      migrateLegacySilverbackWeightUnit(backupItems);
    }
  } catch (e) {
    debugLog("[Vault] Could not parse metalInventory from backup:", e);
  }

  // 4. Enrich backup items with local UUIDs before comparison
  var localItems =
    typeof inventory !== "undefined" && Array.isArray(inventory) ? inventory.slice() : [];
  try {
    DiffEngine.enrichItemIdentities(localItems, backupItems);
  } catch (e) {
    if (typeof debugLog === "function")
      debugLog("[Vault] Identity enrichment failed, proceeding without:", e);
  }

  // 5. Compute item diff
  var diffResult = DiffEngine.compareItems(localItems, backupItems);

  // 6. Compute settings diff
  var settingsDiff = null;
  if (typeof DiffEngine.compareSettings === "function") {
    var settingsKeys =
      typeof ALLOWED_STORAGE_KEYS !== "undefined" && Array.isArray(ALLOWED_STORAGE_KEYS)
        ? ALLOWED_STORAGE_KEYS
        : [];
    var localSettings = {};
    var remoteSettings = {};
    var payloadKeys = Object.keys(payload.data);

    for (var i = 0; i < payloadKeys.length; i++) {
      var k = payloadKeys[i];
      // Skip inventory — handled separately via DiffEngine.compareItems
      if (k === "metalInventory") continue;
      // Only include recognized storage keys
      if (settingsKeys.indexOf(k) === -1) continue;
      // Skip volatile cache keys (spot prices, timestamps) — async init updates
      // these between export and restore, producing false-positive diffs
      if (
        typeof VAULT_SETTINGS_DIFF_SKIP !== "undefined" &&
        VAULT_SETTINGS_DIFF_SKIP.indexOf(k) !== -1
      )
        continue;

      // Parse the remote value (vault stores raw localStorage strings, possibly CMP1-compressed)
      remoteSettings[k] = parseVaultSettingValue(payload.data[k]);

      // Load matching local value — mirror the remote parse logic so raw
      // strings (e.g. "3.34.35" stored by setItem instead of saveData)
      // compare equal instead of producing false-positive diffs.
      var localRaw = localStorage.getItem(k);
      if (localRaw !== null) {
        localSettings[k] = parseVaultSettingValue(localRaw);
      }
    }

    if (Object.keys(remoteSettings).length > 0) {
      settingsDiff = DiffEngine.compareSettings(localSettings, remoteSettings);
      // Omit if no changes
      if (settingsDiff && settingsDiff.changed && settingsDiff.changed.length === 0) {
        settingsDiff = null;
      }
    }
  }

  // 7. Check for zero changes
  var totalChanges =
    diffResult.added.length + diffResult.modified.length + diffResult.deleted.length;
  if (totalChanges === 0 && !settingsDiff) {
    if (typeof showToast === "function") {
      showToast("No differences found \u2014 backup matches current data");
    }
    return;
  }

  // 8. Build metadata from payload._meta
  var payloadMeta = payload._meta || {};

  // Cross-domain origin warning (STAK-374): warn when restoring from a different domain
  var _vaultOrigin = payloadMeta.exportOrigin || null;
  var _currentOriginVault =
    typeof window !== "undefined" && window.location ? window.location.origin : null;
  if (
    _vaultOrigin &&
    _currentOriginVault &&
    _vaultOrigin !== _currentOriginVault &&
    typeof showToast === "function"
  ) {
    var _safeVaultFrom =
      typeof sanitizeHtml === "function" ? sanitizeHtml(_vaultOrigin) : _vaultOrigin;
    showToast(
      "\u26A0 This vault was exported from a different domain (" +
        _safeVaultFrom +
        "). Check item counts carefully."
    );
  }

  // Compute count header values for DiffModal (STAK-374)
  var _vaultBackupCount =
    typeof backupItems !== "undefined" && Array.isArray(backupItems)
      ? backupItems.length
      : payloadMeta.itemCount
        ? payloadMeta.itemCount
        : 0;
  var _vaultLocalCount =
    typeof inventory !== "undefined" && Array.isArray(inventory)
      ? inventory.length
      : typeof loadDataSync === "function"
        ? loadDataSync(LS_KEY, []).length
        : 0;

  // 9. Show DiffModal
  DiffModal.show({
    source: { type: "vault", label: "Encrypted Backup" },
    diff: diffResult,
    settingsDiff: settingsDiff,
    backupCount: _vaultBackupCount,
    localCount: _vaultLocalCount,
    meta: {
      timestamp: payloadMeta.exportTimestamp || null,
      itemCount: backupItems.length,
      appVersion: payloadMeta.appVersion || null,
    },
    onApply: function (selectedChanges) {
      try {
        var hasItemChanges = Array.isArray(selectedChanges) && selectedChanges.length > 0;

        // Apply items selectively when item changes were selected
        if (hasItemChanges) {
          var currentInv =
            typeof inventory !== "undefined" && Array.isArray(inventory) ? inventory : [];
          var newInv = DiffEngine.applySelectedChanges(currentInv, selectedChanges);
          inventory = newInv;
        }

        // Apply settings changes (settings are all-or-nothing until DiffModal adds
        // per-setting checkboxes — intentional, not a bug)
        var appliedSettings = false;
        if (settingsDiff && settingsDiff.changed) {
          for (var si = 0; si < settingsDiff.changed.length; si++) {
            if (typeof saveDataSync === "function") {
              saveDataSync(settingsDiff.changed[si].key, settingsDiff.changed[si].remoteVal);
              appliedSettings = true;
            }
          }
        }

        // Save & render
        if (typeof clearInventoryRecovery === "function") clearInventoryRecovery();
        if (typeof debugLog === "function") debugLog("inventoryRecovery: cleared by vaultRestore");
        if (typeof saveInventory === "function") saveInventory();
        if (typeof renderTable === "function") renderTable();
        if (typeof renderActiveFilters === "function") renderActiveFilters();
        if (typeof updateStorageStats === "function") updateStorageStats();

        // Toast summary
        var addCount = 0,
          modCount = 0,
          delCount = 0;
        if (hasItemChanges) {
          for (var j = 0; j < selectedChanges.length; j++) {
            if (selectedChanges[j].type === "add") addCount++;
            else if (selectedChanges[j].type === "modify") modCount++;
            else if (selectedChanges[j].type === "delete") delCount++;
          }
        }
        var parts = [];
        if (addCount > 0) parts.push(addCount + " added");
        if (modCount > 0) parts.push(modCount + " updated");
        if (delCount > 0) parts.push(delCount + " removed");
        if (appliedSettings && !hasItemChanges) parts.push("settings updated");
        if (typeof showToast === "function") {
          showToast(
            "Backup restored: " + (parts.length > 0 ? parts.join(", ") : "no changes applied")
          );
        }

        // Restore companion photo vault if present
        if (capturedImageFile && typeof vaultDecryptAndRestoreImages === "function") {
          vaultDecryptAndRestoreImages(capturedImageFile, password)
            .then(function (imgCount) {
              debugLog("[Vault] Restored " + imgCount + " photo(s) from companion image vault");
            })
            .catch(function (imgErr) {
              debugLog("[Vault] Image restore failed:", imgErr);
            });
        }
      } catch (applyErr) {
        debugLog("[Vault] Restore apply failed:", applyErr);
        if (typeof showToast === "function") {
          showToast("Restore failed: " + (applyErr.message || "Unknown error"));
        }
      }
    },
    onCancel: function () {
      debugLog("[Vault] Restore preview cancelled");
    },
  });
}

// =============================================================================
// IMAGE VAULT (STAK-181) — cloud sync for user-uploaded IndexedDB photos
// =============================================================================

/**
 * Convert a Blob to a base64 string (strips the data-URI prefix).
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function _blobToBase64(blob) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      resolve(reader.result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert a base64 string back to a Blob.
 * @param {string} b64
 * @param {string} mimeType
 * @returns {Blob}
 */
function _base64ToBlob(b64, mimeType) {
  var byteChars = atob(b64);
  var bytes = new Uint8Array(byteChars.length);
  for (var i = 0; i < byteChars.length; i++) {
    bytes[i] = byteChars.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || "image/webp" });
}

/**
 * Export user images from IndexedDB, convert Blobs to base64, and compute a
 * stable hash so push can skip upload when images haven't changed.
 * @returns {Promise<{payload: object, hash: string, imageCount: number}|null>}
 *   null when there are no user-uploaded images
 */
async function collectAndHashImageVault() {
  if (typeof imageCache === "undefined" || typeof imageCache.exportAllUserImages !== "function")
    return null;
  var records = await imageCache.exportAllUserImages();
  if (!records || records.length === 0) return null;

  var serialized = [];
  var failedCount = 0;
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var entry = { uuid: r.uuid, cachedAt: r.cachedAt, size: r.size };
    try {
      if (r.obverse instanceof Blob) {
        entry.obverse = await _blobToBase64(r.obverse);
        entry.obverseType = r.obverse.type;
      }
      if (r.reverse instanceof Blob) {
        entry.reverse = await _blobToBase64(r.reverse);
        entry.reverseType = r.reverse.type;
      }
    } catch (blobErr) {
      failedCount++;
      debugLog("[Vault] Image vault: blob conversion failed for uuid", r.uuid, blobErr);
      continue;
    }
    serialized.push(entry);
  }

  if (failedCount > 0) {
    debugLog(
      "[Vault] Image vault: " + failedCount + " of " + records.length + " images failed to export",
      "warn"
    );
  }
  if (serialized.length === 0 && records.length > 0) {
    throw new Error(
      "Image vault export failed — could not read any of " + records.length + " images."
    );
  }

  if (serialized.length === 0) return null;

  var payload = {
    _meta: {
      appVersion: typeof APP_VERSION !== "undefined" ? APP_VERSION : "unknown",
      exportTimestamp: new Date().toISOString(),
      imageCount: serialized.length,
    },
    records: serialized,
  };

  // Hash includes a content sample (first 32 chars of obverse base64) so that
  // replacing an image with one of identical byte size still triggers an upload.
  var hash = simpleHash(
    JSON.stringify(
      serialized.map(function (e) {
        return e.uuid + ":" + e.size + ":" + (e.obverse ? e.obverse.slice(0, 32) : "");
      })
    )
  );
  return { payload: payload, hash: hash, imageCount: serialized.length };
}

/**
 * Encrypt a user-image vault payload into raw bytes for cloud upload.
 * @param {string} password
 * @param {object} payload - From collectAndHashImageVault().payload
 * @returns {Promise<Uint8Array>}
 */
async function vaultEncryptImageVault(password, payload) {
  if (!password) throw new Error("Image vault encryption requires a non-empty password.");
  var plaintext = new TextEncoder().encode(JSON.stringify(payload));
  var salt = vaultRandomBytes(32);
  var iv = vaultRandomBytes(12);
  var key = await vaultDeriveKey(password, salt, VAULT_PBKDF2_ITERATIONS);
  var ciphertext = await vaultEncrypt(plaintext, key, iv);
  return serializeVaultFile(salt, iv, VAULT_PBKDF2_ITERATIONS, ciphertext);
}

/**
 * Restore user images from a decrypted image vault payload.
 * @param {object} payload
 * @returns {Promise<number>} Number of images imported
 */
async function restoreImageVaultData(payload) {
  if (!payload || !Array.isArray(payload.records)) return 0;
  if (typeof imageCache === "undefined" || typeof imageCache.importUserImageRecord !== "function")
    return 0;

  var count = 0;
  var failed = 0;
  for (var i = 0; i < payload.records.length; i++) {
    var r = payload.records[i];
    if (!r.uuid) continue;
    try {
      var record = { uuid: r.uuid, cachedAt: r.cachedAt, size: r.size };
      if (r.obverse) record.obverse = _base64ToBlob(r.obverse, r.obverseType);
      if (r.reverse) record.reverse = _base64ToBlob(r.reverse, r.reverseType);
      var ok = await imageCache.importUserImageRecord(record);
      if (ok) {
        count++;
      } else {
        failed++;
        debugLog("[Vault] Image vault: importUserImageRecord returned false for uuid", r.uuid);
      }
    } catch (recErr) {
      failed++;
      debugLog("[Vault] Image vault: record import error for uuid", r.uuid, recErr);
    }
  }
  if (failed > 0) {
    var msg =
      "Image vault restore: " +
      failed +
      " of " +
      payload.records.length +
      " images failed to import.";
    debugLog("[Vault] " + msg, "error");
    throw new Error(msg);
  }
  return count;
}

/**
 * Decrypt image vault bytes and import all user photos into IndexedDB.
 * @param {Uint8Array} fileBytes
 * @param {string} password
 * @returns {Promise<number>} Number of images restored
 */
async function vaultDecryptAndRestoreImages(fileBytes, password) {
  try {
    var parsed = parseVaultFile(new Uint8Array(fileBytes));
    var key = await vaultDeriveKey(password, parsed.salt, parsed.iterations);
    var plainBytes = await vaultDecrypt(parsed.ciphertext, key, parsed.iv);
    var payload = JSON.parse(new TextDecoder().decode(plainBytes));
    return restoreImageVaultData(payload);
  } catch (err) {
    // Re-throw with a clear label so callers can surface meaningful messages
    var msg = String(err.message || err);
    var isPasswordErr = msg.indexOf("Incorrect password") !== -1 || msg.indexOf("corrupted") !== -1;
    throw new Error(
      isPasswordErr
        ? "Image vault decryption failed — check your sync password."
        : "Image vault restore failed: " + msg
    );
  }
}

/**
 * Export attachments from IndexedDB, convert blobs to base64, and compute a
 * stable hash so push can skip upload when attachments haven't changed.
 * @returns {Promise<{payload: object, hash: string, attachmentCount: number}|null>}
 */
async function collectAndHashAttachmentVault() {
  if (
    typeof attachmentManager === "undefined" ||
    typeof attachmentManager.exportAllAttachments !== "function"
  )
    return null;
  var records = await attachmentManager.exportAllAttachments();
  if (!records || records.length === 0) return null;

  var serialized = [];
  var failedCount = 0;
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var entry = {
      attachmentUuid: r.attachmentUuid,
      itemUuid: r.itemUuid,
      fileName: r.fileName,
      type: r.type,
      size: r.size,
      uploadedAt: r.uploadedAt,
    };
    try {
      if (r.blob instanceof Blob) {
        entry.data = await _blobToBase64(r.blob);
        entry.mimeType = r.blob.type || r.type || "application/octet-stream";
      }
    } catch (blobErr) {
      failedCount++;
      debugLog("[Vault] Attachment vault: blob conversion failed for", r.attachmentUuid, blobErr);
      continue;
    }
    serialized.push(entry);
  }

  if (failedCount > 0) {
    debugLog(
      "[Vault] Attachment vault: " +
        failedCount +
        " of " +
        records.length +
        " attachments failed to export",
      "warn"
    );
  }
  if (serialized.length === 0 && records.length > 0) {
    throw new Error(
      "Attachment vault export failed — could not read any of " + records.length + " attachments."
    );
  }
  if (serialized.length === 0) return null;

  var payload = {
    _meta: {
      appVersion: typeof APP_VERSION !== "undefined" ? APP_VERSION : "unknown",
      exportTimestamp: new Date().toISOString(),
      attachmentCount: serialized.length,
    },
    records: serialized,
  };

  var hash = simpleHash(
    JSON.stringify(
      serialized.map(function (e) {
        return e.attachmentUuid + ":" + e.size + ":" + (e.data ? e.data.slice(0, 32) : "");
      })
    )
  );
  return { payload: payload, hash: hash, attachmentCount: serialized.length };
}

/**
 * Encrypt an attachment vault payload into raw bytes for cloud upload.
 * @param {string} password
 * @param {object} payload - From collectAndHashAttachmentVault().payload
 * @returns {Promise<Uint8Array>}
 */
async function vaultEncryptAttachmentVault(password, payload) {
  if (!password) throw new Error("Attachment vault encryption requires a non-empty password.");
  var plaintext = new TextEncoder().encode(JSON.stringify(payload));
  var salt = vaultRandomBytes(32);
  var iv = vaultRandomBytes(12);
  var key = await vaultDeriveKey(password, salt, VAULT_PBKDF2_ITERATIONS);
  var ciphertext = await vaultEncrypt(plaintext, key, iv);
  return serializeVaultFile(salt, iv, VAULT_PBKDF2_ITERATIONS, ciphertext);
}

/**
 * Restore attachments from a decrypted attachment vault payload.
 * @param {object} payload
 * @returns {Promise<number>} Number of attachments imported
 */
async function restoreAttachmentVaultData(payload) {
  if (!payload || !Array.isArray(payload.records)) return 0;
  if (typeof attachmentManager === "undefined" || !attachmentManager.isAvailable()) return 0;

  var count = 0;
  var failed = 0;
  for (var i = 0; i < payload.records.length; i++) {
    var r = payload.records[i];
    if (!r.attachmentUuid) continue;
    try {
      var blob = r.data
        ? _base64ToBlob(r.data, r.mimeType || r.type || "application/octet-stream")
        : null;
      await attachmentManager.addAttachment({
        attachmentUuid: r.attachmentUuid,
        itemUuid: r.itemUuid,
        fileName: r.fileName,
        type: r.type,
        size: r.size,
        uploadedAt: r.uploadedAt,
        blob: blob,
      });
      count++;
    } catch (recErr) {
      failed++;
      debugLog("[Vault] Attachment vault: record import error for", r.attachmentUuid, recErr);
    }
  }
  if (failed > 0) {
    var msg =
      "Attachment vault restore: " +
      failed +
      " of " +
      payload.records.length +
      " attachments failed to import.";
    debugLog("[Vault] " + msg, "error");
    throw new Error(msg);
  }
  return count;
}

/**
 * Decrypt attachment vault bytes and import all attachments into IndexedDB.
 * @param {Uint8Array} fileBytes
 * @param {string} password
 * @returns {Promise<number>} Number of attachments restored
 */
async function vaultDecryptAndRestoreAttachments(fileBytes, password) {
  try {
    var parsed = parseVaultFile(new Uint8Array(fileBytes));
    var key = await vaultDeriveKey(password, parsed.salt, parsed.iterations);
    var plainBytes = await vaultDecrypt(parsed.ciphertext, key, parsed.iv);
    var payload = JSON.parse(new TextDecoder().decode(plainBytes));
    return restoreAttachmentVaultData(payload);
  } catch (err) {
    var msg = String(err.message || err);
    var isPasswordErr = msg.indexOf("Incorrect password") !== -1 || msg.indexOf("corrupted") !== -1;
    throw new Error(
      isPasswordErr
        ? "Attachment vault decryption failed — check your sync password."
        : "Attachment vault restore failed: " + msg
    );
  }
}

// =============================================================================
// EXPORT FLOW
// =============================================================================

/**
 * Export an encrypted vault backup.
 * @param {string} password
 * @returns {Promise<{imageCount: number}|{imageExportFailed: boolean}>}
 */
async function exportEncryptedBackup(password) {
  var backend = getCryptoBackend();
  if (!backend) {
    throw new Error("Encryption not available. Use Chrome/Safari/Edge or serve via HTTP.");
  }

  debugLog("Vault: exporting with", backend, "backend");

  var fileBytes = await vaultEncryptToBytes(password);

  // Download via Blob + anchor
  var blob = new Blob([fileBytes], { type: "application/octet-stream" });
  var url = URL.createObjectURL(blob);
  var timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  var a = document.createElement("a");
  a.href = url;
  a.download = "staktrakr_backup_" + timestamp + VAULT_FILE_EXTENSION;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  debugLog("Vault: export complete,", fileBytes.length, "bytes");

  // Export companion image vault if user has photos
  var imageCount = 0;
  try {
    var imgVaultData = await collectAndHashImageVault();
    if (imgVaultData && imgVaultData.imageCount > 0) {
      var imgBytes = await vaultEncryptImageVault(password, imgVaultData.payload);
      var imgBlob = new Blob([imgBytes], { type: "application/octet-stream" });
      var imgUrl = URL.createObjectURL(imgBlob);
      var imgA = document.createElement("a");
      imgA.href = imgUrl;
      imgA.download =
        "staktrakr_backup_" + timestamp + VAULT_IMAGE_FILE_SUFFIX + VAULT_FILE_EXTENSION;
      document.body.appendChild(imgA);
      imgA.click();
      document.body.removeChild(imgA);
      URL.revokeObjectURL(imgUrl);
      imageCount = imgVaultData.imageCount;
      debugLog(
        "Vault: image vault export complete,",
        imgBytes.length,
        "bytes,",
        imageCount,
        "images"
      );
    }
  } catch (imgErr) {
    debugLog("[Vault] Image vault export failed:", imgErr.message || String(imgErr), "warn");
    // Return a flag so the caller can surface a warning
    return { imageExportFailed: true };
  }

  // Export companion attachment vault if user has attachments (STRK-65: preflight size guard)
  var attachmentCount = 0;
  try {
    const exportAttachUsage = window.attachmentManager?.isAvailable()
      ? await window.attachmentManager.getStorageUsage()
      : null;
    const exportSizeThreshold =
      typeof SYNC_ATTACHMENT_SIZE_WARN_BYTES !== "undefined"
        ? SYNC_ATTACHMENT_SIZE_WARN_BYTES
        : 100 * 1024 * 1024;
    let continueExport = true;
    if (exportAttachUsage && exportAttachUsage.totalBytes > exportSizeThreshold) {
      const sizeMB = Math.round(exportAttachUsage.totalBytes / 1024 / 1024);
      continueExport =
        typeof showAppConfirm === "function"
          ? await showAppConfirm(
              "Attachment vault is " +
                sizeMB +
                " MB. Exporting this much data may use significant memory. Continue?",
              { confirmLabel: "Export Anyway", cancelLabel: "Skip Attachments" }
            )
          : true;
      if (!continueExport) {
        debugLog("[Vault] Attachment export skipped by user (" + sizeMB + " MB)");
      }
    }
    var attachVaultData = continueExport ? await collectAndHashAttachmentVault() : null;
    if (attachVaultData && attachVaultData.attachmentCount > 0) {
      var attachBytes = await vaultEncryptAttachmentVault(password, attachVaultData.payload);
      var attachBlob = new Blob([attachBytes], { type: "application/octet-stream" });
      var attachUrl = URL.createObjectURL(attachBlob);
      var attachA = document.createElement("a");
      attachA.href = attachUrl;
      attachA.download =
        "staktrakr_backup_" + timestamp + VAULT_ATTACHMENT_FILE_SUFFIX + VAULT_FILE_EXTENSION;
      document.body.appendChild(attachA);
      attachA.click();
      document.body.removeChild(attachA);
      URL.revokeObjectURL(attachUrl);
      attachmentCount = attachVaultData.attachmentCount;
      debugLog(
        "Vault: attachment vault export complete,",
        attachBytes.length,
        "bytes,",
        attachmentCount,
        "attachments"
      );
    }
  } catch (attachErr) {
    debugLog(
      "[Vault] Attachment vault export failed:",
      attachErr.message || String(attachErr),
      "warn"
    );
    return { imageCount: imageCount, attachmentExportFailed: true };
  }

  return { imageCount: imageCount, attachmentCount: attachmentCount };
}

// =============================================================================
// IMPORT FLOW
// =============================================================================

/**
 * Import and decrypt a vault backup.
 * @param {Uint8Array} fileBytes
 * @param {string} password
 * @returns {Promise<void>}
 */
async function importEncryptedBackup(fileBytes, password) {
  var backend = getCryptoBackend();
  if (!backend) {
    throw new Error("Encryption not available. Use Chrome/Safari/Edge or serve via HTTP.");
  }

  if (fileBytes.length > VAULT_MAX_FILE_SIZE) {
    throw new Error("File exceeds 50MB limit.");
  }

  debugLog("Vault: importing with", backend, "backend");
  await vaultRestoreWithPreview(fileBytes, password);
  debugLog("Vault: import complete (preview shown or fallback applied)");
}

// =============================================================================
// MODAL MANAGEMENT
// =============================================================================

/** @type {Uint8Array|null} Pending file bytes for import */
var _vaultPendingFile = null;

/** @type {Uint8Array|null} Companion image vault bytes loaded by the optional image file picker */
var _vaultPendingImageFile = null;

/** @type {Uint8Array|null} Companion attachment vault bytes loaded by the optional attachment file picker */
var _vaultPendingAttachmentFile = null;

/** @type {object|null} Cloud context for cloud-export/cloud-import modes */
var _cloudContext = null;

/**
 * Open the vault modal in export, import, cloud-export, or cloud-import mode.
 * @param {'export'|'import'|'cloud-export'|'cloud-import'} mode
 * @param {File|object} [fileOrOpts] - File for import, or { provider, fileBytes, filename, size } for cloud-import
 */
function openVaultModal(mode, fileOrOpts) {
  var file = null;
  var modal = safeGetElement("vaultModal");
  if (!modal) return;

  var titleEl = safeGetElement("vaultModalTitle");
  var passwordEl = safeGetElement("vaultPassword");
  var confirmRow = safeGetElement("vaultConfirmRow");
  var confirmEl = safeGetElement("vaultConfirmPassword");
  var strengthRow = safeGetElement("vaultStrengthRow");
  var fileInfoEl = safeGetElement("vaultFileInfo");
  var statusEl = safeGetElement("vaultStatus");
  var actionBtn = safeGetElement("vaultActionBtn");

  // Reset state
  if (passwordEl) passwordEl.value = "";
  if (confirmEl) confirmEl.value = "";
  if (statusEl) {
    statusEl.style.display = "none";
    statusEl.className = "encryption-status";
    statusEl.innerHTML = "";
  }

  // Update strength bar
  updateStrengthBar("");

  // Update match indicator
  updateMatchIndicator("", "");

  // Resolve effective mode for UI layout
  var effectiveMode = mode;
  _cloudContext = null;

  if (mode === "cloud-export") {
    effectiveMode = "export";
    _cloudContext = {
      provider: fileOrOpts && fileOrOpts.provider ? fileOrOpts.provider : "dropbox",
      isManualBackup: fileOrOpts && fileOrOpts.isManualBackup ? true : false,
    };
  } else if (mode === "cloud-import") {
    effectiveMode = "import";
    if (fileOrOpts && fileOrOpts.fileBytes) {
      _cloudContext = {
        provider: fileOrOpts.provider || "dropbox",
        fileBytes: fileOrOpts.fileBytes,
        filename: fileOrOpts.filename || "cloud-backup.stvault",
        size: fileOrOpts.size || fileOrOpts.fileBytes.length,
      };
      _vaultPendingFile = fileOrOpts.fileBytes;
    }
  } else if (mode === "import" && fileOrOpts instanceof File) {
    file = fileOrOpts;
  } else if (mode === "import") {
    file = fileOrOpts;
  }

  modal.setAttribute("data-vault-mode", mode);

  var imageFileRowEl = safeGetElement("vaultImageFileRow");
  var descExportEl = safeGetElement("vaultDescExport");
  var descImportEl = safeGetElement("vaultDescImport");

  if (effectiveMode === "export") {
    var exportTitle = _cloudContext ? "Cloud Backup — Enter Password" : "Export Encrypted Backup";
    if (titleEl) titleEl.textContent = exportTitle;
    if (confirmRow) confirmRow.style.display = "";
    if (strengthRow) strengthRow.style.display = "";
    if (fileInfoEl) fileInfoEl.style.display = "none";
    if (imageFileRowEl) imageFileRowEl.style.display = "none";
    if (descExportEl) descExportEl.style.display = "";
    if (descImportEl) descImportEl.style.display = "none";
    if (actionBtn) {
      actionBtn.textContent = _cloudContext ? "Encrypt & Upload" : "Export";
      actionBtn.className = "btn";
    }
    _vaultPendingFile = null;

    // "Include attachments" checkbox for manual cloud backup
    var existingAttachRow = document.getElementById("vaultIncludeAttachmentsRow");
    if (existingAttachRow instanceof HTMLElement) existingAttachRow.remove();
    if (_cloudContext && _cloudContext.isManualBackup) {
      (function () {
        try {
          var req = indexedDB.open("StakTrakrAttachments", 1);
          req.onsuccess = function (ev) {
            var db = ev.target.result;
            if (!db.objectStoreNames.contains("userAttachments")) {
              db.close();
              return;
            }
            var tx = db.transaction("userAttachments", "readonly");
            var countReq = tx.objectStore("userAttachments").count();
            countReq.onsuccess = function () {
              db.close();
              if (countReq.result > 0) {
                var row = document.createElement("div");
                row.id = "vaultIncludeAttachmentsRow";
                row.style.cssText = "margin:8px 0;display:flex;align-items:center;gap:8px;";
                row.innerHTML =
                  '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.9em;">' +
                  '<input type="checkbox" id="vaultIncludeAttachments"> Include attachments (' +
                  countReq.result +
                  " file" +
                  (countReq.result === 1 ? "" : "s") +
                  ")</label>";
                var actionsEl = actionBtn ? actionBtn.parentElement : null;
                if (actionsEl && actionsEl.parentElement) {
                  actionsEl.parentElement.insertBefore(row, actionsEl);
                }
              }
            };
          };
          req.onerror = function () {};
        } catch (_) {}
      })();
    }

    // STAK-427: "Include photos" checkbox for manual cloud backup
    var existingPhotoRow = safeGetElement("vaultIncludePhotosRow");
    if (existingPhotoRow instanceof HTMLElement) existingPhotoRow.remove();
    if (_cloudContext && _cloudContext.isManualBackup) {
      // Async check for user photos — inject checkbox if any exist
      (function () {
        try {
          var req = indexedDB.open("StakTrakrImages", 1);
          req.onsuccess = function (ev) {
            var db = ev.target.result;
            if (!db.objectStoreNames.contains("userImages")) {
              db.close();
              return;
            }
            var tx = db.transaction("userImages", "readonly");
            var countReq = tx.objectStore("userImages").count();
            countReq.onsuccess = function () {
              db.close();
              if (countReq.result > 0) {
                var row = document.createElement("div");
                row.id = "vaultIncludePhotosRow";
                row.style.cssText = "margin:8px 0;display:flex;align-items:center;gap:8px;";
                row.innerHTML =
                  '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.9em;">' +
                  '<input type="checkbox" id="vaultIncludePhotos"> Include photos (' +
                  countReq.result +
                  " image" +
                  (countReq.result === 1 ? "" : "s") +
                  ")</label>";
                // Insert before action button row
                var actionsEl = actionBtn ? actionBtn.parentElement : null;
                if (actionsEl && actionsEl.parentElement) {
                  actionsEl.parentElement.insertBefore(row, actionsEl);
                }
              }
            };
          };
          req.onerror = function () {}; // IDB unavailable — skip checkbox
        } catch (_) {}
      })();
    }
  } else {
    var importTitle = _cloudContext ? "Cloud Restore — Enter Password" : "Import Encrypted Backup";
    if (titleEl) titleEl.textContent = importTitle;
    if (confirmRow) confirmRow.style.display = "none";
    if (strengthRow) strengthRow.style.display = "none";
    if (fileInfoEl) {
      fileInfoEl.style.display = "";
      var nameSpan = safeGetElement("vaultFileName");
      var sizeSpan = safeGetElement("vaultFileSize");
      if (_cloudContext) {
        if (nameSpan) nameSpan.textContent = _cloudContext.filename;
        if (sizeSpan) sizeSpan.textContent = formatFileSize(_cloudContext.size || 0);
      } else if (file) {
        if (nameSpan) nameSpan.textContent = file.name;
        if (sizeSpan) sizeSpan.textContent = formatFileSize(file.size);
      }
    }
    if (descExportEl) descExportEl.style.display = "none";
    if (descImportEl) descImportEl.style.display = "";
    // Show image file picker only for local import (not cloud import)
    if (imageFileRowEl) {
      imageFileRowEl.style.display = _cloudContext ? "none" : "";
    }
    // Reset image file state when modal opens
    _vaultPendingImageFile = null;
    var imgInputEl = safeGetElement("vaultImageImportFile");
    if (imgInputEl) imgInputEl.value = "";
    var imgFileInfoEl = safeGetElement("vaultImageFileInfo");
    var imgPickerRowEl = safeGetElement("vaultImagePickerRow");
    if (imgFileInfoEl) imgFileInfoEl.style.display = "none";
    if (imgPickerRowEl) imgPickerRowEl.style.display = "";

    // Reset attachment file state when modal opens
    _vaultPendingAttachmentFile = null;
    var attachInputEl = safeGetElement("vaultAttachmentImportFile");
    if (attachInputEl) attachInputEl.value = "";
    var attachFileInfoEl = safeGetElement("vaultAttachmentFileInfo");
    var attachPickerRowEl = safeGetElement("vaultAttachmentPickerRow");
    var attachFileRowEl = safeGetElement("vaultAttachmentFileRow");
    if (attachFileInfoEl) attachFileInfoEl.style.display = "none";
    if (attachPickerRowEl) attachPickerRowEl.style.display = "";
    if (attachFileRowEl) attachFileRowEl.style.display = _cloudContext ? "none" : "";
    if (actionBtn) {
      actionBtn.textContent = _cloudContext ? "Decrypt & Restore" : "Import";
      actionBtn.className = "btn info";
    }

    // Read file bytes (local file import only — cloud sets _vaultPendingFile above)
    if (file && !_cloudContext) {
      var reader = new FileReader();
      reader.onload = function (e) {
        _vaultPendingFile = new Uint8Array(e.target.result);
      };
      reader.readAsArrayBuffer(file);
    }
  }

  openModalById("vaultModal");
}

/**
 * Close the vault modal and reset state.
 */
function closeVaultModal() {
  _vaultPendingFile = null;
  _vaultPendingImageFile = null;
  _vaultPendingAttachmentFile = null;
  _cloudContext = null;
  // STAK-427: Remove dynamic photo checkbox
  var photoRow = document.getElementById("vaultIncludePhotosRow");
  if (photoRow) photoRow.remove();
  var attachRow = document.getElementById("vaultIncludeAttachmentsRow");
  if (attachRow) attachRow.remove();
  closeModalById("vaultModal");
}

/**
 * Handle the vault modal action button (export or import).
 */
async function handleVaultAction() {
  var modal = safeGetElement("vaultModal");
  if (!modal) return;

  var mode = modal.getAttribute("data-vault-mode");
  var passwordEl = safeGetElement("vaultPassword");
  var confirmEl = safeGetElement("vaultConfirmPassword");
  var statusEl = safeGetElement("vaultStatus");
  var actionBtn = safeGetElement("vaultActionBtn");

  var password = passwordEl ? passwordEl.value : "";

  // Validate password length
  if (password.length < VAULT_MIN_PASSWORD_LENGTH) {
    showVaultStatus(
      "error",
      "Password must be at least " + VAULT_MIN_PASSWORD_LENGTH + " characters."
    );
    return;
  }

  // Determine effective mode
  var isCloudExport = mode === "cloud-export";
  var isCloudImport = mode === "cloud-import";
  var effectiveMode = isCloudExport ? "export" : isCloudImport ? "import" : mode;

  if (effectiveMode === "export") {
    var confirm = confirmEl ? confirmEl.value : "";
    if (password !== confirm) {
      showVaultStatus("error", "Passwords do not match.");
      return;
    }

    if (!getCryptoBackend()) {
      showVaultStatus(
        "error",
        "Encryption not available. Use Chrome/Safari/Edge or serve via HTTP."
      );
      return;
    }

    if (actionBtn) actionBtn.disabled = true;
    showVaultStatus("info", "Encrypting\u2026");

    try {
      if (isCloudExport && _cloudContext) {
        // Cloud export: encrypt then upload
        var fileBytes = await vaultEncryptToBytes(password);
        showVaultStatus("info", "Uploading\u2026");
        await cloudUploadVault(
          _cloudContext.provider,
          fileBytes,
          _cloudContext.isManualBackup ? { skipLatestUpdate: true } : undefined
        );

        // Upload attachment vault if "Include attachments" checkbox is checked
        var includeAttachments = false;
        var attachCheckbox = document.getElementById("vaultIncludeAttachments");
        if (attachCheckbox && attachCheckbox.checked) includeAttachments = true;
        if (includeAttachments) {
          try {
            showVaultStatus("info", "Uploading attachments…");
            var attachData =
              typeof collectAndHashAttachmentVault === "function"
                ? await collectAndHashAttachmentVault()
                : null;
            if (attachData && attachData.payload) {
              var attachmentBytes = await vaultEncryptAttachmentVault(password, attachData.payload);
              var attachToken =
                typeof cloudGetToken === "function"
                  ? await cloudGetToken(_cloudContext.provider)
                  : null;
              if (attachToken && typeof SYNC_ATTACHMENTS_PATH !== "undefined") {
                var attachArg = JSON.stringify({
                  path: SYNC_ATTACHMENTS_PATH,
                  mode: "overwrite",
                  autorename: false,
                  mute: true,
                });
                var attachResp = await fetch("https://content.dropboxapi.com/2/files/upload", {
                  method: "POST",
                  headers: {
                    Authorization: "Bearer " + attachToken,
                    "Content-Type": "application/octet-stream",
                    "Dropbox-API-Arg": attachArg,
                  },
                  body: attachmentBytes,
                });
                if (!attachResp.ok) {
                  throw new Error("Attachment upload returned " + attachResp.status);
                }
              }
            }
          } catch (attachErr) {
            console.warn(
              "[Vault] Attachment vault upload failed (non-fatal):",
              attachErr.message || attachErr
            );
            if (typeof showToast === "function") {
              showToast(
                "Backup saved, but attachments could not be uploaded. Use ZIP backup for full coverage.",
                "warning"
              );
            }
          }
        }

        // STAK-427: Upload image vault if "Include photos" checkbox is checked
        var includePhotos = false;
        var photoCheckbox = document.getElementById("vaultIncludePhotos");
        if (photoCheckbox && photoCheckbox.checked) includePhotos = true;
        var photoMsg = "";
        if (includePhotos) {
          try {
            showVaultStatus("info", "Uploading photos\u2026");
            var imgData =
              typeof collectAndHashImageVault === "function"
                ? await collectAndHashImageVault()
                : null;
            if (imgData && imgData.payload) {
              var imageBytes = await vaultEncryptImageVault(password, imgData.payload);
              var token =
                typeof cloudGetToken === "function"
                  ? await cloudGetToken(_cloudContext.provider)
                  : null;
              if (token && typeof SYNC_IMAGES_PATH !== "undefined") {
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
                if (imgResp.ok) {
                  photoMsg =
                    " (with " +
                    imgData.imageCount +
                    " photo" +
                    (imgData.imageCount === 1 ? "" : "s") +
                    ")";
                } else {
                  throw new Error("Image upload returned " + imgResp.status);
                }
              }
            }
          } catch (imgErr) {
            console.warn(
              "[Vault] Image vault upload failed (non-fatal):",
              imgErr.message || imgErr
            );
            photoMsg = "";
            if (typeof showToast === "function") {
              showToast(
                "Backup saved, but photos could not be uploaded. Use ZIP backup for full photo coverage.",
                "warning"
              );
            }
          }
        }

        showVaultStatus("success", "Backup uploaded successfully" + photoMsg + ".");
        // Cache password for this browser session
        if (
          typeof cloudCachePassword === "function" &&
          !(_cloudContext && _cloudContext.isManualBackup)
        ) {
          cloudCachePassword(_cloudContext.provider, password);
        }
        if (typeof showKrakenToastIfFirst === "function") showKrakenToastIfFirst();
      } else {
        var exportResult = await exportEncryptedBackup(password);
        if (exportResult && exportResult.imageExportFailed) {
          showVaultStatus(
            "warning",
            "Inventory exported. Photo backup failed \u2014 try again or use Settings \u2192 Export Images."
          );
        } else if (exportResult && exportResult.attachmentExportFailed) {
          showVaultStatus(
            "warning",
            "Inventory" +
              (exportResult.imageCount > 0 ? " + photos" : "") +
              " exported. Attachment backup failed \u2014 try again or use ZIP backup."
          );
        } else {
          var _extraFiles =
            (exportResult && exportResult.imageCount > 0 ? 1 : 0) +
            (exportResult && exportResult.attachmentCount > 0 ? 1 : 0);
          if (_extraFiles > 0) {
            showVaultStatus(
              "success",
              "Backup exported \u2014 " +
                (1 + _extraFiles) +
                " files downloaded (inventory" +
                (exportResult.imageCount > 0
                  ? " + " +
                    exportResult.imageCount +
                    " photo" +
                    (exportResult.imageCount === 1 ? "" : "s")
                  : "") +
                (exportResult.attachmentCount > 0
                  ? " + " +
                    exportResult.attachmentCount +
                    " attachment" +
                    (exportResult.attachmentCount === 1 ? "" : "s")
                  : "") +
                ")."
            );
          } else {
            showVaultStatus("success", "Backup exported successfully.");
          }
        }
      }
    } catch (err) {
      showVaultStatus("error", err.message || "Export failed.");
    } finally {
      if (actionBtn) actionBtn.disabled = false;
    }
  } else {
    // Import mode
    if (!_vaultPendingFile) {
      showVaultStatus("error", "No file loaded.");
      return;
    }

    if (!getCryptoBackend()) {
      showVaultStatus(
        "error",
        "Encryption not available. Use Chrome/Safari/Edge or serve via HTTP."
      );
      return;
    }

    if (actionBtn) actionBtn.disabled = true;
    showVaultStatus("info", "Decrypting\u2026");

    try {
      // Determine whether the diff preview path is available
      var hasDiffPreview = typeof DiffEngine !== "undefined" && typeof DiffModal !== "undefined";

      await importEncryptedBackup(_vaultPendingFile, password);
      // Cache password for this browser session
      if (isCloudImport && _cloudContext && typeof cloudCachePassword === "function") {
        cloudCachePassword(_cloudContext.provider, password);
      }

      if (hasDiffPreview) {
        // DiffModal is now showing the preview — close the vault modal so
        // the user can interact with the diff review.  No reload needed;
        // the onApply callback inside vaultRestoreWithPreview handles save/render.
        closeVaultModal();
      } else {
        // Fallback: full overwrite already happened, handle image vault + reload
        var _imgRestoreCount = 0;
        var _attachRestoreCount = 0;
        var _restoreWarning = null;
        if (_vaultPendingImageFile) {
          showVaultStatus("info", "Restoring photos\u2026");
          try {
            _imgRestoreCount = await vaultDecryptAndRestoreImages(_vaultPendingImageFile, password);
          } catch (imgErr) {
            _restoreWarning = "photo file failed: " + (imgErr.message || "decryption error");
          }
        }
        if (_vaultPendingAttachmentFile) {
          showVaultStatus("info", "Restoring attachments\u2026");
          try {
            _attachRestoreCount = await vaultDecryptAndRestoreAttachments(
              _vaultPendingAttachmentFile,
              password
            );
          } catch (attachErr) {
            _restoreWarning =
              (_restoreWarning ? _restoreWarning + "; " : "") +
              "attachment file failed: " +
              (attachErr.message || "decryption error");
          }
        }
        if (_restoreWarning) {
          showVaultStatus(
            "error",
            "Inventory restored, but " + _restoreWarning + ". Reloading\u2026"
          );
        } else if (_imgRestoreCount > 0 || _attachRestoreCount > 0) {
          var _restoredParts = [];
          if (_imgRestoreCount > 0)
            _restoredParts.push(_imgRestoreCount + " photo" + (_imgRestoreCount === 1 ? "" : "s"));
          if (_attachRestoreCount > 0)
            _restoredParts.push(
              _attachRestoreCount + " attachment" + (_attachRestoreCount === 1 ? "" : "s")
            );
          showVaultStatus(
            "success",
            "Data and " + _restoredParts.join(" + ") + " restored. Reloading\u2026"
          );
        } else {
          showVaultStatus("success", "Data restored successfully. Reloading\u2026");
        }
        setTimeout(function () {
          location.reload();
        }, 1200);
      }
    } catch (err) {
      showVaultStatus("error", err.message || "Import failed.");
    } finally {
      if (actionBtn) actionBtn.disabled = false;
    }
  }
}

// =============================================================================
// MODAL HELPERS
// =============================================================================

/**
 * Show status message in the vault modal.
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {string} message
 */
function showVaultStatus(type, message) {
  var statusEl = safeGetElement("vaultStatus");
  if (!statusEl) return;

  statusEl.style.display = "";
  statusEl.className = "encryption-status";

  var dotClass = "status-" + type;
  var isAnimated = type === "info";

  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
  statusEl.innerHTML =
    '<div class="status-indicator ' +
    dotClass +
    '">' +
    '<span class="status-dot' +
    (isAnimated ? " vault-dot-pulse" : "") +
    '"></span>' +
    '<span class="status-text">' +
    escapeHtml(message) +
    "</span>" +
    "</div>";
}

/**
 * Format file size in human-readable form.
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * Update the password strength bar.
 * @param {string} password
 */
function updateStrengthBar(password) {
  var fillEl = safeGetElement("vaultStrengthFill");
  var textEl = safeGetElement("vaultStrengthText");
  if (!fillEl || !textEl) return;

  if (!password) {
    fillEl.style.width = "0%";
    fillEl.style.background = "transparent";
    textEl.textContent = "";
    return;
  }

  var strength = getPasswordStrength(password);
  var percent = ((strength.score + 1) / 5) * 100;
  if (strength.score === 0 && password.length < VAULT_MIN_PASSWORD_LENGTH) {
    percent = (password.length / VAULT_MIN_PASSWORD_LENGTH) * 20;
  }

  fillEl.style.width = percent + "%";
  fillEl.style.background = strength.color;
  textEl.textContent = strength.label;
  textEl.style.color = strength.color;
}

/**
 * Update the password match indicator.
 * @param {string} password
 * @param {string} confirm
 */
function updateMatchIndicator(password, confirm) {
  var matchEl = safeGetElement("vaultMatchIndicator");
  if (!matchEl) return;

  if (!confirm) {
    matchEl.textContent = "";
    matchEl.style.color = "";
    return;
  }

  if (password === confirm) {
    matchEl.textContent = "Passwords match";
    matchEl.style.color = "var(--success)";
  } else {
    matchEl.textContent = "Passwords do not match";
    matchEl.style.color = "var(--danger)";
  }
}

/**
 * Toggle password visibility for a field.
 * @param {string} inputId
 * @param {HTMLElement} toggleBtn
 */
function toggleVaultPasswordVisibility(inputId, toggleBtn) {
  var input = safeGetElement(inputId);
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    if (toggleBtn) toggleBtn.textContent = "\u25C9"; // ◉
  } else {
    input.type = "password";
    if (toggleBtn) toggleBtn.textContent = "\u25CE"; // ◎
  }
}

// =============================================================================
// MANIFEST CRYPTO (STAK-188) — .stmanifest encrypt/decrypt
//
// Binary format (53-byte header + ciphertext):
//   0-3   : "STMF" magic bytes (0x53 0x54 0x4D 0x46)
//   4     : format version (0x01)
//   5-8   : PBKDF2 iterations (uint32 big-endian)
//   9-40  : 32-byte random salt
//   41-52 : 12-byte random IV/nonce
//   53+   : AES-256-GCM ciphertext (includes 16-byte auth tag)
// =============================================================================

const MANIFEST_MAGIC = new Uint8Array([0x53, 0x54, 0x4d, 0x46]); // "STMF"
const MANIFEST_VERSION = 0x01;
const MANIFEST_HEADER_SIZE = 53; // 4 magic + 1 version + 4 iterations + 32 salt + 12 IV

/**
 * Encrypt a manifest object into a .stmanifest binary blob.
 *
 * Uses the same AES-256-GCM + PBKDF2-SHA256 crypto as vault files but with
 * a distinct "STMF" magic header so manifest files are cryptographically
 * separable from .stvault files.
 *
 * @param {object} manifestJson - Plain JS object to encrypt (will be JSON.stringify'd)
 * @param {string} password
 * @returns {Promise<ArrayBuffer>} Encrypted manifest bytes
 */
async function encryptManifest(manifestJson, password) {
  var plaintext = new TextEncoder().encode(JSON.stringify(manifestJson));
  var salt = vaultRandomBytes(32);
  var iv = vaultRandomBytes(12);
  var key = await vaultDeriveKey(password, salt, VAULT_PBKDF2_ITERATIONS);
  var ciphertext = await vaultEncrypt(plaintext, key, iv);

  var file = new Uint8Array(MANIFEST_HEADER_SIZE + ciphertext.length);
  // Magic bytes "STMF"
  file.set(MANIFEST_MAGIC, 0);
  // Version
  file[4] = MANIFEST_VERSION;
  // Iterations (uint32 big-endian)
  file[5] = (VAULT_PBKDF2_ITERATIONS >>> 24) & 0xff;
  file[6] = (VAULT_PBKDF2_ITERATIONS >>> 16) & 0xff;
  file[7] = (VAULT_PBKDF2_ITERATIONS >>> 8) & 0xff;
  file[8] = VAULT_PBKDF2_ITERATIONS & 0xff;
  // Salt (32 bytes at offset 9)
  file.set(salt, 9);
  // IV (12 bytes at offset 41)
  file.set(iv, 41);
  // Ciphertext
  file.set(ciphertext, MANIFEST_HEADER_SIZE);

  return file.buffer;
}

/**
 * Decrypt a .stmanifest binary blob and return the parsed JS object.
 *
 * Validates the "STMF" magic header and explicitly rejects .stvault files
 * with a distinct error message.
 *
 * @param {ArrayBuffer|Uint8Array} encryptedData
 * @param {string} password
 * @returns {Promise<object>} Parsed manifest object
 * @throws {Error} "This is a .stvault file, not a .stmanifest file" — if STVAULT magic detected
 * @throws {Error} "Not a valid .stmanifest file" — if magic is unrecognised
 * @throws {Error} "Failed to decrypt manifest — wrong password or corrupt file" — on decryption failure
 */
async function decryptManifest(encryptedData, password) {
  var fileBytes =
    encryptedData instanceof Uint8Array ? encryptedData : new Uint8Array(encryptedData);

  if (fileBytes.length < MANIFEST_HEADER_SIZE + 16) {
    throw new Error("Not a valid .stmanifest file");
  }

  // Check for .stvault magic ("STVAULT" = 0x53 0x54 0x56 0x41 0x55 0x4C 0x54)
  // First four bytes of STVAULT are 0x53 0x54 0x56 0x41; STMF starts 0x53 0x54 0x4D 0x46.
  // Byte index 2 distinguishes them: 0x56 ('V') vs 0x4D ('M').
  if (
    fileBytes[0] === 0x53 &&
    fileBytes[1] === 0x54 &&
    fileBytes[2] === 0x56 &&
    fileBytes[3] === 0x41
  ) {
    throw new Error("This is a .stvault file, not a .stmanifest file");
  }

  // Validate STMF magic
  if (
    fileBytes[0] !== MANIFEST_MAGIC[0] ||
    fileBytes[1] !== MANIFEST_MAGIC[1] ||
    fileBytes[2] !== MANIFEST_MAGIC[2] ||
    fileBytes[3] !== MANIFEST_MAGIC[3]
  ) {
    throw new Error("Not a valid .stmanifest file");
  }

  // Check version
  var version = fileBytes[4];
  if (version > MANIFEST_VERSION) {
    throw new Error("Manifest created by a newer StakTrakr version. Please update.");
  }

  // Parse iterations (uint32 big-endian at offset 5)
  var iterations =
    ((fileBytes[5] << 24) | (fileBytes[6] << 16) | (fileBytes[7] << 8) | fileBytes[8]) >>> 0; // ensure unsigned

  var salt = fileBytes.slice(9, 41);
  var iv = fileBytes.slice(41, 53);
  var ciphertext = fileBytes.slice(MANIFEST_HEADER_SIZE);

  try {
    var key = await vaultDeriveKey(password, salt, iterations);
    var plainBytes = await vaultDecrypt(ciphertext, key, iv);
    return JSON.parse(new TextDecoder().decode(plainBytes));
  } catch (_) {
    throw new Error("Failed to decrypt manifest — wrong password or corrupt file");
  }
}

// =============================================================================
// WINDOW EXPORTS
// =============================================================================

window.openVaultModal = openVaultModal;
window.closeVaultModal = closeVaultModal;
window.handleVaultAction = handleVaultAction;
window.vaultEncryptToBytes = vaultEncryptToBytes;
window.vaultEncryptToBytesScoped = vaultEncryptToBytesScoped;
window.vaultDecryptAndRestore = vaultDecryptAndRestore;
window.vaultRestoreWithPreview = vaultRestoreWithPreview;
window.vaultDecryptToData = vaultDecryptToData;
window.collectVaultData = collectVaultData;
window.restoreVaultData = restoreVaultData;
window.collectAndHashImageVault = collectAndHashImageVault;
window.vaultEncryptImageVault = vaultEncryptImageVault;
window.vaultDecryptAndRestoreImages = vaultDecryptAndRestoreImages;
window.encryptManifest = encryptManifest;
window.decryptManifest = decryptManifest;
window.setVaultPendingImageFile = function (bytes) {
  _vaultPendingImageFile = bytes;
};
window.setVaultPendingAttachmentFile = function (bytes) {
  _vaultPendingAttachmentFile = bytes;
};

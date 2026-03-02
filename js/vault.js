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

const VAULT_MAGIC = new Uint8Array([0x53, 0x54, 0x56, 0x41, 0x55, 0x4C, 0x54]); // "STVAULT"
const VAULT_VERSION = 0x01;
const VAULT_HEADER_SIZE = 56;
const VAULT_PBKDF2_ITERATIONS = 600000;
const VAULT_MIN_PASSWORD_LENGTH = 8;
const VAULT_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// =============================================================================
// CRYPTO ABSTRACTION LAYER
// =============================================================================

/**
 * Detect available crypto backend.
 * @returns {'native'|'forge'|null}
 */
function getCryptoBackend() {
  try {
    if (
      typeof crypto !== "undefined" &&
      crypto.subtle &&
      typeof crypto.subtle.importKey === "function"
    ) {
      return "native";
    }
  } catch (err) {
    debugLog('[Vault] Crypto backend detection failed: ' + err.message, 'info');
  }
  try {
    if (typeof forge !== "undefined" && forge.cipher && forge.pkcs5) {
      return "forge";
    }
  } catch (err) {
    debugLog('[Vault] Crypto backend detection failed: ' + err.message, 'info');
  }
  return null;
}

/**
 * Generate cryptographically random bytes.
 * @param {number} length
 * @returns {Uint8Array}
 */
function vaultRandomBytes(length) {
  const backend = getCryptoBackend();
  if (backend === "native") {
    return crypto.getRandomValues(new Uint8Array(length));
  }
  if (backend === "forge") {
    const bytes = forge.random.getBytesSync(length);
    return new Uint8Array(
      bytes.split("").map(function (c) {
        return c.charCodeAt(0);
      }),
    );
  }
  throw new Error("No crypto backend available");
}

/**
 * Derive AES-256 key from password using PBKDF2.
 * @param {string} password
 * @param {Uint8Array} salt - 32-byte salt
 * @param {number} iterations
 * @returns {Promise<CryptoKey|string>} Native CryptoKey or forge key bytes
 */
async function vaultDeriveKey(password, salt, iterations) {
  const backend = getCryptoBackend();
  if (backend === "native") {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
  if (backend === "forge") {
    var saltStr = String.fromCharCode.apply(null, salt);
    var key = forge.pkcs5.pbkdf2(password, saltStr, iterations, 32, "sha256");
    return key;
  }
  throw new Error("No crypto backend available");
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * @param {Uint8Array} plaintext
 * @param {CryptoKey|string} key
 * @param {Uint8Array} iv - 12-byte nonce
 * @returns {Promise<Uint8Array>} ciphertext + 16-byte auth tag
 */
async function vaultEncrypt(plaintext, key, iv) {
  var backend = getCryptoBackend();
  if (backend === "native") {
    var result = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      plaintext,
    );
    return new Uint8Array(result);
  }
  if (backend === "forge") {
    var cipher = forge.cipher.createCipher(
      "AES-GCM",
      key,
    );
    var ivStr = String.fromCharCode.apply(null, iv);
    cipher.start({ iv: ivStr, tagLength: 128 });
    cipher.update(
      forge.util.createBuffer(String.fromCharCode.apply(null, plaintext)),
    );
    cipher.finish();

    var encrypted = cipher.output.getBytes();
    var tag = cipher.mode.tag.getBytes();

    var combined = new Uint8Array(encrypted.length + tag.length);
    for (var i = 0; i < encrypted.length; i++) {
      combined[i] = encrypted.charCodeAt(i);
    }
    for (var j = 0; j < tag.length; j++) {
      combined[encrypted.length + j] = tag.charCodeAt(j);
    }
    return combined;
  }
  throw new Error("No crypto backend available");
}

/**
 * Decrypt ciphertext with AES-256-GCM.
 * @param {Uint8Array} ciphertext - ciphertext + 16-byte auth tag
 * @param {CryptoKey|string} key
 * @param {Uint8Array} iv - 12-byte nonce
 * @returns {Promise<Uint8Array>} plaintext
 * @throws {Error} On wrong password or corrupted data (GCM auth tag mismatch)
 */
async function vaultDecrypt(ciphertext, key, iv) {
  var backend = getCryptoBackend();
  if (backend === "native") {
    try {
      var result = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        ciphertext,
      );
      return new Uint8Array(result);
    } catch (_) {
      throw new Error("Incorrect password or corrupted file.");
    }
  }
  if (backend === "forge") {
    // Split ciphertext and tag (last 16 bytes)
    var tagLength = 16;
    if (ciphertext.length < tagLength) {
      throw new Error("Incorrect password or corrupted file.");
    }
    var encBytes = ciphertext.slice(0, ciphertext.length - tagLength);
    var tagBytes = ciphertext.slice(ciphertext.length - tagLength);

    var encStr = String.fromCharCode.apply(null, encBytes);
    var tagStr = String.fromCharCode.apply(null, tagBytes);
    var ivStr = String.fromCharCode.apply(null, iv);

    var decipher = forge.cipher.createDecipher("AES-GCM", key);
    decipher.start({
      iv: ivStr,
      tagLength: 128,
      tag: forge.util.createBuffer(tagStr),
    });
    decipher.update(forge.util.createBuffer(encStr));
    var pass = decipher.finish();

    if (!pass) {
      throw new Error("Incorrect password or corrupted file.");
    }
    var output = decipher.output.getBytes();
    return new Uint8Array(
      output.split("").map(function (c) {
        return c.charCodeAt(0);
      }),
    );
  }
  throw new Error("No crypto backend available");
}

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
    throw new Error(
      "Created by a newer StakTrakr version. Please update.",
    );
  }
  // Parse iterations
  var iterations =
    (fileBytes[8] << 24) |
    (fileBytes[9] << 16) |
    (fileBytes[10] << 8) |
    fileBytes[11];
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

// =============================================================================
// DATA COLLECTION / RESTORATION
// =============================================================================

/**
 * Collect localStorage data for vault export.
 * @param {string} [scope='full'] - 'full' collects all ALLOWED_STORAGE_KEYS;
 *   'sync' collects only SYNC_SCOPE_KEYS (inventory + display prefs, no API keys or tokens)
 * @returns {object|null} Payload object or null if empty
 */
function collectVaultData(scope) {
  scope = scope || 'full';

  var keysToCollect = scope === 'sync' && typeof SYNC_SCOPE_KEYS !== 'undefined'
    ? SYNC_SCOPE_KEYS
    : ALLOWED_STORAGE_KEYS;

  var payload = {
    _meta: {
      appVersion: typeof APP_VERSION !== "undefined" ? APP_VERSION : "unknown",
      exportTimestamp: new Date().toISOString(),
      exportOrigin: (typeof window !== 'undefined' && window.location) ? window.location.origin : '',
      scope: scope,
    },
    data: {},
  };

  var hasData = false;

  for (var i = 0; i < keysToCollect.length; i++) {
    var key = keysToCollect[i];
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
    // Only restore recognized keys
    if (ALLOWED_STORAGE_KEYS.indexOf(key) !== -1) {
      try {
        localStorage.setItem(key, data[key]);
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
  var payload = collectVaultData('full');
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
  var payload = collectVaultData('sync');
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
  if (typeof DiffEngine === 'undefined' || typeof DiffModal === 'undefined') {
    debugLog('[Vault] DiffEngine/DiffModal not available — falling back to full restore');
    if (typeof showToast === 'function') {
      showToast('Diff preview unavailable — restoring full backup');
    }
    await restoreVaultData(payload);
    // Post-restore summary banner (STAK-374) — item count from payload meta or backupItems
    var _fallbackCount = (payload && payload._meta && payload._meta.itemCount) ? payload._meta.itemCount : 0;
    if (typeof showImportSummaryBanner === 'function') {
      showImportSummaryBanner({ added: _fallbackCount, modified: 0, deleted: 0, skipped: 0, skippedReasons: [] });
    }
    return;
  }

  // 3. Extract inventory items from the payload
  // Vault stores raw localStorage strings which may be CMP1-compressed for large inventories
  var backupItems = [];
  try {
    var rawInv = payload.data.metalInventory || '[]';
    var decompressedInv = typeof __decompressIfNeeded === 'function' ? __decompressIfNeeded(rawInv) : rawInv;
    backupItems = JSON.parse(decompressedInv);
  } catch (e) {
    debugLog('[Vault] Could not parse metalInventory from backup:', e);
  }

  // 4. Compute item diff
  var localItems = (typeof inventory !== 'undefined' && Array.isArray(inventory)) ? inventory : [];
  var diffResult = DiffEngine.compareItems(localItems, backupItems);

  // 5. Compute settings diff
  var settingsDiff = null;
  if (typeof DiffEngine.compareSettings === 'function') {
    var settingsKeys = (typeof ALLOWED_STORAGE_KEYS !== 'undefined' && Array.isArray(ALLOWED_STORAGE_KEYS))
      ? ALLOWED_STORAGE_KEYS
      : [];
    var localSettings = {};
    var remoteSettings = {};
    var payloadKeys = Object.keys(payload.data);

    for (var i = 0; i < payloadKeys.length; i++) {
      var k = payloadKeys[i];
      // Skip inventory — handled separately via DiffEngine.compareItems
      if (k === 'metalInventory') continue;
      // Only include recognized storage keys
      if (settingsKeys.indexOf(k) === -1) continue;

      // Parse the remote value (vault stores raw localStorage strings, possibly CMP1-compressed)
      var rawSettingVal = payload.data[k];
      var decompressedVal = typeof __decompressIfNeeded === 'function' ? __decompressIfNeeded(rawSettingVal) : rawSettingVal;
      var remoteVal;
      try { remoteVal = JSON.parse(decompressedVal); } catch (_e) { remoteVal = decompressedVal; }
      remoteSettings[k] = remoteVal;

      // Load matching local value
      var localVal = (typeof loadDataSync === 'function') ? loadDataSync(k, null) : null;
      if (localVal !== null) {
        localSettings[k] = localVal;
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

  // 6. Check for zero changes
  var totalChanges = diffResult.added.length + diffResult.modified.length + diffResult.deleted.length;
  if (totalChanges === 0 && !settingsDiff) {
    if (typeof showToast === 'function') {
      showToast('No differences found \u2014 backup matches current data');
    }
    return;
  }

  // 7. Build metadata from payload._meta
  var payloadMeta = payload._meta || {};

  // Cross-domain origin warning (STAK-374): warn when restoring from a different domain
  var _vaultOrigin = payloadMeta.exportOrigin || null;
  var _currentOriginVault = (typeof window !== 'undefined' && window.location) ? window.location.origin : null;
  if (_vaultOrigin && _currentOriginVault && _vaultOrigin !== _currentOriginVault && typeof showToast === 'function') {
    var _safeVaultFrom = typeof sanitizeHtml === 'function' ? sanitizeHtml(_vaultOrigin) : _vaultOrigin;
    showToast('\u26A0 This vault was exported from a different domain (' + _safeVaultFrom + '). Check item counts carefully.');
  }

  // Compute count header values for DiffModal (STAK-374)
  var _vaultBackupCount = (typeof backupItems !== 'undefined' && Array.isArray(backupItems))
    ? backupItems.length
    : (payloadMeta.itemCount ? payloadMeta.itemCount : 0);
  var _vaultLocalCount = (typeof inventory !== 'undefined' && Array.isArray(inventory))
    ? inventory.length
    : (typeof loadDataSync === 'function' ? (loadDataSync('metalInventory', []).length) : 0);

  // 8. Show DiffModal
  DiffModal.show({
    source: { type: 'vault', label: 'Encrypted Backup' },
    diff: diffResult,
    settingsDiff: settingsDiff,
    backupCount: _vaultBackupCount,
    localCount: _vaultLocalCount,
    meta: {
      timestamp: payloadMeta.exportTimestamp || null,
      itemCount: backupItems.length,
      appVersion: payloadMeta.appVersion || null
    },
    onApply: function (selectedChanges) {
      try {
        var hasItemChanges = Array.isArray(selectedChanges) && selectedChanges.length > 0;

        // Apply items selectively when item changes were selected
        if (hasItemChanges) {
          var currentInv = (typeof inventory !== 'undefined' && Array.isArray(inventory)) ? inventory : [];
          var newInv = DiffEngine.applySelectedChanges(currentInv, selectedChanges);
          inventory = newInv;
        }

        // Apply settings changes (settings are all-or-nothing until DiffModal adds
        // per-setting checkboxes — intentional, not a bug)
        var appliedSettings = false;
        if (settingsDiff && settingsDiff.changed) {
          for (var si = 0; si < settingsDiff.changed.length; si++) {
            if (typeof saveDataSync === 'function') {
              saveDataSync(settingsDiff.changed[si].key, settingsDiff.changed[si].remoteVal);
              appliedSettings = true;
            }
          }
        }

        // Save & render
        if (typeof saveInventory === 'function') saveInventory();
        if (typeof renderTable === 'function') renderTable();
        if (typeof renderActiveFilters === 'function') renderActiveFilters();
        if (typeof updateStorageStats === 'function') updateStorageStats();

        // Toast summary
        var addCount = 0, modCount = 0, delCount = 0;
        if (hasItemChanges) {
          for (var j = 0; j < selectedChanges.length; j++) {
            if (selectedChanges[j].type === 'add') addCount++;
            else if (selectedChanges[j].type === 'modify') modCount++;
            else if (selectedChanges[j].type === 'delete') delCount++;
          }
        }
        var parts = [];
        if (addCount > 0) parts.push(addCount + ' added');
        if (modCount > 0) parts.push(modCount + ' updated');
        if (delCount > 0) parts.push(delCount + ' removed');
        if (appliedSettings && !hasItemChanges) parts.push('settings updated');
        if (typeof showToast === 'function') {
          showToast('Backup restored: ' + (parts.length > 0 ? parts.join(', ') : 'no changes applied'));
        }

        // Post-import summary banner (STAK-374)
        if (typeof showImportSummaryBanner === 'function') {
          showImportSummaryBanner({
            added: addCount,
            modified: modCount,
            deleted: delCount,
            skipped: 0,
            skippedReasons: []
          });
        }

        // Restore companion photo vault if present
        if (capturedImageFile && typeof vaultDecryptAndRestoreImages === 'function') {
          vaultDecryptAndRestoreImages(capturedImageFile, password).then(function (imgCount) {
            debugLog('[Vault] Restored ' + imgCount + ' photo(s) from companion image vault');
          }).catch(function (imgErr) {
            debugLog('[Vault] Image restore failed:', imgErr);
          });
        }
      } catch (applyErr) {
        debugLog('[Vault] Restore apply failed:', applyErr);
        if (typeof showToast === 'function') {
          showToast('Restore failed: ' + (applyErr.message || 'Unknown error'));
        }
      }
    },
    onCancel: function () {
      debugLog('[Vault] Restore preview cancelled');
    }
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
    reader.onload = function () { resolve(reader.result.split(',')[1]); };
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
  for (var i = 0; i < byteChars.length; i++) { bytes[i] = byteChars.charCodeAt(i); }
  return new Blob([bytes], { type: mimeType || 'image/webp' });
}

/**
 * Export user images from IndexedDB, convert Blobs to base64, and compute a
 * stable hash so push can skip upload when images haven't changed.
 * @returns {Promise<{payload: object, hash: string, imageCount: number}|null>}
 *   null when there are no user-uploaded images
 */
async function collectAndHashImageVault() {
  if (typeof imageCache === 'undefined' || typeof imageCache.exportAllUserImages !== 'function') return null;
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
      debugLog('[Vault] Image vault: blob conversion failed for uuid', r.uuid, blobErr);
      continue;
    }
    serialized.push(entry);
  }

  if (failedCount > 0) {
    debugLog('[Vault] Image vault: ' + failedCount + ' of ' + records.length + ' images failed to export', 'warn');
  }
  if (serialized.length === 0 && records.length > 0) {
    throw new Error('Image vault export failed — could not read any of ' + records.length + ' images.');
  }

  if (serialized.length === 0) return null;

  var payload = {
    _meta: {
      appVersion: typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown',
      exportTimestamp: new Date().toISOString(),
      imageCount: serialized.length,
    },
    records: serialized,
  };

  // Hash includes a content sample (first 32 chars of obverse base64) so that
  // replacing an image with one of identical byte size still triggers an upload.
  var hash = simpleHash(JSON.stringify(serialized.map(function (e) {
    return e.uuid + ':' + e.size + ':' + (e.obverse ? e.obverse.slice(0, 32) : '');
  })));
  return { payload: payload, hash: hash, imageCount: serialized.length };
}

/**
 * Encrypt a user-image vault payload into raw bytes for cloud upload.
 * @param {string} password
 * @param {object} payload - From collectAndHashImageVault().payload
 * @returns {Promise<Uint8Array>}
 */
async function vaultEncryptImageVault(password, payload) {
  if (!password) throw new Error('Image vault encryption requires a non-empty password.');
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
  if (typeof imageCache === 'undefined' || typeof imageCache.importUserImageRecord !== 'function') return 0;

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
      if (ok) { count++; } else {
        failed++;
        debugLog('[Vault] Image vault: importUserImageRecord returned false for uuid', r.uuid);
      }
    } catch (recErr) {
      failed++;
      debugLog('[Vault] Image vault: record import error for uuid', r.uuid, recErr);
    }
  }
  if (failed > 0) {
    var msg = 'Image vault restore: ' + failed + ' of ' + payload.records.length + ' images failed to import.';
    debugLog('[Vault] ' + msg, 'error');
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
    var isPasswordErr = msg.indexOf('Incorrect password') !== -1 || msg.indexOf('corrupted') !== -1;
    throw new Error(isPasswordErr
      ? 'Image vault decryption failed — check your sync password.'
      : 'Image vault restore failed: ' + msg);
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
    throw new Error(
      "Encryption not available. Use Chrome/Safari/Edge or serve via HTTP.",
    );
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
      imgA.download = "staktrakr_backup_" + timestamp + VAULT_IMAGE_FILE_SUFFIX + VAULT_FILE_EXTENSION;
      document.body.appendChild(imgA);
      imgA.click();
      document.body.removeChild(imgA);
      URL.revokeObjectURL(imgUrl);
      imageCount = imgVaultData.imageCount;
      debugLog("Vault: image vault export complete,", imgBytes.length, "bytes,", imageCount, "images");
    }
  } catch (imgErr) {
    debugLog("[Vault] Image vault export failed:", imgErr.message || String(imgErr), "warn");
    // Return a flag so the caller can surface a warning
    return { imageExportFailed: true };
  }

  return { imageCount: imageCount };
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
    throw new Error(
      "Encryption not available. Use Chrome/Safari/Edge or serve via HTTP.",
    );
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

  if (mode === 'cloud-export') {
    effectiveMode = 'export';
    _cloudContext = { provider: fileOrOpts && fileOrOpts.provider ? fileOrOpts.provider : 'dropbox' };
  } else if (mode === 'cloud-import') {
    effectiveMode = 'import';
    if (fileOrOpts && fileOrOpts.fileBytes) {
      _cloudContext = {
        provider: fileOrOpts.provider || 'dropbox',
        fileBytes: fileOrOpts.fileBytes,
        filename: fileOrOpts.filename || 'cloud-backup.stvault',
        size: fileOrOpts.size || fileOrOpts.fileBytes.length,
      };
      _vaultPendingFile = fileOrOpts.fileBytes;
    }
  } else if (mode === 'import' && fileOrOpts instanceof File) {
    file = fileOrOpts;
  } else if (mode === 'import') {
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
  _cloudContext = null;
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
      "Password must be at least " + VAULT_MIN_PASSWORD_LENGTH + " characters.",
    );
    return;
  }

  // Determine effective mode
  var isCloudExport = mode === "cloud-export";
  var isCloudImport = mode === "cloud-import";
  var effectiveMode = (isCloudExport) ? "export" : (isCloudImport) ? "import" : mode;

  if (effectiveMode === "export") {
    var confirm = confirmEl ? confirmEl.value : "";
    if (password !== confirm) {
      showVaultStatus("error", "Passwords do not match.");
      return;
    }

    if (!getCryptoBackend()) {
      showVaultStatus(
        "error",
        "Encryption not available. Use Chrome/Safari/Edge or serve via HTTP.",
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
        await cloudUploadVault(_cloudContext.provider, fileBytes);
        showVaultStatus("success", "Backup uploaded successfully.");
        // Cache password for this browser session
        if (typeof cloudCachePassword === 'function') {
          cloudCachePassword(_cloudContext.provider, password);
        }
        if (typeof showKrakenToastIfFirst === 'function') showKrakenToastIfFirst();
      } else {
        var exportResult = await exportEncryptedBackup(password);
        if (exportResult && exportResult.imageExportFailed) {
          showVaultStatus("warning", "Inventory exported. Photo backup failed \u2014 try again or use Settings \u2192 Export Images.");
        } else if (exportResult && exportResult.imageCount > 0) {
          showVaultStatus("success", "Backup exported \u2014 2 files downloaded (inventory + " + exportResult.imageCount + " photo" + (exportResult.imageCount === 1 ? "" : "s") + ").");
        } else {
          showVaultStatus("success", "Backup exported successfully.");
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
        "Encryption not available. Use Chrome/Safari/Edge or serve via HTTP.",
      );
      return;
    }

    if (actionBtn) actionBtn.disabled = true;
    showVaultStatus("info", "Decrypting\u2026");

    try {
      // Determine whether the diff preview path is available
      var hasDiffPreview = (typeof DiffEngine !== 'undefined' && typeof DiffModal !== 'undefined');

      await importEncryptedBackup(_vaultPendingFile, password);
      // Cache password for this browser session
      if (isCloudImport && _cloudContext && typeof cloudCachePassword === 'function') {
        cloudCachePassword(_cloudContext.provider, password);
      }

      if (hasDiffPreview) {
        // DiffModal is now showing the preview — close the vault modal so
        // the user can interact with the diff review.  No reload needed;
        // the onApply callback inside vaultRestoreWithPreview handles save/render.
        closeVaultModal();
      } else {
        // Fallback: full overwrite already happened, handle image vault + reload
        if (_vaultPendingImageFile) {
          showVaultStatus("info", "Restoring photos\u2026");
          try {
            var imgCount = await vaultDecryptAndRestoreImages(_vaultPendingImageFile, password);
            showVaultStatus("success", "Data and " + imgCount + " photo" + (imgCount === 1 ? "" : "s") + " restored. Reloading\u2026");
          } catch (imgErr) {
            showVaultStatus("error", "Inventory restored, but photo file failed: " + (imgErr.message || "decryption error") + ". Reloading\u2026");
          }
        } else {
          showVaultStatus("success", "Data restored successfully. Reloading\u2026");
        }
        setTimeout(function () { location.reload(); }, 1200);
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
    '<div class="status-indicator ' + dotClass + '">' +
    '<span class="status-dot' + (isAnimated ? " vault-dot-pulse" : "") + '"></span>' +
    '<span class="status-text">' + escapeHtml(message) + "</span>" +
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

const MANIFEST_MAGIC = new Uint8Array([0x53, 0x54, 0x4D, 0x46]); // "STMF"
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
  var fileBytes = encryptedData instanceof Uint8Array
    ? encryptedData
    : new Uint8Array(encryptedData);

  if (fileBytes.length < MANIFEST_HEADER_SIZE + 16) {
    throw new Error('Not a valid .stmanifest file');
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
    throw new Error('This is a .stvault file, not a .stmanifest file');
  }

  // Validate STMF magic
  if (
    fileBytes[0] !== MANIFEST_MAGIC[0] ||
    fileBytes[1] !== MANIFEST_MAGIC[1] ||
    fileBytes[2] !== MANIFEST_MAGIC[2] ||
    fileBytes[3] !== MANIFEST_MAGIC[3]
  ) {
    throw new Error('Not a valid .stmanifest file');
  }

  // Check version
  var version = fileBytes[4];
  if (version > MANIFEST_VERSION) {
    throw new Error('Manifest created by a newer StakTrakr version. Please update.');
  }

  // Parse iterations (uint32 big-endian at offset 5)
  var iterations =
    ((fileBytes[5] << 24) |
     (fileBytes[6] << 16) |
     (fileBytes[7] << 8) |
      fileBytes[8]) >>> 0; // ensure unsigned

  var salt = fileBytes.slice(9, 41);
  var iv = fileBytes.slice(41, 53);
  var ciphertext = fileBytes.slice(MANIFEST_HEADER_SIZE);

  try {
    var key = await vaultDeriveKey(password, salt, iterations);
    var plainBytes = await vaultDecrypt(ciphertext, key, iv);
    return JSON.parse(new TextDecoder().decode(plainBytes));
  } catch (_) {
    throw new Error('Failed to decrypt manifest — wrong password or corrupt file');
  }
}

// =============================================================================
// WINDOW EXPORTS
// =============================================================================

window.openVaultModal = openVaultModal;
window.closeVaultModal = closeVaultModal;
window.vaultEncryptToBytes = vaultEncryptToBytes;
window.vaultEncryptToBytesScoped = vaultEncryptToBytesScoped;
window.vaultDecryptAndRestore = vaultDecryptAndRestore;
window.vaultRestoreWithPreview = vaultRestoreWithPreview;
window.vaultDecryptToData = vaultDecryptToData;
window.collectVaultData = collectVaultData;
window.collectAndHashImageVault = collectAndHashImageVault;
window.vaultEncryptImageVault = vaultEncryptImageVault;
window.vaultDecryptAndRestoreImages = vaultDecryptAndRestoreImages;
window.encryptManifest = encryptManifest;
window.decryptManifest = decryptManifest;
window.setVaultPendingImageFile = function (bytes) { _vaultPendingImageFile = bytes; };

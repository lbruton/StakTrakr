// IMAGE CACHE — IndexedDB storage for coin images and Numista metadata
// =============================================================================

/**
 * ImageCache provides persistent IndexedDB storage for user-uploaded images,
 * pattern rule images, and enriched Numista metadata.
 *
 * Schema:
 *   DB: StakTrakrImages v3
 *   Store "coinImages"    — keyPath: catalogId (LEGACY; retained in schema, no longer read/written)
 *   Store "coinMetadata"  — keyPath: catalogId (Numista N# string)
 *   Store "userImages"    — keyPath: uuid (item UUID string)
 *   Store "patternImages" — keyPath: ruleId (pattern rule ID string)
 *
 * @class
 */
class ImageCache {
  constructor() {
    /** @type {IDBDatabase|null} */
    this._db = null;
    /** @type {boolean} */
    this._available = false;
    /** @type {number} Default storage quota in bytes (500 MB); updated async by _initQuota() */
    this._quotaBytes = 500 * 1024 * 1024; // 500 MB default; updated async by _initQuota()
    /** @type {number} Max image dimension (px) for resize */
    this._maxDim = typeof IMAGE_MAX_DIM !== "undefined" ? IMAGE_MAX_DIM : 600;
    /** @type {number} Compression quality (0-1) */
    this._quality = typeof IMAGE_QUALITY !== "undefined" ? IMAGE_QUALITY : 0.75;
    /** @type {'ok'|'warn'|'critical'} Last user-image storage pressure band warned about (STRK-146) */
    this._lastWarnedLevel = "ok";
    /**
     * Cached total bytes in the `userImages` store (STRK-162). `null` = cold
     * (unknown — recompute on next need); a number = warm. Use a strict `=== null`
     * check to read it: an empty store is a legitimate `0`, not "cold".
     * @type {number|null}
     */
    this._userImagesBytesCache = null;
  }

  async _initQuota() {
    try {
      if (!navigator?.storage?.estimate) return;
      const { quota = 0, usage = 0 } = await navigator.storage.estimate();
      const available = quota - usage;
      if (available <= 0) return; // file:// or estimate unavailable
      // 60% of available space, min 500 MB (capped at available), max 4 GB
      this._quotaBytes = Math.min(
        Math.max(available * 0.6, Math.min(available, 500 * 1024 * 1024)),
        4 * 1024 * 1024 * 1024
      );
    } catch {
      // Leave at 500 MB default
    }
  }
  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Open (or create) the IndexedDB database. Safe to call multiple times.
   * @returns {Promise<boolean>} true if DB opened successfully
   */
  async init() {
    if (this._db) return true;

    if (typeof indexedDB === "undefined") {
      console.warn("ImageCache: IndexedDB not available");
      return false;
    }

    try {
      this._db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("StakTrakrImages", 3);

        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains("coinImages")) {
            db.createObjectStore("coinImages", { keyPath: "catalogId" });
          }
          if (!db.objectStoreNames.contains("coinMetadata")) {
            db.createObjectStore("coinMetadata", { keyPath: "catalogId" });
          }
          // v2: User-uploaded images keyed by item UUID (STACK-32)
          if (!db.objectStoreNames.contains("userImages")) {
            db.createObjectStore("userImages", { keyPath: "uuid" });
          }
          // v3: Pattern images keyed by rule ID (user pattern image rules)
          if (e.oldVersion < 3) {
            if (!db.objectStoreNames.contains("patternImages")) {
              db.createObjectStore("patternImages", { keyPath: "ruleId" });
            }
          }
        };

        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
      });

      // Detect browser-initiated connection closure
      this._db.onclose = () => {
        console.warn("ImageCache: DB connection closed by browser");
        this._db = null;
        this._available = false;
      };

      this._available = true;
      debugLog("ImageCache: initialized");
      this._initQuota(); // non-blocking, updates _quotaBytes async
      return true;
    } catch (err) {
      console.warn("ImageCache: failed to open DB", err);
      this._available = false;
      return false;
    }
  }

  /**
   * Whether IndexedDB opened successfully.
   * @returns {boolean}
   */
  isAvailable() {
    return this._available;
  }

  /**
   * Ensure the DB connection is alive, reconnecting if stale.
   * Call this before every public operation to guard against
   * browser-initiated connection closures (storage pressure,
   * tab backgrounding, etc.).
   * @returns {Promise<boolean>}
   */
  async _ensureDb() {
    if (this._db) {
      try {
        // Lightweight probe — creating a transaction will throw if connection is dead
        this._db.transaction("coinMetadata", "readonly");
        return true;
      } catch {
        console.warn("ImageCache: DB connection stale, reconnecting...");
        this._db = null;
        this._available = false;
      }
    }
    return this.init();
  }

  // ---------------------------------------------------------------------------
  // Image storage
  // ---------------------------------------------------------------------------

  /**
   * Store enriched Numista metadata for a coin type.
   * @param {string} catalogId - Numista N# identifier
   * @param {Object} numistaResult - Normalized Numista result object
   * @returns {Promise<boolean>}
   */
  async cacheMetadata(catalogId, numistaResult) {
    if (!catalogId || !numistaResult || !(await this._ensureDb())) return false;

    const record = {
      catalogId,
      title: numistaResult.name || "",
      country: numistaResult.country || "",
      denomination: numistaResult.denomination || "",
      diameter: numistaResult.diameter || numistaResult.size || 0,
      thickness: numistaResult.thickness || 0,
      weight: numistaResult.weight || 0,
      shape: numistaResult.shape || "",
      composition: numistaResult.composition || numistaResult.metal || "",
      orientation: numistaResult.orientation || "",
      commemorative: !!numistaResult.commemorative,
      commemorativeDesc: numistaResult.commemorativeDesc || "",
      rarityIndex: numistaResult.rarityIndex || 0,
      kmReferences: numistaResult.kmReferences || [],
      mintageByYear: numistaResult.mintageByYear || [],
      technique: numistaResult.technique || "",
      tags: numistaResult.tags || [],
      obverseDesc: numistaResult.obverseDesc || "",
      reverseDesc: numistaResult.reverseDesc || "",
      edgeDesc: numistaResult.edgeDesc || "",
      cachedAt: Date.now(),
    };

    return this._put("coinMetadata", record);
  }

  /**
   * Retrieve the metadata record for a coin type.
   * @param {string} catalogId
   * @returns {Promise<Object|null>}
   */
  async getMetadata(catalogId) {
    if (!catalogId || !(await this._ensureDb())) return null;
    return this._get("coinMetadata", catalogId);
  }

  /**
   * Remove a single image record.
   * @param {string} catalogId
   * @returns {Promise<boolean>}
   */
  async deleteImages(catalogId) {
    if (!catalogId || !(await this._ensureDb())) return false;
    return this._delete("coinImages", catalogId);
  }

  /**
   * Delete cached metadata for a catalog ID.
   * @param {string} catalogId
   * @returns {Promise<boolean>}
   */
  async deleteMetadata(catalogId) {
    if (!catalogId || !(await this._ensureDb())) return false;
    return this._delete("coinMetadata", catalogId);
  }

  // ---------------------------------------------------------------------------
  // Export / Import (for ZIP backup — STACK-88)
  // ---------------------------------------------------------------------------

  /**
   * Export all metadata records for backup.
   * @returns {Promise<Array>}
   */
  async exportAllMetadata() {
    if (!(await this._ensureDb())) return [];
    return this._getAll("coinMetadata");
  }

  /**
   * Import a single metadata record (from ZIP restore).
   * @param {Object} record - Metadata record with catalogId key
   * @returns {Promise<boolean>}
   */
  async importMetadataRecord(record) {
    if (!record?.catalogId || !(await this._ensureDb())) return false;
    return this._put("coinMetadata", record);
  }

  /**
   * Clear both object stores.
   * @returns {Promise<boolean>}
   */
  async clearAll() {
    if (!(await this._ensureDb())) return false;

    try {
      const stores = ["coinImages", "coinMetadata"];
      if (this._db.objectStoreNames.contains("userImages")) stores.push("userImages");
      if (this._db.objectStoreNames.contains("patternImages")) stores.push("patternImages");
      const tx = this._db.transaction(stores, "readwrite");
      for (const s of stores) tx.objectStore(s).clear();
      await this._txComplete(tx);
      debugLog("ImageCache: cleared all stores");
      return true;
    } catch (err) {
      console.warn("ImageCache: clearAll failed", err);
      return false;
    }
  }

  /**
   * Calculate current storage usage across all stores.
   * @returns {Promise<{count: number, totalBytes: number, limitBytes: number, metadataCount: number, userImageCount: number, patternImageCount: number, numistaCount: number, numistaBytes: number, userImageBytes: number, patternImageBytes: number, metadataBytes: number}>}
   */
  async getStorageUsage() {
    const result = {
      count: 0,
      totalBytes: 0,
      numistaBytes: 0,
      userImageBytes: 0,
      patternImageBytes: 0,
      metadataBytes: 0,
      metadataCount: 0,
      userImageCount: 0,
      patternImageCount: 0,
      numistaCount: 0,
      limitBytes: this._quotaBytes,
    };
    if (!(await this._ensureDb())) return result;

    try {
      if (this._db.objectStoreNames.contains("coinImages")) {
        await this._iterate("coinImages", (rec) => {
          result.count++;
          result.numistaCount++;
          result.numistaBytes += rec.size || 0;
          result.totalBytes += rec.size || 0;
        });
      }
    } catch (err) {
      debugLog("[ImageCache] Failed to iterate store: " + err.message, "warn");
    }

    try {
      if (this._db.objectStoreNames.contains("coinMetadata")) {
        await this._iterate("coinMetadata", (rec) => {
          const metaSize = JSON.stringify(rec).length;
          result.metadataCount++;
          result.metadataBytes += metaSize;
          result.totalBytes += metaSize;
        });
      }
    } catch (err) {
      debugLog("[ImageCache] Failed to iterate store: " + err.message, "warn");
    }

    try {
      if (this._db.objectStoreNames.contains("userImages")) {
        await this._iterate("userImages", (rec) => {
          result.userImageCount++;
          result.userImageBytes += rec.size || 0;
          result.totalBytes += rec.size || 0;
        });
      }
    } catch (err) {
      debugLog("[ImageCache] Failed to iterate store: " + err.message, "warn");
    }

    try {
      if (this._db.objectStoreNames.contains("patternImages")) {
        await this._iterate("patternImages", (rec) => {
          result.patternImageCount++;
          result.patternImageBytes += rec.size || 0;
          result.totalBytes += rec.size || 0;
        });
      }
    } catch (err) {
      debugLog("[ImageCache] Failed to iterate store: " + err.message, "warn");
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Image resolution cascade (STACK-32)
  // ---------------------------------------------------------------------------

  /**
   * Resolve the best available image for an inventory item.
   * Cascade: user upload → pattern image → null.
   *
   * @param {Object} item - Inventory item with uuid, numistaId, name, metal, type fields
   * @returns {Promise<{catalogId: string, source: 'user'|'pattern'}|null>}
   */
  async resolveImageForItem(item) {
    if (!item || !(await this._ensureDb())) return null;

    // Helper: check user-uploaded image (by UUID in userImages store)
    const _checkUserImage = async () => {
      if (!item.uuid || !this._db.objectStoreNames.contains("userImages")) return null;
      const userRec = await this._get("userImages", item.uuid);
      if (userRec?.obverse?.size > 0) {
        return { catalogId: item.uuid, source: "user" };
      }
      return null;
    };

    // Helper: check pattern images store for a matching rule
    const _checkPatternImage = async () => {
      if (item.ignorePatternImages) return null;
      if (typeof NumistaLookup === "undefined") return null;
      const match = NumistaLookup.matchQuery(item.name || "");
      if (!match?.rule?.seedImageId) return null;
      const ruleImageId = match.rule.seedImageId;
      if (this._db.objectStoreNames.contains("patternImages")) {
        const rec = await this._get("patternImages", ruleImageId);
        if (rec?.obverse?.size > 0) {
          return { catalogId: ruleImageId, source: "pattern" };
        }
      }
      return null;
    };

    const user = await _checkUserImage();
    if (user) return user;
    const pattern = await _checkPatternImage();
    if (pattern) return pattern;
    return null;
  }

  /**
   * Resolves and returns an object URL for the best available image side.
   * Per-side cascade: user upload for this side → pattern image for this side → null.
   * This allows mixed sources (e.g. user obverse + pattern reverse).
   *
   * @param {Object} item - Inventory item with uuid/numistaId/name metadata
   * @param {'obverse'|'reverse'} [side='obverse']
   * @returns {Promise<string|null>} Object URL (caller must revoke) or null
   */
  async resolveImageUrlForItem(item, side = "obverse") {
    if (!item || !(await this._ensureDb())) return null;
    const normalizedSide = side === "reverse" ? "reverse" : "obverse";

    // 1. Try user-uploaded image for this specific side
    if (item.uuid) {
      const userUrl = await this.getUserImageUrl(item.uuid, normalizedSide);
      if (userUrl) return userUrl;
    }

    // 2. Try pattern image for this specific side (unless ignored)
    if (!item.ignorePatternImages) {
      if (typeof NumistaLookup !== "undefined") {
        const match = NumistaLookup.matchQuery(item.name || "");
        if (match?.rule?.seedImageId) {
          const patternUrl = await this.getPatternImageUrl(match.rule.seedImageId, normalizedSide);
          if (patternUrl) return patternUrl;
        }
      }
    }

    return null;
  }

  /**
   * Get a user-uploaded image as an object URL.
   * Caller must revoke the URL when done.
   * @param {string} uuid - Item UUID
   * @param {'obverse'|'reverse'} [side='obverse']
   * @returns {Promise<string|null>}
   */
  async getUserImageUrl(uuid, side = "obverse") {
    if (!uuid || !(await this._ensureDb())) return null;
    if (!this._db.objectStoreNames.contains("userImages")) return null;
    const rec = await this._get("userImages", uuid);
    const blob = rec?.[side];
    if (!blob || blob.size === 0) return null;
    return URL.createObjectURL(blob);
  }

  // ---------------------------------------------------------------------------
  // User image CRUD (STACK-32)
  // ---------------------------------------------------------------------------

  /**
   * Pressure band for current user-image storage usage (STRK-146).
   * @param {number} used - bytes used by user images
   * @param {number} limit - soft quota in bytes (`_quotaBytes`)
   * @returns {'ok'|'warn'|'critical'}
   */
  _pressureLevel(used, limit) {
    if (!limit || limit <= 0) return "ok";
    const p = used / limit;
    if (p >= 0.95) return "critical";
    if (p >= 0.85) return "warn";
    return "ok";
  }

  /**
   * Surface a storage message to the user via the global toast, falling back to
   * the console when toast UI is unavailable (e.g. headless contexts). STRK-146.
   * @param {string} message
   * @param {number} [duration=6000]
   */
  _emitStorageToast(message, duration = 6000) {
    if (typeof showToast === "function") showToast(message, duration);
    else console.warn("ImageCache:", message);
  }

  /** @returns {boolean} true if the error is an IndexedDB quota-exceeded error (STRK-146) */
  static _isQuotaError(err) {
    return err?.name === "QuotaExceededError" || err?.name === "NS_ERROR_DOM_INDEXEDDB_QUOTA_ERR";
  }

  /** @returns {number} byte size of a blob or sized record, 0 when absent (STRK-146) */
  _blobSize(blob) {
    return blob?.size || 0;
  }

  /**
   * Ensure the DB is open and the `userImages` store exists, with one defensive
   * re-init in case the v2 upgrade didn't complete. STRK-146.
   * @returns {Promise<boolean>}
   */
  async _ensureUserImagesWritable() {
    if (!(await this._ensureDb())) {
      // Defensive retry: re-open DB in case v2 upgrade didn't complete
      this._db = null;
      this._available = false;
      if (!(await this.init())) return false;
    }
    return this._db.objectStoreNames.contains("userImages");
  }

  /**
   * Stored byte size of a userImages record, falling back to summing its blob
   * sizes for legacy records written before the `size` field existed. STRK-146.
   * @returns {number}
   */
  _recordSize(rec) {
    if (!rec) return 0;
    return rec.size ?? this._blobSize(rec.obverse) + this._blobSize(rec.reverse);
  }

  /**
   * Total bytes used by the `userImages` store only — a single-store cursor scan,
   * far lighter than getStorageUsage() which walks every store. STRK-146.
   * @returns {Promise<number>}
   */
  async _userImagesBytes() {
    let total = 0;
    try {
      await this._iterate("userImages", (rec) => {
        total += this._recordSize(rec);
      });
    } catch {
      /* leave 0 on failure */
    }
    return total;
  }

  /**
   * Amortized O(1) accessor for the `userImages` byte total (STRK-162). Returns
   * the cached value, computing it once via {@link _userImagesBytes} when cold.
   * The pre-flight quota check reads this instead of scanning on every save;
   * `cacheUserImageResult` keeps it warm on success and the mutation paths
   * (`deleteUserImage`/`clearAll`/`importUserImageRecord`) invalidate it to `null`.
   * @returns {Promise<number>}
   */
  async _cachedUserImagesBytes() {
    if (this._userImagesBytesCache === null) {
      this._userImagesBytesCache = await this._userImagesBytes();
    }
    return this._userImagesBytesCache;
  }

  /**
   * Store a user-uploaded image for an inventory item, reporting the outcome.
   * Enforces a pre-flight soft-cap check against `_quotaBytes` so a doomed write
   * is refused (and reported) rather than failing silently — works even on
   * `file://`, where the browser storage estimate is unavailable (STRK-146).
   * @param {string} uuid - Item UUID
   * @param {Blob} obverse - Processed obverse image blob
   * @param {Blob} [reverse] - Optional reverse image blob
   * @param {string|null} [sharedImageId] - Source item UUID if copied; null for originals
   * @returns {Promise<{ok: boolean, quotaExceeded: boolean, usageBytes?: number, limitBytes?: number}>}
   */
  async cacheUserImageResult(uuid, obverse, reverse = null, sharedImageId = null) {
    if (!uuid || (!obverse && !reverse)) {
      debugLog("ImageCache.cacheUserImageResult: missing uuid or at least one image blob");
      return { ok: false, quotaExceeded: false };
    }
    if (!(await this._ensureUserImagesWritable())) {
      debugLog("ImageCache.cacheUserImageResult: userImages store unavailable");
      return { ok: false, quotaExceeded: false };
    }

    const size = this._blobSize(obverse) + this._blobSize(reverse);
    // Net delta vs any existing record for this uuid — an in-place replace that
    // shrinks the record must never trip the cap. _recordSize falls back to blob
    // sizes for legacy records that predate the `size` field, so a replace is not
    // mis-counted as entirely new data.
    const existing = await this._get("userImages", uuid);
    const delta = size - this._recordSize(existing);
    const used = await this._cachedUserImagesBytes();
    const limit = this._quotaBytes;

    // Pre-flight soft-cap guard: refuse a write that would overflow our quota.
    if (delta > 0 && used + delta > limit) {
      debugLog(
        `ImageCache.cacheUserImageResult: pre-flight quota block uuid=${uuid} used=${used} delta=${delta} limit=${limit}`
      );
      return { ok: false, quotaExceeded: true, usageBytes: used, limitBytes: limit };
    }

    const record = {
      uuid,
      obverse,
      reverse: reverse || null,
      sharedImageId: sharedImageId || null,
      cachedAt: Date.now(),
      size,
    };

    let quotaErr = false;
    const ok = await this._put("userImages", record, (err) => {
      quotaErr = ImageCache._isQuotaError(err);
    });
    debugLog(`ImageCache.cacheUserImageResult: uuid=${uuid} size=${size} saved=${ok}`);
    return {
      ok,
      quotaExceeded: !ok && quotaErr,
      usageBytes: ok ? used + delta : used,
      limitBytes: limit,
    };
  }

  /**
   * Backward-compatible boolean wrapper around {@link cacheUserImageResult}.
   * Silent — used by background/non-interactive callers (split-clone copy,
   * shrinking re-saves). Interactive upload paths should call
   * {@link cacheUserImageWithFeedback}. STRK-146.
   * @returns {Promise<boolean>}
   */
  async cacheUserImage(uuid, obverse, reverse = null, sharedImageId = null) {
    return (await this.cacheUserImageResult(uuid, obverse, reverse, sharedImageId)).ok;
  }

  /**
   * Store a user image for an INTERACTIVE upload and surface the outcome: an
   * explicit error toast when the save is refused/fails, and a throttled warning
   * toast when an accepted save crosses a storage pressure band. STRK-146.
   * @param {string} uuid
   * @param {Blob} obverse
   * @param {Blob} [reverse]
   * @param {string|null} [sharedImageId]
   * @returns {Promise<boolean>} true if the image was saved
   */
  async cacheUserImageWithFeedback(uuid, obverse, reverse = null, sharedImageId = null) {
    const res = await this.cacheUserImageResult(uuid, obverse, reverse, sharedImageId);
    if (!res.ok) {
      this._emitStorageToast(
        res.quotaExceeded
          ? "Storage full — image not saved. Free up space (remove unused images) and try again."
          : "Couldn't save image. Please try again."
      );
      return false;
    }
    // Escalation-only warning: toast only when the band rises. Storing the
    // current band means dropping back down re-arms a future warning.
    const level = this._pressureLevel(res.usageBytes, res.limitBytes);
    const bands = { ok: 0, warn: 1, critical: 2 };
    if (bands[level] > bands[this._lastWarnedLevel || "ok"]) {
      const pct = Math.round((res.usageBytes / res.limitBytes) * 100);
      this._emitStorageToast(
        level === "critical"
          ? `Image storage ${pct}% full — saves may start failing. Remove unused images soon.`
          : `Image storage ${pct}% full — consider removing unused images.`
      );
    }
    this._lastWarnedLevel = level;
    return true;
  }

  /**
   * Retrieve a user-uploaded image record.
   * @param {string} uuid - Item UUID
   * @returns {Promise<Object|null>}
   */
  async getUserImage(uuid) {
    if (!uuid || !(await this._ensureDb())) return null;
    if (!this._db.objectStoreNames.contains("userImages")) return null;
    return this._get("userImages", uuid);
  }

  /**
   * Delete a user-uploaded image.
   * @param {string} uuid - Item UUID
   * @returns {Promise<boolean>}
   */
  async deleteUserImage(uuid) {
    if (!uuid || !(await this._ensureDb())) return false;
    if (!this._db.objectStoreNames.contains("userImages")) return false;
    return this._delete("userImages", uuid);
  }

  /**
   * Export all user images for backup.
   * @returns {Promise<Array>}
   */
  async exportAllUserImages() {
    if (!(await this._ensureDb())) return [];
    if (!this._db.objectStoreNames.contains("userImages")) return [];
    return this._getAll("userImages");
  }

  /**
   * Import a single user image record (from ZIP restore).
   * @param {Object} record - User image record with uuid key
   * @returns {Promise<boolean>}
   */
  async importUserImageRecord(record) {
    if (!record?.uuid || !(await this._ensureDb())) return false;
    if (!this._db.objectStoreNames.contains("userImages")) return false;
    return this._put("userImages", record);
  }

  // ---------------------------------------------------------------------------
  // Pattern image CRUD (user pattern image rules)
  // ---------------------------------------------------------------------------

  /**
   * Store pattern rule images (obverse/reverse blobs).
   * @param {string} ruleId - Pattern rule ID
   * @param {Blob|null} obverseBlob
   * @param {Blob|null} reverseBlob
   * @returns {Promise<boolean>}
   */
  async cachePatternImage(ruleId, obverseBlob, reverseBlob) {
    if (!ruleId || !(await this._ensureDb())) return false;
    if (!this._db.objectStoreNames.contains("patternImages")) return false;

    const size = (obverseBlob?.size || 0) + (reverseBlob?.size || 0);
    const record = {
      ruleId,
      obverse: obverseBlob || null,
      reverse: reverseBlob || null,
      cachedAt: Date.now(),
      size,
    };
    return this._put("patternImages", record);
  }

  /**
   * Retrieve a pattern image record by rule ID.
   * @param {string} ruleId
   * @returns {Promise<Object|null>}
   */
  async getPatternImage(ruleId) {
    if (!ruleId || !(await this._ensureDb())) return null;
    if (!this._db.objectStoreNames.contains("patternImages")) return null;
    return this._get("patternImages", ruleId);
  }

  /**
   * Get a pattern image as an object URL.
   * Caller must revoke the URL when done.
   * @param {string} ruleId
   * @param {'obverse'|'reverse'} [side='obverse']
   * @returns {Promise<string|null>}
   */
  async getPatternImageUrl(ruleId, side = "obverse") {
    const rec = await this.getPatternImage(ruleId);
    const blob = rec?.[side];
    if (!blob || blob.size === 0) return null;
    return URL.createObjectURL(blob);
  }

  /**
   * Delete a pattern image record.
   * @param {string} ruleId
   * @returns {Promise<boolean>}
   */
  async deletePatternImage(ruleId) {
    if (!ruleId || !(await this._ensureDb())) return false;
    if (!this._db.objectStoreNames.contains("patternImages")) return false;
    return this._delete("patternImages", ruleId);
  }

  /**
   * Export all pattern image records for backup.
   * @returns {Promise<Array>}
   */
  async exportAllPatternImages() {
    if (!(await this._ensureDb())) return [];
    if (!this._db.objectStoreNames.contains("patternImages")) return [];
    return this._getAll("patternImages");
  }

  /**
   * Import a single pattern image record (from ZIP restore).
   * @param {Object} record - Pattern image record with ruleId key
   * @returns {Promise<boolean>}
   */
  async importPatternImageRecord(record) {
    if (!record?.ruleId || !(await this._ensureDb())) return false;
    if (!this._db.objectStoreNames.contains("patternImages")) return false;
    return this._put("patternImages", record);
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  /**
   * Check whether a string looks like a usable image URL.
   * Rejects corrupted URLs that have had special characters stripped.
   * @param {string} url
   * @returns {boolean}
   */
  static isValidImageUrl(url) {
    if (!url || typeof url !== "string") return false;
    return /^https?:\/\/.+\..+/i.test(url);
  }

  // ---------------------------------------------------------------------------
  // Image pipeline (private)
  // ---------------------------------------------------------------------------

  /**
   * Resize and compress an image source using ImageProcessor (STACK-95).
   * Falls back to inline Canvas JPEG if ImageProcessor is unavailable.
   * @param {ImageBitmap|HTMLImageElement} source
   * @returns {Promise<Blob|null>}
   */
  async _resizeAndCompress(source) {
    // Delegate to ImageProcessor when available
    if (typeof imageProcessor !== "undefined") {
      try {
        // Convert source to blob first so ImageProcessor can handle it
        const canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        canvas.getContext("2d").drawImage(source, 0, 0);
        const srcBlob = await new Promise((resolve) => {
          canvas.toBlob((b) => resolve(b), "image/png");
        });
        if (!srcBlob) return null;
        const result = await imageProcessor.processFile(srcBlob, {
          maxDim: this._maxDim,
          quality: this._quality,
        });
        return result?.blob || null;
      } catch (err) {
        debugLog("[ImageCache] WebP encode failed, using JPEG fallback: " + err.message, "info");
        // Fall through to legacy path
      }
    }

    // Legacy fallback: inline Canvas JPEG resize
    let width = source.width;
    let height = source.height;
    const scale = Math.min(this._maxDim / width, this._maxDim / height, 1);
    width = Math.round(width * scale);
    height = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(source, 0, 0, width, height);

    try {
      return await new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
          "image/jpeg",
          this._quality
        );
      });
    } catch (err) {
      debugLog("[ImageCache] Canvas resize failed: " + err.message, "warn");
      return null;
    }
  }

  /**
   * Try to get a raw blob for a URL without canvas processing.
   * Falls back to no-cors fetch (opaque blob — still displayable via object URL).
   * @param {string} url
   * @returns {Promise<Blob|null>}
   */
  async _fetchBlobDirect(url) {
    // Try standard fetch first
    try {
      const resp = await fetch(url);
      if (resp.ok) return await resp.blob();
    } catch (err) {
      debugLog("[ImageCache] CORS fetch attempt failed for " + url + ": " + err.message, "info");
    }

    // Try no-cors fetch — only accept non-opaque blobs (opaque blobs report
    // size === 0 and lose their data during IDB structured clone round-trips)
    try {
      const resp = await fetch(url, { mode: "no-cors" });
      const blob = await resp.blob();
      if (blob && blob.size > 0) return blob;
    } catch (err) {
      debugLog("[ImageCache] no-cors fetch attempt failed for " + url + ": " + err.message, "info");
    }

    return null;
  }

  /**
   * Load an image via HTMLImageElement.
   * @param {string} url
   * @param {boolean} [useCors=false] - Whether to set crossOrigin='anonymous'
   * @returns {Promise<ImageBitmap>}
   */
  _loadImageElement(url, useCors = false) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (useCors) img.crossOrigin = "anonymous";
      img.onload = () => {
        createImageBitmap(img).then(resolve).catch(reject);
      };
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = url;
    });
  }

  // ---------------------------------------------------------------------------
  // IndexedDB helpers (private)
  // ---------------------------------------------------------------------------

  /**
   * @param {string} storeName
   * @param {Object} record
   * @param {(err: any) => void} [onError] - Invoked with the raw error on failure (STRK-146)
   * @returns {Promise<boolean>}
   */
  async _put(storeName, record, onError) {
    try {
      const tx = this._db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(record);
      await this._txComplete(tx);
      return true;
    } catch (err) {
      const isQuota = ImageCache._isQuotaError(err);
      console.warn(
        `ImageCache: put to ${storeName} failed${isQuota ? " (quota exceeded)" : ""}`,
        err
      );
      if (typeof onError === "function") onError(err);
      return false;
    }
  }

  /** @returns {Promise<Object|null>} */
  _get(storeName, key) {
    return new Promise((resolve) => {
      try {
        const tx = this._db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Iterate over all records in a store using a cursor to minimize memory usage.
   * O(1) heap relative to store size — avoids loading all records at once.
   * @param {string} storeName
   * @param {function(any): void} callback
   * @returns {Promise<void>}
   */
  _iterate(storeName, callback) {
    return new Promise((resolve, reject) => {
      try {
        const tx = this._db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            callback(cursor.value);
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /** @returns {Promise<Array>} */
  _getAll(storeName) {
    return new Promise((resolve) => {
      try {
        const tx = this._db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  /** @returns {Promise<boolean>} */
  async _delete(storeName, key) {
    try {
      const tx = this._db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
      await this._txComplete(tx);
      return true;
    } catch {
      return false;
    }
  }

  /** Wait for a transaction to complete. */
  _txComplete(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}

// Singleton instance exposed globally
const imageCache = new ImageCache();
if (typeof window !== "undefined") {
  window.imageCache = imageCache;
}

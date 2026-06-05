// HISTORY STORE — IndexedDB storage for market histories (STRK-141)
// =============================================================================

/**
 * HistoryStore provides persistent IndexedDB storage for the API-reproducible
 * market-history caches (spot price history, retail price history) that
 * previously lived in localStorage and pushed it past its ~5–10 MB ceiling.
 *
 * Records are coarse-grained: one record per logical history key, storing the
 * whole history as UNCOMPRESSED JSON (LZ compression was a localStorage-ceiling
 * workaround — pointless at IndexedDB's ~4 GB headroom).
 *
 * Schema:
 *   DB: StakTrakrHistory v1
 *   Store "histories" — keyPath: "key"
 *     Record: { key: string, data: any, updatedAt: number }
 *
 * Backend-only: knows nothing about spot/retail semantics, performs no
 * rendering, and makes no top-level DOM access (load-order-safe).
 *
 * Mirrors the established IndexedDB pattern in ImageCache / AttachmentManager.
 *
 * @class
 */
class HistoryStore {
  constructor() {
    /** @type {IDBDatabase|null} */
    this._db = null;
    /** @type {boolean} */
    this._available = false;
    /** @type {number} Default storage quota estimate in bytes (updated async) */
    this._quotaBytes = 4 * 1024 * 1024 * 1024; // 4 GB default; updated async
    /** @type {string} */
    this._dbName = "StakTrakrHistory";
    /** @type {string} */
    this._storeName = "histories";
    /** @type {Array<string>} Logical keys eligible for the boot migration */
    this._migrationKeys = ["metalSpotHistory", "v2RetailHistory"];
    /** @type {string} */
    this._migrationFlag = "migration_idb_history_v1";
  }

  async _initQuota() {
    try {
      if (!navigator?.storage?.estimate) return;
      const { quota = 0, usage = 0 } = await navigator.storage.estimate();
      const available = quota - usage;
      if (available <= 0) return; // file:// or estimate unavailable
      this._quotaBytes = Math.min(
        Math.max(available * 0.6, Math.min(available, 500 * 1024 * 1024)),
        4 * 1024 * 1024 * 1024
      );
    } catch {
      // Leave at 4 GB default
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
      console.warn("HistoryStore: IndexedDB not available");
      this._available = false;
      return false;
    }

    try {
      this._db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(this._dbName, 1);

        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains("histories")) {
            db.createObjectStore("histories", { keyPath: "key" });
          }
        };

        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
      });

      // Detect browser-initiated connection closure
      this._db.onclose = () => {
        console.warn("HistoryStore: DB connection closed by browser");
        this._db = null;
        this._available = false;
      };

      this._available = true;
      this._initQuota(); // non-blocking, updates _quotaBytes async
      this._requestStoragePersistOnce(); // one-time persistent-storage request
      return true;
    } catch (err) {
      console.warn("HistoryStore: failed to open DB", err);
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
   * Call before every public operation to guard against browser-initiated
   * connection closures (storage pressure, tab backgrounding, etc.).
   * @returns {Promise<boolean>}
   */
  async _ensureDb() {
    if (this._db) {
      try {
        // Lightweight probe — creating a transaction throws if the conn is dead
        this._db.transaction("histories", "readonly");
        return true;
      } catch {
        console.warn("HistoryStore: DB connection stale, reconnecting...");
        this._db = null;
        this._available = false;
      }
    }
    return this.init();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Read the `data` field of the record stored under a logical key.
   * @param {string} key - logical history key (e.g. "metalSpotHistory")
   * @returns {Promise<any|null>} the stored data, or null if absent/unavailable
   */
  async get(key) {
    if (!key || !(await this._ensureDb())) return null;
    const rec = await this._get("histories", key);
    return rec ? rec.data : null;
  }

  /**
   * Write a history blob under a logical key as { key, data, updatedAt }.
   * Stores UNCOMPRESSED JSON. Catches QuotaExceededError /
   * NS_ERROR_DOM_INDEXEDDB_QUOTA_ERR and returns false instead of throwing,
   * so callers can fall back to localStorage without their in-memory copy
   * being disturbed.
   * @param {string} key
   * @param {any} data
   * @returns {Promise<boolean>} true if the write was confirmed
   */
  async put(key, data) {
    if (!key || !(await this._ensureDb())) return false;

    const record = { key, data, updatedAt: Date.now() };

    try {
      const tx = this._db.transaction("histories", "readwrite");
      tx.objectStore("histories").put(record);
      await this._txComplete(tx);
      return true;
    } catch (err) {
      if (err?.name === "QuotaExceededError" || err?.name === "NS_ERROR_DOM_INDEXEDDB_QUOTA_ERR") {
        console.warn("HistoryStore: quota exceeded, history not stored", key);
      } else {
        console.warn("HistoryStore: put failed", key, err);
      }
      return false;
    }
  }

  /**
   * Remove the record for a logical key.
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async remove(key) {
    if (!key || !(await this._ensureDb())) return false;
    return this._delete("histories", key);
  }

  /**
   * Report history storage usage for the settings panel.
   * @returns {Promise<{count: number, bytesEstimate: number}>}
   */
  async getUsage() {
    const result = { count: 0, bytesEstimate: 0 };
    if (!(await this._ensureDb())) return result;

    try {
      await this._iterate("histories", (rec) => {
        result.count++;
        try {
          result.bytesEstimate += JSON.stringify(rec.data).length;
        } catch {
          // Non-serializable record — skip its byte contribution.
        }
      });
    } catch (err) {
      console.warn("HistoryStore: getUsage iterate failed", err);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Migration (one-time, idempotent — modeled on __migrateCompressionV2)
  // ---------------------------------------------------------------------------

  /**
   * One-time, idempotent boot migration of legacy localStorage history payloads
   * into IndexedDB. Safe-by-construction:
   *   - Guarded by the "migration_idb_history_v1" localStorage flag — a no-op
   *     once set.
   *   - For each logical key: decode (CMP2:/CMP1: aware) → JSON.parse →
   *     shape-guard. On parse error / wrong shape, the key is DEFERRED (its
   *     localStorage copy is left untouched) and the flag is NOT set.
   *   - A legacy localStorage copy is deleted ONLY after its put() is confirmed
   *     (returns true). A failed/false put DEFERS the key and keeps the LS copy.
   *   - The flag is set ONLY when every present key migrated with no deferrals,
   *     so a partial failure retries on the next boot.
   *
   * @returns {Promise<{migrated: string[], deferred: string[]}>}
   */
  async migrate() {
    const migrated = [];
    const deferred = [];

    // Guard: never run if the idempotency flag is set.
    try {
      if (typeof localStorage === "undefined") return { migrated, deferred };
      if (localStorage.getItem(this._migrationFlag) === "true") {
        return { migrated, deferred };
      }
    } catch {
      return { migrated, deferred };
    }

    // Without a working IDB backend there is no destination — defer everything,
    // leave every LS copy, and do not set the flag (retry next boot). (R3)
    if (!(await this._ensureDb())) {
      return { migrated, deferred };
    }

    for (const key of this._migrationKeys) {
      let raw;
      try {
        raw = localStorage.getItem(key);
      } catch {
        continue; // unreadable — treat as absent
      }
      if (raw === null || typeof raw !== "string") continue; // absent — skip

      // Decode any Phase-1 CMP2:/CMP1: payload, then parse + shape-guard.
      let parsed;
      try {
        const decoded =
          typeof __decompressIfNeeded === "function" ? __decompressIfNeeded(raw) : raw;
        parsed = JSON.parse(decoded);
      } catch {
        deferred.push(key); // corrupt/unparseable — keep LS copy, don't flag
        continue;
      }

      if (!this._isValidShape(key, parsed)) {
        deferred.push(key); // wrong shape — keep LS copy, don't flag
        continue;
      }

      // Write to IDB; only delete the legacy LS copy on a CONFIRMED put.
      const ok = await this.put(key, parsed);
      if (!ok) {
        deferred.push(key); // write not confirmed — keep LS copy, don't flag
        continue;
      }

      try {
        localStorage.removeItem(key);
      } catch {
        // The data is durable in IDB; a failed removeItem is non-fatal and is
        // harmless to retry (next boot's flag guard short-circuits the rest).
      }
      migrated.push(key);
    }

    // Set the idempotency flag ONLY when nothing was deferred.
    if (deferred.length === 0) {
      try {
        localStorage.setItem(this._migrationFlag, "true");
      } catch {
        /* ignore */
      }
    }

    return { migrated, deferred };
  }

  /**
   * Shape guard for a migrated payload (matches the existing load-path type
   * guards): spot history must be an Array; retail history must be a non-array
   * object.
   * @param {string} key
   * @param {any} parsed
   * @returns {boolean}
   */
  _isValidShape(key, parsed) {
    if (key === "metalSpotHistory") {
      return Array.isArray(parsed);
    }
    if (key === "v2RetailHistory") {
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
    }
    // Unknown key — accept any defined value.
    return parsed !== null && parsed !== undefined;
  }

  // ---------------------------------------------------------------------------
  // IndexedDB helpers (private)
  // ---------------------------------------------------------------------------

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
   * Iterate over all records in a store using a cursor (O(1) heap).
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

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Request persistent storage once per device (same gate as the image/attachment paths). */
  _requestStoragePersistOnce() {
    const key =
      typeof STORAGE_PERSIST_GRANTED_KEY !== "undefined"
        ? STORAGE_PERSIST_GRANTED_KEY
        : "storagePersistGranted";
    try {
      if (localStorage.getItem(key) !== null) return;
    } catch {
      return;
    }
    if (!navigator?.storage?.persist) {
      try {
        localStorage.setItem(key, "false");
      } catch {
        /* ignore */
      }
      return;
    }
    navigator.storage
      .persist()
      .then((granted) => localStorage.setItem(key, granted ? "true" : "false"))
      .catch(() => {
        try {
          localStorage.setItem(key, "false");
        } catch {
          /* ignore */
        }
      });
  }
}

// Singleton instance exposed globally
const historyStore = new HistoryStore();
if (typeof window !== "undefined") {
  window.historyStore = historyStore;
}

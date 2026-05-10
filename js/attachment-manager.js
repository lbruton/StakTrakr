// ATTACHMENT MANAGER — IndexedDB storage for per-item file attachments (STRK-45)
// =============================================================================

/**
 * AttachmentManager provides persistent IndexedDB storage for per-item
 * file attachments (PDFs, images) attached to inventory items.
 *
 * Schema:
 *   DB: StakTrakrAttachments v1
 *   Store "userAttachments" — keyPath: attachmentUuid
 *                             index  : itemUuid (non-unique)
 *
 * @class
 */
class AttachmentManager {
  constructor() {
    /** @type {IDBDatabase|null} */
    this._db = null;
    /** @type {boolean} */
    this._available = false;
    /** @type {number} Default storage quota estimate in bytes */
    this._quotaBytes = 4 * 1024 * 1024 * 1024; // 4 GB default; updated async
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
      console.warn("AttachmentManager: IndexedDB not available");
      return false;
    }

    try {
      this._db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("StakTrakrAttachments", 1);

        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains("userAttachments")) {
            const store = db.createObjectStore("userAttachments", {
              keyPath: "attachmentUuid",
            });
            store.createIndex("itemUuid", "itemUuid", { unique: false });
          }
        };

        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
      });

      this._db.onclose = () => {
        console.warn("AttachmentManager: DB connection closed by browser");
        this._db = null;
        this._available = false;
      };

      this._available = true;
      this._initQuota(); // non-blocking
      return true;
    } catch (err) {
      console.warn("AttachmentManager: failed to open DB", err);
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
   * @returns {Promise<boolean>}
   */
  async _ensureDb() {
    if (this._db) {
      try {
        this._db.transaction("userAttachments", "readonly");
        return true;
      } catch {
        console.warn("AttachmentManager: DB connection stale, reconnecting...");
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
   * Store an attachment binary in IndexedDB.
   * Triggers the persistent-storage prompt on the first call (once per device).
   * Catches QuotaExceededError — returns false without throwing.
   *
   * @param {import('./types.js').AttachmentRecord} record
   * @returns {Promise<boolean>}
   */
  async addAttachment(record) {
    if (!record?.attachmentUuid || !record.blob || !(await this._ensureDb())) return false;

    this._requestStoragePersistOnce();

    try {
      const tx = this._db.transaction("userAttachments", "readwrite");
      tx.objectStore("userAttachments").put(record);
      await this._txComplete(tx);
      return true;
    } catch (err) {
      if (err?.name === "QuotaExceededError" || err?.name === "NS_ERROR_DOM_INDEXEDDB_QUOTA_ERR") {
        console.warn("AttachmentManager: quota exceeded, attachment not stored");
      } else {
        console.warn("AttachmentManager: addAttachment failed", err);
      }
      return false;
    }
  }

  /**
   * Retrieve a single attachment record (including the Blob).
   * @param {string} uuid - attachmentUuid
   * @returns {Promise<import('./types.js').AttachmentRecord|null>}
   */
  async getAttachment(uuid) {
    if (!uuid || !(await this._ensureDb())) return null;
    return this._get("userAttachments", uuid);
  }

  async hasAttachment(uuid) {
    if (!uuid || !(await this._ensureDb())) return false;
    try {
      const tx = this._db.transaction("userAttachments", "readonly");
      const req = tx.objectStore("userAttachments").getKey(uuid);
      return new Promise((resolve) => {
        req.onsuccess = () => resolve(req.result !== undefined);
        req.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  }

  /**
   * Delete a single attachment by its UUID.
   * @param {string} uuid - attachmentUuid
   * @returns {Promise<boolean>}
   */
  async deleteAttachment(uuid) {
    if (!uuid || !(await this._ensureDb())) return false;
    return this._delete("userAttachments", uuid);
  }

  /**
   * Delete all attachments belonging to a given inventory item.
   * Used on item delete to prevent orphan binaries.
   * @param {string} itemUuid
   * @returns {Promise<boolean>}
   */
  async deleteAttachmentsForItem(itemUuid) {
    if (!itemUuid || !(await this._ensureDb())) return false;

    try {
      const tx = this._db.transaction("userAttachments", "readwrite");
      const store = tx.objectStore("userAttachments");
      const index = store.index("itemUuid");
      await new Promise((resolve, reject) => {
        const req = index.openKeyCursor(IDBKeyRange.only(itemUuid));
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            store.delete(cursor.primaryKey);
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error);
      });
      await this._txComplete(tx);
      return true;
    } catch (err) {
      console.warn("AttachmentManager: deleteAttachmentsForItem failed", err);
      return false;
    }
  }

  /**
   * Export all attachment records for backup (includes blobs).
   * @returns {Promise<import('./types.js').AttachmentRecord[]>}
   */
  async exportAllAttachments() {
    if (!(await this._ensureDb())) return [];
    return this._getAll("userAttachments");
  }

  /**
   * Retrieve all attachment records for a given inventory item.
   * @param {string} itemUuid
   * @returns {Promise<import('./types.js').AttachmentRecord[]>}
   */
  async getAttachmentsByItemUuid(itemUuid) {
    if (!itemUuid || !(await this._ensureDb())) return [];

    return new Promise((resolve) => {
      try {
        const tx = this._db.transaction("userAttachments", "readonly");
        const index = tx.objectStore("userAttachments").index("itemUuid");
        const req = index.getAll(IDBKeyRange.only(itemUuid));
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  /**
   * Report attachment storage usage.
   * @returns {Promise<{count: number, totalBytes: number, limitBytes: number}>}
   */
  async getStorageUsage() {
    const result = { count: 0, totalBytes: 0, limitBytes: this._quotaBytes };
    if (!(await this._ensureDb())) return result;

    try {
      await this._iterate("userAttachments", (rec) => {
        result.count++;
        result.totalBytes += rec.size || 0;
      });
    } catch (err) {
      console.warn("AttachmentManager: getStorageUsage iterate failed", err);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // IndexedDB helpers (private)
  // ---------------------------------------------------------------------------

  /** @returns {Promise<boolean>} */
  async _put(storeName, record) {
    try {
      const tx = this._db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(record);
      await this._txComplete(tx);
      return true;
    } catch (err) {
      console.warn(`AttachmentManager: put to ${storeName} failed`, err);
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

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Request persistent storage once per device (same gate as the image upload path). */
  _requestStoragePersistOnce() {
    const key =
      typeof STORAGE_PERSIST_GRANTED_KEY !== "undefined"
        ? STORAGE_PERSIST_GRANTED_KEY
        : "storagePersistGranted";
    if (localStorage.getItem(key) !== null) return;
    if (!navigator?.storage?.persist) {
      localStorage.setItem(key, "false");
      return;
    }
    navigator.storage
      .persist()
      .then((granted) => localStorage.setItem(key, granted ? "true" : "false"))
      .catch(() => localStorage.setItem(key, "false"));
  }
}

// Singleton instance exposed globally
const attachmentManager = new AttachmentManager();
if (typeof window !== "undefined") {
  window.attachmentManager = attachmentManager;
}

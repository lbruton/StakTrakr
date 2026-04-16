// CATALOG MANAGER
/**
 * CatalogManager class for managing catalog mappings between item serials and catalog IDs
 *
 * This is an enhanced implementation that replaces the basic catalogMap object with
 * a robust class providing better data integrity, validation, and future extensibility.
 *
 * Key features:
 * - Data validation and integrity checking
 * - Synchronization between item.numistaId and mapping data
 * - Storage optimization to reduce localStorage footprint
 * - Provider-agnostic architecture for future catalog support
 * - Full backward compatibility with existing data
 */
class CatalogManager {
  /**
   * Removes mappings for serials that no longer exist in inventory.
   * @param {Array} currentInventory - inventory array (objects with serial)
   * @returns {number} count removed
   */
  removeOrphanedMappings(currentInventory = null) {
    try {
      if (!currentInventory && window.inventory) currentInventory = window.inventory;
      const validSerials = new Set((currentInventory || []).map((it) => it.serial));
      const before = Object.keys(this._mappings).length;
      for (const serial of Object.keys(this._mappings)) {
        if (!validSerials.has(serial)) delete this._mappings[serial];
      }
      const removed = before - Object.keys(this._mappings).length;
      if (removed) this._save();
      return removed;
    } catch (e) {
      console.warn("CatalogManager.removeOrphanedMappings error", e);
      return 0;
    }
  }

  /**
   * Deduplicates identical provider mappings across serials (noop-safe).
   * Returns number of entries simplified (kept first occurrence).
   */
  deduplicateMappings() {
    try {
      const seen = new Map();
      let reduced = 0;
      for (const [serial, map] of Object.entries(this._mappings)) {
        const key = JSON.stringify(map);
        if (seen.has(key)) {
          // keep mapping but no special action; placeholder for future cross-ref
          continue;
        }
        seen.set(key, serial);
      }
      // Nothing to change structurally; method kept for API compatibility and metrics
      return reduced;
    } catch (e) {
      console.warn("CatalogManager.deduplicateMappings error", e);
      return 0;
    }
  }

  /**
   * Returns basic storage stats for the catalog mapping blob.
   */
  getStorageStats() {
    try {
      const raw = localStorage.getItem(this.storageKey) || "";
      const bytes = new Blob([raw]).size;
      return {
        key: this.storageKey,
        bytes,
        kb: +(bytes / 1024).toFixed(2),
        entries: Object.keys(this._mappings).length,
      };
    } catch (e) {
      return { key: this.storageKey, bytes: 0, kb: 0, entries: 0 };
    }
  }

  /**
   * Creates a new CatalogManager instance
   *
   * @param {Object} options - Configuration options
   * @param {string} options.storageKey - LocalStorage key for catalog data
   * @param {Function} options.saveCallback - Optional callback when data is saved
   * @param {boolean} options.debug - Enable debug logging
   */
  constructor(options = {}) {
    // Configuration
    this.storageKey = options.storageKey || CATALOG_MAP_KEY;
    this.saveCallback = options.saveCallback || null;
    this.debug = options.debug || DEBUG;

    // Internal state
    this._mappings = {}; // Serial to catalog ID mappings
    this._providers = {
      numista: { prefix: "n", name: "Numista" },
    };
    this._initialized = false;

    // Initialize data from storage
    this._load();
  }

  /**
   * Load mappings from localStorage
   *
   * @private
   */
  _load() {
    try {
      // Load legacy data
      const legacyData = loadDataSync(this.storageKey, {});

      // Initialize with legacy format for backward compatibility
      this._mappings = { ...legacyData };
      this._initialized = true;

      if (this.debug) {
        console.log(`CatalogManager: Loaded ${Object.keys(this._mappings).length} mappings`);
      }
    } catch (error) {
      console.error("CatalogManager: Error loading data", error);
      this._mappings = {};
      this._initialized = true;
    }
  }

  /**
   * Save mappings to localStorage
   *
   * @private
   */
  async _save() {
    try {
      // Save in legacy format for backward compatibility
      await saveData(this.storageKey, this._mappings);

      if (this.saveCallback && typeof this.saveCallback === "function") {
        this.saveCallback();
      }

      if (this.debug) {
        console.log(`CatalogManager: Saved ${Object.keys(this._mappings).length} mappings`);
      }
    } catch (error) {
      console.error("CatalogManager: Error saving data", error);
    }
  }

  /**
   * Validates a catalog ID format
   *
   * @param {string} catalogId - Catalog ID to validate
   * @param {string} [provider='numista'] - Provider key
   * @returns {boolean} True if valid
   */
  validateCatalogId(catalogId, provider = "numista") {
    if (!catalogId) return false;

    // Numista IDs are numeric
    if (provider === "numista") {
      return /^\d+$/.test(catalogId);
    }

    // Generic validation for other providers
    return typeof catalogId === "string" && catalogId.trim().length > 0;
  }

  /**
   * Gets catalog ID for an item serial
   *
   * @param {number|string} serial - Item serial number
   * @param {string} [provider='numista'] - Provider key
   * @returns {string|null} Catalog ID or null if not found
   */
  getCatalogId(serial, provider = "numista") {
    if (!serial) return null;

    // For backward compatibility, directly return the mapping
    const serialKey = String(serial);
    return this._mappings[serialKey] || null;
  }

  /**
   * Sets catalog ID for an item serial
   *
   * @param {number|string} serial - Item serial number
   * @param {string} catalogId - Catalog ID to set
   * @param {string} [provider='numista'] - Provider key
   * @returns {boolean} True if successful
   */
  setCatalogId(serial, catalogId, provider = "numista") {
    if (!serial) return false;

    const serialKey = String(serial);

    // Handle removal case
    if (!catalogId || catalogId === "") {
      delete this._mappings[serialKey];
      this._save();
      return true;
    }

    // Validate the catalog ID
    if (!this.validateCatalogId(catalogId, provider)) {
      console.warn(`CatalogManager: Invalid catalog ID format for ${provider}: ${catalogId}`);
      return false;
    }

    // Store mapping
    this._mappings[serialKey] = catalogId;
    this._save();
    return true;
  }

  /**
   * Gets item serials associated with a catalog ID
   *
   * @param {string} catalogId - Catalog ID to look up
   * @param {string} [provider='numista'] - Provider key
   * @returns {Array<string>} Array of serials (may be empty)
   */
  getSerialsByCatalogId(catalogId, provider = "numista") {
    if (!catalogId) return [];

    return Object.entries(this._mappings)
      .filter(([_, value]) => value === catalogId)
      .map(([serial, _]) => serial);
  }

  /**
   * Synchronizes an inventory item with the catalog mapping
   *
   * @param {Object} item - Inventory item
   * @returns {Object} Updated item
   */
  syncItem(item) {
    if (!item) return item;

    // If item has no serial, can't sync
    if (!item.serial) return item;

    const serialKey = String(item.serial);

    // Case 1: Item has numistaId but no mapping exists
    if (item.numistaId && !this._mappings[serialKey]) {
      this.setCatalogId(serialKey, item.numistaId);
    }
    // Case 2: Item numistaId was never set (null/undefined) but mapping exists — restore it.
    // STAK-302: do NOT restore when numistaId is '' (explicitly cleared by user on save)
    else if (
      (item.numistaId === undefined || item.numistaId === null) &&
      this._mappings[serialKey]
    ) {
      item.numistaId = this._mappings[serialKey];
    }
    // Case 3: Both exist but different - prioritize item.numistaId
    else if (
      item.numistaId &&
      this._mappings[serialKey] &&
      item.numistaId !== this._mappings[serialKey]
    ) {
      this.setCatalogId(serialKey, item.numistaId);
    }

    return item;
  }

  /**
   * Synchronizes all inventory items with catalog mappings
   *
   * @param {Array<Object>} items - Array of inventory items
   * @returns {Array<Object>} Updated items
   */
  syncInventory(items) {
    if (!Array.isArray(items)) return items;

    return items.map((item) => this.syncItem(item));
  }

  /**
   * Removes orphaned mappings that don't correspond to inventory items
   *
   * @param {Array<Object>} inventory - Current inventory items
   * @returns {number} Number of mappings removed
   */
  cleanupOrphans(inventory) {
    if (!Array.isArray(inventory)) return 0;

    const validSerials = new Set(inventory.map((item) => String(item.serial)));
    const orphanedSerials = Object.keys(this._mappings).filter(
      (serial) => !validSerials.has(serial)
    );

    orphanedSerials.forEach((serial) => {
      delete this._mappings[serial];
    });

    if (orphanedSerials.length > 0) {
      this._save();
    }

    return orphanedSerials.length;
  }

  /**
   * Gets serialized export of all mappings for backup
   *
   * @returns {Object} Mappings data
   */
  exportMappings() {
    return { ...this._mappings };
  }

  /**
   * Imports mappings from backup data
   *
   * @param {Object} mappings - Mappings data
   * @param {boolean} [merge=false] - Merge with existing data instead of replacing
   * @returns {number} Number of mappings imported
   */
  importMappings(mappings, merge = false) {
    if (!mappings || typeof mappings !== "object") return 0;

    if (merge) {
      // Merge with existing mappings
      this._mappings = { ...this._mappings, ...mappings };
    } else {
      // Replace all mappings
      this._mappings = { ...mappings };
    }

    this._save();
    return Object.keys(mappings).length;
  }

  /**
   * Gets summary statistics about mappings
   *
   * @returns {Object} Statistics object
   */
  getStats() {
    const totalMappings = Object.keys(this._mappings).length;

    // Count by provider (for future use)
    const providerCounts = { numista: totalMappings };

    return {
      totalMappings,
      providerCounts,
      storageSize: JSON.stringify(this._mappings).length,
    };
  }
}

// Initialize global CatalogManager instance to replace the global catalogMap
const catalogManager = new CatalogManager({
  storageKey: CATALOG_MAP_KEY,
  debug: DEBUG,
  saveCallback: () => {
    if (typeof updateStorageStats === "function") {
      updateStorageStats();
    }
  },
});

// Make accessible globally
window.catalogManager = catalogManager;

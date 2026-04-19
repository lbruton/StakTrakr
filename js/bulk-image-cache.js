/**
 * @fileoverview Bulk metadata sync utilities for Numista-linked inventory items.
 * Exposes the `BulkImageCache` global singleton used by settings-driven cache workflows.
 */

// BULK SYNC (STACK-87/88)
// =============================================================================
// Syncs metadata for inventory items that have Numista catalog IDs.
// Sequential with configurable delay to avoid API rate-limiting.
// Resolves catalog IDs from catalogManager when not directly on items.
// Fetches metadata + image URLs from Numista API, caches metadata to IndexedDB.
// Image caching is handled on-demand by the view modal (viewModal.js).
// =============================================================================

const BulkImageCache = (() => {
  let _aborted = false;
  let _running = false;

  /**
   * Resolves catalog ID for an inventory item.
   * Checks item.numistaId first, then catalogManager mappings.
   * @param {Object} item
   * @returns {string} Catalog ID or empty string
   */
  function resolveCatalogId(item) {
    if (item.numistaId && String(item.numistaId).trim()) {
      return String(item.numistaId).trim();
    }
    // Fall back to catalogManager mapping by serial
    if (item.serial && window.catalogManager) {
      const mapped = catalogManager.getCatalogId(String(item.serial));
      if (mapped && String(mapped).trim()) return String(mapped).trim();
    }
    return "";
  }

  /**
   * Build the list of unique {item, catalogId} entries eligible for caching.
   * @returns {Array.<{item:Object, catalogId:string}>}
   */
  function buildEligibleList() {
    const seen = new Set();
    const list = [];
    for (const item of typeof inventory !== "undefined" ? inventory : []) {
      const catId = resolveCatalogId(item);
      if (!catId) continue;
      if (seen.has(catId)) continue;
      seen.add(catId);
      list.push({ item, catalogId: catId });
    }
    return list;
  }

  /**
   * Sync metadata for all inventory items that have Numista catalog IDs.
   * Resolves IDs from catalogManager and fetches metadata + image URLs from
   * the Numista API. Image downloading is NOT performed here — images are
   * loaded on-demand when the user opens the view modal.
   * @param {Object} opts
   * @param {function({current:number, total:number, catalogId:string}):void} [opts.onProgress]
   * @param {function({synced:number, skipped:number, failed:number, apiLookups:number, elapsed:number}):void} [opts.onComplete]
   * @param {function({catalogId:string, status:string, message:string}):void} [opts.onLog]
   * @param {number} [opts.delay=200] - Delay (ms) between network requests
   * @returns {Promise<void>}
   */
  async function cacheAll({
    onProgress,
    onComplete,
    onLog,
    delay = 200,
    respectEdits = false,
  } = {}) {
    if (_running) return;
    if (!window.imageCache) return;
    // Re-open IDB if the browser closed the connection (storage pressure, backgrounding)
    if (!imageCache.isAvailable()) {
      await imageCache.init();
      if (!imageCache.isAvailable()) return;
    }

    _running = true;
    _aborted = false;

    const startTime = Date.now();
    let synced = 0;
    let skipped = 0;
    let failed = 0;
    let apiLookups = 0;

    const entries = buildEligibleList();
    const total = entries.length;

    // Pre-build a Map<catalogId, uuid[]> for O(1) tag application inside the loop.
    // Uses resolveCatalogId() (same as buildEligibleList) to cover catalogManager items
    // that may not have numistaId directly set on the inventory item.
    const catalogIdToUuids = new Map();
    for (const invItem of typeof inventory !== "undefined" ? inventory : []) {
      if (!invItem.uuid) continue;
      const cid = BulkImageCache.resolveCatalogId(invItem);
      if (!cid) continue;
      if (!catalogIdToUuids.has(cid)) catalogIdToUuids.set(cid, []);
      catalogIdToUuids.get(cid).push(invItem.uuid);
    }

    for (let i = 0; i < entries.length; i++) {
      if (_aborted) break;

      const { item, catalogId } = entries[i];

      if (onProgress) {
        onProgress({ current: i + 1, total, catalogId });
      }

      // Resolve image URLs already on the item
      const _valid = (u) => u && /^https?:\/\/.+\..+/i.test(u);
      // Repair malformed URLs (sanitization bug stripped ://./ characters)
      let urlRepaired = false;
      if (item.obverseImageUrl && !_valid(item.obverseImageUrl)) {
        item.obverseImageUrl = "";
        urlRepaired = true;
      }
      if (item.reverseImageUrl && !_valid(item.reverseImageUrl)) {
        item.reverseImageUrl = "";
        urlRepaired = true;
      }
      if (urlRepaired && onLog)
        onLog({
          catalogId,
          status: "url-repair",
          message: "Cleared malformed image URL(s) — will re-fetch",
        });
      let obverseUrl = _valid(item.obverseImageUrl) ? item.obverseImageUrl : "";
      let reverseUrl = _valid(item.reverseImageUrl) ? item.reverseImageUrl : "";

      // Check if metadata is already cached
      const hasMetaCached = !!(await imageCache.getMetadata(catalogId));

      if (hasMetaCached && obverseUrl) {
        // Metadata synced and URLs already on item — apply cached tags then skip
        try {
          const cached = await imageCache.getMetadata(catalogId);
          if (
            cached &&
            cached.tags &&
            cached.tags.length > 0 &&
            typeof applyNumistaTags === "function"
          ) {
            const uuids = catalogIdToUuids.get(catalogId) || [];
            for (const uuid of uuids) {
              const result = applyNumistaTags(uuid, cached.tags, false, false, respectEdits);
              if (result.skippedEdits && result.skippedEdits.length > 0 && onLog) {
                onLog({
                  catalogId,
                  status: "skip-cached",
                  message: `Preserved ${result.skippedEdits.length} user-removed tag(s): ${result.skippedEdits.join(", ")}`,
                });
              }
            }
          }
        } catch {
          /* non-fatal — tag hydration is best-effort */
        }
        skipped++;
        if (onLog) onLog({ catalogId, status: "skip-cached", message: "Already synced" });
        continue;
      }

      // Either metadata is missing or item needs CDN URLs.
      // Use Local provider cache first (no API call), then fall back to API.
      let apiResult = null;

      // Try local cache first (free, no rate limit)
      if (!obverseUrl && window.catalogAPI?.localProvider) {
        try {
          const localData = catalogAPI.localProvider.localData[catalogId];
          if (localData && (localData.imageUrl || localData.reverseImageUrl)) {
            apiResult = localData;
            if (onLog)
              onLog({ catalogId, status: "local-cache", message: "URLs from local cache" });
          }
        } catch {
          /* ignore */
        }
      }

      // Fall back to API if local cache didn't have URLs or metadata needs syncing
      if (!apiResult && window.catalogAPI && (!hasMetaCached || !obverseUrl)) {
        if (onLog)
          onLog({ catalogId, status: "api-lookup", message: "Syncing metadata from Numista..." });
        try {
          apiResult = await catalogAPI.lookupItem(catalogId);
          apiLookups++;
        } catch (err) {
          failed++;
          if (onLog)
            onLog({ catalogId, status: "meta-failed", message: `Metadata: ${err.message}` });
        }
      }

      if (apiResult) {
        // Sync numistaId back to item if it was only in catalogManager
        if (!item.numistaId) item.numistaId = catalogId;

        // Cache metadata to IndexedDB if not already there
        if (!hasMetaCached) {
          try {
            await imageCache.cacheMetadata(catalogId, apiResult);
          } catch {
            /* ignore */
          }
        }

        // Apply Numista tags to all inventory items sharing this catalog ID
        // Uses pre-built Map for O(1) lookup; persist=false defers saveItemTags() to post-loop
        if (apiResult.tags && apiResult.tags.length > 0 && typeof applyNumistaTags === "function") {
          const uuids = catalogIdToUuids.get(catalogId) || [];
          for (const uuid of uuids) {
            const result = applyNumistaTags(uuid, apiResult.tags, false, false, respectEdits);
            if (result.skippedEdits && result.skippedEdits.length > 0 && onLog) {
              onLog({
                catalogId,
                status: "info",
                message: `Preserved ${result.skippedEdits.length} user-removed tag(s): ${result.skippedEdits.join(", ")}`,
              });
            }
          }
        }

        synced++;
        if (onLog) onLog({ catalogId, status: "metadata", message: "Synced" });
      } else if (!hasMetaCached) {
        failed++;
        if (onLog)
          onLog({ catalogId, status: "meta-failed", message: "Catalog API not available" });
      }

      // Delay between requests to avoid rate-limiting
      if (i < entries.length - 1 && !_aborted) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    _running = false;

    // Persist any tag updates written during the sync loop (synced items + skip-cached tag hydration)
    if ((synced > 0 || skipped > 0) && typeof saveItemTags === "function") {
      saveItemTags();
    }

    // Persist any URL updates back to localStorage
    if (synced > 0 && typeof saveInventory === "function") {
      saveInventory();
    }

    const elapsed = Date.now() - startTime;
    if (onComplete) {
      onComplete({ synced, skipped, failed, apiLookups, elapsed });
    }
  }

  /**
   * Abort a running bulk cache operation.
   */
  function abort() {
    _aborted = true;
  }

  /**
   * Whether a bulk cache operation is currently running.
   * @returns {boolean}
   */
  function isRunning() {
    return _running;
  }

  return { cacheAll, abort, isRunning, buildEligibleList, resolveCatalogId };
})();

if (typeof window !== "undefined") {
  window.BulkImageCache = BulkImageCache;
}

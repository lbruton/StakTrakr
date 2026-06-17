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
   * Build a Map<catalogId, uuid[]> for O(1) tag application inside the sync loop.
   * Uses resolveCatalogId() (same as buildEligibleList) to cover catalogManager
   * items that may not have numistaId directly set on the inventory item.
   * @returns {Map<string, string[]>}
   */
  function buildCatalogIdToUuids() {
    const catalogIdToUuids = new Map();
    for (const invItem of typeof inventory !== "undefined" ? inventory : []) {
      if (!invItem.uuid) continue;
      const cid = BulkImageCache.resolveCatalogId(invItem);
      if (!cid) continue;
      if (!catalogIdToUuids.has(cid)) catalogIdToUuids.set(cid, []);
      catalogIdToUuids.get(cid).push(invItem.uuid);
    }
    return catalogIdToUuids;
  }

  /**
   * Ensure the IndexedDB image cache is available, re-opening it if the browser
   * closed the connection (storage pressure, backgrounding).
   * @returns {Promise<{ok:boolean, error:string}>} Availability status for cacheAll.
   */
  async function ensureImageCacheReady() {
    if (!window.imageCache) {
      return { ok: false, error: "Image cache is not available" };
    }
    if (!imageCache.isAvailable()) {
      try {
        await imageCache.init();
      } catch (err) {
        return {
          ok: false,
          error: `Image cache initialization failed: ${err?.message || err}`,
        };
      }
      if (!imageCache.isAvailable()) {
        return { ok: false, error: "Image cache is not available" };
      }
    }
    return { ok: true, error: "" };
  }

  /**
   * Repair malformed image URLs on an item in place (a sanitization bug stripped
   * `://./` characters). Clears invalid URLs so they will be re-fetched and emits
   * a single url-repair log when any clearing happened.
   * @param {Object} item
   * @param {string} catalogId
   * @param {function(Object):void} [onLog]
   * @returns {{obverseUrl:string, reverseUrl:string}} Valid URLs remaining on the item.
   */
  function repairItemUrls(item, catalogId, onLog) {
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
    return {
      obverseUrl: _valid(item.obverseImageUrl) ? item.obverseImageUrl : "",
      reverseUrl: _valid(item.reverseImageUrl) ? item.reverseImageUrl : "",
    };
  }

  /**
   * Apply a set of Numista tags to every inventory UUID sharing a catalog ID,
   * logging any user-removed tags that were preserved. Best-effort persistence
   * is deferred to the caller (persist=false).
   * @param {string} catalogId
   * @param {string[]} tags
   * @param {Map<string, string[]>} catalogIdToUuids
   * @param {boolean} respectEdits
   * @param {function(Object):void} [onLog]
   * @param {string} skipStatus - Log status to use for preserved-tag messages.
   */
  function applyTagsToUuids(catalogId, tags, catalogIdToUuids, respectEdits, onLog, skipStatus) {
    const uuids = catalogIdToUuids.get(catalogId) || [];
    for (const uuid of uuids) {
      const result = applyNumistaTags(uuid, tags, false, false, respectEdits);
      if (result.skippedEdits && result.skippedEdits.length > 0 && onLog) {
        onLog({
          catalogId,
          status: skipStatus,
          message: `Preserved ${result.skippedEdits.length} user-removed tag(s): ${result.skippedEdits.join(", ")}`,
        });
      }
    }
  }

  /**
   * Handle an entry whose metadata is already cached and which already has image
   * URLs: hydrate cached tags (best-effort) and count it as skipped.
   * @param {string} catalogId
   * @param {Map<string, string[]>} catalogIdToUuids
   * @param {boolean} respectEdits
   * @param {function(Object):void} [onLog]
   * @returns {Promise<void>}
   */
  async function handleAlreadyCached(catalogId, catalogIdToUuids, respectEdits, onLog) {
    try {
      const cached = await imageCache.getMetadata(catalogId);
      if (
        cached &&
        cached.tags &&
        cached.tags.length > 0 &&
        typeof applyNumistaTags === "function"
      ) {
        applyTagsToUuids(
          catalogId,
          cached.tags,
          catalogIdToUuids,
          respectEdits,
          onLog,
          "skip-cached"
        );
      }
    } catch {
      /* non-fatal — tag hydration is best-effort */
    }
    if (onLog) onLog({ catalogId, status: "skip-cached", message: "Already synced" });
  }

  /**
   * Try the Local provider cache (free, no rate limit) for image URLs.
   * @param {string} catalogId
   * @param {string} obverseUrl - URL already present on the item, if any.
   * @param {function(Object):void} [onLog]
   * @returns {Object|null} Local provider data when usable, else null.
   */
  function tryLocalProvider(catalogId, obverseUrl, onLog) {
    if (obverseUrl || !window.catalogAPI?.localProvider) return null;
    try {
      const localData = catalogAPI.localProvider.localData[catalogId];
      if (localData && (localData.imageUrl || localData.reverseImageUrl)) {
        if (onLog) onLog({ catalogId, status: "local-cache", message: "URLs from local cache" });
        return localData;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  /**
   * Fetch metadata from the Numista API when the local cache missed and either
   * the metadata or the image URLs are still needed.
   * @param {string} catalogId
   * @param {boolean} hasMetaCached
   * @param {string} obverseUrl
   * @param {function(Object):void} [onLog]
   * @returns {Promise<{apiResult:Object|null, lookups:number, failed:number}>}
   */
  async function fetchFromApi(catalogId, hasMetaCached, obverseUrl, onLog) {
    if (!window.catalogAPI || (hasMetaCached && obverseUrl)) {
      return { apiResult: null, lookups: 0, failed: 0 };
    }
    if (onLog)
      onLog({ catalogId, status: "api-lookup", message: "Syncing metadata from Numista..." });
    try {
      const apiResult = await catalogAPI.lookupItem(catalogId);
      return { apiResult, lookups: 1, failed: 0 };
    } catch (err) {
      if (onLog) onLog({ catalogId, status: "meta-failed", message: `Metadata: ${err.message}` });
      return { apiResult: null, lookups: 0, failed: 1 };
    }
  }

  /**
   * Persist a successful fetch: backfill numistaId, cache metadata to IndexedDB
   * (when not already cached), and apply fetched tags to all matching items.
   * @param {Object} item
   * @param {string} catalogId
   * @param {Object} apiResult
   * @param {boolean} hasMetaCached
   * @param {Map<string, string[]>} catalogIdToUuids
   * @param {boolean} respectEdits
   * @param {function(Object):void} [onLog]
   * @returns {Promise<void>}
   */
  async function persistFetched(
    item,
    catalogId,
    apiResult,
    hasMetaCached,
    catalogIdToUuids,
    respectEdits,
    onLog
  ) {
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
      applyTagsToUuids(catalogId, apiResult.tags, catalogIdToUuids, respectEdits, onLog, "info");
    }
    if (onLog) onLog({ catalogId, status: "metadata", message: "Synced" });
  }

  /**
   * Process a single eligible entry, returning the counter deltas it produced.
   * Mirrors the original loop body exactly: URL repair, already-cached skip,
   * local-cache fallback, API fetch, and metadata persistence.
   * @param {{item:Object, catalogId:string}} entry
   * @param {Map<string, string[]>} catalogIdToUuids
   * @param {boolean} respectEdits
   * @param {function(Object):void} [onLog]
   * @returns {Promise<{synced:number, skipped:number, failed:number, apiLookups:number}>}
   */
  async function processEntry(entry, catalogIdToUuids, respectEdits, onLog) {
    const { item, catalogId } = entry;
    const delta = { synced: 0, skipped: 0, failed: 0, apiLookups: 0 };

    const { obverseUrl } = repairItemUrls(item, catalogId, onLog);

    // Check if metadata is already cached
    const hasMetaCached = !!(await imageCache.getMetadata(catalogId));

    if (hasMetaCached && obverseUrl) {
      // Metadata synced and URLs already on item — apply cached tags then skip
      await handleAlreadyCached(catalogId, catalogIdToUuids, respectEdits, onLog);
      delta.skipped++;
      return delta;
    }

    // Either metadata is missing or item needs CDN URLs.
    // Use Local provider cache first (no API call), then fall back to API.
    let apiResult = tryLocalProvider(catalogId, obverseUrl, onLog);

    // Fall back to API if local cache didn't have URLs or metadata needs syncing
    if (!apiResult) {
      const fetched = await fetchFromApi(catalogId, hasMetaCached, obverseUrl, onLog);
      apiResult = fetched.apiResult;
      delta.apiLookups += fetched.lookups;
      delta.failed += fetched.failed;
    }

    if (apiResult) {
      await persistFetched(
        item,
        catalogId,
        apiResult,
        hasMetaCached,
        catalogIdToUuids,
        respectEdits,
        onLog
      );
      delta.synced++;
    } else if (!hasMetaCached) {
      delta.failed++;
      if (onLog) onLog({ catalogId, status: "meta-failed", message: "Catalog API not available" });
    }

    return delta;
  }

  /**
   * Persist tag and URL updates accumulated during the sync loop.
   * @param {{synced:number, skipped:number}} totals
   */
  function persistLoopResults(totals) {
    // Persist any tag updates written during the sync loop (synced items + skip-cached tag hydration)
    if ((totals.synced > 0 || totals.skipped > 0) && typeof saveItemTags === "function") {
      saveItemTags();
    }
    // Persist any URL updates back to localStorage
    if (totals.synced > 0 && typeof saveInventory === "function") {
      saveInventory();
    }
  }

  /**
   * Sync metadata for all inventory items that have Numista catalog IDs.
   * Resolves IDs from catalogManager and fetches metadata + image URLs from
   * the Numista API. Image downloading is NOT performed here — images are
   * loaded on-demand when the user opens the view modal.
   * @param {Object} opts
   * @param {function({current:number, total:number, catalogId:string}):void} [opts.onProgress]
   * @param {function({synced:number, skipped:number, failed:number, apiLookups:number, elapsed:number, error?:string}):void} [opts.onComplete]
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
    const startTime = Date.now();
    const readiness = await ensureImageCacheReady();
    if (!readiness.ok) {
      if (onComplete) {
        onComplete({
          synced: 0,
          skipped: 0,
          failed: 1,
          apiLookups: 0,
          elapsed: Date.now() - startTime,
          error: readiness.error,
        });
      }
      return;
    }

    _running = true;
    _aborted = false;

    const totals = { synced: 0, skipped: 0, failed: 0, apiLookups: 0 };

    const entries = buildEligibleList();
    const total = entries.length;
    const catalogIdToUuids = buildCatalogIdToUuids();

    for (let i = 0; i < entries.length; i++) {
      if (_aborted) break;

      if (onProgress) {
        onProgress({ current: i + 1, total, catalogId: entries[i].catalogId });
      }

      const delta = await processEntry(entries[i], catalogIdToUuids, respectEdits, onLog);
      totals.synced += delta.synced;
      totals.skipped += delta.skipped;
      totals.failed += delta.failed;
      totals.apiLookups += delta.apiLookups;

      // Delay between requests to avoid rate-limiting
      if (i < entries.length - 1 && !_aborted) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    _running = false;

    persistLoopResults(totals);

    const elapsed = Date.now() - startTime;
    if (onComplete) {
      onComplete({ ...totals, elapsed });
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

  /**
   * Validate an image URL (must look like an http(s) URL with a host + dot path).
   * Kept LAST in the IIFE: this regex literal contains a `/` that desyncs the
   * Lizard tokenizer; trailing placement dissolves the phantom ccn rollup.
   * @param {string} u
   * @returns {boolean}
   */
  function _valid(u) {
    return u && /^https?:\/\/.+\..+/i.test(u);
  }

  return { cacheAll, abort, isRunning, buildEligibleList, resolveCatalogId };
})();

if (typeof window !== "undefined") {
  window.BulkImageCache = BulkImageCache;
}

// NUMISTA BULK SYNC UI (STACK-87/88)
// =============================================================================
// Inline UI within Settings > API > Numista card for bulk syncing metadata.
// Shows stats, eligible item table with per-row status, real-time activity log,
// and sync controls. Resolves catalog IDs from catalogManager.
// Image caching is handled on-demand by the view modal (viewModal.js).
// =============================================================================

/** @type {Map<string, HTMLElement>} Status cells keyed by catalogId for live updates */
let _statusCells = new Map();

/**
 * Renders the Numista Bulk Sync inline UI: stats, eligible items table.
 * Called when the Numista provider tab is shown and conditions are met.
 */
const renderNumistaSyncUI = async () => {
  _statusCells.clear();
  await renderSyncStats();
  await renderEligibleItemsTable();
};

// ---------------------------------------------------------------------------
// Stats bar
// ---------------------------------------------------------------------------

/**
 * Renders the cache statistics bar: count, total size, quota percentage.
 */
const renderSyncStats = () => {
  const container = safeGetElement("numistaSyncStats");
  if (!container) return;

  const apiCount = typeof getNumistaCacheCount === "function" ? getNumistaCacheCount() : 0;
  const eligible = window.BulkImageCache ? BulkImageCache.buildEligibleList() : [];

  container.textContent = `${apiCount} API cache \u00b7 ${eligible.length} eligible`;
};

// ---------------------------------------------------------------------------
// Eligible items table (shows all N# items with cache status)
// ---------------------------------------------------------------------------

/**
 * Renders the table of all inventory items that have Numista catalog IDs.
 * Each row shows: N#, item name, cache status, and action buttons.
 * Status cells are tracked in _statusCells for live updates during bulk sync.
 */
const renderEligibleItemsTable = async () => {
  const container = document.getElementById("numistaSyncTableContainer");
  if (!container) return;

  container.textContent = "";
  _statusCells.clear();

  if (!window.imageCache?.isAvailable()) {
    const empty = document.createElement("div");
    empty.className = "chip-grouping-empty";
    empty.textContent = "Image cache not available";
    container.appendChild(empty);
    return;
  }

  // Get eligible items from BulkImageCache (resolves catalogManager mappings)
  const entries = window.BulkImageCache ? BulkImageCache.buildEligibleList() : [];

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "chip-grouping-empty";
    empty.textContent = "No items with Numista catalog IDs found";
    container.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "chip-grouping-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["N#", "Item Name", "Status", ""].forEach((text) => {
    const th = document.createElement("th");
    th.textContent = text;
    th.style.cssText = "font-size:0.75rem;font-weight:normal;opacity:0.6;padding:0.2rem 0.4rem";
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const { item, catalogId } of entries) {
    const hasMeta = !!(await imageCache.getMetadata(catalogId));

    const tr = document.createElement("tr");

    // Catalog ID cell
    const tdId = document.createElement("td");
    tdId.classList.add("cache-id");
    tdId.textContent = catalogId;

    // Item name cell
    const tdName = document.createElement("td");
    tdName.textContent = item.name || "\u2014";
    tdName.style.cssText =
      "max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";

    // Status cell (updated live during bulk sync)
    const tdStatus = document.createElement("td");
    tdStatus.style.cssText = "font-size:0.8rem;white-space:nowrap";
    if (hasMeta) {
      tdStatus.textContent = "\u2713 Synced";
      tdStatus.style.color = "var(--success-color, green)";
    } else {
      tdStatus.textContent = "Needs sync";
      tdStatus.style.color = "var(--warning-color, orange)";
    }
    _statusCells.set(catalogId, tdStatus);

    // Actions cell
    const tdActions = document.createElement("td");
    tdActions.style.cssText = "white-space:nowrap;text-align:right";

    if (hasMeta) {
      // Re-sync button
      const syncBtn = document.createElement("button");
      syncBtn.type = "button";
      syncBtn.className = "inline-chip-move";
      syncBtn.textContent = "\u21BB";
      syncBtn.title = "Re-sync";
      syncBtn.addEventListener("click", async () => {
        syncBtn.disabled = true;
        await resyncCachedEntry(catalogId);
        syncBtn.disabled = false;
        await renderEligibleItemsTable();
        await renderSyncStats();
      });

      // Delete button
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "inline-chip-move";
      delBtn.textContent = "\u2715";
      delBtn.title = "Delete cached data";
      delBtn.addEventListener("click", async () => {
        await imageCache.deleteMetadata(catalogId);
        logSyncActivity(`Deleted cache for ${catalogId}`, "warn");
        await renderEligibleItemsTable();
        await renderSyncStats();
      });

      tdActions.append(syncBtn, delBtn);
    }

    tr.append(tdId, tdName, tdStatus, tdActions);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  container.appendChild(table);
};

/**
 * Re-syncs a single cached entry: deletes metadata then re-fetches from Numista API.
 * Image caching is handled on-demand by the view modal.
 * @param {string} catalogId
 */
const resyncCachedEntry = async (catalogId) => {
  const item = (typeof inventory !== "undefined" ? inventory : []).find((i) => {
    const resolved = window.BulkImageCache ? BulkImageCache.resolveCatalogId(i) : "";
    return resolved === catalogId;
  });

  // Delete metadata for a clean re-sync (coinImages store removed — STAK-339)
  await imageCache.deleteMetadata(catalogId);

  // Fetch metadata + image URLs from Numista API
  if (window.catalogAPI) {
    logSyncActivity(`${catalogId}: Re-syncing metadata from Numista...`, "info");
    try {
      const result = await catalogAPI.lookupItem(catalogId);
      if (item) {
        if (result?.tags && result.tags.length > 0 && typeof applyNumistaTags === "function") {
          const allItems = typeof inventory !== "undefined" ? inventory : [];
          allItems.forEach((invItem) => {
            const resolved = window.BulkImageCache ? BulkImageCache.resolveCatalogId(invItem) : "";
            if (resolved === catalogId && invItem.uuid) {
              applyNumistaTags(invItem.uuid, result.tags);
            }
          });
        }
        if (typeof saveInventory === "function") saveInventory();
      }
      await imageCache.cacheMetadata(catalogId, result);
      logSyncActivity(`${catalogId}: Metadata re-synced`, "success");
    } catch (err) {
      logSyncActivity(`${catalogId}: API lookup failed: ${err.message}`, "error");
    }
  } else {
    logSyncActivity(`${catalogId}: Catalog API not available`, "error");
  }
};

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

/**
 * Appends a timestamped line to the activity log and auto-scrolls.
 * @param {string} message
 * @param {'info'|'success'|'warn'|'error'} [type='info']
 */
const logSyncActivity = (message, type = "info") => {
  const logEl = document.getElementById("numistaSyncLog");
  if (!logEl) return;

  const line = document.createElement("div");
  line.classList.add("cache-log-line");

  const colorMap = {
    info: "inherit",
    success: "var(--success-color, green)",
    warn: "var(--warning-color, orange)",
    error: "var(--danger-color, red)",
  };
  line.style.color = colorMap[type] || "inherit";

  const now = new Date();
  const ts =
    typeof formatTimeOnly === "function"
      ? formatTimeOnly(now)
      : now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  line.textContent = `[${ts}] ${message}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
};

/**
 * Updates a status cell in the eligible items table for live feedback.
 * @param {string} catalogId
 * @param {string} text
 * @param {string} color - CSS color value
 */
const updateStatusCell = (catalogId, text, color) => {
  const cell = _statusCells.get(catalogId);
  if (!cell) return;
  cell.textContent = text;
  cell.style.color = color;
};

// ---------------------------------------------------------------------------
// Bulk sync from inline UI
// ---------------------------------------------------------------------------

/**
 * Starts the bulk sync operation from the inline Numista card.
 * Updates per-row status cells in real time as items are processed.
 */
const startBulkSync = async () => {
  if (!window.BulkImageCache || BulkImageCache.isRunning()) return;

  // Confirmation dialog (STAK-556)
  if (typeof appConfirm === "function") {
    const proceed = await appConfirm(
      "Start metadata sync? This will apply Numista tags to all eligible items.",
      "Numista Sync"
    );
    if (!proceed) return;
  }

  // Ask about user-edited tags
  let respectEdits = false;
  if (typeof appConfirm === "function") {
    respectEdits = await appConfirm(
      "Skip tags you've previously removed from items?\n\n• Yes = preserve your tag removals\n• No = sync all tags",
      "Sync Mode"
    );
  }

  const startBtn = document.getElementById("numistaSyncStartBtn");
  const cancelBtn = document.getElementById("numistaSyncCancelBtn");
  const progressBar = document.getElementById("numistaSyncProgress");

  if (startBtn) startBtn.disabled = true;
  if (cancelBtn) cancelBtn.style.display = "";
  if (progressBar) {
    progressBar.style.display = "";
    progressBar.value = 0;
    progressBar.max = 0;
  }

  logSyncActivity("Starting metadata sync...", "info");

  const statusColorMap = {
    "skip-cached": ["var(--success-color, green)", "\u2713 Synced"],
    "api-lookup": ["var(--text-secondary, #888)", "Syncing..."],
    metadata: ["var(--success-color, green)", "\u2713 Synced"],
    "meta-failed": ["var(--warning-color, orange)", "\u26a0 Failed"],
    info: ["var(--text-secondary, #888)", "\u24d8 Info"],
  };

  BulkImageCache.cacheAll({
    respectEdits,
    onProgress: ({ current, total }) => {
      if (progressBar) {
        progressBar.max = total;
        progressBar.value = current;
      }
    },
    onLog: ({ catalogId, status, message }) => {
      // Update the table row status cell
      const [color, label] = statusColorMap[status] || ["inherit", status];
      updateStatusCell(catalogId, label, color);

      // Log to activity log
      const logTypeMap = {
        "skip-cached": "info",
        "api-lookup": "info",
        metadata: "success",
        "meta-failed": "warn",
      };
      logSyncActivity(`${catalogId}: ${message}`, logTypeMap[status] || "info");
    },
    onComplete: async ({ synced, skipped, failed, apiLookups, elapsed, error }) => {
      if (startBtn) startBtn.disabled = false;
      if (cancelBtn) cancelBtn.style.display = "none";
      if (progressBar) progressBar.style.display = "none";

      const secs = (elapsed / 1000).toFixed(1);
      let msg = error
        ? `Failed in ${secs}s: ${error}`
        : `Complete in ${secs}s: ${synced} synced, ${skipped} skipped, ${failed} failed`;
      if (!error && apiLookups > 0) msg += `, ${apiLookups} API calls`;
      msg += ".";
      logSyncActivity(msg, failed > 0 ? "warn" : "success");

      // Refresh table and stats
      await renderEligibleItemsTable();
      await renderSyncStats();

      // Refresh Numista usage bar + settings footer storage display
      if (typeof window.renderNumistaUsageBar === "function") window.renderNumistaUsageBar();
      if (typeof updateSettingsFooter === "function") updateSettingsFooter();

      // Refresh filter chips so newly-applied tags appear immediately
      if (typeof renderActiveFilters === "function") renderActiveFilters();
    },
  });
};

/**
 * Clears all cached images and metadata after confirmation.
 */
const clearAllCachedData = async () => {
  if (!window.imageCache?.isAvailable()) return;

  const usage = await imageCache.getStorageUsage();
  if (usage.count === 0) {
    logSyncActivity("No cached data to clear", "info");
    return;
  }

  const confirmed = await appConfirm(
    `Delete all ${usage.count} cached entries (images + metadata)? This cannot be undone.`,
    "Image Cache"
  );
  if (!confirmed) return;

  const ok = await imageCache.clearAll();
  if (ok) {
    logSyncActivity(`Cleared all ${usage.count} cached entries`, "warn");
  } else {
    logSyncActivity("Failed to clear cache", "error");
  }

  await renderEligibleItemsTable();
  await renderSyncStats();
  if (typeof updateSettingsFooter === "function") updateSettingsFooter();
};

// ---------------------------------------------------------------------------
// Bulk image-URL backfill (STRK-166 — restores the feature removed in STAK-432)
// ---------------------------------------------------------------------------

/**
 * Populates obverse/reverse Numista CDN image URLs on inventory items that have
 * a Numista catalog ID but are missing one or both image URLs (e.g. CSV imports).
 *
 * Routes through catalogAPI.lookupItem, which is cache-first (30-day response
 * cache) — so items already cached by "Sync Unsynced" resolve instantly with no
 * API quota. Only genuine API calls are throttled (~650ms) to respect Numista's
 * 100 req/min limit; the provider throws on overrun, so we save partial progress
 * and ask the user to re-run. Duplicate catalog IDs are fetched once (donor map).
 */
const syncNumistaImageUrls = async () => {
  if (!_imageUrlSyncReady()) return;

  const inv = typeof inventory !== "undefined" && Array.isArray(inventory) ? inventory : [];
  const eligible = _collectImageUrlEligible(inv);

  if (!eligible.length) {
    appAlert("All Numista items already have image URLs.", "Sync Image URLs");
    return;
  }

  const proceed = await appConfirm(
    `Populate image URLs for ${eligible.length} item(s) from Numista?\n\n` +
      "Cached lookups are free; uncached items use your Numista API quota.",
    "Sync Image URLs"
  );
  if (!proceed) return;

  const totals = { synced: 0, failed: 0, rateLimited: false };
  const urlByCatId = new Map(); // catId -> {obv, rev} | null (null = failed/no-retry)

  logSyncActivity("Starting image URL sync...", "info");

  try {
    for (const item of eligible) {
      const catId = _resolveImageUrlCatId(item);
      if (!catId) continue;

      const urls = await _fetchImageUrlsForCatId(catId, urlByCatId, totals);
      if (totals.rateLimited) break;
      if (!urls || (!urls.obv && !urls.rev)) continue;

      if (_applyImageUrls(item, urls)) totals.synced++;
    }
  } finally {
    if (typeof saveInventory === "function") saveInventory();
    if (typeof renderTable === "function") renderTable();
    await renderEligibleItemsTable();
    await renderSyncStats();
  }

  appAlert(_buildImageUrlSummary(totals), "Sync Image URLs");
};

/**
 * Verifies the catalog API and a configured Numista key are present before an
 * image-URL sync. Emits the matching alert and returns false when not ready.
 * @returns {boolean} True if the sync may proceed.
 */
const _imageUrlSyncReady = () => {
  if (!window.catalogAPI) {
    appAlert("Catalog API not available.", "Sync Image URLs");
    return false;
  }
  const config =
    typeof catalogConfig !== "undefined" && typeof catalogConfig.getNumistaConfig === "function"
      ? catalogConfig.getNumistaConfig()
      : null;
  if (!config || !config.apiKey) {
    appAlert("Numista API key not configured.", "Sync Image URLs");
    return false;
  }
  return true;
};

/**
 * Resolves the Numista catalog ID for an inventory item, preferring the
 * catalogManager mapping (via BulkImageCache) and falling back to numistaId.
 * @param {object} item Inventory item.
 * @returns {string} Resolved catalog ID, or "" when none.
 */
const _resolveImageUrlCatId = (item) =>
  window.BulkImageCache ? BulkImageCache.resolveCatalogId(item) : item.numistaId || "";

/**
 * Filters inventory to items that have a resolvable Numista catalog ID AND are
 * missing at least one (obverse/reverse) image URL.
 * @param {object[]} inv Inventory array.
 * @returns {object[]} Items eligible for image-URL backfill.
 */
const _collectImageUrlEligible = (inv) =>
  inv.filter((i) => {
    const catId = _resolveImageUrlCatId(i);
    return catId && (!i.obverseImageUrl || !i.reverseImageUrl);
  });

/**
 * Fills any missing obverse/reverse image URL on an item from the donor URLs,
 * never overwriting an existing value.
 * @param {object} item Inventory item to mutate.
 * @param {{obv: string, rev: string}} urls Donor image URLs.
 * @returns {boolean} True if at least one URL was applied.
 */
const _applyImageUrls = (item, urls) => {
  let updated = false;
  if (!item.obverseImageUrl && urls.obv) {
    item.obverseImageUrl = urls.obv;
    updated = true;
  }
  if (!item.reverseImageUrl && urls.rev) {
    item.reverseImageUrl = urls.rev;
    updated = true;
  }
  return updated;
};

/**
 * Builds the completion summary message for the image-URL sync.
 * @param {{synced: number, failed: number, rateLimited: boolean}} totals Run tallies.
 * @returns {string} Human-readable summary.
 */
const _buildImageUrlSummary = ({ synced, failed, rateLimited }) => {
  let msg = `Image URL sync complete.\n${synced} item(s) updated`;
  if (failed) msg += `, ${failed} failed`;
  msg += ".";
  if (rateLimited) {
    msg += "\n\nStopped early: Numista rate limit reached. Run again in ~1 minute for the rest.";
  }
  return msg;
};

// ---------------------------------------------------------------------------
// Regex-bearing helper kept LAST: a regex literal upstream desyncs Lizard's
// tokenizer and inflates the ccn of the following function (STRK-170 note).
// ---------------------------------------------------------------------------

/**
 * Returns donor image URLs for a catalog ID, fetching once via the cache-first
 * catalogAPI.lookupItem and memoizing in urlByCatId (null = failed/no-retry).
 * Detects a Numista rate-limit error (sets totals.rateLimited and stops), counts
 * other failures (totals.failed), and throttles ~650ms after a genuine API call.
 * @param {string} catId Numista catalog ID.
 * @param {Map<string, ({obv: string, rev: string}|null)>} urlByCatId Donor cache.
 * @param {{failed: number, rateLimited: boolean}} totals Run tallies (mutated).
 * @returns {Promise<{obv: string, rev: string}|null|undefined>} Donor URLs, or null on failure.
 */
const _fetchImageUrlsForCatId = async (catId, urlByCatId, totals) => {
  let urls = urlByCatId.get(catId);
  if (urls !== undefined) return urls;

  const wasCached =
    typeof window.loadNumistaCache === "function" && !!window.loadNumistaCache(catId);
  try {
    const result = await catalogAPI.lookupItem(catId);
    urls = {
      obv: (result && result.imageUrl) || "",
      rev: (result && result.reverseImageUrl) || "",
    };
    urlByCatId.set(catId, urls);
    if (!urls.obv && !urls.rev) {
      logSyncActivity(`${catId}: no images available`, "warn");
    }
  } catch (err) {
    if (/rate limit/i.test((err && err.message) || "")) {
      totals.rateLimited = true;
      logSyncActivity(
        "Paused: Numista rate limit reached. Run again in ~1 minute to continue.",
        "warn"
      );
      return null;
    }
    urlByCatId.set(catId, null);
    totals.failed++;
    logSyncActivity(`${catId}: lookup failed — ${(err && err.message) || err}`, "error");
    return null;
  }
  // Only genuine API calls (cache misses) count against the rate limit.
  if (!wasCached) {
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  return urls;
};

// ---------------------------------------------------------------------------
// Global exports
// ---------------------------------------------------------------------------
if (typeof window !== "undefined") {
  window.renderNumistaSyncUI = renderNumistaSyncUI;
  window.startBulkSync = startBulkSync;
  window.clearAllCachedData = clearAllCachedData;
  window.syncNumistaImageUrls = syncNumistaImageUrls;
}

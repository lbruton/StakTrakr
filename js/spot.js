// SPOT PRICE FUNCTIONS
// =============================================================================

/**
 * Saves spot history to localStorage.
 * Writes the content of `spotHistory` to the `SPOT_HISTORY_KEY`.
 * @returns {void}
 */
const PERSISTED_SEED_HISTORY_DAYS = window.SPOT_HISTORY_RUNTIME_WINDOW_DAYS || 180;

/**
 * Builds the persisted spot-history snapshot.
 * Static seed/reference entries older than the runtime window stay available
 * through bundle/year-file sources instead of localStorage.
 *
 * @param {Array} entries
 * @returns {{entries:Array, changed:boolean, trimmedSeedEntries:number, removedInvalidEntries:number, dedupedEntries:number}}
 */
const getPersistedSpotHistorySnapshot = (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      entries: [],
      changed: Array.isArray(entries) ? false : true,
      trimmedSeedEntries: 0,
      removedInvalidEntries: 0,
      dedupedEntries: 0,
    };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PERSISTED_SEED_HISTORY_DAYS);
  const cutoffStamp = cutoff.toISOString().replace("T", " ").slice(0, 19);

  let trimmedSeedEntries = 0;
  let removedInvalidEntries = 0;
  let dedupedEntries = 0;
  const byKey = new Map();

  entries.forEach((entry) => {
    if (
      !entry ||
      typeof entry.spot !== "number" ||
      entry.spot <= 0 ||
      typeof entry.metal !== "string" ||
      entry.metal === "" ||
      typeof entry.timestamp !== "string" ||
      entry.timestamp === ""
    ) {
      removedInvalidEntries++;
      return;
    }

    if (entry.source === "seed" && entry.timestamp < cutoffStamp) {
      trimmedSeedEntries++;
      return;
    }

    const key = `${entry.timestamp}|${entry.metal}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
      return;
    }

    dedupedEntries++;
    if (existing.source === "seed" && entry.source !== "seed") {
      byKey.set(key, entry);
    }
  });

  const persisted = [...byKey.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return {
    entries: persisted,
    changed:
      trimmedSeedEntries > 0 ||
      removedInvalidEntries > 0 ||
      dedupedEntries > 0 ||
      persisted.length !== entries.length,
    trimmedSeedEntries,
    removedInvalidEntries,
    dedupedEntries,
  };
};

// STRK-141: Synchronous facade over an async IndexedDB tail.
// The in-memory `spotHistory` global is updated FIRST so render/chart reads and
// every existing synchronous caller stay current, then the durable write is
// fire-and-forget: historyStore.put when IndexedDB is available (it swallows its
// own quota failures by returning false — the in-memory copy is already current),
// otherwise the synchronous localStorage fallback. Callers must NOT await this.
const saveSpotHistory = () => {
  try {
    const snapshot = getPersistedSpotHistorySnapshot(spotHistory);
    if (
      snapshot.changed &&
      typeof debugLog === "function" &&
      (snapshot.trimmedSeedEntries > 0 ||
        snapshot.removedInvalidEntries > 0 ||
        snapshot.dedupedEntries > 0)
    ) {
      debugLog(
        "Spot history: persisting sanitized snapshot (" +
          snapshot.entries.length +
          " entries, trimmed " +
          snapshot.trimmedSeedEntries +
          " old seed, removed " +
          snapshot.removedInvalidEntries +
          " invalid, deduped " +
          snapshot.dedupedEntries +
          ")"
      );
    }
    // Assign the in-memory global FIRST so readers/renderers are immediately current.
    spotHistory = snapshot.entries;
    if (typeof historyStore !== "undefined" && historyStore.isAvailable()) {
      // Fire-and-forget: do NOT await. put() returns false on quota without throwing,
      // and the in-memory copy above is already authoritative for all readers.
      void historyStore.put("metalSpotHistory", snapshot.entries);
    } else {
      saveDataSync(SPOT_HISTORY_KEY, snapshot.entries, { quietQuotaToast: true });
    }
  } catch (error) {
    console.warn("Spot history save skipped:", error);
  }
};

/**
 * Loads spot history into the in-memory `spotHistory` global.
 * STRK-141: reads from IndexedDB (historyStore) when available, otherwise the
 * synchronous localStorage fallback, then runs the existing trim/dedup snapshot.
 * Async because the IndexedDB read is async; init.js (task 7) awaits this during
 * boot before the first render.
 */
const loadSpotHistory = async () => {
  try {
    let data;
    if (typeof historyStore !== "undefined" && historyStore.isAvailable()) {
      // IDB available: prefer it, but fall back to the localStorage copy when
      // get() returns null for a DEFERRED key — migrate() keeps an unconfirmed
      // or wrong-shape payload in localStorage WITHOUT writing it to IDB, so the
      // LS copy is still the source of truth (R3.1, STRK-149 finding #1).
      // `??` (not `!== null`) so the fallback also fires if get() ever returns
      // undefined; use SPOT_HISTORY_KEY so the IDB read and the LS fallback
      // resolve the same key.
      const idb = await historyStore.get(SPOT_HISTORY_KEY);
      data = idb ?? loadDataSync(SPOT_HISTORY_KEY, []);
    } else {
      data = loadDataSync(SPOT_HISTORY_KEY, []);
    }
    const snapshot = getPersistedSpotHistorySnapshot(Array.isArray(data) ? data : []);
    spotHistory = snapshot.entries;

    if (snapshot.changed) {
      try {
        // Re-persist the sanitized snapshot through the sync facade (routes to
        // IndexedDB or localStorage as appropriate); spotHistory is already set.
        saveSpotHistory();
        if (typeof debugLog === "function" && snapshot.trimmedSeedEntries > 0) {
          debugLog(
            "Spot history: migrated persisted storage to trimmed runtime snapshot (" +
              snapshot.entries.length +
              " entries, removed " +
              snapshot.trimmedSeedEntries +
              " old seed entries)"
          );
        }
      } catch (saveError) {
        console.warn("Spot history migration save failed:", saveError);
      }
    }
  } catch (error) {
    console.error("Error loading spot history:", error);
    spotHistory = [];
  }
};

/**
 * One-time migration: re-tag old StakTrakr hourly backfill entries.
 * Before v3.30.02, backfill entries were stored with source:"api" (same as
 * live syncs). Identifies them by the heuristic: provider is "StakTrakr",
 * source is "api", and timestamp lands exactly on the hour (:00:00).
 * Regular syncs never produce on-the-hour timestamps.
 */
// STRK-141: async because it awaits loadSpotHistory (now async). No longer runs
// at module parse time — init.js (task 7) invokes `await migrateHourlySource()`
// inside the awaited boot sequence AFTER historyStore.init()/migrate() so spot
// history loads from the ready store before re-tagging.
const migrateHourlySource = async () => {
  const FLAG = "migration_hourlySource";
  try {
    if (localStorage.getItem(FLAG)) return;
    await loadSpotHistory();
    let changed = 0;
    spotHistory.forEach((e) => {
      if (
        e.provider === "StakTrakr" &&
        e.source === "api" &&
        typeof e.timestamp === "string" &&
        e.timestamp.endsWith(":00:00")
      ) {
        e.source = "api-hourly";
        changed++;
      }
    });
    if (changed > 0) {
      saveSpotHistory();
      console.log(`[Migration] Re-tagged ${changed} StakTrakr entries as api-hourly`);
    }
    localStorage.setItem(FLAG, "1");
  } catch (err) {
    console.warn("Hourly source migration failed:", err);
  }
};

// STRK-141: NOT called at parse time anymore. Task 7 (init.js boot wiring) calls
// `await migrateHourlySource()` during the awaited boot, after the history store
// is initialized/migrated. Exposed on window below for the boot sequence.

/**
 * Removes spot history entries older than the specified number of days
 *
 * @param {number} days - Number of days to retain
 */
const purgeSpotHistory = (days = 180) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  spotHistory = spotHistory.filter((entry) => new Date(entry.timestamp) >= cutoff);
};

/**
 * Stores last cache refresh and API sync timestamps
 *
 * @param {string} source - Source of spot price ('api' or 'cached')
 * @param {string|null} provider - Provider name if available
 * @param {string} timestamp - ISO timestamp of the event
 */
const updateLastTimestamps = (source, provider, timestamp) => {
  const apiEntry = {
    provider: provider || "API",
    timestamp,
  };

  if (source === "api") {
    saveDataSync(LAST_API_SYNC_KEY, apiEntry);
    saveDataSync(LAST_CACHE_REFRESH_KEY, apiEntry);
    if (typeof window.updateSpotSyncHealthDot === "function") window.updateSpotSyncHealthDot();
  } else if (source === "cached") {
    const cacheEntry = {
      provider: provider ? `${provider} (cached)` : "Cached",
      timestamp,
    };
    saveDataSync(LAST_CACHE_REFRESH_KEY, cacheEntry);
  }
};

/**
 * Maps a `getHealthStatusClass` modifier onto a spot freshness state name.
 * @param {'--green'|'--orange'|'--red'} healthClass
 * @returns {'fresh'|'stale'|'expired'}
 */
const _healthClassToFreshness = (healthClass) => {
  if (healthClass === "--green") return "fresh";
  if (healthClass === "--orange") return "stale";
  return "expired";
};

/**
 * Reads a freshness timestamp entry, tolerating unreadable storage.
 * @param {string} key - LAST_API_SYNC_KEY or LAST_CACHE_REFRESH_KEY
 * @returns {{provider?: string, timestamp?: string}|null} Entry, or null
 */
const _readFreshnessEntry = (key) => {
  try {
    return loadDataSync(key);
  } catch (e) {
    return null;
  }
};

/**
 * True when a cache entry is still inside its provider's cache window, i.e. the
 * app considers the data valid and will not refetch it.
 *
 * `getCacheDurationMs("STAKTRAKR")` is 0 by design (static hourly files, no rate
 * limit), so this is only ever true for keyed providers.
 * @param {{provider?: string, timestamp?: string}|null} cache - Cache entry
 * @returns {boolean} True if still within the provider's cache duration
 */
const _isCacheWithinProviderWindow = (cache) => {
  if (!cache || !cache.timestamp || typeof getCacheDurationMs !== "function") return false;
  const cacheMs = new Date(cache.timestamp).getTime();
  if (isNaN(cacheMs)) return false;
  const rawProvider = (cache.provider || "").replace(/ \(cached\)$/, "");
  return Date.now() - cacheMs <= getCacheDurationMs(rawProvider || "STAKTRAKR");
};

/**
 * Classifies how current this browser's spot data is.
 *
 * `fresh` < 60 min, `stale` 60 min – 24 hr or no data at all, `expired` > 24 hr,
 * per `SPOT_FRESH_MAX_MIN` / `SPOT_STALE_MAX_MIN` (js/utils.js). Those measure
 * LOCAL data age and are deliberately distinct from `API_HEALTH_SPOT_STALE_MIN`
 * (js/api-health.js), which measures publisher liveness — see either file.
 *
 * Resolution order:
 *   1. A cache entry still inside its provider's window reads `fresh` REGARDLESS
 *      of raw age. This is checked FIRST, and that ordering is load-bearing.
 *      `updateLastTimestamps` writes BOTH keys on every successful API sync, so
 *      checking `LAST_API_SYNC_KEY` first — as this function did until PR #1410
 *      review — meant a keyed provider with a 24 h cache reported `stale` at the
 *      90-minute mark while the app still considered the data valid and would
 *      not refetch it. That made the whole cache branch unreachable in
 *      production and left the indicator telling users to refresh when
 *      refreshing would do nothing.
 *   2. `LAST_API_SYNC_KEY` — plain age of the last real sync.
 *   3. `LAST_CACHE_REFRESH_KEY` — plain age, for a cache-only history.
 *   4. Nothing stored → `stale`, NOT `expired`. "No data" is a milder state than
 *      "data known to be a day old"; a fresh install must not open on red.
 *      `getHealthStatusClass(null)` returns `--red`, so this is handled here
 *      rather than delegated.
 * @returns {'fresh'|'stale'|'expired'}
 */
const getSpotFreshnessStatus = () => {
  const cache = _readFreshnessEntry(LAST_CACHE_REFRESH_KEY);
  if (_isCacheWithinProviderWindow(cache)) return "fresh";

  const entry = _readFreshnessEntry(LAST_API_SYNC_KEY);
  if (entry && entry.timestamp) {
    return _healthClassToFreshness(getHealthStatusClass(entry.timestamp));
  }

  if (cache && cache.timestamp) {
    return _healthClassToFreshness(getHealthStatusClass(cache.timestamp));
  }

  return "stale";
};
window.getSpotFreshnessStatus = getSpotFreshnessStatus;

const SPOT_FRESHNESS_CLASSES = [
  "spot-sync-icon--fresh",
  "spot-sync-icon--stale",
  "spot-sync-icon--expired",
];

/**
 * Paints the current freshness state onto the four `syncIcon{Metal}` buttons.
 *
 * SOLE WRITER of the `spot-sync-icon--*` modifiers. `updateSyncButtonStates`
 * (js/api.js) owns `disabled` / `title` / `.syncing` on the same elements and
 * calls this once per run so those two concerns compose instead of racing.
 *
 * Uses `classList` add/remove, never `className =`. The pre-STRK-291 body
 * assigned `className` wholesale, which was harmless on `#headerSyncDot` — a
 * bare span that existed only to be a dot — but here would wipe
 * `.spot-sync-icon` itself and the `.syncing` class mid-sync.
 * @returns {void}
 */
const applySpotFreshnessClasses = () => {
  const next = `spot-sync-icon--${getSpotFreshnessStatus()}`;
  const stale = SPOT_FRESHNESS_CLASSES.filter((cls) => cls !== next);
  Object.values(METALS).forEach((metalConfig) => {
    const icon = document.getElementById(`syncIcon${metalConfig.name}`);
    if (!icon) return;
    icon.classList.remove(...stale);
    icon.classList.add(next);
  });
};
window.applySpotFreshnessClasses = applySpotFreshnessClasses;

/**
 * Repaints the per-card refresh icons to match current spot-data freshness.
 *
 * STRK-291 retargeted this from the retired `#headerSyncDot` (STRK-284) onto the
 * four `syncIcon{Metal}` buttons. The NAME is kept deliberately: two call sites
 * depend on it — `init.js` boot and the post-sync hook in `updateLastTimestamps`
 * above — and renaming risks dropping the init.js one silently.
 *
 * Calls `applySpotFreshnessClasses` and nothing else. It must NOT delegate to
 * `updateSyncButtonStates()`: `updateLastTimestamps` fires this mid-sync, and
 * that function's `syncing` parameter defaults to false, so delegating would
 * clear the spinner and re-enable the button while the sync is still running.
 * @returns {void}
 */
const updateSpotSyncHealthDot = () => {
  applySpotFreshnessClasses();
};
window.updateSpotSyncHealthDot = updateSpotSyncHealthDot;

/**
 * Records a new spot price entry in history
 *
 * @param {number} newSpot - New spot price value
 * @param {string} source - Source of spot price ('manual', 'api', etc.)
 * @param {string} metal - Metal type ('Silver', 'Gold', 'Platinum', or 'Palladium')
 * @param {string|null} provider - Provider name if source is API-based
 * @param {string|null} timestamp - Optional ISO timestamp for historical entries
 */
const recordSpot = (newSpot, source, metal, provider = null, timestamp = null) => {
  purgeSpotHistory();
  const entryTimestamp = timestamp
    ? new Date(timestamp).toISOString().replace("T", " ").slice(0, 19)
    : new Date().toISOString().replace("T", " ").slice(0, 19);

  // Historical backfill (explicit timestamp): full-array dedup by timestamp+metal.
  // Real-time entries (no explicit timestamp): fast O(1) tail check.
  const isDuplicate = timestamp
    ? spotHistory.some((e) => e.timestamp === entryTimestamp && e.metal === metal)
    : spotHistory.length > 0 &&
      spotHistory[spotHistory.length - 1].spot === newSpot &&
      spotHistory[spotHistory.length - 1].metal === metal;

  if (!isDuplicate) {
    spotHistory.push({
      spot: newSpot,
      metal,
      source,
      provider,
      timestamp: entryTimestamp,
    });
  }
  if (source === "api" || source === "cached") {
    updateLastTimestamps(source, provider, entryTimestamp);
  }
  saveSpotHistory();
};

/**
 * Returns recent spot prices for a given metal from spotHistory.
 * Used by card-view sparklines (STAK-118).
 * @param {string} metal - Metal key ('silver', 'gold', etc.)
 * @param {number} [points=30] - Number of data points to return
 * @param {boolean} [withTimestamps=false] - If true, returns {ts, spot} objects
 * @returns {Array.<number>|Array.<{ts:number,spot:number}>|null} Array of spot prices, or null if insufficient data
 */
const getSpotHistoryForMetal = (metal, points = 30, withTimestamps = false) => {
  const metalName = Object.values(METALS).find((m) => m.key === metal)?.name || metal;
  const entries = spotHistory.filter((e) => e.metal === metalName);
  if (entries.length < 2) return null;
  const recent = entries.slice(-points);
  if (withTimestamps)
    return recent.map((e) => ({ ts: new Date(e.timestamp).getTime(), spot: e.spot }));
  return recent.map((e) => e.spot);
};

/**
 * Formats a spot price for its card's value line. Copper displays in the
 * industry-standard $/lb (STRK-306 display decision) while every stored,
 * synced, and computed value stays USD per troy ounce; the stored per-ozt
 * figure is mirrored into the value's hover title as a side effect so the
 * two can never desync (a visible second line broke the card's row
 * alignment against the other four — STRK-341 review). Other metals format
 * unchanged.
 * @param {string} metalKey - Metal key ('silver', 'gold', ..., 'copper')
 * @param {number} price - Spot price in USD per troy ounce
 * @returns {string} Display string for the card value line
 */
const formatSpotCardValue = (metalKey, price) => {
  const fmt = (v) => (typeof formatCurrency === "function" ? formatCurrency(v) : v.toFixed(2));
  if (metalKey !== "copper") return fmt(price);
  // safeGetElement per convention — a missing element yields a no-op dummy,
  // so the title write degrades harmlessly.
  const displayEl = safeGetElement("spotPriceDisplayCopper");
  displayEl.title = `${fmt(price)} /ozt stored · Shift+click to edit`;
  return `${fmt(price * TROY_OUNCES_PER_POUND)} /lb`;
};

/**
 * Updates spot card color based on price movement compared to last history entry
 *
 * @param {string} metalKey - Metal key ('silver', 'gold', etc.)
 * @param {number} newPrice - Newly set spot price
 */
const updateSpotCardColor = (metalKey, newPrice) => {
  const metalConfig = Object.values(METALS).find((m) => m.key === metalKey);
  if (!metalConfig) return;

  const el = elements.spotPriceDisplay[metalKey];
  if (!el) return;

  // Find the most recent API/manual entry with a DIFFERENT price.
  // This ensures the direction indicator persists across page refreshes —
  // cached reads reload the same price, so comparing against them (or against
  // the most recent same-price API entry) would always show "unchanged".
  const lastEntry = [...spotHistory]
    .reverse()
    .find((e) => e.metal === metalConfig.name && e.source !== "cached" && e.spot !== newPrice);

  let arrow = "";
  // updateSpotCardColor is the final writer in every price flow (API sync,
  // manual entry, reset, inline edit), so this is the single display-unit
  // conversion seam — earlier same-task textContent writes are overwritten
  // before the browser paints.
  const formatted = formatSpotCardValue(metalKey, newPrice);

  if (!lastEntry) {
    el.classList.remove("spot-up", "spot-down", "spot-unchanged");
    el.textContent = formatted;
    return;
  }

  if (newPrice > lastEntry.spot) {
    el.classList.add("spot-up");
    el.classList.remove("spot-down", "spot-unchanged");
    arrow = "\u25B2"; // Up arrow
  } else if (newPrice < lastEntry.spot) {
    el.classList.add("spot-down");
    el.classList.remove("spot-up", "spot-unchanged");
    arrow = "\u25BC"; // Down arrow
  } else {
    el.classList.add("spot-unchanged");
    el.classList.remove("spot-up", "spot-down");
    arrow = "=";
  }

  el.textContent = `${arrow} ${formatted}`.trim();
};

/**
 * Rehydrates per-metal localStorage spot keys from the unified Manual-mode
 * settings payload so Manual spot values survive sync and ZIP restore flows.
 *
 * @param {{force?: boolean, clearMissing?: boolean}} [options]
 * @returns {number} Count of per-metal keys written
 */
const syncManualSpotStorage = (options = {}) => {
  const { force = false, clearMissing = false } = options;
  const activeSource =
    typeof loadDataSync === "function" ? loadDataSync(SPOT_PRICING_SOURCE_KEY, null) : null;

  if (!force && activeSource !== "MANUAL") {
    return 0;
  }

  const manualPrices =
    typeof loadDataSync === "function" ? loadDataSync("metalSpotPrices", null) : null;
  const priceMap =
    manualPrices && typeof manualPrices === "object" && !Array.isArray(manualPrices)
      ? manualPrices
      : {};

  let applied = 0;
  Object.values(METALS).forEach((metalConfig) => {
    const rawValue = priceMap[metalConfig.key];
    if (rawValue === "" || rawValue == null) {
      if (clearMissing) localStorage.removeItem(metalConfig.localStorageKey);
      return;
    }
    const parsedValue = Number(rawValue);
    if (Number.isFinite(parsedValue) && parsedValue > 0) {
      localStorage.setItem(metalConfig.localStorageKey, String(parsedValue));
      applied++;
      return;
    }
    if (clearMissing) {
      localStorage.removeItem(metalConfig.localStorageKey);
    }
  });

  return applied;
};

/**
 * Fetches and displays current spot prices from localStorage or defaults
 */
const fetchSpotPrice = () => {
  syncManualSpotStorage();

  // Load spot prices for all metals
  Object.values(METALS).forEach((metalConfig) => {
    const storedSpot = localStorage.getItem(metalConfig.localStorageKey);
    if (storedSpot) {
      spotPrices[metalConfig.key] = parseFloat(storedSpot);
      if (
        elements.spotPriceDisplay[metalConfig.key] &&
        elements.spotPriceDisplay[metalConfig.key].textContent !== undefined
      ) {
        elements.spotPriceDisplay[metalConfig.key].textContent = formatCurrency(
          spotPrices[metalConfig.key]
        );
      }
    } else {
      // Use default price if no stored price
      const defaultPrice = metalConfig.defaultPrice;
      spotPrices[metalConfig.key] = defaultPrice;
      if (
        elements.spotPriceDisplay[metalConfig.key] &&
        elements.spotPriceDisplay[metalConfig.key].textContent !== undefined
      ) {
        elements.spotPriceDisplay[metalConfig.key].textContent = formatCurrency(
          spotPrices[metalConfig.key]
        );
      }
      // Don't record default prices in history automatically
    }

    // Update timestamp display
    const timestampElement = document.getElementById(`spotTimestamp${metalConfig.name}`);
    if (timestampElement) {
      updateSpotTimestamp(metalConfig.name);
    }

    // Update card color based on price movement
    updateSpotCardColor(metalConfig.key, spotPrices[metalConfig.key]);
  });

  updateSummary();

  // Goldback estimation hook — fire after all spots loaded (STACK-52)
  if (typeof onGoldSpotPriceChanged === "function") onGoldSpotPriceChanged();

  if (typeof renderRatioChips === "function") renderRatioChips();
};

/**
 * Updates spot price for specified metal from user input
 *
 * @param {string} metalKey - Key of metal to update ('silver', 'gold', 'platinum', 'palladium')
 */
const updateManualSpot = (metalKey) => {
  const metalConfig = Object.values(METALS).find((m) => m.key === metalKey);
  if (!metalConfig) return undefined;

  const input = elements.userSpotPriceInput[metalKey];
  const value = input.value;

  if (!value) return undefined;

  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) {
    appAlert(`Invalid ${metalConfig.name.toLowerCase()} spot price.`);
    return undefined;
  }

  localStorage.setItem(metalConfig.localStorageKey, num);
  spotPrices[metalKey] = num;

  if (
    elements.spotPriceDisplay[metalKey] &&
    elements.spotPriceDisplay[metalKey].textContent !== undefined
  ) {
    elements.spotPriceDisplay[metalKey].textContent = formatCurrency(spotPrices[metalKey]);
  }

  updateSpotCardColor(metalKey, num);
  recordSpot(num, "manual", metalConfig.name);

  // Update timestamp display
  const timestampElement = document.getElementById(`spotTimestamp${metalConfig.name}`);
  if (timestampElement) {
    updateSpotTimestamp(metalConfig.name);
  }

  updateSummary();

  // Snapshot item prices after manual spot change (STACK-43)
  if (typeof recordAllItemPriceSnapshots === "function") recordAllItemPriceSnapshots();

  // Goldback estimation hook (STACK-52)
  if (metalKey === "gold" && typeof onGoldSpotPriceChanged === "function") onGoldSpotPriceChanged();

  // Clear the input and hide the manual input section if available
  input.value = "";
  if (typeof hideManualInput === "function") {
    hideManualInput(metalConfig.name);
  }

  if (typeof renderRatioChips === "function") renderRatioChips();

  return undefined;
};

/**
 * Resets spot price for specified metal to default or API cached value
 *
 * @param {string} metalKey - Key of metal to reset ('silver', 'gold', 'platinum', 'palladium')
 */
const resetSpot = (metalKey) => {
  const metalConfig = Object.values(METALS).find((m) => m.key === metalKey);
  if (!metalConfig) return;

  let resetPrice = metalConfig.defaultPrice;
  let source = "default";
  let providerName = null;

  // If we have cached API data, use that instead
  if (typeof apiCache !== "undefined" && apiCache && apiCache.data && apiCache.data[metalKey]) {
    resetPrice = apiCache.data[metalKey];
    source = "api";
    providerName = API_PROVIDERS[apiCache.provider]?.name || null;
  }

  // Update price
  localStorage.setItem(metalConfig.localStorageKey, resetPrice.toString());
  spotPrices[metalKey] = resetPrice;

  // Update display
  if (
    elements.spotPriceDisplay[metalKey] &&
    elements.spotPriceDisplay[metalKey].textContent !== undefined
  ) {
    elements.spotPriceDisplay[metalKey].textContent = formatCurrency(spotPrices[metalKey]);
  }

  updateSpotCardColor(metalKey, resetPrice);

  // Record in history
  recordSpot(resetPrice, source, metalConfig.name, providerName);

  // Update timestamp display
  const timestampElement = document.getElementById(`spotTimestamp${metalConfig.name}`);
  if (timestampElement) {
    updateSpotTimestamp(metalConfig.name);
  }

  // Update summary
  updateSummary();

  // Snapshot item prices after spot reset (STACK-43)
  if (typeof recordAllItemPriceSnapshots === "function") recordAllItemPriceSnapshots();

  // Goldback estimation hook (STACK-52)
  if (metalKey === "gold" && typeof onGoldSpotPriceChanged === "function") onGoldSpotPriceChanged();

  // Hide manual input if shown and function is available
  if (typeof hideManualInput === "function") {
    hideManualInput(metalConfig.name);
  }
};

/**
 * Alternative reset function that works with metal name instead of key
 * This provides compatibility with the API.js resetSpotPrice function
 *
 * @param {string} metalName - Name of metal to reset ('Silver', 'Gold', etc.)
 */
const resetSpotByName = (metalName) => {
  const metalConfig = Object.values(METALS).find((m) => m.name === metalName);
  if (metalConfig) {
    resetSpot(metalConfig.key);
  }
};

// =============================================================================
// SPARKLINE FUNCTIONS
// =============================================================================

/**
 * Returns the theme-aware color for a metal sparkline by reading the
 * CSS custom property (--silver, --gold, etc.) from the active theme
 * via the shared getThemeColor() bridge.
 * @param {string} metalKey - 'silver', 'gold', 'platinum', 'palladium'
 * @returns {string} CSS color string
 */
const getMetalColor = (metalKey) => getThemeColorRGB(metalKey) || "#6366f1";

/**
 * Loads saved trend range preferences from localStorage
 * @returns {Object} Map of metal key → days (default 30)
 */
const loadTrendRanges = () => {
  try {
    const stored = loadDataSync(SPOT_TREND_RANGE_KEY, null);
    return stored && typeof stored === "object" ? stored : {};
  } catch (e) {
    return {};
  }
};

/**
 * Saves a single metal's trend range preference
 * @param {string} metalKey - Metal key
 * @param {number} days - Number of days
 */
const saveTrendRange = (metalKey, days) => {
  const ranges = loadTrendRanges();
  ranges[metalKey] = days;
  saveDataSync(SPOT_TREND_RANGE_KEY, ranges);
};

// =============================================================================
// HISTORICAL DATA — YEAR-FILE FETCH & CACHE (STACK-69)
// =============================================================================

/** @type {Map<number, Array>} Cached year-file entries keyed by year */
const historicalDataCache = new Map();

/** @type {Map<number, Promise<Array>>} In-flight fetch promises to deduplicate concurrent requests */
const historicalFetchPromises = new Map();

/**
 * Calculates which year files are needed for a given lookback period.
 * @param {number} days - Number of days to look back
 * @returns {number[]} Array of year numbers to fetch
 */
const getRequiredYears = (days) => {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const startYear = cutoff.getFullYear();
  const endYear = now.getFullYear();
  const years = [];
  for (let y = startYear; y <= endYear; y++) {
    years.push(y);
  }
  return years;
};

/** @constant {string} Remote base URL for historical data (file:// fallback) */
const HISTORICAL_DATA_REMOTE = "https://staktrakr.com/data/";

const SUPPORTED_SPOT_METALS = new Set(["Gold", "Silver", "Platinum", "Palladium", "Copper"]);

/**
 * Synchronous historical spot lookup from the in-memory cache only.
 * Searches the target year and adjacent years with progressive date widening.
 * @param {string} metalName - Metal name (any casing, e.g. "gold", "SILVER")
 * @param {string} dateStr - Target date in "YYYY-MM-DD" format
 * @returns {number|null} Spot price or null if not found
 */
const lookupHistoricalSpot = (metalName, dateStr) => {
  if (typeof metalName !== "string" || typeof dateStr !== "string") return null;
  const trimmedMetal = metalName.trim();
  if (!trimmedMetal) return null;
  const normalized = trimmedMetal.charAt(0).toUpperCase() + trimmedMetal.slice(1).toLowerCase();
  if (!SUPPORTED_SPOT_METALS.has(normalized)) return null;

  const yearMatch = dateStr.match(/^(\d{4})-/);
  if (!yearMatch) return null;
  const targetYear = parseInt(yearMatch[1], 10);

  const targetDate = new Date(dateStr + "T00:00:00");
  if (isNaN(targetDate.getTime())) return null;
  const targetMs = targetDate.getTime();

  const yearEntries = [
    ...(historicalDataCache.get(targetYear - 1) || []),
    ...(historicalDataCache.get(targetYear) || []),
    ...(historicalDataCache.get(targetYear + 1) || []),
  ].filter((e) => e.metal === normalized);

  if (yearEntries.length === 0) return null;

  const MS_PER_DAY = 86400000;
  const windows = [0, 1, 3, 7];
  for (const windowDays of windows) {
    const windowMs = windowDays * MS_PER_DAY;
    const matches = yearEntries
      .filter((e) => {
        const entryDate = new Date(e.timestamp.slice(0, 10) + "T00:00:00");
        if (isNaN(entryDate.getTime())) return false;
        return Math.abs(entryDate.getTime() - targetMs) <= windowMs;
      })
      .map((e) => {
        const entryDate = new Date(e.timestamp.slice(0, 10) + "T00:00:00");
        const dayOffset = Math.abs(entryDate.getTime() - targetMs) / MS_PER_DAY;
        return { spot: e.spot, dayOffset, timestamp: e.timestamp };
      })
      .sort((a, b) => a.dayOffset - b.dayOffset || b.timestamp.localeCompare(a.timestamp));

    if (matches.length > 0) return matches[0].spot;
  }

  return null;
};

/**
 * Loads a local JSON file via XMLHttpRequest (sync-free).
 * Broader file:// compatibility than fetch() — works in Firefox/Safari
 * and Chrome with --allow-file-access-from-files.
 * @param {string} url - Relative or absolute URL to JSON file
 * @returns {Promise<any>} Parsed JSON
 */
const xhrLoadJSON = (url) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = "json";
    xhr.onload = () => {
      if (xhr.status === 200 || (xhr.status === 0 && xhr.response)) {
        resolve(xhr.response);
      } else {
        reject(new Error(`XHR ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("XHR network error"));
    xhr.send();
  });

/**
 * Fetches a single year file from data/spot-history-{year}.json.
 * Three-tier loading: local fetch → local XHR → remote staktrakr.com.
 * Caches the result (or empty array on failure) to avoid retries.
 * Deduplicates concurrent fetches for the same year.
 * @param {number} year - Year to fetch
 * @returns {Promise<Array>} Array of spot history entries
 */
const fetchYearFile = (year) => {
  // Already cached — return immediately
  if (historicalDataCache.has(year)) {
    return Promise.resolve(historicalDataCache.get(year));
  }

  // Already in-flight — return shared promise
  if (historicalFetchPromises.has(year)) {
    return historicalFetchPromises.get(year);
  }

  const filename = `spot-history-${year}.json`;
  const localUrl = `data/${filename}`;
  const remoteUrl = `${HISTORICAL_DATA_REMOTE}${filename}`;

  const promise = fetch(localUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .catch(() => xhrLoadJSON(localUrl)) // Fallback 1: XHR for file://
    .catch(() =>
      fetch(remoteUrl) // Fallback 2: remote staktrakr.com
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
    )
    .then((entries) => {
      // Validate: must be an array of objects with spot/metal/timestamp
      if (!Array.isArray(entries)) {
        historicalDataCache.set(year, []);
        return [];
      }
      const valid = entries.filter(
        (e) => e && typeof e.spot === "number" && e.metal && e.timestamp
      );
      historicalDataCache.set(year, valid);
      return valid;
    })
    .catch(() => {
      // All three methods failed — cache empty to avoid retries
      historicalDataCache.set(year, []);
      return [];
    })
    .finally(() => {
      historicalFetchPromises.delete(year);
    });

  historicalFetchPromises.set(year, promise);
  return promise;
};

/**
 * Fetches needed year files, merges with live spotHistory, filters to
 * metal + range, deduplicates by day (live data wins over seed).
 * @param {string} metalName - Metal name ('Silver', 'Gold', etc.)
 * @param {number} days - Number of days to look back
 * @returns {Promise<{ labels: string[], data: number[] }>} Arrays for Chart.js
 */
const getHistoricalSparklineData = async (metalName, days) => {
  const years = getRequiredYears(days);
  const yearArrays = await Promise.all(years.map(fetchYearFile));

  // Merge all historical entries
  const allHistorical = yearArrays.flat();

  // Cutoff date
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // Combine: historical + live spotHistory (STAK-222: exclude cached entries from charts)
  const combined = [...allHistorical, ...spotHistory.filter((e) => e.source !== "cached")]
    .filter((e) => e.metal === metalName && new Date(e.timestamp) >= cutoff)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Deduplicate by day — live data (non-seed) wins over seed
  const byDay = new Map();
  combined.forEach((e) => {
    const day = e.timestamp.slice(0, 10);
    const existing = byDay.get(day);
    if (!existing || existing.source === "seed") {
      byDay.set(day, e);
    }
  });

  const sorted = [...byDay.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return {
    labels: sorted.map((e) => e.timestamp.slice(0, 10)),
    data: sorted.map((e) => e.spot),
  };
};

// =============================================================================

/**
 * Extracts sparkline data from spotHistory for a given metal and date range
 * @param {string} metalName - Metal name ('Silver', 'Gold', etc.)
 * @param {number} days - Number of days to look back
 * @param {boolean} [intraday=false] - If true, keep all entries (no per-day dedup)
 *   and use midnight cutoff instead of current-time offset (STACK-66)
 * @returns {{ labels: string[], data: number[] }} Arrays for Chart.js
 */
const getSparklineData = (metalName, days, intraday = false) => {
  const cutoff = new Date();
  if (intraday) {
    // Use midnight of N days ago for clean calendar-day boundaries
    cutoff.setDate(cutoff.getDate() - days);
    cutoff.setHours(0, 0, 0, 0);
  } else {
    cutoff.setDate(cutoff.getDate() - days);
  }

  const entries = spotHistory
    .filter(
      (e) => e.metal === metalName && e.source !== "cached" && new Date(e.timestamp) >= cutoff
    )
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (intraday) {
    // Deduplicate by timestamp — bulk hourly seed loads can produce duplicate timestamps
    const seen = new Set();
    const deduped = entries.filter((e) => {
      if (seen.has(e.timestamp)) return false;
      seen.add(e.timestamp);
      return true;
    });
    return {
      labels: deduped.map((e) => e.timestamp.slice(11, 16)), // "HH:MM"
      data: deduped.map((e) => e.spot),
    };
  }

  // Track first and last entry per day for open/close comparison (STACK-92)
  const byDay = new Map();
  entries.forEach((e) => {
    const day = e.timestamp.slice(0, 10);
    if (!byDay.has(day)) {
      byDay.set(day, { first: e, last: e });
    } else {
      byDay.get(day).last = e;
    }
  });

  const sorted = [...byDay.values()].sort(
    (a, b) => new Date(a.last.timestamp) - new Date(b.last.timestamp)
  );

  return {
    labels: sorted.map((pair) => pair.last.timestamp.slice(0, 10)),
    data: sorted.map((pair) => pair.last.spot), // close prices (backward-compatible)
    openData: sorted.map((pair) => pair.first.spot), // open prices (STACK-92)
  };
};

/**
 * Renders or updates a sparkline chart for a single metal card.
 * For ranges >180 days, fetches historical year files asynchronously.
 * @param {string} metalKey - Metal key ('silver', 'gold', etc.)
 */
const updateSparkline = async (metalKey) => {
  const metalConfig = Object.values(METALS).find((m) => m.key === metalKey);
  if (!metalConfig) return;

  const canvasId = `sparkline${metalConfig.name}`;
  const canvas = document.getElementById(canvasId);
  if (!canvas || !canvas.getContext) return;

  // Destroy existing chart instance early to avoid stale visuals during async fetch
  if (sparklineInstances[metalKey] && typeof sparklineInstances[metalKey].destroy === "function") {
    sparklineInstances[metalKey].destroy();
    sparklineInstances[metalKey] = null;
  }

  // Determine range from dropdown or saved preference
  const rangeSelect = document.getElementById(`spotRange${metalConfig.name}`);
  const days = rangeSelect ? parseInt(rangeSelect.value, 10) : 90;

  // 1-day view: try 1-day intraday window first, widen to 3 if too few points
  const isIntraday = days === 1;
  let effectiveDays = isIntraday ? 1 : days;

  let labels, data;

  if (effectiveDays > 180) {
    // Historical range — async fetch year files (STACK-69)
    if (rangeSelect) rangeSelect.disabled = true;
    try {
      ({ labels, data } = await getHistoricalSparklineData(metalConfig.name, effectiveDays));
    } finally {
      if (rangeSelect) rangeSelect.disabled = false;
    }
  } else {
    ({ labels, data } = getSparklineData(metalConfig.name, effectiveDays, isIntraday));
  }

  // Adaptive fallback: if 1-day window has too few points, widen to 3 days
  if (isIntraday && data.length < 2) {
    ({ labels, data } = getSparklineData(metalConfig.name, 3, true));
  }

  // Need at least 2 data points for a meaningful line
  if (data.length < 2) {
    updateSpotChangePercent(metalKey, data);
    return;
  }

  const ctx = canvas.getContext("2d");
  const color = getMetalColor(metalKey);

  // Create gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 80);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "transparent");

  const sparklineConfig = {
    type: "line",
    data: {
      datasets: [
        {
          data: data.map((val, i) => ({ x: i, y: val })),
          borderColor: color,
          backgroundColor: gradient,
          fill: true,
          borderWidth: 1.5,
          pointRadius: 0,
          tension: isIntraday ? 0 : 0.3,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 6, right: 0, bottom: 0, left: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      scales: {
        x: {
          type: "linear",
          display: false,
          min: 0,
          max: data.length - 1,
        },
        y: {
          display: false,
          beginAtZero: false,
          suggestedMin: data.length ? Math.min(...data) * 0.99 : undefined,
          suggestedMax: data.length ? Math.max(...data) * 1.01 : undefined,
        },
      },
      animation: { duration: 400 },
      interaction: { enabled: false },
    },
  };
  replaceChart(sparklineInstances, metalKey, canvas, sparklineConfig);

  updateSpotChangePercent(metalKey, data);
};

/**
 * Computes 24h % change using the user's selected comparison mode (STACK-92).
 * Modes: close-close (default), open-open, open-close.
 * Graceful degradation: when only 1 entry/day exists, first === last so all modes match.
 * @param {string} metalName - 'Silver', 'Gold', etc.
 * @returns {{ pct: number, valid: boolean }}
 */
const get24hChange = (metalName) => {
  const mode = localStorage.getItem(SPOT_COMPARE_MODE_KEY) || "close-close";
  const { data: closeData, openData } = getSparklineData(metalName, 3, false);

  if (closeData.length < 2) return { pct: 0, valid: false };

  const yesterday = closeData.length - 2;
  const today = closeData.length - 1;
  let oldPrice, newPrice;

  switch (mode) {
    case "open-open":
      oldPrice = openData[yesterday];
      newPrice = openData[today];
      break;
    case "open-close":
      oldPrice = openData[yesterday];
      newPrice = closeData[today];
      break;
    default: // 'close-close'
      oldPrice = closeData[yesterday];
      newPrice = closeData[today];
      break;
  }

  if (!oldPrice || oldPrice === 0) return { pct: 0, valid: false };
  return { pct: ((newPrice - oldPrice) / oldPrice) * 100, valid: true };
};

/**
 * Computes and displays % change on a spot card based on the selected sparkline period.
 * Compares oldest vs newest data point in the selected range.
 *
 * @param {string} metalKey - Metal key ('silver', 'gold', etc.)
 * @param {number[]|null} [precomputedData=null] - Pre-fetched data array from updateSparkline
 *   (avoids redundant re-fetch for historical ranges). When null, uses sync getSparklineData().
 */
const updateSpotChangePercent = (metalKey, precomputedData = null) => {
  const metalConfig = Object.values(METALS).find((m) => m.key === metalKey);
  if (!metalConfig) return;
  const el = document.getElementById(`spotChange${metalConfig.name}`);
  if (!el) return;

  const rangeSelectEl0 = document.getElementById(`spotRange${metalConfig.name}`);
  const selectedDays0 = rangeSelectEl0 ? parseInt(rangeSelectEl0.value, 10) : 90;

  let data;
  if (selectedDays0 === 1) {
    // 1-day view: use get24hChange() which respects the user's comparison mode (STACK-92)
    ({ data } = getSparklineData(metalConfig.name, 3, false));
  } else if (precomputedData) {
    data = precomputedData;
  } else {
    ({ data } = getSparklineData(metalConfig.name, selectedDays0));
  }

  if (data.length < 2) {
    el.textContent = "";
    return;
  }

  // For 1d view, use get24hChange() for mode-aware comparison (STACK-92).
  // For all other views, compare oldest→newest across the full selected range.
  let pctChange;
  if (selectedDays0 === 1) {
    const change24h = get24hChange(metalConfig.name);
    pctChange = change24h.valid ? change24h.pct : 0;
  } else {
    const oldest = data[0];
    const newest = data[data.length - 1];
    pctChange = ((newest - oldest) / oldest) * 100;
  }
  const sign = pctChange > 0 ? "+" : "";
  const rangeClass = pctChange > 0 ? "spot-change-up" : pctChange < 0 ? "spot-change-down" : "";

  // Build DOM: range % (colored) + optional 24h % (independently colored)
  el.className = "spot-card-change";
  el.textContent = "";

  const rangeSpan = document.createElement("span");
  rangeSpan.className = rangeClass;
  rangeSpan.textContent = `${sign}${pctChange.toFixed(2)}%`;
  el.appendChild(rangeSpan);

  // Append secondary % indicator in parentheses (STACK-69, STACK-92)
  // >1d views: show 24h change (mode-aware) | 1d view: show 90d change for context
  if (selectedDays0 > 1) {
    const change24h = get24hChange(metalConfig.name);
    if (change24h.valid) {
      const dayPct = change24h.pct;
      const daySign = dayPct > 0 ? "+" : "";
      const dayClass = dayPct > 0 ? "spot-change-up" : dayPct < 0 ? "spot-change-down" : "";

      const daySpan = document.createElement("span");
      daySpan.className = dayClass;
      daySpan.textContent = ` (${daySign}${dayPct.toFixed(2)}% 24h)`;
      el.appendChild(daySpan);
    }
  } else {
    // 1d view: show 90d context
    const { data: ctx90 } = getSparklineData(metalConfig.name, 90);
    if (ctx90.length >= 2) {
      const ctxOld = ctx90[0];
      const ctxNew = ctx90[ctx90.length - 1];
      const ctxPct = ((ctxNew - ctxOld) / ctxOld) * 100;
      const ctxSign = ctxPct > 0 ? "+" : "";
      const ctxClass = ctxPct > 0 ? "spot-change-up" : ctxPct < 0 ? "spot-change-down" : "";

      const ctxSpan = document.createElement("span");
      ctxSpan.className = ctxClass;
      ctxSpan.textContent = ` (${ctxSign}${ctxPct.toFixed(2)}% 90d)`;
      el.appendChild(ctxSpan);
    }
  }

  // Override the arrow direction on the price display to match the period-based
  // trend. updateSpotCardColor() compares against the last different price in ALL
  // history, but the user expects the arrow to reflect the selected period.
  const priceEl = elements.spotPriceDisplay[metalKey];
  if (priceEl) {
    const currentPrice = spotPrices[metalKey];
    // Same display seam as updateSpotCardColor — copper renders $/lb here too.
    const formatted = formatSpotCardValue(metalKey, currentPrice);

    if (pctChange > 0) {
      priceEl.classList.add("spot-up");
      priceEl.classList.remove("spot-down", "spot-unchanged");
      priceEl.textContent = `\u25B2 ${formatted}`;
    } else if (pctChange < 0) {
      priceEl.classList.add("spot-down");
      priceEl.classList.remove("spot-up", "spot-unchanged");
      priceEl.textContent = `\u25BC ${formatted}`;
    } else {
      priceEl.classList.add("spot-unchanged");
      priceEl.classList.remove("spot-up", "spot-down");
      priceEl.textContent = `= ${formatted}`;
    }
  }

  if (typeof renderRatioChips === "function") renderRatioChips();
};

/**
 * Refreshes sparklines on all 4 metal cards concurrently
 */
const updateAllSparklines = async () => {
  await Promise.all(Object.values(METALS).map((mc) => updateSparkline(mc.key)));
};

/**
 * Destroys all sparkline Chart.js instances (cleanup)
 */
const destroySparklines = () => {
  Object.keys(sparklineInstances).forEach((key) => {
    if (sparklineInstances[key]) {
      sparklineInstances[key].destroy();
      sparklineInstances[key] = null;
    }
  });
};

/**
 * Opens an inline input on a spot card price for manual editing (shift+click)
 * @param {HTMLElement} valueEl - The .spot-card-value element that was clicked
 * @param {string} metalKey - Metal key ('silver', 'gold', etc.)
 */
const startSpotInlineEdit = (valueEl, metalKey) => {
  if (valueEl.querySelector(".spot-inline-input")) return; // already editing

  const metalConfig = Object.values(METALS).find((m) => m.key === metalKey);
  if (!metalConfig) return;

  const currentPrice = spotPrices[metalKey] || 0;
  const originalHTML = valueEl.innerHTML;

  // Copper edits in the unit the card displays ($/lb, STRK-306); the saved
  // value converts back to the stored per-ozt frame below.
  const isCopper = metalKey === "copper";
  const editPrice = isCopper ? currentPrice * TROY_OUNCES_PER_POUND : currentPrice;

  const input = document.createElement("input");
  input.type = "number";
  input.className = "spot-inline-input";
  input.value = editPrice > 0 ? editPrice.toFixed(2) : "";
  input.step = "0.01";
  input.min = "0";

  valueEl.textContent = "";
  valueEl.appendChild(input);
  input.focus();
  input.select();

  const cancel = () => {
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
    valueEl.innerHTML = originalHTML;
  };

  const save = () => {
    const entered = parseFloat(input.value);
    if (isNaN(entered) || entered <= 0) {
      cancel();
      return;
    }

    // Convert a copper $/lb entry back to the stored per-ozt frame.
    const num = isCopper ? entered / TROY_OUNCES_PER_POUND : entered;

    localStorage.setItem(metalConfig.localStorageKey, num);
    spotPrices[metalKey] = num;
    valueEl.textContent = formatSpotCardValue(metalKey, num);
    updateSpotCardColor(metalKey, num);
    recordSpot(num, "manual", metalConfig.name);
    updateSpotTimestamp(metalConfig.name);
    updateSummary();
    updateSparkline(metalKey);

    // Snapshot item prices after inline spot edit (STACK-43)
    if (typeof recordAllItemPriceSnapshots === "function") recordAllItemPriceSnapshots();

    // Goldback estimation hook (STACK-52)
    if (metalKey === "gold" && typeof onGoldSpotPriceChanged === "function")
      onGoldSpotPriceChanged();

    if (typeof renderRatioChips === "function") renderRatioChips();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });

  input.addEventListener("blur", cancel);
};

// =============================================================================
// SPOT HISTORY — SETTINGS LOG TABLE
// =============================================================================

/** @type {string} Current sort column for settings spot history table */
let settingsSpotSortColumn = "";
/** @type {boolean} Sort ascending for settings spot history table */
let settingsSpotSortAsc = true;

/**
 * Renders the spot price history table in the Settings > Activity Log > Metals sub-tab.
 * Reads from the global spotHistory array and sorts by timestamp descending by default.
 */
const renderSpotHistoryTable = () => {
  const table = document.getElementById("settingsSpotHistoryTable");
  if (!table) return;

  // STRK-141: spotHistory is the boot-hydrated, always-current global; the former
  // sync loadSpotHistory() reload is now async and vestigial — read the global.
  let data = [...spotHistory];

  // Sort
  if (settingsSpotSortColumn) {
    data.sort((a, b) => {
      const valA = a[settingsSpotSortColumn];
      const valB = b[settingsSpotSortColumn];
      if (valA < valB) return settingsSpotSortAsc ? -1 : 1;
      if (valA > valB) return settingsSpotSortAsc ? 1 : -1;
      return 0;
    });
  } else {
    data.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }

  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  if (data.length === 0) {
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
    tbody.innerHTML =
      '<tr class="settings-log-empty"><td colspan="5">No spot price history recorded yet.</td></tr>';
    return;
  }

  const rows = data.map((e) => {
    const ts = e.timestamp
      ? typeof formatTimestamp === "function"
        ? formatTimestamp(e.timestamp)
        : new Date(e.timestamp).toLocaleString()
      : "";
    const metal = e.metal || "";
    const price =
      typeof formatCurrency === "function"
        ? formatCurrency(e.spot)
        : `$${Number(e.spot).toFixed(2)}`;
    const source = e.source || "";
    const provider = e.source === "seed" ? "Seed" : e.provider || "";
    return `<tr><td>${ts}</td><td>${escapeHtml(metal)}</td><td>${price}</td><td>${escapeHtml(source)}</td><td>${escapeHtml(provider)}</td></tr>`;
  });

  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  tbody.innerHTML = rows.join("");

  // Sortable headers
  table.querySelectorAll("th").forEach((th) => {
    th.style.cursor = "pointer";
    th.onclick = () => {
      const cols = ["timestamp", "metal", "spot", "source", "provider"];
      const idx = Array.from(th.parentNode.children).indexOf(th);
      const col = cols[idx];
      if (settingsSpotSortColumn === col) {
        settingsSpotSortAsc = !settingsSpotSortAsc;
      } else {
        settingsSpotSortColumn = col;
        settingsSpotSortAsc = true;
      }
      renderSpotHistoryTable();
    };
  });
};

/** @type {string} Current sort column for settings LBMA reference table */
let settingsLbmaSortColumn = "";
/** @type {boolean} Sort ascending for settings LBMA reference table */
let settingsLbmaSortAsc = true;
/** @type {Array<Object>|null} Cached LBMA reference entries */
let settingsLbmaReferenceCache = null;
/** @type {Promise<Array<Object>>|null} In-flight LBMA load promise */
let settingsLbmaLoadPromise = null;
/** @type {boolean} Prevent duplicate LBMA control binding */
let settingsLbmaControlsBound = false;

/**
 * Returns the seed years configured for bundled LBMA reference data.
 * Falls back to current year when the seed config is unavailable.
 *
 * @returns {number[]} Sorted list of years
 */
const getLbmaReferenceYears = () => {
  if (
    typeof SEED_DATA_YEARS !== "undefined" &&
    Array.isArray(SEED_DATA_YEARS) &&
    SEED_DATA_YEARS.length > 0
  ) {
    return [
      ...new Set(SEED_DATA_YEARS.map((y) => parseInt(y, 10)).filter((y) => Number.isFinite(y))),
    ].sort((a, b) => a - b);
  }
  return [new Date().getFullYear()];
};

/**
 * Loads and caches LBMA reference entries from yearly seed files.
 * Uses fetchYearFile() for file:// and HTTP compatibility.
 *
 * @returns {Promise<Array<Object>>} Flattened LBMA reference entries
 */
const loadLbmaReferenceEntries = async () => {
  if (Array.isArray(settingsLbmaReferenceCache)) return settingsLbmaReferenceCache;
  if (settingsLbmaLoadPromise) return settingsLbmaLoadPromise;

  settingsLbmaLoadPromise = Promise.all(getLbmaReferenceYears().map(fetchYearFile))
    .then((yearArrays) => {
      let entries = yearArrays
        .flat()
        .filter((e) => e && typeof e.spot === "number" && e.metal && e.timestamp)
        .filter((e) => e.source === "seed" || String(e.provider || "").toUpperCase() === "LBMA");

      // Final fallback for unusual file:// cases where year files fail entirely.
      if (entries.length === 0 && typeof getEmbeddedSeedData === "function") {
        entries = getEmbeddedSeedData().filter(
          (e) => e && typeof e.spot === "number" && e.metal && e.timestamp
        );
      }

      settingsLbmaReferenceCache = entries.map((e) => ({
        ...e,
        provider: e.provider || "LBMA",
      }));
      return settingsLbmaReferenceCache;
    })
    .catch(() => {
      settingsLbmaReferenceCache = [];
      return settingsLbmaReferenceCache;
    })
    .finally(() => {
      settingsLbmaLoadPromise = null;
    });

  return settingsLbmaLoadPromise;
};

/**
 * Binds LBMA history filter controls once.
 */
const bindLbmaHistoryControls = () => {
  if (settingsLbmaControlsBound) return;

  const metalFilter = document.getElementById("settingsLbmaMetalFilter");
  const startDate = document.getElementById("settingsLbmaStartDate");
  const endDate = document.getElementById("settingsLbmaEndDate");
  const resetBtn = document.getElementById("settingsLbmaResetBtn");
  if (!metalFilter || !startDate || !endDate || !resetBtn) return;

  const rerender = () => {
    renderLbmaHistoryTable();
  };

  metalFilter.addEventListener("change", rerender);
  startDate.addEventListener("change", rerender);
  endDate.addEventListener("change", rerender);
  resetBtn.addEventListener("click", () => {
    metalFilter.value = "all";
    startDate.value = "";
    endDate.value = "";
    renderLbmaHistoryTable();
  });

  settingsLbmaControlsBound = true;
};

/**
 * Renders the Settings > Activity Log > LBMA History reference table.
 * Data source is bundled year files (seed reference data), not user spotHistory.
 */
const renderLbmaHistoryTable = async () => {
  const table = document.getElementById("settingsLbmaHistoryTable");
  if (!table) return;
  bindLbmaHistoryControls();

  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  const resultCountEl = document.getElementById("settingsLbmaResultCount");
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  tbody.innerHTML =
    '<tr class="settings-log-empty"><td colspan="4">Loading LBMA reference history…</td></tr>';

  const allEntries = await loadLbmaReferenceEntries();
  const metalFilter = (
    document.getElementById("settingsLbmaMetalFilter")?.value || "all"
  ).toLowerCase();
  const startDate = document.getElementById("settingsLbmaStartDate")?.value || "";
  const endDate = document.getElementById("settingsLbmaEndDate")?.value || "";

  let data = [...allEntries];

  if (metalFilter !== "all") {
    data = data.filter((e) => String(e.metal || "").toLowerCase() === metalFilter);
  }
  if (startDate) {
    data = data.filter((e) => String(e.timestamp || "").slice(0, 10) >= startDate);
  }
  if (endDate) {
    data = data.filter((e) => String(e.timestamp || "").slice(0, 10) <= endDate);
  }

  if (settingsLbmaSortColumn) {
    data.sort((a, b) => {
      const getSortVal = (entry) => {
        if (settingsLbmaSortColumn === "spot") return Number(entry.spot) || 0;
        if (settingsLbmaSortColumn === "metal") return String(entry.metal || "").toLowerCase();
        if (settingsLbmaSortColumn === "provider")
          return String(entry.provider || "").toLowerCase();
        return String(entry.timestamp || "");
      };
      const valA = getSortVal(a);
      const valB = getSortVal(b);
      if (valA < valB) return settingsLbmaSortAsc ? -1 : 1;
      if (valA > valB) return settingsLbmaSortAsc ? 1 : -1;
      return 0;
    });
  } else {
    data.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }

  if (resultCountEl) {
    resultCountEl.textContent = `${data.length.toLocaleString()} rows`;
  }

  if (data.length === 0) {
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
    tbody.innerHTML =
      '<tr class="settings-log-empty"><td colspan="4">No LBMA reference rows match the current filters.</td></tr>';
  } else {
    const rows = data.map((entry) => {
      const rawDate = String(entry.timestamp || "").slice(0, 10);
      const dateLabel = rawDate
        ? typeof formatDisplayDate === "function"
          ? formatDisplayDate(rawDate)
          : rawDate
        : "";
      const metal = escapeHtml(entry.metal || "");
      const spot =
        typeof formatCurrency === "function"
          ? formatCurrency(entry.spot)
          : `$${Number(entry.spot).toFixed(2)}`;
      const provider = escapeHtml(entry.provider || "LBMA");
      return `<tr><td>${dateLabel}</td><td>${metal}</td><td>${spot}</td><td>${provider}</td></tr>`;
    });
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
    tbody.innerHTML = rows.join("");
  }

  table.querySelectorAll("th").forEach((th, idx) => {
    th.style.cursor = "pointer";
    th.onclick = () => {
      const cols = ["date", "metal", "spot", "provider"];
      const nextCol = cols[idx];
      if (settingsLbmaSortColumn === nextCol) {
        settingsLbmaSortAsc = !settingsLbmaSortAsc;
      } else {
        settingsLbmaSortColumn = nextCol;
        settingsLbmaSortAsc = true;
      }
      renderLbmaHistoryTable();
    };
  });
};

/**
 * Clears all spot price history after user confirmation.
 */
const clearSpotHistory = async () => {
  const confirmed = await appConfirm(
    "Clear all spot price history? This cannot be undone.",
    "Spot History"
  );
  if (!confirmed) return;
  spotHistory = [];
  saveSpotHistory();
  // Reset rendered flag so it re-renders fresh
  const panel = document.getElementById("logPanel_metals");
  if (panel) delete panel.dataset.rendered;
  renderSpotHistoryTable();
};

// =============================================================================

// ---------------------------------------------------------------------------
// Seed bundle loader (file:// protocol support)
// ---------------------------------------------------------------------------
// data/spot-history-bundle.js calls this function on load.
// Compact format: { year: { metal: [[MM-DD, price], ...] } }
// Expands into full historicalDataCache entries so fetchYearFile() finds
// cached data immediately without network requests.
/**
 * Loads the spot history seed bundle into the cache.
 * @param {Object} bundle - The spot history seed bundle.
 */
window._loadSpotSeedBundle = function (bundle) {
  let loaded = 0;
  for (const yearStr of Object.keys(bundle)) {
    const year = parseInt(yearStr, 10);
    if (historicalDataCache.has(year) && historicalDataCache.get(year).length > 0) continue;
    const metals = bundle[yearStr];
    const entries = [];
    for (const metal of Object.keys(metals)) {
      for (const pair of metals[metal]) {
        entries.push({
          spot: pair[1],
          metal: metal,
          source: "seed",
          provider: "LBMA",
          timestamp: yearStr + "-" + pair[0] + " 12:00:00",
        });
      }
    }
    historicalDataCache.set(year, entries);
    loaded += entries.length;
  }
  if (loaded > 0) {
    console.log(
      "[SpotSeed] Loaded " +
        loaded +
        " entries from bundle (" +
        Object.keys(bundle).length +
        " years)"
    );
  }
};

if (typeof window !== "undefined") {
  window.addEventListener("currencychange", () => {
    if (typeof updateAllSparklines === "function") {
      void updateAllSparklines().catch((e) => {
        if (typeof debugLog === "function") {
          debugLog("[spot] currencychange refresh failed: " + e.message, "warn");
        }
      });
    }
  });
}

// Ensure global availability
window.fetchSpotPrice = fetchSpotPrice;
window.syncManualSpotStorage = syncManualSpotStorage;
window.updateSpotCardColor = updateSpotCardColor;
window.formatSpotCardValue = formatSpotCardValue;
window.updateSparkline = updateSparkline;
window.updateAllSparklines = updateAllSparklines;
window.destroySparklines = destroySparklines;
window.updateSpotChangePercent = updateSpotChangePercent;
window.startSpotInlineEdit = startSpotInlineEdit;
window.getMetalColor = getMetalColor;
window.loadTrendRanges = loadTrendRanges;
window.saveTrendRange = saveTrendRange;
window.renderSpotHistoryTable = renderSpotHistoryTable;
window.renderLbmaHistoryTable = renderLbmaHistoryTable;
window.clearSpotHistory = clearSpotHistory;
window.saveSpotHistory = saveSpotHistory;
// STRK-141: expose async load + the relocated boot migration so init.js (task 7)
// can await them in the boot sequence after historyStore.init()/migrate().
window.loadSpotHistory = loadSpotHistory;
window.migrateHourlySource = migrateHourlySource;
window.getHistoricalSparklineData = getHistoricalSparklineData;
window.getRequiredYears = getRequiredYears;
window.fetchYearFile = fetchYearFile;
window.lookupHistoricalSpot = lookupHistoricalSpot;
window.historicalDataCache = historicalDataCache;
// STAK-222: Expose spotHistory via getter so window.spotHistory always reflects current array.
// STRK-141: add a setter (mirroring inventory/changeLog in state.js) so window.spotHistory is
// assignable — required by the quota-safety test and good state-exposure hygiene. The `spotHistory`
// binding lives in state.js but is a shared script-tag global, so this setter reassigns it.
Object.defineProperty(window, "spotHistory", {
  get: () => spotHistory,
  set: (val) => {
    spotHistory = val;
  },
  configurable: true,
});

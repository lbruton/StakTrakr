// RETAIL MARKET PRICES
// =============================================================================

/** All tracked coin slugs, display order */
const RETAIL_SLUGS = [
  "ase", "maple-silver", "britannia-silver", "krugerrand-silver",
  "kangaroo-silver", "koala-silver", "kookaburra-silver",
  "generic-silver-round", "generic-silver-bar-10oz",
  "age", "buffalo", "maple-gold", "krugerrand-gold", "ape",
  "goldback-oklahoma-g1",
];

/** Coin metadata keyed by slug */
const RETAIL_COIN_META = {
  "ase":                     { name: "American Silver Eagle",    weight: 1.0,  metal: "silver"   },
  "maple-silver":            { name: "Silver Maple Leaf",        weight: 1.0,  metal: "silver"   },
  "britannia-silver":        { name: "Silver Britannia",         weight: 1.0,  metal: "silver"   },
  "krugerrand-silver":       { name: "Silver Krugerrand",        weight: 1.0,  metal: "silver"   },
  "kangaroo-silver":         { name: "Silver Kangaroo",          weight: 1.0,  metal: "silver"   },
  "koala-silver":            { name: "Silver Koala",             weight: 1.0,  metal: "silver"   },
  "kookaburra-silver":       { name: "Silver Kookaburra",        weight: 1.0,  metal: "silver"   },
  "generic-silver-round":    { name: "Generic Silver Round",     weight: 1.0,  metal: "silver"   },
  "generic-silver-bar-10oz": { name: "Generic 10oz Silver Bar",  weight: 10.0, metal: "silver"   },
  "age":                     { name: "American Gold Eagle",      weight: 1.0,  metal: "gold"     },
  "buffalo":                 { name: "American Gold Buffalo",    weight: 1.0,  metal: "gold"     },
  "maple-gold":              { name: "Gold Maple Leaf",          weight: 1.0,  metal: "gold"     },
  "krugerrand-gold":         { name: "Gold Krugerrand",          weight: 1.0,  metal: "gold"     },
  "ape":                     { name: "American Platinum Eagle",   weight: 1.0, metal: "platinum" },
  "goldback-oklahoma-g1":    { name: "G1 Oklahoma Goldback",     weight: 0.001, metal: "goldback" },
};

/** Goldback denomination weights (troy oz) */
const GOLDBACK_WEIGHTS = {
  "g0.5": 0.0005, ghalf: 0.0005, g1: 0.001, g2: 0.002, g5: 0.005,
  g10: 0.01, g25: 0.025, g50: 0.05,
};

/**
 * Parse a goldback slug into coin metadata.
 * @param {string} slug - e.g. "goldback-oklahoma-g1", "goldback-new-hampshire-g25"
 * @returns {{ name: string, weight: number, metal: string } | null}
 */
const _parseGoldbackSlug = (slug) => {
  const m = slug.match(/^goldback-(.+)-(g(?:[\d.]+|half))$/);
  if (!m) return null;
  const weight = GOLDBACK_WEIGHTS[m[2]];
  if (weight == null) return null;
  const state = m[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const denom = m[2] === "ghalf" ? "G\u00BD" : m[2].toUpperCase();
  return { name: `${denom} ${state} Goldback`, weight, metal: "goldback" };
};

/** Vendor display names */
const RETAIL_VENDOR_NAMES = {
  apmex:            "APMEX",
  monumentmetals:   "Monument",
  sdbullion:        "SDB",
  jmbullion:        "JM",
  herobullion:      "Hero",
  bullionexchanges: "BullionX",
  summitmetals:     "Summit",
  goldback:         "Goldback",
};

/** Vendor homepage URLs for popup links */
const RETAIL_VENDOR_URLS = {
  apmex:            "https://www.apmex.com",
  monumentmetals:   "https://www.monumentmetals.com",
  sdbullion:        "https://www.sdbullion.com",
  jmbullion:        "https://www.jmbullion.com",
  herobullion:      "https://www.herobullion.com",
  bullionexchanges: "https://www.bullionexchanges.com",
  summitmetals:     "https://www.summitmetals.com",
  goldback:         "https://www.goldback.com",
};

/** Per-vendor brand colors — shared with retail-view-modal.js for chart lines and card labels */
const RETAIL_VENDOR_COLORS = {
  apmex:            "#60a5fa",  // bright blue (was #3b82f6 — boosted for dark bg contrast)
  jmbullion:        "#fbbf24",  // bright amber (was #f59e0b)
  sdbullion:        "#34d399",  // bright emerald (was #10b981)
  monumentmetals:   "#c4b5fd",  // bright violet (was #a78bfa)
  herobullion:      "#f87171",  // red — already distinct
  bullionexchanges: "#f472b6",  // bright pink (was #ec4899)
  summitmetals:     "#22d3ee",  // bright cyan (was #06b6d4)
  goldback:         "#d4a017",  // deep gold — goldback branding
};

// ---------------------------------------------------------------------------
// Manifest-driven resolver state (populated by syncRetailPrices)
// ---------------------------------------------------------------------------
let _manifestSlugs = null;
let _manifestCoinMeta = null;
let _manifestVendorMeta = null;

/** Returns active slugs: manifest-driven (filtered to those with data) or hardcoded fallback */
const getActiveRetailSlugs = () => {
  if (!_manifestSlugs) return RETAIL_SLUGS;
  if (!retailPrices?.prices) return _manifestSlugs;
  return _manifestSlugs.filter((slug) => {
    const entry = retailPrices.prices[slug];
    if (!entry) return false;
    if (entry.median_price != null || entry.lowest_price != null) return true;
    const vendors = entry.vendors;
    return vendors && Object.keys(vendors).length > 0;
  });
};

/** Resolve coin metadata: manifest → hardcoded → goldback parser → default */
const getRetailCoinMeta = (slug) => {
  if (_manifestCoinMeta && _manifestCoinMeta[slug]) return _manifestCoinMeta[slug];
  if (RETAIL_COIN_META[slug]) return RETAIL_COIN_META[slug];
  const gb = _parseGoldbackSlug(slug);
  if (gb) return gb;
  return { name: slug, weight: 0, metal: "unknown" };
};

/** Resolve vendor display info: manifest → hardcoded → defaults */
const getVendorDisplay = (vendorId) => {
  if (_manifestVendorMeta && _manifestVendorMeta[vendorId]) return _manifestVendorMeta[vendorId];
  return {
    name: RETAIL_VENDOR_NAMES[vendorId] || vendorId,
    color: RETAIL_VENDOR_COLORS[vendorId] || "#6c757d",
    url: RETAIL_VENDOR_URLS[vendorId] || null,
  };
};

/**
 * Formats a price value as USD string, or "—" if null/undefined.
 * Retail prices are USD source data — display in USD regardless of user currency setting.
 * @param {number|null|undefined} v
 * @returns {string}
 */
const _fmtRetailPrice = (v) => (v != null ? `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "\u2014");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {{lastSync: string, window_start: string|null, prices: Object}|null} */
let retailPrices = null;

/** @type {Object.<string, Array>} History keyed by slug */
let retailPriceHistory = {};

/** @type {Object.<string, {window_start: string, windows_24h: Array}>} Intraday 15-min window data keyed by slug */
let retailIntradayData = {};

/**
 * Per-slug, per-vendor product page URLs fetched from providers.json.
 * Shape: { "ase": { "apmex": "https://...", "monumentmetals": "https://..." }, ... }
 * @type {Object.<string, Object.<string, string>>|null}
 */
let retailProviders = null;

/** @type {Object.<string, Object.<string, boolean>>} Out-of-stock status by slug and vendorId */
let retailAvailability = {};

/** @type {Object.<string, Object.<string, number>>} Last known prices by slug and vendorId */
let retailLastKnownPrices = {};

/** @type {Object.<string, Object.<string, string>>} Last available dates by slug and vendorId */
let retailLastAvailableDates = {};

/** True while syncRetailPrices() is running — triggers skeleton render */
let _retailSyncInProgress = false;

/** True when the last sync attempt failed — drives error display in grid/list views */
let _retailSyncError = false;

/** Active sparkline Chart instances keyed by slug — destroyed before re-render to prevent Canvas reuse errors */
const _retailSparklines = new Map();

/** Current trend display mode: "7d" (default) or "intraday" */
let _retailTrendMode = "7d";

const _loadRetailTrendMode = () => {
  const stored = loadDataSync(RETAIL_TREND_MODE_KEY, null);
  if (stored === "intraday") _retailTrendMode = "intraday";
};

const _setRetailTrendMode = (mode) => {
  _retailTrendMode = mode;
  saveDataSync(RETAIL_TREND_MODE_KEY, mode);
  _marketChartInstances.forEach((chart) => chart.destroy());
  _marketChartInstances.clear();
  _renderMarketListView();
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const _handleSaveError = (label, err) => {
  const msg = `Failed to save ${label}: ${err.message}. Your browser storage may be full.`;
  debugLog(`[retail] ${msg}`, "error");
  if (typeof showAppAlert === "function") showAppAlert(msg, "Storage Error");
  if (typeof window !== "undefined") window._retailStorageFailure = true;
};

const loadRetailPrices = () => {
  try {
    retailPrices = loadDataSync(RETAIL_PRICES_KEY) || null;
  } catch (err) {
    console.error("[retail] Failed to load retail prices:", err);
    retailPrices = null;
  }
};

const saveRetailPrices = () => {
  try {
    saveDataSync(RETAIL_PRICES_KEY, retailPrices);
  } catch (err) {
    _handleSaveError("retail prices", err);
  }
};

const loadRetailPriceHistory = () => {
  try {
    const loaded = loadDataSync(RETAIL_PRICE_HISTORY_KEY);
    // Guard: stored value must be a plain object; arrays (corrupt/legacy data) are discarded.
    retailPriceHistory = (loaded && !Array.isArray(loaded) && typeof loaded === "object") ? loaded : {};
  } catch (err) {
    console.error("[retail] Failed to load retail price history:", err);
    retailPriceHistory = {};
  }
  // Re-export so window.retailPriceHistory reflects the new reference after reassignment.
  if (typeof window !== "undefined") window.retailPriceHistory = retailPriceHistory;
};

const saveRetailPriceHistory = () => {
  try {
    saveDataSync(RETAIL_PRICE_HISTORY_KEY, retailPriceHistory);
  } catch (err) {
    _handleSaveError("retail price history", err);
  }
};

const loadRetailIntradayData = () => {
  try {
    const loaded = loadDataSync(RETAIL_INTRADAY_KEY);
    retailIntradayData = (loaded && typeof loaded === "object" && !Array.isArray(loaded)) ? loaded : {};
  } catch (err) {
    console.error("[retail] Failed to load intraday data:", err);
    retailIntradayData = {};
  }
  if (typeof window !== "undefined") window.retailIntradayData = retailIntradayData;
};

const saveRetailIntradayData = () => {
  // STAK-300: cap windows_24h to last 96 entries per slug (24h of 15-min data)
  // to prevent localStorage quota overflow on large collections
  const pruned = {};
  for (const [slug, entry] of Object.entries(retailIntradayData)) {
    if (entry && Array.isArray(entry.windows_24h)) {
      pruned[slug] = { ...entry, windows_24h: entry.windows_24h.slice(-96) };
    } else {
      pruned[slug] = entry;
    }
  }
  retailIntradayData = pruned;
  if (typeof window !== 'undefined') window.retailIntradayData = retailIntradayData;
  try {
    saveDataSync(RETAIL_INTRADAY_KEY, retailIntradayData);
  } catch (err) {
    debugWarn(`[retail] Failed to save retail intraday data: ${err.message} (non-critical cache)`);
  }
};

// Max sync log entries kept in localStorage
const RETAIL_SYNC_LOG_MAX = 50;

/**
 * Appends one entry to the retail sync log and persists it.
 * @param {{success: boolean, coins: number, window: string|null, error: string|null}} entry
 */
const _appendSyncLogEntry = (entry) => {
  try {
    const existing = loadDataSync(RETAIL_SYNC_LOG_KEY) || [];
    const log = Array.isArray(existing) ? existing : [];
    log.push({ ts: new Date().toISOString(), ...entry });
    if (log.length > RETAIL_SYNC_LOG_MAX) log.splice(0, log.length - RETAIL_SYNC_LOG_MAX);
    saveDataSync(RETAIL_SYNC_LOG_KEY, log);
  } catch (err) {
    debugLog(`[retail] Failed to save sync log: ${err.message}`, "warn");
  }
};

const loadRetailProviders = () => {
  try {
    const loaded = loadDataSync(RETAIL_PROVIDERS_KEY, null);
    retailProviders = (loaded && typeof loaded === "object" && !Array.isArray(loaded)) ? loaded : null;
  } catch (err) {
    console.error("[retail] Failed to load retail providers:", err);
    retailProviders = null;
  }
  // Re-export so window.retailProviders reflects the new reference after reassignment.
  if (typeof window !== "undefined") window.retailProviders = retailProviders;
};

const saveRetailProviders = () => {
  try {
    saveDataSync(RETAIL_PROVIDERS_KEY, retailProviders);
  } catch (err) {
    _handleSaveError("retail providers", err);
  }
};

const loadRetailAvailability = () => {
  try {
    const loaded = loadDataSync(RETAIL_AVAILABILITY_KEY, null);
    if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
      retailAvailability = loaded.availability || {};
      retailLastKnownPrices = loaded.lastKnownPrices || {};
      retailLastAvailableDates = loaded.lastAvailableDates || {};
    } else {
      retailAvailability = {};
      retailLastKnownPrices = {};
      retailLastAvailableDates = {};
    }
  } catch (err) {
    console.error("[retail] Failed to load retail availability:", err);
    retailAvailability = {};
    retailLastKnownPrices = {};
    retailLastAvailableDates = {};
  }
  if (typeof window !== "undefined") {
    window.retailAvailability = retailAvailability;
    window.retailLastKnownPrices = retailLastKnownPrices;
    window.retailLastAvailableDates = retailLastAvailableDates;
  }
};

const saveRetailAvailability = () => {
  try {
    const data = {
      availability: retailAvailability,
      lastKnownPrices: retailLastKnownPrices,
      lastAvailableDates: retailLastAvailableDates,
      date: new Date().toISOString().slice(0, 10),
    };
    saveDataSync(RETAIL_AVAILABILITY_KEY, data);
  } catch (err) {
    _handleSaveError("retail availability", err);
  }
};

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/**
 * Returns price history entries for one coin slug, newest first.
 * @param {string} slug
 * @returns {Array}
 */
const getRetailHistoryForSlug = (slug) => retailPriceHistory[slug] || [];

/** Last API base URL that returned a valid manifest — used by retail-view-modal.js */
let _lastSuccessfulApiBase = typeof RETAIL_API_ENDPOINTS !== "undefined" ? RETAIL_API_ENDPOINTS[0] : "https://api.staktrakr.com/data/api";

/**
 * Fetch manifest.json from configured endpoints in order (primary first).
 * Tries each endpoint with a 5-second timeout; returns on the first success.
 * @returns {Promise<Array<{base: string, manifest: Object, ts: string}> | null>}
 */
async function _pickFreshestEndpoint() {
  const endpoints = typeof RETAIL_API_ENDPOINTS !== "undefined" ? RETAIL_API_ENDPOINTS : [RETAIL_API_BASE_URL];
  for (const base of endpoints) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch(`${base}/manifest.json`, { signal: controller.signal }).finally(() => clearTimeout(timeoutId));
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const manifest = await resp.json();
      return [{ base, manifest, ts: manifest.generated_at || "" }];
    } catch {
      // try next endpoint
    }
  }
  return null;
}

const _processSlugResult = (slug, latest, hist30) => {
  const result = {
    slug,
    hasLatest: false,
    price: null,
    intraday: null,
    availabilityBySite: null,
    lastKnownPriceBySite: null,
    lastAvailableDateBySite: null,
    history30: Array.isArray(hist30) ? hist30 : null,
  };

  if (!latest) return result;

  result.hasLatest = true;
  result.price = {
    median_price: latest.median_price,
    lowest_price: latest.lowest_price,
    vendors: latest.vendors || {},
  };
  result.intraday = {
    window_start: latest.window_start,
    windows_24h: Array.isArray(latest.windows_24h) ? latest.windows_24h : [],
  };
  result.availabilityBySite = latest.availability_by_site || null;
  result.lastKnownPriceBySite = latest.last_known_price_by_site || null;
  result.lastAvailableDateBySite = latest.last_available_date_by_site || null;

  return result;
};

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Fetches manifest then all per-slug latest.json and history-30d.json from the
 * REST API. Updates retailPrices (current snapshot), retailPriceHistory (daily),
 * and retailIntradayData (15-min windows). Saves all three to localStorage.
 * @param {{ ui?: boolean }} [opts]
 *   ui=true (default) updates the Sync button and status text.
 *   ui=false runs silently in the background.
 * @returns {Promise<void>}
 */
const syncRetailPrices = async ({ ui = true } = {}) => {
  if (_retailSyncInProgress) {
    debugLog("[retail] Sync already in progress — skipping", "info");
    return;
  }
  const syncBtn = safeGetElement("retailSyncBtn");
  const syncStatus = safeGetElement("retailSyncStatus");

  if (ui) {
    syncBtn.disabled = true;
    syncBtn.textContent = "Syncing…";
    syncStatus.textContent = "";
  }
  _retailSyncInProgress = true;
  _retailSyncError = false;
  renderRetailCards();

  try {
    // Multi-endpoint: race all configured APIs, pick freshest manifest
    let apiBase, manifest;
    const ranked = await _pickFreshestEndpoint();
    if (ranked) {
      apiBase = ranked[0].base;
      manifest = ranked[0].manifest;
      _lastSuccessfulApiBase = apiBase;
      window._lastSuccessfulApiBase = apiBase;
      // Save manifest generated_at for market health dot (STAK-314)
      if (manifest.generated_at) {
        try { localStorage.setItem(RETAIL_MANIFEST_TS_KEY, manifest.generated_at); } catch (e) { /* ignore */ }
      }
      debugLog(`[retail] Using ${apiBase} (generated: ${ranked[0].ts}, ${ranked.length} endpoint(s) reachable)`, "info");
      // Extract manifest metadata for resolver functions
      _manifestSlugs = Array.isArray(manifest.enabled_coins) && manifest.enabled_coins.length
        ? manifest.enabled_coins
        : Array.isArray(manifest.coins) && manifest.coins.length
          ? manifest.coins
          : Array.isArray(manifest.slugs) && manifest.slugs.length
            ? manifest.slugs
            : null;
      _manifestCoinMeta = manifest.coins_meta || null;
      // Persist slug list and coin metadata so they survive page reload
      if (_manifestSlugs) {
        try { localStorage.setItem(RETAIL_MANIFEST_SLUGS_KEY, JSON.stringify(_manifestSlugs)); } catch { /* ignore */ }
      }
      if (_manifestCoinMeta) {
        try { localStorage.setItem(RETAIL_MANIFEST_COIN_META_KEY, JSON.stringify(_manifestCoinMeta)); } catch { /* ignore */ }
      }
    } else {
      debugLog("[retail] All endpoints unreachable, using fallback slug list", "warn");
      apiBase = RETAIL_API_ENDPOINTS[0];
      manifest = { slugs: RETAIL_SLUGS, latest_window: null };
      _manifestSlugs = null;
      _manifestCoinMeta = null;
    }
    const slugs = _manifestSlugs || (Array.isArray(manifest.slugs) && manifest.slugs.length ? manifest.slugs : RETAIL_SLUGS);

    // Fetch providers.json (product page URLs for each coin+vendor)
    try {
      const providersResp = await fetch(`${apiBase}/providers.json`);
      if (providersResp.ok) {
        retailProviders = await providersResp.json();
        saveRetailProviders();
        // Extract vendor display metadata if present and persist for page reload
        if (retailProviders && retailProviders._vendor_meta) {
          _manifestVendorMeta = retailProviders._vendor_meta;
          try { localStorage.setItem(RETAIL_MANIFEST_VENDOR_META_KEY, JSON.stringify(_manifestVendorMeta)); } catch { /* ignore */ }
        }
        debugLog(`[retail] Loaded ${Object.keys(retailProviders || {}).length} coin provider mappings`, "info");
      } else {
        debugLog(`[retail] Providers fetch returned HTTP ${providersResp.status} — using fallback URLs`, "warn");
      }
    } catch (providersErr) {
      debugLog(`[retail] Providers fetch failed (${providersErr.message}) — using homepage fallback URLs`, "warn");
    }

    const results = await Promise.allSettled(
      slugs.map(async (slug) => {
        const [latestResp, histResp] = await Promise.all([
          fetch(`${apiBase}/${slug}/latest.json`),
          fetch(`${apiBase}/${slug}/history-30d.json`),
        ]);
        const latest = latestResp.ok ? await latestResp.json() : null;
        const hist30 = histResp.ok ? await histResp.json() : null;
        return { slug, latest, hist30 };
      })
    );

    let successCount = 0;
    const newPrices = {};

    results.forEach((r) => {
      if (r.status !== "fulfilled") {
        debugLog(`[retail] Slug fetch failed: ${r.reason?.message || r.reason}`, "warn");
        return;
      }
      const { slug, latest, hist30 } = r.value;
      const processed = _processSlugResult(slug, latest, hist30);

      if (processed.hasLatest) {
        newPrices[slug] = processed.price;
        retailIntradayData[slug] = processed.intraday;
        // Update availability data
        if (processed.availabilityBySite) {
          if (!retailAvailability[slug]) retailAvailability[slug] = {};
          Object.assign(retailAvailability[slug], processed.availabilityBySite);
        }
        if (processed.lastKnownPriceBySite) {
          if (!retailLastKnownPrices[slug]) retailLastKnownPrices[slug] = {};
          Object.assign(retailLastKnownPrices[slug], processed.lastKnownPriceBySite);
        }
        if (processed.lastAvailableDateBySite) {
          if (!retailLastAvailableDates[slug]) retailLastAvailableDates[slug] = {};
          Object.assign(retailLastAvailableDates[slug], processed.lastAvailableDateBySite);
        }
        successCount++;
      }

      if (processed.history30) {
        retailPriceHistory[slug] = processed.history30;
      }
    });

    if (successCount > 0) {
      retailPrices = {
        lastSync: new Date().toISOString(),
        window_start: manifest.latest_window || null,
        prices: newPrices,
      };
      _retailSyncError = false;
    }

    // Check if all fetches failed
    if (successCount === 0 && slugs.length > 0) {
      const errorMsg = "All coin price fetches failed — check your network connection.";
      debugLog(`[retail] ${errorMsg}`, "error");
      if (ui) syncStatus.textContent = errorMsg;
      _appendSyncLogEntry({ success: false, coins: 0, window: null, error: errorMsg });
      _retailSyncError = true;
      return;
    }

    if (successCount > 0) {
      saveRetailPrices();
      saveRetailPriceHistory();
      saveRetailIntradayData();
      saveRetailAvailability();
    }

    const statusMsg = `Synced ${successCount} coin(s) · ${manifest.latest_window || "unknown window"}`;
    if (ui) syncStatus.textContent = statusMsg;
    debugLog(`[retail] Sync complete: ${statusMsg}`, "info");
    _appendSyncLogEntry({ success: true, coins: successCount, window: manifest.latest_window || null, error: null });
    if (typeof updateMarketHealthDot === 'function') updateMarketHealthDot();
  } catch (err) {
    _retailSyncError = true;
    debugLog(`[retail] Sync error: ${err.message}`, "warn");
    if (ui) syncStatus.textContent = `Sync failed: ${err.message}`;
    _appendSyncLogEntry({ success: false, coins: 0, window: null, error: err.message });
  } finally {
    _retailSyncInProgress = false;
    renderRetailCards();
    const mktLogActive = document.querySelector('[data-log-tab="market"].active');
    if (mktLogActive && typeof renderRetailHistoryTable === "function") {
      renderRetailHistoryTable();
    }
    if (ui) {
      syncBtn.disabled = false;
      syncBtn.textContent = "Sync Now";
    }
  }
};

// ---------------------------------------------------------------------------
// Render - Settings Panel Cards
// ---------------------------------------------------------------------------

/**
 * Builds a shimmer skeleton placeholder card for the loading state.
 * @returns {HTMLElement}
 */
const _buildSkeletonCard = () => {
  const card = document.createElement("div");
  card.className = "retail-price-card retail-price-card--skeleton";
  [
    "retail-skel retail-skel--title",
    "retail-skel retail-skel--stats",
    "retail-skel retail-skel--vendors",
  ].forEach((cls) => {
    const el = document.createElement("div");
    el.className = cls;
    card.appendChild(el);
  });
  return card;
};

/**
 * Renders a 15-min intraday sparkline on a card's canvas (last 48 windows = 12h).
 * Falls back to 7-day daily history if no intraday data is available.
 * Destroys any prior Chart instance first to prevent Canvas reuse errors.
 * @param {string} slug
 */
const _renderRetailSparkline = (slug) => {
  const canvas = safeGetElement(`retail-spark-${slug}`);
  if (!(canvas instanceof HTMLCanvasElement) || typeof Chart === "undefined") return;
  const intraday = retailIntradayData[slug];
  let data;
  if (intraday && Array.isArray(intraday.windows_24h) && intraday.windows_24h.length >= 2) {
    data = intraday.windows_24h.slice(-48).map((w) => Number(w.median)).filter((v) => isFinite(v));
  } else {
    // Fallback: 7-day daily history
    data = (retailPriceHistory[slug] || []).slice(0, 7).reverse()
      .map((e) => Number(e.avg_median ?? e.average_price)).filter((v) => isFinite(v));
  }
  if (data.length < 2) return;
  if (_retailSparklines.has(slug)) {
    _retailSparklines.get(slug).destroy();
  }
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: Array(data.length).fill(""),
      datasets: [{
        data,
        borderColor: "#3b82f6",
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.3,
        fill: false,
      }],
    },
    options: {
      responsive: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
      animation: false,
    },
  });
  _retailSparklines.set(slug, chart);
};

/** Updates the sync timestamp element based on current sync state. Shared by grid and list views. */
const _updateLastSyncEl = (el) => {
  if (_retailSyncError) {
    el.textContent = "Sync error \u2014 prices may be stale";
  } else if (retailPrices && retailPrices.lastSync) {
    const d = new Date(retailPrices.lastSync);
    const diffMin = Math.floor((Date.now() - d) / 60000);
    if (diffMin < 1) el.textContent = "Last synced: just now";
    else if (diffMin < 60) el.textContent = `Last synced: ${diffMin} min ago`;
    else el.textContent = `Last synced: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } else {
    el.textContent = "Never synced";
  }
};

/** Called on market section open and after each sync. */
const renderRetailCards = () => {
  // Market list view branch (feature flag)
  if (typeof isFeatureEnabled === "function" && isFeatureEnabled("MARKET_LIST_VIEW")) {
    _renderMarketListView();
    return;
  }

  const grid = safeGetElement("retailCardsGrid");
  const lastSyncEl = safeGetElement("retailLastSync");
  const disclaimer = safeGetElement("retailDisclaimer");

  // Ensure grid header is visible when using grid view
  const listHeader = safeGetElement("marketListHeader");
  const gridHeader = safeGetElement("marketGridHeader");
  if (listHeader) listHeader.style.display = "none";
  if (gridHeader) gridHeader.style.display = "";
  grid.classList.remove("market-list-mode");

  _updateLastSyncEl(lastSyncEl);

  grid.innerHTML = "";
  if (_retailSyncInProgress) {
    disclaimer.style.display = "";
    safeGetElement("retailEmptyState").style.display = "none";
    getActiveRetailSlugs().forEach(() => grid.appendChild(_buildSkeletonCard()));
    return;
  }

  const emptyState = safeGetElement("retailEmptyState");
  const hasData = retailPrices && retailPrices.prices && Object.keys(retailPrices.prices).length > 0;
  emptyState.style.display = hasData ? "none" : "";
  disclaimer.style.display = hasData ? "" : "none";
  if (!hasData) return;

  const activeSlugs = getActiveRetailSlugs();
  activeSlugs.forEach((slug) => {
    const meta = getRetailCoinMeta(slug);
    const priceData = retailPrices && retailPrices.prices ? retailPrices.prices[slug] || null : null;
    grid.appendChild(_buildRetailCard(slug, meta, priceData));
  });
  activeSlugs.forEach((slug) => _renderRetailSparkline(slug));
};

/** Metal emoji icons keyed by metal name */
const RETAIL_METAL_EMOJI = { gold: "🟡", silver: "⚪", platinum: "🔷", palladium: "⬜", goldback: "🟡" };
/**
 * Computes price trend vs. the previous history entry.
 * @param {string} slug
 * @returns {{ dir: 'up'|'down'|'flat', pct: string }|null} null if insufficient history
 */
const _computeRetailTrend = (slug) => {
  const history = retailPriceHistory[slug];
  if (!history || history.length < 2) return null;
  const sorted = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
  const latest = Number(sorted[0].avg_median);
  const prev   = Number(sorted[1].avg_median);
  if (!isFinite(latest) || !isFinite(prev) || prev === 0) return null;
  const change = ((latest - prev) / prev) * 100;
  const pct = Math.abs(change).toFixed(1);
  if (change > 0.2) return { dir: "up", pct };
  if (change < -0.2) return { dir: "down", pct };
  return { dir: "flat", pct: "0.0" };
};

const _computeIntradayTrend = (slug) => {
  const intraday = retailIntradayData[slug];
  if (!intraday || !Array.isArray(intraday.windows_24h) || intraday.windows_24h.length < 2) return null;
  // Use the same pipeline as the chart for consistency
  if (typeof window.retailBucketWindows !== "function") return null;
  const bucketed = window.retailBucketWindows(intraday.windows_24h);
  if (bucketed.length < 2) return null;
  const earliest = Number(bucketed[0].median);
  const latest = Number(bucketed[bucketed.length - 1].median);
  if (!isFinite(earliest) || !isFinite(latest) || earliest === 0) return null;
  const change = ((latest - earliest) / earliest) * 100;
  const pct = Math.abs(change).toFixed(1);
  if (change > 0.2) return { dir: "up", pct };
  if (change < -0.2) return { dir: "down", pct };
  return { dir: "flat", pct: "0.0" };
};

const _getActiveTrend = (slug) => {
  return _retailTrendMode === "intraday" ? _computeIntradayTrend(slug) : _computeRetailTrend(slug);
};


/**
 * Builds a single coin price card element.
 * @param {string} slug
 * @param {{name:string, weight:number, metal:string}} meta
 * @param {Object|null} priceData
 * @returns {HTMLElement}
 */
const _buildRetailCard = (slug, meta, priceData) => {
  const card = document.createElement("div");
  card.className = "retail-price-card";
  card.dataset.slug = slug;

  const header = document.createElement("div");
  header.className = "retail-card-header";

  const nameSpan = document.createElement("span");
  nameSpan.className = "retail-coin-name";
  nameSpan.textContent = meta.name;

  const badge = document.createElement("span");
  badge.className = `retail-metal-badge retail-metal-badge--${meta.metal}`;
  const emoji = RETAIL_METAL_EMOJI[meta.metal];
  const metalLabel = meta.metal === "platinum" ? "PLAT" : meta.metal.toUpperCase();
  badge.textContent = emoji ? `${emoji} ${metalLabel}` : metalLabel;

  header.appendChild(nameSpan);
  header.appendChild(badge);
  card.appendChild(header);

  const weightEl = document.createElement("div");
  weightEl.className = "retail-coin-weight";
  weightEl.textContent = `${meta.weight} troy oz`;
  card.appendChild(weightEl);

  if (!priceData) {
    const noData = document.createElement("div");
    noData.className = "retail-no-data";
    noData.textContent = "No data — click Sync";
    card.appendChild(noData);
  } else {
    const summary = document.createElement("div");
    summary.className = "retail-summary-row";
    [["Med", priceData.median_price], ["Low", priceData.lowest_price]].forEach(([label, val]) => {
      const item = document.createElement("span");
      item.className = "retail-summary-item";
      const lbl = document.createElement("span");
      lbl.className = "retail-label";
      lbl.textContent = label;
      const valSpan = document.createElement("span");
      valSpan.className = "retail-summary-value";
      valSpan.textContent = _fmtRetailPrice(val);
      item.appendChild(lbl);
      item.appendChild(valSpan);
      summary.appendChild(item);
    });

    // Add trend chip to the right side of the summary row
    const trend = _computeRetailTrend(slug);
    if (trend) {
      const trendEl = document.createElement("span");
      const arrow = { up: "\u2191", down: "\u2193", flat: "\u2192" }[trend.dir];
      const sign  = trend.dir === "up" ? "+" : trend.dir === "down" ? "-" : "";
      trendEl.className = `retail-trend retail-trend--${trend.dir}`;
      trendEl.textContent = `${arrow} ${sign}${trend.pct}%`;
      summary.appendChild(trendEl);
    }

    card.appendChild(summary);

    const vendorDetails = document.createElement("div");
    vendorDetails.className = "retail-vendor-details";

    const vendors = document.createElement("div");
    vendors.className = "retail-vendors";

    // Goldback vendor reference price (grid view)
    if (typeof getGoldbackVendorPrice === "function") {
      const gbPrice = getGoldbackVendorPrice(slug);
      if (gbPrice) {
        const gbRow = document.createElement("div");
        gbRow.className = "retail-vendor-row";
        if (gbPrice.isStale) gbRow.style.opacity = "0.6";
        const gbName = document.createElement("span");
        gbName.className = "retail-vendor-name";
        gbName.style.color = "#d4a017";
        gbName.textContent = "Goldback";
        gbRow.appendChild(gbName);
        const gbVal = document.createElement("span");
        gbVal.className = "retail-vendor-price";
        gbVal.textContent = _fmtRetailPrice(gbPrice.price) + (gbPrice.isStale ? " (stale)" : "");
        gbRow.appendChild(gbVal);
        vendors.appendChild(gbRow);
      }
    }

    const vendorMap = priceData.vendors || {};
    const availability = retailAvailability[slug] || {};
    const lastKnownPrices = retailLastKnownPrices[slug] || {};
    const lastKnownDates = retailLastAvailableDates[slug] || {};

    // Build list of all vendors (in-stock and OOS)
    const allVendorKeys = new Set([
      ...Object.keys(vendorMap),
      ...Object.keys(availability),
    ]);

    // Sort: high-confidence in-stock vendors (≥60) by price asc, then low-confidence, then OOS vendors
    const sortedVendorEntries = Array.from(allVendorKeys)
      .map((key) => {
        const vendorData = vendorMap[key];
        const isAvailable = availability[key] !== false; // default true if not specified
        const price = vendorData ? vendorData.price : null;
        const score = vendorData ? vendorData.confidence : null;
        const label = getVendorDisplay(key).name;
        return { key, label, price, score, isAvailable };
      })
      .filter(({ price }) => price != null) // show only vendors with a price
      .sort((a, b) => a.price - b.price); // sort by price ascending

    // Award medals to top 3 vendors by price
    const top3 = sortedVendorEntries.slice(0, 3).map(({ key }) => key);

    sortedVendorEntries.forEach(({ key, label, price }) => {
      const row = document.createElement("div");
      row.className = "retail-vendor-row";
      const medalIndex = top3.indexOf(key);
      if (medalIndex !== -1) {
        row.classList.add(`retail-vendor-row--medal-${medalIndex + 1}`);
      }

      const nameEl = document.createElement("span");
      nameEl.className = "retail-vendor-name";
      const _vd = getVendorDisplay(key);
      const vendorColor = _vd.color;
      // Prefer specific product page from providers.json; fall back to vendor homepage
      const vendorUrl = (retailProviders && retailProviders[slug] && retailProviders[slug][key])
        || _vd.url;
      if (vendorUrl) {
        const link = document.createElement("a");
        link.href = "#";
        link.textContent = label;
        link.className = "retail-vendor-link";
        if (vendorColor) link.style.color = vendorColor;
        link.addEventListener("click", (e) => {
          e.preventDefault();
          const popup = window.open(vendorUrl, `retail_vendor_${key}`, "width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no");
          if (popup) popup.opener = null;
          else window.open(vendorUrl, "_blank", "noopener,noreferrer");
        });
        nameEl.appendChild(link);
      } else {
        nameEl.textContent = label;
        if (vendorColor) nameEl.style.color = vendorColor;
      }

      const priceEl = document.createElement("span");
      priceEl.className = "retail-vendor-price";
      priceEl.textContent = _fmtRetailPrice(price);

      row.appendChild(nameEl);
      row.appendChild(priceEl);
      vendors.appendChild(row);
    });

    vendorDetails.appendChild(vendors);
    card.appendChild(vendorDetails);

    const footer = document.createElement("div");
    footer.className = "retail-card-footer";
    const dateSpan = document.createElement("span");
    dateSpan.className = "retail-data-date";
    dateSpan.textContent = retailPrices && retailPrices.window_start ? "today" : "—";
    footer.appendChild(dateSpan);
    const sparkCanvas = document.createElement("canvas");
    sparkCanvas.id = `retail-spark-${slug}`;
    sparkCanvas.className = "retail-sparkline";
    sparkCanvas.width = 80;
    sparkCanvas.height = 28;
    footer.appendChild(sparkCanvas);
    card.appendChild(footer);
  }

  const btnRow = document.createElement("div");
  btnRow.className = "retail-card-btn-row";

  const viewBtn = document.createElement("button");
  viewBtn.className = "retail-card-action retail-view-btn";
  viewBtn.type = "button";
  viewBtn.dataset.retailViewSlug = slug;
  viewBtn.textContent = "View";
  btnRow.appendChild(viewBtn);

  const histBtn = document.createElement("button");
  histBtn.className = "retail-card-action retail-history-btn";
  histBtn.type = "button";
  histBtn.dataset.retailHistorySlug = slug;
  histBtn.textContent = "History";
  btnRow.appendChild(histBtn);

  card.appendChild(btnRow);

  return card;
};

// ---------------------------------------------------------------------------
// Market List View (MARKET_LIST_VIEW feature flag)
// ---------------------------------------------------------------------------

/** Medal text labels and CSS classes for top-3 vendors (matches playground) */
const _MARKET_MEDALS = ["1st", "2nd", "3rd"];
const _MARKET_MEDAL_CLASSES = ["vendor-medal--1", "vendor-medal--2", "vendor-medal--3"];

/** Active chart instances for market cards — destroyed on close to prevent Canvas reuse errors */
const _marketChartInstances = new Map();

/** Search debounce timer */
let _marketSearchTimer = null;
let _marketMetalFilter = "all";

/**
 * Builds a compact vendor link element for the market list card.
 * @param {string} vendorId
 * @param {string} slug
 * @returns {HTMLElement}
 */
const _buildMarketVendorLink = (vendorId, slug) => {
  const vd = getVendorDisplay(vendorId);
  const label = vd.name;
  const vendorColor = vd.color;
  const vendorUrl = (retailProviders && retailProviders[slug] && retailProviders[slug][vendorId])
    || vd.url;
  const el = document.createElement("span");
  el.className = "vendor-name";
  if (vendorColor) el.style.color = vendorColor;
  if (vendorUrl) {
    el.style.cursor = "pointer";
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const popup = window.open(vendorUrl, `retail_vendor_${vendorId}`, "width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no");
      if (popup) popup.opener = null;
      else window.open(vendorUrl, "_blank", "noopener,noreferrer");
    });
  }
  el.textContent = label;
  return el;
};

/**
 * Builds a single full-width row card for the market list view.
 * Uses View C card parity: metal border, image column, glass orb placeholders.
 * @param {string} slug
 * @param {{name:string, weight:number, metal:string}} meta
 * @param {Object|null} priceData
 * @param {Array|null} historyData
 * @returns {HTMLElement}
 */
const _buildMarketListCard = (slug, meta, priceData, historyData) => {
  const card = document.createElement("div");
  card.className = `market-list-card metal-${meta.metal}`;
  card.dataset.slug = slug;

  // === Image column — exact playground match: market-card-image-col ===
  const imageCol = document.createElement("div");
  imageCol.className = "market-card-image-col";
  if (meta.metal === "goldback") imageCol.classList.add("bar-shape");
  const noImg = document.createElement("div");
  noImg.className = "market-card-no-image";
  imageCol.appendChild(noImg);
  card.appendChild(imageCol);

  // === Info column ===
  const infoCol = document.createElement("div");
  infoCol.className = "market-card-info";
  const nameEl = document.createElement("div");
  nameEl.className = "market-card-name";
  nameEl.textContent = meta.name;
  infoCol.appendChild(nameEl);
  const weightRow = document.createElement("div");
  const weightSpan = document.createElement("span");
  weightSpan.className = "market-card-weight";
  weightSpan.textContent = `${meta.weight} troy oz`;
  weightRow.appendChild(weightSpan);
  const badge = document.createElement("span");
  badge.className = `retail-metal-badge retail-metal-badge--${meta.metal}`;
  badge.textContent = meta.metal.toUpperCase();
  weightRow.appendChild(badge);
  infoCol.appendChild(weightRow);

  card.appendChild(infoCol);

  // === Stats column — playground structure: stats-col > stats > span ===
  const statsCol = document.createElement("div");
  statsCol.className = "market-card-stats-col";

  // Compute stats from priceData if available, otherwise fall back to latest history entry
  let medVal = null, lowVal = null, avgVal = null;
  // Helper: extract numeric price from vendor object (live uses .price, history uses .avg)
  const _vendorPrice = (v) => {
    if (!v) return null;
    const p = typeof v.price === "number" ? v.price : typeof v.avg === "number" ? v.avg : null;
    return p != null && isFinite(p) ? p : null;
  };
  // Helper: compute average from in-stock vendor prices (deduplicates priceData / historyData branches)
  const _calcVendorAvg = (vendorMap) => {
    const vendorPrices = Object.values(vendorMap)
      .filter((v) => v && v.inStock !== false)
      .map(_vendorPrice)
      .filter((p) => p != null);
    return vendorPrices.length > 0 ? vendorPrices.reduce((a, b) => a + b, 0) / vendorPrices.length : null;
  };
  if (priceData) {
    medVal = priceData.median_price;
    lowVal = priceData.lowest_price;
    // Compute average from in-stock vendor prices
    if (priceData.vendors) {
      avgVal = _calcVendorAvg(priceData.vendors);
    }
  }
  // Fall back to latest history entry if priceData missing or didn't yield stats
  if (medVal == null && lowVal == null && historyData && historyData.length > 0) {
    const latest = historyData[historyData.length - 1];
    medVal = latest.avg_median || null;
    lowVal = latest.avg_low || null;
  }
  if (avgVal == null && historyData && historyData.length > 0) {
    const latest = historyData[historyData.length - 1];
    if (latest.vendors) {
      avgVal = _calcVendorAvg(latest.vendors);
    }
  }

  if (medVal != null || lowVal != null || avgVal != null) {
    const statsInner = document.createElement("div");
    statsInner.className = "market-card-stats";
    [["MED", medVal], ["LOW", lowVal], ["AVG", avgVal]].forEach(([label, val]) => {
      const span = document.createElement("span");
      const lbl = document.createElement("span");
      lbl.className = "stat-label";
      lbl.textContent = label;
      const valEl = document.createElement("span");
      valEl.className = "stat-value";
      valEl.textContent = _fmtRetailPrice(val);
      span.appendChild(lbl);
      span.appendChild(document.createTextNode(" "));
      span.appendChild(valEl);
      statsInner.appendChild(span);
    });
    statsCol.appendChild(statsInner);
  }
  card.appendChild(statsCol);

  // === Trend badge — playground: .market-card-trend .up/.down/.flat ===
  const trend = _getActiveTrend(slug);
  const trendDir = trend ? trend.dir : "flat";
  const trendCol = document.createElement("div");
  trendCol.className = `market-card-trend ${trendDir}`;
  if (trend) {
    const arrow = { up: "\u2191", down: "\u2193", flat: "\u2192" }[trend.dir];
    const sign = trend.dir === "up" ? "+" : trend.dir === "down" ? "\u2212" : "";
    trendCol.textContent = `${arrow} ${sign}${trend.pct}%`;
  } else {
    trendCol.textContent = "\u2192 0.0%";
  }
  card.appendChild(trendCol);

  // === Vendor row — playground classes: vendor-chip, vendor-medal, vendor-name, vendor-price ===
  const vendorRow = document.createElement("div");
  vendorRow.className = "market-card-vendors";
  // Goldback vendor chip — reference price from goldback.com (no medal ranking)
  if (typeof getGoldbackVendorPrice === "function") {
    const gbPrice = getGoldbackVendorPrice(slug);
    if (gbPrice) {
      const gbChip = document.createElement("span");
      gbChip.className = "vendor-chip";
      if (gbPrice.isStale) gbChip.style.opacity = "0.6";
      const gbName = document.createElement("span");
      gbName.className = "vendor-name";
      gbName.style.color = "#d4a017";
      gbName.textContent = "Goldback";
      gbChip.appendChild(gbName);
      const gbPriceEl = document.createElement("span");
      gbPriceEl.className = "vendor-price";
      gbPriceEl.textContent = _fmtRetailPrice(gbPrice.price) + (gbPrice.isStale ? " (stale)" : "");
      gbChip.appendChild(gbPriceEl);
      const gbSrc = document.createElement("span");
      gbSrc.className = "vendor-source";
      gbSrc.textContent = "goldback.com";
      gbSrc.style.fontSize = "0.65rem";
      gbSrc.style.color = "var(--text-muted, #6c757d)";
      gbSrc.style.opacity = "0.7";
      gbChip.appendChild(gbSrc);
      vendorRow.appendChild(gbChip);
    }
  }
  if (priceData) {
    const vendorMap = priceData.vendors || {};
    const sortedVendors = Object.keys(vendorMap)
      .map((key) => {
        const vd = vendorMap[key];
        const price = vd ? vd.price : null;
        return { key, price };
      })
      .filter(({ price }) => price != null && price > 0)
      .sort((a, b) => a.price - b.price);

    // Median anomaly filter: suppress vendors >40% from median (3+ vendors required)
    let displayVendors = sortedVendors;
    if (sortedVendors.length >= 3) {
      const prices = sortedVendors.map(({ price }) => price);
      const mid = Math.floor(prices.length / 2);
      const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
      const threshold = typeof RETAIL_ANOMALY_THRESHOLD !== "undefined" ? RETAIL_ANOMALY_THRESHOLD : 0.40;
      const filtered = sortedVendors.filter(({ price }) => Math.abs(price - median) / median <= threshold);
      // Guard: if all would be filtered, show all
      if (filtered.length > 0) displayVendors = filtered;
    }

    const top3Keys = displayVendors.slice(0, 3).map(({ key }) => key);
    displayVendors.forEach(({ key, price }) => {
      const chip = document.createElement("span");
      chip.className = "vendor-chip";

      const medalIdx = top3Keys.indexOf(key);
      if (medalIdx !== -1) {
        const medal = document.createElement("span");
        medal.className = `vendor-medal ${_MARKET_MEDAL_CLASSES[medalIdx]}`;
        medal.textContent = _MARKET_MEDALS[medalIdx];
        chip.appendChild(medal);
      }
      const nameLink = _buildMarketVendorLink(key, slug);
      nameLink.className = "vendor-name";
      chip.appendChild(nameLink);
      const priceEl = document.createElement("span");
      priceEl.className = "vendor-price";
      priceEl.textContent = _fmtRetailPrice(price);
      chip.appendChild(priceEl);
      vendorRow.appendChild(chip);
    });
  }
  card.appendChild(vendorRow);

  // === Chart details (collapsible, lazy-loaded) ===
  const details = document.createElement("details");
  details.className = "market-card-chart";
  const summary = document.createElement("summary");
  const tArrow = trend ? ({ up: "\u2191", down: "\u2193", flat: "\u2192" }[trend.dir]) : "\u2192";
  const tSign = trend ? (trend.dir === "up" ? "+" : trend.dir === "down" ? "\u2212" : "") : "";
  const tPct = trend ? trend.pct : "0.0";
  const trendLabel = _retailTrendMode === "intraday" ? "Intraday Trend" : "7-Day Trend";
  summary.textContent = `${trendLabel} \u00A0${tArrow} ${tSign}${tPct}%`;
  details.appendChild(summary);
  const chartContainer = document.createElement("div");
  chartContainer.className = "market-chart-container";
  const history = retailPriceHistory[slug];
  const intradayWindows = retailIntradayData[slug] && Array.isArray(retailIntradayData[slug].windows_24h) ? retailIntradayData[slug].windows_24h : [];
  const hasChartData = (history && history.length >= 2) || intradayWindows.length >= 2;
  if (!hasChartData) {
    const msg = document.createElement("p");
    msg.className = "text-muted market-chart-empty";
    msg.textContent = "Not enough data for chart";
    chartContainer.appendChild(msg);
  } else {
    const canvas = document.createElement("canvas");
    canvas.id = `market-chart-${slug}`;
    chartContainer.appendChild(canvas);
  }
  details.appendChild(chartContainer);
  details.addEventListener("toggle", () => {
    if (details.open) {
      if (_retailTrendMode === "intraday") {
        _initMarketCardIntradayChart(slug, details);
      } else {
        _initMarketCardChart(slug, details);
      }
    } else if (_marketChartInstances.has(slug)) {
      _marketChartInstances.get(slug).destroy();
      _marketChartInstances.delete(slug);
    }
  });
  card.appendChild(details);

  // Click anywhere on card body toggles the chart (except vendor chips + summary)
  card.addEventListener("click", (e) => {
    // Let vendor chips, links, and the native summary toggle handle themselves
    if (e.target.closest(".vendor-chip") || e.target.closest("summary") || e.target.closest("a")) return;
    details.open = !details.open;
  });

  return card;
};

/**
 * Filters anomalous vendor prices from daily history entries.
 * Adapted from _flagAnomalies (retail-view-modal.js) for the daily history
 * format where vendor data is { avg, inStock } objects instead of raw numbers.
 *
 * Pass 1 — Temporal spike: if neighbors (t-1, t+1) are stable (±5%) but
 *   price[t] deviates, null it out.
 * Pass 2 — Cross-vendor median: if 3+ vendors in a day, any vendor >40%
 *   from the median is nulled.
 *
 * @param {Array} entries - Chronological daily history entries
 * @param {string[]} vendorIds - Vendor IDs to check
 * @returns {Object<string, Array<number|null>>} Cleaned price arrays keyed by vendorId
 */
const _filterHistorySpikes = (entries, vendorIds) => {
  const neighborTol = typeof RETAIL_SPIKE_NEIGHBOR_TOLERANCE !== "undefined" ? RETAIL_SPIKE_NEIGHBOR_TOLERANCE : 0.05;
  const medianThreshold = typeof RETAIL_ANOMALY_THRESHOLD !== "undefined" ? RETAIL_ANOMALY_THRESHOLD : 0.40;

  // Extract raw price matrix and track which points are estimated (OOS / carry-forward)
  const prices = {};
  const estimated = {}; // parallel boolean arrays — true = OOS carry-forward or missing data
  for (const vid of vendorIds) {
    prices[vid] = [];
    estimated[vid] = [];
    let lastKnown = null;
    // History is chronological (oldest first), so walk forward
    for (let t = 0; t < entries.length; t++) {
      const e = entries[t];
      const vd = e.vendors && e.vendors[vid];
      const val = vd && typeof vd.avg === "number" && isFinite(vd.avg) ? vd.avg : null;
      const isOOS = vd && vd.inStock === false;
      if (val != null && !isOOS) {
        // Real in-stock data point
        prices[vid][t] = val;
        estimated[vid][t] = false;
        lastKnown = val;
      } else if (isOOS && lastKnown != null) {
        // OOS — carry forward last known price, mark estimated
        prices[vid][t] = lastKnown;
        estimated[vid][t] = true;
      } else if (val != null && isOOS) {
        // OOS but scraper returned a price — prefer last in-stock anchor for carry-forward
        // so the dotted line stays flat at the last real price, not drifting with OOS prices
        prices[vid][t] = lastKnown != null ? lastKnown : val;
        estimated[vid][t] = true;
        // Do NOT update lastKnown — keep last in-stock price as the carry anchor
      } else {
        // No data at all
        prices[vid][t] = null;
        estimated[vid][t] = false;
      }
    }
  }

  // Pass 1: Temporal spike detection (only on non-estimated real data)
  for (const vid of vendorIds) {
    const arr = prices[vid];
    const est = estimated[vid];
    for (let t = 1; t < arr.length - 1; t++) {
      if (est[t]) continue; // skip estimated points
      const curr = arr[t];
      const prev = arr[t - 1];
      const next = arr[t + 1];
      if (curr == null || prev == null || next == null) continue;
      if (est[t - 1] || est[t + 1]) continue; // need real neighbors
      if (prev === 0 && next === 0) continue;
      const neighborAvg = (prev + next) / 2;
      if (neighborAvg === 0) continue;
      const neighborDrift = Math.abs(prev - next) / neighborAvg;
      if (neighborDrift > neighborTol) continue;
      const deviation = Math.abs(curr - neighborAvg) / neighborAvg;
      if (deviation > neighborTol) {
        arr[t] = null; // spike — will be interpolated later
        est[t] = false;
      }
    }
  }

  // Pass 1b: Endpoint spike detection (t=0 and t=length-1 have no symmetric neighbors)
  // Compare each endpoint against the average of the nearest 2 real interior data points.
  // Uses 2× the neighbor tolerance (10%) since we're comparing one side only.
  const endpointTol = neighborTol * 2;
  for (const vid of vendorIds) {
    const arr = prices[vid];
    const est = estimated[vid];
    const n = arr.length;
    // Leading endpoint (t=0): look ahead for 2 real non-estimated data points
    if (!est[0] && arr[0] != null) {
      const peers = [];
      for (let j = 1; j < n && peers.length < 2; j++) {
        if (!est[j] && arr[j] != null) peers.push(arr[j]);
      }
      if (peers.length >= 2) {
        const peerAvg = (peers[0] + peers[1]) / 2;
        if (peerAvg !== 0 && Math.abs(arr[0] - peerAvg) / peerAvg > endpointTol) {
          arr[0] = null;
          est[0] = false;
        }
      }
    }
    // Trailing endpoint (t=n-1): look back for 2 real non-estimated data points
    if (!est[n - 1] && arr[n - 1] != null) {
      const peers = [];
      for (let j = n - 2; j >= 0 && peers.length < 2; j--) {
        if (!est[j] && arr[j] != null) peers.push(arr[j]);
      }
      if (peers.length >= 2) {
        const peerAvg = (peers[0] + peers[1]) / 2;
        if (peerAvg !== 0 && Math.abs(arr[n - 1] - peerAvg) / peerAvg > endpointTol) {
          arr[n - 1] = null;
          est[n - 1] = false;
        }
      }
    }
  }

  // Pass 2: Cross-vendor median consensus (only on non-estimated points)
  for (let t = 0; t < entries.length; t++) {
    const isEndpoint = (t === 0 || t === entries.length - 1);
    const valid = vendorIds
      .map((vid) => ({ vid, price: prices[vid][t], est: estimated[vid][t] }))
      .filter((x) => x.price != null && !x.est);
    // Endpoints: allow 2 vendors and tighter threshold (20%); interior: 3 vendors, 40%
    if (valid.length < (isEndpoint ? 2 : 3)) continue;
    const threshold = isEndpoint ? medianThreshold * 0.5 : medianThreshold;
    const sorted = valid.map((x) => x.price).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    if (median === 0) continue;
    let flagged = 0;
    const candidates = [];
    for (const { vid, price } of valid) {
      if (Math.abs(price - median) / median > threshold) {
        candidates.push(vid);
        flagged++;
      }
    }
    if (flagged >= valid.length) continue;
    for (const vid of candidates) {
      prices[vid][t] = null;
      estimated[vid][t] = false;
    }
  }

  return { prices, estimated };
};

/**
 * Linearly interpolates null gaps in a price array and marks which indices
 * are estimated (interpolated, OOS carry-forward, etc.). Trailing/leading
 * nulls are left as-is (no extrapolation beyond known data).
 *
 * @param {Array<number|null>} data - Price array with nulls for missing/anomalous data
 * @param {boolean[]} [preEstimated] - Optional pre-marked estimated flags (e.g. OOS carry-forward)
 * @returns {{ filled: Array<number|null>, interp: boolean[] }}
 */
const _interpolateGaps = (data, preEstimated) => {
  const filled = [...data];
  const interp = preEstimated ? [...preEstimated] : new Array(data.length).fill(false);
  for (let i = 0; i < filled.length; i++) {
    if (filled[i] != null) continue;
    // Find previous non-null value
    let prevIdx = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (filled[j] != null) { prevIdx = j; break; }
    }
    // Find next non-null value
    let nextIdx = -1;
    for (let j = i + 1; j < filled.length; j++) {
      if (filled[j] != null) { nextIdx = j; break; }
    }
    if (prevIdx === -1 || nextIdx === -1) continue; // edge — no extrapolation
    // Linear interpolation
    const span = nextIdx - prevIdx;
    const progress = (i - prevIdx) / span;
    filled[i] = filled[prevIdx] + (filled[nextIdx] - filled[prevIdx]) * progress;
    interp[i] = true;
  }
  return { filled, interp };
};

/**
 * Initializes a Chart.js line chart inside a market card's <details> block.
 * Uses last 7 history entries, reversed to chronological order (oldest left → newest right).
 * Applies spike detection to filter anomalous scrape data, then interpolates
 * gaps and renders them as dashed/dimmed segments.
 * @param {string} slug
 * @param {HTMLDetailsElement} detailsEl
 */
const _initMarketCardChart = (slug, detailsEl) => {
  if (typeof Chart === "undefined") return;
  if (_marketChartInstances.has(slug)) return;
  const canvas = detailsEl.querySelector(`#market-chart-${slug}`);
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const history = retailPriceHistory[slug];
  if (!history || history.length < 2) return;
  // History is chronological (oldest first) — take last 7 entries for newest week
  const last7 = history.slice(-7);
  const knownVendors = Object.keys(RETAIL_VENDOR_NAMES);
  const activeVendors = knownVendors.filter((v) =>
    last7.some((e) => e.vendors && e.vendors[v] && e.vendors[v].avg != null)
  );

  // Filter spikes, then interpolate gaps for smooth lines
  const spikeResult = activeVendors.length > 0
    ? _filterHistorySpikes(last7, activeVendors)
    : null;

  const datasets = activeVendors.length > 0
    ? activeVendors.map((vendorId) => {
        const { filled, interp } = _interpolateGaps(spikeResult.prices[vendorId], spikeResult.estimated[vendorId]);
        // Require 2+ real (non-estimated) data points — a single dot adds noise, not signal
        const realCount = interp.filter((v, i) => !v && filled[i] != null).length;
        if (realCount < 2) return null;
        const _cvd = getVendorDisplay(vendorId);
        const baseColor = _cvd.color;
        return {
          label: _cvd.name,
          data: filled,
          _interp: interp, // stashed for tooltip + segment callbacks
          borderColor: baseColor,
          backgroundColor: "transparent",
          borderWidth: 1.5,
          pointRadius: (ctx) => interp[ctx.dataIndex] ? 2 : 3,
          pointBorderColor: (ctx) => interp[ctx.dataIndex] ? baseColor + "60" : baseColor,
          pointBackgroundColor: (ctx) => interp[ctx.dataIndex] ? "transparent" : baseColor,
          tension: 0.3,
          spanGaps: true,
          // TODO: re-enable dashed segments once API serves 30-min aggregates (STAK-474)
          // segment: {
          //   borderDash: (ctx) => (interp[ctx.p0DataIndex] || interp[ctx.p1DataIndex]) ? [4, 3] : [],
          //   borderColor: (ctx) => (interp[ctx.p0DataIndex] || interp[ctx.p1DataIndex]) ? baseColor + "50" : baseColor,
          // },
        };
      }).filter(Boolean)
    : [{
        label: "Avg Median",
        data: last7.map((e) => Number(e.avg_median)),
        borderColor: "#4a9eff",
        backgroundColor: "transparent",
        borderWidth: 1.5,
        pointRadius: 3,
        tension: 0.3,
      }];

  // Goldback reference baseline (STAK-474) — flat line at goldback.com price
  if (typeof getGoldbackVendorPrice === "function") {
    const gbPrice = getGoldbackVendorPrice(slug);
    if (gbPrice && gbPrice.price != null) {
      datasets.push({
        label: "Goldback",
        data: last7.map(() => gbPrice.price),
        borderColor: "#d4a017",
        backgroundColor: "transparent",
        borderWidth: 1,
        borderDash: [6, 4],
        pointRadius: 0,
        pointHoverRadius: 2,
        tension: 0,
      });
    }
  }

  const chart = new Chart(canvas, {
    type: "line",
    data: { labels: last7.map((e) => e.date), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items[0]?.label || "",
            label: (ctx) => {
              if (ctx.raw === null) return `${ctx.dataset.label}: Out of stock`;
              const isInterp = ctx.dataset._interp && ctx.dataset._interp[ctx.dataIndex];
              const prefix = isInterp ? "~" : "";
              return `${ctx.dataset.label}: ${prefix}$${Number(ctx.raw).toFixed(2)}${isInterp ? " (est.)" : ""}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 7, font: { size: 11 } } },
        y: { ticks: { callback: (v) => `$${Number(v).toFixed(0)}` } },
      },
      animation: false,
    },
  });
  _marketChartInstances.set(slug, chart);
};

const _initMarketCardIntradayChart = (slug, detailsEl) => {
  if (typeof Chart === "undefined") return;
  if (_marketChartInstances.has(slug)) return;
  const canvas = detailsEl.querySelector(`#market-chart-${slug}`);
  if (!(canvas instanceof HTMLCanvasElement)) return;

  if (typeof window.retailBucketWindows !== "function" ||
      typeof window.retailForwardFillVendors !== "function" ||
      typeof window.retailFlagAnomalies !== "function") return;

  const intraday = retailIntradayData[slug];
  const windows = intraday && Array.isArray(intraday.windows_24h) ? intraday.windows_24h : [];
  if (windows.length < 2) return;

  const filled = window.retailForwardFillVendors(window.retailBucketWindows(windows));
  let bucketed;
  try {
    bucketed = window.retailFlagAnomalies(filled);
  } catch (e) {
    debugLog("[retail] _flagAnomalies threw — anomaly detection skipped: " + e.message, "warn");
    bucketed = filled;
  }
  if (bucketed.length < 2) return;

  const labels = bucketed.map((w) => {
    const d = w.window ? new Date(w.window) : null;
    return typeof window.retailFmtIntradayTime === "function" ? window.retailFmtIntradayTime(d) : (d ? d.toISOString().slice(11, 16) : "");
  });

  const knownVendors = typeof RETAIL_VENDOR_NAMES !== "undefined" ? Object.keys(RETAIL_VENDOR_NAMES) : [];
  const activeVendors = knownVendors.filter((v) =>
    bucketed.some((w) => (w.vendors && w.vendors[v] != null) || (w._anomalyOriginals && w._anomalyOriginals[v] != null))
  );

  const datasets = activeVendors.length > 0
    ? activeVendors.map((vendorId) => {
        const _vd = getVendorDisplay(vendorId);
        const color = RETAIL_VENDOR_COLORS[vendorId] || "#94a3b8";
        const carriedIndices = new Set();
        bucketed.forEach((w, i) => {
          if (w._carriedVendors && w._carriedVendors.has(vendorId)) carriedIndices.add(i);
        });
        return {
          label: _vd.name,
          data: bucketed.map((w) => (w.vendors && w.vendors[vendorId] != null ? w.vendors[vendorId] : null)),
          borderColor: color,
          backgroundColor: "transparent",
          borderWidth: 1.5,
          pointRadius: (ctx) => carriedIndices.has(ctx.dataIndex) ? 0 : 0,
          pointHoverRadius: (ctx) => carriedIndices.has(ctx.dataIndex) ? 2 : 3,
          tension: 0.2,
          spanGaps: true,
          _carriedIndices: carriedIndices,
          // TODO: re-enable dashed segments once API serves 30-min aggregates (STAK-474)
          // segment: {
          //   borderDash: (ctx) => (carriedIndices.has(ctx.p0DataIndex) || carriedIndices.has(ctx.p1DataIndex)) ? [4, 3] : [],
          //   borderColor: (ctx) => (carriedIndices.has(ctx.p0DataIndex) || carriedIndices.has(ctx.p1DataIndex)) ? color + "50" : color,
          // },
        };
      })
    : [{
        label: "Median",
        data: bucketed.map((w) => w.median),
        borderColor: "#3b82f6",
        backgroundColor: "transparent",
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0.3,
      }];

  const chart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              if (ctx.raw === null) return `${ctx.dataset.label}: Out of stock`;
              const carried = ctx.dataset._carriedIndices && ctx.dataset._carriedIndices.has(ctx.dataIndex);
              return `${ctx.dataset.label}: ${carried ? "~" : ""}$${Number(ctx.raw).toFixed(2)}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 12, autoSkip: true, maxRotation: 0, font: { size: 10 } } },
        y: { ticks: { callback: (v) => `$${Number(v).toFixed(0)}` } },
      },
      animation: false,
    },
  });
  _marketChartInstances.set(slug, chart);
};

/**
 * Filters and sorts the slug list for market list view.
 * @param {string} query - Search query (case-insensitive substring)
 * @param {string} sortKey - name|metal|price-low|price-high|trend
 * @returns {string[]}
 */
const _getFilteredSortedSlugs = (query, sortKey) => {
  let slugs = [...getActiveRetailSlugs()];
  if (_marketMetalFilter !== "all") {
    slugs = slugs.filter((slug) => {
      const meta = getRetailCoinMeta(slug);
      return meta.metal === _marketMetalFilter;
    });
  }
  if (query && query.trim()) {
    const q = query.trim().toLowerCase();
    slugs = slugs.filter((slug) => {
      const meta = getRetailCoinMeta(slug);
      if (meta.name.toLowerCase().includes(q)) return true;
      if (meta.metal.toLowerCase().includes(q)) return true;
      const priceData = retailPrices && retailPrices.prices ? retailPrices.prices[slug] : null;
      if (priceData && priceData.vendors) {
        for (const vendorId of Object.keys(priceData.vendors)) {
          const vd = getVendorDisplay(vendorId);
          if (vd.name.toLowerCase().includes(q)) return true;
        }
      }
      return false;
    });
  }
  slugs.sort((a, b) => {
    const metaA = getRetailCoinMeta(a);
    const metaB = getRetailCoinMeta(b);
    const priceA = retailPrices && retailPrices.prices ? retailPrices.prices[a] : null;
    const priceB = retailPrices && retailPrices.prices ? retailPrices.prices[b] : null;
    switch (sortKey) {
      case "metal": {
        const cmp = (metaA.metal || "").localeCompare(metaB.metal || "");
        return cmp !== 0 ? cmp : (metaA.name || "").localeCompare(metaB.name || "");
      }
      case "price-low": {
        const pa = priceA ? (priceA.lowest_price ?? Infinity) : Infinity;
        const pb = priceB ? (priceB.lowest_price ?? Infinity) : Infinity;
        return pa - pb;
      }
      case "price-high": {
        const pa = priceA ? (priceA.lowest_price ?? -Infinity) : -Infinity;
        const pb = priceB ? (priceB.lowest_price ?? -Infinity) : -Infinity;
        return pb - pa;
      }
      case "trend": {
        const ta = _getActiveTrend(a);
        const tb = _getActiveTrend(b);
        const va = ta ? parseFloat(ta.pct) * (ta.dir === "down" ? -1 : 1) : 0;
        const vb = tb ? parseFloat(tb.pct) * (tb.dir === "down" ? -1 : 1) : 0;
        return vb - va;
      }
      default:
        return (metaA.name || "").localeCompare(metaB.name || "");
    }
  });
  return slugs;
};

/**
 * Renders the market list view when MARKET_LIST_VIEW is enabled.
 * Shows list header, iterates filtered+sorted slugs, builds cards.
 */
const _renderMarketListView = () => {
  const grid = safeGetElement("retailCardsGrid");
  const listHeader = safeGetElement("marketListHeader");
  const gridHeader = safeGetElement("marketGridHeader");
  const disclaimer = safeGetElement("retailDisclaimer");
  const emptyState = safeGetElement("retailEmptyState");
  const searchInput = safeGetElement("marketSearchInput");
  const sortSelect = safeGetElement("marketSortSelect");
  const lastSyncEl = safeGetElement("retailLastSyncList");

  // Show list header, hide grid header
  listHeader.style.display = "";
  gridHeader.style.display = "none";

  // Update sync timestamp
  _updateLastSyncEl(lastSyncEl);

  // Switch grid to list mode
  grid.classList.add("market-list-mode");

  // Destroy all active market charts before clearing DOM
  _marketChartInstances.forEach((chart) => chart.destroy());
  _marketChartInstances.clear();
  grid.innerHTML = "";

  // Hide inline disclaimer in list view — disclaimer text lives in the footer instead
  disclaimer.style.display = "none";

  // Reset expand button before any early-return path
  const expandBtn = safeGetElement("marketExpandAllBtn");
  if (expandBtn) expandBtn.title = "Expand All";

  // Trend mode toggle pill (STAK-464) — inject into view-row controls-right
  const viewRow = listHeader ? listHeader.querySelector(".market-header-view-row") : null;
  const controlsRight = viewRow ? viewRow.querySelector(".market-header-controls-right") : null;
  if (controlsRight) {
    const existing = controlsRight.querySelector(".market-trend-toggle");
    if (existing) existing.remove();
    const trendToggle = document.createElement("div");
    trendToggle.className = "market-trend-toggle";
    ["7d", "intraday"].forEach((mode) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "market-trend-toggle-btn" + (_retailTrendMode === mode ? " market-trend-toggle-btn--active" : "");
      btn.setAttribute("aria-pressed", _retailTrendMode === mode ? "true" : "false");
      btn.textContent = mode === "7d" ? "7-Day" : "Intraday";
      btn.addEventListener("click", () => _setRetailTrendMode(mode));
      trendToggle.appendChild(btn);
    });
    controlsRight.insertBefore(trendToggle, controlsRight.firstChild);
  }

  if (_retailSyncInProgress) {
    emptyState.style.display = "none";
    getActiveRetailSlugs().forEach(() => grid.appendChild(_buildSkeletonCard()));
    return;
  }

  const hasData = retailPrices && retailPrices.prices && Object.keys(retailPrices.prices).length > 0;
  emptyState.style.display = hasData ? "none" : "";
  if (!hasData) return;

  const query = searchInput ? searchInput.value : "";
  const sortKey = sortSelect ? sortSelect.value : "name";
  const slugs = _getFilteredSortedSlugs(query, sortKey);

  if (slugs.length === 0) {
    const msg = document.createElement("div");
    msg.className = "market-empty-search";
    msg.textContent = "No items match your search";
    grid.appendChild(msg);
    return;
  }

  slugs.forEach((slug) => {
    const meta = getRetailCoinMeta(slug);
    const priceData = retailPrices.prices[slug] || null;
    const historyData = retailPriceHistory[slug] || null;
    grid.appendChild(_buildMarketListCard(slug, meta, priceData, historyData));
  });

  // Market footer — playground two-row layout with divider + sponsor badge
  const footer = document.createElement("div");
  footer.className = "market-footer";
  const footerText1 = document.createElement("div");
  footerText1.className = "market-footer-text";
  footerText1.textContent = "Confidence scores reflect scraper accuracy \u2014 prices with low confidence may be outdated or incorrectly parsed. Always verify at the vendor\u2019s website before purchasing.";
  footer.appendChild(footerText1);
  const footerDiv = document.createElement("div");
  footerDiv.className = "market-footer-divider";
  footer.appendChild(footerDiv);
  const footerRow = document.createElement("div");
  footerRow.className = "market-footer-row";
  const footerText2 = document.createElement("div");
  footerText2.className = "market-footer-text";
  footerText2.innerHTML = 'Item not found? Request it on <a href="https://reddit.com/r/staktrakr" target="_blank" rel="noopener noreferrer">r/staktrakr</a> &mdash; supporters and early adopters get priority placement in the queue.';
  footerRow.appendChild(footerText2);
  const sponsorBadge = document.createElement("a");
  sponsorBadge.className = "market-sponsor-badge";
  sponsorBadge.href = "https://github.com/sponsors/lbruton";
  sponsorBadge.target = "_blank";
  sponsorBadge.rel = "noopener noreferrer";
  sponsorBadge.textContent = "\u2665 Support";
  footerRow.appendChild(sponsorBadge);
  footer.appendChild(footerRow);
  grid.appendChild(footer);
};

/** Debounced search handler for market list view. */
const _onMarketSearch = () => {
  if (_marketSearchTimer) clearTimeout(_marketSearchTimer);
  _marketSearchTimer = setTimeout(() => _renderMarketListView(), 150);
};

/** Sort change handler for market list view. */
const _onMarketSort = () => {
  const sortSelect = safeGetElement("marketSortSelect");
  const sortLabel = document.querySelector(".market-sort-label");
  if (sortLabel && sortSelect) {
    const selected = sortSelect.options[sortSelect.selectedIndex];
    sortLabel.childNodes[0].textContent = `Sort: ${selected ? selected.textContent : "Name"} `;
  }
  _renderMarketListView();
};

/** Wires market list view event listeners (called once during init). */
const _initMarketListViewListeners = () => {
  const searchInput = safeGetElement("marketSearchInput");
  if (searchInput) searchInput.addEventListener("input", _onMarketSearch);

  const sortSelect = safeGetElement("marketSortSelect");
  if (sortSelect) sortSelect.addEventListener("change", _onMarketSort);

  const syncBtn = safeGetElement("retailSyncBtnList");
  if (syncBtn) syncBtn.addEventListener("click", () => {
    if (typeof syncRetailPrices === "function") syncRetailPrices();
  });

  const expandBtn = safeGetElement("marketExpandAllBtn");
  if (expandBtn) expandBtn.addEventListener("click", () => {
    const grid = safeGetElement("retailCardsGrid");
    const allDetails = grid.querySelectorAll("details.market-card-chart");
    const allOpen = Array.from(allDetails).every((d) => d.open);
    allDetails.forEach((d) => {
      if (allOpen) d.removeAttribute("open");
      else d.setAttribute("open", "");
      d.dispatchEvent(new Event("toggle"));
    });
    expandBtn.title = allOpen ? "Expand All" : "Collapse All";
  });

  const pillContainer = safeGetElement("marketFilterPills");
  if (pillContainer) {
    pillContainer.addEventListener("click", (e) => {
      const pill = e.target.closest(".market-filter-pill");
      if (!pill) return;
      _marketMetalFilter = pill.dataset.metal;
      pillContainer.querySelectorAll(".market-filter-pill").forEach((p) => {
        p.classList.remove("active");
        p.setAttribute("aria-pressed", "false");
      });
      pill.classList.add("active");
      pill.setAttribute("aria-pressed", "true");
      _renderMarketListView();
    });
  }
};

// ---------------------------------------------------------------------------
// Render - History Table (Activity Log sub-tab)
// ---------------------------------------------------------------------------

/**
 * Renders the retail price history table in logPanel_market.
 * Called by switchLogTab('market') via LOG_TAB_RENDERERS.
 */
const renderRetailHistoryTable = () => {
  // Sync log section — rendered at top of Market tab
  const syncLogContainer = safeGetElement("retailSyncLogContainer");
  while (syncLogContainer.firstChild) syncLogContainer.removeChild(syncLogContainer.firstChild);
  try {
    const rawLog = loadDataSync(RETAIL_SYNC_LOG_KEY);
    const syncLog = Array.isArray(rawLog) ? rawLog : [];
    const recent = syncLog.slice(-10).reverse();

    const heading = document.createElement("p");
    heading.className = "retail-history-label";
    heading.style.cssText = "font-weight:600;margin:0 0 0.4rem;";
    heading.textContent = "Recent Syncs";
    syncLogContainer.appendChild(heading);

    if (recent.length === 0) {
      const msg = document.createElement("p");
      msg.className = "settings-subtext";
      msg.style.marginBottom = "0.75rem";
      msg.textContent = "No sync events yet — waiting for first background poll.";
      syncLogContainer.appendChild(msg);
    } else {
      const wrap = document.createElement("div");
      wrap.className = "retail-history-table-wrap";
      wrap.style.marginBottom = "1rem";
      const table = document.createElement("table");
      table.className = "retail-history-table";
      const thead = document.createElement("thead");
      const hrow = document.createElement("tr");
      ["Time", "Status", "Coins", "Window (UTC)"].forEach((label) => {
        const th = document.createElement("th");
        th.textContent = label;
        hrow.appendChild(th);
      });
      thead.appendChild(hrow);
      table.appendChild(thead);
      const tbody2 = document.createElement("tbody");
      recent.forEach((entry) => {
        const tr = document.createElement("tr");
        const ts = entry.ts ? new Date(entry.ts) : null;
        const timeStr = (() => {
          if (!ts || isNaN(ts)) return "--";
          const tz = (typeof TIMEZONE_KEY !== 'undefined' && localStorage.getItem(TIMEZONE_KEY)) || undefined;
          const tzOpts = tz && tz !== 'auto' ? { timeZone: tz } : {};
          try {
            const timePart = ts.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false, ...tzOpts });
            return `${ts.toLocaleDateString(undefined, tzOpts)} ${timePart}`;
          } catch (e) {
            return `${ts.toLocaleDateString()} ${ts.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
          }
        })();
        const windowStr = (() => {
          if (!entry.window) return "\u2014";
          const wd = new Date(entry.window);
          if (isNaN(wd)) return "\u2014";
          return `${wd.getUTCHours().toString().padStart(2, "0")}:${wd.getUTCMinutes().toString().padStart(2, "0")}`;
        })();
        [timeStr, entry.success ? "\u2705 OK" : "\u274C Failed", entry.success ? String(entry.coins) : "\u2014", windowStr].forEach((text) => {
          const td = document.createElement("td");
          td.textContent = text;
          tr.appendChild(td);
        });
        tbody2.appendChild(tr);
      });
      table.appendChild(tbody2);
      wrap.appendChild(table);
      syncLogContainer.appendChild(wrap);
    }
  } catch (err) {
    debugLog(`[retail] Failed to render sync log: ${err.message}`, "warn");
  }

  const select = safeGetElement("retailHistorySlugSelect");
  const tbody = safeGetElement("retailHistoryTableBody");

  // Dynamically populate slug dropdown from active slugs (replaces hardcoded HTML options)
  const activeSlugs = getActiveRetailSlugs();
  const prevSlug = select.value;
  select.innerHTML = "";

  if (!activeSlugs.length) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = "No coins with price history yet";
    select.appendChild(placeholder);
    tbody.innerHTML = "<tr><td colspan=\"7\" class=\"settings-subtext\" style=\"text-align:center\">No history yet \u2014 sync from the Market Prices section.</td></tr>";
    return;
  }

  activeSlugs.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = getRetailCoinMeta(s).name;
    select.appendChild(opt);
  });
  if (prevSlug && activeSlugs.includes(prevSlug)) select.value = prevSlug;

  const slug = select.value || activeSlugs[0];
  const allHistory = getRetailHistoryForSlug(slug);

  const tfBtn = document.querySelector("#logPanel_market [data-retail-timeframe].active");
  const days = tfBtn ? tfBtn.dataset.retailTimeframe : "7";
  const history = days === "all" ? allHistory : (() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(days, 10));
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return allHistory.filter((entry) => entry.date >= cutoffStr);
  })();
  tbody.innerHTML = "";

  if (!history.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.className = "settings-subtext";
    td.style.textAlign = "center";
    td.textContent = "No history yet — sync from the Market Prices section.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  history.forEach((entry) => {
    const tr = document.createElement("tr");
    const cells = [
      entry.date,
      _fmtRetailPrice(entry.avg_median),
      _fmtRetailPrice(entry.avg_low),
      _fmtRetailPrice(entry.vendors && entry.vendors.apmex && entry.vendors.apmex.avg),
      _fmtRetailPrice(entry.vendors && entry.vendors.monumentmetals && entry.vendors.monumentmetals.avg),
      _fmtRetailPrice(entry.vendors && entry.vendors.sdbullion && entry.vendors.sdbullion.avg),
      _fmtRetailPrice(entry.vendors && entry.vendors.jmbullion && entry.vendors.jmbullion.avg),
    ];
    cells.forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
};

// ---------------------------------------------------------------------------
// Initializer
// ---------------------------------------------------------------------------

const initRetailPrices = () => {
  // Restore manifest slug list from localStorage (so we don't fall back to 12-item RETAIL_SLUGS)
  try {
    const cached = localStorage.getItem(RETAIL_MANIFEST_SLUGS_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      _manifestSlugs = Array.isArray(parsed) ? parsed : null;
      if (!_manifestSlugs) localStorage.removeItem(RETAIL_MANIFEST_SLUGS_KEY);
    }
  } catch {
    _manifestSlugs = null;
    try { localStorage.removeItem(RETAIL_MANIFEST_SLUGS_KEY); } catch { /* ignore */ }
  }
  // Restore manifest coin metadata (canonical names, weights, metals)
  try {
    const cachedMeta = localStorage.getItem(RETAIL_MANIFEST_COIN_META_KEY);
    if (cachedMeta) {
      const parsed = JSON.parse(cachedMeta);
      _manifestCoinMeta = (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : null;
      if (!_manifestCoinMeta) localStorage.removeItem(RETAIL_MANIFEST_COIN_META_KEY);
    }
  } catch {
    _manifestCoinMeta = null;
    try { localStorage.removeItem(RETAIL_MANIFEST_COIN_META_KEY); } catch { /* ignore */ }
  }
  // Restore vendor display metadata
  try {
    const cachedVendor = localStorage.getItem(RETAIL_MANIFEST_VENDOR_META_KEY);
    if (cachedVendor) {
      const parsed = JSON.parse(cachedVendor);
      _manifestVendorMeta = (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : null;
      if (!_manifestVendorMeta) localStorage.removeItem(RETAIL_MANIFEST_VENDOR_META_KEY);
    }
  } catch {
    _manifestVendorMeta = null;
    try { localStorage.removeItem(RETAIL_MANIFEST_VENDOR_META_KEY); } catch { /* ignore */ }
  }
  loadRetailPrices();
  loadRetailPriceHistory();
  loadRetailIntradayData();
  _loadRetailTrendMode();
  loadRetailProviders();
  loadRetailAvailability();
  _initMarketListViewListeners();
};
// ---------------------------------------------------------------------------
// Background Auto-Sync
// ---------------------------------------------------------------------------

/** Interval ID for the periodic background sync — stored to allow future cancellation */
let _retailSyncIntervalId = null;

/** How stale (ms) data must be before a background sync is triggered on startup */
const RETAIL_STALE_MS = 60 * 60 * 1000; // 1 hour

/** How often (ms) to re-sync in the background while the page is open */
const RETAIL_POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes (poller cron runs every 30 min)

/**
 * Starts the background retail price auto-sync.
 * Immediately syncs if data is absent or stale, then re-syncs on a periodic interval.
 * Safe to call multiple times — only one interval is kept running.
 * Called from init.js after initRetailPrices().
 */
const startRetailBackgroundSync = () => {
  // Clear any previous interval (safe to call multiple times)
  if (_retailSyncIntervalId !== null) {
    clearInterval(_retailSyncIntervalId);
    _retailSyncIntervalId = null;
  }

  const _runSilentSync = () => {
    syncRetailPrices({ ui: false }).catch((err) => {
      debugLog(`[retail] Background sync failed: ${err.message}`, "warn");
    });
  };

  // Sync immediately if no data, data is stale, or providers.json hasn't been fetched yet
  const lastSync = retailPrices && retailPrices.lastSync ? new Date(retailPrices.lastSync).getTime() : 0;
  const isStale = Date.now() - lastSync > RETAIL_STALE_MS;
  const missingProviders = !retailProviders || Object.keys(retailProviders).length === 0;
  const missingSlugs = !Array.isArray(_manifestSlugs) || _manifestSlugs.length === 0;
  if (isStale || missingProviders || missingSlugs) {
    debugLog(`[retail] Background sync triggered (stale=${isStale}, missingProviders=${missingProviders}, missingSlugs=${missingSlugs})`, "info");
    _runSilentSync();
  }

  // Set up periodic re-sync while the page is open
  _retailSyncIntervalId = setInterval(_runSilentSync, RETAIL_POLL_INTERVAL_MS);
};

/**
 * Updates the #headerMarketDot color based on market manifest generated_at age.
 * Green: < 60 min, Orange: 60 min – 24 hr, Red: > 24 hr or no data.
 */
const updateMarketHealthDot = () => {
  const dot = safeGetElement('headerMarketDot');
  if (!dot.classList) return;
  dot.className = 'cloud-sync-dot header-cloud-dot';
  let ts = null;
  try { ts = localStorage.getItem(RETAIL_MANIFEST_TS_KEY); } catch (e) { /* ignore */ }
  if (!ts) {
    dot.classList.add('header-cloud-dot--red');
    return;
  }
  dot.classList.add(`header-cloud-dot${getHealthStatusClass(ts)}`);
};
window.updateMarketHealthDot = updateMarketHealthDot;

// ---------------------------------------------------------------------------
// Global exposure
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  window.retailPriceHistory = retailPriceHistory;
  window.syncRetailPrices = syncRetailPrices;
  window.loadRetailPrices = loadRetailPrices;
  window.saveRetailPrices = saveRetailPrices;
  window.loadRetailPriceHistory = loadRetailPriceHistory;
  window.saveRetailPriceHistory = saveRetailPriceHistory;
  window.getRetailHistoryForSlug = getRetailHistoryForSlug;
  window.renderRetailCards = renderRetailCards;
  window.renderRetailHistoryTable = renderRetailHistoryTable;
  window.initRetailPrices = initRetailPrices;
  window.startRetailBackgroundSync = startRetailBackgroundSync;
  window.retailProviders = retailProviders;
  window.loadRetailProviders = loadRetailProviders;
  window.saveRetailProviders = saveRetailProviders;
  window.retailIntradayData = retailIntradayData;
  window.loadRetailIntradayData = loadRetailIntradayData;
  window.saveRetailIntradayData = saveRetailIntradayData;
  window.RETAIL_COIN_META = RETAIL_COIN_META;
  window.RETAIL_SLUGS = RETAIL_SLUGS;
  window.RETAIL_VENDOR_NAMES = RETAIL_VENDOR_NAMES;
  window.RETAIL_VENDOR_URLS = RETAIL_VENDOR_URLS;
  window.RETAIL_VENDOR_COLORS = RETAIL_VENDOR_COLORS;
  window.retailAvailability = retailAvailability;
  window.retailLastKnownPrices = retailLastKnownPrices;
  window.retailLastAvailableDates = retailLastAvailableDates;
  window.loadRetailAvailability = loadRetailAvailability;
  window.saveRetailAvailability = saveRetailAvailability;
  window._lastSuccessfulApiBase = _lastSuccessfulApiBase;
  window._renderMarketListView = _renderMarketListView;
  window._buildMarketListCard = _buildMarketListCard;
  window._getFilteredSortedSlugs = _getFilteredSortedSlugs;
  window.getActiveRetailSlugs = getActiveRetailSlugs;
  window.getRetailCoinMeta = getRetailCoinMeta;
  window.getVendorDisplay = getVendorDisplay;
  window._parseGoldbackSlug = _parseGoldbackSlug;
  window.GOLDBACK_WEIGHTS = GOLDBACK_WEIGHTS;
}

// =============================================================================

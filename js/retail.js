// RETAIL MARKET PRICES
// =============================================================================

/** All tracked coin slugs, display order */
const RETAIL_SLUGS = [
  "ase",
  "maple-silver",
  "britannia-silver",
  "krugerrand-silver",
  "kangaroo-silver",
  "koala-silver",
  "kookaburra-silver",
  "generic-silver-round",
  "generic-silver-bar-10oz",
  "age",
  "buffalo",
  "maple-gold",
  "krugerrand-gold",
  "ape",
  "goldback-oklahoma-g1",
];

/** Coin metadata keyed by slug */
const RETAIL_COIN_META = {
  ase: { name: "American Silver Eagle", weight: 1.0, metal: "silver" },
  "maple-silver": { name: "Silver Maple Leaf", weight: 1.0, metal: "silver" },
  "britannia-silver": { name: "Silver Britannia", weight: 1.0, metal: "silver" },
  "krugerrand-silver": { name: "Silver Krugerrand", weight: 1.0, metal: "silver" },
  "kangaroo-silver": { name: "Silver Kangaroo", weight: 1.0, metal: "silver" },
  "koala-silver": { name: "Silver Koala", weight: 1.0, metal: "silver" },
  "kookaburra-silver": { name: "Silver Kookaburra", weight: 1.0, metal: "silver" },
  "generic-silver-round": { name: "Generic Silver Round", weight: 1.0, metal: "silver" },
  "generic-silver-bar-10oz": { name: "Generic 10oz Silver Bar", weight: 10.0, metal: "silver" },
  age: { name: "American Gold Eagle", weight: 1.0, metal: "gold" },
  buffalo: { name: "American Gold Buffalo", weight: 1.0, metal: "gold" },
  "maple-gold": { name: "Gold Maple Leaf", weight: 1.0, metal: "gold" },
  "krugerrand-gold": { name: "Gold Krugerrand", weight: 1.0, metal: "gold" },
  ape: { name: "American Platinum Eagle", weight: 1.0, metal: "platinum" },
  "goldback-oklahoma-g1": { name: "G1 Oklahoma Goldback", weight: 0.001, metal: "goldback" },
};

/** Goldback denomination weights (troy oz) */
const GOLDBACK_WEIGHTS = {
  "g0.25": 0.00025,
  "g0.5": 0.0005,
  ghalf: 0.0005,
  g1: 0.001,
  g2: 0.002,
  g5: 0.005,
  g10: 0.01,
  g25: 0.025,
  g50: 0.05,
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
  const denom = m[2] === "ghalf" ? "G\u00BD" : m[2] === "g0.25" ? "G\u00BC" : m[2].toUpperCase();
  return { name: `${denom} ${state} Goldback`, weight, metal: "goldback" };
};

/** Vendor display names */
const RETAIL_VENDOR_NAMES = {
  apmex: "APMEX",
  monumentmetals: "Monument",
  sdbullion: "SDB",
  jmbullion: "JM",
  herobullion: "Hero",
  bullionexchanges: "BullionX",
  summitmetals: "Summit",
  goldback: "Goldback",
  providentmetals: "Provident",
  gainesvillecoins: "Gainesville",
  mintbuilder: "MintBuilder",
};

/** Vendor homepage URLs for popup links */
const RETAIL_VENDOR_URLS = {
  apmex: "https://www.apmex.com",
  monumentmetals: "https://www.monumentmetals.com",
  sdbullion: "https://www.sdbullion.com",
  jmbullion: "https://www.jmbullion.com",
  herobullion: "https://www.herobullion.com",
  bullionexchanges: "https://www.bullionexchanges.com",
  summitmetals: "https://www.summitmetals.com",
  goldback: "https://www.goldback.com",
  providentmetals: "https://www.providentmetals.com",
  gainesvillecoins: "https://www.gainesvillecoins.com",
  mintbuilder: "https://mintbuilder.com", // no www — matches the canonical host in feed/product URLs
};

/** Per-vendor brand colors — shared with retail-view-modal.js for chart lines and vendor labels */
const RETAIL_VENDOR_COLORS = {
  apmex: "#60a5fa", // bright blue (was #3b82f6 — boosted for dark bg contrast)
  jmbullion: "#fbbf24", // bright amber (was #f59e0b)
  sdbullion: "#34d399", // bright emerald (was #10b981)
  monumentmetals: "#c4b5fd", // bright violet (was #a78bfa)
  herobullion: "#f87171", // red — already distinct
  bullionexchanges: "#f472b6", // bright pink (was #ec4899)
  summitmetals: "#22d3ee", // bright cyan (was #06b6d4)
  goldback: "#d4a017", // deep gold — goldback branding
  providentmetals: "#a3e635", // lime green — distinct from emerald (SDB)
  gainesvillecoins: "#fb923c", // orange — distinct from amber (JM)
  mintbuilder: "#818cf8", // indigo — distinct from blue (APMEX) and violet (Monument)
};

// ---------------------------------------------------------------------------
// Manifest-driven resolver state (populated by syncRetailPrices)
// ---------------------------------------------------------------------------
let _manifestSlugs = null;
let _manifestCoinMeta = null;
let _manifestVendorMeta = null;
let _manifestCacheRestored = false;

// ---------------------------------------------------------------------------
// Market Filter — user-configurable slug/vendor visibility (STAK-515)
// ---------------------------------------------------------------------------
let _marketFilterCache = null;

const _loadMarketFilter = () => {
  if (_marketFilterCache !== null) return _marketFilterCache;
  try {
    _marketFilterCache = loadDataSync(MARKET_FILTER_KEY, {});
    if (
      typeof _marketFilterCache !== "object" ||
      _marketFilterCache === null ||
      Array.isArray(_marketFilterCache)
    ) {
      _marketFilterCache = {};
    }
    // STAK-520: Normalize per-slug entries — corrupted values (scalars, arrays)
    // can survive cloud restore and crash checkbox interactions
    for (const slug of Object.keys(_marketFilterCache)) {
      const entry = _marketFilterCache[slug];
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        _marketFilterCache[slug] = {};
      }
      // STAK-540: Drop orphaned entries for slugs that now fail the STAK-521 predicate
      if (typeof _isSlugResolved === "function" && !_isSlugResolved(slug)) {
        delete _marketFilterCache[slug];
      }
    }
  } catch {
    _marketFilterCache = {};
  }
  return _marketFilterCache;
};

const _saveMarketFilter = (filter) => {
  _marketFilterCache = filter;
  saveDataSync(MARKET_FILTER_KEY, filter);
};

const _isMarketItemEnabled = (slug, vendorId) => {
  const f = _loadMarketFilter();
  if (!f[slug]) return true;
  return f[slug][vendorId] !== false;
};

const _invalidateMarketFilterCache = () => {
  _marketFilterCache = null;
};

/** _isSlugResolved — STAK-521 upstream quarantine predicate.
 *
 * Returns true only when a slug's coin metadata has fully resolved through
 * the getRetailCoinMeta resolver chain (manifest -> hardcoded -> goldback
 * parser -> default). The default fallback returns {name: slug, weight: 0,
 * metal: "unknown"}, so a slug fails this predicate when name === slug
 * AND/OR metal === "unknown".
 *
 * This is the upstream chokepoint fix for the three-plane asymmetry where
 * the market filter matrix hid unresolved slugs but the control plane
 * defaulted them to enabled, so they leaked into the ticker/tables with
 * raw-string labels users could not toggle off.
 *
 * Historical note: this automatically quarantines bare `goldback-gN`
 * denomination stubs that lack a state segment, because _parseGoldbackSlug
 * returns null for them and the resolver falls through to the default.
 * The old _HIDDEN_SLUGS hardcoded exclusion for "goldback-g1" has been
 * removed because this predicate catches it for free. See STAK-498 /
 * STAK-521 history for context.
 */
const _isSlugResolved = (slug) => {
  const meta = getRetailCoinMeta(slug);
  return meta.name !== slug && meta.metal !== "unknown";
};

const _restoreRetailManifestCacheFromStorage = () => {
  if (_manifestCacheRestored) return;
  _manifestCacheRestored = true;

  if (_manifestSlugs === null) {
    try {
      const cached = localStorage.getItem(RETAIL_MANIFEST_SLUGS_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        _manifestSlugs = Array.isArray(parsed) ? parsed : null;
        if (!_manifestSlugs) localStorage.removeItem(RETAIL_MANIFEST_SLUGS_KEY);
      }
    } catch {
      _manifestSlugs = null;
      try {
        localStorage.removeItem(RETAIL_MANIFEST_SLUGS_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  if (_manifestCoinMeta === null) {
    try {
      const cachedMeta = localStorage.getItem(RETAIL_MANIFEST_COIN_META_KEY);
      if (cachedMeta) {
        const parsed = JSON.parse(cachedMeta);
        _manifestCoinMeta =
          parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
        if (!_manifestCoinMeta) localStorage.removeItem(RETAIL_MANIFEST_COIN_META_KEY);
      }
    } catch {
      _manifestCoinMeta = null;
      try {
        localStorage.removeItem(RETAIL_MANIFEST_COIN_META_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  if (_manifestVendorMeta === null) {
    try {
      const cachedVendor = localStorage.getItem(RETAIL_MANIFEST_VENDOR_META_KEY);
      if (cachedVendor) {
        const parsed = JSON.parse(cachedVendor);
        _manifestVendorMeta =
          parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
        if (!_manifestVendorMeta) localStorage.removeItem(RETAIL_MANIFEST_VENDOR_META_KEY);
      }
    } catch {
      _manifestVendorMeta = null;
      try {
        localStorage.removeItem(RETAIL_MANIFEST_VENDOR_META_KEY);
      } catch {
        /* ignore */
      }
    }
  }
};

/** Returns active slugs: manifest-driven (filtered to those with data) or hardcoded fallback.
 *  Excludes slugs that fail `_isSlugResolved` on ALL return paths (STAK-521 upstream quarantine). */
const getActiveRetailSlugs = () => {
  _restoreRetailManifestCacheFromStorage();
  if (!_manifestSlugs) return RETAIL_SLUGS.filter(_isSlugResolved);
  if (!retailPrices?.prices) return _manifestSlugs.filter(_isSlugResolved);
  return _manifestSlugs.filter((slug) => {
    if (!_isSlugResolved(slug)) return false;
    const entry = retailPrices.prices[slug];
    if (!entry) return false;
    if (entry.median_price != null || entry.lowest_price != null) return true;
    const vendors = entry.vendors;
    return vendors && Object.keys(vendors).length > 0;
  });
};

/** Resolve coin metadata: manifest → hardcoded → goldback parser → default */
const getRetailCoinMeta = (slug) => {
  _restoreRetailManifestCacheFromStorage();
  if (_manifestCoinMeta && _manifestCoinMeta[slug]) return _manifestCoinMeta[slug];
  if (RETAIL_COIN_META[slug]) return RETAIL_COIN_META[slug];
  const gb = _parseGoldbackSlug(slug);
  if (gb) return gb;
  return { name: slug, weight: 0, metal: "unknown" };
};

/** Resolve vendor display info: manifest → hardcoded → defaults */
const getVendorDisplay = (vendorId) => {
  _restoreRetailManifestCacheFromStorage();
  if (_manifestVendorMeta && _manifestVendorMeta[vendorId]) return _manifestVendorMeta[vendorId];
  return {
    name: RETAIL_VENDOR_NAMES[vendorId] || vendorId,
    color: RETAIL_VENDOR_COLORS[vendorId] || "#6c757d",
    url: RETAIL_VENDOR_URLS[vendorId] || null,
  };
};

/**
 * Formats a price value in the active display currency, or "—" if null/undefined.
 * @param {number|null|undefined} v
 * @returns {string}
 */
const _fmtRetailPrice = (v) =>
  v !== null && v !== undefined ? formatCurrency(Number(v)) : "\u2014";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// STAK-503: v2 storage key constants (strings match ALLOWED_STORAGE_KEYS in constants.js)
const _V2_RETAIL_PRICES_KEY = "v2RetailPrices"; // nosemgrep: codacy.javascript.security.hard-coded-password
const _V2_RETAIL_INTRADAY_KEY = "v2RetailIntraday"; // nosemgrep: codacy.javascript.security.hard-coded-password
const _V2_RETAIL_HISTORY_KEY = "v2RetailHistory"; // nosemgrep: codacy.javascript.security.hard-coded-password

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

// STRK-141: the legacy `retailPriceHistory` localStorage key is retired.
// These functions are now thin aliases that route through the canonical v2
// store (`_loadV2RetailHistory` / `_saveV2RetailHistory`), so the live writer
// (the retail-view-modal edit) persists to IndexedDB instead of the legacy LS
// key. No new key is introduced. (NOTE: _loadV2RetailHistory is async; await it
// at call sites that need the load to complete before reading.)
const loadRetailPriceHistory = () => _loadV2RetailHistory();

const saveRetailPriceHistory = () => _saveV2RetailHistory();

const loadRetailIntradayData = () => {
  try {
    const loaded = loadDataSync(RETAIL_INTRADAY_KEY);
    retailIntradayData =
      loaded && typeof loaded === "object" && !Array.isArray(loaded) ? loaded : {};
  } catch (err) {
    console.error("[retail] Failed to load intraday data:", err);
    retailIntradayData = {};
  }
  if (typeof window !== "undefined") window.retailIntradayData = retailIntradayData;
};

const saveRetailIntradayData = () => {
  // STAK-300: cap windows_24h to last 96 entries per slug (24h of hourly data)
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
  if (typeof window !== "undefined") window.retailIntradayData = retailIntradayData;
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
    retailProviders =
      loaded && typeof loaded === "object" && !Array.isArray(loaded) ? loaded : null;
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
// v2 Persistence (STAK-503)
// ---------------------------------------------------------------------------

const _saveV2RetailPrices = () => {
  try {
    saveDataSync(_V2_RETAIL_PRICES_KEY, retailPrices);
  } catch (err) {
    _handleSaveError("v2 retail prices", err);
  }
};

const _loadV2RetailPrices = () => {
  try {
    retailPrices = loadDataSync(_V2_RETAIL_PRICES_KEY) || null;
  } catch (e) {
    retailPrices = null;
    debugLog("Failed to load v2 retail prices: " + e.message, "warn");
  }
};

const _saveV2RetailIntraday = () => {
  try {
    saveDataSync(_V2_RETAIL_INTRADAY_KEY, retailIntradayData);
  } catch (err) {
    debugLog(`[retail-v2] Failed to save intraday: ${err.message}`, "warn");
  }
};

const _loadV2RetailIntraday = () => {
  try {
    const loaded = loadDataSync(_V2_RETAIL_INTRADAY_KEY);
    retailIntradayData =
      loaded && typeof loaded === "object" && !Array.isArray(loaded) ? loaded : {};
  } catch (e) {
    retailIntradayData = {};
    debugLog("Failed to load v2 retail intraday: " + e.message, "warn");
  }
  if (typeof window !== "undefined") window.retailIntradayData = retailIntradayData;
};

// STRK-141: retail history is IndexedDB-backed via historyStore (with a
// synchronous localStorage fallback when IndexedDB is unavailable). The
// in-memory retailPriceHistory global stays the synchronous source of truth
// for all render/chart reads; storage is async only at boot hydration (awaited)
// and persistence (fire-and-forget after the global is already updated).
const _saveV2RetailHistory = () => {
  try {
    // Update the in-memory global FIRST so synchronous readers/renderers see the
    // current value immediately, then schedule the durable write.
    if (typeof window !== "undefined") window.retailPriceHistory = retailPriceHistory;
    const store = typeof historyStore !== "undefined" ? historyStore : window?.historyStore;
    if (store && store.isAvailable()) {
      // Fire-and-forget IDB write — do NOT await. Reads already see the global.
      void store.put(_V2_RETAIL_HISTORY_KEY, retailPriceHistory);
    } else {
      saveDataSync(_V2_RETAIL_HISTORY_KEY, retailPriceHistory);
    }
  } catch (err) {
    _handleSaveError("v2 retail history", err);
  }
};

const _loadV2RetailHistory = async () => {
  try {
    const store = typeof historyStore !== "undefined" ? historyStore : window?.historyStore;
    let loaded;
    if (store && store.isAvailable()) {
      // IDB available: prefer it, but fall back to the localStorage copy when
      // get() returns null for a DEFERRED key — migrate() keeps an unconfirmed
      // or wrong-shape payload in localStorage WITHOUT writing it to IDB, so the
      // LS copy is still the source of truth (R3.1, STRK-149 finding #1).
      // `??` (not `!== null`) so the fallback also fires if get() ever returns
      // undefined.
      const idb = await store.get(_V2_RETAIL_HISTORY_KEY);
      loaded = idb ?? loadDataSync(_V2_RETAIL_HISTORY_KEY);
    } else {
      loaded = loadDataSync(_V2_RETAIL_HISTORY_KEY);
    }
    // Preserve the existing type guard: retail history must be a non-array object.
    retailPriceHistory =
      loaded && !Array.isArray(loaded) && typeof loaded === "object" ? loaded : {};
  } catch (e) {
    retailPriceHistory = {};
    debugLog("Failed to load v2 retail history: " + e.message, "warn");
  }
  // MANDATORY re-export after the `let` reassignment — without it readers keep a
  // stale binding (silent data loss).
  if (typeof window !== "undefined") window.retailPriceHistory = retailPriceHistory;
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
let _lastSuccessfulApiBase =
  typeof V2_API_ENDPOINTS !== "undefined"
    ? V2_API_ENDPOINTS[0] + "/retail"
    : "https://api.staktrakr.com/data/v2/retail";

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

  // STAK-483: Patch today's history entry with live prices so chart/trend
  // match the current market data instead of lagging behind a daily average.
  if (result.history30 && latest.window_start && latest.vendors) {
    const today = latest.window_start.slice(0, 10);
    const todayEntry = result.history30.find((e) => e.date === today);
    if (todayEntry) {
      const livePrices = [];
      const patchedVendors = {};
      for (const [vid, vdata] of Object.entries(latest.vendors)) {
        const p =
          vdata.price !== null &&
          vdata.price !== undefined &&
          vdata.price > 0 &&
          isFinite(vdata.price)
            ? Number(vdata.price)
            : null;
        if (p !== null) livePrices.push(p);
        patchedVendors[vid] = { avg: p, inStock: vdata.inStock !== false };
      }
      if (livePrices.length > 0) {
        const sorted = [...livePrices].sort((a, b) => a - b);
        todayEntry.avg_median = Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100;
        todayEntry.avg_low = Math.round(Math.min(...livePrices) * 100) / 100;
        todayEntry.vendors = patchedVendors;
      }
    }
  }

  return result;
};

// ---------------------------------------------------------------------------
// v2 Sync Helpers (STAK-503)
// ---------------------------------------------------------------------------

async function _pickFreshestV2Endpoint() {
  const endpoints = typeof V2_API_ENDPOINTS !== "undefined" ? V2_API_ENDPOINTS : [];
  // STRK-331: the name is finally literal — fetch every endpoint's manifest in
  // parallel and sync from the one with the newest generated_at. Both
  // endpoints publish the same feed on different cadences, so freshest is
  // strictly better; endpoint ORDER no longer decides, which is what let a
  // 23-minute-old primary win over an 8-minute-old backup. A candidate
  // without a parseable generated_at only wins when no timestamped candidate
  // exists, and an unreachable endpoint simply drops out. The footer health
  // badge reports the same freshest-per-feed choice.
  const settled = await Promise.allSettled(
    endpoints.map(async (base) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`${base}/manifest.json`, { signal: controller.signal }).finally(() =>
        clearTimeout(timeoutId)
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const envelope = await resp.json();
      const manifest = envelope && envelope.v === 2 && envelope.data ? envelope.data : envelope;
      return { base, manifest, generatedAt: envelope.generated_at || "" };
    })
  );
  const reachable = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  if (!reachable.length) return null;
  let best = reachable[0];
  let bestTs = Date.parse(best.generatedAt);
  for (const candidate of reachable.slice(1)) {
    const ts = Date.parse(candidate.generatedAt);
    if (!isNaN(ts) && (isNaN(bestTs) || ts > bestTs)) {
      best = candidate;
      bestTs = ts;
    }
  }
  return best;
}

async function _fetchV2Json(base, path) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(`${base}/${path}`, { signal: controller.signal }).finally(() =>
      clearTimeout(timeoutId)
    );
    if (!resp.ok) return null;
    const envelope = await resp.json();
    return envelope && envelope.v === 2 && envelope.data !== undefined ? envelope.data : envelope;
  } catch {
    return null;
  }
}

/**
 * Null-aware weighted average of two values.
 * Returns the non-null operand when the other is null/undefined.
 * @param {number|null|undefined} a
 * @param {number} aWeight
 * @param {number|null|undefined} b
 * @param {number} bWeight
 * @returns {number|null|undefined}
 */
const _weightedHistoryAverage = (a, aWeight, b, bWeight) => {
  if (a == null) return b;
  if (b == null) return a;
  return (a * aWeight + b * bWeight) / (aWeight + bWeight);
};

/**
 * Merges two same-granularity history entries for one date: weighted-averages the
 * aggregates by sample count (`n`), keeps the newest `close` by timestamp, and
 * takes the widest high/low range. Mutates and returns `merged`.
 * @param {object} merged - The shallow-clone target (starts as {...finer}).
 * @param {object} existing - The entry already stored for this date.
 * @param {object} e - The incoming entry colliding on this date.
 * @returns {object} The merged entry.
 */
const _mergeSameRankHistory = (merged, existing, e) => {
  const existingWeight = existing.n > 0 ? existing.n : 1;
  const eWeight = e.n > 0 ? e.n : 1;
  const totalWeight = existingWeight + eWeight;
  merged.open = existing.open ?? e.open;
  if (existing.high != null && e.high != null) merged.high = Math.max(existing.high, e.high);
  else merged.high = existing.high ?? e.high;
  if (existing.low != null && e.low != null) merged.low = Math.min(existing.low, e.low);
  else merged.low = existing.low ?? e.low;
  merged.close = (e.ts ?? 0) >= (existing.ts ?? 0) ? e.close : existing.close;
  merged.avg_median = _weightedHistoryAverage(
    existing.avg_median,
    existingWeight,
    e.avg_median,
    eWeight
  );
  merged.avg_low = _weightedHistoryAverage(existing.avg_low, existingWeight, e.avg_low, eWeight);
  merged.n = totalWeight;
  return merged;
};

/**
 * Merges two different-granularity history entries for one date: the finer
 * (higher `_sourceRank`) entry wins each field, falling back to the coarser
 * entry only where the finer value is null/undefined. Mutates and returns `merged`.
 * @param {object} merged - The shallow-clone target (starts as {...finer}).
 * @param {object} finer - The higher-granularity entry.
 * @param {object} coarser - The lower-granularity entry.
 * @returns {object} The merged entry.
 */
const _mergeCrossRankHistory = (merged, finer, coarser) => {
  merged._sourceRank = finer._sourceRank;
  merged.open = finer.open ?? coarser.open;
  merged.high = finer.high ?? coarser.high;
  merged.low = finer.low ?? coarser.low;
  merged.close = finer.close ?? coarser.close;
  merged.avg_median = finer.avg_median ?? coarser.avg_median;
  merged.avg_low = finer.avg_low ?? coarser.avg_low;
  merged.n = finer.n ?? coarser.n;
  return merged;
};

/**
 * Resolves the colliding pair for a date into one merged entry, dispatching to the
 * same-rank or cross-rank merge and union-merging vendors (finer/incoming wins per key).
 * @param {object} existing - The entry already stored for this date.
 * @param {object} e - The incoming entry colliding on this date.
 * @returns {object} The merged entry.
 */
const _mergeHistoryCollision = (existing, e) => {
  const eRank = e._sourceRank ?? 0;
  const existingRank = existing._sourceRank ?? 0;
  const finer = eRank > existingRank ? e : existing;
  const coarser = eRank > existingRank ? existing : e;
  const sameRank = eRank === existingRank;
  const merged = sameRank
    ? _mergeSameRankHistory({ ...finer }, existing, e)
    : _mergeCrossRankHistory({ ...finer }, finer, coarser);

  const primaryVendors = sameRank ? e.vendors : finer.vendors;
  const fallbackVendors = sameRank ? existing.vendors : coarser.vendors;
  if (primaryVendors || fallbackVendors) {
    merged.vendors = { ...(fallbackVendors || {}), ...(primaryVendors || {}) };
  }
  return merged;
};

/**
 * Deduplicates collected history entries by date, preferring finest-granularity
 * aggregates and union-merging vendors, then returns the series sorted ascending
 * by date with the internal `_sourceRank` field stripped.
 *
 * HIGH-RISK: this preserves the exact JSON-LD → history merge order. Callers must
 * pass entries coarsest-first (90d, then 30d, then 7d) so finer entries overwrite
 * coarser ones on a date collision.
 * @param {Array<object>} historyEntries - Collected entries tagged with `_sourceRank`.
 * @returns {Array<object>} Deduped, date-sorted history series.
 */
const _mergeRetailHistory = (historyEntries) => {
  const byDate = new Map();
  for (const e of historyEntries) {
    if (!e.date) continue;
    const existing = byDate.get(e.date);
    if (!existing) {
      byDate.set(e.date, e);
    } else {
      byDate.set(e.date, _mergeHistoryCollision(existing, e));
    }
  }
  return [...byDate.values()]
    .map(({ _sourceRank, ...entry }) => entry)
    .sort((a, b) => (a.date > b.date ? 1 : -1));
};

/**
 * Builds the per-vendor price map for a slug's `latest` feed, preserving the
 * carried/carried_from flags. Returns an empty object when there are no vendors.
 * @param {object} latest - The slug's latest.json payload.
 * @returns {Object.<string, object>} vendorId → { price, inStock, confidence, carried, carried_from }.
 */
const _buildV2VendorMap = (latest) => {
  const vendorMap = {};
  if (latest.vendors) {
    for (const [vid, vdata] of Object.entries(latest.vendors)) {
      vendorMap[vid] = {
        price: vdata.price,
        inStock: vdata.in_stock !== false,
        confidence: vdata.confidence || null,
        carried: vdata.carried || false,
        carried_from: vdata.carried_from || null,
      };
    }
  }
  return vendorMap;
};

/**
 * Updates the module's availability and last-known-price globals from a slug's
 * `latest` vendor data. Mutates retailAvailability and retailLastKnownPrices in place.
 * @param {string} slug
 * @param {object} latest - The slug's latest.json payload.
 */
const _applyV2SlugAvailability = (slug, latest) => {
  if (!latest.vendors) return;
  if (!retailAvailability[slug]) retailAvailability[slug] = {};
  if (!retailLastKnownPrices[slug]) retailLastKnownPrices[slug] = {};
  for (const [vid, vdata] of Object.entries(latest.vendors)) {
    retailAvailability[slug][vid] = vdata.in_stock !== false;
    if (vdata.price != null && vdata.price > 0) {
      retailLastKnownPrices[slug][vid] = vdata.price;
    }
  }
};

/**
 * Maps a slug's `intraday` feed array into the stored intraday entry shape
 * ({ window_start, windows_24h }).
 * @param {Array<object>} intraday - The slug's intraday.json payload (array of windows).
 * @returns {{ window_start: string|null, windows_24h: Array<object> }}
 */
const _buildV2IntradayEntry = (intraday) => ({
  window_start: intraday.length ? intraday[0].t : null,
  windows_24h: intraday.map((w) => ({
    window: w.t,
    t: w.t,
    ts: w.ts,
    median: w.median,
    low: w.low,
    vendors: w.vendors || {},
  })),
});

/**
 * Collects the 7d/30d/90d history feeds into one flat, `_sourceRank`-tagged list
 * ready for _mergeRetailHistory. Coarsest-first (90d rank 0, 30d rank 1, 7d rank 2)
 * so the dedup lets finer entries overwrite coarser ones on a date collision.
 * @param {Array<object>|null} hist7 - 7-day hourly feed.
 * @param {Array<object>|null} hist30 - 30-day daily feed.
 * @param {Array<object>|null} hist90 - 90-day daily feed.
 * @returns {Array<object>} Tagged history entries.
 */
const _collectV2HistoryEntries = (hist7, hist30, hist90) => {
  const historyEntries = [];
  const addHistory = (data, sourceRank) => {
    if (!Array.isArray(data)) return;
    for (const entry of data) {
      historyEntries.push({
        _sourceRank: sourceRank,
        date: entry.t ? entry.t.slice(0, 10) : null,
        t: entry.t,
        ts: entry.ts,
        open: entry.open,
        high: entry.high,
        low: entry.low,
        close: entry.close,
        avg_median: entry.avg ?? entry.close,
        avg_low: entry.low,
        n: entry.n,
        vendors: entry.vendors || null,
      });
    }
  };
  // Coarsest-first: union spread in dedup relies on finer entries overwriting coarser
  addHistory(hist90, 0);
  addHistory(hist30, 1);
  addHistory(hist7, 2);
  return historyEntries;
};

/**
 * Processes one settled per-slug fetch result: on a fulfilled value it records the
 * price entry into `newPrices`, updates availability/intraday/history globals, and
 * returns 1 when a `latest` price landed (else 0). Rejected results are logged and
 * contribute 0. Preserves the exact JSON-LD → history merge ordering.
 * @param {PromiseSettledResult<object>} r - One Promise.allSettled result.
 * @param {Object.<string, object>} newPrices - Accumulator for current-snapshot prices.
 * @returns {number} 1 if a latest price was recorded, else 0.
 */
const _processV2SlugResult = (r, newPrices) => {
  if (r.status !== "fulfilled") {
    debugLog(`[retail-v2] Slug fetch failed: ${r.reason?.message || r.reason}`, "warn");
    return 0;
  }
  const { slug, latest, intraday, hist7, hist30, hist90 } = r.value;

  let recorded = 0;
  if (latest) {
    newPrices[slug] = {
      median_price: latest.median ?? null,
      lowest_price: latest.low ?? null,
      highest_price: latest.high ?? null,
      vendors: _buildV2VendorMap(latest),
    };
    _applyV2SlugAvailability(slug, latest);
    recorded = 1;
  }

  if (Array.isArray(intraday)) {
    retailIntradayData[slug] = _buildV2IntradayEntry(intraday);
  }

  const historyEntries = _collectV2HistoryEntries(hist7, hist30, hist90);
  if (historyEntries.length) {
    retailPriceHistory[slug] = _mergeRetailHistory(historyEntries);
  }
  return recorded;
};

/**
 * Maps a v2 manifest metal code to the display metal name.
 * @param {string} code - Manifest metal code (xag/xau/xpt/xpd) or a passthrough value.
 * @returns {string} silver/gold/platinum/palladium, the raw code, or "unknown".
 */
const _v2MetalFromCode = (code) => {
  if (code === "xag") return "silver";
  if (code === "xau") return "gold";
  if (code === "xpt") return "platinum";
  if (code === "xpd") return "palladium";
  return code || "unknown";
};

/**
 * Persists a string to localStorage, ignoring quota/availability errors.
 * @param {string} key
 * @param {string} value
 */
const _safeLocalStorageSet = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
};

/**
 * Populates the manifest resolver globals (_manifestSlugs, _manifestCoinMeta,
 * _manifestVendorMeta) from a v2 manifest's coin/vendor arrays and caches them to
 * localStorage. Mutates module state in place and mirrors the coin/vendor meta
 * onto the window properties market-data.js prefers (STRK-317) — the lexical
 * bindings here are invisible to `window.*` reads, so without the mirror a
 * mid-session manifest sync leaves ticker/matrix/modal vendor meta (names,
 * colors, URLs) stale until reload.
 * @param {Array<object>} coins - Manifest coin descriptors.
 * @param {Array<object>} vendors - Manifest vendor descriptors.
 */
const _populateManifestState = (coins, vendors) => {
  _manifestSlugs = coins.map((c) => c.slug);
  _manifestCoinMeta = {};
  for (const c of coins) {
    _manifestCoinMeta[c.slug] = {
      name: c.name,
      weight: c.weight_oz || 0,
      metal: _v2MetalFromCode(c.metal),
    };
  }
  if (_manifestSlugs.length) {
    _safeLocalStorageSet(RETAIL_MANIFEST_SLUGS_KEY, JSON.stringify(_manifestSlugs));
  }
  if (_manifestCoinMeta) {
    _safeLocalStorageSet(RETAIL_MANIFEST_COIN_META_KEY, JSON.stringify(_manifestCoinMeta));
  }

  if (vendors.length) {
    _manifestVendorMeta = {};
    for (const v of vendors) {
      _manifestVendorMeta[v.id] = { name: v.name, color: v.color, url: v.url || null };
    }
    _safeLocalStorageSet(RETAIL_MANIFEST_VENDOR_META_KEY, JSON.stringify(_manifestVendorMeta));
  }

  window._manifestCoinMeta = _manifestCoinMeta;
  if (vendors.length) window._manifestVendorMeta = _manifestVendorMeta;
};

/**
 * Flattens the STAK-348 providers.json shape
 * ({ coins: { slug: { providers: [{ id, url, enabled }] } } }) into the legacy
 * { slug: { vendorId: url } } map all render call sites expect. Uses prototype-less
 * objects to defend against prototype-pollution via malicious __proto__/constructor keys.
 * @param {object} raw - Parsed providers.json (envelope or bare { coins } shape).
 * @returns {Object.<string, Object.<string, string>>} Flattened provider map.
 */
const _flattenV2Providers = (raw) => {
  const flattened = Object.create(null);
  // v2 endpoints use a self-describing envelope { v, generated_at, stale_after, data }.
  // Defensive fallback to bare { coins } shape handles the brief deploy window where
  // the poller hasn't redeployed yet and the old non-envelope shape is still served.
  const coinsObj = (raw && raw.data && raw.data.coins) || (raw && raw.coins) || {};
  for (const [slug, coin] of Object.entries(coinsObj)) {
    if (!coin || !Array.isArray(coin.providers)) continue;
    const vendorMap = Object.create(null);
    for (const p of coin.providers) {
      if (p && p.id && p.enabled !== false && p.url) {
        vendorMap[p.id] = p.url;
      }
    }
    if (Object.keys(vendorMap).length) flattened[slug] = vendorMap;
  }
  return flattened;
};

/**
 * Applies a freshly flattened providers map to module state, with a resilience guard:
 * an empty flatten (poller hiccup / malformed body) keeps the existing cached map
 * rather than wiping previously-working product links.
 * @param {Object.<string, Object.<string, string>>} flattened - Flattened provider map.
 */
const _applyV2Providers = (flattened) => {
  if (Object.keys(flattened).length === 0) {
    const existingCount = Object.keys(retailProviders || {}).length;
    debugLog(
      `[retail-v2] providers.json parsed but produced empty map — keeping ${existingCount} existing cached mappings`,
      "warn"
    );
    return;
  }
  retailProviders = flattened;
  if (typeof window !== "undefined") window.retailProviders = retailProviders;
  saveDataSync(RETAIL_PROVIDERS_KEY, retailProviders);
  debugLog(
    `[retail-v2] Loaded ${Object.keys(retailProviders).length} coin provider mappings`,
    "info"
  );
};

/**
 * Fetches providers.json for the given API base, flattens it to the legacy shape,
 * and applies it to module state. Failures are surfaced via debugLog (the historical
 * silent catch masked the STAK-348 schema drift for months) and never throw.
 * @param {string} apiBase - The resolved v2 API base URL.
 * @returns {Promise<void>}
 */
const _fetchAndApplyV2Providers = async (apiBase) => {
  // Use the AbortController + setTimeout pattern rather than AbortSignal.timeout, which is
  // evaluated synchronously as a fetch argument — on a runtime lacking that static method
  // the fetch throws before the request and the catch silently swallows it, leaving
  // retailProviders stale even though price sync still succeeds (STRK-213).
  // Clear the timer in an outer finally (not on fetch resolution) so the 5s abort stays
  // active through the body read too: a stalled/slow providers.json body would otherwise
  // hang here and leave the whole retail sync wedged with _retailSyncInProgress set.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const providersResp = await fetch(`${apiBase}/providers.json`, {
      signal: controller.signal,
    });
    if (providersResp.ok) {
      _applyV2Providers(_flattenV2Providers(await providersResp.json()));
    } else {
      debugLog(`[retail-v2] providers.json fetch non-OK: ${providersResp.status}`, "warn");
    }
  } catch (err) {
    debugLog(`[retail-v2] providers.json fetch failed: ${err.message}`, "warn");
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Persists all v2 sync outputs (prices, history, intraday, availability) after a
 * successful sync.
 */
const _persistV2SyncResults = () => {
  _saveV2RetailPrices();
  _saveV2RetailHistory();
  _saveV2RetailIntraday();
  saveRetailAvailability();
};

/**
 * Reports a successful v2 sync: sets the optional UI status text, logs the sync,
 * appends a success sync-log entry, and refreshes the market health dot.
 * @param {number} successCount - Number of coins synced.
 * @param {string|null} generatedAt - Manifest generated_at timestamp.
 * @param {boolean} ui - Whether UI elements should be updated.
 * @param {Element} [syncStatus] - Optional status text element.
 */
const _reportV2SyncSuccess = (successCount, generatedAt, ui, syncStatus) => {
  const tz =
    (typeof TIMEZONE_KEY !== "undefined" && localStorage.getItem(TIMEZONE_KEY)) || undefined;
  const tzOpts =
    tz && tz !== "auto"
      ? { timeZone: tz, hour: "numeric", minute: "2-digit" }
      : { hour: "numeric", minute: "2-digit" };
  const syncTime = new Date().toLocaleTimeString(undefined, tzOpts);
  const statusMsg = `Synced ${successCount} coin(s) · ${syncTime}`;
  if (ui && syncStatus) syncStatus.textContent = statusMsg;
  debugLog(`[retail-v2] Sync complete: ${statusMsg}`, "info");
  _appendSyncLogEntry({
    success: true,
    coins: successCount,
    window: generatedAt || null,
    error: null,
  });
  if (typeof updateMarketHealthDot === "function") updateMarketHealthDot();
};

/**
 * Synchronizes retail price, provider, intraday, and history data from a v2 API manifest and updates the module's in-memory and persisted retail state.
 *
 * Performs a full v2 sync: picks a fresh endpoint, loads manifest coin/vendor metadata, fetches providers.json (flattening to legacy shape), and concurrently fetches per-slug latest, intraday, and history feeds. On success it updates in-memory maps (retailPrices, retailPriceHistory, retailIntradayData, retailProviders, retailAvailability, retailLastKnownPrices), persists v2 and legacy keys to storage, appends a sync log entry, and optionally updates UI status and the market health indicator.
 *
 * @param {Object} options - Sync options.
 * @param {boolean} options.ui - If true, updates provided UI elements (status text and button state).
 * @param {Element} [options.syncBtn] - Optional sync button element (may be enabled/disabled by the caller).
 * @param {Element} [options.syncStatus] - Optional element whose textContent will be set with sync status or error messages.
 */
async function _syncRetailV2({ ui, syncBtn, syncStatus }) {
  const result = await _pickFreshestV2Endpoint();
  if (!result) {
    debugLog("[retail-v2] All v2 endpoints unreachable", "warn");
    const errorMsg = "All v2 API endpoints unreachable — check your network connection.";
    if (ui && syncStatus) syncStatus.textContent = errorMsg;
    _appendSyncLogEntry({ success: false, coins: 0, window: null, error: errorMsg });
    return;
  }

  const { base: apiBase, manifest, generatedAt } = result;
  _lastSuccessfulApiBase = apiBase + "/retail";
  window._lastSuccessfulApiBase = _lastSuccessfulApiBase;

  if (generatedAt) {
    _safeLocalStorageSet(RETAIL_MANIFEST_TS_KEY, generatedAt);
  }
  debugLog(`[retail-v2] Using ${apiBase} (generated: ${generatedAt})`, "info");

  // Extract slug list and metadata from v2 manifest, then populate resolver state.
  const coins = Array.isArray(manifest.coins) ? manifest.coins : [];
  const vendors = Array.isArray(manifest.vendors) ? manifest.vendors : [];
  _populateManifestState(coins, vendors);

  // Fetch providers.json for vendor product page URLs.
  // STAK-348 migrated the shape to { coins: { slug: { name, providers: [{ id, url, enabled }] } } }.
  // Flatten back to the legacy { slug: { vid: url } } map that all render call sites expect
  // (js/market-data.js:229/649/879, js/retail-view-modal.js:111). Without this transform
  // every lookup returns undefined and clicks silently fall back to vendor homepages.
  await _fetchAndApplyV2Providers(apiBase);

  const slugs = _manifestSlugs.length ? _manifestSlugs : RETAIL_SLUGS;

  // Fetch per-slug data in parallel: latest, intraday, history-7d, history-30d, history-90d
  const results = await Promise.allSettled(
    slugs.map(async (slug) => {
      const [latest, intraday, hist7, hist30, hist90] = await Promise.all([
        _fetchV2Json(apiBase, `retail/${slug}/latest.json`),
        _fetchV2Json(apiBase, `retail/${slug}/intraday.json`),
        _fetchV2Json(apiBase, `retail/${slug}/history-7d.json`),
        _fetchV2Json(apiBase, `retail/${slug}/history-30d.json`),
        _fetchV2Json(apiBase, `retail/${slug}/history-90d.json`),
      ]);
      return { slug, latest, intraday, hist7, hist30, hist90 };
    })
  );

  let successCount = 0;
  const newPrices = {};

  results.forEach((r) => {
    successCount += _processV2SlugResult(r, newPrices);
  });

  if (successCount > 0) {
    retailPrices = {
      lastSync: new Date().toISOString(),
      window_start: generatedAt || null,
      prices: newPrices,
    };
  }

  if (successCount === 0 && slugs.length > 0) {
    const errorMsg = "All v2 coin price fetches failed — check your network connection.";
    debugLog(`[retail-v2] ${errorMsg}`, "error");
    if (ui && syncStatus) syncStatus.textContent = errorMsg;
    _appendSyncLogEntry({ success: false, coins: 0, window: null, error: errorMsg });
    return;
  }

  if (successCount > 0) {
    _persistV2SyncResults();
  }

  _reportV2SyncSuccess(successCount, generatedAt, ui, syncStatus);
}

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
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.textContent = "Syncing\u2026";
    }
    if (syncStatus) {
      syncStatus.textContent = "";
    }
  }
  _retailSyncInProgress = true;

  try {
    await _syncRetailV2({ ui, syncBtn, syncStatus });
  } catch (err) {
    debugLog(`[retail] Sync error: ${err.message}`, "warn");
    if (ui && syncStatus) syncStatus.textContent = `Sync failed: ${err.message}`;
    _appendSyncLogEntry({ success: false, coins: 0, window: null, error: err.message });
  } finally {
    _retailSyncInProgress = false;
    if (ui && syncBtn) {
      syncBtn.disabled = false;
      syncBtn.textContent = "Sync Now";
    }
    try {
      const mktLogActive = document.querySelector('[data-log-tab="market"].active');
      if (mktLogActive && typeof renderRetailHistoryTable === "function") {
        renderRetailHistoryTable();
      }
    } catch (e) {
      debugLog(`[retail] Post-sync log render failed: ${e.message}`, "warn");
    }
    // STAK-504: Refresh main-page market data (ticker + vendor table) after sync
    if (typeof refreshMarketData === "function") {
      try {
        refreshMarketData();
      } catch (e) {
        debugLog(`[retail] Post-sync market refresh failed: ${e.message}`, "warn");
      }
    }
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
          const tz =
            (typeof TIMEZONE_KEY !== "undefined" && localStorage.getItem(TIMEZONE_KEY)) ||
            undefined;
          const tzOpts = tz && tz !== "auto" ? { timeZone: tz } : {};
          try {
            const timePart = ts.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              ...tzOpts,
            });
            return `${ts.toLocaleDateString(undefined, tzOpts)} ${timePart}`;
          } catch (e) {
            return `${ts.toLocaleDateString()} ${ts.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}`;
          }
        })();
        const windowStr = (() => {
          if (!entry.window) return "\u2014";
          const wd = new Date(entry.window);
          if (isNaN(wd)) return "\u2014";
          return `${wd.getUTCHours().toString().padStart(2, "0")}:${wd.getUTCMinutes().toString().padStart(2, "0")}`;
        })();
        [
          timeStr,
          entry.success ? "\u2705 OK" : "\u274C Failed",
          entry.success ? String(entry.coins) : "\u2014",
          windowStr,
        ].forEach((text) => {
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

  // Resolve vendor list from manifest metadata, or extract from history entries
  let vendorIds = [];
  if (
    typeof _manifestVendorMeta !== "undefined" &&
    _manifestVendorMeta &&
    Object.keys(_manifestVendorMeta).length > 0
  ) {
    vendorIds = Object.keys(_manifestVendorMeta);
  } else {
    const vendorSet = new Set();
    const allSlugsForVendors = getActiveRetailSlugs();
    allSlugsForVendors.forEach((s) => {
      const h = getRetailHistoryForSlug(s);
      h.forEach((entry) => {
        if (entry.vendors) Object.keys(entry.vendors).forEach((vid) => vendorSet.add(vid));
      });
    });
    vendorIds = [...vendorSet].sort();
  }

  // Build dynamic thead
  const thead = safeGetElement("retailHistoryTableHead");
  if (thead && typeof thead.appendChild === "function") {
    while (thead.firstChild) thead.removeChild(thead.firstChild);
    const headerRow = document.createElement("tr");
    ["Date", "Avg Median", "Avg Low"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headerRow.appendChild(th);
    });
    vendorIds.forEach((vid) => {
      const th = document.createElement("th");
      const meta =
        typeof _manifestVendorMeta !== "undefined" && _manifestVendorMeta
          ? _manifestVendorMeta[vid]
          : null;
      th.textContent = meta && meta.name ? meta.name : vid;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
  }

  if (!activeSlugs.length) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = "No coins with price history yet";
    select.appendChild(placeholder);
    const emptyTr = document.createElement("tr");
    const emptyTd = document.createElement("td");
    emptyTd.colSpan = 3 + vendorIds.length;
    emptyTd.className = "settings-subtext";
    emptyTd.style.textAlign = "center";
    emptyTd.textContent = "No history yet \u2014 sync from the Market Prices section.";
    emptyTr.appendChild(emptyTd);
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    tbody.appendChild(emptyTr);
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
  const history =
    days === "all"
      ? allHistory
      : (() => {
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - parseInt(days, 10));
          const cutoffStr = cutoff.toISOString().slice(0, 10);
          return allHistory.filter((entry) => entry.date >= cutoffStr);
        })();
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

  if (!history.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3 + vendorIds.length;
    td.className = "settings-subtext";
    td.style.textAlign = "center";
    td.textContent = "No history yet — sync from the Market Prices section.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  history.forEach((entry) => {
    const tr = document.createElement("tr");
    [entry.date, _fmtRetailPrice(entry.avg_median), _fmtRetailPrice(entry.avg_low)].forEach(
      (text) => {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }
    );
    vendorIds.forEach((vid) => {
      const td = document.createElement("td");
      td.textContent = _fmtRetailPrice(
        entry.vendors && entry.vendors[vid] && entry.vendors[vid].avg
      );
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
};

// ---------------------------------------------------------------------------
// Initializer
// ---------------------------------------------------------------------------

const initRetailPrices = async () => {
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
    try {
      localStorage.removeItem(RETAIL_MANIFEST_SLUGS_KEY);
    } catch {
      /* ignore */
    }
  }
  // Restore manifest coin metadata (canonical names, weights, metals)
  try {
    const cachedMeta = localStorage.getItem(RETAIL_MANIFEST_COIN_META_KEY);
    if (cachedMeta) {
      const parsed = JSON.parse(cachedMeta);
      _manifestCoinMeta =
        parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
      if (!_manifestCoinMeta) localStorage.removeItem(RETAIL_MANIFEST_COIN_META_KEY);
    }
  } catch {
    _manifestCoinMeta = null;
    try {
      localStorage.removeItem(RETAIL_MANIFEST_COIN_META_KEY);
    } catch {
      /* ignore */
    }
  }
  // Restore vendor display metadata
  try {
    const cachedVendor = localStorage.getItem(RETAIL_MANIFEST_VENDOR_META_KEY);
    if (cachedVendor) {
      const parsed = JSON.parse(cachedVendor);
      _manifestVendorMeta =
        parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
      if (!_manifestVendorMeta) localStorage.removeItem(RETAIL_MANIFEST_VENDOR_META_KEY);
    }
  } catch {
    _manifestVendorMeta = null;
    try {
      localStorage.removeItem(RETAIL_MANIFEST_VENDOR_META_KEY);
    } catch {
      /* ignore */
    }
  }
  _loadV2RetailPrices();
  // STRK-141: history load is async (IndexedDB-backed) — await so the global is
  // hydrated before first render. init.js (task 7) awaits initRetailPrices().
  await _loadV2RetailHistory();
  _loadV2RetailIntraday();
  loadRetailProviders();
  loadRetailAvailability();
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
  const lastSync =
    retailPrices && retailPrices.lastSync ? new Date(retailPrices.lastSync).getTime() : 0;
  const isStale = Date.now() - lastSync > RETAIL_STALE_MS;
  const missingProviders = !retailProviders || Object.keys(retailProviders).length === 0;
  const missingSlugs = !Array.isArray(_manifestSlugs) || _manifestSlugs.length === 0;
  if (isStale || missingProviders || missingSlugs) {
    debugLog(
      `[retail] Background sync triggered (stale=${isStale}, missingProviders=${missingProviders}, missingSlugs=${missingSlugs})`,
      "info"
    );
    _runSilentSync();
  }

  // Set up periodic re-sync while the page is open
  _retailSyncIntervalId = setInterval(_runSilentSync, RETAIL_POLL_INTERVAL_MS);
};

/**
 * Updates the #marketFreshnessDot color based on market manifest generated_at age.
 * Green: < 60 min, Orange: 60 min – 24 hr, Red: > 24 hr or no data.
 *
 * STRK-290: the dot moved from the header (#headerMarketDot) into the Market
 * block when the Market header button retired, so the signal now sits beside the
 * data it describes. The element is created in js/market-data.js
 * (_buildMarketBlockHeader), which means it is legitimately absent whenever that
 * block has not rendered yet.
 *
 * The instanceof guard below is load-bearing rather than defensive noise, and it
 * replaces a check that never worked: safeGetElement answers a missing id with a
 * truthy dummy, and createDummyElement (js/init.js) DOES define a classList shim
 * with no-op add/remove. So the previous `if (!dot.classList) return;` was always
 * false and the painter went on to call .add() on the dummy — silently painting
 * nothing. Testing for HTMLElement is what actually distinguishes the two.
 */
const updateMarketHealthDot = () => {
  const dot = safeGetElement("marketFreshnessDot");
  if (!(dot instanceof HTMLElement)) return;
  // .cloud-sync-dot is the inline-flow variant (inline-block, flex-shrink: 0),
  // and it is the deliberate choice here rather than a default. The alternative
  // was .header-cloud-dot, `position: absolute` with bottom/right offsets
  // because it was a badge overlaid on a header button's corner; in the Market
  // block's flex row that took the dot out of flow and anchored it to an
  // unrelated positioned ancestor. STRK-298 deleted that rule once its last
  // button retired, so the trap is gone, but the reason this line reads
  // .cloud-sync-dot is that history. The header-cloud-dot--{green,orange,red}
  // modifiers added below are a separate, still-live set: they set only
  // background and box-shadow, so they compose with any base.
  dot.className = "cloud-sync-dot";
  let ts = null;
  try {
    ts = localStorage.getItem(RETAIL_MANIFEST_TS_KEY);
  } catch (e) {
    /* ignore */
  }
  if (!ts) {
    dot.classList.add("header-cloud-dot--red");
    return;
  }
  dot.classList.add(`header-cloud-dot${getHealthStatusClass(ts)}`);
};
window.updateMarketHealthDot = updateMarketHealthDot;

if (typeof window !== "undefined") {
  window.addEventListener("currencychange", () => {
    try {
      if (typeof renderRetailHistoryTable === "function") renderRetailHistoryTable();
    } catch (e) {}
  });
}

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
  window.getActiveRetailSlugs = getActiveRetailSlugs;
  window.getRetailCoinMeta = getRetailCoinMeta;
  window.getVendorDisplay = getVendorDisplay;
  window._parseGoldbackSlug = _parseGoldbackSlug;
  window.GOLDBACK_WEIGHTS = GOLDBACK_WEIGHTS;
  window._isSlugResolved = _isSlugResolved;
  window._isMarketItemEnabled = _isMarketItemEnabled;
  window._invalidateMarketFilterCache = _invalidateMarketFilterCache;
  window._loadMarketFilter = _loadMarketFilter;
  window._saveMarketFilter = _saveMarketFilter;
}

// =============================================================================

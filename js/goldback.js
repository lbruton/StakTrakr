// GOLDBACK DENOMINATION PRICING (STACK-45)
// =============================================================================
// Manual-entry pricing for Goldback denominations.
// Follows priceHistory.js patterns: save/load/record with saveDataSync/loadDataSync.
// Data structures:
//   goldbackPrices:       { "1": { price: 5.12, updatedAt: 1707500000000 }, ... }
//   goldbackPriceHistory: { "1": [{ ts: 1707500000000, price: 5.12 }, ...], ... }
// =============================================================================

let goldbackPricingSource = "api";

const GOLD_BACK_PRICING_SOURCES = new Set(["off", "api", "spot", "manual"]);

const syncLegacyGoldbackFlags = () => {
  goldbackEnabled = goldbackPricingSource !== "off";
  goldbackEstimateEnabled = goldbackPricingSource === "spot";
  if (typeof window !== "undefined") {
    window.goldbackPricingSource = goldbackPricingSource;
  }
};

const normalizeGoldbackPricingSource = (value) => {
  const source = typeof value === "string" ? value.toLowerCase() : "";
  return GOLD_BACK_PRICING_SOURCES.has(source) ? source : null;
};

/**
 * Loads the active Goldback pricing source from localStorage, migrating from
 * legacy boolean keys if needed.
 * @returns {"off"|"api"|"spot"|"manual"}
 */
const loadGoldbackPricingSource = () => {
  try {
    const storedValue = loadDataSync(GOLDBACK_PRICING_SOURCE_KEY, null);
    const normalizedValue = normalizeGoldbackPricingSource(storedValue);

    if (normalizedValue) {
      goldbackPricingSource = normalizedValue;
      syncLegacyGoldbackFlags();
      return goldbackPricingSource;
    }

    const legacyEnabled = loadDataSync(GOLDBACK_ENABLED_KEY, true) === true;
    const legacyEstimateEnabled = loadDataSync(GOLDBACK_ESTIMATE_ENABLED_KEY, false) === true;

    goldbackPricingSource = !legacyEnabled ? "off" : legacyEstimateEnabled ? "spot" : "api";
    saveDataSync(GOLDBACK_PRICING_SOURCE_KEY, goldbackPricingSource);
  } catch (error) {
    console.error("Error loading Goldback pricing source:", error);
    goldbackPricingSource = "api";
  }

  syncLegacyGoldbackFlags();
  return goldbackPricingSource;
};

/**
 * Saves the active Goldback pricing source to localStorage.
 * @param {"off"|"api"|"spot"|"manual"} value - Selected source identifier
 * @returns {"off"|"api"|"spot"|"manual"}
 */
const saveGoldbackPricingSource = (value) => {
  const normalizedValue = normalizeGoldbackPricingSource(value) || "api";
  goldbackPricingSource = normalizedValue;
  syncLegacyGoldbackFlags();

  try {
    saveDataSync(GOLDBACK_PRICING_SOURCE_KEY, goldbackPricingSource);
  } catch (error) {
    console.error("Error saving Goldback pricing source:", error);
  }

  return goldbackPricingSource;
};

/**
 * Saves current Goldback denomination prices to localStorage.
 */
const saveGoldbackPrices = () => {
  try {
    saveDataSync(GOLDBACK_PRICES_KEY, goldbackPrices);
  } catch (error) {
    console.error("Error saving Goldback prices:", error);
  }
};

/**
 * Loads Goldback denomination prices from localStorage into global state.
 */
const loadGoldbackPrices = () => {
  try {
    const data = loadDataSync(GOLDBACK_PRICES_KEY, {});
    goldbackPrices = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (error) {
    console.error("Error loading Goldback prices:", error);
    goldbackPrices = {};
  }
};

/**
 * Saves Goldback price history to localStorage.
 */
const saveGoldbackPriceHistory = () => {
  try {
    saveDataSync(GOLDBACK_PRICE_HISTORY_KEY, goldbackPriceHistory);
  } catch (error) {
    console.error("Error saving Goldback price history:", error);
  }
};

/**
 * Loads Goldback price history from localStorage into global state.
 */
const loadGoldbackPriceHistory = () => {
  try {
    const data = loadDataSync(GOLDBACK_PRICE_HISTORY_KEY, {});
    goldbackPriceHistory = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (error) {
    console.error("Error loading Goldback price history:", error);
    goldbackPriceHistory = {};
  }
};

const GOLDBACK_HISTORY_DAY_MS = 24 * 60 * 60 * 1000;

const getGoldbackHistoryDay = (ts) => {
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const getGoldbackHistoryDayIndexFromDay = (day) => {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  const ts = new Date(`${day}T00:00:00Z`).getTime();
  if (Number.isNaN(ts) || getGoldbackHistoryDay(ts) !== day) return null;

  return ts / GOLDBACK_HISTORY_DAY_MS;
};

const getGoldbackHistoryDayIndex = (dateLike) => {
  const day =
    typeof dateLike === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateLike)
      ? dateLike.slice(0, 10)
      : getGoldbackHistoryDay(dateLike);
  return getGoldbackHistoryDayIndexFromDay(day);
};

const sortGoldbackHistoryEntries = (key) => {
  const entries = goldbackPriceHistory[key];
  if (Array.isArray(entries)) entries.sort((a, b) => a.ts - b.ts);
};

const sortGoldbackHistoryKeys = (keys) => {
  keys.forEach((key) => sortGoldbackHistoryEntries(key));
};

const getGoldbackHistoryPrice = (weightGb, dateLike) => {
  const key = String(parseFloat(weightGb) || 0);
  const entries = Array.isArray(goldbackPriceHistory[key]) ? goldbackPriceHistory[key] : [];
  const ts =
    typeof dateLike === "number"
      ? dateLike
      : typeof dateLike === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateLike)
        ? new Date(`${dateLike.slice(0, 10)}T12:00:00Z`).getTime()
        : new Date(dateLike).getTime();
  if (!ts || Number.isNaN(ts)) return null;

  const day = getGoldbackHistoryDay(ts);
  const entry = [...entries]
    .reverse()
    .find((candidate) => candidate?.ts && getGoldbackHistoryDay(candidate.ts) === day);
  return entry && typeof entry.price === "number" && entry.price > 0 ? entry.price : null;
};

const searchGoldbackHistoryByDate = (weightGb, dateStr) => {
  const key = String(parseFloat(weightGb) || 0);
  const entries = Array.isArray(goldbackPriceHistory[key]) ? goldbackPriceHistory[key] : [];
  const targetDayIndex = getGoldbackHistoryDayIndex(dateStr);
  if (targetDayIndex === null) return [];

  const withOffset = entries
    .filter((entry) => entry && typeof entry.price === "number" && entry.price > 0 && entry.ts)
    .map((entry) => {
      const entryDate = new Date(entry.ts);
      const entryDayIndex = getGoldbackHistoryDayIndex(entry.ts);
      if (entryDayIndex === null) return null;

      return {
        timestamp: entryDate.toISOString(),
        price: entry.price,
        source: entry.source || "goldback",
        provider: entry.provider || "Goldback",
        dayOffset: entryDayIndex - targetDayIndex,
      };
    })
    .filter(Boolean);

  const windows = [0, 1, 3, 7];
  let results = [];
  for (const window of windows) {
    results = withOffset.filter((entry) => Math.abs(entry.dayOffset) <= window);
    if (results.length > 0) break;
  }

  results.sort((a, b) => {
    const proxDiff = Math.abs(a.dayOffset) - Math.abs(b.dayOffset);
    if (proxDiff !== 0) return proxDiff;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  const byDay = new Map();
  for (const entry of results) {
    const day = entry.timestamp.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, entry);
  }
  return [...byDay.values()];
};

const upsertGoldbackHistoryEntry = (key, entry, options = {}) => {
  if (!entry || typeof entry.price !== "number" || entry.price <= 0 || !entry.ts) return false;

  if (!goldbackPriceHistory[key]) {
    goldbackPriceHistory[key] = [];
  }

  const arr = goldbackPriceHistory[key];
  const day = getGoldbackHistoryDay(entry.ts);
  const existingIdx = arr.findIndex((candidate) => getGoldbackHistoryDay(candidate.ts) === day);

  if (existingIdx >= 0) {
    const existing = arr[existingIdx];
    if (existing.price === entry.price && existing.source === entry.source) return false;
    if (existing.source === "manual" && entry.source !== "manual") return false;
    arr[existingIdx] = { ...existing, ...entry };
  } else {
    arr.push(entry);
  }

  if (options.sort !== false) sortGoldbackHistoryEntries(key);
  return true;
};

/**
 * Loads the Goldback pricing enabled toggle from localStorage.
 */
const loadGoldbackEnabled = () => {
  loadGoldbackPricingSource();
  return goldbackEnabled;
};

/**
 * Saves the Goldback pricing enabled toggle to localStorage.
 * @param {boolean} val - Whether Goldback pricing is enabled
 */
const saveGoldbackEnabled = (val) => {
  if (val === true) {
    return saveGoldbackPricingSource(
      goldbackPricingSource === "off" ? "api" : goldbackPricingSource
    );
  }
  return saveGoldbackPricingSource("off");
};

/**
 * Appends current denomination prices as timestamped history entries.
 * Called after user saves updated prices in the settings panel.
 */
const recordGoldbackPrices = () => {
  const now = Date.now();
  let changed = false;
  const changedKeys = new Set();

  for (const key of Object.keys(goldbackPrices)) {
    const entry = goldbackPrices[key];
    if (!entry || typeof entry.price !== "number" || entry.price <= 0) continue;

    const source = entry.source || (goldbackPricingSource === "manual" ? "manual" : undefined);
    const didChange = upsertGoldbackHistoryEntry(
      key,
      { ts: now, price: entry.price, source },
      { sort: false }
    );
    if (didChange) {
      changed = true;
      changedKeys.add(key);
    }
  }

  if (changed) {
    sortGoldbackHistoryKeys(changedKeys);
    saveGoldbackPriceHistory();
  }
};

/**
 * Returns the denomination price for a given Goldback weight, or null.
 * @param {number} weightGb - Weight in Goldback denomination units (e.g. 1, 5, 10)
 * @returns {number|null} Per-unit denomination price, or null if not set
 */
const getGoldbackDenominationPrice = (weightGb) => {
  const key = String(weightGb);
  const entry = goldbackPrices[key];
  if (entry && typeof entry.price === "number" && entry.price > 0) {
    return entry.price;
  }
  return null;
};

/**
 * Returns true if Goldback pricing is active (enabled + has at least one price).
 * @returns {boolean}
 */
const isGoldbackPricingActive = () => {
  return goldbackPricingSource !== "off";
};

// =============================================================================
// GOLDBACK REAL-TIME PRICE ESTIMATION (STACK-52)
// =============================================================================

/**
 * Loads the Goldback estimation enabled toggle from localStorage.
 */
const loadGoldbackEstimateEnabled = () => {
  loadGoldbackPricingSource();
  return goldbackEstimateEnabled;
};

/**
 * Saves the Goldback estimation enabled toggle to localStorage.
 * @param {boolean} val - Whether estimation is enabled
 */
const saveGoldbackEstimateEnabled = (val) => {
  if (val === true) {
    return saveGoldbackPricingSource("spot");
  }
  if (goldbackPricingSource === "spot") {
    return saveGoldbackPricingSource("api");
  }
  syncLegacyGoldbackFlags();
  return goldbackPricingSource;
};

/**
 * Loads the user-configurable premium modifier from localStorage.
 */
const loadGoldbackEstimateModifier = () => {
  try {
    const val = loadDataSync(GB_ESTIMATE_MODIFIER_KEY, GB_ESTIMATE_PREMIUM);
    const num = parseFloat(val);
    goldbackEstimateModifier = !isNaN(num) && num > 0 ? num : GB_ESTIMATE_PREMIUM;
  } catch (error) {
    console.error("Error loading Goldback estimate modifier:", error);
    goldbackEstimateModifier = GB_ESTIMATE_PREMIUM;
  }
};

/**
 * Saves the user-configurable premium modifier to localStorage.
 * @param {number} val - Modifier value (e.g. 1.0, 1.03)
 */
const saveGoldbackEstimateModifier = (val) => {
  const num = parseFloat(val);
  goldbackEstimateModifier = !isNaN(num) && num > 0 ? num : GB_ESTIMATE_PREMIUM;
  try {
    saveDataSync(GB_ESTIMATE_MODIFIER_KEY, goldbackEstimateModifier);
  } catch (error) {
    console.error("Error saving Goldback estimate modifier:", error);
  }
};

/**
 * Computes the estimated 1 Goldback exchange rate from gold spot price.
 * Formula: 2 × (goldSpot / 1000) × modifier
 * @param {number} goldSpot - Current gold spot price per troy oz
 * @returns {number} Estimated 1 Goldback rate in USD
 */
const computeGoldbackEstimatedRate = (goldSpot) => {
  return 2 * (goldSpot / 1000) * goldbackEstimateModifier;
};

/**
 * Hook called whenever the gold spot price changes (API sync, manual, cache).
 * If estimation is ON + Goldback pricing is ON + valid gold spot:
 * calculates all denomination prices, saves them, records history, refreshes UI.
 */
const onGoldSpotPriceChanged = () => {
  if (!goldbackEstimateEnabled || !goldbackEnabled) return;

  const goldSpot = spotPrices && spotPrices.gold ? spotPrices.gold : 0;
  if (!goldSpot || goldSpot <= 0) return;

  const gbRate = computeGoldbackEstimatedRate(goldSpot);
  const now = Date.now();

  if (typeof GOLDBACK_DENOMINATIONS === "undefined") return;

  for (const d of GOLDBACK_DENOMINATIONS) {
    const key = String(d.weight);
    const denomPrice = Math.round(gbRate * d.weight * 100) / 100;
    goldbackPrices[key] = { price: denomPrice, updatedAt: now, source: "spot" };
  }

  if (typeof saveGoldbackPrices === "function") saveGoldbackPrices();
  if (typeof recordGoldbackPrices === "function") recordGoldbackPrices();

  // Refresh settings UI if the Goldback panel is visible
  if (typeof syncGoldbackSettingsUI === "function") syncGoldbackSettingsUI();

  if (typeof renderRatioChips === "function") renderRatioChips();
};

// =============================================================================
// GOLDBACK API FETCH (STAK-241)
// =============================================================================

/**
 * Fetches today's Goldback rate from the StakTrakr API and populates all
 * denomination prices from g1_usd. Saves and records history on success.
 * @returns {Promise<{ok: boolean, g1_usd?: number, error?: string}>}
 */
const fetchGoldbackApiPrices = async (options = {}) => {
  const expectedSource = typeof options.expectedSource === "string" ? options.expectedSource : null;
  const v2Endpoints =
    typeof V2_API_ENDPOINTS !== "undefined" && V2_API_ENDPOINTS.length
      ? V2_API_ENDPOINTS
      : ["https://api.staktrakr.com/data/v2"];

  let envelope;
  let lastErr;
  let usedEndpoint;
  for (const ep of v2Endpoints) {
    const url = `${ep}/goldback/latest.json`;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      envelope = await res.json();
      usedEndpoint = ep;
      break;
    } catch (err) {
      clearTimeout(tid);
      lastErr = err;
    }
  }
  if (!envelope || !envelope.data)
    return { ok: false, error: lastErr ? String(lastErr) : "No v2 goldback data" };

  const gbData = envelope.data;
  const g1 = typeof gbData.g1_usd === "number" && gbData.g1_usd > 0 ? gbData.g1_usd : null;
  if (!g1) return { ok: false, error: "Invalid or missing g1_usd in v2 response" };

  if (typeof GOLDBACK_DENOMINATIONS === "undefined") {
    return { ok: false, error: "GOLDBACK_DENOMINATIONS not defined" };
  }

  if (expectedSource && goldbackPricingSource !== expectedSource) {
    return { ok: false, error: "Stale Goldback API response ignored" };
  }

  const now = Date.now();
  for (const d of GOLDBACK_DENOMINATIONS) {
    const key = String(d.weight);
    const denomKey = `g${d.weight}`;
    const price =
      gbData.denominations && typeof gbData.denominations[denomKey] === "number"
        ? gbData.denominations[denomKey]
        : Math.round(g1 * d.weight * 100) / 100;
    goldbackPrices[key] = {
      price,
      updatedAt: now,
      source: "api",
      ts: gbData.ts,
      // stale_after lives at the ENVELOPE top level (envelope.stale_after), not in data.
      staleAfter: envelope.stale_after,
    };
  }

  if (typeof saveGoldbackPrices === "function") saveGoldbackPrices();
  if (usedEndpoint) await fetchGoldbackApiHistory(usedEndpoint);
  if (typeof recordGoldbackPrices === "function") recordGoldbackPrices();
  if (typeof syncGoldbackSettingsUI === "function") syncGoldbackSettingsUI();
  if (typeof window !== "undefined" && typeof window.renderRatioChips === "function") {
    window.renderRatioChips();
  } else if (typeof renderRatioChips === "function") {
    renderRatioChips();
  }

  return { ok: true, g1_usd: g1 };
};

const fetchGoldbackApiHistory = async (baseEndpoint) => {
  if (!baseEndpoint || typeof GOLDBACK_DENOMINATIONS === "undefined") return false;

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${baseEndpoint}/goldback/history-30d.json`, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const envelope = await res.json();
    const rows = Array.isArray(envelope?.data) ? envelope.data : [];
    let changed = false;
    const changedKeys = new Set();

    for (const row of rows) {
      const g1 =
        typeof row.close === "number"
          ? row.close
          : typeof row.avg === "number"
            ? row.avg
            : typeof row.g1_usd === "number"
              ? row.g1_usd
              : null;
      if (!g1 || g1 <= 0) continue;

      const ts =
        typeof row.t === "string"
          ? new Date(row.t).getTime()
          : typeof row.ts === "number"
            ? row.ts * (row.ts < 1000000000000 ? 1000 : 1)
            : 0;
      if (!ts || Number.isNaN(ts)) continue;

      for (const d of GOLDBACK_DENOMINATIONS) {
        const key = String(d.weight);
        const price = Math.round(g1 * d.weight * 100) / 100;
        const didChange = upsertGoldbackHistoryEntry(
          key,
          { ts, price, source: "api" },
          { sort: false }
        );
        if (didChange) {
          changed = true;
          changedKeys.add(key);
        }
      }
    }

    if (changed) {
      sortGoldbackHistoryKeys(changedKeys);
      saveGoldbackPriceHistory();
    }
    return changed;
  } catch (error) {
    clearTimeout(tid);
    console.warn("Goldback API history fetch failed:", error);
    return false;
  }
};

/**
 * Returns the Goldback vendor reference price for a goldback slug.
 * @param {string} slug - e.g. "goldback-oklahoma-g1"
 * @returns {{ price: number, updatedAt: number, isStale: boolean, source: string } | null}
 */
const getGoldbackVendorPrice = (slug) => {
  if (!slug || !slug.startsWith("goldback-")) return null;
  const denomMatch = slug.match(/g([\d.]+)$/);
  if (!denomMatch) return null;
  const denomKey = denomMatch[1]; // "1", "5", "25", etc.
  if (!goldbackPrices || !goldbackPrices[denomKey]) return null;
  const entry = goldbackPrices[denomKey];
  if (entry.price == null) return null;
  const STALE_MS = 25 * 60 * 60 * 1000; // 25 hours
  const isStale = !entry.updatedAt || Date.now() - entry.updatedAt > STALE_MS;
  return { price: entry.price, updatedAt: entry.updatedAt, isStale, source: "goldback.com" };
};

// =============================================================================
// GOLDBACK PRICE HISTORY MODAL
// =============================================================================

/** @type {string} Current filter text for the history table */
let gbHistoryFilterText = "";
/** @type {string} Current sort column */
let gbHistorySortColumn = "";
/** @type {boolean} Sort direction (true = ascending) */
let gbHistorySortAsc = true;

/**
 * Flattens goldbackPriceHistory into a row array for table rendering.
 * Each entry: { denomination, label, price, timestamp }
 */
const flattenGoldbackHistory = () => {
  const rows = [];
  const denomLabels = {};
  if (typeof GOLDBACK_DENOMINATIONS !== "undefined") {
    for (const d of GOLDBACK_DENOMINATIONS) {
      denomLabels[String(d.weight)] = d.label;
    }
  }

  for (const [key, entries] of Object.entries(goldbackPriceHistory)) {
    if (!Array.isArray(entries)) continue;
    const label = denomLabels[key] || `${key} gb`;
    for (const e of entries) {
      rows.push({
        denomination: key,
        label,
        price: e.price,
        timestamp: e.ts,
        timeStr:
          typeof formatTimestamp === "function"
            ? formatTimestamp(e.ts)
            : new Date(e.ts).toLocaleString(),
      });
    }
  }
  return rows;
};

/**
 * Renders the Goldback history table with filtering and sorting.
 */
const renderGoldbackHistoryTable = () => {
  const table = document.getElementById("goldbackHistoryTable");
  if (!table) return;

  let data = flattenGoldbackHistory();

  // Filter
  if (gbHistoryFilterText) {
    const f = gbHistoryFilterText.toLowerCase();
    data = data.filter((e) => Object.values(e).some((v) => String(v).toLowerCase().includes(f)));
  }

  // Sort
  if (gbHistorySortColumn) {
    data.sort((a, b) => {
      const valA = a[gbHistorySortColumn];
      const valB = b[gbHistorySortColumn];
      if (valA < valB) return gbHistorySortAsc ? -1 : 1;
      if (valA > valB) return gbHistorySortAsc ? 1 : -1;
      return 0;
    });
  } else {
    // Default: newest first
    data.sort((a, b) => b.timestamp - a.timestamp);
  }

  let html =
    '<tr><th data-column="timestamp">Time</th><th data-column="label">Denomination</th><th data-column="price">Price</th></tr>';
  for (const e of data) {
    html += `<tr><td>${e.timeStr}</td><td>${e.label}</td><td>${typeof formatCurrency === "function" ? formatCurrency(e.price) : "$" + e.price.toFixed(2)}</td></tr>`;
  }
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
  table.innerHTML = html;

  // Click-to-sort headers
  table.querySelectorAll("th").forEach((th) => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const col = th.dataset.column;
      if (gbHistorySortColumn === col) {
        gbHistorySortAsc = !gbHistorySortAsc;
      } else {
        gbHistorySortColumn = col;
        gbHistorySortAsc = true;
      }
      renderGoldbackHistoryTable();
    });
  });
};

/**
 * Shows the Goldback price history modal.
 */
const showGoldbackHistoryModal = () => {
  const modal = document.getElementById("goldbackHistoryModal");
  if (!modal) return;

  gbHistorySortColumn = "";
  gbHistorySortAsc = true;
  gbHistoryFilterText = "";

  const filterInput = document.getElementById("goldbackHistoryFilter");
  const clearFilterBtn = document.getElementById("goldbackHistoryClearFilterBtn");

  if (filterInput) {
    filterInput.value = "";
    filterInput.oninput = (e) => {
      gbHistoryFilterText = e.target.value;
      renderGoldbackHistoryTable();
    };
  }
  if (clearFilterBtn) {
    clearFilterBtn.onclick = () => {
      gbHistoryFilterText = "";
      if (filterInput) filterInput.value = "";
      renderGoldbackHistoryTable();
    };
  }

  renderGoldbackHistoryTable();

  if (typeof openModalById === "function") {
    openModalById("goldbackHistoryModal");
  } else {
    modal.style.display = "flex";
  }
};

/**
 * Hides the Goldback price history modal.
 */
const hideGoldbackHistoryModal = () => {
  if (typeof closeModalById === "function") {
    closeModalById("goldbackHistoryModal");
  } else {
    const modal = document.getElementById("goldbackHistoryModal");
    if (modal) modal.style.display = "none";
  }
};

/**
 * Exports Goldback price history as CSV.
 */
const exportGoldbackHistory = () => {
  const data = flattenGoldbackHistory();
  if (data.length === 0) {
    appAlert("No Goldback price history to export.");
    return;
  }

  // Sort newest first
  data.sort((a, b) => b.timestamp - a.timestamp);

  const csvLines = ["Time,Denomination,Price"];
  for (const e of data) {
    csvLines.push(`"${e.timeStr}","${e.label}","${e.price.toFixed(2)}"`);
  }

  const blob = new Blob([csvLines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `goldback-history-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// =============================================================================
// GLOBAL EXPOSURE
// =============================================================================
if (typeof window !== "undefined") {
  window.goldbackPricingSource = goldbackPricingSource;
  window.loadGoldbackPricingSource = loadGoldbackPricingSource;
  window.saveGoldbackPricingSource = saveGoldbackPricingSource;
  window.loadGoldbackEstimateEnabled = loadGoldbackEstimateEnabled;
  window.saveGoldbackEstimateEnabled = saveGoldbackEstimateEnabled;
  window.loadGoldbackEstimateModifier = loadGoldbackEstimateModifier;
  window.saveGoldbackEstimateModifier = saveGoldbackEstimateModifier;
  window.computeGoldbackEstimatedRate = computeGoldbackEstimatedRate;
  window.onGoldSpotPriceChanged = onGoldSpotPriceChanged;
  window.saveGoldbackPrices = saveGoldbackPrices;
  window.loadGoldbackPrices = loadGoldbackPrices;
  window.saveGoldbackPriceHistory = saveGoldbackPriceHistory;
  window.loadGoldbackPriceHistory = loadGoldbackPriceHistory;
  window.loadGoldbackEnabled = loadGoldbackEnabled;
  window.saveGoldbackEnabled = saveGoldbackEnabled;
  window.recordGoldbackPrices = recordGoldbackPrices;
  window.getGoldbackDenominationPrice = getGoldbackDenominationPrice;
  window.getGoldbackHistoryPrice = getGoldbackHistoryPrice;
  window.searchGoldbackHistoryByDate = searchGoldbackHistoryByDate;
  window.isGoldbackPricingActive = isGoldbackPricingActive;
  window.fetchGoldbackApiPrices = fetchGoldbackApiPrices;
  window.getGoldbackVendorPrice = getGoldbackVendorPrice;
  window.showGoldbackHistoryModal = showGoldbackHistoryModal;
  window.hideGoldbackHistoryModal = hideGoldbackHistoryModal;
  window.exportGoldbackHistory = exportGoldbackHistory;
}

// API INTEGRATION FUNCTIONS
// =============================================================================

// Track provider connection status for settings UI
const providerStatuses = {
  STAKTRAKR: "disconnected",
  METALS_DEV: "disconnected",
  METALS_API: "disconnected",
  METAL_PRICE_API: "disconnected",
  GOLD_API: "disconnected",
  CUSTOM: "disconnected",
};

/** Check whether a provider requires an API key */
const providerRequiresKey = (prov) => API_PROVIDERS[prov]?.requiresKey !== false;

let _spotProviderSyncPromise = null;
let _spotProviderSyncKey = null;
let _staktrakrBackfillPromise = null;
let _spotProviderAbortController = null;
let _spotProviderSyncGeneration = 0;

const abortSpotProviderSync = () => {
  _spotProviderSyncGeneration++;
  if (_spotProviderAbortController) {
    _spotProviderAbortController.abort();
  }
};

/**
 * Fetch a single JSON file from the first responsive StakTrakr endpoint.
 * Tries each URL in order; moves to the next after a 5-second timeout, error,
 * or a failed payload validation (STRK-189 freshness gate).
 * @param {string[]} urls - Ordered base URLs (primary first)
 * @param {string} path - Path appended to each base URL
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {function(any): {ok: boolean, reason?: string}} [options.validate] - Payload
 *   validator; a falsy verdict rejects this endpoint and advances to the next
 * @returns {Promise<any>} Parsed JSON from the first successful endpoint
 */
const _staktrakrFetch = async (urls, path, { signal, validate } = {}) => {
  let lastErr;
  for (const base of urls) {
    if (signal?.aborted) throw new DOMException("Spot sync aborted", "AbortError");
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    const abortCurrentFetch = () => ctrl.abort();
    if (signal) signal.addEventListener("abort", abortCurrentFetch, { once: true });
    try {
      // Timeout stays armed through the body read (STRK-331): with the spot
      // sync awaiting every endpoint via Promise.allSettled, an endpoint that
      // returns headers then stalls mid-body would otherwise hang the whole
      // sync unbounded — clearing the timer only after resp.json() bounds
      // headers AND body inside the same 5 s budget.
      const resp = await fetch(`${base}${path}`, { mode: "cors", signal: ctrl.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (validate) {
        const verdict = validate(json);
        if (!verdict.ok) throw new Error(verdict.reason || "Payload validation failed");
      }
      return json;
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err;
    } finally {
      clearTimeout(tid);
      if (signal) signal.removeEventListener("abort", abortCurrentFetch);
    }
  }
  throw lastErr || new Error("All StakTrakr endpoints failed");
};

/**
 * Fetch spot prices from StakTrakr hourly JSON files.
 * Walks back up to 24 hours from the current UTC hour to find data.
 * Tries the primary endpoint first; falls back to backup after 5 s timeout or error.
 */
const _V2_METAL_MAP = {
  xau: "gold",
  xag: "silver",
  xpt: "platinum",
  xpd: "palladium",
  xcu: "copper",
};

// Publication timestamp (epoch ms) of the last accepted /spot/latest.json payload.
// In-memory only: guards against an older payload overwriting a fresher one within
// a page session (STRK-189); the freshness gate bounds the cross-reload case.
let _lastAcceptedSpotGeneratedAtMs = null;

/**
 * Validate a v2 envelope's publication freshness against a parameterized budget.
 * Payloads without a parseable generated_at are accepted (legacy envelopes).
 * Threshold = max(stale_after * multiplier, floorMs); the multiplier supplies
 * slack over the endpoint's own stale_after and floorMs sets an absolute minimum.
 * When maxAgeCapMs is supplied, the threshold is additionally capped at that
 * absolute ceiling — so an endpoint whose own stale_after exceeds the realtime
 * budget (e.g. goldback's 90000s ≈ 25h) cannot keep a stale-but-200 SW/CDN copy
 * alive past the realtime payload-age ceiling.
 * Strictness regimes:
 *   - lenient (spot failover): { multiplier: 6, floorMs: SPOT_MAX_PAYLOAD_AGE_MS }
 *     so poller lag never hard-fails the sync, but days-old SW-cache/CDN payloads
 *     are rejected (STRK-189).
 *   - strict (goldback/retail gates): { multiplier: 1, floorMs: 0 } rejects by the
 *     endpoint's own stale_after with no slack; goldback adds
 *     { maxAgeCapMs: SPOT_MAX_PAYLOAD_AGE_MS } so its 25h stale_after collapses to
 *     the ~2h realtime ceiling (STRK-249 review finding #1).
 * @param {any} envelope - Parsed v2 envelope response
 * @param {Object} strictness - Freshness budget
 * @param {number} strictness.multiplier - stale_after multiplier (slack factor)
 * @param {number} strictness.floorMs - Absolute minimum acceptable age in ms
 * @param {number} [strictness.maxAgeCapMs] - Optional absolute ceiling on the
 *   computed threshold in ms; when set, maxAge = min(maxAge, maxAgeCapMs)
 * @returns {{ok: boolean, reason?: string}} Verdict for the _staktrakrFetch validator
 */
const _checkEnvelopeFreshness = (envelope, { multiplier, floorMs, maxAgeCapMs }) => {
  const gen = Date.parse(envelope?.generated_at);
  if (isNaN(gen)) return { ok: true };
  const age = Math.max(0, Date.now() - gen);
  let maxAge = Math.max(
    (typeof envelope.stale_after === "number" ? envelope.stale_after : 0) * multiplier * 1000,
    floorMs
  );
  if (typeof maxAgeCapMs === "number") {
    maxAge = Math.min(maxAge, maxAgeCapMs);
  }
  return {
    ok: age <= maxAge,
    reason: `Stale payload (generated_at ${envelope?.generated_at})`,
  };
};

/**
 * Validate a v2 spot envelope's publication freshness (STRK-189), lenient regime.
 * Thin wrapper over _checkEnvelopeFreshness with the spot failover budget
 * (multiplier 6, floor SPOT_MAX_PAYLOAD_AGE_MS) so spot behavior is byte-identical.
 * @param {any} envelope - Parsed /spot/latest.json response
 * @returns {{ok: boolean, reason?: string}} Verdict for the _staktrakrFetch validator
 */
const _checkSpotEnvelopeFreshness = (envelope) =>
  _checkEnvelopeFreshness(envelope, { multiplier: 6, floorMs: SPOT_MAX_PAYLOAD_AGE_MS });

/**
 * Order accepted spot envelopes newest-first. Candidates without a parseable
 * generated_at (legacy envelopes) sink to the end, so a timestamped candidate
 * always outranks an undated one and an undated one wins only when it is all
 * that is left — the same precedence the single-winner scan used before
 * STRK-333 turned it into a full ordering.
 * @param {any[]} envelopes - Parsed envelopes that already cleared the freshness gate
 * @returns {any[]} A new array ordered freshest-first
 */
const _sortEnvelopesByFreshness = (envelopes) =>
  envelopes.slice().sort((a, b) => compareIsoFreshnessDesc(a?.generated_at, b?.generated_at));

/**
 * Fetch /spot/latest.json from EVERY configured endpoint in parallel and
 * return every acceptable envelope ordered freshest-first (STRK-331/STRK-333).
 * Endpoint ORDER no longer decides — both endpoints publish the same feed on
 * different cadences, so the one with the newest generated_at is strictly
 * better and the app should never display a 23-minute-old primary while an
 * 8-minute-old backup sits unread.
 * Each candidate must still pass the lenient STRK-189 gate, which keeps the
 * existing guarantees: days-old SW/CDN copies are rejected, and when every
 * endpoint is stale the sync fails rather than resurrecting one of them.
 * The runners-up are RETAINED rather than discarded (STRK-333): the publisher
 * skips metals with no current row (devops/pollers/shared/api-export-v2.js),
 * so the freshest envelope can be legitimately partial, and the losing
 * candidates are already in memory to fill the gap at no extra network cost.
 * @param {AbortSignal} [signal] - Abort signal forwarded to every endpoint fetch
 * @returns {Promise<any[]>} Accepted envelopes, freshest first (never empty)
 */
const _fetchFreshestSpotEnvelopes = async (signal) => {
  const settled = await Promise.allSettled(
    V2_API_ENDPOINTS.map((base) =>
      _staktrakrFetch([base], "/spot/latest.json", {
        signal,
        validate: _checkSpotEnvelopeFreshness,
      })
    )
  );
  const passers = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  if (!passers.length) {
    const firstRejection = settled.find((s) => s.status === "rejected");
    throw firstRejection?.reason || new Error("All StakTrakr endpoints failed");
  }
  return _sortEnvelopesByFreshness(passers);
};

/**
 * Read the selected metals out of one v2 spot envelope.
 *
 * Each entry also carries its own observation time `t` — the 15-minute floor of
 * the underlying sqld row — which `exportSpot()` selects with NO age cutoff. The
 * envelope's `generated_at` is only the publish instant, so clearing the envelope
 * freshness gate does not prove any individual price is equally fresh; `rowTs` is
 * therefore reported alongside the price and preferred when recording history.
 * A legacy entry without a parseable `t` reports null and falls back to the
 * envelope time at the call site.
 * @param {any} envelope - A parsed /spot/latest.json envelope
 * @param {string[]} selectedMetals - Metal keys the user has enabled
 * @returns {Object<string, {price: number, rowTs: number|null}>} Metal key to
 *   positive price and its observation time (epoch ms, or null when undated)
 */
const _extractSpotPrices = (envelope, selectedMetals) => {
  const spotData = envelope?.data || envelope || {};
  const found = {};
  Object.entries(spotData).forEach(([isoKey, entry]) => {
    const metalName = _V2_METAL_MAP[isoKey];
    if (!metalName) return;
    const price = entry?.price ?? entry;
    if (selectedMetals.includes(metalName) && price > 0) {
      const parsedRowTs = Date.parse(entry?.t);
      found[metalName] = { price, rowTs: isNaN(parsedRowTs) ? null : parsedRowTs };
    }
  });
  return found;
};

/**
 * Fetch spot prices from the StakTrakr v2 API, taking the freshest available
 * copy of EACH selected metal (STRK-333).
 *
 * The freshest envelope wins outright for every metal it carries. Any metal it
 * omits is filled from the next-freshest envelope that has it — the publisher
 * skips metals with no current row, so a fresh envelope can be partial, and
 * without this a sole missing selection failed the whole sync while a slightly
 * older endpoint carried the price. Every donor already cleared the same
 * lenient STRK-189 gate, so a backfill can never smuggle in stale data.
 *
 * Every price is recorded at its own observation time (`entry.t`, the 15-minute
 * floor of the underlying row) rather than the envelope's publish instant, since
 * `exportSpot()` selects the latest row with no age cutoff and a fresh envelope
 * can carry an old reading.
 *
 * `generatedAt` stays the WINNER's publication time so the caller's monotonic
 * freshness guard keeps its exact meaning. Backfilled metals report their own
 * (older) mint time via `priceTimestamps` so their recorded history rows are
 * never stamped fresher than the data actually is.
 *
 * @param {string[]} selectedMetals - Metal keys the user has enabled
 * @param {Object} [options] - Fetch options
 * @param {AbortSignal} [options.signal] - Abort signal forwarded to every endpoint
 * @returns {Promise<{prices: Object<string, number>, generatedAt: number|null,
 *   priceTimestamps: Object<string, number>}>} Prices, the winning envelope's
 *   publication time (epoch ms), and per-metal overrides for backfilled metals
 */
const fetchStaktrakrPrices = async (selectedMetals, { signal } = {}) => {
  const envelopes = await _fetchFreshestSpotEnvelopes(signal);
  const winnerTs = Date.parse(envelopes[0]?.generated_at);
  const generatedAt = isNaN(winnerTs) ? null : winnerTs;

  const results = {};
  const priceTimestamps = {};
  envelopes.forEach((envelope, index) => {
    const envelopeTs = Date.parse(envelope?.generated_at);
    // An UNDATED runner-up may not donate. _checkEnvelopeFreshness returns ok
    // for any envelope it cannot date, so a legacy or corrupted payload passes
    // the STRK-189 check without ever being vouched for, and it carries no
    // timestamp of its own to record — a metal taken from it would fall through
    // to the override-free path and be stamped with the winner's FRESH time,
    // the exact overstatement priceTimestamps exists to prevent. The exception
    // is an all-legacy response: if the winner is undated too then generatedAt
    // is null, no freshness claim is made for anything, and the fill is safe.
    if (index > 0 && isNaN(envelopeTs) && generatedAt !== null) return;
    Object.entries(_extractSpotPrices(envelope, selectedMetals)).forEach(
      ([metal, { price, rowTs }]) => {
        if (results[metal] !== undefined) return;
        results[metal] = price;
        // Prefer the entry's own observation time over the envelope's publish
        // instant, for EVERY metal rather than only backfilled ones. exportSpot()
        // takes the latest sqld row with no age cutoff, so a recently published
        // envelope can carry an old reading, and recording it at publish time
        // would let a stale price enter history as newly minted. Applying this
        // uniformly also keeps the winner and a runner-up on the same footing —
        // stamping only backfilled metals by row time would be harder to reason
        // about than either rule applied consistently.
        // Side effect, and a desirable one: recordSpot dedups on timestamp+metal
        // when given an explicit timestamp, so repeated syncs inside one 15-minute
        // window now collapse onto a single row instead of appending a new one per
        // publish cycle for a reading that never changed.
        const stamp = rowTs ?? (isNaN(envelopeTs) ? null : envelopeTs);
        if (stamp !== null) {
          priceTimestamps[metal] = stamp;
        }
      }
    );
  });

  if (Object.keys(results).length > 0) {
    const cfg = loadApiConfig();
    if (cfg.usage?.STAKTRAKR) {
      cfg.usage.STAKTRAKR.used++;
      saveApiConfig(cfg);
    }
    return { prices: results, generatedAt, priceTimestamps };
  }
  throw new Error("No spot data available from StakTrakr v2 API");
};

/**
 * Fetches hourly spot data from StakTrakr for a configurable number of hours.
 * Skips hours already present in spotHistory to avoid duplicates.
 * @param {number} hoursBack - Number of hours to look back
 * @returns {Promise<{newCount: number, fetchCount: number}>} Counts of new entries and successful fetches
 */
const fetchStaktrakrHourlyRange = async (hoursBack, { signal } = {}) => {
  return _fetchStaktrakrHourlyRangeV2(hoursBack, { signal });
};

const _fetchStaktrakrHourlyRangeV2 = async (hoursBack, { signal } = {}) => {
  const now = new Date();
  const cutoff = new Date(now.getTime() - hoursBack * 3600000);

  purgeSpotHistory();
  const existingKeys = new Set(spotHistory.map((e) => `${e.timestamp}|${e.metal}`));

  let newCount = 0;
  let fetchCount = 0;
  const providerName = API_PROVIDERS.STAKTRAKR.name;

  const uniqueDays = new Map();
  for (let i = 0; i < hoursBack; i++) {
    const h = new Date(now.getTime() - i * 3600000);
    const yyyy = h.getUTCFullYear();
    const mm = String(h.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(h.getUTCDate()).padStart(2, "0");
    const dayKey = `${yyyy}/${mm}/${dd}`;
    if (!uniqueDays.has(dayKey)) uniqueDays.set(dayKey, { yyyy, mm, dd });
  }

  const metalEntries = Object.entries(_V2_METAL_MAP);
  const fetchJobs = [];
  for (const [isoKey, metalName] of metalEntries) {
    for (const [dayKey] of uniqueDays) {
      fetchJobs.push({ isoKey, metalName, dayKey });
    }
  }

  const batchSize = 6;
  for (let i = 0; i < fetchJobs.length; i += batchSize) {
    if (signal?.aborted) break;
    // STAK-443 REQ-10: abort in-flight backfill if user switches to MANUAL mid-batch
    const currentSource = (await loadData("spotPricingSource", "STAKTRAKR")) || "STAKTRAKR";
    if (currentSource === "MANUAL") {
      debugLog("[StakTrakr v2] Backfill aborted — spotPricingSource switched to MANUAL");
      break;
    }
    const batch = fetchJobs.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async ({ isoKey, metalName, dayKey }) => {
        const path = `/spot/${isoKey}/${dayKey}.json`;
        try {
          if (signal?.aborted) return null;
          const raw = await _staktrakrFetch(V2_API_ENDPOINTS, path, { signal });
          const entries = raw.data || raw;
          if (!Array.isArray(entries)) return null;
          return { metalName, entries };
        } catch {
          return null;
        }
      })
    );

    const metalConfig = {};
    Object.values(METALS).forEach((m) => {
      metalConfig[m.key] = m;
    });

    results.forEach((result) => {
      if (!result) return;
      fetchCount++;
      const config = metalConfig[result.metalName];
      if (!config) return;

      result.entries.forEach((entry) => {
        const spot = entry.close;
        if (!spot || spot <= 0) return;
        const ts = entry.t;
        if (!ts) return;
        const entryDate = new Date(ts);
        if (entryDate < cutoff) return;
        const entryTimestamp = ts.replace("T", " ").replace("Z", "");
        const isDuplicate = existingKeys.has(`${entryTimestamp}|${config.name}`);
        if (!isDuplicate) {
          spotHistory.push({
            spot,
            metal: config.name,
            source: "api-hourly",
            provider: providerName,
            timestamp: entryTimestamp,
          });
          existingKeys.add(`${entryTimestamp}|${config.name}`);
          newCount++;
        }
      });
    });
  }

  if (newCount > 0) {
    saveSpotHistory();
    debugLog(`[StakTrakr v2] Added ${newCount} hourly entries (${fetchCount} daily files fetched)`);
  }

  return { newCount, fetchCount };
};

/**
 * Backfills hourly spot data from StakTrakr into spotHistory.
 * On a fresh load (no recent api-hourly entries), extends to 7 days to populate
 * the sparkline window — the seed bundle can lag by ~9 days (LBMA data delay),
 * so 24 h alone is not enough to draw a 7-day sparkline (STAK-303).
 * On subsequent loads, only backfills the last 24 h for efficiency.
 * Only runs when STAKTRAKR is the primary provider (rank 1) and sync succeeded.
 * @returns {Promise<number>} Count of new entries added
 */
const backfillStaktrakrHourly = async ({ signal } = {}) => {
  if (signal?.aborted) return 0;
  if (_staktrakrBackfillPromise) return _staktrakrBackfillPromise;

  _staktrakrBackfillPromise = (async () => {
    // STAK-443 REQ-10: skip backfill entirely if user has switched to MANUAL
    const source = (await loadData("spotPricingSource", "STAKTRAKR")) || "STAKTRAKR";
    if (source === "MANUAL") {
      debugLog("[StakTrakr v2] Backfill skipped — spotPricingSource is MANUAL");
      return 0;
    }
    const oneDayAgo = Date.now() - 24 * 3600000;
    const hasRecentHourly = spotHistory.some(
      (e) => e.source === "api-hourly" && new Date(e.timestamp).getTime() >= oneDayAgo
    );
    const hoursBack = hasRecentHourly ? 24 : 7 * 24;
    if (signal?.aborted) return 0;
    const { newCount, fetchCount } = await fetchStaktrakrHourlyRange(hoursBack, { signal });
    // Track usage per file fetched (each file = 1 API request)
    if (fetchCount > 0) {
      const config = loadApiConfig();
      if (config.usage?.STAKTRAKR) {
        config.usage.STAKTRAKR.used += fetchCount;
        saveApiConfig(config);
      }
    }
    return newCount;
  })();

  try {
    return await _staktrakrBackfillPromise;
  } finally {
    _staktrakrBackfillPromise = null;
  }
};

/**
 * Handles user-initiated hourly history pull for STAKTRAKR.
 * Reads days from dropdown, confirms, fetches, and updates UI.
 */
const handleStaktrakrHistoryPull = async () => {
  const daysSelect = document.getElementById("historyPullDays_STAKTRAKR");
  const totalDays = daysSelect ? parseInt(daysSelect.value, 10) : 7;
  const totalHours = totalDays * 24;

  const proceed = await appConfirm(
    `Pull ${totalDays} day${totalDays > 1 ? "s" : ""} of hourly history from StakTrakr.\n\n` +
      `This will fetch up to ${totalHours} hourly files (skipping already-fetched hours).\n\nProceed?`,
    "History Pull"
  );
  if (!proceed) return;

  // Disable button during pull
  const btn = document.querySelector('.api-history-btn[data-provider="STAKTRAKR"]');
  const origText = btn ? btn.textContent : "";
  if (btn) {
    btn.textContent = "Pulling...";
    btn.disabled = true;
  }

  try {
    const { newCount, fetchCount } = await fetchStaktrakrHourlyRange(totalHours);

    // Track usage
    if (fetchCount > 0) {
      const config = loadApiConfig();
      if (config.usage?.STAKTRAKR) {
        config.usage.STAKTRAKR.used += fetchCount;
        saveApiConfig(config);
      }
    }

    appAlert(
      `History pull complete!\n\n` +
        `Added ${newCount} new entries from ${fetchCount} hourly files.`
    );
    updateProviderHistoryTables();
    if (typeof updateAllSparklines === "function") updateAllSparklines();
  } catch (err) {
    console.error("StakTrakr history pull failed:", err);
    appAlert("History pull failed: " + err.message);
  } finally {
    if (btn) {
      btn.textContent = origText;
      btn.disabled = false;
    }
  }
};

/**
 * Renders a status summary row in the header for all configured API providers.
 * Displays connection status (connected/disconnected/cached) and last sync time.
 */
const renderApiStatusSummary = () => {
  const container = document.getElementById("apiHeaderStatusRow");
  if (!container) return;

  // Build provider list: Numista first, then metals providers
  const items = [];

  // Numista status
  let numistaStatus = "disconnected";
  try {
    if (typeof catalogConfig !== "undefined" && catalogConfig.getNumistaConfig) {
      const nc = catalogConfig.getNumistaConfig();
      numistaStatus = nc.apiKey ? "connected" : "disconnected";
    }
  } catch (e) {
    /* ignore */
  }
  items.push({ name: "Numista", status: numistaStatus, provider: "NUMISTA" });

  // PCGS status
  let pcgsStatus = "disconnected";
  try {
    if (typeof catalogConfig !== "undefined" && catalogConfig.isPcgsEnabled) {
      pcgsStatus = catalogConfig.isPcgsEnabled() ? "connected" : "disconnected";
    }
  } catch (e) {
    /* ignore */
  }
  items.push({ name: "PCGS", status: pcgsStatus, provider: "PCGS" });

  // Metals providers
  Object.keys(API_PROVIDERS).forEach((prov) => {
    const status = Object.hasOwn(providerStatuses, prov) ? providerStatuses[prov] : "disconnected";
    const providerConfig = Object.hasOwn(API_PROVIDERS, prov) ? API_PROVIDERS[prov] : null;
    if (!providerConfig) return;
    const name = providerConfig.name;
    const statusClass = status === "cached" ? "connected" : status;
    const lastSync =
      typeof getLastProviderSyncTime === "function" ? getLastProviderSyncTime(prov) : null;
    let tsLabel = "";
    if (lastSync) {
      const d = new Date(lastSync);
      tsLabel =
        typeof formatTimestamp === "function"
          ? formatTimestamp(d, { year: undefined })
          : d.toLocaleString();
    }
    items.push({ name, status: statusClass, tsLabel, provider: prov });
  });

  container.textContent = "";
  items.forEach((item) => {
    const span = document.createElement("span");
    span.className = "api-header-status-item " + item.status;
    const dot = document.createElement("span");
    dot.className = "status-dot";
    const nameEl = document.createElement("span");
    nameEl.className = "status-name";
    nameEl.textContent = item.name;
    span.append(dot, nameEl);
    if (item.tsLabel) {
      const ts = document.createElement("span");
      ts.className = "status-timestamp";
      ts.textContent = item.tsLabel;
      span.appendChild(ts);
    }
    container.appendChild(span);
  });
};

/** @type {Array<Object>} In-memory buffer for API history log entries */
let apiHistoryEntries = [];
/** @type {string} Current sort column for the API history table */
let apiHistorySortColumn = "";
/** @type {boolean} Sort direction for the API history table */
let apiHistorySortAsc = true;
/** @type {string} Active filter text for searching API history */
let apiHistoryFilterText = "";

/**
 * Loads Metals API configuration from localStorage
 * @returns {Object|null} Metals API configuration or null if not set
 */
const loadApiConfig = () => {
  try {
    const stored = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (stored) {
      const config = JSON.parse(stored);
      if (config.keys) {
        Object.keys(config.keys).forEach((p) => {
          if (config.keys[p]) {
            config.keys[p] = atob(config.keys[p]);
          }
        });
      } else if (config.apiKey && config.provider) {
        // Legacy format migration
        config.keys = { [config.provider]: atob(config.apiKey) };
      }
      const usage = config.usage || {};
      const metals = config.metals || {};
      const historyDays = config.historyDays || {};
      const historyTimes = config.historyTimes || {};
      const currentMonth = currentMonthKey();
      const savedMonth = config.usageMonth;
      Object.keys(API_PROVIDERS).forEach((p) => {
        if (!usage[p])
          usage[p] = {
            quota: providerRequiresKey(p) ? DEFAULT_API_QUOTA : 5000,
            used: 0,
          };
        if (!metals[p])
          metals[p] = {
            silver: true,
            gold: true,
            platinum: true,
            palladium: true,
            copper: true,
          };
        else {
          // The forEach also backfills copper into configs saved before STRK-305.
          ["silver", "gold", "platinum", "palladium", "copper"].forEach((m) => {
            if (typeof metals[p][m] === "undefined") metals[p][m] = true;
          });
        }
        if (typeof historyDays[p] !== "number") {
          historyDays[p] = p === "METALS_DEV" ? 29 : 30;
        } else if (p === "METALS_DEV" && historyDays[p] > 30) {
          historyDays[p] = 30;
        }
        if (!Array.isArray(historyTimes[p])) historyTimes[p] = [];
      });
      let needsSave = false;
      if (savedMonth !== currentMonth) {
        Object.keys(usage).forEach((p) => (usage[p].used = 0));
        needsSave = true;
      }
      // Reconstruct per-provider cache timeouts, defaulting to global cacheHours or 24
      const cacheTimeouts = config.cacheTimeouts || {};
      const globalCache = Number.isFinite(config.cacheHours) ? config.cacheHours : 24;
      Object.keys(API_PROVIDERS).forEach((p) => {
        if (p === "STAKTRAKR") {
          cacheTimeouts[p] = 0;
          return;
        }
        if (!Number.isFinite(cacheTimeouts[p]) || cacheTimeouts[p] < 0) {
          cacheTimeouts[p] = globalCache;
        }
      });

      const result = {
        provider: config.provider || "",
        // Clone keys object to prevent accidental cross-provider references
        keys: { ...(config.keys || {}) },
        cacheHours: typeof config.cacheHours === "number" ? config.cacheHours : 24,
        cacheTimeouts,
        customConfig: config.customConfig || {
          baseUrl: "",
          endpoint: "",
          format: "symbol",
        },
        metals,
        usage,
        historyDays,
        historyTimes,
        syncMode: config.syncMode || {},
        autoRefresh: config.autoRefresh || { STAKTRAKR: true },
        usageMonth: currentMonth,
      };
      if (needsSave) {
        saveApiConfig(result);
      }
      return result;
    }
  } catch (error) {
    console.error("Error loading API config:", error);
  }
  const usage = {};
  const metals = {};
  const historyDays = {};
  const historyTimes = {};
  const defaultCacheTimeouts = {};
  Object.keys(API_PROVIDERS).forEach((p) => {
    usage[p] = {
      quota: providerRequiresKey(p) ? DEFAULT_API_QUOTA : 5000,
      used: 0,
    };
    metals[p] = { silver: true, gold: true, platinum: true, palladium: true, copper: true };
    historyDays[p] = p === "METALS_DEV" ? 29 : 30;
    historyTimes[p] = [];
    defaultCacheTimeouts[p] = 24;
  });
  return {
    provider: "",
    keys: {},
    cacheHours: 24,
    cacheTimeouts: defaultCacheTimeouts,
    customConfig: { baseUrl: "", endpoint: "", format: "symbol" },
    metals,
    usage,
    historyDays,
    historyTimes,
    syncMode: {},
    autoRefresh: { STAKTRAKR: true },
    usageMonth: currentMonthKey(),
  };
};

/**
 * Saves Metals API configuration to localStorage
 * @param {Object} config - Metals API configuration object
 */
const saveApiConfig = (config) => {
  try {
    const configToSave = {
      provider: config.provider || "",
      keys: {},
      cacheHours: typeof config.cacheHours === "number" ? config.cacheHours : 24,
      cacheTimeouts: config.cacheTimeouts || {},
      customConfig: config.customConfig || {
        baseUrl: "",
        endpoint: "",
        format: "symbol",
      },
      metals: config.metals || {},
      usage: config.usage || {},
      historyDays: config.historyDays || {},
      historyTimes: config.historyTimes || {},
      syncMode: config.syncMode || {},
      autoRefresh: config.autoRefresh || { STAKTRAKR: true },
      usageMonth: config.usageMonth || currentMonthKey(),
    };
    Object.keys(config.keys || {}).forEach((p) => {
      if (config.keys[p]) {
        configToSave.keys[p] = btoa(config.keys[p]);
      }
    });
    localStorage.setItem(API_KEY_STORAGE_KEY, JSON.stringify(configToSave));

    // Store a cloned copy in memory to avoid shared references
    apiConfig = {
      ...config,
      keys: { ...(config.keys || {}) },
    };
    updateSyncButtonStates();
  } catch (error) {
    console.error("Error saving API config:", error);
  }
};

/**
 * Clears Metals API configuration
 */
const clearApiConfig = () => {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
  localStorage.removeItem(API_CACHE_KEY);
  apiConfig = {
    provider: "",
    keys: {},
    cacheHours: 24,
    customConfig: { baseUrl: "", endpoint: "", format: "symbol" },
  };
  apiCache = null;
  Object.keys(providerStatuses).forEach((p) => setProviderStatus(p, "disconnected"));
  updateSyncButtonStates();
};

/**
 * Clears only the API cache, keeping the configuration
 */
const clearApiCache = () => {
  localStorage.removeItem(API_CACHE_KEY);
  apiCache = null;
  clearApiHistory(true);
  appAlert("API cache and history cleared. Next sync will pull fresh data from the API.");
};

/**
 * Gets cache duration in milliseconds
 * @returns {number} Cache duration
 */
const getCacheDurationMs = (provider) => {
  // STAKTRAKR reads static hourly files — no rate limit, always fetch fresh
  if (provider === "STAKTRAKR") return 0;
  let hours;
  if (provider && Number.isFinite(apiConfig?.cacheTimeouts?.[provider])) {
    hours = apiConfig.cacheTimeouts[provider];
  } else {
    hours = apiConfig?.cacheHours ?? 24;
  }
  return (Number.isFinite(hours) && hours >= 0 ? hours : 24) * 60 * 60 * 1000;
};

/**
 * Sets connection status for a provider in the settings UI
 * @param {string} provider
 * @param {"connected"|"disconnected"|"error"|"cached"} status
 */
const setProviderStatus = (provider, status) => {
  providerStatuses[provider] = status;
  renderApiStatusSummary();
  const block = document.querySelector(
    `.api-provider[data-provider="${provider}"] .provider-status`
  );
  if (!block) return;
  block.classList.remove(
    "status-connected",
    "status-disconnected",
    "status-error",
    "status-cached"
  );
  block.classList.add(status === "cached" ? "status-connected" : `status-${status}`);
  const text = block.querySelector(".status-text");
  if (text) {
    text.textContent =
      status === "connected"
        ? "Connected"
        : status === "cached"
          ? "Connected (cached)"
          : status === "error"
            ? "Error"
            : "Disconnected";
  }

  // Update last-used timestamp in provider card
  const lastUsed = block.querySelector(".status-last-used");
  if (lastUsed && typeof getLastProviderSyncTime === "function") {
    const ts = getLastProviderSyncTime(provider);
    if (ts) {
      const d = new Date(ts);
      lastUsed.textContent =
        "Last: " +
        (typeof formatTimestamp === "function"
          ? formatTimestamp(d, { year: undefined })
          : d.toLocaleString());
    } else {
      lastUsed.textContent = "";
    }
  }
};

/**
 * Updates the visual cost indicator for a history pull from a given provider.
 * Displays total API calls or file fetches expected based on current settings.
 *
 * @param {string} provider - The unique key of the API provider
 */
const updateHistoryPullCost = (provider) => {
  const config = loadApiConfig();
  const providerConfig = API_PROVIDERS[provider];
  const costEl = document.getElementById(`historyPullCost_${provider}`);
  if (!costEl || !providerConfig) return;

  const daysSelect = document.getElementById(`historyPullDays_${provider}`);
  const totalDays = daysSelect ? parseInt(daysSelect.value, 10) : 30;

  // STAKTRAKR: show hourly file count instead of API calls
  if (provider === "STAKTRAKR") {
    const hours = totalDays * 24;
    costEl.textContent = `${totalDays}d = ${hours} hourly files`;
    return;
  }

  const selected = config.metals?.[provider] || {};
  // History-capable restriction keeps the cost preview aligned with what the
  // pull will actually deliver — canonically-mapped metals minus per-provider
  // history exclusions (metals.dev cannot serve copper history; STRK-342,
  // STRK-303 Part 2).
  const selectedMetals = Object.keys(selected).filter(
    (metal) => selected[metal] !== false && isProviderHistoryMetal(provider, metal)
  );

  // Check for hourly toggle (MetalPriceAPI)
  const hourlyToggle = document.getElementById(`hourlyPull_${provider}`);
  if (hourlyToggle && hourlyToggle.checked) {
    const calls = selectedMetals.length;
    costEl.textContent = `${totalDays}d \u00D7 ${selectedMetals.length} metals = ${calls} API calls (hourly)`;
    return;
  }

  const maxPerReq = providerConfig.maxHistoryDays || 30;
  const chunks = Math.ceil(totalDays / maxPerReq);

  let calls;
  if (providerConfig.symbolsPerRequest === 1) {
    calls = chunks * selectedMetals.length;
    costEl.textContent = `${totalDays}d \u00D7 ${selectedMetals.length} metals = ${calls} API calls`;
  } else {
    calls = chunks;
    costEl.textContent = `${totalDays}d = ${calls} API call${calls > 1 ? "s" : ""}`;
  }
};

/**
 * Updates persistent provider settings (like cache duration) from form inputs.
 * Persists the updated configuration to localStorage.
 *
 * @param {string} provider - The unique key of the API provider
 */
const updateProviderSettings = (provider) => {
  const config = loadApiConfig();

  // STAKTRAKR has no cache dropdown — persist toggle + auto-refresh only
  if (provider === "STAKTRAKR") {
    const enabledEl = document.getElementById("enabled_STAKTRAKR");
    if (enabledEl) {
      if (!config.syncMode) config.syncMode = {};
      const enabled = enabledEl.checked ? 1 : 0;
      config.syncMode.STAKTRAKR = enabled;
      // Also update providerPriority — syncProviderChain reads this key to gate fetches
      if (
        typeof loadProviderPriorities === "function" &&
        typeof saveProviderPriorities === "function"
      ) {
        const priorities = loadProviderPriorities();
        priorities.STAKTRAKR = enabled;
        saveProviderPriorities(priorities);
      }
    }
    const autoEl = document.getElementById("autoRefresh_STAKTRAKR");
    if (!config.autoRefresh) config.autoRefresh = {};
    if (enabledEl && !enabledEl.checked) {
      // Provider disabled — clear autoRefresh so startSpotBackgroundSync skips the 60-min tick
      config.autoRefresh.STAKTRAKR = false;
    } else if (autoEl) {
      config.autoRefresh.STAKTRAKR = autoEl.checked;
    }
    saveApiConfig(config);
    if (typeof startSpotBackgroundSync === "function") startSpotBackgroundSync();
    return;
  }

  // Update cache timeout
  const cacheSelect = document.getElementById(`cacheTimeout_${provider}`);
  if (cacheSelect) {
    if (!config.cacheTimeouts) config.cacheTimeouts = {};
    config.cacheTimeouts[provider] = parseFloat(cacheSelect.value);
  }

  saveApiConfig(config);
};

/**
 * Renders the API usage/quota visualization (progress bars) for each provider.
 * Displays usage vs quota and handles clicks for quota adjustment modals.
 */
const updateProviderHistoryTables = () => {
  const config = loadApiConfig();
  Object.keys(API_PROVIDERS).forEach((prov) => {
    const container = document.querySelector(
      `.api-provider[data-provider="${prov}"] .provider-settings .provider-history`
    );
    if (!container) return;
    const usage = config.usage?.[prov] || {
      quota: DEFAULT_API_QUOTA,
      used: 0,
    };
    const usedPercent = Math.min((usage.used / usage.quota) * 100, 100);
    const remainingPercent = 100 - usedPercent;
    const warning = usage.used / usage.quota >= 0.9;
    const safeProv = sanitizeHtml(prov);
    const usageHtml = `<div class="api-usage" data-quota-provider="${safeProv}" style="cursor:pointer" title="Click to edit quota"><div class="usage-bar"><div class="used" style="width:${usedPercent}%"></div><div class="remaining" style="width:${remainingPercent}%"></div></div><div class="usage-text">${usage.used}/${usage.quota} calls${warning ? " 🚩" : ""}</div></div>`;
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
    container.innerHTML = usageHtml;

    // Make quota bar clickable
    const usageEl = container.querySelector(".api-usage[data-quota-provider]");
    if (usageEl) {
      usageEl.addEventListener("click", () => {
        const modal = document.getElementById("apiQuotaModal");
        const input = document.getElementById("apiQuotaInput");
        if (modal && input) {
          const cfg = loadApiConfig();
          const u = cfg.usage?.[prov] || { quota: DEFAULT_API_QUOTA, used: 0 };
          input.value = u.quota;
          // Store provider for the save handler
          modal.dataset.quotaProvider = prov;
          if (window.openModalById) openModalById("apiQuotaModal");
          else modal.style.display = "flex";
        }
      });
    }
  });
};

/**
 * Periodically refreshes connection status icons based on key presence and cache age.
 * Determines if a provider is fully connected, cached (needs sync), or disconnected.
 */
const refreshProviderStatuses = () => {
  const config = loadApiConfig();
  let cache = null;
  try {
    const stored = localStorage.getItem(API_CACHE_KEY);
    cache = stored ? JSON.parse(stored) : null;
  } catch (err) {
    console.error("Error reading API cache for status check:", err);
  }
  const now = Date.now();
  Object.keys(API_PROVIDERS).forEach((prov) => {
    const duration = getCacheDurationMs(prov);
    if (config.keys[prov] || !providerRequiresKey(prov)) {
      // API key is stored (or provider is keyless)
      if (cache && cache.provider === prov && cache.timestamp) {
        const age = now - cache.timestamp;
        if (age <= duration) {
          setProviderStatus(prov, "connected"); // Recently used with fresh data
        } else {
          setProviderStatus(prov, "cached"); // Key stored but data is old
        }
      } else if (!providerRequiresKey(prov)) {
        // Keyless provider: check last sync time instead of cache object
        const lastSync = getLastProviderSyncTime(prov);
        if (lastSync && now - lastSync <= duration) {
          setProviderStatus(prov, "connected");
        } else if (lastSync) {
          setProviderStatus(prov, "cached");
        } else {
          setProviderStatus(prov, "connected"); // Keyless, always available
        }
      } else {
        setProviderStatus(prov, "cached"); // Key stored but no recent usage
      }
    } else {
      setProviderStatus(prov, "disconnected"); // No API key stored
    }
  });
};

/**
 * Automatically selects the primary API provider based on priority and availability.
 * The highest-priority provider that has a stored API key is selected as default.
 */
const autoSelectDefaultProvider = () => {
  const config = loadApiConfig();
  const keys = config.keys || {};

  // Read tab order from localStorage, fall back to default order
  let order;
  try {
    const stored = localStorage.getItem("apiProviderOrder");
    order = stored ? JSON.parse(stored) : null;
  } catch (e) {
    order = null;
  }
  if (!Array.isArray(order) || order.length === 0) {
    order = Object.keys(API_PROVIDERS);
  }

  // Select first provider with a key (or keyless) as default
  const active = order.filter((p) => keys[p] || !providerRequiresKey(p));
  if (active.length > 0 && config.provider !== active[0]) {
    config.provider = active[0];
    saveApiConfig(config);
  } else if (active.length === 0 && config.provider) {
    config.provider = "";
    saveApiConfig(config);
  }
};

// Backward-compatible alias
const updateDefaultProviderButtons = autoSelectDefaultProvider;

/**
 * Returns the effective priority order for API providers.
 * Merges user-defined priority with legacy order and hardcoded defaults.
 *
 * @returns {string[]} Ordered list of provider keys
 */
const getProviderOrder = () => {
  try {
    const stored = localStorage.getItem("providerPriority");
    if (stored) {
      const priorities = JSON.parse(stored);
      if (typeof priorities === "object" && priorities !== null) {
        return Object.entries(priorities)
          .filter(([, p]) => p > 0)
          .sort((a, b) => a[1] - b[1])
          .map(([prov]) => prov);
      }
    }
  } catch (e) {
    /* ignore */
  }
  // Legacy fallback
  try {
    const stored = localStorage.getItem("apiProviderOrder");
    const order = stored ? JSON.parse(stored) : null;
    if (Array.isArray(order) && order.length > 0) return order;
  } catch (e) {
    /* ignore */
  }
  return Object.keys(API_PROVIDERS);
};

/**
 * Determines the default synchronization behavior for a provider.
 * Higher priority providers default to 'always', others to 'backup'.
 *
 * @param {string} provider - The unique key of the API provider
 * @returns {"always"|"backup"} Recommended sync mode
 */
const getDefaultSyncMode = (provider) => {
  const order = getProviderOrder();
  const config = loadApiConfig();
  const firstActive = order.find((p) => config.keys?.[p] || !providerRequiresKey(p));
  return provider === firstActive ? "always" : "backup";
};

/**
 * Renders API history table with filtering, sorting and pagination
 */
const renderApiHistoryTable = () => {
  const table = document.getElementById("apiHistoryTable");
  if (!table) return;
  let data = [...apiHistoryEntries];
  if (apiHistoryFilterText) {
    const f = apiHistoryFilterText.toLowerCase();
    data = data.filter((e) => Object.values(e).some((v) => String(v).toLowerCase().includes(f)));
  }
  if (apiHistorySortColumn) {
    data.sort((a, b) => {
      const valA = a[apiHistorySortColumn];
      const valB = b[apiHistorySortColumn];
      if (valA < valB) return apiHistorySortAsc ? -1 : 1;
      if (valA > valB) return apiHistorySortAsc ? 1 : -1;
      return 0;
    });
  }
  if (!apiHistorySortColumn) {
    data.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }

  let html =
    '<tr><th data-column="timestamp">Time</th><th data-column="metal">Metal</th><th data-column="spot">Price</th><th data-column="provider">Source</th></tr>';
  data.forEach((e) => {
    let sourceLabel;
    if (e.source === "cached") {
      sourceLabel = '<span class="api-history-cached-badge">Cached</span>';
    } else if (e.source === "api-hourly") {
      sourceLabel = `${escapeHtml(e.provider || "")} (hourly)`;
    } else {
      sourceLabel = escapeHtml(e.provider || e.source || "");
    }
    html += `<tr><td>${escapeHtml(e.timestamp)}</td><td>${escapeHtml(e.metal)}</td><td>${formatCurrency(
      e.spot
    )}</td><td>${sourceLabel}</td></tr>`;
  });
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
  table.innerHTML = html;

  table.querySelectorAll("th").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.column;
      if (apiHistorySortColumn === col) {
        apiHistorySortAsc = !apiHistorySortAsc;
      } else {
        apiHistorySortColumn = col;
        apiHistorySortAsc = true;
      }
      renderApiHistoryTable();
    });
  });
};

/**
 * Opens the API history modal and populates it with filtered spot history data.
 * Displays only 'api', 'api-hourly', and 'seed' entries in the log.
 */
const showApiHistoryModal = () => {
  const modal = document.getElementById("apiHistoryModal");
  if (!modal) return;
  // STRK-141: spotHistory is the boot-hydrated, always-current in-memory source of
  // truth (saveSpotHistory assigns it before the async IDB write). The former sync
  // loadSpotHistory() reload is now async and vestigial — read the global directly.
  apiHistoryEntries = spotHistory.filter(
    (e) =>
      e.source === "api" ||
      e.source === "api-hourly" ||
      e.source === "seed" ||
      e.source === "cached"
  );
  apiHistorySortColumn = "";
  apiHistorySortAsc = true;
  apiHistoryFilterText = "";
  const filterInput = document.getElementById("apiHistoryFilter");
  const clearFilterBtn = document.getElementById("apiHistoryClearFilterBtn");
  if (filterInput) {
    filterInput.value = "";
    filterInput.oninput = (e) => {
      apiHistoryFilterText = e.target.value;
      renderApiHistoryTable();
    };
  }
  if (clearFilterBtn) {
    clearFilterBtn.onclick = () => {
      apiHistoryFilterText = "";
      if (filterInput) filterInput.value = "";
      renderApiHistoryTable();
    };
  }
  renderApiHistoryTable();
  modal.style.display = "flex";
};

/**
 * Closes the API history modal.
 */
const hideApiHistoryModal = () => {
  const modal = document.getElementById("apiHistoryModal");
  if (modal) modal.style.display = "none";
};

/**
 * Opens the API provider selection modal (redirects to the API section of Settings).
 */
const showApiProvidersModal = () => {
  // Redirect to Settings modal API section
  if (typeof showSettingsModal === "function") {
    showSettingsModal("api");
  }
};

/**
 * Closes the API providers modal (legacy wrapper for hideSettingsModal).
 */
const hideApiProvidersModal = () => {
  // Legacy — Settings modal handles its own close
  if (typeof hideSettingsModal === "function") {
    hideSettingsModal();
  }
};

/**
 * Clears all stored spot price history from localStorage and re-renders UI.
 *
 * @param {boolean} [silent=false] - If true, suppresses reopening the history modal
 */
const clearApiHistory = (silent = false) => {
  spotHistory = [];
  saveSpotHistory();
  updateProviderHistoryTables();
  if (!silent) {
    showApiHistoryModal();
  }
};

/**
 * Updates the active API provider in configuration.
 * Validates that the provider has a key (if required) before switching.
 *
 * @param {string} provider - The unique key of the API provider
 */
const setDefaultProvider = (provider) => {
  const config = loadApiConfig();
  if (!config.keys[provider] && providerRequiresKey(provider)) {
    appAlert("Please enter your API key first");
    return;
  }
  config.provider = provider;
  saveApiConfig(config);
  updateDefaultProviderButtons();
  updateSyncButtonStates();
};

/**
 * Removes the stored API key for a given provider from configuration.
 * Also handles fallback to other available providers if necessary.
 *
 * @param {string} provider - The unique key of the API provider
 */
const clearApiKey = (provider) => {
  const config = loadApiConfig();
  delete config.keys[provider];
  if (config.provider === provider) {
    config.provider = "";
  }
  const active = Object.keys(API_PROVIDERS).filter(
    (p) => config.keys[p] || !providerRequiresKey(p)
  );
  if (active.length === 1) {
    config.provider = active[0];
  }
  saveApiConfig(config);
  const input = document.getElementById(`apiKey_${provider}`);
  if (input) input.value = "";
  if (provider === "CUSTOM") {
    config.customConfig = { baseUrl: "", endpoint: "", format: "symbol" };
    const base = document.getElementById("apiBase_CUSTOM");
    const endpoint = document.getElementById("apiEndpoint_CUSTOM");
    const format = document.getElementById("apiFormat_CUSTOM");
    if (base) base.value = "";
    if (endpoint) endpoint.value = "";
    if (format) format.value = "symbol";
    saveApiConfig(config);
  }
  setProviderStatus(provider, "disconnected");
  updateDefaultProviderButtons();
  updateProviderHistoryTables();
};

/**
 * Force-refreshes all spot price displays using the most recent cached data.
 * Does not make external network requests.
 *
 * @returns {boolean} True if display was successfully updated from cache
 */
const refreshFromCache = () => {
  const cache = loadApiCache();
  if (!cache || !cache.data) {
    return false;
  }

  let updatedCount = 0;
  Object.entries(cache.data).forEach(([metal, price]) => {
    const metalConfig = Object.values(METALS).find((m) => m.key === metal);
    if (metalConfig && price > 0) {
      // Save to localStorage
      localStorage.setItem(metalConfig.spotKey, price.toString());
      spotPrices[metal] = price;

      // Update display
      elements.spotPriceDisplay[metal].textContent = formatCurrency(price);

      updateSpotCardColor(metal, price);

      // Record in history as 'cached' to distinguish from fresh API calls
      recordSpot(price, "cached", metalConfig.name, API_PROVIDERS[cache.provider]?.name);

      const ts = document.getElementById(`spotTimestamp${metalConfig.name}`);
      if (ts) {
        updateSpotTimestamp(metalConfig.name);
      }

      updatedCount++;
    }
  });

  if (updatedCount > 0) {
    // Update summary calculations
    updateSummary();
    if (typeof updateAllSparklines === "function") {
      updateAllSparklines();
    }
    if (typeof onGoldSpotPriceChanged === "function") onGoldSpotPriceChanged();
    if (typeof renderRatioChips === "function") renderRatioChips();
    return true;
  }

  return false;
};

/**
 * Retrieves valid cached API response data from localStorage.
 * Checks against the provider's specific cache duration before returning.
 *
 * @returns {Object|null} Cached response or null if expired/not found
 */
const loadApiCache = () => {
  try {
    const stored = localStorage.getItem(API_CACHE_KEY);
    if (stored) {
      const cache = JSON.parse(stored);
      const now = new Date().getTime();

      const duration = getCacheDurationMs(cache.provider);
      if (cache.timestamp && now - cache.timestamp < duration) {
        return cache;
      } else {
        // Cache expired, remove it
        localStorage.removeItem(API_CACHE_KEY);
      }
    }
  } catch (error) {
    console.error("Error loading API cache:", error);
  }
  return null;
};

/**
 * Persists API response data to the local browser cache.
 * Uses provider-specific cache duration settings.
 *
 * @param {Object} data - Standardized price data object
 * @param {string} provider - Key of the data provider
 */
const saveApiCache = (data, provider) => {
  try {
    const duration = getCacheDurationMs(provider);
    if (duration === 0) {
      localStorage.removeItem(API_CACHE_KEY);
      apiCache = null;
      return;
    }
    const cacheObject = {
      timestamp: new Date().getTime(),
      data: data,
      provider,
    };
    localStorage.setItem(API_CACHE_KEY, JSON.stringify(cacheObject));
    apiCache = cacheObject;
  } catch (error) {
    console.error("Error saving API cache:", error);
  }
};

/**
 * Triggers an automatic background spot price synchronization.
 * Only runs if API keys are configured and local data is stale.
 *
 * @returns {Promise<void>} Resolves when background sync process ends
 */
const autoSyncSpotPrices = async () => {
  const config = loadApiConfig();
  const hasAnyKey = Object.values(config.keys || {}).some((k) => k);
  const hasKeylessProvider = Object.keys(API_PROVIDERS).some((p) => !providerRequiresKey(p));
  if (!hasAnyKey && !hasKeylessProvider) return;

  await syncProviderChain({ showProgress: false, forceSync: false });
  updateSyncButtonStates();
};

/** Interval ID for spot price background sync — null when not running */
let _spotSyncIntervalId = null;

/**
 * Starts background spot price auto-sync for all providers that have autoRefresh enabled.
 * Immediately syncs if data is absent or stale, then re-syncs on each provider's cache TTL interval.
 * Safe to call multiple times — clears any existing interval before setting a new one.
 * Called from init.js after autoSyncSpotPrices().
 */
const startSpotBackgroundSync = () => {
  if (_spotSyncIntervalId !== null) {
    clearInterval(_spotSyncIntervalId);
    _spotSyncIntervalId = null;
  }

  const config = loadApiConfig();
  const autoRefresh = config.autoRefresh || { STAKTRAKR: true };

  // Find shortest enabled interval to drive the master setInterval tick
  const enabledProviders = Object.keys(API_PROVIDERS).filter((p) => autoRefresh[p]);
  if (enabledProviders.length === 0) return;

  // Use StakTrakr's interval (1h = 3600000ms) as the base tick if enabled,
  // otherwise fall back to the shortest configured cache TTL.
  const staktrakrEnabled = !!autoRefresh["STAKTRAKR"];
  const tickMs = staktrakrEnabled
    ? 60 * 60 * 1000 // 1 hour — StakTrakr updates hourly
    : Math.min(...enabledProviders.map((p) => (config.cacheTimeouts?.[p] ?? 24) * 60 * 60 * 1000));

  const _runSilentSync = () => {
    syncProviderChain({ showProgress: false, forceSync: false }).catch((err) => {
      debugLog(`[spot-bg-sync] Silent sync failed: ${err.message}`, "warn");
    });
  };

  // Sync immediately if data is stale or missing
  const cache = loadApiCache();
  const isStale = !cache || !cache.timestamp || Date.now() - cache.timestamp > tickMs;
  if (isStale) {
    debugLog("[spot-bg-sync] Starting immediate sync (stale or no cache)", "info");
    _runSilentSync();
  }

  _spotSyncIntervalId = setInterval(_runSilentSync, tickMs);
  debugLog(`[spot-bg-sync] Background sync started — tick every ${tickMs / 60000}min`, "info");
};

/**
 * Scans the spot history log to find the most recent successful sync for a provider.
 *
 * @param {string} provider - The unique key of the API provider
 * @returns {number|null} Millisecond timestamp of last sync, or null
 */
const getLastProviderSyncTime = (provider) => {
  try {
    const providerName = API_PROVIDERS[provider]?.name;
    if (!providerName || !spotHistory || !spotHistory.length) return null;
    // Find most recent API entry from this provider
    for (let i = spotHistory.length - 1; i >= 0; i--) {
      const entry = spotHistory[i];
      if (
        (entry.source === "api" || entry.source === "api-hourly") &&
        entry.provider === providerName
      ) {
        // Parse timestamp string "YYYY-MM-DD HH:MM:SS" to ms
        const ts = new Date(entry.timestamp).getTime();
        if (!isNaN(ts)) return ts;
      }
    }
  } catch (e) {
    console.warn("Error checking provider sync time:", e);
  }
  return null;
};

/**
 * Calculates the expected API usage (call count) for a given sync operation.
 * Accounts for batch support and historical data backfill.
 *
 * @param {string[]} selectedMetals - Array of metal keys to fetch
 * @param {number} [historyDays=0] - Number of days of history to include
 * @param {boolean} [batchSupported=false] - Whether the provider supports batch calls
 * @returns {Object} Usage breakdown including calls, type, and potential savings
 */
const calculateApiUsage = (selectedMetals, historyDays = 0, batchSupported = false) => {
  if (batchSupported && selectedMetals.length > 1) {
    return {
      calls: 1,
      type: "batch",
      metals: selectedMetals.length,
      days: historyDays,
      saved:
        selectedMetals.length - 1 + (historyDays > 0 ? selectedMetals.length * historyDays : 0),
    };
  } else {
    const currentPriceCalls = selectedMetals.length;
    const historicalCalls = historyDays > 0 ? selectedMetals.length * historyDays : 0;
    return {
      calls: currentPriceCalls + historicalCalls,
      type: "individual",
      metals: selectedMetals.length,
      days: historyDays,
      saved: 0,
    };
  }
};

/**
 * Fetches the most recent spot prices for selected metals using individual endpoints.
 * Optimized for low-cost, real-time updates without full history backfill.
 *
 * @param {string} provider - The unique key of the API provider
 * @param {string} apiKey - The API key for the provider
 * @param {string[]} selectedMetals - Array of metal keys to fetch
 * @returns {Promise<Object<string, number>>} Map of metal keys to spot prices
 */
const fetchLatestPrices = async (provider, apiKey, selectedMetals) => {
  const providerConfig = API_PROVIDERS[provider];
  if (!providerConfig) throw new Error("Invalid API provider");

  const config = loadApiConfig();
  const usage = config.usage?.[provider] || { quota: DEFAULT_API_QUOTA, used: 0 };
  const results = {};

  // metals.dev supports a batch /latest endpoint returning all metals in one call
  if (provider === "METALS_DEV" && providerConfig.latestBatchEndpoint) {
    await _fetchMetalsDevLatestBatch(providerConfig, apiKey, selectedMetals, results, usage);
  }

  // Individual requests for remaining metals (or all metals for non-batch providers)
  if (Object.keys(results).length < selectedMetals.length) {
    const remaining = selectedMetals.filter((m) => !results[m]);

    if (provider === "CUSTOM") {
      const aborted = await _fetchCustomLatest(
        config,
        providerConfig,
        apiKey,
        remaining,
        results,
        usage
      );
      if (aborted) return results;
    } else {
      await _fetchIndividualLatest(provider, providerConfig, apiKey, remaining, results, usage);
    }
  }

  if (Object.keys(results).length === 0) {
    throw new Error("No valid prices retrieved from latest endpoints");
  }

  config.usage[provider] = usage;
  saveApiConfig(config);
  return results;
};

/**
 * METALS_DEV batch /latest fetch: one call returns all metals. Mutates `results`
 * with any selected metal whose parsed price is positive and increments
 * `usage.used` on a successful response. Failures are swallowed (logged) so the
 * caller falls through to individual per-metal requests.
 *
 * @param {Object} providerConfig - The METALS_DEV entry from API_PROVIDERS
 * @param {string} apiKey - The API key for the provider
 * @param {string[]} selectedMetals - Metals to extract from the batch payload
 * @param {Object<string, number>} results - Accumulator mutated in place
 * @param {{used: number}} usage - Usage counter incremented on success
 * @returns {Promise<void>}
 */
const _fetchMetalsDevLatestBatch = async (
  providerConfig,
  apiKey,
  selectedMetals,
  results,
  usage
) => {
  try {
    const url =
      providerConfig.baseUrl + providerConfig.latestBatchEndpoint.replace("{API_KEY}", apiKey);
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    // Safe: URL constructed from hardcoded API_PROVIDERS config (latestBatchEndpoint)
    const response = await fetch(url, { method: "GET", headers, mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data = await response.json();
    usage.used++;

    const parsed = providerConfig.parseLatestBatchResponse(data);
    selectedMetals.forEach((metal) => {
      if (parsed[metal] && parsed[metal] > 0) results[metal] = parsed[metal];
    });
  } catch (err) {
    console.warn("Batch latest failed for METALS_DEV, falling back to individual:", err.message);
    // Fall through to individual requests below
  }
};

/**
 * CUSTOM provider per-metal latest fetch. Validates the configured base URL
 * (HTTPS required) and requests each remaining metal individually, mutating
 * `results`/`usage` in place. Each per-metal failure is logged and skipped.
 *
 * @param {Object} config - Loaded API config (provides customConfig)
 * @param {Object} providerConfig - The CUSTOM entry from API_PROVIDERS
 * @param {string} apiKey - The API key for the provider
 * @param {string[]} remaining - Metals still missing a price
 * @param {Object<string, number>} results - Accumulator mutated in place
 * @param {{used: number}} usage - Usage counter incremented per successful call
 * @returns {Promise<boolean>} True if the base URL is invalid and the caller
 *   should abort and return the current results without saving config
 */
const _fetchCustomLatest = async (config, providerConfig, apiKey, remaining, results, usage) => {
  const custom = config.customConfig || {};
  const base = custom.baseUrl || "";
  const pattern = custom.endpoint || "";
  const format = custom.format || "symbol";

  // Validate custom API base URL before use
  try {
    const validated = new URL(base);
    if (validated.protocol !== "https:") {
      throw new Error("Custom API base must use HTTPS");
    }
  } catch (urlErr) {
    console.warn("Invalid custom API base URL:", base, urlErr.message);
    return true;
  }
  for (const metal of remaining) {
    // Unmapped metals (any future metal not yet in the canonical map) are
    // skipped — a null code must never reach the user's endpoint URL as the
    // string "undefined" (STRK-342 defect 2).
    const metalCode = getSpotProviderMetalCode(metal, format);
    if (!metalCode) continue;
    try {
      const endpoint = pattern.replace("{API_KEY}", apiKey).replace("{METAL}", metalCode);
      const url = `${base}${endpoint}`;
      const response = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        mode: "cors",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const data = await response.json();
      usage.used++;
      const price = providerConfig.parseResponse(data, metal);
      if (price && price > 0) results[metal] = price;
    } catch (err) {
      console.warn(`Latest fetch failed for ${metal}:`, err.message);
    }
  }
  return false;
};

/**
 * Per-metal latest fetch for standard (non-CUSTOM) providers. Requests each
 * remaining metal's configured endpoint, applying provider-specific auth
 * headers, and mutates `results`/`usage` in place. Metals without an endpoint
 * are skipped; each per-metal failure is logged and skipped.
 *
 * @param {string} provider - The provider key (drives auth-header selection)
 * @param {Object} providerConfig - The provider entry from API_PROVIDERS
 * @param {string} apiKey - The API key for the provider
 * @param {string[]} remaining - Metals still missing a price
 * @param {Object<string, number>} results - Accumulator mutated in place
 * @param {{used: number}} usage - Usage counter incremented per successful call
 * @returns {Promise<void>}
 */
const _fetchIndividualLatest = async (
  provider,
  providerConfig,
  apiKey,
  remaining,
  results,
  usage
) => {
  for (const metal of remaining) {
    const endpoint = providerConfig.endpoints[metal];
    if (!endpoint) continue;
    try {
      // Safe: URL constructed from hardcoded API_PROVIDERS config (baseUrl + endpoints)
      const url = `${providerConfig.baseUrl}${endpoint.replace("{API_KEY}", apiKey)}`;
      const headers = { "Content-Type": "application/json" };
      if (provider === "METALS_DEV" && apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      if (provider === "GOLD_API" && apiKey) headers["x-api-key"] = apiKey;
      const response = await fetch(url, { method: "GET", headers, mode: "cors" });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const data = await response.json();
      usage.used++;
      const price = providerConfig.parseResponse(data, metal);
      if (price && price > 0) results[metal] = price;
    } catch (err) {
      console.warn(`Latest fetch failed for ${metal}:`, err.message);
    }
  }
};

/**
 * Executes a batch API request to retrieve spot prices for multiple metals simultaneously.
 * Supports historical data range requests if provided by the underlying API.
 *
 * @param {string} provider - The unique key of the API provider
 * @param {string} apiKey - The API key for the provider
 * @param {string[]} selectedMetals - Array of metal keys to fetch
 * @param {number} [historyDays=0] - Number of days of history to include
 * @param {string[]} [historyTimes=[]] - Array of HH:MM times for granular history
 * @returns {Promise<Object<string, number>>} Map of metal keys to spot prices
 */
const fetchBatchSpotPrices = async (
  provider,
  apiKey,
  selectedMetals,
  historyDays = 0,
  historyTimes = []
) => {
  const providerConfig = API_PROVIDERS[provider];
  if (!providerConfig || !providerConfig.batchSupported) {
    throw new Error("Provider does not support batch requests");
  }

  if (provider === "METALS_DEV" && historyDays > 30) historyDays = 30;

  const config = loadApiConfig();
  const usage = config.usage?.[provider] || { quota: DEFAULT_API_QUOTA, used: 0 };

  try {
    let url = providerConfig.baseUrl + providerConfig.batchEndpoint;

    // Replace placeholders based on provider specifics
    if (provider === "METALS_DEV") {
      url = url.replace("{API_KEY}", apiKey);
    } else if (provider === "METALS_API") {
      // filter(Boolean) drops unmapped metals (any future metal not yet in
      // the canonical map) so the URL never carries the string "undefined".
      const symbols = selectedMetals
        .map((metal) => SPOT_PROVIDER_METAL_SYMBOLS[metal])
        .filter(Boolean)
        .join(",");
      if (!symbols) return {};
      url = url.replace("{API_KEY}", apiKey).replace("{SYMBOLS}", symbols);
    } else if (provider === "METAL_PRICE_API") {
      const currencies = selectedMetals
        .map((metal) => SPOT_PROVIDER_METAL_SYMBOLS[metal])
        .filter(Boolean)
        .join(",");
      if (!currencies) return {};
      url = url.replace("{API_KEY}", apiKey).replace("{CURRENCIES}", currencies);
    }

    // Compute start/end dates for timeseries endpoints (all providers)
    if (url.includes("{START_DATE}") || url.includes("{END_DATE}")) {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - (historyDays || 29));
      const fmt = (d) => d.toISOString().slice(0, 10);
      url = url.replace("{START_DATE}", fmt(start)).replace("{END_DATE}", fmt(end));
    }

    // Apply historical parameters if supported
    if (url.includes("{DAYS}")) {
      url = url.replace("{DAYS}", historyDays);
      if (Array.isArray(historyTimes) && historyTimes.length) {
        const timesParam = historyTimes.map((t) => encodeURIComponent(t)).join(",");
        if (url.includes("{TIMES}")) {
          url = url.replace("{TIMES}", timesParam);
        } else {
          url += `&times=${timesParam}`;
        }
      }
    }

    const headers = {
      "Content-Type": "application/json",
    };

    if (provider === "METALS_DEV" && apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers: headers,
      mode: "cors",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    usage.used++; // Only increment by 1 for batch request

    const { current = {}, history = {} } = providerConfig.parseBatchResponse(data) || {};

    // Filter results to only include selected metals
    const filteredResults = {};
    selectedMetals.forEach((metal) => {
      if (current[metal] && current[metal] > 0) {
        filteredResults[metal] = current[metal];
      }
    });

    if (Object.keys(filteredResults).length === 0) {
      throw new Error("No valid prices retrieved from batch request");
    }

    // Record historical data if provided
    const providerName = providerConfig.name;
    Object.entries(history).forEach(([metal, entries]) => {
      const metalConfig = Object.values(METALS).find((m) => m.key === metal);
      const metalName = metalConfig?.name || metal;
      entries.forEach(({ timestamp, price }) => {
        recordSpot(price, "api", metalName, providerName, timestamp);
      });
    });
    if (Object.keys(history).length) {
      renderApiHistoryTable();
    }

    // Update usage
    config.usage[provider] = usage;
    saveApiConfig(config);

    return filteredResults;
  } catch (error) {
    throw new Error(`Batch request failed: ${error.message}`);
  }
};

/**
 * Standard interface for fetching spot prices from any supported API provider.
 * Automatically chooses between individual latest endpoints or batch calls.
 *
 * @param {string} provider - The unique key of the API provider
 * @param {string} apiKey - The API key for the provider
 * @returns {Promise<{prices: Object<string, number>, generatedAt: number|null,
 *   priceTimestamps: Object<string, number>}>} Metal prices, the payload's
 *   publication timestamp (epoch ms; null for providers without an envelope),
 *   and per-metal publication overrides for metals backfilled from a runner-up
 *   endpoint (STRK-333; empty for every non-StakTrakr provider)
 */
const fetchSpotPricesFromApi = async (provider, apiKey, { signal } = {}) => {
  const providerConfig = API_PROVIDERS[provider];
  if (!providerConfig) {
    throw new Error("Invalid API provider");
  }

  const config = loadApiConfig();
  const selected = config.metals?.[provider] || {};

  // Get selected metals
  const selectedMetals = Object.keys(selected).filter((metal) => selected[metal] !== false);

  if (selectedMetals.length === 0) {
    throw new Error("No metals selected for sync");
  }

  // StakTrakr uses its own hourly JSON fetch instead of generic provider logic
  if (provider === "STAKTRAKR") {
    return await fetchStaktrakrPrices(selectedMetals, { signal });
  }

  // Third-party providers serve only canonically-wired metals, but config can
  // carry additional truthy entries for metals added ahead of provider wiring
  // (as copper was between STRK-305 and STRK-303 Part 2). Without this
  // restriction such a selection skips the empty-selection error above and
  // fails later with a misleading "No valid prices retrieved" (STRK-342).
  const supportedMetals = selectedMetals.filter((metal) => SPOT_PROVIDER_METAL_SYMBOLS[metal]);
  if (supportedMetals.length === 0) {
    throw new Error("No metals selected for sync");
  }

  // Latest-only: no history backfill on regular sync
  return {
    prices: await fetchLatestPrices(provider, apiKey, supportedMetals),
    generatedAt: null,
    priceTimestamps: {},
  };
};

// =============================================================================
// BATCHED HISTORY PULL
// =============================================================================

/**
 * Splits a requested historical time range into smaller date chunks.
 * Ensures each request stays within the provider's maximum allowed days per call.
 *
 * @param {number} totalDays - Total number of days to fetch
 * @param {number} maxPerRequest - Maximum days allowed per API request
 * @returns {Array<{start: Date, end: Date}>} Array of date range objects, newest first
 */
const getDateChunks = (totalDays, maxPerRequest) => {
  const chunks = [];
  const today = new Date();
  let remaining = totalDays;
  let endDate = new Date(today);
  while (remaining > 0) {
    const chunkSize = Math.min(remaining, maxPerRequest);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - chunkSize);
    chunks.push({ start: new Date(startDate), end: new Date(endDate) });
    endDate = new Date(startDate);
    remaining -= chunkSize;
  }
  return chunks;
};

/**
 * Orchestrates a series of batched API requests to backfill historical spot price data.
 * Automates the chunking process and parses results for multiple metals.
 *
 * @param {string} provider - The unique key of the API provider
 * @param {string} apiKey - The API key for the provider
 * @param {string[]} selectedMetals - Array of metal keys to fetch
 * @param {number} totalDays - Total number of days of history to pull
 * @returns {Promise<{totalEntries: number, callsMade: number}>} Summary of the batch operation
 */
const fetchHistoryBatched = async (provider, apiKey, selectedMetals, totalDays) => {
  const providerConfig = API_PROVIDERS[provider];
  if (!providerConfig || !providerConfig.batchSupported) {
    throw new Error("Provider does not support history requests");
  }

  const maxPerReq = providerConfig.maxHistoryDays || 30;
  const chunks = getDateChunks(totalDays, maxPerReq);
  const config = loadApiConfig();
  const usage = config.usage?.[provider] || { quota: DEFAULT_API_QUOTA, used: 0 };
  const providerName = providerConfig.name;
  const fmt = (d) => d.toISOString().slice(0, 10);

  // Build symbol groups based on provider capability
  let symbolGroups;
  if (providerConfig.symbolsPerRequest === 1) {
    // One metal per request (e.g., metals-api)
    symbolGroups = selectedMetals.map((m) => [m]);
  } else {
    // All metals in one request
    symbolGroups = [selectedMetals];
  }

  let totalEntries = 0;
  let callsMade = 0;

  for (const chunk of chunks) {
    for (const metals of symbolGroups) {
      let url = providerConfig.baseUrl + providerConfig.batchEndpoint;

      // Replace API key and currency placeholders
      url = url.replace("{API_KEY}", apiKey);

      // Replace date placeholders
      url = url.replace("{START_DATE}", fmt(chunk.start)).replace("{END_DATE}", fmt(chunk.end));

      // Replace symbol/currency placeholders
      if (provider === "METALS_API") {
        const symbols = metals
          .map((m) => SPOT_PROVIDER_METAL_SYMBOLS[m])
          .filter(Boolean)
          .join(",");
        if (!symbols) continue;
        url = url.replace("{SYMBOLS}", symbols);
      } else if (provider === "METAL_PRICE_API") {
        const currencies = metals
          .map((m) => SPOT_PROVIDER_METAL_SYMBOLS[m])
          .filter(Boolean)
          .join(",");
        if (!currencies) continue;
        url = url.replace("{CURRENCIES}", currencies);
      }

      const headers = { "Content-Type": "application/json" };
      if (provider === "METALS_DEV" && apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      try {
        // Safe: URL constructed from hardcoded API_PROVIDERS config (baseUrl + batchEndpoint + templated dates/metals)
        const response = await fetch(url, { method: "GET", headers, mode: "cors" });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

        const data = await response.json();
        callsMade++;
        usage.used++;

        const { history = {} } = providerConfig.parseBatchResponse(data) || {};

        Object.entries(history).forEach(([metal, entries]) => {
          if (!selectedMetals.includes(metal)) return;
          const metalConfig = Object.values(METALS).find((m) => m.key === metal);
          const metalName = metalConfig?.name || metal;
          entries.forEach(({ timestamp, price }) => {
            recordSpot(price, "api", metalName, providerName, timestamp);
            totalEntries++;
          });
        });
      } catch (err) {
        console.error(
          `History batch failed (${fmt(chunk.start)}..${fmt(chunk.end)}):`,
          err.message
        );
      }
    }
  }

  // Save updated usage
  config.usage[provider] = usage;
  saveApiConfig(config);

  return { totalEntries, callsMade };
};

/**
 * Specialized history fetcher for MetalPriceAPI's hourly endpoint.
 * Requests granular hourly data for a specific date range.
 *
 * @param {string} apiKey - The API key for MetalPriceAPI
 * @param {string[]} selectedMetals - Array of metal keys to fetch
 * @param {number} totalDays - Number of days of history to pull
 * @returns {Promise<{totalEntries: number, callsMade: number}>} Summary of the operation
 */
const fetchMetalPriceApiHourly = async (apiKey, selectedMetals, totalDays) => {
  const baseUrl = API_PROVIDERS.METAL_PRICE_API.baseUrl;
  const symbolMap = SPOT_PROVIDER_METAL_SYMBOLS;
  const config = loadApiConfig();
  const usage = config.usage?.METAL_PRICE_API || { quota: DEFAULT_API_QUOTA, used: 0 };
  const providerName = API_PROVIDERS.METAL_PRICE_API.name;

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - totalDays);
  const fmt = (d) => d.toISOString().slice(0, 10);

  // Purge once, then build dedup set for batch append (avoids N×save)
  purgeSpotHistory();
  const existingKeys = new Set(spotHistory.map((e) => `${e.timestamp}|${e.metal}`));

  let totalEntries = 0;
  let callsMade = 0;

  for (const metal of selectedMetals) {
    const currency = symbolMap[metal];
    if (!currency) continue;
    const url = (baseUrl + API_PROVIDERS.METAL_PRICE_API.hourlyEndpoint)
      .replace("{API_KEY}", encodeURIComponent(apiKey))
      .replace("{CURRENCY}", currency)
      .replace("{START_DATE}", fmt(start))
      .replace("{END_DATE}", fmt(end));
    try {
      const resp = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        mode: "cors",
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      callsMade++;
      usage.used++;

      const metalConfig = Object.values(METALS).find((m) => m.key === metal);
      const metalName = metalConfig?.name || metal;
      (data.rates || []).forEach((entry) => {
        const ts = new Date(entry.timestamp * 1000);
        const entryTimestamp = ts.toISOString().replace("T", " ").slice(0, 19);
        const rate = entry.rates?.[currency];
        if (!Number.isFinite(rate) || rate === 0) return;
        const price = 1 / rate;
        const key = `${entryTimestamp}|${metalName}`;
        if (!existingKeys.has(key)) {
          spotHistory.push({
            spot: price,
            metal: metalName,
            source: "api-hourly",
            provider: providerName,
            timestamp: entryTimestamp,
          });
          existingKeys.add(key);
          totalEntries++;
        }
      });
    } catch (err) {
      console.warn(`Hourly fetch failed for ${metal}:`, err.message);
    }
  }

  if (totalEntries > 0) {
    saveSpotHistory();
  }

  config.usage.METAL_PRICE_API = usage;
  saveApiConfig(config);
  return { totalEntries, callsMade };
};

/**
 * UI entry point for initiating a historical data pull for a provider.
 * Validates requirements, shows cost/quota confirmation, and executes pull.
 *
 * @param {string} provider - The unique key of the API provider
 */
const handleHistoryPull = async (provider) => {
  // STAKTRAKR has its own hourly pull logic (no API key needed)
  if (provider === "STAKTRAKR") {
    return handleStaktrakrHistoryPull();
  }

  const config = loadApiConfig();
  const apiKey = config.keys?.[provider];
  if (!apiKey) {
    appAlert("No API key configured for this provider. Please save your key first.");
    return;
  }

  const providerConfig = API_PROVIDERS[provider];
  if (!providerConfig || !providerConfig.batchSupported) {
    appAlert("This provider does not support history pulls.");
    return;
  }

  const selected = config.metals?.[provider] || {};
  // History pulls hit third-party batch endpoints only, so restrict to
  // history-capable metals — canonically-wired minus per-provider exclusions
  // (metals.dev discards copper timeseries rows; a copper-only pull there
  // must surface as "no metals selected", not burn a call to pull zero
  // points) (STRK-342, STRK-303 Part 2).
  const selectedMetals = Object.keys(selected).filter(
    (m) => selected[m] !== false && isProviderHistoryMetal(provider, m)
  );
  if (selectedMetals.length === 0) {
    appAlert("No metals selected. Please select at least one metal to track.");
    return;
  }

  const daysSelect = document.getElementById(`historyPullDays_${provider}`);
  let totalDays = daysSelect ? parseInt(daysSelect.value, 10) : 30;

  // Check for hourly mode (MetalPriceAPI)
  const hourlyToggle = document.getElementById(`hourlyPull_${provider}`);
  const isHourly = hourlyToggle && hourlyToggle.checked;
  if (isHourly) {
    const maxHourly = providerConfig.maxHourlyDays || 7;
    totalDays = Math.min(totalDays, maxHourly);
  }

  // Calculate cost — one request per metal for hourly, chunked batches for daily
  const totalCalls = isHourly
    ? selectedMetals.length
    : Math.ceil(totalDays / (providerConfig.maxHistoryDays || 30)) *
      (providerConfig.symbolsPerRequest === 1 ? selectedMetals.length : 1);

  const usage = config.usage?.[provider] || { quota: DEFAULT_API_QUOTA, used: 0 };
  const remaining = Math.max(0, usage.quota - usage.used);

  const modeLabel = isHourly ? "hourly" : "daily";
  const proceed = await appConfirm(
    `Pull ${totalDays} days of ${modeLabel} history from ${providerConfig.name}.\n\n` +
      `This will use ${totalCalls} API call${totalCalls > 1 ? "s" : ""} ` +
      `(${remaining} remaining this month).\n\nProceed?`,
    "History Pull"
  );
  if (!proceed) return;

  // Disable button during pull
  const btn = document.querySelector(`.api-history-btn[data-provider="${provider}"]`);
  const origText = btn ? btn.textContent : "";
  if (btn) {
    btn.textContent = "Pulling...";
    btn.disabled = true;
  }

  try {
    let result;
    if (isHourly && provider === "METAL_PRICE_API") {
      result = await fetchMetalPriceApiHourly(apiKey, selectedMetals, totalDays);
    } else {
      result = await fetchHistoryBatched(provider, apiKey, selectedMetals, totalDays);
    }
    appAlert(
      `History pull complete!\n\n` +
        `Pulled ${result.totalEntries} data points using ${result.callsMade} API call${result.callsMade > 1 ? "s" : ""}.`
    );
    updateProviderHistoryTables();
    if (typeof updateAllSparklines === "function") updateAllSparklines();
  } catch (err) {
    console.error("History pull failed:", err);
    appAlert("History pull failed: " + err.message);
  } finally {
    if (btn) {
      btn.textContent = origText;
      btn.disabled = false;
    }
  }
};

/**
 * Initiates the spot price synchronization process across all configured providers.
 * Handles user interaction, cache validation prompts, and UI status updates.
 *
 * @param {boolean} [showProgress=true] - Whether to display alerts and progress UI
 * @param {boolean} [forceSync=false] - If true, ignores the local cache and forces API calls
 * @returns {Promise<boolean>} True if at least one provider successfully synced prices
 */
const syncSpotPricesFromApi = async (showProgress = true, forceSync = false) => {
  const config = loadApiConfig();
  const hasAnyKey = Object.values(config.keys || {}).some((k) => k);
  const hasKeylessProvider = Object.keys(API_PROVIDERS).some((p) => !providerRequiresKey(p));

  if (!hasAnyKey && !hasKeylessProvider) {
    if (showProgress) {
      appAlert("No Metals API configuration found. Please configure an API provider first.");
    }
    return false;
  }

  // Interactive cache decision (only when user-initiated with visible UI)
  if (showProgress && !forceSync) {
    const cache = loadApiCache();
    if (cache && cache.data && cache.timestamp) {
      const now = Date.now();
      const cacheAge = now - cache.timestamp;
      const duration = getCacheDurationMs(cache.provider || config.provider);

      if (cacheAge < duration) {
        const hoursAgo = Math.floor(cacheAge / (1000 * 60 * 60));
        const minutesAgo = Math.floor(cacheAge / (1000 * 60));
        const timeText = hoursAgo > 0 ? `${hoursAgo} hours ago` : `${minutesAgo} minutes ago`;

        const override = await appConfirm(
          `Cached prices from ${timeText}.\n\nFetch fresh prices from the API?`,
          "Spot Sync"
        );
        if (!override) {
          return refreshFromCache();
        }
      }
    }
  }

  // Delegate to provider chain
  const { updatedCount, anySucceeded, results } = await syncProviderChain({
    showProgress,
    forceSync: forceSync || showProgress, // User-initiated always forces
  });

  if (showProgress && updatedCount > 0) {
    const providerName = Object.entries(results).find(([_, status]) => status === "success")?.[0];
    const label = providerName ? API_PROVIDERS[providerName]?.name || providerName : "API";
    if (typeof showToast === "function") {
      showToast(`\u2713 Synced ${updatedCount} prices from ${label}`);
    }
  } else if (showProgress && !anySucceeded) {
    if (typeof showToast === "function") {
      showToast("Spot sync failed — check API settings");
    }
  }

  return anySucceeded;
};

/**
 * Validates an API provider's connectivity by making a lightweight test request.
 * Usually attempts to fetch a single metal's price (e.g., silver) to verify the key.
 *
 * @param {string} provider - The unique key of the API provider
 * @param {string} apiKey - The API key to be tested
 * @returns {Promise<boolean>} True if the connection test was successful
 */
const testApiConnection = async (provider, apiKey) => {
  try {
    // Just test one metal (silver) to verify connection
    const providerConfig = API_PROVIDERS[provider];
    if (!providerConfig) {
      throw new Error("Invalid provider");
    }

    if (provider === "STAKTRAKR") {
      const result = await fetchStaktrakrPrices(["silver"]);
      return result.prices.silver > 0;
    }

    let url = "";
    const headers = {
      "Content-Type": "application/json",
    };
    if (provider === "CUSTOM") {
      const config = loadApiConfig();
      const custom = config.customConfig || {};
      const metal = custom.format === "word" ? "silver" : "XAG";
      url = `${custom.baseUrl || ""}${(custom.endpoint || "")
        .replace("{API_KEY}", apiKey)
        .replace("{METAL}", metal)}`;
    } else {
      const endpoint = providerConfig.endpoints.silver;
      url = `${providerConfig.baseUrl}${endpoint.replace("{API_KEY}", apiKey)}`;
      if (provider === "METALS_DEV" && apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
      if (provider === "GOLD_API" && apiKey) {
        headers["x-api-key"] = apiKey;
      }
    }

    const response = await fetch(url, {
      method: "GET",
      headers: headers,
      mode: "cors",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const price = providerConfig.parseResponse(data, "silver");

    return price && price > 0;
  } catch (error) {
    debugLog("API connection test failed:", error, "warn");
    return false;
  }
};

/**
 * Handles the UI-triggered synchronization of a single specific provider.
 * Useful for per-provider settings cards and troubleshooting.
 *
 * @param {string} provider - The unique key of the API provider
 * @returns {Promise<void>} Resolves when the provider sync attempt completes
 */
const handleProviderSync = async (provider) => {
  let apiKey = ""; // nosemgrep: codacy.javascript.security.hard-coded-password
  if (providerRequiresKey(provider)) {
    const keyInput = document.getElementById(`apiKey_${provider}`);
    if (!keyInput) return;
    apiKey = keyInput.value.trim();
    if (!apiKey) {
      appAlert("Please enter your API key");
      return;
    }
  }

  const config = loadApiConfig();
  // Ensure keys object exists and clone to avoid mutating shared references
  config.keys = { ...(config.keys || {}) };
  if (apiKey) config.keys[provider] = apiKey;
  if (provider === "CUSTOM") {
    const base = document.getElementById("apiBase_CUSTOM")?.value.trim() || "";
    const endpoint = document.getElementById("apiEndpoint_CUSTOM")?.value.trim() || "";
    const format = document.getElementById("apiFormat_CUSTOM")?.value || "symbol";
    if (!base || !endpoint) {
      appAlert("Please enter base URL and endpoint");
      return;
    }
    config.customConfig = { baseUrl: base, endpoint, format };
  }
  config.timestamp = new Date().getTime();
  saveApiConfig(config);
  updateDefaultProviderButtons();
  updateSyncButtonStates();
  setProviderStatus(provider, "disconnected");

  // Test connection
  const ok = await testApiConnection(provider, apiKey);
  if (!ok) {
    appAlert("API connection test failed.");
    setProviderStatus(provider, "error");
    return;
  }

  try {
    const {
      prices,
      generatedAt,
      priceTimestamps = {},
    } = await fetchSpotPricesFromApi(provider, apiKey);
    if (
      generatedAt !== null &&
      _lastAcceptedSpotGeneratedAtMs !== null &&
      generatedAt < _lastAcceptedSpotGeneratedAtMs
    ) {
      // Older payload than the last accepted one — never overwrite newer (STRK-189)
      appAlert("Received an older spot payload than the one already displayed; sync skipped.");
      setProviderStatus(provider, "error");
      return;
    }
    let updatedCount = 0;
    Object.entries(prices).forEach(([metal, price]) => {
      const metalConfig = Object.values(METALS).find((m) => m.key === metal);
      if (metalConfig && price > 0) {
        localStorage.setItem(metalConfig.spotKey, price.toString());
        spotPrices[metal] = price;
        elements.spotPriceDisplay[metal].textContent = formatCurrency(price);
        updateSpotCardColor(metal, price);
        // STRK-333: backfilled metals carry their own (older) publication time.
        const metalTs = priceTimestamps[metal] ?? generatedAt;
        recordSpot(
          price,
          "api",
          metalConfig.name,
          API_PROVIDERS[provider].name,
          metalTs !== null && metalTs !== undefined ? new Date(metalTs).toISOString() : null
        );
        const ts = document.getElementById(`spotTimestamp${metalConfig.name}`);
        if (ts) {
          updateSpotTimestamp(metalConfig.name);
        }
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      if (generatedAt !== null) _lastAcceptedSpotGeneratedAtMs = generatedAt;
      saveApiCache(prices, provider);
      updateSummary();
      // Update Goldback denomination prices BEFORE snapshotting item prices (STAK-108)
      if (typeof onGoldSpotPriceChanged === "function") onGoldSpotPriceChanged();
      if (typeof recordAllItemPriceSnapshots === "function") recordAllItemPriceSnapshots();
      if (typeof updateAllSparklines === "function") {
        updateAllSparklines();
      }
      if (typeof renderRatioChips === "function") renderRatioChips();
      setProviderStatus(provider, "connected");
      updateProviderHistoryTables();
      appAlert(
        `Successfully synced ${updatedCount} metal prices from ${API_PROVIDERS[provider].name}`
      );
    } else {
      setProviderStatus(provider, "error");
      appAlert("No valid prices retrieved from API");
    }
  } catch (error) {
    console.error("API sync error:", error);
    setProviderStatus(provider, "error");
    appAlert("Failed to sync prices: " + error.message);
  }
};

/**
 * Triggers a background sync across all providers.
 *
 * @returns {Promise<number>} Total number of prices updated
 */
const syncAllProviders = async () => {
  const { updatedCount } = await syncProviderChain({ showProgress: false, forceSync: true });
  updateProviderHistoryTables();
  if (typeof renderRatioChips === "function") renderRatioChips();
  return updatedCount;
};

/**
 * Syncs spot prices from the single active provider selected in `spotPricingSource`.
 * Replaces the legacy priority-chain iteration with a single-branch switch (STAK-443, REQ-10).
 *
 * - When `spotPricingSource === 'MANUAL'`, returns immediately without any network fetch.
 * - Otherwise fetches once from the matching provider and updates status/prices/cache.
 *
 * @param {Object} options
 * @param {boolean} [options.showProgress=false] - If true, updates sync button UI states
 * @param {boolean} [options.forceSync=false] - If true, ignores provider-specific cache durations
 * @returns {Promise<{results: Object, updatedCount: number, anySucceeded: boolean}>} Sync operation summary
 */
const syncSpotProvider = async ({ showProgress = false, forceSync = false } = {}) => {
  const source = (await loadData("spotPricingSource", "STAKTRAKR")) || "STAKTRAKR";
  const syncKey = `${source}|${forceSync ? "force" : "cache"}`;

  if (_spotProviderSyncPromise && _spotProviderSyncKey === syncKey) {
    return _spotProviderSyncPromise;
  }

  // MANUAL short-circuit: zero network activity (REQ-10)
  if (source === "MANUAL") {
    return { results: { MANUAL: "disabled" }, updatedCount: 0, anySucceeded: false };
  }

  _spotProviderSyncKey = syncKey;
  const syncAbortController = new AbortController();
  const syncGeneration = _spotProviderSyncGeneration;
  _spotProviderAbortController = syncAbortController;
  _spotProviderSyncPromise = (async () => {
    // Unknown source → coerce to STAKTRAKR default
    const prov = Object.prototype.hasOwnProperty.call(API_PROVIDERS, source) ? source : "STAKTRAKR";
    const config = loadApiConfig();
    const apiKey = config.keys?.[prov];
    const results = {};
    let updatedCount = 0;
    let anySucceeded = false;

    if (showProgress) {
      updateSyncButtonStates(true);
    }

    try {
      const guard = _evaluateSpotSyncGuards(prov, apiKey, forceSync, results);
      if (guard) {
        return { results, updatedCount: guard.updatedCount, anySucceeded: guard.anySucceeded };
      }

      // Single-provider fetch
      const fetched = await _performSingleProviderFetch(prov, apiKey, results, {
        source,
        syncGeneration,
        syncAbortController,
      });
      updatedCount += fetched.updatedCount;
      anySucceeded = anySucceeded || fetched.anySucceeded;

      // Post-sync updates if anything changed
      if (updatedCount > 0) {
        await _runPostSpotSyncUpdates(prov, results, {
          source,
          syncGeneration,
          syncAbortController,
        });
      }
    } finally {
      if (showProgress) {
        updateSyncButtonStates(false);
      }
    }

    return { results, updatedCount, anySucceeded };
  })();

  const currentSyncPromise = _spotProviderSyncPromise;
  try {
    return await currentSyncPromise;
  } finally {
    if (_spotProviderSyncPromise === currentSyncPromise) {
      _spotProviderSyncPromise = null;
      _spotProviderSyncKey = null;
      if (_spotProviderAbortController === syncAbortController) {
        _spotProviderAbortController = null;
      }
    }
  }
};

/**
 * Backward-compatible alias for external callers. Delegates to `syncSpotProvider`.
 * Slated for removal in a follow-up release once callers are migrated.
 *
 * @deprecated Use `syncSpotProvider` instead.
 */
const syncProviderChain = (options) => syncSpotProvider(options);

/**
 * Pre-fetch guards for a single-provider sync. Sets `results[prov]` and returns
 * an early-exit summary when the provider has no required key or its cache is
 * still warm; returns null to signal the caller should proceed with the fetch.
 *
 * @param {string} prov - The resolved provider key
 * @param {string} apiKey - The provider's API key (may be undefined)
 * @param {boolean} forceSync - When true, bypasses the per-provider cache check
 * @param {Object<string, string>} results - Status accumulator mutated in place
 * @returns {{updatedCount: number, anySucceeded: boolean}|null} Early-exit
 *   summary, or null to continue to the fetch
 */
const _evaluateSpotSyncGuards = (prov, apiKey, forceSync, results) => {
  if (!apiKey && providerRequiresKey(prov)) {
    results[prov] = "no key";
    setProviderStatus(prov, "error");
    return { updatedCount: 0, anySucceeded: false };
  }

  // Check per-provider cache unless forcing
  if (!forceSync) {
    const provDuration = getCacheDurationMs(prov);
    const lastSync = getLastProviderSyncTime(prov);
    if (lastSync && Date.now() - lastSync < provDuration) {
      results[prov] = "cached";
      return { updatedCount: 0, anySucceeded: true };
    }
  }

  return null;
};

/**
 * Writes a fetched price map to storage, in-memory state, the spot displays, and
 * spot history. Skips non-positive prices and metals not in the METALS registry.
 *
 * @param {Object<string, number>} prices - Map of metal key to price
 * @param {string} prov - The provider key (for history attribution)
 * @param {number|null} generatedAt - Payload publication epoch ms (or null)
 * @param {Object<string, number>} [priceTimestamps] - Per-metal publication epoch ms
 *   overrides for metals backfilled from a runner-up endpoint (STRK-333)
 * @returns {number} Count of metals actually updated
 */
const _applyFetchedSpotPrices = (prices, prov, generatedAt, priceTimestamps = {}) => {
  let provUpdated = 0;
  Object.entries(prices).forEach(([metal, price]) => {
    const metalConfig = Object.values(METALS).find((m) => m.key === metal);
    if (metalConfig && price > 0) {
      localStorage.setItem(metalConfig.spotKey, price.toString());
      spotPrices[metal] = price;
      elements.spotPriceDisplay[metal].textContent = formatCurrency(price);
      updateSpotCardColor(metal, price);
      // STRK-333: a metal backfilled from a runner-up endpoint carries its own
      // (older) publication time so its history row is never stamped fresher
      // than the price actually is. Metals from the winning envelope fall
      // through to the shared generatedAt.
      const metalTs = priceTimestamps[metal] ?? generatedAt;
      recordSpot(
        price,
        "api",
        metalConfig.name,
        API_PROVIDERS[prov].name,
        metalTs !== null && metalTs !== undefined ? new Date(metalTs).toISOString() : null
      );
      const ts = safeGetElement(`spotTimestamp${metalConfig.name}`);
      if (ts) updateSpotTimestamp(metalConfig.name);
      provUpdated++;
    }
  });
  return provUpdated;
};

/**
 * Fetches spot prices from a single provider and applies them, enforcing the
 * abort/generation/source-switch guards and the STRK-189 monotonic freshness
 * gate. Sets `results[prov]` to the outcome and returns the update summary.
 *
 * @param {string} prov - The resolved provider key
 * @param {string} apiKey - The provider's API key
 * @param {Object<string, string>} results - Status accumulator mutated in place
 * @param {Object} ctx - Sync context captured by the caller
 * @param {string} ctx.source - The active spot pricing source at sync start
 * @param {number} ctx.syncGeneration - The sync generation snapshot
 * @param {AbortController} ctx.syncAbortController - The per-sync abort controller
 * @returns {Promise<{updatedCount: number, anySucceeded: boolean}>} Update summary
 */
const _performSingleProviderFetch = async (prov, apiKey, results, ctx) => {
  const { source, syncGeneration, syncAbortController } = ctx;
  try {
    const {
      prices,
      generatedAt,
      priceTimestamps = {},
    } = await fetchSpotPricesFromApi(prov, apiKey, {
      signal: syncAbortController.signal,
    });
    const currentSource = (await loadData("spotPricingSource", "STAKTRAKR")) || "STAKTRAKR";
    if (
      syncAbortController.signal.aborted ||
      syncGeneration !== _spotProviderSyncGeneration ||
      currentSource !== source
    ) {
      return { updatedCount: 0, anySucceeded: false };
    }
    if (
      generatedAt !== null &&
      _lastAcceptedSpotGeneratedAtMs !== null &&
      generatedAt < _lastAcceptedSpotGeneratedAtMs
    ) {
      // Older payload than the last accepted one — never overwrite newer (STRK-189)
      results[prov] = "stale";
      setProviderStatus(prov, "error");
      return { updatedCount: 0, anySucceeded: false };
    }

    const provUpdated = _applyFetchedSpotPrices(prices, prov, generatedAt, priceTimestamps);

    if (provUpdated > 0) {
      if (generatedAt !== null) _lastAcceptedSpotGeneratedAtMs = generatedAt;
      saveApiCache(prices, prov);
      results[prov] = "success";
      setProviderStatus(prov, "connected");
      return { updatedCount: provUpdated, anySucceeded: true };
    }
    results[prov] = "no data";
    setProviderStatus(prov, "error");
    return { updatedCount: 0, anySucceeded: false };
  } catch (err) {
    if (syncAbortController.signal.aborted) {
      return { updatedCount: 0, anySucceeded: false };
    }
    console.warn(`Spot sync failed for ${prov}:`, err.message);
    results[prov] = "error";
    setProviderStatus(prov, "error");
    return { updatedCount: 0, anySucceeded: false };
  }
};

/**
 * Runs the post-sync side effects after at least one price updated: summary
 * refresh, exchange rates, goldback pricing, snapshots, storage stats, the
 * StakTrakr hourly backfill (when fresh and still the active source), and chart
 * refreshes. Mirrors the original inline ordering exactly.
 *
 * @param {string} prov - The resolved provider key
 * @param {Object<string, string>} results - Status accumulator (read-only here)
 * @param {Object} ctx - Sync context captured by the caller
 * @param {string} ctx.source - The active spot pricing source at sync start
 * @param {number} ctx.syncGeneration - The sync generation snapshot
 * @param {AbortController} ctx.syncAbortController - The per-sync abort controller
 * @returns {Promise<void>}
 */
const _runPostSpotSyncUpdates = async (prov, results, ctx) => {
  const { source, syncGeneration, syncAbortController } = ctx;
  // Refresh exchange rates alongside spot prices (STACK-50)
  if (typeof fetchExchangeRates === "function") {
    fetchExchangeRates().catch(() => {});
  }
  updateSummary();
  // Update Goldback denomination prices BEFORE snapshotting item prices,
  // so the retail hierarchy reflects the new gold spot (STAK-108)
  if (typeof onGoldSpotPriceChanged === "function") onGoldSpotPriceChanged();
  if (typeof recordAllItemPriceSnapshots === "function") recordAllItemPriceSnapshots();
  if (typeof updateStorageStats === "function") updateStorageStats();
  // Backfill hourly data when StakTrakr is the active source and sync was fresh
  if (prov === "STAKTRAKR" && results.STAKTRAKR === "success") {
    try {
      const currentSource = (await loadData("spotPricingSource", "STAKTRAKR")) || "STAKTRAKR";
      if (
        !syncAbortController.signal.aborted &&
        syncGeneration === _spotProviderSyncGeneration &&
        currentSource === source
      ) {
        await backfillStaktrakrHourly({ signal: syncAbortController.signal });
      }
    } catch (err) {
      console.warn("Hourly backfill failed:", err.message);
    }
  }
  if (typeof updateAllSparklines === "function") updateAllSparklines();
  if (typeof renderRatioChips === "function") renderRatioChips();
};

/**
 * Updates sync button states based on API availability
 *
 * Owns `disabled`, `title`, and `.syncing` on the `syncIcon{Metal}` buttons.
 * The `spot-sync-icon--*` freshness modifiers on those same elements belong to
 * `applySpotFreshnessClasses` (js/spot.js), called at the end of this function
 * so every one of this function's call sites repaints the colour too (STRK-291).
 * Keep the two concerns split — a single writer per class group is what stops
 * them clobbering each other mid-sync.
 * @param {boolean} syncing - Whether sync is in progress
 */
const updateSyncButtonStates = (syncing = false) => {
  let source = "STAKTRAKR";
  const sourceKey =
    typeof SPOT_PRICING_SOURCE_KEY !== "undefined" ? SPOT_PRICING_SOURCE_KEY : "spotPricingSource";
  try {
    if (typeof loadDataSync === "function") {
      source = loadDataSync(sourceKey, "STAKTRAKR") || "STAKTRAKR";
    } else {
      const raw = localStorage.getItem(sourceKey);
      if (raw) source = JSON.parse(raw) || "STAKTRAKR";
    }
  } catch (_e) {
    /* corrupt value — fall back to default */
  }
  const hasApi = source !== "MANUAL" && (apiConfig?.keys?.[source] || !providerRequiresKey(source));

  Object.values(METALS).forEach((metalConfig) => {
    // New sparkline card sync icon
    const syncIcon = document.getElementById(`syncIcon${metalConfig.name}`);
    if (syncIcon) {
      syncIcon.disabled = !hasApi || syncing;
      syncIcon.title = hasApi ? (syncing ? "Syncing..." : "Sync from API") : "Configure API first";
      if (syncing) {
        syncIcon.classList.add("syncing");
      } else {
        syncIcon.classList.remove("syncing");
      }
    }
  });

  // Freshness colour is a separate concern with its own writer — see the JSDoc.
  if (typeof applySpotFreshnessClasses === "function") applySpotFreshnessClasses();
};

// STAK-443: populateApiSection relocated to js/settings.js (composer + per-section
// renderers). The legacy panel DOM it populated was removed in Task 4.

/**
 * Legacy showApiModal — redirects to Settings modal API section
 */
const showApiModal = () => {
  if (typeof showSettingsModal === "function") {
    showSettingsModal("api");
  }
};

/**
 * Legacy hideApiModal — redirects to hideSettingsModal
 */
const hideApiModal = () => {
  if (typeof hideSettingsModal === "function") {
    hideSettingsModal();
  }
};

/**
 * Legacy showFilesModal — redirects to Settings modal Files section
 */
const showFilesModal = () => {
  if (typeof showSettingsModal === "function") {
    showSettingsModal("system");
  }
};

/**
 * Legacy hideFilesModal — redirects to hideSettingsModal
 */
const hideFilesModal = () => {
  if (typeof hideSettingsModal === "function") {
    hideSettingsModal();
  } else {
    try {
      document.body.style.overflow = "";
    } catch (e) {
      console.warn("Failed to reset body overflow:", e);
    }
  }
};

/**
 * Shows provider information modal
 * @param {string} providerKey
 */
const showProviderInfo = (providerKey) => {
  const modal = document.getElementById("apiInfoModal");
  if (!modal || !API_PROVIDERS[providerKey]) return;

  const provider = API_PROVIDERS[providerKey];
  const title = document.getElementById("apiInfoTitle");
  const body = document.getElementById("apiInfoBody");

  if (title) title.textContent = "Provider Information";
  if (body) {
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
    body.innerHTML = `
      <div class="info-provider-name">${provider.name}</div>
      <div>Base URL: ${provider.baseUrl}</div>
      <div>Metals: Silver, Gold, Platinum, Palladium</div>
      <div class="api-key-info">
        <div>📋 <strong>API Key Management:</strong></div>
        <ul>
          <li>Visit the documentation link below to manage your API key</li>
          <li>You can view usage, reset, or regenerate your key there</li>
          <li>Keep your API key secure and never share it publicly</li>
        </ul>
      </div>
      <a class="btn info-docs-btn" href="${provider.documentation}" target="_blank" rel="noopener noreferrer">
        📄 ${provider.name} Documentation & Key Management
      </a>
    `;
  }

  modal.style.display = "flex";
};

/**
 * Hides provider information modal
 */
const hideProviderInfo = () => {
  const modal = document.getElementById("apiInfoModal");
  if (modal) {
    modal.style.display = "none";
  }
};

// Make modal controls available globally
window.showApiModal = showApiModal;
window.hideApiModal = hideApiModal;
window.showFilesModal = showFilesModal;
window.hideFilesModal = hideFilesModal;
// STAK-443: window.populateApiSection now assigned in js/settings.js
window.showProviderInfo = showProviderInfo;
window.hideProviderInfo = hideProviderInfo;

/**
 * Saves provider settings (key, cache timeout, history days) without testing or fetching
 * @param {string} provider - Provider key
 */
const handleProviderSave = (provider) => {
  const keyInput = document.getElementById(`apiKey_${provider}`);
  if (!keyInput) return;

  const apiKey = keyInput.value.trim();
  const config = loadApiConfig();
  config.keys = { ...(config.keys || {}) };

  if (apiKey) {
    config.keys[provider] = apiKey;
  }

  if (provider === "CUSTOM") {
    const base = document.getElementById("apiBase_CUSTOM")?.value.trim() || "";
    const endpoint = document.getElementById("apiEndpoint_CUSTOM")?.value.trim() || "";
    const format = document.getElementById("apiFormat_CUSTOM")?.value || "symbol";
    config.customConfig = { baseUrl: base, endpoint, format };
  }

  // Persist per-provider settings (cache timeout)
  updateProviderSettings(provider);

  // Re-load after updateProviderSettings saved, then layer key + CUSTOM config on top
  const updated = loadApiConfig();
  updated.keys = { ...(updated.keys || {}) };
  if (apiKey) updated.keys[provider] = apiKey;
  if (provider === "CUSTOM") {
    updated.customConfig = {
      baseUrl: document.getElementById("apiBase_CUSTOM")?.value.trim() || "",
      endpoint: document.getElementById("apiEndpoint_CUSTOM")?.value.trim() || "",
      format: document.getElementById("apiFormat_CUSTOM")?.value || "symbol",
    };
  }
  saveApiConfig(updated);

  updateDefaultProviderButtons();
  updateSyncButtonStates();

  // Brief visual confirmation via status indicator
  const btn = document.querySelector(`.api-save-btn[data-provider="${provider}"]`);
  if (btn) {
    const origText = btn.textContent;
    btn.textContent = "Saved!";
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = origText;
      btn.disabled = false;
    }, 1200);
  }
};

window.handleProviderSave = handleProviderSave;
window.handleProviderSync = handleProviderSync;
window.clearApiKey = clearApiKey;
window.clearApiCache = clearApiCache;
window.setDefaultProvider = setDefaultProvider;
window.showApiHistoryModal = showApiHistoryModal;
window.hideApiHistoryModal = hideApiHistoryModal;
window.clearApiHistory = clearApiHistory;
window.syncAllProviders = syncAllProviders;
window.syncSpotPricesFromApi = syncSpotPricesFromApi;
window.syncSpotProvider = syncSpotProvider;
window.syncProviderChain = syncProviderChain;
window.autoSyncSpotPrices = autoSyncSpotPrices;
window.startSpotBackgroundSync = startSpotBackgroundSync;
window.abortSpotProviderSync = abortSpotProviderSync;
window.handleHistoryPull = handleHistoryPull;
window.updateHistoryPullCost = updateHistoryPullCost;
window.fetchHistoryBatched = fetchHistoryBatched;

/**
 * Shows manual price input for a specific metal
 * @param {string} metal - Metal name (Silver, Gold, etc.)
 */
const showManualInput = (metal) => {
  const manualInput = document.getElementById(`manualInput${metal}`);
  if (manualInput) {
    manualInput.style.display = "block";

    // Focus the input field
    const input = document.getElementById(`userSpotPrice${metal}`);
    if (input) {
      input.focus();
    }
  }
};

/**
 * Hides manual price input for a specific metal
 * @param {string} metal - Metal name (Silver, Gold, etc.)
 */
const hideManualInput = (metal) => {
  const manualInput = document.getElementById(`manualInput${metal}`);
  if (manualInput) {
    manualInput.style.display = "none";

    // Clear the input
    const input = document.getElementById(`userSpotPrice${metal}`);
    if (input) {
      input.value = "";
    }
  }
};

/**
 * Resets spot price to default or API cached value
 * @param {string} metal - Metal name (Silver, Gold, etc.)
 */
const resetSpotPrice = (metal) => {
  const metalConfig = Object.values(METALS).find((m) => m.name === metal);
  if (!metalConfig) return;

  let resetPrice = metalConfig.defaultPrice;
  let source = "default";
  let providerName = null;

  // If we have cached API data, use that instead
  if (apiCache && apiCache.data && apiCache.data[metalConfig.key]) {
    resetPrice = apiCache.data[metalConfig.key];
    source = "api";
    providerName = API_PROVIDERS[apiCache.provider]?.name || null;
  }

  // Update price
  localStorage.setItem(metalConfig.spotKey, resetPrice.toString());
  spotPrices[metalConfig.key] = resetPrice;

  // Update display
  elements.spotPriceDisplay[metalConfig.key].textContent = formatCurrency(resetPrice);

  updateSpotCardColor(metalConfig.key, resetPrice);

  // Record in history
  recordSpot(resetPrice, source, metalConfig.name, providerName);

  // Update summary
  updateSummary();

  // Hide manual input if shown
  hideManualInput(metal);

  if (typeof renderRatioChips === "function") renderRatioChips();
};

/**
 * Exports backup data including Metals API configuration
 * @returns {Object} Complete backup data object
 */
const createBackupData = () => {
  const backupData = {
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    inventory: loadData(LS_KEY, []),
    spotHistory: loadData(SPOT_HISTORY_KEY, []),
    apiConfig:
      apiConfig && apiConfig.provider
        ? {
            provider: apiConfig.provider,
            providerName: API_PROVIDERS[apiConfig.provider]?.name || "Unknown",
            keyLength: apiConfig.keys[apiConfig.provider]
              ? apiConfig.keys[apiConfig.provider].length
              : 0,
            hasKey: !!apiConfig.keys[apiConfig.provider],
            timestamp: apiConfig.timestamp,
          }
        : null,
    spotPrices: { ...spotPrices },
  };

  return backupData;
};

// =============================================================================
// SPOT HISTORY EXPORT/IMPORT
// =============================================================================

/**
 * Exports all spot history data as a CSV file
 */
const exportSpotHistory = () => {
  // STRK-141: read the always-current in-memory spotHistory global (the former sync
  // reload is now async; the global is maintained on every save).
  if (!spotHistory.length) {
    appAlert("No spot history to export.");
    return;
  }

  const csv = Papa.unparse([
    ["Timestamp", "Metal", "Price", "Source", "Provider"],
    ...spotHistory.map((e) => [e.timestamp, e.metal, e.spot, e.source, e.provider || ""]),
  ]);
  downloadFile(`spot-history-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv");
};

/**
 * Imports spot history data from a CSV or JSON file
 * @param {File} file - File to import
 */
const importSpotHistory = (file) => {
  const reader = new FileReader();
  reader.onload = async (e) => {
    let entries = [];
    try {
      if (file.name.endsWith(".json")) {
        const parsed = JSON.parse(e.target.result);
        // Support both flat array and { history: [...] } wrapper
        entries = Array.isArray(parsed) ? parsed : parsed.history || [];
      } else {
        const parsed = Papa.parse(e.target.result, { header: true });
        entries = parsed.data
          .map((row) => ({
            timestamp: row.Timestamp,
            metal: row.Metal,
            spot: parseFloat(row.Price),
            source: row.Source || "import",
            provider: row.Provider || "import",
          }))
          .filter((entry) => entry.timestamp && entry.metal && entry.spot > 0);
      }
    } catch (err) {
      appAlert("Failed to parse file: " + err.message);
      return;
    }

    if (entries.length === 0) {
      appAlert("No valid entries found in file.");
      return;
    }

    // STRK-141: await the now-async reload so recordSpot appends onto a fresh base.
    await loadSpotHistory();
    let imported = 0;
    entries.forEach((entry) => {
      recordSpot(
        entry.spot,
        entry.source || "import",
        entry.metal,
        entry.provider || "import",
        entry.timestamp
      );
      imported++;
    });

    appAlert(`Imported ${imported} spot history entries.`);
    if (typeof updateAllSparklines === "function") updateAllSparklines();

    // Refresh the visible history table after import
    apiHistoryEntries = spotHistory.filter(
      (e) =>
        e.source === "api" ||
        e.source === "api-hourly" ||
        e.source === "seed" ||
        e.source === "cached"
    );
    renderApiHistoryTable();
  };
  reader.readAsText(file);
};

/**
 * Wires up spot history export/import button event listeners.
 * Called during populateApiSection() or init.
 */
/**
 * Fetches all available spot-history-YYYY.json files from local seed files
 * and the live API, merges new entries into spotHistory (dedup by date+metal,
 * existing live data always wins), then re-renders sparklines.
 *
 * Safe to run multiple times — dedup prevents duplicates.
 */
const restoreHistoricalSpotData = async () => {
  const btn = safeGetElement("restoreHistoricalDataBtn");
  const origText = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
  }

  try {
    // STRK-141: await the now-async reload so the dedup base is fresh.
    await loadSpotHistory();
    const existing = Array.isArray(spotHistory) ? spotHistory : [];

    // Build dedup Set from existing entries — these always win
    const existingKeys = new Set();
    for (const e of existing) {
      if (e && e.timestamp && e.metal) {
        existingKeys.add(e.timestamp.slice(0, 10) + "|" + e.metal);
      }
    }

    const allNew = [];
    const years = typeof SEED_DATA_YEARS !== "undefined" ? SEED_DATA_YEARS : [];
    let yearsWithData = 0;

    // --- Pass 1: Local seed files (lowest priority) ---
    for (const year of years) {
      try {
        const resp = await fetch(`data/spot-history-${year}.json`);
        if (!resp.ok) continue;
        const entries = await resp.json();
        if (!Array.isArray(entries)) continue;
        for (const e of entries) {
          if (!e || typeof e.spot !== "number" || !e.metal || !e.timestamp) continue;
          const key = e.timestamp.slice(0, 10) + "|" + e.metal;
          if (!existingKeys.has(key)) {
            allNew.push(e);
            existingKeys.add(key); // prevent API pass from double-adding same slot
          }
        }
      } catch (_) {
        /* network or parse error — skip year */
      }
    }

    // --- Pass 2: API files — fills year gaps not yet covered by seed pass ---
    // Derive data-root base URLs from V2_API_ENDPOINTS (strip /v2 suffix)
    const apiBaseUrls =
      typeof V2_API_ENDPOINTS !== "undefined" && V2_API_ENDPOINTS.length
        ? V2_API_ENDPOINTS.map((ep) => ep.replace(/\/v2$/, ""))
        : [`${API_PROVIDERS.STAKTRAKR.baseUrl}`];

    for (const year of years) {
      if (btn) btn.textContent = `Restoring... (${year})`;
      try {
        const entries = await _staktrakrFetch(apiBaseUrls, `/spot-history-${year}.json`);
        if (!Array.isArray(entries)) continue;
        let addedThisYear = false;
        for (const e of entries) {
          if (!e || typeof e.spot !== "number" || !e.metal || !e.timestamp) continue;
          const key = e.timestamp.slice(0, 10) + "|" + e.metal;
          if (!existingKeys.has(key)) {
            allNew.push(e);
            existingKeys.add(key);
            addedThisYear = true;
          }
        }
        if (addedThisYear) yearsWithData++;
      } catch (_) {
        /* all endpoints failed for this year — skip */
      }
    }

    if (allNew.length === 0) {
      appAlert("Already up to date — no new entries found.");
      return;
    }

    // Merge, sort, save
    const merged = existing.concat(allNew);
    merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    spotHistory = merged;
    saveSpotHistory();

    if (typeof updateAllSparklines === "function") updateAllSparklines();

    appAlert(
      `Restored ${allNew.length.toLocaleString()} new entries` +
        (yearsWithData > 0
          ? ` across ${yearsWithData} year${yearsWithData !== 1 ? "s" : ""} from API.`
          : " from local seed files.")
    );
  } catch (err) {
    console.error("Restore historical data failed:", err);
    appAlert("Restore failed: " + err.message);
  } finally {
    if (btn) {
      btn.textContent = origText;
      btn.disabled = false;
    }
  }
};

const initSpotHistoryButtons = () => {
  const exportBtn = document.getElementById("exportSpotHistoryBtn");
  if (exportBtn) exportBtn.addEventListener("click", exportSpotHistory);

  const restoreBtn = safeGetElement("restoreHistoricalDataBtn");
  if (restoreBtn) restoreBtn.addEventListener("click", restoreHistoricalSpotData);

  const importBtn = document.getElementById("importSpotHistoryBtn");
  const importFile = document.getElementById("importSpotHistoryFile");
  if (importBtn && importFile) {
    importBtn.addEventListener("click", () => importFile.click());
    importFile.addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        importSpotHistory(e.target.files[0]);
        e.target.value = ""; // Reset so same file can be re-imported
      }
    });
  }
};

window.exportSpotHistory = exportSpotHistory;
window.importSpotHistory = importSpotHistory;
window.initSpotHistoryButtons = initSpotHistoryButtons;
window.restoreHistoricalSpotData = restoreHistoricalSpotData;

// =============================================================================

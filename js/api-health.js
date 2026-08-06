// API HEALTH CHECK
// =============================================================================
// Three independent freshness checks:
//   Market prices  — manifest.json       — stale after 30 min
//   Spot prices    — hourly/YYYY/MM/DD/HH.json — stale after 20 min
//   Goldback       — goldback-spot.json  — stale after 25 hr (daily scrape)
//
// SUBJECT (STRK-291): these thresholds measure whether the PUBLISHER is still
// producing data — server liveness, checked against the feed's own timestamps.
// They are intentionally tighter than `SPOT_FRESH_MAX_MIN` / `SPOT_STALE_MAX_MIN`
// (js/utils.js), which measure how old the data in THIS BROWSER is. A user who
// has not synced in two hours is looking at stale local data while the feed is
// perfectly healthy; both statements are true and each has its own indicator.
// Do not "reconcile" these into one constant — they answer different questions.

const API_HEALTH_MARKET_STALE_MIN = 30; // poller runs every ~15-20 min; 30 min gives comfortable margin
const API_HEALTH_SPOT_STALE_MIN = 20; // metalpriceapi.com updated every 10 min; poller runs every 15 min
const API_HEALTH_GOLDBACK_STALE_MIN = 25 * 60; // 25 hours in minutes

/**
 * Normalizes naive "YYYY-MM-DD HH:MM:SS" timestamps (no timezone suffix) to
 * UTC ISO-8601 before parsing. Timestamps that already carry "Z", a positive
 * offset ("+HH:MM"), or a negative offset ("-HH:MM" after position 18) pass
 * through unchanged.
 * "2026-02-22 12:00:00" → "2026-02-22T12:00:00Z"
 * @param {string|*} ts
 * @returns {string|*}
 */
const _normalizeTs = (ts) => {
  if (!ts || typeof ts !== "string") return ts;
  const trimmed = ts.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) return trimmed;
  return trimmed.replace(" ", "T") + "Z";
};

/**
 * Returns a compact relative time string ("8m ago", "2h ago", "1d ago").
 * Mirrors the logic in cloud-sync.js _syncRelativeTime.
 * @param {string|Date} timestamp
 * @returns {string}
 */
const _timeAgo = (timestamp) => {
  if (!timestamp) return "unknown";
  const ageMs = Date.now() - new Date(_normalizeTs(timestamp)).getTime();
  if (isNaN(ageMs) || ageMs < 0) return "just now";
  const minutes = Math.floor(ageMs / 60000);
  const hours = Math.floor(ageMs / 3600000);
  const days = Math.floor(ageMs / 86400000);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
};

/**
 * Parses v2 Promise.allSettled results into the standard health shape.
 * v2 endpoints return envelopes with `generated_at`, `stale_after`, and `data`.
 * Timestamps are already ISO 8601 Z-suffixed — no _normalizeTs needed.
 * @param {PromiseSettledResult} manifestResult
 * @param {PromiseSettledResult} spotResult
 * @param {PromiseSettledResult} goldbackResult
 * @returns {{market: object, spot: object, goldback: object}}
 */
const _parseV2EndpointHealth = (manifestResult, spotResult, goldbackResult) => {
  // --- Market prices (v2/manifest.json) ---
  let market = { ok: false, ageMin: null, ago: null, coins: [], error: null, staleAfterMin: null };
  if (manifestResult.status === "fulfilled") {
    const envelope = manifestResult.value;
    const generatedAt = new Date(envelope.generated_at);
    const staleAfterMin =
      typeof envelope.stale_after === "number"
        ? Math.ceil(envelope.stale_after / 60)
        : API_HEALTH_MARKET_STALE_MIN;
    market.staleAfterMin = staleAfterMin;
    if (!isNaN(generatedAt.getTime())) {
      market.ageMin = Math.max(0, Math.floor((Date.now() - generatedAt.getTime()) / 60000));
      market.ago = _timeAgo(envelope.generated_at);
      market.ok = market.ageMin <= staleAfterMin;
      market.coins = (envelope.data && envelope.data.coins) || [];
    } else {
      market.error = `Invalid timestamp: ${envelope.generated_at}`;
    }
  } else {
    market.error = manifestResult.reason?.message || String(manifestResult.reason);
  }

  // --- Spot prices (v2/spot/latest.json) ---
  let spot = { ok: false, ageMin: null, ago: null, error: null, staleAfterMin: null };
  if (spotResult.status === "fulfilled") {
    const envelope = spotResult.value;
    const generatedAt = new Date(envelope.generated_at);
    const staleAfterMin =
      typeof envelope.stale_after === "number"
        ? Math.ceil(envelope.stale_after / 60)
        : API_HEALTH_SPOT_STALE_MIN;
    spot.staleAfterMin = staleAfterMin;
    if (!isNaN(generatedAt.getTime())) {
      spot.ageMin = Math.max(0, Math.floor((Date.now() - generatedAt.getTime()) / 60000));
      spot.ago = _timeAgo(envelope.generated_at);
      spot.ok = spot.ageMin <= staleAfterMin;
    } else {
      spot.error = `Invalid timestamp: ${envelope.generated_at}`;
    }
  } else {
    spot.error = spotResult.reason?.message || String(spotResult.reason);
  }

  // --- Goldback (v2/goldback/latest.json) ---
  let goldback = { ok: false, ago: null, error: null };
  if (goldbackResult.status === "fulfilled") {
    const envelope = goldbackResult.value;
    const generatedAt = new Date(envelope.generated_at);
    const staleAfterMin =
      typeof envelope.stale_after === "number"
        ? Math.ceil(envelope.stale_after / 60)
        : API_HEALTH_GOLDBACK_STALE_MIN;
    if (!isNaN(generatedAt.getTime())) {
      const ageMin = Math.max(0, Math.floor((Date.now() - generatedAt.getTime()) / 60000));
      goldback.ago = _timeAgo(envelope.generated_at);
      goldback.ok = ageMin <= staleAfterMin;
    } else {
      goldback.error = `Invalid timestamp: ${envelope.generated_at}`;
    }
  } else {
    goldback.error = goldbackResult.reason?.message || String(goldbackResult.reason);
  }

  return { market, spot, goldback };
};

/**
 * Fetches all three API feeds independently from every configured endpoint in
 * parallel. Returns per-endpoint health so the modal can benchmark drift.
 * @returns {Promise<{primary: object, backup: object|null}>}
 */
const fetchApiHealth = async () => {
  const _fetchWithTimeout = (url, ms = 5000) => {
    const bustUrl = `${url}${url.includes("?") ? "&" : "?"}_t=${Date.now()}`;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), ms);
    return fetch(bustUrl, { cache: "no-store", signal: ctrl.signal })
      .then((r) => {
        clearTimeout(tid);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .catch((e) => {
        clearTimeout(tid);
        throw e;
      });
  };

  const v2Endpoints =
    typeof V2_API_ENDPOINTS !== "undefined" && V2_API_ENDPOINTS.length
      ? V2_API_ENDPOINTS
      : ["https://api.staktrakr.com/data/v2"];

  const _fetchV2FromEndpoint = async (ep) => {
    return Promise.allSettled([
      _fetchWithTimeout(`${ep}/manifest.json`),
      _fetchWithTimeout(`${ep}/spot/latest.json`),
      _fetchWithTimeout(`${ep}/goldback/latest.json`),
    ]);
  };

  const endpointRaws = await Promise.all(v2Endpoints.map(_fetchV2FromEndpoint));
  const parsed = endpointRaws.map(([m, s, g]) => _parseV2EndpointHealth(m, s, g));
  return { primary: parsed[0], backup: parsed[1] ?? null };
};

/**
 * Lenient spot accept-window in minutes, mirroring the data path's selection
 * gate (_checkSpotEnvelopeFreshness in api.js): max(stale_after × 6,
 * SPOT_MAX_PAYLOAD_AGE_MS). The badge must use the same window the fetch path
 * uses to pick an endpoint — not the strict display threshold — so it never
 * reports an endpoint the renderer would have skipped (STRK-331).
 * @param {{staleAfterMin: number|null}} spot - Parsed spot health for one endpoint
 * @returns {number} Accept window in minutes
 */
const _spotLenientGateMin = (spot) => {
  const floorMin =
    typeof SPOT_MAX_PAYLOAD_AGE_MS === "number" ? Math.ceil(SPOT_MAX_PAYLOAD_AGE_MS / 60000) : 120;
  return Math.max((spot.staleAfterMin ?? API_HEALTH_SPOT_STALE_MIN) * 6, floorMin);
};

/**
 * Selects the spot health entry for the endpoint the data path is serving.
 * Mirrors _staktrakrFetch + the lenient spot gate: first endpoint whose payload
 * fetched successfully AND passes max(stale_after × 6, 2h). Falls back to
 * primary when neither qualifies so error states stay attributed to api1.
 * @param {object} primary - Parsed primary-endpoint health
 * @param {object|null} backup - Parsed backup-endpoint health
 * @returns {object} The serving endpoint's spot feed health
 */
const _servingSpot = (primary, backup) => {
  const passes = (s) => s && !s.error && s.ageMin !== null && s.ageMin <= _spotLenientGateMin(s);
  if (passes(primary.spot) || !backup || !passes(backup.spot)) return primary.spot;
  return backup.spot;
};

/**
 * Selects the market health entry for the endpoint the data path is serving.
 * Mirrors the strict regime the retail price fetches use for endpoint selection
 * (_strictMarketFreshness in market-data.js: reject when older than the
 * envelope's own stale_after) — those per-slug fetches are what deliver the
 * market prices on screen, so the badge follows their failover rule.
 * Falls back to primary when neither endpoint qualifies so genuinely-stale
 * states stay attributed to api1 and render its age honestly.
 * @param {object} primary - Parsed primary-endpoint health
 * @param {object|null} backup - Parsed backup-endpoint health
 * @returns {object} The serving endpoint's market feed health
 */
const _servingMarket = (primary, backup) => {
  const passes = (m) => m && !m.error && m.ok;
  if (passes(primary.market) || !backup || !passes(backup.market)) return primary.market;
  return backup.market;
};

/**
 * Updates both health badge elements with a compact per-feed summary.
 * Two independent signals (STRK-331):
 *   - time + color describe the DATA ON SCREEN — age of whichever endpoint the
 *     fetch path is actually serving (green fresh / orange stale);
 *   - the leading icon describes the INFRASTRUCTURE — ✅ all endpoints healthy,
 *     ⚠️ any endpoint stale or unreachable (details live in the health modal).
 * Goldback is informational and excluded from both signals.
 * @param {{primary: object, backup: object|null}} health
 */
const updateHealthBadges = ({ primary, backup }) => {
  const market = _servingMarket(primary, backup);
  const spot = _servingSpot(primary, backup);
  const dataOk = market.ok && spot.ok;

  const primaryOk = primary.market.ok && primary.spot.ok;
  const backupOk = !backup || (backup.market.ok && backup.spot.ok);
  const icon = primaryOk && backupOk ? "✅" : "⚠️";

  const marketPart = market.error ? "Market ❌" : `Market ${market.ago ?? "?"}`;
  const spotPart = spot.error ? "Spot ❌" : `Spot ${spot.ago ?? "?"}`;

  const label = `${icon} ${marketPart} · ${spotPart}`;
  // Footer badge uses shield-badge structure (label + value spans)
  const footerVal = safeGetElement("apiHealthValue");
  if (footerVal) {
    footerVal.textContent = label;
    footerVal.className =
      "shield-badge-value " + (dataOk ? "shield-badge-value--green" : "shield-badge-value--orange");
  }
  // About tab badge uses legacy single-element structure
  const aboutBadge = safeGetElement("apiHealthBadgeAbout");
  if (aboutBadge) aboutBadge.textContent = label;
};

/**
 * Fills a single feed cell (market or spot) with status text.
 * @param {string} id - Element ID
 * @param {{ok: boolean, ago: string|null, error: string|null}} feed
 * @param {number} staleMin - Stale threshold in minutes (for warning label)
 */
const _setFeedCell = (id, feed, staleMin) => {
  const el = safeGetElement(id);
  if (!el) return;
  if (!feed) {
    el.textContent = "—";
    return;
  }
  el.textContent = feed.error
    ? `❌ ${feed.error}`
    : feed.ok
      ? `✅ ${feed.ago}`
      : `⚠️ ${feed.ago} — stale (>${staleMin}m)`;
};

/**
 * Fills a goldback cell (no stale-minute label — daily cadence).
 * @param {string} id - Element ID
 * @param {{ok: boolean, ago: string|null, error: string|null}|null} gb
 */
const _setGoldbackCell = (id, gb) => {
  const el = safeGetElement(id);
  if (!el) return;
  if (!gb) {
    el.textContent = "—";
    return;
  }
  el.textContent = gb.error
    ? `❌ ${gb.error}`
    : gb.ok
      ? `✅ ${gb.ago}`
      : `⚠️ ${gb.ago} — missed scrape?`;
};

/**
 * Populates the health detail modal table with per-endpoint data.
 * Shows primary and backup columns for drift benchmarking.
 * @param {{primary: object, backup: object|null}} health
 */
const populateApiHealthModal = ({ primary, backup }) => {
  const { market, spot, goldback } = primary;
  const primaryOk = market.ok && spot.ok;
  const backupOk = backup && backup.market.ok && backup.spot.ok;

  const statusEl = safeGetElement("apiHealthStatus");
  const coinsEl = safeGetElement("apiHealthCoins");
  const verdictEl = safeGetElement("apiHealthVerdict");

  if (statusEl) {
    statusEl.textContent = primaryOk
      ? "✅ Healthy"
      : backupOk
        ? "⚠️ Primary degraded — backup serving"
        : "⚠️ Check feeds";
  }

  // Primary column
  _setFeedCell("apiHealthMarket", market, API_HEALTH_MARKET_STALE_MIN);
  _setFeedCell("apiHealthSpot", spot, API_HEALTH_SPOT_STALE_MIN);
  _setGoldbackCell("apiHealthGoldback", goldback);

  // Backup column
  if (backup) {
    _setFeedCell("apiHealthMarket2", backup.market, API_HEALTH_MARKET_STALE_MIN);
    _setFeedCell("apiHealthSpot2", backup.spot, API_HEALTH_SPOT_STALE_MIN);
    _setGoldbackCell("apiHealthGoldback2", backup.goldback);
  } else {
    ["apiHealthMarket2", "apiHealthSpot2", "apiHealthGoldback2"].forEach((id) => {
      const el = safeGetElement(id);
      if (el) el.textContent = "—";
    });
  }

  if (coinsEl) {
    coinsEl.textContent = market.coins.length ? `${market.coins.length} items tracked` : "—";
  }

  if (verdictEl) {
    if (primaryOk && backupOk) {
      // Both healthy — compute drift
      const driftParts = [];
      if (market.ageMin !== null && backup.market.ageMin !== null) {
        const d = backup.market.ageMin - market.ageMin;
        if (Math.abs(d) >= 1)
          driftParts.push(`market ${Math.abs(d)}m ${d > 0 ? "behind" : "ahead"}`);
      }
      if (spot.ageMin !== null && backup.spot.ageMin !== null) {
        const d = backup.spot.ageMin - spot.ageMin;
        if (Math.abs(d) >= 1) driftParts.push(`spot ${Math.abs(d)}m ${d > 0 ? "behind" : "ahead"}`);
      }
      verdictEl.textContent = driftParts.length
        ? `Both healthy. api2 ${driftParts.join(", ")}.`
        : "Both endpoints healthy and in sync.";
    } else if (!primaryOk && backupOk) {
      verdictEl.textContent = "Primary degraded — backup is currently serving data.";
    } else if (market.error || spot.error) {
      verdictEl.textContent = "One or more feeds unreachable — check Fly.io dashboard.";
    } else if (!market.ok && !spot.ok) {
      verdictEl.textContent = "Both market and spot feeds are stale — poller may be down.";
    } else if (!market.ok) {
      verdictEl.textContent = `Market feed is stale (>${API_HEALTH_MARKET_STALE_MIN} min). Spot prices are current.`;
    } else if (!spot.ok) {
      verdictEl.textContent = `Spot feed is stale (>${API_HEALTH_SPOT_STALE_MIN} min). Market prices are current.`;
    } else {
      verdictEl.textContent = "All feeds are current. Poller is healthy.";
    }
  }
};

/**
 * Populates the health detail modal with an error state.
 * @param {Error} err
 */
const populateApiHealthModalError = (err) => {
  const statusEl = safeGetElement("apiHealthStatus");
  const verdictEl = safeGetElement("apiHealthVerdict");
  if (statusEl) statusEl.textContent = "❌ Unreachable";
  if (verdictEl) verdictEl.textContent = `Could not reach API: ${err.message}`;
  [
    "apiHealthMarket",
    "apiHealthSpot",
    "apiHealthGoldback",
    "apiHealthCoins",
    "apiHealthMarket2",
    "apiHealthSpot2",
    "apiHealthGoldback2",
  ].forEach((id) => {
    const el = safeGetElement(id);
    if (el) el.textContent = "—";
  });
  // Footer badge: update value span only (preserve label/value structure)
  const errVal = safeGetElement("apiHealthValue");
  if (errVal) {
    errVal.textContent = "API ?";
    errVal.className = "shield-badge-value shield-badge-value--red";
  }
  // About tab badge: legacy single-element structure
  const aboutErr = safeGetElement("apiHealthBadgeAbout");
  if (aboutErr) aboutErr.textContent = "\u274c API ?";
};

// Cached result so the modal reflects the same data as the badge
let _lastHealth = null;

/**
 * Sets modal fields to a loading/checking placeholder state.
 */
const _setModalLoading = () => {
  const statusEl = safeGetElement("apiHealthStatus");
  const verdictEl = safeGetElement("apiHealthVerdict");
  if (statusEl) statusEl.textContent = "⏳ Checking…";
  if (verdictEl) verdictEl.textContent = "Fetching status…";
};

/**
 * Opens the API health modal, populating it if data already loaded.
 */
const showApiHealthModal = () => {
  if (_lastHealth) {
    populateApiHealthModal(_lastHealth);
  } else {
    _setModalLoading();
  }
  if (window.openModalById) window.openModalById("apiHealthModal");
};

/**
 * Hides the API health modal.
 */
const hideApiHealthModal = () => {
  if (window.closeModalById) window.closeModalById("apiHealthModal");
};

// Guard to ensure the keydown listener is registered only once
let _keydownRegistered = false;

/**
 * Sets up event listeners for the health modal.
 * Uses document.getElementById directly — safeGetElement lives in init.js
 * which loads after this file in the defer queue.
 */
const setupApiHealthModalEvents = () => {
  const closeBtn = document.getElementById("apiHealthCloseBtn");
  const modal = document.getElementById("apiHealthModal");
  if (closeBtn) closeBtn.addEventListener("click", hideApiHealthModal);
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) hideApiHealthModal();
    });
  }
  if (!_keydownRegistered) {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideApiHealthModal();
    });
    _keydownRegistered = true;
  }
};

/**
 * Main entry point — fetches health data and wires up the UI.
 * If the modal is already open when the fetch resolves (user opened it while
 * data was in-flight), populate it immediately rather than leaving it on
 * the "Checking…" placeholder.
 */
const initApiHealth = async () => {
  setupApiHealthModalEvents();
  try {
    const health = await fetchApiHealth();
    _lastHealth = health;
    if (typeof window !== "undefined") window._lastApiHealth = health; // STAK-443: expose for settings renderers
    updateHealthBadges(health);
    // If the modal is open, push the result in now rather than leaving placeholder text.
    // Use getElementById directly — safeGetElement returns a dummy whose style.display
    // is always undefined (never "none"), which would make this guard always true.
    const modal = document.getElementById("apiHealthModal");
    if (modal && modal.style.display !== "none") {
      populateApiHealthModal(health);
    }
  } catch (err) {
    console.warn("API health check failed:", err);
    _lastHealth = null; // clear stale data so modal shows error state, not old green result
    if (typeof window !== "undefined") window._lastApiHealth = null; // STAK-443
    populateApiHealthModalError(err);
  }
};

// Expose globally for other modules and onclick handlers
if (typeof window !== "undefined") {
  window.showApiHealthModal = showApiHealthModal;
  window.hideApiHealthModal = hideApiHealthModal;
  window.initApiHealth = initApiHealth;
  // STRK-331 selection helpers — exposed for the no-bundler test runtime
  window._spotLenientGateMin = _spotLenientGateMin;
  window._servingSpot = _servingSpot;
  window._servingMarket = _servingMarket;
}

// initApiHealth() is called by init.js after safeGetElement and all DOM setup
// are complete. Do NOT auto-init here — init.js (script #64) runs after this
// file (script #56) in the defer queue, so safeGetElement is not yet defined.

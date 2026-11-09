// js/market-data.js — Market Data Module (STAK-504)
// Orchestrates the best price ticker, vendor prices section, and market detail modal.

let _marketDataInitialized = false;
const V2_API = "https://api.staktrakr.com/data/v2";
const MARKET_DETAIL_HOUR_MS = 60 * 60 * 1000;
const MARKET_DETAIL_DAY_MS = 24 * MARKET_DETAIL_HOUR_MS;
const MARKET_DETAIL_PERIODS = Object.freeze([
  Object.freeze({
    id: "24h",
    label: "24H",
    durationMs: MARKET_DETAIL_DAY_MS,
    source: "intraday",
    intraday: true,
  }),
  Object.freeze({
    id: "7d",
    label: "7D",
    durationMs: 7 * MARKET_DETAIL_DAY_MS,
    source: "history30d",
    intraday: false,
  }),
  Object.freeze({
    id: "30d",
    label: "30D",
    durationMs: 30 * MARKET_DETAIL_DAY_MS,
    source: "history30d",
    intraday: false,
  }),
  Object.freeze({
    id: "60d",
    label: "60D",
    durationMs: 60 * MARKET_DETAIL_DAY_MS,
    source: "history90d",
    intraday: false,
  }),
  Object.freeze({
    id: "90d",
    label: "90D",
    durationMs: 90 * MARKET_DETAIL_DAY_MS,
    source: "history90d",
    intraday: false,
  }),
]);
const MARKET_DETAIL_DEFAULT_PERIOD_ID = "7d";

// STRK-188: ordered endpoint failover (api1 → api2), mirroring the spot and
// goldback fetch paths. _staktrakrFetch is defined in api.js, which executes
// after this file (both deferred) — it exists by the time any market fetch
// runs, and the typeof guard degrades to the primary endpoint only if not.
/**
 * Fetch a market-data JSON path with ordered api1→api2 endpoint failover.
 * @param {string} path - Path appended to each V2 endpoint base.
 * @param {Object} [options]
 * @param {function(any): {ok: boolean, reason?: string}} [options.validate] -
 *   Payload validator forwarded to _staktrakrFetch (STRK-249/STRK-189); a falsy
 *   verdict rejects the endpoint's payload and advances to the next endpoint.
 *   Existing callers pass none, so failover behavior is unchanged for them.
 * @returns {Promise<any>} Parsed JSON from the first successful endpoint.
 */
const _marketV2Fetch = async (path, { validate } = {}) => {
  const endpoints =
    typeof V2_API_ENDPOINTS !== "undefined" &&
    Array.isArray(V2_API_ENDPOINTS) &&
    V2_API_ENDPOINTS.length
      ? V2_API_ENDPOINTS
      : [V2_API];
  if (typeof _staktrakrFetch === "function") {
    return _staktrakrFetch(endpoints, path, { validate });
  }
  // Fallback if api.js hasn't executed: same ordered failover with plain fetch.
  let lastErr;
  for (const base of endpoints) {
    try {
      const resp = await fetch(base + path, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return await resp.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("All market endpoints failed");
};

// STRK-249 (C.5): strict freshness gate for the goldback-G1 and retail-detail
// fetches. Built on api.js's shared _checkEnvelopeFreshness with the strict regime
// (multiplier:1, floorMs:0) — reject by the endpoint's OWN stale_after with no slack,
// so a stale-but-200 api1 SW/CDN payload is rejected and _staktrakrFetch advances to
// api2 instead of short-circuiting (C-8). Guarded two ways for robustness:
//   - load order: api.js executes after this file (both deferred); the gate runs only
//     at fetch RUNTIME, but if _checkEnvelopeFreshness is somehow absent we pass through.
//   - no declared budget: an envelope without a positive stale_after declares no
//     staleness constraint, so it is accepted (mirrors the legacy unparseable-
//     generated_at short-circuit). Production goldback/retail envelopes always carry a
//     positive stale_after, so a genuinely stale SW copy is still rejected.
// STRK-249 (review finding #1): the goldback envelope carries stale_after = 90000s
// (~25h) — the very SW floor STRK-249 exists to escape (US-3). Cap the strict realtime
// budget at SPOT_MAX_PAYLOAD_AGE_MS (~2h) so goldback's 25h collapses to 2h: a >2h
// stale api1 200 is rejected → failover to api2. Retail's stale_after = 1800s (30min)
// stays min(30min, 2h) = 30min (unchanged). A fresh goldback copy (≤~1h) still passes.
/**
 * Strict v2-envelope freshness verdict for _marketV2Fetch's `validate` gate.
 * Caps the accept budget at SPOT_MAX_PAYLOAD_AGE_MS (the realtime payload-age
 * ceiling) so a high-stale_after endpoint (goldback ≈ 25h) cannot keep a
 * stale-but-200 SW/CDN copy alive past the realtime ceiling (review finding #1).
 * @param {any} envelope - Parsed v2 envelope ({ generated_at, stale_after, data }).
 * @returns {{ok: boolean, reason?: string}} Verdict for the _staktrakrFetch validator.
 */
const _strictMarketFreshness = (envelope) => {
  if (typeof _checkEnvelopeFreshness !== "function") return { ok: true };
  if (!envelope || typeof envelope.stale_after !== "number" || envelope.stale_after <= 0) {
    return { ok: true };
  }
  return _checkEnvelopeFreshness(envelope, {
    multiplier: 1,
    floorMs: 0,
    maxAgeCapMs: SPOT_MAX_PAYLOAD_AGE_MS,
  });
};

const _METAL_TO_ISO = { silver: "xag", gold: "xau", platinum: "xpt", palladium: "xpd" };
const _ISO_TO_METAL = { xag: "silver", xau: "gold", xpt: "platinum", xpd: "palladium" };

const _isSafeUrl = (url) => typeof url === "string" && /^https?:\/\//i.test(url);

// Shared premium helpers — used across ticker, Matrix, and detail modal (AC-4)
const _calcMarketPremium = (price, referenceRate) => {
  if (!referenceRate || referenceRate <= 0 || !price || price <= 0) return null;
  return ((price - referenceRate) / referenceRate) * 100;
};
const _premiumTierClass = (pct) => {
  if (pct == null || !Number.isFinite(pct)) return "low";
  if (pct >= 5) return "high";
  if (pct >= 2) return "mid";
  return "low";
};

/** Percent from the dealer median at which a Market premium turns low or high. */
const MARKET_PREMIUM_BAND_PCT = 1;

/**
 * Tiers each dealer price against the median of the in-stock, non-carried prices.
 * A carried price, or any price when fewer than two dealers are in stock, is "plain".
 * @param {Array<{id:string, price:number, inStock:boolean, carried:boolean}>} entries - Dealer prices.
 * @returns {{median:(number|null), liveCount:number, byId:Object}} Tier and distance per ranked id.
 */
const _rankDealerPrices = (entries) => {
  // A legacy snapshot can hold numeric-string prices; only finite numbers rank.
  const priced = entries
    .filter((e) => e && e.inStock)
    .map((e) => ({ ...e, price: Number(e.price) }))
    .filter((e) => Number.isFinite(e.price) && e.price > 0);
  const live = priced
    .filter((e) => !e.carried)
    .map((e) => e.price)
    .sort((a, b) => a - b);
  const mid = Math.floor(live.length / 2);
  let median = null;
  if (live.length > 0) median = live.length % 2 ? live[mid] : (live[mid - 1] + live[mid]) / 2;
  const byId = Object.create(null);
  for (const e of priced) {
    if (e.carried || live.length < 2) {
      byId[e.id] = { tier: "plain", distancePct: null, only: !e.carried };
      continue;
    }
    const distancePct = ((e.price - median) / median) * 100;
    let tier = "mid";
    if (distancePct <= -MARKET_PREMIUM_BAND_PCT) tier = "low";
    else if (distancePct >= MARKET_PREMIUM_BAND_PCT) tier = "high";
    byId[e.id] = { tier, distancePct, only: false };
  }
  return { median, liveCount: live.length, byId };
};

/**
 * Whether a dealer entry is in stock under either feed flag.
 * @param {(Object|null|undefined)} entry - Dealer entry carrying in_stock or inStock.
 * @returns {boolean} True only when a flag is strictly true.
 */
const _isVendorInStock = (entry) =>
  Boolean(entry && (entry.in_stock === true || entry.inStock === true));

/**
 * Ranks one item's dealer prices, skipping dealers the Market filter hides.
 * @param {Object} vData - Per-vendor data map for one item.
 * @param {string} slug - Retail coin slug (for the market-filter check).
 * @returns {{median:(number|null), liveCount:number, byId:Object}} See _rankDealerPrices.
 */
const _rankVendorData = (vData, slug) => {
  const entries = [];
  for (const vid in vData || {}) {
    if (typeof _isMarketItemEnabled === "function" && !_isMarketItemEnabled(slug, vid)) continue;
    const v = vData[vid];
    if (!v) continue;
    entries.push({
      id: vid,
      price: v.price,
      inStock: _isVendorInStock(v),
      carried: Boolean(v.carried),
    });
  }
  return _rankDealerPrices(entries);
};

/**
 * Names a ranked price's distance from the dealer median for an accessible name.
 * @param {(Object|undefined)} ranked - One byId entry from _rankDealerPrices.
 * @returns {string} A leading-comma phrase, or "" when the price has no distance.
 */
const _medianDistancePhrase = (ranked) => {
  if (!ranked) return "";
  if (ranked.distancePct == null) return ranked.only ? ", the only dealer in stock" : "";
  const size = Math.abs(ranked.distancePct);
  if (size < 0.05) return ", at the dealer median";
  return `, ${size.toFixed(1)}% ${ranked.distancePct < 0 ? "below" : "above"} the dealer median`;
};

/** Short words for the premium tiers, so the comparison does not rest on color alone. */
const _TIER_WORDS = { low: "Low", mid: "Mid", high: "High" };

/**
 * Builds a premium badge: the premium text, plus a tier word when the price is ranked.
 * @param {string} text - Premium text such as "+1.4%".
 * @param {(Object|undefined)} ranked - One byId entry from _rankDealerPrices.
 * @returns {HTMLSpanElement} The badge element.
 */
const _buildPremiumBadge = (text, ranked) => {
  const tier = (ranked && ranked.tier) || "plain";
  const badge = document.createElement("span");
  badge.className = "vp-premium " + tier;
  badge.textContent = text;
  if (_TIER_WORDS[tier]) {
    const word = document.createElement("span");
    word.className = "vp-tier-word";
    word.textContent = _TIER_WORDS[tier];
    badge.append(" ", word);
  }
  return badge;
};

/**
 * Formats a UTC feed timestamp as the en-CA date and time every Market label uses.
 * Follows the Settings timezone; "auto" or an unknown zone falls back to the browser zone.
 * @param {string} iso - ISO timestamp from a feed or sync record.
 * @returns {(string|null)} "YYYY-MM-DD, hh:mm" text, or null when missing or unparseable.
 */
const _formatMarketTimestamp = (iso) => {
  const when = iso ? new Date(iso) : null;
  if (!when || Number.isNaN(when.getTime())) return null;
  const options = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  };
  let zone = null;
  try {
    zone = typeof TIMEZONE_KEY !== "undefined" ? localStorage.getItem(TIMEZONE_KEY) : null;
  } catch (e) {
    zone = null;
  }
  if (zone && zone !== "auto") {
    try {
      return when.toLocaleString("en-CA", { ...options, timeZone: zone });
    } catch (err) {
      if (!(err instanceof RangeError)) throw err;
    }
  }
  return when.toLocaleString("en-CA", options);
};

/**
 * Tooltip text for a dealer price, from the time a scrape last saw it.
 * @param {string} seenAt - ISO timestamp: carried_from for a carried price, else the price window.
 * @returns {(string|null)} "Last seen YYYY-MM-DD, hh:mm" text, or null.
 */
const _lastSeenTitle = (seenAt) => {
  const local = _formatMarketTimestamp(seenAt);
  return local ? `Last seen ${local}` : null;
};

/**
 * Returns the value when it parses as a timestamp.
 * @param {*} value - Candidate ISO timestamp.
 * @returns {(string|null)} The value, or null when missing or unparseable.
 */
const _validTimestamp = (value) => {
  return value && !Number.isNaN(new Date(value).getTime()) ? value : null;
};

/**
 * The price window of the retail snapshot: the first source, in memory then storage,
 * that names a valid window_start. A source without one does not hide the next.
 * @returns {(string|null)} ISO timestamp, or null when no snapshot names one.
 */
const _snapshotWindowTime = () => {
  const sources = [
    () => (typeof window._v2RetailData !== "undefined" ? window._v2RetailData : null),
    () => loadDataSync("v2RetailPrices", null),
    () => loadDataSync("retailPrices", null),
  ];
  for (const read of sources) {
    const snapshot = read();
    const windowStart = _validTimestamp(snapshot && snapshot.window_start);
    if (windowStart) return windowStart;
  }
  return null;
};

/**
 * The price window a coin's fresh prices come from: the detail's own window,
 * else the fallback.
 * @param {Object} detail - Retail detail for one coin.
 * @param {(string|null)} fallback - Window to use when the detail names none.
 * @returns {(string|null)} ISO timestamp, or null when no source names one.
 */
const _detailWindowTime = (detail, fallback) => {
  // v2 feeds name the price window `t`; window_start is the v1 name.
  return (
    _validTimestamp(detail && detail.t) ||
    _validTimestamp(detail && detail.window_start) ||
    fallback ||
    null
  );
};

/**
 * Open a vendor URL in a standardized detached popup window. Mirrors the
 * window name and feature string used by the ticker, vendor matrix, and detail
 * modal so all three open identical popups. Caller validates url via _isSafeUrl.
 * @param {string} url - The vendor URL to open.
 * @param {string} vid - Vendor id, used to name the popup window.
 * @returns {void}
 */
const _openVendorPopup = (url, vid) => {
  const popup = window.open(
    url,
    "retail_vendor_" + vid,
    "width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no"
  );
  if (popup) popup.opener = null;
};

/**
 * Resolve a vendor's buy URL: prefer the live retailProviders map, then an
 * optional per-entry URL, then the vendor-meta URL. Shared by the ticker,
 * detail modal, and vendor matrix.
 * @param {string} slug - Retail coin slug.
 * @param {string} vid - Vendor id.
 * @param {Object} vendorMeta - Vendor-meta map (url fallback by vendor id).
 * @param {(string|null)} [entryUrl=null] - Optional per-entry URL fallback (detail modal).
 * @returns {(string|null)} The resolved URL, or null.
 */
const _resolveVendorUrl = (slug, vid, vendorMeta, entryUrl = null) => {
  return (
    (window.retailProviders && window.retailProviders[slug] && window.retailProviders[slug][vid]) ||
    entryUrl ||
    (vendorMeta && vendorMeta[vid] && vendorMeta[vid].url) ||
    null
  );
};

/**
 * Resolve coin metadata for a slug, preferring the cached manifest map over the
 * live global lookup. Used by the ticker and detail modal (which favor the map);
 * the vendor matrix uses _getRetailCoinMetaForSlug, which prefers the live lookup.
 * @param {string} slug - Retail coin slug.
 * @param {Object|null} coinMetaMap - Manifest coin-meta map (may be null).
 * @returns {{name:string, weight:number, metal:string}} Resolved coin meta.
 */
const _resolveCoinMetaPreferMap = (slug, coinMetaMap) => {
  if (coinMetaMap && coinMetaMap[slug]) return coinMetaMap[slug];
  if (typeof window.getRetailCoinMeta === "function") return window.getRetailCoinMeta(slug);
  return { name: slug, weight: 0, metal: "unknown" };
};

let _cachedSlugDetail = {};
let _cachedSlugDetailGeneration = 0;
let _vendorTableRenderSeq = 0;
let _goldbackG1Rate = null;

/**
 * Empties the per-slug detail cache after a sync stores new prices. The generation
 * bump stops a fetch that started before the sync from refilling the cache, and the
 * render bump stops a table render that started before the sync from drawing.
 * @returns {void}
 */
const _clearCachedSlugDetail = () => {
  _cachedSlugDetail = {};
  _cachedSlugDetailGeneration += 1;
  _vendorTableRenderSeq += 1;
};

const _fmtPrice = (n) => {
  if (n == null || isNaN(n)) return "\u2014";
  return n >= 100
    ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toFixed(2);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _getSpotPrice = (metalCode) => {
  const englishKey = _ISO_TO_METAL[metalCode] || metalCode;
  if (typeof spotPrices !== "undefined" && spotPrices && spotPrices[englishKey] != null) {
    return spotPrices[englishKey];
  }
  const capMetal = englishKey.charAt(0).toUpperCase() + englishKey.slice(1);
  const displayEl = safeGetElement("spotPriceDisplay" + capMetal);
  if (displayEl) {
    const parsed = parseFloat(displayEl.textContent.replace(/[^0-9.]/g, ""));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return null;
};

const _getRetailCoins = () => {
  // Check window cache first
  if (
    typeof window._v2RetailData !== "undefined" &&
    window._v2RetailData &&
    window._v2RetailData.prices
  ) {
    return window._v2RetailData.prices;
  }
  // Check v2-specific key
  const v2Cache = loadDataSync("v2RetailPrices", null);
  if (v2Cache && typeof v2Cache === "object" && v2Cache.prices) return v2Cache.prices;
  // Check primary retail key (RETAIL_PRICES_KEY = "retailPrices")
  const retailCache = loadDataSync("retailPrices", null);
  if (retailCache && typeof retailCache === "object" && retailCache.prices)
    return retailCache.prices;
  return {};
};

const _getCoinMeta = () => {
  if (typeof window._manifestCoinMeta !== "undefined" && window._manifestCoinMeta)
    return window._manifestCoinMeta;
  if (typeof window.getRetailCoinMeta === "function") return null;
  return loadDataSync("retailManifestCoinMeta", {});
};

const _getVendorMeta = () => {
  if (
    typeof window._manifestVendorMeta !== "undefined" &&
    window._manifestVendorMeta &&
    Object.keys(window._manifestVendorMeta).length > 0
  )
    return window._manifestVendorMeta;
  const cached = loadDataSync("retailManifestVendorMeta", null);
  if (cached && Object.keys(cached).length > 0) return cached;
  return {};
};

const _getRetailCoinMetaForSlug = (slug, coinMetaMap) => {
  if (typeof window.getRetailCoinMeta === "function") return window.getRetailCoinMeta(slug);
  if (coinMetaMap && coinMetaMap[slug]) return coinMetaMap[slug];
  return { name: slug, weight: 0, metal: "unknown" };
};

// Fetch v2 manifest for coin + vendor metadata if not already cached
const _ensureManifest = async () => {
  const coinMeta = _getCoinMeta();
  const vendorMeta = _getVendorMeta();
  // Always re-fetch if either is missing; also re-fetch if we have fewer coins than expected (stale cache)
  const hasSufficientMeta =
    coinMeta &&
    Object.keys(coinMeta).length >= 20 &&
    vendorMeta &&
    Object.keys(vendorMeta).length >= 5;
  if (hasSufficientMeta) return;
  try {
    const json = await _marketV2Fetch("/manifest.json");
    const data = json.data || json;
    if (data.coins && Array.isArray(data.coins)) {
      const cm = {};
      for (const c of data.coins) {
        cm[c.slug] = {
          name: c.name,
          metal:
            c.metal === "xag"
              ? "silver"
              : c.metal === "xau"
                ? "gold"
                : c.metal === "xpt"
                  ? "platinum"
                  : c.metal === "xpd"
                    ? "palladium"
                    : c.metal,
          weight: c.weight_oz || 0,
        };
      }
      window._manifestCoinMeta = cm;
      try {
        saveDataSync("retailManifestCoinMeta", cm);
      } catch (e) {
        /* quota */
      }
    }
    if (data.vendors && Array.isArray(data.vendors)) {
      const vm = {};
      for (const v of data.vendors) {
        vm[v.id] = { name: v.name, color: v.color, url: v.url || null };
      }
      window._manifestVendorMeta = vm;
      try {
        saveDataSync("retailManifestVendorMeta", vm);
      } catch (e) {
        /* quota */
      }
    }
    debugLog(
      "[market-data] Fetched v2 manifest: " +
        (data.coins ? data.coins.length : 0) +
        " coins, " +
        (data.vendors ? data.vendors.length : 0) +
        " vendors",
      "info"
    );
  } catch (e) {
    debugLog("[market-data] Manifest fetch failed: " + e.message, "warn");
  }
};

// ---------------------------------------------------------------------------
// Ticker
// ---------------------------------------------------------------------------

const TICKER_SPEED_PIXELS_PER_SECOND = 95;
const MIN_TICKER_DURATION_SECONDS = 20;
const RETAIL_CURRENCY_DISCLAIMER =
  "Currency conversion is for convenience only — vendors are US-based and may not accept your selected currency at checkout.";

const _getDisplayCurrency = () =>
  typeof displayCurrency !== "undefined" && displayCurrency ? displayCurrency : "USD";

const _getRetailCurrencyDisclaimer = () =>
  _getDisplayCurrency() !== "USD" ? RETAIL_CURRENCY_DISCLAIMER : "";

const _buildTickerSignature = (items) => {
  const currency = _getDisplayCurrency();
  return [
    currency,
    items
      .map((item) =>
        [
          item.slug,
          item.bestVid,
          typeof formatCurrency === "function"
            ? formatCurrency(item.bestPrice || 0, currency)
            : Number(item.bestPrice || 0).toFixed(2),
          Number.isFinite(item.premium) ? item.premium.toFixed(3) : "",
        ].join("|")
      )
      .join("||"),
  ].join("::");
};

const _getTickerLoopPhase = (track) => {
  if (!track || track.classList.contains("static")) return 0;

  const loopWidth = Number(track.dataset.loopWidth || 0);
  if (!(loopWidth > 0)) return 0;

  const transform = window.getComputedStyle(track).transform;
  if (!transform || transform === "none") return 0;

  const MatrixCtor = window.DOMMatrixReadOnly || window.WebKitCSSMatrix;
  if (!MatrixCtor) return 0;

  try {
    const matrix = new MatrixCtor(transform);
    const translateX = typeof matrix.m41 === "number" ? matrix.m41 : 0;
    const distance = ((-translateX % loopWidth) + loopWidth) % loopWidth;
    return distance / loopWidth;
  } catch (error) {
    debugLog("[market-data] Unable to read ticker transform: " + error.message, "debug");
    return 0;
  }
};

/**
 * Measure the primary block and apply (or clear) the loop animation variables.
 *
 * Split out of _finalizeTickerTrack (STRK-327) so the tab-reveal repair path can
 * re-measure without also inheriting that function's stale-render sweep, which
 * deletes any track whose signature no longer matches the container.
 *
 * A zero measurement is not always a failure — it is also what a legitimately
 * empty block reports — so this stays a pure "size it from what you can see"
 * helper. Deciding whether a zero is worth acting on belongs to the caller.
 *
 * @param {HTMLElement} track - The track to size.
 * @param {HTMLElement} primaryBlock - The primary content block, for loop width.
 * @param {number} phase - Prior loop phase (0..1) for animation continuity.
 * @returns {number} Measured loop width in pixels, or 0 when unmeasurable.
 */
const _applyTickerLoopSizing = (track, primaryBlock, phase = 0) => {
  const loopWidth = Math.ceil(primaryBlock.getBoundingClientRect().width);

  if (!(loopWidth > 0)) {
    track.classList.add("static");
    track.dataset.loopWidth = "0";
    track.style.removeProperty("--ticker-loop-distance");
    track.style.removeProperty("--ticker-duration");
    track.style.removeProperty("animation-delay");
    return 0;
  }

  const durationSeconds = Math.max(
    MIN_TICKER_DURATION_SECONDS,
    loopWidth / TICKER_SPEED_PIXELS_PER_SECOND
  );
  // Dropping `static` is what actually makes the STRK-327 repair visible: the
  // class carries `animation: none`, so restoring the custom properties alone
  // would leave the track frozen with the STRK-317 scrollbar still showing.
  track.classList.remove("static");
  track.dataset.loopWidth = String(loopWidth);
  track.style.setProperty("--ticker-loop-distance", `${loopWidth}px`);
  track.style.setProperty("--ticker-duration", `${durationSeconds.toFixed(3)}s`);
  track.style.animationDelay = phase > 0 ? `-${(phase * durationSeconds).toFixed(3)}s` : "0s";
  return loopWidth;
};

/**
 * Size the ticker loop, apply animation timing, and sweep superseded tracks.
 *
 * Takes no `previousTrack`: the STAK-513 sweep below removes every
 * `.ticker-track` except this one, which necessarily includes the prior track,
 * so targeted removal is redundant here (STRK-275). The caller still needs its
 * own `previousTrack` for the static (<4 item) path and for positioning the
 * incoming track while the old one is still on screen.
 *
 * @param {HTMLElement} container - The ticker container element.
 * @param {HTMLElement} track - The track being finalised.
 * @param {HTMLElement} primaryBlock - The primary content block, for loop width.
 * @param {number} phase - Prior loop phase (0..1) for animation continuity.
 * @returns {void}
 */
const _finalizeTickerTrack = (container, track, primaryBlock, phase = 0) => {
  track.style.removeProperty("left");
  track.style.removeProperty("top");
  track.style.removeProperty("position");
  track.style.removeProperty("pointer-events");
  track.style.removeProperty("visibility");

  _applyTickerLoopSizing(track, primaryBlock, phase);

  // STAK-513: Guard against stale rAF callbacks — only the latest track sweeps.
  if (!container.contains(track) || track.dataset.signature !== container.dataset.tickerSignature) {
    if (track.parentNode === container) track.remove();
    return;
  }
  // Sweep ALL orphaned tracks so rapid re-renders can't accumulate rows.
  container.querySelectorAll(".ticker-track").forEach((t) => {
    if (t !== track) t.remove();
  });
};

/**
 * Re-measure the ticker loop after its tab panel becomes visible (STRK-327).
 *
 * A track built while #tabViewDashboard is hidden measures 0 and falls into the
 * static branch, so the ticker reveals frozen with a scrollbar. Nothing else
 * re-measures, so it stays that way until the next rebuild that happens to run
 * with Dashboard on screen. activateTab (js/tabs.js) calls this on reveal.
 *
 * Repair-only by construction: it returns on a zero measurement rather than
 * delegating, so it can only ever move a track from static to animated, never
 * the reverse. That matters because activateTab also fires when switching
 * *away* from Dashboard, where a perfectly healthy track measures 0 — and
 * because a switch can land between a track's append and its pending rAF
 * finalize, when the track is neither static nor yet sized.
 *
 * The discriminator for "safe to animate" is the duplicate block, not the
 * `static` class: that class is overloaded, marking both a genuinely short
 * track (<4 items, where STRK-317's centering and scrollbar are correct) and a
 * failed measurement. Only tracks built to loop carry a second block, and
 * animating a single-block track would expose a gap at the wrap point.
 *
 * @returns {void}
 */
const refreshTickerGeometry = () => {
  const container = safeGetElement("bestPriceTickerEl");
  // instanceof rather than a truthiness check: safeGetElement returns a truthy
  // dummy whose members silently no-op, so `if (!container)` would sail past it
  // and then querySelector against a shim.
  if (!(container instanceof HTMLElement)) return;

  const track = container.querySelector(".ticker-track");
  if (!track) return;

  // Already sized and running — skip before touching geometry. The early exit
  // is the point: getBoundingClientRect forces a synchronous layout, and
  // activateTab runs on every single tab switch.
  if (!track.classList.contains("static") && Number(track.dataset.loopWidth) > 0) return;

  const primaryBlock = track.querySelector('[data-ticker-block="primary"]');
  const duplicateBlock = track.querySelector('[data-ticker-block="duplicate"]');
  if (!primaryBlock || !duplicateBlock) return;

  // Still unmeasurable — the panel is hidden, so leave the track exactly as it
  // is and wait for a later reveal. Delegating here would let the shared sizing
  // helper apply `static`, which is the one thing this function must not do.
  if (!(primaryBlock.getBoundingClientRect().width > 0)) return;

  // Phase is 0 for the case being repaired (_getTickerLoopPhase returns 0 for a
  // static track), so this restarts the loop from the top rather than jumping.
  _applyTickerLoopSizing(track, primaryBlock, _getTickerLoopPhase(track));
};

/**
 * Find the cheapest in-stock vendor for a coin, preferring fresh v2 detail data
 * (from _cachedSlugDetail) over the summary price, and skipping filter-disabled
 * vendors and non-positive prices.
 * @param {Object} coin - Retail coin summary with a vendors map.
 * @param {string} slug - Retail coin slug (for the market-filter check).
 * @returns {{bestVid:(string|null), bestPrice:number}} Cheapest vendor id and price (Infinity if none).
 */
const _findCheapestTickerVendor = (coin, slug) => {
  let bestVid = null;
  let bestPrice = Infinity;
  for (const vid in coin.vendors) {
    const v = coin.vendors[vid];
    if (typeof _isMarketItemEnabled === "function" && !_isMarketItemEnabled(slug, vid)) continue;
    if (!v || v.price <= 0) continue;
    // Cross-reference with fresh v2 detail for accurate stock status
    const fresh =
      _cachedSlugDetail[slug] &&
      _cachedSlugDetail[slug].vendors &&
      _cachedSlugDetail[slug].vendors[vid];
    const price = fresh && fresh.price > 0 ? fresh.price : v.price;
    const inStock = fresh
      ? fresh.in_stock === true || fresh.inStock === true
      : v.in_stock === true || v.inStock === true;
    if (inStock && price < bestPrice) {
      bestPrice = price;
      bestVid = vid;
    }
  }
  return { bestVid, bestPrice };
};

/**
 * Build a single best-price ticker item descriptor for a coin, or null when no
 * in-stock vendor exists. Computes premium (spot or Goldback G1 reference) and
 * resolves the cheapest vendor's display name, color, and buy URL.
 * @param {string} slug - Retail coin slug.
 * @param {Object} coin - Retail coin summary with a vendors map.
 * @param {Object|null} coinMetaMap - Manifest coin-meta map.
 * @param {Object} vendorMeta - Vendor-meta map (name/color/url by vendor id).
 * @returns {Object|null} Ticker item descriptor, or null if no qualifying vendor.
 */
const _buildTickerItem = (slug, coin, coinMetaMap, vendorMeta) => {
  const meta = _resolveCoinMetaPreferMap(slug, coinMetaMap);
  const metalLower = (meta.metal || "").toLowerCase();

  const { bestVid, bestPrice } = _findCheapestTickerVendor(coin, slug);
  if (!bestVid || bestPrice === Infinity) return null;

  const weightOz = meta.weight || 0;
  const spot = _getSpotPrice(metalLower);
  let premium = null;
  if (spot && spot > 0 && weightOz > 0) {
    premium = _calcMarketPremium(bestPrice, spot * weightOz);
  } else if (metalLower === "goldback" && _goldbackG1Rate > 0) {
    premium = _calcMarketPremium(bestPrice, _goldbackG1Rate);
  }

  const vendorName = _shortVendor(bestVid);
  const vendorColor =
    typeof getRetailVendorColor === "function"
      ? getRetailVendorColor(bestVid)
      : "var(--text-muted)";
  const vendorUrl = _resolveVendorUrl(slug, bestVid, vendorMeta);

  return {
    slug,
    name: meta.name || slug,
    metal: metalLower,
    bestPrice,
    premium,
    vendorName,
    vendorColor,
    vendorUrl,
    bestVid,
  };
};

/**
 * Build the DOM element for one ticker item (metal dot, coin name, vendor,
 * price, premium badge). A safe vendor URL makes it a button that opens the dealer page.
 * @param {Object} item - Ticker item descriptor from _buildTickerItem.
 * @returns {HTMLElement} The ".ticker-item" element.
 */
const _buildTickerItemEl = (item) => {
  const isLink = _isSafeUrl(item.vendorUrl);
  const el = document.createElement(isLink ? "button" : "div");
  el.className = "ticker-item";
  if (isLink) {
    el.type = "button";
    el.classList.add("ticker-item--link");
    const premium =
      item.premium != null
        ? `, premium ${(item.premium >= 0 ? "+" : "") + item.premium.toFixed(1)}%`
        : "";
    el.setAttribute(
      "aria-label",
      `${item.name} at ${item.vendorName}, ${formatCurrency(item.bestPrice)}${premium}. Opens the dealer page in a new window.`
    );
    el.addEventListener("click", () => {
      _openVendorPopup(item.vendorUrl, item.bestVid);
    });
  }

  const dot = document.createElement("span");
  const isoCode = _METAL_TO_ISO[item.metal] || "";
  dot.className = "metal-dot" + (isoCode ? " " + isoCode : "");
  el.appendChild(dot);

  const coinSpan = document.createElement("span");
  coinSpan.className = "coin";
  // Full name, no cap (STRK-317) — the pill sizes to content and
  // _sizeTickerLoop derives animation duration from measured track width.
  coinSpan.textContent = item.name;
  el.appendChild(coinSpan);

  const vendorSpan = document.createElement("span");
  vendorSpan.className = "vendor";
  vendorSpan.textContent = item.vendorName;
  if (item.vendorColor) vendorSpan.style.color = item.vendorColor;
  el.appendChild(vendorSpan);

  const priceSpan = document.createElement("span");
  priceSpan.className = "price";
  priceSpan.textContent = formatCurrency(item.bestPrice);
  el.appendChild(priceSpan);

  const premiumSpan = document.createElement("span");
  premiumSpan.className = "premium";
  if (item.premium != null) {
    premiumSpan.textContent = (item.premium >= 0 ? "+" : "") + item.premium.toFixed(1) + "%";
    premiumSpan.classList.add(_premiumTierClass(item.premium));
  }
  el.appendChild(premiumSpan);

  return el;
};

/**
 * Render the scrolling ticker track into the container. Builds two identical
 * blocks for a seamless loop when there are >=4 items (animated), or a single
 * static block otherwise. Reuses the prior loop phase for animation continuity.
 * @param {HTMLElement} container - The ticker container element.
 * @param {Object[]} items - Ticker item descriptors.
 * @param {string} signature - Content signature for stale-render guarding.
 * @param {(HTMLElement|null)} previousTrack - Prior track element, if any.
 * @param {number} previousPhase - Prior loop phase (0..1) for animation continuity.
 * @returns {void}
 */
const _renderTickerTrack = (container, items, signature, previousTrack, previousPhase) => {
  const track = document.createElement("div");
  track.className = "ticker-track";
  track.dataset.signature = signature;

  // Build TWO identical content blocks for seamless loop
  const block1 = document.createElement("div");
  block1.className = "ticker-block";
  block1.dataset.tickerBlock = "primary";
  const block2 = document.createElement("div");
  block2.className = "ticker-block";
  block2.dataset.tickerBlock = "duplicate";
  // The copy exists only for the seamless scroll loop: keep it out of the tab order and
  // the accessibility tree so each dealer price is announced once. It stays clickable
  // (no `inert`), because the loop scrolls it through the visible strip.
  block2.setAttribute("aria-hidden", "true");

  for (const item of items) {
    block1.appendChild(_buildTickerItemEl(item));
    const copy = _buildTickerItemEl(item);
    copy.tabIndex = -1;
    block2.appendChild(copy);
  }

  if (items.length >= 4) {
    track.appendChild(block1);
    track.appendChild(block2);

    track.style.visibility = "hidden";
    if (previousTrack) {
      track.style.position = "absolute";
      track.style.left = "0";
      track.style.top = "0";
      track.style.pointerEvents = "none";
    }

    container.appendChild(track);
    requestAnimationFrame(() => {
      _finalizeTickerTrack(container, track, block1, previousPhase);
    });
  } else {
    track.classList.add("static");
    track.appendChild(block1);
    if (previousTrack) previousTrack.remove();
    container.appendChild(track);
  }
};

/**
 * Keeps a keyboard-focused dealer visible. Keyboard focus stops the animation (CSS), which
 * moves the track back to its start, so the dealer is scrolled into view after that restyle;
 * the strip's scroll resets when focus leaves. Wires the container once.
 * @param {HTMLElement} container - The #bestPriceTickerEl element
 * @returns {void}
 */
const _wireTickerFocus = (container) => {
  if (!(container instanceof HTMLElement) || container.dataset.focusWired) return;
  container.dataset.focusWired = "1";
  container.addEventListener("focusin", (e) => {
    const dealer = e.target.closest(".ticker-item");
    if (!dealer || !dealer.matches(":focus-visible")) return;
    requestAnimationFrame(() => dealer.scrollIntoView({ block: "nearest", inline: "nearest" }));
  });
  container.addEventListener("focusout", (e) => {
    if (!container.contains(e.relatedTarget)) container.scrollLeft = 0;
  });
};

/** True while the user has paused the strip. Lasts for the page view, so every load scrolls. */
let _tickerUserPaused = false;

/**
 * Holds the loop at its offset when the user paused the strip, and applies the static
 * layout under reduced motion. The pause button shows only beside a looping strip, and
 * never under reduced motion.
 * @param {HTMLElement} container - The #bestPriceTickerEl element
 * @returns {void}
 */
const _syncTickerPause = (container) => {
  if (!(container instanceof HTMLElement)) return;
  const reduced = prefersReducedMotion();
  const userPaused = _tickerUserPaused;
  container.classList.toggle("is-paused", reduced);
  container.classList.toggle("is-held", userPaused && !reduced);
  const button = safeGetElement("bestPriceTickerPause");
  if (!(button instanceof HTMLElement)) return;
  const looping = !container.hidden && !!container.querySelector('[data-ticker-block="duplicate"]');
  button.hidden = reduced || !looping;
  button.setAttribute("aria-pressed", String(userPaused));
};

/**
 * Wires the pause button and the reduced-motion listener once.
 * @param {HTMLElement} container - The #bestPriceTickerEl element
 * @returns {void}
 */
const _wireTickerPause = (container) => {
  if (!(container instanceof HTMLElement) || container.dataset.pauseWired) return;
  container.dataset.pauseWired = "1";
  const button = safeGetElement("bestPriceTickerPause");
  if (button instanceof HTMLElement) {
    button.addEventListener("click", () => {
      _tickerUserPaused = !_tickerUserPaused;
      _syncTickerPause(container);
    });
  }
  if (typeof window.matchMedia === "function") {
    window
      .matchMedia("(prefers-reduced-motion: reduce)")
      .addEventListener("change", () => _syncTickerPause(container));
  }
};

const renderBestPriceTicker = () => {
  const container = safeGetElement("bestPriceTickerEl");
  if (!(container instanceof HTMLElement)) return;
  _wireTickerFocus(container);
  _wireTickerPause(container);
  _buildBestPriceTicker(container);
  _syncTickerPause(container);
};

/**
 * Builds the strip from the cheapest in-stock dealer per coin, or hides it when none qualify.
 * @param {HTMLElement} container - The #bestPriceTickerEl element
 * @returns {void}
 */
const _buildBestPriceTicker = (container) => {
  const coins = _getRetailCoins();
  const coinMetaMap = _getCoinMeta();
  const vendorMeta = _getVendorMeta();

  const items = [];

  for (const slug of Object.keys(coins)) {
    const coin = coins[slug];
    if (!coin || !coin.vendors) continue;

    const item = _buildTickerItem(slug, coin, coinMetaMap, vendorMeta);
    if (item) items.push(item);
  }

  // Sort alphabetically by coin name so vendors are naturally interleaved
  items.sort((a, b) => a.name.localeCompare(b.name));

  if (items.length === 0) {
    container.dataset.tickerSignature = "";
    container.setAttribute("hidden", "");
    // Remove only the tracks: the region's heading stays for the next render.
    container.querySelectorAll(".ticker-track").forEach((track) => track.remove());
    return;
  }

  const signature = _buildTickerSignature(items);
  const previousTrack = container.querySelector(".ticker-track");
  if (previousTrack && container.dataset.tickerSignature === signature) {
    container.removeAttribute("hidden");
    return;
  }

  const previousPhase = _getTickerLoopPhase(previousTrack);

  container.removeAttribute("hidden");
  container.dataset.tickerSignature = signature;

  _renderTickerTrack(container, items, signature, previousTrack, previousPhase);
};

// ---------------------------------------------------------------------------
// Vendor Prices
// ---------------------------------------------------------------------------

/**
 * Resolve a vendor id to its short display label. Vendors missing from the
 * hardcoded map fall back to the manifest vendor-meta display name, so a newly
 * added vendor renders its feed name instead of a bare lowercase id (STRK-317:
 * "mintbuilder"). The raw vid remains the last resort when no meta name exists.
 * @param {string} vid - Vendor id from the retail feed (e.g. "apmex").
 * @returns {string} Short display label (e.g. "APMEX", "MintBuilder").
 */
const _shortVendor = (vid) => {
  const map = {
    apmex: "APMEX",
    jmbullion: "JM",
    sdbullion: "SD",
    monumentmetals: "Monument",
    herobullion: "Hero",
    bullionexchanges: "BullionX",
    summitmetals: "Summit",
    gainesvillecoins: "Gville",
    providentmetals: "Provident",
    goldback: "Goldback",
    mintbuilder: "MintBuilder",
  };
  if (map[vid]) return map[vid];
  const meta = _getVendorMeta()[vid];
  return (meta && meta.name) || vid;
};

let _activeModalChart = null;
let _activeModalSlug = null;
let _activeModalPeriodId = MARKET_DETAIL_DEFAULT_PERIOD_ID;
let _activeModalRenderGeneration = 0;
let _activeModalOpener = null;
let _pendingMarketFocusSlug = null;

const _destroyActiveMarketDetailChart = () => {
  if (_activeModalChart && typeof destroyCoinChart === "function") {
    destroyCoinChart(_activeModalChart);
  }
  _activeModalChart = null;
};

/**
 * Return focus to the control that opened the detail modal. A re-render replaces the
 * opener and a resize can hide it, so the shown item button with the same slug stands in.
 * @param {(HTMLElement|null)} opener - Element focused when the modal opened.
 * @param {(string|null)} slug - Slug of the coin the modal showed.
 * @returns {void}
 */
const _restoreMarketDetailFocus = (opener, slug) => {
  if (opener && opener.isConnected && opener.getClientRects().length > 0) {
    opener.focus();
    return;
  }
  if (!slug) return;
  const stand = _findShownCoinButton(slug);
  if (stand instanceof HTMLElement) stand.focus();
  // The matrix may still be rebuilding; _applyPendingMarketFocus finishes the restore.
  else _pendingMarketFocusSlug = slug;
};

/**
 * Focus the item button a closed detail modal could not reach while the matrix
 * rebuilt. Runs once per render and only while focus still sits on the body.
 * @returns {void}
 */
const _applyPendingMarketFocus = () => {
  const slug = _pendingMarketFocusSlug;
  _pendingMarketFocusSlug = null;
  if (!slug || (document.activeElement && document.activeElement !== document.body)) return;
  const btn = _findShownCoinButton(slug);
  if (btn instanceof HTMLElement) btn.focus();
};

/**
 * Find the item button for a slug in the layout on screen. The matrix and the phone
 * cards both carry one, and CSS hides one of the two.
 * @param {string} slug - Retail coin slug.
 * @returns {(HTMLElement|null)} The shown button, else the first match, else null.
 */
const _findShownCoinButton = (slug) => {
  const buttons = [...document.querySelectorAll(`.vp-coin-link[data-slug="${CSS.escape(slug)}"]`)];
  return buttons.find((btn) => btn.getClientRects().length > 0) || buttons[0] || null;
};

/**
 * Report whether an overlay is the top entry of the open-modal stack. An overlay absent from
 * the stack counts as top when nothing else is open.
 * @param {HTMLElement} overlay - Modal overlay element.
 * @returns {boolean} False when another modal is stacked above the overlay.
 */
const _isTopModal = (overlay) => {
  if (typeof _focusTrapStack === "undefined") return true;
  const top = _focusTrapStack[_focusTrapStack.length - 1];
  return !top || top.modal === overlay;
};

const closeMarketDetailModal = () => {
  const closedSlug = _activeModalSlug;
  _activeModalRenderGeneration += 1;
  _destroyActiveMarketDetailChart();
  _activeModalSlug = null;
  _activeModalPeriodId = MARKET_DETAIL_DEFAULT_PERIOD_ID;

  const content = safeGetElement("marketDetailContent");
  if (content instanceof HTMLElement) content.textContent = "";

  const overlay = safeGetElement("marketDetailModal");
  if (overlay instanceof HTMLElement) {
    const wasOpen = !overlay.hasAttribute("hidden");
    const wasTop = _isTopModal(overlay);
    overlay.setAttribute("hidden", "");
    if (wasOpen) {
      // _restoreMarketDetailFocus owns focus here: it waits for a matrix rebuild.
      if (typeof releaseFocus === "function") releaseFocus(overlay, { restoreFocus: false });
      // A dialog stacked above keeps focus.
      if (wasTop) _restoreMarketDetailFocus(_activeModalOpener, closedSlug);
    }
  }
  _activeModalOpener = null;
};

/**
 * Parse the publisher's UTC ISO timestamp shape with shared local-calendar
 * validity checks and domain-specific UTC time-component checks.
 * `validatedLocalDate()` is reused only as the shared local-calendar predicate;
 * this feed parser retains strict UTC `Z` framing and time checks.
 * @param {*} timestamp - Candidate `YYYY-MM-DDTHH:mm:ss(.sss)Z` value.
 * @returns {(number|null)} Valid UTC timestamp in milliseconds, otherwise null.
 */
const _parseMarketDetailIsoTime = (timestamp) => {
  if (typeof timestamp !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(timestamp);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, msText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(msText || 0);
  const calendarDate =
    typeof validatedLocalDate === "function" ? validatedLocalDate(year, month - 1, day) : null;
  if (
    !calendarDate ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59 ||
    millisecond < 0 ||
    millisecond > 999
  ) {
    return null;
  }

  const utcTimeMs = Date.parse(timestamp);
  return Number.isFinite(utcTimeMs) ? utcTimeMs : null;
};

/**
 * Format a millisecond timestamp as its UTC calendar date key.
 * @param {number} timeMs - Milliseconds since epoch.
 * @returns {string} UTC `YYYY-MM-DD` date key.
 */
const _utcDateKey = (timeMs) => {
  const date = new Date(timeMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * Return an ISO date-only chart key from a validated publisher timestamp.
 * The publisher's UTC date is preferred; timestamp fallback is explicitly UTC.
 * @param {Object} row - Retail history row.
 * @param {number} timeMs - Valid observation time in milliseconds.
 * @returns {string} UTC `YYYY-MM-DD` chart key.
 */
const _getMarketDetailDailyChartTime = (row, timeMs) => {
  const isoTimeMs = _parseMarketDetailIsoTime(row.t);
  if (isoTimeMs !== null) return row.t.slice(0, 10);
  return _utcDateKey(timeMs);
};

/**
 * Parse a retail feed row timestamp, preferring Unix seconds and falling back
 * to the publisher ISO timestamp.
 * @param {Object} row - Retail feed row.
 * @returns {(number|null)} Parsed timestamp in milliseconds.
 */
const _parseMarketDetailTime = (row) => {
  const unixSeconds = Number(row?.ts);
  if (Number.isFinite(unixSeconds) && unixSeconds > 0) return unixSeconds * 1000;

  return _parseMarketDetailIsoTime(row?.t);
};

/**
 * Normalize a raw Vendor value into a finite positive USD price.
 * @param {*} vendorValue - Intraday price or daily `{avg}`/numeric value.
 * @param {boolean} intraday - Whether the source uses direct numeric values.
 * @returns {(number|null)} Valid raw USD price, otherwise null.
 */
const _normalizeMarketDetailPrice = (vendorValue, intraday) => {
  const rawPrice =
    intraday || typeof vendorValue === "number" || typeof vendorValue === "string"
      ? vendorValue
      : vendorValue?.avg;
  if (
    (typeof rawPrice !== "number" && typeof rawPrice !== "string") ||
    (typeof rawPrice === "string" && rawPrice.trim() === "")
  ) {
    return null;
  }

  const usdPrice = Number(rawPrice);
  return Number.isFinite(usdPrice) && usdPrice > 0 ? usdPrice : null;
};

/**
 * Calculate range statistics from accepted raw-USD Vendor observations.
 * @param {Array<{usdPrice:number}>} observations - Accepted range observations.
 * @returns {{median:(number|null),low:(number|null),high:(number|null),spread:(number|null),count:number}}
 */
const _calculateMarketDetailSummary = (observations) => {
  const acceptedObservations = Array.isArray(observations) ? observations : [];
  const prices = acceptedObservations
    .map((observation) => observation.usdPrice)
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);

  if (prices.length === 0) {
    return { median: null, low: null, high: null, spread: null, count: 0 };
  }

  const midpoint = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 1 ? prices[midpoint] : (prices[midpoint - 1] + prices[midpoint]) / 2;
  const low = prices[0];
  const high = prices[prices.length - 1];
  return { median, low, high, spread: high - low, count: prices.length };
};

/**
 * Find single-point price spikes in each Vendor's intraday line. A point is a spike
 * when the points on both sides agree within RETAIL_SPIKE_NEIGHBOR_TOLERANCE and the
 * point differs from their average by more than that tolerance.
 * @param {Array<{vendorId:string, points:Array<{time:number, usdPrice:number}>}>} series - Vendor series.
 * @returns {Set<string>} `vendorId|time` keys of the spike points.
 */
const _findMarketDetailSpikes = (series) => {
  const tolerance =
    typeof RETAIL_SPIKE_NEIGHBOR_TOLERANCE === "number" ? RETAIL_SPIKE_NEIGHBOR_TOLERANCE : 0.05;
  const spikeKeys = new Set();
  for (const { vendorId, points } of series) {
    // The first and last points have no neighbor pair, so they are never flagged.
    for (let index = 1; index < points.length - 1; index += 1) {
      const prev = points[index - 1].usdPrice;
      const next = points[index + 1].usdPrice;
      const neighborAvg = (prev + next) / 2;
      if (Math.abs(prev - next) / neighborAvg > tolerance) continue;
      if (Math.abs(points[index].usdPrice - neighborAvg) / neighborAvg > tolerance) {
        spikeKeys.add(`${vendorId}|${points[index].time}`);
      }
    }
  }
  return spikeKeys;
};

/**
 * Build the authoritative date-bounded observations, summary, and Vendor
 * series for a Retail View period.
 * @param {string} periodId - Allow-listed period identifier.
 * @param {Object} modalData - Independently fetched Retail View payloads.
 * @param {number} nowMs - Inclusive range end in milliseconds.
 * @returns {Object} Normalized market-detail range model.
 */
const _buildMarketDetailRangeModel = (periodId, modalData, nowMs) => {
  const period = MARKET_DETAIL_PERIODS.find((candidate) => candidate.id === periodId);
  const numericNowMs = Number(nowMs);
  const endMs = Number.isFinite(numericNowMs) && numericNowMs > 0 ? numericNowMs : Date.now();
  const startMs = period ? endMs - period.durationMs : endMs;
  // STRK-260: daily aggregates carry a synthetic noon-UTC timestamp
  // (devops/pollers/shared/api-export-v2.js buildDailyWithVendors stamps every
  // bucket at T12:00:00Z), so an exact-millisecond compare against startMs/endMs
  // rejects today's bucket before noon UTC and the oldest boundary day after
  // noon UTC. Non-intraday periods are bounded by UTC calendar date instead;
  // intraday (24H) keeps the exact-millisecond compare. Start is exclusive and
  // end is inclusive so an N-day period spans exactly N calendar dates (today
  // plus the N-1 preceding days), regardless of what time "now" falls at.
  const startDateKey = _utcDateKey(startMs);
  const endDateKey = _utcDateKey(endMs);
  const rows = period && Array.isArray(modalData?.[period.source]) ? modalData[period.source] : [];
  const observations = [];
  const dailyObservationsByVendorTime = new Map();

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const timeMs = _parseMarketDetailTime(row);
    if (timeMs === null) continue;

    const chartTime = period?.intraday
      ? Math.floor(timeMs / 1000)
      : _getMarketDetailDailyChartTime(row, timeMs);

    if (period?.intraday) {
      if (timeMs < startMs || timeMs > endMs) continue;
    } else if (chartTime <= startDateKey || chartTime > endDateKey) {
      continue;
    }
    if (!row.vendors || typeof row.vendors !== "object" || Array.isArray(row.vendors)) continue;

    for (const [vendorId, vendorValue] of Object.entries(row.vendors)) {
      if (!vendorId) continue;
      const usdPrice = _normalizeMarketDetailPrice(vendorValue, !!period?.intraday);
      if (usdPrice === null) continue;
      const observation = { vendorId, timeMs, chartTime, usdPrice };
      if (period?.intraday) {
        observations.push(observation);
      } else {
        const observationKey = JSON.stringify([vendorId, chartTime]);
        const existingObservation = dailyObservationsByVendorTime.get(observationKey);
        if (!existingObservation || timeMs >= existingObservation.timeMs) {
          dailyObservationsByVendorTime.set(observationKey, observation);
        }
      }
    }
  }

  if (!period?.intraday) {
    observations.push(...dailyObservationsByVendorTime.values());
  }

  observations.sort(
    (left, right) => left.timeMs - right.timeMs || left.vendorId.localeCompare(right.vendorId)
  );

  // STRK-276: collapse duplicate (vendorId, chartTime) pairs when building the
  // chart series. Intraday keys chart time as Math.floor(timeMs / 1000), so two
  // rows for one vendor inside the same second yield two points at an identical
  // time; Lightweight Charts rejects duplicate/unsorted times in setData(),
  // which degrades the whole view to "Chart unavailable" instead of dropping a
  // single point.
  //
  // Deliberately done HERE and not where observations are collected. The
  // duplicate is a chart-rendering constraint, not a data-validity problem —
  // both rows are real observations — so `observations`, and therefore the
  // median/low/high/spread/count in the summary, are left untouched. Deduping
  // upstream instead would let a rendering limitation quietly change
  // user-visible statistics.
  //
  // `observations` is already sorted ascending by timeMs, so the last write per
  // key wins, matching the daily branch's timeMs tie-break. Map iteration keeps
  // insertion order, so points stay time-ordered. The daily path is deduped
  // upstream already, making this a no-op there.
  const seriesByVendor = new Map();
  const chartObservationByKey = new Map();
  for (const observation of observations) {
    let pointsByChartTime = seriesByVendor.get(observation.vendorId);
    if (!pointsByChartTime) {
      pointsByChartTime = new Map();
      seriesByVendor.set(observation.vendorId, pointsByChartTime);
    }
    pointsByChartTime.set(observation.chartTime, {
      time: observation.chartTime,
      usdPrice: observation.usdPrice,
    });
    chartObservationByKey.set(`${observation.vendorId}|${observation.chartTime}`, observation);
  }

  const rawSeries = Array.from(seriesByVendor, ([vendorId, pointsByChartTime]) => ({
    vendorId,
    points: Array.from(pointsByChartTime.values()),
  })).sort((left, right) => left.vendorId.localeCompare(right.vendorId));

  const spikeKeys = period?.intraday ? _findMarketDetailSpikes(rawSeries) : new Set();
  const series = rawSeries.map(({ vendorId, points }) => ({
    vendorId,
    points: points.filter((point) => !spikeKeys.has(`${vendorId}|${point.time}`)),
  }));
  // Drop only the observation each spike point charts; same-second rows it replaced stay.
  const spikeObservations = new Set(Array.from(spikeKeys, (key) => chartObservationByKey.get(key)));
  const summaryObservations = observations.filter(
    (observation) => !spikeObservations.has(observation)
  );

  return {
    periodId: period ? period.id : periodId,
    startMs,
    endMs,
    intraday: !!period?.intraday,
    observations,
    series,
    spikeCount: spikeKeys.size,
    summary: _calculateMarketDetailSummary(summaryObservations),
    hasChartData: series.some((vendorSeries) => vendorSeries.points.length > 0),
  };
};

/**
 * Fetch a slug's retail detail and three history sources independently,
 * tolerating individual failures (each resolves to null on error).
 * @param {string} slug - Retail coin slug.
 * @returns {Promise<{detail:(Object|null),intraday:*,history30d:*,history90d:*}>}
 */
const _fetchModalData = async (slug) => {
  const detailPromise = _marketV2Fetch("/retail/" + slug + "/latest.json")
    .then((json) => (json && json.data ? json.data : null))
    .catch((e) => {
      debugLog("[market-data] Detail fetch failed: " + e.message, "warn");
      return null;
    });

  const intradayPromise = _marketV2Fetch("/retail/" + slug + "/intraday.json")
    .then((json) => (json && json.data ? json.data : json))
    .catch((e) => {
      debugLog("[market-data] Intraday fetch failed: " + e.message, "warn");
      return null;
    });

  const history30dPromise = _marketV2Fetch("/retail/" + slug + "/history-30d.json")
    .then((json) => (json && json.data ? json.data : json))
    .catch((e) => {
      debugLog("[market-data] History 30d fetch failed: " + e.message, "warn");
      return null;
    });

  const history90dPromise = _marketV2Fetch("/retail/" + slug + "/history-90d.json")
    .then((json) => (json && json.data ? json.data : json))
    .catch((e) => {
      debugLog("[market-data] History 90d fetch failed: " + e.message, "warn");
      return null;
    });

  const [detailResult, intradayResult, history30dResult, history90dResult] =
    await Promise.allSettled([
      detailPromise,
      intradayPromise,
      history30dPromise,
      history90dPromise,
    ]);

  return {
    detail: detailResult.status === "fulfilled" ? detailResult.value : null,
    intraday: intradayResult.status === "fulfilled" ? intradayResult.value : null,
    history30d: history30dResult.status === "fulfilled" ? history30dResult.value : null,
    history90d: history90dResult.status === "fulfilled" ? history90dResult.value : null,
  };
};

/**
 * Render the detail-modal header (metal dot, coin name, optional weight line).
 * @param {HTMLElement} content - Modal content container.
 * @param {Object} coinMeta - Resolved coin meta.
 * @param {string} slug - Retail coin slug (name fallback).
 * @param {string} metalCode - ISO metal code (e.g. "xau") or metal name.
 * @param {string} metalLower - Lowercased metal name (weight-line fallback label).
 * @param {number} weightOz - Coin weight in troy ounces (0 hides the weight line).
 * @param {string} [pricesAt] - ISO start of the price window (absent hides the time line).
 * @returns {void}
 */
const _buildModalHeader = (content, coinMeta, slug, metalCode, metalLower, weightOz, pricesAt) => {
  const header = document.createElement("div");
  header.className = "market-detail-header";

  const h2 = document.createElement("h2");
  h2.id = "marketDetailTitle";
  h2.tabIndex = -1;
  const dot = document.createElement("span");
  dot.className = "metal-dot" + (metalCode ? " " + metalCode : "");
  h2.appendChild(dot);
  const nameText = document.createTextNode(" " + (coinMeta.name || slug));
  h2.appendChild(nameText);
  header.appendChild(h2);

  if (weightOz > 0) {
    const metalNames = { xau: "Gold", xag: "Silver", xpt: "Platinum", xpd: "Palladium" };
    const metalName = metalNames[metalCode] || metalLower;
    const weightInfo = document.createElement("div");
    weightInfo.className = "market-detail-weight";
    weightInfo.textContent = weightOz + " oz " + metalName;
    header.appendChild(weightInfo);
  }

  const pricesLocal = _formatMarketTimestamp(pricesAt);
  if (pricesLocal) {
    const asOf = document.createElement("div");
    asOf.className = "market-detail-asof";
    asOf.textContent = `Prices from ${pricesLocal}`;
    header.appendChild(asOf);
  }

  content.appendChild(header);
};

/**
 * Render four stable selected-period summary cells. Each label names the period,
 * so the modal median never reads like the matrix "Median now".
 * @param {HTMLElement} content - Modal content container.
 * @returns {function(Object, string):void} Raw-USD summary updater taking the period label.
 */
const _buildModalPriceSummary = (content) => {
  const priceRow = document.createElement("div");
  priceRow.className = "market-detail-summary";
  priceRow.setAttribute("aria-live", "polite");
  const valueElements = {};
  const labelElements = {};
  const STAT_WORDS = { median: "median", low: "low", high: "high", spread: "spread" };

  for (const [key, word] of Object.entries(STAT_WORDS)) {
    const stat = document.createElement("div");
    const lbl = document.createElement("div");
    lbl.className = "market-detail-stat-label";
    lbl.textContent = word;
    stat.appendChild(lbl);
    labelElements[key] = lbl;
    const val = document.createElement("div");
    val.classList.add("market-value");
    val.textContent = "\u2014";
    stat.appendChild(val);
    priceRow.appendChild(stat);
    valueElements[key] = val;
  }

  content.appendChild(priceRow);

  return (summary = {}, periodLabel = "") => {
    for (const [key, element] of Object.entries(valueElements)) {
      const value = summary[key];
      element.textContent = Number.isFinite(value) ? formatCurrency(value) : "\u2014";
      labelElements[key].textContent = `${periodLabel} ${STAT_WORDS[key]}`.trim();
    }
  };
};

/**
 * Render the five-period selected-range controller and chart.
 * @param {HTMLElement} content - Modal content container.
 * @param {Object} modalData - Independently fetched Retail View payloads.
 * @param {Object} vendorMeta - Vendor-meta map (for chart series styling).
 * @param {function(Object, string):void} updateSummary - Selected-range summary updater.
 * @param {string} initialPeriodId - Period selected for this reconstruction.
 * @returns {void}
 */
const _buildModalChartSection = (
  content,
  modalData,
  vendorMeta,
  updateSummary,
  initialPeriodId
) => {
  const chartSection = document.createElement("div");
  chartSection.className = "market-detail-chart-section";

  const chartTabBar = document.createElement("div");
  chartTabBar.className = "chip-sort-toggle market-detail-periods";
  chartTabBar.setAttribute("role", "group");
  chartTabBar.setAttribute("aria-label", "Vendor history period");

  const chartWrap = document.createElement("div");
  chartWrap.className = "market-detail-chart";
  chartWrap.id = "marketDetailChartArea";
  chartWrap.setAttribute("role", "group");
  chartWrap.setAttribute("aria-label", "Vendor price history chart");
  const rangeEndMs = Date.now();
  const rangeModels = new Map(
    MARKET_DETAIL_PERIODS.map((period) => [
      period.id,
      _buildMarketDetailRangeModel(period.id, modalData, rangeEndMs),
    ])
  );
  const periodButtons = new Map();
  const legend = document.createElement("ul");
  legend.className = "market-detail-legend";
  legend.setAttribute("aria-label", "Dealers by latest price");
  const chartNote = document.createElement("p");
  chartNote.className = "market-detail-chart-note";

  /**
   * List each charted dealer by latest price with its line color, and name hidden spikes.
   * @param {Object} rangeModel - Normalized range model the chart renders.
   * @returns {void}
   */
  const _renderChartKey = (rangeModel) => {
    const latest = rangeModel.series
      .filter((vendorSeries) => vendorSeries.points.length > 0)
      .map(({ vendorId, points }) => ({ vendorId, usdPrice: points[points.length - 1].usdPrice }))
      .sort((left, right) => left.usdPrice - right.usdPrice);
    for (const { vendorId, usdPrice } of latest) {
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "market-detail-legend-swatch";
      // The swatch fills with currentColor, so the vendor color rides the color property.
      swatch.style.color =
        typeof getRetailVendorColor === "function"
          ? getRetailVendorColor(vendorId)
          : "var(--text-muted)";
      const name = document.createElement("span");
      name.className = "market-detail-legend-name";
      name.textContent = _shortVendor(vendorId);
      const price = document.createElement("span");
      price.className = "market-detail-legend-price";
      price.textContent = formatCurrency(usdPrice);
      item.append(swatch, name, price);
      legend.appendChild(item);
    }
    const spikes = rangeModel.spikeCount || 0;
    if (spikes > 0) {
      chartNote.textContent =
        spikes === 1
          ? "1 price spike is hidden. The prices before and after it agree."
          : `${spikes} price spikes are hidden. The prices before and after each agree.`;
      chartSection.appendChild(chartNote);
    }
  };

  const NO_CHART_DATA = "No dealer prices were recorded for this period. Select another period.";
  const NO_CHART_LIBRARY = "The chart did not load. Reload the page to try again.";
  const NO_CHART_LOAD = "The price history did not load.";

  /**
   * Replace chart content with the unavailable state and its reason.
   * @param {string} reasonText - Why the chart is missing and what to do next.
   * @param {boolean} [canRetry] - Adds a Try again button that refetches the modal data.
   * @returns {void}
   */
  const _showNoChart = (reasonText, canRetry = false) => {
    chartWrap.textContent = "";
    const msg = document.createElement("div");
    msg.className = "market-detail-chart-unavailable";
    const title = document.createElement("div");
    title.textContent = "Chart unavailable";
    const reason = document.createElement("div");
    reason.className = "market-detail-chart-reason";
    reason.textContent = reasonText;
    msg.append(title, reason);
    if (canRetry) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "market-block-btn vp-message-action";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => {
        if (!_activeModalSlug) return;
        void openMarketDetailModal(_activeModalSlug, { preservePeriod: true }).catch((e) => {
          debugLog(`[market-data] Detail retry failed: ${e?.message ?? e}`, "warn");
        });
      });
      msg.appendChild(retry);
    }
    chartWrap.appendChild(msg);
  };

  /**
   * Render one selected range across controls, summary, and chart.
   * @param {string} periodId - Allow-listed period identifier.
   * @returns {void}
   */
  const _renderSelectedRange = (periodId) => {
    const period = MARKET_DETAIL_PERIODS.find((candidate) => candidate.id === periodId);
    const rangeModel = rangeModels.get(periodId);
    if (!period || !rangeModel) return;

    _activeModalPeriodId = periodId;
    for (const [buttonPeriodId, button] of periodButtons) {
      const isSelected = buttonPeriodId === periodId;
      button.classList.toggle("active", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    }

    updateSummary(rangeModel.summary, period.label);
    _destroyActiveMarketDetailChart();
    chartWrap.textContent = "";
    legend.textContent = "";
    chartNote.remove();

    if (typeof LightweightCharts === "undefined") {
      _showNoChart(NO_CHART_LIBRARY);
      return;
    }
    if (!rangeModel.hasChartData) {
      // _fetchModalData resolves a failed request to null; an empty feed is an array.
      const loadFailed = modalData[period.source] === null;
      _showNoChart(loadFailed ? NO_CHART_LOAD : NO_CHART_DATA, loadFailed);
      return;
    }

    try {
      if (period.intraday && typeof createVendorIntradayChart === "function") {
        _activeModalChart = createVendorIntradayChart(
          "marketDetailChartArea",
          rangeModel,
          vendorMeta
        );
      } else if (!period.intraday && typeof createVendorHistoryChart === "function") {
        _activeModalChart = createVendorHistoryChart(
          "marketDetailChartArea",
          rangeModel,
          vendorMeta
        );
      }
    } catch (e) {
      debugLog("[market-data] Detail chart render failed: " + e.message, "warn");
      _destroyActiveMarketDetailChart();
    }

    if (_activeModalChart) {
      _renderChartKey(rangeModel);
    } else {
      _showNoChart(NO_CHART_LIBRARY);
    }
  };

  for (const period of MARKET_DETAIL_PERIODS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-sort-btn market-detail-period-btn";
    btn.setAttribute("data-period", period.id);
    btn.setAttribute("aria-pressed", "false");
    btn.textContent = period.label;
    btn.addEventListener("click", () => _renderSelectedRange(period.id));
    chartTabBar.appendChild(btn);
    periodButtons.set(period.id, btn);
  }

  chartSection.append(chartTabBar, chartWrap, legend);
  content.appendChild(chartSection);

  const selectedPeriodId = rangeModels.has(initialPeriodId)
    ? initialPeriodId
    : MARKET_DETAIL_DEFAULT_PERIOD_ID;
  _renderSelectedRange(selectedPeriodId);
};

/**
 * Rank a detail-modal vendor entry by stock: 0 in stock, 1 carried, 2 out of stock.
 * @param {Object} entry - Vendor entry ({in_stock, inStock, carried}).
 * @returns {number} Stock tier; lower sorts first.
 */
const _modalStockTier = (entry) => {
  if (entry.carried) return 1;
  return _isVendorInStock(entry) ? 0 : 2;
};

/**
 * Build the link cell for a detail-modal vendor row. Renders "Buy" for an in-stock
 * dealer and "Visit" otherwise (both open a detached popup) when a safe vendor URL
 * resolves, else a muted dash.
 * @param {Object} entry - Vendor entry ({vid, url, ...}).
 * @param {string} slug - Retail coin slug (provider URL lookup).
 * @param {Object} vendorMeta - Vendor-meta map (url fallback for entry.vid).
 * @returns {HTMLTableCellElement} The buy cell.
 */
const _buildModalBuyCell = (entry, slug, vendorMeta) => {
  const tdBuy = document.createElement("td");
  const url = _resolveVendorUrl(slug, entry.vid, vendorMeta, entry.url);
  if (_isSafeUrl(url)) {
    const buyBtn = document.createElement("button");
    buyBtn.type = "button";
    const pricePart = entry.price > 0 ? `, ${formatCurrency(entry.price)}` : "";
    // Only a live in-stock listing gets Buy; a carried or sold-out price links as Visit.
    if (_modalStockTier(entry) === 0) {
      buyBtn.textContent = "Buy";
      buyBtn.className = "market-detail-buy";
      buyBtn.setAttribute(
        "aria-label",
        `Buy at ${_shortVendor(entry.vid)}${pricePart}. Opens the dealer page in a new window.`
      );
    } else {
      buyBtn.textContent = "Visit";
      buyBtn.className = "market-detail-visit";
      const stockPart = entry.carried ? "Price from an earlier check" : "Out of stock";
      buyBtn.setAttribute(
        "aria-label",
        `Visit ${_shortVendor(entry.vid)}. ${stockPart}. Opens the dealer page in a new window.`
      );
    }
    buyBtn.addEventListener("click", () => {
      _openVendorPopup(url, entry.vid);
    });
    tdBuy.appendChild(buyBtn);
  } else {
    tdBuy.textContent = "—";
    tdBuy.className = "vp-muted";
  }
  return tdBuy;
};

/**
 * Build one vendor row for the detail-modal comparison table (name, price,
 * premium badge, stock status, buy link).
 * @param {Object} entry - Vendor entry ({vid, price, in_stock, carried, url, ...}).
 * @param {Object} vendorMeta - Vendor-meta map used for vendor purchase URLs.
 * @param {string} slug - Retail coin slug (for provider URL lookup).
 * @param {string} metalCode - ISO metal code (Goldback premium uses the G1 rate).
 * @param {number} weightOz - Coin weight in troy ounces (for spot premium).
 * @param {(number|null)} spotPrice - Spot price for the metal, or null.
 * @returns {HTMLTableRowElement} The vendor row element.
 */
const _buildModalVendorRow = (entry, vendorMeta, slug, metalCode, weightOz, spotPrice, rank) => {
  const tr = document.createElement("tr");

  // Vendor name
  const tdVendor = document.createElement("td");
  tdVendor.textContent = _shortVendor(entry.vid);
  tdVendor.style.color =
    typeof getRetailVendorColor === "function"
      ? getRetailVendorColor(entry.vid)
      : "var(--text-muted)";
  tr.appendChild(tdVendor);

  // Price
  const tdPrice = document.createElement("td");
  tdPrice.classList.add("market-price");
  tdPrice.textContent = entry.price > 0 ? formatCurrency(entry.price) : "—";
  tr.appendChild(tdPrice);

  // Premium
  const tdPrem = document.createElement("td");
  let _modalPremium = null;
  if (entry.price > 0 && spotPrice && spotPrice > 0 && weightOz > 0) {
    _modalPremium = _calcMarketPremium(entry.price, spotPrice * weightOz);
  } else if (entry.price > 0 && metalCode === "goldback" && _goldbackG1Rate > 0) {
    _modalPremium = _calcMarketPremium(entry.price, _goldbackG1Rate);
  }
  if (_modalPremium != null) {
    tdPrem.appendChild(
      _buildPremiumBadge(
        (_modalPremium >= 0 ? "+" : "") + _modalPremium.toFixed(1) + "%",
        rank?.byId[entry.vid]
      )
    );
  } else {
    tdPrem.textContent = "—";
    tdPrem.className = "vp-muted";
  }
  tr.appendChild(tdPrem);

  // Stock: its own column, and a copy under the vendor name that the phone layout shows instead.
  const tdStock = document.createElement("td");
  let stockState = "out";
  let stockWord = "Out of Stock";
  let stockSubWord = stockWord;
  let carriedTitle = "";
  if (entry.carried) {
    stockState = "carried";
    stockWord = "Carried";
    stockSubWord = stockWord;
    carriedTitle = _lastSeenTitle(entry.carried_from);
    if (carriedTitle) {
      tdStock.title = carriedTitle;
      // Touch never shows a title, so the phone line names the day it was last seen.
      stockSubWord = `Carried ${_formatMarketTimestamp(entry.carried_from).split(",")[0]}`;
    }
  } else if (_isVendorInStock(entry)) {
    stockState = "in";
    stockWord = "In Stock";
    stockSubWord = stockWord;
  }
  tdStock.className = `market-stock market-stock--${stockState} market-detail-stock-col`;
  tdStock.textContent = stockWord;
  tr.appendChild(tdStock);

  const stockSub = document.createElement("span");
  stockSub.className = `market-stock--${stockState} market-stock-sub`;
  stockSub.textContent = stockSubWord;
  if (carriedTitle) stockSub.title = carriedTitle;
  tdVendor.appendChild(stockSub);

  tr.appendChild(_buildModalBuyCell(entry, slug, vendorMeta));

  return tr;
};

/**
 * Render the detail-modal vendor comparison table (in stock, carried, then out of
 * stock, each by price), or a
 * "vendor data unavailable" placeholder when no vendor data exists.
 * @param {HTMLElement} content - Modal content container.
 * @param {Object|null} detail - Normalized retail detail (with vendors map).
 * @param {string} slug - Retail coin slug.
 * @param {Object} vendorMeta - Vendor-meta map.
 * @param {string} metalCode - ISO metal code.
 * @param {number} weightOz - Coin weight in troy ounces.
 * @returns {void}
 */
const _buildModalVendorTable = (content, detail, slug, vendorMeta, metalCode, weightOz) => {
  if (detail && detail.vendors) {
    const vData = detail.vendors;
    const spotPrice = _getSpotPrice(metalCode);
    const rank = _rankVendorData(vData, slug);

    const vendorEntries = [];
    for (const vid in vData) {
      const v = vData[vid];
      if (!v) continue;
      // The ranking skips a dealer the Market filter hides, so the table does too.
      if (typeof _isMarketItemEnabled === "function" && !_isMarketItemEnabled(slug, vid)) continue;
      vendorEntries.push({ vid, ...v });
    }
    vendorEntries.sort((a, b) => {
      const tierDiff = _modalStockTier(a) - _modalStockTier(b);
      if (tierDiff !== 0) return tierDiff;
      if (a.price > 0 && b.price > 0) return a.price - b.price;
      if (a.price > 0) return -1;
      if (b.price > 0) return 1;
      return 0;
    });

    if (vendorEntries.length > 0) {
      const scrollWrap = document.createElement("div");
      scrollWrap.className = "vp-scroll";

      const table = document.createElement("table");
      table.className = "vendor-prices-table market-detail-vendors";

      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      const headers = ["Vendor", "Price", "Premium", "Stock", "Buy"];
      for (const h of headers) {
        const th = document.createElement("th");
        th.textContent = h;
        if (h === "Stock") th.className = "market-detail-stock-col";
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");

      for (const entry of vendorEntries) {
        tbody.appendChild(
          _buildModalVendorRow(entry, vendorMeta, slug, metalCode, weightOz, spotPrice, rank)
        );
      }

      table.appendChild(tbody);
      scrollWrap.appendChild(table);
      content.appendChild(scrollWrap);
    }
  } else {
    const noData = document.createElement("div");
    noData.className = "market-detail-empty";
    noData.textContent = "Vendor data unavailable for this coin";
    content.appendChild(noData);
  }
};

/**
 * Append the convenience-currency disclaimer to the modal when a non-USD
 * display currency is active. No-op otherwise.
 * @param {HTMLElement} content - Modal content container.
 * @returns {void}
 */
const _appendModalDisclaimer = (content) => {
  const currencyDisclaimer = _getRetailCurrencyDisclaimer();
  if (currencyDisclaimer) {
    const disclaimer = document.createElement("div");
    disclaimer.className = "market-disclaimer";
    disclaimer.textContent = currencyDisclaimer;
    content.appendChild(disclaimer);
  }
};

/**
 * Open and populate the main-page Retail View for one product slug.
 * @param {string} slug - Retail product slug.
 * @param {Object} [options] - Modal reconstruction options.
 * @param {boolean} [options.preservePeriod=false] - Preserve UI-local range selection.
 * @returns {Promise<void>}
 */
const openMarketDetailModal = async (slug, { preservePeriod = false } = {}) => {
  const overlay = safeGetElement("marketDetailModal");
  const content = safeGetElement("marketDetailContent");
  if (!(overlay instanceof HTMLElement) || !(content instanceof HTMLElement)) return;

  const renderGeneration = ++_activeModalRenderGeneration;
  if (!preservePeriod) _activeModalPeriodId = MARKET_DETAIL_DEFAULT_PERIOD_ID;
  _destroyActiveMarketDetailChart();
  _activeModalSlug = slug;
  const dialog = overlay.querySelector(".market-detail-modal");
  // Clearing the content drops focus to the body, outside the trap's keydown listener.
  if (content.contains(document.activeElement) && dialog instanceof HTMLElement) dialog.focus();
  content.textContent = "";
  // A re-render of an open modal keeps the original opener and trap.
  const isFreshOpen = overlay.hasAttribute("hidden");
  overlay.removeAttribute("hidden");
  if (isFreshOpen) {
    // The body is no opener: Safari leaves it active after a button click.
    const active = document.activeElement;
    _activeModalOpener =
      active instanceof HTMLElement &&
      active !== document.body &&
      active !== document.documentElement
        ? active
        : null;
    document.body.style.overflow = "hidden";
    if (typeof trapFocus === "function") trapFocus(overlay, closeMarketDetailModal);
    if (dialog instanceof HTMLElement) dialog.focus();
  }

  const closeBtn = safeGetElement("marketDetailCloseBtn");
  if (closeBtn instanceof HTMLElement) closeBtn.onclick = () => closeMarketDetailModal();
  overlay.onclick = (e) => {
    if (e.target === overlay) closeMarketDetailModal();
  };

  const loadingEl = document.createElement("div");
  loadingEl.className = "market-detail-loading";
  loadingEl.textContent = "Loading coin details\u2026";
  content.appendChild(loadingEl);

  const coinMetaMap = _getCoinMeta();
  const vendorMeta = _getVendorMeta();

  const coinMeta = _resolveCoinMetaPreferMap(slug, coinMetaMap);

  const metalLower = (coinMeta.metal || "").toLowerCase();
  const metalCode = _METAL_TO_ISO[metalLower] || metalLower;

  const modalData = await _fetchModalData(slug);
  if (
    renderGeneration !== _activeModalRenderGeneration ||
    _activeModalSlug !== slug ||
    overlay.hasAttribute("hidden")
  ) {
    return;
  }
  const { detail } = modalData;

  // Focus moves to the title when it sits on the dialog box or was lost with the old content.
  const dialogBox = overlay.querySelector(".market-detail-modal");
  const focusOnBox = document.activeElement === dialogBox;
  content.textContent = "";

  const weightOz = (detail && detail.weight_oz) || coinMeta.weight || 0;
  _buildModalHeader(
    content,
    coinMeta,
    slug,
    metalCode,
    metalLower,
    weightOz,
    _detailWindowTime(detail, null)
  );
  const title = safeGetElement("marketDetailTitle");
  if (
    title instanceof HTMLElement &&
    _isTopModal(overlay) &&
    (focusOnBox || !overlay.contains(document.activeElement))
  ) {
    title.focus();
  }

  const updateSummary = _buildModalPriceSummary(content);

  _buildModalChartSection(content, modalData, vendorMeta, updateSummary, _activeModalPeriodId);

  // ── Vendor comparison table ──
  _buildModalVendorTable(content, detail, slug, vendorMeta, metalCode, weightOz);

  _appendModalDisclaimer(content);

  debugLog("[market-data] Detail modal opened for: " + slug, "info");
};

/**
 * Coalesce two alias fields to the first non-nullish value, else null.
 * @param {*} a - Preferred value.
 * @param {*} b - Fallback value.
 * @returns {*} a if non-nullish, otherwise b if non-nullish, otherwise null.
 */
const _coalesce = (a, b) => a ?? b ?? null;

/**
 * Normalize a detail.vendors map so each vendor carries both in_stock and
 * inStock booleans (true only when either source flag is strictly true).
 * @param {Object} detailVendors - Raw per-vendor map from a retail detail payload.
 * @returns {Object} New map with normalized stock flags (originals spread first).
 */
const _normalizeDetailVendors = (detailVendors) => {
  const vendors = {};
  for (const [vid, vendor] of Object.entries(detailVendors)) {
    const inStock = vendor.in_stock === true || vendor.inStock === true;
    vendors[vid] = {
      ...vendor,
      in_stock: inStock,
      inStock,
    };
  }
  return vendors;
};

/**
 * Return a normalized, alias-filled copy of a slug's retail detail from the
 * in-memory cache (falling back to the coins summary), or null if absent.
 * Normalizes vendor stock flags and back-fills median/low/high aliases.
 * @param {string} slug - Retail coin slug.
 * @param {Object|null} coins - Retail coins summary map (fallback source).
 * @returns {Object|null} Normalized detail object, or null when unavailable.
 */
const _getCachedRetailDetail = (slug, coins) => {
  const detail = _cachedSlugDetail[slug] || (coins && coins[slug]);
  if (!detail || !detail.vendors || typeof detail.vendors !== "object") return null;

  return {
    ...detail,
    median: _coalesce(detail.median, detail.median_price),
    median_price: _coalesce(detail.median_price, detail.median),
    low: _coalesce(detail.low, detail.lowest_price),
    lowest_price: _coalesce(detail.lowest_price, detail.low),
    high: _coalesce(detail.high, detail.highest_price),
    highest_price: _coalesce(detail.highest_price, detail.high),
    vendors: _normalizeDetailVendors(detail.vendors),
  };
};

/**
 * Replace the vendor table area with a single centered status message.
 * @param {HTMLElement} tableWrap - The ".vp-table-area" container.
 * @param {string} text - Message text.
 * @param {{label: string, onClick: Function}} [action] - Optional button under the message.
 * @returns {void}
 */
const _renderVendorTableMessage = (tableWrap, text, action) => {
  tableWrap.textContent = "";
  const msg = document.createElement("div");
  msg.className = "vp-message";
  msg.setAttribute("role", "status");
  const line = document.createElement("p");
  line.className = "vp-message-text";
  line.textContent = text;
  msg.appendChild(line);
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "market-block-btn vp-message-action";
    btn.textContent = action.label;
    btn.addEventListener("click", action.onClick);
    msg.appendChild(btn);
  }
  tableWrap.appendChild(msg);
};

/**
 * True when the metal scope holds priced coins but the Market filter hides every dealer.
 * @param {string} metalCode - ISO metal code or "all".
 * @param {Object} coins - Retail coins summary map.
 * @param {Object|null} coinMetaMap - Manifest coin-meta map.
 * @returns {boolean} True when the empty table is the filter's doing, not missing data.
 */
const _scopeHiddenByFilter = (metalCode, coins, coinMetaMap) =>
  typeof _isMarketItemEnabled === "function" &&
  Object.keys(coins).some((slug) => {
    const meta = _getRetailCoinMetaForSlug(slug, coinMetaMap);
    const metalLower = (meta.metal || "").toLowerCase();
    const isoCode = _METAL_TO_ISO[metalLower] || metalLower;
    const inScope =
      metalCode === "all" ? isoCode in _VENDOR_TABLE_METAL_LABELS : isoCode === metalCode;
    const vids = Object.keys((coins[slug] && coins[slug].vendors) || {});
    return inScope && vids.length > 0 && !vids.some((vid) => _isMarketItemEnabled(slug, vid));
  });

/**
 * Build the ordered list of coin rows for a metal scope. For the "all" scope,
 * rows are grouped by metal in xau→xag→xpt→xpd→goldback order and sorted by name
 * within each group; for a single metal, all matching rows are name-sorted.
 * Slugs whose every vendor is filter-disabled are skipped.
 * @param {string} metalCode - ISO metal code or "all".
 * @param {Object} coins - Retail coins summary map.
 * @param {Object|null} coinMetaMap - Manifest coin-meta map.
 * @returns {Array<{slug:string, meta:Object, isoCode:string}>} Ordered rows.
 */
const _collectVendorTableRows = (metalCode, coins, coinMetaMap) => {
  const rowComparator = (a, b) =>
    String(a.meta.name || a.slug).localeCompare(String(b.meta.name || b.slug), undefined, {
      numeric: true,
    }) || a.slug.localeCompare(b.slug);
  const allScopeOrder = ["xau", "xag", "xpt", "xpd", "goldback"];
  const isAllScope = metalCode === "all";
  const metalSlugs = [];
  const rowsByIsoCode = {};
  const slugs = Object.keys(coins);
  for (const slug of slugs) {
    const meta = _getRetailCoinMetaForSlug(slug, coinMetaMap);
    const metalLower = (meta.metal || "").toLowerCase();
    const isoCode = _METAL_TO_ISO[metalLower] || metalLower;
    if (isAllScope ? allScopeOrder.includes(isoCode) : isoCode === metalCode) {
      // STAK-515: Skip slugs where ALL vendors are disabled by market filter
      if (typeof _isMarketItemEnabled === "function") {
        const coin = coins[slug];
        if (coin && coin.vendors) {
          const vids = Object.keys(coin.vendors);
          if (vids.length > 0 && !vids.some((vid) => _isMarketItemEnabled(slug, vid))) continue;
        }
      }
      if (isAllScope) {
        if (!rowsByIsoCode[isoCode]) rowsByIsoCode[isoCode] = [];
        rowsByIsoCode[isoCode].push({ slug, meta, isoCode });
      } else {
        metalSlugs.push({ slug, meta, isoCode });
      }
    }
  }
  if (isAllScope) {
    for (const isoCode of allScopeOrder) {
      const groupRows = rowsByIsoCode[isoCode];
      if (!groupRows || groupRows.length === 0) continue;
      groupRows.sort(rowComparator);
      metalSlugs.push(...groupRows);
    }
  } else {
    metalSlugs.sort(rowComparator);
  }
  return metalSlugs;
};

/**
 * Resolve a normalized retail-detail map for the given rows, using cached detail
 * where available and fetching the rest in parallel (failures resolve to null).
 * Also refreshes the in-memory _cachedSlugDetail entries. Each detail keeps the
 * windowTime of its prices from when it was first cached, so a tooltip names their time.
 * @param {Array<{slug:string}>} metalSlugs - Ordered rows (slugs read).
 * @param {Object} coins - Retail coins summary map (cache fallback).
 * @returns {Promise<Object>} Map of slug to normalized detail.
 */
const _resolveVendorDetailMap = async (metalSlugs, coins) => {
  const detailMap = {};
  const missingSlugs = [];
  const snapshotWindow = _snapshotWindowTime();
  const generation = _cachedSlugDetailGeneration;
  for (const { slug } of metalSlugs) {
    const cachedDetail = _getCachedRetailDetail(slug, coins);
    if (cachedDetail) {
      // A stored null stays null: a newer snapshot's window would mislabel the cached prices.
      if (!("windowTime" in cachedDetail)) {
        cachedDetail.windowTime = _detailWindowTime(cachedDetail, snapshotWindow);
      }
      detailMap[slug] = cachedDetail;
      _cachedSlugDetail[slug] = cachedDetail;
    } else {
      missingSlugs.push(slug);
    }
  }

  if (missingSlugs.length > 0) {
    // STRK-249 (C.5): routed through _marketV2Fetch with the strict freshness gate
    // so a stale-but-200 api1 origin fails over to api2 instead of short-circuiting;
    // _marketV2Fetch resolves the parsed envelope, so consume json.data directly.
    const fetchPromises = missingSlugs.map((slug) =>
      _marketV2Fetch("/retail/" + slug + "/latest.json", { validate: _strictMarketFreshness })
        .then((json) => ({ slug, data: json && json.data ? json.data : null }))
        .catch(() => ({ slug, data: null }))
    );

    const results = await Promise.allSettled(fetchPromises);
    for (const r of results) {
      if (r.status === "fulfilled" && r.value && r.value.data) {
        const normalized = _getCachedRetailDetail(r.value.slug, { [r.value.slug]: r.value.data });
        if (normalized) {
          normalized.windowTime = _detailWindowTime(normalized, snapshotWindow);
          detailMap[r.value.slug] = normalized;
          // A fetch from before a sync holds old prices, so it fills this render only.
          if (generation === _cachedSlugDetailGeneration) {
            _cachedSlugDetail[r.value.slug] = normalized;
          }
        }
      }
    }
  }
  return detailMap;
};

/**
 * Collect the set of filter-enabled vendor ids present across all rows, sorted
 * by short vendor name then id.
 * @param {Array<{slug:string}>} metalSlugs - Ordered rows.
 * @param {Object} detailMap - Map of slug to normalized detail.
 * @returns {string[]} Sorted vendor ids.
 */
const _collectEnabledVendorIds = (metalSlugs, detailMap) => {
  const allVendorIds = new Set();
  for (const { slug } of metalSlugs) {
    const detail = detailMap[slug];
    const vendors = detail && detail.vendors;
    if (!vendors) continue;
    for (const vid in vendors) {
      if (typeof _isMarketItemEnabled === "function" && !_isMarketItemEnabled(slug, vid)) {
        continue;
      }
      allVendorIds.add(vid);
    }
  }

  return Array.from(allVendorIds).sort(
    (a, b) => String(_shortVendor(a)).localeCompare(String(_shortVendor(b))) || a.localeCompare(b)
  );
};

/**
 * Build the vendor matrix table header row (ITEM, one column per vendor, then
 * MEDIAN and SPREAD).
 * @param {string[]} vendorIds - Sorted vendor ids.
 * @returns {HTMLTableSectionElement} The thead element.
 */
const _buildVendorTableHead = (vendorIds) => {
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const addHeader = (text) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = text;
    headRow.appendChild(th);
    return th;
  };
  addHeader("ITEM");

  for (const vid of vendorIds) {
    const th = addHeader(_shortVendor(vid));
    th.style.color =
      typeof getRetailVendorColor === "function" ? getRetailVendorColor(vid) : "var(--text-muted)";
  }

  addHeader("MEDIAN NOW");
  addHeader("SPREAD");

  thead.appendChild(headRow);
  return thead;
};

/**
 * Collect in-stock, non-carried, positive prices for a coin's enabled vendors.
 * @param {Object} vData - Per-vendor data map for one coin.
 * @param {string} slug - Retail coin slug (for the market-filter check).
 * @returns {number[]} In-stock vendor prices.
 */
const _computeInStockPrices = (vData, slug) => {
  const inStockPrices = [];
  for (const vid in vData) {
    // STAK-515: Skip disabled vendors in price calculations
    if (typeof _isMarketItemEnabled === "function" && !_isMarketItemEnabled(slug, vid)) continue;
    const _vs = vData[vid];
    const price = _vs ? Number(_vs.price) : NaN;
    if (Number.isFinite(price) && price > 0 && _isVendorInStock(_vs) && !_vs.carried) {
      inStockPrices.push(price);
    }
  }
  return inStockPrices;
};

/**
 * Build one vendor price cell for the matrix: a muted dash for disabled vendors
 * or missing data, an OOS marker when out of stock, otherwise the price (with a
 * best-price highlight, a "Last seen" tooltip, click-to-vendor link, and premium badge).
 * @param {string} slug - Retail coin slug.
 * @param {string} vid - Vendor id.
 * @param {Object} vData - Per-vendor data map for the coin.
 * @param {(number|null)} lowestPrice - Lowest in-stock price in the row (for highlight).
 * @param {(number|null)} spotPrice - Spot price for the metal.
 * @param {number} weightOz - Coin weight in troy ounces.
 * @param {string} isoCode - ISO metal code (Goldback premium uses the G1 rate).
 * @param {Object} vendorMeta - Vendor-meta map (for the URL fallback).
 * @param {string} itemName - Display name of the coin (price button name).
 * @param {Object} [rank] - Row rank from _rankVendorData; computed from vData when absent.
 * @param {(string|null)} [windowTime] - ISO price window that a fresh price was seen in.
 * @returns {HTMLTableCellElement} The price cell.
 */
const _buildVendorPriceCell = (
  slug,
  vid,
  vData,
  lowestPrice,
  spotPrice,
  weightOz,
  isoCode,
  vendorMeta,
  itemName,
  rank = _rankVendorData(vData, slug),
  windowTime = null
) => {
  // STAK-515: Skip disabled vendor cells
  if (typeof _isMarketItemEnabled === "function" && !_isMarketItemEnabled(slug, vid)) {
    const skipTd = document.createElement("td");
    skipTd.textContent = "—";
    skipTd.className = "vp-muted";
    return skipTd;
  }
  const td = document.createElement("td");
  const vInfo = vData[vid];

  if (!vInfo) {
    td.textContent = "—";
    td.className = "vp-muted";
    return td;
  }

  if (!_isVendorInStock(vInfo)) {
    td.classList.add("vp-oos");
    const oosSpan = document.createElement("span");
    oosSpan.textContent = "OOS";
    td.appendChild(oosSpan);
    return td;
  }

  if (vInfo.carried && vInfo.price != null) {
    td.classList.add("vp-carried");
  }

  if (Number(vInfo.price) === lowestPrice && !vInfo.carried) td.classList.add("vp-best");
  // A carried price was seen before this window, so only its carried_from names the time.
  const lastSeen = _lastSeenTitle(vInfo.carried ? vInfo.carried_from : windowTime);

  let premium = null;
  if (spotPrice && spotPrice > 0 && weightOz > 0) {
    premium = _calcMarketPremium(vInfo.price, spotPrice * weightOz);
  } else if (isoCode === "goldback" && _goldbackG1Rate > 0 && vInfo.price > 0) {
    premium = _calcMarketPremium(vInfo.price, _goldbackG1Rate);
  }
  const premiumText = premium != null ? (premium >= 0 ? "+" : "") + premium.toFixed(1) + "%" : "";

  // A safe dealer URL makes the price a button; its name matches the ticker items.
  const url = _resolveVendorUrl(slug, vid, vendorMeta);
  const isLink = _isSafeUrl(url);
  const priceEl = document.createElement(isLink ? "button" : "span");
  priceEl.className = "vp-price";
  priceEl.textContent = formatCurrency(vInfo.price);
  if (isLink) {
    priceEl.type = "button";
    const premiumPart = premiumText
      ? `, premium ${premiumText}${_medianDistancePhrase(rank.byId[vid])}`
      : "";
    // Title tooltips never show on touch or keyboard focus, so the name carries the time too.
    // An en-CA time can end in "a.m.", which already closes the sentence.
    const seenPart = lastSeen ? ` ${lastSeen}${lastSeen.endsWith(".") ? "" : "."}` : "";
    priceEl.setAttribute(
      "aria-label",
      `${itemName} at ${_shortVendor(vid)}, ${formatCurrency(vInfo.price)}${premiumPart}.${seenPart} Opens the dealer page in a new window.`
    );
    priceEl.addEventListener("click", () => {
      _openVendorPopup(url, vid);
    });
  }
  td.appendChild(priceEl);

  if (premium != null) {
    td.appendChild(_buildPremiumBadge(premiumText, rank.byId[vid]));
  }

  if (lastSeen) {
    td.title = lastSeen;
    // A plain price has no name to carry the time, so hidden text reads it after the premium.
    if (!isLink) {
      const seenText = document.createElement("span");
      seenText.className = "sr-only";
      seenText.textContent = `, ${lastSeen}`;
      td.appendChild(seenText);
    }
  }

  return td;
};

/**
 * Build one coin row for the vendor matrix: the clickable coin name, one price
 * cell per vendor, and the median and spread cells.
 * @param {Object} row - Context from _vendorRowContext.
 * @param {string[]} vendorIds - Sorted vendor ids (column order).
 * @param {Object} vendorMeta - Vendor-meta map.
 * @returns {HTMLTableRowElement} The row element.
 */
const _buildVendorTableRow = (row, vendorIds, vendorMeta) => {
  const tr = document.createElement("tr");
  const tdName = document.createElement("td");
  tdName.appendChild(_buildCoinNameButton(row.slug, row.displayName));
  tr.appendChild(tdName);

  for (const vid of vendorIds) tr.appendChild(_buildRowPriceCell(row, vid, vendorMeta));

  for (const text of [row.medianText, row.spreadText]) {
    const td = document.createElement("td");
    td.className = "vp-stat";
    td.textContent = text;
    tr.appendChild(td);
  }
  return tr;
};

/**
 * Collect what a matrix row and a phone card both show for one coin.
 * @param {{slug:string, meta:Object, isoCode:string}} rowInfo - Row descriptor.
 * @param {Object} detailMap - Map of slug to normalized detail.
 * @returns {(Object|null)} Row context, or null when the coin has no vendor detail.
 */
const _vendorRowContext = (rowInfo, detailMap) => {
  const { slug, meta, isoCode } = rowInfo;
  const detail = detailMap[slug];
  if (!detail || !detail.vendors) return null;

  const vData = detail.vendors;
  const inStockPrices = _computeInStockPrices(vData, slug);
  const lowestPrice = inStockPrices.length > 0 ? Math.min(...inStockPrices) : null;
  const highestPrice = inStockPrices.length > 0 ? Math.max(...inStockPrices) : null;
  // The Median shown is the median the premium color compares against.
  const rank = _rankVendorData(vData, slug);
  const medianVal = rank.median;

  return {
    slug,
    isoCode,
    vData,
    rank,
    lowestPrice,
    displayName: meta.name || slug,
    weightOz: detail.weight_oz || meta.weight || 0,
    spotPrice: _getSpotPrice(isoCode),
    windowTime: detail.windowTime || null,
    medianText: medianVal != null ? formatCurrency(medianVal) : "—",
    // The summary may lack high and low, so the spread comes from the in-stock prices.
    spreadText:
      lowestPrice != null && highestPrice !== lowestPrice
        ? formatCurrency(highestPrice - lowestPrice)
        : "—",
  };
};

/**
 * Build one vendor price cell from a row context.
 * @param {Object} row - Context from _vendorRowContext.
 * @param {string} vid - Vendor id.
 * @param {Object} vendorMeta - Vendor-meta map.
 * @returns {HTMLTableCellElement} The price cell.
 */
const _buildRowPriceCell = (row, vid, vendorMeta) =>
  _buildVendorPriceCell(
    row.slug,
    vid,
    row.vData,
    row.lowestPrice,
    row.spotPrice,
    row.weightOz,
    row.isoCode,
    vendorMeta,
    row.displayName,
    row.rank,
    row.windowTime
  );

/**
 * Build the item name button that opens the detail modal.
 * @param {string} slug - Retail coin slug.
 * @param {string} displayName - Item name shown on the button.
 * @returns {HTMLButtonElement} The name button.
 */
const _buildCoinNameButton = (slug, displayName) => {
  const nameBtn = document.createElement("button");
  nameBtn.type = "button";
  nameBtn.textContent = displayName;
  nameBtn.className = "vp-coin-link";
  nameBtn.dataset.slug = slug;
  nameBtn.setAttribute("aria-haspopup", "dialog");
  nameBtn.addEventListener("click", () => {
    openMarketDetailModal(slug);
  });
  return nameBtn;
};

/**
 * Build one phone card: the item name, the median and spread, and a tile per dealer
 * that lists the item. Tiles reuse the matrix cell content, so prices stay dealer buttons.
 * @param {Object} row - Context from _vendorRowContext.
 * @param {string[]} vendorIds - Sorted vendor ids (tile order).
 * @param {Object} vendorMeta - Vendor-meta map.
 * @returns {HTMLLIElement} The card.
 */
const _buildVendorCard = (row, vendorIds, vendorMeta) => {
  const card = document.createElement("li");
  card.className = "vp-card";
  card.appendChild(_buildCoinNameButton(row.slug, row.displayName));

  const metaLine = document.createElement("p");
  metaLine.className = "vp-card-meta";
  for (const [label, text] of [
    ["Median now", row.medianText],
    ["Spread", row.spreadText],
  ]) {
    const part = document.createElement("span");
    part.textContent = `${label} `;
    const figure = document.createElement("b");
    figure.textContent = text;
    part.appendChild(figure);
    metaLine.appendChild(part);
  }
  card.appendChild(metaLine);

  const dealers = document.createElement("ul");
  dealers.className = "vp-card-dealers";
  for (const vid of vendorIds) {
    const cell = _buildRowPriceCell(row, vid, vendorMeta);
    // A muted dash means the dealer does not list the item, so it gets no tile.
    if (cell.classList.contains("vp-muted")) continue;
    const tile = document.createElement("li");
    tile.className = `vp-card-dealer ${cell.className}`.trim();
    if (cell.title) tile.title = cell.title;
    const vendor = document.createElement("span");
    vendor.className = "vp-card-vendor";
    // Brand colors fail 4.5:1 as text, so the color marks a dot beside the name.
    const dot = document.createElement("span");
    dot.className = "vp-card-vendor-dot";
    dot.setAttribute("aria-hidden", "true");
    if (typeof getRetailVendorColor === "function") dot.style.color = getRetailVendorColor(vid);
    vendor.append(dot, _shortVendor(vid));
    tile.appendChild(vendor);
    tile.append(...cell.childNodes);
    // Touch never shows the title, so a carried tile says when it was last seen.
    if (cell.classList.contains("vp-carried") && cell.title) {
      const seen = document.createElement("span");
      seen.className = "vp-card-seen";
      seen.textContent = cell.title;
      tile.appendChild(seen);
    }
    dealers.appendChild(tile);
  }
  card.appendChild(dealers);
  return card;
};

/** Metal tab labels, keyed by tab code, that name the matrix in its caption. */
const _VENDOR_TABLE_METAL_LABELS = {
  all: "All",
  xau: "Gold",
  xag: "Silver",
  xpt: "Platinum",
  xpd: "Palladium",
  goldback: "Goldback",
};

/**
 * Renders the dealer matrix and phone cards for one metal tab. Only the newest
 * render draws after the detail fetch, so a slow older render cannot replace it.
 * @param {string} metalCode - Metal tab code (all, xau, xag, xpt, xpd, goldback).
 * @returns {Promise<void>}
 */
const _renderVendorTable = async (metalCode) => {
  const container = safeGetElement("vendorPricesContainer");
  if (!container) return;
  _vendorTableRenderSeq += 1;
  const renderSeq = _vendorTableRenderSeq;

  let tableWrap = container.querySelector(".vp-table-area");
  if (!tableWrap) {
    tableWrap = document.createElement("div");
    tableWrap.className = "vp-table-area";
    container.appendChild(tableWrap);
  }

  const coins = _getRetailCoins();
  const coinMetaMap = _getCoinMeta();
  const vendorMeta = _getVendorMeta();

  const metalSlugs = _collectVendorTableRows(metalCode, coins, coinMetaMap);

  if (metalSlugs.length === 0) {
    if (_scopeHiddenByFilter(metalCode, coins, coinMetaMap)) {
      _renderVendorTableMessage(tableWrap, "All dealers are hidden by your Market filter.", {
        label: "Open Market settings",
        onClick: () => {
          if (typeof showSettingsModal === "function") showSettingsModal("market");
        },
      });
    } else {
      _renderVendorTableMessage(tableWrap, "No coins tracked for this metal");
    }
    return;
  }

  _renderVendorTableMessage(tableWrap, "Loading vendor prices\u2026");

  const detailMap = await _resolveVendorDetailMap(metalSlugs, coins);
  if (renderSeq !== _vendorTableRenderSeq) return;

  const vendorIds = _collectEnabledVendorIds(metalSlugs, detailMap);

  if (vendorIds.length === 0) {
    _renderVendorTableMessage(tableWrap, "No vendor data available for this metal");
    return;
  }

  tableWrap.textContent = "";
  const scrollWrap = document.createElement("div");
  scrollWrap.className = "vp-scroll";

  const table = document.createElement("table");
  table.className = "vendor-prices-table";

  const caption = document.createElement("caption");
  caption.className = "sr-only";
  const scopeLabel = `${_VENDOR_TABLE_METAL_LABELS[metalCode] || "All"} dealer prices`;
  caption.textContent = scopeLabel;
  table.appendChild(caption);

  table.appendChild(_buildVendorTableHead(vendorIds));

  const tbody = document.createElement("tbody");
  // Phones below 480px show the cards and desktops the matrix; CSS hides the other one.
  const cards = document.createElement("ul");
  cards.className = "vp-cards";
  cards.setAttribute("aria-label", scopeLabel);

  for (const rowInfo of metalSlugs) {
    const row = _vendorRowContext(rowInfo, detailMap);
    if (!row) continue;
    tbody.appendChild(_buildVendorTableRow(row, vendorIds, vendorMeta));
    cards.appendChild(_buildVendorCard(row, vendorIds, vendorMeta));
  }

  table.appendChild(tbody);
  scrollWrap.appendChild(table);
  tableWrap.appendChild(scrollWrap);
  tableWrap.appendChild(cards);
  _applyPendingMarketFocus();

  // STAK-513: Removed redundant renderBestPriceTicker() call here.
  // Both initMarketData and refreshMarketData already call it — re-calling
  // inside the async _renderVendorTable completion was the primary trigger
  // for the stale-reference race that duplicated ticker rows.
};

/**
 * True while a user-initiated market refresh is running.
 *
 * Module-scoped rather than closed over the button element because a completing
 * sync calls refreshMarketData() → renderVendorPrices(), which rebuilds the
 * control. A captured node reference would be detached by the time the refresh
 * finished, so the in-flight state has to live outside the DOM.
 */
let _marketRefreshInProgress = false;

/**
 * Text of the last failed manual refresh, or null. Module-scoped because each sync
 * rebuilds the header; any later sync that stores new prices clears it.
 */
let _marketRefreshFailure = null;

/**
 * Names what failed in a manual refresh and what the user still sees.
 * @returns {string} Failure message for the Market header
 */
const _marketRefreshFailureText = () =>
  navigator.onLine === false
    ? "Refresh failed: you are offline. The last prices stay shown."
    : "Refresh failed: the price server did not respond. The last prices stay shown.";

/**
 * Builds the header line that reports a failed refresh.
 * @param {string} text - Failure message
 * @returns {HTMLParagraphElement} The status line
 */
const _buildMarketRefreshFailureLine = (text) => {
  const line = document.createElement("p");
  line.className = "market-refresh-failure";
  line.setAttribute("role", "status");
  line.textContent = text;
  return line;
};

/**
 * Stores the refresh failure and shows or removes its line in the mounted header.
 * @param {(string|null)} text - Failure message, or null to clear it
 * @returns {void}
 */
const _setMarketRefreshFailure = (text) => {
  _marketRefreshFailure = text;
  const header = document.querySelector("#vendorPricesContainer .market-block-header");
  if (!header) return;
  const existing = header.querySelector(".market-refresh-failure");
  if (existing) existing.remove();
  if (text) header.appendChild(_buildMarketRefreshFailureLine(text));
};

if (typeof document !== "undefined") {
  // A sync dispatches this before its refreshMarketData() render, so the render reads the new prices.
  document.addEventListener("retail:updated", () => {
    _clearCachedSlugDetail();
    _setMarketRefreshFailure(null);
  });
}

/**
 * Paints one refresh button to match the current refresh state.
 * @param {HTMLButtonElement} btn - The control to paint
 * @returns {void}
 */
const _paintMarketRefreshBtn = (btn) => {
  if (!(btn instanceof HTMLButtonElement)) return;
  btn.disabled = _marketRefreshInProgress;
  btn.textContent = _marketRefreshInProgress ? "↻…" : "↻ Refresh";
};

/**
 * Repaints the live refresh button, if the market block is currently rendered.
 *
 * safeGetElement returns a truthy dummy for a missing id, so the instanceof
 * check in _paintMarketRefreshBtn is what makes this safe to call when the
 * Market block has not rendered yet.
 * @returns {void}
 */
const _syncMarketRefreshBtnState = () => {
  _paintMarketRefreshBtn(safeGetElement("marketRefreshBtn"));
};

/**
 * Runs a user-initiated market refresh from the Market block (STRK-290).
 *
 * Calls syncRetailPrices(), which pulls unconditionally. The control used to
 * call startRetailBackgroundSync(), whose body sits behind
 * `if (isStale || missingProviders || missingSlugs)` with a one-hour staleness
 * budget and no else branch — so on data younger than an hour the click did
 * nothing at all, while a hardcoded 5s timeout restored the button and made it
 * look like a refresh had happened.
 *
 * ui:false because the shared progress machinery inside syncRetailPrices
 * addresses Settings' #retailSyncBtn by id; this control owns its own state and
 * drives it off the awaited promise instead of a timer.
 *
 * A click during the background sync awaits that sync's result, because
 * syncRetailPrices shares the running promise. A failure line stays until the
 * retail:updated listener clears it after a sync that loads prices.
 * @returns {Promise<void>}
 */
const _runMarketRefresh = async () => {
  if (_marketRefreshInProgress) return;
  _marketRefreshInProgress = true;
  _syncMarketRefreshBtnState();
  try {
    if (typeof syncRetailPrices === "function") {
      const result = await syncRetailPrices({ ui: false });
      if (result && result.ok === false) _setMarketRefreshFailure(_marketRefreshFailureText());
    }
    // syncRetailPrices covers vendor/retail feeds but never fetches
    // goldback/latest.json, so the G1 benchmark would stay stale and Goldback
    // premiums would keep rendering against the old rate until reload. The
    // control's previous implementation reached this via
    // `_marketDataInitialized = false; initMarketData()`; calling the seeder
    // directly gets the same refresh without re-running all of init.
    await _seedAndRefreshGoldbackG1Rate();
    // Repaint with the refreshed G1 rate — syncRetailPrices' own
    // refreshMarketData() already ran, but it did so before this fetch.
    if (typeof refreshMarketData === "function") refreshMarketData();
  } catch (e) {
    debugLog(`[market-data] Manual market refresh failed: ${e?.message ?? e}`, "warn");
    _setMarketRefreshFailure(_marketRefreshFailureText());
  } finally {
    _marketRefreshInProgress = false;
    // syncRetailPrices' own finally re-renders the block, so this repaints
    // whichever button is mounted now — the original or its replacement.
    _syncMarketRefreshBtnState();
    if (typeof updateMarketHealthDot === "function") updateMarketHealthDot();
  }
};

/**
 * Builds the gear icon the app header's Settings button draws, for the Configure button.
 * @returns {SVGSVGElement} A decorative 16px icon that inherits the text color.
 */
const _buildGearIcon = () => {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "market-block-icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const hub = document.createElementNS(ns, "circle");
  hub.setAttribute("cx", "12");
  hub.setAttribute("cy", "12");
  hub.setAttribute("r", "3");
  const teeth = document.createElementNS(ns, "path");
  teeth.setAttribute(
    "d",
    "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
  );
  svg.append(hub, teeth);
  return svg;
};

/**
 * Builds the Market block's header row: timestamp, freshness dot, Refresh, Configure.
 *
 * Extracted from renderVendorPrices (STRK-290) so it can render in BOTH the
 * populated and the empty-data branches. Previously the empty branch returned
 * before this markup existed, which was survivable only while the retired
 * #headerMarketBtn provided an always-available market pull. Without that
 * button, a fresh install or a failed first sync would show "Retail data
 * unavailable" with no way to retry — and the background poll does not try
 * again for 30 minutes.
 * @returns {HTMLDivElement} The assembled header row, ready to append
 */
const _buildMarketBlockHeader = () => {
  const headerRow = document.createElement("div");
  headerRow.className = "market-block-header";

  const heading = document.createElement("h2");
  heading.className = "market-block-title";
  heading.textContent = "Market prices";
  headerRow.appendChild(heading);

  const rightGroup = document.createElement("div");
  rightGroup.className = "market-block-actions";

  // The time, the age word and the dot read as one status; the word carries the meaning.
  const statusGroup = document.createElement("span");
  statusGroup.className = "market-block-status";
  statusGroup.setAttribute("aria-live", "polite");

  const tsSpan = document.createElement("span");
  tsSpan.id = "marketDataTimestamp";
  const retailData = loadDataSync("v2RetailPrices", null) || loadDataSync("retailPrices", null);
  const syncedLocal = _formatMarketTimestamp(retailData && retailData.lastSync);
  tsSpan.textContent = syncedLocal ? `Updated ${syncedLocal}` : "";
  statusGroup.appendChild(tsSpan);

  const freshnessWord = document.createElement("span");
  freshnessWord.id = "marketFreshnessStatus";
  freshnessWord.className = "market-freshness";
  statusGroup.appendChild(freshnessWord);

  // STRK-290: market freshness moved here from #headerMarketDot when the Market
  // header button retired. Same painter (updateMarketHealthDot, js/retail.js) and
  // a different base class: .cloud-sync-dot is the inline-flow dot, whereas the
  // old .header-cloud-dot was `position: absolute` for a button-corner badge and
  // dropped straight out of this flex row. That base rule is gone as of STRK-298
  // — this must stay .cloud-sync-dot, which is load-bearing, not incidental. The
  // color modifiers the painter adds are separate and still exist.
  const freshnessDot = document.createElement("span");
  freshnessDot.id = "marketFreshnessDot";
  freshnessDot.className = "cloud-sync-dot";
  freshnessDot.setAttribute("aria-hidden", "true");
  statusGroup.appendChild(freshnessDot);
  rightGroup.appendChild(statusGroup);

  const refreshBtn = document.createElement("button");
  refreshBtn.id = "marketRefreshBtn";
  refreshBtn.type = "button";
  refreshBtn.title = "Refresh market prices";
  refreshBtn.setAttribute("aria-label", "Refresh market prices");
  refreshBtn.className = "market-block-btn";
  // Painted from the module flag rather than hardcoded to the idle state: a sync
  // ends by calling refreshMarketData(), which re-runs this whole function, so a
  // freshly built button must be able to render mid-flight in the syncing state.
  _paintMarketRefreshBtn(refreshBtn);
  refreshBtn.addEventListener("click", () => {
    void _runMarketRefresh();
  });
  rightGroup.appendChild(refreshBtn);

  const settingsBtn = document.createElement("button");
  settingsBtn.id = "marketSettingsBtn";
  settingsBtn.type = "button";
  settingsBtn.title = "Market settings";
  // The name starts with the visible word, so voice control users can say "Configure".
  settingsBtn.setAttribute("aria-label", "Configure Market");
  settingsBtn.className = "market-block-btn market-block-btn--labelled";
  const settingsLabel = document.createElement("span");
  settingsLabel.className = "market-block-label";
  settingsLabel.textContent = "Configure";
  settingsBtn.append(_buildGearIcon(), settingsLabel);
  settingsBtn.addEventListener("click", () => {
    if (typeof showSettingsModal === "function") showSettingsModal("market");
  });
  rightGroup.appendChild(settingsBtn);

  headerRow.appendChild(rightGroup);
  if (_marketRefreshFailure) {
    headerRow.appendChild(_buildMarketRefreshFailureLine(_marketRefreshFailure));
  }
  return headerRow;
};

/** The ResizeObserver watching the current metal tab bar, or null. */
let _vendorTabObserver = null;

/**
 * Stop watching the current metal tab bar. A detached bar never resizes, so every
 * render calls this before it clears the container, the empty-state path included.
 * @returns {void}
 */
const _releaseVendorTabObserver = () => {
  if (_vendorTabObserver) _vendorTabObserver.disconnect();
  _vendorTabObserver = null;
};

/**
 * Keep the metal tab bar's right-edge fade on while tabs sit past the edge, and off
 * once the last tab is in view. Rechecks on scroll and whenever the bar resizes.
 * @param {HTMLElement} tabBar - The .vendor-prices-tabs element.
 * @returns {void}
 */
const _watchVendorTabOverflow = (tabBar) => {
  _releaseVendorTabObserver();
  const sync = () => {
    const hidden = tabBar.scrollWidth - tabBar.clientWidth - tabBar.scrollLeft;
    tabBar.classList.toggle("vp-tabs-more", hidden > 1);
  };
  // A rebuilt bar starts at scrollLeft 0, so the selected tab is scrolled back into view.
  // A hidden panel has no width; the resize when it shows runs this again.
  const reveal = () => {
    const active = tabBar.querySelector('button[aria-pressed="true"]');
    if (!active || tabBar.clientWidth === 0) return;
    const bar = tabBar.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    if (tab.right > bar.right) tabBar.scrollLeft += tab.right - bar.right;
    else if (tab.left < bar.left) tabBar.scrollLeft -= bar.left - tab.left;
  };
  tabBar.addEventListener("scroll", sync, { passive: true });
  if (typeof ResizeObserver === "function") {
    _vendorTabObserver = new ResizeObserver(() => {
      reveal();
      sync();
    });
    _vendorTabObserver.observe(tabBar);
  }
  reveal();
  sync();
};

const renderVendorPrices = () => {
  const container = safeGetElement("vendorPricesContainer");
  if (!container) return;

  _releaseVendorTabObserver();
  container.textContent = "";
  // Header first, unconditionally — the empty branch below needs the Refresh
  // control too, otherwise "Retail data unavailable" is a dead end (STRK-290).
  container.appendChild(_buildMarketBlockHeader());

  const coins = _getRetailCoins();
  if (!coins || Object.keys(coins).length === 0) {
    const msg = document.createElement("div");
    msg.className = "vp-message";
    msg.setAttribute("role", "status");
    msg.textContent =
      navigator.onLine === false
        ? "Retail data unavailable. You are offline. Select Refresh when you are back online."
        : "Retail data unavailable. Prices have not loaded. Select Refresh to try again.";
    container.appendChild(msg);
    if (typeof updateMarketHealthDot === "function") updateMarketHealthDot();
    return;
  }

  const tabBar = document.createElement("div");
  tabBar.className = "vendor-prices-tabs";
  tabBar.setAttribute("role", "group");
  tabBar.setAttribute("aria-label", "Metal");

  // Determine which metals have coins with data
  const coinMetaMap = _getCoinMeta();
  const metalHasCoins = {};
  for (const slug of Object.keys(coins)) {
    const meta = _getRetailCoinMetaForSlug(slug, coinMetaMap);
    const metalLower = (meta.metal || "").toLowerCase();
    const isoCode = _METAL_TO_ISO[metalLower] || metalLower;
    // STAK-515: Only count metal if at least one vendor is enabled for this slug
    if (typeof _isMarketItemEnabled === "function") {
      const coin = coins[slug];
      if (coin && coin.vendors) {
        const vids = Object.keys(coin.vendors);
        if (vids.length > 0 && !vids.some((vid) => _isMarketItemEnabled(slug, vid))) continue;
      }
    }
    metalHasCoins[isoCode] = true;
  }

  const allMetals = Object.entries(_VENDOR_TABLE_METAL_LABELS).map(([code, label]) => ({
    code,
    label,
  }));
  // Only show tabs that have coins
  const metals = allMetals.filter((m) => m.code === "all" || metalHasCoins[m.code]);

  const savedTab = loadDataSync("vendorPricesActiveTab", "all");
  let activeTab = metals.some((m) => m.code === savedTab) ? savedTab : "all";

  const setActive = (code) => {
    activeTab = code;
    saveDataSync("vendorPricesActiveTab", code);
    const btns = tabBar.querySelectorAll("button");
    btns.forEach((b) => {
      const isActive = b.getAttribute("data-metal") === code;
      b.classList.toggle("active", isActive);
      b.setAttribute("aria-pressed", String(isActive));
    });
    _renderVendorTable(code);
  };

  for (const m of metals) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vp-tab" + (m.code === activeTab ? " active" : "");
    btn.setAttribute("data-metal", m.code);
    btn.setAttribute("aria-pressed", String(m.code === activeTab));
    btn.textContent = m.label;
    btn.addEventListener("click", () => {
      setActive(m.code);
    });
    tabBar.appendChild(btn);
  }

  container.appendChild(tabBar);
  _watchVendorTabOverflow(tabBar);

  _renderVendorTable(activeTab);

  // ── Footer disclaimer ──
  const footer = document.createElement("div");
  footer.className = "market-disclaimer";
  footer.appendChild(
    document.createTextNode(
      "Market prices are best effort. Percentages show premium over spot (or G1 rate for Goldbacks); their color compares dealers."
    )
  );
  footer.appendChild(
    document.createTextNode(
      " Prices are sourced directly from vendors when possible, or provided by "
    )
  );
  const fbpLink = document.createElement("a");
  fbpLink.href = "https://findbullionprices.com";
  fbpLink.target = "_blank";
  fbpLink.rel = "noopener noreferrer";
  fbpLink.textContent = "findbullionprices.com";
  footer.appendChild(fbpLink);
  const currencyDisclaimer = _getRetailCurrencyDisclaimer();
  if (currencyDisclaimer) {
    footer.appendChild(document.createTextNode(" " + currencyDisclaimer));
  }
  container.appendChild(footer);

  // STRK-290: paint the relocated freshness dot now that it is mounted. The
  // painter's other callers (init.js boot, and _syncRetailV2 on success) can
  // both fire while this block is unrendered, so relying on them alone would
  // leave the dot unpainted until the next sync.
  if (typeof updateMarketHealthDot === "function") updateMarketHealthDot();
};

// ---------------------------------------------------------------------------
// Init / Refresh
// ---------------------------------------------------------------------------

/**
 * Seed the goldback G1 rate for first paint, then refine it from the network.
 *
 * Three phases (STRK-249):
 *  1. Seed from the fresh goldbackPrices['1'] cache so the gated premium sites
 *     (ticker / modal / vendor matrix) paint in the same pass as spot premiums —
 *     before the network fetch resolves. selectGoldbackG1Seed declines a stale
 *     value while online and preserves the last-known plain value offline.
 *  2. Refine over the network (api1 → api2 failover via the strict freshness
 *     gate) so a stale/offline seed is replaced by the latest figure, then
 *     re-render so the premium reflects it.
 *  3. US-5 offline re-seed: if the post-seed fetch fails and navigator.onLine was
 *     a false-positive (captive portal), the online seed declined the stale cache
 *     and _goldbackG1Rate is still unset → re-seed via the OFFLINE branch so the
 *     last-known value renders instead of blank, never clobbering a good rate.
 *
 * @returns {Promise<void>}
 */
const _seedAndRefreshGoldbackG1Rate = async () => {
  // Seed the goldback G1 rate from the fresh goldbackPrices['1'] cache so the
  // gated premium sites (ticker / modal / vendor matrix) paint in the same pass
  // as spot premiums — before the un-awaited network fetch below resolves.
  // selectGoldbackG1Seed (spot-ratio-math.js) declines a stale value while
  // online and preserves the last-known plain value offline.
  if (typeof selectGoldbackG1Seed === "function") {
    const seeded = selectGoldbackG1Seed(navigator.onLine);
    if (typeof seeded === "number" && seeded > 0) {
      _goldbackG1Rate = seeded;
      // Paint the seeded rate immediately so gated premium sites (ticker / vendor
      // matrix) render in lockstep with spot premiums — before the network fetch
      // below resolves. The render calls at the bottom of this function will
      // re-paint once the network refines the rate.
      renderBestPriceTicker();
      renderVendorPrices();
    }
  }

  // Fetch goldback G1 rate for premium calculation. This always runs (even when
  // a cache seed already set _goldbackG1Rate) so a stale/offline seed is refined
  // by the network; on success update the rate and re-render so the premium
  // reflects the latest figure. STRK-249 (C.5): routed through _marketV2Fetch with
  // the strict freshness gate so a stale-but-200 api1 origin fails over to api2
  // instead of short-circuiting; _marketV2Fetch resolves the parsed envelope.
  try {
    const gbJson = await _marketV2Fetch("/goldback/latest.json", {
      validate: _strictMarketFreshness,
    });
    if (gbJson && gbJson.data && gbJson.data.g1_usd) {
      _goldbackG1Rate = gbJson.data.g1_usd;
      debugLog("[market-data] Goldback G1 rate: $" + _goldbackG1Rate, "info");
    }
  } catch (e) {
    debugLog("[market-data] Goldback rate fetch failed: " + e.message, "warn");
    // STRK-249 (US-5): the post-seed network fetch failed. If navigator.onLine was
    // a false-positive (captive portal / "connected but no internet"), the ONLINE
    // seed above declined the stale cache (returned null) and _goldbackG1Rate is
    // still unset/≤0 → blank premium. Re-seed via the OFFLINE branch so the
    // last-known value (even if stale) renders instead of blank. Never clobber an
    // already-good rate (an online seed or a prior fetch).
    if ((!_goldbackG1Rate || _goldbackG1Rate <= 0) && typeof selectGoldbackG1Seed === "function") {
      const offlineSeed = selectGoldbackG1Seed(false);
      if (typeof offlineSeed === "number" && offlineSeed > 0) {
        _goldbackG1Rate = offlineSeed;
        debugLog(
          "[market-data] Goldback G1 rate re-seeded offline (last-known): $" + _goldbackG1Rate,
          "info"
        );
      }
    }
  }

  renderBestPriceTicker();
  renderVendorPrices();
};

const initMarketData = async () => {
  if (_marketDataInitialized) return;

  // Ensure v2 manifest (coin + vendor metadata) is available
  await _ensureManifest();

  let retailData = null;
  if (typeof window._v2RetailData !== "undefined" && window._v2RetailData) {
    retailData = window._v2RetailData;
  }
  if (!retailData) {
    retailData = await loadData("v2RetailPrices", null);
  }
  if (!retailData) {
    retailData = await loadData("retailPrices", null);
  }

  if (typeof window._manifestCoinMeta === "undefined" || !window._manifestCoinMeta) {
    const cached = await loadData("retailManifestCoinMeta", null);
    if (cached && typeof cached === "object") {
      window._manifestCoinMeta = cached;
    }
  }
  if (typeof window._manifestVendorMeta === "undefined" || !window._manifestVendorMeta) {
    const cached = await loadData("retailManifestVendorMeta", null);
    if (cached && typeof cached === "object") {
      window._manifestVendorMeta = cached;
    }
  }

  const coins = _getRetailCoins();
  if (!coins || Object.keys(coins).length === 0) {
    // Retail sync may still be in progress — retry after a delay (up to 3 attempts)
    if (!initMarketData._retryCount) initMarketData._retryCount = 0;
    initMarketData._retryCount++;
    if (initMarketData._retryCount <= 3) {
      const delay = initMarketData._retryCount * 5000;
      debugLog(
        "[market-data] No retail data yet — retry " +
          initMarketData._retryCount +
          "/3 in " +
          delay / 1000 +
          "s",
        "info"
      );
      _marketDataInitialized = false;
      setTimeout(() => {
        _marketDataInitialized = false;
        initMarketData().catch(() => {});
      }, delay);
      return;
    }
    debugLog(
      "[market-data] No retail data available after 3 retries — ticker hidden, vendor section empty",
      "warn"
    );
    return;
  }

  initMarketData._retryCount = 0;

  // Charts now use per-slug retail data fetched on modal open — no pre-fetch needed

  await _seedAndRefreshGoldbackG1Rate();

  _marketDataInitialized = true;
};

const refreshMarketData = () => {
  renderBestPriceTicker();
  renderVendorPrices();
};

if (typeof window !== "undefined") {
  window.addEventListener("currencychange", () => {
    try {
      if (typeof renderBestPriceTicker === "function") renderBestPriceTicker();
      if (typeof renderVendorPrices === "function") renderVendorPrices();
      const overlay = safeGetElement("marketDetailModal");
      if (_activeModalSlug && overlay instanceof HTMLElement && !overlay.hasAttribute("hidden")) {
        void openMarketDetailModal(_activeModalSlug, { preservePeriod: true }).catch((e) => {
          debugLog("[market-data] Detail modal currency refresh failed: " + e.message, "warn");
        });
      }
    } catch (e) {
      debugLog("[market-data] currencychange refresh failed: " + e.message, "warn");
    }
  });
}

// ---------------------------------------------------------------------------
// Global exposure
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  window.initMarketData = initMarketData;
  window.refreshMarketData = refreshMarketData;
  window.renderBestPriceTicker = renderBestPriceTicker;
  window.refreshTickerGeometry = refreshTickerGeometry;
  window.renderVendorPrices = renderVendorPrices;
  window.openMarketDetailModal = openMarketDetailModal;
  window.closeMarketDetailModal = closeMarketDetailModal;
  // _marketDataInitialized is a module-scoped `let`, so it is not visible on
  // window by default (state.js gotcha). Bridge it with a getter/setter so a
  // caller can re-arm a fresh init (e.g. to refine the goldback rate from the
  // network) by writing window._marketDataInitialized = false.
  Object.defineProperty(window, "_marketDataInitialized", {
    configurable: true,
    get: () => _marketDataInitialized,
    set: (v) => {
      _marketDataInitialized = v;
    },
  });
}

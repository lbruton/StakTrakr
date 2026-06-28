// js/market-data.js — Market Data Module (STAK-504)
// Orchestrates the best price ticker, vendor prices section, and market detail modal.

let _marketDataInitialized = false;
const V2_API = "https://api.staktrakr.com/data/v2";

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
/**
 * Strict v2-envelope freshness verdict for _marketV2Fetch's `validate` gate.
 * @param {any} envelope - Parsed v2 envelope ({ generated_at, stale_after, data }).
 * @returns {{ok: boolean, reason?: string}} Verdict for the _staktrakrFetch validator.
 */
const _strictMarketFreshness = (envelope) => {
  if (typeof _checkEnvelopeFreshness !== "function") return { ok: true };
  if (!envelope || typeof envelope.stale_after !== "number" || envelope.stale_after <= 0) {
    return { ok: true };
  }
  return _checkEnvelopeFreshness(envelope, { multiplier: 1, floorMs: 0 });
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
let _goldbackG1Rate = null;

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

const TICKER_SPEED_PIXELS_PER_SECOND = 127;
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

const _finalizeTickerTrack = (container, track, primaryBlock, phase = 0, previousTrack = null) => {
  const loopWidth = Math.ceil(primaryBlock.getBoundingClientRect().width);

  track.style.removeProperty("left");
  track.style.removeProperty("top");
  track.style.removeProperty("position");
  track.style.removeProperty("pointer-events");
  track.style.removeProperty("visibility");

  if (!(loopWidth > 0)) {
    track.classList.add("static");
    track.dataset.loopWidth = "0";
    track.style.removeProperty("--ticker-loop-distance");
    track.style.removeProperty("--ticker-duration");
    track.style.removeProperty("animation-delay");
  } else {
    const durationSeconds = Math.max(
      MIN_TICKER_DURATION_SECONDS,
      loopWidth / TICKER_SPEED_PIXELS_PER_SECOND
    );
    track.dataset.loopWidth = String(loopWidth);
    track.style.setProperty("--ticker-loop-distance", `${loopWidth}px`);
    track.style.setProperty("--ticker-duration", `${durationSeconds.toFixed(3)}s`);
    track.style.animationDelay = phase > 0 ? `-${(phase * durationSeconds).toFixed(3)}s` : "0s";
  }

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
  const vendorColor = vendorMeta[bestVid] ? vendorMeta[bestVid].color : null;
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
 * price, premium badge). Clickable when the vendor URL is safe.
 * @param {Object} item - Ticker item descriptor from _buildTickerItem.
 * @returns {HTMLDivElement} The ".ticker-item" element.
 */
const _buildTickerItemEl = (item) => {
  const el = document.createElement("div");
  el.className = "ticker-item";
  if (_isSafeUrl(item.vendorUrl)) {
    el.style.cursor = "pointer";
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
  const displayName = item.name.length > 30 ? item.name.substring(0, 27) + "…" : item.name;
  coinSpan.textContent = displayName;
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

  for (const item of items) {
    block1.appendChild(_buildTickerItemEl(item));
    block2.appendChild(_buildTickerItemEl(item));
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
      _finalizeTickerTrack(container, track, block1, previousPhase, previousTrack);
    });
  } else {
    track.classList.add("static");
    track.appendChild(block1);
    if (previousTrack) previousTrack.remove();
    container.appendChild(track);
  }
};

const renderBestPriceTicker = () => {
  const container = safeGetElement("bestPriceTickerEl");
  if (!container) return;

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
    while (container.firstChild) container.removeChild(container.firstChild);
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
  };
  return map[vid] || vid;
};

let _activeModalChart = null;
let _activeModalSlug = null;

const _modalEscHandler = (e) => {
  if (e.key === "Escape") closeMarketDetailModal();
};

const closeMarketDetailModal = () => {
  if (_activeModalChart && typeof destroyCoinChart === "function") {
    destroyCoinChart(_activeModalChart);
  }
  _activeModalChart = null;
  _activeModalSlug = null;

  const content = safeGetElement("marketDetailContent");
  if (content) content.textContent = "";

  const overlay = safeGetElement("marketDetailModal");
  if (overlay) overlay.setAttribute("hidden", "");

  document.removeEventListener("keydown", _modalEscHandler);
};

/**
 * Fetch a slug's retail detail, 30-day history, and intraday series in parallel,
 * tolerating individual failures (each resolves to null on error).
 * @param {string} slug - Retail coin slug.
 * @returns {Promise<{detail:(Object|null), retailHistory:*, retailIntraday:*}>}
 */
const _fetchModalData = async (slug) => {
  const detailPromise = _marketV2Fetch("/retail/" + slug + "/latest.json")
    .then((json) => (json && json.data ? json.data : null))
    .catch((e) => {
      debugLog("[market-data] Detail fetch failed: " + e.message, "warn");
      return null;
    });

  // Fetch per-vendor retail history (30d — filter to 7 in chart) and intraday (24h)
  const historyPromise = _marketV2Fetch("/retail/" + slug + "/history-30d.json")
    .then((json) => (json && json.data ? json.data : json))
    .catch(() => null);

  const intradayPromise = _marketV2Fetch("/retail/" + slug + "/intraday.json")
    .then((json) => (json && json.data ? json.data : json))
    .catch(() => null);

  const [detailResult, historyResult, intradayResult] = await Promise.allSettled([
    detailPromise,
    historyPromise,
    intradayPromise,
  ]);
  return {
    detail: detailResult.status === "fulfilled" ? detailResult.value : null,
    retailHistory: historyResult.status === "fulfilled" ? historyResult.value : null,
    retailIntraday: intradayResult.status === "fulfilled" ? intradayResult.value : null,
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
 * @returns {void}
 */
const _buildModalHeader = (content, coinMeta, slug, metalCode, metalLower, weightOz) => {
  const header = document.createElement("div");
  header.className = "market-detail-header";

  const h2 = document.createElement("h2");
  h2.id = "marketDetailTitle";
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
    weightInfo.style.cssText = "font-size:12px;color:var(--text-muted);margin-top:2px;";
    weightInfo.textContent = weightOz + " oz " + metalName;
    header.appendChild(weightInfo);
  }

  content.appendChild(header);
};

/**
 * Render the detail-modal price summary row (median/low/high/spread stats).
 * No-op when detail is absent.
 * @param {HTMLElement} content - Modal content container.
 * @param {Object|null} detail - Normalized retail detail.
 * @param {string} slug - Retail coin slug (for the coins-summary lookup).
 * @returns {void}
 */
const _buildModalPriceSummary = (content, detail, slug) => {
  if (!detail) return;
  const coins = _getRetailCoins();
  const coinSummary = coins[slug];
  const median = coinSummary ? _coalesce(coinSummary.median_price, coinSummary.median) : null;
  const low = detail.lowest_price || (coinSummary && coinSummary.lowest_price) || null;
  const high = detail.highest_price || (coinSummary && coinSummary.highest_price) || null;
  const spread = low != null && high != null ? high - low : null;

  const priceRow = document.createElement("div");
  priceRow.style.cssText =
    "display:flex;gap:24px;flex-wrap:wrap;margin-bottom:1rem;font-size:13px;";

  const addStat = (label, value) => {
    const stat = document.createElement("div");
    const lbl = document.createElement("div");
    lbl.style.cssText =
      "color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;";
    lbl.textContent = label;
    stat.appendChild(lbl);
    const val = document.createElement("div");
    val.classList.add("market-value");
    val.textContent = value;
    stat.appendChild(val);
    priceRow.appendChild(stat);
  };

  if (median != null) addStat("Median", formatCurrency(median));
  if (low != null) addStat("Low", formatCurrency(low));
  if (high != null) addStat("High", formatCurrency(high));
  if (spread != null) addStat("Spread", formatCurrency(spread));

  content.appendChild(priceRow);
};

/**
 * Render the detail-modal chart section: period tabs (24H/7D) and a chart area
 * that lazily renders the appropriate vendor history/intraday chart on demand.
 * @param {HTMLElement} content - Modal content container.
 * @param {*} retailHistory - 30-day per-vendor history series (or null).
 * @param {*} retailIntraday - 24-hour intraday series (or null).
 * @param {Object} vendorMeta - Vendor-meta map (for chart series styling).
 * @returns {void}
 */
const _buildModalChartSection = (content, retailHistory, retailIntraday, vendorMeta) => {
  const chartSection = document.createElement("div");
  chartSection.style.cssText = "margin-bottom:1rem;";

  const chartTabBar = document.createElement("div");
  chartTabBar.style.cssText = "display:flex;gap:4px;margin-bottom:8px;";
  const periods = [
    { id: "24h", label: "24H" },
    { id: "7d", label: "7D" },
  ];

  const chartWrap = document.createElement("div");
  chartWrap.className = "market-detail-chart";
  chartWrap.id = "marketDetailChartArea";

  const _showNoChart = () => {
    chartWrap.textContent = "";
    const msg = document.createElement("div");
    msg.style.cssText =
      "display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px;";
    msg.textContent = "Chart unavailable";
    chartWrap.appendChild(msg);
  };

  const _switchChartPeriod = (periodId) => {
    // Update tab active state
    chartTabBar.querySelectorAll("button").forEach((b) => {
      b.style.background =
        b.getAttribute("data-period") === periodId ? "var(--bg-secondary)" : "transparent";
      b.style.fontWeight = b.getAttribute("data-period") === periodId ? "600" : "400";
    });
    // Destroy existing chart
    if (_activeModalChart && typeof destroyCoinChart === "function") {
      destroyCoinChart(_activeModalChart);
    }
    _activeModalChart = null;
    chartWrap.textContent = "";
    chartWrap.id = "marketDetailChartArea";

    if (typeof LightweightCharts === "undefined") {
      _showNoChart();
      return;
    }

    if (periodId === "7d") {
      if (
        typeof createVendorHistoryChart === "function" &&
        retailHistory &&
        Array.isArray(retailHistory) &&
        retailHistory.length > 0
      ) {
        _activeModalChart = createVendorHistoryChart(
          "marketDetailChartArea",
          retailHistory,
          vendorMeta
        );
        if (!_activeModalChart) _showNoChart();
      } else {
        _showNoChart();
      }
    } else if (periodId === "24h") {
      if (
        typeof createVendorIntradayChart === "function" &&
        retailIntraday &&
        Array.isArray(retailIntraday) &&
        retailIntraday.length > 0
      ) {
        _activeModalChart = createVendorIntradayChart(
          "marketDetailChartArea",
          retailIntraday,
          vendorMeta
        );
        if (!_activeModalChart) _showNoChart();
      } else {
        _showNoChart();
      }
    }
  };

  for (const p of periods) {
    const btn = document.createElement("button");
    btn.setAttribute("data-period", p.id);
    btn.textContent = p.label;
    btn.style.cssText =
      "border:1px solid var(--border);border-radius:6px;padding:3px 12px;font-size:11px;cursor:pointer;color:var(--text-secondary);background:transparent;";
    btn.addEventListener("click", () => _switchChartPeriod(p.id));
    chartTabBar.appendChild(btn);
  }

  chartSection.appendChild(chartTabBar);
  chartSection.appendChild(chartWrap);
  content.appendChild(chartSection);

  // Defer initial chart render until after all modal content is in the DOM
  const hasIntraday = retailIntraday && Array.isArray(retailIntraday) && retailIntraday.length > 0;
  const hasHistory = retailHistory && Array.isArray(retailHistory) && retailHistory.length > 0;
  setTimeout(() => _switchChartPeriod(hasHistory ? "7d" : hasIntraday ? "24h" : "7d"), 0);
};

/**
 * Build the buy-link cell for a detail-modal vendor row. Renders a "Buy" link
 * (opening a detached popup) when a safe vendor URL resolves, else a muted dash.
 * @param {Object} entry - Vendor entry ({vid, url, ...}).
 * @param {string} slug - Retail coin slug (provider URL lookup).
 * @param {Object} vendorMeta - Vendor-meta map (url fallback for entry.vid).
 * @returns {HTMLTableCellElement} The buy cell.
 */
const _buildModalBuyCell = (entry, slug, vendorMeta) => {
  const tdBuy = document.createElement("td");
  const url = _resolveVendorUrl(slug, entry.vid, vendorMeta, entry.url);
  if (_isSafeUrl(url)) {
    const buyBtn = document.createElement("a");
    buyBtn.textContent = "Buy";
    buyBtn.href = "#";
    buyBtn.style.cssText =
      "color:var(--primary);text-decoration:none;font-weight:600;font-size:12px;";
    buyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      _openVendorPopup(url, entry.vid);
    });
    tdBuy.appendChild(buyBtn);
  } else {
    tdBuy.textContent = "—";
    tdBuy.style.color = "var(--text-muted)";
  }
  return tdBuy;
};

/**
 * Build one vendor row for the detail-modal comparison table (name, price,
 * premium badge, stock status, buy link).
 * @param {Object} entry - Vendor entry ({vid, price, in_stock, carried, url, ...}).
 * @param {Object} vendorMeta - Vendor-meta map (name/color/url).
 * @param {string} slug - Retail coin slug (for provider URL lookup).
 * @param {string} metalCode - ISO metal code (Goldback premium uses the G1 rate).
 * @param {number} weightOz - Coin weight in troy ounces (for spot premium).
 * @param {(number|null)} spotPrice - Spot price for the metal, or null.
 * @returns {HTMLTableRowElement} The vendor row element.
 */
const _buildModalVendorRow = (entry, vendorMeta, slug, metalCode, weightOz, spotPrice) => {
  const tr = document.createElement("tr");

  // Vendor name
  const tdVendor = document.createElement("td");
  const vMeta = vendorMeta[entry.vid];
  tdVendor.textContent = _shortVendor(entry.vid);
  if (vMeta && vMeta.color) {
    tdVendor.style.color = vMeta.color;
  }
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
    const badge = document.createElement("span");
    badge.className = "vp-premium " + _premiumTierClass(_modalPremium);
    badge.textContent = (_modalPremium >= 0 ? "+" : "") + _modalPremium.toFixed(1) + "%";
    tdPrem.appendChild(badge);
  } else {
    tdPrem.textContent = "—";
    tdPrem.style.color = "var(--text-muted)";
  }
  tr.appendChild(tdPrem);

  // Stock
  const tdStock = document.createElement("td");
  if (entry.carried) {
    tdStock.style.color = "var(--warning)";
    tdStock.textContent = "Carried";
    if (entry.carried_from) tdStock.title = `Last scraped: ${entry.carried_from}`;
  } else if (entry.in_stock) {
    tdStock.style.color = "var(--success)";
    tdStock.textContent = "In Stock";
  } else {
    tdStock.style.color = "var(--danger)";
    tdStock.textContent = "Out of Stock";
  }
  tr.appendChild(tdStock);

  tr.appendChild(_buildModalBuyCell(entry, slug, vendorMeta));

  return tr;
};

/**
 * Render the detail-modal vendor comparison table (sorted by price), or a
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

    const vendorEntries = [];
    for (const vid in vData) {
      const v = vData[vid];
      if (!v) continue;
      vendorEntries.push({ vid, ...v });
    }
    vendorEntries.sort((a, b) => {
      if (a.price > 0 && b.price > 0) return a.price - b.price;
      if (a.price > 0) return -1;
      if (b.price > 0) return 1;
      return 0;
    });

    if (vendorEntries.length > 0) {
      const scrollWrap = document.createElement("div");
      scrollWrap.style.overflowX = "auto";

      const table = document.createElement("table");
      table.className = "vendor-prices-table";
      table.style.marginTop = "0.5rem";

      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      const headers = ["Vendor", "Price", "Premium", "Stock", "Buy"];
      for (const h of headers) {
        const th = document.createElement("th");
        th.textContent = h;
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");

      for (const entry of vendorEntries) {
        tbody.appendChild(
          _buildModalVendorRow(entry, vendorMeta, slug, metalCode, weightOz, spotPrice)
        );
      }

      table.appendChild(tbody);
      scrollWrap.appendChild(table);
      content.appendChild(scrollWrap);
    }
  } else {
    const noData = document.createElement("div");
    noData.style.cssText = "padding:16px;text-align:center;color:var(--text-muted);font-size:13px;";
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
    disclaimer.style.cssText =
      "padding:8px 0 0;font-size:10px;color:var(--text-muted);text-align:center;";
    disclaimer.textContent = currencyDisclaimer;
    content.appendChild(disclaimer);
  }
};

const openMarketDetailModal = async (slug) => {
  const overlay = safeGetElement("marketDetailModal");
  const content = safeGetElement("marketDetailContent");
  if (!overlay || !content) return;

  _activeModalSlug = slug;
  content.textContent = "";
  overlay.removeAttribute("hidden");

  const closeBtn = safeGetElement("marketDetailCloseBtn");
  if (closeBtn) closeBtn.onclick = () => closeMarketDetailModal();
  overlay.onclick = (e) => {
    if (e.target === overlay) closeMarketDetailModal();
  };
  document.addEventListener("keydown", _modalEscHandler);

  const loadingEl = document.createElement("div");
  loadingEl.style.cssText =
    "padding:48px;text-align:center;color:var(--text-muted);font-size:13px;";
  loadingEl.textContent = "Loading coin details\u2026";
  content.appendChild(loadingEl);

  const coinMetaMap = _getCoinMeta();
  const vendorMeta = _getVendorMeta();

  const coinMeta = _resolveCoinMetaPreferMap(slug, coinMetaMap);

  const metalLower = (coinMeta.metal || "").toLowerCase();
  const metalCode = _METAL_TO_ISO[metalLower] || metalLower;

  const { detail, retailHistory, retailIntraday } = await _fetchModalData(slug);

  content.textContent = "";

  const weightOz = (detail && detail.weight_oz) || coinMeta.weight || 0;
  _buildModalHeader(content, coinMeta, slug, metalCode, metalLower, weightOz);

  _buildModalPriceSummary(content, detail, slug);

  _buildModalChartSection(content, retailHistory, retailIntraday, vendorMeta);

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
 * @returns {void}
 */
const _renderVendorTableMessage = (tableWrap, text) => {
  tableWrap.textContent = "";
  const msg = document.createElement("div");
  msg.style.cssText = "padding:24px;text-align:center;color:var(--text-muted);font-size:13px;";
  msg.textContent = text;
  tableWrap.appendChild(msg);
};

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
 * Also refreshes the in-memory _cachedSlugDetail entries.
 * @param {Array<{slug:string}>} metalSlugs - Ordered rows (slugs read).
 * @param {Object} coins - Retail coins summary map (cache fallback).
 * @returns {Promise<Object>} Map of slug to normalized detail.
 */
const _resolveVendorDetailMap = async (metalSlugs, coins) => {
  const detailMap = {};
  const missingSlugs = [];
  for (const { slug } of metalSlugs) {
    const cachedDetail = _getCachedRetailDetail(slug, coins);
    if (cachedDetail) {
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
          detailMap[r.value.slug] = normalized;
          _cachedSlugDetail[r.value.slug] = normalized;
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
 * @param {Object} vendorMeta - Vendor-meta map (for column color).
 * @returns {HTMLTableSectionElement} The thead element.
 */
const _buildVendorTableHead = (vendorIds, vendorMeta) => {
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const thCoin = document.createElement("th");
  thCoin.textContent = "ITEM";
  headRow.appendChild(thCoin);

  for (const vid of vendorIds) {
    const th = document.createElement("th");
    th.textContent = _shortVendor(vid);
    const vMeta = vendorMeta[vid];
    if (vMeta && vMeta.color) th.style.color = vMeta.color;
    headRow.appendChild(th);
  }

  const thMedian = document.createElement("th");
  thMedian.textContent = "MEDIAN";
  headRow.appendChild(thMedian);
  const thSpread = document.createElement("th");
  thSpread.textContent = "SPREAD";
  headRow.appendChild(thSpread);

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
    if (_vs && _vs.price > 0 && (_vs.in_stock === true || _vs.inStock === true) && !_vs.carried) {
      inStockPrices.push(vData[vid].price);
    }
  }
  return inStockPrices;
};

/**
 * Build one vendor price cell for the matrix: a muted dash for disabled vendors
 * or missing data, an OOS marker when out of stock, otherwise the price (with a
 * best-price highlight, carried dimming, click-to-vendor link, and premium badge).
 * @param {string} slug - Retail coin slug.
 * @param {string} vid - Vendor id.
 * @param {Object} vData - Per-vendor data map for the coin.
 * @param {(number|null)} lowestPrice - Lowest in-stock price in the row (for highlight).
 * @param {(number|null)} spotPrice - Spot price for the metal.
 * @param {number} weightOz - Coin weight in troy ounces.
 * @param {string} isoCode - ISO metal code (Goldback premium uses the G1 rate).
 * @param {Object} vendorMeta - Vendor-meta map (for the URL fallback).
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
  vendorMeta
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
    td.style.color = "var(--text-muted)";
    return td;
  }

  if (!vInfo.in_stock && !vInfo.inStock) {
    td.classList.add("vp-oos");
    const oosSpan = document.createElement("span");
    oosSpan.textContent = "OOS";
    td.appendChild(oosSpan);
    return td;
  }

  if (vInfo.carried && vInfo.price != null) {
    td.style.opacity = "0.5";
  }

  if (vInfo.price === lowestPrice && !vInfo.carried) td.classList.add("vp-best");

  const priceSpan = document.createElement("span");
  priceSpan.className = "vp-price";
  priceSpan.textContent = formatCurrency(vInfo.price);
  priceSpan.style.cursor = "pointer";
  priceSpan.addEventListener("click", () => {
    const url = _resolveVendorUrl(slug, vid, vendorMeta);
    if (_isSafeUrl(url)) _openVendorPopup(url, vid);
  });
  td.appendChild(priceSpan);

  let premium = null;
  if (spotPrice && spotPrice > 0 && weightOz > 0) {
    premium = _calcMarketPremium(vInfo.price, spotPrice * weightOz);
  } else if (isoCode === "goldback" && _goldbackG1Rate > 0 && vInfo.price > 0) {
    premium = _calcMarketPremium(vInfo.price, _goldbackG1Rate);
  }
  if (premium != null) {
    const premBadge = document.createElement("span");
    premBadge.className = "vp-premium " + _premiumTierClass(premium);
    premBadge.textContent = (premium >= 0 ? "+" : "") + premium.toFixed(1) + "%";
    td.appendChild(premBadge);
  }

  return td;
};

/**
 * Build one coin row for the vendor matrix: the clickable coin name, one price
 * cell per vendor, and the median and spread cells.
 * @param {{slug:string, meta:Object, isoCode:string}} rowInfo - Row descriptor.
 * @param {string[]} vendorIds - Sorted vendor ids (column order).
 * @param {Object} detailMap - Map of slug to normalized detail.
 * @param {Object} coins - Retail coins summary map (for median).
 * @param {Object} vendorMeta - Vendor-meta map.
 * @returns {(HTMLTableRowElement|null)} The row element, or null if no detail.
 */
const _buildVendorTableRow = (rowInfo, vendorIds, detailMap, coins, vendorMeta) => {
  const { slug, meta, isoCode } = rowInfo;
  const detail = detailMap[slug];
  if (!detail || !detail.vendors) return null;

  const vData = detail.vendors;
  const weightOz = detail.weight_oz || meta.weight || 0;
  const spotPrice = _getSpotPrice(isoCode);

  const inStockPrices = _computeInStockPrices(vData, slug);
  const lowestPrice = inStockPrices.length > 0 ? Math.min(...inStockPrices) : null;

  const tr = document.createElement("tr");

  const tdName = document.createElement("td");

  const nameSpan = document.createElement("span");
  const displayName = meta.name || slug;
  nameSpan.textContent = displayName;
  nameSpan.className = "vp-coin-link";
  nameSpan.style.cursor = "pointer";
  nameSpan.addEventListener("click", () => {
    openMarketDetailModal(slug);
  });
  tdName.appendChild(nameSpan);

  tr.appendChild(tdName);

  for (const vid of vendorIds) {
    tr.appendChild(
      _buildVendorPriceCell(slug, vid, vData, lowestPrice, spotPrice, weightOz, isoCode, vendorMeta)
    );
  }

  const coinSummary = coins[slug];
  const tdMedian = document.createElement("td");
  const medianVal = coinSummary ? _coalesce(coinSummary.median_price, coinSummary.median) : null;
  tdMedian.textContent = medianVal != null ? formatCurrency(medianVal) : "—";
  tr.appendChild(tdMedian);

  const tdSpread = document.createElement("td");
  // Calculate high/low from vendor data since summary may not have these fields
  const allPrices = inStockPrices.length > 0 ? inStockPrices : [];
  const calcHigh = allPrices.length > 0 ? Math.max(...allPrices) : null;
  const calcLow = allPrices.length > 0 ? Math.min(...allPrices) : null;
  if (calcHigh != null && calcLow != null && calcHigh !== calcLow) {
    tdSpread.textContent = formatCurrency(calcHigh - calcLow);
  } else {
    tdSpread.textContent = "—";
  }
  tr.appendChild(tdSpread);

  return tr;
};

const _renderVendorTable = async (metalCode) => {
  const container = safeGetElement("vendorPricesContainer");
  if (!container) return;

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
    _renderVendorTableMessage(tableWrap, "No coins tracked for this metal");
    return;
  }

  _renderVendorTableMessage(tableWrap, "Loading vendor prices\u2026");

  const detailMap = await _resolveVendorDetailMap(metalSlugs, coins);

  const vendorIds = _collectEnabledVendorIds(metalSlugs, detailMap);

  if (vendorIds.length === 0) {
    _renderVendorTableMessage(tableWrap, "No vendor data available for this metal");
    return;
  }

  tableWrap.textContent = "";
  const scrollWrap = document.createElement("div");
  scrollWrap.style.overflowX = "auto";

  const table = document.createElement("table");
  table.className = "vendor-prices-table";

  table.appendChild(_buildVendorTableHead(vendorIds, vendorMeta));

  const tbody = document.createElement("tbody");

  for (const rowInfo of metalSlugs) {
    const tr = _buildVendorTableRow(rowInfo, vendorIds, detailMap, coins, vendorMeta);
    if (tr) tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  scrollWrap.appendChild(table);
  tableWrap.appendChild(scrollWrap);

  // STAK-513: Removed redundant renderBestPriceTicker() call here.
  // Both initMarketData and refreshMarketData already call it — re-calling
  // inside the async _renderVendorTable completion was the primary trigger
  // for the stale-reference race that duplicated ticker rows.
};

const renderVendorPrices = () => {
  const container = safeGetElement("vendorPricesContainer");
  if (!container) return;

  const coins = _getRetailCoins();
  if (!coins || Object.keys(coins).length === 0) {
    container.textContent = "";
    const msg = document.createElement("div");
    msg.style.cssText = "padding:24px;text-align:center;color:var(--text-muted);font-size:13px;";
    msg.textContent = "Retail data unavailable";
    container.appendChild(msg);
    return;
  }

  container.textContent = "";

  // ── Header: Timestamp + Refresh (no section title — matches other sections) ──
  const headerRow = document.createElement("div");
  headerRow.style.cssText =
    "display:flex;justify-content:flex-end;align-items:center;margin-bottom:0.75rem;";

  const rightGroup = document.createElement("div");
  rightGroup.style.cssText =
    "display:flex;align-items:center;gap:10px;font-size:11px;color:var(--text-muted);";

  const tsSpan = document.createElement("span");
  tsSpan.id = "marketDataTimestamp";
  const retailData = loadDataSync("v2RetailPrices", null) || loadDataSync("retailPrices", null);
  if (retailData && retailData.lastSync) {
    const d = new Date(retailData.lastSync);
    tsSpan.textContent =
      "Updated " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else {
    tsSpan.textContent = "";
  }
  rightGroup.appendChild(tsSpan);

  const refreshBtn = document.createElement("button");
  refreshBtn.style.cssText =
    "background:var(--bg-secondary);border:1px solid var(--border);color:var(--text-secondary);padding:3px 10px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;";
  refreshBtn.textContent = "\u21BB Refresh";
  refreshBtn.addEventListener("click", () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "\u21BB\u2026";
    if (typeof startRetailBackgroundSync === "function") {
      startRetailBackgroundSync();
    }
    setTimeout(() => {
      _marketDataInitialized = false;
      initMarketData().catch(() => {});
      refreshBtn.disabled = false;
      refreshBtn.textContent = "\u21BB Refresh";
    }, 5000);
  });
  rightGroup.appendChild(refreshBtn);

  const settingsBtn = document.createElement("button");
  settingsBtn.id = "marketSettingsBtn";
  settingsBtn.title = "Market settings";
  settingsBtn.setAttribute("aria-label", "Market settings");
  settingsBtn.style.cssText =
    "background:var(--bg-secondary);border:1px solid var(--border);color:var(--text-secondary);padding:3px 10px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;";
  settingsBtn.textContent = "\u2699";
  settingsBtn.addEventListener("click", () => {
    if (typeof showSettingsModal === "function") showSettingsModal("market");
  });
  rightGroup.appendChild(settingsBtn);

  headerRow.appendChild(rightGroup);
  container.appendChild(headerRow);

  const tabBar = document.createElement("div");
  tabBar.className = "vendor-prices-tabs";

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

  const allMetals = [
    { code: "all", label: "All" },
    { code: "xau", label: "Gold" },
    { code: "xag", label: "Silver" },
    { code: "xpt", label: "Platinum" },
    { code: "xpd", label: "Palladium" },
    { code: "goldback", label: "Goldback" },
  ];
  // Only show tabs that have coins
  const metals = allMetals.filter((m) => m.code === "all" || metalHasCoins[m.code]);

  const savedTab = loadDataSync("vendorPricesActiveTab", "all");
  let activeTab = metals.some((m) => m.code === savedTab) ? savedTab : "all";

  const setActive = (code) => {
    activeTab = code;
    saveDataSync("vendorPricesActiveTab", code);
    const btns = tabBar.querySelectorAll("button");
    btns.forEach((b) => b.classList.toggle("active", b.getAttribute("data-metal") === code));
    _renderVendorTable(code);
  };

  for (const m of metals) {
    const btn = document.createElement("button");
    btn.className = "vp-tab" + (m.code === activeTab ? " active" : "");
    btn.setAttribute("data-metal", m.code);
    btn.textContent = m.label;
    btn.addEventListener("click", () => {
      setActive(m.code);
    });
    tabBar.appendChild(btn);
  }

  container.appendChild(tabBar);

  _renderVendorTable(activeTab);

  // ── Footer disclaimer ──
  const footer = document.createElement("div");
  footer.style.cssText =
    "padding:8px 0 0;font-size:10px;color:var(--text-muted);text-align:center;";
  let footerText =
    "Market prices are best effort. Percentages show premium over spot (or G1 rate for Goldbacks). Click a price to visit the vendor.";
  const currencyDisclaimer = _getRetailCurrencyDisclaimer();
  if (currencyDisclaimer) footerText += " " + currencyDisclaimer;
  footer.textContent = footerText;
  container.appendChild(footer);
};

// ---------------------------------------------------------------------------
// Init / Refresh
// ---------------------------------------------------------------------------

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

  // Seed the goldback G1 rate from the fresh goldbackPrices['1'] cache so the
  // gated premium sites (ticker / modal / vendor matrix) paint in the same pass
  // as spot premiums — before the un-awaited network fetch below resolves.
  // selectGoldbackG1Seed (spot-ratio-math.js) declines a stale value while
  // online and preserves the last-known plain value offline.
  if (typeof selectGoldbackG1Seed === "function") {
    const seeded = selectGoldbackG1Seed(navigator.onLine);
    if (typeof seeded === "number" && seeded > 0) _goldbackG1Rate = seeded;
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
  }

  renderBestPriceTicker();
  renderVendorPrices();

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
      if (_activeModalSlug && overlay && !overlay.hasAttribute("hidden")) {
        void openMarketDetailModal(_activeModalSlug).catch((e) => {
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

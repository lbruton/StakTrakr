// js/market-data.js — Market Data Module (STAK-504)
// Orchestrates the best price ticker, vendor prices section, and market detail modal.

let _marketDataInitialized = false;
const V2_API = "https://api.staktrakr.com/data/v2";

// STRK-188: ordered endpoint failover (api1 → api2), mirroring the spot and
// goldback fetch paths. _staktrakrFetch is defined in api.js, which executes
// after this file (both deferred) — it exists by the time any market fetch
// runs, and the typeof guard degrades to the primary endpoint only if not.
const _marketV2Fetch = async (path) => {
  if (
    typeof _staktrakrFetch === "function" &&
    typeof V2_API_ENDPOINTS !== "undefined" &&
    Array.isArray(V2_API_ENDPOINTS) &&
    V2_API_ENDPOINTS.length
  ) {
    return _staktrakrFetch(V2_API_ENDPOINTS, path);
  }
  const resp = await fetch(V2_API + path, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  return resp.json();
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

    let meta;
    if (coinMetaMap && coinMetaMap[slug]) {
      meta = coinMetaMap[slug];
    } else if (typeof window.getRetailCoinMeta === "function") {
      meta = window.getRetailCoinMeta(slug);
    } else {
      meta = { name: slug, weight: 0, metal: "unknown" };
    }

    const metalLower = (meta.metal || "").toLowerCase();

    // Find cheapest in-stock vendor — prefer fresh v2 detail data when available
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
    if (!bestVid || bestPrice === Infinity) continue;

    const weightOz = meta.weight || 0;
    const spot = _getSpotPrice(metalLower);
    let premium = null;
    if (spot && spot > 0 && weightOz > 0) {
      premium = _calcMarketPremium(bestPrice, spot * weightOz);
    } else if (metalLower === "goldback" && _goldbackG1Rate > 0) {
      premium = _calcMarketPremium(bestPrice, _goldbackG1Rate);
    }

    // Get vendor display info
    const vendorName = _shortVendor(bestVid);
    const vendorColor = vendorMeta[bestVid] ? vendorMeta[bestVid].color : null;
    const vendorUrl =
      (window.retailProviders &&
        window.retailProviders[slug] &&
        window.retailProviders[slug][bestVid]) ||
      (vendorMeta[bestVid] && vendorMeta[bestVid].url) ||
      null;

    items.push({
      slug,
      name: meta.name || slug,
      metal: metalLower,
      bestPrice,
      premium,
      vendorName,
      vendorColor,
      vendorUrl,
      bestVid,
    });
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

  const track = document.createElement("div");
  track.className = "ticker-track";
  track.dataset.signature = signature;

  const buildTickerItem = (item) => {
    const el = document.createElement("div");
    el.className = "ticker-item";
    if (_isSafeUrl(item.vendorUrl)) {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => {
        const popup = window.open(
          item.vendorUrl,
          "retail_vendor_" + item.bestVid,
          "width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no"
        );
        if (popup) popup.opener = null;
      });
    }

    const dot = document.createElement("span");
    const isoCode = _METAL_TO_ISO[item.metal] || "";
    dot.className = "metal-dot" + (isoCode ? " " + isoCode : "");
    el.appendChild(dot);

    const coinSpan = document.createElement("span");
    coinSpan.className = "coin";
    const displayName = item.name.length > 30 ? item.name.substring(0, 27) + "\u2026" : item.name;
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

  // Build TWO identical content blocks for seamless loop
  const block1 = document.createElement("div");
  block1.className = "ticker-block";
  block1.dataset.tickerBlock = "primary";
  const block2 = document.createElement("div");
  block2.className = "ticker-block";
  block2.dataset.tickerBlock = "duplicate";

  for (const item of items) {
    block1.appendChild(buildTickerItem(item));
    block2.appendChild(buildTickerItem(item));
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

  let coinMeta;
  if (coinMetaMap && coinMetaMap[slug]) {
    coinMeta = coinMetaMap[slug];
  } else if (typeof window.getRetailCoinMeta === "function") {
    coinMeta = window.getRetailCoinMeta(slug);
  } else {
    coinMeta = { name: slug, weight: 0, metal: "unknown" };
  }

  const metalLower = (coinMeta.metal || "").toLowerCase();
  const metalCode = _METAL_TO_ISO[metalLower] || metalLower;

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
  const detail = detailResult.status === "fulfilled" ? detailResult.value : null;
  const retailHistory = historyResult.status === "fulfilled" ? historyResult.value : null;
  const retailIntraday = intradayResult.status === "fulfilled" ? intradayResult.value : null;

  content.textContent = "";

  // ── Header ──
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

  const weightOz = (detail && detail.weight_oz) || coinMeta.weight || 0;
  if (weightOz > 0) {
    const metalNames = { xau: "Gold", xag: "Silver", xpt: "Platinum", xpd: "Palladium" };
    const metalName = metalNames[metalCode] || metalLower;
    const weightInfo = document.createElement("div");
    weightInfo.style.cssText = "font-size:12px;color:var(--text-muted);margin-top:2px;";
    weightInfo.textContent = weightOz + " oz " + metalName;
    header.appendChild(weightInfo);
  }

  content.appendChild(header);

  // ── Price summary ──
  if (detail) {
    const coins = _getRetailCoins();
    const coinSummary = coins[slug];
    const median = coinSummary
      ? coinSummary.median_price != null
        ? coinSummary.median_price
        : coinSummary.median != null
          ? coinSummary.median
          : null
      : null;
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
  }

  // ── Chart with period tabs ──
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

  // ── Vendor comparison table ──
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
        tdPrice.textContent = entry.price > 0 ? formatCurrency(entry.price) : "\u2014";
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
          tdPrem.textContent = "\u2014";
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

        // Buy link
        const tdBuy = document.createElement("td");
        const url =
          (window.retailProviders &&
            window.retailProviders[slug] &&
            window.retailProviders[slug][entry.vid]) ||
          entry.url ||
          (vMeta && vMeta.url) ||
          null;
        if (_isSafeUrl(url)) {
          const buyBtn = document.createElement("a");
          buyBtn.textContent = "Buy";
          buyBtn.href = "#";
          buyBtn.style.cssText =
            "color:var(--primary);text-decoration:none;font-weight:600;font-size:12px;";
          buyBtn.addEventListener("click", (e) => {
            e.preventDefault();
            const popup = window.open(
              url,
              "retail_vendor_" + entry.vid,
              "width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no"
            );
            if (popup) popup.opener = null;
          });
          tdBuy.appendChild(buyBtn);
        } else {
          tdBuy.textContent = "\u2014";
          tdBuy.style.color = "var(--text-muted)";
        }
        tr.appendChild(tdBuy);

        tbody.appendChild(tr);
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

  const currencyDisclaimer = _getRetailCurrencyDisclaimer();
  if (currencyDisclaimer) {
    const disclaimer = document.createElement("div");
    disclaimer.style.cssText =
      "padding:8px 0 0;font-size:10px;color:var(--text-muted);text-align:center;";
    disclaimer.textContent = currencyDisclaimer;
    content.appendChild(disclaimer);
  }

  debugLog("[market-data] Detail modal opened for: " + slug, "info");
};

const _getCachedRetailDetail = (slug, coins) => {
  const detail = _cachedSlugDetail[slug] || (coins && coins[slug]);
  if (!detail || !detail.vendors || typeof detail.vendors !== "object") return null;

  const vendors = {};
  for (const [vid, vendor] of Object.entries(detail.vendors)) {
    const inStock = vendor.in_stock === true || vendor.inStock === true;
    vendors[vid] = {
      ...vendor,
      in_stock: inStock,
      inStock,
    };
  }

  return {
    ...detail,
    median: detail.median ?? detail.median_price ?? null,
    median_price: detail.median_price ?? detail.median ?? null,
    low: detail.low ?? detail.lowest_price ?? null,
    lowest_price: detail.lowest_price ?? detail.low ?? null,
    high: detail.high ?? detail.highest_price ?? null,
    highest_price: detail.highest_price ?? detail.high ?? null,
    vendors,
  };
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

  if (metalSlugs.length === 0) {
    tableWrap.textContent = "";
    const msg = document.createElement("div");
    msg.style.cssText = "padding:24px;text-align:center;color:var(--text-muted);font-size:13px;";
    msg.textContent = "No coins tracked for this metal";
    tableWrap.appendChild(msg);
    return;
  }

  tableWrap.textContent = "";
  const loadingMsg = document.createElement("div");
  loadingMsg.style.cssText =
    "padding:24px;text-align:center;color:var(--text-muted);font-size:13px;";
  loadingMsg.textContent = "Loading vendor prices\u2026";
  tableWrap.appendChild(loadingMsg);

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
    const fetchPromises = missingSlugs.map((slug) =>
      fetch(V2_API + "/retail/" + slug + "/latest.json", { signal: AbortSignal.timeout(8000) })
        .then((r) => (r.ok ? r.json() : null))
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

  const vendorIds = Array.from(allVendorIds).sort(
    (a, b) => String(_shortVendor(a)).localeCompare(String(_shortVendor(b))) || a.localeCompare(b)
  );

  if (vendorIds.length === 0) {
    tableWrap.textContent = "";
    const msg = document.createElement("div");
    msg.style.cssText = "padding:24px;text-align:center;color:var(--text-muted);font-size:13px;";
    msg.textContent = "No vendor data available for this metal";
    tableWrap.appendChild(msg);
    return;
  }

  tableWrap.textContent = "";
  const scrollWrap = document.createElement("div");
  scrollWrap.style.overflowX = "auto";

  const table = document.createElement("table");
  table.className = "vendor-prices-table";

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
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const { slug, meta, isoCode } of metalSlugs) {
    const detail = detailMap[slug];
    if (!detail || !detail.vendors) continue;

    const vData = detail.vendors;
    const weightOz = detail.weight_oz || meta.weight || 0;
    const spotPrice = _getSpotPrice(isoCode);

    const inStockPrices = [];
    for (const vid in vData) {
      // STAK-515: Skip disabled vendors in price calculations
      if (typeof _isMarketItemEnabled === "function" && !_isMarketItemEnabled(slug, vid)) continue;
      const _vs = vData[vid];
      if (_vs && _vs.price > 0 && (_vs.in_stock === true || _vs.inStock === true) && !_vs.carried) {
        inStockPrices.push(vData[vid].price);
      }
    }
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
      // STAK-515: Skip disabled vendor cells
      if (typeof _isMarketItemEnabled === "function" && !_isMarketItemEnabled(slug, vid)) {
        const skipTd = document.createElement("td");
        skipTd.textContent = "\u2014";
        skipTd.className = "vp-muted";
        tr.appendChild(skipTd);
        continue;
      }
      const td = document.createElement("td");
      const vInfo = vData[vid];

      if (!vInfo) {
        td.textContent = "\u2014";
        td.style.color = "var(--text-muted)";
        tr.appendChild(td);
        continue;
      }

      if (!vInfo.in_stock && !vInfo.inStock) {
        td.classList.add("vp-oos");
        const oosSpan = document.createElement("span");
        oosSpan.textContent = "OOS";
        td.appendChild(oosSpan);
        tr.appendChild(td);
        continue;
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
        const url =
          (window.retailProviders &&
            window.retailProviders[slug] &&
            window.retailProviders[slug][vid]) ||
          (vendorMeta[vid] && vendorMeta[vid].url) ||
          null;
        if (_isSafeUrl(url)) {
          const popup = window.open(
            url,
            "retail_vendor_" + vid,
            "width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no"
          );
          if (popup) popup.opener = null;
        }
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

      tr.appendChild(td);
    }

    const coinSummary = coins[slug];
    const tdMedian = document.createElement("td");
    const medianVal = coinSummary
      ? coinSummary.median_price != null
        ? coinSummary.median_price
        : coinSummary.median
      : null;
    tdMedian.textContent = medianVal != null ? formatCurrency(medianVal) : "\u2014";
    tr.appendChild(tdMedian);

    const tdSpread = document.createElement("td");
    // Calculate high/low from vendor data since summary may not have these fields
    const allPrices = inStockPrices.length > 0 ? inStockPrices : [];
    const calcHigh = allPrices.length > 0 ? Math.max(...allPrices) : null;
    const calcLow = allPrices.length > 0 ? Math.min(...allPrices) : null;
    if (calcHigh != null && calcLow != null && calcHigh !== calcLow) {
      tdSpread.textContent = formatCurrency(calcHigh - calcLow);
    } else {
      tdSpread.textContent = "\u2014";
    }
    tr.appendChild(tdSpread);

    tbody.appendChild(tr);
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

  // Fetch goldback G1 rate for premium calculation
  if (!_goldbackG1Rate) {
    try {
      const gbResp = await fetch(V2_API + "/goldback/latest.json", {
        signal: AbortSignal.timeout(10000),
      });
      if (gbResp.ok) {
        const gbJson = await gbResp.json();
        if (gbJson && gbJson.data && gbJson.data.g1_usd) {
          _goldbackG1Rate = gbJson.data.g1_usd;
          debugLog("[market-data] Goldback G1 rate: $" + _goldbackG1Rate, "info");
        }
      }
    } catch (e) {
      debugLog("[market-data] Goldback rate fetch failed: " + e.message, "warn");
    }
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
}

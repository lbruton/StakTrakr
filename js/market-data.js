// js/market-data.js — Market Data Module (STAK-504)
// Orchestrates the best price ticker, vendor prices section, and market detail modal.

let _marketDataInitialized = false;
const V2_API = 'https://api.staktrakr.com/data/v2';

const _METAL_TO_ISO = { silver: 'xag', gold: 'xau', platinum: 'xpt', palladium: 'xpd' };

const _fmtPrice = (n) => {
  if (n == null || isNaN(n)) return '\u2014';
  return n >= 100 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                   : n.toFixed(2);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _getSpotPrice = (metalCode) => {
  if (typeof spotPrices !== 'undefined' && spotPrices && spotPrices[metalCode] != null) {
    return spotPrices[metalCode];
  }
  const capMetal = metalCode.charAt(0).toUpperCase() + metalCode.slice(1);
  const displayEl = safeGetElement('spotPriceDisplay' + capMetal);
  if (displayEl) {
    const parsed = parseFloat(displayEl.textContent.replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return null;
};

const _getRetailCoins = () => {
  if (typeof window._v2RetailData !== 'undefined' && window._v2RetailData && window._v2RetailData.prices) {
    return window._v2RetailData.prices;
  }
  const v2Cache = loadDataSync('v2RetailPrices', null);
  if (v2Cache && typeof v2Cache === 'object' && v2Cache.prices) return v2Cache.prices;
  if (v2Cache && typeof v2Cache === 'object' && !v2Cache.prices) return v2Cache;
  return {};
};

const _getCoinMeta = () => {
  if (typeof window._manifestCoinMeta !== 'undefined' && window._manifestCoinMeta) return window._manifestCoinMeta;
  if (typeof window.getRetailCoinMeta === 'function') return null;
  return loadDataSync('retailManifestCoinMeta', {});
};

const _getVendorMeta = () => {
  if (typeof window._manifestVendorMeta !== 'undefined' && window._manifestVendorMeta) return window._manifestVendorMeta;
  return loadDataSync('retailManifestVendorMeta', {});
};

// ---------------------------------------------------------------------------
// Ticker
// ---------------------------------------------------------------------------

const renderBestPriceTicker = () => {
  const container = safeGetElement('bestPriceTickerEl');
  if (!container) return;

  const coins = _getRetailCoins();
  const coinMetaMap = _getCoinMeta();
  // vendorMeta available via _getVendorMeta() — used by Task 6 vendor prices

  const items = [];

  const slugs = Object.keys(coins);
  for (const slug of slugs) {
    const coin = coins[slug];
    if (!coin) continue;

    let meta;
    if (coinMetaMap && coinMetaMap[slug]) {
      meta = coinMetaMap[slug];
    } else if (typeof window.getRetailCoinMeta === 'function') {
      meta = window.getRetailCoinMeta(slug);
    } else {
      meta = { name: slug, weight: 0, metal: 'unknown' };
    }

    const metalLower = (meta.metal || '').toLowerCase();
    if (metalLower === 'goldback' || metalLower.startsWith('goldback')) continue;

    const bestPrice = coin.lowest_price != null ? coin.lowest_price : null;
    if (bestPrice == null || bestPrice <= 0) continue;

    const weightOz = meta.weight || 0;
    const spot = _getSpotPrice(metalLower);
    let premium = null;
    if (spot && spot > 0 && weightOz > 0) {
      const meltValue = spot * weightOz;
      premium = ((bestPrice - meltValue) / meltValue) * 100;
    }

    const vendorCount = coin.vendors ? Object.keys(coin.vendors).length : 0;

    items.push({
      slug: slug,
      name: meta.name || slug,
      metal: metalLower,
      bestPrice: bestPrice,
      vendorCount: vendorCount,
      premium: premium
    });
  }

  items.sort((a, b) => {
    if (a.premium != null && b.premium != null) return a.premium - b.premium;
    if (a.premium != null) return -1;
    if (b.premium != null) return 1;
    return a.bestPrice - b.bestPrice;
  });

  if (items.length === 0) {
    container.setAttribute('hidden', '');
    return;
  }

  container.removeAttribute('hidden');
  while (container.firstChild) container.removeChild(container.firstChild);

  const track = document.createElement('div');
  track.className = 'ticker-track';

  const buildTickerItem = (item) => {
    const el = document.createElement('div');
    el.className = 'ticker-item';

    const dot = document.createElement('span');
    const isoCode = _METAL_TO_ISO[item.metal] || '';
    dot.className = 'metal-dot' + (isoCode ? ' ' + isoCode : '');
    el.appendChild(dot);

    const coinSpan = document.createElement('span');
    coinSpan.className = 'coin';
    const displayName = item.name.length > 25 ? item.name.substring(0, 22) + '\u2026' : item.name;
    coinSpan.textContent = sanitizeHtml(displayName);
    el.appendChild(coinSpan);

    const vendorSpan = document.createElement('span');
    vendorSpan.className = 'vendor';
    vendorSpan.textContent = item.vendorCount + (item.vendorCount === 1 ? ' vendor' : ' vendors');
    el.appendChild(vendorSpan);

    const priceSpan = document.createElement('span');
    priceSpan.className = 'price';
    priceSpan.textContent = '$' + _fmtPrice(item.bestPrice);
    el.appendChild(priceSpan);

    const premiumSpan = document.createElement('span');
    premiumSpan.className = 'premium';
    if (item.premium != null) {
      const sign = item.premium >= 0 ? '+' : '';
      premiumSpan.textContent = sign + item.premium.toFixed(1) + '%';
    } else {
      premiumSpan.textContent = '\u2014';
    }
    el.appendChild(premiumSpan);

    return el;
  };

  for (const item of items) {
    track.appendChild(buildTickerItem(item));
  }

  if (items.length >= 4) {
    for (const item of items) {
      track.appendChild(buildTickerItem(item));
    }
  } else {
    track.classList.add('static');
  }

  container.appendChild(track);
};

// ---------------------------------------------------------------------------
// Init / Refresh
// ---------------------------------------------------------------------------

const initMarketData = async () => {
  if (_marketDataInitialized) return;

  let retailData = null;
  if (typeof window._v2RetailData !== 'undefined' && window._v2RetailData) {
    retailData = window._v2RetailData;
  }
  if (!retailData) {
    retailData = await loadData('v2ManifestCache', null);
  }
  if (!retailData) {
    retailData = await loadData('v2RetailPrices', null);
  }

  if (typeof window._manifestCoinMeta === 'undefined' || !window._manifestCoinMeta) {
    const cached = await loadData('retailManifestCoinMeta', null);
    if (cached && typeof cached === 'object') {
      window._manifestCoinMeta = cached;
    }
  }
  if (typeof window._manifestVendorMeta === 'undefined' || !window._manifestVendorMeta) {
    const cached = await loadData('retailManifestVendorMeta', null);
    if (cached && typeof cached === 'object') {
      window._manifestVendorMeta = cached;
    }
  }

  const coins = _getRetailCoins();
  if (!coins || Object.keys(coins).length === 0) {
    debugLog('[market-data] No retail data available — ticker hidden, vendor section empty', 'warn');
    return;
  }

  renderBestPriceTicker();
  // renderVendorPrices() — Task 6

  _marketDataInitialized = true;
};

const refreshMarketData = () => {
  renderBestPriceTicker();
  // renderVendorPrices() — Task 6
};

// ---------------------------------------------------------------------------
// Global exposure
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
  window.initMarketData = initMarketData;
  window.refreshMarketData = refreshMarketData;
  window.renderBestPriceTicker = renderBestPriceTicker;
}

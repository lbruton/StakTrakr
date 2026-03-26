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
// Vendor Prices
// ---------------------------------------------------------------------------

const _shortVendor = (vid) => {
  const map = { apmex: 'APMEX', jmbullion: 'JM', sdbullion: 'SD', monumentmetals: 'Monument',
    herobullion: 'Hero', bullionexchanges: 'BullionX', summitmetals: 'Summit',
    gainesvillecoins: "G'ville", providentmetals: 'Provident', goldback: 'Goldback' };
  return map[vid] || vid;
};

const openMarketDetailModal = (slug) => {
  debugLog('[market-data] Detail modal not yet implemented for: ' + slug, 'info');
};

const _renderVendorTable = async (metalCode) => {
  const container = safeGetElement('vendorPricesContainer');
  if (!container) return;

  let tableWrap = container.querySelector('.vp-table-area');
  if (!tableWrap) {
    tableWrap = document.createElement('div');
    tableWrap.className = 'vp-table-area';
    container.appendChild(tableWrap);
  }

  const coins = _getRetailCoins();
  const coinMetaMap = _getCoinMeta();
  const vendorMeta = _getVendorMeta();

  const metalSlugs = [];
  const slugs = Object.keys(coins);
  for (const slug of slugs) {
    let meta;
    if (coinMetaMap && coinMetaMap[slug]) {
      meta = coinMetaMap[slug];
    } else if (typeof window.getRetailCoinMeta === 'function') {
      meta = window.getRetailCoinMeta(slug);
    } else {
      meta = { name: slug, weight: 0, metal: 'unknown' };
    }
    const metalLower = (meta.metal || '').toLowerCase();
    const isoCode = _METAL_TO_ISO[metalLower] || metalLower;
    if (isoCode === metalCode) {
      metalSlugs.push({ slug, meta });
    }
  }

  if (metalSlugs.length === 0) {
    tableWrap.textContent = '';
    const msg = document.createElement('div');
    msg.style.cssText = 'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
    msg.textContent = 'No coins tracked for this metal';
    tableWrap.appendChild(msg);
    return;
  }

  tableWrap.textContent = '';
  const loadingMsg = document.createElement('div');
  loadingMsg.style.cssText = 'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
  loadingMsg.textContent = 'Loading vendor prices\u2026';
  tableWrap.appendChild(loadingMsg);

  const fetchPromises = metalSlugs.map(({ slug }) =>
    fetch(V2_API + '/retail/' + slug + '/latest.json', { signal: AbortSignal.timeout(8000) })
      .then(r => r.ok ? r.json() : null)
      .then(json => ({ slug, data: json && json.data ? json.data : null }))
      .catch(() => ({ slug, data: null }))
  );

  const results = await Promise.allSettled(fetchPromises);
  const detailMap = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value && r.value.data) {
      detailMap[r.value.slug] = r.value.data;
    }
  }

  const allVendorIds = new Set();
  for (const slug in detailMap) {
    const vendors = detailMap[slug].vendors;
    if (vendors) {
      for (const vid in vendors) allVendorIds.add(vid);
    }
  }

  const vendorIds = Array.from(allVendorIds);

  if (vendorIds.length === 0) {
    tableWrap.textContent = '';
    const msg = document.createElement('div');
    msg.style.cssText = 'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
    msg.textContent = 'No vendor data available for this metal';
    tableWrap.appendChild(msg);
    return;
  }

  tableWrap.textContent = '';
  const scrollWrap = document.createElement('div');
  scrollWrap.style.overflowX = 'auto';

  const table = document.createElement('table');
  table.className = 'vendor-prices-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const thCoin = document.createElement('th');
  thCoin.textContent = 'COIN';
  headRow.appendChild(thCoin);

  for (const vid of vendorIds) {
    const th = document.createElement('th');
    th.textContent = _shortVendor(vid);
    headRow.appendChild(th);
  }

  const thMedian = document.createElement('th');
  thMedian.textContent = 'MEDIAN';
  headRow.appendChild(thMedian);
  const thSpread = document.createElement('th');
  thSpread.textContent = 'SPREAD';
  headRow.appendChild(thSpread);

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  for (const { slug, meta } of metalSlugs) {
    const detail = detailMap[slug];
    if (!detail || !detail.vendors) continue;

    const vData = detail.vendors;
    const weightOz = detail.weight_oz || meta.weight || 0;
    const spotPrice = _getSpotPrice(metalCode);

    const inStockPrices = [];
    for (const vid in vData) {
      if (vData[vid] && vData[vid].price > 0 && vData[vid].in_stock) {
        inStockPrices.push(vData[vid].price);
      }
    }
    const lowestPrice = inStockPrices.length > 0 ? Math.min(...inStockPrices) : null;

    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    const dot = document.createElement('span');
    dot.className = 'metal-dot ' + metalCode;
    tdName.appendChild(dot);

    const nameSpan = document.createElement('span');
    const displayName = meta.name || slug;
    nameSpan.textContent = sanitizeHtml(displayName);
    tdName.appendChild(nameSpan);

    const detailsBtn = document.createElement('button');
    detailsBtn.className = 'vp-details-btn';
    detailsBtn.textContent = 'Details';
    detailsBtn.setAttribute('data-slug', slug);
    detailsBtn.addEventListener('click', () => { openMarketDetailModal(slug); });
    tdName.appendChild(detailsBtn);

    tr.appendChild(tdName);

    for (const vid of vendorIds) {
      const td = document.createElement('td');
      const vInfo = vData[vid];

      if (!vInfo || vInfo.price == null || vInfo.price <= 0) {
        td.textContent = '\u2014';
        td.style.color = 'var(--text-muted)';
        tr.appendChild(td);
        continue;
      }

      if (vInfo.carried) td.classList.add('vp-carried');
      if (!vInfo.in_stock) {
        td.classList.add('vp-oos');
        const oosSpan = document.createElement('span');
        oosSpan.textContent = 'OOS';
        td.appendChild(oosSpan);
        tr.appendChild(td);
        continue;
      }

      if (vInfo.price === lowestPrice) td.classList.add('vp-best');

      const priceSpan = document.createElement('span');
      priceSpan.className = 'vp-price';
      priceSpan.textContent = '$' + _fmtPrice(vInfo.price);
      priceSpan.style.cursor = 'pointer';
      priceSpan.addEventListener('click', () => {
        const url = (window.retailProviders && window.retailProviders[slug] && window.retailProviders[slug][vid])
          || (vendorMeta[vid] && vendorMeta[vid].url)
          || null;
        if (url) {
          const popup = window.open(url, 'retail_vendor_' + vid, 'width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no');
          if (popup) popup.opener = null;
        }
      });
      td.appendChild(priceSpan);

      if (spotPrice && spotPrice > 0 && weightOz > 0) {
        const meltValue = spotPrice * weightOz;
        const premium = ((vInfo.price - meltValue) / meltValue) * 100;
        const premClass = premium < 5 ? 'low' : premium < 15 ? 'mid' : 'high';
        const premBadge = document.createElement('span');
        premBadge.className = 'vp-premium ' + premClass;
        premBadge.textContent = (premium >= 0 ? '+' : '') + premium.toFixed(1) + '%';
        td.appendChild(premBadge);
      }

      tr.appendChild(td);
    }

    const coinSummary = coins[slug];
    const tdMedian = document.createElement('td');
    tdMedian.className = 'vp-price';
    tdMedian.textContent = coinSummary && coinSummary.median != null ? '$' + _fmtPrice(coinSummary.median) : '\u2014';
    tr.appendChild(tdMedian);

    const tdSpread = document.createElement('td');
    tdSpread.className = 'vp-price';
    if (coinSummary && coinSummary.highest_price != null && coinSummary.lowest_price != null) {
      tdSpread.textContent = '$' + _fmtPrice(coinSummary.highest_price - coinSummary.lowest_price);
    } else {
      tdSpread.textContent = '\u2014';
    }
    tr.appendChild(tdSpread);

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  scrollWrap.appendChild(table);
  tableWrap.appendChild(scrollWrap);
};

const renderVendorPrices = () => {
  const container = safeGetElement('vendorPricesContainer');
  if (!container) return;

  const coins = _getRetailCoins();
  if (!coins || Object.keys(coins).length === 0) {
    container.textContent = '';
    const msg = document.createElement('div');
    msg.style.cssText = 'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
    msg.textContent = 'Retail data unavailable';
    container.appendChild(msg);
    return;
  }

  container.textContent = '';

  const tabBar = document.createElement('div');
  tabBar.className = 'vendor-prices-tabs';

  const metals = [
    { code: 'xau', label: 'Gold' },
    { code: 'xag', label: 'Silver' },
    { code: 'xpt', label: 'Platinum' },
    { code: 'xpd', label: 'Palladium' },
    { code: 'goldback', label: 'Goldback' }
  ];

  const savedTab = loadDataSync('vendorPricesActiveTab', 'xag');
  let activeTab = savedTab;

  const setActive = (code) => {
    activeTab = code;
    saveDataSync('vendorPricesActiveTab', code);
    const btns = tabBar.querySelectorAll('button');
    btns.forEach(b => b.classList.toggle('active', b.getAttribute('data-metal') === code));
    _renderVendorTable(code);
  };

  for (const m of metals) {
    const btn = document.createElement('button');
    btn.className = 'vp-tab' + (m.code === activeTab ? ' active' : '');
    btn.setAttribute('data-metal', m.code);
    btn.textContent = m.label;
    btn.addEventListener('click', () => { setActive(m.code); });
    tabBar.appendChild(btn);
  }

  container.appendChild(tabBar);

  _renderVendorTable(activeTab);
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
  renderVendorPrices();

  _marketDataInitialized = true;
};

const refreshMarketData = () => {
  renderBestPriceTicker();
  renderVendorPrices();
};

// ---------------------------------------------------------------------------
// Global exposure
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
  window.initMarketData = initMarketData;
  window.refreshMarketData = refreshMarketData;
  window.renderBestPriceTicker = renderBestPriceTicker;
  window.renderVendorPrices = renderVendorPrices;
  window.openMarketDetailModal = openMarketDetailModal;
}

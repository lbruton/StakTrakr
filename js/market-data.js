// js/market-data.js — Market Data Module (STAK-504)
// Orchestrates the best price ticker, vendor prices section, and market detail modal.

let _marketDataInitialized = false;
const V2_API = 'https://api.staktrakr.com/data/v2';

const _METAL_TO_ISO = { silver: 'xag', gold: 'xau', platinum: 'xpt', palladium: 'xpd' };
const _ISO_TO_METAL = { xag: 'silver', xau: 'gold', xpt: 'platinum', xpd: 'palladium' };

let _cachedSlugDetail = {};

const _fmtPrice = (n) => {
  if (n == null || isNaN(n)) return '\u2014';
  return n >= 100 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                   : n.toFixed(2);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _getSpotPrice = (metalCode) => {
  const englishKey = _ISO_TO_METAL[metalCode] || metalCode;
  if (typeof spotPrices !== 'undefined' && spotPrices && spotPrices[englishKey] != null) {
    return spotPrices[englishKey];
  }
  const capMetal = englishKey.charAt(0).toUpperCase() + englishKey.slice(1);
  const displayEl = safeGetElement('spotPriceDisplay' + capMetal);
  if (displayEl) {
    const parsed = parseFloat(displayEl.textContent.replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return null;
};

const _getRetailCoins = () => {
  // Check window cache first
  if (typeof window._v2RetailData !== 'undefined' && window._v2RetailData && window._v2RetailData.prices) {
    return window._v2RetailData.prices;
  }
  // Check v2-specific key
  const v2Cache = loadDataSync('v2RetailPrices', null);
  if (v2Cache && typeof v2Cache === 'object' && v2Cache.prices) return v2Cache.prices;
  // Check primary retail key (RETAIL_PRICES_KEY = "retailPrices")
  const retailCache = loadDataSync('retailPrices', null);
  if (retailCache && typeof retailCache === 'object' && retailCache.prices) return retailCache.prices;
  return {};
};

const _getCoinMeta = () => {
  if (typeof window._manifestCoinMeta !== 'undefined' && window._manifestCoinMeta) return window._manifestCoinMeta;
  if (typeof window.getRetailCoinMeta === 'function') return null;
  return loadDataSync('retailManifestCoinMeta', {});
};

const _getVendorMeta = () => {
  if (typeof window._manifestVendorMeta !== 'undefined' && window._manifestVendorMeta && Object.keys(window._manifestVendorMeta).length > 0) return window._manifestVendorMeta;
  const cached = loadDataSync('retailManifestVendorMeta', null);
  if (cached && Object.keys(cached).length > 0) return cached;
  return {};
};

// Fetch v2 manifest for coin + vendor metadata if not already cached
const _ensureManifest = async () => {
  const coinMeta = _getCoinMeta();
  const vendorMeta = _getVendorMeta();
  if (coinMeta && Object.keys(coinMeta).length > 0 && vendorMeta && Object.keys(vendorMeta).length > 0) return;
  try {
    const resp = await fetch(V2_API + '/manifest.json', { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return;
    const json = await resp.json();
    const data = json.data || json;
    if (data.coins && Array.isArray(data.coins)) {
      const cm = {};
      for (const c of data.coins) {
        cm[c.slug] = { name: c.name, metal: c.metal === 'xag' ? 'silver' : c.metal === 'xau' ? 'gold' : c.metal === 'xpt' ? 'platinum' : c.metal === 'xpd' ? 'palladium' : c.metal, weight: c.weight_oz || 0 };
      }
      window._manifestCoinMeta = cm;
      try { saveDataSync('retailManifestCoinMeta', cm); } catch (e) { /* quota */ }
    }
    if (data.vendors && Array.isArray(data.vendors)) {
      const vm = {};
      for (const v of data.vendors) {
        vm[v.id] = { name: v.name, color: v.color, url: v.url || null };
      }
      window._manifestVendorMeta = vm;
      try { saveDataSync('retailManifestVendorMeta', vm); } catch (e) { /* quota */ }
    }
    debugLog('[market-data] Fetched v2 manifest: ' + (data.coins ? data.coins.length : 0) + ' coins, ' + (data.vendors ? data.vendors.length : 0) + ' vendors', 'info');
  } catch (e) {
    debugLog('[market-data] Manifest fetch failed: ' + e.message, 'warn');
  }
};

// ---------------------------------------------------------------------------
// Ticker
// ---------------------------------------------------------------------------

const renderBestPriceTicker = () => {
  const container = safeGetElement('bestPriceTickerEl');
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
    } else if (typeof window.getRetailCoinMeta === 'function') {
      meta = window.getRetailCoinMeta(slug);
    } else {
      meta = { name: slug, weight: 0, metal: 'unknown' };
    }

    const metalLower = (meta.metal || '').toLowerCase();
    if (metalLower === 'goldback' || metalLower.startsWith('goldback')) continue;

    // Find cheapest in-stock vendor from the cached vendor data
    let bestVid = null;
    let bestPrice = Infinity;
    for (const vid in coin.vendors) {
      const v = coin.vendors[vid];
      if (v && v.price > 0 && (v.in_stock === true || v.inStock === true) && v.price < bestPrice) {
        bestPrice = v.price;
        bestVid = vid;
      }
    }
    if (!bestVid || bestPrice === Infinity) continue;

    const weightOz = meta.weight || 0;
    const spot = _getSpotPrice(metalLower);
    let premium = null;
    if (spot && spot > 0 && weightOz > 0) {
      const meltValue = spot * weightOz;
      premium = ((bestPrice - meltValue) / meltValue) * 100;
    }

    // Get vendor display info
    const vendorName = _shortVendor(bestVid);
    const vendorColor = vendorMeta[bestVid] ? vendorMeta[bestVid].color : null;
    const vendorUrl = (window.retailProviders && window.retailProviders[slug] && window.retailProviders[slug][bestVid])
      || (vendorMeta[bestVid] && vendorMeta[bestVid].url) || null;

    items.push({
      slug, name: meta.name || slug, metal: metalLower,
      bestPrice, premium, vendorName, vendorColor, vendorUrl, bestVid,
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
    if (item.vendorUrl) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const popup = window.open(item.vendorUrl, 'retail_vendor_' + item.bestVid, 'width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no');
        if (popup) popup.opener = null;
      });
    }

    const dot = document.createElement('span');
    const isoCode = _METAL_TO_ISO[item.metal] || '';
    dot.className = 'metal-dot' + (isoCode ? ' ' + isoCode : '');
    el.appendChild(dot);

    const coinSpan = document.createElement('span');
    coinSpan.className = 'coin';
    const displayName = item.name.length > 30 ? item.name.substring(0, 27) + '\u2026' : item.name;
    coinSpan.textContent = displayName;
    el.appendChild(coinSpan);

    const vendorSpan = document.createElement('span');
    vendorSpan.className = 'vendor';
    vendorSpan.textContent = item.vendorName;
    if (item.vendorColor) vendorSpan.style.color = item.vendorColor;
    el.appendChild(vendorSpan);

    const priceSpan = document.createElement('span');
    priceSpan.className = 'price';
    priceSpan.textContent = '$' + _fmtPrice(item.bestPrice);
    el.appendChild(priceSpan);

    const premiumSpan = document.createElement('span');
    premiumSpan.className = 'premium';
    if (item.premium != null) {
      premiumSpan.textContent = (item.premium >= 0 ? '+' : '') + item.premium.toFixed(1) + '%';
    }
    el.appendChild(premiumSpan);

    return el;
  };

  // Build TWO identical content blocks for seamless loop
  const block1 = document.createElement('div');
  block1.className = 'ticker-block';
  const block2 = document.createElement('div');
  block2.className = 'ticker-block';

  for (const item of items) {
    block1.appendChild(buildTickerItem(item));
    block2.appendChild(buildTickerItem(item));
  }

  if (items.length >= 4) {
    track.appendChild(block1);
    track.appendChild(block2);
  } else {
    track.classList.add('static');
    track.appendChild(block1);
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

let _activeModalChart = null;

const _modalEscHandler = (e) => {
  if (e.key === 'Escape') closeMarketDetailModal();
};

const closeMarketDetailModal = () => {
  if (_activeModalChart && typeof destroyCoinChart === 'function') {
    destroyCoinChart(_activeModalChart);
  }
  _activeModalChart = null;

  const content = safeGetElement('marketDetailContent');
  if (content) content.textContent = '';

  const overlay = safeGetElement('marketDetailModal');
  if (overlay) overlay.setAttribute('hidden', '');

  document.removeEventListener('keydown', _modalEscHandler);
};

const openMarketDetailModal = async (slug) => {
  const overlay = safeGetElement('marketDetailModal');
  const content = safeGetElement('marketDetailContent');
  if (!overlay || !content) return;

  content.textContent = '';
  overlay.removeAttribute('hidden');

  const closeBtn = safeGetElement('marketDetailCloseBtn');
  if (closeBtn) closeBtn.onclick = () => closeMarketDetailModal();
  overlay.onclick = (e) => { if (e.target === overlay) closeMarketDetailModal(); };
  document.addEventListener('keydown', _modalEscHandler);

  const loadingEl = document.createElement('div');
  loadingEl.style.cssText = 'padding:48px;text-align:center;color:var(--text-muted);font-size:13px;';
  loadingEl.textContent = 'Loading coin details\u2026';
  content.appendChild(loadingEl);

  const coinMetaMap = _getCoinMeta();
  const vendorMeta = _getVendorMeta();

  let coinMeta;
  if (coinMetaMap && coinMetaMap[slug]) {
    coinMeta = coinMetaMap[slug];
  } else if (typeof window.getRetailCoinMeta === 'function') {
    coinMeta = window.getRetailCoinMeta(slug);
  } else {
    coinMeta = { name: slug, weight: 0, metal: 'unknown' };
  }

  const metalLower = (coinMeta.metal || '').toLowerCase();
  const metalCode = _METAL_TO_ISO[metalLower] || metalLower;

  const detailPromise = fetch(V2_API + '/retail/' + slug + '/latest.json', { signal: AbortSignal.timeout(10000) })
    .then(r => r.ok ? r.json() : null)
    .then(json => json && json.data ? json.data : null)
    .catch(() => null);

  const cachedHistory = loadDataSync('v2SpotHistory', null);
  const cachedTs = loadDataSync('v2SpotHistoryTs', null);
  const historyStale = !cachedHistory || !cachedTs || (Date.now() - new Date(cachedTs).getTime() > 3600000);

  const historyPromise = historyStale
    ? fetch(V2_API + '/spot/history/7d.json', { signal: AbortSignal.timeout(10000) })
        .then(r => r.ok ? r.json() : null)
        .then(json => {
          if (json) {
            saveDataSync('v2SpotHistory', json);
            saveDataSync('v2SpotHistoryTs', new Date().toISOString());
          }
          return json;
        })
        .catch(() => null)
    : Promise.resolve(cachedHistory);

  const [detailResult, historyResult] = await Promise.allSettled([detailPromise, historyPromise]);
  const detail = detailResult.status === 'fulfilled' ? detailResult.value : null;

  content.textContent = '';

  // ── Header ──
  const header = document.createElement('div');
  header.className = 'market-detail-header';

  const h2 = document.createElement('h2');
  const dot = document.createElement('span');
  dot.className = 'metal-dot' + (metalCode ? ' ' + metalCode : '');
  h2.appendChild(dot);
  const nameText = document.createTextNode(' ' + sanitizeHtml(coinMeta.name || slug));
  h2.appendChild(nameText);
  header.appendChild(h2);

  const weightOz = (detail && detail.weight_oz) || coinMeta.weight || 0;
  if (weightOz > 0) {
    const metalNames = { xau: 'Gold', xag: 'Silver', xpt: 'Platinum', xpd: 'Palladium' };
    const metalName = metalNames[metalCode] || metalLower;
    const weightInfo = document.createElement('div');
    weightInfo.style.cssText = 'font-size:12px;color:var(--text-muted);margin-top:2px;';
    weightInfo.textContent = weightOz + ' oz ' + metalName;
    header.appendChild(weightInfo);
  }

  content.appendChild(header);

  // ── Price summary ──
  if (detail) {
    const coins = _getRetailCoins();
    const coinSummary = coins[slug];
    const median = coinSummary && coinSummary.median != null ? coinSummary.median : null;
    const low = detail.lowest_price || (coinSummary && coinSummary.lowest_price) || null;
    const high = detail.highest_price || (coinSummary && coinSummary.highest_price) || null;
    const spread = (low != null && high != null) ? (high - low) : null;

    const priceRow = document.createElement('div');
    priceRow.style.cssText = 'display:flex;gap:24px;flex-wrap:wrap;margin-bottom:1rem;font-size:13px;';

    const addStat = (label, value) => {
      const stat = document.createElement('div');
      const lbl = document.createElement('div');
      lbl.style.cssText = 'color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;';
      lbl.textContent = label;
      stat.appendChild(lbl);
      const val = document.createElement('div');
      val.style.cssText = 'font-family:ui-monospace,monospace;font-size:14px;font-weight:600;';
      val.textContent = value;
      stat.appendChild(val);
      priceRow.appendChild(stat);
    };

    if (median != null) addStat('Median', '$' + _fmtPrice(median));
    if (low != null) addStat('Low', '$' + _fmtPrice(low));
    if (high != null) addStat('High', '$' + _fmtPrice(high));
    if (spread != null) addStat('Spread', '$' + _fmtPrice(spread));

    content.appendChild(priceRow);
  }

  // ── Chart ──
  const chartWrap = document.createElement('div');
  chartWrap.className = 'market-detail-chart';
  chartWrap.id = 'marketDetailChartArea';
  content.appendChild(chartWrap);

  if (typeof createCoinChart === 'function') {
    _activeModalChart = createCoinChart('marketDetailChartArea', metalCode);
    if (!_activeModalChart) {
      const noChart = document.createElement('div');
      noChart.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px;';
      noChart.textContent = 'Chart unavailable';
      chartWrap.appendChild(noChart);
    }
  } else {
    const noChart = document.createElement('div');
    noChart.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px;';
    noChart.textContent = 'Chart unavailable';
    chartWrap.appendChild(noChart);
  }

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
      const scrollWrap = document.createElement('div');
      scrollWrap.style.overflowX = 'auto';

      const table = document.createElement('table');
      table.className = 'vendor-prices-table';
      table.style.marginTop = '0.5rem';

      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      const headers = ['Vendor', 'Price', 'Premium', 'Stock', 'Buy'];
      for (const h of headers) {
        const th = document.createElement('th');
        th.textContent = h;
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');

      for (const entry of vendorEntries) {
        const tr = document.createElement('tr');

        // Vendor name
        const tdVendor = document.createElement('td');
        const vMeta = vendorMeta[entry.vid];
        tdVendor.textContent = _shortVendor(entry.vid);
        if (vMeta && vMeta.color) {
          tdVendor.style.color = vMeta.color;
        }
        tr.appendChild(tdVendor);

        // Price
        const tdPrice = document.createElement('td');
        tdPrice.style.fontFamily = 'ui-monospace, monospace';
        tdPrice.textContent = entry.price > 0 ? '$' + _fmtPrice(entry.price) : '\u2014';
        tr.appendChild(tdPrice);

        // Premium
        const tdPrem = document.createElement('td');
        if (entry.price > 0 && spotPrice && spotPrice > 0 && weightOz > 0) {
          const meltValue = spotPrice * weightOz;
          const premium = ((entry.price - meltValue) / meltValue) * 100;
          const premClass = premium < 5 ? 'low' : premium < 15 ? 'mid' : 'high';
          const badge = document.createElement('span');
          badge.className = 'vp-premium ' + premClass;
          badge.textContent = (premium >= 0 ? '+' : '') + premium.toFixed(1) + '%';
          tdPrem.appendChild(badge);
        } else {
          tdPrem.textContent = '\u2014';
          tdPrem.style.color = 'var(--text-muted)';
        }
        tr.appendChild(tdPrem);

        // Stock
        const tdStock = document.createElement('td');
        if (entry.in_stock) {
          tdStock.style.color = 'var(--success)';
          tdStock.textContent = 'In Stock';
        } else if (entry.carried) {
          tdStock.style.color = 'var(--warning, #eab308)';
          tdStock.textContent = 'Carried';
        } else {
          tdStock.style.color = 'var(--danger)';
          tdStock.textContent = 'Out of Stock';
        }
        tr.appendChild(tdStock);

        // Buy link
        const tdBuy = document.createElement('td');
        const url = (window.retailProviders && window.retailProviders[slug] && window.retailProviders[slug][entry.vid])
          || (entry.url)
          || (vMeta && vMeta.url)
          || null;
        if (url && entry.price > 0) {
          const buyBtn = document.createElement('a');
          buyBtn.textContent = 'Buy';
          buyBtn.href = '#';
          buyBtn.style.cssText = 'color:var(--primary);text-decoration:none;font-weight:600;font-size:12px;';
          buyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const popup = window.open(url, 'retail_vendor_' + entry.vid, 'width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no');
            if (popup) popup.opener = null;
          });
          tdBuy.appendChild(buyBtn);
        } else {
          tdBuy.textContent = '\u2014';
          tdBuy.style.color = 'var(--text-muted)';
        }
        tr.appendChild(tdBuy);

        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      scrollWrap.appendChild(table);
      content.appendChild(scrollWrap);
    }
  } else {
    const noData = document.createElement('div');
    noData.style.cssText = 'padding:16px;text-align:center;color:var(--text-muted);font-size:13px;';
    noData.textContent = 'Vendor data unavailable for this coin';
    content.appendChild(noData);
  }

  debugLog('[market-data] Detail modal opened for: ' + slug, 'info');
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
      _cachedSlugDetail[r.value.slug] = r.value.data;
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
    const vMeta = vendorMeta[vid];
    if (vMeta && vMeta.color) th.style.color = vMeta.color;
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
      const _vs = vData[vid];
      if (_vs && _vs.price > 0 && (_vs.in_stock === true || _vs.inStock === true)) {
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
    nameSpan.className = 'vp-coin-link';
    nameSpan.style.cursor = 'pointer';
    nameSpan.addEventListener('click', () => { openMarketDetailModal(slug); });
    tdName.appendChild(nameSpan);

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
      if (!vInfo.in_stock && !vInfo.inStock) {
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
    const medianVal = coinSummary ? (coinSummary.median_price != null ? coinSummary.median_price : coinSummary.median) : null;
    tdMedian.textContent = medianVal != null ? '$' + _fmtPrice(medianVal) : '\u2014';
    tr.appendChild(tdMedian);

    const tdSpread = document.createElement('td');
    tdSpread.className = 'vp-price';
    // Calculate high/low from vendor data since summary may not have these fields
    const allPrices = inStockPrices.length > 0 ? inStockPrices : [];
    const calcHigh = allPrices.length > 0 ? Math.max(...allPrices) : null;
    const calcLow = allPrices.length > 0 ? Math.min(...allPrices) : null;
    if (calcHigh != null && calcLow != null && calcHigh !== calcLow) {
      tdSpread.textContent = '$' + _fmtPrice(calcHigh - calcLow);
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

  // Ensure v2 manifest (coin + vendor metadata) is available
  await _ensureManifest();

  let retailData = null;
  if (typeof window._v2RetailData !== 'undefined' && window._v2RetailData) {
    retailData = window._v2RetailData;
  }
  if (!retailData) {
    retailData = await loadData('v2RetailPrices', null);
  }
  if (!retailData) {
    retailData = await loadData('retailPrices', null);
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
    // Retail sync may still be in progress — retry after a delay (up to 3 attempts)
    if (!initMarketData._retryCount) initMarketData._retryCount = 0;
    initMarketData._retryCount++;
    if (initMarketData._retryCount <= 3) {
      const delay = initMarketData._retryCount * 5000;
      debugLog('[market-data] No retail data yet — retry ' + initMarketData._retryCount + '/3 in ' + (delay / 1000) + 's', 'info');
      _marketDataInitialized = false;
      setTimeout(() => {
        _marketDataInitialized = false;
        initMarketData().catch(() => {});
      }, delay);
      return;
    }
    debugLog('[market-data] No retail data available after 3 retries — ticker hidden, vendor section empty', 'warn');
    return;
  }

  initMarketData._retryCount = 0;

  // Pre-fetch spot history for charts (non-blocking, cached for modal use)
  const cachedHistory = loadDataSync('v2SpotHistory', null);
  if (!cachedHistory) {
    fetch(V2_API + '/spot/history/7d.json', { signal: AbortSignal.timeout(10000) })
      .then(r => r.ok ? r.json() : null)
      .then(json => { if (json) { saveDataSync('v2SpotHistory', json); saveDataSync('v2SpotHistoryTs', new Date().toISOString()); } })
      .catch(() => {});
  }

  renderBestPriceTicker();
  renderVendorPrices();

  setTimeout(() => { renderBestPriceTicker(); }, 12000);

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
  window.closeMarketDetailModal = closeMarketDetailModal;
}

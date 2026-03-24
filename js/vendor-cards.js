// ---------------------------------------------------------------------------
// Vendor Intelligence Cards — STAK-435
// Renders a horizontal carousel of per-vendor market price + portfolio cards.
// ---------------------------------------------------------------------------

const SOURCE_VENDOR_ALIASES = {
  'jm':               'jmbullion',
  'sd':               'sdbullion',
  'monument':         'monumentmetals',
  'hero':             'herobullion',
  'bullionx':         'bullionexchanges',
  'summit':           'summitmetals',
  'provident':        'providentmetals',
  'gainesville':      'gainesvillecoins',
};

const _resolveVendor = (source) => {
  if (!source) return null;
  const normalized = String(source)
    .trim()
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/, '')
    .replace(/\.com\/?$/, '')
    .replace(/\s+/g, '');
  if (!normalized) return null;
  if (normalized === 'goldback') return null;
  if (typeof RETAIL_VENDOR_NAMES !== 'undefined' && RETAIL_VENDOR_NAMES[normalized]) return normalized;
  return SOURCE_VENDOR_ALIASES[normalized] || null;
};

const _computeVendorStats = () => {
  const stats = new Map();
  if (typeof inventory === 'undefined' || !Array.isArray(inventory)) return stats;

  const metalNameMap = {};
  if (typeof METALS !== 'undefined') {
    Object.values(METALS).forEach(m => { metalNameMap[m.name] = m.key; });
  }

  for (const item of inventory) {
    if (typeof isDisposed === 'function' && isDisposed(item)) continue;

    const vendorId = _resolveVendor(item.purchaseLocation);
    if (!vendorId) continue;

    if (!stats.has(vendorId)) {
      stats.set(vendorId, {
        vendorId,
        totalItems: 0,
        totalWeight: 0,
        totalPurchased: 0,
        totalMeltValue: 0,
        totalRetailValue: 0,
        totalGainLoss: 0,
        sourceValues: new Set(),
      });
    }

    const entry = stats.get(vendorId);
    entry.sourceValues.add(item.purchaseLocation);

    const qty = Number(item.qty) || 0;
    const weight = parseFloat(item.weight) || 0;
    const price = parseFloat(item.price) || 0;

    entry.totalItems += qty;

    const weightOz = (item.weightUnit === 'gb') ? weight * (typeof GB_TO_OZT !== 'undefined' ? GB_TO_OZT : 0.001) : weight;
    const itemWeight = qty * weightOz;
    entry.totalWeight += itemWeight;

    const metalKey = metalNameMap[item.metal] || '';
    const currentSpot = (typeof spotPrices !== 'undefined' && spotPrices[metalKey]) || 0;

    const valuation = (typeof computeItemValuation === 'function')
      ? computeItemValuation(item, currentSpot)
      : null;

    const purity = parseFloat(item.purity) || 1.0;
    const meltValue = valuation ? valuation.meltValue : (currentSpot * itemWeight * purity);
    entry.totalMeltValue += meltValue;

    const purchaseTotal = valuation ? valuation.purchaseTotal : (qty * price);
    entry.totalPurchased += purchaseTotal;

    const retailTotal = valuation ? valuation.retailTotal : meltValue;
    entry.totalRetailValue += retailTotal;

    entry.totalGainLoss += retailTotal - purchaseTotal;
  }

  return stats;
};

const _computeMarketPremium = (vendorId) => {
  if (typeof getActiveRetailSlugs !== 'function') return null;
  if (typeof retailPrices === 'undefined' || !retailPrices?.prices) return null;
  if (typeof getRetailCoinMeta !== 'function') return null;
  if (typeof spotPrices === 'undefined') return null;

  const slugs = getActiveRetailSlugs();
  let premiumSum = 0;
  let count = 0;

  for (const slug of slugs) {
    const entry = retailPrices.prices[slug];
    if (!entry?.vendors?.[vendorId]) continue;

    const vendorData = entry.vendors[vendorId];
    if (!vendorData.inStock) continue;

    const vendorPrice = Number(vendorData.price);
    if (!vendorPrice || vendorPrice <= 0) continue;

    const coinMeta = getRetailCoinMeta(slug);
    if (!coinMeta || !coinMeta.weight || !coinMeta.metal) continue;

    const metalSpot = spotPrices[coinMeta.metal] || 0;
    if (metalSpot <= 0) continue;

    const coinMelt = coinMeta.weight * metalSpot;
    if (coinMelt <= 0) continue;

    premiumSum += (vendorPrice - coinMelt) / coinMelt;
    count++;
  }

  return count > 0 ? premiumSum / count : null;
};

const _getVendorPriceRows = (vendorId) => {
  if (typeof getActiveRetailSlugs !== 'function') return [];
  if (typeof retailPrices === 'undefined' || !retailPrices?.prices) return [];

  const rows = [];
  const slugs = getActiveRetailSlugs();

  for (const slug of slugs) {
    const entry = retailPrices.prices[slug];
    if (!entry?.vendors?.[vendorId]) continue;

    const vendorData = entry.vendors[vendorId];
    const vendorPrice = Number(vendorData.price);
    if (!vendorPrice || vendorPrice <= 0) continue;

    const coinMeta = (typeof getRetailCoinMeta === 'function') ? getRetailCoinMeta(slug) : { name: slug, weight: 0, metal: 'unknown' };
    const medianPrice = Number(entry.median_price) || 0;
    const delta = medianPrice > 0 ? vendorPrice - medianPrice : 0;

    let productUrl = null;
    if (typeof retailProviders !== 'undefined' && retailProviders?.[slug]?.[vendorId]) {
      productUrl = retailProviders[slug][vendorId];
    }

    rows.push({
      slug,
      name: coinMeta.name || slug,
      metal: coinMeta.metal || 'unknown',
      price: vendorPrice,
      delta,
      productUrl,
      inStock: vendorData.inStock !== false,
    });
  }

  const metalOrder = { gold: 0, silver: 1, platinum: 2, palladium: 3 };
  rows.sort((a, b) => {
    const ma = metalOrder[a.metal] ?? 99;
    const mb = metalOrder[b.metal] ?? 99;
    if (ma !== mb) return ma - mb;
    return a.slug.localeCompare(b.slug);
  });

  return rows;
};

const _buildDeltaSpan = (delta) => {
  if (Math.abs(delta) < 0.005) {
    return `<span class="vendor-card-delta neutral">\u2014</span>`;
  }
  const dir = delta > 0 ? 'up' : 'down';
  const icon = delta > 0 ? '\u25B2' : '\u25BC';
  const prefix = delta > 0 ? '+' : '-';
  const formatted = (typeof formatCurrency === 'function') ? formatCurrency(Math.abs(delta)) : `$${Math.abs(delta).toFixed(2)}`;
  return `<span class="vendor-card-delta ${dir}">${icon} ${prefix}${formatted}</span>`;
};

const renderVendorCards = () => {
  const carousel = safeGetElement('vendorCardsCarousel');
  const hint = safeGetElement('vendorCardsHint');
  if (!carousel) return;

  if (typeof retailPrices === 'undefined' || !retailPrices?.prices || Object.keys(retailPrices.prices).length === 0) {
    if (hint) hint.style.display = '';
    carousel.style.display = 'none';
    return;
  }

  // Build list of vendors that have at least 1 price row
  const allVendorIds = new Set();
  if (typeof getActiveRetailSlugs === 'function') {
    const slugs = getActiveRetailSlugs();
    for (const slug of slugs) {
      const entry = retailPrices.prices[slug];
      if (!entry?.vendors) continue;
      for (const vid of Object.keys(entry.vendors)) {
        const vd = entry.vendors[vid];
        if (Number(vd.price) > 0) allVendorIds.add(vid);
      }
    }
  }

  if (allVendorIds.size === 0) {
    if (hint) hint.style.display = '';
    carousel.style.display = 'none';
    return;
  }

  if (hint) hint.style.display = 'none';
  carousel.style.display = '';
  carousel.innerHTML = '';

  // Compute vendor stats once for all cards
  const vendorStats = _computeVendorStats();

  for (const vendorId of allVendorIds) {
    const priceRows = _getVendorPriceRows(vendorId);
    if (priceRows.length === 0) continue;

    const vendorDisplay = (typeof getVendorDisplay === 'function') ? getVendorDisplay(vendorId) : { name: vendorId, color: '#6c757d', url: null };
    const premium = _computeMarketPremium(vendorId);
    const stats = vendorStats.get(vendorId);

    const card = document.createElement('div');
    card.className = 'vendor-card total-card';
    card.setAttribute('data-vendor-id', vendorId);

    // --- Header: title with vendor color border ---
    const titleEl = document.createElement('div');
    titleEl.className = 'total-title';
    titleEl.style.borderBottomColor = vendorDisplay.color;
    titleEl.style.textAlign = 'left';

    if (vendorDisplay.url) {
      const nameLink = document.createElement('a');
      nameLink.href = vendorDisplay.url;
      nameLink.target = '_blank';
      nameLink.rel = 'noopener noreferrer';
      nameLink.textContent = vendorDisplay.name;
      nameLink.style.color = 'inherit';
      nameLink.style.textDecoration = 'none';
      titleEl.appendChild(nameLink);
    } else {
      titleEl.textContent = vendorDisplay.name;
    }
    card.appendChild(titleEl);

    // --- Premium badge ---
    if (premium !== null) {
      const badge = document.createElement('div');
      badge.className = 'vendor-card-premium';
      const sign = premium >= 0 ? '+' : '';
      badge.textContent = `Avg ${sign}${(premium * 100).toFixed(1)}%`;
      card.appendChild(badge);
    }

    // --- Price table (primary content) ---
    const priceGroup = document.createElement('div');
    priceGroup.className = 'total-group';

    for (const row of priceRows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'total-item';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'total-label';
      if (row.productUrl) {
        const link = document.createElement('a');
        link.href = row.productUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = row.name;
        link.style.color = 'inherit';
        link.style.textDecoration = 'none';
        labelSpan.appendChild(link);
      } else {
        labelSpan.textContent = row.name;
      }

      const valueSpan = document.createElement('span');
      valueSpan.className = 'total-value';
      const priceText = (typeof formatCurrency === 'function') ? formatCurrency(row.price) : `$${row.price.toFixed(2)}`;
      // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
      valueSpan.innerHTML = `${priceText} ${_buildDeltaSpan(row.delta)}`;

      rowEl.appendChild(labelSpan);
      rowEl.appendChild(valueSpan);
      priceGroup.appendChild(rowEl);
    }

    card.appendChild(priceGroup);

    // --- Portfolio summary (secondary, only if user has items at this vendor) ---
    if (stats && stats.totalItems > 0) {
      const portfolioGroup = document.createElement('div');
      portfolioGroup.className = 'total-group';

      const itemRow = document.createElement('div');
      itemRow.className = 'total-item';
      const itemLabel = document.createElement('span');
      itemLabel.className = 'total-label';
      itemLabel.textContent = 'Holdings:';
      const itemValue = document.createElement('span');
      itemValue.className = 'total-value';
      itemValue.textContent = `${stats.totalItems} items \u00B7 ${stats.totalWeight.toFixed(1)} oz`;
      itemRow.appendChild(itemLabel);
      itemRow.appendChild(itemValue);
      portfolioGroup.appendChild(itemRow);

      const costRow = document.createElement('div');
      costRow.className = 'total-item';
      const costLabel = document.createElement('span');
      costLabel.className = 'total-label';
      costLabel.textContent = 'Cost / Melt:';
      const costValue = document.createElement('span');
      costValue.className = 'total-value';
      const costFmt = (typeof formatCurrency === 'function') ? formatCurrency(stats.totalPurchased) : `$${stats.totalPurchased.toFixed(0)}`;
      const meltFmt = (typeof formatCurrency === 'function') ? formatCurrency(stats.totalMeltValue) : `$${stats.totalMeltValue.toFixed(0)}`;
      costValue.textContent = `${costFmt} / ${meltFmt}`;
      costRow.appendChild(costLabel);
      costRow.appendChild(costValue);
      portfolioGroup.appendChild(costRow);

      const glRow = document.createElement('div');
      glRow.className = 'total-item total-item-bottom-line';
      const glLabel = document.createElement('span');
      glLabel.className = 'total-label';
      const gl = stats.totalGainLoss || 0;
      const glPct = stats.totalPurchased > 0 ? (gl / stats.totalPurchased) * 100 : 0;
      glLabel.textContent = gl >= 0 ? 'Gain:' : 'Loss:';
      glLabel.style.color = gl >= 0 ? 'var(--success)' : 'var(--danger)';
      const glValue = document.createElement('span');
      glValue.className = 'total-value';
      const glPrefix = gl >= 0 ? '+' : '-';
      const glFmt = (typeof formatCurrency === 'function') ? formatCurrency(Math.abs(gl)) : `$${Math.abs(gl).toFixed(2)}`;
      glValue.textContent = `${glPrefix}${glFmt} (${glPrefix}${Math.abs(glPct).toFixed(1)}%)`;
      glValue.style.color = gl >= 0 ? 'var(--success)' : 'var(--danger)';
      glRow.appendChild(glLabel);
      glRow.appendChild(glValue);
      portfolioGroup.appendChild(glRow);

      card.appendChild(portfolioGroup);
    }

    // --- Click handler: filter inventory to this vendor ---
    if (stats && stats.sourceValues.size > 0) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', (e) => {
        if (e.target.tagName === 'A') return;
        if (typeof activeFilters !== 'undefined') {
          activeFilters['purchaseLocation'] = { values: [...stats.sourceValues] };
        }
        if (typeof renderTable === 'function') renderTable();
        if (typeof renderActiveFilters === 'function') renderActiveFilters();
        const tableSection = safeGetElement('inventoryTableSection');
        if (tableSection) tableSection.scrollIntoView({ behavior: 'smooth' });
      });
    }

    carousel.appendChild(card);
  }

  _initVendorCarousel();
};

const _initVendorCarousel = () => {
  const carousel = safeGetElement('vendorCardsCarousel');
  const prevBtn = safeGetElement('vendorCardsPrev');
  const nextBtn = safeGetElement('vendorCardsNext');
  const dotsEl = safeGetElement('vendorCardsDots');

  if (!carousel || !prevBtn || !nextBtn || !dotsEl) return;

  const cards = Array.from(carousel.querySelectorAll('.vendor-card'));
  if (!cards.length) return;

  // --- Build dots ---
  dotsEl.innerHTML = '';
  const dots = cards.map((card, i) => {
    const dot = document.createElement('button');
    dot.className = 'totals-dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('aria-label', `Go to vendor card ${i + 1}`);
    dot.addEventListener('click', () => {
      carousel.scrollTo({ left: card.offsetLeft, behavior: 'smooth' });
    });
    dotsEl.appendChild(dot);
    return dot;
  });

  // --- Helpers ---
  const getCardWidth = () => {
    const card = cards[0];
    const gap = parseFloat(getComputedStyle(carousel).gap) || 0;
    return card.getBoundingClientRect().width + gap;
  };

  const updateState = () => {
    const scrollLeft = carousel.scrollLeft;
    const maxScroll = carousel.scrollWidth - carousel.clientWidth;

    prevBtn.disabled = scrollLeft < 4;
    nextBtn.disabled = scrollLeft >= maxScroll - 1;

    const activeIdx = Math.round(scrollLeft / getCardWidth());
    dots.forEach((d, i) => d.classList.toggle('active', i === activeIdx));

    // Hide nav when all cards fit
    const allFit = carousel.scrollWidth <= carousel.clientWidth + 4;
    prevBtn.style.display = allFit ? 'none' : '';
    nextBtn.style.display = allFit ? 'none' : '';
    dotsEl.style.display = allFit ? 'none' : '';
  };

  // --- Button clicks ---
  prevBtn.addEventListener('click', () => {
    carousel.scrollBy({ left: -getCardWidth(), behavior: 'smooth' });
  });
  nextBtn.addEventListener('click', () => {
    carousel.scrollBy({ left: getCardWidth(), behavior: 'smooth' });
  });

  // --- Scroll tracking ---
  let scrollTimer;
  carousel.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(updateState, 50);
  }, { passive: true });

  // --- Initial state ---
  updateState();
};

window.renderVendorCards = renderVendorCards;

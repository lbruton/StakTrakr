// VIEW ITEM MODAL — Card-style showcase with coin images + enriched data
// =============================================================================

/**
 * Active object URLs created for the current view modal session.
 * Revoked on modal close to prevent memory leaks.
 * @type {string[]}
 */
let _viewModalObjectUrls = [];

/** @type {Chart|null} Price history chart instance — destroyed on modal close */
let _viewModalChartInstance = null;

/** @type {number[]} Available chart range options (0 = all, -1 = from purchase date) */
const _VIEW_CHART_RANGES = [7, 14, 30, 60, 90, 180, 365, 1825, 3650, -1, 0];

/** @type {string[]} Display labels for chart range pills */
const _VIEW_CHART_RANGE_LABELS = ['7d', '14d', '30d', '60d', '90d', '180d', '1Y', '5Y', '10Y', 'Purchased', 'All'];

/** @type {number} Default chart range in days (-1 = from purchase date, falls back to 30d) */
const _VIEW_CHART_DEFAULT_RANGE = -1;

/** Session-persistent state for "Show more fields" toggle in re-sync picker */
let _resyncPickerShowMore = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open the view modal for a specific inventory item.
 * @param {number} index - Index into the global `inventory` array
 */
async function showViewModal(index) {
  const item = inventory[index];
  if (!item) return;

  const modal = document.getElementById('viewItemModal');
  if (!modal) return;

  const body = document.getElementById('viewModalBody');
  if (!body) return;

  // Build modal content
  body.textContent = '';
  body.appendChild(buildViewContent(item, index));

  // Render price history chart (canvas must be in DOM first)
  const chartCanvas = body.querySelector('#viewPriceHistoryChart');
  if (chartCanvas && chartCanvas._chartData) {
    const cd = chartCanvas._chartData;
    // "Purchased" default (-1): calculate days from purchase date, fall back to 30d
    let initRange = _VIEW_CHART_DEFAULT_RANGE;
    if (initRange === -1) {
      initRange = cd.purchaseDate > 0
        ? Math.max(1, Math.ceil((Date.now() - cd.purchaseDate) / 86400000))
        : 30;
    }
    if (initRange === 0 || initRange > 180) {
      const metalName = item.metal || 'Silver';
      _fetchHistoricalSpotData(metalName, initRange).then((fullSpot) => {
        _createPriceHistoryChart(chartCanvas, fullSpot, cd.retailEntries, cd.purchasePerUnit, cd.meltFactor, initRange, cd.purchaseDate, cd.currentRetail);
      }).catch(() => {
        _createPriceHistoryChart(chartCanvas, cd.spotEntries, cd.retailEntries, cd.purchasePerUnit, cd.meltFactor, initRange, cd.purchaseDate, cd.currentRetail);
      });
    } else {
      _createPriceHistoryChart(chartCanvas, cd.spotEntries, cd.retailEntries, cd.purchasePerUnit, cd.meltFactor, initRange, cd.purchaseDate, cd.currentRetail);
    }
  }

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Load images and Numista data asynchronously after modal is visible
  // Share a single API result to avoid duplicate calls
  const catalogId = item.numistaId || '';
  let apiResult = null;

  // Try loading images from cache/item first
  const cacheResult = await loadViewImages(item, body);
  const imagesLoaded = cacheResult.loaded;
  const imageSource = cacheResult.source;

  // Check whether metadata is already cached in IndexedDB
  let metaCached = false;
  if (catalogId && window.imageCache?.isAvailable()) {
    try {
      const cachedMeta = await imageCache.getMetadata(catalogId);
      metaCached = !!(cachedMeta && (Date.now() - (cachedMeta.cachedAt || 0)) < VIEW_METADATA_TTL);
    } catch { /* ignore */ }
  }

  // Only hit the API when images are missing OR metadata is not in cache
  if (catalogId && (!imagesLoaded || !metaCached)) {
    apiResult = await _fetchNumistaResult(catalogId);
  }

  // Fill images from API result when no images were loaded at all
  const shouldReplaceWithApi = !imagesLoaded;

  if (shouldReplaceWithApi && apiResult && (apiResult.imageUrl || apiResult.reverseImageUrl)) {
    const section = body.querySelector('#viewImageSection');
    if (section) {
      const slots = section.querySelectorAll('.view-image-slot');
      if (apiResult.imageUrl) _setSlotImage(slots[0], apiResult.imageUrl);
      if (apiResult.reverseImageUrl) _setSlotImage(slots[1], apiResult.reverseImageUrl);
    }
  }

  // Do NOT persist CDN URLs from the view modal back to the inventory item (STAK-311).
  // Writing here bypasses the save-path image priority cascade and can stick URLs to
  // items that the user has deliberately cleared. URLs are written only via the edit
  // form save path and the bulk-sync operation.

  // Load Numista enrichment section
  await loadViewNumistaData(item, body, apiResult);
}

/**
 * Close the view modal and clean up resources.
 */
function closeViewModal() {
  const modal = document.getElementById('viewItemModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';

  // Destroy price history chart to free canvas resources
  if (_viewModalChartInstance) {
    _viewModalChartInstance.destroy();
    _viewModalChartInstance = null;
  }

  // Revoke all object URLs to free memory
  _viewModalObjectUrls.forEach(url => {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  });
  _viewModalObjectUrls = [];
}

// ---------------------------------------------------------------------------
// Content builder
// ---------------------------------------------------------------------------

/**
 * Compute shared metrics used by all view modal section renderers.
 * @param {Object} item - Inventory item
 * @returns {Object} Metrics object with currentSpot, qty, weight, purity, isGb, weightOz, metalColor
 */
function _getViewMetrics(item) {
  const metalKey = (item.metal || 'silver').toLowerCase();
  const currentSpot = spotPrices[metalKey] || 0;
  const qty = Number(item.qty) || 1;
  const weight = parseFloat(item.weight) || 0;
  const purity = parseFloat(item.purity) || 1.0;
  const isGb = item.weightUnit === 'gb';
  const weightOz = isGb ? weight * GB_TO_OZT : weight;
  const metalColor = typeof getMetalColor === 'function' ? getMetalColor(metalKey) : null;
  return { currentSpot, qty, weight, purity, isGb, weightOz, metalColor };
}

function _renderHeaderMeta(item, metrics) {
  const header = document.getElementById('viewModalTitle');
  if (header) header.textContent = sanitizeHtml(item.name || 'Untitled Item');
  _renderCatalogBadge(item);
  _applyHeaderGradient(header, metrics.metalColor);
  _renderCountChip(item);
}

function _renderCatalogBadge(item) {
  const catalogBadge = document.getElementById('viewModalCatalogId');
  if (!catalogBadge) return;
  const nId = item.numistaId || '';
  catalogBadge.textContent = nId ? `N#${nId}` : '';
  catalogBadge.style.display = nId ? '' : 'none';
  if (!nId) {
    catalogBadge.onclick = null;
    catalogBadge.style.cursor = '';
    return;
  }
  catalogBadge.style.cursor = 'pointer';
  catalogBadge.title = 'View on Numista';
  catalogBadge.onclick = (e) => {
    e.stopPropagation();
    const isSet = /^S/i.test(nId);
    const cleanId = nId.replace(/^[NS]?#?\s*/i, '').trim();
    const url = isSet
      ? `https://en.numista.com/catalogue/set.php?id=${cleanId}`
      : `https://en.numista.com/catalogue/pieces${cleanId}.html`;
    _openExternalPopup(url, `numista_${nId}`);
  };
}

function _applyHeaderGradient(header, metalColor) {
  const modalHeader = document.getElementById('viewItemModal')?.querySelector('.modal-header');
  if (!modalHeader || !metalColor) return;
  modalHeader.style.background = `linear-gradient(135deg, ${metalColor}, ${_darkenColor(metalColor, 0.3)})`;
  const textColor = _isLightColor(metalColor) ? '#1e293b' : '#f8fafc';
  modalHeader.style.color = textColor;
  if (header) header.style.color = textColor;
}

function _renderCountChip(item) {
  const countChip = document.getElementById('viewModalCountChip');
  if (!countChip) return;
  const totalQty = inventory.reduce((sum, invItem) => {
    return invItem.name === item.name && invItem.metal === item.metal
      ? sum + (Number(invItem.qty) || 1)
      : sum;
  }, 0);
  countChip.textContent = totalQty > 1 ? `\u00d7${totalQty} in inventory` : '';
  countChip.style.display = totalQty > 1 ? '' : 'none';
}

function _buildImageSection(item, metrics) {
  const itemType = (item.type || '').toLowerCase();
  const isRectShape = itemType === 'bar' || itemType === 'note' || itemType === 'aurum'
    || itemType === 'set' || metrics.isGb;
  const imgSection = _el('div', 'view-image-section' + (isRectShape ? ' view-shape-rect' : ''));
  imgSection.id = 'viewImageSection';
  imgSection.appendChild(_imageSlot('obverse', 'Obverse'));
  imgSection.appendChild(_imageSlot('reverse', 'Reverse'));
  if (metrics.metalColor) {
    imgSection.style.background = `linear-gradient(145deg, color-mix(in srgb, ${metrics.metalColor} 15%, #1a1a2e), color-mix(in srgb, ${metrics.metalColor} 8%, #16213e))`;
  }
  const badge = _buildImageCertBadge(item);
  if (badge) imgSection.appendChild(badge);
  return imgSection;
}

function _buildImageCertBadge(item) {
  if (!item.grade) return null;
  const badge = _el('div', 'view-cert-badge');
  const authority = item.gradingAuthority || '';
  const certNum = item.certNumber || '';
  const pcgsNo = item.pcgsNumber || '';
  const isVerified = item.pcgsVerified === true && authority === 'PCGS';
  if (authority) badge.dataset.authority = authority;
  const gradeSpan = _buildImageCertGrade(item, authority, certNum, pcgsNo);
  badge.appendChild(gradeSpan);
  const verifySpan = _buildPcgsVerifyControl(item, authority, certNum, isVerified, false);
  if (verifySpan) badge.appendChild(verifySpan);
  return badge;
}

function _buildImageCertGrade(item, authority, certNum, pcgsNo) {
  const gradeSpan = _el('span', 'view-cert-grade');
  gradeSpan.textContent = authority ? `${authority} ${item.grade}` : item.grade;
  const certUrlTemplate = (typeof CERT_LOOKUP_URLS !== 'undefined' && authority) ? CERT_LOOKUP_URLS[authority] : '';
  const hasCertLink = certUrlTemplate && (certNum || pcgsNo);
  const hasCoinFacts = authority === 'PCGS' && pcgsNo;
  if (hasCertLink || hasCoinFacts) {
    gradeSpan.classList.add('view-cert-clickable');
    gradeSpan.title = certNum ? `Look up ${authority} Cert #${certNum}` : `Open ${authority} verification`;
    gradeSpan.tabIndex = 0;
    gradeSpan.role = 'button';
    gradeSpan.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); gradeSpan.click(); } });
    gradeSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = hasCoinFacts
        ? _buildPcgsCoinFactsUrl(item.grade || '', pcgsNo)
        : certUrlTemplate.replace(/\{certNumber\}/g, encodeURIComponent(certNum)).replace(/\{grade\}/g, encodeURIComponent(_extractNumericGrade(item.grade)));
      const popupName = `cert_${authority}_${certNum || pcgsNo}`.replace(/[^a-zA-Z0-9_]/g, '_');
      const popup = window.open(url, popupName, 'width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no');
      if (popup) {
        popup.opener = null; // Security: prevent reverse tabnabbing
        popup.focus();
      }
    });
  } else {
    gradeSpan.title = authority ? `Graded by ${authority}: ${item.grade}${certNum ? ` — Cert #${certNum}` : ''}` : `Grade: ${item.grade}`;
  }
  return gradeSpan;
}

function _extractNumericGrade(gradeText) {
  return (gradeText || '').match(/\d+/)?.[0] || '';
}

function _buildPcgsCoinFactsUrl(gradeText, pcgsNo) {
  const gradeNum = _extractNumericGrade(gradeText);
  return gradeNum
    ? `https://www.pcgs.com/coinfacts/coin/detail/${encodeURIComponent(pcgsNo)}/${encodeURIComponent(gradeNum)}`
    : `https://www.pcgs.com/coinfacts/coin/${encodeURIComponent(pcgsNo)}`;
}

function _buildPcgsVerifyControl(item, authority, certNum, isVerified, inline) {
  const showVerifyBtn = authority === 'PCGS' && certNum
    && typeof catalogConfig !== 'undefined' && catalogConfig.isPcgsEnabled()
    && typeof verifyPcgsCert === 'function';
  if (!showVerifyBtn) return null;
  const cls = inline ? 'view-cert-verify view-cert-verify-inline' : 'view-cert-verify';
  const verifySpan = _el('span', `${cls}${isVerified ? ' pcgs-verified' : ''}`);
  verifySpan.tabIndex = 0;
  verifySpan.role = 'button';
  verifySpan.dataset.certNumber = certNum;
  verifySpan.title = isVerified ? `Verified — Cert #${certNum}` : 'Verify cert via PCGS API';
  verifySpan.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  verifySpan.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); verifySpan.click(); } });
  verifySpan.addEventListener('click', (e) => {
    e.stopPropagation();
    _verifyPcgsCertAndUpdate(item, certNum, verifySpan, inline);
  });
  return verifySpan;
}

function _verifyPcgsCertAndUpdate(item, certNum, verifyEl, syncImageBadge) {
  verifyEl.classList.add('pcgs-verifying');
  verifyEl.title = 'Verifying...';
  verifyPcgsCert(certNum).then((result) => {
    verifyEl.classList.remove('pcgs-verifying');
    if (!result.verified) {
      verifyEl.title = result.error || 'Verification failed';
      verifyEl.classList.add('pcgs-verify-failed');
      setTimeout(() => verifyEl.classList.remove('pcgs-verify-failed'), 3000);
      return;
    }
    verifyEl.classList.add('pcgs-verified');
    const idx = inventory.findIndex((inv) => inv.uuid === item.uuid);
    if (idx >= 0) {
      inventory[idx].pcgsVerified = true;
      saveInventory();
    }
    const parts = [];
    if (result.grade) parts.push(`Grade: ${result.grade}`);
    if (result.population) parts.push(`Pop: ${result.population}`);
    if (result.popHigher) parts.push(`Pop Higher: ${result.popHigher}`);
    if (result.priceGuide) parts.push(`Price Guide: $${Number(result.priceGuide).toLocaleString()}`);
    verifyEl.title = `Verified — ${parts.join(' | ')}`;
    if (syncImageBadge) {
      const imgBadgeVerify = document.querySelector('#viewItemModal .view-cert-verify:not(.view-cert-verify-inline)');
      if (imgBadgeVerify) imgBadgeVerify.classList.add('pcgs-verified');
    }
  }).catch((err) => {
    verifyEl.classList.remove('pcgs-verifying');
    verifyEl.title = 'Verification service unavailable';
    if (typeof debugLog === 'function') debugLog('warn', 'PCGS verify failed:', err);
  });
}

function _buildInventorySection(item, metrics) {
  const invSection = _section('Inventory');
  const invGrid = _el('div', 'view-detail-grid three-col');
  _addDetail(invGrid, 'Metal', item.composition || item.metal || '—');
  _addDetail(invGrid, 'Type', item.type || '—');
  _addDetail(invGrid, 'Year', item.year || '—');
  _addDetail(invGrid, 'Purity', metrics.purity < 1 ? `.${String(metrics.purity).replace('0.', '')}` : metrics.purity === 1 ? '.999+' : String(metrics.purity));
  _addDetail(invGrid, 'Weight', typeof formatWeight === 'function' ? formatWeight(metrics.weight, item.weightUnit) : `${metrics.weight} oz`);
  _addDetail(invGrid, 'Qty', String(metrics.qty));
  invSection.appendChild(invGrid);
  const invGrid2 = _el('div', 'view-detail-grid three-col');
  const dateVal = item.date ? (typeof formatDisplayDate === 'function' ? formatDisplayDate(item.date) : item.date) : '—';
  _addDetail(invGrid2, 'Date', dateVal);
  _appendSourceField(invGrid2, item.purchaseLocation || '—');
  invSection.appendChild(invGrid2);
  const storGrid = _el('div', 'view-detail-grid');
  _addDetail(storGrid, 'Storage', item.storageLocation || '\u2014');
  invSection.appendChild(storGrid);
  return invSection;
}

function _appendSourceField(container, sourceValue) {
  const srcUrlPattern = /^(https?:\/\/)?[\w.-]+\.(com|net|org|co|io|us|uk|ca|au|de|fr|shop|store)\b/i;
  if (!srcUrlPattern.test(sourceValue)) {
    _addDetail(container, 'Source', sourceValue);
    return;
  }
  const srcItem = _detailItem('Source', '');
  const valEl = srcItem.querySelector('.view-detail-value');
  if (valEl) {
    valEl.textContent = '';
    const srcLink = document.createElement('a');
    srcLink.href = '#';
    const srcHref = /^https?:\/\//i.test(sourceValue) ? sourceValue : `https://${sourceValue}`;
    srcLink.title = srcHref;
    srcLink.style.color = 'var(--primary)';
    srcLink.style.textDecoration = 'none';
    srcLink.textContent = sourceValue.replace(/^(https?:\/\/)?(www\.)?/i, '').replace(/\/(.*)/i, '');
    srcLink.addEventListener('click', (e) => { e.preventDefault(); _openExternalPopup(srcHref, 'source_popup'); });
    valEl.appendChild(srcLink);
  }
  container.appendChild(srcItem);
}

function _buildValuationSection(item, metrics) {
  const meltValue = metrics.currentSpot > 0 ? metrics.weightOz * metrics.qty * metrics.currentSpot * metrics.purity : 0;
  const purchaseTotal = metrics.qty * (parseFloat(item.price) || 0);
  const marketVal = parseFloat(item.marketValue) || 0;
  const retailTotal = marketVal > 0 ? metrics.qty * marketVal : meltValue;
  const gainLoss = retailTotal > 0 ? retailTotal - purchaseTotal : null;
  const valSection = _section('Valuation');
  valSection.classList.add('view-valuation-section');
  const valGrid = _el('div', 'view-detail-grid four-col');
  const purchaseDateStr = item.date ? (typeof formatDisplayDate === 'function' ? formatDisplayDate(item.date) : item.date) : '';
  const purchaseLabel = purchaseDateStr ? `${formatCurrency(purchaseTotal)} (${purchaseDateStr})` : formatCurrency(purchaseTotal);
  _addDetail(valGrid, 'Purchase', purchaseLabel);
  _addDetail(valGrid, 'Melt Value', metrics.currentSpot > 0 ? formatCurrency(meltValue) : '—');
  _addDetail(valGrid, 'Retail', retailTotal > 0 ? formatCurrency(retailTotal) : '—');
  if (gainLoss !== null && retailTotal > 0) {
    const glItem = _detailItem('Gain/Loss', (gainLoss >= 0 ? '+' : '') + formatCurrency(gainLoss));
    const valEl = glItem.querySelector('.view-detail-value');
    if (valEl) valEl.classList.add(gainLoss >= 0 ? 'gain' : 'loss');
    valGrid.appendChild(glItem);
  } else {
    _addDetail(valGrid, 'Gain/Loss', '—', 'muted');
  }
  valSection.appendChild(valGrid);
  return valSection;
}

/**
 * Build the disposition section for disposed items (STAK-72).
 * Returns null for active (non-disposed) items — no visual change.
 * @param {Object} item - Inventory item
 * @returns {HTMLElement|null}
 */
function _buildDispositionSection(item) {
  if (!item.disposition) return null;

  const d = item.disposition;
  const section = _section('Disposition');
  const grid = _el('div', 'view-detail-grid three-col');

  // Type
  const typeLabel = (typeof DISPOSITION_TYPES !== 'undefined' && DISPOSITION_TYPES[d.type])
    ? DISPOSITION_TYPES[d.type].label
    : d.type;
  _addDetail(grid, 'Type', typeLabel);

  // Date
  const dateStr = d.date ? (typeof formatDisplayDate === 'function' ? formatDisplayDate(d.date) : d.date) : '—';
  _addDetail(grid, 'Date', dateStr);

  // Amount (show "N/A" for lost/gifted where amount is 0 and not required)
  const requiresAmount = (typeof DISPOSITION_TYPES !== 'undefined' && DISPOSITION_TYPES[d.type])
    ? DISPOSITION_TYPES[d.type].requiresAmount
    : true;
  _addDetail(grid, 'Amount', requiresAmount ? formatCurrency(d.amount || 0) : 'N/A');

  section.appendChild(grid);

  // Optional fields
  if (d.recipient) {
    const grid2 = _el('div', 'view-detail-grid two-col');
    _addDetail(grid2, 'Recipient', sanitizeHtml(d.recipient));
    section.appendChild(grid2);
  }

  if (d.notes) {
    const grid3 = _el('div', 'view-detail-grid two-col');
    _addDetail(grid3, 'Notes', sanitizeHtml(d.notes));
    section.appendChild(grid3);
  }

  // Realized G/L (color-coded like existing gain/loss)
  const glGrid = _el('div', 'view-detail-grid two-col');
  const glItem = _detailItem('Realized Gain/Loss',
    (d.realizedGainLoss >= 0 ? '+' : '') + formatCurrency(d.realizedGainLoss || 0));
  const valEl = glItem.querySelector('.view-detail-value');
  if (valEl) valEl.classList.add(d.realizedGainLoss >= 0 ? 'gain' : 'loss');
  glGrid.appendChild(glItem);
  section.appendChild(glGrid);

  return section;
}

function _getPriceHistoryContext(item, metrics) {
  const metalName = item.metal || 'Silver';
  const meltFactor = metrics.weightOz * metrics.qty * metrics.purity;
  const spotEntries = (typeof spotHistory !== 'undefined')
    ? spotHistory.filter(e => e.metal === metalName).map(e => ({ ts: new Date(e.timestamp).getTime(), spot: e.spot })).sort((a, b) => a.ts - b.ts)
    : [];
  const spotByDay = new Map();
  for (const e of spotEntries) {
    const day = new Date(e.ts).toISOString().slice(0, 10);
    spotByDay.set(day, e);
  }
  const dailySpotEntries = [...spotByDay.values()];
  const retailEntries = (typeof itemPriceHistory !== 'undefined' && item.uuid) ? (itemPriceHistory[item.uuid] || []).filter(e => e.retail > 0) : [];
  return {
    metalName,
    meltFactor,
    dailySpotEntries,
    retailEntries,
    purchasePerUnit: parseFloat(item.price) || 0,
    purchaseDate: item.date ? new Date(item.date).getTime() : 0,
    currentRetail: parseFloat(item.marketValue) || 0,
  };
}

function _buildPriceHistorySection(chartCtx) {
  if (chartCtx.dailySpotEntries.length < 2) return null;
  const chartSection = _section('Price History');
  const rangeBar = _buildChartRangeBar(chartSection, chartCtx);
  chartSection.appendChild(rangeBar);
  const chartContainer = _el('div', 'view-chart-container');
  const canvas = document.createElement('canvas');
  canvas.id = 'viewPriceHistoryChart';
  canvas._chartData = {
    spotEntries: chartCtx.dailySpotEntries,
    retailEntries: chartCtx.retailEntries,
    purchasePerUnit: chartCtx.purchasePerUnit,
    meltFactor: chartCtx.meltFactor,
    purchaseDate: chartCtx.purchaseDate,
    currentRetail: chartCtx.currentRetail,
  };
  chartContainer.appendChild(canvas);
  chartSection.appendChild(chartContainer);
  return chartSection;
}

function _buildChartRangeBar(chartSection, chartCtx) {
  const rangeBar = _el('div', 'view-chart-range-bar');
  const dateRange = _buildChartDateRangePicker(rangeBar, chartSection, chartCtx);
  _VIEW_CHART_RANGES.forEach((days, i) => {
    if (days === -1 && !chartCtx.purchaseDate) return;
    const pill = _el('button', 'view-chart-range-pill');
    pill.type = 'button';
    pill.textContent = _VIEW_CHART_RANGE_LABELS[i];
    pill.dataset.days = String(days);
    const isDefaultPill = _VIEW_CHART_DEFAULT_RANGE === -1 ? (chartCtx.purchaseDate ? days === -1 : days === 30) : days === _VIEW_CHART_DEFAULT_RANGE;
    if (isDefaultPill) pill.classList.add('active');
    pill.addEventListener('click', async () => {
      rangeBar.querySelectorAll('.view-chart-range-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      await _onChartRangePillClick(days, dateRange, chartSection, chartCtx);
    });
    rangeBar.appendChild(pill);
  });
  rangeBar.appendChild(dateRange.wrap);
  return rangeBar;
}

function _buildChartDateRangePicker(rangeBar, chartSection, chartCtx) {
  const wrap = _el('div', 'view-chart-date-range');
  const fromInput = document.createElement('input');
  fromInput.type = 'date';
  fromInput.className = 'view-chart-date-input';
  fromInput.title = 'From date';
  const toInput = document.createElement('input');
  toInput.type = 'date';
  toInput.className = 'view-chart-date-input';
  toInput.title = 'To date';
  const todayStr = new Date().toISOString().slice(0, 10);
  fromInput.max = todayStr;
  toInput.max = todayStr;
  const dateSep = _el('span', 'view-chart-date-sep');
  dateSep.textContent = '\u2014';
  wrap.appendChild(fromInput);
  wrap.appendChild(dateSep);
  wrap.appendChild(toInput);
  const onDateChange = async () => {
    rangeBar.querySelectorAll('.view-chart-range-pill').forEach(p => p.classList.remove('active'));
    if (fromInput.value) toInput.min = fromInput.value; else toInput.min = '';
    if (toInput.value) fromInput.max = toInput.value; else fromInput.max = todayStr;
    const fromTs = fromInput.value ? new Date(fromInput.value + 'T00:00:00').getTime() : 0;
    const toTs = toInput.value ? new Date(toInput.value + 'T23:59:59').getTime() : 0;
    if (fromTs <= 0 && toTs <= 0) return;
    const canvas = chartSection.querySelector('#viewPriceHistoryChart');
    if (!canvas) return;
    try {
      const fullSpot = await _fetchHistoricalSpotData(chartCtx.metalName, 0, fromTs, toTs);
      _createPriceHistoryChart(canvas, fullSpot, chartCtx.retailEntries, chartCtx.purchasePerUnit, chartCtx.meltFactor, 0, chartCtx.purchaseDate, chartCtx.currentRetail, fromTs, toTs);
    } catch (err) {
      console.error('Custom date range fetch failed:', err);
      _createPriceHistoryChart(canvas, [], chartCtx.retailEntries, chartCtx.purchasePerUnit, chartCtx.meltFactor, 0, chartCtx.purchaseDate, chartCtx.currentRetail, fromTs, toTs);
    }
  };
  fromInput.addEventListener('change', onDateChange);
  toInput.addEventListener('change', onDateChange);
  return { wrap, fromInput, toInput, todayStr };
}

async function _onChartRangePillClick(days, dateRange, chartSection, chartCtx) {
  dateRange.fromInput.value = '';
  dateRange.toInput.value = '';
  dateRange.fromInput.max = dateRange.todayStr;
  dateRange.toInput.min = '';
  const canvas = chartSection.querySelector('#viewPriceHistoryChart');
  if (!canvas) return;
  const effectiveDays = days === -1 && chartCtx.purchaseDate > 0
    ? Math.max(1, Math.ceil((Date.now() - chartCtx.purchaseDate) / 86400000))
    : days;
  if (effectiveDays === 0 || effectiveDays > 180) {
    try {
      const fullSpot = await _fetchHistoricalSpotData(chartCtx.metalName, effectiveDays);
      _createPriceHistoryChart(canvas, fullSpot, chartCtx.retailEntries, chartCtx.purchasePerUnit, chartCtx.meltFactor, effectiveDays, chartCtx.purchaseDate, chartCtx.currentRetail);
    } catch (err) {
      console.error('Range pill fetch failed:', err);
      _createPriceHistoryChart(canvas, chartCtx.dailySpotEntries, chartCtx.retailEntries, chartCtx.purchasePerUnit, chartCtx.meltFactor, effectiveDays, chartCtx.purchaseDate, chartCtx.currentRetail);
    }
    return;
  }
  _createPriceHistoryChart(canvas, chartCtx.dailySpotEntries, chartCtx.retailEntries, chartCtx.purchasePerUnit, chartCtx.meltFactor, effectiveDays, chartCtx.purchaseDate, chartCtx.currentRetail);
}

function _buildGradingSection(item) {
  if (!item.grade && !item.gradingAuthority && !item.certNumber) return null;
  const gradeSection = _section('Grading');
  const gradeGrid = _el('div', 'view-detail-grid three-col');
  _addDetail(gradeGrid, 'Grade', item.grade || '—');
  _addDetail(gradeGrid, 'Authority', item.gradingAuthority || '—');
  const certItem = _buildGradingCertItem(item);
  if (certItem) gradeGrid.appendChild(certItem); else _addDetail(gradeGrid, 'Cert #', '—');
  gradeSection.appendChild(gradeGrid);
  return gradeSection;
}

function _buildGradingCertItem(item) {
  if (!item.certNumber) return null;
  const certItem = _detailItem('Cert #', item.certNumber);
  _attachGradingCertLink(certItem, item);
  const valEl = certItem.querySelector('.view-detail-value');
  if (!valEl) return certItem;
  const inlineVerify = _buildPcgsVerifyControl(item, item.gradingAuthority || '', item.certNumber, item.pcgsVerified === true, true);
  if (inlineVerify) valEl.appendChild(inlineVerify);
  return certItem;
}

function _attachGradingCertLink(certItem, item) {
  if (!item.gradingAuthority || typeof CERT_LOOKUP_URLS === 'undefined' || !CERT_LOOKUP_URLS[item.gradingAuthority]) return;
  const url = CERT_LOOKUP_URLS[item.gradingAuthority]
    .replace(/{certNumber}/g, encodeURIComponent(item.certNumber))
    .replace(/{grade}/g, encodeURIComponent(_extractNumericGrade(item.grade)));
  const valEl = certItem.querySelector('.view-detail-value');
  if (!valEl) return;
  valEl.textContent = '';
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = item.certNumber;
  link.style.color = 'var(--primary)';
  link.title = `Verify on ${item.gradingAuthority}`;
  valEl.appendChild(link);
}

function _buildNumistaPlaceholderSection() {
  const numistaPlaceholder = _el('div', '');
  numistaPlaceholder.id = 'viewNumistaSection';
  return numistaPlaceholder;
}

function _buildTagsSection(item) {
  if (typeof buildTagSection !== 'function') return null;
  return buildTagSection(item.uuid, [], () => {
    if (typeof renderActiveFilters === 'function') renderActiveFilters();
  });
}

function _buildNotesSection(item) {
  if (!item.notes) return null;
  const notesSection = _section('Notes');
  const noteText = _el('div', 'view-notes-text');
  noteText.textContent = item.notes;
  notesSection.appendChild(noteText);
  return notesSection;
}

function _appendSectionsInConfiguredOrder(frag, sectionBuilders) {
  const sectionConfig = typeof getViewModalSectionConfig === 'function' ? getViewModalSectionConfig() : VIEW_MODAL_SECTION_DEFAULTS;
  for (const sec of sectionConfig) {
    if (!sec.enabled) continue;
    const builder = sectionBuilders[sec.id];
    if (!builder) continue;
    const el = builder();
    if (el) frag.appendChild(el);
  }
}

function _renderHeaderActions(item, index) {
  const headerActions = document.getElementById('viewHeaderActions');
  if (!headerActions) return;
  headerActions.textContent = '';
  const ebayBtn = document.createElement('button');
  ebayBtn.className = 'view-ebay-btn';
  ebayBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style="fill:currentColor;margin-right:4px;vertical-align:-2px;"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.5"/><line x1="15" y1="15" x2="21" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>eBay';
  ebayBtn.title = 'Search eBay for this item';
  ebayBtn.addEventListener('click', () => {
    const searchTerm = (item.metal || '') + (item.year ? ' ' + item.year : '') + ' ' + (item.name || '');
    if (typeof openEbayBuySearch === 'function') openEbayBuySearch(searchTerm);
    else if (typeof openEbaySoldSearch === 'function') openEbaySoldSearch(searchTerm);
  });
  headerActions.appendChild(ebayBtn);
}

function _renderFooterActions(item, index) {
  const footer = document.getElementById('viewModalFooter');
  if (!footer) return;
  footer.textContent = '';

  // Left group — destructive
  const left = document.createElement('div');
  left.className = 'view-footer-left';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'view-footer-btn danger';
  removeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-1px;margin-right:0.2rem;"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>Remove';
  removeBtn.addEventListener('click', () => {
    closeViewModal();
    if (typeof deleteItem === 'function') deleteItem(index);
  });
  left.appendChild(removeBtn);

  // Right group — constructive
  const right = document.createElement('div');
  right.className = 'view-footer-right';

  const editBtn = document.createElement('button');
  editBtn.className = 'view-footer-btn primary';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => {
    closeViewModal();
    if (typeof editItem === 'function') editItem(index);
  });

  const cloneBtn = document.createElement('button');
  cloneBtn.className = 'view-footer-btn secondary';
  cloneBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-1px;margin-right:0.2rem;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Clone';
  cloneBtn.addEventListener('click', () => {
    closeViewModal();
    if (typeof cloneItem === 'function') cloneItem(index);
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'view-footer-btn secondary';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', closeViewModal);

  right.appendChild(cloneBtn);
  right.appendChild(closeBtn);
  right.appendChild(editBtn);

  footer.appendChild(left);
  footer.appendChild(right);

  // Restore to Inventory button for disposed items (STAK-388)
  if (isDisposed(item)) {
    const restoreBtn = document.createElement('button');
    restoreBtn.textContent = 'Restore to Inventory';
    restoreBtn.className = 'view-footer-btn secondary';
    restoreBtn.setAttribute('aria-label', 'Restore item to active inventory');
    restoreBtn.onclick = async function() {
      await undoDisposition(index);
      const modal = safeGetElement('viewItemModal');
      if (modal) modal.style.display = 'none';
    };
    footer.insertBefore(restoreBtn, footer.firstChild);
  }

  // Wire up header close X button
  const closeX = document.getElementById('viewModalCloseX');
  if (closeX) {
    closeX.onclick = closeViewModal;
  }
}

/**
 * Build the full view modal body as a DocumentFragment.
 * Sections are built eagerly then appended in user-configured order.
 * @param {Object} item - Inventory item
 * @param {number} index - Item index for edit button
 * @returns {DocumentFragment}
 */
function buildViewContent(item, index) {
  const frag = document.createDocumentFragment();
  const metrics = _getViewMetrics(item);
  _renderHeaderMeta(item, metrics);

  const chartCtx = _getPriceHistoryContext(item, metrics);
  const sectionBuilders = {
    images:       () => _buildImageSection(item, metrics),
    priceHistory: () => _buildPriceHistorySection(chartCtx),
    valuation:    () => _buildValuationSection(item, metrics),
    inventory:    () => _buildInventorySection(item, metrics),
    grading:      () => _buildGradingSection(item),
    numista:      () => _buildNumistaPlaceholderSection(),
    tags:         () => _buildTagsSection(item),
    notes:        () => _buildNotesSection(item),
  };

  _appendSectionsInConfiguredOrder(frag, sectionBuilders);

  // Always append disposition section if item is disposed (STAK-72).
  // This ensures the section appears even if 'disposition' is not yet
  // in the user's saved sectionConfig order.
  if (typeof isDisposed === 'function' && isDisposed(item)) {
    const dispositionEl = _buildDispositionSection(item);
    if (dispositionEl) frag.appendChild(dispositionEl);
  }

  _renderHeaderActions(item, index);
  _renderFooterActions(item, index);
  return frag;
}

// ---------------------------------------------------------------------------
// Async loaders
// ---------------------------------------------------------------------------

/**
 * Load coin images from IndexedDB cache → CDN URL fallback.
 * @param {Object} item
 * @param {HTMLElement} container
 * @returns {Promise<{loaded: boolean, source: string|null}>}
 */
async function loadViewImages(item, container) {
  const section = container.querySelector('#viewImageSection');
  if (!section) return { loaded: false, source: null };

  const slots = section.querySelectorAll('.view-image-slot');
  const obvSlot = slots[0];
  const revSlot = slots[1];

  if (!window.imageCache?.isAvailable()) {
    // Fallback: CDN URLs stored on the item
    const validObv = ImageCache.isValidImageUrl(item.obverseImageUrl);
    const validRev = ImageCache.isValidImageUrl(item.reverseImageUrl);
    if (validObv) _setSlotImage(obvSlot, item.obverseImageUrl);
    if (validRev) _setSlotImage(revSlot, item.reverseImageUrl);
    return { loaded: validObv || validRev, source: 'cdn' };
  }

  // Per-side cascade: user upload → pattern → CDN URL (each side independent)
  const obvUrl = await imageCache.resolveImageUrlForItem(item, 'obverse');
  const revUrl = await imageCache.resolveImageUrlForItem(item, 'reverse');

  if (obvUrl) { _viewModalObjectUrls.push(obvUrl); _setSlotImage(obvSlot, obvUrl); }
  if (revUrl) { _viewModalObjectUrls.push(revUrl); _setSlotImage(revSlot, revUrl); }
  if (obvUrl || revUrl) return { loaded: true, source: 'userOrPattern' };

  // Final fallback: CDN URLs stored on the item (validate to skip corrupted URLs)
  const validObv = ImageCache.isValidImageUrl(item.obverseImageUrl);
  const validRev = ImageCache.isValidImageUrl(item.reverseImageUrl);
  if (validObv) _setSlotImage(obvSlot, item.obverseImageUrl);
  if (validRev) _setSlotImage(revSlot, item.reverseImageUrl);
  return { loaded: validObv || validRev, source: (validObv || validRev) ? 'cdn' : null };
}

/**
 * Load Numista metadata from IndexedDB cache or pre-fetched API result, render enrichment section.
 * @param {Object} item
 * @param {HTMLElement} container
 * @param {Object|null} apiResult - Pre-fetched Numista API result (avoids duplicate call)
 */
async function loadViewNumistaData(item, container, apiResult) {
  const catalogId = item.numistaId || '';
  if (!catalogId) return;

  const placeholder = container.querySelector('#viewNumistaSection');
  if (!placeholder) return;

  let meta = null;

  // Check cache
  if (window.imageCache?.isAvailable()) {
    meta = await imageCache.getMetadata(catalogId);

    // Stale check
    if (meta && (Date.now() - (meta.cachedAt || 0)) > VIEW_METADATA_TTL) {
      meta = null; // Force refresh
    }
  }

  // Use pre-fetched API result if no cache hit
  if (!meta && apiResult) {
    meta = _extractMetadata(apiResult);

    // Cache for next time
    if (window.imageCache?.isAvailable()) {
      imageCache.cacheMetadata(catalogId, apiResult).catch(() => {});
    }
  }

  if (!meta) return;

  // Load user's field visibility config
  const cfg = typeof getNumistaViewFieldConfig === 'function'
    ? getNumistaViewFieldConfig()
    : {};

  // Update image frame shape based on Numista data if not already rectangular
  if (meta.shape) {
    const imgSection = container.querySelector('#viewImageSection');
    const shapeStr = meta.shape.toLowerCase();
    const isNonRound = shapeStr !== 'round' && shapeStr !== 'circular';
    if (isNonRound && imgSection && !imgSection.classList.contains('view-shape-rect')) {
      imgSection.classList.add('view-shape-rect');
    }
  }

  // Build Numista section
  const section = _el('div', 'view-numista-section');

  const badge = _el('span', 'view-numista-badge');
  badge.textContent = 'Catalog Data';
  section.appendChild(badge);

  const grid = _el('div', 'view-detail-grid');

  if (cfg.denomination !== false && meta.denomination) _addDetail(grid, 'Denomination', meta.denomination);
  if (cfg.shape !== false && meta.shape) _addDetail(grid, 'Shape', meta.shape);
  if (cfg.diameter !== false && meta.diameter) _addDetail(grid, 'Diameter', `${meta.diameter}mm`);
  if (cfg.thickness !== false && meta.thickness) _addDetail(grid, 'Thickness', `${meta.thickness}mm`);
  if (cfg.orientation !== false && meta.orientation) _addDetail(grid, 'Orientation', meta.orientation);
  if (cfg.composition !== false && meta.composition) _addDetail(grid, 'Composition', meta.composition);
  if (cfg.country !== false && meta.country) _addDetail(grid, 'Country', meta.country);
  if (cfg.technique !== false && meta.technique) _addDetail(grid, 'Technique', meta.technique);

  if (cfg.references !== false && meta.kmReferences && meta.kmReferences.length > 0) {
    _addDetail(grid, 'References', meta.kmReferences.join(', '));
  }

  section.appendChild(grid);

  // Edge description on its own full-width line (can be long)
  if (cfg.edge !== false && meta.edgeDesc) {
    const edgeGrid = _el('div', 'view-detail-grid');
    const edgeItem = _detailItem('Edge', meta.edgeDesc);
    edgeItem.classList.add('full-width');
    edgeGrid.appendChild(edgeItem);
    section.appendChild(edgeGrid);
  }

  // Set obverse/reverse descriptions as tooltips on the image slots
  if (cfg.imageTooltips !== false && (meta.obverseDesc || meta.reverseDesc)) {
    const imgSection = container.querySelector('#viewImageSection');
    if (imgSection) {
      const slots = imgSection.querySelectorAll('.view-image-slot');
      if (meta.obverseDesc && slots[0]) {
        slots[0].title = `Obverse: ${meta.obverseDesc}`;
      }
      if (meta.reverseDesc && slots[1]) {
        slots[1].title = `Reverse: ${meta.reverseDesc}`;
      }
    }
  }

  // Tags
  if (cfg.tags !== false && meta.tags && meta.tags.length > 0) {
    const tagGrid = _el('div', 'view-detail-grid');
    const tagItem = _detailItem('Tags', meta.tags.join(', '));
    tagItem.classList.add('full-width');
    tagGrid.appendChild(tagItem);
    section.appendChild(tagGrid);
  }

  // Commemorative
  if (cfg.commemorative !== false && meta.commemorative && meta.commemorativeDesc) {
    const commGrid = _el('div', 'view-detail-grid');
    const commItem = _detailItem('Commemorative', meta.commemorativeDesc);
    commItem.classList.add('full-width');
    commGrid.appendChild(commItem);
    section.appendChild(commGrid);
  }

  // Rarity index
  if (cfg.rarity !== false && meta.rarityIndex > 0) {
    const rarityRow = _el('div', 'view-detail-item');

    const lbl = _el('span', 'view-detail-label');
    lbl.textContent = 'Rarity';
    rarityRow.appendChild(lbl);

    const bar = _el('div', 'view-rarity-bar');

    const track = _el('div', 'view-rarity-track');
    const fill = _el('div', 'view-rarity-fill');
    fill.style.width = `${Math.min(meta.rarityIndex, 100)}%`;
    track.appendChild(fill);
    bar.appendChild(track);

    const score = _el('span', 'view-rarity-score');
    score.textContent = String(meta.rarityIndex);
    bar.appendChild(score);

    rarityRow.appendChild(bar);
    section.appendChild(rarityRow);
  }

  // Mintage by year (show first few)
  if (cfg.mintage !== false && meta.mintageByYear && meta.mintageByYear.length > 0) {
    const mintGrid = _el('div', 'view-detail-grid');
    const mintItem = _el('div', 'view-detail-item full-width');
    const mintLabel = _el('span', 'view-detail-label');
    mintLabel.textContent = 'Mintage';
    mintItem.appendChild(mintLabel);

    const mintVal = _el('span', 'view-detail-value');
    const entries = meta.mintageByYear.slice(0, 5);
    mintVal.textContent = entries.map(e => {
      const m = typeof e.mintage === 'number' ? e.mintage.toLocaleString() : e.mintage;
      return `${e.year}: ${m}${e.remark ? ` (${e.remark})` : ''}`;
    }).join(' | ');
    if (meta.mintageByYear.length > 5) mintVal.textContent += ' ...';
    mintItem.appendChild(mintVal);
    mintGrid.appendChild(mintItem);
    section.appendChild(mintGrid);
  }

  placeholder.replaceWith(section);

  // STAK-126 + Numista Search Overhaul: Re-sync via picker modal
  // If we have a full normalized API result, show the picker for field-level control.
  // Otherwise fall back to direct tag application (legacy path).
  if (apiResult && typeof showResyncPicker === 'function' && typeof window.applyPickerSelections === 'function') {
    showResyncPicker(item, apiResult, function (selections) {
      // Apply checked fields via field-meta helper
      window.applyPickerSelections(item, selections, apiResult, 'numista');

      // If tags were selected, apply them through the tag system
      if (selections.tags && meta.tags && meta.tags.length > 0 && item.uuid && typeof applyNumistaTags === 'function') {
        applyNumistaTags(item.uuid, meta.tags, true, true);
      }

      // Persist inventory changes
      if (typeof saveInventory === 'function') {
        saveInventory();
      }

      // Rebuild the tags section in the modal
      const tagsSectionEl = container.querySelector('#viewTagsSection');
      if (tagsSectionEl && typeof buildTagSection === 'function') {
        const newTagsSection = buildTagSection(item.uuid, meta.tags || [], () => {
          if (typeof renderActiveFilters === 'function') renderActiveFilters();
        });
        tagsSectionEl.replaceWith(newTagsSection);
      }
    });
  } else if (meta.tags && meta.tags.length > 0 && item.uuid && typeof applyNumistaTags === 'function') {
    // Legacy fallback: direct tag application when picker is not available
    applyNumistaTags(item.uuid, meta.tags);
    const tagsSectionEl = container.querySelector('#viewTagsSection');
    if (tagsSectionEl && typeof buildTagSection === 'function') {
      const newTagsSection = buildTagSection(item.uuid, meta.tags, () => {
        if (typeof renderActiveFilters === 'function') renderActiveFilters();
      });
      tagsSectionEl.replaceWith(newTagsSection);
    }
  }
}

// ---------------------------------------------------------------------------
// API helpers (private)
// ---------------------------------------------------------------------------

/**
 * Fetch a Numista item by catalogId. Returns the normalized result or null.
 * @param {string} catalogId
 * @returns {Promise<Object|null>}
 */
async function _fetchNumistaResult(catalogId) {
  if (!catalogId || typeof catalogAPI === 'undefined') return null;
  try {
    return await catalogAPI.lookupItem(catalogId);
  } catch {
    return null;
  }
}

/**
 * Extract metadata fields from a Numista API result.
 * @param {Object} result
 * @returns {Object}
 */
function _extractMetadata(result) {
  return {
    title: result.name || '',
    country: result.country || '',
    denomination: result.denomination || '',
    diameter: result.diameter || result.size || 0,
    thickness: result.thickness || 0,
    weight: result.weight || 0,
    shape: result.shape || '',
    composition: result.composition || result.metal || '',
    orientation: result.orientation || '',
    commemorative: !!result.commemorative,
    commemorativeDesc: result.commemorativeDesc || '',
    rarityIndex: result.rarityIndex || 0,
    kmReferences: result.kmReferences || [],
    mintageByYear: result.mintageByYear || [],
    technique: result.technique || '',
    tags: result.tags || [],
    obverseDesc: result.obverseDesc || '',
    reverseDesc: result.reverseDesc || '',
    edgeDesc: result.edgeDesc || '',
  };
}

// ---------------------------------------------------------------------------
// External popup (private)
// ---------------------------------------------------------------------------

/**
 * Open a URL in a 1250px popup window.
 * Most external sites block iframe embedding (X-Frame-Options), so we use window.open().
 * @param {string} url
 * @param {string} [name='_blank'] - Window name for reuse
 */
function _openExternalPopup(url, name) {
  const popup = window.open(
    url,
    name || '_blank',
    'width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no'
  );
  if (!popup) {
    // Popup blocked — let user know
    appAlert(`Popup blocked! Please allow popups or manually visit:\n${url}`);
  } else {
    popup.opener = null; // Security: prevent reverse tabnabbing
    popup.focus();
  }
}

// ---------------------------------------------------------------------------
// Color helpers (private)
// ---------------------------------------------------------------------------

/**
 * Parse a color string (hex #rrggbb or rgb(r,g,b)) into [r, g, b].
 * @param {string} color
 * @returns {number[]} [r, g, b] in 0-255
 */
function _parseColor(color) {
  if (!color) return [99, 102, 241]; // fallback indigo
  const s = color.trim();
  // Handle #rrggbb / #rgb
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
  }
  // Handle rgb(r, g, b)
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  return [99, 102, 241];
}

/**
 * Darken a hex/rgb color by a factor (0–1). 0 = no change, 1 = black.
 * @param {string} color - Hex or rgb() string
 * @param {number} amount - Darkening factor
 * @returns {string} Hex color
 */
function _darkenColor(color, amount) {
  const [r, g, b] = _parseColor(color);
  const f = 1 - Math.min(Math.max(amount, 0), 1);
  const toHex = v => Math.round(v * f).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Check if a color is light based on relative luminance.
 * @param {string} color - Hex or rgb() string
 * @returns {boolean} True if light (needs dark text)
 */
function _isLightColor(color) {
  const [r, g, b] = _parseColor(color);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5;
}

// ---------------------------------------------------------------------------
// Historical spot data fetcher (private, self-contained)
// ---------------------------------------------------------------------------

/** @type {Map<number, Array>} Year-file cache shared with spot.js when available */
const _viewYearCache = new Map();

/** @type {Map<number, Promise<Array>>} In-flight fetch promises to deduplicate concurrent requests */
const _viewYearFetchPromises = new Map();

/**
 * Fetch a single year file with three-tier fallback (fetch → XHR → remote).
 * Reuses spot.js cache/fetcher when available; falls back to own implementation.
 * Deduplicates concurrent fetches for the same year.
 * @param {number} year
 * @returns {Promise<Array>}
 */
function _fetchYearFile(year) {
  // Prefer spot.js fetcher (shares its dedup + cache)
  if (typeof window.fetchYearFile === 'function') {
    return window.fetchYearFile(year);
  }

  // Self-contained fallback
  // Already cached — return immediately
  if (_viewYearCache.has(year)) return Promise.resolve(_viewYearCache.get(year));

  // Already in-flight — return shared promise
  if (_viewYearFetchPromises.has(year)) {
    return _viewYearFetchPromises.get(year);
  }

  const filename = `spot-history-${year}.json`;
  const localUrl = `data/${filename}`;
  const remoteUrl = `https://staktrakr.com/data/${filename}`;

  const promise = fetch(localUrl)
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .catch(() => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', localUrl, true);
      xhr.responseType = 'json';
      xhr.onload = () => (xhr.status === 200 || (xhr.status === 0 && xhr.response)) ? resolve(xhr.response) : reject(new Error(`XHR ${xhr.status}`));
      xhr.onerror = () => reject(new Error('XHR error'));
      xhr.send();
    }))
    .catch(() => fetch(remoteUrl).then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); }))
    .then(entries => {
      const valid = Array.isArray(entries) ? entries.filter(e => e && typeof e.spot === 'number' && e.metal && e.timestamp) : [];
      _viewYearCache.set(year, valid);
      return valid;
    })
    .catch(() => { _viewYearCache.set(year, []); return []; })
    .finally(() => {
      _viewYearFetchPromises.delete(year);
    });

  // Store promise in Map immediately to ensure proper cleanup
  _viewYearFetchPromises.set(year, promise);
  return promise;
}

/**
 * Fetch full historical spot data for a metal by loading year files.
 * Merges fetched year-file data with live spotHistory, deduplicates by day
 * (live data wins over seed). Returns sorted {ts, spot} entries.
 *
 * For ranges <= 180 days, just returns the in-memory spotHistory slice (no fetch).
 * For longer ranges (including "All"), async-fetches year files back to 1968.
 *
 * @param {string} metalName - Metal name ('Silver', 'Gold', etc.)
 * @param {number} days - Number of days (0 = all available data)
 * @param {number} [fromTs=0] - Custom range start (0 = unbounded)
 * @param {number} [toTs=0] - Custom range end (0 = unbounded)
 * @returns {Promise<Array<{ts:number, spot:number}>>} Sorted daily spot entries
 */
async function _fetchHistoricalSpotData(metalName, days, fromTs, toTs) {
  fromTs = fromTs || 0;
  toTs = toTs || 0;

  // Calculate which years to fetch
  let startYear;
  if (fromTs > 0) {
    startYear = new Date(fromTs).getFullYear();
  } else if (days > 0 && days <= 180) {
    // Short range — in-memory spotHistory is sufficient
    const liveEntries = (typeof spotHistory !== 'undefined' ? spotHistory : [])
      .filter(e => e.metal === metalName)
      .map(e => ({ ts: new Date(e.timestamp).getTime(), spot: e.spot }));
    liveEntries.sort((a, b) => a.ts - b.ts);
    const byDay = new Map();
    for (const e of liveEntries) byDay.set(new Date(e.ts).toISOString().slice(0, 10), e);
    return [...byDay.values()].sort((a, b) => a.ts - b.ts);
  } else {
    // "All" — go back to 1968 (earliest seed data)
    startYear = 1968;
  }

  const endYear = new Date().getFullYear();
  const years = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);

  // Fetch all needed year files in parallel
  const yearArrays = await Promise.all(years.map(_fetchYearFile));
  const allHistorical = yearArrays.flat();

  // Merge historical + live spotHistory
  const live = typeof spotHistory !== 'undefined' ? spotHistory : [];
  const combined = [...allHistorical, ...live]
    .filter(e => e.metal === metalName)
    .map(e => ({ ts: new Date(e.timestamp).getTime(), spot: e.spot }));

  // Sort chronologically
  combined.sort((a, b) => a.ts - b.ts);

  // Dedup to one entry per day (later entries win — live data appended after seed)
  const byDay = new Map();
  for (const e of combined) {
    byDay.set(new Date(e.ts).toISOString().slice(0, 10), e);
  }

  return [...byDay.values()].sort((a, b) => a.ts - b.ts);
}

// ---------------------------------------------------------------------------
// Price history chart (private)
// ---------------------------------------------------------------------------

/**
 * Create a Chart.js line chart showing price history for the viewed item.
 * Primary: melt value derived from spotHistory (dense daily data).
 * Secondary: retail value anchored from purchase date/price to current market value,
 *   with sparse itemPriceHistory snapshots in between.
 * Purchase price shown as a flat dashed reference line.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{ts:number, spot:number}>} allSpotEntries - Daily spot prices for this metal
 * @param {Array<{ts:number, retail:number}>} allRetailEntries - Sparse retail value snapshots
 * @param {number} purchasePerUnit - Original purchase price per unit
 * @param {number} meltFactor - weightOz * qty * purity (melt = spot * meltFactor)
 * @param {number} [days=0] - Number of days to show (0 = all)
 * @param {number} [purchaseDate=0] - Purchase date timestamp (anchor start for retail line)
 * @param {number} [currentRetail=0] - Current market/retail value (anchor end for retail line)
 * @param {number} [fromTs=0] - Custom range start timestamp (0 = unbounded)
 * @param {number} [toTs=0] - Custom range end timestamp (0 = unbounded)
 */
function _createPriceHistoryChart(canvas, allSpotEntries, allRetailEntries, purchasePerUnit, meltFactor, days, purchaseDate, currentRetail, fromTs, toTs) {
  if (typeof Chart === 'undefined') return;

  // Destroy any previous instance
  if (_viewModalChartInstance) {
    _viewModalChartInstance.destroy();
    _viewModalChartInstance = null;
  }

  // Filter spot entries by time range
  fromTs = fromTs || 0;
  toTs = toTs || 0;
  const cutoff = days > 0 ? Date.now() - (days * 86400000) : 0;
  let spotEntries;
  if (fromTs > 0 || toTs > 0) {
    // Custom date range mode
    spotEntries = allSpotEntries.filter(e =>
      (fromTs <= 0 || e.ts >= fromTs) && (toTs <= 0 || e.ts <= toTs)
    );
  } else {
    spotEntries = cutoff > 0 ? allSpotEntries.filter(e => e.ts >= cutoff) : [...allSpotEntries];
  }

  // If "All" range or custom range and purchase date is before earliest spot data,
  // prepend a synthetic entry so the chart extends back to purchase date
  const isAllOrCustom = days === 0 || fromTs > 0 || toTs > 0;
  if (isAllOrCustom && purchaseDate > 0 && spotEntries.length > 0 && purchaseDate < spotEntries[0].ts) {
    spotEntries.unshift({ ts: purchaseDate, spot: spotEntries[0].spot });
  }

  // Show fallback message if insufficient data for selected range
  const container = canvas.parentElement;
  const existingMsg = container.querySelector('.view-chart-no-data');
  if (existingMsg) existingMsg.remove();
  canvas.style.display = '';

  if (spotEntries.length < 2) {
    canvas.style.display = 'none';
    const msg = _el('div', 'view-chart-no-data');
    msg.textContent = 'Not enough data for this range';
    container.appendChild(msg);
    return;
  }

  // Build labels + melt data from spot entries
  // Adaptive formatting: decade spans → year only, multi-year → two-line [month, year],
  // single-year → month + day
  const firstYear = new Date(spotEntries[0].ts).getFullYear();
  const lastYear = new Date(spotEntries[spotEntries.length - 1].ts).getFullYear();
  const yearSpan = lastYear - firstYear;
  const labels = spotEntries.map(e => {
    const d = new Date(e.ts);
    if (yearSpan > 10) {
      // Decade+ ranges: compact "Jan '24" or just "'24"
      return d.toLocaleDateString(undefined, { year: '2-digit', month: 'short' });
    }
    if (yearSpan >= 1) {
      // 1–10 year ranges: two-line label [month day, year]
      return [
        d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        String(d.getFullYear())
      ];
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  });
  const meltData = spotEntries.map(e => parseFloat((e.spot * meltFactor).toFixed(2)));
  const purchaseLine = spotEntries.map(() => purchasePerUnit);

  // Build retail data: anchored from purchase date to present, with sparse midpoints.
  // Uses index-based snapping to find the nearest spot entry for each retail point,
  // since anchor dates may not have an exact-match spot entry on that calendar day.
  const retailData = new Array(spotEntries.length).fill(null);

  // Helper: find the index of the spot entry nearest to a given timestamp
  const _nearestSpotIdx = (ts) => {
    let best = 0;
    let bestDist = Math.abs(spotEntries[0].ts - ts);
    for (let i = 1; i < spotEntries.length; i++) {
      const dist = Math.abs(spotEntries[i].ts - ts);
      if (dist < bestDist) { best = i; bestDist = dist; }
    }
    return best;
  };

  // Anchor start: purchase price at the leftmost chart position.
  // If purchase date is within the visible range, snap to that day.
  // If purchase date is before the range, pin to index 0 so the
  // retail line always starts with "what you paid" as a reference.
  if (purchaseDate > 0) {
    if (purchaseDate >= spotEntries[0].ts &&
        purchaseDate <= spotEntries[spotEntries.length - 1].ts) {
      const idx = _nearestSpotIdx(purchaseDate);
      retailData[idx] = purchasePerUnit;
    } else if (purchaseDate < spotEntries[0].ts) {
      retailData[0] = purchasePerUnit;
    }
  }

  // Middle: sparse itemPriceHistory retail values snapped to nearest spot day
  for (const re of allRetailEntries) {
    if (cutoff > 0 && re.ts < cutoff) continue;
    if (fromTs > 0 && re.ts < fromTs) continue;
    if (toTs > 0 && re.ts > toTs) continue;
    const idx = _nearestSpotIdx(re.ts);
    retailData[idx] = re.retail;
  }

  // Anchor end: current market value on the last spot entry (≈ today)
  if (currentRetail > 0) {
    retailData[spotEntries.length - 1] = currentRetail;
  }

  const hasRetail = retailData.some(v => v !== null);

  const showPoints = spotEntries.length <= 30;

  const textColor = typeof getChartTextColor === 'function' ? getChartTextColor() : '#1e293b';
  const bgColor = typeof getChartBackgroundColor === 'function' ? getChartBackgroundColor() : '#f8fafc';

  // Dataset order: purchase (bottom) → melt (middle) → retail (top)
  // Layered fills create visual bands showing cost basis, intrinsic value, and market premium
  const datasets = [
    {
      label: 'Purchase Price',
      data: purchaseLine,
      borderColor: '#ef4444',
      backgroundColor: 'rgba(239, 68, 68, 0.06)',
      fill: 'origin',
      borderDash: [6, 3],
      tension: 0,
      pointRadius: 0,
      pointHoverRadius: 0,
      borderWidth: 1.5,
      order: 3,
    },
    {
      label: 'Melt Value',
      data: meltData,
      borderColor: '#10b981',
      backgroundColor: 'rgba(16, 185, 129, 0.12)',
      fill: 'origin',
      tension: 0.3,
      pointRadius: showPoints ? 3 : 0,
      pointHoverRadius: 5,
      borderWidth: 2,
      order: 2,
    },
    {
      label: 'Retail Value',
      data: retailData,
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59, 130, 246, 0.08)',
      fill: 'origin',
      tension: 0.3,
      spanGaps: true,
      pointRadius: 4,
      pointHoverRadius: 6,
      borderWidth: 2,
      hidden: !hasRetail,
      order: 1,
    },
  ];

  _viewModalChartInstance = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          ticks: {
            color: textColor,
            maxTicksLimit: 6,
            autoSkip: true,
            font: { size: 10 }
          },
          grid: { display: false }
        },
        y: {
          ticks: {
            color: textColor,
            font: { size: 10 },
            callback: function(value) {
              return typeof formatCurrency === 'function' ? formatCurrency(value) : '$' + value;
            }
          },
          grid: { color: 'rgba(128,128,128,0.1)' }
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: textColor,
            usePointStyle: true,
            pointStyle: 'line',
            padding: 12,
            font: { size: 10 }
          }
        },
        tooltip: {
          backgroundColor: bgColor,
          titleColor: textColor,
          bodyColor: textColor,
          borderColor: textColor,
          borderWidth: 1,
          callbacks: {
            label: function(ctx) {
              if (ctx.parsed.y === null) return null;
              const val = typeof formatCurrency === 'function' ? formatCurrency(ctx.parsed.y) : '$' + ctx.parsed.y;
              return `${ctx.dataset.label}: ${val}`;
            }
          }
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Re-Sync Picker Modal
// ---------------------------------------------------------------------------

/** Human-readable labels for picker fields */
const _FIELD_LABELS = {
  name: 'Name',
  numistaId: 'Catalog N#',
  year: 'Year',
  type: 'Type',
  weight: 'Weight',
  tags: 'Tags',
  country: 'Country',
  denomination: 'Denomination',
  composition: 'Composition',
  shape: 'Shape',
  diameter: 'Diameter',
  thickness: 'Thickness',
  metal: 'Metal',
  orientation: 'Orientation',
  description: 'Description',
  grade: 'Grade',
  mintage: 'Mintage',
  technique: 'Technique',
  commemorative: 'Commemorative',
};

/**
 * Format a field value for display in the picker modal.
 * @param {string} fieldName
 * @param {*} value
 * @returns {string}
 */
function _formatPickerValue(fieldName, value) {
  if (value === null || value === undefined || value === '') return '';
  if (fieldName === 'tags' && Array.isArray(value)) {
    return value.length > 0 ? '[' + value.length + ' tag' + (value.length !== 1 ? 's' : '') + ']' : '';
  }
  if (fieldName === 'weight' && typeof value === 'number') return value + 'g';
  if (fieldName === 'diameter' && typeof value === 'number' && value > 0) return value + 'mm';
  if (fieldName === 'thickness' && typeof value === 'number' && value > 0) return value + 'mm';
  if (fieldName === 'commemorative') return value ? 'Yes' : 'No';
  return String(value);
}

/**
 * Determine whether a field's current and incoming values are effectively equal.
 * @param {*} current
 * @param {*} incoming
 * @returns {boolean}
 */
function _valuesMatch(current, incoming) {
  if (current === incoming) return true;
  if (Array.isArray(current) && Array.isArray(incoming)) {
    return current.length === incoming.length &&
      current.every((v, i) => v === incoming[i]);
  }
  // Loose numeric comparison (e.g. "26.73" vs 26.73)
  if (current !== null && current !== undefined && incoming !== null && incoming !== undefined && Number(current) === Number(incoming) && !isNaN(Number(current))) return true;
  return false;
}

/**
 * Build and show the re-sync picker modal.
 *
 * @param {object} item - Current inventory item
 * @param {object} normalizedData - Normalized API data from normalizeItemData()
 * @param {function} onConfirm - Called with { fieldName: boolean } selections map
 * @param {function} [onCancel] - Called when user cancels
 */
function showResyncPicker(item, normalizedData, onConfirm, onCancel) {
  if (!item || !normalizedData) return;

  const tiers = window.FIELD_TIERS || { tier1: [], tier2: [] };
  const tagsAutoApply = typeof loadDataSync === 'function'
    ? loadDataSync('numista_tags_auto', true)
    : true;

  // State: track checkbox states keyed by field name
  const checkStates = {};
  const fieldDisabled = {};

  // Remove any existing picker modal
  const existingModal = safeGetElement('resyncPickerModal');
  if (existingModal) existingModal.remove();

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop fade show';
  backdrop.id = 'resyncPickerBackdrop';

  // Modal root
  const modal = document.createElement('div');
  modal.className = 'modal fade show';
  modal.id = 'resyncPickerModal';
  modal.style.display = 'block';
  modal.setAttribute('tabindex', '-1');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-labelledby', 'resyncPickerTitle');

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog modal-dialog-centered';

  const content = document.createElement('div');
  content.className = 'modal-content';

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'modal-header';

  const title = document.createElement('h5');
  title.className = 'modal-title';
  title.id = 'resyncPickerTitle';
  title.textContent = 'Re-sync from Numista';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', _dismiss);
  header.appendChild(closeBtn);

  content.appendChild(header);

  // --- Body ---
  const body = document.createElement('div');
  body.className = 'modal-body';
  body.style.maxHeight = '60vh';
  body.style.overflowY = 'auto';

  /**
   * Build a single field row (checkbox + label + incoming value + diff hint).
   * @param {string} fieldName
   * @returns {HTMLElement}
   */
  function _buildFieldRow(fieldName) {
    const currentVal = item[fieldName];
    const incomingVal = normalizedData[fieldName];
    const meta = typeof getFieldMeta === 'function'
      ? getFieldMeta(item, fieldName)
      : { source: 'manual', userModified: true };

    const hasCurrentValue = currentVal !== null && currentVal !== undefined && currentVal !== '' &&
      !(Array.isArray(currentVal) && currentVal.length === 0) && currentVal !== 0 && currentVal !== false;
    const hasIncomingValue = incomingVal !== null && incomingVal !== undefined && incomingVal !== '' &&
      !(Array.isArray(incomingVal) && incomingVal.length === 0) && incomingVal !== 0 && incomingVal !== false;
    const valuesEqual = _valuesMatch(currentVal, incomingVal);

    // Determine pre-check state
    let checked = false;
    let disabled = false;
    let dimmed = false;

    if (!hasIncomingValue) {
      // Nothing from API — skip this row entirely
      return null;
    } else if (valuesEqual) {
      // Already matches — checked but dimmed/disabled
      checked = true;
      disabled = true;
      dimmed = true;
    } else if (!hasCurrentValue) {
      // Empty in current → fill from API
      checked = true;
    } else if (meta.source === 'numista' && !meta.userModified) {
      // Numista-sourced, not user-modified → safe to update
      checked = true;
    } else if (meta.userModified) {
      // User-modified → protect
      checked = false;
    } else {
      checked = true;
    }

    // Tags row: override default based on auto-apply setting
    if (fieldName === 'tags' && !disabled) {
      checked = tagsAutoApply;
    }

    checkStates[fieldName] = checked && !disabled;
    fieldDisabled[fieldName] = disabled;

    const row = document.createElement('div');
    row.className = 'mb-2';
    if (dimmed) row.style.opacity = '0.5';

    const formCheck = document.createElement('div');
    formCheck.className = 'form-check';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'form-check-input';
    input.id = 'resync-field-' + fieldName;
    input.checked = checked;
    input.disabled = disabled;
    input.addEventListener('change', function () {
      checkStates[fieldName] = this.checked;
      _updateApplyButton();
    });
    formCheck.appendChild(input);

    const label = document.createElement('label');
    label.className = 'form-check-label';
    label.setAttribute('for', 'resync-field-' + fieldName);

    const labelText = document.createElement('span');
    labelText.textContent = (_FIELD_LABELS[fieldName] || fieldName);
    label.appendChild(labelText);

    // Show incoming value
    const incomingDisplay = _formatPickerValue(fieldName, incomingVal);
    if (incomingDisplay) {
      const valSpan = document.createElement('span');
      valSpan.className = 'text-muted ms-2';
      valSpan.style.fontSize = '0.85em';
      valSpan.textContent = typeof sanitizeHtml === 'function'
        ? sanitizeHtml(incomingDisplay)
        : incomingDisplay;
      label.appendChild(valSpan);
    }

    if (dimmed) {
      const matchSpan = document.createElement('span');
      matchSpan.className = 'text-muted ms-2';
      matchSpan.style.fontSize = '0.8em';
      matchSpan.textContent = '(already matches)';
      label.appendChild(matchSpan);
    }

    formCheck.appendChild(label);
    row.appendChild(formCheck);

    // Diff hint: show current value for unchecked fields where incoming differs
    if (!checked && !disabled && hasCurrentValue && !valuesEqual) {
      const diffHint = document.createElement('div');
      diffHint.className = 'text-muted ms-4';
      diffHint.style.fontSize = '0.8em';
      const currentDisplay = _formatPickerValue(fieldName, currentVal);
      diffHint.textContent = 'Current: ' + (typeof sanitizeHtml === 'function'
        ? sanitizeHtml(currentDisplay)
        : currentDisplay);
      row.appendChild(diffHint);
    }

    return row;
  }

  // Build Tier 1 rows
  const tier1Fields = tiers.tier1 || [];
  for (const fieldName of tier1Fields) {
    const row = _buildFieldRow(fieldName);
    if (row) body.appendChild(row);
  }

  // "Show more fields" toggle + Tier 2 container
  const tier2Fields = tiers.tier2 || [];
  const tier2Container = document.createElement('div');
  tier2Container.id = 'resyncTier2Container';
  tier2Container.style.display = _resyncPickerShowMore ? 'block' : 'none';

  for (const fieldName of tier2Fields) {
    const row = _buildFieldRow(fieldName);
    if (row) tier2Container.appendChild(row);
  }

  // Only show toggle if tier2 has visible rows
  if (tier2Container.childNodes.length > 0) {
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn btn-link btn-sm p-0 mt-2 mb-2';
    toggleBtn.textContent = _resyncPickerShowMore ? '\u25BE Hide extra fields' : '\u25B8 Show more fields';
    toggleBtn.addEventListener('click', function () {
      _resyncPickerShowMore = !_resyncPickerShowMore;
      tier2Container.style.display = _resyncPickerShowMore ? 'block' : 'none';
      this.textContent = _resyncPickerShowMore ? '\u25BE Hide extra fields' : '\u25B8 Show more fields';
    });
    body.appendChild(toggleBtn);
    body.appendChild(tier2Container);
  }

  content.appendChild(body);

  // --- Footer ---
  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', _dismiss);
  footer.appendChild(cancelBtn);

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'btn premium';
  applyBtn.id = 'resyncApplyBtn';
  footer.appendChild(applyBtn);

  content.appendChild(footer);
  dialog.appendChild(content);
  modal.appendChild(dialog);

  /** Count checked (non-disabled) fields */
  function _getCheckedCount() {
    let count = 0;
    for (const fn of Object.keys(checkStates)) {
      if (checkStates[fn] && !fieldDisabled[fn]) count++;
    }
    return count;
  }

  /** Update apply button text and disabled state */
  function _updateApplyButton() {
    const count = _getCheckedCount();
    applyBtn.textContent = count > 0 ? 'Apply (' + count + ')' : 'Apply (0)';
    applyBtn.disabled = count === 0;
  }

  _updateApplyButton();

  applyBtn.addEventListener('click', function () {
    // Build selections map (only non-disabled)
    const selections = {};
    for (const fn of Object.keys(checkStates)) {
      if (!fieldDisabled[fn]) {
        selections[fn] = checkStates[fn];
      }
    }
    _cleanup();
    if (typeof onConfirm === 'function') onConfirm(selections);
  });

  function _dismiss() {
    _cleanup();
    if (typeof onCancel === 'function') onCancel();
  }

  function _cleanup() {
    const m = safeGetElement('resyncPickerModal');
    if (m) m.remove();
    const b = safeGetElement('resyncPickerBackdrop');
    if (b) b.remove();
  }

  // Append to DOM
  document.body.appendChild(backdrop);
  document.body.appendChild(modal);

  // Focus the first checkbox
  const firstCheck = modal.querySelector('input[type="checkbox"]:not(:disabled)');
  if (firstCheck) firstCheck.focus();
}

// ---------------------------------------------------------------------------
// DOM helpers (private)
// ---------------------------------------------------------------------------

/** Create element with className */
function _el(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

/** Create a data section with title */
function _section(title) {
  const section = _el('div', 'view-detail-section');
  const h = _el('div', 'view-section-title');
  h.textContent = title;
  section.appendChild(h);
  return section;
}

/** Create a label/value detail item element */
function _detailItem(label, value, extraClass) {
  const item = _el('div', 'view-detail-item');
  const lbl = _el('span', 'view-detail-label');
  lbl.textContent = label;
  const val = _el('span', 'view-detail-value' + (extraClass ? ' ' + extraClass : ''));
  val.textContent = value;
  item.appendChild(lbl);
  item.appendChild(val);
  return item;
}

/** Add a detail item to a grid */
function _addDetail(grid, label, value, extraClass) {
  grid.appendChild(_detailItem(label, value, extraClass));
}

/** Create an image slot with placeholder */
function _imageSlot(side, label) {
  const slot = _el('div', 'view-image-slot');
  slot.dataset.side = side;

  const ph = _el('div', 'view-image-placeholder');
  ph.textContent = '\uD83E\uDE99'; // coin emoji
  slot.appendChild(ph);

  const lbl = _el('span', 'view-image-label');
  lbl.textContent = label;
  slot.appendChild(lbl);

  return slot;
}

/** Replace placeholder with actual image in a slot */
function _setSlotImage(slot, src) {
  if (!slot || !src) return;

  // If an image already exists, update its src (for override replacement)
  const existing = slot.querySelector('img');
  if (existing) {
    existing.src = src;
    existing.style.display = '';
    return;
  }

  // First time: replace placeholder with new img element
  const ph = slot.querySelector('.view-image-placeholder');
  if (!ph) return;

  const img = document.createElement('img');
  img.src = src;
  img.alt = slot.dataset.side || 'Coin';
  // Only use lazy loading for network URLs — blob URLs are already in memory
  // and lazy loading can prevent display in modals that just became visible
  if (!src.startsWith('blob:')) img.loading = 'lazy';
  img.onerror = () => { img.style.display = 'none'; };
  ph.replaceWith(img);
}

// ---------------------------------------------------------------------------
// Global exposure
// ---------------------------------------------------------------------------

// ESC key handler
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('viewItemModal');
    if (modal && modal.style.display !== 'none') {
      closeViewModal();
    }
  }
});

if (typeof window !== 'undefined') {
  window.showViewModal = showViewModal;
  window.closeViewModal = closeViewModal;
  window.showResyncPicker = showResyncPicker;
}

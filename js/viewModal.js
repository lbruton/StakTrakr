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
const _VIEW_CHART_RANGE_LABELS = [
  "7d",
  "14d",
  "30d",
  "60d",
  "90d",
  "180d",
  "1Y",
  "5Y",
  "10Y",
  "Purchased",
  "All",
];

/** @type {number} Default chart range in days (-1 = from purchase date, falls back to 30d) */
const _VIEW_CHART_DEFAULT_RANGE = -1;

const _VIEW_CHART_DAY_MS = 24 * 60 * 60 * 1000;
const _VIEW_CHART_MIN_WINDOW_MS = 7 * _VIEW_CHART_DAY_MS;

function _purchasedRangeFrom(purchaseDate) {
  const toTs = Date.now();
  const windowMs = toTs - purchaseDate;
  if (windowMs < _VIEW_CHART_MIN_WINDOW_MS) {
    const daysSince = Math.max(0, Math.floor(windowMs / _VIEW_CHART_DAY_MS));
    const caption =
      daysSince === 0
        ? "Purchased today — showing last 7 days"
        : `Purchased ${daysSince} day${daysSince === 1 ? "" : "s"} ago — showing last 7 days`;
    return { fromTs: toTs - _VIEW_CHART_MIN_WINDOW_MS, caption };
  }
  return { fromTs: purchaseDate, caption: null };
}

function _setChartCaption(canvas, text) {
  const caption = safeGetElement("viewChartCaption");
  if (!caption) return;
  if (text) {
    caption.textContent = text;
    caption.hidden = false;
  } else {
    caption.hidden = true;
  }
}

function _getViewChartRangeCutoff(days) {
  const rangeDays = Number(days) || 0;
  if (rangeDays <= 0) return 0;
  if (rangeDays > 180) return Date.now() - rangeDays * _VIEW_CHART_DAY_MS;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - Math.max(rangeDays - 1, 0));
  return start.getTime();
}

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

  const modal = document.getElementById("viewItemModal");
  if (!modal) return;

  const body = document.getElementById("viewModalBody");
  if (!body) return;

  // Build modal content
  body.textContent = "";
  body.appendChild(buildViewContent(item, index));

  // Render price history chart (canvas must be in DOM first)
  const chartCanvas = body.querySelector("#viewPriceHistoryChart");
  if (chartCanvas && chartCanvas._chartData) {
    const cd = chartCanvas._chartData;
    const initRange = _VIEW_CHART_DEFAULT_RANGE;
    if (initRange === -1 && cd.purchaseDate > 0) {
      const metalName = item.metal || "Silver";
      const toTs = Date.now();
      const { fromTs: purchasedFrom, caption: purchasedCaption } = _purchasedRangeFrom(
        cd.purchaseDate
      );
      _fetchHistoricalSpotData(metalName, 0, purchasedFrom, toTs)
        .then((fullSpot) => {
          _setChartCaption(chartCanvas, purchasedCaption);
          _createPriceHistoryChart(
            chartCanvas,
            fullSpot,
            cd.retailEntries,
            cd.purchasePerUnit,
            cd.meltFactor,
            0,
            cd.purchaseDate,
            cd.currentRetail,
            purchasedFrom,
            toTs
          );
        })
        .catch(() => {
          _setChartCaption(chartCanvas, purchasedCaption);
          _createPriceHistoryChart(
            chartCanvas,
            cd.spotEntries,
            cd.retailEntries,
            cd.purchasePerUnit,
            cd.meltFactor,
            0,
            cd.purchaseDate,
            cd.currentRetail,
            purchasedFrom,
            toTs
          );
        });
    } else if (initRange === 0 || initRange > 180) {
      const metalName = item.metal || "Silver";
      _fetchHistoricalSpotData(metalName, initRange)
        .then((fullSpot) => {
          _createPriceHistoryChart(
            chartCanvas,
            fullSpot,
            cd.retailEntries,
            cd.purchasePerUnit,
            cd.meltFactor,
            initRange,
            cd.purchaseDate,
            cd.currentRetail
          );
        })
        .catch(() => {
          _createPriceHistoryChart(
            chartCanvas,
            cd.spotEntries,
            cd.retailEntries,
            cd.purchasePerUnit,
            cd.meltFactor,
            initRange,
            cd.purchaseDate,
            cd.currentRetail
          );
        });
    } else {
      _createPriceHistoryChart(
        chartCanvas,
        cd.spotEntries,
        cd.retailEntries,
        cd.purchasePerUnit,
        cd.meltFactor,
        initRange,
        cd.purchaseDate,
        cd.currentRetail
      );
    }
  }

  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
  if (typeof window.trapFocus === "function") window.trapFocus(modal);
  const firstFocusable = modal.querySelector(
    'button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled])'
  );
  if (firstFocusable) firstFocusable.focus();

  // Load images from stored URLs / user uploads only — no API fallback.
  // STAK-489: Stored URLs are the single source of truth for images everywhere.
  // Users populate images via Search → Fill Fields or manual URL entry in the edit form.
  const catalogId = item.numistaId || "";
  let apiResult = null;

  await loadViewImages(item, body);

  // Check whether metadata is already cached in IndexedDB
  let metaCached = false;
  if (catalogId && window.imageCache?.isAvailable()) {
    try {
      const cachedMeta = await imageCache.getMetadata(catalogId);
      metaCached = !!(cachedMeta && Date.now() - (cachedMeta.cachedAt || 0) < VIEW_METADATA_TTL);
    } catch {
      /* ignore */
    }
  }

  // Fetch API result only for metadata enrichment — not for images
  if (catalogId && !metaCached) {
    apiResult = await _fetchNumistaResult(catalogId);
  }

  // Load Numista enrichment section (country, denomination, composition, etc.)
  await loadViewNumistaData(item, body, apiResult);
}

/**
 * Close the view modal and clean up resources.
 */
function closeViewModal() {
  const modal = document.getElementById("viewItemModal");
  if (modal) {
    if (typeof window.releaseFocus === "function") window.releaseFocus(modal);
    modal.style.display = "none";
  }
  document.body.style.overflow = "";

  // Destroy price history chart to free canvas resources
  if (_viewModalChartInstance) {
    _viewModalChartInstance.destroy();
    _viewModalChartInstance = null;
  }

  // Revoke all object URLs to free memory
  _viewModalObjectUrls.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  });
  _viewModalObjectUrls = [];
}

// ---------------------------------------------------------------------------
// Content builder
// ---------------------------------------------------------------------------

/**
 * Compute shared metrics used by all view modal section renderers.
 * @param {Object} item - Inventory item
 * @returns {Object} Metrics object with currentSpot, qty, weight, purity, isGb, isSb, weightOz, metalColor
 */
function _getViewMetrics(item) {
  const metalKey = (item.metal || "silver").toLowerCase();
  const currentSpot = spotPrices[metalKey] || 0;
  const qty = Number(item.qty) || 1;
  const weight = parseFloat(item.weight) || 0;
  const purity = parseFloat(item.purity) || 1.0;
  const isGb = item.weightUnit === "gb";
  const isSb = item.weightUnit === "sb";
  const weightOz = isGb
    ? weight * GB_TO_OZT
    : isSb
      ? weight * (typeof SB_TO_OZT !== "undefined" ? SB_TO_OZT : GB_TO_OZT)
      : weight;
  const metalColor = typeof getMetalColor === "function" ? getMetalColor(metalKey) : null;
  return { currentSpot, qty, weight, purity, isGb, isSb, weightOz, metalColor };
}

function _renderHeaderMeta(item, metrics) {
  const header = safeGetElement("viewModalTitle");
  if (header) header.textContent = item.name || "Untitled Item";
  _renderCatalogBadge(item);
  _applyHeaderGradient(header, metrics.metalColor);
  _renderCountChip(item);
}

function _renderCatalogBadge(item) {
  const catalogBadge = document.getElementById("viewModalCatalogId");
  if (!catalogBadge) return;
  const nId = item.numistaId || "";
  catalogBadge.textContent = nId ? `N#${nId}` : "";
  catalogBadge.style.display = nId ? "" : "none";
  if (!nId) {
    catalogBadge.onclick = null;
    catalogBadge.style.cursor = "";
    return;
  }
  catalogBadge.style.cursor = "pointer";
  catalogBadge.title = "View on Numista";
  catalogBadge.onclick = (e) => {
    e.stopPropagation();
    const isSet = /^S/i.test(nId);
    const cleanId = nId.replace(/^[NS]?#?\s*/i, "").trim();
    const url = isSet
      ? `https://en.numista.com/catalogue/set.php?id=${cleanId}`
      : `https://en.numista.com/catalogue/pieces${cleanId}.html`;
    _openExternalPopup(url, `numista_${nId}`);
  };
}

function _applyHeaderGradient(header, metalColor) {
  const modalHeader = document.getElementById("viewItemModal")?.querySelector(".modal-header");
  if (!modalHeader || !metalColor) return;
  modalHeader.style.background = `linear-gradient(135deg, ${metalColor}, ${_darkenColor(metalColor, 0.3)})`;
  const textColor = _isLightColor(metalColor) ? "#1e293b" : "#f8fafc";
  modalHeader.style.color = textColor;
  if (header) header.style.color = textColor;
}

function _renderCountChip(item) {
  const countChip = document.getElementById("viewModalCountChip");
  if (!countChip) return;
  const totalQty = inventory.reduce((sum, invItem) => {
    return invItem.name === item.name && invItem.metal === item.metal
      ? sum + (Number(invItem.qty) || 1)
      : sum;
  }, 0);
  countChip.textContent = totalQty > 1 ? `\u00d7${totalQty} in inventory` : "";
  countChip.style.display = totalQty > 1 ? "" : "none";
}

function _buildImageSection(item, metrics) {
  const imgSection = _el("div", "view-image-section");
  imgSection.id = "viewImageSection";
  const obverseSlot = _imageSlot("obverse", "Obverse");
  const reverseSlot = _imageSlot("reverse", "Reverse");
  _applyViewSlotFrame(obverseSlot, item, "obverse");
  _applyViewSlotFrame(reverseSlot, item, "reverse");
  imgSection.appendChild(obverseSlot);
  imgSection.appendChild(reverseSlot);
  if (metrics.metalColor) {
    const surfaceDeep = getThemeColor("bg-primary") || "#1a1a2e";
    const surfaceDeeper = getThemeColor("bg-secondary") || "#16213e";
    imgSection.style.background = `linear-gradient(145deg, color-mix(in srgb, ${metrics.metalColor} 15%, ${surfaceDeep}), color-mix(in srgb, ${metrics.metalColor} 8%, ${surfaceDeeper}))`;
  }
  const badge = _buildImageCertBadge(item);
  if (badge) imgSection.appendChild(badge);
  return imgSection;
}

function _buildImageCertBadge(item) {
  if (!item.grade) return null;
  const badge = _el("div", "view-cert-badge");
  const authority = item.gradingAuthority || "";
  const certNum = item.certNumber || "";
  const pcgsNo = item.pcgsNumber || "";
  const isVerified = item.pcgsVerified === true && authority === "PCGS";
  if (authority) badge.dataset.authority = authority;
  const gradeSpan = _buildImageCertGrade(item, authority, certNum, pcgsNo);
  badge.appendChild(gradeSpan);
  const verifySpan = _buildPcgsVerifyControl(item, authority, certNum, isVerified, false);
  if (verifySpan) badge.appendChild(verifySpan);
  return badge;
}

function _buildImageCertGrade(item, authority, certNum, pcgsNo) {
  const gradeSpan = _el("span", "view-cert-grade");
  gradeSpan.textContent = authority ? `${authority} ${item.grade}` : item.grade;
  const certUrlTemplate =
    typeof CERT_LOOKUP_URLS !== "undefined" && authority ? CERT_LOOKUP_URLS[authority] : "";
  const hasCertLink = certUrlTemplate && (certNum || pcgsNo);
  const hasCoinFacts = authority === "PCGS" && pcgsNo;
  if (hasCertLink || hasCoinFacts) {
    gradeSpan.classList.add("view-cert-clickable");
    gradeSpan.title = certNum
      ? `Look up ${authority} Cert #${certNum}`
      : `Open ${authority} verification`;
    gradeSpan.tabIndex = 0;
    gradeSpan.role = "button";
    gradeSpan.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        gradeSpan.click();
      }
    });
    gradeSpan.addEventListener("click", (e) => {
      e.stopPropagation();
      const url = hasCoinFacts
        ? _buildPcgsCoinFactsUrl(item.grade || "", pcgsNo)
        : certUrlTemplate
            .replace(/\{certNumber\}/g, encodeURIComponent(certNum))
            .replace(/\{grade\}/g, encodeURIComponent(_extractNumericGrade(item.grade)));
      const popupName = `cert_${authority}_${certNum || pcgsNo}`.replace(/[^a-zA-Z0-9_]/g, "_");
      const popup = window.open(
        url,
        popupName,
        "width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no"
      );
      if (popup) {
        popup.opener = null; // Security: prevent reverse tabnabbing
        popup.focus();
      }
    });
  } else {
    gradeSpan.title = authority
      ? `Graded by ${authority}: ${item.grade}${certNum ? ` — Cert #${certNum}` : ""}`
      : `Grade: ${item.grade}`;
  }
  return gradeSpan;
}

function _extractNumericGrade(gradeText) {
  return (gradeText || "").match(/\d+/)?.[0] || "";
}

function _buildPcgsCoinFactsUrl(gradeText, pcgsNo) {
  const gradeNum = _extractNumericGrade(gradeText);
  return gradeNum
    ? `https://www.pcgs.com/coinfacts/coin/detail/${encodeURIComponent(pcgsNo)}/${encodeURIComponent(gradeNum)}`
    : `https://www.pcgs.com/coinfacts/coin/${encodeURIComponent(pcgsNo)}`;
}

function _buildPcgsVerifyControl(item, authority, certNum, isVerified, inline) {
  const showVerifyBtn =
    authority === "PCGS" &&
    certNum &&
    typeof catalogConfig !== "undefined" &&
    catalogConfig.isPcgsEnabled() &&
    typeof verifyPcgsCert === "function";
  if (!showVerifyBtn) return null;
  const cls = inline ? "view-cert-verify view-cert-verify-inline" : "view-cert-verify";
  const verifySpan = _el("span", `${cls}${isVerified ? " pcgs-verified" : ""}`);
  verifySpan.tabIndex = 0;
  verifySpan.role = "button";
  verifySpan.dataset.certNumber = certNum;
  verifySpan.title = isVerified ? `Verified — Cert #${certNum}` : "Verify cert via PCGS API";
  verifySpan.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  verifySpan.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      verifySpan.click();
    }
  });
  verifySpan.addEventListener("click", (e) => {
    e.stopPropagation();
    _verifyPcgsCertAndUpdate(item, certNum, verifySpan, inline);
  });
  return verifySpan;
}

function _verifyPcgsCertAndUpdate(item, certNum, verifyEl, syncImageBadge) {
  verifyEl.classList.add("pcgs-verifying");
  verifyEl.title = "Verifying...";
  verifyPcgsCert(certNum)
    .then((result) => {
      verifyEl.classList.remove("pcgs-verifying");
      if (!result.verified) {
        verifyEl.title = result.error || "Verification failed";
        verifyEl.classList.add("pcgs-verify-failed");
        setTimeout(() => verifyEl.classList.remove("pcgs-verify-failed"), 3000);
        return;
      }
      verifyEl.classList.add("pcgs-verified");
      const idx = inventory.findIndex((inv) => inv.uuid === item.uuid);
      if (idx >= 0) {
        inventory[idx].pcgsVerified = true;
        saveInventory();
      }
      const parts = [];
      if (result.grade) parts.push(`Grade: ${result.grade}`);
      if (result.population) parts.push(`Pop: ${result.population}`);
      if (result.popHigher) parts.push(`Pop Higher: ${result.popHigher}`);
      if (result.priceGuide)
        parts.push(`Price Guide: $${Number(result.priceGuide).toLocaleString()}`);
      verifyEl.title = `Verified — ${parts.join(" | ")}`;
      if (syncImageBadge) {
        const imgBadgeVerify = document.querySelector(
          "#viewItemModal .view-cert-verify:not(.view-cert-verify-inline)"
        );
        if (imgBadgeVerify) imgBadgeVerify.classList.add("pcgs-verified");
      }
    })
    .catch((err) => {
      verifyEl.classList.remove("pcgs-verifying");
      verifyEl.title = "Verification service unavailable";
      if (typeof debugLog === "function") debugLog("warn", "PCGS verify failed:", err);
    });
}

function _buildInventorySection(item, metrics) {
  const invSection = _section("Inventory");
  const invGrid = _el("div", "view-detail-grid three-col");
  _addDetail(invGrid, "Metal", item.composition || item.metal || "—");
  _addDetail(invGrid, "Type", item.type || "—");
  _addDetail(invGrid, "Year", item.year || "—");
  _addDetail(
    invGrid,
    "Purity",
    metrics.purity < 1
      ? `.${String(metrics.purity).replace("0.", "")}`
      : metrics.purity === 1
        ? ".999+"
        : String(metrics.purity)
  );
  _addDetail(
    invGrid,
    "Weight",
    typeof formatWeight === "function"
      ? formatWeight(metrics.weight, item.weightUnit)
      : `${metrics.weight} oz`
  );
  _addDetail(invGrid, "Qty", String(metrics.qty));
  invSection.appendChild(invGrid);
  const invGrid2 = _el("div", "view-detail-grid three-col");
  const dateVal = item.date
    ? typeof formatDisplayDate === "function"
      ? formatDisplayDate(item.date)
      : item.date
    : "—";
  _addDetail(invGrid2, "Date", dateVal);
  _addDetail(invGrid2, "Payment Method", item.paymentMethod || "—");
  _appendSourceField(invGrid2, item.purchaseLocation || "—");
  invSection.appendChild(invGrid2);
  const storGrid = _el("div", "view-detail-grid");
  _addDetail(storGrid, "Storage", item.storageLocation || "\u2014");
  if (item.serialNumber) _addDetail(storGrid, "Serial #", item.serialNumber);
  invSection.appendChild(storGrid);
  return invSection;
}

function _appendSourceField(container, sourceValue) {
  const srcUrlPattern =
    /^(https?:\/\/)?[\w.-]+\.(com|net|org|co|io|us|uk|ca|au|de|fr|shop|store)\b/i;
  if (!srcUrlPattern.test(sourceValue)) {
    _addDetail(container, "Source", sourceValue);
    return;
  }
  const srcItem = _detailItem("Source", "");
  const valEl = srcItem.querySelector(".view-detail-value");
  if (valEl) {
    valEl.textContent = "";
    const srcLink = document.createElement("a");
    srcLink.href = "#";
    const srcHref = /^https?:\/\//i.test(sourceValue) ? sourceValue : `https://${sourceValue}`;
    srcLink.title = srcHref;
    srcLink.style.color = "var(--primary)";
    srcLink.style.textDecoration = "none";
    srcLink.textContent = sourceValue
      .replace(/^(https?:\/\/)?(www\.)?/i, "")
      .replace(/\/(.*)/i, "");
    srcLink.addEventListener("click", (e) => {
      e.preventDefault();
      _openExternalPopup(srcHref, "source_popup");
    });
    valEl.appendChild(srcLink);
  }
  container.appendChild(srcItem);
}

const SUPPORTED_PREMIUM_METALS = new Set(["Gold", "Silver", "Platinum", "Palladium"]);

function _resolvePremiumData(item, metrics, computed) {
  const purchasePrice = computed?.purchasePrice ?? (parseFloat(item.price) || 0);
  const purchaseTotal = computed?.purchaseTotal ?? metrics.qty * purchasePrice;
  const retailTotal =
    computed?.retailTotal ??
    (parseFloat(item.marketValue) > 0 ? metrics.qty * parseFloat(item.marketValue) : 0);

  let resolvedSpot = null;
  const rawMetal = String(item.metal || "").trim();
  const metalName = rawMetal
    ? rawMetal.charAt(0).toUpperCase() + rawMetal.slice(1).toLowerCase()
    : "";
  if (SUPPORTED_PREMIUM_METALS.has(metalName) && item.date) {
    const lookedUp =
      typeof lookupHistoricalSpot === "function"
        ? lookupHistoricalSpot(metalName, item.date)
        : null;
    if (typeof lookedUp === "number" && lookedUp > 0) resolvedSpot = lookedUp;
  }
  if (resolvedSpot === null) {
    const stored = parseFloat(item.spotPriceAtPurchase);
    if (stored > 0) resolvedSpot = stored;
  }

  const asw = metrics.weightOz * metrics.purity;
  const hasValidInputs = resolvedSpot !== null && resolvedSpot > 0 && asw > 0;

  const premiumPerOz = hasValidInputs ? purchasePrice / asw - resolvedSpot : null;
  const premiumPerCoin = hasValidInputs ? purchasePrice - resolvedSpot * asw : null;
  const premiumPercent = hasValidInputs ? (purchasePrice / asw / resolvedSpot - 1) * 100 : null;

  const glPercent =
    purchaseTotal > 0 && retailTotal > 0
      ? ((retailTotal - purchaseTotal) / purchaseTotal) * 100
      : null;

  return {
    resolvedSpot,
    asw,
    premiumPerOz,
    premiumPerCoin,
    premiumPercent,
    glPercent,
  };
}

function _buildValuationSection(item, metrics) {
  const computed =
    typeof computeItemValuation === "function"
      ? computeItemValuation(item, metrics.currentSpot)
      : null;
  const meltValue =
    computed?.meltValue ??
    (metrics.currentSpot > 0
      ? metrics.weightOz * metrics.qty * metrics.currentSpot * metrics.purity
      : 0);
  const purchasePrice = computed?.purchasePrice ?? (parseFloat(item.price) || 0);
  const purchaseTotal = computed?.purchaseTotal ?? metrics.qty * purchasePrice;
  const manualMarket = parseFloat(item.marketValue) || 0;
  const retailTotal =
    computed?.retailTotal ?? (manualMarket > 0 ? metrics.qty * manualMarket : meltValue);
  const gainLoss = computed?.gainLoss ?? (retailTotal > 0 ? retailTotal - purchaseTotal : null);
  const premiumData = _resolvePremiumData(item, metrics, computed);
  const valSection = _section("Valuation");
  valSection.classList.add("view-valuation-section");
  valSection._premiumData = premiumData;

  const formatPercent = (value) => {
    if (value === null || value === undefined) return "—";
    const sign = value >= 0 ? "+" : "";
    return sign + value.toFixed(1) + "%";
  };

  const signClass = (value) => {
    if (value === null || value === undefined) return "muted";
    return value >= 0 ? "gain" : "loss";
  };

  const purchaseDateStr = item.date
    ? typeof formatDisplayDate === "function"
      ? formatDisplayDate(item.date)
      : item.date
    : "";

  const valGrid = _el("div", "view-detail-grid six-col");
  const qty = metrics.qty || 1;
  const perUnitMelt = metrics.currentSpot > 0 ? meltValue / qty : 0;
  const perUnitRetail = retailTotal > 0 ? retailTotal / qty : 0;
  const perUnitGainLoss = gainLoss !== null ? gainLoss / qty : null;

  const costLabel = item.tradedFromUuid ? "Trade" : "Purchase";
  // STRK-132: compute FMV at trade date for received items (secondary info shown via ⓘ tooltip)
  const fmvAtTrade =
    item.tradedFromUuid && item.date && typeof computeTradeValue === "function"
      ? computeTradeValue(item, item.date)?.meltValue
      : null;
  const addRow = (purchaseLabel, pPrice, mMelt, mRetail, mGainLoss, mGlPercent) => {
    _addDetail(valGrid, costLabel, purchaseLabel);
    if (item.tradedFromUuid && fmvAtTrade > 0) {
      const lastItem = valGrid.lastElementChild;
      const lbl = lastItem?.querySelector(".view-detail-label");
      if (lbl instanceof HTMLElement) {
        const info = _el("span", "view-detail-info");
        info.textContent = " ⓘ";
        info.title = `Fair Market Value at trade: ${formatCurrency(fmvAtTrade)} — IRS reportable value`;
        info.style.cssText = "margin-left:4px;color:var(--text-muted);cursor:help";
        lbl.appendChild(info);
      }
    }
    _addDetail(
      valGrid,
      "Premium",
      formatPercent(premiumData.premiumPercent),
      signClass(premiumData.premiumPercent)
    );
    _addDetail(valGrid, "Melt", mMelt > 0 ? formatCurrency(mMelt) : "—");
    _addDetail(valGrid, "Retail", mRetail > 0 ? formatCurrency(mRetail) : "—");

    if (mGainLoss !== null && mRetail > 0) {
      const glItem = _detailItem(
        "Gain/Loss",
        (mGainLoss >= 0 ? "+" : "") + formatCurrency(mGainLoss),
        signClass(mGainLoss)
      );
      valGrid.appendChild(glItem);
    } else {
      _addDetail(valGrid, "Gain/Loss", "—", "muted");
    }

    if (mGlPercent !== null && mRetail > 0 && pPrice > 0) {
      _addDetail(valGrid, "G/L%", formatPercent(mGlPercent), signClass(mGlPercent));
    } else {
      _addDetail(valGrid, "G/L%", "—", "muted");
    }
  };

  if (qty > 1) {
    const totalLabel = purchaseDateStr
      ? `${formatCurrency(purchaseTotal)} total (${purchaseDateStr})`
      : `${formatCurrency(purchaseTotal)} total`;
    addRow(totalLabel, purchaseTotal, meltValue, retailTotal, gainLoss, premiumData.glPercent);

    const eachLabel = formatCurrency(purchasePrice) + " each";
    addRow(
      eachLabel,
      purchasePrice,
      perUnitMelt,
      perUnitRetail,
      perUnitGainLoss,
      premiumData.glPercent
    );
  } else {
    const singleLabel = purchaseDateStr
      ? `${formatCurrency(purchasePrice)} (${purchaseDateStr})`
      : formatCurrency(purchasePrice);
    addRow(singleLabel, purchasePrice, meltValue, retailTotal, gainLoss, premiumData.glPercent);
  }

  valSection.appendChild(valGrid);
  return valSection;
}

function _getChartCurrentRetail(item, metrics) {
  if (typeof computeItemValuation === "function") {
    const computed = computeItemValuation(item, metrics.currentSpot);
    if (computed && (computed.gbDenomPrice || computed.isManualRetail)) {
      return computed.retailTotal;
    }
    return 0;
  }

  const manualMarket = parseFloat(item.marketValue) || 0;
  return manualMarket > 0 ? manualMarket * metrics.qty : 0;
}

function _getGoldbackRetailHistoryEntries(item) {
  if (item.weightUnit !== "gb" || typeof goldbackPriceHistory === "undefined") return [];

  const key = String(parseFloat(item.weight) || 0);
  const entries = Array.isArray(goldbackPriceHistory[key]) ? goldbackPriceHistory[key] : [];
  return entries
    .filter((entry) => entry && typeof entry.price === "number" && entry.price > 0 && entry.ts)
    .map((entry) => ({ ts: entry.ts, retail: parseFloat(entry.price.toFixed(2)) }));
}

function _mergeRetailHistoryEntries(itemRetailEntries, goldbackRetailEntries) {
  const byDay = new Map();
  for (const entry of [...itemRetailEntries, ...goldbackRetailEntries]) {
    if (!entry || typeof entry.retail !== "number" || entry.retail <= 0 || !entry.ts) continue;
    const day = new Date(entry.ts).toISOString().slice(0, 10);
    const existing = byDay.get(day);
    if (!existing || entry.retail >= existing.retail) {
      byDay.set(day, entry);
    }
  }
  return [...byDay.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * Build the disposition section for disposed items (STAK-72).
 * Returns null for active (non-disposed) items — no visual change.
 * @param {Object} item - Inventory item
 * @returns {HTMLElement|null}
 */
function _buildDispositionSection(item) {
  // Path 1: Received item — compact provenance line (AC-5, AC-7)
  if (item.tradedFromUuid && typeof findItemByUuid === "function") {
    const source = findItemByUuid(item.tradedFromUuid);
    const section = _section("Trade");

    const line = _el("div", "trade-provenance-line");
    const icon = _el("span", "prov-icon");
    icon.textContent = "\u{1F501}";
    line.appendChild(icon);

    const text = _el("span");
    if (source) {
      const sd = source.disposition || {};
      const amountStr = sd.amount ? formatCurrency(sd.amount) : "";
      const sdDateStr = sd.date
        ? typeof formatDisplayDate === "function"
          ? formatDisplayDate(sd.date)
          : sd.date
        : "";
      text.textContent = "Acquired via trade — gave up: ";
      const nameLink = _el("button", "prov-link");
      nameLink.textContent = source.name || "source item";
      nameLink.type = "button";
      nameLink.addEventListener("click", () => {
        const idx = inventory.findIndex((c) => c.uuid === source.uuid);
        if (idx >= 0 && typeof showViewModal === "function") showViewModal(idx);
      });
      text.appendChild(nameLink);
      const suffix = [amountStr, sdDateStr].filter(Boolean).join(", ");
      if (suffix) text.appendChild(document.createTextNode(", " + suffix));
    } else {
      text.textContent = "Acquired via trade — source item missing";
    }
    line.appendChild(text);
    section.appendChild(line);

    // Mini comparison bar — gave up vs this item now (STRK-128)
    if (source) {
      const sd = source.disposition || {};
      const tradeTimeValue =
        typeof computeTradeValue === "function" ? computeTradeValue(source, sd.date || "") : null;
      const gaveUpValue = tradeTimeValue?.meltValue || 0;
      const thisSpot = spotPrices?.[String(item.metal || "").toLowerCase()] || 0;
      const thisValuation =
        typeof computeItemValuation === "function" ? computeItemValuation(item, thisSpot) : null;
      const thisValue = thisValuation?.retailTotal || thisValuation?.meltValue || 0;
      const netValue = thisValue - gaveUpValue;

      const comp = _el("div", "trade-comparison");

      const gaveUpSide = _el("div", "trade-comparison-side");
      const gaveLabel = _el("span", "comp-label");
      gaveLabel.textContent = "Gave Up (at trade)";
      const gaveVal = _el("span", "comp-value");
      gaveVal.textContent = formatCurrency(gaveUpValue);
      gaveUpSide.appendChild(gaveLabel);
      gaveUpSide.appendChild(gaveVal);
      comp.appendChild(gaveUpSide);

      const arrowEl = _el("div", "trade-comparison-arrow");
      arrowEl.textContent = "→";
      comp.appendChild(arrowEl);

      const thisSide = _el("div", "trade-comparison-side");
      const thisLabel = _el("span", "comp-label");
      thisLabel.textContent = "This Item (Now)";
      const thisVal = _el("span", "comp-value");
      thisVal.textContent = formatCurrency(thisValue);
      thisSide.appendChild(thisLabel);
      thisSide.appendChild(thisVal);
      comp.appendChild(thisSide);

      const verdict = _el("div", "trade-comparison-verdict");
      const netLabel = _el("span", "comp-label");
      netLabel.textContent = "Net";
      const netVal = _el("span", "comp-value " + (netValue >= 0 ? "gain" : "loss"));
      netVal.textContent = (netValue >= 0 ? "+" : "") + formatCurrency(netValue);
      verdict.appendChild(netLabel);
      verdict.appendChild(netVal);
      comp.appendChild(verdict);

      section.appendChild(comp);
    }

    const unlinkWrap = _el("div");
    unlinkWrap.style.cssText = "margin-top:var(--spacing-sm);display:flex;justify-content:flex-end";
    const unlinkBtn = _el("button", "trade-unlink-btn");
    unlinkBtn.type = "button";
    _setUnlinkBtnContent(unlinkBtn);
    unlinkBtn.addEventListener("click", () => {
      if (source && typeof unlinkTradeItem === "function") {
        unlinkTradeItem(source, item.uuid);
      } else {
        // Source item missing (deleted or not imported) — clear the stale back-reference directly.
        delete item.tradedFromUuid;
        if (typeof saveInventory === "function") saveInventory();
        if (typeof renderTable === "function") renderTable();
      }
      closeViewModal();
    });
    unlinkWrap.appendChild(unlinkBtn);
    section.appendChild(unlinkWrap);
    return section;
  }

  // STRK-83: derive the guard from the canonical predicate so the renderer and
  // isDisposed() can never disagree about empty-object dispositions.
  if (!isDisposed(item)) return null;

  const d = item.disposition;

  // Path 2: Disposed traded item with linked items (AC-3, AC-6, AC-10)
  if (d.type === "traded" && Array.isArray(d.tradedForUuids) && d.tradedForUuids.length > 0) {
    const section = _el("div", "view-detail-section");

    // Section header with Edit Trade pencil button
    const headerBar = _el("div");
    headerBar.style.cssText = "display:flex;align-items:center;justify-content:space-between";
    const titleEl = _el("div", "view-section-title");
    titleEl.textContent = "Trade";
    titleEl.style.margin = "0";
    headerBar.appendChild(titleEl);

    const editBtn = _el("button", "trade-edit-toggle");
    editBtn.type = "button";
    _setEditBtnContent(editBtn, "Edit Trade");
    headerBar.appendChild(editBtn);
    section.appendChild(headerBar);

    // Disposition detail grid (Type / Date / Amount)
    const typeLabel =
      typeof DISPOSITION_TYPES !== "undefined" && DISPOSITION_TYPES[d.type]
        ? DISPOSITION_TYPES[d.type].label
        : d.type;
    const dateStr = d.date
      ? typeof formatDisplayDate === "function"
        ? formatDisplayDate(d.date)
        : d.date
      : "—";
    const grid = _el("div", "view-detail-grid three-col");
    grid.style.marginTop = "var(--spacing-sm)";
    _addDetail(grid, "Type", typeLabel);
    _addDetail(grid, "Date", dateStr);
    _addDetail(grid, "Amount", formatCurrency(d.amount || 0));
    // STRK-132: FMV row — trade-time fair-market-value of received items (IRS reportable)
    const fmvTotal = Object.values(d.tradeValues || {}).reduce(
      (sum, tv) => sum + (tv?.meltValue || 0),
      0
    );
    _addDetail(grid, "FMV", formatCurrency(fmvTotal || parseFloat(d.amount) || 0));
    section.appendChild(grid);

    // Optional fields
    if (d.recipient || d.notes) {
      const optGrid = _el("div", "view-detail-grid");
      optGrid.style.marginTop = "2px";
      if (d.recipient) _addDetail(optGrid, "Recipient", d.recipient);
      if (d.notes) _addDetail(optGrid, "Notes", d.notes);
      section.appendChild(optGrid);
    }

    // Trade Gain/Loss
    const glGrid = _el("div", "view-detail-grid");
    glGrid.style.marginTop = "2px";
    const glItem = _detailItem(
      "Trade Gain/Loss",
      (d.realizedGainLoss >= 0 ? "+" : "") + formatCurrency(d.realizedGainLoss || 0)
    );
    const glVal = glItem.querySelector(".view-detail-value");
    if (glVal) glVal.classList.add(d.realizedGainLoss >= 0 ? "gain" : "loss");
    glGrid.appendChild(glItem);
    section.appendChild(glGrid);

    // Received Items sub-section
    const recSection = _el("div", "view-detail-section");
    const recTitle = _el("div", "view-section-title");
    recTitle.textContent = "Received Items";
    recSection.appendChild(recTitle);

    // View mode: table
    const viewMode = _el("div");
    viewMode.dataset.tradeViewMode = "view";
    const table = _el("table", "trade-items-table");
    const thead = _el("thead");
    const headRow = _el("tr");
    ["Item", "Qty", "Melt", "Retail"].forEach((label, i) => {
      const th = _el("th");
      th.textContent = label;
      if (i >= 2) th.className = "num";
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = _el("tbody");
    let receivedTotal = 0;
    d.tradedForUuids.forEach((uuid) => {
      const linked = typeof findItemByUuid === "function" ? findItemByUuid(uuid) : null;
      const tr = _el("tr");
      if (!linked) {
        const td = _el("td", "trade-missing-item");
        td.textContent = "Missing item";
        td.colSpan = 4;
        tr.appendChild(td);
      } else {
        const spot = spotPrices?.[String(linked.metal || "").toLowerCase()] || 0;
        const valuation =
          typeof computeItemValuation === "function" ? computeItemValuation(linked, spot) : null;
        const meltValue = valuation?.meltValue || 0;
        const retailTotal = valuation?.retailTotal || 0;
        receivedTotal += retailTotal || meltValue;

        const nameTd = _el("td");
        const nameBtn = _el("button", "item-name");
        nameBtn.type = "button";
        nameBtn.textContent = linked.name || "Unnamed item";
        nameBtn.addEventListener("click", () => {
          const idx = inventory.findIndex((c) => c.uuid === linked.uuid);
          if (idx >= 0 && typeof showViewModal === "function") showViewModal(idx);
        });
        nameTd.appendChild(nameBtn);
        tr.appendChild(nameTd);

        const qtyTd = _el("td");
        qtyTd.textContent = String(Number(linked.qty) || 1);
        tr.appendChild(qtyTd);

        const meltTd = _el("td", "num");
        meltTd.textContent = formatCurrency(meltValue);
        tr.appendChild(meltTd);

        const retailTd = _el("td", "num");
        retailTd.textContent = formatCurrency(retailTotal);
        tr.appendChild(retailTd);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    viewMode.appendChild(table);

    // Comparison bar
    const sourceSpot = spotPrices?.[String(item.metal || "").toLowerCase()] || 0;
    const sourceValue =
      typeof computeMeltValue === "function" ? computeMeltValue(item, sourceSpot) : 0;
    const netValue = receivedTotal - sourceValue;

    const comp = _el("div", "trade-comparison");

    const gaveUp = _el("div", "trade-comparison-side");
    const gaveLabel = _el("span", "comp-label");
    gaveLabel.textContent = "Gave Up (Now)";
    const gaveVal = _el("span", "comp-value");
    gaveVal.textContent = formatCurrency(sourceValue);
    gaveUp.appendChild(gaveLabel);
    gaveUp.appendChild(gaveVal);
    comp.appendChild(gaveUp);

    const arrowEl = _el("div", "trade-comparison-arrow");
    arrowEl.textContent = "→";
    comp.appendChild(arrowEl);

    const receivedSide = _el("div", "trade-comparison-side");
    const recLabel = _el("span", "comp-label");
    recLabel.textContent = "Received (Now)";
    const recVal = _el("span", "comp-value");
    recVal.textContent = formatCurrency(receivedTotal);
    receivedSide.appendChild(recLabel);
    receivedSide.appendChild(recVal);
    comp.appendChild(receivedSide);

    const verdict = _el("div", "trade-comparison-verdict");
    const netLabel = _el("span", "comp-label");
    netLabel.textContent = "Net";
    const netVal = _el("span", "comp-value " + (netValue >= 0 ? "gain" : "loss"));
    netVal.textContent = (netValue >= 0 ? "+" : "") + formatCurrency(netValue);
    verdict.appendChild(netLabel);
    verdict.appendChild(netVal);
    comp.appendChild(verdict);

    viewMode.appendChild(comp);
    recSection.appendChild(viewMode);

    // Edit mode (hidden by default) — inline chip+picker editor (AC-6)
    const editMode = _el("div");
    editMode.dataset.tradeViewMode = "edit";
    editMode.style.display = "none";

    const editChips = _el("div", "trade-linked-chips");
    editChips.dataset.editChips = "true";
    editMode.appendChild(editChips);

    const editPickerWrap = _el("div", "trade-item-picker");
    editPickerWrap.style.marginTop = "var(--spacing-sm)";
    const editSearchIcon = _el("span", "trade-search-icon");
    editSearchIcon.textContent = "\u{1F50D}";
    editPickerWrap.appendChild(editSearchIcon);
    const editSearch = _el("input");
    editSearch.type = "search";
    editSearch.placeholder = "Add item...";
    editSearch.autocomplete = "off";
    editPickerWrap.appendChild(editSearch);
    const editSuggestions = _el("div", "trade-item-suggestions");
    editSuggestions.setAttribute("role", "listbox");
    editPickerWrap.appendChild(editSuggestions);
    editMode.appendChild(editPickerWrap);

    const editAddBtn = _el("button", "trade-add-new-btn");
    editAddBtn.type = "button";
    const addIcon = _el("span", "add-icon");
    addIcon.textContent = "+";
    editAddBtn.appendChild(addIcon);
    const addText = _el("span");
    addText.textContent = "Add new item to inventory";
    editAddBtn.appendChild(addText);
    const addHint = _el("span", "add-hint");
    addHint.textContent = "— opens Add Item form";
    editAddBtn.appendChild(addHint);
    editMode.appendChild(editAddBtn);

    const editActions = _el("div", "trade-edit-actions");
    const saveBtn = _el("button", "btn-sm save");
    saveBtn.textContent = "Save";
    const cancelBtn = _el("button", "btn-sm cancel");
    cancelBtn.textContent = "Cancel";
    editActions.appendChild(saveBtn);
    editActions.appendChild(cancelBtn);
    editMode.appendChild(editActions);

    recSection.appendChild(editMode);

    // Wire up edit toggle
    let editUuids = [...d.tradedForUuids];

    const renderEditChips = () => {
      editChips.textContent = "";
      editUuids.forEach((uuid) => {
        const linked = typeof findItemByUuid === "function" ? findItemByUuid(uuid) : null;
        const chip = _el("span", "trade-linked-chip");
        chip.textContent = linked ? linked.name || "Unnamed item" : "Missing item";
        chip.dataset.uuid = uuid;
        const removeBtn = _el("button", "chip-remove");
        removeBtn.type = "button";
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", () => {
          editUuids = editUuids.filter((u) => u !== uuid);
          renderEditChips();
        });
        chip.appendChild(removeBtn);
        editChips.appendChild(chip);
      });
    };

    editBtn.addEventListener("click", () => {
      const isEditing = viewMode.style.display === "none";
      if (isEditing) {
        viewMode.style.display = "";
        editMode.style.display = "none";
        _setEditBtnContent(editBtn, "Edit Trade");
      } else {
        editUuids = [...d.tradedForUuids];
        renderEditChips();
        viewMode.style.display = "none";
        editMode.style.display = "";
        _setEditBtnContent(editBtn, "Cancel Edit");
      }
    });

    // Edit mode search
    editSearch.addEventListener("input", () => {
      const query = editSearch.value.trim().toLowerCase();
      if (!query) {
        editSuggestions.textContent = "";
        return;
      }
      const sourceUuid = item.uuid;
      const matches = inventory
        .filter(
          (inv) =>
            !isDisposed(inv) &&
            inv.uuid !== sourceUuid &&
            !editUuids.includes(inv.uuid) &&
            (inv.name || "").toLowerCase().includes(query)
        )
        .slice(0, 8);
      editSuggestions.textContent = "";
      matches.forEach((inv) => {
        const opt = _el("div", "trade-item-suggestion");
        opt.setAttribute("role", "option");
        opt.tabIndex = 0;
        const nameSpan = _el("span", "result-name");
        nameSpan.textContent = inv.name || "Unnamed item";
        opt.appendChild(nameSpan);
        const metaSpan = _el("span", "result-meta");
        metaSpan.textContent = (inv.metal || "") + " · Qty " + (Number(inv.qty) || 1);
        opt.appendChild(metaSpan);
        opt.addEventListener("click", () => {
          if (!editUuids.includes(inv.uuid)) editUuids.push(inv.uuid);
          renderEditChips();
          editSearch.value = "";
          editSuggestions.textContent = "";
        });
        opt.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          if (!editUuids.includes(inv.uuid)) editUuids.push(inv.uuid);
          renderEditChips();
          editSearch.value = "";
          editSuggestions.textContent = "";
        });
        editSuggestions.appendChild(opt);
      });
    });

    // Edit mode add new item
    editAddBtn.addEventListener("click", () => {
      window.__tradeEditAddNewPending = true;
      window.__tradeEditSourceItem = item;
      window.__tradeEditUuids = editUuids;
      window.__tradeEditRenderChips = renderEditChips;
      const itemModal = document.getElementById("itemModal");
      if (itemModal) itemModal.style.zIndex = "10001";
      document.getElementById("newItemBtn")?.click();
    });

    // Save: persist the updated trade links
    saveBtn.addEventListener("click", () => {
      const sourceIdx = inventory.findIndex((c) => c.uuid === item.uuid);
      if (sourceIdx < 0) return;
      if (typeof updateTradeLinks === "function") {
        updateTradeLinks(item, editUuids);
      }
      closeViewModal();
      if (typeof showViewModal === "function") showViewModal(sourceIdx);
    });

    cancelBtn.addEventListener("click", () => {
      viewMode.style.display = "";
      editMode.style.display = "none";
      _setEditBtnContent(editBtn, "Edit Trade");
    });

    section.appendChild(recSection);
    return section;
  }

  // Path 3: Standard (non-trade) disposition
  const section = _section("Disposition");
  const grid = _el("div", "view-detail-grid three-col");

  const typeLabel =
    typeof DISPOSITION_TYPES !== "undefined" && DISPOSITION_TYPES[d.type]
      ? DISPOSITION_TYPES[d.type].label
      : d.type;
  _addDetail(grid, "Type", typeLabel);

  const dateStr = d.date
    ? typeof formatDisplayDate === "function"
      ? formatDisplayDate(d.date)
      : d.date
    : "—";
  _addDetail(grid, "Date", dateStr);

  const requiresAmount =
    typeof DISPOSITION_TYPES !== "undefined" && DISPOSITION_TYPES[d.type]
      ? DISPOSITION_TYPES[d.type].requiresAmount
      : true;
  _addDetail(grid, "Amount", requiresAmount ? formatCurrency(d.amount || 0) : "N/A");

  section.appendChild(grid);

  if (d.recipient) {
    const grid2 = _el("div", "view-detail-grid two-col");
    _addDetail(grid2, "Recipient", d.recipient);
    section.appendChild(grid2);
  }

  if (d.notes) {
    const grid3 = _el("div", "view-detail-grid two-col");
    _addDetail(grid3, "Notes", d.notes);
    section.appendChild(grid3);
  }

  const glGrid = _el("div", "view-detail-grid two-col");
  const glItem = _detailItem(
    "Realized Gain/Loss",
    (d.realizedGainLoss >= 0 ? "+" : "") + formatCurrency(d.realizedGainLoss || 0)
  );
  const valEl = glItem.querySelector(".view-detail-value");
  if (valEl) valEl.classList.add(d.realizedGainLoss >= 0 ? "gain" : "loss");
  glGrid.appendChild(glItem);
  section.appendChild(glGrid);

  return section;
}

function _getPriceHistoryContext(item, metrics) {
  const metalName = item.metal || "Silver";
  // AC-1/AC-2: pricingType drives display unit. "each" → per-unit (×1); "lot" or absent → lot-total (×qty).
  const unitQty = item.pricingType === "each" ? 1 : metrics.qty;
  const meltFactor = metrics.weightOz * unitQty * metrics.purity;
  const spotEntries =
    typeof spotHistory !== "undefined"
      ? spotHistory
          .filter((e) => e.metal === metalName)
          .map((e) => ({ ts: new Date(e.timestamp).getTime(), spot: e.spot }))
          .sort((a, b) => a.ts - b.ts)
      : [];
  const spotByDay = new Map();
  for (const e of spotEntries) {
    const day = new Date(e.ts).toISOString().slice(0, 10);
    spotByDay.set(day, e);
  }
  const dailySpotEntries = [...spotByDay.values()];
  const retailEntries =
    typeof itemPriceHistory !== "undefined" && item.uuid
      ? (itemPriceHistory[item.uuid] || []).filter((e) => e.retail > 0)
      : [];
  const goldbackRetailEntries = _getGoldbackRetailHistoryEntries(item);
  const mergedRetail = _mergeRetailHistoryEntries(retailEntries, goldbackRetailEntries);
  // D-3: itemPriceHistory retail midpoints are stored per-unit; scale to match display unit.
  const scaledRetailEntries =
    unitQty !== 1
      ? mergedRetail.map((e) => ({ ...e, retail: parseFloat((e.retail * unitQty).toFixed(2)) }))
      : mergedRetail;
  // currentRetail is lot-total from _getChartCurrentRetail; scale to display unit.
  const lotCurrentRetail = _getChartCurrentRetail(item, metrics);
  const currentRetail =
    metrics.qty > 0
      ? parseFloat((lotCurrentRetail * (unitQty / metrics.qty)).toFixed(2))
      : lotCurrentRetail;
  return {
    metalName,
    meltFactor,
    dailySpotEntries,
    retailEntries: scaledRetailEntries,
    purchasePerUnit: (parseFloat(item.price) || 0) * unitQty,
    purchaseDate: item.date ? new Date(item.date).getTime() : 0,
    currentRetail,
  };
}

function _buildPriceHistorySection(chartCtx) {
  if (chartCtx.dailySpotEntries.length < 2) return null;
  const chartSection = _section("Price History");
  const rangeBar = _buildChartRangeBar(chartSection, chartCtx);
  chartSection.appendChild(rangeBar);
  const chartContainer = _el("div", "view-chart-container");
  const canvas = document.createElement("canvas");
  canvas.id = "viewPriceHistoryChart";
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
  const chartCaption = _el("p", "view-chart-caption");
  chartCaption.id = "viewChartCaption";
  chartCaption.hidden = true;
  chartSection.appendChild(chartCaption);
  return chartSection;
}

function _buildChartRangeBar(chartSection, chartCtx) {
  const rangeBar = _el("div", "view-chart-range-bar");
  const dateRange = _buildChartDateRangePicker(rangeBar, chartSection, chartCtx);
  _VIEW_CHART_RANGES.forEach((days, i) => {
    if (days === -1 && !chartCtx.purchaseDate) return;
    const pill = _el("button", "view-chart-range-pill");
    pill.type = "button";
    pill.textContent = _VIEW_CHART_RANGE_LABELS[i];
    pill.dataset.days = String(days);
    const isDefaultPill =
      _VIEW_CHART_DEFAULT_RANGE === -1
        ? chartCtx.purchaseDate
          ? days === -1
          : days === 30
        : days === _VIEW_CHART_DEFAULT_RANGE;
    if (isDefaultPill) pill.classList.add("active");
    pill.addEventListener("click", async () => {
      rangeBar
        .querySelectorAll(".view-chart-range-pill")
        .forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      await _onChartRangePillClick(days, dateRange, chartSection, chartCtx);
    });
    rangeBar.appendChild(pill);
  });
  rangeBar.appendChild(dateRange.wrap);
  return rangeBar;
}

function _buildChartDateRangePicker(rangeBar, chartSection, chartCtx) {
  const wrap = _el("div", "view-chart-date-range");
  const fromInput = document.createElement("input");
  fromInput.type = "date";
  fromInput.className = "view-chart-date-input";
  fromInput.title = "From date";
  const toInput = document.createElement("input");
  toInput.type = "date";
  toInput.className = "view-chart-date-input";
  toInput.title = "To date";
  const todayStr = new Date().toISOString().slice(0, 10);
  fromInput.max = todayStr;
  toInput.max = todayStr;
  const dateSep = _el("span", "view-chart-date-sep");
  dateSep.textContent = "\u2014";
  wrap.appendChild(fromInput);
  wrap.appendChild(dateSep);
  wrap.appendChild(toInput);
  const onDateChange = async () => {
    rangeBar
      .querySelectorAll(".view-chart-range-pill")
      .forEach((p) => p.classList.remove("active"));
    if (fromInput.value) toInput.min = fromInput.value;
    else toInput.min = "";
    if (toInput.value) fromInput.max = toInput.value;
    else fromInput.max = todayStr;
    const fromTs = fromInput.value ? new Date(fromInput.value + "T00:00:00").getTime() : 0;
    const toTs = toInput.value ? new Date(toInput.value + "T23:59:59").getTime() : 0;
    if (fromTs <= 0 && toTs <= 0) return;
    const canvas = chartSection.querySelector("#viewPriceHistoryChart");
    if (!canvas) return;
    _setChartCaption(canvas, null);
    try {
      const fullSpot = await _fetchHistoricalSpotData(chartCtx.metalName, 0, fromTs, toTs);
      _createPriceHistoryChart(
        canvas,
        fullSpot,
        chartCtx.retailEntries,
        chartCtx.purchasePerUnit,
        chartCtx.meltFactor,
        0,
        chartCtx.purchaseDate,
        chartCtx.currentRetail,
        fromTs,
        toTs
      );
    } catch (err) {
      console.error("Custom date range fetch failed:", err);
      _createPriceHistoryChart(
        canvas,
        [],
        chartCtx.retailEntries,
        chartCtx.purchasePerUnit,
        chartCtx.meltFactor,
        0,
        chartCtx.purchaseDate,
        chartCtx.currentRetail,
        fromTs,
        toTs
      );
    }
  };
  fromInput.addEventListener("change", onDateChange);
  toInput.addEventListener("change", onDateChange);
  return { wrap, fromInput, toInput, todayStr };
}

async function _onChartRangePillClick(days, dateRange, chartSection, chartCtx) {
  dateRange.fromInput.value = "";
  dateRange.toInput.value = "";
  dateRange.fromInput.max = dateRange.todayStr;
  dateRange.toInput.min = "";
  const canvas = chartSection.querySelector("#viewPriceHistoryChart");
  if (!canvas) return;
  if (days === -1 && chartCtx.purchaseDate > 0) {
    const toTs = Date.now();
    const { fromTs, caption } = _purchasedRangeFrom(chartCtx.purchaseDate);
    _setChartCaption(canvas, caption);
    try {
      const spotData = await _fetchHistoricalSpotData(chartCtx.metalName, 0, fromTs, toTs);
      _createPriceHistoryChart(
        canvas,
        spotData,
        chartCtx.retailEntries,
        chartCtx.purchasePerUnit,
        chartCtx.meltFactor,
        0,
        chartCtx.purchaseDate,
        chartCtx.currentRetail,
        fromTs,
        toTs
      );
    } catch (err) {
      console.error("Purchased range fetch failed:", err);
      _createPriceHistoryChart(
        canvas,
        chartCtx.dailySpotEntries,
        chartCtx.retailEntries,
        chartCtx.purchasePerUnit,
        chartCtx.meltFactor,
        0,
        chartCtx.purchaseDate,
        chartCtx.currentRetail,
        fromTs,
        toTs
      );
    }
    return;
  }
  const effectiveDays = days;
  _setChartCaption(canvas, null);
  try {
    const spotData = await _fetchHistoricalSpotData(chartCtx.metalName, effectiveDays);
    _createPriceHistoryChart(
      canvas,
      spotData,
      chartCtx.retailEntries,
      chartCtx.purchasePerUnit,
      chartCtx.meltFactor,
      effectiveDays,
      chartCtx.purchaseDate,
      chartCtx.currentRetail
    );
  } catch (err) {
    console.error("Range pill fetch failed:", err);
    _createPriceHistoryChart(
      canvas,
      chartCtx.dailySpotEntries,
      chartCtx.retailEntries,
      chartCtx.purchasePerUnit,
      chartCtx.meltFactor,
      effectiveDays,
      chartCtx.purchaseDate,
      chartCtx.currentRetail
    );
  }
}

function _buildGradingSection(item) {
  if (!item.grade && !item.gradingAuthority && !item.certNumber) return null;
  const gradeSection = _section("Grading");
  const gradeGrid = _el("div", "view-detail-grid three-col");
  _addDetail(gradeGrid, "Grade", item.grade || "—");
  _addDetail(gradeGrid, "Authority", item.gradingAuthority || "—");
  const certItem = _buildGradingCertItem(item);
  if (certItem) gradeGrid.appendChild(certItem);
  else _addDetail(gradeGrid, "Cert #", "—");
  gradeSection.appendChild(gradeGrid);
  return gradeSection;
}

function _buildGradingCertItem(item) {
  if (!item.certNumber) return null;
  const certItem = _detailItem("Cert #", item.certNumber);
  _attachGradingCertLink(certItem, item);
  const valEl = certItem.querySelector(".view-detail-value");
  if (!valEl) return certItem;
  const inlineVerify = _buildPcgsVerifyControl(
    item,
    item.gradingAuthority || "",
    item.certNumber,
    item.pcgsVerified === true,
    true
  );
  if (inlineVerify) valEl.appendChild(inlineVerify);
  return certItem;
}

function _attachGradingCertLink(certItem, item) {
  if (
    !item.gradingAuthority ||
    typeof CERT_LOOKUP_URLS === "undefined" ||
    !CERT_LOOKUP_URLS[item.gradingAuthority]
  )
    return;
  const url = CERT_LOOKUP_URLS[item.gradingAuthority]
    .replace(/{certNumber}/g, encodeURIComponent(item.certNumber))
    .replace(/{grade}/g, encodeURIComponent(_extractNumericGrade(item.grade)));
  const valEl = certItem.querySelector(".view-detail-value");
  if (!valEl) return;
  valEl.textContent = "";
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = item.certNumber;
  link.style.color = "var(--primary)";
  link.title = `Verify on ${item.gradingAuthority}`;
  valEl.appendChild(link);
}

function _buildNumistaPlaceholderSection() {
  const numistaPlaceholder = _el("div", "");
  numistaPlaceholder.id = "viewNumistaSection";
  return numistaPlaceholder;
}

function _buildTagsSection(item) {
  if (typeof buildTagSection !== "function") return null;
  return buildTagSection(item.uuid, [], () => {
    if (typeof renderActiveFilters === "function") renderActiveFilters();
  });
}

function _buildNotesSection(item) {
  if (!item.notes) return null;
  const notesSection = _section("Notes");
  const noteText = _el("div", "view-notes-text");
  noteText.textContent = item.notes;
  notesSection.appendChild(noteText);
  return notesSection;
}

function _buildAttachmentsSection(item) {
  if (!item.attachments?.length) return null;
  if (typeof renderAttachmentListPanel !== "function") return null;
  const section = _el("div", "view-detail-section");
  renderAttachmentListPanel(item, { editable: false })
    .then((panel) => {
      if (panel) section.appendChild(panel);
    })
    .catch((err) => {
      console.warn("Failed to render attachment panel:", err);
    });
  return section;
}

function _appendSectionsInConfiguredOrder(frag, sectionBuilders) {
  const sectionConfig =
    typeof getViewModalSectionConfig === "function"
      ? getViewModalSectionConfig()
      : VIEW_MODAL_SECTION_DEFAULTS;
  for (const sec of sectionConfig) {
    if (!sec.enabled) continue;
    const builder = sectionBuilders[sec.id];
    if (!builder) continue;
    const el = builder();
    if (el) frag.appendChild(el);
  }
}

function _renderHeaderActions(item, index) {
  const headerActions = document.getElementById("viewHeaderActions");
  if (!headerActions) return;
  headerActions.textContent = "";
  const ebayBtn = document.createElement("button");
  ebayBtn.className = "view-ebay-btn";
  ebayBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style="fill:currentColor;margin-right:4px;vertical-align:-2px;"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.5"/><line x1="15" y1="15" x2="21" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>eBay';
  ebayBtn.title = "Search eBay for this item";
  ebayBtn.addEventListener("click", () => {
    const searchTerm =
      (item.metal || "") + (item.year ? " " + item.year : "") + " " + (item.name || "");
    if (typeof openEbayBuySearch === "function") openEbayBuySearch(searchTerm);
    else if (typeof openEbaySoldSearch === "function") openEbaySoldSearch(searchTerm);
  });
  headerActions.appendChild(ebayBtn);
}

function _renderFooterActions(item, index) {
  const footer = document.getElementById("viewModalFooter");
  if (!footer) return;
  footer.textContent = "";

  // Left group — destructive
  const left = document.createElement("div");
  left.className = "view-footer-left";

  const removeBtn = document.createElement("button");
  removeBtn.className = "view-footer-btn danger";
  removeBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-1px;margin-right:0.2rem;"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>Remove';
  removeBtn.addEventListener("click", () => {
    closeViewModal();
    if (typeof deleteItem === "function") deleteItem(index);
  });
  left.appendChild(removeBtn);

  // Right group — constructive
  const right = document.createElement("div");
  right.className = "view-footer-right";

  const editBtn = document.createElement("button");
  editBtn.className = "view-footer-btn primary";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => {
    closeViewModal();
    if (typeof editItem === "function") editItem(index);
  });

  const cloneBtn = document.createElement("button");
  cloneBtn.className = "view-footer-btn secondary";
  cloneBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-1px;margin-right:0.2rem;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Clone';
  cloneBtn.addEventListener("click", () => {
    closeViewModal();
    if (typeof cloneItem === "function") cloneItem(index);
  });

  const closeBtn = document.createElement("button");
  closeBtn.className = "view-footer-btn secondary";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", closeViewModal);

  right.appendChild(cloneBtn);
  right.appendChild(closeBtn);
  right.appendChild(editBtn);

  footer.appendChild(left);
  footer.appendChild(right);

  // Restore to Inventory button for disposed items (STAK-388)
  if (isDisposed(item)) {
    const restoreBtn = document.createElement("button");
    restoreBtn.textContent = "Restore to Inventory";
    restoreBtn.className = "view-footer-btn secondary";
    restoreBtn.setAttribute("aria-label", "Restore item to active inventory");
    restoreBtn.onclick = async function () {
      await undoDisposition(index);
      closeViewModal();
    };
    left.insertBefore(restoreBtn, left.firstChild);
  }

  // Wire up header close X button
  const closeX = safeGetElement("viewModalCloseX");
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
    images: () => _buildImageSection(item, metrics),
    priceHistory: () => _buildPriceHistorySection(chartCtx),
    valuation: () => _buildValuationSection(item, metrics),
    inventory: () => _buildInventorySection(item, metrics),
    grading: () => _buildGradingSection(item),
    numista: () => _buildNumistaPlaceholderSection(),
    tags: () => _buildTagsSection(item),
    notes: () => _buildNotesSection(item),
    attachments: () => _buildAttachmentsSection(item),
    disposition: () => _buildDispositionSection(item),
  };

  _appendSectionsInConfiguredOrder(frag, sectionBuilders);

  _renderHeaderActions(item, index);
  _renderFooterActions(item, index);
  return frag;
}

// ---------------------------------------------------------------------------
// Async loaders
// ---------------------------------------------------------------------------

/**
 * Load obverse and reverse images for the view modal, preferring cached user-uploaded or pattern-derived URLs and falling back to CDN URLs stored on the item.
 * @param {Object} item - Inventory item containing image references (e.g., obverseImageUrl, reverseImageUrl).
 * @param {HTMLElement} container - Modal container element that contains the image section (#viewImageSection).
 * @returns {{loaded: boolean, source: ('userOrPattern'|'cdn'|null)}} `loaded` is `true` if at least one image was set, `false` otherwise. `source` is `'userOrPattern'` when a cached/uploaded URL was used, `'cdn'` when fallback item URLs were used, or `null` when no valid images were available.
 */
async function loadViewImages(item, container) {
  const section = container.querySelector("#viewImageSection");
  if (!section) return { loaded: false, source: null };

  const slots = section.querySelectorAll(".view-image-slot");
  const obvSlot = slots[0];
  const revSlot = slots[1];

  if (!window.imageCache?.isAvailable()) {
    // Fallback: CDN URLs stored on the item
    const validObv = ImageCache.isValidImageUrl(item.obverseImageUrl);
    const validRev = ImageCache.isValidImageUrl(item.reverseImageUrl);
    if (validObv) _setSlotImage(obvSlot, item.obverseImageUrl);
    if (validRev) _setSlotImage(revSlot, item.reverseImageUrl);
    return { loaded: validObv || validRev, source: "cdn" };
  }

  // Per-side cascade: user upload → pattern → CDN URL (each side independent)
  const obvUrl = await imageCache.resolveImageUrlForItem(item, "obverse");
  const revUrl = await imageCache.resolveImageUrlForItem(item, "reverse");

  if (obvUrl) {
    _viewModalObjectUrls.push(obvUrl);
    _setSlotImage(obvSlot, obvUrl);
  }
  if (revUrl) {
    _viewModalObjectUrls.push(revUrl);
    _setSlotImage(revSlot, revUrl);
  }
  if (obvUrl || revUrl) return { loaded: true, source: "userOrPattern" };

  // Final fallback: CDN URLs stored on the item (validate to skip corrupted URLs)
  const validObv = ImageCache.isValidImageUrl(item.obverseImageUrl);
  const validRev = ImageCache.isValidImageUrl(item.reverseImageUrl);
  if (validObv) _setSlotImage(obvSlot, item.obverseImageUrl);
  if (validRev) _setSlotImage(revSlot, item.reverseImageUrl);
  return { loaded: validObv || validRev, source: validObv || validRev ? "cdn" : null };
}

const MEANINGFUL_FALSY_KEYS = new Set(["commemorative", "rarityIndex"]);
const NON_RENDERING_NUMISTA_KEYS = new Set(["source", "updatedAt", "fieldMeta"]);

/**
 * Determines whether a Numista metadata field contains a value that should be rendered in the UI.
 * Considers configured exclusions and treats certain falsy values as meaningful for specific keys.
 * @param {string} key - The Numista metadata field name.
 * @param {*} value - The field value to evaluate.
 * @returns {boolean} `true` if the field should be displayed, `false` otherwise.
 */
function _hasMeaningfulNumistaValue(key, value) {
  if (NON_RENDERING_NUMISTA_KEYS.has(key)) return false;
  if (value === "" || value === null || value === undefined) return false;
  if (!value && !MEANINGFUL_FALSY_KEYS.has(key)) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  )
    return false;
  return true;
}

/**
 * Determine whether the supplied Numista item edits contain any fields that should be rendered in the Catalog Data section.
 *
 * @param {Object|null|undefined} itemData - Item-level Numista edits (may be null/undefined). The function treats non-empty strings and numbers as meaningful and also treats certain intentionally falsy fields (for example `commemorative` or `rarityIndex`) as meaningful when present.
 * @returns {boolean} `true` if at least one renderable Numista field exists on `itemData`, `false` otherwise.
 */
function hasMeaningfulItemData(itemData) {
  if (!itemData || typeof itemData !== "object") return false;
  return Object.entries(itemData).some(([key, value]) => _hasMeaningfulNumistaValue(key, value));
}

/**
 * Combine cached/API Numista metadata with item-level Numista edits, giving precedence to item edits.
 *
 * Empty or otherwise non-meaningful item fields are removed before merging so they do not override valid cached values.
 * The function preserves intentionally meaningful falsy values such as `commemorative: false` and `rarityIndex: 0`.
 *
 * @param {Object|null|undefined} itemData - Item-level Numista edits; may contain partial or raw fields.
 * @param {Object|null|undefined} cacheMeta - Cached or API-provided Numista metadata.
 * @returns {Object} Merged metadata object where keys from `itemData` override those in `cacheMeta`.
 */
function mergeNumistaSources(itemData, cacheMeta) {
  const sanitizedItemData = {};
  if (itemData && typeof itemData === "object") {
    Object.entries(itemData).forEach(([key, value]) => {
      if (_hasMeaningfulNumistaValue(key, value)) {
        sanitizedItemData[key] = value;
      }
    });
  }

  return { ...(cacheMeta || {}), ...sanitizedItemData };
}

/**
 * Format a KM (catalogue) reference into a user-facing string.
 *
 * @param {string|Object} ref - A KM reference, either a display string or an object with optional `catalogue` and `number` properties (e.g. `{ catalogue: "KM", number: 123 }`).
 * @returns {string} The formatted reference: the input string unchanged when `ref` is a string; `"catalogue#number"` when both fields are present; the `catalogue` or `number` (as a string) when only one is present; otherwise an empty string.
 */
function _formatKmReference(ref) {
  if (typeof ref === "string") return ref;
  if (!ref || typeof ref !== "object") return "";
  if (ref.catalogue && ref.number) return `${ref.catalogue}#${ref.number}`;
  if (ref.catalogue) return ref.catalogue;
  if (ref.number) return String(ref.number);
  return "";
}

/**
 * Render the "Catalog Data" enrichment for an item using cached Numista metadata, a provided API result, or item-level Numista edits.
 *
 * Attempts to read metadata from the image cache (IndexedDB) and falls back to the supplied `apiResult` when available. If neither cache/API metadata nor meaningful item-level Numista edits exist, the function returns without rendering. The final rendered view merges item-level edits over any metadata, updates the image frame shape when the merged shape indicates a non-round form, sets obverse/reverse image tooltips when available, and replaces the `#viewNumistaSection` placeholder with the constructed section. When an `apiResult` is used, it is cached for future use when an image cache is available.
 *
 * @param {Object} item - Inventory item object; `item.numistaId` identifies the catalog entry and `item.numistaData` may contain user edits that override cached/API fields.
 * @param {HTMLElement} container - Container element containing the `#viewNumistaSection` placeholder and optional `#viewImageSection`.
 * @param {Object|null} apiResult - Optional pre-fetched Numista API result to use when cache is missing or stale; when provided and used, it will be cached if an image cache is available.
 */
async function loadViewNumistaData(item, container, apiResult) {
  const catalogId = item.numistaId || "";
  const hasCapsuleData = !!(item.capsule || item.capsuleNotes);
  if (!catalogId && !hasCapsuleData) return;

  const placeholder = container.querySelector("#viewNumistaSection");
  if (!placeholder) return;

  let meta = null;

  // Check cache
  if (catalogId && window.imageCache?.isAvailable()) {
    meta = await imageCache.getMetadata(catalogId);

    // Stale check
    if (meta && Date.now() - (meta.cachedAt || 0) > VIEW_METADATA_TTL) {
      meta = null; // Force refresh
    }
  }

  // Use pre-fetched API result if no cache hit
  if (!meta && apiResult) {
    meta = _extractMetadata(apiResult);

    // Cache for next time
    if (catalogId && window.imageCache?.isAvailable()) {
      imageCache.cacheMetadata(catalogId, apiResult).catch(() => {});
    }
  }

  if (!meta && !hasMeaningfulItemData(item.numistaData) && !hasCapsuleData) return;
  const merged = mergeNumistaSources(item.numistaData, meta);

  // Load user's field visibility config
  const cfg = typeof getNumistaViewFieldConfig === "function" ? getNumistaViewFieldConfig() : {};

  // Update image frame shape after late Numista enrichment; use a two-way
  // per-slot toggle so explicit circle overrides do not get stuck rectangular.
  if (merged.shape) {
    const enrichedItem = { ...item, numistaData: merged };
    _applyViewSlotFrame(
      container.querySelector('.view-image-slot[data-side="obverse"]'),
      enrichedItem,
      "obverse"
    );
    _applyViewSlotFrame(
      container.querySelector('.view-image-slot[data-side="reverse"]'),
      enrichedItem,
      "reverse"
    );
  }

  // Build Numista section — uses standard _section() for consistent styling
  const section = _section("Catalog Data");
  section.classList.add("view-numista-section");

  const grid = _el("div", "view-detail-grid");

  if (cfg.denomination !== false && merged.denomination)
    _addDetail(grid, "Denomination", merged.denomination);
  if (cfg.shape !== false && merged.shape) _addDetail(grid, "Shape", merged.shape);
  if (cfg.diameter !== false || (merged.length && merged.width)) {
    if (merged.length && merged.width) {
      // Both dimensions available — composite "L × W" or "L × W × T"
      const dims =
        cfg.thickness !== false && merged.thickness
          ? `${merged.length} \u00D7 ${merged.width} \u00D7 ${merged.thickness} mm`
          : `${merged.length} \u00D7 ${merged.width} mm`;
      _addDetail(grid, "Dimensions", dims);
    } else if (merged.length) {
      // Only length (width=0) — show what we have
      _addDetail(grid, "Dimensions", `${merged.length} mm`);
      if (cfg.thickness !== false && merged.thickness) {
        _addDetail(grid, "Thickness", `${merged.thickness} mm`);
      }
    } else if (merged.diameter) {
      _addDetail(grid, "Diameter", `${merged.diameter} mm`);
      if (cfg.thickness !== false && merged.thickness) {
        _addDetail(grid, "Thickness", `${merged.thickness} mm`);
      }
    }
  }
  // Standalone thickness for items with only thickness (no other dimensions)
  if (cfg.thickness !== false && merged.thickness && !merged.diameter && !merged.length) {
    _addDetail(grid, "Thickness", `${merged.thickness} mm`);
  }
  if (item.capsule) _addDetail(grid, "Capsule", item.capsule);
  if (item.capsuleNotes) _addDetail(grid, "Capsule Notes", item.capsuleNotes);
  if (cfg.orientation !== false && merged.orientation)
    _addDetail(grid, "Orientation", merged.orientation);
  if (cfg.composition !== false && merged.composition)
    _addDetail(grid, "Composition", merged.composition);
  if (cfg.country !== false && merged.country) _addDetail(grid, "Country", merged.country);
  if (cfg.technique !== false && merged.technique) _addDetail(grid, "Technique", merged.technique);

  if (cfg.references !== false) {
    if (merged.kmRef) {
      _addDetail(grid, "KM Reference", merged.kmRef);
    } else if (Array.isArray(merged.kmReferences) && merged.kmReferences.length > 0) {
      const references = merged.kmReferences.map(_formatKmReference).filter(Boolean).join(", ");
      if (references) _addDetail(grid, "References", references);
    }
  }

  section.appendChild(grid);

  // Obverse/reverse descriptions on full-width lines; image tooltips below stay additive.
  if (cfg.obverse !== false && merged.obverseDesc) {
    const obvGrid = _el("div", "view-detail-grid");
    const obvItem = _detailItem("Obverse", merged.obverseDesc);
    obvItem.classList.add("full-width");
    obvGrid.appendChild(obvItem);
    section.appendChild(obvGrid);
  }
  if (cfg.reverse !== false && merged.reverseDesc) {
    const revGrid = _el("div", "view-detail-grid");
    const revItem = _detailItem("Reverse", merged.reverseDesc);
    revItem.classList.add("full-width");
    revGrid.appendChild(revItem);
    section.appendChild(revGrid);
  }

  // Edge description on its own full-width line (can be long)
  if (cfg.edge !== false && merged.edgeDesc) {
    const edgeGrid = _el("div", "view-detail-grid");
    const edgeItem = _detailItem("Edge", merged.edgeDesc);
    edgeItem.classList.add("full-width");
    edgeGrid.appendChild(edgeItem);
    section.appendChild(edgeGrid);
  }

  // Set obverse/reverse descriptions as tooltips on the image slots
  if (cfg.imageTooltips !== false && (merged.obverseDesc || merged.reverseDesc)) {
    const imgSection = container.querySelector("#viewImageSection");
    if (imgSection) {
      const slots = imgSection.querySelectorAll(".view-image-slot");
      if (merged.obverseDesc && slots[0]) {
        slots[0].title = `Obverse: ${merged.obverseDesc}`;
      }
      if (merged.reverseDesc && slots[1]) {
        slots[1].title = `Reverse: ${merged.reverseDesc}`;
      }
    }
  }

  // Commemorative
  if (cfg.commemorative !== false && merged.commemorative && merged.commemorativeDesc) {
    const commGrid = _el("div", "view-detail-grid");
    const commItem = _detailItem("Commemorative", merged.commemorativeDesc);
    commItem.classList.add("full-width");
    commGrid.appendChild(commItem);
    section.appendChild(commGrid);
  }

  // Rarity index
  if (cfg.rarity !== false && merged.rarityIndex > 0) {
    const rarityRow = _el("div", "view-detail-item");

    const lbl = _el("span", "view-detail-label");
    lbl.textContent = "Rarity";
    rarityRow.appendChild(lbl);

    const bar = _el("div", "view-rarity-bar");

    const track = _el("div", "view-rarity-track");
    const fill = _el("div", "view-rarity-fill");
    fill.style.width = `${Math.min(merged.rarityIndex, 100)}%`;
    track.appendChild(fill);
    bar.appendChild(track);

    const score = _el("span", "view-rarity-score");
    score.textContent = String(merged.rarityIndex);
    bar.appendChild(score);

    rarityRow.appendChild(bar);
    section.appendChild(rarityRow);
  }

  // Mintage: prefer item-level flat value, then cache/API per-year data.
  if (
    cfg.mintage !== false &&
    ((merged.mintage != null && merged.mintage !== "") ||
      (Array.isArray(merged.mintageByYear) && merged.mintageByYear.length > 0))
  ) {
    const mintGrid = _el("div", "view-detail-grid");
    const mintItem = _el("div", "view-detail-item full-width");
    const mintLabel = _el("span", "view-detail-label");
    mintLabel.textContent = "Mintage";
    mintItem.appendChild(mintLabel);

    const mintVal = _el("span", "view-detail-value");
    if (merged.mintage != null && merged.mintage !== "") {
      mintVal.textContent =
        typeof merged.mintage === "number"
          ? merged.mintage.toLocaleString()
          : String(merged.mintage);
    } else {
      const entries = merged.mintageByYear.slice(0, 5);
      mintVal.textContent = entries
        .map((e) => {
          const m = typeof e.mintage === "number" ? e.mintage.toLocaleString() : e.mintage;
          return `${e.year}: ${m}${e.remark ? ` (${e.remark})` : ""}`;
        })
        .join(" | ");
      if (merged.mintageByYear.length > 5) mintVal.textContent += " ...";
    }
    mintItem.appendChild(mintVal);
    mintGrid.appendChild(mintItem);
    section.appendChild(mintGrid);
  }

  placeholder.replaceWith(section);
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
  if (!catalogId || typeof catalogAPI === "undefined") return null;
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
    title: result.name || "",
    country: result.country || "",
    denomination: result.denomination || "",
    diameter: result.diameter || result.size || 0,
    thickness: result.thickness || 0,
    length: result.length || 0,
    width: result.width || 0,
    weight: result.weight || 0,
    shape: result.shape || "",
    composition: result.composition || result.metal || "",
    orientation: result.orientation || "",
    commemorative: !!result.commemorative,
    commemorativeDesc: result.commemorativeDesc || "",
    rarityIndex: result.rarityIndex || 0,
    kmReferences: result.kmReferences || [],
    mintageByYear: result.mintageByYear || [],
    technique: result.technique || "",
    tags: result.tags || [],
    obverseDesc: result.obverseDesc || "",
    reverseDesc: result.reverseDesc || "",
    edgeDesc: result.edgeDesc || "",
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
    name || "_blank",
    "width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no"
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
  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  // Handle rgb(r, g, b) / rgba(r, g, b, a)
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  // Delegate to the shared resolveColor (theme.js) for oklch, hsl, lab, etc.
  if (typeof resolveColor === "function") {
    const resolved = resolveColor(s);
    const rm = resolved.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rm) return [parseInt(rm[1], 10), parseInt(rm[2], 10), parseInt(rm[3], 10)];
  }
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
  const toHex = (v) =>
    Math.round(v * f)
      .toString(16)
      .padStart(2, "0");
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
  if (typeof window.fetchYearFile === "function") {
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
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .catch(
      () =>
        new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", localUrl, true);
          xhr.responseType = "json";
          xhr.onload = () =>
            xhr.status === 200 || (xhr.status === 0 && xhr.response)
              ? resolve(xhr.response)
              : reject(new Error(`XHR ${xhr.status}`));
          xhr.onerror = () => reject(new Error("XHR error"));
          xhr.send();
        })
    )
    .catch(() =>
      fetch(remoteUrl).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
    )
    .then((entries) => {
      const valid = Array.isArray(entries)
        ? entries.filter((e) => e && typeof e.spot === "number" && e.metal && e.timestamp)
        : [];
      _viewYearCache.set(year, valid);
      return valid;
    })
    .catch(() => {
      _viewYearCache.set(year, []);
      return [];
    })
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
 * For longer bounded ranges, fetches only the years needed for that viewport.
 * For "All", async-fetches year files back to 1968.
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
    // Short range — try in-memory spotHistory first
    const liveEntries = (typeof spotHistory !== "undefined" ? spotHistory : [])
      .filter((e) => e.metal === metalName)
      .map((e) => ({ ts: new Date(e.timestamp).getTime(), spot: e.spot }));
    liveEntries.sort((a, b) => a.ts - b.ts);
    const byDay = new Map();
    for (const e of liveEntries) byDay.set(new Date(e.ts).toISOString().slice(0, 10), e);
    const result = [...byDay.values()].sort((a, b) => a.ts - b.ts);
    const cutoff = _getViewChartRangeCutoff(days);
    const inRange = result.filter((e) => e.ts >= cutoff);
    if (inRange.length >= 2) return result;
    // Sparse in-memory data — fall back to current year file
    startYear = new Date(cutoff).getFullYear();
  } else if (days > 180) {
    const cutoff = _getViewChartRangeCutoff(days);
    startYear = new Date(cutoff).getFullYear();
  } else {
    // "All" — go back to 1968 (earliest seed data)
    startYear = 1968;
  }

  const endYear = Math.max(startYear, new Date(toTs > 0 ? toTs : Date.now()).getFullYear());
  const years = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);

  // Fetch all needed year files in parallel
  const yearArrays = await Promise.all(years.map(_fetchYearFile));
  const allHistorical = yearArrays.flat();

  // Merge historical + live spotHistory
  const live = typeof spotHistory !== "undefined" ? spotHistory : [];
  const combined = [...allHistorical, ...live]
    .filter((e) => e.metal === metalName)
    .map((e) => ({ ts: new Date(e.timestamp).getTime(), spot: e.spot }));

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
 * @param {number} purchasePerUnit - Original total purchase price for the viewed item quantity
 * @param {number} meltFactor - weightOz * qty * purity (melt = spot * meltFactor)
 * @param {number} [days=0] - Number of days to show (0 = all)
 * @param {number} [purchaseDate=0] - Purchase date timestamp (anchor start for retail line)
 * @param {number} [currentRetail=0] - Current total market/retail value (anchor end for retail line)
 * @param {number} [fromTs=0] - Custom range start timestamp (0 = unbounded)
 * @param {number} [toTs=0] - Custom range end timestamp (0 = unbounded)
 */
function _createPriceHistoryChart(
  canvas,
  allSpotEntries,
  allRetailEntries,
  purchasePerUnit,
  meltFactor,
  days,
  purchaseDate,
  currentRetail,
  fromTs,
  toTs
) {
  if (typeof Chart === "undefined") return;

  // Destroy any previous instance
  if (_viewModalChartInstance) {
    _viewModalChartInstance.destroy();
    _viewModalChartInstance = null;
  }

  fromTs = fromTs || 0;
  toTs = toTs || 0;
  const cutoff = _getViewChartRangeCutoff(days);

  // Filter spot entries by selected range, then optionally prepend a synthetic
  // anchor so "All"/custom/long-bounded ranges extend back to purchase/cutoff.
  const spotEntries = _selectViewChartSpotEntries(allSpotEntries, cutoff, fromTs, toTs);
  const syntheticAnchorTs = _computeViewChartSyntheticAnchor(
    spotEntries,
    days,
    cutoff,
    fromTs,
    toTs,
    purchaseDate
  );
  if (syntheticAnchorTs > 0) {
    spotEntries.unshift({ ts: syntheticAnchorTs, spot: spotEntries[0].spot });
  }

  // Show fallback message if insufficient data for selected range
  const container = canvas.parentElement;
  const existingMsg = container.querySelector(".view-chart-no-data");
  if (existingMsg) existingMsg.remove();
  canvas.style.display = "";

  if (spotEntries.length < 2) {
    canvas.style.display = "none";
    const msg = _el("div", "view-chart-no-data");
    msg.textContent = "Not enough data for this range";
    container.appendChild(msg);
    return;
  }

  // Build labels + melt data + flat purchase reference line from spot entries
  const labels = _buildViewChartLabels(spotEntries);
  const meltData = spotEntries.map((e) => parseFloat((e.spot * meltFactor).toFixed(2)));
  const purchaseLine = spotEntries.map(() => purchasePerUnit);

  // Build retail data series: anchored from purchase date to present with sparse midpoints
  const { retailData, hasRetail } = _buildViewChartRetailData(
    spotEntries,
    allRetailEntries,
    currentRetail,
    purchaseDate,
    cutoff,
    fromTs,
    toTs
  );

  const showPoints = spotEntries.length <= 30;

  const textColor =
    typeof getChartTextColor === "function"
      ? getChartTextColor()
      : getThemeColorRGB("text-primary");
  const bgColor =
    typeof getChartBackgroundColor === "function"
      ? getChartBackgroundColor()
      : getThemeColorRGB("bg-primary");

  const datasets = _buildViewChartDatasets({
    purchaseLine,
    meltData,
    retailData,
    showPoints,
    hasRetail,
  });

  _viewModalChartInstance = createTimeSeriesChart(canvas, labels, datasets, {
    animation: false,
    showLegend: true,
    xTicks: {
      color: textColor,
      maxTicksLimit: 6,
      autoSkip: true,
      font: { size: 10 },
    },
    yTicks: {
      color: textColor,
      font: { size: 10 },
      callback: function (value) {
        return typeof formatCurrency === "function" ? formatCurrency(value) : "$" + value;
      },
    },
    tooltipCallbacks: {
      label: function (ctx) {
        if (ctx.parsed.y === null) return null;
        const val =
          typeof formatCurrency === "function" ? formatCurrency(ctx.parsed.y) : "$" + ctx.parsed.y;
        return `${ctx.dataset.label}: ${val}`;
      },
    },
  });

  // Apply chart-specific overrides not covered by createTimeSeriesChart
  if (_viewModalChartInstance) {
    _applyViewChartOverrides(_viewModalChartInstance, textColor, bgColor);
    _applyPriceHistoryYAxisBounds(_viewModalChartInstance);
    _viewModalChartInstance.update("none");
  }
}

/**
 * Filter spot entries to the selected chart range.
 * In custom-range mode (fromTs/toTs > 0) it keeps entries within the bounds;
 * otherwise it applies the day-count cutoff (0 = all).
 *
 * @param {Array<{ts:number, spot:number}>} allSpotEntries - Daily spot prices
 * @param {number} cutoff - Day-count cutoff timestamp (<=0 = no cutoff)
 * @param {number} fromTs - Custom range start (0 = unbounded)
 * @param {number} toTs - Custom range end (0 = unbounded)
 * @returns {Array<{ts:number, spot:number}>} New filtered array
 */
function _selectViewChartSpotEntries(allSpotEntries, cutoff, fromTs, toTs) {
  if (fromTs > 0 || toTs > 0) {
    return allSpotEntries.filter(
      (e) => (fromTs <= 0 || e.ts >= fromTs) && (toTs <= 0 || e.ts <= toTs)
    );
  }
  return cutoff > 0 ? allSpotEntries.filter((e) => e.ts >= cutoff) : [...allSpotEntries];
}

/**
 * Compute the synthetic left-edge anchor timestamp for the chart, or 0 if none.
 * If "All"/custom range and the purchase date precedes the earliest spot data,
 * anchor to purchase date. Long bounded ranges (>180d) keep their sparse-data
 * viewport anchor at the cutoff; short ranges show only actual days so a 7d
 * chart cannot invent an extra left-edge point.
 *
 * @param {Array<{ts:number, spot:number}>} spotEntries - Filtered spot entries
 * @param {number} days - Day-count range (0 = all)
 * @param {number} cutoff - Day-count cutoff timestamp
 * @param {number} fromTs - Custom range start (0 = unbounded)
 * @param {number} toTs - Custom range end (0 = unbounded)
 * @param {number} purchaseDate - Purchase date timestamp
 * @returns {number} Anchor timestamp, or 0 when no synthetic anchor is needed
 */
function _computeViewChartSyntheticAnchor(spotEntries, days, cutoff, fromTs, toTs, purchaseDate) {
  const isAllOrCustom = days === 0 || fromTs > 0 || toTs > 0;
  const boundedAnchorTs =
    !isAllOrCustom &&
    days > 180 &&
    cutoff > 0 &&
    spotEntries.length > 0 &&
    spotEntries[0].ts > cutoff
      ? cutoff
      : 0;
  const purchaseAnchorTs =
    isAllOrCustom && purchaseDate > 0 && spotEntries.length > 0 && purchaseDate < spotEntries[0].ts
      ? purchaseDate
      : 0;
  return boundedAnchorTs || purchaseAnchorTs;
}

/**
 * Build adaptive x-axis labels from spot entries.
 * Formatting adapts to the spanned year range: decade spans → compact
 * "month '24", multi-year → two-line [month day, year], single year →
 * month + day.
 *
 * @param {Array<{ts:number, spot:number}>} spotEntries - Filtered spot entries
 * @returns {Array<string|string[]>} Chart.js x-axis labels
 */
function _buildViewChartLabels(spotEntries) {
  const firstYear = new Date(spotEntries[0].ts).getFullYear();
  const lastYear = new Date(spotEntries[spotEntries.length - 1].ts).getFullYear();
  const yearSpan = lastYear - firstYear;
  return spotEntries.map((e) => {
    const d = new Date(e.ts);
    if (yearSpan > 10) {
      // Decade+ ranges: compact "Jan '24" or just "'24"
      return d.toLocaleDateString(undefined, { year: "2-digit", month: "short" });
    }
    if (yearSpan >= 1) {
      // 1–10 year ranges: two-line label [month day, year]
      return [
        d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        String(d.getFullYear()),
      ];
    }
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  });
}

/**
 * Find the index of the spot entry whose timestamp is nearest to `ts`.
 *
 * @param {Array<{ts:number}>} spotEntries - Filtered spot entries (non-empty)
 * @param {number} ts - Target timestamp
 * @returns {number} Index of the nearest entry
 */
function _nearestViewChartSpotIdx(spotEntries, ts) {
  let best = 0;
  let bestDist = Math.abs(spotEntries[0].ts - ts);
  for (let i = 1; i < spotEntries.length; i++) {
    const dist = Math.abs(spotEntries[i].ts - ts);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Resolve the leading (left-edge) retail value when the first in-range retail
 * snapshot is not at index 0. Prefers the most recent prior out-of-range
 * snapshot; otherwise falls back to current retail when the purchase date is
 * within range.
 *
 * @param {Array<*>} retailData - Retail series being built (mutated by caller)
 * @param {Array<{ts:number, retail:number}>} allRetailEntries - All snapshots
 * @param {number} firstSpotTs - Timestamp of the first spot entry
 * @param {number} purchaseDate - Purchase date timestamp
 * @param {number} currentRetail - Current total market/retail value
 * @returns {number|null} Leading retail value, or null when none applies
 */
function _resolveViewChartLeadingRetail(
  retailData,
  allRetailEntries,
  firstSpotTs,
  purchaseDate,
  currentRetail
) {
  const previousRetail = [...allRetailEntries]
    .filter((entry) => Number(entry.retail) > 0 && entry.ts < firstSpotTs)
    .sort((a, b) => a.ts - b.ts)
    .at(-1);
  if (previousRetail) {
    return previousRetail.retail;
  }
  if (purchaseDate >= firstSpotTs && currentRetail > 0) {
    return currentRetail;
  }
  return null;
}

/**
 * Build the retail value series anchored from purchase date to present, with
 * sparse itemPriceHistory snapshots in between. Uses index-based snapping to
 * the nearest spot entry since anchor dates may lack an exact-match spot day.
 *
 * @param {Array<{ts:number, spot:number}>} spotEntries - Filtered spot entries
 * @param {Array<{ts:number, retail:number}>} allRetailEntries - Snapshots
 * @param {number} currentRetail - Current total market/retail value (end anchor)
 * @param {number} purchaseDate - Purchase date timestamp
 * @param {number} cutoff - Day-count cutoff timestamp
 * @param {number} fromTs - Custom range start (0 = unbounded)
 * @param {number} toTs - Custom range end (0 = unbounded)
 * @returns {{retailData: Array<number|null>, hasRetail: boolean}} Series + flag
 */
function _buildViewChartRetailData(
  spotEntries,
  allRetailEntries,
  currentRetail,
  purchaseDate,
  cutoff,
  fromTs,
  toTs
) {
  const retailData = new Array(spotEntries.length).fill(null);
  const hasRetailSeries =
    currentRetail > 0 || allRetailEntries.some((entry) => Number(entry.retail) > 0);

  // Middle: sparse itemPriceHistory retail values snapped to nearest spot day
  for (const re of allRetailEntries) {
    if (cutoff > 0 && re.ts < cutoff) continue;
    if (fromTs > 0 && re.ts < fromTs) continue;
    if (toTs > 0 && re.ts > toTs) continue;
    const idx = _nearestViewChartSpotIdx(spotEntries, re.ts);
    retailData[idx] = re.retail;
  }

  // Anchor end: current market value on the last spot entry (≈ today)
  if (currentRetail > 0) {
    retailData[spotEntries.length - 1] = currentRetail;
  }

  if (hasRetailSeries) {
    const firstRetailIdx = retailData.findIndex((value) => value !== null);
    const firstSpotTs = spotEntries[0].ts;
    if (firstRetailIdx > 0) {
      const leadingRetail = _resolveViewChartLeadingRetail(
        retailData,
        allRetailEntries,
        firstSpotTs,
        purchaseDate,
        currentRetail
      );
      if (leadingRetail !== null) {
        retailData[0] = leadingRetail;
      }
    } else if (firstRetailIdx === -1 && currentRetail > 0) {
      retailData[0] = currentRetail;
      retailData[spotEntries.length - 1] = currentRetail;
    }
  }

  const hasRetail = hasRetailSeries && retailData.some((v) => v !== null);
  return { retailData, hasRetail };
}

/**
 * Build the three Chart.js datasets (purchase reference line, melt value,
 * retail value) for the price-history chart.
 *
 * @param {Object} args
 * @param {Array<number>} args.purchaseLine - Flat purchase-price series
 * @param {Array<number>} args.meltData - Melt-value series
 * @param {Array<number|null>} args.retailData - Retail-value series
 * @param {boolean} args.showPoints - Whether to render point markers
 * @param {boolean} args.hasRetail - Whether the retail dataset has data
 * @returns {Array<Object>} Chart.js dataset configs
 */
function _buildViewChartDatasets({ purchaseLine, meltData, retailData, showPoints, hasRetail }) {
  const dangerColor = getThemeColorRGB("danger");
  const successColor = getThemeColorRGB("success");
  const primaryColor = getThemeColorRGB("primary");
  return [
    {
      label: "Purchase Price",
      data: purchaseLine,
      borderColor: dangerColor,
      backgroundColor: "transparent",
      fill: false,
      borderDash: [6, 3],
      tension: 0,
      pointRadius: 0,
      pointHoverRadius: 0,
      borderWidth: 1.5,
      order: 0,
    },
    {
      label: "Melt Value",
      data: meltData,
      borderColor: successColor,
      backgroundColor: resolveColor(`color-mix(in srgb, ${successColor} 12%, transparent)`),
      fill: "origin",
      tension: 0.3,
      pointRadius: showPoints ? 3 : 0,
      pointHoverRadius: 5,
      borderWidth: 2,
      order: 2,
    },
    {
      label: "Retail Value",
      data: retailData,
      borderColor: primaryColor,
      backgroundColor: "transparent",
      fill: false,
      tension: 0.3,
      spanGaps: true,
      pointRadius: showPoints ? 3 : 0,
      pointHoverRadius: showPoints ? 5 : 3,
      borderWidth: 2,
      hidden: !hasRetail,
      order: 1,
    },
  ];
}

/**
 * Apply price-history chart overrides not covered by createTimeSeriesChart:
 * axis grid styling, bottom legend with y-axis-bounds recompute on toggle, and
 * themed tooltip colors.
 *
 * @param {Chart} chart - The created Chart.js instance
 * @param {string} textColor - Resolved theme text color
 * @param {string} bgColor - Resolved theme background color
 * @returns {void}
 */
function _applyViewChartOverrides(chart, textColor, bgColor) {
  const chartOpts = chart.options;
  chartOpts.scales.x.grid = { display: false };
  chartOpts.scales.y.grid = {
    color: resolveColor(`color-mix(in srgb, ${getThemeColorRGB("border")} 40%, transparent)`),
  };
  Object.assign(chartOpts.plugins.legend, {
    position: "bottom",
    labels: {
      color: textColor,
      usePointStyle: true,
      pointStyle: "line",
      padding: 12,
      font: { size: 10 },
    },
    onClick: function (event, legendItem, legend) {
      Chart.defaults.plugins.legend.onClick?.call(this, event, legendItem, legend);
      _applyPriceHistoryYAxisBounds(legend.chart);
      legend.chart.update();
    },
  });
  Object.assign(chartOpts.plugins.tooltip, {
    backgroundColor: bgColor,
    titleColor: textColor,
    bodyColor: textColor,
    borderColor: textColor,
    borderWidth: 1,
  });
}

function _applyPriceHistoryYAxisBounds(chart) {
  if (!chart?.options?.scales?.y) return;
  let dataMin = Infinity;
  let dataMax = -Infinity;
  let hasVisibleValue = false;
  chart.data.datasets.forEach((dataset, index) => {
    const isVisible =
      typeof chart.isDatasetVisible === "function"
        ? chart.isDatasetVisible(index)
        : dataset.hidden !== true;
    if (!isVisible || !Array.isArray(dataset.data)) return;
    dataset.data.forEach((point) => {
      if (point === null || point === undefined) return;
      const rawValue = point && typeof point === "object" && "y" in point ? point.y : point;
      if (rawValue === null || rawValue === undefined) return;
      const value = Number(rawValue);
      if (!Number.isFinite(value)) return;
      if (value < dataMin) dataMin = value;
      if (value > dataMax) dataMax = value;
      hasVisibleValue = true;
    });
  });

  const yScale = chart.options.scales.y;
  if (!hasVisibleValue) {
    delete yScale.min;
    delete yScale.max;
    delete yScale.suggestedMin;
    delete yScale.suggestedMax;
    return;
  }

  const dataRange = dataMax - dataMin;
  const padding = dataRange > 0 ? dataRange * 0.05 : Math.max(dataMax * 0.05, 1);
  const yMin = Math.max(0, dataMin - padding);
  const yMax = dataMax + padding;

  yScale.min = yMin;
  yScale.max = yMax;
  yScale.suggestedMin = yMin;
  yScale.suggestedMax = yMax;
}

// ---------------------------------------------------------------------------
// DOM helpers (private)
// ---------------------------------------------------------------------------

function _svgIcon(paths, size) {
  const sz = size || 12;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", String(sz));
  svg.setAttribute("height", String(sz));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  paths.forEach((d) => {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  });
  return svg;
}

function _setEditBtnContent(btn, label) {
  btn.textContent = "";
  btn.appendChild(
    _svgIcon([
      "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",
      "M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
    ])
  );
  const span = document.createElement("span");
  span.textContent = label;
  btn.appendChild(span);
}

function _setUnlinkBtnContent(btn) {
  btn.textContent = "";
  btn.appendChild(_svgIcon(["M18 6L6 18", "M6 6l12 12"]));
  btn.appendChild(document.createTextNode(" Unlink from Trade"));
}

/** Create element with className */
function _el(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

/** Create a data section with title */
function _section(title) {
  const section = _el("div", "view-detail-section");
  const h = _el("div", "view-section-title");
  h.textContent = title;
  section.appendChild(h);
  return section;
}

/** Create a label/value detail item element */
function _detailItem(label, value, extraClass) {
  const item = _el("div", "view-detail-item");
  const lbl = _el("span", "view-detail-label");
  lbl.textContent = label;
  const val = _el("span", "view-detail-value" + (extraClass ? " " + extraClass : ""));
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
  const slot = _el("div", "view-image-slot");
  slot.dataset.side = side;

  const ph = _el("div", "view-image-placeholder");
  ph.textContent = "\uD83E\uDE99"; // coin emoji
  slot.appendChild(ph);

  const lbl = _el("span", "view-image-label");
  lbl.textContent = label;
  slot.appendChild(lbl);

  return slot;
}

function _applyViewSlotFrame(slot, item, side) {
  if (!slot) return;
  const isRect =
    typeof resolveImageFrame === "function" && resolveImageFrame(item, side) === "rect";
  slot.classList.toggle("view-shape-rect", isRect);
}

/** Replace placeholder with actual image in a slot */
function _setSlotImage(slot, src) {
  if (!slot || !src) return;

  // If an image already exists, update its src (for override replacement)
  const existing = slot.querySelector("img");
  if (existing) {
    existing.src = src;
    existing.style.display = "";
    return;
  }

  // First time: replace placeholder with new img element
  const ph = slot.querySelector(".view-image-placeholder");
  if (!ph) return;

  const img = document.createElement("img");
  img.src = src;
  img.alt = slot.dataset.side || "Coin";
  // Only use lazy loading for network URLs — blob URLs are already in memory
  // and lazy loading can prevent display in modals that just became visible
  if (!src.startsWith("blob:")) img.loading = "lazy";
  img.onerror = () => {
    img.style.display = "none";
  };
  ph.replaceWith(img);
}

// ---------------------------------------------------------------------------
// Global exposure
// ---------------------------------------------------------------------------

// ESC key handler
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modal = document.getElementById("viewItemModal");
    if (modal && modal.style.display !== "none") {
      closeViewModal();
    }
  }
});

if (typeof window !== "undefined") {
  window.showViewModal = showViewModal;
  window.closeViewModal = closeViewModal;
}

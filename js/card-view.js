// CARD VIEW RENDERING ENGINE (STAK-118)
// =============================================================================

/**
 * Returns the active card style from localStorage.
 * @returns {'A'|'B'|'C'|'D'}
 */
const getCardStyle = () => localStorage.getItem(CARD_STYLE_KEY) || "D";

/**
 * Returns true when the card view (A/B/C) should be rendered instead of the table.
 * Style D = table view. When D is selected, returns false so inventory.js renders the table.
 * @returns {boolean}
 */
function isCardViewActive() {
  return getCardStyle() !== "D";
}

/**
 * Computes portfolio summary totals for currently filtered items.
 * @returns {{ purchase: number, melt: number, retail: number, gainLoss: number, filteredCount: number, totalCount: number, totalWeight: number }}
 */
function _computePortfolioSummary() {
  const items = typeof filterInventory === "function" ? filterInventory() : inventory || [];
  // Total pieces across ALL inventory (sum of qty, matches metal card "Items" count)
  const allItems = typeof inventory !== "undefined" && Array.isArray(inventory) ? inventory : items;
  const totalPieces = allItems.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  let purchase = 0,
    melt = 0,
    retail = 0,
    totalWeight = 0,
    filteredPieces = 0;
  const gbToOzt = typeof GB_TO_OZT !== "undefined" ? GB_TO_OZT : 0.001;
  const sbToOzt = typeof SB_TO_OZT !== "undefined" ? SB_TO_OZT : gbToOzt;
  items.forEach((item) => {
    const qty = Number(item.qty) || 0;
    filteredPieces += qty;
    const spot =
      (typeof spotPrices !== "undefined" ? spotPrices[(item.metal || "").toLowerCase()] : 0) || 0;
    const valuation =
      typeof computeItemValuation === "function"
        ? computeItemValuation(item, spot)
        : {
            meltValue: typeof computeMeltValue === "function" ? computeMeltValue(item, spot) : 0,
            purchaseTotal:
              (typeof item.price === "number" ? item.price : parseFloat(item.price) || 0) * qty,
            retailTotal: (() => {
              const gbPrice =
                typeof getGoldbackRetailPrice === "function" ? getGoldbackRetailPrice(item) : null;
              const mktVal = parseFloat(item.marketValue) || 0;
              return gbPrice
                ? gbPrice * qty
                : mktVal > 0
                  ? mktVal * qty
                  : typeof computeMeltValue === "function"
                    ? computeMeltValue(item, spot)
                    : 0;
            })(),
          };
    purchase += valuation.purchaseTotal || 0;
    melt += valuation.meltValue || 0;
    retail += valuation.retailTotal || 0;
    // STRK-235: constitutional silver oz is pre-derived (includes qty + wear factor,
    // already pure). Do NOT multiply by qty or purity again.
    if (item.weightUnit === "cu") {
      totalWeight +=
        typeof getConstitutionalSilverOz === "function" ? getConstitutionalSilverOz(item) : 0;
    } else {
      const w = parseFloat(item.weight) || 0;
      const wOz =
        item.weightUnit === "gb" ? w * gbToOzt : item.weightUnit === "sb" ? w * sbToOzt : w;
      totalWeight += qty * wOz;
    }
  });
  return {
    purchase,
    melt,
    retail,
    gainLoss: retail - purchase,
    filteredCount: filteredPieces,
    totalCount: totalPieces,
    totalWeight,
  };
}

/**
 * Ensures the sort bar is always visible and syncs controls to the active view style.
 * Called after every renderTable() — works around inventory.js hiding the bar in table mode.
 */
function _syncSortBar() {
  const style = getCardStyle();
  const bar = document.getElementById("cardSortBar");
  if (!bar) return;

  // Always show the bar
  bar.style.display = "flex";

  const sortLeft = bar.querySelector(".card-sort-left");
  if (sortLeft) sortLeft.style.visibility = "";

  // Sync style toggle active state
  const styleToggle = document.getElementById("cardStyleToggle");
  if (styleToggle) {
    styleToggle.querySelectorAll(".chip-sort-btn[data-style]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.style === style);
    });
  }

  // Update summary
  _renderSortBarSummary();

  // Body class for CSS hooks
  document.body.classList.toggle("view-mode-d", style === "D");

  // Set table min-width directly (inline style beats any CSS specificity issue).
  // 1200px forces the table wider than typical tablet/mobile viewports so .portal-scroll scrolls.
  // At desktop (>1200px) width:100% naturally fills the container — no forced overflow there.
  const table = document.getElementById("inventoryTable");
  if (table) table.style.minWidth = style === "D" ? "1200px" : "";

  // Custom horizontal scrollbar (show in D mode, hide in card modes)
  _syncHScrollBar(style === "D");
}

// ---------------------------------------------------------------------------
// Custom horizontal scrollbar for D (table) mode
// ---------------------------------------------------------------------------

/** Whether the custom H-scroll bar event listeners have been wired */
let _hScrollWired = false;

/**
 * Creates the scrollbar DOM node (once) and inserts it after .portal-scroll.
 * @returns {{ track: HTMLElement, thumb: HTMLElement }|null}
 */
function _getOrCreateHScrollBar() {
  let track = document.getElementById("tableHScrollTrack");
  if (track) return { track, thumb: document.getElementById("tableHScrollThumb") };

  const portal = document.querySelector(".portal-scroll");
  if (!portal) return null;

  track = document.createElement("div");
  track.id = "tableHScrollTrack";
  track.className = "h-scroll-track";
  track.setAttribute("aria-hidden", "true");

  const thumb = document.createElement("div");
  thumb.id = "tableHScrollThumb";
  thumb.className = "h-scroll-thumb";
  track.appendChild(thumb);

  // Insert immediately after the portal-scroll container
  portal.parentNode.insertBefore(track, portal.nextSibling);
  return { track, thumb };
}

/**
 * Recalculates thumb size and position from portal scroll state.
 */
function _updateHScrollThumb() {
  const track = document.getElementById("tableHScrollTrack");
  const thumb = document.getElementById("tableHScrollThumb");
  const portal = document.querySelector(".portal-scroll");
  const table = document.getElementById("inventoryTable");
  if (!track || !thumb || !portal || !table) return;

  const scrollWidth = table.scrollWidth;
  const clientWidth = portal.clientWidth;

  // Hide the bar if content fits (no scroll needed)
  if (scrollWidth <= clientWidth + 2) {
    track.hidden = true;
    return;
  }
  track.hidden = false;

  const trackWidth = track.clientWidth || track.offsetWidth;
  const thumbWidth = Math.max(44, (clientWidth / scrollWidth) * trackWidth);
  const maxLeft = trackWidth - thumbWidth;
  const scrollPct = portal.scrollLeft / (scrollWidth - clientWidth);

  thumb.style.width = thumbWidth + "px";
  thumb.style.transform = `translateX(${scrollPct * maxLeft}px)`;
}

/**
 * Shows or hides the custom H-scroll bar and wires events (once).
 * @param {boolean} show
 */
function _syncHScrollBar(show) {
  const result = _getOrCreateHScrollBar();
  if (!result) return;
  const { track, thumb } = result;

  // Constrain table-section so it can't inflate beyond its parent container.
  // Without this, table-section expands to match the table's min-width (1200px),
  // making portal.clientWidth === table.scrollWidth → no perceived overflow → scrollbar hidden.
  // overflow-x:hidden creates a BFC that locks the element to its parent's width.
  const tableSection = document.getElementById("tableSectionEl");
  if (tableSection) {
    tableSection.style.overflowX = show ? "hidden" : "";
  }

  // Switch portal-scroll to always-show scroll mode so iOS creates a real scroll container
  const portal = document.querySelector(".portal-scroll");
  if (portal) {
    portal.style.overflowX = show ? "scroll" : "";
    portal.style.maxWidth = show ? "100%" : "";
  }

  if (!show) {
    track.hidden = true;
    return;
  }

  _updateHScrollThumb();

  // Wire all events only once
  if (_hScrollWired) return;
  _hScrollWired = true;

  // Sync native scroll → thumb position
  if (portal) {
    portal.addEventListener("scroll", _updateHScrollThumb, { passive: true });
  }
  window.addEventListener("resize", _updateHScrollThumb, { passive: true });

  // ── Drag logic ──────────────────────────────────────────────────────────
  let dragging = false;
  let dragStartX = 0;
  let dragStartScrollLeft = 0;

  function clientX(e) {
    return e.touches && e.touches.length ? e.touches[0].clientX : e.clientX;
  }

  function onDragStart(e) {
    if (!portal) return;
    dragging = true;
    dragStartX = clientX(e);
    dragStartScrollLeft = portal.scrollLeft;
    thumb.style.cursor = "grabbing";
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!dragging || !portal) return;
    const table = document.getElementById("inventoryTable");
    if (!table) return;
    const dx = clientX(e) - dragStartX;
    const trackWidth = track.clientWidth || track.offsetWidth;
    const thumbWidth = thumb.offsetWidth;
    const maxLeft = trackWidth - thumbWidth;
    const maxScroll = table.scrollWidth - portal.clientWidth;
    if (maxLeft <= 0) return;
    portal.scrollLeft = dragStartScrollLeft + (dx / maxLeft) * maxScroll;
    _updateHScrollThumb();
    e.preventDefault();
  }

  function onDragEnd() {
    dragging = false;
    thumb.style.cursor = "";
  }

  thumb.addEventListener("mousedown", onDragStart);
  thumb.addEventListener("touchstart", onDragStart, { passive: false });
  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("touchmove", onDragMove, { passive: false });
  document.addEventListener("mouseup", onDragEnd);
  document.addEventListener("touchend", onDragEnd);

  // Click-on-track to jump scroll position
  track.addEventListener("click", (e) => {
    if (!portal || e.target === thumb) return;
    const table = document.getElementById("inventoryTable");
    if (!table) return;
    const rect = track.getBoundingClientRect();
    const clickFrac = (clientX(e) - rect.left) / rect.width;
    portal.scrollLeft = clickFrac * (table.scrollWidth - portal.clientWidth);
    _updateHScrollThumb();
  });
}

/**
 * Renders the portfolio summary strip in the sort bar.
 */
function _renderSortBarSummary() {
  const el = document.getElementById("cardSortSummary");
  if (!el) return;
  const fmt = typeof formatCurrency === "function" ? formatCurrency : (v) => "$" + v.toFixed(2);
  const s = _computePortfolioSummary();
  const gl = s.gainLoss;
  const glClass = gl >= 0 ? "summary-positive" : "summary-negative";
  const glSign = gl >= 0 ? "+" : "";
  const itemsText =
    s.filteredCount === s.totalCount ? `${s.totalCount}` : `${s.filteredCount}/${s.totalCount}`;
  const weightText = `${s.totalWeight.toFixed(1)}oz`;
  el.innerHTML =
    `<span class="summary-item"><span class="summary-label">Items</span><span class="summary-val">${itemsText}</span></span>` +
    `<span class="summary-sep">·</span>` +
    `<span class="summary-item"><span class="summary-label">Weight</span><span class="summary-val">${weightText}</span></span>` +
    `<span class="summary-sep">·</span>` +
    `<span class="summary-item"><span class="summary-label">Buy</span><span class="summary-val">${fmt(s.purchase)}</span></span>` +
    `<span class="summary-sep">·</span>` +
    `<span class="summary-item"><span class="summary-label">Melt</span><span class="summary-val">${fmt(s.melt)}</span></span>` +
    `<span class="summary-sep">·</span>` +
    `<span class="summary-item"><span class="summary-label">Market</span><span class="summary-val">${fmt(s.retail)}</span></span>` +
    `<span class="summary-sep">·</span>` +
    `<span class="summary-item ${glClass}"><span class="summary-label">G/L</span><span class="summary-val">${glSign}${fmt(gl)}</span></span>`;
}

// ---------------------------------------------------------------------------
// SVG Sparkline helpers
// ---------------------------------------------------------------------------

/**
 * Converts an array of numeric values to SVG polyline coordinate string.
 * @param {number[]} data - Data points
 * @param {number} w - SVG viewBox width
 * @param {number} h - SVG viewBox height
 * @param {number} [padY=4] - Vertical padding
 * @returns {string} Space-separated "x,y" pairs
 */
const dataToPolyline = (data, w, h, padY = 4) => {
  if (data.length === 0) return "";
  if (data.length === 1) return `0,${(h / 2).toFixed(1)}`;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  return data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = padY + ((max - v) / range) * (h - padY * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
};

/**
 * Generates a "since purchased" 3-line sparkline SVG matching the view modal pattern.
 * Red dashed = purchase price (flat), Green = melt value over time, Blue = retail/market value.
 * Uses real spot history with timestamps when available.
 * @param {object} item - Inventory item
 * @param {number} w - SVG viewBox width
 * @param {number} h - SVG viewBox height
 * @param {object} [opts] - Options
 * @param {number} [opts.opacity=1] - SVG opacity
 * @param {number} [opts.points=60] - Number of data points
 * @returns {string} SVG markup string
 */
const generateSparklineSVG = (item, w, h, opts = {}) => {
  const opacity = opts.opacity || 1;
  const points = opts.points || 60;
  const metal = (item.metal || "").toLowerCase();
  const weightOz = parseFloat(item.weight) || 1;
  const qty = Number(item.qty) || 1;
  const purity = parseFloat(item.purity) || 1;
  // STRK-235: for constitutional ("cu") items the derived total silver oz already
  // incorporates qty and wear factor and is pure — use it directly as meltFactor.
  // Multiplying again by qty or purity would double-count both.
  const meltFactor =
    item.weightUnit === "cu" && typeof getConstitutionalSilverOz === "function"
      ? getConstitutionalSilverOz(item)
      : weightOz * qty * purity;
  const purchasePerUnit = parseFloat(item.price) || 0;
  const purchaseTotal = purchasePerUnit * qty;
  const currentRetail = (parseFloat(item.marketValue) || 0) * qty;

  // Try real spot history with timestamps
  let spotEntries;
  if (typeof getSpotHistoryForMetal === "function") {
    spotEntries = getSpotHistoryForMetal(metal, points, true);
  }

  let meltData, purchaseData, retailData;

  if (spotEntries && spotEntries.length >= 2) {
    // Prepend synthetic entry at purchase date if before earliest spot
    const purchaseDate = item.date ? new Date(item.date).getTime() : 0;
    if (purchaseDate > 0 && purchaseDate < spotEntries[0].ts) {
      spotEntries.unshift({ ts: purchaseDate, spot: spotEntries[0].spot });
    }

    // Melt line: spot * meltFactor over time (green)
    meltData = spotEntries.map((e) => e.spot * meltFactor);

    // Purchase line: flat reference (red dashed)
    purchaseData = spotEntries.map(() => purchaseTotal || 1);

    // Retail line: anchored sparse line (blue) — purchase at start, current at end
    // with itemPriceHistory midpoints if available
    retailData = new Array(spotEntries.length).fill(null);

    // Anchor start: purchase price
    if (purchaseTotal > 0) retailData[0] = purchaseTotal;

    // Middle: sparse retail snapshots from itemPriceHistory
    if (typeof itemPriceHistory !== "undefined" && item.uuid) {
      const history = itemPriceHistory[item.uuid] || [];
      for (const re of history) {
        if (re.retail > 0) {
          // Find nearest spot entry index
          let best = 0,
            bestDist = Math.abs(spotEntries[0].ts - re.ts);
          for (let i = 1; i < spotEntries.length; i++) {
            const dist = Math.abs(spotEntries[i].ts - re.ts);
            if (dist < bestDist) {
              best = i;
              bestDist = dist;
            }
          }
          retailData[best] = re.retail * qty;
        }
      }
    }

    // Anchor end: current retail/market value
    if (currentRetail > 0) {
      retailData[spotEntries.length - 1] = currentRetail;
    }

    // Interpolate nulls for SVG polyline (spanGaps equivalent)
    retailData = _interpolateNulls(retailData);
  } else {
    // No history — flat lines as fallback
    const currentSpot = (typeof spotPrices !== "undefined" && spotPrices[metal]) || 0;
    const meltVal = currentSpot * meltFactor;
    meltData = Array(points).fill(meltVal || 1);
    purchaseData = Array(points).fill(purchaseTotal || 1);
    const retailVal = currentRetail > 0 ? currentRetail : meltVal;
    retailData = Array(points).fill(retailVal || 1);
  }

  // Use shared scale across all 3 lines so they're comparable
  const allVals = [...meltData, ...purchaseData, ...retailData];
  const globalMin = Math.min(...allVals);
  const globalMax = Math.max(...allVals);

  const meltLine = _dataToPolylineScaled(meltData, w, h, globalMin, globalMax);
  const purchaseLine = _dataToPolylineScaled(purchaseData, w, h, globalMin, globalMax);
  const retailLine = _dataToPolylineScaled(retailData, w, h, globalMin, globalMax);

  const uid = (item.uuid || item.name || "").replace(/[^a-z0-9]/gi, "").slice(0, 20);
  const meltGradId = `meltFill-${uid}`;
  const purchGradId = `purchFill-${uid}`;
  const meltFillPoints = `${meltLine} ${w},${h} 0,${h}`;
  const purchFillPoints = `${purchaseLine} ${w},${h} 0,${h}`;

  // Theme-aware — bold strokes and fills on light/sepia backgrounds
  const _lt = typeof isDarkTheme === "function" ? !isDarkTheme() : false;
  const _meltStroke = getThemeColor("success");
  const _purchStroke = getThemeColor("danger");
  const _retailStroke = getThemeColor("primary");
  const _meltFillOp = _lt ? "0.70" : "0.18";
  const _purchFillOp = _lt ? "0.50" : "0.08";
  const _sw = _lt ? "3.5" : "1.5";
  const _purchOp = _lt ? "1" : "0.85";

  return (
    `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="opacity:${opacity}">` +
    `<defs>` +
    `<linearGradient id="${meltGradId}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${_meltStroke}" stop-opacity="${_meltFillOp}"/>` +
    `<stop offset="100%" stop-color="${_meltStroke}" stop-opacity="0"/>` +
    `</linearGradient>` +
    `<linearGradient id="${purchGradId}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${_purchStroke}" stop-opacity="${_purchFillOp}"/>` +
    `<stop offset="100%" stop-color="${_purchStroke}" stop-opacity="0"/>` +
    `</linearGradient>` +
    `</defs>` +
    `<polygon points="${purchFillPoints}" fill="url(#${purchGradId})"/>` +
    `<polygon points="${meltFillPoints}" fill="url(#${meltGradId})"/>` +
    `<polyline points="${meltLine}" fill="none" stroke="${_meltStroke}" stroke-width="${_sw}" stroke-linecap="round"/>` +
    `<polyline points="${purchaseLine}" fill="none" stroke="${_purchStroke}" stroke-width="${_sw}" stroke-dasharray="4,3" opacity="${_purchOp}"/>` +
    `<polyline points="${retailLine}" fill="none" stroke="${_retailStroke}" stroke-width="${_sw}" stroke-linecap="round"/>` +
    `</svg>`
  );
};

/**
 * Interpolate null gaps in an array for SVG rendering (equivalent to Chart.js spanGaps).
 * @param {Array.<(number|null)>} arr
 * @returns {Array.<number>}
 */
const _interpolateNulls = (arr) => {
  const result = [...arr];
  // Find first non-null
  let firstIdx = result.findIndex((v) => v !== null);
  if (firstIdx < 0) return result.map(() => 0);

  // Fill leading nulls
  for (let i = 0; i < firstIdx; i++) result[i] = result[firstIdx];

  // Find last non-null and fill trailing
  let lastIdx = result.length - 1;
  while (lastIdx >= 0 && result[lastIdx] === null) lastIdx--;
  for (let i = lastIdx + 1; i < result.length; i++) result[i] = result[lastIdx];

  // Interpolate interior nulls
  for (let i = firstIdx + 1; i < lastIdx; i++) {
    if (result[i] !== null) continue;
    // Find next non-null
    let nextIdx = i + 1;
    while (nextIdx < result.length && result[nextIdx] === null) nextIdx++;
    const prevVal = result[i - 1];
    const nextVal = result[nextIdx];
    const span = nextIdx - (i - 1);
    for (let j = i; j < nextIdx; j++) {
      result[j] = prevVal + (nextVal - prevVal) * ((j - (i - 1)) / span);
    }
  }
  return result;
};

/**
 * Converts data to SVG polyline using a shared min/max scale.
 * @param {number[]} data
 * @param {number} w - SVG width
 * @param {number} h - SVG height
 * @param {number} globalMin
 * @param {number} globalMax
 * @param {number} [padY=4]
 * @returns {string}
 */
const _dataToPolylineScaled = (data, w, h, globalMin, globalMax, padY = 4) => {
  if (data.length === 0) return "";
  if (data.length === 1) {
    const y = padY + ((globalMax - data[0]) / (globalMax - globalMin || 1)) * (h - padY * 2);
    return `0,${y.toFixed(1)}`;
  }
  const range = globalMax - globalMin || 1;
  return data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = padY + ((globalMax - v) / range) * (h - padY * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Returns metal CSS class for card border/accent.
 * @param {string} metal
 * @returns {string}
 */
const _cardMetalClass = (metal) => `metal-${(metal || "silver").toLowerCase()}`;

/**
 * Returns coin image HTML. Renders an <img> with data attributes for async
 * ImageCache resolution (same pattern as table thumbnails in inventory.js).
 * Falls back to a metal-initial placeholder via onerror.
 * @param {object} item
 * @param {string} [extraClass='']
 * @param {string} [side='obverse'] - 'obverse' or 'reverse'
 * @returns {string}
 */
const _cardImageHTML = (item, extraClass = "", side = "obverse") => {
  const isRect =
    typeof resolveImageFrame === "function" && resolveImageFrame(item, side) === "rect";
  const shape = isRect ? " bar-shape" : "";
  const uuid = item.uuid || "";
  const catalogId = item.numistaId || "";
  const metalKey = (item.metal || "").toLowerCase();

  // Initial src from item data (CDN URL) if available
  const urlKey = side === "reverse" ? "reverseImageUrl" : "obverseImageUrl";
  const rawUrl = item[urlKey] || "";
  const directUrl = rawUrl && /^https?:\/\/.+\..+/i.test(rawUrl) ? rawUrl : "";
  const srcAttr = directUrl ? ` src="${_cvEscapeAttr(directUrl)}"` : "";

  const fitStyle = isRect ? "object-fit:contain;" : "object-fit:cover;";

  return (
    `<div class="coin-img${shape}${extraClass}" data-metal="${_cvEscapeAttr(metalKey)}">` +
    `<img class="cv-thumb" data-side="${side}"${srcAttr}` +
    ` data-catalog-id="${_cvEscapeAttr(catalogId)}"` +
    ` data-item-uuid="${_cvEscapeAttr(uuid)}"` +
    ` data-item-name="${_cvEscapeAttr(item.name || "")}"` +
    ` data-item-metal="${_cvEscapeAttr(metalKey)}"` +
    ` data-item-type="${_cvEscapeAttr(item.type || "")}"` +
    ` alt="" loading="lazy" style="${directUrl ? "" : "display:none;"}width:100%;height:100%;${fitStyle}border-radius:inherit;"` +
    ` onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />` +
    `<div class="cv-no-image" style="display:${directUrl ? "none" : "flex"}"></div>` +
    `</div>`
  );
};

/**
 * Escapes HTML attribute values — fallback for card-view context.
 * The main escapeAttribute lives in inventory.js (loaded before this file).
 * @param {string} s
 * @returns {string}
 */
const _cvEscapeAttr = (s) => {
  if (typeof escapeAttribute === "function") return escapeAttribute(s);
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

/**
 * Builds chip HTML for card views.
 * @param {object} item
 * @param {boolean} [small=false]
 * @returns {string}
 */
const _cardChipsHTML = (item, small = false) => {
  const s = small ? ' style="font-size:0.58rem;padding:0.05rem 0.35rem"' : "";
  const type = (item.type || "coin").toLowerCase().replace(/[^a-z0-9-]/g, "");
  let h = `<span class="cv-chip cv-chip-type ${type}"${s}>${sanitizeHtml(type)}</span>`;
  if (item.metal) {
    const metal = item.metal.toLowerCase().replace(/[^a-z0-9-]/g, "");
    h += `<span class="cv-chip cv-chip-metal ${metal}"${s}>${sanitizeHtml(metal)}</span>`;
  }
  if (item.year)
    h += `<span class="cv-chip cv-chip-year"${s}>${sanitizeHtml(String(item.year))}</span>`;
  if (item.grade) h += `<span class="cv-chip cv-chip-grade"${s}>${sanitizeHtml(item.grade)}</span>`;
  const qty = Number(item.qty) || 1;
  if (qty > 1) h += `<span class="cv-chip cv-chip-qty"${s}>x${qty}</span>`;
  // STRK-300: cu chips show the lot's TOTAL face value with the shared `fv` suffix. The 2-arg
  // formatWeight fallback rendered per-coin face ("$0.25 face") — the right figure in the wrong
  // frame, since the card already shows the coin count in its own qty chip.
  const weightChipText =
    item.weightUnit === "cu" && typeof formatConstitutionalFace === "function"
      ? formatConstitutionalFace(item)
      : formatWeight(item.weight, item.weightUnit);
  h += `<span class="cv-chip cv-chip-weight"${s}>${sanitizeHtml(weightChipText)}</span>`;

  const _cardTags = typeof getItemTags === "function" ? getItemTags(item.uuid) : [];
  if (_cardTags.length > 0) {
    const show = _cardTags.slice(0, 2);
    show.forEach((t) => {
      h += `<span class="cv-chip cv-chip-tags"${s} title="${_cvEscapeAttr(t)}">${sanitizeHtml(t)}</span>`;
    });
    if (_cardTags.length > 2) {
      h += `<span class="cv-chip cv-chip-tags"${s} title="${_cvEscapeAttr(_cardTags.join(", "))}">+${_cardTags.length - 2}</span>`;
    }
  }

  if (item.attachments?.length > 0) {
    h +=
      `<span class="cv-chip cv-chip-attach"${s} title="${item.attachments.length} attachment${item.attachments.length === 1 ? "" : "s"}">` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>` +
      ` ${item.attachments.length}</span>`;
  }

  return h;
};

/**
 * Format currency using app's formatCurrency or simple fallback.
 */
const _cardFmt = (n) => {
  if (typeof formatCurrency === "function") return formatCurrency(Math.abs(n));
  return (
    "$" +
    Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
};

const _gainClass = (gl) => (gl >= 0 ? "cv-gain" : "cv-loss");
const _gainSign = (gl) => (gl >= 0 ? "+" : "-");
const _gainArrow = (gl) => (gl >= 0 ? "&#9650;" : "&#9660;");

// ---------------------------------------------------------------------------
// Card renderers — A through D
// ---------------------------------------------------------------------------

/**
 * Renders Card Style A: Sparkline Header with stacked images.
 * @param {object} item - Inventory item
 * @param {number} idx - Original inventory index
 * @param {object} computed - Pre-computed financial values
 * @returns {string}
 */
const renderCardA = (item, idx, computed) => {
  const { purchaseTotal, retailTotal, gainLoss } = computed;
  const gl = gainLoss ?? 0;
  const pct = purchaseTotal > 0 ? (gl / purchaseTotal) * 100 : 0;

  return (
    `<article class="card-a ${_cardMetalClass(item.metal)}${isDisposed(item) ? " disposed-card" : ""}" data-idx="${idx}">` +
    `<div class="card-a-chart-wrap"><canvas class="card-a-canvas" data-metal="${_cvEscapeAttr((item.metal || "").toLowerCase())}" data-weight="${parseFloat(item.weight) || 1}" data-qty="${Number(item.qty) || 1}" data-purity="${parseFloat(item.purity) || 1}" data-price="${parseFloat(item.price) || 0}" data-market="${parseFloat(item.marketValue) || 0}" data-date="${_cvEscapeAttr(item.date || "")}" data-cu-oz="${item.weightUnit === "cu" && typeof getConstitutionalSilverOz === "function" ? getConstitutionalSilverOz(item) : 0}"></canvas></div>` +
    `<div class="card-body">` +
    `<div class="cv-item-name">${sanitizeHtml(item.name || "")}${isDisposed(item) ? ` <span class="disposition-badge disposition-badge--${item.disposition.type}">${DISPOSITION_TYPES[item.disposition.type]?.label || item.disposition.type}</span>` : ""}</div>` +
    `<div class="cv-chips-img-row"><div class="cv-chips-row">${_cardChipsHTML(item)}</div><div class="cv-images-row cv-images-sm">${_cardImageHTML(item, "", "obverse")}${_cardImageHTML(item, "", "reverse")}</div></div>` +
    `<div class="cv-value-row">` +
    `<span class="cv-value-journey">${_cardFmt(purchaseTotal)}<span class="cv-arrow">&rarr;</span>${_cardFmt(retailTotal)}</span>` +
    `<span class="cv-value-gain ${_gainClass(gl)}">${_gainArrow(gl)} ${_gainSign(gl)}${_cardFmt(gl)} (${_gainSign(gl)}${Math.abs(pct).toFixed(1)}%)</span>` +
    `</div>` +
    `</div>` +
    `</article>`
  );
};

/**
 * Renders Card Style B: Full-Bleed Overlay with hero gain number.
 */
const renderCardB = (item, idx, computed) => {
  const { purchaseTotal, retailTotal, gainLoss } = computed;
  const gl = gainLoss ?? 0;
  const pct = purchaseTotal > 0 ? (gl / purchaseTotal) * 100 : 0;

  return (
    `<article class="card-b ${_cardMetalClass(item.metal)}${isDisposed(item) ? " disposed-card" : ""}" data-idx="${idx}">` +
    `<div class="sparkline-bg">${generateSparklineSVG(item, 400, 180)}</div>` +
    `<div class="card-content">` +
    `<div class="cv-images-row cv-images-center">${_cardImageHTML(item, "", "obverse")}${_cardImageHTML(item, "", "reverse")}</div>` +
    `<div class="cv-item-name">${sanitizeHtml(item.name || "")}${isDisposed(item) ? ` <span class="disposition-badge disposition-badge--${item.disposition.type}">${DISPOSITION_TYPES[item.disposition.type]?.label || item.disposition.type}</span>` : ""}</div>` +
    `<div class="cv-chips-row cv-chips-center">${_cardChipsHTML(item)}</div>` +
    `<div class="cv-value-hero ${_gainClass(gl)}">${_gainSign(gl)}${_cardFmt(gl)}</div>` +
    `<div class="cv-value-detail">${_cardFmt(purchaseTotal)} cost &rarr; ${_cardFmt(retailTotal)} retail &middot; ${_gainSign(gl)}${Math.abs(pct).toFixed(1)}%</div>` +
    `</div>` +
    `</article>`
  );
};

/**
 * Renders Card Style C: Split Card (image left, data right).
 */
const renderCardC = (item, idx, computed) => {
  const { purchaseTotal, retailTotal, gainLoss } = computed;
  const gl = gainLoss ?? 0;

  return (
    `<article class="card-c ${_cardMetalClass(item.metal)}${isDisposed(item) ? " disposed-card" : ""}" data-idx="${idx}">` +
    `<div class="cv-image-col">` +
    `${_cardImageHTML(item, "", "obverse")}` +
    `${_cardImageHTML(item, "", "reverse")}` +
    `</div>` +
    `<div class="cv-data-col">` +
    `<div class="cv-item-name">${sanitizeHtml(item.name || "")}${isDisposed(item) ? ` <span class="disposition-badge disposition-badge--${item.disposition.type}">${DISPOSITION_TYPES[item.disposition.type]?.label || item.disposition.type}</span>` : ""}</div>` +
    `<div class="cv-chips-row">${_cardChipsHTML(item, true)}</div>` +
    `<div class="cv-value-row">` +
    `<span class="cv-value-journey">${_cardFmt(purchaseTotal)}<span class="cv-arrow">&rarr;</span>${_cardFmt(retailTotal)}</span>` +
    `<span class="cv-value-gain ${_gainClass(gl)}">${_gainArrow(gl)} ${_gainSign(gl)}${_cardFmt(gl)}</span>` +
    `</div>` +
    `</div>` +
    `</article>`
  );
};

// ---------------------------------------------------------------------------
// Main card view renderer
// ---------------------------------------------------------------------------

const _cardRenderers = { A: renderCardA, B: renderCardB, C: renderCardC };

/**
 * Renders all items as cards into the given container.
 * @param {object[]} sortedItems - Sorted/filtered inventory items
 * @param {HTMLElement} container - Target container element
 * @param {Map<Object, number>} [itemIndexMap] - Optional map for O(1) index lookup
 */
const renderCardView = (sortedItems, container, itemIndexMap) => {
  const style = getCardStyle();
  const renderer = _cardRenderers[style] || renderCardB;

  const html = sortedItems.map((item) => {
    const originalIdx = itemIndexMap ? itemIndexMap.get(item) : inventory.indexOf(item);
    const currentSpot =
      (typeof spotPrices !== "undefined" ? spotPrices[(item.metal || "").toLowerCase()] : 0) || 0;
    const valuation =
      typeof computeItemValuation === "function" ? computeItemValuation(item, currentSpot) : null;
    const purchasePrice = typeof item.price === "number" ? item.price : parseFloat(item.price) || 0;
    const qty = Number(item.qty) || 1;
    const meltValue = valuation
      ? valuation.meltValue
      : typeof computeMeltValue === "function"
        ? computeMeltValue(item, currentSpot)
        : 0;
    const purchaseTotal = valuation ? valuation.purchaseTotal : purchasePrice * qty;
    const retailTotal = valuation ? valuation.retailTotal : meltValue;
    const fallbackHasRetailSignal =
      currentSpot > 0 ||
      (parseFloat(item.marketValue) || 0) > 0 ||
      !!(typeof getGoldbackRetailPrice === "function" ? getGoldbackRetailPrice(item) : null);
    const gainLoss = valuation
      ? valuation.gainLoss
      : fallbackHasRetailSignal
        ? retailTotal - purchaseTotal
        : null;

    return renderer(item, originalIdx, { purchaseTotal, retailTotal, meltValue, gainLoss });
  });

  // Revoke previous card blob URLs to prevent memory leaks
  for (const url of _cvBlobUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
  _cvBlobUrls = [];

  // STRK-13: Skip the "Add Item" empty-state placeholder during recovery — the
  // recovery banner already owns the screen real estate, and showing Add Item
  // would let the user defeat the saveInventory recovery hold.
  const recoveryActive =
    typeof isInventoryRecoveryActive === "function" && isInventoryRecoveryActive();

  // Handle empty state: no items or no search results
  if (html.length === 0 && !recoveryActive) {
    const isFiltered = typeof inventory !== "undefined" && inventory.length > 0;
    const message = isFiltered ? "No matching items found." : "Your stack is empty.";
    const subtext = isFiltered
      ? "Try adjusting your search or filters."
      : "Add your first item to start tracking your portfolio.";
    const action = isFiltered
      ? `<button class="btn warning btn-sm" onclick="clearAllFilters()">Clear Filters</button>`
      : `<button class="btn success btn-sm" onclick="safeGetElement('newItemBtn').click()">Add Item</button>`;

    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; width: 100%;">
        <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          ${
            isFiltered
              ? '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>' // Search icon
              : '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>' // Stack icon
          }
        </svg>
        <h3>${message}</h3>
        <p>${subtext}</p>
        ${action}
      </div>
    `;
    return;
  }

  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  container.innerHTML = html.join("");

  // Async image enhancement from ImageCache (fire-and-forget)
  _enhanceCardImages(container);

  // Initialize Chart.js charts on Card A canvases
  _initCardCharts(container);
};

// ---------------------------------------------------------------------------
// Chart.js card charts (Card A) — mirrors view modal pattern
// ---------------------------------------------------------------------------

/** @type {Chart[]} Active card chart instances to destroy on re-render */
let _cvChartInstances = [];

/**
 * Initializes Chart.js mini-charts on all .card-a-canvas elements.
 * Reads spot history data from the canvas data attributes and builds
 * the same 3-line chart as the view modal (purchase/melt/retail).
 * @param {HTMLElement} container
 */
function _initCardCharts(container) {
  // Destroy previous instances
  for (const chart of _cvChartInstances) {
    try {
      chart.destroy();
    } catch {
      /* ignore */
    }
  }
  _cvChartInstances = [];

  if (typeof Chart === "undefined") return;

  const canvases = container.querySelectorAll(".card-a-canvas");
  for (const canvas of canvases) {
    const metal = canvas.dataset.metal || "";
    const weightOz = parseFloat(canvas.dataset.weight) || 1;
    const qty = parseInt(canvas.dataset.qty, 10) || 1;
    const purity = parseFloat(canvas.dataset.purity) || 1;
    // STRK-235: for constitutional ("cu") items data-cu-oz carries the pre-derived
    // total silver oz (already × qty, already pure). Use it directly as meltFactor
    // to avoid double-counting qty and purity. Non-cu items: cuOz is 0, fallback.
    const cuOz = parseFloat(canvas.dataset.cuOz) || 0;
    const meltFactor = cuOz > 0 ? cuOz : weightOz * qty * purity;
    const purchasePerUnit = parseFloat(canvas.dataset.price) || 0;
    const purchaseTotal = purchasePerUnit * qty;
    const marketValue = parseFloat(canvas.dataset.market) || 0;
    const currentRetail = marketValue * qty;
    const purchaseDate = canvas.dataset.date ? new Date(canvas.dataset.date).getTime() : 0;

    // Get spot history with timestamps
    let spotEntries = [];
    if (typeof getSpotHistoryForMetal === "function") {
      spotEntries = getSpotHistoryForMetal(metal, 60, true) || [];
    }
    if (spotEntries.length < 2) continue; // No chart without data

    // Prepend synthetic entry at purchase date
    if (purchaseDate > 0 && spotEntries.length > 0 && purchaseDate < spotEntries[0].ts) {
      spotEntries.unshift({ ts: purchaseDate, spot: spotEntries[0].spot });
    }

    // Build labels (compact dates)
    const labels = spotEntries.map((e) => {
      const d = new Date(e.ts);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    });

    // Melt line: spot * meltFactor
    const meltData = spotEntries.map((e) => parseFloat((e.spot * meltFactor).toFixed(2)));

    // Purchase line: flat
    const purchaseLine = spotEntries.map(() => purchaseTotal);

    // Retail line: anchored sparse (purchase at start → current at end)
    const retailData = new Array(spotEntries.length).fill(null);
    if (purchaseTotal > 0) retailData[0] = purchaseTotal;

    // Sparse midpoints from itemPriceHistory
    if (typeof itemPriceHistory !== "undefined") {
      const itemUuid = canvas.closest("[data-idx]")?.dataset.idx;
      const item =
        typeof inventory !== "undefined" && itemUuid ? inventory[parseInt(itemUuid, 10)] : null;
      if (item?.uuid) {
        const history = itemPriceHistory[item.uuid] || [];
        for (const re of history) {
          if (re.retail > 0) {
            let best = 0,
              bestDist = Math.abs(spotEntries[0].ts - re.ts);
            for (let i = 1; i < spotEntries.length; i++) {
              const dist = Math.abs(spotEntries[i].ts - re.ts);
              if (dist < bestDist) {
                best = i;
                bestDist = dist;
              }
            }
            retailData[best] = re.retail * qty;
          }
        }
      }
    }
    if (currentRetail > 0) retailData[spotEntries.length - 1] = currentRetail;

    const hasRetail = retailData.some((v) => v !== null);

    // Theme-aware chart colors — bold lines/fills for light & sepia
    const _isLight = typeof isDarkTheme === "function" ? !isDarkTheme() : false;
    const _danger = getThemeColorRGB("danger");
    const _success = getThemeColorRGB("success");
    const _primary = getThemeColorRGB("primary");
    const _purchFillAlpha = _isLight ? 0.15 : 0.06;
    const _meltFillAlpha = _isLight ? 0.25 : 0.18;
    const _retailFillAlpha = _isLight ? 0.15 : 0.12;
    const datasets = [
      {
        label: "Purchase",
        data: purchaseLine,
        borderColor: _danger,
        backgroundColor: resolveColor(
          `color-mix(in srgb, ${_danger} ${Math.round(_purchFillAlpha * 100)}%, transparent)`
        ),
        fill: "origin",
        borderDash: [6, 3],
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 0,
        borderWidth: _isLight ? 3 : 1.5,
        order: 1,
      },
      {
        label: "Melt",
        data: meltData,
        borderColor: _success,
        backgroundColor: resolveColor(
          `color-mix(in srgb, ${_success} ${Math.round(_meltFillAlpha * 100)}%, transparent)`
        ),
        fill: "origin",
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 3,
        borderWidth: _isLight ? 3 : 2,
        order: 3,
      },
      {
        label: "Retail",
        data: retailData,
        borderColor: _primary,
        backgroundColor: resolveColor(
          `color-mix(in srgb, ${_primary} ${Math.round(_retailFillAlpha * 100)}%, transparent)`
        ),
        fill: "origin",
        tension: 0.3,
        spanGaps: true,
        pointRadius: 0,
        pointHoverRadius: 3,
        borderWidth: _isLight ? 3 : 1.5,
        hidden: !hasRetail,
        order: 2,
      },
    ];

    const cvTextColor =
      typeof getChartTextColor === "function"
        ? getChartTextColor()
        : getThemeColorRGB("text-primary");
    const chart = createTimeSeriesChart(canvas, labels, datasets, {
      animation: false,
      showLegend: true,
      xTicks: {
        color: cvTextColor,
        maxTicksLimit: 4,
        autoSkip: true,
        font: { size: 8 },
        maxRotation: 0,
      },
      yTicks: {
        color: cvTextColor,
        maxTicksLimit: 3,
        font: { size: 8 },
        callback: function (value) {
          return typeof formatCurrency === "function" ? formatCurrency(value) : "$" + value;
        },
      },
      tooltipCallbacks: {
        label: function (ctx) {
          if (ctx.parsed.y === null) return null;
          const val =
            typeof formatCurrency === "function"
              ? formatCurrency(ctx.parsed.y)
              : "$" + ctx.parsed.y.toFixed(2);
          return `${ctx.dataset.label}: ${val}`;
        },
      },
    });

    // Apply chart-specific overrides not covered by createTimeSeriesChart
    if (chart) {
      const chartOpts = chart.options;
      chartOpts.scales.x.grid = { display: false };
      chartOpts.scales.y.grid = { color: "rgba(128,128,128,0.08)" };
      Object.assign(chartOpts.plugins.legend, {
        position: "bottom",
        labels: {
          color: cvTextColor,
          usePointStyle: true,
          pointStyle: "line",
          padding: 6,
          boxWidth: 16,
          font: { size: 8 },
        },
      });
      Object.assign(chartOpts.plugins.tooltip, {
        enabled: true,
        backgroundColor: "rgba(0,0,0,0.8)",
        titleColor: getThemeColorRGB("text-inverse"),
        bodyColor: getThemeColorRGB("text-inverse"),
        padding: 6,
        bodyFont: { size: 10 },
        titleFont: { size: 10 },
      });
      chart.update("none");
    }
    if (chart) _cvChartInstances.push(chart);
  }
}

// ---------------------------------------------------------------------------
// Image enhancement — async load from ImageCache
// ---------------------------------------------------------------------------

/** @type {string[]} Blob URLs to revoke on next render */
let _cvBlobUrls = [];

/** @type {IntersectionObserver|null} */
let _cvImageObserver = null;

/**
 * Enhances card thumbnail images from IndexedDB ImageCache.
 * Uses IntersectionObserver for lazy loading (same pattern as table thumbnails).
 * @param {HTMLElement} container
 */
async function _enhanceCardImages(container) {
  if (typeof featureFlags === "undefined" || !featureFlags.isEnabled("COIN_IMAGES")) return;
  if (!window.imageCache?.isAvailable()) return;

  if (_cvImageObserver) _cvImageObserver.disconnect();

  _cvImageObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        _cvImageObserver.unobserve(entry.target);
        // Observe the visible .coin-img wrapper, find the img inside
        const img = entry.target.querySelector(".cv-thumb");
        if (img) _loadCardImage(img);
      }
    },
    { rootMargin: "200px 0px" }
  );

  container.querySelectorAll(".coin-img").forEach((wrapper) => {
    _cvImageObserver.observe(wrapper);
  });
}

/**
 * Resolves and sets blob URL for a single card thumbnail image.
 * @param {HTMLImageElement} img
 */
async function _loadCardImage(img) {
  try {
    const item = {
      uuid: img.dataset.itemUuid || "",
      numistaId: img.dataset.catalogId || "",
      name: img.dataset.itemName || "",
      metal: img.dataset.itemMetal || "",
      type: img.dataset.itemType || "",
    };
    const side = img.dataset.side || "obverse";

    // Resolve CDN URL and ignorePatternImages from inventory item
    const idx = img.closest("[data-idx]")?.dataset.idx;
    let cdnUrl = "";
    if (idx !== undefined && typeof inventory !== "undefined") {
      const invItem = inventory[parseInt(idx, 10)];
      if (invItem) {
        const urlKey = side === "reverse" ? "reverseImageUrl" : "obverseImageUrl";
        cdnUrl =
          invItem[urlKey] && /^https?:\/\/.+\..+/i.test(invItem[urlKey]) ? invItem[urlKey] : "";
        // STAK-332: Pass ignorePatternImages flag to resolveImageForItem
        if (invItem.ignorePatternImages) item.ignorePatternImages = true;
      }
    }

    // Try IDB resolution cascade (user → pattern → numista cache)
    if (window.imageCache?.isAvailable()) {
      const blobUrl = await imageCache.resolveImageUrlForItem(item, side);
      if (blobUrl) {
        _cvBlobUrls.push(blobUrl);
        _showCardImage(img, blobUrl);
        return;
      }
    }

    // Fallback: CDN URL
    if (cdnUrl) {
      _showCardImage(img, cdnUrl);
      return;
    }
  } catch {
    /* ignore — IDB unavailable or entry missing */
  }
}

/**
 * Show a card image and hide its placeholder.
 * @param {HTMLImageElement} img
 * @param {string} url
 */
function _showCardImage(img, url) {
  img.src = url;
  img.style.display = "";
  const placeholder = img.nextElementSibling;
  if (placeholder) placeholder.style.display = "none";
}

// ---------------------------------------------------------------------------
// Delegated click handler for card grid
// ---------------------------------------------------------------------------

/** @type {boolean} */
let _cardClickBound = false;

/**
 * Binds a delegated click handler on the card grid container.
 * @param {HTMLElement} container
 */
const bindCardClickHandler = (container) => {
  if (_cardClickBound) return;
  _cardClickBound = true;
  container.addEventListener("click", (e) => {
    const card = e.target.closest("[data-idx]");
    if (!card) return;
    const idx = Number(card.dataset.idx);
    if (typeof showViewModal === "function") {
      showViewModal(idx);
    } else if (typeof editItem === "function") {
      editItem(idx);
    }
  });
};

// ---------------------------------------------------------------------------
// Card Sort Bar — sort controls + style toggle (STAK-131)
// ---------------------------------------------------------------------------

/** @type {boolean} Whether card sort bar event listeners have been bound */
let _cardSortBarBound = false;

/**
 * Updates the card sort bar UI to reflect current sort state and card style.
 * Called from renderTable() whenever card view (A/B/C) is active.
 * For D mode, _syncSortBar handles everything via MutationObserver.
 */
const updateCardSortBar = () => {
  // Sync sort dropdown with current sortColumn
  const colSelect = document.getElementById("cardSortColumn");
  if (colSelect && colSelect.value !== String(sortColumn)) {
    colSelect.value = String(sortColumn);
  }

  // Sync direction button
  const dirBtn = document.getElementById("cardSortDirBtn");
  if (dirBtn) {
    dirBtn.setAttribute("data-dir", sortDirection);
    dirBtn.title =
      sortDirection === "asc" ? "Ascending — click to reverse" : "Descending — click to reverse";
  }

  _syncSortBar();
};

/**
 * Binds event listeners on the card sort bar (once).
 * Also sets up the MutationObserver that keeps the bar visible in D (table) mode.
 */
const initCardSortBar = () => {
  if (_cardSortBarBound) return;
  _cardSortBarBound = true;

  // Sort column dropdown
  const colSelect = document.getElementById("cardSortColumn");
  if (colSelect) {
    colSelect.addEventListener("change", () => {
      sortColumn = parseInt(colSelect.value, 10);
      if (sortColumn === SORT_COL_LAST_MODIFIED && sortDirection === "asc") {
        sortDirection = "desc";
        localStorage.setItem(DEFAULT_SORT_DIR_KEY, "desc");
      }
      if (typeof renderTable === "function") renderTable();
    });
  }

  // Sort direction toggle
  const dirBtn = document.getElementById("cardSortDirBtn");
  if (dirBtn) {
    dirBtn.addEventListener("click", () => {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
      if (typeof renderTable === "function") renderTable();
    });
  }

  // Style A/B/C/D toggle
  const styleToggle = document.getElementById("cardStyleToggle");
  if (styleToggle) {
    styleToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip-sort-btn");
      if (!btn || !btn.dataset.style) return;
      const newStyle = btn.dataset.style;
      localStorage.setItem(CARD_STYLE_KEY, newStyle);
      // Sync settings dropdown (D is not in the settings list, skip it)
      const styleSelect = document.getElementById("settingsCardStyle");
      if (styleSelect && newStyle !== "D") styleSelect.value = newStyle;
      if (typeof renderTable === "function") renderTable();
      // After renderTable(), inventory.js may have hidden bar (D mode) — restore it
      _syncSortBar();
    });
  }

  // MutationObserver: when inventory.js hides the bar in table mode (D), immediately restore it.
  // inventory.js sets cardSortBar.style.display='none' when isCardViewActive()===false.
  const bar = document.getElementById("cardSortBar");
  if (bar) {
    new MutationObserver(() => {
      if (getCardStyle() === "D" && bar.style.display === "none") {
        _syncSortBar();
      }
    }).observe(bar, { attributes: true, attributeFilter: ["style"] });
  }
};

// =============================================================================
// GLOBAL SPOT CONTROLS
// =============================================================================

/**
 * Trend period presets and labels for the header trend cycle button.
 */
const TREND_PRESETS = ["1", "7", "30", "90", "365", "1095", "1825", "3650"];
const TREND_LABELS = {
  1: "1d",
  7: "7d",
  30: "30d",
  90: "90d",
  365: "1Y",
  1095: "3Y",
  1825: "5Y",
  3650: "10Y",
};

/** @constant {string[]} TREND_METALS - Metal suffixes for the per-card trend controls.
 * Derived from METALS so a new first-class metal (copper, STRK-306) can never
 * be silently missing from the trend wiring. */
const TREND_METALS = Object.values(METALS).map((m) => m.name);

/**
 * Applies a trend period value to all four metal sparkline selects and to the
 * per-card period chips.
 *
 * The chips carry an aria-label as well as visible text because the text alone
 * ("90d") is not a usable accessible name for a control; both are refreshed
 * here so a screen reader never announces a stale period.
 * @param {string} val - The trend period value to apply.
 */
const _applyTrend = (val) => {
  const label = TREND_LABELS[val] || `${val}d`;
  TREND_METALS.forEach((m) => {
    // Chip first, then the select: dispatching the select's change event runs
    // the spot.js sparkline listeners synchronously, so updating the chip
    // beforehand means those listeners never observe a stale label.
    const period = document.getElementById(`spotPeriod${m}`);
    if (period) {
      period.textContent = label;
      period.setAttribute("aria-label", `Trend period: ${label}. Activate to change.`);
    }
    const sel = document.getElementById(`spotRange${m}`);
    if (sel && sel.value !== val) {
      sel.value = val;
      sel.dispatchEvent(new Event("change"));
    }
  });
};

/**
 * Cycles through trend period presets, persists the selection, and applies it.
 */
const cycleSpotTrend = () => {
  const current = localStorage.getItem(SPOT_TREND_KEY) || "90";
  const next = TREND_PRESETS[(TREND_PRESETS.indexOf(current) + 1) % TREND_PRESETS.length];
  localStorage.setItem(SPOT_TREND_KEY, next);
  _applyTrend(next);
};
window.cycleSpotTrend = cycleSpotTrend;

/**
 * Initialises spot controls: wires the per-card period chips and applies the
 * persisted trend period on load.
 *
 * The per-card <select> elements remain in the DOM (hidden via CSS) so that
 * the existing spot.js sparkline listeners continue to work — `_applyTrend`
 * drives them with a synthetic change event, and they are what actually
 * repaints the sparklines.
 *
 * The chips are native <button> elements, so Enter/Space activation, focus
 * order, and the "does not scroll on Space" behaviour all come from the
 * platform; no delegated keydown handler is needed (contrast the ratio chips
 * in spot-ratio-chips.js, which are built dynamically as role="button" divs
 * and therefore must handle keys themselves).
 */
const _initSpotControls = () => {
  TREND_METALS.forEach((m) => {
    const chip = document.getElementById(`spotPeriod${m}`);
    if (chip) chip.addEventListener("click", cycleSpotTrend);
  });
  _applyTrend(localStorage.getItem(SPOT_TREND_KEY) || "90");
};

// =============================================================================
// TOTALS CAROUSEL
// =============================================================================

/**
 * Initialises the totals cards carousel:
 *  - Generates one dot per card inside #totalsDots
 *  - Wires prev/next buttons to scroll by one card width
 *  - Wires the scroll event to update the active dot and button states
 *
 * At ≥1350px the nav buttons and dots are hidden via CSS; the carousel
 * degenerates to a plain flex row with no overflow.
 */
/**
 * Rebuilds totals carousel dots after metal order/visibility changes.
 * Safe to call multiple times — does not re-wire scroll or nav listeners.
 */
const refreshTotalsDots = () => {
  const carousel = document.getElementById("totalsCarousel");
  const dotsEl = document.getElementById("totalsDots");
  if (!carousel || !dotsEl) return;
  const cards = [...carousel.querySelectorAll(".total-card")].filter(
    (c) => c.style.display !== "none"
  );
  dotsEl.innerHTML = "";
  cards.forEach((card, i) => {
    const dot = document.createElement("button");
    dot.className = "totals-dot" + (i === 0 ? " active" : "");
    dot.setAttribute("aria-label", `Go to card ${i + 1}`);
    dot.addEventListener("click", () =>
      carousel.scrollTo({ left: card.offsetLeft, behavior: "smooth" })
    );
    dotsEl.appendChild(dot);
  });
};
window.refreshTotalsDots = refreshTotalsDots;

const _initTotalsCarousel = () => {
  const carousel = document.getElementById("totalsCarousel");
  const prevBtn = document.getElementById("totalsPrev");
  const nextBtn = document.getElementById("totalsNext");
  const dotsEl = document.getElementById("totalsDots");

  if (!carousel || !prevBtn || !nextBtn || !dotsEl) return;

  const cards = Array.from(carousel.querySelectorAll(".total-card"));
  if (!cards.length) return;

  // Sort by visual (rendered) left offset so CSS `order` is respected.
  // All Metals has order:-1 so it renders first but is last in DOM order.
  const sortedCards = [...cards].sort((a, b) => a.offsetLeft - b.offsetLeft);

  // --- Build dots ---
  dotsEl.innerHTML = "";
  const dots = sortedCards.map((card, i) => {
    const dot = document.createElement("button");
    dot.className = "totals-dot" + (i === 0 ? " active" : "");
    dot.setAttribute("aria-label", `Go to card ${i + 1}`);
    dot.addEventListener("click", () => {
      carousel.scrollTo({ left: card.offsetLeft, behavior: "smooth" });
    });
    dotsEl.appendChild(dot);
    return dot;
  });

  // --- Helpers ---
  const getCardWidth = () => {
    const card = sortedCards[0];
    const gap = parseFloat(getComputedStyle(carousel).gap) || 0;
    return card.getBoundingClientRect().width + gap;
  };

  const updateState = () => {
    const scrollLeft = carousel.scrollLeft;
    const maxScroll = carousel.scrollWidth - carousel.clientWidth;

    prevBtn.disabled = scrollLeft < 4;
    nextBtn.disabled = scrollLeft >= maxScroll - 1;

    // Highlight the dot whose card is most in view
    const activeIdx = Math.round(scrollLeft / getCardWidth());
    dots.forEach((d, i) => d.classList.toggle("active", i === activeIdx));
  };

  // --- Button clicks ---
  prevBtn.addEventListener("click", () => {
    carousel.scrollBy({ left: -getCardWidth(), behavior: "smooth" });
  });
  nextBtn.addEventListener("click", () => {
    carousel.scrollBy({ left: getCardWidth(), behavior: "smooth" });
  });

  // --- Scroll tracking ---
  let scrollTimer;
  carousel.addEventListener(
    "scroll",
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(updateState, 50);
    },
    { passive: true }
  );

  // --- Initial state ---
  updateState();
};

// On page load: initialise sort bar event handlers (needed even in D mode where
// inventory.js never calls initCardSortBar) and fix initial bar visibility.
document.addEventListener("DOMContentLoaded", () => {
  initCardSortBar();
  _initSpotControls();
  _initTotalsCarousel();
  // requestAnimationFrame runs after all DOMContentLoaded handlers (including init.js)
  // so the sort bar has already been shown/hidden by inventory.js by this point.
  requestAnimationFrame(_syncSortBar);
});

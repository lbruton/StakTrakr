// RETAIL VIEW MODAL
// =============================================================================

let _retailViewModalChart = null;
let _retailViewIntradayChart = null;
let _intradayRowCount = 24;
/**
 * Formats a Date as HH:MM in the user's selected timezone (or local if unset).
 * @param {Date} d
 * @returns {string}
 */
const _fmtIntradayTime = (d) => {
  if (!d || isNaN(d.getTime())) return '--:--';
  const tz = (typeof TIMEZONE_KEY !== 'undefined' && localStorage.getItem(TIMEZONE_KEY)) || undefined;
  const tzOpts = tz && tz !== 'auto' ? { timeZone: tz } : {};
  try {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false, ...tzOpts });
  } catch (e) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
};

const _trendGlyph = (current, previous) => {
  if (previous == null || current == null) return '—'; // —
  if (current > previous) return '▲'; // ▲
  if (current < previous) return '▼'; // ▼
  return '—'; // —
};

const _trendClass = (current, previous) => {
  if (previous == null || current == null) return '';
  if (current > previous) return 'text-success';
  if (current < previous) return 'text-danger';
  return '';
};

const _retailYTicks = () => ({
  color: typeof getChartTextColor === "function" ? getChartTextColor() : undefined,
  callback: (v) => `$${Number(v).toFixed(2)}`,
});

/**
 * Switches between the "Price History" and "24h Chart" tabs in the retail view modal.
 * @param {"history"|"intraday"} tab
 */
const _switchRetailViewTab = (tab) => {
  const historySection = safeGetElement("retailViewHistorySection");
  const intradaySection = safeGetElement("retailViewIntradaySection");
  const histTab = safeGetElement("retailViewTabHistory");
  const intTab = safeGetElement("retailViewTabIntraday");
  const isHistory = tab === "history";
  historySection.style.display = isHistory ? "" : "none";
  intradaySection.style.display = isHistory ? "none" : "";
  if (histTab.classList) histTab.classList.toggle("active", isHistory);
  if (intTab.classList) intTab.classList.toggle("active", !isHistory);
};

/**
 * Builds the vendor legend: colored swatch + clickable vendor name + current price.
 * Replaces the "Current Prices" table. No-ops if no price data is available.
 * @param {string} slug
 */
const _buildVendorLegend = (slug) => {
  const container = safeGetElement("retailViewVendorLegend");
  while (container.firstChild) container.removeChild(container.firstChild);

  const priceData = typeof retailPrices !== "undefined" && retailPrices && retailPrices.prices
    ? retailPrices.prices[slug]
    : null;
  const vendorMap = priceData ? priceData.vendors || {} : {};
  const knownVendors = typeof RETAIL_VENDOR_NAMES !== "undefined" ? Object.keys(RETAIL_VENDOR_NAMES) : [];
  const avail = typeof retailAvailability !== 'undefined' && retailAvailability;
  const hasAny = knownVendors.some((v) =>
    (vendorMap[v] && vendorMap[v].price != null) ||
    (avail && avail[slug] && avail[slug][v] === false)
  );
  if (!hasAny) return;

  knownVendors.forEach((vendorId) => {
    const vendorData = vendorMap[vendorId];
    const price = vendorData ? vendorData.price : null;
    const isOOS = avail && avail[slug] && avail[slug][vendorId] === false;

    // Skip vendors with no price and no OOS flag (they don't carry this coin)
    if (price == null && !isOOS) return;

    const color = RETAIL_VENDOR_COLORS[vendorId] || "#94a3b8";
    const label = (typeof RETAIL_VENDOR_NAMES !== "undefined" && RETAIL_VENDOR_NAMES[vendorId]) || vendorId;
    const vendorUrl = (typeof retailProviders !== "undefined" && retailProviders && retailProviders[slug] && retailProviders[slug][vendorId])
      || (typeof RETAIL_VENDOR_URLS !== "undefined" && RETAIL_VENDOR_URLS[vendorId])
      || null;

    // Skip vendors with no price
    if (price == null) return;

    const item = document.createElement(vendorUrl ? "a" : "span");
    item.className = "retail-legend-item";
    if (vendorUrl) {
      item.href = "#";
      item.addEventListener("click", (e) => {
        e.preventDefault();
        const popup = window.open(vendorUrl, `retail_vendor_${vendorId}`, "width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no");
        if (popup) popup.opener = null;
        else window.open(vendorUrl, "_blank", "noopener,noreferrer");
      });
    }

    const swatch = document.createElement("span");
    swatch.className = "retail-legend-swatch";
    swatch.style.background = color;

    const nameEl = document.createElement("span");
    nameEl.className = "retail-legend-name";
    nameEl.textContent = label;
    nameEl.style.color = color;

    const priceEl = document.createElement("span");
    priceEl.className = "retail-legend-price";
    priceEl.textContent = `$${Number(price).toFixed(2)}`;

    item.appendChild(swatch);
    item.appendChild(nameEl);
    item.appendChild(priceEl);
    container.appendChild(item);
  });
};

/**
 * Buckets raw windows_24h into 30-min aligned slots (HH:00 and HH:30).
 * For each slot, picks the most recent window whose timestamp falls within it.
 * Returns up to 48 entries covering the 24h window, oldest first.
 * @param {Array} windows - raw windows_24h from API
 * @returns {Array}
 */
const _bucketWindows = (windows) => {
  if (!windows || windows.length === 0) return [];
  // Build a map: slotKey (ISO :00 or :30) → most recent window in that slot
  const slotMap = new Map();
  for (const w of windows) {
    if (!w.window) continue;
    const d = new Date(w.window);
    if (isNaN(d.getTime())) continue;
    // Round down to nearest 30-min boundary
    const mins = d.getUTCMinutes() >= 30 ? 30 : 0;
    const slotDate = new Date(Date.UTC(
      d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
      d.getUTCHours(), mins, 0, 0
    ));
    const key = slotDate.toISOString();
    // Keep the most recent window for each slot
    const existing = slotMap.get(key);
    // Compare original timestamps (not slot keys) so the most recent poll wins
    if (!existing || d.getTime() > new Date(existing._originalWindow).getTime()) {
      slotMap.set(key, { ...w, window: key, _originalWindow: w.window });
    }
  }
  // Sort chronologically
  return Array.from(slotMap.values()).sort((a, b) => a.window < b.window ? -1 : 1);
};

/**
 * Forward-fills missing vendor prices across a bucketed windows array.
 * For each vendor, carries the most recently seen price into any gap window within the 24h set.
 * Returns a new array — source objects are not mutated.
 * Each returned window gains _carriedVendors: Set<vendorId> listing which prices were carried.
 * @param {Array} bucketed - Chronologically sorted (oldest first) from _bucketWindows
 * @returns {Array}
 */
const _forwardFillVendors = (bucketed) => {
  if (!bucketed || bucketed.length === 0) return [];
  const knownVendors = typeof RETAIL_VENDOR_NAMES !== 'undefined' ? Object.keys(RETAIL_VENDOR_NAMES) : [];
  const lastSeen = {};
  return bucketed.map((w) => {
    const vendors = w.vendors ? { ...w.vendors } : {};
    const carriedVendors = new Set();
    knownVendors.forEach((v) => {
      if (vendors[v] != null) {
        lastSeen[v] = vendors[v];
      } else if (lastSeen[v] != null) {
        vendors[v] = lastSeen[v];
        carriedVendors.add(v);
      }
    });
    return { ...w, vendors, _carriedVendors: carriedVendors };
  });
};

/**
 * Flags anomalous vendor prices using two passes:
 *
 * Pass 1 — Temporal spike detection (primary):
 *   For each vendor at window[t], compare price[t-1] and price[t+1].
 *   If the neighbors are within ±RETAIL_SPIKE_NEIGHBOR_TOLERANCE of each other
 *   (stable neighborhood) but price[t] deviates significantly from their average,
 *   replace price[t] with the neighbor average. This catches single-window scrape spikes.
 *
 * Pass 2 — Cross-vendor median consensus (safety net):
 *   For each window with 3+ vendors, any vendor deviating >RETAIL_ANOMALY_THRESHOLD
 *   from the median is nulled. Catches multi-window vendor drift.
 *
 * Flagged chart prices are nulled so Chart.js gaps over them via spanGaps.
 * Original prices preserved in _anomalyOriginals for table display.
 * Pure function — input array is not mutated.
 *
 * @param {Array} bucketed - Chronologically sorted windows from _forwardFillVendors
 * @returns {Array} New array with _anomalousVendors: Set on each window
 */
const _flagAnomalies = (bucketed) => {
  if (!bucketed || bucketed.length === 0) return [];
  const neighborTol = typeof RETAIL_SPIKE_NEIGHBOR_TOLERANCE !== 'undefined' ? RETAIL_SPIKE_NEIGHBOR_TOLERANCE : 0.05;
  const medianThreshold = typeof RETAIL_ANOMALY_THRESHOLD !== 'undefined' ? RETAIL_ANOMALY_THRESHOLD : 0.40;
  const knownSet = typeof RETAIL_VENDOR_NAMES !== 'undefined' ? Object.keys(RETAIL_VENDOR_NAMES) : null;

  // Deep-copy vendors so we don't mutate input
  const result = bucketed.map((w) => ({
    ...w,
    vendors: w.vendors ? { ...w.vendors } : {},
    _anomalousVendors: new Set(),
    _anomalyOriginals: {}
  }));

  // --- Pass 1: Temporal spike detection (per-vendor, per-window) ---
  // Collect all vendor IDs across all windows
  const allVendors = new Set();
  for (const w of result) {
    for (const k of Object.keys(w.vendors)) {
      if (!knownSet || knownSet.includes(k)) allVendors.add(k);
    }
  }

  for (const vendorId of allVendors) {
    // Skip t=0 and t=last: no neighbor pair available at boundaries.
    // Pass 2 (cross-vendor median) provides a safety net for boundary windows.
    for (let t = 1; t < result.length - 1; t++) {
      const curr = result[t].vendors[vendorId];
      const prev = result[t - 1].vendors[vendorId];
      const next = result[t + 1].vendors[vendorId];
      // Need numeric values for all three windows
      if (typeof curr !== 'number' || isNaN(curr)) continue;
      if (typeof prev !== 'number' || isNaN(prev)) continue;
      if (typeof next !== 'number' || isNaN(next)) continue;
      if (prev === 0 && next === 0) continue;
      // Check if before/after form a stable neighborhood (within ±tolerance of each other)
      const neighborAvg = (prev + next) / 2;
      if (neighborAvg === 0) continue;
      const neighborDrift = Math.abs(prev - next) / neighborAvg;
      if (neighborDrift > neighborTol) continue; // neighbors disagree — not a spike
      // Check if current price deviates from the neighbor average
      const deviation = Math.abs(curr - neighborAvg) / neighborAvg;
      if (deviation > neighborTol) {
        // Spike detected — replace with neighbor average for chart, preserve original for table
        result[t]._anomalyOriginals[vendorId] = curr;
        result[t].vendors[vendorId] = null;
        result[t]._anomalousVendors.add(vendorId);
      }
    }
  }

  // --- Pass 2: Cross-vendor median consensus (safety net for extreme outliers) ---
  for (const w of result) {
    const entries = Object.entries(w.vendors).filter(([k, p]) => typeof p === 'number' && !isNaN(p) && (!knownSet || knownSet.includes(k)));
    if (entries.length < 3) continue;
    const prices = entries.map(([, p]) => p).sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];
    if (median === 0) continue;
    let flagged = 0;
    const candidates = [];
    for (const [vendorId, price] of entries) {
      if (Math.abs(price - median) / median > medianThreshold) {
        candidates.push(vendorId);
        flagged++;
      }
    }
    // Guard: don't flag all vendors
    if (flagged >= entries.length) continue;
    for (const vendorId of candidates) {
      if (!w._anomalousVendors.has(vendorId)) {
        w._anomalyOriginals[vendorId] = w.vendors[vendorId];
        w.vendors[vendorId] = null;
        w._anomalousVendors.add(vendorId);
      }
    }
  }

  return result;
};

/**
 * Renders the intraday data table for a given slug.
 * Accepts an optional pre-bucketed array; if omitted, re-buckets from retailIntradayData.
 * Slices to the _intradayRowCount most recent rows.
 * @param {string} slug
 * @param {Array} [bucketed]
 */
const _buildIntradayTable = (slug, bucketed) => {
  const tableBody = safeGetElement("retailViewIntradayTableBody");
  const tableHead = safeGetElement("retailViewIntradayTableHead");

  // Fall back to re-bucketing from live data if bucketed not provided
  if (!bucketed) {
    const intraday = typeof retailIntradayData !== "undefined" ? retailIntradayData[slug] : null;
    const windows = intraday && Array.isArray(intraday.windows_24h) ? intraday.windows_24h : [];
    const filled = _forwardFillVendors(_bucketWindows(windows));
    try {
      bucketed = _flagAnomalies(filled);
    } catch (e) {
      console.error('[retail] _flagAnomalies threw unexpectedly — anomaly detection skipped', e);
      bucketed = filled;
    }
  }

  // Collect the vendor set across all bucketed entries
  const knownVendors = typeof RETAIL_VENDOR_NAMES !== "undefined" ? Object.keys(RETAIL_VENDOR_NAMES) : [];
  const activeVendors = knownVendors.filter((v) => bucketed.some((w) => (w.vendors && w.vendors[v] != null) || (w._anomalyOriginals && w._anomalyOriginals[v] != null)));
  const useVendorLines = activeVendors.length > 0;

  // Update table header — per-vendor when data available, median+low fallback otherwise
  const tableColumns = useVendorLines
    ? activeVendors.map((v) => (typeof RETAIL_VENDOR_NAMES !== "undefined" && RETAIL_VENDOR_NAMES[v]) || v)
    : ["Median", "Low"];
  if (tableHead) {
    tableHead.innerHTML = "";
    const headerRow = document.createElement("tr");
    const tz = (typeof TIMEZONE_KEY !== 'undefined' && localStorage.getItem(TIMEZONE_KEY)) || undefined;
    const timeColLabel = tz && tz !== 'auto' ? `Time (${tz})` : 'Time (local)';
    [timeColLabel, ...tableColumns].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headerRow.appendChild(th);
    });
    tableHead.appendChild(headerRow);
  }

  // Compact recent-windows table (slice to _intradayRowCount most recent, newest first)
  if (tableBody) {
    tableBody.innerHTML = "";
    const recent = bucketed.slice(-_intradayRowCount).reverse();
    const fmt = (v) => (v != null ? `$${Number(v).toFixed(2)}` : "\u2014");
    recent.forEach((w, idx) => {
      const tr = document.createElement("tr");
      const d = w.window ? new Date(w.window) : null;
      const timeLabel = _fmtIntradayTime(d);

      // Time cell
      const timeTd = document.createElement("td");
      timeTd.textContent = timeLabel;
      tr.appendChild(timeTd);

      // Per-vendor (or median/low) cells — each gets its own trend glyph + color
      if (useVendorLines) {
        activeVendors.forEach((v) => {
          const isAnomalous = w._anomalousVendors && w._anomalousVendors.has(v);
          const anomalyVal = isAnomalous && w._anomalyOriginals ? w._anomalyOriginals[v] : null;
          const isCarried = w._carriedVendors && w._carriedVendors.has(v);
          const currVal = w.vendors && w.vendors[v] != null ? w.vendors[v] : null;
          const td = document.createElement("td");
          if (isAnomalous && anomalyVal != null) {
            const prevAnom = idx + 1 < recent.length && recent[idx + 1]._anomalyOriginals
              ? recent[idx + 1]._anomalyOriginals[v] : null;
            const cls = _trendClass(anomalyVal, prevAnom);
            td.className = cls || '';
            td.style.textDecoration = 'line-through';
            td.style.opacity = '0.45';
            td.textContent = fmt(anomalyVal);
          } else if (currVal == null) {
            td.textContent = '\u2014';
          } else if (isCarried) {
            td.className = 'text-muted fst-italic';
            td.textContent = `~${fmt(currVal)}`;
          } else {
            const prevVal = idx + 1 < recent.length
              ? (recent[idx + 1].vendors && recent[idx + 1].vendors[v] != null ? recent[idx + 1].vendors[v] : null)
              : null;
            const glyph = _trendGlyph(currVal, prevVal);
            const cls = _trendClass(currVal, prevVal);
            td.className = cls || '';
            td.textContent = `${fmt(currVal)} ${glyph}`;
          }
          tr.appendChild(td);
        });
      } else {
        // Median cell with trend
        const currMedian = w.median != null ? w.median : null;
        const prevMedian = idx + 1 < recent.length ? (recent[idx + 1].median != null ? recent[idx + 1].median : null) : null;
        const medGlyph = _trendGlyph(currMedian, prevMedian);
        const medCls = _trendClass(currMedian, prevMedian);
        const medTd = document.createElement("td");
        medTd.className = medCls || '';
        medTd.textContent = currMedian != null ? `${fmt(currMedian)} ${medGlyph}` : '\u2014';
        tr.appendChild(medTd);
        // Low cell (no trend — less meaningful for low)
        const lowTd = document.createElement("td");
        lowTd.textContent = fmt(w.low);
        tr.appendChild(lowTd);
      }

      tableBody.appendChild(tr);
    });
    const colCount = tableColumns.length + 1; // +1 for Time
    if (recent.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = colCount;
      td.className = "settings-subtext";
      td.textContent = "No intraday data available.";
      tr.appendChild(td);
      tableBody.appendChild(tr);
    }
  }
};

/**
 * Builds the intraday chart from bucketed windows_24h data for a slug.
 * Also calls _buildIntradayTable to render the time-series table below.
 * @param {string} slug
 */
const _buildIntradayChart = (slug) => {
  const canvas = safeGetElement("retailViewIntradayChart");
  const noDataEl = safeGetElement("retailViewIntradayNoData");

  const intraday = typeof retailIntradayData !== "undefined" ? retailIntradayData[slug] : null;
  const windows = intraday && Array.isArray(intraday.windows_24h) ? intraday.windows_24h : [];
  const filled = _forwardFillVendors(_bucketWindows(windows));
  let bucketed;
  try {
    bucketed = _flagAnomalies(filled);
  } catch (e) {
    console.error('[retail] _flagAnomalies threw unexpectedly — anomaly detection skipped', e);
    bucketed = filled;
  }

  if (noDataEl) noDataEl.style.display = bucketed.length < 2 ? "" : "none";
  if (canvas) canvas.style.display = bucketed.length >= 2 ? "" : "none";

  if (_retailViewIntradayChart) {
    _retailViewIntradayChart.destroy();
    _retailViewIntradayChart = null;
  }

  // Collect the vendor set across all bucketed entries (preserves display order from RETAIL_VENDOR_NAMES)
  const knownVendors = typeof RETAIL_VENDOR_NAMES !== "undefined" ? Object.keys(RETAIL_VENDOR_NAMES) : [];
  const activeVendors = knownVendors.filter((v) => bucketed.some((w) => (w.vendors && w.vendors[v] != null) || (w._anomalyOriginals && w._anomalyOriginals[v] != null)));
  // Fall back to median+low when windows predate the per-vendor format
  const useVendorLines = activeVendors.length > 0;

  if (bucketed.length >= 2 && canvas instanceof HTMLCanvasElement && typeof Chart !== "undefined") {
    const labels = bucketed.map((w) => {
      const d = w.window ? new Date(w.window) : null;
      return _fmtIntradayTime(d);
    });

    const datasets = useVendorLines
      ? activeVendors.map((vendorId) => {
          const label = (typeof RETAIL_VENDOR_NAMES !== "undefined" && RETAIL_VENDOR_NAMES[vendorId]) || vendorId;
          const color = RETAIL_VENDOR_COLORS[vendorId] || "#94a3b8";
          const carriedIndices = new Set();
          bucketed.forEach((w, i) => {
            if (w._carriedVendors && w._carriedVendors.has(vendorId)) carriedIndices.add(i);
          });
          return {
            label,
            data: bucketed.map((w) => (w.vendors && w.vendors[vendorId] != null ? w.vendors[vendorId] : null)),
            borderColor: color,
            backgroundColor: "transparent",
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.2,
            spanGaps: true,
            _carriedIndices: carriedIndices,
          };
        })
      : [
          {
            label: "Median",
            data: bucketed.map((w) => w.median),
            borderColor: "#3b82f6",
            backgroundColor: "transparent",
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.3,
          },
          {
            label: "Low",
            data: bucketed.map((w) => w.low),
            borderColor: "#22c55e",
            backgroundColor: "transparent",
            borderWidth: 1.5,
            borderDash: [4, 3],
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.3,
          },
        ];

    _retailViewIntradayChart = new Chart(canvas, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !useVendorLines, position: "top", labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                if (ctx.raw == null) return null;
                const carried = ctx.dataset._carriedIndices && ctx.dataset._carriedIndices.has(ctx.dataIndex);
                return `${ctx.dataset.label}: ${carried ? '~' : ''}$${Number(ctx.raw).toFixed(2)}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              maxTicksLimit: 12,
              autoSkip: true,
              maxRotation: 0,
              color: function(context) {
                const label = context.chart.data.labels[context.index] || '';
                const mins = label.split(':')[1];
                const base = typeof getChartTextColor === "function" ? getChartTextColor() : '#94a3b8';
                if (mins === '00') return base;
                return base.startsWith('#') && base.length === 7 ? base + '80' : base;
              },
              font: function(context) {
                const label = context.chart.data.labels[context.index] || '';
                const mins = label.split(':')[1];
                return { size: mins === '00' ? 11 : 9 };
              },
            },
          },
          y: { ticks: _retailYTicks() },
        },
      },
    });
  }

  _buildIntradayTable(slug, bucketed);
};

/**
 * Opens the per-coin retail price detail modal.
 * @param {string} slug - Coin slug (e.g. "ase")
 */
const openRetailViewModal = (slug) => {
  const meta = RETAIL_COIN_META[slug];
  if (!meta) return;

  const titleEl = safeGetElement("retailViewCoinName");
  const subtitleEl = safeGetElement("retailViewModalSubtitle");
  const historyTableBody = safeGetElement("retailViewHistoryTableBody");
  const chartCanvas = safeGetElement("retailViewChart");

  titleEl.textContent = meta.name;
  subtitleEl.textContent = `${meta.weight} troy oz \u00b7 ${meta.metal}`;

  // Clear any stale staleness banner from a previous modal open
  const existingBanner = document.querySelector('#retailViewModal .retail-stale-data-warning');
  if (existingBanner) existingBanner.remove();

  // Vendor legend — colored swatch + clickable name + current price
  _buildVendorLegend(slug);

  // History table — new avg_median/avg_low/vendors.*.avg shape (7 columns)
  const history = getRetailHistoryForSlug(slug);
  historyTableBody.innerHTML = "";
  history.forEach((entry) => {
    const tr = document.createElement("tr");
    const fmt = (v) => (v != null ? `$${Number(v).toFixed(2)}` : "\u2014");
    [
      entry.date,
      fmt(entry.avg_median),
      fmt(entry.avg_low),
      fmt(entry.vendors && entry.vendors.apmex && entry.vendors.apmex.avg),
      fmt(entry.vendors && entry.vendors.monumentmetals && entry.vendors.monumentmetals.avg),
      fmt(entry.vendors && entry.vendors.sdbullion && entry.vendors.sdbullion.avg),
      fmt(entry.vendors && entry.vendors.jmbullion && entry.vendors.jmbullion.avg),
    ].forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });
    historyTableBody.appendChild(tr);
  });

  // Daily price history chart — per-vendor lines matching the 24h chart colors
  const chartWrap = chartCanvas instanceof HTMLCanvasElement
    ? chartCanvas.closest(".retail-view-chart-wrap")
    : null;
  if (_retailViewModalChart) {
    _retailViewModalChart.destroy();
    _retailViewModalChart = null;
  }
  const hasEnoughHistory = history.length > 1;
  if (chartWrap) chartWrap.style.display = hasEnoughHistory ? "" : "none";
  if (hasEnoughHistory && chartCanvas instanceof HTMLCanvasElement && typeof Chart !== "undefined") {
    const sorted = [...history].reverse();
    const knownVendors = typeof RETAIL_VENDOR_NAMES !== "undefined" ? Object.keys(RETAIL_VENDOR_NAMES) : [];
    const activeHistVendors = knownVendors.filter((v) =>
      sorted.some((e) => e.vendors && e.vendors[v] && e.vendors[v].avg != null)
    );
    const useVendorHistLines = activeHistVendors.length > 0;

    const histDatasets = useVendorHistLines
      ? activeHistVendors.map((vendorId) => ({
          label: (typeof RETAIL_VENDOR_NAMES !== "undefined" && RETAIL_VENDOR_NAMES[vendorId]) || vendorId,
          data: sorted.map((e) => {
            const vendorData = e.vendors && e.vendors[vendorId];
            // If vendor is out of stock, return null to create gap
            if (vendorData && vendorData.inStock === false) return null;
            return vendorData ? vendorData.avg : null;
          }),
          borderColor: RETAIL_VENDOR_COLORS[vendorId] || "#94a3b8",
          backgroundColor: "transparent",
          borderWidth: 1.5,
          pointRadius: 2,
          tension: 0.3,
          spanGaps: false,
        }))
      : [{
          label: "Avg Median",
          data: sorted.map((e) => e.avg_median),
          borderColor: "var(--accent-primary, #4a9eff)",
          backgroundColor: "transparent",
          pointRadius: 2,
          tension: 0.3,
        }];

    _retailViewModalChart = new Chart(chartCanvas, {
      type: "line",
      data: { labels: sorted.map((e) => e.date), datasets: histDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !useVendorHistLines },
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.dataset.label || "";
                const value = context.parsed.y;

                if (value === null) {
                  return `${label}: Out of stock`;
                }

                return `${label}: $${Number(value).toFixed(2)}`;
              }
            }
          }
        },
        scales: {
          y: { ticks: _retailYTicks() },
        },
      },
    });
  }

  // Build intraday chart for 24h tab using cached data
  _buildIntradayChart(slug);

  // Wire row-count dropdown
  const rowCountSel = safeGetElement('retailViewIntradayRowCount');
  if (rowCountSel) {
    rowCountSel.value = String(_intradayRowCount);
    rowCountSel.onchange = () => {
      _intradayRowCount = Number(rowCountSel.value);
      _buildIntradayTable(slug);
    };
  }

  // Default to 24h chart on open (switch to history once dataset is larger)
  _switchRetailViewTab("intraday");

  if (typeof openModalById === "function") openModalById("retailViewModal");

  // Async refresh: fetch fresh data for this coin so the modal always shows
  // current vendor-level intraday data regardless of localStorage staleness.
  const _apiBase = typeof _lastSuccessfulApiBase !== "undefined" ? _lastSuccessfulApiBase : (typeof RETAIL_API_BASE_URL !== "undefined" ? RETAIL_API_BASE_URL : null);
  if (_apiBase) {
    Promise.all([
      fetch(`${_apiBase}/${slug}/latest.json`).catch((err) => { debugLog(`[retail-view-modal] latest fetch failed: ${err.message}`, "warn"); return null; }),
      fetch(`${_apiBase}/${slug}/history-30d.json`).catch((err) => { debugLog(`[retail-view-modal] history fetch failed: ${err.message}`, "warn"); return null; }),
    ]).then(async ([latestResp, histResp]) => {
      let intradayUpdated = false;
      let anySuccess = false;
      if (latestResp && latestResp.ok) {
        const latest = await latestResp.json().catch((err) => { debugLog(`[retail-view-modal] JSON parse failed for latest: ${err.message}`, "warn"); return null; });
        if (latest) {
          anySuccess = true;
          if (typeof retailIntradayData !== "undefined") {
            retailIntradayData[slug] = {
              window_start: latest.window_start,
              windows_24h: Array.isArray(latest.windows_24h) ? latest.windows_24h : [],
            };
            if (typeof saveRetailIntradayData === "function") saveRetailIntradayData();
            intradayUpdated = true;
          }
          if (latest.vendors && typeof retailPrices !== "undefined" && retailPrices && retailPrices.prices) {
            retailPrices.prices[slug] = {
              median_price: latest.median_price,
              lowest_price: latest.lowest_price,
              vendors: latest.vendors,
            };
            if (typeof saveRetailPrices === "function") saveRetailPrices();
          }
        }
      }
      if (histResp && histResp.ok) {
        const hist = await histResp.json().catch((err) => { debugLog(`[retail-view-modal] JSON parse failed for history: ${err.message}`, "warn"); return null; });
        if (Array.isArray(hist) && typeof retailPriceHistory !== "undefined") {
          anySuccess = true;
          retailPriceHistory[slug] = hist;
          if (typeof saveRetailPriceHistory === "function") saveRetailPriceHistory();
        }
      }
      // Show staleness warning if both fetches failed
      if (!anySuccess) {
        const modalBody = document.querySelector('#retailViewModal .modal-body');
        if (modalBody && !modalBody.querySelector('.retail-stale-data-warning')) {
          const banner = document.createElement('div');
          banner.className = 'retail-stale-data-warning';
          banner.textContent = '\u26a0 Could not refresh live data \u2014 showing cached prices';
          modalBody.insertBefore(banner, modalBody.firstChild);
        }
      }
      // Rebuild intraday chart and vendor legend with fresh data
      if (intradayUpdated) _buildIntradayChart(slug);
      _buildVendorLegend(slug);
    }).catch((err) => {
      debugLog(`[retail-view-modal] Background refresh failed: ${err.message}`, "warn");
    });
  }
};

const closeRetailViewModal = () => {
  if (_retailViewModalChart) {
    _retailViewModalChart.destroy();
    _retailViewModalChart = null;
  }
  if (_retailViewIntradayChart) {
    _retailViewIntradayChart.destroy();
    _retailViewIntradayChart = null;
  }
  if (typeof closeModalById === "function") closeModalById("retailViewModal");
};

if (typeof window !== "undefined") {
  window.openRetailViewModal = openRetailViewModal;
  window.closeRetailViewModal = closeRetailViewModal;
  window._switchRetailViewTab = _switchRetailViewTab;
  window._bucketWindows = _bucketWindows;
  window._forwardFillVendors = _forwardFillVendors;
  window._flagAnomalies = _flagAnomalies;
  window._buildIntradayTable = _buildIntradayTable;
  window.retailBucketWindows = _bucketWindows;
  window.retailForwardFillVendors = _forwardFillVendors;
  window.retailFlagAnomalies = _flagAnomalies;
  window.retailFmtIntradayTime = _fmtIntradayTime;
}

// =============================================================================

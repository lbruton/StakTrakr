// RATIOS PANEL COMPONENT (STRK-270)
// =============================================================================
// Shared Layout C ("Signal") metal-ratios panel — the single component both
// hosts render: the in-app modal (STRK-271) and the standalone /ratios/ page
// (STRK-273). Lifted from playground/ratios-panel-playground.html (the
// approved prototype); layout and copy decisions live there — do not redesign
// here. Depends on the STRK-269 statistics engine in spot-ratio-math.js
// (RATIO_PAIRS / buildRatioSeries / computeRatioStats), which MUST load first.
// Chart.js (vendored) is only needed at draw time; the panel renders its
// statistics without it. Markup is generated from internal numeric data only —
// no user-supplied content flows into these strings.
//
// Styling is tokens-only (design rule D-7): the accent is set by data-accent
// resolving to --silver / --platinum / --palladium, and chart colors are read
// from computed tokens at draw time so a theme switch repaints correctly (a
// MutationObserver on data-theme redraws the chart while mounted, mirroring
// the STAK-504 market-data precedent).
// =============================================================================

/**
 * Formats a panel value to fixed decimals, or an em dash when unusable.
 * @param {*} value - Numeric value to format
 * @param {number} [decimals] - Decimal places (default 1)
 * @returns {string}
 */
const ratioPanelFmt = (value, decimals = 1) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(decimals) : "—";

/**
 * Formats a value as an "N:1" ratio string.
 * @param {*} value - Numeric ratio value
 * @param {number} [decimals] - Decimal places (default 1)
 * @returns {string}
 */
const ratioPanelRatio = (value, decimals = 1) => `${ratioPanelFmt(value, decimals)}:1`;

/**
 * Rounds and suffixes a number as an English ordinal ("82nd", "13th").
 * @param {number} value - Value to round and suffix
 * @returns {string}
 */
const ratioPanelOrdinal = (value) => {
  const rounded = Math.round(value);
  const suffix =
    ["th", "st", "nd", "rd"][((rounded % 100) - 20) % 10] ||
    ["th", "st", "nd", "rd"][rounded % 100] ||
    "th";
  return `${rounded}${suffix}`;
};

/**
 * Signed magnitude of the current ratio vs a trailing average — "9.4% above
 * trend" beats a bare above/below. Within ±0.05% reads "At trend"; an
 * unusable average degrades to an em dash.
 * @param {number} current - Current ratio value
 * @param {*} avg - Trailing average to compare against
 * @returns {string}
 */
const ratioTrendLabel = (current, avg) => {
  if (typeof avg !== "number" || !Number.isFinite(avg) || avg <= 0) return "—";
  const pct = ((current - avg) / avg) * 100;
  if (Math.abs(pct) < 0.05) return "At trend";
  return `${ratioPanelFmt(Math.abs(pct), 1)}% ${pct > 0 ? "above" : "below"} trend`;
};

/**
 * Returns whether the long-run-mean reference line should be drawn for the
 * visible window. Only when the mean lands within ~35% of the window span —
 * otherwise it hijacks the y-axis (Au:Pt's 1990-to-date mean of 1.10 against
 * a 90-day window near 2.5 squashes the series into the top fifth of the
 * plot). A flat window falls back to a 10% pad so the check never divides by
 * a zero span.
 * @param {number[]} visibleValues - Y values of the visible chart window
 * @param {number} histMean - All-time mean of the full series
 * @returns {boolean}
 */
const ratioMeanLineVisible = (visibleValues, histMean) => {
  if (!Array.isArray(visibleValues) || visibleValues.length === 0) return false;
  const lo = Math.min(...visibleValues);
  const hi = Math.max(...visibleValues);
  const pad = (hi - lo) * 0.35 || hi * 0.1;
  return histMean >= lo - pad && histMean <= hi + pad;
};

/**
 * Header block: eyebrow, plain-English title, live/last-close badge, and the
 * in-panel pair selector (the component owns it so both hosts get it once).
 * Reads RATIO_PAIRS (spot-ratio-math.js) bare, mirroring how the chip module
 * reads its collaborators.
 * @param {object} pair - Active RATIO_PAIRS entry
 * @param {boolean} live - Whether a live spot ratio is driving `current`
 * @returns {string} HTML fragment
 */
const ratioPanelHeaderHtml = (pair, live) => `
  <div class="gsr-head">
    <div>
      <div class="eyebrow">${pair.num} ÷ ${pair.den}</div>
      <div class="title">${pair.title}</div>
    </div>
    <span class="gsr-live" data-state="${live ? "live" : "stale"}">
      <span class="dot"></span>${live ? "Live" : "Last close"}
    </span>
  </div>
  <div class="gsr-pairs" role="group" aria-label="Metal pair">
    ${RATIO_PAIRS.map(
      (p) => `<button data-pair="${p.id}" aria-pressed="${p.id === pair.id}">${p.label}</button>`
    ).join("")}
  </div>`;

/**
 * Hero readout with the delta vs prior close (one extra decimal place). When
 * no prior close exists the delta clause is omitted rather than faked.
 * @param {object} pair - Active RATIO_PAIRS entry
 * @param {object} stats - computeRatioStats result
 * @returns {string} HTML fragment
 */
const ratioPanelHeroHtml = (pair, stats) => {
  let sub = `<span style="color:var(--text-muted)">No prior session close</span>`;
  if (typeof stats.prevClose === "number" && Number.isFinite(stats.prevClose)) {
    const delta = stats.current - stats.prevClose;
    sub =
      `<span class="gsr-delta" data-dir="${delta >= 0 ? "up" : "down"}">` +
      `${delta >= 0 ? "▲" : "▼"} ${ratioPanelFmt(Math.abs(delta), pair.decimals + 1)}</span> ` +
      `<span style="color:var(--text-muted)">vs prior close</span>`;
  }
  return `
  <div>
    <span class="gsr-hero-num">${ratioPanelFmt(stats.current, pair.decimals)}<span class="unit">:1</span></span>
    <div class="gsr-hero-sub">${sub}</div>
  </div>`;
};

/**
 * 52-week position bar with the long-run-mean marker. Both scales are named
 * explicitly — the bar is a 52-WEEK range while the figure beside it is an
 * ALL-TIME percentile; unlabeled, the marker reads as pointing at the
 * percentile. The interpretive clause ("higher means silver is relatively
 * cheaper") is Au:Ag only: it implies mean reversion that Pt/Pd have not
 * historically honored, so those pairs get position without a verdict.
 * @param {object} pair - Active RATIO_PAIRS entry
 * @param {object} stats - computeRatioStats result
 * @returns {string} HTML fragment
 */
const ratioPanelRangeHtml = (pair, stats) => {
  const d = pair.decimals;
  const lo = stats.low52[1];
  const hi = stats.high52[1];
  const span = hi - lo || 1;
  const pos = Math.max(0, Math.min(100, ((stats.current - lo) / span) * 100));
  const meanPos = Math.max(0, Math.min(100, ((stats.histMean - lo) / span) * 100));
  const spanYear = stats.spanStart.slice(0, 4);
  const above = stats.vsMeanPct >= 0 ? "above" : "below";
  const magnitude = ratioPanelFmt(Math.abs(stats.vsMeanPct), 0);
  const legend = pair.interpretive
    ? `Today sits <b>${magnitude}% ${above}</b> the long-run mean of ` +
      `${ratioPanelRatio(stats.histMean, d)} (thin marker). ` +
      `A higher ratio means silver is relatively cheaper against gold.`
    : `Today sits <b>${magnitude}% ${above}</b> the ${spanYear}-to-date mean of ` +
      `${ratioPanelRatio(stats.histMean, d)} (thin marker). ` +
      `${pair.id === "pt-pd" ? "Both metals are" : `${pair.den} is`} priced largely by ` +
      `industrial demand and supply shocks, so position here is context — not a signal.`;
  return `
  <div class="gsr-range">
    <div class="rhead">
      <span class="k">52-week range</span>
      <span class="pct">${ratioPanelOrdinal(stats.percentile)} percentile all-time</span>
    </div>
    <div class="gsr-track">
      <span class="mean-mark" style="left:${meanPos}%"></span>
      <span class="mark" style="left:${pos}%"></span>
    </div>
    <div class="rfoot"><span>${ratioPanelRatio(lo, d)}</span><span>${ratioPanelRatio(hi, d)}</span></div>
    <div class="rlegend">${legend}</div>
  </div>`;
};

/**
 * The four trend tiles (7D/30D/90D/1Y) with signed-magnitude context lines.
 * @param {object} pair - Active RATIO_PAIRS entry
 * @param {object} stats - computeRatioStats result
 * @returns {string} HTML fragment
 */
const ratioPanelTilesHtml = (pair, stats) => {
  const d = pair.decimals;
  const tile = (label, avg) =>
    `<div class="gsr-tile"><span class="k">${label}</span>` +
    `<span class="v">${ratioPanelRatio(avg, d)}</span>` +
    `<span class="m">${ratioTrendLabel(stats.current, avg)}</span></div>`;
  return `
  <div class="gsr-grid">
    ${tile("7-day", stats.avg7)}
    ${tile("30-day", stats.avg30)}
    ${tile("90-day", stats.avg90)}
    ${tile("1-year", stats.avg365)}
  </div>`;
};

/**
 * Chart block with the 30D/90D/1Y/5Y/MAX range control. The pressed pill
 * follows the ACTIVE range so a rerender (e.g. a pair switch) after a range
 * change cannot desync the control from the chart. The canvas is class-scoped
 * (no ids) so multiple mounts cannot collide.
 * @param {string} [activeRange] - Active range key ("30"|"90"|"365"|"1305"|"max"), default "90"
 * @returns {string} HTML fragment
 */
const ratioPanelChartHtml = (activeRange = "90") => {
  const rangeButton = (key, label) =>
    `<button data-r="${key}" aria-pressed="${key === activeRange}">${label}</button>`;
  return `
  <div class="gsr-chartwrap">
    <div class="cbar">
      <div class="gsr-tf" role="group" aria-label="Chart range">
        ${rangeButton("30", "30D")}
        ${rangeButton("90", "90D")}
        ${rangeButton("365", "1Y")}
        ${rangeButton("1305", "5Y")}
        ${rangeButton("max", "MAX")}
      </div>
    </div>
    <div class="gsr-canvas"><canvas></canvas></div>
  </div>`;
};

/**
 * Provenance footer: source, span, session count, session-based averages
 * note, and the not-investment-advice disclaimer.
 * @param {object} pair - Active RATIO_PAIRS entry
 * @param {object} stats - computeRatioStats result
 * @returns {string} HTML fragment
 */
const ratioPanelFootHtml = (pair, stats) => `
  <div class="gsr-foot">
    ${pair.num} ÷ ${pair.den} from LBMA daily closes, <code>${stats.spanStart.slice(0, 4)}</code>
    to present (${stats.points.toLocaleString()} sessions where both metals printed).
    Averages are trailing trading sessions, not calendar days. Not investment advice.
  </div>`;

/**
 * Full Layout C panel markup for one pair. A null stats object (empty series)
 * renders the token-styled empty state instead of crashing.
 * @param {object} pair - Active RATIO_PAIRS entry
 * @param {?object} stats - computeRatioStats result, or null
 * @param {boolean} live - Whether a live spot ratio is driving `current`
 * @param {string} [activeRange] - Active chart range key, default "90"
 * @returns {string} HTML for the .gsr-panel root
 */
const ratioPanelHtml = (pair, stats, live, activeRange = "90") => {
  if (!stats) {
    return (
      `<div class="gsr-panel gsr-empty" data-accent="${pair.accent}">` +
      `Historical ratio data is unavailable right now.</div>`
    );
  }
  return `<div class="gsr-panel" data-accent="${pair.accent}">
    ${ratioPanelHeaderHtml(pair, live)}
    ${ratioPanelHeroHtml(pair, stats)}
    ${ratioPanelRangeHtml(pair, stats)}
    ${ratioPanelTilesHtml(pair, stats)}
    ${ratioPanelChartHtml(activeRange)}
    ${ratioPanelFootHtml(pair, stats)}
  </div>`;
};

/**
 * Builds the ratio series source for the app host: every historicalDataCache
 * year flattened PLUS the live spotHistory rows. The overlay is mandatory —
 * the seed bundle pre-populates every cache year and fetchYearFile() returns
 * early for cached years, so the cache alone pins statistics to the last
 * bundled release. Same-date duplicates resolve to the later timestamp in
 * buildRatioSeries, so live observations win over seed rows automatically.
 * @returns {Array} Flat array of { spot, metal, timestamp } entries
 */
const ratioPanelSeriesSource = () => {
  const flat = [];
  const cache = typeof historicalDataCache !== "undefined" ? historicalDataCache : null;
  if (cache instanceof Map) {
    for (const yearEntries of cache.values()) {
      if (Array.isArray(yearEntries)) flat.push(...yearEntries);
    }
  }
  const liveRows =
    typeof spotHistory !== "undefined" && Array.isArray(spotHistory) ? spotHistory : [];
  return flat.concat(liveRows);
};

/**
 * Live spot ratio for a pair from the spotPrices global, or null when either
 * side is missing/non-positive (computeRatio guards).
 * @param {object} pair - RATIO_PAIRS entry
 * @returns {number|null}
 */
const ratioPanelLiveRatio = (pair) => {
  const prices = typeof spotPrices !== "undefined" ? spotPrices : null;
  if (!prices) return null;
  return computeRatio(prices[pair.num.toLowerCase()], prices[pair.den.toLowerCase()]);
};

/**
 * Mounts the shared ratios panel into a host element and wires pair/range
 * controls, chart drawing, and theme-change repaints. Both hosts (modal and
 * /ratios/ page) call exactly this.
 * @param {HTMLElement} mountEl - Host element the panel renders into
 * @param {{ initialPairId?: string }} [options] - Optional initial pair id (e.g. "au-pt")
 * @returns {?{ destroy: function(): void, selectPair: function(string): void }}
 *   Panel handle, or null when the mount element is unusable.
 */
const renderRatiosPanel = (mountEl, options = {}) => {
  if (typeof HTMLElement !== "undefined" && !(mountEl instanceof HTMLElement)) return null;

  const seriesCache = new Map();
  let activePair = RATIO_PAIRS.find((p) => p.id === options.initialPairId) || RATIO_PAIRS[0];
  let activeStats = null;
  let activeSeries = [];
  let liveActive = false;
  let activeRange = "90";
  let chart = null;

  /** Builds (memoized) series + stats for a pair and makes it active. */
  const selectPairInternal = (pair) => {
    if (!seriesCache.has(pair.id)) {
      seriesCache.set(pair.id, buildRatioSeries(ratioPanelSeriesSource(), pair.num, pair.den));
    }
    activeSeries = seriesCache.get(pair.id);
    const liveRatio = ratioPanelLiveRatio(pair);
    liveActive = liveRatio !== null;
    activeStats = computeRatioStats(activeSeries, liveRatio);
    activePair = pair;
  };

  /** Slices the active series to the requested range ("max" or a session count). */
  const rangeSlice = (range) =>
    range === "max" ? activeSeries : activeSeries.slice(-Number(range));

  /**
   * Resolves any CSS color expression (including color-mix) to the concrete
   * color the browser computes for it, via a throwaway style read on the
   * canvas. Canvas 2D fillStyle does not reliably parse CSS Level 4 color
   * functions, so Chart.js needs the resolved value, not the expression.
   * @param {HTMLElement} el - Attached element to resolve the style against
   * @param {string} cssColor - CSS color expression to resolve
   * @param {string} fallback - Color returned when resolution fails
   * @returns {string}
   */
  const resolveCssColor = (el, cssColor, fallback) => {
    el.style.color = cssColor;
    const resolved = getComputedStyle(el).color;
    el.style.color = "";
    return resolved || fallback;
  };

  /** Destroys and redraws the chart from computed tokens (theme-safe). */
  const drawChart = (range) => {
    const canvas = mountEl.querySelector(".gsr-canvas canvas");
    if (!canvas || typeof Chart === "undefined" || !activeStats) return;
    if (chart) chart.destroy();
    const rows = rangeSlice(range);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue(`--${activePair.accent}`).trim() || "#fbbf24";
    const gridColor = css.getPropertyValue("--border").trim() || "#333";
    const textColor = css.getPropertyValue("--text-muted").trim() || "#888";
    const fillColor = resolveCssColor(
      canvas,
      `color-mix(in oklch, ${accent}, transparent 88%)`,
      accent
    );
    // Long ranges: thin the points so Chart.js stays smooth.
    const step = Math.max(1, Math.ceil(rows.length / 420));
    const pts = rows.filter((_, i) => i % step === 0);
    const showMean = ratioMeanLineVisible(
      pts.map((p) => p[1]),
      activeStats.histMean
    );
    chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: pts.map((p) => p[0]),
        datasets: [
          {
            data: pts.map((p) => p[1]),
            borderColor: accent,
            backgroundColor: fillColor,
            borderWidth: 2,
            fill: true,
            pointRadius: 0,
            tension: 0.25,
          },
          ...(showMean
            ? [
                {
                  data: pts.map(() => activeStats.histMean),
                  borderColor: textColor,
                  borderWidth: 1,
                  borderDash: [4, 4],
                  pointRadius: 0,
                  fill: false,
                },
              ]
            : []),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          datalabels: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => items[0].label,
              label: (ctx) =>
                ctx.datasetIndex === 0
                  ? `${activePair.label} ${ratioPanelFmt(ctx.parsed.y, activePair.decimals + 1)}:1`
                  : `Mean ${ratioPanelFmt(ctx.parsed.y, activePair.decimals)}:1`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textColor, maxTicksLimit: 6, font: { size: 10 } },
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { size: 10 }, callback: (v) => `${v}:1` },
          },
        },
      },
    });
  };

  /** Renders the active pair and wires the in-panel controls. */
  const rerender = () => {
    // Internally generated markup only — numeric stats and fixed copy.
    mountEl.innerHTML = ratioPanelHtml(activePair, activeStats, liveActive, activeRange);
    mountEl.querySelectorAll(".gsr-pairs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = RATIO_PAIRS.find((p) => p.id === btn.dataset.pair);
        if (!next || next.id === activePair.id) return;
        selectPairInternal(next);
        rerender();
      });
    });
    mountEl.querySelectorAll(".gsr-tf button").forEach((btn) => {
      btn.addEventListener("click", () => {
        mountEl
          .querySelectorAll(".gsr-tf button")
          .forEach((other) => other.setAttribute("aria-pressed", String(other === btn)));
        activeRange = btn.dataset.r;
        drawChart(activeRange);
      });
    });
    drawChart(activeRange);
  };

  // Theme switches repaint the chart from freshly computed tokens (STAK-504
  // precedent); everything else re-colors via pure CSS.
  const themeObserver = new MutationObserver(() => drawChart(activeRange));
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  selectPairInternal(activePair);
  rerender();

  return {
    /** Unhooks observers, destroys the chart, and clears the mount. */
    destroy() {
      themeObserver.disconnect();
      if (chart) chart.destroy();
      chart = null;
      mountEl.innerHTML = "";
    },
    /** Switches the panel to a pair by id (no-op on unknown ids). */
    selectPair(pairId) {
      const next = RATIO_PAIRS.find((p) => p.id === pairId);
      if (!next) return;
      selectPairInternal(next);
      rerender();
    },
  };
};

// =============================================================================
// GLOBAL EXPOSURE (script-tag globals; hosts call renderRatiosPanel)
// =============================================================================
if (typeof window !== "undefined") {
  window.ratioPanelFmt = ratioPanelFmt;
  window.ratioPanelRatio = ratioPanelRatio;
  window.ratioPanelOrdinal = ratioPanelOrdinal;
  window.ratioTrendLabel = ratioTrendLabel;
  window.ratioMeanLineVisible = ratioMeanLineVisible;
  window.ratioPanelHtml = ratioPanelHtml;
  window.ratioPanelSeriesSource = ratioPanelSeriesSource;
  window.renderRatiosPanel = renderRatiosPanel;
}

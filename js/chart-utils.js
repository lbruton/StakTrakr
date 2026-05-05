/* chart-utils.js — Shared Chart.js configuration builders, dataset factories,
   formatters, and lifecycle helpers. Consolidates duplicated chart patterns from
   retail.js, retail-view-modal.js, spot.js, and others. (STAK-484) */

(function () {
  "use strict";

  /**
   * Create a minimal sparkline chart (no axes, no legend, no tooltip).
   * Replaces: retail.js:629-666, spot.js:760-790
   */
  const createSparkline = function (canvas, data, opts) {
    if (typeof Chart === "undefined") return null;
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    if (!Array.isArray(data) || data.length < 2) return null;

    const o = opts || {};
    const borderColor = o.borderColor || getThemeColor("primary");
    const borderWidth = o.borderWidth != null ? o.borderWidth : 1.5;
    const tension = o.tension != null ? o.tension : 0.3;

    return new Chart(canvas, {
      type: "line",
      data: {
        labels: Array(data.length).fill(""),
        datasets: [
          {
            data,
            borderColor,
            borderWidth,
            pointRadius: 0,
            tension,
            fill: false,
          },
        ],
      },
      options: {
        responsive: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
        animation: false,
      },
    });
  };

  /**
   * Build vendor-colored line datasets from vendor data.
   * Replaces: retail.js:1453-1494, retail.js:1590-1614,
   *           retail-view-modal.js:452-496, retail-view-modal.js:600-630
   */
  const buildVendorDatasets = function (vendors, dataRows, valueExtractor, opts) {
    if (!Array.isArray(vendors) || !Array.isArray(dataRows)) return [];

    const o = opts || {};
    const colorMap =
      o.colorMap ||
      (typeof window.RETAIL_VENDOR_COLORS !== "undefined" ? window.RETAIL_VENDOR_COLORS : {});
    const labelFn =
      o.labelFn ||
      function (vendorId) {
        return vendorId;
      };
    const borderWidth = o.borderWidth != null ? o.borderWidth : 1.5;
    const tension = o.tension != null ? o.tension : 0.3;
    const spanGaps = o.spanGaps != null ? o.spanGaps : true;
    const carriedIndices = o.carriedIndices || null;

    return vendors.map(function (vendorId, vendorIdx) {
      const color = colorMap[vendorId] || getThemeColor("text-muted");
      const carried = carriedIndices ? carriedIndices[vendorIdx] : null;

      return {
        label: labelFn(vendorId),
        data: dataRows.map(function (row) {
          return valueExtractor(row, vendorId);
        }),
        borderColor: color,
        backgroundColor: "transparent",
        borderWidth,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension,
        spanGaps,
        _carriedIndices: carried || null,
      };
    });
  };

  /**
   * Create a time-series line chart with standard options.
   * Replaces: retail.js:1524-1551, retail.js:1626-1651,
   *           retail-view-modal.js:498-539, retail-view-modal.js:633-660
   */
  const createTimeSeriesChart = function (canvas, labels, datasets, opts) {
    if (typeof Chart === "undefined") return null;
    if (!(canvas instanceof HTMLCanvasElement)) return null;

    const o = opts || {};
    const responsive = o.responsive != null ? o.responsive : true;
    const maintainAspectRatio = o.maintainAspectRatio != null ? o.maintainAspectRatio : false;
    const animation = o.animation != null ? o.animation : false;
    const showLegend = o.showLegend != null ? o.showLegend : false;
    const tooltipCallbacks = o.tooltipCallbacks || {};
    const xTicks = o.xTicks || {};
    const yTicks = o.yTicks || {};
    const interactionMode = o.interactionMode || "index";

    const config = {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive,
        maintainAspectRatio,
        interaction: { mode: interactionMode, intersect: false },
        plugins: {
          legend: { display: showLegend },
          tooltip: {},
        },
        scales: {
          x: { ticks: xTicks },
          y: { ticks: yTicks },
        },
        animation,
      },
    };

    if (Object.keys(tooltipCallbacks).length > 0) {
      config.options.plugins.tooltip.callbacks = tooltipCallbacks;
    }

    return new Chart(canvas, config);
  };

  /**
   * Destroy existing chart instance (if any), create new one, store in container.
   * Supports both Map (.has/.get/.set) and plain Object (in/bracket access).
   */
  const replaceChart = function (instanceMap, key, canvas, chartConfig) {
    const isMap = instanceMap instanceof Map;

    if (isMap) {
      if (instanceMap.has(key)) {
        const instance = instanceMap.get(key);
        if (instance && typeof instance.destroy === "function") {
          instance.destroy();
        }
      }
    } else if (instanceMap && key in instanceMap) {
      if (instanceMap[key] && typeof instanceMap[key].destroy === "function") {
        instanceMap[key].destroy();
      }
    }

    const chart = new Chart(canvas, chartConfig);

    if (isMap) {
      instanceMap.set(key, chart);
    } else if (instanceMap) {
      instanceMap[key] = chart;
    }

    return chart;
  };

  /**
   * Shared tooltip label formatter for price charts.
   * Handles: null -> "Out of stock", carried -> "~$X.XX", normal -> "$X.XX"
   */
  const chartPriceTooltip = function (opts) {
    const o = opts || {};
    const nullLabel = o.nullLabel != null ? o.nullLabel : "Out of stock";
    const carriedPrefix = o.carriedPrefix != null ? o.carriedPrefix : "~";
    const interpSuffix = o.interpSuffix != null ? o.interpSuffix : " (est.)";

    return function (ctx) {
      const label = ctx.dataset.label || "";
      const raw = ctx.raw;

      if (raw === null || raw === undefined) {
        return label + ": " + nullLabel;
      }

      const isCarried =
        ctx.dataset._carriedIndices && ctx.dataset._carriedIndices.has
          ? ctx.dataset._carriedIndices.has(ctx.dataIndex)
          : false;
      const isInterp = ctx.dataset._interp && ctx.dataset._interp[ctx.dataIndex];

      if (isCarried || isInterp) {
        return label + ": " + carriedPrefix + "$" + Number(raw).toFixed(2) + interpSuffix;
      }

      return label + ": $" + Number(raw).toFixed(2);
    };
  };

  /**
   * Y-axis dollar tick formatter.
   * Replaces: retail.js and retail-view-modal.js `$${Number(v).toFixed(0)}` patterns
   */
  const chartDollarTicks = function (decimals) {
    const d = decimals != null ? decimals : 0;
    return function (v) {
      return "$" + Number(v).toFixed(d);
    };
  };

  // Export all 6 functions via window.*
  window.createSparkline = createSparkline;
  window.buildVendorDatasets = buildVendorDatasets;
  window.createTimeSeriesChart = createTimeSeriesChart;
  window.replaceChart = replaceChart;
  window.chartPriceTooltip = chartPriceTooltip;
  window.chartDollarTicks = chartDollarTicks;
})();

// js/market-charts.js — Lightweight Charts v4 wrapper for Market Detail Modal (STAK-504)
// Renders per-vendor price comparison lines for a specific coin (slug).
// Data sources: /v2/retail/{slug}/intraday.json (24H) and /v2/retail/{slug}/history-30d.json (7D).
// NOTE: Uses v4 API (chart.addLineSeries) — NOT v5 (chart.addSeries(LineSeries)).

const getChartThemeColors = () => {
  const get = (token) =>
    typeof getThemeColorRGB === "function" ? getThemeColorRGB(token) : getThemeColor(token);
  return {
    bg: get("bg-card"),
    text: get("text-primary"),
    textMuted: get("text-muted"),
    border: get("border"),
    success: get("success"),
    danger: get("danger"),
    metals: {
      xau: get("gold"),
      xag: get("silver"),
      xpt: get("platinum"),
      xpd: get("palladium"),
    },
  };
};

// Shared chart configuration
const _chartConfig = (colors, timeVisible) => ({
  autoSize: true,
  layout: {
    background: { type: "solid", color: "transparent" },
    textColor: colors.textMuted,
    fontFamily: '"Geist", -apple-system, sans-serif',
    fontSize: 11,
    attributionLogo: false,
  },
  watermark: { visible: false },
  grid: {
    vertLines: { color: resolveColor(`color-mix(in srgb, ${colors.border} 25%, transparent)`) },
    horzLines: { color: resolveColor(`color-mix(in srgb, ${colors.border} 25%, transparent)`) },
  },
  timeScale: {
    borderColor: colors.border,
    timeVisible: !!timeVisible,
    secondsVisible: false,
    fixLeftEdge: true,
    fixRightEdge: true,
    rightOffset: 0,
  },
  rightPriceScale: { borderColor: colors.border },
  crosshair: {
    mode: LightweightCharts.CrosshairMode ? LightweightCharts.CrosshairMode.Normal : 0,
  },
});

// Fit chart content after next animation frame (container must be laid out first)
const _fitAfterLayout = (chart) => {
  requestAnimationFrame(() => {
    try {
      chart.timeScale().fitContent();
    } catch (e) {
      /* noop */
    }
  });
};

// Short vendor name for legend
const _shortName = (vid) => {
  const map = {
    apmex: "APMEX",
    jmbullion: "JM",
    sdbullion: "SD",
    monumentmetals: "Monument",
    herobullion: "Hero",
    bullionexchanges: "BullionX",
    summitmetals: "Summit",
    gainesvillecoins: "Gville",
    providentmetals: "Provident",
    goldback: "Goldback",
  };
  return map[vid] || vid;
};

/**
 * Create a multi-vendor line chart from retail intraday data (24H).
 * Data format: [{ t, ts, median, low, vendors: { vid: price, ... } }, ...]
 */
const createVendorIntradayChart = (containerId, intradayRows, vendorMeta) => {
  if (typeof LightweightCharts === "undefined") return null;
  const container = document.getElementById(containerId);
  if (!container || !intradayRows || !Array.isArray(intradayRows) || intradayRows.length === 0)
    return null;

  const colors = getChartThemeColors();
  const chart = LightweightCharts.createChart(container, _chartConfig(colors, true));

  try {
    // Collect all vendor IDs across all windows
    const vendorIds = new Set();
    for (const row of intradayRows) {
      if (row.vendors) {
        for (const vid in row.vendors) vendorIds.add(vid);
      }
    }

    // Create one line series per vendor (v4 API: chart.addLineSeries)
    for (const vid of vendorIds) {
      const vMeta = vendorMeta && vendorMeta[vid];
      const color = (vMeta && vMeta.color) || colors.textMuted;
      const series = chart.addLineSeries({
        color: color,
        lineWidth: 2,
        crosshairMarkerVisible: true,
        priceLineVisible: false,
        lastValueVisible: false,
        title: _shortName(vid),
      });
      const data = [];
      for (const row of intradayRows) {
        const ts = row.ts || (row.t ? Math.floor(new Date(row.t).getTime() / 1000) : null);
        const price = row.vendors && row.vendors[vid];
        if (!ts || price == null || price <= 0) continue;
        data.push({ time: ts, value: price });
      }
      if (data.length > 0) series.setData(data);
    }

    _fitAfterLayout(chart);
  } catch (e) {
    debugLog("[market-charts] Intraday vendor chart error: " + e.message, "warn");
  }

  return chart;
};

/**
 * Create a multi-vendor line chart from retail 30d history (filtered to last 7 days).
 * Data format: [{ t, ts, ..., vendors: { vid: { avg, in_stock } } }, ...]
 */
const createVendorHistoryChart = (containerId, historyRows, vendorMeta) => {
  if (typeof LightweightCharts === "undefined") return null;
  const container = document.getElementById(containerId);
  if (!container || !historyRows || !Array.isArray(historyRows) || historyRows.length === 0)
    return null;

  const colors = getChartThemeColors();
  const chart = LightweightCharts.createChart(container, _chartConfig(colors, false));

  try {
    const rows = historyRows.slice(-7);

    // Collect all vendor IDs
    const vendorIds = new Set();
    for (const row of rows) {
      if (row.vendors) {
        for (const vid in row.vendors) vendorIds.add(vid);
      }
    }

    // Create one line series per vendor (v4 API: chart.addLineSeries)
    for (const vid of vendorIds) {
      const vMeta = vendorMeta && vendorMeta[vid];
      const color = (vMeta && vMeta.color) || colors.textMuted;
      const series = chart.addLineSeries({
        color: color,
        lineWidth: 2,
        crosshairMarkerVisible: true,
        priceLineVisible: false,
        lastValueVisible: false,
        title: _shortName(vid),
      });
      const data = [];
      for (const row of rows) {
        if (!row.t) continue;
        const day = row.t.split("T")[0];
        const vData = row.vendors && row.vendors[vid];
        const price = vData ? (typeof vData === "number" ? vData : vData.avg) : null;
        if (price == null || price <= 0) continue;
        data.push({ time: day, value: price });
      }
      if (data.length > 0) series.setData(data);
    }

    _fitAfterLayout(chart);
  } catch (e) {
    debugLog("[market-charts] History vendor chart error: " + e.message, "warn");
  }

  return chart;
};

const destroyCoinChart = (chart) => {
  if (chart) {
    try {
      chart.remove();
    } catch (e) {
      /* noop */
    }
  }
};

if (typeof window !== "undefined") {
  window.getChartThemeColors = getChartThemeColors;
  window.createVendorIntradayChart = createVendorIntradayChart;
  window.createVendorHistoryChart = createVendorHistoryChart;
  window.destroyCoinChart = destroyCoinChart;
}

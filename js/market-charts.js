// js/market-charts.js — Lightweight Charts wrapper for Market Detail Modal (STAK-504)
// Provides theme-aware chart creation for the per-coin detail view.

const getChartThemeColors = () => {
  const s = getComputedStyle(document.documentElement);
  const get = (p) => s.getPropertyValue(p).trim();
  return {
    bg: get('--bg-card'),
    text: get('--text-primary'),
    textMuted: get('--text-muted'),
    border: get('--border'),
    success: get('--success'),
    danger: get('--danger'),
    metals: {
      xau: get('--gold'), xag: get('--silver'),
      xpt: get('--platinum'), xpd: get('--palladium'),
    }
  };
};

// Shared chart configuration builder
const _chartConfig = (colors) => ({
  autoSize: true,
  layout: {
    background: { type: 'solid', color: 'transparent' },
    textColor: colors.textMuted,
    fontFamily: '"Inter", -apple-system, sans-serif',
    fontSize: 11,
  },
  watermark: { visible: false },
  grid: {
    vertLines: { color: colors.border + '40' },
    horzLines: { color: colors.border + '40' },
  },
  rightPriceScale: { borderColor: colors.border },
  crosshair: { mode: LightweightCharts.CrosshairMode ? LightweightCharts.CrosshairMode.Normal : 0 },
});

// Shared area series options builder
const _areaOpts = (metalColor) => ({
  lineColor: metalColor,
  topColor: metalColor + '4D',
  bottomColor: metalColor + '0D',
  lineWidth: 2,
  crosshairMarkerVisible: true,
  priceLineVisible: false,
  lastValueVisible: true,
});

// 7-day spot history chart (daily data points, date strings on x-axis)
const createCoinChart = (containerId, metalCode, historyOverride) => {
  if (typeof LightweightCharts === 'undefined') return null;

  const container = document.getElementById(containerId);
  if (!container) return null;

  const colors = getChartThemeColors();
  const metalColor = colors.metals[metalCode] || colors.text;

  const config = _chartConfig(colors);
  config.timeScale = { borderColor: colors.border, timeVisible: false };
  const chart = LightweightCharts.createChart(container, config);

  // Use passed history data first, fall back to localStorage cache
  const history = historyOverride || loadDataSync('v2SpotHistory', null);
  if (history) {
    try {
      const payload = history.data ? history.data : history;
      const rows = payload && payload[metalCode] ? payload[metalCode] : null;
      if (rows && Array.isArray(rows) && rows.length > 0) {
        const series = chart.addSeries(LightweightCharts.AreaSeries, _areaOpts(metalColor));
        const seen = {};
        const data = [];
        for (const r of rows) {
          if (!r.t || r.close == null) continue;
          const day = r.t.split('T')[0];
          if (seen[day]) continue;
          seen[day] = true;
          data.push({ time: day, value: r.close });
        }
        if (data.length > 0) {
          series.setData(data);
          chart.timeScale().fitContent();
        }
      }
    } catch (e) {
      debugLog('[market-charts] Failed to parse spot history: ' + e.message, 'warn');
    }
  }

  return chart;
};

// 24-hour intraday spot chart (15-min data points, Unix timestamps on x-axis)
const createIntradayChart = (containerId, metalCode, intradayData) => {
  if (typeof LightweightCharts === 'undefined') return null;

  const container = document.getElementById(containerId);
  if (!container) return null;

  const colors = getChartThemeColors();
  const metalColor = colors.metals[metalCode] || colors.text;

  const config = _chartConfig(colors);
  config.timeScale = {
    borderColor: colors.border,
    timeVisible: true,
    secondsVisible: false,
  };
  const chart = LightweightCharts.createChart(container, config);

  if (intradayData) {
    try {
      const rows = Array.isArray(intradayData) ? intradayData
        : (intradayData.data ? intradayData.data : null);
      if (rows && Array.isArray(rows) && rows.length > 0) {
        const series = chart.addSeries(LightweightCharts.AreaSeries, _areaOpts(metalColor));
        const data = [];
        for (const r of rows) {
          const ts = r.ts || (r.t ? Math.floor(new Date(r.t).getTime() / 1000) : null);
          const val = r.close != null ? r.close : r.avg != null ? r.avg : null;
          if (!ts || val == null) continue;
          data.push({ time: ts, value: val });
        }
        if (data.length > 0) {
          series.setData(data);
          chart.timeScale().fitContent();
        }
      }
    } catch (e) {
      debugLog('[market-charts] Failed to parse intraday data: ' + e.message, 'warn');
    }
  }

  return chart;
};

const destroyCoinChart = (chart) => {
  if (chart) { try { chart.remove(); } catch (e) { /* noop */ } }
};

if (typeof window !== 'undefined') {
  window.getChartThemeColors = getChartThemeColors;
  window.createCoinChart = createCoinChart;
  window.createIntradayChart = createIntradayChart;
  window.destroyCoinChart = destroyCoinChart;
}

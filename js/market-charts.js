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

const createCoinChart = (containerId, metalCode) => {
  if (typeof LightweightCharts === 'undefined') return null;

  const container = document.getElementById(containerId);
  if (!container) return null;

  const colors = getChartThemeColors();
  const metalColor = colors.metals[metalCode] || colors.text;

  const chart = LightweightCharts.createChart(container, {
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
    timeScale: { borderColor: colors.border, timeVisible: false },
    rightPriceScale: { borderColor: colors.border },
    crosshair: { mode: LightweightCharts.CrosshairMode ? LightweightCharts.CrosshairMode.Normal : 0 },
  });

  const historyRaw = localStorage.getItem('v2SpotHistory');
  if (historyRaw) {
    try {
      const history = JSON.parse(historyRaw);
      const rows = history && history[metalCode] ? history[metalCode] : null;
      if (rows && Array.isArray(rows) && rows.length > 0) {
        const series = chart.addSeries(LightweightCharts.AreaSeries, {
          lineColor: metalColor,
          topColor: metalColor + '4D',
          bottomColor: metalColor + '0D',
          lineWidth: 2,
          crosshairMarkerVisible: true,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        const data = rows.map(r => ({ time: r.t.split('T')[0], value: r.close }));
        series.setData(data);
        chart.timeScale().fitContent();
      }
    } catch (e) {
      debugLog('[market-charts] Failed to parse spot history: ' + e.message, 'warn');
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
  window.destroyCoinChart = destroyCoinChart;
}

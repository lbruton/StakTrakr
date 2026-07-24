// js/market-charts.js — Lightweight Charts v4 wrapper for Market Detail Modal (STAK-504)
// Renders per-vendor price comparison lines for a specific coin (slug).
// Data sources: normalized 24H, 7D, 30D, 60D, and 90D Retail View range models.
// NOTE: Uses v4 API (chart.addLineSeries) — NOT v5 (chart.addSeries(LineSeries)).

const _marketChartContainers = new WeakMap();

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

/**
 * Build shared Lightweight Charts options for Vendor range charts.
 * @param {Object} colors - Active theme colors.
 * @param {boolean} timeVisible - Whether the intraday time scale shows times.
 * @param {Object} currencyContext - Active display-currency context.
 * @returns {Object} Lightweight Charts v4 options.
 */
const _chartConfig = (colors, timeVisible, currencyContext) => ({
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
  localization: {
    priceFormatter: currencyContext.formatDisplayValue,
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
 * Build one-time conversion and formatting behavior for the active display
 * currency. The formatter receives values that have already been converted.
 * @returns {{code:string,rate:number,formatDisplayValue:function(number):string}}
 */
const _getMarketChartCurrencyContext = () => {
  const code =
    typeof displayCurrency !== "undefined" && displayCurrency
      ? String(displayCurrency).toUpperCase()
      : "USD";
  const exchangeRate = typeof getExchangeRate === "function" ? Number(getExchangeRate(code)) : 1;
  const rate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
  let formatter = null;
  try {
    formatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    });
  } catch (e) {
    formatter = null;
  }

  /**
   * Format a numeric value that is already in the active display currency.
   * @param {number} displayValue - Already-converted display value.
   * @returns {string} Currency label.
   */
  const formatDisplayValue = (displayValue) => {
    const numericValue = Number(displayValue);
    if (!Number.isFinite(numericValue)) return "";
    return formatter ? formatter.format(numericValue) : `${code} ${numericValue.toFixed(2)}`;
  };

  return { code, rate, formatDisplayValue };
};

/**
 * Clear a dedicated Market Detail chart container after failed construction or
 * removal so a partial Lightweight Charts root cannot survive.
 * @param {HTMLElement} container - Dedicated chart container.
 * @returns {void}
 */
const _clearMarketChartContainer = (container) => {
  if (container instanceof HTMLElement) container.textContent = "";
};

/**
 * Create a multi-Vendor line chart from a normalized range model.
 * @param {string} containerId - Target chart container ID.
 * @param {Object} rangeModel - Normalized date-bounded range model.
 * @param {Object} vendorMeta - Vendor metadata keyed by ID.
 * @param {Object} currencyContext - Active display-currency context.
 * @param {boolean} timeVisible - Whether the time scale shows intraday times.
 * @returns {(Object|null)} Lightweight Charts instance, or null.
 */
const _createVendorRangeChart = (
  containerId,
  rangeModel,
  vendorMeta,
  currencyContext,
  timeVisible
) => {
  if (typeof LightweightCharts === "undefined") return null;
  const container = safeGetElement(containerId);
  if (!(container instanceof HTMLElement)) return null;

  const isNormalizedRangeModel =
    rangeModel &&
    typeof rangeModel === "object" &&
    !Array.isArray(rangeModel) &&
    typeof rangeModel.periodId === "string" &&
    Number.isFinite(rangeModel.startMs) &&
    Number.isFinite(rangeModel.endMs) &&
    rangeModel.startMs <= rangeModel.endMs &&
    rangeModel.intraday === timeVisible &&
    Array.isArray(rangeModel.observations) &&
    Array.isArray(rangeModel.series) &&
    rangeModel.hasChartData === true;
  if (!isNormalizedRangeModel || rangeModel.series.length === 0) return null;

  const validSeries = rangeModel.series.filter(
    (vendorSeries) =>
      vendorSeries &&
      typeof vendorSeries.vendorId === "string" &&
      vendorSeries.vendorId.length > 0 &&
      Array.isArray(vendorSeries.points) &&
      vendorSeries.points.length > 0 &&
      vendorSeries.points.every(
        (point) =>
          point &&
          Number.isFinite(point.usdPrice) &&
          point.usdPrice > 0 &&
          (timeVisible
            ? Number.isFinite(point.time) && point.time > 0
            : /^\d{4}-\d{2}-\d{2}$/.test(point.time))
      )
  );
  if (validSeries.length !== rangeModel.series.length) return null;

  const colors = getChartThemeColors();
  const context = currencyContext || _getMarketChartCurrencyContext();
  let chart = null;

  try {
    chart = LightweightCharts.createChart(container, _chartConfig(colors, timeVisible, context));
    _marketChartContainers.set(chart, container);

    for (const vendorSeries of validSeries) {
      const vendorId = vendorSeries.vendorId;
      const vMeta = vendorMeta && vendorMeta[vendorId];
      const series = chart.addLineSeries({
        color: (vMeta && vMeta.color) || colors.textMuted,
        lineWidth: 2,
        crosshairMarkerVisible: true,
        priceLineVisible: false,
        lastValueVisible: false,
        title: _shortName(vendorId),
      });
      series.setData(
        vendorSeries.points.map((point) => ({
          time: point.time,
          value: point.usdPrice * context.rate,
        }))
      );
    }

    _fitAfterLayout(chart);
  } catch (e) {
    debugLog("[market-charts] Vendor range chart error: " + e.message, "warn");
    if (chart) destroyCoinChart(chart);
    _clearMarketChartContainer(container);
    return null;
  }

  return chart;
};

/**
 * Create a multi-Vendor chart for normalized intraday observations.
 * @param {string} containerId - Target chart container ID.
 * @param {Object} rangeModel - Normalized date-bounded intraday model.
 * @param {Object} vendorMeta - Vendor metadata keyed by ID.
 * @param {Object} [currencyContext] - Active display-currency context.
 * @returns {(Object|null)} Lightweight Charts instance, or null.
 */
const createVendorIntradayChart = (
  containerId,
  rangeModel,
  vendorMeta,
  currencyContext = _getMarketChartCurrencyContext()
) => _createVendorRangeChart(containerId, rangeModel, vendorMeta, currencyContext, true);

/**
 * Create a multi-Vendor chart for normalized daily observations.
 * @param {string} containerId - Target chart container ID.
 * @param {Object} rangeModel - Normalized date-bounded daily model.
 * @param {Object} vendorMeta - Vendor metadata keyed by ID.
 * @param {Object} [currencyContext] - Active display-currency context.
 * @returns {(Object|null)} Lightweight Charts instance, or null.
 */
const createVendorHistoryChart = (
  containerId,
  rangeModel,
  vendorMeta,
  currencyContext = _getMarketChartCurrencyContext()
) => _createVendorRangeChart(containerId, rangeModel, vendorMeta, currencyContext, false);

/**
 * Remove a Lightweight Charts instance and its DOM root.
 * @param {Object|null} chart - Chart instance to remove.
 * @returns {void}
 */
const destroyCoinChart = (chart) => {
  if (!chart) return;
  const isChartObject = typeof chart === "object" || typeof chart === "function";
  const container = isChartObject ? _marketChartContainers.get(chart) : null;

  try {
    if (typeof chart.remove === "function") chart.remove();
  } catch (e) {
    debugLog("[market-charts] Vendor chart removal error: " + e.message, "warn");
  } finally {
    _clearMarketChartContainer(container);
    if (isChartObject) _marketChartContainers.delete(chart);
  }
};

if (typeof window !== "undefined") {
  window.getChartThemeColors = getChartThemeColors;
  window.createVendorIntradayChart = createVendorIntradayChart;
  window.createVendorHistoryChart = createVendorHistoryChart;
  window.destroyCoinChart = destroyCoinChart;
}

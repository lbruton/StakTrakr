// =============================================================================
// PORTFOLIO SERIES — pure series math for the metal detail modal (STRK-352)
//
// Builds the day-indexed holdings series (melt + cost basis, backdated to the
// first dated acquisition) and the flow-adjusted window statistics that feed
// the detail modal's hero chart and substrip. Pure functions only: no DOM, no
// globals mutated — everything is a function of its inputs, so the whole file
// is unit-testable under Node (tests/unit/portfolio-series.test.js).
//
// Contract source: DocVault sketch STRK-352 requirements.md AC-5..AC-8, AC-15
// and approach.md layer 1 (series boundaries, baseline day, fill rules).
// =============================================================================

/**
 * Build the portfolio series for a scope.
 *
 * @param {Array<object>} items - Inventory Items (active AND disposed; the
 *   fold applies each Item's [acquisition, disposition) holding interval).
 * @param {Object<string, Map<string, number>>} spotDayMaps - Per-metal maps of
 *   "YYYY-MM-DD" day key → spot USD/ozt raw samples (gaps unfilled; filling is
 *   this module's job).
 * @param {string} scope - "All" or a metal display name ("Silver"…"Copper").
 * @param {Object<string, number>} todaySpotPrices - Live spot by lowercase
 *   metal key; the final series day is valued at these, not the day-map close.
 * @returns {{days: string[], melt: number[], basis: number[],
 *   buys: Array<object>, baseline: object|null}} Day-aligned series arrays,
 *   grouped acquisition markers, and the synthetic pre-series baseline day.
 */
const buildPortfolioSeries = (items, spotDayMaps, scope, todaySpotPrices) => {
  return { days: [], melt: [], basis: [], buys: [], baseline: null };
};

/**
 * Compute flow-adjusted statistics for a visible window of a built series.
 *
 * @param {object} series - Result of buildPortfolioSeries.
 * @param {string} windowStartKey - "YYYY-MM-DD" first visible day.
 * @returns {{market: number, marketPct: number|null, invested: number,
 *   buyCount: number, paceOzPerMonth: number|null}} Window stats; marketPct is
 *   null when the end-of-window basis is 0, pace is null for the All scope.
 */
const computeWindowStats = (series, windowStartKey) => {
  return { market: 0, marketPct: null, invested: 0, buyCount: 0, paceOzPerMonth: null };
};

/**
 * Select and order the active Items for the modal's acquisitions ledger.
 *
 * @param {Array<object>} items - Inventory Items.
 * @param {string} scope - "All" or a metal display name.
 * @returns {Array<object>} Active Items in scope, acquisition date descending,
 *   undated Items last.
 */
const pickLedgerRows = (items, scope) => {
  return [];
};

// Expose for browser consumers (script-tag global scope)
if (typeof window !== "undefined") {
  window.buildPortfolioSeries = buildPortfolioSeries;
  window.computeWindowStats = computeWindowStats;
  window.pickLedgerRows = pickLedgerRows;
}

// Node export for unit tests (mirrors js/utils.js pattern)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildPortfolioSeries,
    computeWindowStats,
    pickLedgerRows,
  };
}

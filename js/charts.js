// CHART UTILITIES
// =============================================================================
// STRK-352 retired the legacy pie stack (createPieChart, generateColors,
// getChartColors, destroyCharts) with the details-modal redesign — every
// caller died with the old modal. The theme-aware color getters below remain
// live consumers' contract (viewModal, card-view, retail-view-modal).

/**
 * Gets appropriate background color for charts based on current theme
 *
 * @returns {string} Background color
 */
const getChartBackgroundColor = () => getThemeColorRGB("bg-primary");

/**
 * Gets appropriate text color for charts based on current theme
 *
 * @returns {string} Text color
 */
const getChartTextColor = () => getThemeColorRGB("text-primary");

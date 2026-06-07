// SPOT-CARD RATIO CHIPS (STRK-161)
// =============================================================================
// Pure display layer that renders a per-spot-card ratio chip (e.g. Au:Ag) plus
// a goldback rate chip, with a position:fixed tooltip singleton. Owns the
// ratio/goldback math, freshness/estimate resolution, and the idempotent
// renderRatioChips() choke point invoked from every spot/goldback DOM-write path.
//
// NOTE: These are STUBS only — scaffold for STRK-161 (Task A.3). They return
// undefined / are no-ops by design so the TDD tests fail RED. The real logic
// lands in Cohort C. Do not add behavior here.
// =============================================================================

/**
 * Computes a spot-price ratio (numerator ÷ denominator).
 * STUB — real logic in Cohort C.
 * @param {number} numeratorSpot - Numerator spot price (e.g. gold)
 * @param {number} denominatorSpot - Denominator spot price (e.g. silver)
 * @returns {undefined}
 */
const computeRatio = (numeratorSpot, denominatorSpot) => {};

/**
 * Formats a ratio value to a fixed number of decimals for chip display.
 * STUB — real logic in Cohort C.
 * @param {number} value - Ratio value to format
 * @param {number} decimals - Number of decimal places
 * @returns {undefined}
 */
const formatRatio = (value, decimals) => {};

/**
 * Resolves the active goldback G1 rate, will later return {value, est} or null.
 * STUB — real logic in Cohort C.
 * @returns {undefined}
 */
const resolveGoldbackRate = () => {};

/**
 * Returns whether a cached goldback entry is stale ((now − data.ts) > stale_after).
 * STUB — real logic in Cohort C.
 * @param {object} entry - Cached goldback entry
 * @returns {undefined}
 */
const isGoldbackStale = (entry) => {};

/**
 * Idempotent choke point: creates/updates/removes the ratio chip on every spot card.
 * STUB — real logic in Cohort C.
 * @returns {undefined}
 */
const renderRatioChips = () => {};

/**
 * Renders (or removes) the ratio chip for a single metal card.
 * STUB — real logic in Cohort C.
 * @param {string} metalKey - Spot metal key (e.g. "silver", "platinum")
 * @returns {undefined}
 */
const renderRatioChip = (metalKey) => {};

// =============================================================================
// GLOBAL EXPOSURE
// =============================================================================
if (typeof window !== "undefined") {
  window.computeRatio = computeRatio;
  window.formatRatio = formatRatio;
  window.resolveGoldbackRate = resolveGoldbackRate;
  window.isGoldbackStale = isGoldbackStale;
  window.renderRatioChips = renderRatioChips;
  window.renderRatioChip = renderRatioChip;
}

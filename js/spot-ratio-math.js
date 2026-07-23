// SPOT-CARD RATIO MATH (STRK-161)
// =============================================================================
// Pure ratio + goldback-rate math and freshness/estimate resolution for the spot
// ratio chips. No DOM. Split out from spot-ratio-chips.js (the render layer) so
// each file stays within the Codacy per-file complexity gate. MUST load BEFORE
// spot-ratio-chips.js. Reads bare goldback/spot globals so the same code resolves
// in both the unit harness and the browser.
// =============================================================================

/**
 * Computes a spot-price ratio (numerator ÷ denominator).
 * @param {number} numeratorSpot - Numerator spot price (e.g. gold)
 * @param {number} denominatorSpot - Denominator spot price (e.g. silver)
 * @returns {number|null} The ratio, or null when either input is ≤ 0 or non-finite.
 */
const computeRatio = (numeratorSpot, denominatorSpot) => {
  if (!Number.isFinite(numeratorSpot) || !Number.isFinite(denominatorSpot)) return null;
  if (numeratorSpot <= 0 || denominatorSpot <= 0) return null;
  return numeratorSpot / denominatorSpot;
};

/**
 * Formats a ratio value to a fixed number of decimals for chip display.
 * @param {number} value - Ratio value to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} Fixed-decimal string (e.g. "63.8", "2.43").
 */
const formatRatio = (value, decimals) => {
  return Number(value).toFixed(decimals);
};

/**
 * Returns whether a cached goldback entry is stale: (now − entry.ts) > entry.staleAfter.
 * The boundary (difference === staleAfter) is NOT stale (strictly greater).
 * @param {object} entry - Cached goldback entry with { ts, staleAfter }
 * @returns {boolean}
 */
const isGoldbackStale = (entry) => {
  if (!entry || typeof entry.ts !== "number" || typeof entry.staleAfter !== "number") {
    return true;
  }
  // entry.ts is a unix timestamp in SECONDS and staleAfter is a seconds budget
  // (the goldback/latest.json envelope contract) — compare in seconds, not ms.
  return Math.floor(Date.now() / 1000) - entry.ts > entry.staleAfter;
};

/**
 * Returns the fresh cached G1 price (> 0), or null when the cache entry is
 * absent/stale or has no positive price. Reads bare goldback globals.
 * @returns {number|null}
 */
const readFreshCachedGoldback = () => {
  // goldbackPrices and getGoldbackDenominationPrice are declared in state.js /
  // goldback.js, both loaded (deferred) before this file — read them bare.
  const cacheEntry = goldbackPrices["1"];
  if (!cacheEntry || isGoldbackStale(cacheEntry)) return null;
  const cached = getGoldbackDenominationPrice(1);
  return typeof cached === "number" && cached > 0 ? cached : null;
};

/**
 * Selects the G1 rate to seed the market-data premium chip before the network
 * fetch resolves. Reads the same bare goldback globals as readFreshCachedGoldback.
 *   - online  → the fresh + positive cached G1 (readFreshCachedGoldback), else
 *     null; never seed a stale value while online.
 *   - offline → the last-known G1 (getGoldbackDenominationPrice(1) when > 0) even
 *     when stale, returned plain (no marker), preserving the offline display.
 * The > 0 guard is mandatory and independent of staleness: a non-positive G1
 * offline still returns null.
 * @param {boolean} isOnline - Whether the app currently has connectivity.
 * @returns {number|null}
 */
const selectGoldbackG1Seed = (isOnline) => {
  if (isOnline) return readFreshCachedGoldback();
  const lastKnown = getGoldbackDenominationPrice(1);
  return typeof lastKnown === "number" && lastKnown > 0 ? lastKnown : null;
};

/**
 * Returns the spot-derived goldback estimate (> 0), or null. Reads bare globals.
 * @returns {number|null}
 */
const readGoldbackSpotEstimate = () => {
  // spotPrices (state.js) and computeGoldbackEstimatedRate (goldback.js) load
  // before this file — read them bare.
  const gold = spotPrices.gold;
  if (!Number.isFinite(gold) || gold <= 0) return null;
  const estimate = computeGoldbackEstimatedRate(gold);
  return typeof estimate === "number" && estimate > 0 ? estimate : null;
};

/**
 * Resolves the active goldback G1 rate for the gold card chip. Reads bare globals
 * so the same code resolves in both the unit harness and the browser.
 *   - mode "off"              → null
 *   - fresh cache             → { value: <cached G1>, est: false }
 *   - stale + "spot"/"manual" → { value: spot estimate, est: true }
 *   - stale + "api"           → null
 * @returns {{ value: number, est: boolean } | null}
 */
const resolveGoldbackRate = () => {
  // goldbackPricingSource (goldback.js, default "api") loads before this file.
  const mode = goldbackPricingSource;
  if (mode === "off") return null;

  const fresh = readFreshCachedGoldback();
  if (fresh !== null) return { value: fresh, est: false };

  if (mode === "spot" || mode === "manual") {
    const estimate = readGoldbackSpotEstimate();
    if (estimate !== null) return { value: estimate, est: true };
  }
  return null;
};

// =============================================================================
// GLOBAL EXPOSURE (script-tag globals; spot-ratio-chips.js reads these bare)
// =============================================================================
if (typeof window !== "undefined") {
  window.computeRatio = computeRatio;
  window.formatRatio = formatRatio;
  window.isGoldbackStale = isGoldbackStale;
  window.readFreshCachedGoldback = readFreshCachedGoldback;
  window.selectGoldbackG1Seed = selectGoldbackG1Seed;
  window.resolveGoldbackRate = resolveGoldbackRate;
}

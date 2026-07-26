// SPOT-CARD RATIO MATH (STRK-161) + RATIO STATISTICS ENGINE (STRK-269)
// =============================================================================
// Pure ratio + goldback-rate math and freshness/estimate resolution for the spot
// ratio chips, plus the pair config / series builder / statistics engine that
// feeds the STRK-268 ratios panel. No DOM. Split out from spot-ratio-chips.js
// (the render layer) so each file stays within the Codacy per-file complexity
// gate. MUST load BEFORE spot-ratio-chips.js. Reads bare goldback/spot globals
// so the same code resolves in both the unit harness and the browser.
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
// RATIO SERIES + STATISTICS ENGINE (STRK-269)
// =============================================================================
// Foundation for the STRK-268 ratios panel. In the app host, source the series
// from `historicalDataCache` (populated by js/spot.js and refreshed by
// fetchYearFile()), NOT the raw seed bundle — reading the bundle directly would
// silently pin statistics to the last release.

/** @constant {number} Trading sessions per year (~261); 5Y windows use 5×. */
const RATIO_SESSIONS_PER_YEAR = 261;

/**
 * Supported ratio pairs for the ratios panel, in display order. `num`/`den` are
 * historical-bundle metal keys, `numSym`/`denSym` are live-spot symbols, and
 * `accent` always follows the DENOMINATOR metal (the thing being priced
 * against). `interpretive` gates the plain-English "what this means" line: only
 * Au:Ag carries a century of mean-reversion context worth narrating — Pt/Pd
 * repriced structurally, so a "cheap vs dear" verdict there would be unearned.
 * @type {Array<{id: string, label: string, num: string, den: string,
 *   numSym: string, denSym: string, accent: string, decimals: number,
 *   interpretive: boolean, title: string}>}
 */
const RATIO_PAIRS = [
  {
    id: "au-ag",
    label: "Au:Ag",
    num: "Gold",
    den: "Silver",
    numSym: "xau",
    denSym: "xag",
    accent: "silver",
    decimals: 1,
    interpretive: true,
    title: "How many ounces of silver buy one ounce of gold",
  },
  {
    id: "au-pt",
    label: "Au:Pt",
    num: "Gold",
    den: "Platinum",
    numSym: "xau",
    denSym: "xpt",
    accent: "platinum",
    decimals: 2,
    interpretive: false,
    title: "How many ounces of platinum buy one ounce of gold",
  },
  {
    id: "au-pd",
    label: "Au:Pd",
    num: "Gold",
    den: "Palladium",
    numSym: "xau",
    denSym: "xpd",
    accent: "palladium",
    decimals: 2,
    interpretive: false,
    title: "How many ounces of palladium buy one ounce of gold",
  },
  {
    id: "pt-pd",
    label: "Pt:Pd",
    num: "Platinum",
    den: "Palladium",
    numSym: "xpt",
    denSym: "xpd",
    accent: "palladium",
    decimals: 2,
    interpretive: false,
    title: "How many ounces of palladium buy one ounce of platinum",
  },
];

/**
 * Flattens a ratio-series source into a single entries array. Accepts the
 * historicalDataCache shape (Map<year, entries[]>) or an already-flat array.
 * @param {Map<number, Array>|Array|*} source - Cache map, flat entries array, or junk
 * @returns {Array} Flat array of cache entries (possibly empty)
 */
const flattenRatioSource = (source) => {
  if (source instanceof Map) {
    const flat = [];
    for (const yearEntries of source.values()) {
      if (Array.isArray(yearEntries)) flat.push(...yearEntries);
    }
    return flat;
  }
  return Array.isArray(source) ? source : [];
};

/**
 * Returns whether a cache-entry spot value is a usable close: a finite number
 * strictly greater than zero. Excludes zero, negatives, NaN, Infinity, and
 * non-number types (e.g. numeric strings) so no NaN can leak into statistics.
 * @param {*} spot - Candidate spot price
 * @returns {boolean}
 */
const isUsableClose = (spot) => typeof spot === "number" && Number.isFinite(spot) && spot > 0;

/**
 * Builds an ascending [isoDate, ratio] series for a metal pair from cache
 * entries ({ spot, metal, timestamp: "YYYY-MM-DD hh:mm:ss" }). A point is
 * emitted ONLY where BOTH metals printed a usable close, so a pair whose metals
 * start in different years self-truncates correctly (Pt/Pd begin 1990; Au/Ag
 * begin 1968) with no date-range special-casing. When one metal has multiple
 * closes on the same date, the later timestamp wins (live data over seed).
 * @param {Map<number, Array>|Array} source - historicalDataCache map or flat entries array
 * @param {string} numMetal - Numerator bundle metal key (e.g. "Gold")
 * @param {string} denMetal - Denominator bundle metal key (e.g. "Silver")
 * @returns {Array<[string, number]>} Ascending [isoDate, ratio] pairs
 */
const buildRatioSeries = (source, numMetal, denMetal) => {
  const numCloses = new Map();
  const denCloses = new Map();
  for (const cacheEntry of flattenRatioSource(source)) {
    if (
      !cacheEntry ||
      typeof cacheEntry.timestamp !== "string" ||
      cacheEntry.timestamp.length < 10
    ) {
      continue;
    }
    if (!isUsableClose(cacheEntry.spot)) continue;
    const sideCloses =
      cacheEntry.metal === numMetal ? numCloses : cacheEntry.metal === denMetal ? denCloses : null;
    if (!sideCloses) continue;
    const isoDate = cacheEntry.timestamp.slice(0, 10);
    const held = sideCloses.get(isoDate);
    if (!held || cacheEntry.timestamp > held.timestamp) sideCloses.set(isoDate, cacheEntry);
  }
  const series = [];
  for (const [isoDate, numEntry] of numCloses) {
    const denEntry = denCloses.get(isoDate);
    if (denEntry) series.push([isoDate, numEntry.spot / denEntry.spot]);
  }
  series.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return series;
};

/**
 * Arithmetic mean of a non-empty numeric array.
 * @param {number[]} values - Values to average
 * @returns {number}
 */
const meanOfValues = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * Extreme [isoDate, value] row of a non-empty series. Strict comparison keeps
 * the EARLIEST occurrence on ties. Returns a copy so callers can't mutate the
 * series through the result.
 * @param {Array<[string, number]>} rows - Series rows to scan
 * @param {function(number, number): boolean} beats - True when a beats b
 * @returns {[string, number]}
 */
const seriesExtreme = (rows, beats) => {
  const winner = rows.reduce((best, row) => (beats(row[1], best[1]) ? row : best));
  return [winner[0], winner[1]];
};

/**
 * Computes the full statistic set for a ratio series. Trailing averages are
 * TRADING SESSIONS, not calendar days (~261/yr, so avg365 = 261 sessions and
 * avg5y = 1,305) and degrade gracefully on shorter series by averaging the
 * sessions available. `percentile` is all-time (share of sessions strictly
 * below `current`); `high52`/`low52` are the separate last-261-session lens.
 * Extremes return [isoDate, value] so the UI can label when they occurred.
 * A finite positive `liveRatio` overrides the last close for `current` (and
 * `prevClose` then reports the last close); otherwise `current` falls back to
 * the last close and `prevClose` to the session before it.
 * @param {Array<[string, number]>} series - Ascending [isoDate, ratio] pairs from buildRatioSeries
 * @param {number|null} [liveRatio] - Live ratio override, or null for last-close fallback
 * @returns {?{current: number, spanStart: string, spanEnd: string, points: number,
 *   histMean: number, median: number, vsMeanPct: number, percentile: number,
 *   avg7: number, avg30: number, avg90: number, avg365: number, avg5y: number,
 *   prevClose: ?number, high52: [string, number], low52: [string, number],
 *   allHigh: [string, number], allLow: [string, number]}} Stats, or null for an empty series
 */
const computeRatioStats = (series, liveRatio) => {
  if (!Array.isArray(series) || series.length === 0) return null;
  const closes = series.map((row) => row[1]);
  const sorted = [...closes].sort((a, b) => a - b);
  const lastClose = closes[closes.length - 1];
  const hasLive = isUsableClose(liveRatio);
  const current = hasLive ? liveRatio : lastClose;
  const avgOfSessions = (n) => meanOfValues(closes.slice(-n));
  const yearRows = series.slice(-RATIO_SESSIONS_PER_YEAR);
  const histMean = meanOfValues(closes);
  return {
    current,
    spanStart: series[0][0],
    spanEnd: series[series.length - 1][0],
    points: series.length,
    histMean,
    median: sorted[Math.floor(sorted.length / 2)],
    vsMeanPct: ((current - histMean) / histMean) * 100,
    percentile: (sorted.filter((v) => v < current).length / sorted.length) * 100,
    avg7: avgOfSessions(7),
    avg30: avgOfSessions(30),
    avg90: avgOfSessions(90),
    avg365: avgOfSessions(RATIO_SESSIONS_PER_YEAR),
    avg5y: avgOfSessions(RATIO_SESSIONS_PER_YEAR * 5),
    prevClose: hasLive ? lastClose : closes.length >= 2 ? closes[closes.length - 2] : null,
    high52: seriesExtreme(yearRows, (a, b) => a > b),
    low52: seriesExtreme(yearRows, (a, b) => a < b),
    allHigh: seriesExtreme(series, (a, b) => a > b),
    allLow: seriesExtreme(series, (a, b) => a < b),
  };
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
  // STRK-269 ratio statistics engine (foundation for the STRK-268 panel)
  window.RATIO_SESSIONS_PER_YEAR = RATIO_SESSIONS_PER_YEAR;
  window.RATIO_PAIRS = RATIO_PAIRS;
  window.buildRatioSeries = buildRatioSeries;
  window.computeRatioStats = computeRatioStats;
}

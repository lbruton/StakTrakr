// RATIOS PAGE HOST (STRK-273)
// =============================================================================
// Boot script for the standalone /ratios/ page — the second host of the shared
// STRK-270 panel. Runs WITHOUT the main app: it defines the seed-bundle hook
// and the globals the panel reads bare (historicalDataCache, spotHistory,
// spotPrices), merges the current-year feed file over the release-time bundle
// (closing the release-cadence staleness gap), fetches live spot from the
// public unauthenticated feed, and mounts renderRatiosPanel().
//
// Zero user data by design: no inventory, no API keys, and NO localStorage
// writes — the pre-paint inline snippet in ratios/index.html only READS the
// tracker's saved theme. Load order (all deferred): chart.min.js →
// spot-ratio-math.js → ratios-panel.js → THIS FILE → spot-history-bundle.js
// (the bundle calls _loadSpotSeedBundle, defined here); boot runs on
// DOMContentLoaded, after every deferred script has executed.
// =============================================================================

/** @constant {string} Public unauthenticated live-spot feed (no user data). */
const RATIOS_PAGE_SPOT_URL = "https://api.staktrakr.com/data/v2/spot/latest.json";

/**
 * @constant {number} Fallback freshness budget (seconds) for the live-spot
 * envelope when it carries no stale_after — matches the sw-router
 * spot-latest floor.
 */
const RATIOS_PAGE_SPOT_STALE_FLOOR = 1200;

/**
 * Current-year feed sources, freshest first. The API origin copy is published
 * continuously by the poller's api branch (verified live), while the
 * same-origin copy under ../data/ only refreshes when a release deploys — so
 * the API origin is what actually closes the release-cadence staleness gap,
 * and same-origin is the offline/api-down fallback.
 * @param {number} year - UTC calendar year
 * @returns {string[]} Candidate URLs in preference order
 */
const ratiosPageYearUrls = (year) => [
  `https://api.staktrakr.com/data/spot-history-${year}.json`,
  `../data/spot-history-${year}.json`,
];

/** Live-spot symbol → metal key/name mapping for the four panel metals. */
const RATIOS_PAGE_METALS = [
  { symbol: "xag", key: "silver", name: "Silver" },
  { symbol: "xau", key: "gold", name: "Gold" },
  { symbol: "xpt", key: "platinum", name: "Platinum" },
  { symbol: "xpd", key: "palladium", name: "Palladium" },
];

// The globals the panel reads bare, owned by this host on the standalone page.
const ratiosPageCache = new Map();
const ratiosPageHistory = [];
const ratiosPageSpot = { silver: 0, gold: 0, platinum: 0, palladium: 0 };
window.historicalDataCache = ratiosPageCache;
window.spotHistory = ratiosPageHistory;
window.spotPrices = ratiosPageSpot;

/**
 * Seed-bundle hook — data/spot-history-bundle.js calls this on load. Expands
 * the compact { year: { metal: [[MM-DD, price]] } } payload into the same
 * cache-entry shape js/spot.js produces, so buildRatioSeries sees identical
 * data in both hosts.
 * @param {Object} bundle - Compact seed bundle payload
 * @returns {void}
 */
window._loadSpotSeedBundle = function (bundle) {
  for (const yearStr of Object.keys(bundle)) {
    const year = parseInt(yearStr, 10);
    if (ratiosPageCache.has(year) && ratiosPageCache.get(year).length > 0) continue;
    const metals = bundle[yearStr];
    const entries = [];
    for (const metal of Object.keys(metals)) {
      for (const pair of metals[metal]) {
        entries.push({
          spot: pair[1],
          metal: metal,
          source: "seed",
          provider: "LBMA",
          timestamp: `${yearStr}-${pair[0]} 12:00:00`,
        });
      }
    }
    ratiosPageCache.set(year, entries);
  }
};

/**
 * Merges the current-year feed file over the bundle. The bundle is rebuilt
 * only at release time, so alone it can leave 52-week stats up to a release
 * cycle stale; the API-origin year file is republished continuously between
 * releases (the same-origin copy is only a fallback — it is exactly as old as
 * the deploy). Rows go into the spotHistory overlay — buildRatioSeries
 * dedupes same-date closes toward the later timestamp, so fresher rows win
 * over seed rows. UTC year on purpose: feed files are keyed by UTC calendar
 * date.
 * @returns {Promise<void>}
 */
const ratiosPageMergeCurrentYear = async () => {
  const year = new Date().getUTCFullYear();
  for (const url of ratiosPageYearUrls(year)) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const rows = await res.json();
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (row && typeof row.spot === "number" && row.metal && row.timestamp) {
          ratiosPageHistory.push(row);
        }
      }
      return;
    } catch (error) {
      // Try the next source; offline leaves the bundle rendering alone.
    }
  }
};

/**
 * Returns whether a v2 spot envelope is fresh: generated_at present, parseable,
 * and within the envelope's own stale_after budget (or the spot-latest floor).
 * A CDN/proxy can serve an OLD envelope with a 200 — accepting it would light
 * the Live badge on stale prices, so a stale envelope is treated exactly like
 * a failed fetch (bundle close + honest "Last close" badge).
 * @param {?object} body - Parsed latest.json envelope
 * @returns {boolean}
 */
const ratiosPageEnvelopeIsFresh = (body) => {
  const generatedMs = Date.parse(body && body.generated_at);
  if (!Number.isFinite(generatedMs)) return false;
  const budgetSec =
    body && typeof body.stale_after === "number" && body.stale_after > 0
      ? body.stale_after
      : RATIOS_PAGE_SPOT_STALE_FLOOR;
  return Date.now() - generatedMs <= budgetSec * 1000;
};

/**
 * Fetches live spot for all four metals from the public feed. Quotes are
 * accepted ONLY from a fresh envelope (see ratiosPageEnvelopeIsFresh); they
 * populate spotPrices AND append api-sourced spotHistory rows stamped with the
 * envelope's own generated_at — which is what the panel's Live gate
 * (ratioPanelMetalIsSynced) requires. A failed fetch or stale envelope leaves
 * the latest rows seed/sqld-sourced and the panel honestly shows "Last close".
 * @returns {Promise<boolean>} Whether any live quote was accepted
 */
const ratiosPageFetchLiveSpot = async () => {
  try {
    const res = await fetch(RATIOS_PAGE_SPOT_URL, { cache: "no-store" });
    if (!res.ok) return false;
    const body = await res.json();
    if (!ratiosPageEnvelopeIsFresh(body)) return false;
    // Preserve the envelope's publication instant (UTC "YYYY-MM-DD HH:MM:SS"),
    // not the wall clock — the quote is only as fresh as its envelope.
    const envelopeStamp = new Date(Date.parse(body.generated_at))
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    let accepted = false;
    for (const metalDef of RATIOS_PAGE_METALS) {
      const price =
        body && body.data && body.data[metalDef.symbol] ? body.data[metalDef.symbol].price : null;
      if (typeof price === "number" && Number.isFinite(price) && price > 0) {
        ratiosPageSpot[metalDef.key] = price;
        ratiosPageHistory.push({
          spot: price,
          metal: metalDef.name,
          source: "api",
          timestamp: envelopeStamp,
        });
        accepted = true;
      }
    }
    return accepted;
  } catch (error) {
    return false; // offline-tolerant by design — bundle close + stale badge
  }
};

/**
 * Boots the page: waits for the data passes (year merge + live spot) and
 * mounts the shared panel into #ratiosPageMount.
 * @returns {Promise<void>}
 */
const ratiosPageBoot = async () => {
  const mount = document.getElementById("ratiosPageMount");
  if (!mount || typeof renderRatiosPanel !== "function") return;
  await Promise.allSettled([ratiosPageMergeCurrentYear(), ratiosPageFetchLiveSpot()]);
  const loading = document.getElementById("ratiosPageLoading");
  if (loading) loading.remove();
  window.__ratiosPageHandle = renderRatiosPanel(mount);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void ratiosPageBoot();
  });
} else {
  void ratiosPageBoot();
}

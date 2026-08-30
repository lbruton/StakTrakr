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
// and approach.md layer 1 (series boundaries, baseline day, fill rules), as
// amended by STRK-353: undated Items' purchase cost enters as an acquisition
// flow on the series-start day (the baseline day carries no pre-history).
// Series boundaries: start = first dated acquisition − 14 days (the AC-11 ALL
// pre-roll is built in); all-undated fallback = todayKey − 30 days; a
// synthetic baseline day precedes the start so every window has a prior
// sample. Day keys are verbatim "YYYY-MM-DD" strings; arithmetic goes through
// the UTC epoch-day bridge below — deliberate: keys are calendar identifiers,
// not instants, so no local timezone is ever consulted.
// =============================================================================

const _PS_MS_PER_DAY = 86400000;

/**
 * Convert a "YYYY-MM-DD" day key to a UTC epoch-day number.
 * @param {string} key - Day key
 * @returns {number} Whole days since the Unix epoch (UTC frame)
 */
const _psKeyToEpochDays = (key) => {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const d = Number(key.slice(8, 10));
  return Math.round(Date.UTC(y, m - 1, d) / _PS_MS_PER_DAY);
};

/**
 * Convert a UTC epoch-day number back to a "YYYY-MM-DD" day key.
 * @param {number} epochDays - Whole days since the Unix epoch
 * @returns {string} Day key
 */
const _psEpochDaysToKey = (epochDays) => {
  const dt = new Date(epochDays * _PS_MS_PER_DAY);
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
};

/**
 * Add whole days to a day key.
 * @param {string} key - Day key
 * @param {number} n - Days to add (may be negative)
 * @returns {string} Shifted day key
 */
const _psAddDays = (key, n) => _psEpochDaysToKey(_psKeyToEpochDays(key) + n);

/**
 * Resolve the injected/global helper set the fold depends on.
 * @param {object} [helpers] - Optional injected doubles (unit tests)
 * @returns {{getUnitOztWeight: Function, getConstitutionalSilverOz: Function,
 *   isDisposed: Function}} Resolved helpers
 */
const _psResolveHelpers = (helpers) => {
  const g = typeof globalThis !== "undefined" ? globalThis : {};
  return {
    getUnitOztWeight: helpers?.getUnitOztWeight ?? g.getUnitOztWeight,
    getConstitutionalSilverOz: helpers?.getConstitutionalSilverOz ?? g.getConstitutionalSilverOz,
    isDisposed: helpers?.isDisposed ?? g.isDisposed,
  };
};

/**
 * Per-metal forward/backward fill over the series days (AC-8): carry the most
 * recent prior sample forward with no gap ceiling; days before the first
 * sample backward-fill from it; a metal with no samples at all fills with 0.
 * @param {Map<string, number>|undefined} map - Raw day→spot samples
 * @param {string[]} days - Series day keys (consecutive)
 * @returns {number[]} Filled spot per day
 */
const _psFillSpot = (map, days) => {
  const out = new Array(days.length).fill(null);
  let last = null;
  for (let i = 0; i < days.length; i++) {
    const v = map?.get(days[i]);
    if (v != null && Number.isFinite(v)) last = v;
    out[i] = last;
  }
  // leading backfill from the first real sample; all-null → zeros
  let first = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i] != null) {
      first = out[i];
      break;
    }
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i] == null) out[i] = first ?? 0;
    else break;
  }
  if (first == null) out.fill(0);
  return out;
};

/**
 * Build the portfolio series for a scope.
 *
 * @param {Array<object>} items - Inventory Items (active AND disposed; the
 *   fold applies each Item's [acquisition, disposition) holding interval).
 * @param {Object<string, Map<string, number>>} spotDayMaps - Per-metal maps of
 *   "YYYY-MM-DD" day key → spot USD/ozt raw samples (gaps unfilled; filling is
 *   this module's job). Keys are metal display names ("Silver").
 * @param {string} scope - "All" or a metal display name ("Silver"…"Copper").
 * @param {Object<string, number>} todaySpotPrices - Live spot by lowercase
 *   metal key; the final series day is valued at these, not the day-map close
 *   (D-8 — deliberate frame mix, commented at the site).
 * @param {string} todayKey - "YYYY-MM-DD" for today (injected for purity).
 * @param {object} [helpers] - Optional injected unit helpers (tests); browser
 *   callers omit and the app globals are used.
 * @returns {{days: string[], melt: number[], basis: number[],
 *   buys: Array<{day: string, items: object[], totalCost: number,
 *   totalOz: number}>,
 *   dispositions: Array<{day: string, items: object[], totalMeltOut: number}>,
 *   baseline: {day: string, melt: number, basis: number}|null}}
 *   Day-aligned series plus grouped acquisition and disposition markers and the
 *   synthetic pre-series baseline day (always 0/0 since STRK-353 — undated
 *   Items are series-start flows, not pre-history). Internal `_flows`/`_scope`
 *   fields feed computeWindowStats and are not part of the public contract.
 */
const buildPortfolioSeries = (items, spotDayMaps, scope, todaySpotPrices, todayKey, helpers) => {
  const empty = { days: [], melt: [], basis: [], buys: [], dispositions: [], baseline: null };
  if (!Array.isArray(items) || !todayKey) return empty;
  const h = _psResolveHelpers(helpers);

  const scoped = items.filter((it) => scope === "All" || it?.metal === scope);
  // AC-7: an undated Disposition means "never held" — excluded entirely
  const usable = scoped.filter((it) => {
    if (!h.isDisposed(it)) return true;
    return typeof it.disposition?.date === "string" && it.disposition.date !== "";
  });
  if (usable.length === 0) return empty;

  const datedKeys = usable.map((it) => it.date).filter((d) => typeof d === "string" && d !== "");
  const startKey =
    datedKeys.length > 0
      ? _psAddDays(
          datedKeys.reduce((a, b) => (a < b ? a : b)),
          -14
        )
      : _psAddDays(todayKey, -30);
  const startNum = Math.min(_psKeyToEpochDays(startKey), _psKeyToEpochDays(todayKey));
  const endNum = _psKeyToEpochDays(todayKey);

  const days = [];
  for (let n = startNum; n <= endNum; n++) days.push(_psEpochDaysToKey(n));
  const len = days.length;

  // per-metal filled spot arrays for the metals actually held
  const spotByMetal = {};
  usable.forEach((it) => {
    const metal = it.metal || "Unknown";
    if (!spotByMetal[metal]) spotByMetal[metal] = _psFillSpot(spotDayMaps?.[metal], days);
  });
  // D-8: the final day is valued at live spot when a positive live value
  // exists — daily closes lag intraday and the chart's right edge must equal
  // the KPI totals. Deliberate close-frame/live-frame mix, per approach D-8.
  Object.keys(spotByMetal).forEach((metal) => {
    const live = Number(todaySpotPrices?.[metal.toLowerCase()]);
    if (Number.isFinite(live) && live > 0) spotByMetal[metal][len - 1] = live;
  });

  // per-item precompute: derived oz, melt factor, cost, holding interval
  const computed = usable.map((it) => {
    const qty = Number(it.qty) || 1;
    let oz;
    let meltFactor;
    if (it.weightUnit === "cu") {
      // cu derived oz is qty-folded and already pure silver — purity must NOT
      // be re-applied (computeMeltValue precedent, js/utils.js:988-990)
      oz = Number(h.getConstitutionalSilverOz(it)) || 0;
      meltFactor = oz;
    } else {
      oz = (Number(h.getUnitOztWeight(it)) || 0) * qty;
      meltFactor = oz * (parseFloat(it.purity) || 1);
    }
    const cost = (parseFloat(it.price) || 0) * qty;
    const dated = typeof it.date === "string" && it.date !== "";
    const acqIdx = dated ? _psKeyToEpochDays(it.date) - startNum : 0;
    const disposed = h.isDisposed(it);
    const dispIdx = disposed ? _psKeyToEpochDays(it.disposition.date) - startNum : Infinity;
    return { it, metal: it.metal || "Unknown", oz, meltFactor, cost, dated, acqIdx, dispIdx };
  });

  const melt = new Array(len).fill(0);
  const basis = new Array(len).fill(0);
  const buyCost = new Array(len).fill(0);
  const dispOut = new Array(len).fill(0);
  // STRK-362: the since-disposed slice of buyCost — invested minus this equals
  // the active cost basis on ALL — the substrip's "(− $X disposed)"
  const disposedBuyCost = new Array(len).fill(0);

  computed.forEach((c) => {
    const from = Math.max(0, c.acqIdx);
    const to = Math.min(len - 1, c.dispIdx - 1); // held on [acq, disp)
    const spot = spotByMetal[c.metal];
    for (let i = from; i <= to; i++) {
      melt[i] += c.meltFactor * spot[i];
      basis[i] += c.cost;
    }
    const disposed = c.dispIdx !== Infinity;
    if (c.dated && c.acqIdx >= 0 && c.acqIdx < len) {
      buyCost[c.acqIdx] += c.cost;
      if (disposed) disposedBuyCost[c.acqIdx] += c.cost;
    } else if (!c.dated && c.dispIdx >= 0) {
      // STRK-353: an undated Item is not a ghost — its purchase cost enters as
      // an acquisition flow on the series-start day, mirroring its
      // held-from-start melt treatment, so ALL-range invested/market reconcile
      // with actual inventory totals. No buy marker (AC-4). The >= 0 bound
      // mirrors dispOut's: a day-zero disposition books its melt-out, so its
      // cost must flow too; a pre-series disposition books neither.
      buyCost[0] += c.cost;
      if (disposed) disposedBuyCost[0] += c.cost;
    }
    if (c.dispIdx >= 0 && c.dispIdx < len) {
      // melt-out value at the disposition day's spot — a flow, not market
      dispOut[c.dispIdx] += c.meltFactor * spot[c.dispIdx];
    }
  });

  // buys index: dated acquisitions grouped per day, ascending — including
  // since-disposed Items (their acquisitions shaped the series; grill 4)
  const buyGroups = new Map();
  computed.forEach((c) => {
    if (!c.dated) return;
    const key = c.it.date;
    if (!buyGroups.has(key)) buyGroups.set(key, { day: key, items: [], totalCost: 0, totalOz: 0 });
    const g = buyGroups.get(key);
    g.items.push(c.it);
    g.totalCost += c.cost;
    g.totalOz += c.oz;
  });
  const buys = [...buyGroups.values()].sort((a, b) => (a.day < b.day ? -1 : 1));

  // STRK-363: dispositions index — dated dispositions grouped per day,
  // ascending, with per-item melt-out at the disposition day's spot
  const dispGroups = new Map();
  computed.forEach((c) => {
    if (c.dispIdx === Infinity) return;
    if (c.dispIdx < 0 || c.dispIdx >= len) return;
    const key = c.it.disposition.date;
    if (!dispGroups.has(key)) dispGroups.set(key, { day: key, items: [], totalMeltOut: 0 });
    const g = dispGroups.get(key);
    const spot = spotByMetal[c.metal] || [];
    const itemMeltOut = c.meltFactor * (spot[c.dispIdx] || 0);
    g.items.push(Object.assign({}, c.it, { _meltOut: itemMeltOut }));
    g.totalMeltOut += itemMeltOut;
  });
  const dispositions = [...dispGroups.values()].sort((a, b) => (a.day < b.day ? -1 : 1));

  // synthetic baseline day: pre-history is empty — undated Items enter as a
  // series-start flow (STRK-353). Only the day-zero window reads this 0/0
  // baseline; later windows use melt[w − 1]. A non-zero baseline here would
  // double-count undated Items against buyCost[0] in computeWindowStats'
  // ALL-range market (AC-5 reconciliation invariant).
  const baseline = { day: _psAddDays(days[0], -1), melt: 0, basis: 0 };

  return {
    days,
    melt,
    basis,
    buys,
    dispositions,
    baseline,
    _flows: { buyCost, dispOut, disposedBuyCost },
    _scope: scope,
  };
};

/**
 * Compute flow-adjusted statistics for a visible window of a built series
 * (AC-15): market gain books buys at cost and dispositions at melt-out value,
 * so contributions and withdrawals never masquerade as market movement.
 *
 * @param {object} series - Result of buildPortfolioSeries.
 * @param {string} windowStartKey - "YYYY-MM-DD" first visible day.
 * @returns {{market: number, marketPct: number|null, invested: number,
 *   investedDisposed: number, buyCount: number, paceOzPerMonth: number|null}}
 *   Window stats; marketPct is null when the end-of-window basis is 0, pace is
 *   null for the All scope. investedDisposed is the since-disposed slice of
 *   invested (STRK-362) — invested − investedDisposed = active cost basis on ALL.
 */
const computeWindowStats = (series, windowStartKey) => {
  const zero = {
    market: 0,
    marketPct: null,
    invested: 0,
    investedDisposed: 0,
    buyCount: 0,
    paceOzPerMonth: null,
  };
  if (!series || !Array.isArray(series.days) || series.days.length === 0) return zero;
  let w = series.days.indexOf(windowStartKey);
  if (w < 0) w = 0;
  const end = series.days.length - 1;
  const prevMelt = w === 0 ? (series.baseline?.melt ?? 0) : series.melt[w - 1];

  let invested = 0;
  let investedDisposed = 0;
  let out = 0;
  for (let i = w; i <= end; i++) {
    invested += series._flows.buyCost[i];
    investedDisposed += series._flows.disposedBuyCost[i];
    out += series._flows.dispOut[i];
  }
  const market = series.melt[end] - prevMelt - invested + out;
  const basisEnd = series.basis[end];
  const marketPct = basisEnd > 0 ? (market / basisEnd) * 100 : null;

  const windowBuys = series.buys.filter((b) => b.day >= series.days[w]);
  const buyCount = windowBuys.length;

  let paceOzPerMonth = null;
  if (series._scope !== "All") {
    const months = Math.max(1 / 30, (end - w) / 30.44);
    const ozBought = windowBuys.reduce((a, b) => a + b.totalOz, 0);
    paceOzPerMonth = ozBought / months;
  }

  return { market, marketPct, invested, investedDisposed, buyCount, paceOzPerMonth };
};

/**
 * Select and order the active Items for the modal's acquisitions ledger
 * (AC-18): active (non-disposed) Items in scope, acquisition date descending,
 * undated Items last; ties keep input order (stable sort).
 *
 * @param {Array<object>} items - Inventory Items.
 * @param {string} scope - "All" or a metal display name.
 * @param {object} [helpers] - Optional injected helpers (tests).
 * @returns {Array<object>} Ledger rows, newest first.
 */
const pickLedgerRows = (items, scope, helpers) => {
  if (!Array.isArray(items)) return [];
  const h = _psResolveHelpers(helpers);
  return items
    .filter((it) => (scope === "All" || it?.metal === scope) && !h.isDisposed(it))
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const da = typeof a.it.date === "string" ? a.it.date : "";
      const db = typeof b.it.date === "string" ? b.it.date : "";
      if (da === "" && db === "") return a.i - b.i;
      if (da === "") return 1; // undated last
      if (db === "") return -1;
      if (da === db) return a.i - b.i;
      return da < db ? 1 : -1; // newest first
    })
    .map((x) => x.it);
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

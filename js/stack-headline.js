// Your stack figures over the totals ledger: the lead value (retail or melt) with today's
// change, the other value, gain on cost, cost basis and realized, the weight held per metal
// and the last 12 months of activity, drawn by updateSummary from the per-metal totals.

/** Days in the activity window: the breakdown modal's 1Y range. */
const STACK_ACTIVITY_DAYS = 365;

/**
 * Computes the Your stack figures from updateSummary's per-metal accumulators.
 * Today's change prices each metal's pure ounces (melt / current spot) at the two
 * prices the 24h comparison uses, so it matches the spot card's comparison mode.
 * @param {Object<string, object>} metalTotals - Accumulators keyed by metal key.
 * @param {(metalKey: string) => {valid: boolean, oldPrice: number, newPrice: number,
 *   spot: number}|null} changeFor - 24h comparison prices and the current spot.
 * @returns {{retail: number, melt: number, gain: number, gainPct: number, purchased: number,
 *   avgCostPerOz: number, realized: number, realizedPct: number, disposedCost: number,
 *   disposedItems: number, weight: number, items: number, today: number, todayPct: number, hasToday: boolean,
 *   premiumPct: number, activeRows: number, empty: boolean}}
 */
const computeStackHeadline = (metalTotals, changeFor) => {
  const figures = {
    retail: 0,
    melt: 0,
    gain: 0,
    gainPct: 0,
    purchased: 0,
    avgCostPerOz: 0,
    realized: 0,
    realizedPct: 0,
    disposedCost: 0,
    disposedItems: 0,
    weight: 0,
    items: 0,
    today: 0,
    todayPct: 0,
    hasToday: false,
    premiumPct: 0,
    activeRows: 0,
    empty: true,
  };
  let valueBefore = 0;
  for (const [metalKey, totals] of Object.entries(metalTotals)) {
    figures.retail += totals.totalRetailValue;
    figures.melt += totals.totalMeltValue;
    figures.gain += totals.totalGainLoss;
    figures.purchased += totals.totalPurchased;
    figures.realized += totals.realizedGainLoss || 0;
    figures.disposedCost += totals.totalDisposedCost || 0;
    figures.disposedItems += totals.disposedItems || 0;
    figures.weight += totals.totalWeight || 0;
    figures.items += totals.totalItems || 0;
    figures.activeRows += totals.activeRows;
    if (totals.activeRows > 0 || totals.disposedItems > 0) figures.empty = false;
    if (!(totals.totalMeltValue > 0)) continue;
    const change = changeFor(metalKey);
    if (!change || !change.valid || !(change.spot > 0)) continue;
    const pureOz = totals.totalMeltValue / change.spot;
    figures.today += pureOz * (change.newPrice - change.oldPrice);
    valueBefore += pureOz * change.oldPrice;
    figures.hasToday = true;
  }
  figures.gainPct = figures.purchased > 0 ? (figures.gain / figures.purchased) * 100 : 0;
  figures.avgCostPerOz = figures.weight > 0 ? figures.purchased / figures.weight : 0;
  figures.realizedPct =
    figures.disposedCost > 0 ? (figures.realized / figures.disposedCost) * 100 : 0;
  figures.todayPct = valueBefore > 0 ? (figures.today / valueBefore) * 100 : 0;
  figures.premiumPct =
    figures.melt > 0 ? ((figures.retail - figures.melt) / figures.melt) * 100 : 0;
  return figures;
};

/**
 * Picks the lead figure and the gain on cost that follows its basis. Melt gain is melt
 * minus cost basis over the same active rows as the retail gain. Anything but "melt"
 * leads with retail.
 * @param {{gain: number, melt: number, purchased: number}} figures - computeStackHeadline result.
 * @param {*} lead - Saved preference.
 * @returns {{lead: string, other: string, gain: number, gainPct: number}}
 */
const pickStackLead = (figures, lead) => {
  const melt = lead === "melt";
  const gain = melt ? figures.melt - figures.purchased : figures.gain;
  return {
    lead: melt ? "melt" : "retail",
    other: melt ? "retail" : "melt",
    gain,
    gainPct: figures.purchased > 0 ? (gain / figures.purchased) * 100 : 0,
  };
};

/**
 * Names the gain figure. A negative amount that displays as zero reads as a gain, so the
 * test uses formatCurrency, which applies the display currency's rate and precision.
 * @param {number} gain - Signed gain on cost.
 * @returns {string}
 */
const stackGainLabel = (gain) => {
  return gain < 0 && /[1-9]/.test(formatCurrency(Math.abs(gain))) ? "Loss on cost" : "Gain on cost";
};

/**
 * Lists the weight held per metal, in Metal Order, for enabled metals with active Items:
 * the same rows the ledger shows apart from metals held only as realized gain or loss.
 * @param {Object<string, object>} metalTotals - Accumulators keyed by metal key.
 * @param {Array<{id: string, enabled: boolean}>} metalOrder - getMetalOrderConfig() result.
 * @returns {Array<{key: string, weight: number}>}
 */
const computeStackWeights = (metalTotals, metalOrder) => {
  return metalOrder
    .filter(
      ({ id, enabled }) =>
        enabled && Object.hasOwn(metalTotals, id) && metalTotals[id].totalItems > 0
    )
    .map(({ id }) => ({ key: id, weight: metalTotals[id].totalWeight || 0 }));
};

/**
 * Formats a 12-month pace with the breakdown modal's digits and a leading plus.
 * @param {number|null} pace - Ounces bought per month.
 * @returns {string}
 */
const formatStackPace = (pace) => {
  if (!(pace > 0)) return "No buys";
  return `+${pace.toFixed(pace < 0.1 ? 3 : 1)} oz/mo`;
};

/**
 * First day of the activity window: STACK_ACTIVITY_DAYS before the series' last day,
 * as the breakdown modal's 1Y range picks it.
 * @param {string[]} days - Series day keys.
 * @returns {string} Day key, or "" for an empty series.
 */
const stackActivityWindowStart = (days) => {
  if (days.length === 0) return "";
  return days[Math.max(0, days.length - 1 - STACK_ACTIVITY_DAYS)];
};

/** Totals from the last updateSummary, kept so a history change can redraw the headline. */
let _lastMetalTotals = null;

/**
 * Spot day maps for the All Metals series, loaded for one inventory and day.
 * @type {{mapsKey: string, maps: Object<string, Map<string, number>>}|null}
 */
let _stackSpotMaps = null;
/**
 * Last-12-months activity: the All Metals window stats and each held metal's pace, both
 * null after a failed load. `statsKey` adds the live spot prices and the constitutional
 * wear factor to `mapsKey`, since the series values today with them.
 * @type {{mapsKey: string, statsKey: string, all: object|null,
 *   pace: Object<string, number|null>|null}|null}
 */
let _stackActivity = null;
/** statsKey of the activity being computed, or null. */
let _stackActivityPending = null;
/** Supersede generation: a load that finishes after a newer one started is dropped. */
let _stackActivityGeneration = 0;
/** Counts spot history changes; refreshStackHeadline bumps it so the maps reload. */
let _stackSpotHistoryVersion = 0;

/**
 * Reads the saved lead figure.
 * @returns {string} "retail" or "melt"
 */
const readStackLead = () =>
  loadDataSync(STACK_HEADLINE_LEAD_KEY, "retail") === "melt" ? "melt" : "retail";

/**
 * Builds a span coloured by the sign of a value, with the gain and loss text tokens.
 * @param {number} value - Signed value that picks the colour.
 * @param {string} text - Text to show.
 * @returns {HTMLSpanElement}
 */
const _statusSpan = (value, text) => {
  const span = document.createElement("span");
  if (value > 0) span.className = "gl-gain";
  if (value < 0) span.className = "gl-loss";
  span.textContent = text;
  return span;
};

/** Formats a percentage with a leading "+" when positive. */
const _signedPct = (pct, digits) => `${pct > 0 ? "+" : ""}${pct.toFixed(digits)}%`;

/** Formats a signed currency amount with a leading "+" when positive. */
const _signedCurrency = (value) => `${value > 0 ? "+" : ""}${formatCurrency(value)}`;

/**
 * Replaces a figure's content. safeGetElement's stand-in for a missing node has no
 * replaceChildren, so a missing figure is skipped rather than written.
 * @param {string} id - Element id.
 * @param {...(Node|string)} nodes - New content.
 */
const _fillFigure = (id, ...nodes) => {
  const el = safeGetElement(id);
  if (el instanceof HTMLElement) el.replaceChildren(...nodes);
};

/**
 * Puts the lead figure first and the other value second, so reading order matches the
 * screen. The lead takes the large type, the swap button and today's line; the other
 * value shows its own sub-line. A focused swap button keeps focus through the move.
 * @param {string} lead - "retail" or "melt"
 */
const _arrangeStackLead = (lead) => {
  const list = document.getElementById("stackHeadlineFigures");
  const leadFigure = document.getElementById(
    lead === "melt" ? "stackMeltFigure" : "stackRetailFigure"
  );
  const otherFigure = document.getElementById(
    lead === "melt" ? "stackRetailFigure" : "stackMeltFigure"
  );
  const swap = document.getElementById("stackLeadSwap");
  const today = document.getElementById("stackTodayValue");
  if (!(list && leadFigure && otherFigure && swap && today)) return;
  const hadFocus = document.activeElement === swap;

  if (list.firstElementChild !== leadFigure) list.prepend(leadFigure, otherFigure);
  leadFigure.classList.add("stack-figure-lead");
  otherFigure.classList.remove("stack-figure-lead");
  if (swap.parentElement !== leadFigure.querySelector("dt"))
    leadFigure.querySelector("dt").append(swap);
  leadFigure.querySelector(".stack-figure-value").after(today);
  safeGetElement("stackRetailSub").hidden = lead === "retail";
  safeGetElement("stackMeltSub").hidden = lead === "melt";

  const action = `Lead with ${lead === "melt" ? "retail" : "melt"} value`;
  swap.setAttribute("aria-label", action);
  swap.title = action;
  if (hadFocus && document.activeElement !== swap) swap.focus();
};

/**
 * Fills the weights list: one row per held metal with its mark, ounces and 12-month pace.
 * The pace stays blank until the activity series load.
 * @param {Object<string, object>} metalTotals - Accumulators keyed by metal key.
 * @param {Object<string, number|null>|null} pace - Pace by metal key, or null while loading.
 */
const _renderStackWeights = (metalTotals, pace) => {
  const list = document.getElementById("stackWeightsList");
  if (!list) return;
  const order = typeof getMetalOrderConfig === "function" ? getMetalOrderConfig() : [];
  const rows = computeStackWeights(metalTotals, order).map(({ key, weight }) => {
    const metal = Object.values(METALS).find((m) => m.key === key);
    const row = document.createElement("li");
    row.className = `stack-weight-row ${key}`;
    const cell = (className, text) => {
      const span = document.createElement("span");
      span.className = className;
      span.textContent = text;
      return span;
    };
    row.append(
      cell("totals-metal-mark", ""),
      cell("stack-weight-name", metal ? metal.name : key),
      cell("stack-weight-oz", `${weight.toFixed(2)} oz`),
      cell("stack-weight-pace", pace ? formatStackPace(pace[key]) : "")
    );
    return row;
  });
  list.replaceChildren(...rows);
  safeGetElement("stackWeights").hidden = rows.length === 0;
  safeGetElement("stackWeightsRate").hidden = !pace;
};

/**
 * Writes the activity line from the window stats, in the breakdown modal's money and
 * percentage formats, or hides it while the series load or after a failed load.
 * @param {object|null} stats - computeWindowStats result for All Metals.
 */
const _renderStackActivity = (stats) => {
  const line = safeGetElement("stackActivity");
  line.hidden = !stats;
  if (!stats) return;
  const sign = stats.market > 0 ? "+" : stats.market < 0 ? "−" : "";
  const pct =
    stats.marketPct == null
      ? ""
      : ` (${stats.marketPct >= 0 ? "+" : "−"}${Math.abs(stats.marketPct).toFixed(1)}%)`;
  const money = (text) => {
    const span = document.createElement("span");
    span.className = "stack-activity-figure";
    span.textContent = text;
    return span;
  };
  const market = _statusSpan(
    stats.market,
    `${sign}${formatCurrency(Math.abs(stats.market))}${pct}`
  );
  if (stats.buyCount === 0) {
    _fillFigure("stackActivity", "Last 12 months: no acquisitions, market ", market);
    return;
  }
  _fillFigure(
    "stackActivity",
    "Last 12 months: ",
    money(formatCurrency(stats.invested)),
    ` added across ${stats.buyCount} ${stats.buyCount === 1 ? "acquisition" : "acquisitions"}, market `,
    market
  );
};

/**
 * Keys for the cached activity. `viewKey` covers today and the Item fields the series
 * read; a change hides the line until it loads again. `mapsKey` adds the spot history
 * version, so a history change reloads the maps. `statsKey` adds the live spot prices and
 * the constitutional wear factor, which value the series.
 * @returns {{todayKey: string, viewKey: string, mapsKey: string, statsKey: string}}
 */
const _stackActivityKeys = () => {
  // todayStr is local-frame like item dates; buildPortfolioSeries absorbs the UTC
  // spot-key seam, as the breakdown modal's load does.
  const todayKey = todayStr();
  const items = inventory.map((it) => [
    it.uuid,
    it.metal,
    it.date,
    it.qty,
    it.weight,
    it.weightUnit,
    it.purity,
    it.price,
    it.constitutionalVariant,
    it.constitutionalEntryMode,
    it.disposition,
  ]);
  const viewKey = `${todayKey}|${JSON.stringify(items)}`;
  const mapsKey = `${viewKey}|${_stackSpotHistoryVersion}`;
  const wear =
    typeof getConstitutionalWearFactor === "function" ? getConstitutionalWearFactor() : 1;
  const statsKey = `${mapsKey}|${wear}|${JSON.stringify(spotPrices)}`;
  return { todayKey, viewKey, mapsKey, statsKey };
};

/**
 * Builds the All Metals series and one series per held metal from one set of spot maps,
 * loading the maps only when the inventory, the day or the spot history changed, then
 * redraws the headline. A run that a newer one superseded is dropped; a failed run leaves
 * the activity line and the pace hidden until the keys change.
 * @param {{todayKey: string, viewKey: string, mapsKey: string, statsKey: string}} keys -
 *   _stackActivityKeys().
 * @param {number} generation - Generation captured when the run started.
 */
const _loadStackActivity = async (keys, generation) => {
  // A failed run is kept for its keys too, so the redraw below does not retry it.
  let activity = {
    viewKey: keys.viewKey,
    mapsKey: keys.mapsKey,
    statsKey: keys.statsKey,
    all: null,
    pace: null,
  };
  try {
    if (_stackSpotMaps?.mapsKey !== keys.mapsKey) {
      const loaded = await window.loadPortfolioSpotMaps("All");
      if (generation !== _stackActivityGeneration) return;
      _stackSpotMaps = { mapsKey: keys.mapsKey, maps: loaded };
    }
    const maps = _stackSpotMaps.maps;
    const statsFor = (scope) => {
      const series = buildPortfolioSeries(inventory, maps, scope, spotPrices, keys.todayKey);
      return computeWindowStats(series, stackActivityWindowStart(series.days));
    };
    const pace = Object.create(null);
    for (const metal of Object.values(METALS)) {
      if (_lastMetalTotals?.[metal.key]?.totalItems > 0) {
        pace[metal.key] = statsFor(metal.name).paceOzPerMonth;
      }
    }
    activity = { ...activity, all: statsFor("All"), pace };
  } catch (error) {
    console.error("[stack-headline] activity load failed:", error);
  }
  if (generation !== _stackActivityGeneration) return;
  _stackActivity = activity;
  _stackActivityPending = null;
  if (_lastMetalTotals) renderStackHeadline(_lastMetalTotals);
};

/**
 * Starts an activity run after this paint when any of its inputs changed since the last one.
 * @param {{todayKey: string, mapsKey: string, statsKey: string}} keys - _stackActivityKeys().
 */
const _scheduleStackActivity = (keys) => {
  if (_stackActivity?.statsKey === keys.statsKey || _stackActivityPending === keys.statsKey) {
    return;
  }
  if (typeof window.loadPortfolioSpotMaps !== "function") return;
  _stackActivityPending = keys.statsKey;
  const generation = ++_stackActivityGeneration;
  setTimeout(() => _loadStackActivity(keys, generation), 0);
};

/**
 * Renders the Your stack figures from updateSummary's per-metal totals. With no Items
 * the card shows the Add Item prompt and hides the ledger, which has no row to show.
 * @param {Object<string, object>} metalTotals - Accumulators keyed by metal key.
 */
const renderStackHeadline = (metalTotals) => {
  _lastMetalTotals = metalTotals;
  const section = document.getElementById("totalsSectionEl");
  if (!(section instanceof HTMLElement)) return;
  const changeFor = (metalKey) => {
    const metal = Object.values(METALS).find((m) => m.key === metalKey);
    if (!metal || typeof get24hChange !== "function") return null;
    return { ...get24hChange(metal.name), spot: spotPrices[metalKey] || 0 };
  };
  const figures = computeStackHeadline(metalTotals, changeFor);

  // Under an inventory recovery hold the in-memory inventory is empty but the stored one
  // is not, and saving an Item from the Add Item prompt would overwrite it: show neither.
  const recovering = typeof isInventoryRecoveryActive === "function" && isInventoryRecoveryActive();
  safeGetElement("stackHeadlineHead").hidden = figures.empty;
  safeGetElement("totalsLedger").hidden = figures.empty;
  safeGetElement("stackHeadlineEmpty").hidden = !figures.empty || recovering;
  if (figures.empty) return;

  const picked = pickStackLead(figures, readStackLead());
  _arrangeStackLead(picked.lead);
  safeGetElement("totalsLedger").dataset.lead = picked.lead;

  _fillFigure("stackRetailValue", formatCurrency(figures.retail));
  _fillFigure("stackMeltValue", formatCurrency(figures.melt));
  if (figures.hasToday) {
    const text = `${_signedCurrency(figures.today)} (${_signedPct(figures.todayPct, 2)})`;
    // The change is a melt change; under the retail lead the line names that basis.
    const label = picked.lead === "retail" ? " today at spot" : " today";
    _fillFigure("stackTodayValue", _statusSpan(figures.today, text), label);
  } else {
    _fillFigure("stackTodayValue", "No 24h change yet");
  }
  _fillFigure(
    "stackRetailSub",
    _statusSpan(figures.premiumPct, _signedPct(figures.premiumPct, 1)),
    " over melt"
  );
  _fillFigure("stackMeltSub", `${figures.items} Items, priced at spot`);

  safeGetElement("stackGainLabel").textContent = stackGainLabel(picked.gain);
  _fillFigure("stackGainValue", _statusSpan(picked.gain, _signedCurrency(picked.gain)));
  _fillFigure(
    "stackGainSub",
    _statusSpan(picked.gain, _signedPct(picked.gainPct, 1)),
    ` at ${picked.lead}`
  );

  _fillFigure("stackCostValue", formatCurrency(figures.purchased));
  _fillFigure("stackCostSub", `Avg ${formatCurrency(figures.avgCostPerOz)}/oz`);

  // Matches the ledger's Realized cell: zero shows unsigned, like "$0.00" there.
  const realizedText =
    figures.realized === 0 ? formatCurrency(0) : _signedCurrency(figures.realized);
  _fillFigure("stackRealizedValue", _statusSpan(figures.realized, realizedText));
  if (figures.disposedCost > 0) {
    _fillFigure(
      "stackRealizedSub",
      _statusSpan(figures.realized, _signedPct(figures.realizedPct, 1)),
      ` on ${formatCurrency(figures.disposedCost)} cost`
    );
  } else {
    _fillFigure(
      "stackRealizedSub",
      figures.disposedItems > 0 ? `from ${figures.disposedItems} Items` : "No Items sold or traded"
    );
  }

  // The last activity for this inventory and day stays up while a spot or history change
  // recomputes it; an inventory edit or a new day hides it until the series load again.
  const keys = _stackActivityKeys();
  const activity = _stackActivity?.viewKey === keys.viewKey ? _stackActivity : null;
  _renderStackWeights(metalTotals, activity?.pace ?? null);
  _renderStackActivity(activity?.all ?? null);
  _scheduleStackActivity(keys);
};
window.renderStackHeadline = renderStackHeadline;

/**
 * Redraws the headline from the last totals after spot history or the 24h comparison
 * mode changes; updateAllSparklines calls it, since those changes redraw the sparklines.
 * The activity reloads its spot maps, which an import or restore may have corrected.
 */
const refreshStackHeadline = () => {
  _stackSpotHistoryVersion += 1;
  if (_lastMetalTotals) renderStackHeadline(_lastMetalTotals);
};
window.refreshStackHeadline = refreshStackHeadline;

/** Swaps which value leads, saves the choice and redraws the headline and the ledger. */
const _swapStackLead = () => {
  const next = readStackLead() === "melt" ? "retail" : "melt";
  try {
    saveDataSync(STACK_HEADLINE_LEAD_KEY, next);
  } catch (error) {
    console.warn("[stack-headline] could not save the lead figure:", error);
    // saveDataSync shows its own storage-full message for a quota error.
    if (error?.name !== "QuotaExceededError" && typeof window.showToast === "function") {
      window.showToast("Could not save the lead figure. Swap it again to retry.");
    }
  }
  if (typeof scheduleSyncPush === "function") scheduleSyncPush();
  if (_lastMetalTotals) updateSummary();
};

// Parse-time wiring: this script is deferred, so the buttons exist, and safeGetElement may not yet.
document.getElementById("stackHeadlineAddItem")?.addEventListener("click", () => {
  if (typeof window.activateTab === "function") window.activateTab("inventory");
  document.getElementById("newItemBtn")?.click();
});
document.getElementById("stackLeadSwap")?.addEventListener("click", _swapStackLead);

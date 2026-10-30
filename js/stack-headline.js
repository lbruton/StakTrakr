// Dashboard stack headline: retail value, melt value, today's change and gain on cost,
// drawn by updateSummary from the same per-metal totals as the totals cards.

/**
 * Computes the stack headline figures from updateSummary's per-metal accumulators.
 * Today's change prices each metal's pure ounces (melt / current spot) at the two
 * prices the 24h comparison uses, so it matches the spot card's comparison mode.
 * @param {Object<string, object>} metalTotals - Accumulators keyed by metal key.
 * @param {(metalKey: string) => {valid: boolean, oldPrice: number, newPrice: number,
 *   spot: number}|null} changeFor - 24h comparison prices and the current spot.
 * @returns {{retail: number, melt: number, gain: number, gainPct: number, today: number,
 *   todayPct: number, hasToday: boolean, activeRows: number, meltFallbackRows: number,
 *   empty: boolean}}
 */
const computeStackHeadline = (metalTotals, changeFor) => {
  const figures = {
    retail: 0,
    melt: 0,
    gain: 0,
    gainPct: 0,
    today: 0,
    todayPct: 0,
    hasToday: false,
    activeRows: 0,
    meltFallbackRows: 0,
    empty: true,
  };
  let purchased = 0;
  let valueBefore = 0;
  for (const [metalKey, totals] of Object.entries(metalTotals)) {
    figures.retail += totals.totalRetailValue;
    figures.melt += totals.totalMeltValue;
    figures.gain += totals.totalGainLoss;
    figures.activeRows += totals.activeRows;
    figures.meltFallbackRows += totals.meltFallbackRows;
    purchased += totals.totalPurchased;
    if (totals.activeRows > 0 || totals.disposedItems > 0) figures.empty = false;
    if (!(totals.totalMeltValue > 0)) continue;
    const change = changeFor(metalKey);
    if (!change || !change.valid || !(change.spot > 0)) continue;
    const pureOz = totals.totalMeltValue / change.spot;
    figures.today += pureOz * (change.newPrice - change.oldPrice);
    valueBefore += pureOz * change.oldPrice;
    figures.hasToday = true;
  }
  figures.gainPct = purchased > 0 ? (figures.gain / purchased) * 100 : 0;
  figures.todayPct = valueBefore > 0 ? (figures.today / valueBefore) * 100 : 0;
  return figures;
};

/** Totals from the last updateSummary, kept so a history change can redraw the headline. */
let _lastMetalTotals = null;

/**
 * Writes a signed amount, its percentage and a trailing word into a headline value.
 * @param {HTMLElement} el - Value element.
 * @param {number} amount - Signed amount in the base currency.
 * @param {number} pct - Signed percentage.
 * @param {number} digits - Percentage decimals.
 * @param {string} word - Trailing word, such as "today".
 */
const _writeSignedFigure = (el, amount, pct, digits, word) => {
  const sign = amount > 0 ? "+" : "";
  const status = document.createElement("span");
  if (amount > 0) status.className = "gl-gain";
  if (amount < 0) status.className = "gl-loss";
  status.textContent = `${sign}${formatCurrency(amount)} (${pct > 0 ? "+" : ""}${pct.toFixed(digits)}%)`;
  el.replaceChildren(status, ` ${word}`);
};

/**
 * Renders the stack headline from updateSummary's per-metal totals.
 * @param {Object<string, object>} metalTotals - Accumulators keyed by metal key.
 */
const renderStackHeadline = (metalTotals) => {
  _lastMetalTotals = metalTotals;
  const section = document.getElementById("stackHeadlineSection");
  if (!(section instanceof HTMLElement)) return;
  const changeFor = (metalKey) => {
    const metal = Object.values(METALS).find((m) => m.key === metalKey);
    if (!metal || typeof get24hChange !== "function") return null;
    return { ...get24hChange(metal.name), spot: spotPrices[metalKey] || 0 };
  };
  const figures = computeStackHeadline(metalTotals, changeFor);

  document.getElementById("stackHeadlineFigures").hidden = figures.empty;
  document.getElementById("stackHeadlineEmpty").hidden = !figures.empty;
  document.getElementById("stackRetailNote").textContent = "";
  if (figures.empty) return;

  document.getElementById("stackRetailValue").textContent = formatCurrency(figures.retail);
  document.getElementById("stackMeltValue").textContent = formatCurrency(figures.melt);
  document.getElementById("stackGainLabel").textContent = figures.gain < 0 ? "Loss" : "Gain";
  _writeSignedFigure(
    document.getElementById("stackGainValue"),
    figures.gain,
    figures.gainPct,
    1,
    "on cost"
  );

  const todayEl = document.getElementById("stackTodayValue");
  if (figures.hasToday) {
    _writeSignedFigure(todayEl, figures.today, figures.todayPct, 2, "today");
  } else {
    todayEl.textContent = "No 24h change yet";
  }

  const label = document.getElementById("stackRetailLabel");
  const note = document.getElementById("stackRetailNote");
  const partial = figures.meltFallbackRows > 0;
  label.textContent = partial ? "Retail (partial)" : "Retail value";
  note.textContent = partial
    ? `${figures.meltFallbackRows} of ${figures.activeRows} Items have no retail price and count at melt value.`
    : "";
  if (partial) {
    label.title = note.textContent;
    label.setAttribute("aria-describedby", note.id);
  } else {
    label.removeAttribute("title");
    label.removeAttribute("aria-describedby");
  }
};
window.renderStackHeadline = renderStackHeadline;

/**
 * Redraws the headline from the last totals after spot history or the 24h comparison
 * mode changes; updateAllSparklines calls it, since those changes redraw the sparklines.
 */
const refreshStackHeadline = () => {
  if (_lastMetalTotals) renderStackHeadline(_lastMetalTotals);
};
window.refreshStackHeadline = refreshStackHeadline;

// Parse-time wiring: this script is deferred, so the button exists, and safeGetElement may not yet.
document.getElementById("stackHeadlineAddItem")?.addEventListener("click", () => {
  if (typeof window.activateTab === "function") window.activateTab("inventory");
  document.getElementById("newItemBtn")?.click();
});

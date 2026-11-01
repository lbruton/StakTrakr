// Your stack figures over the totals ledger: retail value with today's change, melt value,
// gain on cost, cost basis and realized, drawn by updateSummary from the per-metal totals.

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
 *   activeRows: number, empty: boolean}}
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
  return figures;
};

/** Totals from the last updateSummary, kept so a history change can redraw the headline. */
let _lastMetalTotals = null;

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

  const retailEl = document.getElementById("stackRetailValue");

  // Under an inventory recovery hold the in-memory inventory is empty but the stored one
  // is not, and saving an Item from the Add Item prompt would overwrite it: show neither.
  const recovering = typeof isInventoryRecoveryActive === "function" && isInventoryRecoveryActive();
  document.getElementById("stackHeadlineFigures").hidden = figures.empty;
  document.getElementById("totalsLedger").hidden = figures.empty;
  document.getElementById("stackHeadlineEmpty").hidden = !figures.empty || recovering;
  if (figures.empty) return;

  retailEl.textContent = formatCurrency(figures.retail);
  const todayEl = document.getElementById("stackTodayValue");
  if (figures.hasToday) {
    const text = `${_signedCurrency(figures.today)} (${_signedPct(figures.todayPct, 2)})`;
    todayEl.replaceChildren(_statusSpan(figures.today, text), " today");
  } else {
    todayEl.textContent = "No 24h change yet";
  }

  document.getElementById("stackMeltValue").textContent = formatCurrency(figures.melt);
  document.getElementById("stackMeltSub").textContent =
    `${figures.weight.toFixed(2)} oz across ${figures.items} Items`;

  document
    .getElementById("stackGainValue")
    .replaceChildren(_statusSpan(figures.gain, _signedCurrency(figures.gain)));
  document
    .getElementById("stackGainSub")
    .replaceChildren(_statusSpan(figures.gain, _signedPct(figures.gainPct, 1)), " at retail");

  document.getElementById("stackCostValue").textContent = formatCurrency(figures.purchased);
  document.getElementById("stackCostSub").textContent =
    `Avg ${formatCurrency(figures.avgCostPerOz)}/oz`;

  // Matches the ledger's Realized cell: zero shows unsigned, like "$0.00" there.
  const realizedText =
    figures.realized === 0 ? formatCurrency(0) : _signedCurrency(figures.realized);
  document
    .getElementById("stackRealizedValue")
    .replaceChildren(_statusSpan(figures.realized, realizedText));
  const realizedSub = document.getElementById("stackRealizedSub");
  if (figures.disposedCost > 0) {
    realizedSub.replaceChildren(
      _statusSpan(figures.realized, _signedPct(figures.realizedPct, 1)),
      ` on ${formatCurrency(figures.disposedCost)} cost`
    );
  } else {
    realizedSub.textContent =
      figures.disposedItems > 0 ? `from ${figures.disposedItems} Items` : "No Items sold or traded";
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

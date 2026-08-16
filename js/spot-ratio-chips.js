// SPOT-CARD RATIO CHIPS — RENDER LAYER (STRK-161)
// =============================================================================
// Renders a per-spot-card ratio chip (e.g. Au:Ag) plus a goldback rate chip, with
// a position:fixed tooltip singleton, via the idempotent renderRatioChips() choke
// point invoked from every spot/goldback DOM-write path. The ratio/goldback math
// and freshness/estimate resolution live in js/spot-ratio-math.js (loaded first);
// this file reads computeRatio / formatRatio / resolveGoldbackRate as globals.
// =============================================================================

const SPOT_RATIOS_STORAGE_KEY =
  typeof SPOT_RATIOS_KEY !== "undefined" ? SPOT_RATIOS_KEY : "show-spot-ratios";

// Inline glyphs (stroke="currentColor" so they inherit the metal accent token).
const RATIO_CHIP_GLYPH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7l-3 6a3 3 0 0 0 6 0z"/><path d="M19 7l-3 6a3 3 0 0 0 6 0z"/></svg>`;
const GOLDBACK_CHIP_GLYPH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M5 9v6M19 9v6"/></svg>`;

// Ratio-card definitions. Each chip lives on its pair's DENOMINATOR card;
// `num` names the numerator spot key (default "gold"). pairId maps each chip
// to its RATIO_PAIRS entry for the panel modal (STRK-271); the gold card's
// goldback chip has NO pairId — it shows a G1 rate, not a ratio, and must
// never open the ratios panel. Pt:Pd deliberately has no chip; it is
// reachable via the in-panel selector. The Ag:Cu chip rides the COPPER card
// (STRK-341), so its visibility structurally follows copper's Metal Order
// opt-in — no copper figure ever surfaces on a copper-less dashboard.
const RATIO_CHIP_CARDS = [
  { metal: "silver", label: "Au:Ag", decimals: 1, accentClass: "metal-silver", pairId: "au-ag" },
  {
    metal: "platinum",
    label: "Au:Pt",
    decimals: 2,
    accentClass: "metal-platinum",
    pairId: "au-pt",
  },
  {
    metal: "palladium",
    label: "Au:Pd",
    decimals: 2,
    accentClass: "metal-palladium",
    pairId: "au-pd",
  },
  {
    metal: "copper",
    label: "Ag:Cu",
    decimals: 1,
    accentClass: "metal-copper",
    pairId: "ag-cu",
    num: "silver",
  },
];

// Ratio/goldback math + freshness/estimate resolution moved to js/spot-ratio-math.js
// (loaded first). This file reads them as globals: computeRatio, formatRatio,
// isGoldbackStale, resolveGoldbackRate.

// =============================================================================
// RENDER LAYER (DOM)
// =============================================================================

/**
 * Returns true when the master "Show spot ratios" toggle is on (default ON).
 * @returns {boolean}
 */
const areRatioChipsEnabled = () => {
  try {
    return localStorage.getItem(SPOT_RATIOS_STORAGE_KEY) !== "false";
  } catch (error) {
    return true;
  }
};

/**
 * Removes the ratio chip from a spot card if one exists.
 * @param {HTMLElement} cardEl - The .spot-card element
 */
const removeRatioChip = (cardEl) => {
  const existing = cardEl.querySelector(".spot-ratio-chip");
  if (existing) existing.remove();
};

/**
 * Removes the chip-row spacer from a spot card if one exists.
 * @param {HTMLElement} cardEl - The .spot-card element
 */
const removeRatioChipSpacer = (cardEl) => {
  const existing = cardEl.querySelector(".spot-ratio-chip-spacer");
  if (existing) existing.remove();
};

/**
 * Inserts an empty, space-reserving placeholder (a chip's vertical footprint) between
 * .spot-card-change and .spot-card-timestamp, so a card whose chip is hidden keeps its
 * "Last API Sync" line aligned with the cards that show a chip (master toggle ON only).
 * @param {HTMLElement} cardEl - The .spot-card element
 */
const upsertRatioChipSpacer = (cardEl) => {
  if (cardEl.querySelector(".spot-ratio-chip-spacer")) return;
  const spacer = document.createElement("div");
  spacer.className = "spot-ratio-chip-spacer";
  spacer.setAttribute("aria-hidden", "true");
  spacer.textContent = " "; // reserve the chip's text-line height
  const timestamp = cardEl.querySelector(".spot-card-timestamp");
  if (timestamp) cardEl.insertBefore(spacer, timestamp);
  else cardEl.appendChild(spacer);
};

/**
 * Builds a chip's child nodes (glyph + label + value + optional est marker +
 * optional actionable caret) with safe DOM methods. Label/value are set via
 * textContent (no user-supplied HTML); the glyph is a static SVG literal
 * assigned to its own span's innerHTML.
 * @param {string} glyph - Inline SVG glyph markup (static literal)
 * @param {string} label - Chip label text
 * @param {string} value - Chip value text
 * @param {boolean} est - Whether to show the ~est estimate marker
 * @param {boolean} actionable - Whether to append the click-affordance caret
 * @returns {HTMLElement[]} The child elements to mount into the chip
 */
const buildRatioChipNodes = (glyph, label, value, est, actionable) => {
  const glyphEl = document.createElement("span");
  glyphEl.className = "glyph";
  // Static SVG constant — never user input.
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  glyphEl.innerHTML = glyph;

  const labEl = document.createElement("span");
  labEl.className = "lab";
  labEl.textContent = label;

  const valEl = document.createElement("span");
  valEl.className = "val";
  valEl.textContent = value;

  const nodes = [glyphEl, labEl, valEl];

  if (est) {
    const estEl = document.createElement("span");
    estEl.className = "est";
    estEl.textContent = "~est";
    nodes.push(estEl);
  }

  if (actionable) {
    const caretEl = document.createElement("span");
    caretEl.className = "caret";
    caretEl.setAttribute("aria-hidden", "true");
    caretEl.textContent = "▸";
    nodes.push(caretEl);
  }

  return nodes;
};

/**
 * Plain-English tooltip content for a card (mirrors the playground's tipText):
 * a bold heading plus a body line.
 * @param {string} metal - Card metal key
 * @returns {{ heading: string, body: string }}
 */
const ratioChipTipText = (metal) => {
  if (metal === "gold") {
    const gb = resolveGoldbackRate();
    if (!gb) return { heading: "Goldback G1 rate", body: "" };
    const suffix = gb.est ? " — spot estimate (cache stale)." : " (live cache).";
    return {
      heading: "Goldback G1 rate",
      body: `Current price of one 1-denomination goldback (1/1000 oz gold): $${formatRatio(gb.value, 2)}${suffix}`,
    };
  }
  // spotPrices (state.js) loads before this file — read it bare. computeRatio
  // already returns null for missing/≤0 inputs, so undefined metals are safe.
  if (metal === "copper") {
    const agcu = computeRatio(spotPrices.silver, spotPrices.copper);
    return {
      heading: "Silver-to-Copper Ratio",
      body: `It takes ${formatRatio(agcu, 1)} oz of copper to buy 1 oz of silver. Click for trends.`,
    };
  }
  const r = computeRatio(spotPrices.gold, spotPrices[metal]);
  if (metal === "silver") {
    return {
      heading: "Gold-to-Silver Ratio (GSR)",
      body: `It takes ${formatRatio(r, 1)} oz of silver to buy 1 oz of gold. Higher = silver relatively cheaper. Click for trends.`,
    };
  }
  const cap = metal.charAt(0).toUpperCase() + metal.slice(1);
  return {
    heading: `Gold ÷ ${cap}`,
    body: `${formatRatio(r, 2)} oz of ${metal} equals 1 oz of gold by spot value. Click for trends.`,
  };
};

/**
 * Creates or updates the ratio chip for a single metal card.
 * Inserts the chip as a sibling BETWEEN .spot-card-change and .spot-card-timestamp.
 * A chip descriptor carrying a pairId (the three ratio cards) becomes an
 * actionable button that opens the ratios panel modal (STRK-271); the gold
 * card's goldback chip carries no pairId and stays a passive display.
 * @param {HTMLElement} cardEl - The .spot-card element
 * @param {{accentClass:string, glyph:string, label:string, value:string,
 *   est:boolean, pairId:?string}} chip - Resolved chip descriptor
 */
const upsertRatioChip = (cardEl, chip) => {
  let chipEl = cardEl.querySelector(".spot-ratio-chip");
  if (!chipEl) {
    chipEl = document.createElement("div");
    const timestamp = cardEl.querySelector(".spot-card-timestamp");
    if (timestamp) {
      cardEl.insertBefore(chipEl, timestamp);
    } else {
      cardEl.appendChild(chipEl);
    }
  }
  const actionable = Boolean(chip.pairId);
  chipEl.className = `spot-ratio-chip ${chip.accentClass}${actionable ? " is-actionable" : ""}`;
  chipEl.setAttribute("tabindex", "0");
  chipEl.setAttribute("aria-describedby", "chipTip");
  if (actionable) {
    chipEl.dataset.pair = chip.pairId;
    chipEl.setAttribute("role", "button");
    chipEl.setAttribute("aria-haspopup", "dialog");
  } else {
    delete chipEl.dataset.pair;
    chipEl.removeAttribute("role");
    chipEl.removeAttribute("aria-haspopup");
  }
  chipEl.replaceChildren(
    ...buildRatioChipNodes(chip.glyph, chip.label, chip.value, chip.est, actionable)
  );
};

/**
 * Resolves a card's chip descriptor, or null when the chip should be hidden.
 * @param {string} metalKey - Spot metal key
 * @param {object} spots - Current spotPrices
 * @returns {{accentClass:string, glyph:string, label:string, value:string, est:boolean}|null}
 */
const resolveChipContent = (metalKey, spots) => {
  if (metalKey === "gold") {
    const gb = resolveGoldbackRate();
    if (!gb) return null;
    return {
      accentClass: "metal-gold",
      glyph: GOLDBACK_CHIP_GLYPH,
      label: "GB",
      value: `$${formatRatio(gb.value, 2)}`,
      est: gb.est,
      pairId: null,
    };
  }
  const card = RATIO_CHIP_CARDS.find((c) => c.metal === metalKey);
  if (!card) return null;
  // Numerator defaults to gold; Ag:Cu overrides with silver (STRK-341).
  const ratio = computeRatio(spots[card.num || "gold"], spots[metalKey]);
  if (ratio === null) return null;
  return {
    accentClass: card.accentClass,
    glyph: RATIO_CHIP_GLYPH,
    label: card.label,
    value: formatRatio(ratio, card.decimals),
    est: false,
    pairId: card.pairId,
  };
};

/**
 * Renders (or removes) the ratio chip for a single metal card. When the chip is
 * hidden but the master toggle is on, a spacer reserves the row so timestamps stay aligned.
 * @param {string} metalKey - Spot metal key (e.g. "silver", "gold", "platinum")
 */
const renderRatioChip = (metalKey) => {
  if (typeof document === "undefined") return;
  const cardEl = document.querySelector(`.spot-card[data-metal="${metalKey}"]`);
  if (!cardEl) return;

  // Master toggle off → no chip and no spacer (original card layout).
  if (!areRatioChipsEnabled()) {
    removeRatioChip(cardEl);
    removeRatioChipSpacer(cardEl);
    return;
  }

  // spotPrices (state.js) loads before this file — read it bare; resolveChipContent
  // tolerates missing keys (computeRatio returns null → chip hidden).
  const chip = resolveChipContent(metalKey, spotPrices);

  if (chip) {
    removeRatioChipSpacer(cardEl);
    upsertRatioChip(cardEl, chip);
  } else {
    // Master ON but this card has no chip → reserve the row so timestamps stay aligned.
    removeRatioChip(cardEl);
    upsertRatioChipSpacer(cardEl);
  }
};

/**
 * Idempotent choke point: creates/updates/removes the ratio chip on every spot
 * card from current state. Safe to call at the tail of every spot/goldback
 * DOM-write path.
 */
const renderRatioChips = () => {
  if (typeof document === "undefined") return;
  renderRatioChip("silver");
  renderRatioChip("gold");
  renderRatioChip("platinum");
  renderRatioChip("palladium");
  // Renders into the copper card, which is hidden unless copper is enabled
  // in Settings › Metal Order — chip visibility follows the opt-in (STRK-341).
  renderRatioChip("copper");
};

// =============================================================================
// TOOLTIP SINGLETON (position:fixed, body-appended → escapes overflow:hidden)
// =============================================================================

let ratioChipTipEl = null;

/**
 * Returns the singleton #chipTip element, creating + appending it to <body> once.
 * @returns {HTMLElement|null}
 */
const getRatioChipTip = () => {
  if (typeof document === "undefined") return null;
  if (ratioChipTipEl && document.body.contains(ratioChipTipEl)) return ratioChipTipEl;
  let tip = document.getElementById("chipTip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "chipTip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
  }
  ratioChipTipEl = tip;
  return tip;
};

/**
 * Shows the tooltip for a chip, positioned above it (flips below when no room).
 * @param {HTMLElement} chipEl - The chip the tooltip describes
 */
const showRatioChipTip = (chipEl) => {
  const tip = getRatioChipTip();
  if (!tip || !chipEl) return;
  const cardEl = chipEl.closest(".spot-card");
  const metal = cardEl ? cardEl.getAttribute("data-metal") : null;
  if (metal) {
    const { heading, body } = ratioChipTipText(metal);
    const headingEl = document.createElement("b");
    headingEl.textContent = heading;
    const nodes = [headingEl];
    if (body) {
      nodes.push(document.createElement("br"));
      nodes.push(document.createTextNode(body));
    }
    tip.replaceChildren(...nodes);
  } else {
    tip.replaceChildren();
  }
  tip.classList.add("show");

  const r = chipEl.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  let top = r.top - tr.height - 8;
  if (top < 8) top = r.bottom + 8; // flip below if no room above
  let left = r.left + r.width / 2 - tr.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
};

/**
 * Hides the tooltip.
 */
const hideRatioChipTip = () => {
  const tip =
    ratioChipTipEl || (typeof document !== "undefined" && document.getElementById("chipTip"));
  if (tip) tip.classList.remove("show");
};

/**
 * Wires hover/focus tooltip behavior via delegation on the spot-prices section,
 * plus a scroll listener that hides the tooltip. Idempotent — guarded so it
 * only attaches once.
 */
let ratioChipTipWired = false;
const wireRatioChipTooltip = () => {
  if (ratioChipTipWired || typeof document === "undefined") return;
  ratioChipTipWired = true;

  const findChip = (target) =>
    target && target.closest ? target.closest(".spot-ratio-chip") : null;

  // Two shared handlers cover both interaction modes: mouseenter/focus reveal,
  // mouseleave/blur dismiss. showRatioChipTip no-ops on a null chip, so onShow
  // needs no guard of its own.
  const onShow = (e) => showRatioChipTip(findChip(e.target));
  const onHide = (e) => {
    if (findChip(e.target)) hideRatioChipTip();
  };

  document.addEventListener("mouseenter", onShow, true);
  document.addEventListener("focus", onShow, true);
  document.addEventListener("mouseleave", onHide, true);
  document.addEventListener("blur", onHide, true);
  window.addEventListener("scroll", hideRatioChipTip, true);
};

// =============================================================================
// RATIOS PANEL MODAL HOST (STRK-271) — the in-app half of STRK-268
// =============================================================================

let ratiosPanelHandle = null;
let ratiosPanelOriginEl = null;

/**
 * Opens the ratios panel modal on a pair, mounting the STRK-270 shared panel
 * into #ratiosPanelMount. The clicked chip sets the initial pair; the in-panel
 * selector lets the user switch without closing. Dismisses the chip tooltip
 * first — it is position:fixed with z-index 9999 and body-appended, so it
 * would otherwise float above the dialog.
 * @param {string} pairId - RATIO_PAIRS id to open on (e.g. "au-pd")
 * @param {?HTMLElement} originEl - Element to return focus to on close
 */
const openRatiosPanelModal = (pairId, originEl) => {
  const mount = document.getElementById("ratiosPanelMount");
  const modal = document.getElementById("ratiosPanelModal");
  if (!mount || !modal || typeof renderRatiosPanel !== "function") return;
  hideRatioChipTip();
  ratiosPanelOriginEl = originEl || null;
  if (ratiosPanelHandle) ratiosPanelHandle.destroy();
  ratiosPanelHandle = renderRatiosPanel(mount, { initialPairId: pairId });
  if (window.openModalById) window.openModalById("ratiosPanelModal");
  // openModalById focuses the first focusable element (the header close
  // button); move focus into the panel — onto the pressed pair button.
  const pressed = mount.querySelector('.gsr-pairs button[aria-pressed="true"]');
  if (pressed) pressed.focus();
};

/**
 * Closes the ratios panel modal, tears down the mounted panel (chart +
 * observers), and returns focus to the originating chip.
 */
const closeRatiosPanelModal = () => {
  const modal = document.getElementById("ratiosPanelModal");
  if (!modal || modal.style.display === "none") return;
  if (ratiosPanelHandle) {
    ratiosPanelHandle.destroy();
    ratiosPanelHandle = null;
  }
  if (window.closeModalById) window.closeModalById("ratiosPanelModal");
  if (ratiosPanelOriginEl && document.contains(ratiosPanelOriginEl)) {
    ratiosPanelOriginEl.focus();
  }
  ratiosPanelOriginEl = null;
};

/**
 * Wires chip activation (click + Enter/Space on .is-actionable chips) and the
 * modal chrome (close button, Esc, backdrop). The backdrop handler is claimed
 * HERE, before the first openModalById call, because openModalById's built-in
 * click-outside handler calls closeModalById directly — bypassing the panel
 * teardown and focus return this host needs. Idempotent — attaches once.
 */
let ratioChipActivationWired = false;
const wireRatioChipActivation = () => {
  if (ratioChipActivationWired || typeof document === "undefined") return;
  ratioChipActivationWired = true;

  const findActionableChip = (target) =>
    target && target.closest ? target.closest(".spot-ratio-chip.is-actionable") : null;

  document.addEventListener("click", (e) => {
    const chipEl = findActionableChip(e.target);
    if (chipEl) openRatiosPanelModal(chipEl.dataset.pair, chipEl);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const chipEl = findActionableChip(e.target);
    if (!chipEl) return;
    e.preventDefault(); // Space must not scroll the page
    openRatiosPanelModal(chipEl.dataset.pair, chipEl);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeRatiosPanelModal();
  });

  const closeBtn = document.getElementById("ratiosPanelCloseBtn");
  if (closeBtn) closeBtn.addEventListener("click", closeRatiosPanelModal);
  const modal = document.getElementById("ratiosPanelModal");
  if (modal && !modal.dataset.initialized) {
    modal.dataset.initialized = "true";
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeRatiosPanelModal();
    });
  }
};

/**
 * DOM-ready init: ensure the tooltip singleton exists, wire interaction, and
 * paint the chips once. The script is deferred (loads after init.js), so the
 * DOM is parsed by the time this runs.
 */
const initRatioChips = () => {
  getRatioChipTip();
  wireRatioChipTooltip();
  wireRatioChipActivation();
  renderRatioChips();
};

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRatioChips);
  } else {
    initRatioChips();
  }
}

// =============================================================================
// GLOBAL EXPOSURE (math globals are exposed by spot-ratio-math.js)
// =============================================================================
if (typeof window !== "undefined") {
  window.renderRatioChips = renderRatioChips;
  window.renderRatioChip = renderRatioChip;
  window.openRatiosPanelModal = openRatiosPanelModal;
  window.closeRatiosPanelModal = closeRatiosPanelModal;
}

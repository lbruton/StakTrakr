// SPOT-CARD RATIO CHIPS (STRK-161)
// =============================================================================
// Pure display layer that renders a per-spot-card ratio chip (e.g. Au:Ag) plus
// a goldback rate chip, with a position:fixed tooltip singleton. Owns the
// ratio/goldback math, freshness/estimate resolution, and the idempotent
// renderRatioChips() choke point invoked from every spot/goldback DOM-write path.
// =============================================================================

const SPOT_RATIOS_STORAGE_KEY =
  typeof SPOT_RATIOS_KEY !== "undefined" ? SPOT_RATIOS_KEY : "show-spot-ratios";

// Inline glyphs (stroke="currentColor" so they inherit the metal accent token).
const RATIO_CHIP_GLYPH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7l-3 6a3 3 0 0 0 6 0z"/><path d="M19 7l-3 6a3 3 0 0 0 6 0z"/></svg>`;
const GOLDBACK_CHIP_GLYPH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M5 9v6M19 9v6"/></svg>`;

// Ratio-card definitions (gold ÷ <metal>). The gold card is handled separately.
const RATIO_CHIP_CARDS = [
  { metal: "silver", label: "Au:Ag", decimals: 1, accentClass: "metal-silver" },
  { metal: "platinum", label: "Au:Pt", decimals: 2, accentClass: "metal-platinum" },
  { metal: "palladium", label: "Au:Pd", decimals: 2, accentClass: "metal-palladium" },
];

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
  const cacheEntry =
    typeof goldbackPrices !== "undefined" && goldbackPrices ? goldbackPrices["1"] : null;
  if (!cacheEntry || isGoldbackStale(cacheEntry)) return null;
  const cached =
    typeof getGoldbackDenominationPrice === "function" ? getGoldbackDenominationPrice(1) : null;
  return typeof cached === "number" && cached > 0 ? cached : null;
};

/**
 * Returns the spot-derived goldback estimate (> 0), or null. Reads bare globals.
 * @returns {number|null}
 */
const readGoldbackSpotEstimate = () => {
  const gold = typeof spotPrices !== "undefined" && spotPrices ? spotPrices.gold : 0;
  if (typeof computeGoldbackEstimatedRate !== "function" || !Number.isFinite(gold) || gold <= 0) {
    return null;
  }
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
  const mode = typeof goldbackPricingSource !== "undefined" ? goldbackPricingSource : "off";
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
 * Builds a chip's child nodes (glyph + label + value + optional est marker) with
 * safe DOM methods. Label/value are set via textContent (no user-supplied HTML);
 * the glyph is a static SVG literal assigned to its own span's innerHTML.
 * @param {string} glyph - Inline SVG glyph markup (static literal)
 * @param {string} label - Chip label text
 * @param {string} value - Chip value text
 * @param {boolean} est - Whether to show the ~est estimate marker
 * @returns {HTMLElement[]} The child elements to mount into the chip
 */
const buildRatioChipNodes = (glyph, label, value, est) => {
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
  const gold = typeof spotPrices !== "undefined" && spotPrices ? spotPrices.gold : 0;
  const r = computeRatio(gold, spotPrices ? spotPrices[metal] : 0);
  if (metal === "silver") {
    return {
      heading: "Gold-to-Silver Ratio (GSR)",
      body: `It takes ${formatRatio(r, 1)} oz of silver to buy 1 oz of gold. Higher = silver relatively cheaper.`,
    };
  }
  const cap = metal.charAt(0).toUpperCase() + metal.slice(1);
  return {
    heading: `Gold ÷ ${cap}`,
    body: `${formatRatio(r, 2)} oz of ${metal} equals 1 oz of gold by spot value.`,
  };
};

/**
 * Creates or updates the ratio chip for a single metal card.
 * Inserts the chip as a sibling BETWEEN .spot-card-change and .spot-card-timestamp.
 * @param {HTMLElement} cardEl - The .spot-card element
 * @param {string} accentClass - Metal accent class (e.g. "metal-silver")
 * @param {string} glyph - Inline SVG glyph markup
 * @param {string} label - Chip label text
 * @param {string} value - Chip value text
 * @param {boolean} est - Whether to show the ~est estimate marker
 */
const upsertRatioChip = (cardEl, accentClass, glyph, label, value, est) => {
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
  chipEl.className = `spot-ratio-chip ${accentClass}`;
  chipEl.setAttribute("tabindex", "0");
  chipEl.setAttribute("aria-describedby", "chipTip");
  chipEl.replaceChildren(...buildRatioChipNodes(glyph, label, value, est));
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
    };
  }
  const card = RATIO_CHIP_CARDS.find((c) => c.metal === metalKey);
  if (!card) return null;
  const ratio = computeRatio(spots.gold, spots[metalKey]);
  if (ratio === null) return null;
  return {
    accentClass: card.accentClass,
    glyph: RATIO_CHIP_GLYPH,
    label: card.label,
    value: formatRatio(ratio, card.decimals),
    est: false,
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

  const spots = typeof spotPrices !== "undefined" && spotPrices ? spotPrices : {};
  const chip = resolveChipContent(metalKey, spots);

  if (chip) {
    removeRatioChipSpacer(cardEl);
    upsertRatioChip(cardEl, chip.accentClass, chip.glyph, chip.label, chip.value, chip.est);
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

  document.addEventListener(
    "mouseenter",
    (e) => {
      const chipEl = findChip(e.target);
      if (chipEl) showRatioChipTip(chipEl);
    },
    true
  );
  document.addEventListener(
    "mouseleave",
    (e) => {
      if (findChip(e.target)) hideRatioChipTip();
    },
    true
  );
  document.addEventListener(
    "focus",
    (e) => {
      const chipEl = findChip(e.target);
      if (chipEl) showRatioChipTip(chipEl);
    },
    true
  );
  document.addEventListener(
    "blur",
    (e) => {
      if (findChip(e.target)) hideRatioChipTip();
    },
    true
  );
  window.addEventListener("scroll", hideRatioChipTip, true);
};

/**
 * DOM-ready init: ensure the tooltip singleton exists, wire interaction, and
 * paint the chips once. The script is deferred (loads after init.js), so the
 * DOM is parsed by the time this runs.
 */
const initRatioChips = () => {
  getRatioChipTip();
  wireRatioChipTooltip();
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

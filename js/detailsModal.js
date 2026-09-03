// =============================================================================
// DETAIL MODAL — STRK-352 Variant A "Stack Story"
//
// Full rewrite of the legacy two-pie details modal. Opened from the dashboard
// totals-card titles via the unchanged public contract showDetailsModal(metal)
// / closeDetailsModal(). Renders, per open: a five-tile KPI strip, the hero
// portfolio chart (melt vs cost basis, per-metal spot overlay, acquisition
// markers, disposition markers — Chart.js 3.9.1, linear index x-axis, external HTML tooltip, inline
// crosshair plugin), composition panels (stacked bars + rows with the
// Purchase/Melt/Retail/Gain-Loss metric toggle), the acquisitions ledger, and
// the loading/empty/disposed-only states.
//
// Series math lives in js/portfolio-series.js (pure, unit-tested); per-day
// spot assembly in js/spot.js getSpotDayMap. Two-phase open: skeletons render
// synchronously, day maps are awaited, then the body renders — guarded by a
// render generation counter so a close-during-load can never repopulate a
// stale modal (approach D-3). Pixel authority: the approved playground
// prototype (playground/metal-detail-modal-playground.html, PR #1475).
// =============================================================================

/** @type {number} Render generation — bumped on every open AND close; async
 *  continuations compare against it and abort when stale (D-3). */
let _dmGeneration = 0;

/** @type {string} Current scope: "All" or a metal display name */
let _dmScope = "All";

/** @type {object|null} Built portfolio series for the current open */
let _dmSeries = null;

/** @type {Object<string, Map<string, number>>|null} Day maps for the open */
let _dmSpotMaps = null;

/** @type {string} Active range pill */
let _dmRange = "1Y";

/** @type {string} Active composition metric */
let _dmMetric = "melt";

/** @type {{basis: boolean, spot: boolean, buys: boolean, dispositions: boolean}} Series toggles */
let _dmShow = { basis: true, spot: true, buys: true, dispositions: true };

/** @type {ResizeObserver|null} Chart resize observer for the open modal */
let _dmResizeObserver = null;

/** @type {Map<string, string>|null} Purchase location → var() color, written
 *  by the By Purchase Location panel on every build so the marker tooltip
 *  paints each location the same way the bars do (STRK-361). */
let _dmLocColors = null;

/** Chart.js pointHitRadius for buy/disposition markers (STRK-361 AC-1). */
const _DM_MARKER_HIT_RADIUS = 12;

/**
 * Marker radius scaled by the day's dollar total — floor 5 so the smallest
 * buy is still a clear dot, cap 10 so a big day never blots the line.
 * @param {number} total - Day total (cost for buys, melt-out for dispositions)
 * @returns {number} Radius in px
 */
const _dmMarkerRadius = (total) => Math.max(5, Math.min(10, Math.sqrt(total) / 5));

/** Days per range pill; ALL spans the whole series. */
const _DM_RANGES = { "30D": 30, "90D": 90, "1Y": 365, ALL: Infinity };

/** Metal display name → theme token (getThemeColorRGB form, no "--"). */
const _DM_ACCENT_TOKEN = {
  Silver: "silver",
  Gold: "gold",
  Platinum: "platinum",
  Palladium: "palladium",
  Copper: "copper",
  All: "primary",
};

/** Composition palette for non-metal dimensions — --info leads so the dark
 *  theme's gold --primary never mimics a metal inside a non-gold modal. */
const _DM_PALETTE = ["info", "success", "warning", "danger", "secondary", "primary"];

// ── small helpers ───────────────────────────────────────────────────────────

/**
 * The modal body container (static shell, index.html).
 * @returns {HTMLElement|null} #dmBody
 */
const _dmBody = () => document.getElementById("dmBody");

/**
 * Active (non-disposed) Items for a scope, ledger-ordered.
 * @param {string} scope - "All" or metal display name
 * @returns {Array<object>} Active Items, newest first, undated last
 */
const _dmActiveItems = (scope) => pickLedgerRows(inventory, scope);

/**
 * Disposed Items for a scope.
 * @param {string} scope - "All" or metal display name
 * @returns {Array<object>} Disposed Items
 */
const _dmDisposedItems = (scope) =>
  inventory.filter((it) => (scope === "All" || it?.metal === scope) && isDisposed(it));

/**
 * Derived troy oz for one Item (qty-folded; cu via the constitutional helper).
 * @param {object} item - Inventory Item
 * @returns {number} Derived oz
 */
const _dmItemOz = (item) => {
  if (item.weightUnit === "cu") return Number(getConstitutionalSilverOz(item)) || 0;
  return (Number(getUnitOztWeight(item)) || 0) * (Number(item.qty) || 1);
};

/**
 * Signed currency string in the active display currency.
 * @param {number} v - Value in USD
 * @returns {string} e.g. "+$12.34", "−$12.34", "$0.00"
 */
const _dmSigned = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + formatCurrency(Math.abs(v));

/**
 * Numeric [r, g, b] from a resolved theme color. resolveColor passes #hex
 * through untouched (slate defines its metal accents as hex), so channel
 * extraction must parse both rgb() and hex — digit-scraping a hex string
 * builds an invalid rgba() and addColorStop throws (live slate regression).
 * @param {string} color - rgb()/rgba()/#rrggbb/#rgb color string
 * @returns {number[]} [r, g, b], gray fallback for anything unparseable
 */
const _dmRgbTriple = (color) => {
  const s = String(color || "").trim();
  const rgb = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex6 = s.match(/^#([0-9a-f]{6})$/i);
  if (hex6) {
    const n = parseInt(hex6[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const hex3 = s.match(/^#([0-9a-f]{3})$/i);
  if (hex3) {
    return [...hex3[1]].map((c) => parseInt(c + c, 16));
  }
  return [128, 128, 128];
};

/**
 * "Mon YY" axis label from a day key — string math only, no Date objects.
 * @param {string} dayKey - "YYYY-MM-DD"
 * @returns {string} Short label
 */
const _dmMonthLabel = (dayKey) => {
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${MONTHS[Number(dayKey.slice(5, 7)) - 1]} ${dayKey.slice(2, 4)}`;
};

/**
 * First visible day key for the active range pill.
 * @returns {string} Day key (series start when the pill is ALL)
 */
const _dmWindowStartKey = () => {
  const days = _dmSeries?.days || [];
  if (days.length === 0) return "";
  const span = _DM_RANGES[_dmRange];
  if (!Number.isFinite(span)) return days[0];
  return days[Math.max(0, days.length - 1 - span)];
};

// ── header + substats ───────────────────────────────────────────────────────

/**
 * Render the static-shell header for the scope (title, accent, substats).
 * @param {string} scope - "All" or metal display name
 */
const _dmRenderHeader = (scope) => {
  const title = document.getElementById("detailsModalTitle");
  const header = document.getElementById("dmHeader");
  const substats = document.getElementById("dmSubstats");
  if (title) {
    title.textContent =
      scope === "All" ? "All Metals — Portfolio" : `${scope} — Detailed Breakdown`;
  }
  if (header) header.setAttribute("data-accent", scope.toLowerCase());

  const active = _dmActiveItems(scope);
  const units = active.reduce((a, it) => a + (Number(it.qty) || 1), 0);
  const oz = active.reduce((a, it) => a + _dmItemOz(it), 0);
  const dated = active.map((it) => it.date).filter((d) => typeof d === "string" && d !== "");
  let since = "";
  if (dated.length > 0) {
    const first = dated.reduce((a, b) => (a < b ? a : b));
    since = ` · since ${_dmMonthLabel(first).split(" ")[0]} ${first.slice(0, 4)}`;
  }
  if (substats) substats.textContent = `${units} items · ${oz.toFixed(2)} oz${since}`;
};

// ── skeletons / empty state ─────────────────────────────────────────────────

/**
 * Render the loading skeletons into the body (synchronous open phase).
 */
const _dmRenderSkeletons = () => {
  const body = _dmBody();
  if (!body) return;
  // static developer markup — no user content interpolated
  body.innerHTML = `
    <div class="dm-kpis">${'<div class="dm-skel" style="height:64px"></div>'.repeat(5)}</div>
    <div class="dm-skel" style="height:300px;margin-bottom:var(--spacing)"></div>
    <div class="dm-grid">
      <div class="dm-skel" style="height:200px"></div>
      <div class="dm-skel" style="height:200px"></div>
    </div>`;
};

/**
 * Render the empty state (scope has zero active AND zero disposed Items).
 * @param {string} scope - "All" or metal display name
 */
const _dmRenderEmpty = (scope) => {
  const body = _dmBody();
  if (!body) return;
  body.textContent = "";
  const wrap = document.createElement("div");
  wrap.className = "empty-state";
  const icon = document.createElement("div");
  icon.className = "empty-state-icon";
  icon.textContent = "🪙";
  const h3 = document.createElement("h3");
  h3.textContent = scope === "All" ? "No items yet" : `No ${scope.toLowerCase()} items yet`;
  const p = document.createElement("p");
  p.textContent =
    "Add your first item and this view lights up — value over time, cost basis, and your acquisition history.";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn";
  btn.textContent = "+ Add Item";
  btn.addEventListener("click", () => {
    // STRK-13: mirror the card-view / inventory-table Add Item empty-state
    // guard — when saveInventory recovery is active, the recovery banner
    // owns the screen and this CTA must not let a panicked user defeat the
    // recovery hold by reaching the add-item flow.
    if (typeof isInventoryRecoveryActive === "function" && isInventoryRecoveryActive()) {
      return;
    }
    // D-15: run the full #newItemBtn path — its handler owns the edit-state
    // and picker-state reset; opening #itemModal directly can leak stale data
    closeDetailsModal();
    const addBtn = document.getElementById("newItemBtn");
    if (addBtn) addBtn.click();
  });
  wrap.appendChild(icon);
  wrap.appendChild(h3);
  wrap.appendChild(p);
  wrap.appendChild(btn);
  body.appendChild(wrap);
};

// ── KPI strip ───────────────────────────────────────────────────────────────

/**
 * Compute the KPI totals for a scope from active + disposed Items.
 * @param {string} scope - "All" or metal display name
 * @returns {{purchase: number, melt: number, retail: number, unrealized: number,
 *   realized: number, oz: number, avgCost: number}} Totals in USD
 */
const _dmKpiTotals = (scope) => {
  const active = _dmActiveItems(scope);
  let purchase = 0;
  let melt = 0;
  let retail = 0;
  let unrealized = 0;
  let oz = 0;
  active.forEach((it) => {
    const spot = spotPrices[(it.metal || "Silver").toLowerCase()] || 0;
    const v = computeItemValuation(it, spot);
    purchase += v.purchaseTotal;
    melt += v.meltValue;
    retail += v.retailTotal;
    unrealized += v.gainLoss ?? v.retailTotal - v.purchaseTotal;
    oz += _dmItemOz(it);
  });
  const realized = _dmDisposedItems(scope).reduce(
    (a, it) => a + (Number(it.disposition?.realizedGainLoss) || 0),
    0
  );
  return { purchase, melt, retail, unrealized, realized, oz, avgCost: oz > 0 ? purchase / oz : 0 };
};

/**
 * Build the KPI strip element.
 * @param {string} scope - "All" or metal display name
 * @returns {HTMLElement} .dm-kpis
 */
const _dmBuildKpis = (scope) => {
  const t = _dmKpiTotals(scope);
  const spotNow = scope !== "All" ? spotPrices[scope.toLowerCase()] || 0 : 0;
  const premium =
    scope !== "All" && spotNow > 0 && t.oz > 0 ? (t.avgCost / spotNow - 1) * 100 : null;
  const meltSub =
    scope === "All" || premium == null
      ? "at today's spot"
      : `bought ${premium >= 0 ? "+" : ""}${premium.toFixed(1)}% vs spot now`;
  const gainCls = t.unrealized >= 0 ? "dm-kpi--gain" : "dm-kpi--loss";
  const unrealPct = t.purchase > 0 ? (t.unrealized / t.purchase) * 100 : null;
  const unrealSub =
    unrealPct == null
      ? "vs cost basis"
      : `${unrealPct >= 0 ? "+" : "−"}${Math.abs(unrealPct).toFixed(1)}% vs cost basis`;

  const strip = document.createElement("div");
  strip.className = "dm-kpis";
  const tiles = [
    {
      // STRK-362: "Cost Basis", not "Purchase" — this tile sums ACTIVE items
      // only, while the substrip's invested is all-time flow incl. since-sold
      label: "Cost Basis",
      value: formatCurrency(t.purchase),
      sub: `${formatCurrency(t.avgCost)}/oz avg`,
      cls: "",
    },
    { label: "Melt Value", value: formatCurrency(t.melt), sub: meltSub, cls: "" },
    { label: "Retail Value", value: formatCurrency(t.retail), sub: "est. replacement", cls: "" },
    { label: "Unrealized", value: _dmSigned(t.unrealized), sub: unrealSub, cls: gainCls },
    {
      label: "Realized",
      value: formatCurrency(t.realized),
      sub: "from disposed items",
      cls: "",
    },
  ];
  tiles.forEach((tile) => {
    const el = document.createElement("div");
    el.className = `dm-kpi${tile.cls ? ` ${tile.cls}` : ""}`;
    const label = document.createElement("div");
    label.className = "dm-kpi-label";
    label.textContent = tile.label;
    const value = document.createElement("div");
    value.className = "dm-kpi-value";
    value.textContent = tile.value;
    const sub = document.createElement("div");
    sub.className = "dm-kpi-sub";
    sub.textContent = tile.sub;
    el.appendChild(label);
    el.appendChild(value);
    el.appendChild(sub);
    strip.appendChild(el);
  });
  return strip;
};

// ── segmented controls ──────────────────────────────────────────────────────

/**
 * Build a hugging segmented control (.chart-metric-toggle.dm-seg).
 * @param {Array<[string, string]>} pairs - [value, label] entries
 * @param {string} activeKey - Currently active value
 * @param {string} dataKey - data-* attribute name ("range" | "metric")
 * @param {(value: string) => void} onSelect - Selection callback
 * @returns {HTMLElement} The control
 */
const _dmBuildSeg = (pairs, activeKey, dataKey, onSelect) => {
  const wrap = document.createElement("div");
  wrap.className = "chart-metric-toggle dm-seg";
  pairs.forEach(([key, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chart-metric-btn${key === activeKey ? " active" : ""}`;
    btn.dataset[dataKey] = key;
    btn.setAttribute("aria-pressed", key === activeKey ? "true" : "false");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".chart-metric-btn").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      onSelect(key);
    });
    wrap.appendChild(btn);
  });
  return wrap;
};

// ── composition panels ──────────────────────────────────────────────────────

/**
 * Aggregate active Items along a dimension with all four metric values.
 * @param {string} scope - "All" or metal display name
 * @param {"primary"|"location"} dim - By metal/type vs by purchase location
 * @returns {Array<[string, object]>} Entries ranked by |active metric| desc,
 *   ties broken alphabetically (AC-16)
 */
const _dmAggregate = (scope, dim) => {
  const buckets = new Map();
  _dmActiveItems(scope).forEach((it) => {
    const key =
      dim === "location"
        ? it.purchaseLocation || "Unknown"
        : scope === "All"
          ? it.metal || "Unknown"
          : it.type || "Other";
    if (!buckets.has(key)) {
      buckets.set(key, { purchase: 0, melt: 0, retail: 0, gainLoss: 0, count: 0, oz: 0 });
    }
    const b = buckets.get(key);
    const spot = spotPrices[(it.metal || "Silver").toLowerCase()] || 0;
    const v = computeItemValuation(it, spot);
    b.purchase += v.purchaseTotal;
    b.melt += v.meltValue;
    b.retail += v.retailTotal;
    b.gainLoss += v.gainLoss ?? v.retailTotal - v.purchaseTotal;
    b.count += Number(it.qty) || 1;
    b.oz += _dmItemOz(it);
  });
  return [...buckets.entries()].sort((a, b) => {
    const diff = Math.abs(b[1][_dmMetric]) - Math.abs(a[1][_dmMetric]);
    return diff !== 0 ? diff : a[0].localeCompare(b[0]);
  });
};

/**
 * CSS color values per entry (var() strings — safe for DOM, never for canvas).
 * @param {string} scope - Scope
 * @param {Array<[string, object]>} entries - Aggregated entries
 * @param {"primary"|"location"} dim - Dimension
 * @returns {string[]} CSS color per entry
 */
const _dmCompColors = (scope, entries, dim) =>
  entries.map(([key], i) => {
    if (scope === "All" && dim === "primary" && _DM_ACCENT_TOKEN[key]) {
      return `var(--${_DM_ACCENT_TOKEN[key]})`;
    }
    return `var(--${_DM_PALETTE[i % _DM_PALETTE.length]})`;
  });

/**
 * Build one composition panel (stacked bar + top-5 rows + "+N more…",
 * STRK-358 — trimmed from 6 so the modal fits a desktop viewport).
 * @param {string} scope - Scope
 * @param {"primary"|"location"} dim - Dimension
 * @param {string} title - Panel title
 * @returns {HTMLElement} .dm-panel
 */
const _dmBuildCompPanel = (scope, dim, title) => {
  const entries = _dmAggregate(scope, dim);
  const colors = _dmCompColors(scope, entries, dim);
  if (dim === "location") {
    // single writer: the metric toggle re-ranks entries (colors are
    // index-assigned), and every rebuild passes through here
    _dmLocColors = new Map(entries.map(([key], i) => [key, colors[i]]));
  }
  const total = entries.reduce((a, [, b]) => a + Math.abs(b[_dmMetric]), 0) || 1;

  const panel = document.createElement("div");
  panel.className = "dm-panel";
  const h = document.createElement("h3");
  h.className = "dm-panel-title";
  h.textContent = title;
  panel.appendChild(h);

  const bar = document.createElement("div");
  bar.className = "dm-comp-bar";
  entries.forEach(([key, b], i) => {
    const seg = document.createElement("div");
    seg.className = "dm-comp-seg";
    seg.style.width = `${((Math.abs(b[_dmMetric]) / total) * 100).toFixed(2)}%`;
    seg.style.background = colors[i];
    seg.title = key; // attribute assignment — user content is inert here
    bar.appendChild(seg);
  });
  panel.appendChild(bar);

  const rows = document.createElement("div");
  rows.className = "dm-comp-rows";
  const top = entries.slice(0, 5);
  top.forEach(([key, b], i) => {
    const row = document.createElement("div");
    row.className = "dm-comp-row";
    const dot = document.createElement("span");
    dot.className = "dm-comp-dot";
    dot.style.background = colors[i];
    const name = document.createElement("span");
    name.className = "dm-comp-name";
    name.textContent = key;
    const meta = document.createElement("span");
    meta.className = "dm-comp-meta";
    meta.textContent = `${b.count} · ${b.oz.toFixed(1)} oz · ${((Math.abs(b[_dmMetric]) / total) * 100).toFixed(0)}%`;
    const val = document.createElement("span");
    const v = b[_dmMetric];
    val.className = `dm-comp-val${_dmMetric === "gainLoss" ? (v >= 0 ? " dm-pos" : " dm-neg") : ""}`;
    val.textContent = _dmMetric === "gainLoss" ? _dmSigned(v) : formatCurrency(Math.abs(v));
    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(meta);
    row.appendChild(val);
    rows.appendChild(row);
  });
  if (entries.length > top.length) {
    const more = document.createElement("div");
    more.className = "dm-comp-row dm-comp-more";
    const name = document.createElement("span");
    name.className = "dm-comp-name";
    name.textContent = `+ ${entries.length - top.length} more…`;
    more.appendChild(name);
    rows.appendChild(more);
  }
  panel.appendChild(rows);
  return panel;
};

/**
 * Re-render both composition panels in place (metric toggle handler).
 */
const _dmRerenderComposition = () => {
  const col = document.getElementById("dmCompCol");
  if (!col) return;
  col.textContent = "";
  col.appendChild(
    _dmBuildCompPanel(_dmScope, "primary", _dmScope === "All" ? "By Metal" : "By Type")
  );
  col.appendChild(_dmBuildCompPanel(_dmScope, "location", "By Purchase Location"));
};

// ── acquisitions ledger ─────────────────────────────────────────────────────

/**
 * Build the ledger panel inside its equal-height fill cell.
 * @param {string} scope - Scope
 * @returns {HTMLElement} .dm-ledger-fill wrapper
 */
const _dmBuildLedger = (scope) => {
  const rows = _dmActiveItems(scope);

  const fill = document.createElement("div");
  fill.className = "dm-ledger-fill";
  const panel = document.createElement("div");
  panel.className = "dm-panel";
  const h = document.createElement("h3");
  h.className = "dm-panel-title";
  h.textContent = "Acquisitions";
  const hint = document.createElement("span");
  hint.className = "dm-panel-hint";
  hint.textContent = "newest first · click to open item";
  h.appendChild(hint);
  panel.appendChild(h);

  const wrap = document.createElement("div");
  wrap.className = "dm-ledger-wrap";
  const table = document.createElement("table");
  table.className = "dm-ledger";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  [
    ["Date", ""],
    ["Item", ""],
    ["Qty", "num"],
    ["Paid", "num dm-col-paid"],
    ["Melt now", "num dm-col-melt"],
    ["±%", "num"],
  ].forEach(([label, cls]) => {
    const th = document.createElement("th");
    if (cls) th.className = cls;
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((it) => {
    const spot = spotPrices[(it.metal || "Silver").toLowerCase()] || 0;
    const v = computeItemValuation(it, spot);
    const paid = v.purchaseTotal;
    const meltNow = v.meltValue;
    const pct = paid > 0 ? ((meltNow - paid) / paid) * 100 : null;

    const tr = document.createElement("tr");
    tr.dataset.uuid = it.uuid || "";
    tr.dataset.date = typeof it.date === "string" ? it.date : "";
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-label", `Open ${it.name || "item"}`);

    const dateTd = document.createElement("td");
    dateTd.className = "dm-ledger-date";
    dateTd.textContent = it.date && it.date !== "" ? it.date : "—";

    const itemTd = document.createElement("td");
    itemTd.className = "dm-item-td";
    const lrow = document.createElement("div");
    lrow.className = "dm-lrow";
    if (scope === "All") {
      const dot = document.createElement("span");
      dot.className = "dm-metal-dot";
      dot.style.background = `var(--${_DM_ACCENT_TOKEN[it.metal] || "secondary"})`;
      dot.title = it.metal || "";
      lrow.appendChild(dot);
    }
    const name = document.createElement("span");
    name.className = "dm-item-name";
    name.textContent = it.name || "(unnamed)";
    lrow.appendChild(name);
    // STRK-356: no type pill in this compact view — type detail lives in the
    // Inventory panel; the freed width goes to the never-truncated amounts
    itemTd.appendChild(lrow);

    const qtyTd = document.createElement("td");
    qtyTd.className = "num";
    qtyTd.textContent = `×${Number(it.qty) || 1}`;
    const paidTd = document.createElement("td");
    paidTd.className = "num dm-col-paid";
    paidTd.textContent = formatCurrency(paid);
    const meltTd = document.createElement("td");
    meltTd.className = "num dm-col-melt";
    meltTd.textContent = formatCurrency(meltNow);
    const pctTd = document.createElement("td");
    pctTd.className = pct == null ? "num" : `num ${pct >= 0 ? "dm-pos" : "dm-neg"}`;
    pctTd.textContent = pct == null ? "—" : `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}%`;

    tr.appendChild(dateTd);
    tr.appendChild(itemTd);
    tr.appendChild(qtyTd);
    tr.appendChild(paidTd);
    tr.appendChild(meltTd);
    tr.appendChild(pctTd);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);

  if (rows.length === 0) {
    const note = document.createElement("div");
    note.className = "dm-ledger-note";
    note.textContent = "No active items — disposed history lives in the Inventory tab.";
    wrap.appendChild(note);
  }
  panel.appendChild(wrap);

  const actions = document.createElement("div");
  actions.className = "dm-foot-actions";
  const link = document.createElement("button");
  link.type = "button";
  link.className = "dm-link";
  link.textContent = "View all in Inventory →";
  link.addEventListener("click", () => {
    closeDetailsModal();
    if (typeof activateTab === "function") activateTab("inventory");
  });
  actions.appendChild(link);
  panel.appendChild(actions);

  // delegated activation: click / Enter / Space on a row opens the Item View
  // modal, resolving the index late so inventory mutations can't strand it
  const activate = (target) => {
    const tr = target.closest("tr[data-uuid]");
    if (!tr) return;
    const idx = inventory.findIndex((it) => it.uuid === tr.dataset.uuid);
    if (idx >= 0 && typeof showViewModal === "function") showViewModal(idx);
  };
  wrap.addEventListener("click", (e) => activate(e.target));
  wrap.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    activate(e.target);
  });

  fill.appendChild(panel);
  return fill;
};

/**
 * Scroll to and flash every active ledger row sharing an acquisition date;
 * no-op when the date has no active rows (all disposed — AC-14).
 * @param {string} dayKey - Acquisition date
 */
const _dmFlashLedgerRows = (dayKey) => {
  const rows = document.querySelectorAll(
    `#detailsModal .dm-ledger tbody tr[data-date="${CSS.escape(dayKey)}"]`
  );
  if (rows.length === 0) return;
  rows[0].scrollIntoView({ block: "nearest", behavior: "smooth" });
  rows.forEach((row) => {
    row.classList.remove("dm-flash");
    void row.offsetWidth; // restart the CSS animation
    row.classList.add("dm-flash");
  });
};

// ── substrip ────────────────────────────────────────────────────────────────

/**
 * Render the window statistics substrip for the active range.
 */
const _dmRenderSubstrip = () => {
  const strip = document.getElementById("dmSubstrip2");
  if (!strip || !_dmSeries) return;
  const stats = computeWindowStats(_dmSeries, _dmWindowStartKey());
  strip.textContent = "";
  const addStat = (labelText, valueText, valueCls) => {
    const span = document.createElement("span");
    span.append(`${labelText} `);
    const strong = document.createElement("strong");
    if (valueCls) strong.className = valueCls;
    strong.textContent = valueText;
    span.appendChild(strong);
    strip.appendChild(span);
  };
  const pctPart =
    stats.marketPct == null
      ? ""
      : ` (${stats.marketPct >= 0 ? "+" : "−"}${Math.abs(stats.marketPct).toFixed(1)}%)`;
  addStat(
    "market",
    `${_dmSigned(stats.market)}${pctPart}`,
    stats.market >= 0 ? "dm-pos" : "dm-neg"
  );
  // STRK-362: invested is all-time flow (incl. since-disposed buys) while the
  // Cost Basis KPI is active-only — surface the disposed slice so the
  // difference reads as accounting, not error: invested − disposed = active
  // cost basis. "disposed" (canonical term), not "sold": the slice covers
  // traded/lost/gifted dispositions too (Codex, PR #1484).
  const investedText =
    stats.investedDisposed > 0
      ? `${formatCurrency(stats.invested)} (− ${formatCurrency(stats.investedDisposed)} disposed)`
      : formatCurrency(stats.invested);
  addStat("invested", investedText);
  addStat("buys", String(stats.buyCount));
  if (stats.paceOzPerMonth != null) {
    const pace = stats.paceOzPerMonth;
    addStat("pace", `${pace.toFixed(pace < 0.1 ? 3 : 1)} oz/mo`);
  }
};

// ── hero chart (Chart.js 3.9.1) ─────────────────────────────────────────────

/**
 * Inline crosshair plugin: draws a vertical line at the active element's x in
 * afterDraw. Canvas-drawn — no DOM overlay exists to occlude the scatter
 * markers, so the playground's occlusion bug cannot structurally recur.
 */
const _dmCrosshairPlugin = {
  id: "dmCrosshair",
  afterDraw(chart) {
    const active = chart.tooltip?.getActiveElements?.() || [];
    if (active.length === 0) return;
    const { ctx, chartArea } = chart;
    const x = active[0].element.x;
    ctx.save();
    ctx.strokeStyle = getThemeColorRGB("text-muted");
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

/**
 * Day-stat entries for one series index — Melt, Basis (basis toggle on),
 * Spot (spot toggle on and a value that day) and the signed melt−basis gap.
 * One source for both tooltip shapes: the plain line tooltip renders one
 * entry per line; the marker tooltips render them as a compact footer so a
 * hover on a buy/disposition never loses the day's numbers (STRK-361).
 * @param {object} chart - Chart.js instance (spot dataset visibility)
 * @param {number} dayIdx - Index into _dmSeries.days
 * @param {boolean} compact - Short labels for the footer ("Basis" vs "Cost basis")
 * @returns {Array<{text: string, cls: string}>} Ordered entries; cls is "" or
 *   the dm-pos/dm-neg gap class
 */
const _dmTooltipDayStats = (chart, dayIdx, compact) => {
  const melt = _dmSeries?.melt[dayIdx] || 0;
  const basis = _dmSeries?.basis[dayIdx] || 0;
  const out = [{ text: `Melt ${formatCurrency(melt)}`, cls: "" }];
  if (_dmShow.basis) {
    out.push({ text: `${compact ? "Basis" : "Cost basis"} ${formatCurrency(basis)}`, cls: "" });
  }
  const spotDs = chart.data.datasets.find((d) => d.dmRole === "spot");
  if (_dmShow.spot && spotDs && !spotDs.hidden) {
    const spotPoint = spotDs.data.find((pt) => pt.x === dayIdx);
    if (spotPoint && spotPoint.y != null) {
      out.push({ text: `Spot ${formatCurrency(spotPoint.y)}/oz`, cls: "" });
    }
  }
  const gap = melt - basis;
  out.push({ text: `${_dmSigned(gap)} vs basis`, cls: gap >= 0 ? "dm-pos" : "dm-neg" });
  return out;
};

/**
 * Compact one-line footer for marker tooltips — the day stats joined by
 * middle dots, styled smaller than the item lines (STRK-361 AC-3).
 * @param {object} chart - Chart.js instance
 * @param {number} dayIdx - Index into _dmSeries.days
 * @returns {HTMLElement} .dm-tt-foot
 */
const _dmTooltipFooter = (chart, dayIdx) => {
  const foot = document.createElement("div");
  foot.className = "dm-tt-foot";
  _dmTooltipDayStats(chart, dayIdx, true).forEach((stat, i) => {
    if (i > 0) foot.appendChild(document.createTextNode(" · "));
    const span = document.createElement("span");
    if (stat.cls) span.className = stat.cls;
    span.textContent = stat.text;
    foot.appendChild(span);
  });
  return foot;
};

/**
 * CSS color for a purchase location in the tooltip — the same var() the
 * By Purchase Location panel painted that location with, so the tooltip and
 * the bars read as one system. Unknown (and any location the active-items
 * panel does not list, e.g. a since-disposed vendor) falls back to the
 * neutral muted token (STRK-361 AC-4).
 * @param {string} location - Item purchaseLocation (may be empty)
 * @returns {string} var() color string — DOM-safe, never for canvas
 */
const _dmLocationColor = (location) => {
  const key = location || "Unknown";
  if (key === "Unknown") return "var(--text-muted)";
  return _dmLocColors?.get(key) || "var(--text-muted)";
};

/**
 * One tooltip item line: "name ×qty — amount", optionally followed by a
 * color-coded purchase-location span (buys only). textContent throughout —
 * Item names and locations are user content (D-6).
 * @param {object} it - Inventory Item
 * @param {number} amount - Cost (buys) or melt-out (dispositions)
 * @param {boolean} withLocation - Append the .dm-tt-loc span
 * @returns {HTMLElement} Line element
 */
const _dmTooltipItemLine = (it, amount, withLocation) => {
  const line = document.createElement("div");
  line.className = "dm-tt-item";
  line.textContent = `${it.name || "(unnamed)"} ×${Number(it.qty) || 1} — ${formatCurrency(amount)}`;
  if (withLocation) {
    const loc = document.createElement("span");
    loc.className = "dm-tt-loc";
    loc.style.color = _dmLocationColor(it.purchaseLocation);
    loc.textContent = it.purchaseLocation || "Unknown";
    line.appendChild(loc);
  }
  return line;
};

/**
 * External HTML tooltip handler — builds DOM with createElement/textContent
 * only (Item names are user content; raw innerHTML is banned here, D-6).
 * @param {object} context - Chart.js external tooltip context
 */
const _dmExternalTooltip = (context) => {
  const tip = document.getElementById("dmChartTooltip");
  if (!tip) return;
  const { chart, tooltip } = context;
  if (!tooltip || tooltip.opacity === 0 || (tooltip.dataPoints || []).length === 0) {
    tip.style.display = "none";
    return;
  }
  tip.textContent = "";
  const points = tooltip.dataPoints;
  const buysPoint = points.find((p) => chart.data.datasets[p.datasetIndex].dmRole === "buys");
  const dispositionsPoint = points.find(
    (p) => chart.data.datasets[p.datasetIndex].dmRole === "dispositions"
  );
  const dayIdx = Math.round(points[0].parsed.x);
  const dayKey = _dmSeries?.days[dayIdx] || "";

  const title = document.createElement("div");
  title.className = "dm-tt-title";
  if (dispositionsPoint) {
    const group = _dmSeries?.dispositions.find((d) => d.day === dayKey);
    title.textContent = `Disposed ${dayKey}`;
    tip.appendChild(title);
    (group?.items || []).forEach((it) => {
      tip.appendChild(_dmTooltipItemLine(it, it._meltOut || 0, false));
    });
    tip.appendChild(_dmTooltipFooter(chart, dayIdx));
  } else if (buysPoint) {
    const group = _dmSeries?.buys.find((b) => b.day === dayKey);
    title.textContent = `Acquired ${dayKey}`;
    tip.appendChild(title);
    (group?.items || []).forEach((it) => {
      const cost = (parseFloat(it.price) || 0) * (Number(it.qty) || 1);
      tip.appendChild(_dmTooltipItemLine(it, cost, true));
    });
    tip.appendChild(_dmTooltipFooter(chart, dayIdx));
  } else {
    title.textContent = dayKey;
    tip.appendChild(title);
    _dmTooltipDayStats(chart, dayIdx, false).forEach((stat) => {
      const line = document.createElement("div");
      if (stat.cls) line.className = stat.cls;
      line.textContent = stat.text;
      tip.appendChild(line);
    });
  }

  tip.style.display = "block";
  const wrap = chart.canvas.parentElement;
  const maxLeft = wrap.clientWidth - tip.offsetWidth - 4;
  tip.style.left = `${Math.max(0, Math.min(maxLeft, tooltip.caretX + 12))}px`;
  tip.style.top = `${Math.max(0, tooltip.caretY - tip.offsetHeight - 10)}px`;
};

/**
 * Build (or rebuild) the hero chart for the current range/toggles/theme.
 * Destroys any prior instance on the canvas first (canvas-reuse contract).
 */
const _dmRenderChart = () => {
  const canvas = document.getElementById("dmHeroChart");
  if (!canvas || !_dmSeries || typeof Chart === "undefined") return;
  const prev = Chart.getChart(canvas);
  if (prev) prev.destroy();

  const days = _dmSeries.days;
  const startKey = _dmWindowStartKey();
  const startIdx = Math.max(0, days.indexOf(startKey));
  const endIdx = days.length - 1;

  const accent = getThemeColorRGB(_DM_ACCENT_TOKEN[_dmScope] || "primary");
  const mutedRGB = getThemeColorRGB("text-muted");
  const infoRGB = getThemeColorRGB("info");

  // gradient fill: scriptable with the mandatory !chartArea guard and a
  // resize-keyed cache (the initial layout pass runs before chartArea exists)
  let gradient = null;
  let gradientKey = "";
  const meltFill = (context) => {
    const { ctx, chartArea } = context.chart;
    if (!chartArea) return "transparent";
    const key = `${chartArea.top}-${chartArea.bottom}`;
    if (!gradient || gradientKey !== key) {
      gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
      const [r, g, b] = _dmRgbTriple(accent);
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
      gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.28)`);
      gradientKey = key;
    }
    return gradient;
  };

  const meltData = [];
  const basisData = [];
  for (let i = startIdx; i <= endIdx; i++) {
    meltData.push({ x: i, y: _dmSeries.melt[i] });
    basisData.push({ x: i, y: _dmSeries.basis[i] });
  }

  const datasets = [
    {
      dmRole: "melt",
      type: "line",
      label: "Melt value",
      data: meltData,
      borderColor: accent,
      backgroundColor: meltFill,
      fill: "origin",
      borderWidth: 2,
      pointRadius: 0,
      pointHitRadius: 0,
      tension: 0.3,
      yAxisID: "y",
      order: 4,
    },
    {
      dmRole: "basis",
      type: "line",
      label: "Cost basis",
      data: basisData,
      borderColor: mutedRGB,
      borderWidth: 1.4,
      stepped: true,
      pointRadius: 0,
      pointHitRadius: 0,
      hidden: !_dmShow.basis,
      yAxisID: "y",
      order: 3,
    },
  ];

  const hasSpot = _dmScope !== "All";
  if (hasSpot) {
    // display-side carry-forward over the visible window (the fold's fill is
    // internal to the series; the overlay re-derives from the raw day map)
    const map = _dmSpotMaps?.[_dmScope];
    const spotData = [];
    let last = null;
    for (let i = 0; i <= endIdx; i++) {
      const v = map?.get(days[i]);
      if (v != null) last = v;
      if (i >= startIdx) spotData.push({ x: i, y: last });
    }
    const liveSpot = spotPrices[_dmScope.toLowerCase()];
    if (spotData.length > 0 && Number.isFinite(liveSpot) && liveSpot > 0) {
      spotData[spotData.length - 1] = { x: endIdx, y: liveSpot };
    }
    datasets.push({
      dmRole: "spot",
      type: "line",
      label: "Spot /oz",
      data: spotData,
      borderColor: infoRGB,
      borderWidth: 1.2,
      borderDash: [4, 4],
      pointRadius: 0,
      pointHitRadius: 0,
      spanGaps: true,
      hidden: !_dmShow.spot,
      yAxisID: "y1",
      order: 2,
    });
  }

  const windowBuys = _dmSeries.buys.filter((b) => days.indexOf(b.day) >= startIdx);
  // STRK-361: radius floor 5 / cap 10 and a 12px hit radius — the old 3.5px
  // floor was fiddly to hover. The fill stays the accent (solid = buy, hollow
  // = disposition), so the contrast element is the halo: a 2.5px bg-primary
  // ring cuts the melt line on both sides in every theme, because the page
  // background contrasts with the accent by construction (slate's silver
  // fill is otherwise identical to the silver melt line).
  const buyRadii = windowBuys.map((b) => _dmMarkerRadius(b.totalCost));
  datasets.push({
    dmRole: "buys",
    type: "scatter",
    label: "Buys",
    data: windowBuys.map((b) => {
      const i = days.indexOf(b.day);
      return { x: i, y: _dmSeries.melt[i] };
    }),
    pointRadius: buyRadii,
    pointHoverRadius: buyRadii.map((r) => r + 2),
    pointHitRadius: _DM_MARKER_HIT_RADIUS,
    backgroundColor: windowBuys.map((b) =>
      _dmScope === "All"
        ? getThemeColorRGB(_DM_ACCENT_TOKEN[b.items[0]?.metal] || "primary")
        : accent
    ),
    borderColor: getThemeColorRGB("bg-primary"),
    borderWidth: 2.5,
    hidden: !_dmShow.buys,
    yAxisID: "y",
    order: 1,
  });

  const dangerRGB = getThemeColorRGB("danger");
  const windowDispositions = _dmSeries.dispositions.filter((d) => days.indexOf(d.day) >= startIdx);
  const dispRadii = windowDispositions.map((d) => _dmMarkerRadius(d.totalMeltOut));
  datasets.push({
    dmRole: "dispositions",
    type: "scatter",
    label: "Dispositions",
    data: windowDispositions.map((d) => {
      const i = days.indexOf(d.day);
      return { x: i, y: _dmSeries.melt[i] };
    }),
    pointRadius: dispRadii,
    pointHoverRadius: dispRadii.map((r) => r + 2),
    pointHitRadius: _DM_MARKER_HIT_RADIUS,
    pointStyle: "circle",
    backgroundColor: "transparent",
    borderColor: dangerRGB,
    borderWidth: 2,
    hidden: !_dmShow.dispositions,
    yAxisID: "y",
    order: 0,
  });

  const scales = {
    x: {
      type: "linear",
      min: startIdx,
      max: endIdx,
      grid: { display: false },
      ticks: {
        maxTicksLimit: 6,
        color: mutedRGB,
        callback: (value) => {
          const i = Math.round(value);
          return days[i] ? _dmMonthLabel(days[i]) : "";
        },
      },
    },
    y: {
      type: "linear",
      position: "left",
      grid: { color: getThemeColorRGB("border"), borderDash: [2, 4] },
      ticks: { maxTicksLimit: 5, color: mutedRGB, callback: (v) => formatCurrency(v) },
    },
  };
  if (hasSpot) {
    scales.y1 = {
      type: "linear",
      position: "right",
      grid: { drawOnChartArea: false },
      ticks: { maxTicksLimit: 4, color: infoRGB, callback: (v) => formatCurrency(v) },
    };
  }

  const chart = new Chart(canvas, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: { display: false },
        // the vendored datalabels plugin is globally registered — keep it off
        // this chart or every point grows a number label
        datalabels: { display: false },
        tooltip: { enabled: false, external: _dmExternalTooltip },
      },
      scales,
      onClick: (e, _active, c) => {
        const hits = c.getElementsAtEventForMode(e, "nearest", { intersect: true }, true);
        const buyHit = hits.find((hit) => c.data.datasets[hit.datasetIndex].dmRole === "buys");
        if (!buyHit) return;
        const group = windowBuys[buyHit.index];
        if (group) _dmFlashLedgerRows(group.day);
      },
    },
    plugins: [_dmCrosshairPlugin],
  });
  chartInstances.heroChart = chart;
};

// ── body assembly ───────────────────────────────────────────────────────────

/**
 * Build the full populated body (post-data phase of the two-phase open).
 */
const _dmRenderBody = () => {
  const body = _dmBody();
  if (!body) return;
  body.textContent = "";

  body.appendChild(_dmBuildKpis(_dmScope));

  // hero chart card
  const card = document.createElement("div");
  card.className = "dm-chart-card";
  const head = document.createElement("div");
  head.className = "dm-chart-head";

  const chips = document.createElement("div");
  chips.className = "dm-series-chips";
  [
    { key: "basis", label: "Cost basis", swatch: "", disabled: false },
    {
      key: "spot",
      label: "Spot /oz",
      swatch: "dm-series-swatch--dash",
      disabled: _dmScope === "All",
    },
    { key: "buys", label: "Buys", swatch: "dm-series-swatch--dot", disabled: false },
    {
      key: "dispositions",
      label: "Dispositions",
      swatch: "dm-series-swatch--ring",
      disabled: false,
    },
  ].forEach(({ key, label, swatch, disabled }) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "dm-series-chip";
    chip.dataset.series = key;
    chip.setAttribute("aria-pressed", disabled ? "false" : String(_dmShow[key]));
    if (disabled) {
      chip.disabled = true;
      chip.title = "Per-metal scope only";
    }
    const sw = document.createElement("span");
    sw.className = `dm-series-swatch${swatch ? ` ${swatch}` : ""}`;
    chip.appendChild(sw);
    chip.append(label);
    chip.addEventListener("click", () => {
      _dmShow[key] = !_dmShow[key];
      chip.setAttribute("aria-pressed", String(_dmShow[key]));
      const chart = Chart.getChart(document.getElementById("dmHeroChart"));
      if (!chart) return;
      const ds = chart.data.datasets.findIndex((d) => d.dmRole === key);
      if (ds >= 0) {
        chart.setDatasetVisibility(ds, _dmShow[key]);
        chart.update();
      }
    });
    chips.appendChild(chip);
  });
  head.appendChild(chips);

  head.appendChild(
    _dmBuildSeg(
      Object.keys(_DM_RANGES).map((r) => [r, r]),
      _dmRange,
      "range",
      (key) => {
        _dmRange = key;
        _dmRenderChart();
        _dmRenderSubstrip();
      }
    )
  );
  card.appendChild(head);

  const wrap = document.createElement("div");
  wrap.className = "dm-chart-wrap";
  const canvas = document.createElement("canvas");
  canvas.id = "dmHeroChart";
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    "Portfolio value over time. The KPI strip and acquisitions ledger carry the same information accessibly."
  );
  wrap.appendChild(canvas);
  const tip = document.createElement("div");
  tip.id = "dmChartTooltip";
  wrap.appendChild(tip);
  card.appendChild(wrap);

  const substrip = document.createElement("div");
  substrip.className = "dm-substrip";
  substrip.id = "dmSubstrip2";
  card.appendChild(substrip);
  body.appendChild(card);

  // metric toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "dm-toolbar";
  toolbar.appendChild(
    _dmBuildSeg(
      [
        ["purchase", "Purchase"],
        ["melt", "Melt"],
        ["retail", "Retail"],
        ["gainLoss", "Gain/Loss"],
      ],
      _dmMetric,
      "metric",
      (key) => {
        _dmMetric = key;
        _dmRerenderComposition();
      }
    )
  );
  body.appendChild(toolbar);

  // composition + ledger grid
  const grid = document.createElement("div");
  grid.className = "dm-grid dm-grid--ledger";
  const compCol = document.createElement("div");
  compCol.className = "dm-col";
  compCol.id = "dmCompCol";
  grid.appendChild(compCol);
  grid.appendChild(_dmBuildLedger(_dmScope));
  body.appendChild(grid);
  _dmRerenderComposition();

  // footer provenance (D-16): the same last-sync store the spot cards read;
  // no per-sample provenance claims — getSpotDayMap returns day/price only
  const foot = document.createElement("div");
  foot.className = "dm-foot";
  const sync = loadDataSync(LAST_API_SYNC_KEY, null);
  const provider = sync?.provider ? `Spot: ${sync.provider}` : "Spot: StakTrakr";
  const ts =
    sync?.timestamp && typeof formatTimestamp === "function"
      ? formatTimestamp(sync.timestamp)
      : "—";
  foot.textContent = `Local data · ${provider} · Last sync ${ts}`;
  body.appendChild(foot);

  _dmRenderChart();
  _dmRenderSubstrip();
};

// ── open / close (public contract) ──────────────────────────────────────────

/**
 * Open the detail modal for a scope. Wired by events.js to the dashboard
 * totals-card titles; contract unchanged from the legacy modal.
 * @param {string} metal - "Silver".."Copper" or "All"
 */
const showDetailsModal = (metal) => {
  const generation = ++_dmGeneration;
  _dmScope = metal;
  _dmRange = "1Y";
  _dmMetric = "melt";
  _dmShow = { basis: true, spot: true, buys: true, dispositions: true };
  _dmSeries = null;
  _dmSpotMaps = null;

  _dmRenderHeader(metal);

  const hasActive = _dmActiveItems(metal).length > 0;
  const hasDisposed = _dmDisposedItems(metal).length > 0;
  if (!hasActive && !hasDisposed) {
    _dmRenderEmpty(metal);
  } else {
    _dmRenderSkeletons();
    _dmLoadAndRender(metal, generation);
  }

  // utils.js openModalById() lazily installs a generic backdrop handler
  // (`if (e.target === modal) closeModalById(id)`) gated on
  // modal.dataset.initialized. That generic path bypasses closeDetailsModal's
  // teardown (generation bump, ResizeObserver disconnect, chart destroy), so
  // a backdrop click during a load-in-flight could let a stale async
  // completion render into the hidden modal. Own the backdrop click here and
  // pre-mark the seam so the generic handler never attaches.
  const dmBackdropModal = document.getElementById("detailsModal");
  if (dmBackdropModal && !dmBackdropModal.dataset.initialized) {
    dmBackdropModal.addEventListener("click", (e) => {
      if (e.target === dmBackdropModal) closeDetailsModal();
    });
    dmBackdropModal.dataset.initialized = "true";
  }

  if (window.openModalById) {
    openModalById("detailsModal");
  } else {
    elements.detailsModal.style.display = "flex";
    document.body.style.overflow = "hidden";
  }
  const content = document.querySelector("#detailsModal .modal-content");
  if (content) content.scrollTop = 0;

  if (_dmResizeObserver) {
    _dmResizeObserver.disconnect();
    _dmResizeObserver = null;
  }
  _dmResizeObserver = new ResizeObserver(() => {
    if (chartInstances.heroChart) chartInstances.heroChart.resize();
  });
  const modalEl = document.getElementById("detailsModal");
  if (modalEl) _dmResizeObserver.observe(modalEl);
};

/**
 * Async phase of the open: assemble day maps, build the series, render.
 * Aborts silently when the generation went stale (closed or reopened — D-3).
 * @param {string} scope - Scope being opened
 * @param {number} generation - Generation captured at open
 */
const _dmLoadAndRender = async (scope, generation) => {
  try {
    const usable = inventory.filter(
      (it) =>
        (scope === "All" || it?.metal === scope) &&
        (!isDisposed(it) ||
          (typeof it.disposition?.date === "string" && it.disposition.date !== ""))
    );
    const metals = [...new Set(usable.map((it) => it.metal).filter(Boolean))];
    const dated = usable.map((it) => it.date).filter((d) => typeof d === "string" && d !== "");
    const todayKey = todayStr();
    // fetch back past the series' own boundary (the fold re-derives exactly);
    // one extra year of map rows costs little and covers the 14-day pre-roll
    const fromKey =
      dated.length > 0
        ? `${Number(dated.reduce((a, b) => (a < b ? a : b)).slice(0, 4)) - 1}-12-01`
        : `${Number(todayKey.slice(0, 4)) - 1}-12-01`;

    const maps = {};
    // window indirection on purpose: the public export is the injection seam
    // for the two-phase open (a bare const reference cannot be intercepted)
    await Promise.all(
      metals.map(async (m) => {
        maps[m] = await window.getSpotDayMap(m, fromKey);
      })
    );
    if (generation !== _dmGeneration) return; // stale — modal closed/reopened

    _dmSpotMaps = maps;
    // todayKey is local-frame (matching item.date's entry frame); spot day
    // keys are UTC-frame. The fold treats keys as opaque calendar ids and D-8
    // overrides the final day with live spot, so the ≤1-day seam is absorbed
    // there. Deliberate frame crossing, per coding standards.
    _dmSeries = buildPortfolioSeries(inventory, maps, scope, spotPrices, todayKey);
  } catch (error) {
    console.error("[detailsModal] series load failed:", error);
    if (generation !== _dmGeneration) return;
    _dmShowLoadNote("Could not load price history — try again.");
    return;
  }
  if (generation !== _dmGeneration) return;
  // render failures are NOT data failures — keep the messages distinct so a
  // theme/DOM bug can never masquerade as a price-history outage (slate
  // regression: a gradient throw surfaced as "could not load price history")
  try {
    _dmRenderBody();
  } catch (error) {
    console.error("[detailsModal] render failed:", error);
    _dmShowLoadNote("Something went wrong rendering this view — details in the browser console.");
  }
};

/**
 * Replace the modal body with a single status note.
 * @param {string} message - Plain-text status line
 */
const _dmShowLoadNote = (message) => {
  // The hero chart's canvas (#dmHeroChart) lives inside #dmBody. Clearing the
  // body below removes that canvas from the DOM, but a live Chart instance
  // referenced by chartInstances.heroChart would then have no canvas for
  // closeDetailsModal's Chart.getChart(canvas) lookup to find — destroy it
  // here first so a render-phase failure can never strand a live Chart.
  if (chartInstances.heroChart) {
    chartInstances.heroChart.destroy();
    chartInstances.heroChart = null;
  }
  const body = _dmBody();
  if (!body) return;
  body.textContent = "";
  const note = document.createElement("div");
  note.className = "dm-ledger-note";
  note.textContent = message;
  body.appendChild(note);
};

/**
 * Close the detail modal and release everything it holds. Public contract.
 */
const closeDetailsModal = () => {
  _dmGeneration++; // any in-flight load becomes stale (D-3)
  if (_dmResizeObserver) {
    _dmResizeObserver.disconnect();
    _dmResizeObserver = null;
  }
  const canvas = document.getElementById("dmHeroChart");
  if (canvas && typeof Chart !== "undefined") {
    const chart = Chart.getChart(canvas);
    if (chart) chart.destroy();
  }
  chartInstances.heroChart = null;
  _dmSeries = null;
  _dmSpotMaps = null;
  if (window.closeModalById) {
    closeModalById("detailsModal");
  } else {
    elements.detailsModal.style.display = "none";
    try {
      document.body.style.overflow = "";
    } catch (e) {}
  }
};

// ── cross-cutting refresh hooks ─────────────────────────────────────────────

/**
 * True while the detail modal is open with rendered series content.
 * @returns {boolean} Open state
 */
const _dmIsOpen = () => {
  const modal = document.getElementById("detailsModal");
  return !!modal && modal.style.display === "flex" && !!_dmSeries;
};

// currency changes re-render every monetary surface (values are USD-internal
// and convert at format time, so the built series itself stays valid)
window.addEventListener("currencychange", () => {
  if (_dmIsOpen()) _dmRenderBody();
});

/**
 * Theme refresh hook — called by setTheme() via a guarded direct call (D-7):
 * canvas colors are resolved rgb values and must re-resolve after a theme
 * switch; the DOM side uses var() tokens and follows the cascade on its own.
 */
window._refreshDetailsModalTheme = () => {
  if (_dmIsOpen()) {
    _dmRenderChart();
    _dmRenderSubstrip();
  }
};

// =============================================================================

// Expose details modal functions globally for inline handlers
window.showDetailsModal = showDetailsModal;
window.closeDetailsModal = closeDetailsModal;

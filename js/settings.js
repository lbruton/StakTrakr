// SETTINGS MODAL
// =============================================================================

const CATALOG_KEY_MASK = "••••••••";

/**
 * Opens the unified Settings modal, optionally navigating to a section.
 * @param {string} [section='about'] - Section to display: 'about', 'site', 'system', 'table', 'grouping', 'api', 'cloud', 'images', 'storage', 'changelog', 'market', 'currency'
 */
const showSettingsModal = (section = "about") => {
  const modal = document.getElementById("settingsModal");
  if (!modal) return;

  syncSettingsUI();
  switchSettingsSection(section);

  if (window.openModalById) {
    openModalById("settingsModal");
  } else {
    modal.style.display = "flex";
    document.body.style.overflow = "hidden";
  }
};

/**
 * Closes the Settings modal.
 */
const hideSettingsModal = () => {
  if (window.closeModalById) {
    closeModalById("settingsModal");
  } else {
    const modal = document.getElementById("settingsModal");
    if (modal) modal.style.display = "none";
    try {
      document.body.style.overflow = "";
    } catch (e) {
      /* ignore */
    }
  }
};

/**
 * Switches the visible section panel in the Settings modal.
 * @param {string} name - Section key: 'about', 'site', 'system', 'table', 'grouping', 'api', 'cloud', 'images', 'storage', 'changelog', 'market', 'currency'
 */
const switchSettingsSection = (name) => {
  const targetName = document.getElementById(`settingsPanel_${name}`) ? name : "about";

  // Hide all panels
  document.querySelectorAll(".settings-section-panel").forEach((panel) => {
    panel.style.display = "none";
  });

  // Show target panel
  const target = document.getElementById(`settingsPanel_${targetName}`);
  if (target) target.style.display = "block";

  // Update active nav item
  document.querySelectorAll(".settings-nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.section === targetName);
  });

  // Populate API data when switching to API section
  if (targetName === "api" && typeof populateApiSection === "function") {
    populateApiSection();
  }

  // Populate Images data and sync toggles when switching to Images section (STACK-96)
  if (targetName === "images") {
    syncChipToggle("tableImagesToggle", localStorage.getItem("tableImagesEnabled") !== "false");
    const sidesSync = safeGetElement("tableImageSidesToggle");
    if (sidesSync) {
      const curSides = localStorage.getItem("tableImageSides") || "both";
      sidesSync
        .querySelectorAll(".chip-sort-btn")
        .forEach((btn) => btn.classList.toggle("active", btn.dataset.val === curSides));
    }
    populateImagesSection();
  }

  // Render the active log sub-tab when switching to the changelog section
  if (targetName === "changelog") {
    const activeTab = document.querySelector(".settings-log-tab.active");
    const activeKey = activeTab ? activeTab.dataset.logTab : "changelog";
    switchLogTab(activeKey);
  }

  // Render market filter matrix when switching to the market section
  if (targetName === "market" && typeof renderMarketFilterMatrix === "function") {
    renderMarketFilterMatrix();
  }

  // Populate Storage section when switching to it
  if (targetName === "storage" && typeof renderStorageSection === "function") {
    renderStorageSection();
  }

  // Populate About tab content when switching to it
  if (targetName === "about") {
    if (typeof populateAboutTab === "function") populateAboutTab();
  }

  // Populate Inventory Summary card and show/hide Cloud section when switching to Inventory
  if (targetName === "system") {
    const countEl = safeGetElement("invSummaryCount");
    const weightEl = safeGetElement("invSummaryWeight");
    const meltEl = safeGetElement("invSummaryMelt");
    const modEl = safeGetElement("invSummaryModified");
    if (countEl || weightEl || meltEl || modEl) {
      try {
        // STRK-233: the summary card reflects CURRENT in-stock holdings, so disposed
        // (sold/traded/gifted/lost/returned) items must drop out of every total via the
        // canonical isDisposed() predicate — otherwise they inflate count, weight, melt,
        // and the last-modified date with stock the user no longer holds.
        // isDisposed is a guaranteed constants.js global (loaded before this script, same as
        // LS_KEY above), so it is used unguarded; the enclosing try/catch surfaces any load
        // failure rather than silently falling back to the inflated totals this fix removes.
        const items = loadDataSync(LS_KEY, []).filter((it) => !isDisposed(it));
        if (countEl)
          countEl.textContent =
            items.reduce((sum, it) => sum + (Number(it.qty) || 1), 0) + " items";
        // Total weight — sum all items in troy oz (convert Goldback denominations)
        if (weightEl) {
          const totalOz = items.reduce((sum, it) => {
            // STRK-235: constitutional silver oz is derived (variant table + wear) and
            // already includes the coin count — add it directly, do NOT × qty.
            if (it.weightUnit === "cu") {
              return (
                sum +
                (typeof getConstitutionalSilverOz === "function"
                  ? getConstitutionalSilverOz(it)
                  : 0)
              );
            }
            const w = parseFloat(it.weight) || 0;
            const qty = Number(it.qty) || 1;
            const oz =
              it.weightUnit === "gb" && typeof GB_TO_OZT !== "undefined"
                ? w * GB_TO_OZT
                : it.weightUnit === "sb" && typeof SB_TO_OZT !== "undefined"
                  ? w * SB_TO_OZT
                  : w;
            return sum + oz * qty;
          }, 0);
          weightEl.textContent =
            typeof formatWeight === "function" ? formatWeight(totalOz) : `${totalOz.toFixed(2)} oz`;
        }
        // Melt value — use canonical computeMeltValue() helper from utils.js
        if (meltEl) {
          const totalMelt = items.reduce((sum, it) => {
            const metalKey = (it.metal || "silver").toLowerCase();
            const spot = (typeof spotPrices !== "undefined" && spotPrices[metalKey]) || 0;
            return spot ? sum + computeMeltValue(it, spot) : sum;
          }, 0);
          meltEl.textContent =
            totalMelt > 0
              ? typeof formatCurrency === "function"
                ? formatCurrency(totalMelt)
                : `$${totalMelt.toFixed(2)}`
              : "—";
        }
        // Last modified — newest updatedAt across all items
        if (modEl) {
          const newest = items.reduce((max, it) => {
            const ts = it.updatedAt || it.dateAdded || 0;
            return ts > max ? ts : max;
          }, 0);
          modEl.textContent = newest
            ? new Date(newest).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "—";
        }
      } catch (e) {
        console.warn("[settings] Inventory Summary card failed to populate:", e);
      }
    }

    // Sync cloud UI state (connected/disconnected badges, button states)
    if (typeof syncCloudUI === "function") syncCloudUI();
  }

  // Sync cloud UI state when switching to the dedicated Cloud tab
  if (targetName === "cloud") {
    if (typeof syncCloudUI === "function") syncCloudUI();
  }
};

// STAK-443 — API tab sectioned redesign
// =============================================================================

/**
 * Builds a `.status-dot` element reflecting the StakTrakr Market API health.
 * Reads `window._lastApiHealth` (set by api-health.js) when available; falls
 * back to a neutral "unknown" dot when data has not loaded yet.
 * @param {object|null} health - Snapshot from api-health.js, or null
 * @returns {HTMLElement}
 */
const _buildMarketStatusDot = (health) => {
  const dot = document.createElement("span");
  dot.classList.add("status-dot");
  const marketOk = !!(
    health &&
    health.primary &&
    health.primary.market &&
    health.primary.market.ok
  );
  dot.classList.add(marketOk ? "dot-ok" : "dot-off");
  return dot;
};

/**
 * Returns a human-readable "last pull" label for the market feed.
 * Prefers the cached api-health snapshot; falls back to a neutral placeholder.
 * Always references "last" so consumers can surface time-based framing even
 * before the async health fetch completes.
 * @param {object|null} health
 * @returns {string}
 */
const _marketStatusLabel = (health) => {
  const market = health && health.primary && health.primary.market;
  if (!market) return "Last pull pending…";
  if (market.error) return "Unreachable — last fetch failed";
  if (market.ago) return market.ok ? `Connected · ${market.ago}` : `Stale · ${market.ago}`;
  return market.ok ? "Connected · last pull recent" : "Last pull unknown";
};

/**
 * Builds the inline market-beacon SVG icon via createElementNS (no innerHTML).
 * Static markup mirrors artifacts/playground.html Market section.
 * @returns {SVGSVGElement}
 */
const _buildMarketBeaconSvg = () => {
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("width", "28");
  svg.setAttribute("height", "28");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const pathAxes = document.createElementNS(svgNs, "path");
  pathAxes.setAttribute("d", "M3 3v18h18");
  svg.appendChild(pathAxes);
  const pathLine = document.createElementNS(svgNs, "path");
  pathLine.setAttribute("d", "M7 14l4-4 4 4 6-6");
  svg.appendChild(pathLine);
  return svg;
};

/**
 * Renders the Market Prices fieldset (StakTrakr Market API beacon).
 * Produces a header row (title + inline status) and beacon card (icon + body
 * + attribution). No on/off toggle, no cascade controls. Status is sourced
 * from `window._lastApiHealth` when available.
 * @returns {DocumentFragment}
 */
const renderMarketBeacon = () => {
  const frag = document.createDocumentFragment();
  const health = typeof window !== "undefined" ? window._lastApiHealth || null : null;

  // Header row: title + inline status
  const headerRow = document.createElement("div");
  headerRow.className = "fieldset-header-row";

  const title = document.createElement("div");
  title.className = "settings-fieldset-title";
  title.textContent = "Market Prices";
  headerRow.appendChild(title);

  const statusInline = document.createElement("div");
  statusInline.className = "fieldset-status-inline";
  statusInline.appendChild(_buildMarketStatusDot(health));
  const statusText = document.createElement("span");
  statusText.className = "beacon-meta";
  statusText.textContent = _marketStatusLabel(health);
  statusInline.appendChild(statusText);
  headerRow.appendChild(statusInline);

  frag.appendChild(headerRow);

  // Beacon card
  const beacon = document.createElement("div");
  beacon.className = "market-beacon";

  const beaconIcon = document.createElement("div");
  beaconIcon.className = "market-beacon-icon";
  beaconIcon.appendChild(_buildMarketBeaconSvg());
  beacon.appendChild(beaconIcon);

  const beaconBody = document.createElement("div");
  beaconBody.className = "market-beacon-body";

  const beaconStrong = document.createElement("strong");
  beaconStrong.textContent = "StakTrakr Market API";
  beaconBody.appendChild(beaconStrong);

  const beaconDesc = document.createElement("p");
  beaconDesc.textContent = "Powers the main-page ticker, market price table, and Market tab.";
  beaconBody.appendChild(beaconDesc);

  const attribution = document.createElement("span");
  attribution.className = "provider-attribution";
  attribution.textContent = "Provided by api.staktrakr.com";
  beaconBody.appendChild(attribution);

  beacon.appendChild(beaconBody);
  frag.appendChild(beacon);

  return frag;
};

// ---------------------------------------------------------------------------
// Spot Price section — per-provider sub-card renderers (Task 7)
// ---------------------------------------------------------------------------

/**
 * Pill-radio metadata for the six spot-price sources. `data-val` values are
 * the uppercase enum keys consumed by `switchSpotProvider` (Task 8) and the
 * Playwright tests in `tests/playwright/stak-443-api-tab.spec.js`.
 */
const _SPOT_SOURCE_PILLS = [
  { val: "STAKTRAKR", label: "StakTrakr" },
  { val: "METALS_DEV", label: "Metals.dev" },
  { val: "METALS_API", label: "Metals-API" },
  { val: "METAL_PRICE_API", label: "MetalPriceAPI" },
  { val: "GOLD_API", label: "Gold API" },
  { val: "CUSTOM", label: "Custom" },
  { val: "MANUAL", label: "Manual" },
];

/**
 * Resolves the currently active spot-source enum value from localStorage.
 * Falls back to "STAKTRAKR" when the key is missing or corrupted. Uses the
 * sync reader because `renderSpotSection` builds DOM synchronously.
 * @returns {string}
 */
const _getActiveSpotSource = () => {
  const raw =
    typeof loadDataSync === "function" ? loadDataSync(SPOT_PRICING_SOURCE_KEY, null) : null;
  if (typeof raw === "string" && _SPOT_SOURCE_PILLS.some((p) => p.val === raw)) {
    return raw;
  }
  return "STAKTRAKR";
};

/**
 * Builds the `[Save] [Save & Test] [History] [Clear Key]` action row shared by
 * Metals.dev, Metals-API, MetalPriceAPI, and Custom panels. History button
 * uses `.api-action-btn` outlined style (REQ-8.2).
 * @param {object} opts
 * @param {boolean} [opts.saveTest=true] include the Save & Test button
 * @param {boolean} [opts.clearKey=true] include the Clear Key button
 * @returns {HTMLElement}
 */
const _buildSpotActionRow = (opts = {}) => {
  const { saveTest = true, clearKey = true } = opts;
  const row = document.createElement("div");
  row.className = "spot-panel-actions";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "btn api-action-btn js-save";
  save.textContent = "Save";
  row.appendChild(save);

  if (saveTest) {
    const saveAndTest = document.createElement("button");
    saveAndTest.type = "button";
    saveAndTest.className = "btn api-action-btn js-save-test";
    saveAndTest.textContent = "Save & Test";
    row.appendChild(saveAndTest);
  }

  const history = document.createElement("button");
  history.type = "button";
  history.className = "btn api-action-btn btn-history js-history";
  history.textContent = "History";
  row.appendChild(history);

  if (clearKey) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "btn api-action-btn js-clear-key";
    clear.textContent = "Clear Key";
    row.appendChild(clear);
  }

  return row;
};

/**
 * Builds a labeled `type="password"` API-key input with a show/hide toggle
 * button. Task 11 wires the actual click handler; this renderer only emits
 * the markup the wireup queries for.
 * @param {object} opts
 * @param {string} opts.provider API_PROVIDERS enum key (used for DOM id)
 * @param {string} opts.placeholder
 * @param {string} [opts.helpText]
 * @param {string} [opts.helpHref]
 * @returns {HTMLElement}
 */
const _buildApiKeyField = (opts) => {
  const { provider, placeholder, helpText, helpHref } = opts;
  const shell = document.createElement("div");
  shell.className = "gb-input-shell";

  const label = document.createElement("label");
  label.textContent = "API Key";
  shell.appendChild(label);

  const inputWrap = document.createElement("div");
  inputWrap.className = "inline-field-group";

  const input = document.createElement("input");
  input.type = "password";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  input.placeholder = placeholder;
  input.dataset.provider = provider;
  input.className = "js-api-key-input";
  inputWrap.appendChild(input);

  if (
    (provider === "numista" || provider === "pcgs") &&
    typeof window.catalogConfig !== "undefined" &&
    window.catalogConfig
  ) {
    const cc = window.catalogConfig;
    cc.load();
    if (provider === "numista" && cc.isNumistaEnabled()) {
      input.value = CATALOG_KEY_MASK;
      input.dataset.masked = "true";
    } else if (provider === "pcgs" && cc.isPcgsEnabled()) {
      input.value = CATALOG_KEY_MASK;
      input.dataset.masked = "true";
    }
  } else if (typeof loadApiConfig === "function") {
    try {
      const cfg = loadApiConfig();
      if (cfg && cfg.keys && cfg.keys[provider]) {
        input.value = cfg.keys[provider];
      }
    } catch (_e) {
      /* ignore */
    }
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "btn btn-toggle-key js-toggle-password";
  toggle.setAttribute("aria-label", "Show API key");
  const eyeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  eyeSvg.setAttribute("viewBox", "0 0 24 24");
  eyeSvg.setAttribute("fill", "none");
  eyeSvg.setAttribute("stroke", "currentColor");
  eyeSvg.setAttribute("stroke-width", "2");
  const eyePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  eyePath.setAttribute("d", "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z");
  eyeSvg.appendChild(eyePath);
  const eyeCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  eyeCircle.setAttribute("cx", "12");
  eyeCircle.setAttribute("cy", "12");
  eyeCircle.setAttribute("r", "3");
  eyeSvg.appendChild(eyeCircle);
  toggle.appendChild(eyeSvg);
  inputWrap.appendChild(toggle);

  shell.appendChild(inputWrap);

  if (helpText) {
    const small = document.createElement("small");
    small.textContent = helpText + " ";
    if (helpHref) {
      const link = document.createElement("a");
      link.href = helpHref;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = helpHref.replace(/^https?:\/\//, "");
      small.appendChild(link);
    }
    shell.appendChild(small);
  }

  return shell;
};

/**
 * Builds the four-metal checkbox grid used by every provider panel. All
 * checkboxes are rendered checked — Task 11 syncs them to stored state.
 * @returns {HTMLElement}
 */
const _buildMetalsCheckboxes = () => {
  const wrap = document.createElement("div");
  wrap.className = "metal-selection";

  const label = document.createElement("label");
  label.className = "field-label";
  label.textContent = "Metals to track";
  wrap.appendChild(label);

  const grid = document.createElement("div");
  grid.className = "metal-checkboxes";

  [
    { metal: "gold", display: "Gold" },
    { metal: "silver", display: "Silver" },
    { metal: "platinum", display: "Platinum" },
    { metal: "palladium", display: "Palladium" },
  ].forEach(({ metal, display }) => {
    const wrapLabel = document.createElement("label");
    wrapLabel.className = "metal-checkbox";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.dataset.metal = metal;
    wrapLabel.appendChild(cb);
    const span = document.createElement("span");
    span.textContent = display;
    wrapLabel.appendChild(span);
    grid.appendChild(wrapLabel);
  });

  wrap.appendChild(grid);
  return wrap;
};

/**
 * Builds the auto-refresh toggle row shared by paid-provider panels.
 * @param {string} [hint] optional settings-hint caption
 * @returns {HTMLElement}
 */
const _buildAutoRefreshRow = (hint) => {
  const row = document.createElement("div");
  row.className = "auto-refresh-row";

  const label = document.createElement("label");
  label.className = "metal-checkbox";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = true;
  cb.className = "js-auto-refresh";
  label.appendChild(cb);
  const span = document.createElement("span");
  span.textContent = "Background auto-refresh";
  label.appendChild(span);
  row.appendChild(label);

  if (hint) {
    const hintEl = document.createElement("span");
    hintEl.className = "settings-hint auto-refresh-hint";
    hintEl.textContent = hint;
    row.appendChild(hintEl);
  }

  return row;
};

const _buildProviderFooter = (attributionText) => {
  const footer = document.createElement("div");
  footer.className = "spot-panel-footer";
  const attribution = document.createElement("span");
  attribution.className = "provider-attribution";
  attribution.textContent = attributionText;
  footer.appendChild(attribution);
  const hint = document.createElement("span");
  hint.className = "settings-hint";
  hint.textContent = "Your API key is stored locally only.";
  footer.appendChild(hint);
  return footer;
};

/**
 * Builds the Cache-timeout + Pull-history `.provider-field-grid`. The caller
 * supplies the timeout / history-length option arrays so each provider can
 * advertise its own supported ranges.
 * @param {object} opts
 * @param {string[]} opts.cacheOptions
 * @param {string} opts.cacheSelected
 * @param {string[]} opts.historyOptions
 * @param {string} opts.historySelected
 * @returns {HTMLElement}
 */
const _buildCachePullGrid = ({ cacheOptions, cacheSelected, historyOptions, historySelected }) => {
  const grid = document.createElement("div");
  grid.className = "provider-field-grid";

  // Cache timeout
  const cacheField = document.createElement("div");
  cacheField.className = "provider-field";
  const cacheLabel = document.createElement("label");
  cacheLabel.className = "field-label";
  cacheLabel.textContent = "Cache timeout";
  cacheField.appendChild(cacheLabel);
  const cacheSelect = document.createElement("select");
  cacheSelect.className = "js-cache-timeout";
  cacheOptions.forEach((opt) => {
    const o = document.createElement("option");
    o.textContent = opt;
    if (opt === cacheSelected) o.selected = true;
    cacheSelect.appendChild(o);
  });
  cacheField.appendChild(cacheSelect);
  grid.appendChild(cacheField);

  // Pull history
  const histField = document.createElement("div");
  histField.className = "provider-field";
  const histLabel = document.createElement("label");
  histLabel.className = "field-label";
  histLabel.textContent = "Pull history";
  histField.appendChild(histLabel);
  const histGroup = document.createElement("div");
  histGroup.className = "inline-field-group";
  const histSelect = document.createElement("select");
  histSelect.className = "js-history-range";
  historyOptions.forEach((opt) => {
    const o = document.createElement("option");
    o.textContent = opt;
    if (opt === historySelected) o.selected = true;
    histSelect.appendChild(o);
  });
  histGroup.appendChild(histSelect);
  const pullBtn = document.createElement("button");
  pullBtn.type = "button";
  pullBtn.className = "btn api-action-btn js-pull-history";
  pullBtn.textContent = "Pull";
  histGroup.appendChild(pullBtn);
  histField.appendChild(histGroup);
  grid.appendChild(histField);

  return grid;
};

/**
 * Builds a `.spot-panel-row` header (info block + action row).
 * @param {object} opts
 * @param {string} opts.title bold provider name
 * @param {string} [opts.badgeText]
 * @param {string} [opts.badgeClass] additional class on `.provider-badge`
 * @param {string} [opts.meta] optional `.spot-panel-meta` caption
 * @param {HTMLElement} opts.actions action row element
 * @returns {HTMLElement}
 */
const _buildSpotPanelHeader = ({ title, badgeText, badgeClass, meta, actions }) => {
  const row = document.createElement("div");
  row.className = "spot-panel-row";

  const info = document.createElement("div");
  info.className = "spot-panel-info";

  const strong = document.createElement("strong");
  strong.textContent = title;
  info.appendChild(strong);

  if (badgeText) {
    const badge = document.createElement("span");
    badge.className = "provider-badge" + (badgeClass ? " " + badgeClass : "");
    badge.textContent = badgeText;
    info.appendChild(badge);
  }

  if (meta) {
    const metaEl = document.createElement("span");
    metaEl.className = "spot-panel-meta";
    metaEl.textContent = meta;
    info.appendChild(metaEl);
  }

  row.appendChild(info);
  row.appendChild(actions);
  return row;
};

/**
 * Panel: StakTrakr Spot API (free, no key).
 * @returns {HTMLElement}
 */
const renderSpotPanelStaktrakr = () => {
  const panel = document.createElement("div");
  panel.className = "spot-accordion-panel";
  panel.dataset.val = "STAKTRAKR";

  // Action row (informational: Sync / Flush Cache / History)
  const actions = document.createElement("div");
  actions.className = "spot-panel-actions";
  const syncBtn = document.createElement("button");
  syncBtn.type = "button";
  syncBtn.className = "btn api-action-btn js-save-test";
  syncBtn.textContent = "Sync";
  actions.appendChild(syncBtn);
  const flushBtn = document.createElement("button");
  flushBtn.type = "button";
  flushBtn.className = "btn api-action-btn js-flush-cache";
  flushBtn.textContent = "Flush Cache";
  actions.appendChild(flushBtn);
  const histBtn = document.createElement("button");
  histBtn.type = "button";
  histBtn.className = "btn api-action-btn js-history";
  histBtn.textContent = "History";
  actions.appendChild(histBtn);

  panel.appendChild(
    _buildSpotPanelHeader({
      title: "StakTrakr Spot API",
      badgeText: "Free · No key",
      badgeClass: "free",
      meta: "Hourly refresh · cached locally",
      actions,
    })
  );

  const footer = document.createElement("div");
  footer.className = "spot-panel-footer";
  const attribution = document.createElement("span");
  attribution.className = "provider-attribution";
  attribution.textContent = "Provided by api.staktrakr.com";
  footer.appendChild(attribution);
  const disclaimer = document.createElement("span");
  disclaimer.className = "disclaimer";
  disclaimer.textContent = "Best-effort free service. No uptime or accuracy guarantees.";
  footer.appendChild(disclaimer);
  panel.appendChild(footer);

  return panel;
};

/**
 * Panel: Metals.dev (key required, full field schema).
 * @returns {HTMLElement}
 */
const renderSpotPanelMetalsDev = () => {
  const panel = document.createElement("div");
  panel.className = "spot-accordion-panel";
  panel.dataset.val = "METALS_DEV";

  panel.appendChild(
    _buildSpotPanelHeader({
      title: "Metals.dev",
      badgeText: "Key required",
      badgeClass: "paid",
      actions: _buildSpotActionRow(),
    })
  );

  panel.appendChild(
    _buildApiKeyField({
      provider: "METALS_DEV",
      placeholder: "Enter Metals.dev API key",
      helpText: "10K requests/month free tier ·",
      helpHref: "https://metals.dev/documentation",
    })
  );

  panel.appendChild(
    _buildCachePullGrid({
      cacheOptions: [
        "No cache",
        "15 minutes",
        "30 minutes",
        "1 hour",
        "6 hours",
        "12 hours",
        "24 hours",
      ],
      cacheSelected: "24 hours",
      historyOptions: ["7 days", "14 days", "30 days"],
      historySelected: "30 days",
    })
  );

  panel.appendChild(_buildMetalsCheckboxes());
  panel.appendChild(_buildAutoRefreshRow());
  panel.appendChild(_buildProviderFooter("Provided by metals.dev"));

  return panel;
};

/**
 * Panel: Metals-API (key required, schema parallel to Metals.dev).
 * @returns {HTMLElement}
 */
const renderSpotPanelMetalsApi = () => {
  const panel = document.createElement("div");
  panel.className = "spot-accordion-panel";
  panel.dataset.val = "METALS_API";

  panel.appendChild(
    _buildSpotPanelHeader({
      title: "Metals-API",
      badgeText: "Key required",
      badgeClass: "paid",
      actions: _buildSpotActionRow(),
    })
  );

  panel.appendChild(
    _buildApiKeyField({
      provider: "METALS_API",
      placeholder: "Enter Metals-API key",
      helpText: "100 requests/month free tier ·",
      helpHref: "https://metals-api.com/documentation",
    })
  );

  panel.appendChild(
    _buildCachePullGrid({
      cacheOptions: ["No cache", "15 minutes", "1 hour", "24 hours"],
      cacheSelected: "24 hours",
      historyOptions: ["7 days", "30 days"],
      historySelected: "30 days",
    })
  );

  panel.appendChild(_buildMetalsCheckboxes());
  panel.appendChild(_buildAutoRefreshRow());
  panel.appendChild(_buildProviderFooter("Provided by metals-api.com"));

  return panel;
};

/**
 * Panel: MetalPriceAPI (key required, schema parallel to Metals.dev).
 * @returns {HTMLElement}
 */
const renderSpotPanelMetalPriceApi = () => {
  const panel = document.createElement("div");
  panel.className = "spot-accordion-panel";
  panel.dataset.val = "METAL_PRICE_API";

  panel.appendChild(
    _buildSpotPanelHeader({
      title: "MetalPriceAPI",
      badgeText: "Key required",
      badgeClass: "paid",
      actions: _buildSpotActionRow(),
    })
  );

  panel.appendChild(
    _buildApiKeyField({
      provider: "METAL_PRICE_API",
      placeholder: "Enter MetalPriceAPI key",
      helpText: "100 requests/month free tier ·",
      helpHref: "https://metalpriceapi.com/documentation",
    })
  );

  panel.appendChild(
    _buildCachePullGrid({
      cacheOptions: ["24 hours", "12 hours", "1 hour"],
      cacheSelected: "24 hours",
      historyOptions: ["30 days"],
      historySelected: "30 days",
    })
  );

  panel.appendChild(_buildMetalsCheckboxes());
  panel.appendChild(_buildAutoRefreshRow());
  panel.appendChild(_buildProviderFooter("Provided by metalpriceapi.com"));

  return panel;
};

const renderSpotPanelGoldApi = () => {
  const panel = document.createElement("div");
  panel.className = "spot-accordion-panel";
  panel.dataset.val = "GOLD_API";

  panel.appendChild(
    _buildSpotPanelHeader({
      title: "Gold API",
      badgeText: "Free · Optional key",
      badgeClass: "free",
      meta: "Unlimited real-time · gold-api.com",
      actions: _buildSpotActionRow(),
    })
  );

  const details = document.createElement("details");
  details.className = "optional-key-details";
  const summary = document.createElement("summary");
  summary.textContent = "Premium API Key (optional)";
  details.appendChild(summary);
  details.appendChild(
    _buildApiKeyField({
      provider: "GOLD_API",
      placeholder: "Enter Gold API premium key (optional)",
      helpText: "Free tier: unlimited real-time prices ·",
      helpHref: "https://gold-api.com/docs",
    })
  );
  panel.appendChild(details);

  panel.appendChild(_buildMetalsCheckboxes());
  panel.appendChild(_buildAutoRefreshRow());
  panel.appendChild(_buildProviderFooter("Provided by gold-api.com"));

  return panel;
};

/**
 * Panel: Custom endpoint (BYO URL + template + key).
 * @returns {HTMLElement}
 */
const renderSpotPanelCustom = () => {
  const panel = document.createElement("div");
  panel.className = "spot-accordion-panel";
  panel.dataset.val = "CUSTOM";

  panel.appendChild(
    _buildSpotPanelHeader({
      title: "Custom Spot API",
      badgeText: "BYO endpoint",
      badgeClass: "paid",
      actions: _buildSpotActionRow({ saveTest: true, clearKey: true }),
    })
  );

  // Endpoint fields + cache + key all inside a single .provider-field-grid
  const grid = document.createElement("div");
  grid.className = "provider-field-grid";

  // Base URL
  const baseShell = document.createElement("div");
  baseShell.className = "gb-input-shell full-row";
  const baseLabel = document.createElement("label");
  baseLabel.textContent = "Base URL";
  baseShell.appendChild(baseLabel);
  const baseInput = document.createElement("input");
  baseInput.type = "text";
  baseInput.placeholder = "https://api.example.com";
  baseInput.className = "js-custom-base";
  baseShell.appendChild(baseInput);
  grid.appendChild(baseShell);

  // Endpoint
  const endShell = document.createElement("div");
  endShell.className = "gb-input-shell full-row";
  const endLabel = document.createElement("label");
  endLabel.textContent = "Endpoint";
  endShell.appendChild(endLabel);
  const endInput = document.createElement("input");
  endInput.type = "text";
  endInput.placeholder = "/latest?key={API_KEY}&metal={METAL}";
  endInput.className = "js-custom-endpoint";
  endShell.appendChild(endInput);
  const endHelp = document.createElement("small");
  endHelp.textContent = "Use ";
  const codeKey = document.createElement("code");
  codeKey.textContent = "{API_KEY}";
  endHelp.appendChild(codeKey);
  endHelp.appendChild(document.createTextNode(" and "));
  const codeMetal = document.createElement("code");
  codeMetal.textContent = "{METAL}";
  endHelp.appendChild(codeMetal);
  endHelp.appendChild(document.createTextNode(" as placeholders"));
  endShell.appendChild(endHelp);
  grid.appendChild(endShell);

  // Metal format
  const fmtField = document.createElement("div");
  fmtField.className = "provider-field";
  const fmtLabel = document.createElement("label");
  fmtLabel.className = "field-label";
  fmtLabel.textContent = "Metal format";
  fmtField.appendChild(fmtLabel);
  const fmtSelect = document.createElement("select");
  fmtSelect.className = "js-custom-format";
  [
    ["symbol", "Symbol (XAU)"],
    ["word", "Word (gold)"],
  ].forEach(([val, label]) => {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = label;
    fmtSelect.appendChild(o);
  });
  fmtField.appendChild(fmtSelect);
  grid.appendChild(fmtField);

  // Cache timeout
  const cacheField = document.createElement("div");
  cacheField.className = "provider-field";
  const cacheLabel = document.createElement("label");
  cacheLabel.className = "field-label";
  cacheLabel.textContent = "Cache timeout";
  cacheField.appendChild(cacheLabel);
  const cacheSelect = document.createElement("select");
  cacheSelect.className = "js-cache-timeout";
  ["24 hours", "12 hours", "1 hour"].forEach((opt, idx) => {
    const o = document.createElement("option");
    o.textContent = opt;
    if (idx === 0) o.selected = true;
    cacheSelect.appendChild(o);
  });
  cacheField.appendChild(cacheSelect);
  grid.appendChild(cacheField);

  // API Key inside custom grid (full row)
  const keyShell = document.createElement("div");
  keyShell.className = "gb-input-shell full-row";
  const keyLabel = document.createElement("label");
  keyLabel.textContent = "API Key";
  keyShell.appendChild(keyLabel);
  const keyInputWrap = document.createElement("div");
  keyInputWrap.className = "inline-field-group";
  const keyInput = document.createElement("input");
  keyInput.type = "password";
  keyInput.setAttribute("autocomplete", "off");
  keyInput.setAttribute("spellcheck", "false");
  keyInput.placeholder = "Enter API key (used in {API_KEY})";
  keyInput.dataset.provider = "CUSTOM";
  keyInput.className = "js-api-key-input";
  keyInputWrap.appendChild(keyInput);
  const keyToggle = document.createElement("button");
  keyToggle.type = "button";
  keyToggle.className = "btn btn-toggle-key js-toggle-password";
  keyToggle.setAttribute("aria-label", "Show API key");
  const keyEyeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  keyEyeSvg.setAttribute("viewBox", "0 0 24 24");
  keyEyeSvg.setAttribute("fill", "none");
  keyEyeSvg.setAttribute("stroke", "currentColor");
  keyEyeSvg.setAttribute("stroke-width", "2");
  const keyEyePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  keyEyePath.setAttribute("d", "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z");
  keyEyeSvg.appendChild(keyEyePath);
  const keyEyeCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  keyEyeCircle.setAttribute("cx", "12");
  keyEyeCircle.setAttribute("cy", "12");
  keyEyeCircle.setAttribute("r", "3");
  keyEyeSvg.appendChild(keyEyeCircle);
  keyToggle.appendChild(keyEyeSvg);
  keyInputWrap.appendChild(keyToggle);
  keyShell.appendChild(keyInputWrap);
  grid.appendChild(keyShell);

  panel.appendChild(grid);
  panel.appendChild(_buildMetalsCheckboxes());
  panel.appendChild(_buildAutoRefreshRow("History pull not supported for custom endpoints."));

  return panel;
};

/**
 * Panel: Manual / Offline mode. Four numeric spot inputs + helper text. Save
 * writes to `metalSpotPrices` (unified object, read by Task 11 wireup). No
 * Save & Test button — Reset replaces Clear Key.
 * @returns {HTMLElement}
 */
const renderSpotPanelManual = () => {
  const panel = document.createElement("div");
  panel.className = "spot-accordion-panel";
  panel.dataset.val = "MANUAL";
  const savedManualPrices =
    typeof loadDataSync === "function" ? loadDataSync("metalSpotPrices", {}) : {};

  // Action row: Save / History / Reset
  const actions = document.createElement("div");
  actions.className = "spot-panel-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "btn api-action-btn js-save";
  save.textContent = "Save";
  actions.appendChild(save);
  const history = document.createElement("button");
  history.type = "button";
  history.className = "btn api-action-btn btn-history js-history";
  history.textContent = "History";
  actions.appendChild(history);
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "btn api-action-btn js-reset";
  reset.textContent = "Reset";
  actions.appendChild(reset);

  panel.appendChild(
    _buildSpotPanelHeader({
      title: "Manual / Offline Mode",
      badgeText: "Offline",
      badgeClass: "offline",
      meta: "All feeds disabled. Shift+click spot cards on main page also edits.",
      actions,
    })
  );

  // Four-input manual grid
  const grid = document.createElement("div");
  grid.className = "manual-grid";
  [
    { metal: "gold", label: "Gold (per oz)" },
    { metal: "silver", label: "Silver (per oz)" },
    { metal: "platinum", label: "Platinum (per oz)" },
    { metal: "palladium", label: "Palladium (per oz)" },
  ].forEach(({ metal, label }) => {
    const shell = document.createElement("div");
    shell.className = "gb-input-shell";
    const lbl = document.createElement("label");
    lbl.textContent = label;
    shell.appendChild(lbl);
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.01";
    input.min = "0";
    input.dataset.metal = metal;
    input.className = "js-manual-spot";
    const savedValue = Number(savedManualPrices?.[metal]);
    if (Number.isFinite(savedValue)) {
      input.value = String(savedValue);
    }
    shell.appendChild(input);
    grid.appendChild(shell);
  });
  panel.appendChild(grid);

  const footer = document.createElement("div");
  footer.className = "spot-panel-footer";
  const disclaimer = document.createElement("span");
  disclaimer.className = "disclaimer";
  disclaimer.textContent = "All automatic refresh is OFF while Manual is active.";
  footer.appendChild(disclaimer);
  panel.appendChild(footer);

  return panel;
};

/**
 * Maps each spot-source enum value to its panel renderer.
 */
const _SPOT_PANEL_RENDERERS = {
  STAKTRAKR: renderSpotPanelStaktrakr,
  METALS_DEV: renderSpotPanelMetalsDev,
  METALS_API: renderSpotPanelMetalsApi,
  METAL_PRICE_API: renderSpotPanelMetalPriceApi,
  GOLD_API: renderSpotPanelGoldApi,
  CUSTOM: renderSpotPanelCustom,
  MANUAL: renderSpotPanelManual,
};

/**
 * Renders the Spot Price fieldset (title + pill radio group + accordion of
 * six provider sub-cards). Initial active pill/panel is read from
 * `loadDataSync(SPOT_PRICING_SOURCE_KEY)` with "STAKTRAKR" fallback. Does NOT
 * bind event listeners — Task 11 wires click delegation.
 * @returns {DocumentFragment}
 */
const renderSpotSection = () => {
  const frag = document.createDocumentFragment();
  const active = _getActiveSpotSource();

  // Title row
  const title = document.createElement("div");
  title.className = "settings-fieldset-title";
  title.textContent = "Spot Price";
  frag.appendChild(title);

  // Helper text (per playground subtext)
  const subtext = document.createElement("p");
  subtext.className = "settings-subtext";
  subtext.textContent = "Choose which feed powers spot prices. Only one active at a time.";
  frag.appendChild(subtext);

  // Pill radio group
  const pillGroup = document.createElement("div");
  pillGroup.className = "gb-source-group";
  pillGroup.setAttribute("role", "radiogroup");
  pillGroup.setAttribute("aria-label", "Spot price source");

  _SPOT_SOURCE_PILLS.forEach(({ val, label }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const isActive = val === active;
    btn.className = "btn gb-source-btn" + (isActive ? " active" : "");
    btn.dataset.val = val;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", isActive ? "true" : "false");
    btn.textContent = label;
    pillGroup.appendChild(btn);
  });

  frag.appendChild(pillGroup);

  // Accordion with six panels (only active one visible)
  const accordion = document.createElement("div");
  accordion.className = "spot-accordion";
  accordion.id = "spotAccordion";

  _SPOT_SOURCE_PILLS.forEach(({ val }) => {
    const renderer = _SPOT_PANEL_RENDERERS[val];
    if (typeof renderer !== "function") return;
    const panel = renderer();
    if (val === active) {
      panel.classList.add("active");
      panel.style.display = "";
    } else {
      panel.style.display = "none";
    }
    accordion.appendChild(panel);
  });

  frag.appendChild(accordion);
  return frag;
};

/**
 * Builds the inline chevron SVG used on `.catalog-expand-btn`. Rotated 180°
 * via CSS when the parent row is `.catalog-row.open`. Constructed with
 * `createElementNS` to avoid innerHTML.
 * @returns {SVGSVGElement}
 */
const _buildCatalogChevron = () => {
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("class", "chevron");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("aria-hidden", "true");
  const poly = document.createElementNS(svgNs, "polyline");
  poly.setAttribute("points", "6 9 12 15 18 9");
  svg.appendChild(poly);
  return svg;
};

/**
 * Reads `catalog_api_config` from localStorage and reports whether each
 * catalog provider has a non-empty credential. Accepts either `apiKey` or
 * `bearerToken` for PCGS (CatalogConfig uses `bearerToken`; some tests and
 * legacy paths use `apiKey`).
 * @returns {{numista: boolean, pcgs: boolean}}
 */
const _getCatalogConfiguredState = () => {
  const cfg = typeof loadDataSync === "function" ? loadDataSync("catalog_api_config", null) : null;
  const numista = !!(
    cfg &&
    cfg.numista &&
    typeof cfg.numista.apiKey === "string" &&
    cfg.numista.apiKey
  );
  const pcgsKey = cfg && cfg.pcgs && (cfg.pcgs.bearerToken || cfg.pcgs.apiKey);
  const pcgs = !!(typeof pcgsKey === "string" && pcgsKey);
  return { numista, pcgs };
};

/**
 * Builds a single `.catalog-row` element with summary + collapsed expand body.
 * Event wiring (expand/collapse, test, open-bulk-sync, show/hide password) is
 * deferred to Task 11 — this renderer only emits the DOM hooks.
 * @param {object} opts
 * @param {string} opts.provider - "numista" | "pcgs"
 * @param {string} opts.displayName - "Numista" | "PCGS"
 * @param {boolean} opts.configured - green dot when true
 * @param {string} opts.metaText - meta line (e.g. "Not configured")
 * @param {string} opts.apiKeyPlaceholder
 * @param {string} [opts.apiKeyHelpText]
 * @param {string} [opts.apiKeyHelpHref]
 * @param {boolean} [opts.showUsageBar=false] render usage bar scaffold
 * @returns {HTMLElement}
 */
const _buildCatalogRow = (opts) => {
  const {
    provider,
    displayName,
    configured,
    metaText,
    apiKeyPlaceholder,
    apiKeyHelpText,
    apiKeyHelpHref,
    showUsageBar = false,
  } = opts;

  const row = document.createElement("div");
  row.className = "catalog-row";
  row.dataset.provider = provider;

  // Summary -----------------------------------------------------------------
  const summary = document.createElement("div");
  summary.className = "catalog-row-summary";

  const nameBlock = document.createElement("div");
  nameBlock.className = "catalog-row-name";

  const nameStrong = document.createElement("strong");
  nameStrong.textContent = displayName;
  nameBlock.appendChild(nameStrong);

  const badge = document.createElement("span");
  badge.className = "provider-badge free";
  badge.textContent = "Free";
  nameBlock.appendChild(badge);

  const dot = document.createElement("span");
  dot.className = configured ? "status-dot dot-ok" : "status-dot dot-off";
  nameBlock.appendChild(dot);

  const meta = document.createElement("span");
  meta.className = "catalog-row-meta";
  meta.textContent = metaText;
  nameBlock.appendChild(meta);

  summary.appendChild(nameBlock);

  // Action pills: Test · Catalog History · Configure ------------------------
  const actions = document.createElement("div");
  actions.className = "catalog-row-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn api-action-btn js-catalog-save";
  saveBtn.dataset.provider = provider;
  saveBtn.textContent = "Save";
  actions.appendChild(saveBtn);

  const testBtn = document.createElement("button");
  testBtn.type = "button";
  testBtn.className = "btn api-action-btn js-catalog-test";
  testBtn.dataset.provider = provider;
  testBtn.textContent = "Test";
  actions.appendChild(testBtn);

  const historyBtn = document.createElement("button");
  historyBtn.type = "button";
  historyBtn.className = "btn api-action-btn btn-history js-catalog-history";
  historyBtn.dataset.provider = provider;
  historyBtn.textContent = "Catalog History";
  actions.appendChild(historyBtn);

  const configureBtn = document.createElement("button");
  configureBtn.type = "button";
  configureBtn.className = "btn api-action-btn catalog-expand-btn js-catalog-configure";
  configureBtn.dataset.provider = provider;
  configureBtn.setAttribute("aria-expanded", "false");
  configureBtn.appendChild(document.createTextNode("Configure"));
  configureBtn.appendChild(_buildCatalogChevron());
  actions.appendChild(configureBtn);

  summary.appendChild(actions);
  row.appendChild(summary);

  // Expand body (hidden initially) ------------------------------------------
  const expand = document.createElement("div");
  expand.className = "catalog-row-expand";
  expand.style.display = "none";

  expand.appendChild(
    _buildApiKeyField({
      provider,
      placeholder: apiKeyPlaceholder,
      helpText: apiKeyHelpText,
      helpHref: apiKeyHelpHref,
    })
  );

  if (showUsageBar) {
    const hasKey =
      typeof window.catalogConfig !== "undefined" &&
      window.catalogConfig &&
      window.catalogConfig.hasNumistaKey();
    if (hasKey) {
      const usageHost = document.createElement("div");
      usageHost.id = "numistaUsageBar";
      expand.appendChild(usageHost);
      setTimeout(function () {
        if (typeof window.renderNumistaUsageBar === "function") {
          window.renderNumistaUsageBar();
        }
      }, 0);
    } else {
      const usage = document.createElement("div");
      usage.className = "usage-bar";
      const fill = document.createElement("div");
      fill.className = "usage-bar-fill";
      fill.style.width = "0%";
      usage.appendChild(fill);
      const label = document.createElement("span");
      label.className = "usage-bar-label empty";
      label.textContent = "No key configured";
      usage.appendChild(label);
      expand.appendChild(usage);
    }
  }

  const expandActions = document.createElement("div");
  expandActions.className = "catalog-expand-actions";
  const openBulk = document.createElement("button");
  openBulk.type = "button";
  openBulk.className = "btn api-action-btn js-open-bulk-sync";
  openBulk.dataset.provider = provider;
  openBulk.textContent = "Advanced Settings";
  expandActions.appendChild(openBulk);
  expand.appendChild(expandActions);

  row.appendChild(expand);
  return row;
};

/**
 * Builds the Catalog `.settings-fieldset` — title, subtext, and two catalog
 * rows (Numista then PCGS). Status dots reflect `catalog_api_config` state;
 * Task 11 wires the expand/collapse, test, history, and bulk-sync handlers.
 * REQ-6.1 through REQ-6.7 render-side.
 * @returns {DocumentFragment}
 */
const renderCatalogCards = () => {
  const frag = document.createDocumentFragment();

  const title = document.createElement("div");
  title.className = "settings-fieldset-title";
  title.textContent = "Catalog";
  frag.appendChild(title);

  const subtext = document.createElement("p");
  subtext.className = "settings-subtext";
  subtext.textContent = "External catalog APIs for coin metadata and pricing reference.";
  frag.appendChild(subtext);

  const state = _getCatalogConfiguredState();

  frag.appendChild(
    _buildCatalogRow({
      provider: "numista",
      displayName: "Numista",
      configured: state.numista,
      metaText: state.numista ? "Configured" : "Not configured",
      apiKeyPlaceholder: "Enter your Numista API key",
      apiKeyHelpText: "Get a free key at",
      apiKeyHelpHref: "https://numista.com/api",
      showUsageBar: true,
    })
  );

  frag.appendChild(
    _buildCatalogRow({
      provider: "pcgs",
      displayName: "PCGS",
      configured: state.pcgs,
      metaText: state.pcgs ? "Configured" : "Not configured",
      apiKeyPlaceholder: "Enter your PCGS bearer token",
      apiKeyHelpText: "Get a free key at",
      apiKeyHelpHref: "https://pcgs.com/api",
      showUsageBar: false,
    })
  );

  return frag;
};

/**
 * Composes the API settings panel by populating the three fieldset skeletons
 * (`#apiSection_market`, `#apiSection_spot`, `#apiSection_catalog`) added by
 * Task 4. Called from `switchSettingsSection('api')`.
 */
const populateApiSection = () => {
  const marketHost = safeGetElement("apiSection_market");
  const spotHost = safeGetElement("apiSection_spot");
  const catHost = safeGetElement("apiSection_catalog");

  if (marketHost && typeof marketHost.replaceChildren === "function") {
    marketHost.replaceChildren();
    marketHost.appendChild(renderMarketBeacon());
  }
  if (spotHost && typeof spotHost.replaceChildren === "function") {
    spotHost.replaceChildren();
    spotHost.appendChild(renderSpotSection());
  }
  if (catHost && typeof catHost.replaceChildren === "function") {
    catHost.replaceChildren();
    catHost.appendChild(renderCatalogCards());
  }
};

if (typeof window !== "undefined") {
  window.populateApiSection = populateApiSection;
  window.renderMarketBeacon = renderMarketBeacon;
  window.renderSpotSection = renderSpotSection;
  window.renderCatalogCards = renderCatalogCards;
}

/**
 * Spot pricing source enum — single source of truth for valid values
 * persisted under `spotPricingSource` via `saveData`.
 */
const SPOT_SOURCES = [
  "STAKTRAKR",
  "METALS_DEV",
  "METALS_API",
  "METAL_PRICE_API",
  "GOLD_API",
  "CUSTOM",
  "MANUAL",
];

/**
 * Selects the active spot pricing source. Persists the choice, then updates
 * pill `.active` / `aria-checked` state and accordion panel visibility inside
 * `#apiSection_spot`.
 *
 * @param {string} value - One of SPOT_SOURCES; invalid values coerce to 'STAKTRAKR'.
 */
const switchSpotProvider = (value) => {
  const normalized = SPOT_SOURCES.includes(value) ? value : "STAKTRAKR";
  saveData("spotPricingSource", normalized);
  if (normalized === "MANUAL" && typeof abortSpotProviderSync === "function") {
    abortSpotProviderSync();
  }

  const spotHost = safeGetElement("apiSection_spot");
  if (!spotHost) return;

  spotHost.querySelectorAll(".gb-source-btn[data-val]").forEach((pill) => {
    const isActive = pill.dataset.val === normalized;
    pill.classList.toggle("active", isActive);
    pill.setAttribute("aria-checked", isActive ? "true" : "false");
  });

  spotHost.querySelectorAll(".spot-accordion-panel[data-val]").forEach((panel) => {
    const isActive = panel.dataset.val === normalized;
    panel.classList.toggle("active", isActive);
    panel.style.display = isActive ? "" : "none";
  });
};

/**
 * Switches the visible log sub-tab in the Activity Log panel.
 * Re-renders the tab content on every switch to ensure fresh data.
 * @param {string} key - Sub-tab key: 'changelog', 'metals', 'catalogs', 'pricehistory'
 */
const switchLogTab = (key) => {
  // Hide all log panels
  document.querySelectorAll(".settings-log-panel").forEach((panel) => {
    panel.style.display = "none";
  });

  // Show target panel
  const target = document.getElementById(`logPanel_${key}`);
  if (target) target.style.display = "block";

  // Update active tab
  document.querySelectorAll(".settings-log-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.logTab === key);
  });

  // Always re-render to show fresh data
  renderLogTab(key);
};

/** Dispatch map: log sub-tab key → window function name */
const LOG_TAB_RENDERERS = {
  changelog: "renderChangeLog",
  catalogs: "renderCatalogHistoryForSettings",
  cloud: "renderCloudActivityTable",
  metals: "renderSpotHistoryTable",
  market: "renderRetailHistoryTable",
  pricehistory: "renderItemPriceHistoryTable",
  lbma: "renderLbmaHistoryTable",
};

/**
 * Dispatches to the appropriate render function for a log sub-tab.
 * @param {string} key - Sub-tab key
 */
const renderLogTab = (key) => {
  const fn = window[LOG_TAB_RENDERERS[key]];
  if (typeof fn === "function") fn();
};

/**
 * Syncs all Settings UI controls with current application state.
 * Called each time the modal opens to ensure controls reflect live values.
 */
const syncSettingsUI = () => {
  // Theme picker
  const currentTheme = localStorage.getItem(THEME_KEY) || "light";
  document.querySelectorAll(".theme-option").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === currentTheme);
  });

  // Items per page
  const ippSelect = safeGetElement("settingsItemsPerPage");
  if (ippSelect) {
    ippSelect.value = itemsPerPage === Infinity ? "all" : String(itemsPerPage);
  }

  // Cloud backup history depth
  var historySelect = safeGetElement("cloudBackupHistoryDepth");
  if (historySelect) {
    const savedDepth = loadDataSync(CLOUD_BACKUP_HISTORY_KEY, String(CLOUD_BACKUP_HISTORY_DEFAULT));
    historySelect.value = savedDepth;
  }

  // Chip min count — sync with inline control
  const chipMinSetting = document.getElementById("settingsChipMinCount");
  const chipMinInline = document.getElementById("chipMinCount");
  if (chipMinSetting) {
    chipMinSetting.value = localStorage.getItem("chipMinCount") || "3";
  }

  // Chip max count — sync with inline control
  const chipMaxSetting = safeGetElement("settingsChipMaxCount");
  if (chipMaxSetting) {
    chipMaxSetting.value = localStorage.getItem("chipMaxCount") || "0";
  }

  // Smart name grouping — sync with inline toggle
  const groupSetting = document.getElementById("settingsGroupNameChips");
  if (groupSetting && window.featureFlags) {
    const gVal = featureFlags.isEnabled("GROUPED_NAME_CHIPS") ? "yes" : "no";
    groupSetting.querySelectorAll(".chip-sort-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.val === gVal);
    });
  }

  // Dynamic name chips — sync toggle with feature flag
  const dynamicSetting = document.getElementById("settingsDynamicChips");
  if (dynamicSetting && window.featureFlags) {
    const dVal = featureFlags.isEnabled("DYNAMIC_NAME_CHIPS") ? "yes" : "no";
    dynamicSetting.querySelectorAll(".chip-sort-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.val === dVal);
    });
  }

  // Chip quantity badge — sync toggle with feature flag
  const qtyBadgeSetting = document.getElementById("settingsChipQtyBadge");
  if (qtyBadgeSetting && window.featureFlags) {
    const qVal = featureFlags.isEnabled("CHIP_QTY_BADGE") ? "yes" : "no";
    qtyBadgeSetting.querySelectorAll(".chip-sort-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.val === qVal);
    });
  }

  // Fuzzy autocomplete — sync toggle with feature flag
  const autocompleteSetting = document.getElementById("settingsFuzzyAutocomplete");
  if (autocompleteSetting && window.featureFlags) {
    const aVal = featureFlags.isEnabled("FUZZY_AUTOCOMPLETE") ? "yes" : "no";
    autocompleteSetting.querySelectorAll(".chip-sort-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.val === aVal);
    });
  }

  // Numista lookup rule tables
  renderCustomRuleTable();

  // Chip grouping tables and dropdown
  if (typeof window.populateBlacklistDropdown === "function") window.populateBlacklistDropdown();
  if (typeof window.renderBlacklistTable === "function") window.renderBlacklistTable();
  if (typeof window.renderCustomGroupTable === "function") window.renderCustomGroupTable();

  // Inline chip config table
  renderInlineChipConfigTable();

  // Filter chip category config table
  renderFilterChipCategoryTable();

  // Chip sort order — sync settings toggle with stored value
  const chipSortSetting = document.getElementById("settingsChipSortOrder");
  if (chipSortSetting) {
    const saved = localStorage.getItem("chipSortOrder");
    const active = saved === "count" ? "count" : "alpha";
    chipSortSetting.querySelectorAll(".chip-sort-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.sort === active);
    });
  }

  // Storage footer
  updateSettingsFooter();

  // API status
  if (typeof renderApiStatusSummary === "function") {
    renderApiStatusSummary();
  }

  // Numista usage bar
  if (typeof window.renderNumistaUsageBar === "function") {
    window.renderNumistaUsageBar();
  }

  // PCGS usage bar
  if (typeof window.renderPcgsUsageBar === "function") {
    window.renderPcgsUsageBar();
  }

  // Display currency (STACK-50)
  if (typeof syncCurrencySettingsUI === "function") {
    syncCurrencySettingsUI();
  }

  // Goldback denomination pricing (STACK-45)
  if (typeof syncGoldbackSettingsUI === "function") {
    syncGoldbackSettingsUI();
  }

  // Numista bulk sync visibility (STACK-87/88)
  const numistaSyncGroup = document.getElementById("numistaBulkSyncGroup");
  if (numistaSyncGroup) {
    const showBulkSync = window.featureFlags?.isEnabled("COIN_IMAGES");
    numistaSyncGroup.style.display = showBulkSync ? "" : "none";
  }

  // Card style (STAK-118)
  const cardStyleSelect = document.getElementById("settingsCardStyle");
  if (cardStyleSelect) {
    cardStyleSelect.value = localStorage.getItem(CARD_STYLE_KEY) || "D";
  }

  // Desktop card view toggle (STAK-118)
  const desktopCardToggle = document.getElementById("settingsDesktopCardView");
  if (desktopCardToggle) {
    const dcVal = localStorage.getItem(DESKTOP_CARD_VIEW_KEY) === "true" ? "yes" : "no";
    desktopCardToggle.querySelectorAll(".chip-sort-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.val === dcVal);
    });
  }

  // Display timezone (STACK-63)
  const tzSelect = document.getElementById("settingsTimezone");
  if (tzSelect) {
    tzSelect.value = localStorage.getItem(TIMEZONE_KEY) || "auto";
  }

  // Spot compare mode (STACK-92)
  const spotCompareSelect = document.getElementById("settingsSpotCompareMode");
  if (spotCompareSelect) {
    spotCompareSelect.value = localStorage.getItem(SPOT_COMPARE_MODE_KEY) || "close-close";
  }

  // Header shortcuts (STACK-54)
  syncHeaderToggleUI();
  // Layout visibility (STACK-54)
  syncLayoutVisibilityUI();

  // Show realized G/L toggle (STAK-436)
  const showRealized = loadDataSync(SHOW_REALIZED_KEY, "true") !== "false";
  syncChipToggle("settingsShowRealizedToggle", showRealized);
};

/**
 * Updates the storage + version footer bar at the bottom of the Settings modal.
 */
const updateSettingsFooter = async () => {
  const footerEl = document.getElementById("settingsFooter");
  if (!footerEl) return;

  let storageText = "";
  try {
    let totalBytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key);
      totalBytes += (key.length + (val ? val.length : 0)) * 2; // UTF-16
    }
    const lsMb = (totalBytes / (1024 * 1024)).toFixed(2);
    storageText = `LS: ${lsMb} MB / ~5 MB`;

    // Append IndexedDB usage: images + attachments (STRK-65)
    let idbTotalBytes = 0;
    if (window.imageCache?.isAvailable()) {
      try {
        const imgUsage = await imageCache.getStorageUsage();
        idbTotalBytes += imgUsage.totalBytes || 0;
      } catch {
        /* ignore */
      }
    }
    if (window.attachmentManager?.isAvailable()) {
      try {
        const attachUsage = await attachmentManager.getStorageUsage();
        idbTotalBytes += attachUsage.totalBytes || 0;
      } catch {
        /* ignore */
      }
    }
    if (idbTotalBytes > 0) {
      const idbMb = (idbTotalBytes / (1024 * 1024)).toFixed(2);
      storageText += `  \u00b7  IDB: ${idbMb} MB`;
    }
  } catch (e) {
    storageText = "Storage: unknown";
  }

  footerEl.textContent = `${storageText}  \u00b7  v${APP_VERSION}`;
};

/**
 * Wires a yes/no chip toggle to a feature flag.
 * Handles click delegation, flag enable/disable, active-class sync,
 * optional mirror element sync, and optional callback.
 *
 * @param {string} elementId - DOM id of the toggle container
 * @param {string} flagName - Feature flag key (e.g. 'GROUPED_NAME_CHIPS')
 * @param {Object} [opts]
 * @param {string} [opts.syncId] - DOM id of a mirror toggle to keep in sync
 * @param {Function} [opts.onApply] - Called after toggle with (isEnabled) arg
 */
const wireFeatureFlagToggle = (elementId, flagName, opts = {}) => {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip-sort-btn");
    if (!btn) return;
    const isEnabled = btn.dataset.val === "yes";
    if (window.featureFlags) {
      if (isEnabled) featureFlags.enable(flagName);
      else featureFlags.disable(flagName);
    }
    el.querySelectorAll(".chip-sort-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.val === btn.dataset.val);
    });
    if (opts.syncId) {
      const syncEl = document.getElementById(opts.syncId);
      if (syncEl)
        syncEl.querySelectorAll(".chip-sort-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.val === btn.dataset.val);
        });
    }
    if (opts.onApply) opts.onApply(isEnabled);
  });
};
window.wireFeatureFlagToggle = wireFeatureFlagToggle;

/**
 * Syncs a chip-sort-toggle's active state from a boolean value.
 * @param {string} elementId - DOM id of the .chip-sort-toggle container
 * @param {boolean} isOn - Whether the 'yes' button should be active
 */
const syncChipToggle = (elementId, isOn) => {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.querySelectorAll(".chip-sort-btn").forEach((btn) => {
    const btnIsYes = btn.dataset.val === "yes";
    const isActive = isOn ? btnIsYes : !btnIsYes;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });
};

/**
 * Wires a yes/no chip toggle to a raw localStorage key (not a feature flag).
 * Handles click delegation, localStorage read/write, active-class sync, and optional callback.
 *
 * @param {string} elementId - DOM id of the toggle container
 * @param {string} storageKey - localStorage key to read/write ('true'/'false')
 * @param {Object} [opts]
 * @param {boolean} [opts.defaultVal=false] - Default value when no localStorage entry exists
 * @param {Function} [opts.onApply] - Called after toggle with (isEnabled) arg
 */
const wireStorageToggle = (elementId, storageKey, opts = {}) => {
  const el = document.getElementById(elementId);
  if (!el) return;
  // Set initial state
  const defaultVal = opts.defaultVal ?? false;
  const stored = localStorage.getItem(storageKey);
  const isOn = stored !== null ? stored === "true" : defaultVal;
  syncChipToggle(elementId, isOn);

  el.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip-sort-btn");
    if (!btn) return;
    const isEnabled = btn.dataset.val === "yes";
    localStorage.setItem(storageKey, isEnabled ? "true" : "false");
    syncChipToggle(elementId, isEnabled);
    if (opts.onApply) opts.onApply(isEnabled);
  });
};
window.wireStorageToggle = wireStorageToggle;
window.syncChipToggle = syncChipToggle;

/**
 * Wires a chip sort order toggle (alpha/count) with bidirectional sync.
 *
 * @param {string} elementId - DOM id of the toggle container
 * @param {string} [syncId] - DOM id of a mirror toggle to keep in sync
 */
const wireChipSortToggle = (elementId, syncId) => {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip-sort-btn");
    if (!btn) return;
    const val = btn.dataset.sort;
    localStorage.setItem("chipSortOrder", val);
    el.querySelectorAll(".chip-sort-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.sort === val);
    });
    if (syncId) {
      const syncEl = document.getElementById(syncId);
      if (syncEl)
        syncEl.querySelectorAll(".chip-sort-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.sort === val);
        });
    }
    if (typeof renderActiveFilters === "function") renderActiveFilters();
  });
};
window.wireChipSortToggle = wireChipSortToggle;

// STAK-135:
// setupSettingsEventListeners() moved to js/settings-listeners.js to keep
// listener wiring split by settings tab/concern.

/**
 * One-time migration from legacy apiProviderOrder + syncMode to priority numbers (STACK-90).
 * Maps first "always" provider → 1, remaining providers → 2,3 in order, disabled → 0.
 * @returns {Object} Priority map { METALS_DEV: 1, METALS_API: 2, ... }
 */
const migrateProviderPriority = () => {
  const priorities = {};
  const metalsProviders = Object.keys(API_PROVIDERS);
  let order;
  try {
    const stored = localStorage.getItem("apiProviderOrder");
    order = stored ? JSON.parse(stored) : null;
  } catch (e) {
    /* ignore */
  }
  if (!Array.isArray(order) || order.length === 0) {
    order = metalsProviders;
  }

  // Read legacy sync modes
  let syncModes = {};
  try {
    const cfg = loadApiConfig();
    syncModes = cfg.syncMode || {};
  } catch (e) {
    /* ignore */
  }

  let nextPriority = 1;
  // First pass: assign based on legacy order + sync mode
  order.forEach((prov) => {
    if (!metalsProviders.includes(prov)) return;
    const mode = syncModes[prov] || "always";
    if (mode === "backup" && nextPriority === 1) {
      // All backup = assign sequentially starting at 2
      priorities[prov] = nextPriority++;
    } else {
      priorities[prov] = nextPriority++;
    }
  });

  // Ensure any providers not in legacy order get a priority
  metalsProviders.forEach((prov) => {
    if (!(prov in priorities)) {
      priorities[prov] = nextPriority++;
    }
  });

  // Normalize STAKTRAKR to enabled/disabled (not ranked)
  if (!("STAKTRAKR" in priorities)) {
    // Shift existing providers to make room at rank 1
    Object.keys(priorities).forEach((prov) => {
      if (priorities[prov] >= 1) priorities[prov]++;
    });
    priorities.STAKTRAKR = 1;
  } else if (priorities.STAKTRAKR > 1) {
    // Swap with current rank-1 provider to avoid collision
    const currentRank1 = Object.entries(priorities).find(([k, p]) => k !== "STAKTRAKR" && p === 1);
    if (currentRank1) priorities[currentRank1[0]] = priorities.STAKTRAKR;
    priorities.STAKTRAKR = 1;
  }

  saveProviderPriorities(priorities);
  return priorities;
};

/**
 * Loads provider priority map from localStorage.
 * Falls back to migration if not found.
 * @returns {Object} Priority map { METALS_DEV: 1, METALS_API: 2, ... }
 */
const loadProviderPriorities = () => {
  try {
    const stored = localStorage.getItem("providerPriority");
    if (stored) {
      const priorities = JSON.parse(stored);
      if (typeof priorities === "object" && priorities !== null) {
        // Normalize STAKTRAKR to enabled/disabled for existing users
        if (!("STAKTRAKR" in priorities)) {
          // Shift existing providers to make room at rank 1
          Object.keys(priorities).forEach((prov) => {
            if (priorities[prov] >= 1) priorities[prov]++;
          });
          priorities.STAKTRAKR = 1;
          saveProviderPriorities(priorities);
        } else if (priorities.STAKTRAKR > 1) {
          // Swap with current rank-1 provider to avoid collision
          const currentRank1 = Object.entries(priorities).find(
            ([k, p]) => k !== "STAKTRAKR" && p === 1
          );
          if (currentRank1) priorities[currentRank1[0]] = priorities.STAKTRAKR;
          priorities.STAKTRAKR = 1;
          saveProviderPriorities(priorities);
        }
        return priorities;
      }
    }
  } catch (e) {
    /* ignore */
  }
  return migrateProviderPriority();
};

/**
 * Saves provider priority map and writes backward-compatible apiProviderOrder (STACK-90).
 * @param {Object} priorities - { METALS_DEV: 1, METALS_API: 2, ... }
 */
const saveProviderPriorities = (priorities) => {
  try {
    localStorage.setItem("providerPriority", JSON.stringify(priorities));
    // Backward compatibility: write apiProviderOrder sorted by priority (non-disabled only)
    const sorted = Object.entries(priorities)
      .filter(([, p]) => p > 0)
      .sort((a, b) => a[1] - b[1])
      .map(([prov]) => prov);
    localStorage.setItem("apiProviderOrder", JSON.stringify(sorted));
  } catch (e) {
    /* ignore */
  }
};

/**
 * Sets all priority <select> values from a priority map.
 * @param {Object} priorities - { METALS_DEV: 1, ... }
 */
const syncProviderPriorityUI = (priorities) => {
  Object.entries(priorities).forEach(([prov, val]) => {
    const sel = document.getElementById(`providerPriority_${prov}`);
    if (sel) sel.value = String(val);
  });
};

/**
 * Sets up change listeners on provider priority selects (STACK-90).
 * Auto-shifts: setting provider X to priority N bumps any existing N holder to N+1 (cascade).
 */
const setupProviderPriority = () => {
  const selects = document.querySelectorAll(".provider-priority-select");
  if (!selects.length) return;

  selects.forEach((sel) => {
    sel.addEventListener("change", () => {
      const provider = sel.dataset.provider;
      const newVal = parseInt(sel.value, 10);
      const priorities = loadProviderPriorities();

      if (newVal === 0) {
        // Disabled — just set it
        priorities[provider] = 0;
      } else {
        // Auto-shift: bump any provider already at this priority
        const oldVal = priorities[provider];
        Object.keys(priorities).forEach((prov) => {
          if (prov !== provider && priorities[prov] === newVal && priorities[prov] > 0) {
            // Cascade: shift this one to the old slot (or next available)
            priorities[prov] = oldVal > 0 ? oldVal : newVal + 1;
          }
        });
        priorities[provider] = newVal;
      }

      saveProviderPriorities(priorities);
      syncProviderPriorityUI(priorities);
      if (typeof autoSelectDefaultProvider === "function") {
        autoSelectDefaultProvider();
      }
    });
  });
};

/**
 * Renders the inline chip config table in Settings > Grouping.
 * Delegates to the generic _renderSectionConfigTable helper.
 */
const renderInlineChipConfigTable = () =>
  _renderSectionConfigTable({
    containerId: "inlineChipConfigContainer",
    getConfig: getInlineChipConfig,
    saveConfig: saveInlineChipConfig,
    emptyText: "No chip types available",
    onApply: typeof renderTable === "function" ? renderTable : null,
    onRender: () => renderInlineChipConfigTable(),
  });

/**
 * Renders the filter chip category config table in Settings > Chips.
 * Each row has a checkbox (enable/disable) and up/down arrows for reordering.
 */
const renderFilterChipCategoryTable = () => {
  const container = document.getElementById("filterChipCategoryContainer");
  if (!container || typeof getFilterChipCategoryConfig !== "function") return;

  const config = getFilterChipCategoryConfig();
  container.textContent = "";

  if (!config.length) {
    const empty = document.createElement("div");
    empty.className = "chip-grouping-empty";
    empty.textContent = "No chip categories available";
    container.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "chip-grouping-table";

  // Header row
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["", "Category", "Group", ""].forEach((text) => {
    const th = document.createElement("th");
    th.textContent = text;
    th.style.cssText = "font-size:0.75rem;font-weight:normal;opacity:0.6;padding:0.2rem 0.4rem";
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  config.forEach((cat, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.catId = cat.id;

    // Checkbox cell
    const tdCheck = document.createElement("td");
    tdCheck.style.cssText = "width:2rem;text-align:center";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = cat.enabled;
    cb.className = "filter-cat-toggle";
    cb.title = "Toggle " + cat.label;
    cb.addEventListener("change", () => {
      const cfg = getFilterChipCategoryConfig();
      const item = cfg.at(idx);
      if (item) {
        item.enabled = cb.checked;
        saveFilterChipCategoryConfig(cfg);
        if (typeof renderActiveFilters === "function") renderActiveFilters();
      }
    });
    tdCheck.appendChild(cb);

    // Label cell
    const tdLabel = document.createElement("td");
    tdLabel.textContent = cat.label;

    // Group dropdown cell
    const tdGroup = document.createElement("td");
    tdGroup.style.cssText = "width:3rem;text-align:center";
    const groupSelect = document.createElement("select");
    groupSelect.className = "control-select";
    groupSelect.title = "Merge group — same letter = chips sort together";
    groupSelect.style.cssText =
      "width:auto;min-width:3.2rem;padding:0.15rem 0.3rem;font-size:0.8rem";
    const groupOptions = ["\u2014", "A", "B", "C", "D", "E"];
    groupOptions.forEach((letter) => {
      const opt = document.createElement("option");
      opt.value = letter === "\u2014" ? "" : letter;
      opt.textContent = letter;
      if ((cat.group || "") === opt.value) opt.selected = true;
      groupSelect.appendChild(opt);
    });
    groupSelect.addEventListener("change", () => {
      const cfg = getFilterChipCategoryConfig();
      const item = cfg.at(idx);
      if (item) {
        item.group = groupSelect.value || null;
        saveFilterChipCategoryConfig(cfg);
        renderFilterChipCategoryTable();
        if (typeof renderActiveFilters === "function") renderActiveFilters();
      }
    });
    tdGroup.appendChild(groupSelect);

    // Arrow buttons cell
    const tdMove = document.createElement("td");
    tdMove.style.cssText = "width:3.5rem;text-align:right;white-space:nowrap";

    const makeBtn = (dir, disabled) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "inline-chip-move";
      btn.textContent = dir === "up" ? "\u2191" : "\u2193";
      btn.title = "Move " + dir;
      btn.disabled = disabled;
      btn.addEventListener("click", () => {
        const cfg = getFilterChipCategoryConfig();
        const j = dir === "up" ? idx - 1 : idx + 1;
        if (j < 0 || j >= cfg.length) return;
        const moved = cfg.splice(idx, 1).at(0);
        cfg.splice(j, 0, moved);
        saveFilterChipCategoryConfig(cfg);
        renderFilterChipCategoryTable();
        if (typeof renderActiveFilters === "function") renderActiveFilters();
      });
      return btn;
    };
    tdMove.appendChild(makeBtn("up", idx === 0));
    tdMove.appendChild(makeBtn("down", idx === config.length - 1));

    tr.append(tdCheck, tdLabel, tdGroup, tdMove);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
};

/**
 * Renders the custom Numista lookup rules table with delete buttons.
 */
const renderCustomRuleTable = () => {
  const container = document.getElementById("customRuleTableContainer");
  if (!container || !window.NumistaLookup) return;

  const rules = NumistaLookup.getCustomRules();
  container.textContent = "";

  if (!rules.length) {
    const empty = document.createElement("div");
    empty.className = "chip-grouping-empty";
    empty.textContent = "No custom patterns";
    container.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "chip-grouping-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Pattern", "Numista Query", "N#", ""].forEach((text) => {
    const th = document.createElement("th");
    th.textContent = text;
    th.style.cssText = "font-size:0.75rem;font-weight:normal;opacity:0.6;padding:0.2rem 0.4rem";
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const rule of rules) {
    const tr = document.createElement("tr");

    const tdPattern = document.createElement("td");
    tdPattern.classList.add("pattern-cell");
    tdPattern.textContent = rule.pattern;

    const tdReplacement = document.createElement("td");
    tdReplacement.textContent = rule.replacement;

    const tdId = document.createElement("td");
    tdId.style.cssText = "font-size:0.85rem;opacity:0.7;white-space:nowrap";
    tdId.textContent = rule.numistaId || "\u2014";

    const tdDelete = document.createElement("td");
    tdDelete.style.cssText = "width:2rem;text-align:center";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "inline-chip-move";
    delBtn.textContent = "\u2715";
    delBtn.title = "Delete rule";
    delBtn.addEventListener("click", () => {
      NumistaLookup.removeRule(rule.id);
      renderCustomRuleTable();
    });
    tdDelete.appendChild(delBtn);

    tr.append(tdPattern, tdReplacement, tdId, tdDelete);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  container.appendChild(table);
};

/**
 * Syncs the display currency dropdown with current state (STACK-50).
 * Populates options from SUPPORTED_CURRENCIES on first call.
 */
const syncCurrencySettingsUI = () => {
  const sel = document.getElementById("settingsDisplayCurrency");
  if (!sel) return;
  if (sel.options.length === 0) {
    SUPPORTED_CURRENCIES.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = `${c.code} \u2014 ${c.name}`;
      sel.appendChild(opt);
    });
  }
  sel.value = displayCurrency;
};

/**
 * Syncs the Goldback settings panel UI with current state.
 * Renders the Currency tab Goldback pricing controls and read-only table.
 */
const syncGoldbackSettingsUI = () => {
  const sourceGroup = document.getElementById("settingsGoldbackSource");
  if (sourceGroup) {
    sourceGroup.querySelectorAll(".gb-source-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.val === goldbackPricingSource);
    });
  }

  const spotModifierGroup = document.getElementById("goldbackSpotModifierGroup");
  if (spotModifierGroup) {
    spotModifierGroup.style.display = goldbackPricingSource === "spot" ? "" : "none";
  }

  const manualInputGroup = document.getElementById("goldbackManualInputGroup");
  if (manualInputGroup) {
    manualInputGroup.style.display = goldbackPricingSource === "manual" ? "" : "none";
  }

  const modifierInput = document.getElementById("goldbackEstimateModifierInput");
  if (modifierInput) {
    modifierInput.value = goldbackEstimateModifier.toFixed(2);
  }

  const manualRateInput = document.getElementById("goldbackManualRateInput");
  const manualRateSymbol = document.getElementById("goldbackManualRateSymbol");
  const fxRate = typeof getExchangeRate === "function" ? getExchangeRate() : 1;
  const sourceLabels = {
    off: "Off",
    api: "API",
    spot: "Spot",
    manual: "Manual",
  };

  if (manualRateSymbol && typeof getCurrencySymbol === "function") {
    manualRateSymbol.textContent = getCurrencySymbol();
  }

  if (manualRateInput) {
    const manualEntry = goldbackPrices["1"];
    if (
      goldbackPricingSource === "manual" &&
      manualEntry &&
      manualEntry.source === "manual" &&
      typeof manualEntry.price === "number"
    ) {
      const displayValue = fxRate !== 1 ? manualEntry.price * fxRate : manualEntry.price;
      manualRateInput.value = displayValue.toFixed(2);
    } else {
      manualRateInput.value = "";
    }
  }

  const tbody = document.getElementById("goldbackPriceTableBody");
  if (!tbody || typeof GOLDBACK_DENOMINATIONS === "undefined") return;

  tbody.innerHTML = "";
  for (const d of GOLDBACK_DENOMINATIONS) {
    const key = String(d.weight);
    const entry = goldbackPrices[key];
    const usdPrice =
      goldbackPricingSource === "off" || !entry || typeof entry.price !== "number"
        ? null
        : entry.price;
    const displayPrice = usdPrice == null ? null : fxRate !== 1 ? usdPrice * fxRate : usdPrice;
    const priceLabel =
      usdPrice == null
        ? "\u2014"
        : typeof formatCurrency === "function"
          ? formatCurrency(usdPrice)
          : `${typeof getCurrencySymbol === "function" ? getCurrencySymbol() : "$"}${displayPrice.toFixed(2)}`;
    const rawSource = entry && typeof entry.source === "string" ? entry.source.toLowerCase() : null;
    const effectiveSource =
      rawSource &&
      typeof GOLD_BACK_PRICING_SOURCES !== "undefined" &&
      GOLD_BACK_PRICING_SOURCES.has(rawSource)
        ? rawSource
        : null;
    const badgeSource = effectiveSource || goldbackPricingSource || "api";
    const sourceLabel =
      displayPrice == null
        ? "\u2014"
        : sourceLabels[effectiveSource] || sourceLabels[goldbackPricingSource] || sourceLabels.api;
    const sourceBadge =
      displayPrice == null
        ? "—"
        : `<span class="source-badge ${badgeSource}">${sourceLabel}</span>`;

    const tr = document.createElement("tr");
    tr.dataset.denom = key;
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
    tr.innerHTML = `
      <td>${d.label}</td>
      <td>${d.goldOz} oz</td>
      <td>${priceLabel}</td>
      <td>${sourceBadge}</td>
    `;
    tbody.appendChild(tr);
  }
};

if (typeof window !== "undefined") {
  window.addEventListener("currencychange", () => {
    try {
      if (typeof syncGoldbackSettingsUI === "function") syncGoldbackSettingsUI();
    } catch (e) {
      if (typeof debugLog === "function") {
        debugLog("[settings] Goldback currency refresh failed: " + e.message, "warn");
      }
    }
  });
}

// =============================================================================
// HEADER TOGGLE & LAYOUT VISIBILITY (STACK-54)
// =============================================================================

/**
 * Syncs the header shortcut UI in Settings with stored state.
 * Re-renders the config table and applies current header state.
 */
const syncHeaderToggleUI = () => {
  // The syncChipToggle("settingsHeaderCurrencyBtn", ...) call that used to sit
  // here went with the Currency button (STRK-288) — but it was ALREADY inert.
  // #settingsHeaderCurrencyBtn has not existed in the DOM since STRK-122, whose
  // archived AC 0.5.6 asserts it is absent from the Currency tab; the comment
  // claiming it "still exists in the Currency settings panel" was simply stale.
  // Header button visibility is configured in Settings › Appearance via
  // renderHeaderBtnConfigTable(), which is the real control.
  renderHeaderBtnConfigTable();
  applyHeaderToggleVisibility();
};

/**
 * Shows/hides and reorders header shortcut buttons based on stored config.
 * All buttons default visible for new users.
 */
const applyHeaderToggleVisibility = () => {
  const config = getHeaderBtnConfig();
  // marketBtn retired (STRK-290) — the header is down to Theme + Settings.
  const BTN_ID_MAP = {
    themeBtn: "headerThemeBtn",
    settingsBtn: "settingsBtn",
  };

  // Apply visibility
  for (const { id, enabled } of config) {
    const btnId = BTN_ID_MAP[id];
    if (!btnId) continue;
    const btn = safeGetElement(btnId);
    if (btn) btn.style.display = enabled ? "" : "none";
  }

  // Apply order to live header container; settingsBtn is last (it's last in config)
  const container = safeGetElement("headerBtnContainer");
  if (container) {
    for (const { id } of config) {
      const btnId = BTN_ID_MAP[id];
      if (!btnId) continue;
      const btn = container.querySelector(`#${btnId}`);
      if (btn) container.append(btn);
    }
  }

  // Show text toggle
  const showText = localStorage.getItem(HEADER_BTN_SHOW_TEXT_KEY) !== "false";
  if (container && container.classList) {
    container.classList.toggle("header-buttons--show-text", showText);
  }
};
window.applyHeaderToggleVisibility = applyHeaderToggleVisibility;

/**
 * Returns the header button config as [{id, label, enabled}] in saved order.
 * Reads visibility from individual legacy keys; order from `headerBtnOrder`.
 * @returns {Array<{id:string, label:string, enabled:boolean}>}
 */
const getHeaderBtnConfig = () => {
  // marketBtn retired (STRK-290). No migration is needed: a stored headerBtnOrder
  // still containing it is filtered by `savedOrder.filter(k => k in vis)` below,
  // so the id self-heals out on the next config write.
  const vis = {
    themeBtn: localStorage.getItem("headerThemeBtnVisible") !== "false",
  };
  const labelMap = {
    themeBtn: "Theme",
  };
  const defaultOrder = Object.keys(vis);
  const savedOrder = (() => {
    const o = localStorage.getItem("headerBtnOrder");
    try {
      const p = o ? JSON.parse(o) : null;
      return Array.isArray(p) ? p : null;
    } catch {
      return null;
    }
  })();
  const order = savedOrder
    ? [
        ...savedOrder.filter((k) => k in vis),
        ...defaultOrder.filter((k) => !savedOrder.includes(k)),
      ]
    : defaultOrder;
  const cfg = order.map((id) => ({ id, label: labelMap[id] || id, enabled: vis[id] ?? true }));
  // Settings is always last and always visible (locked — cannot be hidden or reordered)
  cfg.push({ id: "settingsBtn", label: "Settings", enabled: true, locked: true });
  return cfg;
};

/**
 * Persists header button config: writes visibility to individual keys and
 * order to `headerBtnOrder`.
 * @param {Array<{id:string, enabled:boolean}>} cfg
 */
const saveHeaderBtnConfig = (cfg) => {
  const visKeys = {
    themeBtn: "headerThemeBtnVisible",
  };
  for (const item of cfg) {
    if (item.locked) continue;
    const key = visKeys[item.id];
    if (key) {
      try {
        localStorage.setItem(key, item.enabled ? "true" : "false");
      } catch {
        /* ignore */
      }
    }
  }
  try {
    // Exclude locked items from saved order (settingsBtn is always re-appended by getHeaderBtnConfig)
    localStorage.setItem(
      "headerBtnOrder",
      JSON.stringify(cfg.filter((c) => !c.locked).map((c) => c.id))
    );
  } catch (err) {
    console.warn("[HeaderBtnConfig] could not save order:", err);
  }
};

/** Renders the header button config table in Settings → Appearance (STAK-320). */
const renderHeaderBtnConfigTable = () =>
  _renderSectionConfigTable({
    containerId: "headerBtnConfigTable",
    getConfig: getHeaderBtnConfig,
    saveConfig: saveHeaderBtnConfig,
    onApply: () => applyHeaderToggleVisibility(),
    onRender: () => renderHeaderBtnConfigTable(),
  });
window.renderHeaderBtnConfigTable = renderHeaderBtnConfigTable;

/**
 * Syncs layout section config table in Settings and applies layout order.
 */
const syncLayoutVisibilityUI = () => {
  renderLayoutTabConfigTable();
  renderLayoutSectionConfigTable();
  renderViewModalSectionConfigTable();
  renderMetalOrderConfigTable();
  renderInlineChipConfigTable();
  applyLayoutOrder();
  if (typeof window.applyTabVisibility === "function") window.applyTabVisibility();
};

/**
 * Generic section-config table renderer.
 * Builds a checkbox + arrow reorder table for any {id, label, enabled}[] config.
 *
 * @param {Object} opts
 * @param {string} opts.containerId - DOM id of the container element
 * @param {function} opts.getConfig - Returns the current config array
 * @param {function} opts.saveConfig - Persists the updated config array
 * @param {string} [opts.emptyText] - Text shown when config is empty (default: 'No sections available')
 * @param {function} [opts.onApply] - Called after every change (e.g. applyLayoutOrder)
 * @param {function} [opts.onRender] - Called to re-render after reorder (defaults to self)
 * @param {function} [opts.filter] - Predicate selecting which entries to render.
 *   Rows keep their index into the FULL config, so entries the filter excludes
 *   are neither shown nor disturbed by a reorder (STRK-326).
 * @param {boolean} [opts.noReorder] - Render checkboxes only, no arrow cell.
 */
const _renderSectionConfigTable = (opts) => {
  const container = document.getElementById(opts.containerId);
  if (!container || typeof opts.getConfig !== "function") return;

  const config = opts.getConfig();
  container.textContent = "";

  if (!config.length) {
    const empty = document.createElement("div");
    empty.className = "chip-grouping-empty";
    empty.textContent = opts.emptyText || "No sections available";
    container.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "chip-grouping-table";
  const tbody = document.createElement("tbody");

  // Rows carry their index into the FULL config so a filtered view can still
  // write back to the right entry. Movement is an adjacent swap between two
  // *visible* rows, which leaves filtered-out entries exactly where they are \u2014
  // the old splice-by-one was already an adjacent swap, so unfiltered callers
  // behave identically.
  const rows = config
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => (opts.filter ? opts.filter(section) : true));
  const sortable = rows.filter(({ section }) => !section.locked);

  rows.forEach((row) => {
    const { section, index } = row;
    const tr = document.createElement("tr");
    tr.dataset.sectionId = section.id;

    // Checkbox cell
    const tdCheck = document.createElement("td");
    tdCheck.style.cssText = "width:2rem;text-align:center";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = section.enabled;
    cb.className = "inline-chip-toggle";
    cb.title = section.locked ? section.label + " (always visible)" : "Toggle " + section.label;
    cb.disabled = !!section.locked;
    if (!section.locked) {
      cb.addEventListener("change", () => {
        const cfg = opts.getConfig();
        const item = cfg.at(index);
        if (item) {
          item.enabled = cb.checked;
          opts.saveConfig(cfg);
          if (opts.onApply) opts.onApply();
        }
      });
    }
    tdCheck.appendChild(cb);

    // Label cell
    const tdLabel = document.createElement("td");
    tdLabel.textContent = section.label;

    // Arrow buttons cell (locked items get none)
    const tdMove = document.createElement("td");
    tdMove.style.cssText = "width:3.5rem;text-align:right;white-space:nowrap";

    const pos = sortable.indexOf(row);
    if (!section.locked && !opts.noReorder) {
      const makeBtn = (dir, disabled) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "inline-chip-move";
        btn.textContent = dir === "up" ? "\u2191" : "\u2193";
        btn.title = "Move " + dir;
        btn.disabled = disabled;
        btn.addEventListener("click", () => {
          const target = sortable.at(dir === "up" ? pos - 1 : pos + 1);
          // `.at(-1)` wraps to the last element, so guard the top row explicitly
          // rather than trusting a falsy check.
          if (!target || (dir === "up" && pos <= 0)) return;
          const cfg = opts.getConfig();
          const a = cfg.at(index);
          const b = cfg.at(target.index);
          if (!a || !b) return;
          cfg[index] = b;
          cfg[target.index] = a;
          opts.saveConfig(cfg);
          (opts.onRender || (() => _renderSectionConfigTable(opts)))();
          if (opts.onApply) opts.onApply();
        });
        return btn;
      };
      tdMove.appendChild(makeBtn("up", pos <= 0));
      tdMove.appendChild(makeBtn("down", pos < 0 || pos >= sortable.length - 1));
    }

    tr.append(tdCheck, tdLabel, tdMove);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
};

/**
 * The v2 tabs, in nav order (STRK-326).
 *
 * Dashboard is locked: guaranteeing one always-visible tab means activateTab
 * always has a fallback target, so hiding the active tab or deep-linking to a
 * hidden one can never strand the user on an empty shell.
 * @constant {Array<{id: string, label: string, view: string, locked?: boolean}>}
 */
const LAYOUT_TABS = [
  { id: "dashboard", label: "Dashboard", view: "tabViewDashboard", locked: true },
  { id: "inventory", label: "Inventory", view: "tabViewInventory" },
  { id: "market", label: "Market", view: "tabViewMarket" },
  { id: "collections", label: "Collections", view: "tabViewCollections" },
];

/**
 * Derives per-tab visibility from the flat layout section config.
 *
 * A tab is visible when any section it owns is enabled, so this needs no
 * storage of its own — the section-to-tab ownership in LAYOUT_SECTION_TAB_VIEW
 * is the single source of truth for both this and applyLayoutOrder.
 * @returns {Array<{id:string, label:string, enabled:boolean, locked?:boolean}>}
 */
const getLayoutTabConfig = () => {
  const sections = getLayoutSectionConfig();
  return LAYOUT_TABS.map((tab) => {
    if (tab.locked) return { id: tab.id, label: tab.label, enabled: true, locked: true };
    const owned = sections.filter((s) => LAYOUT_SECTION_TAB_VIEW[s.id] === tab.view);
    return { id: tab.id, label: tab.label, enabled: owned.some((s) => s.enabled) };
  });
};
window.getLayoutTabConfig = getLayoutTabConfig;

/**
 * Writes per-tab visibility back onto every section the tab owns.
 *
 * Inventory owns two sections (search bar + table) that render as one visual
 * surface, so its single checkbox drives both — a half-hidden Inventory tab is
 * not a state the UI can express any more.
 * @param {Array<{id:string, enabled:boolean}>} cfg - Tab rows from getLayoutTabConfig.
 */
const saveLayoutTabConfig = (cfg) => {
  const enabledByTab = new Map(cfg.map((t) => [t.id, t.enabled]));
  const sections = getLayoutSectionConfig();
  for (const section of sections) {
    const tab = LAYOUT_TABS.find((t) => t.view === LAYOUT_SECTION_TAB_VIEW[section.id]);
    if (!tab || tab.locked || !enabledByTab.has(tab.id)) continue;
    section.enabled = enabledByTab.get(tab.id);
  }
  saveLayoutSectionConfig(sections);
};

/** Renders the whole-tab visibility table in Settings > Layout (STRK-326). */
const renderLayoutTabConfigTable = () =>
  _renderSectionConfigTable({
    containerId: "layoutTabConfigContainer",
    getConfig: getLayoutTabConfig,
    saveConfig: saveLayoutTabConfig,
    noReorder: true,
    emptyText: "No tabs available",
    onApply: () => {
      if (typeof applyLayoutOrder === "function") applyLayoutOrder();
      if (typeof window.applyTabVisibility === "function") window.applyTabVisibility();
    },
    onRender: () => renderLayoutTabConfigTable(),
  });

/**
 * Renders the Dashboard section config table in Settings > Layout.
 *
 * Scoped to Dashboard-owned sections: the other tabs hold a single module each,
 * so ordering there would be a no-op control, and their visibility is a whole-tab
 * decision handled by renderLayoutTabConfigTable (STRK-326).
 */
const renderLayoutSectionConfigTable = () =>
  _renderSectionConfigTable({
    containerId: "layoutSectionConfigContainer",
    getConfig: getLayoutSectionConfig,
    saveConfig: saveLayoutSectionConfig,
    filter: (s) => LAYOUT_SECTION_TAB_VIEW[s.id] === "tabViewDashboard",
    onApply: typeof applyLayoutOrder === "function" ? applyLayoutOrder : null,
    onRender: () => renderLayoutSectionConfigTable(),
  });

/** Renders the view modal section config table in Settings > Layout. */
const renderViewModalSectionConfigTable = () =>
  _renderSectionConfigTable({
    containerId: "viewModalSectionConfigContainer",
    getConfig: getViewModalSectionConfig,
    saveConfig: saveViewModalSectionConfig,
    onRender: () => renderViewModalSectionConfigTable(),
  });

// =============================================================================
// METAL ORDER CONFIG
// =============================================================================

const METAL_ORDER_DEFAULTS = [
  { id: "silver", label: "Silver", enabled: true },
  { id: "gold", label: "Gold", enabled: true },
  { id: "platinum", label: "Platinum", enabled: true },
  { id: "palladium", label: "Palladium", enabled: true },
  { id: "all", label: "All Metals", enabled: true },
];

/**
 * Returns the current metal order config, merging stored data with defaults.
 * New metals added to defaults will be appended to existing stored configs.
 * @returns {Array<{id:string, label:string, enabled:boolean}>}
 */
const getMetalOrderConfig = () => {
  const stored = localStorage.getItem(METAL_ORDER_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      // Append any new defaults not yet in stored config
      const knownIds = new Set(parsed.map((m) => m.id));
      METAL_ORDER_DEFAULTS.filter((m) => !knownIds.has(m.id)).forEach((m) => parsed.push({ ...m }));
      return parsed;
    } catch (e) {
      /* fall through to defaults */
    }
  }
  return METAL_ORDER_DEFAULTS.map((m) => ({ ...m }));
};

const saveMetalOrderConfig = (config) => {
  localStorage.setItem(METAL_ORDER_KEY, JSON.stringify(config));
};

/**
 * Applies metal order config: reorders and shows/hides spot price cards and totals cards.
 */
const applyMetalOrder = () => {
  const config = getMetalOrderConfig();
  const spotGrid = document.querySelector(".spot-cards-grid");
  const totalsEl = document.getElementById("totalsCarousel");

  const spotMap = {
    silver: document.querySelector(".spot-input.silver"),
    gold: document.querySelector(".spot-input.gold"),
    platinum: document.querySelector(".spot-input.platinum"),
    palladium: document.querySelector(".spot-input.palladium"),
  };
  const totalsMap = {
    silver: document.querySelector(".total-card.silver"),
    gold: document.querySelector(".total-card.gold"),
    platinum: document.querySelector(".total-card.platinum"),
    palladium: document.querySelector(".total-card.palladium"),
    all: document.querySelector(".total-card.total-card-all"),
  };

  config.forEach(({ id, enabled }) => {
    const spotEl = spotMap[id];
    if (spotEl && spotGrid) {
      spotEl.style.display = enabled ? "" : "none";
      spotGrid.appendChild(spotEl);
    }
    const totalEl = totalsMap[id];
    if (totalEl && totalsEl) {
      totalEl.style.display = enabled ? "" : "none";
      totalsEl.appendChild(totalEl);
    }
  });

  if (typeof window.refreshTotalsDots === "function") window.refreshTotalsDots();
};
window.applyMetalOrder = applyMetalOrder;

/** Renders the metal order config table in Settings > Chips. */
const renderMetalOrderConfigTable = () =>
  _renderSectionConfigTable({
    containerId: "metalOrderConfigContainer",
    getConfig: getMetalOrderConfig,
    saveConfig: saveMetalOrderConfig,
    onApply: applyMetalOrder,
    onRender: () => renderMetalOrderConfigTable(),
  });
window.renderMetalOrderConfigTable = renderMetalOrderConfigTable;

/**
 * Which v2 tab view owns each layout section (STRK-282).
 *
 * Load-bearing: applyLayoutOrder re-appends every section to reassert DOM
 * order, and appending to `.container` would EJECT the section from its tab
 * view — the wrappers end up empty (zero height) and every section renders on
 * every tab. Reordering is therefore scoped within the owning view, which is
 * also the only ordering that still means anything once the sections are split
 * across tabs.
 */
const LAYOUT_SECTION_TAB_VIEW = {
  spotPrices: "tabViewDashboard",
  bestPriceTicker: "tabViewDashboard",
  totals: "tabViewDashboard",
  search: "tabViewInventory",
  table: "tabViewInventory",
  vendorPrices: "tabViewMarket",
  // No DOM section answers to `collections` yet — the entry exists so the tab
  // ownership lookup covers all four tabs (STRK-326). applyLayoutOrder skips it
  // because sectionMap has nothing under that id.
  collections: "tabViewCollections",
};
window.LAYOUT_SECTION_TAB_VIEW = LAYOUT_SECTION_TAB_VIEW;

/**
 * Shows/hides and reorders major page sections based on layout section config.
 * Reads from localStorage and applies both visibility and DOM order.
 */
const applyLayoutOrder = () => {
  const config = getLayoutSectionConfig();
  const sectionMap = {
    spotPrices: elements.spotPricesSection,
    totals: elements.totalsSectionEl,
    search: elements.searchSectionEl,
    table: elements.tableSectionEl,
    bestPriceTicker: safeGetElement("bestPriceTickerEl"),
    vendorPrices: safeGetElement("vendorPricesSectionEl"),
  };
  const container = document.querySelector(".container");
  if (!container) return;

  for (const section of config) {
    const el = sectionMap[section.id];
    if (!el) continue;
    el.style.display = section.enabled ? "" : "none";
    // Fall back to the container when the shell is absent, so this keeps
    // working if the tab views are ever removed.
    //
    // The `instanceof HTMLElement` test is load-bearing, not defensive noise:
    // safeGetElement returns a TRUTHY dummy on a miss whose methods no-op
    // silently, so a plain `view || container` would always take the dummy
    // branch and append() would quietly do nothing — every section would stay
    // where it was with no error to show for it.
    const view = safeGetElement(LAYOUT_SECTION_TAB_VIEW[section.id] || "");
    const target = view instanceof HTMLElement ? view : container;
    target.append(el);
  }
};
const applyLayoutVisibility = applyLayoutOrder;
window.applyLayoutVisibility = applyLayoutVisibility;
window.applyLayoutOrder = applyLayoutOrder;

// toggleCurrencyDropdown(), closeCurrencyDropdown() and
// closeCurrencyDropdownOnOutside() removed (STRK-288). Together they built and
// tore down the floating #headerCurrencyDropdown picker anchored to the retired
// header button — including a document-level click listener registered on open.
// The button was their only entry point, so all three became unreachable with
// it. Currency selection now runs solely through #settingsDisplayCurrency
// (js/settings-listeners.js), which reaches the same saveDisplayCurrency().

// =============================================================================
// IMAGES SETTINGS TAB (STACK-96)
// =============================================================================

/**
 * Populate all sub-sections of the Images settings tab.
 */
const populateImagesSection = () => {
  renderImageStorageStats();
  renderCustomPatternRules();
  renderOrphanedPatternImages();
  renderUserImageGrid();
};

/**
 * Create a thumbnail element (img or placeholder) for a given blob URL.
 * @param {string|null} src - Object URL or null
 * @param {string} alt - Alt text
 * @returns {HTMLElement}
 */
const createThumbEl = (src, alt) => {
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = alt;
    img.className = "pattern-rule-thumb";
    return img;
  }
  const placeholder = document.createElement("div");
  placeholder.className = "pattern-rule-thumb pattern-rule-thumb-empty";
  placeholder.textContent = "No img";
  return placeholder;
};

/**
 * Builds one orphaned-image row (dual thumbnails, key + size, delete button).
 * Extracted so renderOrphanedPatternImages stays under the complexity gate.
 * @param {{ruleId: string, size: number}} rec - patternImages record.
 * @param {Function} onDelete - Called after the record is deleted (re-render).
 * @returns {Promise<HTMLElement>}
 */
const _buildOrphanImageRow = async (rec, onDelete) => {
  const row = document.createElement("div");
  row.className = "pattern-rule-row";

  const thumbs = document.createElement("div");
  thumbs.className = "pattern-rule-thumbs";
  let obverseSrc = null;
  let reverseSrc = null;
  try {
    obverseSrc = await imageCache.getPatternImageUrl(rec.ruleId, "obverse");
  } catch {
    /* ignore */
  }
  try {
    reverseSrc = await imageCache.getPatternImageUrl(rec.ruleId, "reverse");
  } catch {
    /* ignore */
  }
  thumbs.appendChild(createThumbEl(obverseSrc, "orphaned obverse"));
  thumbs.appendChild(createThumbEl(reverseSrc, "orphaned reverse"));
  row.appendChild(thumbs);

  const info = document.createElement("div");
  info.className = "pattern-rule-info";
  const sizeKB = Math.round((rec.size || 0) / 1024);
  // Built via textContent (not innerHTML) — XSS-safe by construction.
  const keyEl = document.createElement("div");
  keyEl.className = "rule-pattern";
  keyEl.textContent = rec.ruleId;
  const sizeEl = document.createElement("div");
  sizeEl.className = "rule-replacement";
  sizeEl.textContent = `${sizeKB} KB · orphaned`;
  info.appendChild(keyEl);
  info.appendChild(sizeEl);
  row.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "pattern-rule-actions";
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn img-btn img-btn-remove";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", async () => {
    try {
      await imageCache.deletePatternImage(rec.ruleId);
    } catch (err) {
      console.warn("Settings: failed to delete orphaned pattern image", rec.ruleId, err);
    }
    onDelete(); // re-scan reflects reality whether or not the delete succeeded
  });
  actions.appendChild(deleteBtn);
  row.appendChild(actions);
  return row;
};

/**
 * Render orphaned pattern images — records in the patternImages store whose key
 * (seedImageId) is no longer referenced by any custom rule (STRK-202). These
 * accumulate when a pre-fix ZIP backup is restored (images came back but the
 * rules did not) or when a rule is removed without its image. The list lets the
 * user reclaim the space; it hides itself when there is nothing orphaned.
 */
const renderOrphanedPatternImages = async () => {
  const container = safeGetElement("orphanedPatternImages");
  if (!(container instanceof HTMLElement)) return;

  const emptyMsg =
    '<p style="font-size:0.85em;color:var(--text-secondary)">No orphaned pattern images.</p>';

  if (typeof NumistaLookup === "undefined" || !window.imageCache?.isAvailable()) {
    container.innerHTML = emptyMsg;
    return;
  }

  let records = [];
  try {
    records = await imageCache.exportAllPatternImages();
  } catch {
    container.innerHTML = emptyMsg;
    return;
  }

  const referenced = new Set(
    NumistaLookup.getCustomRules()
      .map((r) => r.seedImageId)
      .filter(Boolean)
  );
  const orphans = records.filter((rec) => rec && rec.ruleId && !referenced.has(rec.ruleId));

  if (!orphans.length) {
    container.innerHTML = emptyMsg;
    return;
  }

  container.textContent = "";

  const header = document.createElement("div");
  header.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-bottom:0.5rem";
  const label = document.createElement("span");
  label.style.cssText = "font-size:0.85em;color:var(--text-secondary)";
  label.textContent = `${orphans.length} orphaned image${
    orphans.length === 1 ? "" : "s"
  } — no matching rule, safe to delete.`;
  const deleteAllBtn = document.createElement("button");
  deleteAllBtn.className = "btn img-btn img-btn-remove";
  deleteAllBtn.textContent = "Delete all";
  deleteAllBtn.addEventListener("click", async () => {
    const ok = await showAppConfirm(
      `Delete all ${orphans.length} orphaned pattern image${
        orphans.length === 1 ? "" : "s"
      }? This cannot be undone.`,
      "Delete Orphaned Images"
    );
    if (!ok) return;
    for (const rec of orphans) {
      try {
        await imageCache.deletePatternImage(rec.ruleId);
      } catch (err) {
        console.warn("Settings: failed to delete orphaned pattern image", rec.ruleId, err);
      }
    }
    renderOrphanedPatternImages();
    renderImageStorageStats();
  });
  header.appendChild(label);
  header.appendChild(deleteAllBtn);
  container.appendChild(header);

  const onDelete = () => {
    renderOrphanedPatternImages();
    renderImageStorageStats();
  };
  // Build rows concurrently (each does IndexedDB lookups), then append in order.
  const rows = await Promise.all(orphans.map((rec) => _buildOrphanImageRow(rec, onDelete)));
  for (const row of rows) container.appendChild(row);
};

/**
 * Render user-created pattern image rules with dual thumbnails, edit, and delete.
 */
const renderCustomPatternRules = async () => {
  const container = document.getElementById("customPatternImageRules");
  if (!container) return;

  if (typeof NumistaLookup === "undefined") {
    container.innerHTML =
      '<p style="font-size:0.85em;color:var(--text-secondary)">NumistaLookup not available.</p>';
    return;
  }

  const rules = NumistaLookup.getCustomRules();
  if (!rules.length) {
    container.innerHTML =
      '<p style="font-size:0.85em;color:var(--text-secondary)">No custom pattern rules yet. Use the form above to add one.</p>';
    return;
  }

  container.textContent = "";

  for (const rule of rules) {
    const row = document.createElement("div");
    row.className = "pattern-rule-row";

    // Dual thumbnails (obverse + reverse)
    const thumbs = document.createElement("div");
    thumbs.className = "pattern-rule-thumbs";

    let obverseSrc = null;
    let reverseSrc = null;
    if (rule.seedImageId && window.imageCache?.isAvailable()) {
      try {
        obverseSrc = await imageCache.getPatternImageUrl(rule.seedImageId, "obverse");
      } catch {
        /* ignore */
      }
      try {
        reverseSrc = await imageCache.getPatternImageUrl(rule.seedImageId, "reverse");
      } catch {
        /* ignore */
      }
    }
    thumbs.appendChild(createThumbEl(obverseSrc, rule.pattern + " obverse"));
    thumbs.appendChild(createThumbEl(reverseSrc, rule.pattern + " reverse"));
    row.appendChild(thumbs);

    // Info
    const info = document.createElement("div");
    info.className = "pattern-rule-info";
    info.innerHTML = `<div class="rule-pattern">/${sanitizeHtml(rule.pattern)}/i</div>
      <div class="rule-replacement">${sanitizeHtml(rule.replacement) || "\u2014"}</div>`;
    row.appendChild(info);

    // Actions
    const actions = document.createElement("div");
    actions.className = "pattern-rule-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn img-btn img-btn-upload";
    editBtn.textContent = "Edit";

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn img-btn img-btn-remove";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      NumistaLookup.removeRule(rule.id);
      if (rule.seedImageId && window.imageCache?.isAvailable()) {
        await imageCache.deletePatternImage(rule.seedImageId);
      }
      renderCustomPatternRules();
      renderImageStorageStats();
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    row.appendChild(actions);

    // Inline edit form (hidden by default)
    const editForm = document.createElement("div");
    editForm.className = "pattern-rule-edit-form";
    editForm.style.display = "none";
    editForm.innerHTML = `
      <div class="cloud-provider-card" style="margin-top: 0.75rem; padding: 1rem">
        <div class="pattern-rule-form-row">
          <div class="pattern-rule-field">
            <label>
              Name Pattern
              <div class="chip-sort-toggle pattern-mode-toggle" style="display: inline-flex; margin-left: 0.4rem; vertical-align: middle;">
                <button type="button" class="chip-sort-btn edit-mode-keywords active" title="Comma or semicolon separated keywords">Keywords</button>
                <button type="button" class="chip-sort-btn edit-mode-regex" title="Regular expression">Regex</button>
              </div>
            </label>
            <input type="text" class="edit-pattern form-control" value="${sanitizeHtml(rule.pattern)}" placeholder="e.g. morgan, peace, walking liberty" />
          </div>
        </div>
        <div class="image-upload-sides" style="margin-top: 0.5rem">
          <div class="image-upload-side">
            <span class="image-side-label">Obverse</span>
            <div class="image-card">
              <div class="image-upload-preview" style="display: none">
                <img class="edit-obverse-preview" alt="Obverse preview" />
              </div>
              <div class="image-card-actions">
                <input type="file" class="edit-obverse" accept="image/*" style="display: none" />
                <button type="button" class="btn img-btn img-btn-upload edit-obverse-upload-btn">Upload</button>
              </div>
            </div>
            <span class="image-upload-filename edit-obverse-name"></span>
          </div>
          <div class="image-swap-wrapper" style="display: flex; align-items: center; padding-top: 1.2rem">
            <button type="button" class="btn btn-icon edit-swap-btn" title="Swap obverse &amp; reverse" style="font-size: 1.1rem; padding: 0.2rem 0.4rem; line-height: 1">⇄</button>
          </div>
          <div class="image-upload-side">
            <span class="image-side-label">Reverse</span>
            <div class="image-card">
              <div class="image-upload-preview" style="display: none">
                <img class="edit-reverse-preview" alt="Reverse preview" />
              </div>
              <div class="image-card-actions">
                <input type="file" class="edit-reverse" accept="image/*" style="display: none" />
                <button type="button" class="btn img-btn img-btn-upload edit-reverse-upload-btn">Upload</button>
              </div>
            </div>
            <span class="image-upload-filename edit-reverse-name"></span>
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.75rem">
          <button type="button" class="btn img-btn img-btn-upload edit-save-btn">Save</button>
          <button type="button" class="btn img-btn img-btn-remove edit-cancel-btn">Cancel</button>
        </div>
      </div>`;

    // Wire edit upload buttons
    [
      ["edit-obverse-upload-btn", "edit-obverse", "edit-obverse-name", "edit-obverse-preview"],
      ["edit-reverse-upload-btn", "edit-reverse", "edit-reverse-name", "edit-reverse-preview"],
    ].forEach(([btnClass, inputClass, nameClass, previewClass]) => {
      const btn = editForm.querySelector(`.${btnClass}`);
      const input = editForm.querySelector(`.${inputClass}`);
      const nameEl = editForm.querySelector(`.${nameClass}`);
      const previewEl = editForm.querySelector(`.${previewClass}`);
      if (btn && input) {
        btn.addEventListener("click", () => input.click());
        input.addEventListener("change", () => {
          if (nameEl) nameEl.textContent = input.files?.[0]?.name || "";
          if (previewEl && input.files?.[0]) {
            previewEl.src = URL.createObjectURL(input.files[0]);
            previewEl.parentElement.style.display = "";
          } else if (previewEl) {
            previewEl.src = "";
            previewEl.parentElement.style.display = "none";
          }
        });
      }
    });

    // Wire edit swap button
    const editSwapBtn = editForm.querySelector(".edit-swap-btn");
    if (editSwapBtn) {
      editSwapBtn.addEventListener("click", () => {
        const obvInput = editForm.querySelector(".edit-obverse");
        const revInput = editForm.querySelector(".edit-reverse");
        const obvName = editForm.querySelector(".edit-obverse-name");
        const revName = editForm.querySelector(".edit-reverse-name");
        const obvPreview = editForm.querySelector(".edit-obverse-preview");
        const revPreview = editForm.querySelector(".edit-reverse-preview");
        // Swap files via DataTransfer
        if (obvInput && revInput) {
          const dt1 = new DataTransfer();
          const dt2 = new DataTransfer();
          if (revInput.files[0]) dt1.items.add(revInput.files[0]);
          if (obvInput.files[0]) dt2.items.add(obvInput.files[0]);
          obvInput.files = dt1.files;
          revInput.files = dt2.files;
        }
        // Swap names
        if (obvName && revName) {
          const tmp = obvName.textContent;
          obvName.textContent = revName.textContent;
          revName.textContent = tmp;
        }
        // Swap previews
        if (obvPreview && revPreview) {
          const tmpSrc = obvPreview.src;
          const tmpDisplay = obvPreview.parentElement.style.display;
          obvPreview.src = revPreview.src;
          obvPreview.parentElement.style.display = revPreview.parentElement.style.display;
          revPreview.src = tmpSrc;
          revPreview.parentElement.style.display = tmpDisplay;
        }
      });
    }

    // Pre-populate preview images from existing cached data
    if (rule.seedImageId && window.imageCache?.isAvailable()) {
      imageCache
        .getPatternImage(rule.seedImageId)
        .then((existing) => {
          if (existing?.obverse) {
            const obvPreview = editForm.querySelector(".edit-obverse-preview");
            if (obvPreview) {
              if (obvPreview.src && obvPreview.src.startsWith("blob:"))
                URL.revokeObjectURL(obvPreview.src);
              obvPreview.src = URL.createObjectURL(existing.obverse);
              obvPreview.parentElement.style.display = "";
            }
          }
          if (existing?.reverse) {
            const revPreview = editForm.querySelector(".edit-reverse-preview");
            if (revPreview) {
              if (revPreview.src && revPreview.src.startsWith("blob:"))
                URL.revokeObjectURL(revPreview.src);
              revPreview.src = URL.createObjectURL(existing.reverse);
              revPreview.parentElement.style.display = "";
            }
          }
        })
        .catch((err) => {
          console.error("Failed to load pattern images:", err);
        });
    }

    // Keywords/Regex toggle wiring for edit form
    const editKeywordsBtn = editForm.querySelector(".edit-mode-keywords");
    const editRegexBtn = editForm.querySelector(".edit-mode-regex");
    if (editKeywordsBtn && editRegexBtn) {
      const isRegex = rule.pattern.startsWith("/") || rule.pattern.startsWith("\\b");
      if (isRegex) {
        editKeywordsBtn.classList.remove("active");
        editRegexBtn.classList.add("active");
      }
      editKeywordsBtn.addEventListener("click", () => {
        editKeywordsBtn.classList.add("active");
        editRegexBtn.classList.remove("active");
      });
      editRegexBtn.addEventListener("click", () => {
        editRegexBtn.classList.add("active");
        editKeywordsBtn.classList.remove("active");
      });
    }

    // Toggle edit form
    editBtn.addEventListener("click", () => {
      const isVisible = editForm.style.display !== "none";
      editForm.style.display = isVisible ? "none" : "block";
      editBtn.textContent = isVisible ? "Edit" : "Editing...";
    });

    // Cancel
    editForm.querySelector(".edit-cancel-btn").addEventListener("click", () => {
      editForm.style.display = "none";
      editBtn.textContent = "Edit";
    });

    // Save
    editForm.querySelector(".edit-save-btn").addEventListener("click", async () => {
      const rawPattern = editForm.querySelector(".edit-pattern").value.trim();
      const newReplacement = rawPattern;

      if (!rawPattern) {
        appAlert("Pattern is required.");
        return;
      }

      // Convert keywords to regex if Keywords mode is active (mirrors Add form behavior)
      const isKeywordMode = editForm
        .querySelector(".edit-mode-keywords")
        ?.classList.contains("active");
      let newPattern = rawPattern;
      if (isKeywordMode) {
        const terms = rawPattern
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        if (terms.length === 0) {
          appAlert("Enter at least one keyword.");
          return;
        }
        newPattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      }

      try {
        new RegExp(newPattern, "i");
      } catch (e) {
        appAlert("Invalid pattern: " + e.message);
        return;
      }

      // STRK-221: resolve any new image uploads to blobs BEFORE mutating the
      // rule, so a processing failure aborts the whole edit (matching the create
      // path) rather than leaving the pattern changed while the image is rejected.
      const obvFile = editForm.querySelector(".edit-obverse").files[0];
      const revFile = editForm.querySelector(".edit-reverse").files[0];
      const hasImageUpload = (obvFile || revFile) && window.imageCache?.isAvailable();
      let obvBlob = null;
      let revBlob = null;
      if (hasImageUpload) {
        const processor = typeof imageProcessor !== "undefined" ? imageProcessor : null;
        const toBlob = async (file) => {
          if (!processor) return file;
          const processed = await processor.processFile(file);
          if (!processed?.blob) {
            throw new Error("the selected image could not be processed");
          }
          return processed.blob;
        };

        try {
          if (obvFile) obvBlob = await toBlob(obvFile);
          if (revFile) revBlob = await toBlob(revFile);
        } catch (err) {
          console.error("Image processing failed:", err);
          appAlert("Failed to process image: " + err.message);
          return;
        }
      }

      const result = NumistaLookup.updateRule(rule.id, {
        pattern: newPattern,
        replacement: newReplacement,
        numistaId: null, // STAK-306: clear any legacy N# — edit form no longer manages it
      });

      if (!result.success) {
        appAlert(result.error || "Failed to update rule.");
        return;
      }

      // Cache the already-resolved image blobs now that the rule text is saved.
      if (hasImageUpload) {
        const ruleId = rule.seedImageId || rule.id;
        // Preserve existing side when only one side is uploaded
        if (rule.seedImageId && !(obvFile && revFile)) {
          const existing = await imageCache.getPatternImage(rule.seedImageId);
          await imageCache.cachePatternImage(
            ruleId,
            obvBlob || existing?.obverse || null,
            revBlob || existing?.reverse || null
          );
        } else {
          await imageCache.cachePatternImage(ruleId, obvBlob, revBlob);
        }

        // Ensure seedImageId is set on the rule
        if (!rule.seedImageId) {
          NumistaLookup.updateRule(rule.id, { seedImageId: ruleId });
        }
      }

      renderCustomPatternRules();
      renderImageStorageStats();
    });

    row.appendChild(editForm);
    container.appendChild(row);
  }
};

/**
 * Render storage statistics for the image system.
 */
const renderImageStorageStats = async () => {
  const container = document.getElementById("imageStorageStats");
  if (!container) return;

  if (!window.imageCache?.isAvailable()) {
    container.innerHTML = '<span class="stat-item">IndexedDB unavailable</span>';
    return;
  }

  const usage = await imageCache.getStorageUsage();
  const limitBytes = usage.limitBytes || 1;

  const fmt = (b) => {
    if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + " MB";
    return Math.round(b / 1024) + " KB";
  };

  const pct = (b) => Math.min(100, (b / limitBytes) * 100).toFixed(1);

  const barColor = (b) => {
    const p = (b / limitBytes) * 100;
    if (p > 90) return "var(--danger)";
    if (p > 70) return "var(--warning)";
    return "var(--primary)";
  };

  const userBar = document.getElementById("gaugeUserBar");
  const userSize = document.getElementById("gaugeUserSize");
  const persistLine = document.getElementById("gaugePersistLine");

  if (userBar) {
    userBar.style.width = pct(usage.userImageBytes || 0) + "%";
    userBar.style.background = barColor(usage.userImageBytes || 0);
  }
  if (userSize) {
    userSize.textContent = `${fmt(usage.userImageBytes || 0)} (${usage.userImageCount} items)`;
  }
  if (persistLine) {
    const granted = localStorage.getItem(STORAGE_PERSIST_GRANTED_KEY);
    if (granted === "true") {
      persistLine.textContent =
        "✅ Persistent storage granted — browser will not auto-clear your images";
      persistLine.style.color = "var(--success)";
    } else if (granted === "false") {
      persistLine.textContent =
        "⚠️ Persistent storage not granted — consider using Full Backup regularly";
      persistLine.style.color = "var(--warning)";
    } else {
      persistLine.textContent = "Upload a photo to request persistent storage protection";
      persistLine.style.color = "var(--text-secondary)";
    }
  }
};

/**
 * Render user-uploaded images as rows with dual thumbnails, edit link, and delete.
 */
const renderUserImageGrid = async () => {
  const container = document.getElementById("userImageGrid");
  if (!container) return;

  if (!window.imageCache?.isAvailable()) {
    container.innerHTML =
      '<p style="font-size:0.85em;color:var(--text-secondary)">IndexedDB unavailable.</p>';
    return;
  }

  let userImages;
  try {
    userImages = await imageCache.exportAllUserImages();
  } catch {
    container.innerHTML =
      '<p style="font-size:0.85em;color:var(--text-secondary)">Could not load user images.</p>';
    return;
  }

  if (!userImages?.length) {
    container.innerHTML =
      '<p style="font-size:0.85em;color:var(--text-secondary)">No user-uploaded images yet.</p>';
    return;
  }

  container.textContent = "";

  // Pre-index inventory by UUID → array index for O(1) lookups (STRK-228)
  const idxByUuid = new Map();
  if (typeof inventory !== "undefined" && Array.isArray(inventory)) {
    for (let i = 0; i < inventory.length; i++) {
      const inv = inventory[i];
      // First-match parity with the original inventory.find() (keep earliest index)
      if (inv?.uuid && !idxByUuid.has(inv.uuid)) idxByUuid.set(inv.uuid, i);
    }
  }

  for (const rec of userImages) {
    const row = document.createElement("div");
    row.className = "pattern-rule-row";

    // Dual thumbnails
    const thumbs = document.createElement("div");
    thumbs.className = "pattern-rule-thumbs";
    let obverseSrc = null;
    let reverseSrc = null;
    if (rec.obverse) {
      try {
        obverseSrc = URL.createObjectURL(rec.obverse);
      } catch {
        /* ignore */
      }
    }
    if (rec.reverse) {
      try {
        reverseSrc = URL.createObjectURL(rec.reverse);
      } catch {
        /* ignore */
      }
    }
    thumbs.appendChild(createThumbEl(obverseSrc, "obverse"));
    thumbs.appendChild(createThumbEl(reverseSrc, "reverse"));
    row.appendChild(thumbs);

    // Item name
    const itemIndex = idxByUuid.get(rec.uuid) ?? -1;
    const item = itemIndex >= 0 ? inventory[itemIndex] : null;
    const name = item ? item.name : rec.uuid.slice(0, 8) + "...";

    const info = document.createElement("div");
    info.className = "pattern-rule-info";
    info.innerHTML = '<div class="rule-replacement">' + sanitizeHtml(name) + "</div>";
    row.appendChild(info);

    // Actions
    const actions = document.createElement("div");
    actions.className = "pattern-rule-actions";

    // Edit link — opens item's edit modal
    if (itemIndex >= 0) {
      const editLink = document.createElement("button");
      editLink.className = "btn img-btn img-btn-upload";
      editLink.textContent = "Edit";
      editLink.addEventListener("click", () => {
        hideSettingsModal();
        if (typeof editItem === "function") editItem(itemIndex);
      });
      actions.appendChild(editLink);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn img-btn img-btn-remove";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      const confirmed = await appConfirm(`Delete images for "${name}"?`, "User Images");
      if (!confirmed) return;
      await imageCache.deleteUserImage(rec.uuid);
      renderUserImageGrid();
      renderImageStorageStats();
    });
    actions.appendChild(deleteBtn);
    row.appendChild(actions);

    container.appendChild(row);
  }
};

// =============================================================================
// STORAGE SECTION
// =============================================================================

/** Friendly display names for known localStorage keys */
const STORAGE_KEY_LABELS = {
  metalInventory: { label: "Inventory Data", icon: "📋", category: "Inventory" },
  inventorySerial: { label: "Item Serial Counter", icon: "🔢", category: "Inventory" },
  catalogMap: { label: "Catalog Map", icon: "🗂", category: "Inventory" },
  itemTags: { label: "Item Tags", icon: "🏷", category: "Inventory" },
  changeLog: { label: "Change Log", icon: "📝", category: "Inventory" },
  metalSpotHistory: {
    label: "Spot Price History (IndexedDB — localStorage fallback)",
    icon: "📈",
    category: "Prices",
  },
  v2RetailHistory: {
    label: "Retail Price History (IndexedDB — localStorage fallback)",
    icon: "📈",
    category: "Prices",
  },
  retailPriceHistory: {
    label: "Retail Price History (legacy — IndexedDB)",
    icon: "📈",
    category: "Prices",
  },
  "item-price-history": { label: "Item Price History", icon: "💰", category: "Prices" },
  "goldback-prices": { label: "Goldback Prices", icon: "🥇", category: "Prices" },
  "goldback-price-history": { label: "Goldback Price History", icon: "🥇", category: "Prices" },
  spotSilver: { label: "Silver Spot (live)", icon: "🪙", category: "Prices" },
  spotGold: { label: "Gold Spot (live)", icon: "🪙", category: "Prices" },
  spotPlatinum: { label: "Platinum Spot (live)", icon: "🪙", category: "Prices" },
  spotPalladium: { label: "Palladium Spot (live)", icon: "🪙", category: "Prices" },
  metalApiConfig: { label: "API Configuration", icon: "🔑", category: "API & Cache" },
  metalApiCache: { label: "API Cache", icon: "⚡", category: "API & Cache" },
  lastCacheRefresh: { label: "Last Cache Refresh", icon: "⏱", category: "API & Cache" },
  lastApiSync: { label: "Last API Sync", icon: "⏱", category: "API & Cache" },
  apiProviderOrder: { label: "API Provider Order", icon: "↕", category: "API & Cache" },
  providerPriority: { label: "Provider Priority", icon: "↕", category: "API & Cache" },
  autocomplete_lookup_cache: { label: "Autocomplete Cache", icon: "⚡", category: "API & Cache" },
  autocomplete_cache_timestamp: {
    label: "Autocomplete Cache Stamp",
    icon: "⏱",
    category: "API & Cache",
  },
  "staktrakr.catalog.cache": { label: "Catalog Cache", icon: "⚡", category: "API & Cache" },
  "staktrakr.catalog.history": {
    label: "Catalog Call History",
    icon: "📜",
    category: "API & Cache",
  },
  catalog_api_config: { label: "Catalog API Config", icon: "🔑", category: "API & Cache" },
  exchangeRates: { label: "Exchange Rates", icon: "💱", category: "API & Cache" },
  appTheme: { label: "Theme", icon: "🎨", category: "Settings" },
  displayCurrency: { label: "Display Currency", icon: "💱", category: "Settings" },
  appTimeZone: { label: "Timezone", icon: "🕐", category: "Settings" },
  settingsItemsPerPage: { label: "Items Per Page", icon: "⚙️", category: "Settings" },
  cardViewStyle: { label: "Card View Style", icon: "⚙️", category: "Settings" },
  desktopCardView: { label: "Desktop Card View", icon: "⚙️", category: "Settings" },
  defaultSortColumn: { label: "Default Sort Column", icon: "⚙️", category: "Settings" },
  defaultSortDir: { label: "Default Sort Direction", icon: "⚙️", category: "Settings" },
  metalOrderConfig: { label: "Metal Order / Visibility", icon: "⚙️", category: "Settings" },
  layoutVisibility: { label: "Layout Visibility", icon: "⚙️", category: "Settings" },
  layoutSectionConfig: { label: "Layout Section Config", icon: "⚙️", category: "Settings" },
  viewModalSectionConfig: { label: "View Modal Section Config", icon: "⚙️", category: "Settings" },
  chipMinCount: { label: "Chip Min Count", icon: "⚙️", category: "Settings" },
  chipMaxCount: { label: "Chip Max Count", icon: "⚙️", category: "Settings" },
  chipCustomGroups: { label: "Chip Custom Groups", icon: "⚙️", category: "Settings" },
  chipBlacklist: { label: "Chip Blacklist", icon: "⚙️", category: "Settings" },
  inlineChipConfig: { label: "Inline Chip Config", icon: "⚙️", category: "Settings" },
  filterChipCategoryConfig: { label: "Filter Chip Categories", icon: "⚙️", category: "Settings" },
  chipSortOrder: { label: "Chip Sort Order", icon: "⚙️", category: "Settings" },
  numistaLookupRules: { label: "Numista Lookup Rules", icon: "🔍", category: "Settings" },
  numistaViewFields: { label: "Numista View Fields", icon: "🔍", category: "Settings" },
  "staktrakr.catalog.settings": { label: "Catalog Settings", icon: "🔍", category: "Settings" },
  tableImagesEnabled: { label: "Table Images", icon: "🖼", category: "Settings" },
  tableImageSides: { label: "Table Image Sides", icon: "🖼", category: "Settings" },
  featureFlags: { label: "Feature Flags", icon: "🚩", category: "Settings" },
  headerThemeBtnVisible: { label: "Theme Btn Visible", icon: "⚙️", category: "Settings" },
  spotTrendRange: { label: "Spot Trend Range", icon: "📈", category: "Settings" },
  spotCompareMode: { label: "Spot Compare Mode", icon: "📈", category: "Settings" },
  spotTrendPeriod: { label: "Spot Trend Period", icon: "📈", category: "Settings" },
  "goldback-enabled": { label: "Goldback Enabled", icon: "🥇", category: "Settings" },
  "goldback-estimate-enabled": { label: "Goldback Estimate On", icon: "🥇", category: "Settings" },
  "goldback-estimate-modifier": { label: "Goldback Modifier", icon: "🥇", category: "Settings" },
  cloud_token_dropbox: { label: "Dropbox Token", icon: "☁️", category: "Cloud & Auth" },
  cloud_token_pcloud: { label: "pCloud Token", icon: "☁️", category: "Cloud & Auth" },
  cloud_token_box: { label: "Box Token", icon: "☁️", category: "Cloud & Auth" },
  cloud_last_backup: { label: "Last Cloud Backup", icon: "☁️", category: "Cloud & Auth" },
  cloud_activity_log: { label: "Cloud Activity Log", icon: "☁️", category: "Cloud & Auth" },
  cloud_kraken_seen: { label: "Cloud Onboarding Seen", icon: "☁️", category: "Cloud & Auth" },
  staktrakr_oauth_result: { label: "OAuth Result", icon: "🔐", category: "Cloud & Auth" },
  currentAppVersion: { label: "App Version (stored)", icon: "ℹ️", category: "App State" },
  ackVersion: { label: "Acknowledged Version", icon: "ℹ️", category: "App State" },
  ackDismissed: { label: "Acknowledgment Dismissed", icon: "ℹ️", category: "App State" },
  lastVersionCheck: { label: "Last Version Check", icon: "ℹ️", category: "App State" },
  latestRemoteVersion: { label: "Latest Remote Version", icon: "ℹ️", category: "App State" },
  latestRemoteUrl: { label: "Latest Remote URL", icon: "ℹ️", category: "App State" },
  seedImagesVer: { label: "Seed Images Version", icon: "🌱", category: "App State" },
  ff_migration_fuzzy_autocomplete: {
    label: "Migration: Fuzzy Autocomplete",
    icon: "🔄",
    category: "App State",
  },
  migration_hourlySource: { label: "Migration: Hourly Source", icon: "🔄", category: "App State" },
  "staktrakr.debug": { label: "Debug Flag", icon: "🐛", category: "App State" },
  "stackrtrackr.debug": { label: "Debug Flag (legacy typo)", icon: "🐛", category: "App State" },
};

/** Keys under this KB threshold are considered "minor" and hidden by default */
const STORAGE_TINY_THRESHOLD_KB = 0.5;

/** True = show minor keys; toggled by the button in the panel */
let _storageTinyVisible = false;

/**
 * Populates the Storage settings panel with live LS and IDB data.
 * @param {boolean} [silent=false] - If true, skip the loading spinner on refresh
 */
const renderStorageSection = async (silent = false) => {
  const keyTable = document.getElementById("storageKeyTable");
  const idbTable = document.getElementById("storageIdbTable");
  if (!keyTable) return;

  if (!silent) {
    keyTable.innerHTML = '<div class="storage-key-table-loading">Loading…</div>';
    if (idbTable) idbTable.innerHTML = '<div class="storage-key-table-loading">Loading…</div>';
  }

  // ── 1. Gather localStorage data ──────────────────────────────────────────
  const lsItems = [];
  let lsTotalKB = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const val = localStorage.getItem(key) || "";
    const sizeKB = ((key.length + val.length) * 2) / 1024;
    lsTotalKB += sizeKB;

    let type = "String",
      records = null;
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) {
        type = "Array";
        records = parsed.length;
      } else if (parsed && typeof parsed === "object") {
        type = "Object";
        records = Object.keys(parsed).length;
      } else {
        type = "Value";
      }
    } catch (e) {
      /* not JSON */
    }

    const meta = STORAGE_KEY_LABELS[key] || {};
    lsItems.push({
      key,
      sizeKB,
      type,
      records,
      label: meta.label || key,
      icon: meta.icon || "📄",
      category: meta.category || "Other",
    });
  }
  lsItems.sort((a, b) => b.sizeKB - a.sizeKB);

  // ── 2. Gather IndexedDB data ──────────────────────────────────────────────
  let idbStats = null;
  if (window.imageCache?.isAvailable()) {
    try {
      idbStats = await imageCache.getStorageUsage();
    } catch (e) {
      /* unavailable */
    }
  }

  let attachStats = null;
  if (window.attachmentManager?.isAvailable()) {
    try {
      attachStats = await attachmentManager.getStorageUsage();
    } catch (e) {
      /* unavailable */
    }
  }

  // Spot + retail price history live in the StakTrakrHistory IndexedDB store
  // (migrated out of localStorage — STRK-141). Surface it like the image stores.
  let historyStats = null;
  if (typeof historyStore !== "undefined" && historyStore.isAvailable()) {
    try {
      historyStats = await historyStore.getUsage();
    } catch (e) {
      /* unavailable */
    }
  }

  const attachTotalKB = attachStats ? attachStats.totalBytes / 1024 : 0;
  const historyTotalKB = historyStats ? historyStats.bytesEstimate / 1024 : 0;
  const idbTotalKB = (idbStats ? idbStats.totalBytes / 1024 : 0) + attachTotalKB + historyTotalKB;
  const idbLimitKB = idbStats ? idbStats.limitBytes / 1024 : 50 * 1024;
  const lsLimitKB = 5 * 1024;
  const combinedKB = lsTotalKB + idbTotalKB;
  const combinedLimitKB = lsLimitKB + idbLimitKB;

  // ── 3. Update summary stat cards ─────────────────────────────────────────
  const fmt = (kb) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`);
  const pct = (used, limit) => (limit > 0 ? Math.min((used / limit) * 100, 100) : 0);

  const setCard = (id, val, sub, barId, barPct, barClass) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
    const subEl = document.getElementById(`${id}_sub`);
    if (subEl) subEl.textContent = sub;
    const bar = document.getElementById(barId);
    if (bar) {
      bar.style.width = `${barPct.toFixed(1)}%`;
      if (barClass) bar.className = `storage-stat-bar ${barClass}`;
    }
  };

  setCard(
    "storageStat_ls",
    fmt(lsTotalKB),
    `${pct(lsTotalKB, lsLimitKB).toFixed(1)}% of ~5 MB (localStorage)`,
    "storageStatBar_ls",
    pct(lsTotalKB, lsLimitKB),
    "storage-stat-bar--ls"
  );
  setCard(
    "storageStat_idb",
    fmt(idbTotalKB),
    idbTotalKB > 0
      ? `Images: ~${fmt(idbTotalKB - attachTotalKB - historyTotalKB)} · Attachments: ${fmt(attachTotalKB)} · History: ${fmt(historyTotalKB)}`
      : "No IndexedDB data",
    "storageStatBar_idb",
    pct(idbTotalKB, idbLimitKB),
    "storage-stat-bar--idb"
  );
  setCard(
    "storageStat_combined",
    fmt(combinedKB),
    `LS + IDB combined (browser quota varies)`,
    "storageStatBar_combined_ls",
    pct(lsTotalKB, combinedLimitKB),
    "storage-stat-bar--ls"
  );
  const combinedIdbBar = document.getElementById("storageStatBar_combined_idb");
  if (combinedIdbBar)
    combinedIdbBar.style.width = `${pct(idbTotalKB, combinedLimitKB).toFixed(1)}%`;

  // ── 4. Render localStorage key table ─────────────────────────────────────
  const major = lsItems.filter((it) => it.sizeKB >= STORAGE_TINY_THRESHOLD_KB);
  const minor = lsItems.filter((it) => it.sizeKB < STORAGE_TINY_THRESHOLD_KB);
  const visible = _storageTinyVisible ? lsItems : major;

  const rowsHtml = visible
    .map((it) => {
      const barPct = lsTotalKB > 0 ? Math.min((it.sizeKB / lsTotalKB) * 100, 100) : 0;
      const recStr = it.records !== null ? it.records.toLocaleString() : "—";
      const sizeStr =
        it.sizeKB >= 1 ? `${it.sizeKB.toFixed(1)} KB` : `${(it.sizeKB * 1024).toFixed(0)} B`;
      return `<tr class="storage-key-row">
      <td class="storage-key-icon">${it.icon}</td>
      <td class="storage-key-label">${sanitizeHtml(it.label)}<span class="storage-key-raw">${sanitizeHtml(it.key)}</span></td>
      <td class="storage-key-size">${sizeStr}</td>
      <td class="storage-key-bar-cell"><div class="storage-key-bar-wrap"><div class="storage-key-bar" style="width:${barPct.toFixed(1)}%"></div></div></td>
      <td class="storage-key-pct">${barPct.toFixed(1)}%</td>
      <td class="storage-key-type"><span class="storage-type-badge storage-type-badge--${it.type.toLowerCase()}">${it.type}</span></td>
      <td class="storage-key-records">${recStr}</td>
    </tr>`;
    })
    .join("");

  keyTable.innerHTML = `
    <table class="storage-data-table">
      <thead><tr>
        <th></th>
        <th>Key</th>
        <th>Size</th>
        <th class="storage-col-bar">Usage</th>
        <th>%</th>
        <th>Type</th>
        <th>Records</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    ${minor.length > 0 ? `<p class="storage-minor-note">${_storageTinyVisible ? "" : `${minor.length} minor keys hidden. `}<button class="btn-link storage-toggle-tiny" id="storageToggleTinyBottom">${_storageTinyVisible ? "Hide minor keys" : "Show all"}</button></p>` : ""}
  `;

  // wire bottom toggle
  const bottomToggle = document.getElementById("storageToggleTinyBottom");
  if (bottomToggle) bottomToggle.addEventListener("click", _handleStorageTinyToggle);

  // ── 5. Render IndexedDB table ─────────────────────────────────────────────
  if (idbTable) {
    if (!idbStats && !attachStats && !historyStats) {
      idbTable.innerHTML = '<p class="settings-subtext">IndexedDB unavailable in this browser.</p>';
    } else {
      const imagesTotalKB = idbStats ? idbStats.totalBytes / 1024 : 0;
      const idbRows = idbStats
        ? [
            { label: "Coin Images", icon: "🖼", count: idbStats.numistaCount, sizeKB: null },
            { label: "User Images", icon: "📷", count: idbStats.userImageCount, sizeKB: null },
            {
              label: "Pattern Images",
              icon: "🎨",
              count: idbStats.patternImageCount || 0,
              sizeKB: null,
            },
            { label: "Coin Metadata", icon: "📄", count: idbStats.metadataCount, sizeKB: null },
          ]
        : [];
      // Estimate image row sizes by proportion of images total (exact per-store breakdown unavailable)
      const idbImageCount = idbRows.reduce((s, r) => s + r.count, 0) || 1;
      idbRows.forEach((r) => {
        r.sizeKB = idbImageCount > 0 ? (r.count / idbImageCount) * imagesTotalKB : 0;
      });
      // Attachments row uses exact bytes from attachmentManager (rec.size is stored on write)
      if (attachStats !== null) {
        idbRows.push({
          label: "Attachments",
          icon: "📎",
          count: attachStats.count,
          sizeKB: attachTotalKB,
          exact: true,
        });
      }
      // Spot + retail history row uses exact bytes from historyStore.getUsage() (STRK-141)
      if (historyStats !== null) {
        idbRows.push({
          label: "Spot/Retail History",
          icon: "📈",
          count: historyStats.count,
          sizeKB: historyTotalKB,
          dbName: "StakTrakrHistory",
          exact: true,
        });
      }

      const idbRowsHtml = idbRows
        .map((r) => {
          const barPct = idbTotalKB > 0 ? Math.min((r.sizeKB / idbTotalKB) * 100, 100) : 0;
          const sizeStr =
            r.sizeKB >= 1024 ? `${(r.sizeKB / 1024).toFixed(1)} MB` : `${r.sizeKB.toFixed(1)} KB`;
          const dbName = r.dbName || (r.exact ? "StakTrakrAttachments" : "StakTrakrImages");
          return `<tr class="storage-key-row">
          <td class="storage-key-icon">${r.icon}</td>
          <td class="storage-key-label">${r.label}<span class="storage-key-raw">${dbName}</span></td>
          <td class="storage-key-size">${r.exact ? "" : "~"}${sizeStr}</td>
          <td class="storage-key-bar-cell"><div class="storage-key-bar-wrap"><div class="storage-key-bar storage-key-bar--idb" style="width:${barPct.toFixed(1)}%"></div></div></td>
          <td class="storage-key-pct">${barPct.toFixed(1)}%</td>
          <td class="storage-key-type"><span class="storage-type-badge storage-type-badge--idb">IDB</span></td>
          <td class="storage-key-records">${r.count.toLocaleString()}</td>
        </tr>`;
        })
        .join("");

      const idbTotalStr =
        idbTotalKB >= 1024 ? `${(idbTotalKB / 1024).toFixed(1)} MB` : `${idbTotalKB.toFixed(1)} KB`;
      const idbLimitStr =
        idbLimitKB >= 1024 ? `${(idbLimitKB / 1024).toFixed(0)} MB` : `${idbLimitKB.toFixed(0)} KB`;

      idbTable.innerHTML = `
        <table class="storage-data-table">
          <thead><tr>
            <th></th>
            <th>Store</th>
            <th>~Size</th>
            <th class="storage-col-bar">Usage</th>
            <th>%</th>
            <th>Type</th>
            <th>Records</th>
          </tr></thead>
          <tbody>${idbRowsHtml}</tbody>
        </table>
        <p class="storage-minor-note">Total: ${idbTotalStr} / ${idbLimitStr} &nbsp;·&nbsp; Size per store is estimated proportionally from record count.</p>
      `;
    }
  }

  // ── 6. Update top toggle button text ─────────────────────────────────────
  const topToggle = document.getElementById("storageToggleTiny");
  if (topToggle)
    topToggle.textContent = _storageTinyVisible
      ? "Hide minor keys"
      : `Show minor keys (${minor.length})`;
};

const _handleStorageTinyToggle = () => {
  _storageTinyVisible = !_storageTinyVisible;
  renderStorageSection(true);
};

/**
 * Builds and renders the Numista tag settings UI:
 * 1. Auto-apply Numista tags toggle
 * 2. Tag blacklist management section
 * Appended after the numistaBulkSyncGroup inside the Numista provider panel.
 */
const renderNumistaTagSettings = () => {
  const container = safeGetElement("numistaTagSettingsGroup");
  if (!container) return;

  // Clear previous render
  container.innerHTML = "";

  // ── 1. Auto-apply toggle ──────────────────────────────────────────────
  const autoGroup = document.createElement("div");
  autoGroup.className = "settings-group";
  autoGroup.style.cssText =
    "margin-top: 1rem; border-top: 1px solid var(--border); padding-top: 0.75rem;";

  const autoLabel = document.createElement("div");
  autoLabel.className = "settings-group-label";
  autoLabel.textContent = "Auto-apply Numista tags on import";
  autoGroup.appendChild(autoLabel);

  const autoSubtext = document.createElement("p");
  autoSubtext.className = "settings-subtext";
  autoSubtext.textContent =
    "When enabled, tags from Numista are automatically applied to items during search and bulk sync. Disable to skip tag assignment entirely.";
  autoGroup.appendChild(autoSubtext);

  const toggleWrap = document.createElement("div");
  toggleWrap.className = "chip-sort-toggle";
  toggleWrap.id = "settingsNumistaTagsAuto";

  const btnYes = document.createElement("button");
  btnYes.type = "button";
  btnYes.className = "chip-sort-btn";
  btnYes.dataset.val = "yes";
  btnYes.textContent = "On";

  const btnNo = document.createElement("button");
  btnNo.type = "button";
  btnNo.className = "chip-sort-btn";
  btnNo.dataset.val = "no";
  btnNo.textContent = "Off";

  toggleWrap.appendChild(btnYes);
  toggleWrap.appendChild(btnNo);
  autoGroup.appendChild(toggleWrap);
  container.appendChild(autoGroup);

  // Sync initial state
  const autoOn = loadDataSync("numista_tags_auto", true);
  syncChipToggle("settingsNumistaTagsAuto", autoOn);

  // Wire toggle
  toggleWrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip-sort-btn");
    if (!btn) return;
    const isEnabled = btn.dataset.val === "yes";
    saveDataSync("numista_tags_auto", isEnabled);
    syncChipToggle("settingsNumistaTagsAuto", isEnabled);
  });

  // ── 2. Tag blacklist section ──────────────────────────────────────────
  const blGroup = document.createElement("div");
  blGroup.className = "settings-group";
  blGroup.style.cssText =
    "margin-top: 1rem; border-top: 1px solid var(--border); padding-top: 0.75rem;";

  const blLabel = document.createElement("div");
  blLabel.className = "settings-group-label";
  blLabel.textContent = "Tag Blacklist";
  blGroup.appendChild(blLabel);

  const blSubtext = document.createElement("p");
  blSubtext.className = "settings-subtext";
  blSubtext.textContent =
    "Tags in this list will never be applied from Numista imports. Matching is case-insensitive.";
  blGroup.appendChild(blSubtext);

  // Input row
  const inputRow = document.createElement("div");
  inputRow.style.cssText = "display:flex;gap:0.5rem;margin-bottom:0.5rem;";

  const tagInput = document.createElement("input");
  tagInput.type = "text";
  tagInput.id = "numistaTagBlacklistInput";
  tagInput.placeholder = "e.g. Circulation";
  tagInput.style.cssText =
    "flex:1;padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:4px;font-size:0.85rem;background:var(--bg);color:var(--text);";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn info";
  addBtn.style.fontSize = "0.85rem";
  addBtn.textContent = "Add";

  inputRow.appendChild(tagInput);
  inputRow.appendChild(addBtn);
  blGroup.appendChild(inputRow);

  // Tag list container
  const tagList = document.createElement("div");
  tagList.id = "numistaTagBlacklistList";
  tagList.style.cssText = "display:flex;flex-wrap:wrap;gap:0.35rem;";
  blGroup.appendChild(tagList);

  container.appendChild(blGroup);

  // Render current blacklist
  const renderBlacklist = () => {
    tagList.innerHTML = "";
    const blacklist =
      typeof window.loadTagBlacklist === "function" ? window.loadTagBlacklist() : [];
    if (blacklist.length === 0) {
      const hint = document.createElement("span");
      hint.className = "settings-subtext";
      hint.style.fontSize = "0.8rem";
      hint.textContent = "No blacklisted tags.";
      tagList.appendChild(hint);
      return;
    }
    for (const tag of blacklist) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.style.cssText =
        "display:inline-flex;align-items:center;gap:0.25rem;padding:0.2rem 0.5rem;border-radius:12px;font-size:0.8rem;background:var(--bg-secondary);color:var(--text);";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = sanitizeHtml(tag);
      chip.appendChild(nameSpan);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "\u00d7";
      removeBtn.title = "Remove from blacklist";
      removeBtn.style.cssText =
        "background:none;border:none;cursor:pointer;font-size:1rem;line-height:1;padding:0 0.15rem;color:var(--text-secondary);";
      removeBtn.addEventListener("click", () => {
        if (typeof window.removeFromTagBlacklist === "function") {
          window.removeFromTagBlacklist(tag);
          renderBlacklist();
        }
      });
      chip.appendChild(removeBtn);
      tagList.appendChild(chip);
    }
  };

  // Wire add button
  const doAdd = () => {
    const val = tagInput.value.trim();
    if (!val) return;
    if (typeof window.addToTagBlacklist === "function") {
      window.addToTagBlacklist(val);
    }
    tagInput.value = "";
    renderBlacklist();
  };

  addBtn.addEventListener("click", doAdd);
  tagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doAdd();
    }
  });

  renderBlacklist();
};

// ---------------------------------------------------------------------------
// Market Filter Matrix (STAK-515)
// ---------------------------------------------------------------------------

const _getAvailableVendorsForSlug = (slug) => {
  if (
    !retailPrices ||
    !retailPrices.prices ||
    !retailPrices.prices[slug] ||
    !retailPrices.prices[slug].vendors
  )
    return [];
  return Object.keys(retailPrices.prices[slug].vendors);
};

const renderMarketFilterMatrix = () => {
  const thead = safeGetElement("marketFilterMatrixHead");
  const tbody = safeGetElement("marketFilterMatrixBody");
  const statusEl = safeGetElement("marketFilterStatus");
  if (!thead || !thead.id || !tbody || !tbody.id) return;

  const slugs = typeof getActiveRetailSlugs === "function" ? getActiveRetailSlugs() : [];

  // Build vendor list from manifest or fallback constants
  const vendorSource =
    typeof _manifestVendorMeta !== "undefined" && _manifestVendorMeta
      ? _manifestVendorMeta
      : typeof RETAIL_VENDOR_NAMES !== "undefined"
        ? RETAIL_VENDOR_NAMES
        : {};
  const vendors = Object.keys(vendorSource).map((id) => {
    if (typeof getVendorDisplay === "function") {
      const info = getVendorDisplay(id);
      return { id, name: info.name || id, color: info.color || getThemeColor("text-muted") };
    }
    const colors = typeof RETAIL_VENDOR_COLORS !== "undefined" ? RETAIL_VENDOR_COLORS : {};
    return {
      id,
      name: vendorSource[id]?.name || vendorSource[id] || id,
      color: colors[id] || getThemeColor("text-muted"),
    };
  });

  // --- thead ---
  while (thead.firstChild) thead.removeChild(thead.firstChild);
  const headerRow = document.createElement("tr");

  const thProduct = document.createElement("th");
  thProduct.textContent = "PRODUCT";
  headerRow.appendChild(thProduct);

  const thAll = document.createElement("th");
  thAll.textContent = "ALL";
  headerRow.appendChild(thAll);

  vendors.forEach((v) => {
    const th = document.createElement("th");
    const dot = document.createElement("span");
    dot.className = "vendor-dot";
    dot.style.background = v.color;
    th.appendChild(dot);
    // Ultra-short vendor names for compact matrix headers
    const _vendorAbbrev = {
      APMEX: "APX",
      Monument: "MON",
      Gainesville: "GVL",
      Provident: "PRV",
      BullionX: "BLX",
      Summit: "SMT",
      Hero: "HRO",
      Goldback: "GB",
    };
    th.appendChild(document.createTextNode(_vendorAbbrev[v.name] || v.name));
    th.title = v.name; // Full name on hover
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  // --- ALL row (column toggles) ---
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
  const allRow = document.createElement("tr");
  allRow.className = "mfm-all-row";

  const allLabelTd = document.createElement("td");
  allLabelTd.textContent = "ALL";
  allRow.appendChild(allLabelTd);

  const masterTd = document.createElement("td");
  const masterCb = document.createElement("input");
  masterCb.type = "checkbox";
  masterCb.title = "Toggle everything";
  masterCb.className = "mfm-master-toggle";
  masterTd.appendChild(masterCb);
  allRow.appendChild(masterTd);

  vendors.forEach((v) => {
    const td = document.createElement("td");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.setAttribute("data-col-toggle", v.id);
    cb.title = "Toggle all " + v.name;
    td.appendChild(cb);
    allRow.appendChild(td);
  });
  tbody.appendChild(allRow);

  // --- Product rows ---
  // STAK-521: `slugs` is already filtered by _isSlugResolved upstream in getActiveRetailSlugs.
  // Retain `displaySlugs` as a read-only alias so the downstream forEach, metal-pill
  // visibleSlugs filter, and master-toggle scoping below do not need to change. The alias
  // is intentionally preserved to keep the STAK-521 diff minimally invasive — do not inline.
  const displaySlugs = slugs;
  displaySlugs.forEach((slug) => {
    const meta =
      typeof getRetailCoinMeta === "function"
        ? getRetailCoinMeta(slug)
        : { name: slug, metal: "unknown" };
    const metal = (meta.metal || "unknown").toLowerCase();
    const available = _getAvailableVendorsForSlug(slug);

    const tr = document.createElement("tr");
    tr.setAttribute("data-metal", metal);

    const nameTd = document.createElement("td");
    nameTd.className = "mfm-product-name";
    // Abbreviate product names: strip weight/purity suffixes for compact display
    const shortName = (meta.name || slug)
      .replace(/\s*\(1\/1000 oz gold\)/i, "") // Goldback weight suffix
      .replace(/\s*\(\.\d+\)/i, "") // (.999) purity
      .replace(/\s+1\s*oz$/i, "") // trailing "1 oz"
      .replace(/\s+10\s*oz$/i, " 10oz"); // "10 oz" → compact
    nameTd.textContent = shortName;
    nameTd.title = meta.name; // Full name on hover
    tr.appendChild(nameTd);

    const rowAllTd = document.createElement("td");
    const rowCb = document.createElement("input");
    rowCb.type = "checkbox";
    rowCb.setAttribute("data-row-toggle", slug);
    rowCb.title = "Toggle all for " + meta.name;
    rowAllTd.appendChild(rowCb);
    tr.appendChild(rowAllTd);

    let rowTotal = 0;
    let rowChecked = 0;

    // When no price data is available (e.g. file:// or before first sync),
    // treat all vendor combos as available so checkboxes are enabled.
    const hasAnyData = available.length > 0;

    vendors.forEach((v) => {
      const td = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      const hasData = !hasAnyData || available.indexOf(v.id) !== -1;
      if (!hasData) {
        cb.disabled = true;
        cb.checked = false;
      } else {
        cb.setAttribute("data-slug", slug);
        cb.setAttribute("data-vendor", v.id);
        const isEnabled =
          typeof _isMarketItemEnabled === "function" ? _isMarketItemEnabled(slug, v.id) : true;
        cb.checked = isEnabled;
        rowTotal++;
        if (isEnabled) rowChecked++;
      }
      td.appendChild(cb);
      tr.appendChild(td);
    });

    // Set row toggle state
    rowCb.checked = rowTotal > 0 && rowChecked === rowTotal;
    rowCb.indeterminate = rowChecked > 0 && rowChecked < rowTotal;
    if (rowTotal === 0) rowCb.disabled = true;

    tbody.appendChild(tr);
  });

  // --- Determine visible slugs for ALL row toggle scoping ---
  const activePillEl = document.querySelector("#marketFilterMetalPills .market-filter-pill.active");
  const activeMetalFilter = activePillEl ? activePillEl.getAttribute("data-metal") : "all";
  const visibleSlugs =
    activeMetalFilter === "all"
      ? displaySlugs
      : displaySlugs.filter((s) => {
          const m =
            typeof getRetailCoinMeta === "function" ? getRetailCoinMeta(s) : { metal: "unknown" };
          return (m.metal || "").toLowerCase() === activeMetalFilter;
        });

  // --- Sync column toggle states (scoped to visible slugs) ---
  const anySlugHasData = visibleSlugs.some((s) => _getAvailableVendorsForSlug(s).length > 0);
  vendors.forEach((v) => {
    const colCb = tbody.querySelector(`input[data-col-toggle="${v.id}"]`);
    if (!colCb) return;
    let colTotal = 0;
    let colChecked = 0;
    visibleSlugs.forEach((slug) => {
      const available = _getAvailableVendorsForSlug(slug);
      const isAvailable = !anySlugHasData || available.indexOf(v.id) !== -1;
      if (isAvailable) {
        colTotal++;
        if (typeof _isMarketItemEnabled === "function" && _isMarketItemEnabled(slug, v.id))
          colChecked++;
      }
    });
    colCb.checked = colTotal > 0 && colChecked === colTotal;
    colCb.indeterminate = colChecked > 0 && colChecked < colTotal;
    if (colTotal === 0) {
      colCb.disabled = true;
      colCb.checked = false;
    }
  });

  // --- Sync master toggle (scoped to visible slugs) ---
  let grandTotal = 0;
  let grandChecked = 0;
  visibleSlugs.forEach((slug) => {
    const available = _getAvailableVendorsForSlug(slug);
    const hasAny = available.length > 0;
    if (hasAny) {
      available.forEach((vid) => {
        grandTotal++;
        if (typeof _isMarketItemEnabled === "function" && _isMarketItemEnabled(slug, vid))
          grandChecked++;
      });
    } else {
      // No price data — count all vendors as available
      vendors.forEach((v) => {
        grandTotal++;
        if (typeof _isMarketItemEnabled === "function" && _isMarketItemEnabled(slug, v.id))
          grandChecked++;
      });
    }
  });
  masterCb.checked = grandTotal > 0 && grandChecked === grandTotal;
  masterCb.indeterminate = grandChecked > 0 && grandChecked < grandTotal;

  // --- Status line ---
  const activeVendors = {};
  displaySlugs.forEach((slug) => {
    const available = _getAvailableVendorsForSlug(slug);
    const effective = available.length > 0 ? available : vendors.map((v) => v.id);
    effective.forEach((vid) => {
      if (typeof _isMarketItemEnabled === "function" && _isMarketItemEnabled(slug, vid)) {
        activeVendors[vid] = true;
      }
    });
  });
  const enabledCount = grandChecked;
  const activeVendorCount = Object.keys(activeVendors).length;
  const totalVendors = vendors.length;
  if (statusEl) {
    statusEl.textContent =
      "Showing " +
      enabledCount +
      " items \u00b7 " +
      activeVendorCount +
      " of " +
      totalVendors +
      " vendors active";
  }

  // Re-apply active metal pill filter after re-render
  if (activeMetalFilter !== "all") {
    const rows = tbody.querySelectorAll("tr");
    let visibleProductCount = 0;
    rows.forEach((row) => {
      if (row.classList.contains("mfm-all-row")) return;
      const rowMetal = row.getAttribute("data-metal");
      if (rowMetal && rowMetal !== activeMetalFilter) {
        row.style.display = "none";
      } else {
        visibleProductCount++;
      }
    });
    if (statusEl) {
      statusEl.textContent =
        "Showing " +
        visibleProductCount +
        (visibleProductCount === 1 ? " product" : " products") +
        " \u00b7 " +
        activeVendorCount +
        " of " +
        totalVendors +
        (totalVendors === 1 ? " vendor" : " vendors") +
        " active";
    }
  }
};

// Expose globally
if (typeof window !== "undefined") {
  window.showSettingsModal = showSettingsModal;
  window.hideSettingsModal = hideSettingsModal;
  window.switchSettingsSection = switchSettingsSection;
  window.switchSpotProvider = switchSpotProvider;
  window.renderInlineChipConfigTable = renderInlineChipConfigTable;
  window.renderFilterChipCategoryTable = renderFilterChipCategoryTable;
  window.renderLayoutSectionConfigTable = renderLayoutSectionConfigTable;
  window.renderLayoutTabConfigTable = renderLayoutTabConfigTable;
  window.saveLayoutTabConfig = saveLayoutTabConfig;
  window.syncGoldbackSettingsUI = syncGoldbackSettingsUI;
  window.syncCurrencySettingsUI = syncCurrencySettingsUI;
  window.syncHeaderToggleUI = syncHeaderToggleUI;
  window.syncLayoutVisibilityUI = syncLayoutVisibilityUI;
  window.renderCustomRuleTable = renderCustomRuleTable;
  window.populateImagesSection = populateImagesSection;
  window.renderStorageSection = renderStorageSection;
  window.renderNumistaTagSettings = renderNumistaTagSettings;
  window.renderMarketFilterMatrix = renderMarketFilterMatrix;
}

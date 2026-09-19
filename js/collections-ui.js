// COLLECTIONS UI (STRK-368, epic STRK-254)
// =============================================================================
// Renders the Collections tab into #collectionsSectionEl: a HUB of every Series
// Template plus the user's Custom Collections, and an in-page ALBUM for one of
// them. One device-local preference (COLLECTIONS_VIEW_MODE_KEY) flips BOTH levels
// between "album" (hub cards + slot tiles) and "ledger" (hub table + slot rows).
//
// The URL is the single source of truth for WHICH view shows: "#/collections" is
// the hub and "#/collections/<id>" an album. js/tabs.js parses the route and calls
// render() on activation and on every sub-route change, so Back/Forward, deep
// links and reloads all take the same path as a click.
//
// RULES THIS FILE KEEPS
//   - Talks only to window.collectionsStore / window.collectionsCore — never to
//     storage or to collection state directly.
//   - DOM is built with createElement + textContent. Item names and custom
//     collection names, labels and notes are user text and never reach innerHTML;
//     innerHTML is used for the static inline SVG icons only.
//   - Rendering is synchronous. Item photos resolve afterwards; every blob: URL
//     created is tracked and revoked on the next render (precedent:
//     _viewModalObjectUrls in js/viewModal.js). A render generation stops a slow
//     lookup from painting into — or leaking a URL for — a view that has moved on.
//   - Nothing paints before "app:listeners-ready": until then the inventory is not
//     hydrated (every slot would read as missing) and the controls this UI
//     delegates to (#newItemBtn, the item view modal) are not wired (STRK-294).
//   - The link picker + builder are a separate slice behind window.collectionsPicker;
//     until it loads those actions toast instead of throwing.
//
// MUST load after collections-store.js and before tabs.js.
// =============================================================================

(() => {
  "use strict";

  const ROOT_ID = "collectionsSectionEl";
  const TAB_VIEW_ID = "tabViewCollections";
  const HUB_HASH = "#/collections";
  const READY_EVENT = "app:listeners-ready";
  const CHANGED_EVENT_FALLBACK = "collections:changed";

  /** Route ids the router accepts: a template slug or "custom-<uuid>". */
  const ID_PATTERN = /^[a-z0-9-]+$/;

  const VIEW_ALBUM = "album";
  const VIEW_LEDGER = "ledger";
  const VIEW_MODES = [VIEW_ALBUM, VIEW_LEDGER];

  const STATUS_ALL = "all";
  const STATUS_PROGRESS = "progress";
  const STATUS_NOT_STARTED = "notstarted";
  const STATUS_COMPLETE = "complete";

  const SLOTS_ALL = "all";
  const SLOTS_OWNED = "owned";
  const SLOTS_MISSING = "missing";

  const SORT_OLDEST = "oldest";
  const SORT_NEWEST = "newest";

  const PICKER_FALLBACK_MESSAGE = "Coming in the next build";
  const DASH = "—";
  const PERCENT = 100;
  const MONOGRAM_MAX_LETTERS = 2;

  /** Gap between a slot button and its action menu, and the menu's viewport margin (px). */
  const MENU_OFFSET_PX = 6;
  const MENU_MARGIN_PX = 8;

  /** Modals that can change an Item in place; closing one refreshes the open view. */
  const REFRESH_ON_CLOSE_MODAL_IDS = ["itemModal", "viewItemModal"];

  /** Static developer markup — the only innerHTML this file ever assigns. */
  const ICON_PATHS = Object.freeze({
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    unlink:
      '<path d="m18.8 12.2 1.7-1.7a5 5 0 0 0-7-7l-1.7 1.7M5.2 11.8l-1.7 1.7a5 5 0 0 0 7 7l1.7-1.7M2 2l20 20"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    swap: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash:
      '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  });

  // ---------------------------------------------------------------------------
  // Module state — transient UI state only; nothing here is persisted
  // ---------------------------------------------------------------------------

  let hubFilter = STATUS_ALL;
  let albumFilter = SLOTS_ALL;
  let albumSort = SORT_OLDEST;

  /** Route shown by the last render ("" = hub); a change resets the slot filter. */
  let lastRouteId = null;

  /** Bumped on every render so stale async image work can recognise itself. */
  let renderGeneration = 0;

  /** blob: URLs created for the current render; revoked on the next one. */
  let objectUrls = [];

  /** The open slot action menu, or null. */
  let activeMenu = null;

  /** Guards the async Remove confirmation against a double click. */
  let removeInFlight = false;

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  /**
   * The storage + inventory seam (window.collectionsStore).
   * @returns {Object} Store API
   */
  const store = () => window.collectionsStore;

  /**
   * The pure data layer (window.collectionsCore).
   * @returns {Object} Core API
   */
  const core = () => window.collectionsCore;

  /**
   * Coerces a value to a trimmed string ("" for null/undefined).
   * @param {*} value - Value to coerce
   * @returns {string} Trimmed string
   */
  const text = (value) => String(value == null ? "" : value).trim();

  /**
   * Creates an element with an optional class list and text content.
   * @param {string} tag - Tag name
   * @param {string} [className] - Space-separated classes
   * @param {string} [content] - Text content (never parsed as HTML)
   * @returns {HTMLElement} The new element
   */
  const el = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null && content !== "") node.textContent = String(content);
    return node;
  };

  /**
   * Creates a <button type="button"> with a click handler.
   * @param {string} className - Space-separated classes
   * @param {string} focusKey - Stable key used to restore focus across a re-render
   * @param {(event: MouseEvent) => void} onClick - Click handler
   * @returns {HTMLButtonElement} The button
   */
  const button = (className, focusKey, onClick) => {
    const node = el("button", className);
    node.type = "button";
    node.dataset.focusKey = focusKey;
    node.addEventListener("click", onClick);
    return node;
  };

  /**
   * Builds an inline SVG icon from the static ICON_PATHS table.
   * @param {string} name - Key of ICON_PATHS
   * @returns {HTMLElement} A span wrapping the icon, hidden from assistive tech
   */
  const icon = (name) => {
    const wrap = el("span", "collections-icon");
    wrap.setAttribute("aria-hidden", "true");
    // Static developer markup only — ICON_PATHS is a frozen literal, never user text.
    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
    wrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">${ICON_PATHS[name] || ""}</svg>`;
    return wrap;
  };

  /**
   * Formats a USD amount in the user's display currency.
   * @param {number} value - Amount in USD
   * @returns {string} Formatted amount
   */
  const money = (value) =>
    typeof formatCurrency === "function" ? formatCurrency(value) : `$${Number(value).toFixed(2)}`;

  /**
   * Shows a toast when the toast helper is available.
   * @param {string} message - Text to show
   * @returns {void}
   */
  const toast = (message) => {
    if (typeof window.showToast === "function") window.showToast(message);
  };

  /**
   * Whether the COLLECTIONS feature flag is on.
   * @returns {boolean} True when the module should render
   */
  const isEnabled = () =>
    typeof featureFlags !== "undefined" && featureFlags.isEnabled("COLLECTIONS");

  /**
   * Whether boot has finished: inventory hydrated, listeners wired (STRK-294).
   * @returns {boolean} True once the app has signalled readiness
   */
  const isAppReady = () => window.appListenersReady === true;

  /**
   * Whether the Collections panel is the visible tab. A hidden panel is never
   * rendered: tab activation always re-renders, so nothing is lost by skipping.
   * @returns {boolean} True when the panel is showing
   */
  const isTabActive = () => {
    const view = document.getElementById(TAB_VIEW_ID);
    return Boolean(view && view.classList.contains("active"));
  };

  /**
   * Whether slot actions that add or link Items may be offered. While the inventory
   * recovery hold is up, an add would silently clear it before the user has read the
   * warning (coding-standards: recovery-state guard for mutation actions).
   * @returns {boolean} False while the recovery banner is active
   */
  const canMutate = () =>
    !(typeof isInventoryRecoveryActive === "function" && isInventoryRecoveryActive());

  // ---------------------------------------------------------------------------
  // View mode — one persisted, device-local preference for both levels
  // ---------------------------------------------------------------------------

  /**
   * The persisted view mode.
   * @returns {"album"|"ledger"} Current mode; "album" when unset or unreadable
   */
  const getViewMode = () => {
    const stored =
      typeof loadDataSync === "function"
        ? loadDataSync(COLLECTIONS_VIEW_MODE_KEY, VIEW_ALBUM)
        : VIEW_ALBUM;
    return VIEW_MODES.includes(stored) ? stored : VIEW_ALBUM;
  };

  /**
   * Persists the view mode and re-renders. Invalid values are ignored.
   * @param {"album"|"ledger"} mode - Mode to switch to
   * @returns {void}
   */
  const setViewMode = (mode) => {
    if (!VIEW_MODES.includes(mode)) return;
    try {
      // saveDataSync re-throws on quota errors; the toggle still applies for this render.
      saveDataSync(COLLECTIONS_VIEW_MODE_KEY, mode);
    } catch (error) {
      console.warn("[collections] Failed to save the view mode:", error);
    }
    render();
  };

  // ---------------------------------------------------------------------------
  // Money — per unit, because a slot holds ONE coin even when the Item row is a lot
  // ---------------------------------------------------------------------------

  /**
   * Current spot price for a metal name.
   * @param {string} metal - Metal name (e.g. "Silver")
   * @returns {number} Spot price, or 0 when unknown
   */
  const spotFor = (metal) => {
    if (typeof spotPrices === "undefined" || !spotPrices) return 0;
    const value = Number(spotPrices[text(metal).toLowerCase()]);
    return Number.isFinite(value) && value > 0 ? value : 0;
  };

  /**
   * An Item's quantity as a positive number.
   * @param {Object} item - Inventory item
   * @returns {number} Quantity, at least 1
   */
  const quantityOf = (item) => {
    const qty = Number(item.qty);
    return Number.isFinite(qty) && qty > 0 ? qty : 1;
  };

  /**
   * Per-unit purchase price. item.price is already stored per unit.
   * @param {Object} item - Inventory item
   * @returns {number} Price paid for one unit
   */
  const unitPaid = (item) => parseFloat(item.price) || 0;

  /**
   * Per-unit melt value through the app's canonical helper (computeMeltValue in
   * js/utils.js owns purity, the gb/sb denomination conversion and constitutional
   * silver). It is qty-folded, so one unit is its result divided by the quantity —
   * the same derivation the item view modal uses.
   * @param {Object} item - Inventory item
   * @returns {number} Melt value of one unit, or 0 when no spot price is loaded
   */
  const unitMelt = (item) => {
    const spot = spotFor(item.metal);
    if (!spot || typeof computeMeltValue !== "function") return 0;
    const melt = computeMeltValue(item, spot) / quantityOf(item);
    return Number.isFinite(melt) ? melt : 0;
  };

  /**
   * Best current in-stock vendor price for a retail slug — the SAME derivation as the
   * Best Price Ticker (js/market-data.js): _getRetailCoins() for the cached feed,
   * _findCheapestTickerVendor() for the winner (fresh v2 detail preferred, user-hidden
   * vendors and out-of-stock listings skipped), _shortVendor() for the label.
   * @param {string} slug - Retail slug from the Series Template
   * @returns {{price: number, vendor: string}|null} Best price, or null when unavailable
   */
  const findBestVendorPrice = (slug) => {
    if (!slug) return null;
    if (typeof _getRetailCoins !== "function" || typeof _findCheapestTickerVendor !== "function")
      return null;
    try {
      const coins = _getRetailCoins() || {};
      const coin = Object.prototype.hasOwnProperty.call(coins, slug) ? coins[slug] : null;
      if (!coin || !coin.vendors) return null;
      const best = _findCheapestTickerVendor(coin, slug);
      if (!best.bestVid || !Number.isFinite(best.bestPrice)) return null;
      const vendor = typeof _shortVendor === "function" ? _shortVendor(best.bestVid) : best.bestVid;
      return { price: best.bestPrice, vendor };
    } catch (error) {
      debugLog(`[collections] Best vendor price unavailable for ${slug}: ${error.message}`, "warn");
      return null;
    }
  };

  // ---------------------------------------------------------------------------
  // View models
  // ---------------------------------------------------------------------------

  /**
   * "2021 – present" style run label for a Series Template.
   * @param {{start?: number, end?: number|null}} [run] - Template run
   * @returns {string} Run label, or "" when the template has none
   */
  const runLabel = (run) => {
    if (!run || run.start == null) return "";
    return `${run.start} – ${run.end == null ? "present" : run.end}`;
  };

  /**
   * Up to two initials for a collection's monogram medallion.
   * @param {string} name - Collection name
   * @returns {string} Upper-case initials, or "?" for an empty name
   */
  const monogramOf = (name) => {
    const letters = text(name)
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .slice(0, MONOGRAM_MAX_LETTERS)
      .map((word) => word.charAt(0).toUpperCase())
      .join("");
    return letters || "?";
  };

  /**
   * Stock image URL for one side of a Series Template.
   * @param {Object|null} template - Series Template
   * @param {"obverse"|"reverse"} side - Coin side
   * @returns {string} Relative URL, or "" when the template has no image
   */
  const stockImage = (template, side) => {
    const file = template && template.images ? text(template.images[side]) : "";
    return file ? `${text(template.basePath)}${file}` : "";
  };

  /**
   * Status bucket for the hub filter.
   * @param {{owned: number, total: number}} progress - Collection progress
   * @returns {"notstarted"|"complete"|"progress"} Status
   */
  const statusOf = (progress) => {
    if (progress.owned === 0) return STATUS_NOT_STARTED;
    return progress.owned === progress.total ? STATUS_COMPLETE : STATUS_PROGRESS;
  };

  /**
   * Builds the view model for one collection. A Series Template that has not been
   * started has no stored record yet (the store creates it on the first link), so it
   * is described through a blank stand-in.
   * @param {string} id - Collection id
   * @param {Object|null} live - Stored collection, or null for a not-started template
   * @param {Object|null} template - Series Template, or null for a Custom Collection
   * @param {(slug: string) => Object|null} bestPriceFor - Memoized best-price lookup
   * @returns {Object} Entry view model
   */
  const describeEntry = (id, live, template, bestPriceFor) => {
    const collection = live || {
      id,
      kind: "template",
      templateSlug: id,
      name: "",
      definition: null,
      slots: Object.create(null),
    };
    const isCustom = collection.kind === "custom";
    const definition = collection.definition || {};
    const slotDefs = core().slotDefsFor(collection, template);
    const progress = core().collectionProgress(collection, slotDefs, store().isActiveUuid);
    let paid = 0;
    let melt = 0;
    slotDefs.forEach((def) => {
      const primary = store().resolveSlot(collection, def.id).primary;
      const item = primary ? store().findItem(primary) : null;
      if (!item) return;
      paid += unitPaid(item);
      melt += unitMelt(item);
    });
    const best = template ? bestPriceFor(text(template.retailSlug)) : null;
    const name = isCustom ? text(collection.name) : text(template && template.name);
    const variant = isCustom ? "" : text(template && template.variant);
    const hubParts = isCustom
      ? ["Custom collection", `${slotDefs.length} slot${slotDefs.length === 1 ? "" : "s"}`]
      : [variant, text(template.subtitle), runLabel(template.run)];
    return {
      id,
      collection,
      template,
      isCustom,
      name: name || id,
      variant,
      hubLine: hubParts.filter(Boolean).join(" · "),
      metal: isCustom ? text(definition.metal) : text(template && template.metal),
      slotDefs,
      progress,
      status: statusOf(progress),
      paid,
      melt,
      best,
      costToComplete: best && progress.missing > 0 ? best.price * progress.missing : null,
      obverse: stockImage(template, "obverse"),
      reverse: stockImage(template, "reverse"),
      monogram: monogramOf(name || id),
    };
  };

  /**
   * Every collection the hub lists: each Series Template (started or not), then the
   * user's Custom Collections, oldest first. Only real data — no demo entries.
   * @returns {Object[]} Entry view models
   */
  const buildEntries = () => {
    const priceCache = Object.create(null);
    /**
     * Best vendor price per retail slug, looked up once per render.
     * @param {string} slug - Retail slug
     * @returns {{price: number, vendor: string}|null} Best price, or null
     */
    const bestPriceFor = (slug) => {
      if (!slug) return null;
      if (!(slug in priceCache)) priceCache[slug] = findBestVendorPrice(slug);
      return priceCache[slug];
    };
    const live = core().listCollections(store().getState());
    const templates = store().getTemplates();
    const entries = Object.keys(templates).map((slug) =>
      describeEntry(
        slug,
        live.find((collection) => collection.id === slug && collection.kind === "template") || null,
        templates[slug],
        bestPriceFor
      )
    );
    live
      .filter((collection) => collection.kind === "custom")
      .forEach((collection) => {
        entries.push(describeEntry(collection.id, collection, null, bestPriceFor));
      });
    return entries;
  };

  /**
   * Mintage line for a slot tile.
   * @param {Object} def - Slot definition
   * @returns {string} "14,968,500 minted", "In production", or ""
   */
  const mintageLine = (def) => {
    if (typeof def.mintage === "number") return `${def.mintage.toLocaleString("en-US")} minted`;
    return def.mintageStatus === "in-production" ? "In production" : "";
  };

  /**
   * Mintage cell for a ledger row.
   * @param {Object} def - Slot definition
   * @returns {string} "14,968,500", "In production", or an em dash
   */
  const mintageCell = (def) => {
    if (typeof def.mintage === "number") return def.mintage.toLocaleString("en-US");
    return def.mintageStatus === "in-production" ? "In production" : DASH;
  };

  /**
   * Every Item UUID already linked anywhere in a collection (primaries and spares).
   * @param {Object} collection - Collection record
   * @returns {Set<string>} Linked UUIDs
   */
  const linkedUuids = (collection) => {
    const linked = new Set();
    Object.keys(collection.slots).forEach((slotId) => {
      const link = collection.slots[slotId];
      [link.primary, ...(link.spares || [])].filter(Boolean).forEach((uuid) => linked.add(uuid));
    });
    return linked;
  };

  /**
   * Builds the slot view models for an album, filtered and sorted for display.
   * Name matching only ever SUGGESTS — it never links anything.
   * @param {Object} entry - Entry view model
   * @returns {{slots: Object[], owned: number, missing: number}} Visible slots + counts
   */
  const describeSlots = (entry) => {
    const excludeUuids = linkedUuids(entry.collection);
    const candidates = entry.template ? store().activeItems() : [];
    const normalizeName = window.autocomplete ? window.autocomplete.normalizeItemName : undefined;
    const all = entry.slotDefs.map((def) => {
      const resolved = store().resolveSlot(entry.collection, def.id);
      const item = resolved.primary ? store().findItem(resolved.primary) : null;
      const matches =
        !item && entry.template
          ? core().suggestItemsForSlot(entry.template, def, candidates, {
              normalizeName,
              excludeUuids,
            }).length
          : 0;
      return {
        def,
        item,
        spares: item ? resolved.spares : [],
        matches,
        label: text(def.label) || text(def.year) || def.id,
        tag: text(def.tag),
        note: text(def.note),
      };
    });
    const owned = all.filter((slot) => slot.item).length;
    let slots = all;
    if (albumFilter === SLOTS_OWNED) slots = all.filter((slot) => slot.item);
    if (albumFilter === SLOTS_MISSING) slots = all.filter((slot) => !slot.item);
    if (albumSort === SORT_NEWEST) slots = slots.slice().reverse();
    return { slots, owned, missing: all.length - owned };
  };

  // ---------------------------------------------------------------------------
  // Navigation — the hash is the source of truth; tabs.js calls render() on change
  // ---------------------------------------------------------------------------

  /**
   * The collection id in the URL, or "" for the hub.
   * @returns {string} Sub-route id
   */
  const currentRouteId = () =>
    typeof window.getTabSubRoute === "function" ? window.getTabSubRoute() : "";

  /**
   * Moves to a hash. An unchanged hash fires no hashchange, so render directly.
   * @param {string} hash - Target hash
   * @returns {void}
   */
  const navigate = (hash) => {
    if (window.location.hash === hash) {
      render();
      return;
    }
    window.location.hash = hash;
  };

  /**
   * Opens a collection's album in-page (sets "#/collections/<id>").
   * @param {string} collectionId - Template slug or custom collection id
   * @returns {void}
   */
  const openCollection = (collectionId) => {
    if (typeof collectionId !== "string" || !ID_PATTERN.test(collectionId)) return;
    navigate(`${HUB_HASH}/${collectionId}`);
  };

  /**
   * Returns to the hub (sets "#/collections").
   * @returns {void}
   */
  const showHub = () => navigate(HUB_HASH);

  // ---------------------------------------------------------------------------
  // Picker / builder seam (follow-up slice)
  // ---------------------------------------------------------------------------

  /**
   * Calls the link picker / builder module when it is loaded; toasts otherwise.
   * @param {"openLinkPicker"|"openBuilder"} method - Seam method
   * @param {Object} payload - Arguments for the seam
   * @returns {void}
   */
  const callPicker = (method, payload) => {
    const picker = window.collectionsPicker;
    if (picker && typeof picker[method] === "function") {
      picker[method](payload);
      return;
    }
    toast(PICKER_FALLBACK_MESSAGE);
  };

  // ---------------------------------------------------------------------------
  // Slot action menu — one floating menu, anchored to the button that opened it
  // ---------------------------------------------------------------------------

  /**
   * Closes the open action menu, if any.
   * @param {boolean} [restoreFocus=false] - Return focus to the anchor (keyboard close)
   * @returns {void}
   */
  const closeMenu = (restoreFocus = false) => {
    if (!activeMenu) return;
    const { element, anchor, onPointerDown, onKeyDown } = activeMenu;
    activeMenu = null;
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    element.remove();
    anchor.setAttribute("aria-expanded", "false");
    if (restoreFocus && anchor.isConnected) anchor.focus();
  };

  /**
   * Places the menu under its anchor, flipped above when it would leave the viewport
   * and clamped horizontally so it can never widen the page on a phone.
   * @param {HTMLElement} menu - Menu element (already in the document)
   * @param {HTMLElement} anchor - Button that opened it
   * @returns {void}
   */
  const positionMenu = (menu, anchor) => {
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const maxLeft = viewportWidth - menu.offsetWidth - MENU_MARGIN_PX;
    const left = Math.max(MENU_MARGIN_PX, Math.min(rect.left, maxLeft));
    const below = rect.bottom + MENU_OFFSET_PX;
    const above = rect.top - MENU_OFFSET_PX - menu.offsetHeight;
    const top = below + menu.offsetHeight > viewportHeight && above >= 0 ? above : below;
    menu.style.left = `${left + window.scrollX}px`;
    menu.style.top = `${top + window.scrollY}px`;
  };

  /**
   * Builds one menu entry.
   * @param {{label: string, hint?: string, icon: string, danger?: boolean, onSelect: Function}} spec - Entry
   * @returns {HTMLButtonElement} The menu item
   */
  const buildMenuItem = (spec) => {
    const item = el(
      "button",
      spec.danger ? "collections-menu-item is-danger" : "collections-menu-item"
    );
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.appendChild(icon(spec.icon));
    const body = el("span", "collections-menu-text", spec.label);
    if (spec.hint) body.appendChild(el("small", "", spec.hint));
    item.appendChild(body);
    item.addEventListener("click", () => {
      closeMenu();
      spec.onSelect();
    });
    return item;
  };

  /**
   * Moves focus between menu items with the arrow keys, Home and End.
   * @param {HTMLElement} menu - Menu element
   * @param {KeyboardEvent} event - Key event
   * @returns {void}
   */
  const moveMenuFocus = (menu, event) => {
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    let next = null;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    items[next].focus();
  };

  /**
   * Opens an action menu anchored to a button. Clicking the same button again, a
   * pointer press outside, Escape, or any re-render closes it.
   * @param {HTMLElement} anchor - Button that owns the menu
   * @param {string} label - Accessible name for the menu
   * @param {Array<Object>} entries - Items ({label, icon, onSelect, ...}) and {heading} rows
   * @returns {void}
   */
  const openMenu = (anchor, label, entries) => {
    const wasOpenHere = activeMenu && activeMenu.anchor === anchor;
    closeMenu();
    if (wasOpenHere) return;

    const menu = el("div", "collections-menu");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", label);
    entries.forEach((entry) => {
      menu.appendChild(
        entry.heading ? el("div", "collections-menu-heading", entry.heading) : buildMenuItem(entry)
      );
    });

    /**
     * Closes the menu on a pointer press anywhere outside it and its anchor.
     * @param {PointerEvent} event - Document-level pointer press
     * @returns {void}
     */
    const onPointerDown = (event) => {
      if (menu.contains(event.target) || anchor.contains(event.target)) return;
      closeMenu();
    };
    /**
     * Escape closes the menu (before any modal handler sees it); arrows move focus.
     * @param {KeyboardEvent} event - Document-level key press
     * @returns {void}
     */
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeMenu(true);
        return;
      }
      moveMenuFocus(menu, event);
    };

    document.body.appendChild(menu);
    positionMenu(menu, anchor);
    anchor.setAttribute("aria-expanded", "true");
    activeMenu = { element: menu, anchor, onPointerDown, onKeyDown };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    const first = menu.querySelector('[role="menuitem"]');
    if (first) first.focus();
  };

  // ---------------------------------------------------------------------------
  // Slot actions
  // ---------------------------------------------------------------------------

  /**
   * Opens the item view modal for a linked Item.
   * @param {string} uuid - Item UUID
   * @returns {void}
   */
  const viewItem = (uuid) => {
    if (typeof inventory === "undefined" || !Array.isArray(inventory)) return;
    const index = inventory.findIndex((entry) => entry && entry.uuid === uuid);
    if (index >= 0 && typeof showViewModal === "function") showViewModal(index);
  };

  /**
   * Opens the "+ Add" menu for a slot: link an Item that exists, or add a new one.
   * @param {HTMLElement} anchor - Button that owns the menu
   * @param {Object} entry - Entry view model
   * @param {Object} slot - Slot view model
   * @param {boolean} asSpare - Add behind the current primary instead of filling the slot
   * @returns {void}
   */
  const openAddMenu = (anchor, entry, slot, asSpare) => {
    const request = { collectionId: entry.id, slotId: slot.def.id, asSpare };
    openMenu(anchor, `${asSpare ? "Add a spare to" : "Fill"} the ${slot.label} slot`, [
      {
        label: "Link existing item",
        hint: "Pick from your inventory — matches first",
        icon: "link",
        onSelect: () => callPicker("openLinkPicker", request),
      },
      {
        label: "Add new item",
        hint: "Opens Add Item prefilled; links on save",
        icon: "plus",
        onSelect: () => {
          const result = store().requestNewItem(entry.id, slot.def.id, { asSpare });
          if (!result.ok) toast("Add Item could not be opened for this slot");
        },
      },
    ]);
  };

  /**
   * Unlinks an Item from a slot and says what happened — the Item itself is untouched.
   * @param {Object} entry - Entry view model
   * @param {Object} slot - Slot view model
   * @param {string} uuid - Item UUID to unlink
   * @returns {void}
   */
  const unlinkFromSlot = (entry, slot, uuid) => {
    const result = store().unlink(entry.id, slot.def.id, uuid);
    if (!result.ok) {
      toast("That item could not be unlinked");
      return;
    }
    toast(
      result.promoted
        ? "Unlinked — a spare moved up. The item stays in your inventory."
        : "Unlinked — the item stays in your inventory."
    );
  };

  /**
   * Opens the "more" menu for an owned slot: view, add a spare, unlink, and — when
   * spares exist — promote or unlink each one.
   * @param {HTMLElement} anchor - Button that owns the menu
   * @param {Object} entry - Entry view model
   * @param {Object} slot - Slot view model (slot.item is set)
   * @returns {void}
   */
  const openMoreMenu = (anchor, entry, slot) => {
    const entries = [{ label: "View item", icon: "eye", onSelect: () => viewItem(slot.item.uuid) }];
    if (slot.spares.length < core().MAX_SLOT_SPARES) {
      entries.push({
        label: "Add spare",
        hint: "A duplicate you also own",
        icon: "plus",
        // The menu that hosts this entry has just closed; reopen on the same anchor.
        onSelect: () => openAddMenu(anchor, entry, slot, true),
      });
    }
    entries.push({
      label: "Unlink item",
      hint: "The item stays in your inventory",
      icon: "unlink",
      danger: true,
      onSelect: () => unlinkFromSlot(entry, slot, slot.item.uuid),
    });
    slot.spares.forEach((uuid) => {
      const spare = store().findItem(uuid);
      entries.push({ heading: `Spare · ${spare ? text(spare.name) || "Untitled item" : uuid}` });
      entries.push({
        label: "Make primary",
        icon: "swap",
        onSelect: () => {
          if (!store().promote(entry.id, slot.def.id, uuid).ok)
            toast("That spare could not be promoted");
        },
      });
      entries.push({
        label: "Unlink spare",
        icon: "unlink",
        danger: true,
        onSelect: () => unlinkFromSlot(entry, slot, uuid),
      });
    });
    openMenu(anchor, `Actions for the ${slot.label} slot`, entries);
  };

  /**
   * Removes a Custom Collection after confirmation. Items are never touched.
   * @param {Object} entry - Entry view model
   * @returns {Promise<void>} Resolves when the dialog has been answered
   */
  const confirmRemoveCollection = async (entry) => {
    if (removeInFlight) return;
    removeInFlight = true;
    try {
      const confirmed =
        typeof window.showAppConfirm === "function"
          ? await window.showAppConfirm(
              `Remove "${entry.name}"? Its slots and links are removed. The items stay in your inventory.`,
              "Remove collection"
            )
          : false;
      if (!confirmed) return;
      const result = store().remove(entry.id);
      if (!result.ok) {
        toast("That collection could not be removed");
        return;
      }
      showHub();
    } finally {
      removeInFlight = false;
    }
  };

  // ---------------------------------------------------------------------------
  // Shared builders
  // ---------------------------------------------------------------------------

  /**
   * Coin medallion: a stock / item photo, or a monogram when there is no image.
   * @param {{src?: string, monogram?: string, ghost?: boolean, owned?: boolean, size?: string,
   *   itemUuid?: string, artwork?: {collectionId: string, slotId?: string}}} spec - Medallion spec.
   *   itemUuid marks it for the async item-photo pass; artwork for custom collection art.
   * @returns {HTMLElement} The medallion
   */
  const buildCoin = (spec) => {
    const coin = el("span", "collections-coin");
    if (spec.size) coin.classList.add(`collections-coin--${spec.size}`);
    if (spec.ghost) coin.classList.add("collections-coin--ghost");
    if (spec.owned) coin.classList.add("collections-coin--owned");
    if (spec.itemUuid) coin.dataset.itemUuid = spec.itemUuid;
    if (spec.artwork) {
      coin.dataset.artCollection = spec.artwork.collectionId;
      if (spec.artwork.slotId) coin.dataset.artSlot = spec.artwork.slotId;
    }
    coin.dataset.monogram = spec.monogram || "?";
    if (spec.src) {
      const image = el("img");
      image.alt = "";
      image.loading = "lazy";
      image.src = spec.src;
      coin.dataset.stockSrc = spec.src;
      coin.appendChild(image);
    } else {
      coin.classList.add("collections-coin--mono");
      coin.textContent = coin.dataset.monogram;
    }
    return coin;
  };

  /**
   * Progress track: one span whose inline width is the percent.
   * @param {{pct: number, owned: number, total: number}} progress - Collection progress
   * @returns {HTMLElement} The track
   */
  const buildProgress = (progress) => {
    const track = el("span", "collections-progress");
    if (progress.total > 0 && progress.owned === progress.total) track.classList.add("is-complete");
    track.setAttribute("aria-hidden", "true");
    const bar = el("span");
    bar.style.width = `${progress.pct}%`;
    track.appendChild(bar);
    return track;
  };

  /**
   * "3 / 6" count with the owned figure emphasised.
   * @param {{owned: number, total: number}} progress - Collection progress
   * @returns {HTMLElement} The count
   */
  const buildCount = (progress) => {
    const count = el("span", "collections-count");
    count.appendChild(el("b", "", progress.owned));
    count.appendChild(document.createTextNode(` / ${progress.total}`));
    return count;
  };

  /**
   * Small uppercase tag (Custom, Complete, a slot's "T2", "+1 spare").
   * @param {string} label - Tag text
   * @param {string} [modifier] - Extra class (e.g. "is-done")
   * @returns {HTMLElement} The tag
   */
  const buildTag = (label, modifier) =>
    el("span", modifier ? `collections-tag ${modifier}` : "collections-tag", label);

  /**
   * One card of a stat strip.
   * @param {{label: string, value: string, unit?: string, note: string, accent?: boolean}} spec - Stat
   * @returns {HTMLElement} The stat card
   */
  const buildStat = (spec) => {
    const stat = el("div", spec.accent ? "collections-stat is-accent" : "collections-stat");
    stat.appendChild(el("div", "collections-stat-label", spec.label));
    const value = el("div", "collections-stat-value", spec.value);
    if (spec.unit) value.appendChild(el("small", "", ` ${spec.unit}`));
    stat.appendChild(value);
    stat.appendChild(el("div", "collections-stat-note", spec.note));
    return stat;
  };

  /**
   * A four-up stat strip.
   * @param {Object[]} stats - Stat specs for buildStat
   * @returns {HTMLElement} The strip
   */
  const buildStats = (stats) => {
    const strip = el("div", "collections-stats");
    stats.forEach((spec) => strip.appendChild(buildStat(spec)));
    return strip;
  };

  /**
   * Pill button (.btn / .btn.secondary) with an optional leading icon.
   * @param {{label: string, icon?: string, secondary?: boolean, danger?: boolean, focusKey: string,
   *   onClick: Function}} spec - Button spec
   * @returns {HTMLButtonElement} The button
   */
  const buildPillButton = (spec) => {
    const classes = ["btn", "collections-btn-pill"];
    if (spec.secondary) classes.push("secondary");
    if (spec.danger) classes.push("danger");
    const node = button(classes.join(" "), spec.focusKey, spec.onClick);
    if (spec.icon) node.appendChild(icon(spec.icon));
    node.appendChild(el("span", "", spec.label));
    return node;
  };

  /**
   * Segmented text control built on the app's .chip-sort-toggle.
   * @param {string} label - Accessible group label
   * @param {string} current - Selected value
   * @param {Array<[string, string]>} options - [value, label] pairs
   * @param {(value: string) => void} onChange - Called with the clicked value
   * @returns {HTMLElement} The control
   */
  const buildSegmented = (label, current, options, onChange) => {
    const group = el("div", "chip-sort-toggle");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    options.forEach(([value, optionLabel]) => {
      const node = button(
        value === current ? "chip-sort-btn active" : "chip-sort-btn",
        `${label}:${value}`,
        () => onChange(value)
      );
      node.textContent = optionLabel;
      node.setAttribute("aria-pressed", String(value === current));
      group.appendChild(node);
    });
    return group;
  };

  /**
   * The album / ledger view toggle shown in both toolbars.
   * @returns {HTMLElement} Icon segmented control
   */
  const buildViewToggle = () => {
    const mode = getViewMode();
    const group = el("div", "chip-sort-toggle collections-modetoggle");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "View mode");
    [
      [VIEW_ALBUM, "Album view", "grid"],
      [VIEW_LEDGER, "Ledger view", "list"],
    ].forEach(([value, label, iconName]) => {
      const node = button(
        value === mode
          ? "chip-sort-btn collections-iconbtn active"
          : "chip-sort-btn collections-iconbtn",
        `view:${value}`,
        () => setViewMode(value)
      );
      node.setAttribute("aria-label", label);
      node.setAttribute("aria-pressed", String(value === mode));
      node.title = label;
      node.appendChild(icon(iconName));
      group.appendChild(node);
    });
    return group;
  };

  /**
   * Centered message block built on the app's .empty-state.
   * @param {string} title - Heading
   * @param {string} body - Supporting copy
   * @returns {HTMLElement} The block
   */
  const buildEmptyState = (title, body) => {
    const block = el("div", "empty-state collections-emptystate");
    block.appendChild(el("h3", "", title));
    block.appendChild(el("p", "", body));
    return block;
  };

  /**
   * Cost-to-complete text for a stat or a table cell.
   * @param {number|null} cost - Estimated cost, or null when no vendor price is available
   * @returns {string} "≈ $206.34" or an em dash
   */
  const costLabel = (cost) => (cost ? `≈ ${money(cost)}` : DASH);

  // ---------------------------------------------------------------------------
  // Hub
  // ---------------------------------------------------------------------------

  /**
   * Hub header: title, BETA chip and the one-line explanation.
   * @returns {HTMLElement} Header block
   */
  const buildHubHeader = () => {
    const head = el("div", "collections-head");
    const titles = el("div");
    const heading = el("h2", "", "Collections");
    heading.appendChild(el("span", "collections-beta", "BETA"));
    titles.appendChild(heading);
    titles.appendChild(
      el(
        "p",
        "collections-sub",
        "Date runs and custom checklists, linked to the Items in your inventory."
      )
    );
    head.appendChild(titles);
    return head;
  };

  /**
   * Hub stat strip. "Active" means at least one slot is filled; value and cost are
   * summed over active collections only, so an untouched template adds no noise.
   * @param {Object[]} entries - Entry view models
   * @returns {HTMLElement} The strip
   */
  const buildHubStats = (entries) => {
    const active = entries.filter((entry) => entry.progress.owned > 0);
    /**
     * Sums one figure across the active collections.
     * @param {(entry: Object) => number} pick - Figure to read from each entry
     * @returns {number} Total
     */
    const sum = (pick) => active.reduce((total, entry) => total + pick(entry), 0);
    const filled = sum((entry) => entry.progress.owned);
    const total = sum((entry) => entry.progress.total);
    const paid = sum((entry) => entry.paid);
    const melt = sum((entry) => entry.melt);
    const cost = sum((entry) => entry.costToComplete || 0);
    const idle = entries.length - active.length;
    return buildStats([
      {
        label: "Collections",
        value: String(active.length),
        unit: "active",
        note: `${idle} not started`,
      },
      {
        label: "Slots filled",
        value: String(filled),
        unit: `/ ${total}`,
        note: `${total ? Math.round((filled / total) * PERCENT) : 0}% across active collections`,
      },
      {
        label: "Collected value",
        value: melt ? money(melt) : DASH,
        note: `melt · paid ${money(paid)}`,
      },
      {
        label: "Cost to complete",
        value: costLabel(cost),
        note: "floor est. · best vendor price today",
        accent: true,
      },
    ]);
  };

  /**
   * Hub toolbar: status filter, view toggle, New collection.
   * @returns {HTMLElement} The toolbar
   */
  const buildHubToolbar = () => {
    const toolbar = el("div", "collections-toolbar");
    const tabs = el("div", "vendor-prices-tabs");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Filter collections by status");
    [
      [STATUS_ALL, "All"],
      [STATUS_PROGRESS, "In progress"],
      [STATUS_NOT_STARTED, "Not started"],
      [STATUS_COMPLETE, "Complete"],
    ].forEach(([value, label]) => {
      const tab = button(value === hubFilter ? "active" : "", `hubfilter:${value}`, () => {
        hubFilter = value;
        render();
      });
      tab.textContent = label;
      tab.setAttribute("aria-pressed", String(value === hubFilter));
      tabs.appendChild(tab);
    });
    toolbar.appendChild(tabs);
    const right = el("div", "collections-toolbar-right");
    right.appendChild(buildViewToggle());
    right.appendChild(
      buildPillButton({
        label: "New collection",
        icon: "plus",
        focusKey: "hub:new",
        onClick: () => callPicker("openBuilder", {}),
      })
    );
    toolbar.appendChild(right);
    return toolbar;
  };

  /**
   * Name line for a hub entry: name plus its Custom / Complete tags.
   * @param {Object} entry - Entry view model
   * @param {string} className - Class for the wrapper
   * @returns {HTMLElement} The name line
   */
  const buildEntryName = (entry, className) => {
    const line = el("span", className);
    line.appendChild(el("b", "", entry.name));
    if (entry.isCustom) line.appendChild(buildTag("Custom"));
    if (entry.status === STATUS_COMPLETE) line.appendChild(buildTag("Complete", "is-done"));
    return line;
  };

  /**
   * Footer line of a hub card.
   * @param {Object} entry - Entry view model
   * @returns {string} Summary of what is left
   */
  const cardFootText = (entry) => {
    const { missing } = entry.progress;
    if (entry.status === STATUS_COMPLETE)
      return entry.melt ? `Set complete · ${money(entry.melt)} melt` : "Set complete";
    if (entry.costToComplete)
      return `${missing} missing ≈ ${money(entry.costToComplete)} to finish`;
    return `${missing} missing`;
  };

  /**
   * Medallion for a hub entry: the template's stock obverse (ghosted until started),
   * or a monogram for a Custom Collection (its own cover art resolves afterwards).
   * @param {Object} entry - Entry view model
   * @param {string} [size] - Medallion size modifier
   * @returns {HTMLElement} The medallion
   */
  const buildEntryCoin = (entry, size) =>
    buildCoin({
      src: entry.obverse,
      monogram: entry.monogram,
      ghost: entry.progress.owned === 0,
      size,
      artwork: entry.isCustom ? { collectionId: entry.id } : null,
    });

  /**
   * One hub card (album mode).
   * @param {Object} entry - Entry view model
   * @returns {HTMLButtonElement} The card
   */
  const buildHubCard = (entry) => {
    const card = button("collections-card", `open:${entry.id}`, () => openCollection(entry.id));
    card.dataset.collectionId = entry.id;
    card.appendChild(buildEntryCoin(entry));
    const body = el("span", "collections-card-body");
    body.appendChild(buildEntryName(entry, "collections-card-name"));
    body.appendChild(el("span", "collections-card-sub", entry.hubLine));
    const row = el("span", "collections-card-row");
    row.appendChild(buildCount(entry.progress));
    row.appendChild(el("span", "collections-pct", `${entry.progress.pct}%`));
    body.appendChild(row);
    body.appendChild(buildProgress(entry.progress));
    body.appendChild(el("span", "collections-card-foot", cardFootText(entry)));
    card.appendChild(body);
    return card;
  };

  /**
   * The dashed "New collection" card that closes the card grid.
   * @returns {HTMLButtonElement} The card
   */
  const buildNewCard = () => {
    const card = button("collections-card is-new", "hub:newcard", () =>
      callPicker("openBuilder", {})
    );
    card.appendChild(icon("plus"));
    card.appendChild(el("strong", "", "New collection"));
    card.appendChild(
      el("span", "", "Blank checklist, or clone a template and add varieties, mint marks, proofs…")
    );
    return card;
  };

  /**
   * One hub table row (ledger mode).
   * @param {Object} entry - Entry view model
   * @returns {HTMLButtonElement} The row
   */
  const buildHubRow = (entry) => {
    const row = button("collections-lrow collections-hubrow", `open:${entry.id}`, () =>
      openCollection(entry.id)
    );
    row.dataset.collectionId = entry.id;
    row.appendChild(buildEntryCoin(entry, "sm"));
    const name = buildEntryName(entry, "collections-lrow-name");
    name.appendChild(el("small", "", entry.hubLine));
    row.appendChild(name);
    const progress = el("span", "collections-hubrow-progress");
    progress.appendChild(buildProgress(entry.progress));
    const compact = el("span", "collections-show-sm");
    compact.appendChild(buildCount(entry.progress));
    progress.appendChild(compact);
    row.appendChild(progress);
    const owned = el("span", "collections-num collections-hide-sm");
    owned.appendChild(buildCount(entry.progress));
    row.appendChild(owned);
    row.appendChild(
      el("span", "collections-num collections-hide-sm", entry.melt ? money(entry.melt) : DASH)
    );
    row.appendChild(
      el("span", "collections-num collections-hide-sm", costLabel(entry.costToComplete))
    );
    const chevron = icon("chevron");
    chevron.classList.add("collections-hide-sm");
    row.appendChild(chevron);
    return row;
  };

  /**
   * Header row for a ledger table.
   * @param {string} className - Extra class selecting the column template
   * @param {Array<[string, string]>} columns - [label, extra classes] per column
   * @returns {HTMLElement} The header row
   */
  const buildLedgerHead = (className, columns) => {
    const head = el("div", `collections-lrow is-head ${className}`.trim());
    columns.forEach(([label, classes]) => head.appendChild(el("span", classes, label)));
    return head;
  };

  /**
   * Hub body: cards or a table, by view mode.
   * @param {Object[]} entries - Entry view models
   * @returns {HTMLElement} The body
   */
  const buildHubBody = (entries) => {
    const visible = entries.filter(
      (entry) => hubFilter === STATUS_ALL || entry.status === hubFilter
    );
    if (getViewMode() === VIEW_LEDGER) {
      if (!visible.length)
        return buildEmptyState("Nothing here yet", "No collections match this filter.");
      const table = el("div", "collections-ledger");
      table.appendChild(
        buildLedgerHead("collections-hubrow", [
          ["", ""],
          ["Collection", ""],
          ["Progress", ""],
          ["Owned", "collections-num"],
          ["Value (melt)", "collections-num"],
          ["To complete", "collections-num"],
          ["", ""],
        ])
      );
      visible.forEach((entry) => table.appendChild(buildHubRow(entry)));
      return table;
    }
    const grid = el("div", "collections-grid");
    visible.forEach((entry) => grid.appendChild(buildHubCard(entry)));
    if (hubFilter === STATUS_ALL || !visible.length) grid.appendChild(buildNewCard());
    return grid;
  };

  /**
   * The hub view.
   * @param {Object[]} entries - Entry view models
   * @returns {HTMLElement} Hub panel content
   */
  const buildHub = (entries) => {
    const hub = el("div", "collections-hub");
    hub.appendChild(buildHubHeader());
    // No first-run hero: an unstarted Series Template already shows as a ghosted 0 / N card
    // right below, so a "Start …" banner only repeated it. The stat strip appears once a
    // collection exists — before that every figure would be zero.
    const started = core().listCollections(store().getState()).length > 0;
    if (started) hub.appendChild(buildHubStats(entries));
    hub.appendChild(buildHubToolbar());
    hub.appendChild(buildHubBody(entries));
    return hub;
  };

  // ---------------------------------------------------------------------------
  // Album
  // ---------------------------------------------------------------------------

  /**
   * Spec line parts for an album header.
   * @param {Object} entry - Entry view model
   * @returns {string[]} Parts, e.g. ["1 oz", ".999 fine silver", "40.6 mm", "$1 face value"]
   */
  const specParts = (entry) => {
    if (entry.isCustom) return [entry.metal].filter(Boolean);
    const template = entry.template;
    const specs = template.specs || {};
    return [
      template.weight ? `${template.weight} ${text(template.weightUnit) || "oz"}` : "",
      text(specs.fineness),
      specs.diameterMm ? `${specs.diameterMm} mm` : "",
      specs.faceValue ? `${text(specs.faceValue)} face value` : "",
    ].filter(Boolean);
  };

  /**
   * Album header: coin pair (or monogram), titles, spec line, about text, progress ring.
   * @param {Object} entry - Entry view model
   * @returns {HTMLElement} The header
   */
  const buildAlbumHead = (entry) => {
    const head = el("div", "collections-album-head");
    const pair = el("div", "collections-pair");
    if (entry.obverse) {
      pair.appendChild(buildCoin({ src: entry.obverse, size: "lg" }));
      if (entry.reverse) pair.appendChild(buildCoin({ src: entry.reverse, size: "lg" }));
    } else {
      pair.appendChild(
        buildCoin({
          monogram: entry.monogram,
          size: "lg",
          artwork: entry.isCustom ? { collectionId: entry.id } : null,
        })
      );
    }
    head.appendChild(pair);

    const info = el("div", "collections-album-info");
    const heading = el("h2", "", entry.name);
    if (entry.variant) heading.appendChild(buildTag(entry.variant, "is-variant"));
    if (entry.isCustom) heading.appendChild(buildTag("Custom"));
    info.appendChild(heading);
    const definition = entry.collection.definition || {};
    const subParts = entry.isCustom
      ? [
          "Custom collection",
          `${entry.slotDefs.length} slot${entry.slotDefs.length === 1 ? "" : "s"}`,
        ]
      : [text(entry.template.subtitle), runLabel(entry.template.run), text(entry.template.issuer)];
    info.appendChild(el("p", "collections-sub", subParts.filter(Boolean).join(" · ")));
    const spec = el("div", "collections-spec");
    specParts(entry).forEach((part) => spec.appendChild(el("span", "", part)));
    if (spec.childElementCount) info.appendChild(spec);
    const about = entry.isCustom ? text(definition.description) : text(entry.template.about);
    if (about) info.appendChild(el("p", "collections-about", about));
    head.appendChild(info);

    const ring = el("div", "collections-ring");
    ring.style.setProperty("--collections-pct", String(entry.progress.pct));
    ring.setAttribute("role", "img");
    ring.setAttribute(
      "aria-label",
      `${entry.progress.pct}% complete: ${entry.progress.owned} of ${entry.progress.total}`
    );
    const ringBody = el("span");
    ringBody.appendChild(el("b", "", `${entry.progress.pct}%`));
    ringBody.appendChild(el("small", "", `${entry.progress.owned} of ${entry.progress.total}`));
    ring.appendChild(ringBody);
    head.appendChild(ring);
    return head;
  };

  /**
   * Album stat strip.
   * @param {Object} entry - Entry view model
   * @returns {HTMLElement} The strip
   */
  const buildAlbumStats = (entry) => {
    const { owned, total, missing } = entry.progress;
    const spot = spotFor(entry.metal);
    const spotNote = spot
      ? `${entry.metal.toLowerCase()} spot ${money(spot)}`
      : "per unit at today's spot";
    let costValue = costLabel(entry.costToComplete);
    if (!missing && total) costValue = "Done";
    return buildStats([
      {
        label: "Owned",
        value: String(owned),
        unit: `/ ${total}`,
        note: missing ? `${missing} still to find` : "every slot filled",
      },
      {
        label: "Paid",
        value: entry.paid ? money(entry.paid) : DASH,
        note: "primary items only · per unit",
      },
      { label: "Melt value", value: entry.melt ? money(entry.melt) : DASH, note: spotNote },
      {
        label: "Cost to complete",
        value: costValue,
        note: entry.best
          ? "floor est. · key dates carry premiums"
          : "floor est. · no vendor price available",
        accent: true,
      },
    ]);
  };

  /**
   * Album toolbar: slot filter, sort, view toggle, collection actions.
   * @param {Object} entry - Entry view model
   * @param {{owned: number, missing: number}} counts - Slot counts for the filter labels
   * @returns {HTMLElement} The toolbar
   */
  const buildAlbumToolbar = (entry, counts) => {
    const toolbar = el("div", "collections-toolbar");
    toolbar.appendChild(
      buildSegmented(
        "Filter slots",
        albumFilter,
        [
          [SLOTS_ALL, "All"],
          [SLOTS_OWNED, `Owned ${counts.owned}`],
          [SLOTS_MISSING, `Missing ${counts.missing}`],
        ],
        (value) => {
          albumFilter = value;
          render();
        }
      )
    );
    const right = el("div", "collections-toolbar-right");
    right.appendChild(el("span", "collections-toolbar-label", "Sort"));
    right.appendChild(
      buildSegmented(
        "Sort slots",
        albumSort,
        [
          [SORT_OLDEST, "Oldest"],
          [SORT_NEWEST, "Newest"],
        ],
        (value) => {
          albumSort = value;
          render();
        }
      )
    );
    right.appendChild(el("span", "collections-toolbar-label", "View"));
    right.appendChild(buildViewToggle());
    if (entry.isCustom) {
      right.appendChild(
        buildPillButton({
          label: "Edit collection",
          icon: "edit",
          secondary: true,
          focusKey: "album:edit",
          onClick: () => callPicker("openBuilder", { editId: entry.id }),
        })
      );
      right.appendChild(
        buildPillButton({
          label: "Remove collection",
          icon: "trash",
          danger: true,
          focusKey: "album:remove",
          onClick: () => void confirmRemoveCollection(entry),
        })
      );
    } else {
      right.appendChild(
        buildPillButton({
          label: "Clone & customize",
          icon: "copy",
          secondary: true,
          focusKey: "album:clone",
          onClick: () => callPicker("openBuilder", { cloneFrom: entry.id }),
        })
      );
    }
    toolbar.appendChild(right);
    return toolbar;
  };

  /**
   * Year / label heading of a slot, with its optional tag (e.g. "T2").
   * @param {Object} slot - Slot view model
   * @param {string} className - Wrapper class
   * @returns {HTMLElement} The heading
   */
  const buildSlotLabel = (slot, className) => {
    const heading = el("span", className);
    heading.appendChild(el("span", "collections-slot-label", slot.label));
    if (slot.tag) heading.appendChild(el("span", "collections-slot-tag", slot.tag));
    return heading;
  };

  /**
   * "paid → melt (+x%)" for one unit of a linked Item.
   * @param {Object} item - Linked inventory item
   * @param {string} className - Wrapper class
   * @returns {HTMLElement} The money line
   */
  const buildMoneyLine = (item, className) => {
    const line = el("span", className);
    const paid = unitPaid(item);
    const melt = unitMelt(item);
    line.appendChild(document.createTextNode(money(paid)));
    if (!melt) return line;
    line.appendChild(document.createTextNode(` → ${money(melt)}`));
    if (paid > 0) {
      const pct = Math.round(((melt - paid) / paid) * PERCENT);
      line.appendChild(document.createTextNode(" "));
      line.appendChild(
        el(
          "span",
          pct >= 0 ? "collections-up" : "collections-down",
          `${pct >= 0 ? "+" : ""}${pct}%`
        )
      );
    }
    return line;
  };

  /**
   * What a missing slot offers instead of an Item: inventory matches, the best
   * current vendor price, or "Not owned".
   * @param {Object} entry - Entry view model
   * @param {Object} slot - Slot view model
   * @param {string} className - Class for the plain-text variants
   * @param {boolean} [showPrice=true] - False where the price has a column of its own (ledger)
   * @returns {HTMLElement} The hint
   */
  const buildMissingHint = (entry, slot, className, showPrice = true) => {
    if (slot.matches > 0) {
      const match = button("collections-match", `match:${slot.def.id}`, () =>
        callPicker("openLinkPicker", {
          collectionId: entry.id,
          slotId: slot.def.id,
          asSpare: false,
        })
      );
      match.textContent = `${slot.matches} match${slot.matches === 1 ? "" : "es"} in your inventory`;
      return match;
    }
    if (entry.best && showPrice) {
      const price = el(
        "span",
        `${className} collections-slot-price`,
        `from ${money(entry.best.price)}`
      );
      price.appendChild(el("small", "", ` · ${entry.best.vendor}`));
      return price;
    }
    return el("span", className, "Not owned");
  };

  /**
   * "+ Add" pill for a missing slot.
   * @param {Object} entry - Entry view model
   * @param {Object} slot - Slot view model
   * @returns {HTMLButtonElement} The button
   */
  const buildAddButton = (entry, slot) => {
    const add = buildPillButton({
      label: "Add",
      icon: "plus",
      secondary: true,
      focusKey: `add:${slot.def.id}`,
      onClick: () => openAddMenu(add, entry, slot, false),
    });
    add.classList.add("collections-add");
    add.setAttribute("aria-haspopup", "menu");
    add.setAttribute("aria-expanded", "false");
    add.setAttribute("aria-label", `Add an item to the ${slot.label} slot`);
    return add;
  };

  /**
   * "More" (⋯) button for an owned slot.
   * @param {Object} entry - Entry view model
   * @param {Object} slot - Slot view model
   * @returns {HTMLButtonElement} The button
   */
  const buildMoreButton = (entry, slot) => {
    const more = button("collections-more", `more:${slot.def.id}`, (event) => {
      event.stopPropagation();
      openMoreMenu(more, entry, slot);
    });
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    more.setAttribute("aria-label", `More actions for the ${slot.label} slot`);
    more.appendChild(icon("more"));
    return more;
  };

  /**
   * Medallion for a slot: stock image (ghosted while missing); an owned slot is
   * marked so the async pass can swap in the linked Item's own photo.
   * @param {Object} entry - Entry view model
   * @param {Object} slot - Slot view model
   * @param {string} [size] - Medallion size modifier
   * @returns {HTMLElement} The medallion
   */
  const buildSlotCoin = (entry, slot, size) =>
    buildCoin({
      src: entry.obverse,
      monogram: entry.monogram,
      ghost: !slot.item,
      owned: Boolean(slot.item),
      size,
      itemUuid: slot.item ? slot.item.uuid : "",
      artwork: entry.isCustom ? { collectionId: entry.id, slotId: slot.def.id } : null,
    });

  /**
   * One slot tile (album mode).
   * @param {Object} entry - Entry view model
   * @param {Object} slot - Slot view model
   * @returns {HTMLElement} The tile
   */
  const buildSlotTile = (entry, slot) => {
    const tile = el("div", slot.item ? "collections-slot is-owned" : "collections-slot is-missing");
    tile.dataset.slotId = slot.def.id;
    tile.setAttribute("role", "listitem");
    if (slot.note) tile.title = slot.note;
    const mintage = mintageLine(slot.def);

    if (!slot.item) {
      tile.appendChild(buildSlotCoin(entry, slot));
      tile.appendChild(buildSlotLabel(slot, "collections-slot-year"));
      tile.appendChild(el("span", "collections-slot-meta", mintage || " "));
      tile.appendChild(el("span", "collections-slot-rule"));
      tile.appendChild(buildMissingHint(entry, slot, "collections-slot-meta"));
      if (canMutate()) tile.appendChild(buildAddButton(entry, slot));
      return tile;
    }

    // The main button carries the whole face of the tile; badges and the "more" button
    // are its SIBLINGS, never its children — interactive controls must not nest.
    const main = button("collections-slot-main", `slot:${slot.def.id}`, () =>
      viewItem(slot.item.uuid)
    );
    main.appendChild(buildSlotCoin(entry, slot));
    main.appendChild(buildSlotLabel(slot, "collections-slot-year"));
    main.appendChild(el("span", "collections-slot-meta", mintage || " "));
    main.appendChild(el("span", "collections-slot-rule"));
    const name = el("span", "collections-slot-item", text(slot.item.name) || "Untitled item");
    name.title = name.textContent;
    main.appendChild(name);
    const moneyLine = buildMoneyLine(slot.item, "collections-slot-money");
    if (quantityOf(slot.item) > 1)
      moneyLine.appendChild(el("span", "collections-qty", `×${quantityOf(slot.item)}`));
    main.appendChild(moneyLine);
    tile.appendChild(main);

    const check = el("span", "collections-check");
    check.appendChild(icon("check"));
    check.setAttribute("aria-hidden", "true");
    tile.appendChild(check);
    if (slot.spares.length) {
      const spare = el("span", "collections-spare", `+${slot.spares.length}`);
      spare.title = `${slot.spares.length} spare${slot.spares.length === 1 ? "" : "s"}`;
      tile.appendChild(spare);
    }
    if (canMutate()) tile.appendChild(buildMoreButton(entry, slot));
    return tile;
  };

  /**
   * Secondary line under a linked Item's name in the ledger: where and when it was bought.
   * @param {Object} item - Linked inventory item
   * @returns {string} "APMEX · 2024-03-14" style line
   */
  const purchaseLine = (item) => {
    const when =
      item.date && typeof formatDisplayDate === "function" ? formatDisplayDate(item.date) : "";
    return [text(item.purchaseLocation), text(when)].filter(Boolean).join(" · ");
  };

  /**
   * One slot row (ledger mode). Below 640px the numeric columns hide and the row
   * becomes two lines: thumb | year + item / status or price | action.
   * @param {Object} entry - Entry view model
   * @param {Object} slot - Slot view model
   * @returns {HTMLElement} The row
   */
  const buildSlotRow = (entry, slot) => {
    const row = el("div", slot.item ? "collections-lrow is-owned" : "collections-lrow is-missing");
    row.dataset.slotId = slot.def.id;
    row.setAttribute("role", "listitem");
    row.appendChild(buildSlotCoin(entry, slot, "sm"));
    row.appendChild(buildSlotLabel(slot, "collections-lrow-year"));
    const name = el("span", "collections-lrow-name");
    /**
     * A right-aligned numeric cell; hidden in the compact (<=640px) row.
     * @param {string} value - Cell text
     * @param {string} [extra] - Extra classes
     * @returns {HTMLElement} The cell
     */
    const numeric = (value, extra) =>
      el("span", `collections-num collections-hide-sm ${extra || ""}`.trim(), value);

    if (!slot.item) {
      // The price has its own column here; the compact row folds it into line two instead.
      name.appendChild(buildMissingHint(entry, slot, "collections-muted", false));
      if (slot.note) name.appendChild(el("small", "collections-hide-sm", slot.note));
      if (entry.best)
        name.appendChild(
          el(
            "small",
            "collections-show-sm",
            `from ${money(entry.best.price)} · ${entry.best.vendor}`
          )
        );
      row.appendChild(name);
      row.appendChild(numeric(mintageCell(slot.def), "collections-muted collections-hide-md"));
      row.appendChild(numeric(DASH, "collections-muted"));
      row.appendChild(numeric(DASH, "collections-muted"));
      row.appendChild(numeric(entry.best ? `from ${money(entry.best.price)}` : DASH));
      const act = el("span", "collections-lrow-act");
      if (canMutate()) act.appendChild(buildAddButton(entry, slot));
      row.appendChild(act);
      return row;
    }

    const item = slot.item;
    const open = button("collections-linkbtn", `slot:${slot.def.id}`, () => viewItem(item.uuid));
    open.textContent = text(item.name) || "Untitled item";
    open.title = open.textContent;
    name.appendChild(open);
    if (quantityOf(item) > 1)
      name.appendChild(el("span", "collections-qty", `×${quantityOf(item)}`));
    if (slot.spares.length)
      name.appendChild(
        buildTag(`+${slot.spares.length} spare${slot.spares.length === 1 ? "" : "s"}`)
      );
    name.appendChild(el("small", "collections-hide-sm", purchaseLine(item) || slot.note));
    name.appendChild(buildMoneyLine(item, "collections-lrow-money collections-show-sm"));
    row.appendChild(name);

    const paid = unitPaid(item);
    const melt = unitMelt(item);
    row.appendChild(numeric(mintageCell(slot.def), "collections-muted collections-hide-md"));
    row.appendChild(numeric(money(paid)));
    row.appendChild(numeric(melt ? money(melt) : DASH));
    const delta = melt - paid;
    row.appendChild(
      melt
        ? numeric(
            `${delta >= 0 ? "+" : "−"}${money(Math.abs(delta))}`,
            delta >= 0 ? "collections-up" : "collections-down"
          )
        : numeric(DASH, "collections-muted")
    );
    const act = el("span", "collections-lrow-act");
    act.appendChild(buildTag("Owned", "is-done"));
    if (canMutate()) act.appendChild(buildMoreButton(entry, slot));
    row.appendChild(act);
    if (slot.note) row.title = slot.note;
    // Convenience only — the row is not the control; the name button is.
    row.addEventListener("click", (event) => {
      if (!event.target.closest("button")) viewItem(item.uuid);
    });
    return row;
  };

  /**
   * Album body: tiles or rows by view mode, or a message when the filter matches nothing.
   * @param {Object} entry - Entry view model
   * @param {Object[]} slots - Visible slot view models
   * @returns {HTMLElement} The body
   */
  const buildAlbumBody = (entry, slots) => {
    if (!slots.length) {
      if (albumFilter === SLOTS_OWNED)
        return buildEmptyState(
          "No slots filled yet",
          "Link an item from your inventory, or add a new one, to fill your first slot."
        );
      if (albumFilter === SLOTS_MISSING)
        return buildEmptyState(
          "Nothing missing — set complete",
          "Every slot in this collection has a linked item."
        );
      return buildEmptyState("No slots yet", "This collection does not define any slots.");
    }
    if (getViewMode() === VIEW_LEDGER) {
      const table = el("div", "collections-ledger");
      table.setAttribute("role", "list");
      table.appendChild(
        buildLedgerHead("", [
          ["", ""],
          ["Year", ""],
          ["Linked item", ""],
          ["Mintage", "collections-num collections-hide-md"],
          ["Paid", "collections-num"],
          ["Melt", "collections-num"],
          ["G/L · Best price", "collections-num"],
          ["", ""],
        ])
      );
      slots.forEach((slot) => table.appendChild(buildSlotRow(entry, slot)));
      return table;
    }
    const grid = el("div", "collections-slots");
    grid.setAttribute("role", "list");
    slots.forEach((slot) => grid.appendChild(buildSlotTile(entry, slot)));
    return grid;
  };

  /**
   * The in-page album view.
   * @param {Object} entry - Entry view model
   * @returns {HTMLElement} Album panel content
   */
  const buildAlbum = (entry) => {
    const album = el("div", "collections-album");
    const crumb = el("nav", "collections-crumb");
    crumb.setAttribute("aria-label", "Breadcrumb");
    const back = button("", "album:back", () => showHub());
    back.appendChild(icon("back"));
    back.appendChild(el("span", "", "Collections"));
    crumb.appendChild(back);
    crumb.appendChild(el("span", "", "/"));
    const here = el("span", "", [entry.name, entry.variant].filter(Boolean).join(" — "));
    here.setAttribute("aria-current", "page");
    crumb.appendChild(here);
    album.appendChild(crumb);

    const described = describeSlots(entry);
    album.appendChild(buildAlbumHead(entry));
    album.appendChild(buildAlbumStats(entry));
    album.appendChild(buildAlbumToolbar(entry, described));
    album.appendChild(buildAlbumBody(entry, described.slots));
    return album;
  };

  // ---------------------------------------------------------------------------
  // Images — resolved after the synchronous render
  // ---------------------------------------------------------------------------

  /**
   * Revokes every blob: URL the previous render created. http(s) and relative
   * (stock) URLs are never tracked, so they can never be revoked here.
   * @returns {void}
   */
  const revokeObjectUrls = () => {
    objectUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        debugLog(`[collections] revokeObjectURL failed: ${error.message}`, "warn");
      }
    });
    objectUrls = [];
  };

  /**
   * Best image URL for a linked Item: the image cache's user upload / pattern image
   * (a blob: URL the caller owns), else the Item's stored CDN URL, else null so the
   * template stock image stays.
   * @param {Object} item - Linked inventory item
   * @returns {Promise<string|null>} URL, or null
   */
  const resolveItemImageUrl = async (item) => {
    const cache = window.imageCache;
    if (cache && typeof cache.isAvailable === "function" && cache.isAvailable()) {
      const cached = await cache.resolveImageUrlForItem(item, "obverse");
      if (cached) return cached;
    }
    const stored = item.obverseImageUrl;
    return typeof ImageCache !== "undefined" && ImageCache.isValidImageUrl(stored) ? stored : null;
  };

  /**
   * Custom Collection artwork (cover, or one slot's image) from the builder slice.
   * @param {HTMLElement} coin - Medallion carrying data-art-collection / data-art-slot
   * @returns {Promise<string|null>} blob: URL the caller owns, or null
   */
  const resolveArtworkUrl = async (coin) => {
    const picker = window.collectionsPicker;
    if (!coin.dataset.artCollection || !picker || typeof picker.getImageUrl !== "function")
      return null;
    return picker.getImageUrl(coin.dataset.artCollection, coin.dataset.artSlot || undefined);
  };

  /**
   * Shows a resolved image in a medallion, falling back to what the synchronous
   * render painted (stock image or monogram) if it fails to load.
   * @param {HTMLElement} coin - Medallion
   * @param {string} url - Image URL
   * @returns {void}
   */
  const showCoinImage = (coin, url) => {
    let image = coin.querySelector("img");
    if (!image) {
      image = el("img");
      image.alt = "";
      coin.textContent = "";
      coin.classList.remove("collections-coin--mono");
      coin.appendChild(image);
    }
    image.addEventListener(
      "error",
      () => {
        if (coin.dataset.stockSrc) {
          image.src = coin.dataset.stockSrc;
          return;
        }
        image.remove();
        coin.classList.add("collections-coin--mono");
        coin.textContent = coin.dataset.monogram || "?";
      },
      { once: true }
    );
    image.src = url;
  };

  /**
   * Resolves one medallion's image: the linked Item's own photo first, then custom
   * collection artwork. A result that arrives after a newer render is discarded —
   * and revoked, so an abandoned lookup cannot leak its blob: URL.
   * @param {HTMLElement} coin - Medallion to resolve
   * @param {number} generation - Render generation the medallion belongs to
   * @returns {Promise<void>} Resolves when the medallion is settled
   */
  const resolveCoin = async (coin, generation) => {
    try {
      const item = coin.dataset.itemUuid ? store().findItem(coin.dataset.itemUuid) : null;
      const url =
        (item ? await resolveItemImageUrl(item) : null) || (await resolveArtworkUrl(coin));
      if (!url) return;
      const isBlob = url.startsWith("blob:");
      if (generation !== renderGeneration || !coin.isConnected) {
        if (isBlob) URL.revokeObjectURL(url);
        return;
      }
      if (isBlob) objectUrls.push(url);
      showCoinImage(coin, url);
    } catch (error) {
      debugLog(`[collections] Image lookup failed: ${error.message}`, "warn");
    }
  };

  /**
   * Resolves every medallion that asked for an item photo or custom artwork.
   * @param {HTMLElement} root - Render root
   * @param {number} generation - Render generation
   * @returns {Promise<void>} Resolves when all lookups have settled
   */
  const resolveImages = async (root, generation) => {
    if (typeof featureFlags === "undefined" || !featureFlags.isEnabled("COIN_IMAGES")) return;
    const coins = Array.from(root.querySelectorAll("[data-item-uuid], [data-art-collection]"));
    await Promise.all(coins.map((coin) => resolveCoin(coin, generation)));
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /**
   * The placeholder shown while the COLLECTIONS flag is off.
   * @returns {HTMLElement} Placeholder block
   */
  const buildPlaceholder = () => {
    const block = el("div", "collections-empty");
    block.appendChild(el("h2", "", "Collections"));
    block.appendChild(
      el(
        "p",
        "",
        "Prebuilt date runs and custom checklists are on the way. This tab is the shell they will render into."
      )
    );
    return block;
  };

  /**
   * Renders the Collections tab from the current route. Safe to call at any time:
   * it does nothing before boot has finished or while the panel is hidden.
   * @returns {void}
   */
  const render = () => {
    // getElementById, not safeGetElement: this can run before init.js defines it, and
    // the existence check needs a real null rather than the truthy dummy.
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const enabled = isEnabled();
    // Checked BEFORE any teardown, so an event that arrives while the panel is hidden
    // leaves the last frame — and the blob: URLs it is showing — exactly as it was.
    if (enabled && (!isAppReady() || !isTabActive() || !store() || !core())) return;
    closeMenu();
    revokeObjectUrls();
    renderGeneration += 1;

    if (!enabled) {
      lastRouteId = null;
      root.replaceChildren(buildPlaceholder());
      return;
    }

    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = focused ? focused.dataset.focusKey : "";

    const entries = buildEntries();
    const routeId = currentRouteId();
    const entry = routeId ? entries.find((candidate) => candidate.id === routeId) : null;
    if (routeId && !entry) {
      // Unknown or removed collection: land on the hub and make the URL agree, without
      // adding a history entry (same correction tabs.js applies to a hidden tab).
      history.replaceState(null, "", HUB_HASH);
    }
    const shownId = entry ? entry.id : "";
    const routeChanged = lastRouteId !== null && lastRouteId !== shownId;
    if (lastRouteId !== shownId) albumFilter = SLOTS_ALL;
    lastRouteId = shownId;

    const panel = el("div", "collections-panel");
    panel.appendChild(entry ? buildAlbum(entry) : buildHub(entries));
    root.replaceChildren(panel);

    if (focusKey) {
      const target = Array.from(root.querySelectorAll("[data-focus-key]")).find(
        (node) => node.dataset.focusKey === focusKey
      );
      if (target) target.focus({ preventScroll: true });
    }
    // Opening an album from far down the hub must not leave the user mid-page.
    if (routeChanged && root.getBoundingClientRect().top < 0)
      root.scrollIntoView({ block: "start" });

    void resolveImages(root, renderGeneration);
  };

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  /**
   * Re-renders when a modal that can edit an Item closes, so a renamed or re-priced
   * Item does not leave a stale tile behind. (Links changing is covered separately
   * by the store's "collections:changed" event.)
   * @returns {void}
   */
  const watchItemModals = () => {
    if (typeof MutationObserver !== "function") return;
    REFRESH_ON_CLOSE_MODAL_IDS.forEach((id) => {
      const modal = document.getElementById(id);
      if (!modal) return;
      const observer = new MutationObserver(() => {
        if (modal.style.display === "none") render();
      });
      observer.observe(modal, { attributes: true, attributeFilter: ["style"] });
    });
  };

  /**
   * First paint once boot has finished, plus the modal watchers that need a live DOM.
   * @returns {void}
   */
  const start = () => {
    watchItemModals();
    render();
  };

  const changedEvent =
    (window.collectionsStore && window.collectionsStore.CHANGED_EVENT) || CHANGED_EVENT_FALLBACK;
  document.addEventListener(changedEvent, render);
  // Money is shown in the display currency (precedent: inventory-table / market-data).
  window.addEventListener("currencychange", render);
  window.addEventListener("resize", () => closeMenu());
  if (typeof featureFlags !== "undefined" && typeof featureFlags.addListener === "function") {
    featureFlags.addListener("COLLECTIONS", render);
    featureFlags.addListener("COIN_IMAGES", render);
  }
  if (isAppReady()) start();
  else window.addEventListener(READY_EVENT, start, { once: true });

  // ---------------------------------------------------------------------------
  // Global exposure
  // ---------------------------------------------------------------------------
  window.collectionsUI = Object.freeze({
    render,
    openCollection,
    showHub,
    getViewMode,
    setViewMode,
  });
})();

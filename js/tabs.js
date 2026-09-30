// =============================================================================
// V2 TAB SHELL (STRK-282)
//
// Hash-routed view switching for the tabbed layout. Both navigation surfaces
// (header text nav + mobile bottom bar) drive one activateTab(); tab views are
// visibility wrappers around the existing page sections, so section IDs and
// all module behavior inside them stay untouched.
//
// Route form is "#/name" (e.g. #/inventory). Bare hashes like #privacy and
// #faq are deliberately ignored here — init.js consumes those at boot.
//
// A tab listed in SUB_ROUTE_TABS also owns ONE further segment, "#/name/<id>"
// (STRK-368: #/collections/ase-type2 opens that album in-page). The router only
// parses and exposes the segment (getTabSubRoute); what an id MEANS — and the
// fallback for an unknown one — belongs to the tab's own module.
// =============================================================================

(() => {
  "use strict";

  const TAB_NAMES = ["dashboard", "inventory", "market", "collections"];
  const DEFAULT_TAB = "dashboard";

  // Tabs that accept a sub-route segment. Every other tab keeps the strict
  // "#/name" form, so "#/inventory/anything" is still not a tab route.
  const SUB_ROUTE_TABS = ["collections"];

  // "#/name" with an optional "/<id>"; ids are lower-case slugs — a Series
  // Template slug ("ase-type2") or a Custom Collection id ("custom-<uuid>").
  const ROUTE_PATTERN = /^#\/([a-z]+)(?:\/([a-z0-9-]+))?$/;

  // The boot activation runs at parse time, before init.js. Any geometry
  // recompute must wait for that: updatePortalHeight (pagination.js) calls
  // safeGetElement, which init.js defines on the NEXT script tag, so invoking
  // it during boot throws a ReferenceError. init.js renders the table and sizes
  // the portal itself afterwards, so the boot pass has nothing to recompute.
  let booted = false;

  // Which tab is showing right now, so applyTabVisibility can tell "the user's
  // tab just got hidden" from "some other tab got hidden".
  let currentTab = DEFAULT_TAB;

  /**
   * Parse the current location hash into a tab route.
   * @returns {{tab: string, sub: string}|null} Route, or null when the hash is not a
   *   tab route. `sub` is "" unless the tab owns sub-routes and one is present.
   */
  const routeFromHash = () => {
    const match = ROUTE_PATTERN.exec(window.location.hash || "");
    if (!match || !TAB_NAMES.includes(match[1])) return null;
    const sub = match[2] || "";
    if (sub && !SUB_ROUTE_TABS.includes(match[1])) return null;
    return { tab: match[1], sub };
  };

  /**
   * Parse the current location hash into a known tab name.
   * @returns {string|null} Tab name, or null when the hash is not a tab route.
   */
  const tabFromHash = () => {
    const route = routeFromHash();
    return route ? route.tab : null;
  };

  /**
   * The sub-route of the tab that is showing, e.g. "ase-type2" for
   * "#/collections/ase-type2". Parsed live rather than cached: the owning module
   * may correct an unknown id with history.replaceState, which fires no
   * hashchange, and a cached copy would keep reporting the id it just rejected.
   * @returns {string} Sub-route id, or "" when there is none.
   */
  const getTabSubRoute = () => {
    const route = routeFromHash();
    return route && route.tab === currentTab ? route.sub : "";
  };

  /**
   * Tell a tab's own module that its panel was activated or its sub-route changed.
   * Only Collections renders from the route today (STRK-368). Skipped during boot
   * for the same reason as the geometry recomputes in activateTab: this file runs
   * before init.js, so nothing a renderer needs is hydrated yet — collectionsUI
   * paints its first frame itself once the app signals readiness.
   * @param {string} tab - The tab that is now showing.
   */
  const notifyTabView = (tab) => {
    if (!booted || tab !== "collections") return;
    if (window.collectionsUI && typeof window.collectionsUI.render === "function") {
      window.collectionsUI.render();
    }
  };

  /**
   * Tabs the user has left enabled in Settings > Appearance > Layout (STRK-326).
   *
   * Falls back to every tab when the config layer is missing or throws: a broken
   * settings read must not be able to hide the entire application.
   * @returns {string[]} Visible tab names, never empty.
   */
  const visibleTabs = () => {
    try {
      const cfg =
        typeof window.getLayoutTabConfig === "function" ? window.getLayoutTabConfig() : null;
      if (!Array.isArray(cfg)) return TAB_NAMES.slice();
      const names = cfg
        .filter((t) => t && t.enabled)
        .map((t) => t.id)
        .filter((name) => TAB_NAMES.includes(name));
      return names.length ? names : [DEFAULT_TAB];
    } catch {
      return TAB_NAMES.slice();
    }
  };

  /**
   * Hide the nav entries of disabled tabs across both nav surfaces.
   *
   * The `hidden` attribute alone is not enough on the bottom bar: .bottom-nav-btn
   * sets display:flex, which outranks the user-agent [hidden] rule. css/styles.css
   * carries the matching `[hidden] { display: none !important }` override.
   */
  const syncTabNavVisibility = () => {
    const visible = visibleTabs();
    document.querySelectorAll('[role="tab"][data-tab]').forEach((btn) => {
      btn.hidden = !visible.includes(btn.dataset.tab);
    });
  };

  /**
   * Show one tab view and sync aria-selected across both nav surfaces.
   * Uses document.getElementById (not safeGetElement) intentionally: tabs.js
   * executes before init.js defines safeGetElement, and existence-sensitive
   * toggling must not run against the truthy dummy element.
   * Resolution order: an unknown name falls back to DEFAULT_TAB, and a name the
   * user has hidden in Settings falls back again to the first visible tab
   * (STRK-326) — so a stale "#/market" bookmark lands somewhere real instead of
   * on a blank shell.
   * @param {string} name - Tab to activate; falls back to the first visible tab.
   * @param {boolean} [updateHash=true] - Write the "#/name" route to the URL.
   */
  const activateTab = (name, updateHash = true) => {
    const requested = TAB_NAMES.includes(name) ? name : DEFAULT_TAB;
    const visible = visibleTabs();
    const tab = visible.includes(requested)
      ? requested
      : visible.includes(DEFAULT_TAB)
        ? DEFAULT_TAB
        : visible.at(0);
    currentTab = tab;

    TAB_NAMES.forEach((candidate) => {
      const viewId = `tabView${candidate.charAt(0).toUpperCase()}${candidate.slice(1)}`;
      const view = document.getElementById(viewId);
      if (view) view.classList.toggle("active", candidate === tab);
    });

    // Roving tabindex, per the WAI-ARIA tabs pattern: only the selected tab is
    // in the page tab order, and the arrow keys move between them from there.
    document.querySelectorAll('[role="tab"][data-tab]').forEach((btn) => {
      const selected = btn.dataset.tab === tab;
      btn.setAttribute("aria-selected", String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });

    if (updateHash && window.location.hash !== `#/${tab}`) {
      window.location.hash = `#/${tab}`;
    } else if (!updateHash && tab !== requested && tabFromHash()) {
      // Fell back off a hidden route on a path that does not own the hash — the
      // boot deep link and the hashchange handler both pass updateHash=false.
      // Without this the address bar keeps "#/market" while Dashboard renders,
      // so the panel and any bookmarked or shared URL disagree indefinitely.
      // replaceState rather than assignment: it corrects the URL without
      // pushing a history entry (and without re-firing hashchange), so Back
      // still leaves by the door the user came in through. Guarded on
      // tabFromHash() so a hashless index.html stays hashless.
      history.replaceState(null, "", `#/${tab}`);
    }

    // Recompute any geometry that was measured while this panel was hidden.
    // updatePortalHeight sizes the table/card portal from getBoundingClientRect
    // on the header and first row, and those report 0 inside a display:none
    // panel — init.js renders the table during boot while Dashboard is active,
    // so a user with more rows than their itemsPerPage would otherwise reveal
    // Inventory to a portal collapsed to a single pixel. Cheap and idempotent:
    // a value computed while hidden is corrected the moment the panel shows.
    // Skipped during boot — see the `booted` declaration.
    if (booted && typeof window.updatePortalHeight === "function") {
      window.updatePortalHeight();
    }

    // Same failure mode, second instance (STRK-327): the Best Price ticker sizes
    // its scroll loop from a measured block width, so a rebuild that lands while
    // Dashboard is hidden — an ordinary reload on #/inventory, or a Market
    // setting change — reveals a frozen track with a scrollbar. The repair is
    // one-way and self-skipping once the track is running, so it is safe on
    // every switch, including the ones that hide Dashboard rather than show it.
    if (booted && typeof window.refreshTickerGeometry === "function") {
      window.refreshTickerGeometry();
    }

    // Last, once the hash above is settled: a sub-route change arrives here through
    // the hashchange handler, so this one call covers activation, Back/Forward and
    // an in-page "#/collections/<id>" navigation alike.
    notifyTabView(tab);
  };

  /**
   * Delegated click handler shared by both nav containers.
   * @param {MouseEvent} event - Click within a nav container.
   */
  const handleNavClick = (event) => {
    const btn = event.target.closest("[data-tab]");
    if (btn) activateTab(btn.dataset.tab);
  };

  /**
   * Keyboard navigation for the tablist (WAI-ARIA tabs pattern). Declaring
   * role="tablist"/"tab" promises arrow-key movement to assistive tech, so
   * click-only handling would leave that promise unkept.
   *
   * Scoped to the nav that received the event and to [role="tab"] only, which
   * keeps the bottom bar's Settings button — a plain button, not a tab — out of
   * the arrow cycle.
   *
   * @param {KeyboardEvent} event - Keydown within a nav container.
   */
  const handleNavKeydown = (event) => {
    const STEP = { ArrowLeft: -1, ArrowRight: 1 };
    // :not([hidden]) keeps tabs the user disabled out of the arrow cycle —
    // arrowing onto one would focus an invisible button (STRK-326).
    const buttons = Array.from(
      event.currentTarget.querySelectorAll('[role="tab"][data-tab]:not([hidden])')
    );
    const current = buttons.indexOf(document.activeElement);
    if (current === -1 || buttons.length === 0) return;

    let next = null;
    if (event.key in STEP) next = (current + STEP[event.key] + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    if (next === null) return;

    event.preventDefault();
    buttons[next].focus();
    activateTab(buttons[next].dataset.tab);
  };

  ["appTabNav", "appBottomNav"].forEach((navId) => {
    const nav = document.getElementById(navId);
    if (nav) {
      nav.addEventListener("click", handleNavClick);
      nav.addEventListener("keydown", handleNavKeydown);
    }
  });

  const bottomSettingsBtn = document.getElementById("bottomNavSettingsBtn");
  if (bottomSettingsBtn) {
    bottomSettingsBtn.addEventListener("click", () => {
      const settingsBtn = document.getElementById("settingsBtn");
      if (settingsBtn) settingsBtn.click();
    });
  }

  window.addEventListener("hashchange", () => {
    const tab = tabFromHash();
    if (tab) {
      activateTab(tab, false);
      return;
    }
    // An EMPTY hash means the default view, not "no opinion". Starting at a
    // plain index.html, the first tab click pushes #/inventory; pressing Back
    // restores the hashless URL, and ignoring that left the address bar and the
    // visible panel disagreeing. Non-empty non-tab hashes (#privacy, #faq) are
    // still ignored here — init.js owns those.
    if (!window.location.hash) activateTab(DEFAULT_TAB, false);
  });

  /**
   * Re-apply tab visibility after a Settings change, re-homing the user when the
   * tab they are on has just been hidden.
   */
  const applyTabVisibility = () => {
    syncTabNavVisibility();
    // Rewrite the hash only when the current tab actually became unreachable.
    // Otherwise toggling an unrelated tab would dirty a clean index.html URL.
    activateTab(currentTab, !visibleTabs().includes(currentTab));
  };

  // Boot: hide disabled tabs before the first activation, then honor a "#/name"
  // deep link; otherwise show the default tab without writing a hash (keeps
  // plain index.html URLs clean). activateTab resolves a hidden target itself.
  syncTabNavVisibility();
  activateTab(tabFromHash() || DEFAULT_TAB, false);
  booted = true;

  // Exposed for Playwright helpers and cross-module use (script-tag globals).
  window.activateTab = activateTab;
  window.applyTabVisibility = applyTabVisibility;
  window.getTabSubRoute = getTabSubRoute;
})();

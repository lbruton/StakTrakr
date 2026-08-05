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
// =============================================================================

(() => {
  "use strict";

  const TAB_NAMES = ["dashboard", "inventory", "market", "collections"];
  const DEFAULT_TAB = "dashboard";

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
   * Parse the current location hash into a known tab name.
   * @returns {string|null} Tab name, or null when the hash is not a tab route.
   */
  const tabFromHash = () => {
    const match = /^#\/([a-z]+)$/.exec(window.location.hash || "");
    return match && TAB_NAMES.includes(match[1]) ? match[1] : null;
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
})();

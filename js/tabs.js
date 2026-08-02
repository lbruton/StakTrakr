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

  /**
   * Parse the current location hash into a known tab name.
   * @returns {string|null} Tab name, or null when the hash is not a tab route.
   */
  const tabFromHash = () => {
    const match = /^#\/([a-z]+)$/.exec(window.location.hash || "");
    return match && TAB_NAMES.includes(match[1]) ? match[1] : null;
  };

  /**
   * Show one tab view and sync aria-selected across both nav surfaces.
   * Uses document.getElementById (not safeGetElement) intentionally: tabs.js
   * executes before init.js defines safeGetElement, and existence-sensitive
   * toggling must not run against the truthy dummy element.
   * @param {string} name - Tab to activate; falls back to DEFAULT_TAB.
   * @param {boolean} [updateHash=true] - Write the "#/name" route to the URL.
   */
  const activateTab = (name, updateHash = true) => {
    const tab = TAB_NAMES.includes(name) ? name : DEFAULT_TAB;

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
    const buttons = Array.from(event.currentTarget.querySelectorAll('[role="tab"][data-tab]'));
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

  // Boot: honor a "#/name" deep link; otherwise show the default tab without
  // writing a hash (keeps plain index.html URLs clean).
  activateTab(tabFromHash() || DEFAULT_TAB, false);
  booted = true;

  // Exposed for Playwright helpers and cross-module use (script-tag globals).
  window.activateTab = activateTab;
})();

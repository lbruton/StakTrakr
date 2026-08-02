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

    document.querySelectorAll('[role="tab"][data-tab]').forEach((btn) => {
      btn.setAttribute("aria-selected", String(btn.dataset.tab === tab));
    });

    if (updateHash && window.location.hash !== `#/${tab}`) {
      window.location.hash = `#/${tab}`;
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

  ["appTabNav", "appBottomNav"].forEach((navId) => {
    const nav = document.getElementById(navId);
    if (nav) nav.addEventListener("click", handleNavClick);
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
    if (tab) activateTab(tab, false);
  });

  // Boot: honor a "#/name" deep link; otherwise show the default tab without
  // writing a hash (keeps plain index.html URLs clean).
  activateTab(tabFromHash() || DEFAULT_TAB, false);

  // Exposed for Playwright helpers and cross-module use (script-tag globals).
  window.activateTab = activateTab;
})();

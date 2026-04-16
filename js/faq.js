/**
 * @fileoverview FAQ modal compatibility shim.
 * Redirects legacy FAQ entry points to the Settings modal FAQ tab.
 */

// FAQ MODAL
// =============================================================================
// showFaqModal — redirects to Settings > FAQ tab.
// All FAQ content lives in #settingsPanel_faq; the standalone #faqModal has
// been removed. Preserving the window.showFaqModal export keeps all existing
// call sites in index.html and init.js working without modification.

/**
 * Opens the Settings modal on the FAQ tab.
 * @returns {void}
 */
const showFaqModal = () => {
  if (typeof showSettingsModal === "function") {
    showSettingsModal("faq");
  }
};

if (typeof window !== "undefined") {
  window.showFaqModal = showFaqModal;
}

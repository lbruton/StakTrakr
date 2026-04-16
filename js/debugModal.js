/**
 * @fileoverview Debug modal open/close helpers.
 * Exposes `showDebugModal` and `hideDebugModal` on `window`.
 */

/**
 * Displays the debug modal and renders buffered debug history text.
 * @returns {void}
 */
const showDebugModal = () => {
  const modal = document.getElementById("debugModal");
  const content = document.getElementById("debugModalContent");
  if (content && typeof window.getDebugHistory === "function") {
    content.textContent = window.getDebugHistory().join("\n");
  }
  if (window.openModalById) openModalById("debugModal");
  else if (modal) {
    modal.style.display = "flex";
    document.body.style.overflow = "hidden";
  }
};

/**
 * Hides the debug modal and restores body scrolling.
 * @returns {void}
 */
const hideDebugModal = () => {
  if (window.closeModalById) closeModalById("debugModal");
  else {
    const modal = document.getElementById("debugModal");
    if (modal) modal.style.display = "none";
    try {
      document.body.style.overflow = "";
    } catch (e) {}
  }
};

window.showDebugModal = showDebugModal;
window.hideDebugModal = hideDebugModal;

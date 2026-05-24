// CLONE MODE CONTROLLER (STAK-375)
// =============================================================================
// Reuses the edit modal with overlay checkboxes for field-level clone selection.
// Replaces the standalone clone picker modal with an in-place clone mode.

/**
 * @type {boolean} Whether clone mode is currently active
 */
let _cloneMode = false;

/**
 * @type {Object|null} Deep clone of source item for reference during clone session
 */
let _cloneSourceItem = null;

/**
 * @type {number} Counter of clones created in this session
 */
let _cloneSessionCount = 0;

/**
 * @type {boolean} Whether any clones were created (triggers re-render on exit)
 */
let _cloneDirty = false;

/**
 * @type {boolean} Flag set by Save & Close button to trigger modal close after commit.
 *   Defaults to true so Enter-key (implicit) submits behave as Save & Close.
 */
let _cloneSaveAndClose = true;

/**
 * @type {number|null} Inventory index of the source item (for "Back" button)
 */
let _cloneSourceIndex = null;

// Expose state on window for cross-file access
Object.defineProperty(window, "_cloneMode", {
  get: () => _cloneMode,
  set: (v) => {
    _cloneMode = v;
  },
  configurable: true,
});
Object.defineProperty(window, "_cloneSourceItem", {
  get: () => _cloneSourceItem,
  set: (v) => {
    _cloneSourceItem = v;
  },
  configurable: true,
});
Object.defineProperty(window, "_cloneSessionCount", {
  get: () => _cloneSessionCount,
  set: (v) => {
    _cloneSessionCount = v;
  },
  configurable: true,
});
Object.defineProperty(window, "_cloneDirty", {
  get: () => _cloneDirty,
  set: (v) => {
    _cloneDirty = v;
  },
  configurable: true,
});
Object.defineProperty(window, "_cloneSaveAndClose", {
  get: () => _cloneSaveAndClose,
  set: (v) => {
    _cloneSaveAndClose = v;
  },
  configurable: true,
});
Object.defineProperty(window, "_cloneSourceIndex", {
  get: () => _cloneSourceIndex,
  set: (v) => {
    _cloneSourceIndex = v;
  },
  configurable: true,
});

/**
 * Deep-clone a source inventory item with a compatibility fallback.
 * @param {Object} item
 * @returns {Object}
 */
function cloneItemDeep(item) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(item);
    } catch (_) {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(item));
}

/**
 * Field definitions for clone checkboxes.
 * Maps label `for` attribute → data key → default checked state.
 */
// Only optional fields get checkboxes. Mandatory fields (metal, type, purity,
// qty, weight, weightUnit, name) are always carried over — they cannot be blank.
const CLONE_FIELDS = [
  { labelFor: "itemYear", key: "year", defaultOn: true },
  { labelFor: "itemDate", key: "date", defaultOn: true },
  { labelFor: "itemPrice", key: "price", defaultOn: true },
  { labelFor: "itemPaymentMethod", key: "paymentMethod", defaultOn: true },
  { labelFor: "purchaseLocation", key: "purchaseLocation", defaultOn: true },
  { labelFor: "storageLocation", key: "storageLocation", defaultOn: true },
  { labelFor: "itemGrade", key: "grade", defaultOn: true },
  { labelFor: "itemGradingAuthority", key: "gradingAuthority", defaultOn: true },
  { labelFor: "itemCertNumber", key: "certNumber", defaultOn: false },
  { labelFor: "itemCatalog", key: "numistaId", defaultOn: true },
  { labelFor: "itemPcgsNumber", key: "pcgsNumber", defaultOn: false },
  { labelFor: "itemMarketValue", key: "marketValue", defaultOn: true },
  { labelFor: "itemSerialNumber", key: "serialNumber", defaultOn: false },
  { labelFor: "itemNotes", key: "notes", defaultOn: true },
];

/**
 * Section-level checkboxes for non-collapsible sections.
 */
const CLONE_SECTIONS = [
  { sectionId: "numistaDataSection", key: "numistaData", defaultOn: true },
  { sectionId: "tagsSection", key: "tags", defaultOn: true },
];

/**
 * Enters clone mode on the edit modal.
 * @param {number} inventoryIndex - Index of the source item in the inventory array
 */
function enterCloneMode(inventoryIndex) {
  if (_cloneMode) return;

  _cloneSourceItem = cloneItemDeep(inventory[inventoryIndex]);
  _cloneSourceIndex = inventoryIndex;
  editingIndex = null; // Form submit creates new item
  _cloneMode = true;
  _cloneSessionCount = 0;
  _cloneDirty = false;
  _cloneSaveAndClose = true;

  const modal = safeGetElement("itemModal");
  if (modal) modal.classList.add("clone-mode");

  // Inject field checkboxes
  CLONE_FIELDS.forEach(({ labelFor, key, defaultOn }) => {
    const label = document.querySelector(`label[for="${labelFor}"]`);
    if (!label) return;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "clone-field-cb";
    cb.dataset.cloneField = key;
    cb.checked = defaultOn;
    cb.setAttribute("aria-label", `Clone ${key}`);
    cb.addEventListener("change", () => toggleCloneField(key, cb.checked));
    label.prepend(cb);
    // Apply initial dim state for defaultOff fields
    if (!defaultOn) toggleCloneField(key, false);
  });

  // Inject section checkboxes
  CLONE_SECTIONS.forEach(({ sectionId, key, defaultOn }) => {
    const section = safeGetElement(sectionId);
    if (!section) return;
    const header = section.querySelector(".form-section-header");
    if (!header) return;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "clone-section-cb";
    cb.dataset.cloneSection = key;
    cb.checked = defaultOn;
    cb.setAttribute("aria-label", "Clone section");
    cb.addEventListener("change", () => toggleCloneSection(sectionId, key, cb.checked));
    header.prepend(cb);
    if (!defaultOn) toggleCloneSection(sectionId, key, false);
  });

  // Update modal UI
  if (elements.itemModalTitle) elements.itemModalTitle.textContent = "Clone Item";
  if (elements.itemModalSubmit) elements.itemModalSubmit.textContent = "Save & Close";
  if (elements.cloneItemSaveAnotherBtn) elements.cloneItemSaveAnotherBtn.style.display = "";
  if (elements.cloneItemBtn) elements.cloneItemBtn.style.display = "none";
  if (elements.undoChangeBtn) elements.undoChangeBtn.style.display = "none";
  if (elements.viewItemFromEditBtn) elements.viewItemFromEditBtn.style.display = "none";
  const deleteFromEditBtn = document.getElementById("deleteFromEditBtn");
  if (deleteFromEditBtn) deleteFromEditBtn.style.display = "none";
  if (elements.cancelItemBtn) elements.cancelItemBtn.textContent = "Back";

  // Clone counter (hidden until first save)
  updateCloneCounter();
}

/**
 * Exits clone mode and restores the edit modal to normal state.
 * @param {boolean} [silent=false] If true, skip re-opening edit mode (used during Save & Close)
 */
function exitCloneMode(silent) {
  if (!_cloneMode) return;
  _cloneMode = false;

  const modal = safeGetElement("itemModal");
  if (modal) modal.classList.remove("clone-mode");

  // Remove injected checkboxes
  document.querySelectorAll(".clone-field-cb").forEach((cb) => cb.remove());
  document.querySelectorAll(".clone-section-cb").forEach((cb) => cb.remove());

  // Remove dim classes
  document
    .querySelectorAll(".clone-field-dimmed")
    .forEach((el) => el.classList.remove("clone-field-dimmed"));

  // Restore modal UI
  if (elements.itemModalTitle) elements.itemModalTitle.textContent = "Edit Item";
  if (elements.itemModalSubmit) elements.itemModalSubmit.textContent = "Update Item";
  if (elements.cloneItemSaveAnotherBtn) elements.cloneItemSaveAnotherBtn.style.display = "none";
  if (elements.clonePickerCount) elements.clonePickerCount.style.display = "none";
  if (elements.cancelItemBtn) elements.cancelItemBtn.textContent = "Cancel";

  if (_cloneDirty && typeof renderTable === "function") {
    renderTable();
  }

  // Re-open source item in edit mode (unless silent exit for Save & Close)
  const srcIdx = _cloneSourceIndex;
  _cloneSourceItem = null;
  _cloneSourceIndex = null;
  if (!silent && srcIdx !== null && typeof editItem === "function") {
    editItem(srcIdx);
  }
}

/**
 * Toggle visibility/opacity of a field when its clone checkbox changes.
 * @param {string} key - Field key from CLONE_FIELDS
 * @param {boolean} checked - Whether the checkbox is now checked
 */
function toggleCloneField(key, checked) {
  const field = CLONE_FIELDS.find((f) => f.key === key);
  if (!field) return;
  const label = document.querySelector(`label[for="${field.labelFor}"]`);
  if (!label) return;
  // Dim the parent container (the div wrapping label + input)
  const container = label.closest("div");
  if (container) {
    container.classList.toggle("clone-field-dimmed", !checked);
  }
}

/**
 * Toggle an entire section when its section checkbox changes.
 * @param {string} sectionId - Section element ID
 * @param {string} key - Section key from CLONE_SECTIONS
 * @param {boolean} checked - Whether the checkbox is now checked
 */
function toggleCloneSection(sectionId, key, checked) {
  const section = safeGetElement(sectionId);
  if (!section) return;
  const body = section.querySelector(".form-section-body");
  if (body) {
    body.classList.toggle("clone-field-dimmed", !checked);
  }
}

/**
 * Check if a clone field checkbox is checked.
 * @param {string} key - Field or section key
 * @returns {boolean}
 */
function isCloneFieldChecked(key) {
  // Check field checkboxes
  const fieldCb = document.querySelector(`.clone-field-cb[data-clone-field="${key}"]`);
  if (fieldCb) return fieldCb.checked;
  // Check section checkboxes
  const sectionCb = document.querySelector(`.clone-section-cb[data-clone-section="${key}"]`);
  if (sectionCb) return sectionCb.checked;
  return true; // Default to checked if not found
}

/**
 * Clear unchecked clone fields in the DOM BEFORE parseItemFormFields reads them.
 * This ensures the first clone respects checkbox state.
 */
function clearUncheckedCloneFields() {
  CLONE_FIELDS.forEach(({ labelFor, key }) => {
    if (isCloneFieldChecked(key)) return;
    const el = safeGetElement(labelFor);
    if (!el) return;
    if (el.tagName === "SELECT") {
      el.selectedIndex = 0;
    } else {
      el.value = "";
    }
  });

  // Clear unchecked sections
  CLONE_SECTIONS.forEach(({ sectionId, key }) => {
    if (key === "tags") return; // Tags handled separately via tag API
    if (isCloneFieldChecked(key)) return;
    const section = safeGetElement(sectionId);
    if (!section) return;
    section.querySelectorAll("input:not(.clone-section-cb), select").forEach((input) => {
      if (input.type === "checkbox") input.checked = false;
      else if (input.tagName === "SELECT") input.selectedIndex = 0;
      else input.value = "";
    });
  });
}

/**
 * Reset unchecked fields after "Save & Clone Another".
 * Checked fields keep their values; unchecked fields are cleared.
 * Clone control checkboxes are preserved.
 */
function resetUncheckedCloneFields() {
  CLONE_FIELDS.forEach(({ labelFor, key }) => {
    if (isCloneFieldChecked(key)) return;
    const el = safeGetElement(labelFor);
    if (!el) return;
    if (el.tagName === "SELECT") {
      el.selectedIndex = 0;
    } else {
      el.value = "";
    }
  });

  // Reset unchecked sections (excluding clone control checkboxes)
  CLONE_SECTIONS.forEach(({ sectionId, key }) => {
    if (isCloneFieldChecked(key)) return;
    const section = safeGetElement(sectionId);
    if (!section) return;
    section
      .querySelectorAll("input:not(.clone-field-cb):not(.clone-section-cb), select")
      .forEach((input) => {
        if (input.type === "checkbox") input.checked = false;
        else if (input.tagName === "SELECT") input.selectedIndex = 0;
        else input.value = "";
      });
  });
}

/**
 * Update the clone counter display.
 */
function updateCloneCounter() {
  if (!elements.clonePickerCount) return;
  if (_cloneSessionCount > 0) {
    elements.clonePickerCount.textContent = `${_cloneSessionCount} cloned`;
    elements.clonePickerCount.style.display = "";
  } else {
    elements.clonePickerCount.style.display = "none";
  }
}

// Expose functions globally
window.enterCloneMode = enterCloneMode;
window.exitCloneMode = exitCloneMode;
window.isCloneFieldChecked = isCloneFieldChecked;
window.clearUncheckedCloneFields = clearUncheckedCloneFields;
window.resetUncheckedCloneFields = resetUncheckedCloneFields;
window.updateCloneCounter = updateCloneCounter;

// INVENTORY FUNCTIONS
// Table rendering, summary, and formatting extracted to inventory-table.js

/**
 * Cached map of inventory items to their original indices.
 * Optimized for O(1) lookup during rendering to avoid O(N) indexOf calls.
 * @type {Map<Object, number>|null}
 */
let _cachedItemIndexMap = null;

/**
 * STRK-13: Inventory recovery flag.
 * Set true when boot detected damaged or unparseable metalInventory; gated
 * `saveInventory()` calls become no-ops until cleared by an explicit user
 * action (add / import / restore — wired in task 8). Prevents the auto-write
 * of `[]` that would overwrite the corrupt key with an empty array, destroying
 * forensic evidence and preventing cloud-restore.
 */
let inventoryRecoveryActive = false;
const setInventoryRecoveryActive = (val) => {
  inventoryRecoveryActive = !!val;
};
const isInventoryRecoveryActive = () => inventoryRecoveryActive;
const clearInventoryRecovery = () => {
  if (!inventoryRecoveryActive) return;
  inventoryRecoveryActive = false;
  if (typeof dismissInventoryRecoveryBanner === "function") {
    dismissInventoryRecoveryBanner();
  }
  if (typeof debugLog === "function") {
    debugLog("inventoryRecovery: cleared");
  }
};
window.setInventoryRecoveryActive = setInventoryRecoveryActive;
window.isInventoryRecoveryActive = isInventoryRecoveryActive;
window.clearInventoryRecovery = clearInventoryRecovery;
Object.defineProperty(window, "inventoryRecoveryActive", {
  get: () => inventoryRecoveryActive,
  set: (val) => {
    inventoryRecoveryActive = !!val;
  },
  configurable: true,
});

/**
 * STRK-13: Show the sticky inventory recovery banner above the inventory
 * table section. Idempotent — re-invocation is a no-op when the banner
 * already exists. Banner is built with createElement / textContent (no
 * innerHTML) and stays visible until the user clicks Dismiss or Open Cloud
 * Settings.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.cloudConnected] - When true, copy directs the user
 *   toward cloud restore; when false/undefined, copy directs toward refresh
 *   or local backup import.
 */
const showInventoryRecoveryBanner = ({ cloudConnected } = {}) => {
  if (typeof document === "undefined") return;
  // safeGetElement returns a truthy dummy on miss, so use document.getElementById
  // for these existence checks where null matters.
  if (document.getElementById("inventoryRecoveryBanner")) return;
  const tableSection = document.getElementById("tableSectionEl");
  if (!tableSection || !tableSection.parentNode) return;

  const copyConnected =
    "Your inventory could not be loaded from this device. Restore from your cloud backup, or refresh and try again. Your local data was not modified.";
  const copyDisconnected =
    "Your inventory could not be loaded from this device. Refresh and try again, or import a backup file. Your local data was not modified.";

  const banner = document.createElement("div");
  banner.id = "inventoryRecoveryBanner";
  banner.className = "inventory-recovery-banner";
  banner.setAttribute("role", "alert");

  const icon = document.createElement("span");
  icon.className = "inventory-recovery-banner__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "⚠";

  const copy = document.createElement("p");
  copy.className = "inventory-recovery-banner__copy";
  copy.textContent = cloudConnected ? copyConnected : copyDisconnected;

  const actions = document.createElement("div");
  actions.className = "inventory-recovery-banner__actions";

  const primaryBtn = document.createElement("button");
  primaryBtn.type = "button";
  primaryBtn.className = "inventory-recovery-banner__btn inventory-recovery-banner__btn--primary";
  primaryBtn.textContent = "Open Cloud Settings";
  primaryBtn.addEventListener("click", () => {
    if (typeof showSettingsModal === "function") {
      showSettingsModal("cloud");
    }
    clearInventoryRecovery();
  });

  const secondaryBtn = document.createElement("button");
  secondaryBtn.type = "button";
  secondaryBtn.className =
    "inventory-recovery-banner__btn inventory-recovery-banner__btn--secondary";
  secondaryBtn.textContent = "Dismiss";
  secondaryBtn.addEventListener("click", () => {
    clearInventoryRecovery();
  });

  actions.appendChild(primaryBtn);
  actions.appendChild(secondaryBtn);
  banner.appendChild(icon);
  banner.appendChild(copy);
  banner.appendChild(actions);

  tableSection.parentNode.insertBefore(banner, tableSection);
};

const dismissInventoryRecoveryBanner = () => {
  if (typeof document === "undefined") return;
  // safeGetElement returns a truthy dummy on miss; use document.getElementById so
  // banner.parentNode is null when absent and the removeChild guard works correctly.
  const banner = document.getElementById("inventoryRecoveryBanner");
  if (banner && banner.parentNode) {
    banner.parentNode.removeChild(banner);
  }
};

window.showInventoryRecoveryBanner = showInventoryRecoveryBanner;
window.dismissInventoryRecoveryBanner = dismissInventoryRecoveryBanner;

/**
 * Invalidates the cached item index map.
 * Should be called whenever the inventory array is mutated (add/remove/reorder).
 */
const invalidateItemIndexMap = () => {
  _cachedItemIndexMap = null;
};

/**
 * Retrieves or builds the cached item index map.
 * @returns {Map<Object, number>} Map of item objects to their indices
 */
const getItemIndexMap = () => {
  if (_cachedItemIndexMap) return _cachedItemIndexMap;

  _cachedItemIndexMap = new Map();
  // Build map: key = item object reference, value = index in main inventory array
  for (let j = 0; j < inventory.length; j++) {
    _cachedItemIndexMap.set(inventory[j], j);
  }
  return _cachedItemIndexMap;
};

// Backup/restore functions extracted to inventory-backup.js

// =============================================================================

// Note: catalogMap is now managed by catalogManager class
// No need for the global catalogMap variable anymore

const getNextSerial = () => {
  const next = parseInt(loadDataSync(SERIAL_KEY, 0), 10) + 1;
  saveDataSync(SERIAL_KEY, next);
  return next;
};
window.getNextSerial = getNextSerial;

/**
 * Saves current inventory to localStorage
 */
const saveInventory = async () => {
  // STRK-13: Suppress automatic writes during recovery mode. Cleared by the
  // recovery banner's actions or by the first explicit user-driven mutation
  // (add/import/restore — see task 8 wiring).
  if (inventoryRecoveryActive) {
    if (typeof debugLog === "function") {
      debugLog("saveInventory: suppressed (recovery mode active — explicit user action required)");
    }
    return;
  }

  // Invalidate cached index map as inventory has likely changed
  invalidateItemIndexMap();

  migrateLegacySilverbackWeightUnit(inventory);
  await saveData(LS_KEY, inventory);
  // CatalogManager handles its own saving, no need to explicitly save catalogMap
  // STACK-62: Invalidate autocomplete cache so lookup table rebuilds with current inventory
  if (typeof clearLookupCache === "function") clearLookupCache();
  // STAK-149: Trigger debounced cloud auto-sync push (no-op if sync disabled or not connected)
  if (typeof scheduleSyncPush === "function") scheduleSyncPush();
};

/**
 * Synchronous, success-detecting equivalent of saveInventory() for the
 * partial-disposition two-phase commit path. Returns true on full success,
 * false on any failure (including recovery mode active). Never throws.
 * STRK-44: REQ-7.1 cloud propagation depends on this calling scheduleSyncPush.
 */
const tryPersistInventory = () => {
  // STRK-13: Suppress writes during recovery mode
  if (inventoryRecoveryActive) {
    if (typeof debugLog === "function") {
      debugLog(
        "tryPersistInventory: suppressed (recovery mode active — explicit user action required)"
      );
    }
    return false;
  }

  // Invalidate cached index map as inventory has likely changed
  invalidateItemIndexMap();

  migrateLegacySilverbackWeightUnit(inventory);

  try {
    localStorage.setItem(LS_KEY, __compressIfNeeded(JSON.stringify(inventory)));
  } catch (e) {
    if (typeof debugLog === "function") {
      debugLog("tryPersistInventory: inventory write failed", e);
    }
    if (e && e.name === "QuotaExceededError" && typeof showToast === "function") {
      showToast("Storage is full — partial disposition was not saved.", "error");
    }
    return false;
  }
  // Timestamp is best-effort: failure here must NOT trigger caller rollback because inventory
  // is already persisted. A stale timestamp causes sync to re-sync harmlessly on next change.
  try {
    localStorage.setItem("cloud_sync_local_modified", new Date().toISOString());
  } catch (_) {
    if (typeof debugLog === "function")
      debugLog("tryPersistInventory: timestamp write skipped (quota)");
  }

  // STACK-62: Invalidate autocomplete cache so lookup table rebuilds with current inventory
  if (typeof clearLookupCache === "function") clearLookupCache();
  // STAK-149: Trigger debounced cloud auto-sync push (no-op if sync disabled or not connected)
  if (typeof scheduleSyncPush === "function") scheduleSyncPush();

  return true;
};
window.tryPersistInventory = tryPersistInventory;

/**
 * Removes non-alphanumeric characters from inventory records.
 *
 * @returns {void}
 */
const sanitizeTablesOnLoad = () => {
  inventory = inventory.map((item) => sanitizeObjectFields(item));
  invalidateItemIndexMap();
};

const migrateLegacySilverbackWeightUnit = (items) => {
  if (!Array.isArray(items)) return false;
  let migrated = false;
  items.forEach((item) => {
    const isSilverback =
      item && typeof item.type === "string" && item.type.trim().toLowerCase() === "silverback";
    if (isSilverback && item.weightUnit === "gb") {
      item.weightUnit = "sb";
      migrated = true;
    }
  });
  return migrated;
};
window.migrateLegacySilverbackWeightUnit = migrateLegacySilverbackWeightUnit;

/**
 * Loads inventory from localStorage with comprehensive data migration
 *
 * This function handles backwards compatibility by:
 * - Loading existing inventory data from localStorage
 * - Migrating legacy records that may be missing newer fields
 * - Calculating premiums for older records that lack this data
 * - Ensuring all records have required fields with sensible defaults
 * - Preserving existing user data while adding new functionality
 *
 * @returns {void} Updates the global inventory array with migrated data
 * @throws {Error} Logs errors to console if localStorage access fails
 */
const loadInventory = async () => {
  try {
    const data = await loadData(LS_KEY, []);

    // Ensure data is an array
    if (!Array.isArray(data)) {
      console.warn("Inventory data is not an array, resetting to empty array");
      inventory = [];
      invalidateItemIndexMap();
      return;
    }

    // Migrate legacy data to include new fields
    inventory = data.map((item) => {
      let normalized;
      // Handle legacy data that might not have all fields
      if (item.premiumPerOz === undefined) {
        // For legacy items, calculate premium if possible
        const metalConfig =
          Object.values(METALS).find((m) => m.name === item.metal) || METALS.SILVER;
        const spotPrice = spotPrices[metalConfig.key];

        const premiumPerOz = spotPrice > 0 ? item.price / item.weight - spotPrice : 0;
        const totalPremium = premiumPerOz * item.qty * item.weight;

        normalized = {
          ...item,
          type: normalizeType(item.type),
          purchaseLocation: item.purchaseLocation || "",
          storageLocation: item.storageLocation || "",
          notes: item.notes || "",
          marketValue: item.marketValue || 0,
          year: item.year || item.issuedYear || "",
          grade: item.grade || "",
          gradingAuthority: item.gradingAuthority || "",
          certNumber: item.certNumber || "",
          pcgsNumber: item.pcgsNumber || "",
          pcgsVerified: item.pcgsVerified || false,
          spotPriceAtPurchase: spotPrice,
          premiumPerOz,
          totalPremium,
          composition: item.composition || item.metal || "",
          purity: parseFloat(item.purity) || 1.0,
        };
      } else {
        // Ensure all items have required properties
        normalized = {
          ...item,
          type: normalizeType(item.type),
          purchaseLocation: item.purchaseLocation || "",
          storageLocation: item.storageLocation || "",
          notes: item.notes || "",
          marketValue: item.marketValue || 0,
          year: item.year || item.issuedYear || "",
          grade: item.grade || "",
          gradingAuthority: item.gradingAuthority || "",
          certNumber: item.certNumber || "",
          pcgsNumber: item.pcgsNumber || "",
          pcgsVerified: item.pcgsVerified || false,
          composition: item.composition || item.metal || "",
          purity: parseFloat(item.purity) || 1.0,
        };
      }
      return sanitizeImportedItem(normalized);
    });
    const migratedSilverbackWeightUnits = migrateLegacySilverbackWeightUnit(inventory);
    if (migratedSilverbackWeightUnits) {
      await saveData(LS_KEY, inventory);
    }

    let serialCounter = parseInt(loadDataSync(SERIAL_KEY, 0), 10);

    // Process each inventory item: assign serials and sync with catalog manager
    inventory.forEach((item) => {
      // Assign serial numbers to items that don't have them
      if (!item.serial) {
        serialCounter += 1;
        item.serial = serialCounter;
      }

      // Assign UUIDs to items that don't have them (migration for existing data)
      if (!item.uuid) {
        item.uuid = generateUUID();
      }

      // Use CatalogManager to synchronize numistaId
      catalogManager.syncItem(item);
    });

    // Save updated serial counter
    saveDataSync(SERIAL_KEY, serialCounter);

    // Clean up any orphaned catalog mappings
    if (typeof catalogManager.cleanupOrphans === "function") {
      const removed = catalogManager.cleanupOrphans(inventory);
      if (removed > 0 && DEBUG) {
        console.log(`Removed ${removed} orphaned catalog mappings`);
      }
    }

    // Invalidate cache after loading fresh data
    invalidateItemIndexMap();
  } catch (error) {
    console.error("Error loading inventory:", error);
    inventory = [];
    invalidateItemIndexMap();
  }
};

/**
 * Enhanced validation for inline edits with comprehensive field support
 * @param {string} field - Field being edited
 * @param {string} value - Proposed value
 * @returns {boolean} Whether value is valid
 */
const validateFieldValue = (field, value) => {
  const trimmedValue = typeof value === "string" ? value.trim() : String(value).trim();

  switch (field) {
    case "qty":
      const qty = parseInt(value, 10);
      return /^\d+$/.test(value) && qty > 0 && qty <= 999999;

    case "weight":
      const weight = parseFloat(value);
      return !isNaN(weight) && weight > 0 && weight <= 999999;

    case "price":
    case "marketValue":
      const price = parseFloat(value);
      return !isNaN(price) && price >= 0 && price <= 999999999;

    case "name":
      return trimmedValue.length > 0 && trimmedValue.length <= 200;

    case "purchaseLocation":
    case "storageLocation":
      return trimmedValue.length <= 100; // Allow empty for optional fields

    case "notes":
      return trimmedValue.length <= 1000; // Allow long notes but with limit

    case "date":
      if (!trimmedValue) return false;
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(trimmedValue)) return false;
      const date = new Date(trimmedValue);
      const today = new Date();
      const minDate = new Date("1900-01-01");
      return date >= minDate && date <= today;

    case "type":
      return VALID_TYPES.includes(trimmedValue);

    case "metal":
      const validMetals = ["Silver", "Gold", "Platinum", "Palladium"];
      return validMetals.includes(trimmedValue);

    default:
      return true;
  }
};

/**
 * Enhanced inline editing for table cells with support for multiple field types
 * @param {number} idx - Index of item to edit
 * @param {string} field - Field name to update
 * @param {HTMLElement} element - The td cell or a child element within it
 */
const startCellEdit = (idx, field, element) => {
  const td = element.tagName === "TD" ? element : element.closest("td");
  const item = inventory[idx];
  const current = item[field] ?? "";
  const originalContent = td.innerHTML;

  // Close any other open editors (fix for closing all editors issue)
  const allOpenEditors = document.querySelectorAll("td.editing");
  allOpenEditors.forEach((editor) => {
    if (editor !== td) {
      const cancelBtn = editor.querySelector(".cancel-inline");
      if (cancelBtn) cancelBtn.click();
    }
  });

  td.classList.add("editing");

  let input;

  // Create appropriate input type based on field
  if (["type", "metal"].includes(field)) {
    input = document.createElement("select");
    input.className = "inline-select";

    if (field === "type") {
      VALID_TYPES.forEach((type) => {
        const option = document.createElement("option");
        option.value = type;
        option.textContent = type;
        if (type === current) option.selected = true;
        input.appendChild(option);
      });
      // Filter type options based on the item's metal (T21)
      if (typeof TYPE_METAL_FILTER !== "undefined") {
        Array.from(input.options).forEach((option) => {
          const allowedMetals = TYPE_METAL_FILTER[option.value];
          if (Array.isArray(allowedMetals) && !allowedMetals.includes(item.metal)) {
            option.hidden = true;
            option.disabled = true;
          }
        });
      }
    } else if (field === "metal") {
      const metals = ["Silver", "Gold", "Platinum", "Palladium", "Alloy/Other"];
      metals.forEach((metal) => {
        const option = document.createElement("option");
        option.value = metal;
        option.textContent = metal;
        if (metal === current) option.selected = true;
        input.appendChild(option);
      });
    }
  } else {
    input = document.createElement("input");
    input.className = "inline-input";

    if (field === "qty") {
      input.type = "number";
      input.step = "1";
      input.min = "1";
    } else if (["weight", "price", "marketValue"].includes(field)) {
      input.type = "number";
      input.step = "0.01";
      input.min = "0";
    } else if (field === "date") {
      input.type = "date";
    } else {
      input.type = "text";
    }

    // Set input value based on field type
    if (field === "weight" && item.weightUnit === "kg") {
      input.value = oztToKg(current).toFixed(4);
      input.dataset.unit = "kg";
    } else if (field === "weight" && item.weightUnit === "lb") {
      input.value = oztToLb(current).toFixed(4);
      input.dataset.unit = "lb";
    } else if (field === "weight" && (item.weightUnit === "g" || item.weight < 1)) {
      input.value = oztToGrams(current).toFixed(2);
      input.dataset.unit = "g";
    } else if (["weight", "price", "marketValue"].includes(field)) {
      input.value = parseFloat(current || 0).toFixed(2);
      if (field === "weight") input.dataset.unit = "oz";
    } else {
      input.value = current;
    }
  }

  td.innerHTML = "";
  td.appendChild(input);

  const cancelEdit = () => {
    td.classList.remove("editing");
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
    td.innerHTML = originalContent;
  };

  const saveEdit = () => {
    const value = input.value;
    if (!validateFieldValue(field, value)) {
      appAlert(`Invalid value for ${field}`);
      cancelEdit();
      return;
    }

    let finalValue;
    if (field === "qty") {
      finalValue = parseInt(value, 10);
    } else if (["weight", "price", "marketValue"].includes(field)) {
      finalValue = parseFloat(value);
      if (field === "weight" && input.dataset.unit === "g") {
        finalValue = gramsToOzt(finalValue);
      } else if (field === "weight" && input.dataset.unit === "kg") {
        finalValue = kgToOzt(finalValue);
      } else if (field === "weight" && input.dataset.unit === "lb") {
        finalValue = lbToOzt(finalValue);
      }
    } else {
      finalValue = value.trim();
    }

    // Store the old value for change logging
    const oldValue = item[field];
    item[field] = finalValue;

    // Log the change
    if (typeof logChange === "function") {
      logChange(item.name || `Item ${idx + 1}`, field, oldValue, finalValue, idx);
    }

    saveInventory();

    // Record price data point for inline edits on price-related fields (STACK-43)
    if (
      typeof recordSingleItemPrice === "function" &&
      ["price", "marketValue", "weight", "qty"].includes(field)
    ) {
      recordSingleItemPrice(item, "edit");
    }

    renderTable();
  };

  // Keyboard-only: Enter saves, Escape cancels
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  });

  // Cancel on blur (clicking away from the input)
  input.addEventListener("blur", () => {
    cancelEdit();
  });

  input.focus();
  if (input.select) input.select();
};

window.startCellEdit = startCellEdit;

// hideEmptyColumns, thumbnail helpers, renderTable, updateSummary extracted to inventory-table.js

/**
 * Opens the combined Remove Item modal (STAK-72).
 * Handles both delete and dispose flows via checkbox toggle.
 *
 * @param {number} idx - Index of item to remove
 * @param {boolean} [preDispose=false] - Pre-check the dispose checkbox
 */
let _removeItemQtyPreviewHandler = null;
let _confirmRemoveItemInFlight = false;
const DISPOSE_QTY_CHIP_MAX = 8;
let _removeItemQtyChipKeyHandler = null;
let _removeItemQtySelectChangeHandler = null;

const writeDisposeQty = (n) => {
  const el = safeGetElement("removeItemQty");
  if (!(el instanceof HTMLElement)) return;
  el.value = String(n);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const renderDisposeQtyChips = (stackQty, labelMaxEl) => {
  const chipsEl = safeGetElement("removeItemQtyChips");
  const selectEl = safeGetElement("removeItemQtySelect");
  if (!chipsEl || !selectEl) return;

  chipsEl.innerHTML = "";
  chipsEl.className = "chip-sort-toggle chip-sort-toggle--quantity";
  chipsEl.style.display = "";
  selectEl.style.display = "none";

  if (labelMaxEl) labelMaxEl.textContent = ` (max ${stackQty})`;

  if (stackQty === 1) {
    chipsEl.classList.add("is-disabled");
    chipsEl.setAttribute("aria-disabled", "true");
  } else {
    chipsEl.classList.remove("is-disabled");
    chipsEl.removeAttribute("aria-disabled");
  }

  const selectChip = (n) => {
    const disabled = chipsEl.classList.contains("is-disabled");
    for (const btn of chipsEl.children) {
      const active = btn.dataset.qty === String(n);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.tabIndex = active ? 0 : -1;
      btn.classList.toggle("active", active);
    }
    writeDisposeQty(n);
    if (!disabled) {
      chipsEl.querySelector(`[data-qty="${n}"]`)?.focus();
    }
  };

  for (let n = 1; n <= stackQty; n++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-sort-btn";
    btn.dataset.qty = String(n);
    btn.textContent = String(n);
    btn.setAttribute("aria-label", `Dispose ${n} of ${stackQty}`);
    const isLast = n === stackQty;
    btn.setAttribute("aria-pressed", isLast ? "true" : "false");
    btn.tabIndex = isLast ? 0 : -1;
    if (isLast) btn.classList.add("active");
    btn.addEventListener("click", () => selectChip(n));
    chipsEl.appendChild(btn);
  }

  if (_removeItemQtyChipKeyHandler) {
    chipsEl.removeEventListener("keydown", _removeItemQtyChipKeyHandler);
  }
  _removeItemQtyChipKeyHandler = (event) => {
    if (chipsEl.classList.contains("is-disabled")) return;
    const chips = Array.from(chipsEl.children);
    const currentIdx = chips.findIndex((b) => b.tabIndex === 0);
    let targetIdx = currentIdx;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      targetIdx = (currentIdx + 1) % chips.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      targetIdx = (currentIdx - 1 + chips.length) % chips.length;
    } else if (event.key === "Home") {
      targetIdx = 0;
    } else if (event.key === "End") {
      targetIdx = chips.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const parsedQty = Number(chips[targetIdx].dataset.qty);
    selectChip(Number.isNaN(parsedQty) ? 1 : parsedQty);
  };
  chipsEl.addEventListener("keydown", _removeItemQtyChipKeyHandler);

  writeDisposeQty(stackQty);
  if (!chipsEl.classList.contains("is-disabled")) {
    chipsEl.querySelector(`[data-qty="${stackQty}"]`)?.focus();
  }
};

const renderDisposeQtySelect = (stackQty, labelMaxEl) => {
  const chipsEl = safeGetElement("removeItemQtyChips");
  const selectEl = safeGetElement("removeItemQtySelect");
  if (!chipsEl || !selectEl) return;

  chipsEl.style.display = "none";
  selectEl.style.display = "";

  if (labelMaxEl) labelMaxEl.textContent = ` (max ${stackQty})`;

  selectEl.innerHTML = "";
  for (let n = 1; n <= stackQty; n++) {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = String(n);
    if (n === stackQty) opt.selected = true;
    selectEl.appendChild(opt);
  }

  if (_removeItemQtySelectChangeHandler) {
    selectEl.removeEventListener("change", _removeItemQtySelectChangeHandler);
  }
  _removeItemQtySelectChangeHandler = (e) => writeDisposeQty(parseInt(e.target.value, 10));
  selectEl.addEventListener("change", _removeItemQtySelectChangeHandler);

  writeDisposeQty(stackQty);
  selectEl.focus();
};

const openRemoveItemModal = (idx, preDispose = false) => {
  const item = inventory[idx];
  if (!item) return;

  if (!item.uuid && typeof generateUUID === "function") {
    item.uuid = generateUUID();
    saveInventory();
  }

  const idxInput = safeGetElement("removeItemIdx");
  if (idxInput) idxInput.value = idx;

  const nameEl = safeGetElement("removeItemName");
  if (nameEl) nameEl.textContent = item.name || "Unnamed item";

  // Show attachment deletion warning (STRK-45)
  const attachWarn = safeGetElement("removeItemAttachmentWarn");
  if (attachWarn) {
    const count = item.attachments?.length || 0;
    if (count > 0) {
      attachWarn.textContent = `${count} attachment${count === 1 ? "" : "s"} will also be deleted.`;
      attachWarn.style.display = "";
    } else {
      attachWarn.style.display = "none";
    }
  }

  const checkbox = safeGetElement("removeItemDisposeCheck");
  const fieldsWrap = safeGetElement("removeItemDisposeFields");
  const deleteBtn = safeGetElement("removeItemDeleteBtn");
  const disposeBtn = safeGetElement("removeItemDisposeBtn");

  // Reset disposition fields
  const typeSelect = safeGetElement("dispositionType");
  if (typeSelect) typeSelect.value = "sold";
  const dateInput = safeGetElement("dispositionDate");
  if (dateInput) dateInput.value = new Date().toLocaleDateString("en-CA");
  const amountInput = safeGetElement("dispositionAmount");
  if (amountInput) amountInput.value = "";
  const recipientInput = safeGetElement("dispositionRecipient");
  if (recipientInput) recipientInput.value = "";
  const notesInput = safeGetElement("dispositionNotes");
  if (notesInput) notesInput.value = "";
  const amountGroup = safeGetElement("dispositionAmountGroup");
  if (amountGroup) amountGroup.style.display = "";
  window.resetPendingTradeLinks?.();
  const tradeSection = safeGetElement("tradeLinkSection");
  if (tradeSection) tradeSection.style.display = "none";

  // Reset partial-dispose fields
  const qtyInput = safeGetElement("removeItemQty");
  const previewEl = safeGetElement("removeItemDisposePreview");
  const qtyGroup = qtyInput?.closest(".form-group");
  if (qtyInput) qtyInput.value = "";
  if (previewEl) {
    previewEl.textContent = "";
    previewEl.style.display = "none";
  }

  const stackQty = Number(item.qty) || 1;

  // STRK-53: control is always visible — qty=1 shows pre-selected, dimmed.
  if (qtyGroup) qtyGroup.style.display = "";
  const labelMaxEl = safeGetElement("removeItemQtyLabelMax");
  if (stackQty <= DISPOSE_QTY_CHIP_MAX) {
    renderDisposeQtyChips(stackQty, labelMaxEl);
  } else {
    renderDisposeQtySelect(stackQty, labelMaxEl);
  }
  // qtyInput.value is set by writeDisposeQty inside the helpers; no direct write here.

  window.disposeAmountToggle?.setMode("each", { convertInput: false });
  window.disposeAmountToggle?.updateVisibility();

  // Wire live preview — remove any prior listener first
  if (qtyInput) {
    if (_removeItemQtyPreviewHandler) {
      qtyInput.removeEventListener("input", _removeItemQtyPreviewHandler);
    }
    _removeItemQtyPreviewHandler = () => {
      const entered = parseInt(qtyInput.value, 10);
      if (!previewEl) return;
      if (!Number.isFinite(entered) || entered < 1 || entered >= stackQty) {
        previewEl.style.display = "none";
        previewEl.textContent = "";
      } else {
        const remaining = stackQty - entered;
        previewEl.textContent = `Disposing ${entered} of ${stackQty} — ${remaining} will remain in active inventory`;
        previewEl.style.display = "";
      }
    };
    qtyInput.addEventListener("input", _removeItemQtyPreviewHandler);
  }

  // Set checkbox state and toggle fields/buttons
  if (checkbox) checkbox.checked = preDispose;
  if (fieldsWrap) fieldsWrap.style.display = preDispose ? "" : "none";
  if (deleteBtn) deleteBtn.style.display = preDispose ? "none" : "";
  if (disposeBtn) disposeBtn.style.display = preDispose ? "" : "none";

  openModalById("removeItemModal");
};

const deleteItem = (idx) => {
  openRemoveItemModal(idx, false);
};

const disposeItem = (idx) => {
  const item = inventory[idx];
  if (!item || isDisposed(item)) return;
  openRemoveItemModal(idx, true);
};

const pushTradeLinkChange = (disposedItem, receivedItem, oldValue, newValue) => {
  changeLog.push({
    timestamp: Date.now(),
    itemName: disposedItem?.name || receivedItem?.name || "Trade link",
    field: "tradeLink",
    oldValue: JSON.stringify(oldValue || null),
    newValue: JSON.stringify(newValue || null),
    idx: inventory.indexOf(disposedItem),
    undone: false,
    itemKey: disposedItem?.uuid || "",
    type: "item-edit",
  });
  if (typeof tryPersistChangeLog === "function") tryPersistChangeLog();
};

const removeTradeLinkReference = (disposedItem, receivedUuid, { log = true } = {}) => {
  if (!disposedItem?.disposition) return;
  const receivedItem = typeof findItemByUuid === "function" ? findItemByUuid(receivedUuid) : null;
  const before = {
    disposedUuid: disposedItem.uuid,
    receivedUuid,
    tradedForUuids: [...(disposedItem.disposition.tradedForUuids || [])],
    tradeValue: disposedItem.disposition.tradeValues?.[receivedUuid] || null,
    tradedFromUuid: receivedItem?.tradedFromUuid === disposedItem.uuid ? disposedItem.uuid : null,
  };
  disposedItem.disposition.tradedForUuids = (disposedItem.disposition.tradedForUuids || []).filter(
    (uuid) => uuid !== receivedUuid
  );
  if (disposedItem.disposition.tradeValues) {
    delete disposedItem.disposition.tradeValues[receivedUuid];
    if (Object.keys(disposedItem.disposition.tradeValues).length === 0) {
      delete disposedItem.disposition.tradeValues;
    }
  }
  if (disposedItem.disposition.tradedForUuids.length === 0) {
    delete disposedItem.disposition.tradedForUuids;
  }
  if (receivedItem?.tradedFromUuid === disposedItem.uuid) delete receivedItem.tradedFromUuid;
  if (log) {
    pushTradeLinkChange(disposedItem, receivedItem, before, {
      disposedUuid: disposedItem.uuid,
      receivedUuid,
      action: "unlink",
      tradedForUuids: disposedItem.disposition.tradedForUuids
        ? [...disposedItem.disposition.tradedForUuids]
        : [],
      tradedFromUuid: null,
    });
  }
};

const linkTradeItems = async (disposedItem, receivedUuids, tradeDate) => {
  if (!disposedItem?.disposition || !Array.isArray(receivedUuids)) return [];
  if (!Array.isArray(disposedItem.disposition.tradedForUuids)) {
    disposedItem.disposition.tradedForUuids = [];
  }
  if (!disposedItem.disposition.tradeValues) disposedItem.disposition.tradeValues = {};
  const linked = [];
  for (const receivedUuid of receivedUuids.filter(Boolean)) {
    const receivedItem = typeof findItemByUuid === "function" ? findItemByUuid(receivedUuid) : null;
    if (!receivedItem || receivedItem.uuid === disposedItem.uuid) continue;
    if (receivedItem.tradedFromUuid && receivedItem.tradedFromUuid !== disposedItem.uuid) {
      const proceed =
        typeof showAppConfirm === "function"
          ? await showAppConfirm(
              `"${receivedItem.name}" is already linked to another trade. Reassign it?`,
              "Reassign Trade Link"
            )
          : false;
      if (!proceed) continue;
      const oldSource =
        typeof findItemByUuid === "function" ? findItemByUuid(receivedItem.tradedFromUuid) : null;
      removeTradeLinkReference(oldSource, receivedUuid);
    }
    const before = {
      disposedUuid: disposedItem.uuid,
      receivedUuid,
      tradedForUuids: [...disposedItem.disposition.tradedForUuids],
      tradedFromUuid: receivedItem.tradedFromUuid || null,
    };
    if (!disposedItem.disposition.tradedForUuids.includes(receivedUuid)) {
      disposedItem.disposition.tradedForUuids.push(receivedUuid);
    }
    const tradeValue =
      typeof computeTradeValue === "function" ? computeTradeValue(receivedItem, tradeDate) : null;
    if (tradeValue) disposedItem.disposition.tradeValues[receivedUuid] = tradeValue;
    receivedItem.tradedFromUuid = disposedItem.uuid;

    // STRK-132: cost basis = given-up item's value at trade date (carryover),
    // NOT the FMV of the received item. Matches the "what did I pay?" mental
    // model consistent with cash purchases.
    const givenUpTradeValue =
      typeof computeTradeValue === "function" ? computeTradeValue(disposedItem, tradeDate) : null;
    const givenUpValue =
      givenUpTradeValue?.meltValue || parseFloat(disposedItem.disposition.amount) || 0;
    if (givenUpValue > 0 && receivedUuids.length > 0) {
      receivedItem.price = String(givenUpValue / receivedUuids.length);
      receivedItem.date = tradeDate || disposedItem.disposition.date || "";
    }

    pushTradeLinkChange(disposedItem, receivedItem, before, {
      disposedUuid: disposedItem.uuid,
      receivedUuid,
      tradedForUuids: [...disposedItem.disposition.tradedForUuids],
      tradedFromUuid: disposedItem.uuid,
      tradeValue: disposedItem.disposition.tradeValues[receivedUuid] || null,
    });
    linked.push(receivedUuid);
  }
  if (Object.keys(disposedItem.disposition.tradeValues).length === 0) {
    delete disposedItem.disposition.tradeValues;
  }
  return linked;
};

const unlinkTradeItem = (disposedItem, receivedUuid) => {
  removeTradeLinkReference(disposedItem, receivedUuid);
  saveInventory();
  if (typeof renderChangeLog === "function") renderChangeLog();
};

const updateTradeLinks = async (disposedItem, newUuids) => {
  if (!disposedItem?.disposition) return;
  const oldUuids = [...(disposedItem.disposition.tradedForUuids || [])];
  const removed = oldUuids.filter((u) => !newUuids.includes(u));
  const added = newUuids.filter((u) => !oldUuids.includes(u));
  removed.forEach((uuid) => removeTradeLinkReference(disposedItem, uuid));
  if (added.length > 0) {
    const tradeDate = disposedItem.disposition.date || "";
    await linkTradeItems(disposedItem, added, tradeDate);
  }
  saveInventory();
  if (typeof renderChangeLog === "function") renderChangeLog();
  if (typeof renderTable === "function") renderTable();
};

const clearTradeLinks = (disposedItem) => {
  const linked = [...(disposedItem?.disposition?.tradedForUuids || [])];
  linked.forEach((uuid) => removeTradeLinkReference(disposedItem, uuid));
};

/**
 * Confirms removal from the combined Remove Item modal (STAK-72).
 * Reads checkbox state to decide between plain delete and disposition.
 */
const confirmRemoveItem = async () => {
  if (_confirmRemoveItemInFlight) return;
  _confirmRemoveItemInFlight = true;
  try {
    const idxInput = safeGetElement("removeItemIdx");
    const idx = parseInt(idxInput?.value, 10);
    if (isNaN(idx) || !inventory[idx]) return;

    const item = inventory[idx];
    const checkbox = safeGetElement("removeItemDisposeCheck");
    const isDispose = checkbox?.checked;

    if (isDispose) {
      // Disposition flow — validate fields
      const type = safeGetElement("dispositionType")?.value;
      const date = safeGetElement("dispositionDate")?.value;
      const recipient = safeGetElement("dispositionRecipient")?.value?.trim() || "";
      const notes = safeGetElement("dispositionNotes")?.value?.trim() || "";

      if (!type || !DISPOSITION_TYPES[type]) {
        showToast("Please select a disposition type.");
        return;
      }
      if (!date) {
        showToast("Please enter a disposition date.");
        return;
      }

      // Determine disposed quantity
      const qtyInputEl = safeGetElement("removeItemQty");
      const qtyHidden = !qtyInputEl || qtyInputEl.closest(".form-group")?.style.display === "none";
      let disposedQty;
      if (qtyHidden || qtyInputEl.value === "") {
        disposedQty = Number(item.qty) || 1;
      } else {
        disposedQty = Number(qtyInputEl.value);
        // STRK-53: defense-in-depth. The chip/<select> UI does not expose a path to a non-integer
        // value. This branch is reachable only via programmatic DOM access — keep as a safety net.
        if (!Number.isInteger(disposedQty)) {
          showToast("Please enter a whole number quantity to dispose.");
          return;
        }
      }

      // STRK-53: defense-in-depth. Same reasoning as above — out-of-range values are not
      // selectable through the UI.
      if (
        !Number.isFinite(disposedQty) ||
        disposedQty < 1 ||
        disposedQty > (Number(item.qty) || 1)
      ) {
        showToast("Please enter a valid quantity to dispose.");
        return;
      }

      // Read amount — resolve lot/each
      const amountMode = window.disposeAmountToggle?.getMode() ?? "each";
      const rawAmount = parseFloat(safeGetElement("dispositionAmount")?.value ?? "");
      let resolvedAmount;
      if (!Number.isFinite(rawAmount)) {
        resolvedAmount = undefined;
      } else if (amountMode === "each") {
        resolvedAmount = rawAmount * disposedQty;
      } else {
        resolvedAmount = rawAmount;
      }

      if (
        DISPOSITION_TYPES[type].requiresAmount &&
        (resolvedAmount == null || resolvedAmount <= 0)
      ) {
        showToast("Please enter a sale/trade/refund amount.");
        return;
      }

      // Partial-dispose path
      if (disposedQty < (Number(item.qty) || 1)) {
        const dispositionInput = {
          type,
          date,
          amount: resolvedAmount,
          currency: typeof displayCurrency !== "undefined" ? displayCurrency : "USD",
          recipient,
          notes,
          tradedForUuids: window.getPendingTradeLinkUuids?.() || [],
        };
        const result = await splitInventoryItem(idx, disposedQty, dispositionInput);
        if (!result.ok) {
          showToast(`Could not split stack: ${result.error}`);
          return;
        }
        renderTable();
        if (typeof renderChangeLog === "function") renderChangeLog();
        closeModalById("removeItemModal");
        renderActiveFilters();
        updateSummary();
        return;
      }

      // Full-stack path (unchanged)
      const amount = resolvedAmount ?? 0;
      const purchaseTotal = (parseFloat(item.price) || 0) * (Number(item.qty) || 1);
      const realizedGainLoss = amount - purchaseTotal;

      const disposition = {
        type,
        date,
        amount,
        currency: typeof displayCurrency !== "undefined" ? displayCurrency : "USD",
        recipient,
        notes,
        realizedGainLoss,
        disposedAt: new Date().toISOString(),
      };

      inventory[idx].disposition = disposition;
      if (type === "traded") {
        await linkTradeItems(item, window.getPendingTradeLinkUuids?.() || [], date);
      }
      saveInventory();
      closeModalById("removeItemModal");
      logChange(item.name, "Disposed", "", JSON.stringify(disposition), idx);
      showToast(`${item.name} marked as ${DISPOSITION_TYPES[type].label.toLowerCase()}.`);
    } else {
      // Plain delete flow
      inventory.splice(idx, 1);
      saveInventory();
      closeModalById("removeItemModal");
      logChange(item.name, "Deleted", JSON.stringify(item), "", idx);

      // Clean up user images from IndexedDB (STAK-120)
      if (item?.uuid && window.imageCache?.isAvailable()) {
        window.imageCache.deleteUserImage(item.uuid).catch((err) => {
          debugLog(`Failed to delete user images for deleted item: ${err}`);
        });
      }

      // Clean up attachments from IndexedDB (STRK-45)
      if (item?.uuid && window.attachmentManager?.isAvailable()) {
        attachmentManager.deleteAttachmentsForItem(item.uuid).catch((err) => {
          debugLog(`Failed to delete attachments for deleted item: ${err}`);
        });
      }

      // Clean up item tags (STAK-126)
      if (item?.uuid && typeof deleteItemTags === "function") {
        deleteItemTags(item.uuid);
      }
    }

    renderTable();
    renderActiveFilters();
    updateSummary();
  } finally {
    _confirmRemoveItemInFlight = false;
  }
};

/**
 * Restores a disposed item back to active inventory after
 * user confirmation (STAK-72).
 *
 * @param {number} idx - Index of item to restore
 */
const restoreInPlace = async (idx, { skipConfirm = false } = {}) => {
  const item = inventory[idx];
  if (!item || !isDisposed(item)) return;
  const confirmed =
    skipConfirm ||
    (typeof showAppConfirm === "function"
      ? await showAppConfirm(`Restore "${item.name}" to active inventory?`, "Undo Disposition")
      : false);
  if (confirmed) {
    const oldDisposition = JSON.stringify(item.disposition);
    clearTradeLinks(item);
    inventory[idx].disposition = null;
    saveInventory();
    logChange(item.name, "Disposition Undone", oldDisposition, "", idx);
    showToast(`${item.name} restored to active inventory.`);
    renderTable();
    renderActiveFilters();
    updateSummary();
  }
};

const undoDisposition = async (idx) => {
  const item = inventory[idx];
  if (!item || !isDisposed(item)) return;
  const splitFromUuid = item.disposition?.splitFromUuid;
  if (!splitFromUuid) return restoreInPlace(idx);
  const originalIdx = inventory.findIndex((i) => i.uuid === splitFromUuid);
  if (originalIdx === -1 || isDisposed(inventory[originalIdx])) {
    showToast("Original record no longer present; restored as separate row.");
    return restoreInPlace(idx);
  }
  const mergedQty = inventory[originalIdx].qty + item.qty;
  const choice = await window.showRestoreChoice({
    clone: item,
    original: inventory[originalIdx],
    mergedQty,
  });
  if (choice === "cancel") return;
  if (choice === "separate") return restoreInPlace(idx, { skipConfirm: true });

  // Merge two-phase commit
  const inventorySnapshot = structuredClone(inventory);
  const changeLogSnapshot = structuredClone(changeLog);

  const cloneQty = item.qty;
  const cloneName = item.name;
  const cloneUuid = item.uuid;
  clearTradeLinks(item);
  inventory[originalIdx].qty += cloneQty;
  const mergeAdjustedOriginalIdx = idx < originalIdx ? originalIdx - 1 : originalIdx;
  inventory.splice(idx, 1);

  changeLog.push({
    timestamp: Date.now(),
    itemName: cloneName,
    field: "Restored (merged)",
    oldValue: { fromUuid: cloneUuid, qty: cloneQty },
    newValue: {
      intoUuid: inventory[mergeAdjustedOriginalIdx].uuid,
      mergedQty: inventory[mergeAdjustedOriginalIdx].qty,
    },
    idx: mergeAdjustedOriginalIdx,
    undone: false,
  });

  if (!tryPersistInventory()) {
    inventory.length = 0;
    inventorySnapshot.forEach((i) => inventory.push(i));
    changeLog.length = 0;
    changeLogSnapshot.forEach((e) => changeLog.push(e));
    showToast("Couldn't merge — storage failed. Try again.", "error");
    return;
  }

  if (!tryPersistChangeLog()) {
    inventory.length = 0;
    inventorySnapshot.forEach((i) => inventory.push(i));
    changeLog.length = 0;
    changeLogSnapshot.forEach((e) => changeLog.push(e));
    const revertOk = tryPersistInventory();
    if (!revertOk) {
      showToast("Critical: storage failure left state inconsistent. Reload to recover.", "error");
      return;
    }
    showToast("Couldn't save audit log — merge was reverted.", "error");
    return;
  }

  try {
    if (window.imageCache && typeof window.imageCache.deleteUserImage === "function") {
      window.imageCache.deleteUserImage(cloneUuid).catch(() => {});
    }
  } catch (e) {
    if (typeof debugLog === "function") debugLog("undoDisposition merge: image cleanup failed", e);
  }

  renderTable();
  if (typeof renderActiveFilters === "function") renderActiveFilters();
  if (typeof updateSummary === "function") updateSummary();
  if (typeof renderChangeLog === "function") renderChangeLog();
  showToast(
    `${cloneName} merged back into original (${inventory[mergeAdjustedOriginalIdx].qty} total).`
  );
};

const splitInventoryItem = async (originalIdx, disposedQty, dispositionInput) => {
  // 1. Validate
  const original = inventory[originalIdx];
  if (!original) return { ok: false, error: "validation_failed" };
  const qty = parseInt(disposedQty, 10);
  if (!Number.isFinite(qty) || qty < 1 || qty >= original.qty) {
    return { ok: false, error: "validation_failed" };
  }

  // 2. Snapshot
  const inventorySnapshot = structuredClone(inventory);
  const changeLogSnapshot = structuredClone(changeLog);

  // 3. Mutate inventory in memory
  const originalQtyBefore = original.qty;
  inventory[originalIdx].qty -= qty;
  const originalQtyAfter = inventory[originalIdx].qty;

  const clone = structuredClone(original);
  clone.uuid = generateUUID();
  clone.serial = getNextSerial();
  clone.qty = qty;
  const _splitAttachmentMap = new Map();
  clone.attachments = (original.attachments || []).map((a) => {
    const newUuid = generateUUID();
    _splitAttachmentMap.set(a.attachmentUuid, newUuid);
    return { ...a, attachmentUuid: newUuid };
  });
  const disposedAt = new Date().toISOString();
  const pricePerUnit = parseFloat(original.price) || 0;
  const rawTotalAmount =
    dispositionInput.amount != null ? Number(dispositionInput.amount) : undefined;
  const typeInfo =
    typeof DISPOSITION_TYPES !== "undefined" && dispositionInput.type
      ? DISPOSITION_TYPES[dispositionInput.type]
      : null;
  const totalAmount =
    rawTotalAmount != null && Number.isFinite(rawTotalAmount)
      ? rawTotalAmount
      : typeInfo && !typeInfo.requiresAmount
        ? 0
        : undefined;
  const realizedGainLoss =
    totalAmount != null && Number.isFinite(totalAmount)
      ? totalAmount - pricePerUnit * qty
      : undefined;

  clone.disposition = {
    type: dispositionInput.type || null,
    date: dispositionInput.date || null,
    amount: totalAmount,
    currency: dispositionInput.currency || null,
    recipient: dispositionInput.recipient || null,
    notes: dispositionInput.notes || null,
    realizedGainLoss,
    disposedAt,
    splitFromUuid: original.uuid,
  };
  if (Array.isArray(dispositionInput.tradedForUuids) && dispositionInput.tradedForUuids.length) {
    clone.disposition.tradedForUuids = [];
    clone.disposition.tradeValues = {};
  }

  // Insert clone immediately after original
  inventory.splice(originalIdx + 1, 0, clone);
  if (Array.isArray(dispositionInput.tradedForUuids) && dispositionInput.tradedForUuids.length) {
    await linkTradeItems(clone, dispositionInput.tradedForUuids, clone.disposition.date);
  }

  // 4. Build changeLog entries in memory
  const transactionId = disposedAt;
  const splitEntry = {
    timestamp: Date.now(),
    itemName: original.name,
    field: "Stack split",
    oldValue: String(originalQtyBefore),
    newValue: String(originalQtyAfter),
    idx: originalIdx,
    undone: false,
    transactionId,
    transactionLabel: `Stack split: ${originalQtyBefore} → ${originalQtyAfter}`,
    itemKey: original.uuid,
    stackSplit: {
      originalUuid: original.uuid,
      cloneUuid: clone.uuid,
      originalQtyBefore,
      originalQtyAfter,
      disposedQty: qty,
    },
  };
  const disposedEntry = {
    timestamp: Date.now(),
    itemName: clone.name,
    field: "Disposed",
    oldValue: null,
    newValue: JSON.stringify(clone.disposition),
    idx: originalIdx + 1,
    undone: false,
    transactionId,
    transactionLabel: `Disposed: ${qty} of original ${originalQtyBefore}`,
    itemKey: clone.uuid,
    splitDisposed: {
      cloneUuid: clone.uuid,
      originalUuid: original.uuid,
      disposedQty: qty,
      dispositionSnapshot: { ...clone.disposition },
    },
  };
  pushTransactionEntries(splitEntry, disposedEntry);

  // 5. Phase 1 — persist inventory
  if (!tryPersistInventory()) {
    inventory.length = 0;
    inventorySnapshot.forEach((item) => inventory.push(item));
    changeLog.length = 0;
    changeLogSnapshot.forEach((entry) => changeLog.push(entry));
    return { ok: false, error: "storage_failed_inventory" };
  }

  // 6. Phase 2 — persist changeLog
  if (!tryPersistChangeLog()) {
    inventory.length = 0;
    inventorySnapshot.forEach((item) => inventory.push(item));
    changeLog.length = 0;
    changeLogSnapshot.forEach((entry) => changeLog.push(entry));
    const revertOk = tryPersistInventory();
    if (!revertOk) {
      if (typeof showToast === "function") {
        showToast(
          "Storage failure left audit log out of sync — reload the app to recover.",
          "error"
        );
      }
      return { ok: false, error: "storage_failed_both" };
    }
    return { ok: false, error: "storage_failed_changelog" };
  }

  // 7. Copy tags (non-blocking — tag loss is acceptable)
  try {
    if (typeof getItemTags === "function" && typeof addItemTag === "function") {
      const copiedTags = getItemTags(original.uuid);
      let addedTags = false;
      copiedTags.forEach((tag) => {
        if (addItemTag(clone.uuid, tag, false)) addedTags = true;
      });
      if (addedTags && typeof stampTagTimestamp === "function") stampTagTimestamp([clone.uuid]);
      if (typeof saveItemTags === "function") saveItemTags();
    }
  } catch (e) {
    if (typeof debugLog === "function") debugLog("splitInventoryItem: tag copy failed", e);
  }

  // 8. Copy images (non-blocking)
  try {
    if (imageCache && typeof imageCache.getUserImage === "function") {
      const { obverse, reverse } = await imageCache.getUserImage(original.uuid);
      if (obverse || reverse) {
        await imageCache.cacheUserImage(clone.uuid, obverse, reverse);
      }
    }
  } catch (e) {
    if (typeof debugLog === "function") debugLog("splitInventoryItem: image copy failed", e);
  }

  // 9. Copy attachment blobs (non-blocking — missing blobs show derived warning)
  try {
    if (_splitAttachmentMap.size > 0 && window.attachmentManager?.isAvailable()) {
      await window.attachmentManager.copyAttachments(_splitAttachmentMap, clone.uuid);
    }
  } catch (e) {
    if (typeof debugLog === "function") debugLog("splitInventoryItem: attachment copy failed", e);
  }

  if (typeof renderChangeLog === "function") renderChangeLog();

  return { ok: true, originalIdx, cloneIdx: originalIdx + 1, transactionId };
};
window.splitInventoryItem = splitInventoryItem;
window.linkTradeItems = linkTradeItems;
window.unlinkTradeItem = unlinkTradeItem;
window.updateTradeLinks = updateTradeLinks;
window.clearTradeLinks = clearTradeLinks;

/**
 * Opens modal to view and edit an item's notes
 *
 * @param {number} idx - Index of item whose notes to view/edit
 */
const showNotes = (idx) => {
  notesIndex = idx;
  const item = inventory[idx];

  // Add fallbacks and better error handling
  const textareaElement = elements.notesTextarea || safeGetElement("notesTextarea");
  const modalElement = elements.notesModal || safeGetElement("notesModal");

  if (textareaElement) {
    textareaElement.value = item.notes || "";
  } else {
    console.error("Notes textarea element not found");
  }

  if (modalElement) {
    if (window.openModalById) openModalById("notesModal");
    else modalElement.style.display = "flex";
  } else {
    console.error("Notes modal element not found");
  }

  if (textareaElement && textareaElement.focus) {
    textareaElement.focus();
  }
};

/**
 * Populate Numista Data form fields.
 * Priority: item.numistaData (user/saved) > IndexedDB cache (API) > empty.
 * When called from a fresh Numista search, itemData is null and cache is used.
 *
 * @param {string} catalogId - Numista catalog ID (N#)
 * @param {Object} [itemData] - Stored numistaData from the inventory item
 */
const populateNumistaDataFields = (catalogId, itemData, { skipFields = new Set() } = {}) => {
  const set = (id, val) => {
    const el = safeGetElement(id);
    if (el) el.value = val || "";
  };
  const refreshCapsuleSuggestion = () => {
    if (typeof updateCapsuleSuggestion !== "function") return;
    updateCapsuleSuggestion(safeGetElement("numistaDiameter")?.value || "");
  };

  // Field mapping: formId → { itemKey, cacheKey }
  const fieldMap = [
    { id: "numistaCountry", itemKey: "country", cacheKey: "country" },
    { id: "numistaDenomination", itemKey: "denomination", cacheKey: "denomination" },
    { id: "numistaComposition", itemKey: "composition", cacheKey: "composition" },
    { id: "numistaShape", itemKey: "shape", cacheKey: "shape" },
    { id: "numistaDiameter", itemKey: "diameter", cacheKey: "diameter" },
    { id: "numistaThickness", itemKey: "thickness", cacheKey: "thickness" },
    { id: "numistaLength", itemKey: "length", cacheKey: "length" },
    { id: "numistaWidth", itemKey: "width", cacheKey: "width" },
    { id: "numistaOrientation", itemKey: "orientation", cacheKey: "orientation" },
    { id: "numistaTechnique", itemKey: "technique", cacheKey: "technique" },
    { id: "numistaMintage", itemKey: "mintage", cacheKey: null },
    { id: "numistaRarity", itemKey: "rarityIndex", cacheKey: "rarityIndex" },
    { id: "numistaKmRef", itemKey: "kmRef", cacheKey: null },
    { id: "numistaObverseDesc", itemKey: "obverseDesc", cacheKey: "obverseDesc" },
    { id: "numistaReverseDesc", itemKey: "reverseDesc", cacheKey: "reverseDesc" },
    { id: "numistaEdgeDesc", itemKey: "edgeDesc", cacheKey: "edgeDesc" },
  ];

  // Clear all fields (skip preserved fields from picker)
  fieldMap.forEach((f) => {
    if (!skipFields.has(f.itemKey)) set(f.id, "");
  });
  const commCb = safeGetElement("numistaCommemorative");
  const commDescWrap = safeGetElement("numistaCommemorativeDescWrap");
  const commDesc = safeGetElement("numistaCommemorativeDesc");
  if (!skipFields.has("commemorative")) {
    if (commCb) commCb.checked = false;
    if (commDescWrap) commDescWrap.style.display = "none";
    if (commDesc) commDesc.value = "";
  }

  // Apply a data source to the form fields.
  // Only fills fields that are still empty (preserves higher-rank data).
  const applySource = (getData) => {
    fieldMap.forEach((f) => {
      if (skipFields.has(f.itemKey)) return;
      const el = safeGetElement(f.id);
      if (el && !el.value) {
        const val = getData(f);
        if (val) el.value = val;
      }
    });
    // Commemorative
    if (!skipFields.has("commemorative") && commCb && !commCb.checked) {
      const isComm = getData({ itemKey: "commemorative", cacheKey: "commemorative" });
      if (isComm) {
        commCb.checked = true;
        if (commDescWrap) commDescWrap.style.display = "";
        const desc = !skipFields.has("commemorativeDesc")
          ? getData({ itemKey: "commemorativeDesc", cacheKey: "commemorativeDesc" })
          : null;
        if (commDesc && desc) commDesc.value = desc;
      }
    }
  };

  // Layer 1 (highest rank): Item's stored numistaData (user edits persist here)
  if (itemData && Object.keys(itemData).length > 0) {
    applySource((f) => itemData[f.itemKey] || "");
    refreshCapsuleSuggestion();
  }

  // Layer 2 (fallback): IndexedDB cache from API
  if (catalogId && window.imageCache?.isAvailable()) {
    imageCache
      .getMetadata(catalogId)
      .then((meta) => {
        if (!meta) return;
        applySource((f) => {
          if (!f.cacheKey) {
            // Special handling for computed fields
            if (f.itemKey === "mintage" && meta.mintageByYear?.length > 0) {
              const first = meta.mintageByYear[0];
              return typeof first.mintage === "number"
                ? first.mintage.toLocaleString()
                : first.mintage;
            }
            if (f.itemKey === "kmRef" && meta.kmReferences?.length > 0) {
              return meta.kmReferences
                .map((r) =>
                  typeof r === "object" ? `${r.catalogue || "KM"}# ${r.number || ""}` : r
                )
                .join(", ");
            }
            return "";
          }
          return meta[f.cacheKey] || "";
        });
        refreshCapsuleSuggestion();
      })
      .catch(() => {});
  }
};

/**
 * Prepares and displays edit modal for specified inventory item
 *
 * @param {number} idx - Index of item to edit
 */
const editItem = (idx, logIdx = null) => {
  editingIndex = idx;
  editingChangeLogIndex = logIdx;
  const item = inventory[idx];

  // Ensure legacy/seeded records have a stable UUID before tag/image actions.
  if (!item.uuid && typeof generateUUID === "function") {
    item.uuid = generateUUID();
    if (typeof saveInventory === "function") saveInventory();
  }

  // Set modal to edit mode
  if (elements.itemModalTitle) elements.itemModalTitle.textContent = "Edit Inventory Item";
  if (elements.itemModalSubmit) elements.itemModalSubmit.textContent = "Save Changes";

  // Populate unified form fields
  elements.itemMetal.value = item.composition || item.metal;
  elements.itemName.value = item.name;
  elements.itemQty.value = item.qty;
  elements.itemType.value = item.type;

  const selectedMetal = item.metal || elements.itemMetal.value;
  if (typeof filterTypesByMetal === "function") {
    filterTypesByMetal(selectedMetal);
  }
  if (typeof handleTypeChange === "function") {
    handleTypeChange();
  }

  // Weight: use real <select> instead of dataset.unit (BUG FIX)
  if (item.weightUnit === "gb") {
    const denomSelect = elements.itemGbDenom || safeGetElement("itemGbDenom");
    elements.itemWeight.value = parseFloat(item.weight);
    elements.itemWeightUnit.value = "gb";
    if (denomSelect) denomSelect.value = String(parseFloat(item.weight));
    if (typeof toggleGbDenomPicker === "function") toggleGbDenomPicker();
  } else if (item.weightUnit === "kg") {
    elements.itemWeight.value = parseFloat(oztToKg(item.weight).toFixed(4));
    elements.itemWeightUnit.value = "kg";
    if (typeof toggleGbDenomPicker === "function") toggleGbDenomPicker();
  } else if (item.weightUnit === "lb") {
    elements.itemWeight.value = parseFloat(oztToLb(item.weight).toFixed(4));
    elements.itemWeightUnit.value = "lb";
    if (typeof toggleGbDenomPicker === "function") toggleGbDenomPicker();
  } else if (item.weightUnit === "g" || item.weight < 1) {
    const grams = oztToGrams(item.weight);
    elements.itemWeight.value = parseFloat(grams.toFixed(4));
    elements.itemWeightUnit.value = "g";
    if (typeof toggleGbDenomPicker === "function") toggleGbDenomPicker();
  } else {
    elements.itemWeight.value = parseFloat(item.weight).toFixed(2);
    elements.itemWeightUnit.value = "oz";
    if (typeof toggleGbDenomPicker === "function") toggleGbDenomPicker();
  }

  // Convert stored USD values to display currency for the form (STACK-50)
  // STRK-88: round to active currency precision to prevent drifted-float display
  // (e.g. 56.66666666666667 → 56.67 in the #itemPrice field).
  // Use roundToPricePrecision + toFixed(digits) to preserve trailing zeros
  // (String() on a number drops them: 1700.00 → "1700"). T2/T14 fix.
  const fxRate = typeof getExchangeRate === "function" ? getExchangeRate() : 1;
  const _fracDigits =
    typeof getCurrencyFractionDigits === "function" ? getCurrencyFractionDigits() : 2;
  const _fmtDisplay =
    typeof roundToPricePrecision === "function"
      ? (v) => roundToPricePrecision(v).toFixed(_fracDigits)
      : (v) => Number(v).toFixed(2);
  const displayPrice =
    item.price > 0 ? _fmtDisplay(fxRate !== 1 ? item.price * fxRate : item.price) : "";
  const displayMv =
    item.marketValue > 0
      ? _fmtDisplay(fxRate !== 1 ? item.marketValue * fxRate : item.marketValue)
      : "";
  elements.itemPrice.value = displayPrice;
  if (elements.itemMarketValue) elements.itemMarketValue.value = displayMv;
  if (elements.itemPaymentMethod) elements.itemPaymentMethod.value = item.paymentMethod || "";
  elements.purchaseLocation.value = item.purchaseLocation || "";
  elements.storageLocation.value =
    item.storageLocation && item.storageLocation !== "Unknown" ? item.storageLocation : "";
  if (elements.itemSerialNumber) elements.itemSerialNumber.value = item.serialNumber || "";
  if (elements.itemNotes) elements.itemNotes.value = item.notes || "";
  if (elements.itemCapsule) elements.itemCapsule.value = item.capsule || "";
  if (elements.itemCapsuleNotes) elements.itemCapsuleNotes.value = item.capsuleNotes || "";
  elements.itemDate.value = item.date || "";
  // Set date N/A button state based on whether item has a date
  if (elements.itemDateNABtn) {
    const noDate = !item.date;
    elements.itemDateNABtn.classList.toggle("active", noDate);
    elements.itemDateNABtn.setAttribute("aria-pressed", noDate);
    elements.itemDate.disabled = noDate;
  }
  // Reset spot lookup state for edit mode (STACK-49)
  if (typeof syncSpotLookupButtons === "function") {
    syncSpotLookupButtons(!!item.date);
  }
  if (elements.itemCatalog) elements.itemCatalog.value = item.numistaId || "";
  if (elements.itemYear) elements.itemYear.value = item.year || item.issuedYear || "";
  if (elements.itemGrade) elements.itemGrade.value = item.grade || "";
  if (elements.itemGradingAuthority)
    elements.itemGradingAuthority.value = item.gradingAuthority || "";
  if (elements.itemCertNumber) elements.itemCertNumber.value = item.certNumber || "";
  if (elements.itemPcgsNumber) elements.itemPcgsNumber.value = item.pcgsNumber || "";
  if (elements.itemObverseImageUrl) elements.itemObverseImageUrl.value = item.obverseImageUrl || "";
  if (elements.itemReverseImageUrl) elements.itemReverseImageUrl.value = item.reverseImageUrl || "";
  // STAK-332: Populate ignorePatternImages checkbox from item data
  const ignorePatternEl = safeGetElement("itemIgnorePatternImages");
  if (ignorePatternEl) ignorePatternEl.checked = !!item.ignorePatternImages;
  if (elements.itemSerial) elements.itemSerial.value = item.serial;

  // Pre-fill purity: match a preset or show custom input
  const purityVal = parseFloat(item.purity) || 1.0;
  const puritySelect = elements.itemPuritySelect || safeGetElement("itemPuritySelect");
  const purityCustom = elements.purityCustomWrapper || safeGetElement("purityCustomWrapper");
  const purityInput = elements.itemPurity || safeGetElement("itemPurity");
  if (puritySelect) {
    const presetOption = Array.from(puritySelect.options).find(
      (o) => o.value !== "custom" && parseFloat(o.value) === purityVal
    );
    if (presetOption) {
      puritySelect.value = presetOption.value;
      if (purityCustom) purityCustom.style.display = "none";
      if (purityInput) purityInput.value = "";
    } else {
      puritySelect.value = "custom";
      if (purityCustom) purityCustom.style.display = "";
      if (purityInput) purityInput.value = purityVal;
    }
  }

  // Show/hide PCGS verified icon next to Cert# label
  const certVerifiedIcon = safeGetElement("certVerifiedIcon");
  if (certVerifiedIcon) certVerifiedIcon.style.display = item.pcgsVerified ? "inline-flex" : "none";

  // Show price history link in edit mode (STAK-109)
  const retailHistoryLink = safeGetElement("retailPriceHistoryLink");
  if (retailHistoryLink) retailHistoryLink.style.display = "inline";

  // Show/hide Undo button based on changelog context
  if (elements.undoChangeBtn) {
    elements.undoChangeBtn.style.display = logIdx !== null ? "inline-block" : "none";
  }

  // Update currency symbols in modal (STACK-50)
  if (typeof updateModalCurrencyUI === "function") updateModalCurrencyUI();

  // Preload user images (obverse + reverse) into upload previews (STACK-32)
  if (typeof clearUploadState === "function") clearUploadState();
  if (typeof setPendingImageFrames === "function") {
    setPendingImageFrames(item.obverseImageFrame, item.reverseImageFrame);
  }

  /**
   * Show a preview thumbnail for a given side.
   * Works for both blob object-URLs and remote image URLs.
   * @param {string} url - Image source URL
   * @param {'Obv'|'Rev'} suffix - DOM element suffix
   * @param {'obverse'|'reverse'} side - Side name for setEditPreviewUrl
   */
  const showPreview = (url, suffix, side) => {
    const previewContainer = safeGetElement("itemImagePreview" + suffix);
    const previewImg = safeGetElement("itemImagePreviewImg" + suffix);
    const removeBtn = safeGetElement("itemImageRemoveBtn" + suffix);
    if (previewImg) previewImg.src = url;
    if (previewContainer) previewContainer.style.display = "block";
    if (removeBtn) removeBtn.style.display = "";
    if (typeof setEditPreviewUrl === "function") setEditPreviewUrl(url, side);
  };

  /** Fall back to image URL fields when no user-uploaded blob exists */
  const showUrlPreviewFallback = (loadedSides) => {
    if (!loadedSides.obverse && item.obverseImageUrl) {
      if (typeof previewImageUrlForSide === "function") {
        previewImageUrlForSide("obverse", item.obverseImageUrl);
      } else {
        showPreview(item.obverseImageUrl, "Obv", "obverse");
      }
    }
    if (!loadedSides.reverse && item.reverseImageUrl) {
      if (typeof previewImageUrlForSide === "function") {
        previewImageUrlForSide("reverse", item.reverseImageUrl);
      } else {
        showPreview(item.reverseImageUrl, "Rev", "reverse");
      }
    }
  };

  if (item.uuid && window.imageCache?.isAvailable()) {
    imageCache
      .getUserImage(item.uuid)
      .then(async (rec) => {
        const loaded = { obverse: false, reverse: false };
        if (rec?.obverse) {
          try {
            showPreview(URL.createObjectURL(rec.obverse), "Obv", "obverse");
            loaded.obverse = true;
          } catch {
            /* ignore */
          }
        }
        if (rec?.reverse) {
          try {
            showPreview(URL.createObjectURL(rec.reverse), "Rev", "reverse");
            loaded.reverse = true;
          } catch {
            /* ignore */
          }
        }
        // Fall back to URL fields
        showUrlPreviewFallback(loaded);
        // If still missing sides, try pattern image resolution
        if (!loaded.obverse || !loaded.reverse) {
          const itemMeta = {
            uuid: item.uuid,
            numistaId: item.numistaId || "",
            name: item.name || "",
            metal: item.metal || "",
            type: item.type || "",
            ignorePatternImages: !!item.ignorePatternImages,
          };
          if (!loaded.obverse) {
            const obvUrl = await imageCache
              .resolveImageUrlForItem(itemMeta, "obverse")
              .catch(() => null);
            if (obvUrl && !item.obverseImageUrl) showPreview(obvUrl, "Obv", "obverse");
          }
          if (!loaded.reverse) {
            const revUrl = await imageCache
              .resolveImageUrlForItem(itemMeta, "reverse")
              .catch(() => null);
            if (revUrl && !item.reverseImageUrl) showPreview(revUrl, "Rev", "reverse");
          }
        }
      })
      .catch(() => {
        showUrlPreviewFallback({ obverse: false, reverse: false });
      })
      .finally(() => {
        if (typeof updateSwapButtonVisibility === "function") updateSwapButtonVisibility();
      });
  } else {
    // No IndexedDB — go straight to URL fallback
    showUrlPreviewFallback({ obverse: false, reverse: false });
    if (typeof updateSwapButtonVisibility === "function") updateSwapButtonVisibility();
  }

  // Render attachment section in edit modal (STRK-45 — UI in Cohort D)
  if (typeof renderAttachmentSection === "function") renderAttachmentSection(item);

  // Update Numista API status dot (STAK-173)
  if (typeof updateNumistaModalDot === "function") updateNumistaModalDot();
  // Show URL inputs if item has URL values (STAK-173)
  ["Obv", "Rev"].forEach((suffix) => {
    const urlInputWrap = safeGetElement("itemImageUrlInput" + suffix);
    const urlField = suffix === "Obv" ? elements.itemObverseImageUrl : elements.itemReverseImageUrl;
    if (urlInputWrap && urlField && urlField.value) urlInputWrap.style.display = "";
    else if (urlInputWrap) urlInputWrap.style.display = "none";
  });

  // Show clone/view/remove buttons in edit mode (STAK-173, STAK-72)
  if (elements.cloneItemBtn) elements.cloneItemBtn.style.display = "";
  if (elements.viewItemFromEditBtn) elements.viewItemFromEditBtn.style.display = "";
  const deleteFromEditBtn = safeGetElement("deleteFromEditBtn");
  if (deleteFromEditBtn) deleteFromEditBtn.style.display = "";

  // Populate Numista Data fields: item data first, API cache as fallback (STAK-173)
  populateNumistaDataFields(item.numistaId || item.catalog || "", item.numistaData);

  // STAK-528: Normalize shape select value from raw API strings
  const shapeEl = safeGetElement("numistaShape");
  if (shapeEl && window.classifyShape) {
    const rawShape = shapeEl.value || "";
    // If raw API string doesn't match a select option, normalize it
    const validOptions = ["Round", "Rectangular", "Square", "Oval", "Other"];
    if (rawShape && !validOptions.includes(rawShape)) {
      const category = window.classifyShape(rawShape);
      const normalized = category.charAt(0).toUpperCase() + category.slice(1);
      shapeEl.value = validOptions.includes(normalized) ? normalized : "Other";
    }
  }

  // STAK-528: Migrate legacy "LxW" diameter values into length/width fields
  const diamEl = safeGetElement("numistaDiameter");
  const lenEl = safeGetElement("numistaLength");
  const widEl = safeGetElement("numistaWidth");
  if (diamEl && shapeEl) {
    const diamVal = diamEl.value || "";
    if (/[xX\u00d7]/.test(diamVal) && window.parseDimensions) {
      const parsed = window.parseDimensions(diamVal, shapeEl.value);
      if (parsed.length > 0 && lenEl) lenEl.value = parsed.length;
      if (parsed.width > 0 && widEl) widEl.value = parsed.width;
      // Only clear diameter after confirmed valid parse
      if (parsed.length > 0 || parsed.width > 0) diamEl.value = "";
    }
  }

  // Set correct field visibility — use shared toggle if available
  if (shapeEl && window.toggleDimensionFields) {
    window.toggleDimensionFields(shapeEl.value);
  }
  if (typeof updateCapsuleSuggestion === "function") {
    updateCapsuleSuggestion(diamEl?.value || item.numistaData?.diameter || "");
  }

  if (typeof window.restorePurchasePriceToggle === "function") {
    const isLot = window.restorePurchasePriceToggle(item.pricingType, item.qty);
    if (isLot) {
      const priceEl = safeGetElement("itemPrice");
      if (priceEl) {
        // STRK-88: use item.price (full-precision stored per-unit) rather than the
        // already-rounded display value in #itemPrice to avoid double-rounding drift.
        // e.g. item.price=56.666... × qty=30 = 1699.999... → rounds to 1700.00 ✓
        // vs  displayPrice="56.67"   × qty=30 = 1700.10   → would round to 1700.10 ✗
        const fxRate = typeof getExchangeRate === "function" ? getExchangeRate() : 1;
        const perUnitFull = item.price > 0 ? item.price * fxRate : 0;
        if (!isNaN(perUnitFull) && perUnitFull > 0) {
          // STRK-88: round the restored LOT total to currency precision and
          // preserve trailing zeros via toFixed(digits). T2/T14 fix.
          const lotTotal = perUnitFull * item.qty;
          const _lotFracDigits =
            typeof getCurrencyFractionDigits === "function" ? getCurrencyFractionDigits() : 2;
          const _fmtLot =
            typeof roundToPricePrecision === "function"
              ? (v) => roundToPricePrecision(v).toFixed(_lotFracDigits)
              : (v) => Number(v).toFixed(2);
          priceEl.value = _fmtLot(lotTotal);
          // Seed the exact-lot cache so EACH→LOT toggle can restore the original total (STRK-88)
          if (typeof window.purchasePriceSeedLotCache === "function") {
            // Cache the full-precision lot total so toggle can recover it losslessly.
            window.purchasePriceSeedLotCache(lotTotal, item.qty);
          }
        }
      }
    }
  } else if (typeof window.resetPurchasePriceToggle === "function") {
    window.resetPurchasePriceToggle();
  }

  // STAK-343: Populate tags in edit modal
  if (item.uuid && typeof getItemTags === "function") {
    const itemTagsChips = safeGetElement("itemModalTagsChips", true);

    const renderEditTags = () => {
      const tags = getItemTags(item.uuid);
      if (typeof itemTagsChips.appendChild !== "function") return;
      itemTagsChips.textContent = "";

      if (tags.length === 0) {
        itemTagsChips.innerHTML = '<span class="tag-empty-hint">No tags</span>';
      } else {
        tags.forEach((tag) => {
          const chip = document.createElement("span");
          chip.className = "tag-chip";
          chip.textContent = tag;
          chip.title = `Tag: ${tag} (click × to remove)`;

          const rm = document.createElement("button");
          rm.type = "button";
          rm.className = "tag-chip-remove";
          rm.textContent = "\u00d7";
          rm.setAttribute("aria-label", `Remove tag ${tag}`);
          rm.onclick = (e) => {
            e.stopPropagation();
            removeItemTag(item.uuid, tag);
            renderEditTags();
          };

          chip.appendChild(rm);
          itemTagsChips.appendChild(chip);
        });
      }
    };

    renderEditTags();
    window._renderEditTags = renderEditTags;

    // Wire up the add-tag button
    if (elements.addTagBtn && elements.newTagInput) {
      const addHandler = () => {
        const val = elements.newTagInput.value.trim();
        if (val && typeof addItemTag === "function") {
          let addedTags = false;
          parseTagInput(val).forEach((t) => {
            if (addItemTag(item.uuid, t, false)) addedTags = true;
          });
          if (addedTags && typeof stampTagTimestamp === "function") stampTagTimestamp([item.uuid]);
          if (typeof saveItemTags === "function") saveItemTags();
          elements.newTagInput.value = "";
          renderEditTags();
        }
      };
      elements.addTagBtn.onclick = addHandler;
      elements.newTagInput.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addHandler();
        }
      };
    }

    // Tags section is always visible (non-collapsible)
  }

  // Open unified modal
  if (window.openModalById) openModalById("itemModal");
  else if (elements.itemModal) elements.itemModal.style.display = "flex";
};

/**
 * Opens the edit modal in clone mode for a given inventory item.
 * Called from the table row copy button. (STAK-375)
 *
 * @param {number} idx - Index of item to clone
 */
const cloneItem = (idx) => {
  editItem(idx);
  if (typeof enterCloneMode === "function") enterCloneMode(idx);
};

/**
 * Duplicates an inventory item by opening the add modal pre-filled with
 * the source item's fields. Date preserves the original purchase date, qty resets to 1.
 *
 * @param {number} idx - Index of item to duplicate
 */
const duplicateItem = (idx) => {
  const item = inventory[idx];

  // Stay in add mode — editingIndex remains null so submit creates a new record
  editingIndex = null;
  editingChangeLogIndex = null;

  // Set modal to add mode with "Duplicate" title
  if (elements.itemModalTitle) elements.itemModalTitle.textContent = "Duplicate Inventory Item";
  if (elements.itemModalSubmit) elements.itemModalSubmit.textContent = "Add to Inventory";
  if (elements.undoChangeBtn) elements.undoChangeBtn.style.display = "none";

  // Pre-fill from source item
  elements.itemMetal.value = item.composition || item.metal;
  elements.itemName.value = item.name;
  const duplicatePreservesLot = item.pricingType === "lot" && Number(item.qty) > 1;
  elements.itemQty.value = duplicatePreservesLot ? item.qty : 1;
  elements.itemType.value = item.type;

  // Weight: same conversion logic as editItem
  if (item.weightUnit === "gb") {
    const denomSelect = elements.itemGbDenom || safeGetElement("itemGbDenom");
    elements.itemWeight.value = parseFloat(item.weight);
    elements.itemWeightUnit.value = "gb";
    if (denomSelect) denomSelect.value = String(parseFloat(item.weight));
    if (typeof toggleGbDenomPicker === "function") toggleGbDenomPicker();
  } else if (item.weightUnit === "kg") {
    elements.itemWeight.value = parseFloat(oztToKg(item.weight).toFixed(4));
    elements.itemWeightUnit.value = "kg";
    if (typeof toggleGbDenomPicker === "function") toggleGbDenomPicker();
  } else if (item.weightUnit === "lb") {
    elements.itemWeight.value = parseFloat(oztToLb(item.weight).toFixed(4));
    elements.itemWeightUnit.value = "lb";
    if (typeof toggleGbDenomPicker === "function") toggleGbDenomPicker();
  } else if (item.weightUnit === "g" || item.weight < 1) {
    const grams = oztToGrams(item.weight);
    elements.itemWeight.value = parseFloat(grams.toFixed(4));
    elements.itemWeightUnit.value = "g";
    if (typeof toggleGbDenomPicker === "function") toggleGbDenomPicker();
  } else {
    elements.itemWeight.value = parseFloat(item.weight).toFixed(2);
    elements.itemWeightUnit.value = "oz";
    if (typeof toggleGbDenomPicker === "function") toggleGbDenomPicker();
  }

  // Convert stored USD values to display currency for the form (STACK-50)
  // STRK-88: round to active currency precision to prevent drifted-float display.
  // Use toFixed(digits) to preserve trailing zeros (String() drops them). T2/T14 fix.
  const dupFxRate = typeof getExchangeRate === "function" ? getExchangeRate() : 1;
  const _dupFracDigits =
    typeof getCurrencyFractionDigits === "function" ? getCurrencyFractionDigits() : 2;
  const _dupFmtDisplay =
    typeof roundToPricePrecision === "function"
      ? (v) => roundToPricePrecision(v).toFixed(_dupFracDigits)
      : (v) => Number(v).toFixed(2);
  let dupDisplayPrice =
    item.price > 0 ? _dupFmtDisplay(dupFxRate !== 1 ? item.price * dupFxRate : item.price) : "";
  const dupDisplayMv =
    item.marketValue > 0
      ? _dupFmtDisplay(dupFxRate !== 1 ? item.marketValue * dupFxRate : item.marketValue)
      : "";
  elements.itemPrice.value = dupDisplayPrice;
  if (elements.itemMarketValue) elements.itemMarketValue.value = dupDisplayMv;
  if (elements.itemPaymentMethod) elements.itemPaymentMethod.value = item.paymentMethod || "";
  elements.purchaseLocation.value = item.purchaseLocation || "";
  elements.storageLocation.value =
    item.storageLocation && item.storageLocation !== "Unknown" ? item.storageLocation : "";
  if (elements.itemSerialNumber) elements.itemSerialNumber.value = item.serialNumber || "";
  if (elements.itemNotes) elements.itemNotes.value = item.notes || "";
  if (elements.itemCapsule) elements.itemCapsule.value = item.capsule || "";
  if (elements.itemCapsuleNotes) elements.itemCapsuleNotes.value = item.capsuleNotes || "";
  elements.itemDate.value = item.date || todayStr();
  if (elements.itemCatalog) elements.itemCatalog.value = item.numistaId || "";
  if (elements.itemYear) elements.itemYear.value = item.year || item.issuedYear || "";
  if (elements.itemGrade) elements.itemGrade.value = item.grade || "";
  if (elements.itemGradingAuthority)
    elements.itemGradingAuthority.value = item.gradingAuthority || "";
  if (elements.itemCertNumber) elements.itemCertNumber.value = item.certNumber || "";
  if (elements.itemPcgsNumber) elements.itemPcgsNumber.value = item.pcgsNumber || "";
  if (elements.itemSerial) elements.itemSerial.value = ""; // Serial should be unique per item

  // Pre-fill purity (same logic as editItem)
  const dupPurity = parseFloat(item.purity) || 1.0;
  const dupPuritySelect = elements.itemPuritySelect || safeGetElement("itemPuritySelect");
  const dupPurityCustom = elements.purityCustomWrapper || safeGetElement("purityCustomWrapper");
  const dupPurityInput = elements.itemPurity || safeGetElement("itemPurity");
  if (dupPuritySelect) {
    const presetOpt = Array.from(dupPuritySelect.options).find(
      (o) => o.value !== "custom" && parseFloat(o.value) === dupPurity
    );
    if (presetOpt) {
      dupPuritySelect.value = presetOpt.value;
      if (dupPurityCustom) dupPurityCustom.style.display = "none";
      if (dupPurityInput) dupPurityInput.value = "";
    } else {
      dupPuritySelect.value = "custom";
      if (dupPurityCustom) dupPurityCustom.style.display = "";
      if (dupPurityInput) dupPurityInput.value = dupPurity;
    }
  }

  // Hide PCGS verified icon — duplicate is a new unverified item
  const certVerifiedIcon = safeGetElement("certVerifiedIcon");
  if (certVerifiedIcon) certVerifiedIcon.style.display = "none";

  // Update currency symbols in modal (STACK-50)
  if (typeof updateModalCurrencyUI === "function") updateModalCurrencyUI();

  // STRK-88 (D-5): Preserve source item's pricing mode rather than unconditionally resetting.
  // EACH-mode duplicates still reset qty to 1; LOT-mode duplicates preserve qty/mode so
  // the visible price remains the rounded lot total instead of a rounded per-unit value.
  if (typeof window.restorePurchasePriceToggle === "function") {
    const isLot = window.restorePurchasePriceToggle(
      item.pricingType,
      Number(elements.itemQty.value)
    );
    if (isLot && elements.itemPrice) {
      const lotTotal = (item.price > 0 ? item.price * dupFxRate : 0) * Number(item.qty || 0);
      if (Number.isFinite(lotTotal) && lotTotal > 0) {
        dupDisplayPrice = _dupFmtDisplay(lotTotal);
        elements.itemPrice.value = dupDisplayPrice;
        if (typeof window.purchasePriceSeedLotCache === "function") {
          window.purchasePriceSeedLotCache(lotTotal, Number(item.qty));
        }
      }
    }
  } else if (typeof window.resetPurchasePriceToggle === "function") {
    window.resetPurchasePriceToggle();
  }

  if (typeof updateCapsuleSuggestion === "function") {
    updateCapsuleSuggestion(item.numistaData?.diameter || "");
  }

  // Open unified modal
  if (window.openModalById) openModalById("itemModal");
  else if (elements.itemModal) elements.itemModal.style.display = "flex";
};

/**
 * Toggles price display between purchase price and market value
 *
 * @param {number} idx - Index of item to toggle price view for
 */
/**
 * Legacy function kept for compatibility - no longer used
 * Market value now has its own dedicated column
 */
const toggleGlobalPriceView = () => {
  // Function kept for compatibility but no longer used
  console.warn("toggleGlobalPriceView is deprecated - using separate columns now");
};

// Import/export functions extracted to inventory-import.js

/**
 * Exports current inventory to JSON format
 */
const exportJson = () => {
  debugLog("exportJson start", inventory.length, "items");
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const sortedInventory = sortInventoryByDateNewestFirst();

  const exportData = sortedInventory.map((item) => ({
    date: item.date,
    metal: item.metal,
    type: item.type,
    name: item.name,
    year: item.year || "",
    qty: item.qty,
    weight: item.weight,
    weightUnit: item.weightUnit || "oz",
    purity: parseFloat(item.purity) || 1.0,
    price: item.price,
    marketValue: item.marketValue || 0,
    ...(item.paymentMethod && { paymentMethod: item.paymentMethod }),
    purchaseLocation: item.purchaseLocation,
    storageLocation: item.storageLocation,
    tags: typeof getItemTags === "function" ? getItemTags(item.uuid) : [],
    notes: item.notes,
    capsule: item.capsule || "",
    capsuleNotes: item.capsuleNotes || "",
    numistaId: item.numistaId,
    grade: item.grade || "",
    gradingAuthority: item.gradingAuthority || "",
    certNumber: item.certNumber || "",
    serialNumber: item.serialNumber || "",
    pcgsNumber: item.pcgsNumber || "",
    pcgsVerified: item.pcgsVerified || false,
    serial: item.serial,
    uuid: item.uuid,
    obverseImageUrl: item.obverseImageUrl || "",
    reverseImageUrl: item.reverseImageUrl || "",
    // Legacy fields preserved for backward compatibility
    spotPriceAtPurchase: item.spotPriceAtPurchase,
    composition: item.composition,
    numistaData: item.numistaData || null,
    fieldMeta: item.fieldMeta || null,
  }));

  // Wrap in metadata envelope so importJson can detect export origin (STAK-374)
  const _exportOrigin =
    typeof window !== "undefined" && window.location ? window.location.origin : "";
  const exportPayload = {
    items: exportData,
    exportMeta: {
      exportOrigin: _exportOrigin,
      exportDate: new Date().toISOString(),
      version: typeof APP_VERSION !== "undefined" ? APP_VERSION : "",
      itemCount: exportData.length,
    },
    itemRemovedTags: loadDataSync("itemRemovedTags", {}),
  };

  const json = JSON.stringify(exportPayload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `metal_inventory_${timestamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  debugLog("exportJson complete");
};

/**
 * Builds and returns a jsPDF document of the current inventory.
 * Does not save or open the document — callers (exportPdf, printInventory) handle that.
 */
const _buildInventoryPdf = () => {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    appAlert(
      "PDF library (jsPDF) failed to load. Please check your internet connection and reload the page."
    );
    return null;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("landscape");

  // Sort inventory by date (newest first) for export
  const sortedInventory = sortInventoryByDateNewestFirst();

  // Add title
  doc.setFontSize(16);
  doc.text("StakTrakr", 14, 15);

  // Add date
  doc.setFontSize(10);
  doc.text(
    `Exported: ${typeof formatTimestamp === "function" ? formatTimestamp(new Date()) : new Date().toLocaleString()}`,
    14,
    22
  );

  // Prepare table data with computed portfolio columns
  const tableData = sortedInventory.map((item) => {
    const currentSpot = spotPrices[item.metal.toLowerCase()] || 0;
    const valuation =
      typeof computeItemValuation === "function" ? computeItemValuation(item, currentSpot) : null;
    const purchasePrice = valuation
      ? valuation.purchasePrice
      : typeof item.price === "number"
        ? item.price
        : parseFloat(item.price) || 0;
    const meltValue = valuation ? valuation.meltValue : computeMeltValue(item, currentSpot);
    const retailTotal = valuation ? valuation.retailTotal : meltValue;
    const gainLoss = valuation ? valuation.gainLoss : null;

    return [
      item.date,
      item.metal,
      item.type,
      item.name,
      item.qty,
      formatWeight(item.weight, item.weightUnit),
      parseFloat(item.purity) || 1.0,
      formatCurrency(purchasePrice),
      currentSpot > 0 ? formatCurrency(meltValue) : "—",
      formatCurrency(retailTotal),
      gainLoss !== null ? formatCurrency(gainLoss) : "—",
      item.paymentMethod || "",
      item.purchaseLocation,
      item.numistaId || "",
      item.pcgsNumber || "",
      item.grade || "",
      item.gradingAuthority || "",
      item.certNumber || "",
      item.serialNumber || "",
      item.notes || "",
      (item.uuid || "").slice(0, 8),
    ];
  });

  // Add table
  doc.autoTable({
    head: [
      [
        "Date",
        "Metal",
        "Type",
        "Name",
        "Qty",
        "Weight",
        "Purity",
        "Purchase",
        "Melt Value",
        "Retail",
        "Gain/Loss",
        "Payment Method",
        "Location",
        "N#",
        "PCGS#",
        "Grade",
        "Auth",
        "Cert#",
        "Serial #",
        "Notes",
        "UUID",
      ],
    ],
    body: tableData,
    startY: 30,
    theme: "striped",
    styles: { fontSize: 7 },
    headStyles: { fillColor: [25, 118, 210] },
  });

  // Add totals
  const finalY = doc.lastAutoTable.finalY || 30;

  // Helper to safely read element text
  const txt = (el) => (el && el.textContent) || "—";

  // Add totals section
  doc.setFontSize(12);
  doc.text("Portfolio Summary", 14, finalY + 10);

  // Silver Totals
  doc.setFontSize(10);
  doc.text("Silver:", 14, finalY + 16);
  doc.text(`Items: ${txt(elements.totals.silver.items)}`, 25, finalY + 22);
  doc.text(`Weight: ${txt(elements.totals.silver.weight)} oz`, 25, finalY + 28);
  doc.text(`Purchase: ${txt(elements.totals.silver.purchased)}`, 25, finalY + 34);
  doc.text(`Melt Value: ${txt(elements.totals.silver.value)}`, 25, finalY + 40);
  doc.text(`Retail: ${txt(elements.totals.silver.retailValue)}`, 25, finalY + 46);
  doc.text(`Gain/Loss: ${txt(elements.totals.silver.lossProfit)}`, 25, finalY + 52);

  // Gold Totals
  doc.text("Gold:", 100, finalY + 16);
  doc.text(`Items: ${txt(elements.totals.gold.items)}`, 111, finalY + 22);
  doc.text(`Weight: ${txt(elements.totals.gold.weight)} oz`, 111, finalY + 28);
  doc.text(`Purchase: ${txt(elements.totals.gold.purchased)}`, 111, finalY + 34);
  doc.text(`Melt Value: ${txt(elements.totals.gold.value)}`, 111, finalY + 40);
  doc.text(`Retail: ${txt(elements.totals.gold.retailValue)}`, 111, finalY + 46);
  doc.text(`Gain/Loss: ${txt(elements.totals.gold.lossProfit)}`, 111, finalY + 52);

  // Platinum Totals
  doc.text("Platinum:", 186, finalY + 16);
  doc.text(`Items: ${txt(elements.totals.platinum.items)}`, 197, finalY + 22);
  doc.text(`Weight: ${txt(elements.totals.platinum.weight)} oz`, 197, finalY + 28);
  doc.text(`Purchase: ${txt(elements.totals.platinum.purchased)}`, 197, finalY + 34);
  doc.text(`Melt Value: ${txt(elements.totals.platinum.value)}`, 197, finalY + 40);
  doc.text(`Retail: ${txt(elements.totals.platinum.retailValue)}`, 197, finalY + 46);
  doc.text(`Gain/Loss: ${txt(elements.totals.platinum.lossProfit)}`, 197, finalY + 52);

  // Palladium Totals
  doc.text("Palladium:", 14, finalY + 60);
  doc.text(`Items: ${txt(elements.totals.palladium.items)}`, 25, finalY + 66);
  doc.text(`Weight: ${txt(elements.totals.palladium.weight)} oz`, 25, finalY + 72);
  doc.text(`Purchase: ${txt(elements.totals.palladium.purchased)}`, 25, finalY + 78);
  doc.text(`Melt Value: ${txt(elements.totals.palladium.value)}`, 25, finalY + 84);
  doc.text(`Retail: ${txt(elements.totals.palladium.retailValue)}`, 25, finalY + 90);
  doc.text(`Gain/Loss: ${txt(elements.totals.palladium.lossProfit)}`, 25, finalY + 96);

  return doc;
};

const exportPdf = () => {
  const doc = _buildInventoryPdf();
  if (!doc) return;
  doc.save(`metal_inventory_${new Date().toLocaleDateString("en-CA").replace(/-/g, "")}.pdf`);
};

const printInventory = () => {
  const doc = _buildInventoryPdf();
  if (!doc) return;
  doc.autoPrint();
  // Must remain synchronous in click-handler stack — browsers block popup if await precedes window.open
  const blobUrl = doc.output("bloburl");
  const popup = window.open(blobUrl, "_blank");
  // Revoke after a short delay to allow the popup to load the blob before the URL is released
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  if (!popup) {
    appAlert("Your browser blocked the print window — allow popups for this page.");
  }
};
/**
 * Show or hide the "Realized:" row on all summary cards (STAK-72).
 * Called from settings toggle and on page load.
 */
const applyRealizedVisibility = (show) => {
  const metals = ["Silver", "Gold", "Platinum", "Palladium", "All"];
  metals.forEach((m) => {
    // Use getElementById directly — this runs from events.js top-level (before init.js defines safeGetElement)
    const el = document.getElementById(`realizedGainLoss${m}`);
    if (el && el.parentElement) el.parentElement.style.display = show ? "" : "none";
  });
};

// =============================================================================
// Expose inventory actions globally for inline event handlers
window.exportJson = exportJson;
window.exportPdf = exportPdf;
window.printInventory = printInventory;
// window.updateSummary exported from inventory-table.js
window.applyRealizedVisibility = applyRealizedVisibility;
window.toggleGlobalPriceView = toggleGlobalPriceView;
window.editItem = editItem;
window.duplicateItem = duplicateItem;
window.cloneItem = cloneItem;
window.populateNumistaDataFields = populateNumistaDataFields;
window.deleteItem = deleteItem;
window.disposeItem = disposeItem;
window.openRemoveItemModal = openRemoveItemModal;
window.confirmRemoveItem = confirmRemoveItem;
window.undoDisposition = undoDisposition;
window.showNotes = showNotes;

/**
 * Opens a read-only notes viewer for the given inventory index.
 * @param {number} idx - Inventory array index
 */
const showNotesView = (idx) => {
  const item = inventory[idx];
  if (!item) return;
  const titleEl = safeGetElement("notesViewTitle");
  const contentEl = safeGetElement("notesViewContent");
  const editBtn = safeGetElement("notesViewEditBtn");
  if (!contentEl) return;

  if (titleEl) titleEl.textContent = item.name ? `Notes — ${item.name}` : "Notes";
  contentEl.textContent = item.notes || "(no notes)";

  // Wire edit button to open the full item edit modal
  if (editBtn) {
    editBtn.onclick = () => {
      closeModalById("notesViewModal");
      editItem(idx);
    };
  }

  openModalById("notesViewModal");
};
window.showNotesView = showNotesView;

/**
 * Delegated click handler for inline tag interactions.
 * Uses data attributes and closest() to prevent XSS
 * when item names contain quotes or special characters.
 */
document.addEventListener("click", (e) => {
  // Notes indicator click → view notes (shift+click → edit item)
  const notesInd = e.target.closest(".notes-indicator");
  if (notesInd) {
    e.preventDefault();
    e.stopPropagation();
    const tr = notesInd.closest("tr[data-idx]");
    if (!tr) return;
    const idx = parseInt(tr.dataset.idx, 10);
    if (isNaN(idx)) return;
    if (e.shiftKey) {
      editItem(idx);
    } else {
      showNotesView(idx);
    }
    return;
  }

  // PCGS verify button click → call PCGS API for cert verification
  const verifyBtn = e.target.closest(".pcgs-verify-btn");
  if (verifyBtn) {
    e.preventDefault();
    e.stopPropagation();
    const certNum = verifyBtn.dataset.certNumber || "";
    if (!certNum || typeof verifyPcgsCert !== "function") return;

    const tr = verifyBtn.closest("tr[data-idx]");
    const idx = tr ? parseInt(tr.dataset.idx, 10) : -1;

    verifyBtn.classList.add("pcgs-verifying");
    verifyBtn.title = "Verifying...";

    verifyPcgsCert(certNum).then((result) => {
      verifyBtn.classList.remove("pcgs-verifying");
      if (result.verified) {
        verifyBtn.classList.add("pcgs-verified");
        if (idx >= 0 && inventory[idx]) {
          inventory[idx].pcgsVerified = true;
          saveInventory();
        }
        const parts = [];
        if (result.grade) parts.push(`Grade: ${result.grade}`);
        if (result.population) parts.push(`Pop: ${result.population}`);
        if (result.popHigher) parts.push(`Pop Higher: ${result.popHigher}`);
        if (result.priceGuide)
          parts.push(`Price Guide: $${Number(result.priceGuide).toLocaleString()}`);
        verifyBtn.title = `Verified — ${parts.join(" | ")}`;
      } else {
        verifyBtn.title = result.error || "Verification failed";
        verifyBtn.classList.add("pcgs-verify-failed");
        setTimeout(() => verifyBtn.classList.remove("pcgs-verify-failed"), 3000);
      }
    });
    return;
  }

  // Numista N# tag click → open Numista in popup window
  const numistaTag = e.target.closest(".numista-tag");
  if (numistaTag) {
    e.preventDefault();
    e.stopPropagation();
    const nId = numistaTag.dataset.numistaId;
    const coinName = numistaTag.dataset.coinName || "";
    if (nId && typeof openNumistaModal === "function") {
      openNumistaModal(nId, coinName);
    }
    return;
  }

  // PCGS# tag click → open PCGS CoinFacts in popup window
  const pcgsTagEl = e.target.closest(".pcgs-tag");
  if (pcgsTagEl) {
    e.preventDefault();
    e.stopPropagation();
    const pcgsNo = pcgsTagEl.dataset.pcgsNumber || "";
    const gradeNum = (pcgsTagEl.dataset.grade || "").match(/\d+/)?.[0] || "";
    if (pcgsNo) {
      const url = `https://www.pcgs.com/coinfacts/coin/detail/${encodeURIComponent(pcgsNo)}/${encodeURIComponent(gradeNum)}`;
      const popup = window.open(
        url,
        `pcgs_${pcgsNo}`,
        "width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no"
      );
      if (!popup) {
        appAlert(`Popup blocked! Please allow popups or manually visit:\n${url}`);
      } else {
        popup.opener = null;
        popup.focus();
      }
    }
    return;
  }

  // Grade tag click → open cert verification URL
  const gradeTag = e.target.closest('.grade-tag[data-clickable="true"]');
  if (gradeTag) {
    e.preventDefault();
    e.stopPropagation();
    const authority = gradeTag.dataset.authority || "";
    const certNum = gradeTag.dataset.certNumber || "";
    if (authority && typeof CERT_LOOKUP_URLS !== "undefined" && CERT_LOOKUP_URLS[authority]) {
      let url = CERT_LOOKUP_URLS[authority].replaceAll("{certNumber}", encodeURIComponent(certNum));
      const gradeNum = (gradeTag.dataset.grade || "").match(/\d+/)?.[0] || "";
      url = url.replace("{grade}", encodeURIComponent(gradeNum));
      const popup = window.open(
        url,
        `cert_${authority}_${certNum || Date.now()}`,
        "width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no"
      );
      if (!popup) {
        appAlert(`Popup blocked! Please allow popups or manually visit:\n${url}`);
      } else {
        popup.opener = null;
        popup.focus();
      }
    }
    return;
  }

  const buyLink = e.target.closest(".ebay-buy-link");
  if (buyLink) {
    e.preventDefault();
    e.stopPropagation();
    openEbayBuySearch(buyLink.dataset.search);
    return;
  }
  const soldLink = e.target.closest(".ebay-sold-link");
  if (soldLink) {
    e.preventDefault();
    e.stopPropagation();
    openEbaySoldSearch(soldLink.dataset.search);
    return;
  }
});

/**
 * Shift+click inline editing — power user shortcut for editable cells.
 * Capture-phase listener intercepts shift+clicks before inline onclick
 * handlers (filterLink) and bubble-phase eBay handlers can fire.
 */
document.addEventListener(
  "click",
  (e) => {
    if (!e.shiftKey) return;
    const td = e.target.closest("#inventoryTable td[data-column]");
    if (!td) return;
    const EDITABLE = {
      name: "name",
      qty: "qty",
      weight: "weight",
      purchasePrice: "price",
      retailPrice: "marketValue",
      purchaseLocation: "purchaseLocation",
    };
    const field = EDITABLE[td.dataset.column];
    if (!field) return;
    const tr = td.closest("tr[data-idx]");
    if (!tr) return;
    const idx = parseInt(tr.dataset.idx, 10);
    if (isNaN(idx)) return;
    e.preventDefault();
    e.stopPropagation();
    startCellEdit(idx, field, td);
  },
  true
); // capture phase

// =============================================================================
// THUMBNAIL POPOVER  (image view + upload for main table)
// =============================================================================

/**
 * Opens a fixed-position popover anchored below (or above) the image cell.
 * Shows a large preview of the resolved image for each visible side, with
 * Upload, Camera (mobile/HTTPS only), and Remove buttons.
 * Saves directly to imageCache and refreshes the row's thumbnails.
 *
 * @param {HTMLTableDataCellElement} cell  - the td[data-column="image"] element
 * @param {Object} item                   - the full inventory item object
 */
function _openThumbPopover(cell, item) {
  // Toggle off if same cell clicked again (use getElementById — need real null when absent)
  const existing = document.getElementById("thumbPopover");
  if (existing) {
    existing.remove();
    if (existing.dataset.forUuid === (item.uuid || "")) return;
  }

  const isSecure = location.protocol === "https:" || location.hostname === "localhost";
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  const showCamera = isMobile && isSecure;

  const { showObv, showRev } = (() => {
    const s = localStorage.getItem("tableImageSides") || "both";
    return { showObv: s === "both" || s === "obverse", showRev: s === "both" || s === "reverse" };
  })();

  // Build side HTML helper
  const sideHtml = (sideKey, label) => `
    <div class="bulk-img-popover-side">
      <span class="bulk-img-popover-label">${label}</span>
      <div class="bulk-img-popover-preview thumb-popover-preview" id="thumbPop_${sideKey}_preview"></div>
      <div class="bulk-img-popover-actions">
        <input type="file" id="thumbPop_${sideKey}_file" accept="image/jpeg,image/png,image/webp" style="display:none" />
        <button class="btn btn-sm" id="thumbPop_${sideKey}_upload" type="button">Upload</button>
        ${showCamera ? `<button class="btn btn-sm" id="thumbPop_${sideKey}_camera" type="button">📷</button>` : ""}
        <button class="btn btn-sm btn-danger" id="thumbPop_${sideKey}_remove" type="button" style="display:none">Remove</button>
      </div>
    </div>`;

  const pop = document.createElement("div");
  pop.id = "thumbPopover";
  pop.className = "bulk-img-popover thumb-popover";
  pop.dataset.forUuid = item.uuid || "";

  pop.innerHTML = `
    <div class="bulk-img-popover-header">
      <span class="bulk-img-popover-title">${item.name ? sanitizeHtml(item.name.slice(0, 28) + (item.name.length > 28 ? "…" : "")) : "Photos"}</span>
      <button class="bulk-img-popover-close" type="button" aria-label="Close">×</button>
    </div>
    <div class="bulk-img-popover-sides">
      ${showObv ? sideHtml("obv", "Obverse") : ""}
      ${showRev ? sideHtml("rev", "Reverse") : ""}
    </div>`;

  document.body.appendChild(pop);

  // Position: below cell, flip above if near viewport bottom
  const rect = cell.getBoundingClientRect();
  const popW = 300;
  let left = rect.left;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  let top = rect.bottom + 4;
  if (top + 340 > window.innerHeight) top = rect.top - 344;
  pop.style.left = Math.max(4, left) + "px";
  pop.style.top = Math.max(4, top) + "px";

  // Close handlers
  const closePopover = () => pop.remove();
  pop.querySelector(".bulk-img-popover-close").addEventListener("click", closePopover);
  const _onOutside = (e) => {
    if (!pop.contains(e.target) && e.target !== cell) {
      closePopover();
      document.removeEventListener("click", _onOutside, true);
    }
  };
  setTimeout(() => document.addEventListener("click", _onOutside, true), 10);

  // Track blob URLs created here so they're revoked with the main pool
  const _popBlobUrls = [];
  const _track = (url) => {
    if (url) {
      if (typeof window._trackThumbBlobUrl === "function") window._trackThumbBlobUrl(url);
      _popBlobUrls.push(url);
    }
    return url;
  };

  // Load existing images into previews
  const _loadPreview = async (sideKey, side) => {
    const previewEl = safeGetElement(`thumbPop_${sideKey}_preview`);
    const removeBtn = safeGetElement(`thumbPop_${sideKey}_remove`);
    if (!previewEl) return;

    let url = null;
    if (window.imageCache?.isAvailable()) {
      url = _track(await imageCache.resolveImageUrlForItem(item, side));
    }
    // Fallback to CDN URL strings
    if (!url) {
      url = side === "obverse" ? item.obverseImageUrl || null : item.reverseImageUrl || null;
      if (url && !/^https?:\/\//i.test(url)) url = null;
    }

    if (url) {
      previewEl.innerHTML = `<img src="${url}" alt="${side}" class="bulk-img-popover-img" />`;
      if (removeBtn) removeBtn.style.display = "";
    } else {
      previewEl.innerHTML = `<span class="thumb-popover-empty">No image</span>`;
    }
  };

  if (showObv) _loadPreview("obv", "obverse");
  if (showRev) _loadPreview("rev", "reverse");

  // Refresh the row thumbnails after a change
  const _refreshRowThumbs = () => {
    if (!featureFlags.isEnabled("COIN_IMAGES") || !window.imageCache?.isAvailable()) return;
    const row = document.querySelector(`#inventoryTable tr[data-idx]`);
    // Find by uuid via data attribute on the img
    const thumbImg = document.querySelector(
      `#inventoryTable .table-thumb[data-item-uuid="${CSS.escape(item.uuid || "")}"]`
    );
    if (thumbImg) {
      // Revoke old blob URL for this specific image
      if (thumbImg.src && thumbImg.src.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(thumbImg.src);
        } catch {
          /* ignore */
        }
      }
      thumbImg.src = "";
      thumbImg.style.visibility = "hidden";
      thumbImg.removeAttribute("src");
      _loadThumbImage(thumbImg);
    }
    // Refresh popover previews too
    if (showObv) _loadPreview("obv", "obverse");
    if (showRev) _loadPreview("rev", "reverse");
  };

  // Handle upload for one side
  const _handleUpload = async (file, side) => {
    if (!file || typeof imageProcessor === "undefined") return;
    const result = await imageProcessor.processFile(file, {
      maxDim: typeof IMAGE_MAX_DIM !== "undefined" ? IMAGE_MAX_DIM : 600,
      maxBytes: typeof IMAGE_MAX_BYTES !== "undefined" ? IMAGE_MAX_BYTES : 512000,
    });
    if (!result?.blob) return;

    let obvBlob = side === "obverse" ? result.blob : null;
    let revBlob = side === "reverse" ? result.blob : null;
    // Merge: keep the other side if it exists
    try {
      const existing = await imageCache.getUserImage(item.uuid);
      if (existing) {
        if (!obvBlob && existing.obverse) obvBlob = existing.obverse;
        if (!revBlob && existing.reverse) revBlob = existing.reverse;
      }
    } catch {
      /* ignore */
    }
    if (!obvBlob && revBlob) {
      obvBlob = revBlob;
      revBlob = null;
    }

    await imageCache.cacheUserImage(item.uuid, obvBlob, revBlob);
    _refreshRowThumbs();
  };

  // Wire Upload + Camera buttons for each visible side
  const _wireSide = (sideKey, side) => {
    const fileInput = safeGetElement(`thumbPop_${sideKey}_file`);
    const uploadBtn = safeGetElement(`thumbPop_${sideKey}_upload`);
    const cameraBtn = safeGetElement(`thumbPop_${sideKey}_camera`);
    const removeBtn = safeGetElement(`thumbPop_${sideKey}_remove`);
    if (!fileInput) return;

    if (uploadBtn) {
      uploadBtn.addEventListener("click", () => {
        fileInput.removeAttribute("capture");
        fileInput.click();
      });
    }
    if (cameraBtn) {
      cameraBtn.addEventListener("click", () => {
        fileInput.setAttribute("capture", "environment");
        fileInput.click();
      });
    }
    fileInput.addEventListener("change", () => {
      if (fileInput.files[0]) _handleUpload(fileInput.files[0], side);
    });

    if (removeBtn) {
      removeBtn.addEventListener("click", async () => {
        if (!window.imageCache?.isAvailable()) return;
        const existing = await imageCache.getUserImage(item.uuid);
        if (!existing) return;
        const keepObv = side === "reverse" ? existing.obverse : null;
        const keepRev = side === "obverse" ? existing.reverse : null;
        if (!keepObv && !keepRev) {
          await imageCache.deleteUserImage(item.uuid);
        } else {
          const o = keepObv || keepRev;
          const r = keepObv ? keepRev : null;
          await imageCache.cacheUserImage(item.uuid, o, r);
        }
        _refreshRowThumbs();
      });
    }
  };

  if (showObv) _wireSide("obv", "obverse");
  if (showRev) _wireSide("rev", "reverse");
}

/**
 * Phase 1C: Storage optimization and housekeeping
 */
function optimizeStoragePhase1C() {
  try {
    if (
      typeof catalogManager !== "undefined" &&
      catalogManager &&
      typeof catalogManager.removeOrphanedMappings === "function"
    ) {
      catalogManager.removeOrphanedMappings();
    }
    if (typeof generateStorageReport === "function") {
      const report = generateStorageReport();
      debugLog("Storage Optimization: Total localStorage ~", report.totalKB, "KB");
      if (typeof initializeStorageChart === "function") {
        try {
          initializeStorageChart(report);
        } catch (e) {
          debugWarn("Storage chart init failed", e);
        }
      }
    }
  } catch (e) {
    debugWarn("optimizeStoragePhase1C error", e);
  }
}
if (typeof window !== "undefined") {
  window.optimizeStoragePhase1C = optimizeStoragePhase1C;
}

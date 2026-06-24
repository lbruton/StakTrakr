// FILTERS MODULE
// =============================================================================

/**
 * Advanced filtering system
 */
/** @type {Object.<string, FilterConfig>} */
let activeFilters = {};

/**
 * Cache for computed search strings to optimize filter performance.
 * Key: inventory item object
 * Value: lowercase concatenated search string
 */
let searchCache = new WeakMap();

/**
 * Invalidates the search cache for a specific item.
 * Call this when an item's properties or tags are modified in place.
 * @param {Object} item - The inventory item to invalidate
 */
window.invalidateSearchCache = (item) => {
  if (item && typeof item === "object") {
    searchCache.delete(item);
  }
};

/**
 * Resets the entire search cache.
 * Call this for bulk updates or when many items change.
 */
window.resetSearchCache = () => {
  searchCache = new WeakMap();
};

/**
 * Clears all active filters and resets search input and pagination.
 */
const clearAllFilters = () => {
  activeFilters = {};
  searchQuery = "";

  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.value = "";
  if (typeof window.updateSaveSearchButton === "function") {
    window.updateSaveSearchButton("", false);
  }

  const typeFilter = document.getElementById("typeFilter");
  if (typeFilter) typeFilter.value = "";

  const metalFilter = document.getElementById("metalFilter");
  if (metalFilter) metalFilter.value = "";

  // Update chip UI before rerendering the table
  renderActiveFilters();
  renderTable();
};

/**
 * Removes a specific filter from active filters or search.
 *
 * @param {string} field - The field to remove filter from
 * @param {string} value - The value to remove from filter
 */
const removeFilter = (field, value) => {
  if (field === "search") {
    // Clear search query
    searchQuery = "";
    const searchInput = document.getElementById("searchInput");
    if (searchInput) searchInput.value = "";
    if (typeof window.updateSaveSearchButton === "function") {
      window.updateSaveSearchButton("", false);
    }
  } else if (activeFilters[field]) {
    if (activeFilters[field].values && Array.isArray(activeFilters[field].values)) {
      // Remove specific value from array
      activeFilters[field].values = activeFilters[field].values.filter((v) => v !== value);
      // If no values left, remove the entire filter
      if (activeFilters[field].values.length === 0) {
        delete activeFilters[field];
      }
    } else {
      // Remove entire filter
      delete activeFilters[field];
    }
  }

  renderTable();
};

/**
 * Returns the display value for a filter chip.
 * Passes through the value as-is — hardcoded name simplifications have been
 * removed in favour of user-configurable custom grouping rules in Settings.
 *
 * @param {string} value - The original value
 * @param {string} field - The field type (e.g., 'name', 'type', etc.)
 * @returns {string} Display value
 */
const simplifyChipValue = (value, field) => {
  if (!value || typeof value !== "string") {
    return value;
  }

  // Handle comma-separated values
  if (value.includes(", ")) {
    return value
      .split(", ")
      .map((v) => simplifyChipValue(v.trim(), field))
      .join(", ");
  }

  return value;
};

/**
 * Tallies an item's metal (first composition words) into the metals bucket.
 * @param {Object.<string, number>} metals - Metal → count map (mutated)
 * @param {Object} item - Inventory item
 */
const _tallyMetal = (metals, item) => {
  const metal = getCompositionFirstWords(item.composition || item.metal || "");
  if (metal) {
    metals[metal] = (metals[metal] || 0) + 1;
  }
};

/**
 * Tallies an item's type into the types bucket.
 * @param {Object.<string, number>} types - Type → count map (mutated)
 * @param {Object} item - Inventory item
 */
const _tallyType = (types, item) => {
  if (item.type) {
    types[item.type] = (types[item.type] || 0) + 1;
  }
};

/**
 * Tallies an item's payment method (trimmed key) into the payment-methods bucket.
 * @param {Object.<string, number>} paymentMethods - Method → count map (mutated)
 * @param {Object} item - Inventory item
 */
const _tallyPaymentMethod = (paymentMethods, item) => {
  const payMethod = (item.paymentMethod || "").trim();
  if (payMethod) {
    paymentMethods[payMethod] = (paymentMethods[payMethod] || 0) + 1;
  }
};

/**
 * Tallies a location value into a location bucket, skipping empty / "Unknown" /
 * "Numista Import". The bucket key is the original (untrimmed) value to match
 * legacy chip output. "Numista Import" is a synthetic non-location: the filter
 * predicate (_filterByLocationField) and the table display layer both normalize
 * it to the "—" placeholder, so tallying it would render a location chip that can
 * never match the predicate — clicking it would filter the table to zero (STRK-206).
 * @param {Object.<string, number>} map - Location → count map (mutated)
 * @param {string} rawLoc - The raw location value (purchase or storage)
 */
const _tallyLocation = (map, rawLoc) => {
  const loc = (rawLoc || "").trim().toLowerCase();
  if (loc && loc !== "unknown" && loc !== "numista import") {
    map[rawLoc] = (map[rawLoc] || 0) + 1;
  }
};

/**
 * Tallies a trimmed scalar value (year / grade / numistaId), skipping empty.
 * @param {Object.<string, number>} map - Value → count map (mutated)
 * @param {string} rawValue - The raw field value
 */
const _tallyTrimmed = (map, rawValue) => {
  const v = (rawValue || "").trim();
  if (v) {
    map[v] = (map[v] || 0) + 1;
  }
};

/**
 * Tallies an item's normalized (grouped) name when GROUPED_NAME_CHIPS is enabled.
 * @param {Object.<string, number>} names - Base name → count map (mutated)
 * @param {Object} item - Inventory item
 */
const _tallyName = (names, item) => {
  if (window.featureFlags && window.featureFlags.isEnabled("GROUPED_NAME_CHIPS")) {
    const itemName = (item.name || "").trim();
    if (itemName) {
      let baseName = itemName;
      if (window.autocomplete && typeof window.autocomplete.normalizeItemName === "function") {
        baseName = window.autocomplete.normalizeItemName(itemName);
      }
      names[baseName] = (names[baseName] || 0) + 1;
    }
  }
};

/**
 * Tallies an item's non-pure fineness (0 < purity < 1.0) into the purities bucket.
 * @param {Object.<string, number>} purities - Purity-string → count map (mutated)
 * @param {Object} item - Inventory item
 */
const _tallyPurity = (purities, item) => {
  const pur = parseFloat(item.purity);
  if (!isNaN(pur) && pur > 0 && pur < 1.0) {
    const purKey = String(pur);
    purities[purKey] = (purities[purKey] || 0) + 1;
  }
};

/**
 * Tallies an item's tags into the tags bucket (STAK-126).
 * @param {Object.<string, number>} tags - Tag → count map (mutated)
 * @param {Object} item - Inventory item
 */
const _tallyTags = (tags, item) => {
  if (typeof getItemTags === "function" && item.uuid) {
    const itemTags = getItemTags(item.uuid) || [];
    itemTags.forEach((tag) => {
      tags[tag] = (tags[tag] || 0) + 1;
    });
  }
};

/**
 * Generates category summary from filtered inventory.
 * Returns summary of metals, types, and item counts above minimum threshold.
 *
 * @param {Array<Object>} inventory - The filtered inventory
 * @returns {Object} Summary of metals, types, and counts
 */
const generateCategorySummary = (inventory) => {
  // Get minimum count setting from dropdown control or localStorage
  const chipMinCountEl = document.getElementById("chipMinCount");
  let minCount = 3;
  if (chipMinCountEl && chipMinCountEl.value) {
    minCount = parseInt(chipMinCountEl.value, 10);
  } else {
    minCount = parseInt(localStorage.getItem("chipMinCount") || "3", 10);
  }

  const nameMinCount = Math.max(2, minCount);

  const metals = {};
  const types = {};
  const paymentMethods = {};
  const purchaseLocations = {};
  const storageLocations = {};
  const names = {};
  const years = {};
  const grades = {};
  const numistaIds = {};
  const purities = {};
  const tags = {};

  inventory.forEach((item) => {
    _tallyMetal(metals, item);
    _tallyType(types, item);
    _tallyPaymentMethod(paymentMethods, item);
    _tallyLocation(purchaseLocations, item.purchaseLocation);
    _tallyLocation(storageLocations, item.storageLocation);
    _tallyName(names, item);
    _tallyTrimmed(years, item.year);
    _tallyTrimmed(grades, item.grade);
    _tallyTrimmed(numistaIds, item.numistaId);
    _tallyPurity(purities, item);
    _tallyTags(tags, item);
  });

  // Count custom groups
  let customGroups = {};
  if (typeof window.countCustomGroups === "function") {
    customGroups = window.countCustomGroups(inventory);
  }

  // Extract dynamic chips (text from parentheses/quotes)
  let dynamicNames = {};
  if (
    window.featureFlags &&
    window.featureFlags.isEnabled("DYNAMIC_NAME_CHIPS") &&
    typeof window.extractDynamicChips === "function"
  ) {
    dynamicNames = window.extractDynamicChips(inventory);
  }

  // Apply minCount threshold to all categories
  const filteredMetals = applyMinCountThreshold(metals, minCount);
  const filteredTypes = applyMinCountThreshold(types, minCount);
  const filteredPaymentMethods = applyMinCountThreshold(paymentMethods, minCount);
  const filteredPurchaseLocations = applyMinCountThreshold(purchaseLocations, minCount);
  const filteredStorageLocations = applyMinCountThreshold(storageLocations, minCount);
  let filteredNames = applyMinCountThreshold(names, nameMinCount);
  const filteredYears = applyMinCountThreshold(years, minCount);
  const filteredGrades = applyMinCountThreshold(grades, minCount);
  const filteredNumistaIds = applyMinCountThreshold(numistaIds, minCount);
  const filteredPurities = applyMinCountThreshold(purities, minCount);
  const filteredTags = applyMinCountThreshold(tags, minCount);
  const filteredDynamicNames = applyMinCountThreshold(dynamicNames, nameMinCount);

  // Apply blacklist filter to auto-generated name chips, dynamic chips, tag chips,
  // and custom-group labels so shift-click suppression is consistent across chip types.
  if (typeof window.isBlacklisted === "function") {
    filteredNames = Object.fromEntries(
      Object.entries(filteredNames).filter(([key]) => !window.isBlacklisted(key))
    );
    // Filter dynamic names through blacklist too
    for (const key of Object.keys(filteredDynamicNames)) {
      if (window.isBlacklisted(key)) {
        delete filteredDynamicNames[key];
      }
    }
    for (const key of Object.keys(filteredTags)) {
      if (window.isBlacklisted(key)) {
        delete filteredTags[key];
      }
    }
    for (const groupId of Object.keys(customGroups)) {
      const info = customGroups[groupId];
      if (info && window.isBlacklisted(info.label)) {
        delete customGroups[groupId];
      }
    }
  }

  // Suppress auto-generated names that duplicate a custom group label
  const customLabelsLower = new Set(Object.values(customGroups).map((g) => g.label.toLowerCase()));
  filteredNames = Object.fromEntries(
    Object.entries(filteredNames).filter(([key]) => !customLabelsLower.has(key.toLowerCase()))
  );

  // Apply minCount threshold to custom groups
  const filteredCustomGroups = Object.fromEntries(
    Object.entries(customGroups).filter(([, info]) => info.count >= minCount)
  );

  return {
    metals: filteredMetals,
    types: filteredTypes,
    paymentMethods: filteredPaymentMethods,
    purchaseLocations: filteredPurchaseLocations,
    storageLocations: filteredStorageLocations,
    names: filteredNames,
    years: filteredYears,
    grades: filteredGrades,
    numistaIds: filteredNumistaIds,
    customGroups: filteredCustomGroups,
    dynamicNames: filteredDynamicNames,
    purities: filteredPurities,
    tags: filteredTags,
    totalItems: inventory.length,
  };
};

/**
 * Resets the disposed-items filter back to "hide" and re-renders. Shared by the
 * disposed-mode chip's click handler and its close (×) action.
 */
const _resetDisposedFilter = () => {
  // safeGetElement returns a truthy DUMMY (not null) when the element is absent,
  // so `if (!dfg)` would not guard it — assert a real element before touching the
  // DOM, while still persisting + re-rendering regardless (STRK-207).
  const dfg = safeGetElement("disposedFilterGroup");
  if (dfg instanceof HTMLElement) {
    dfg.querySelectorAll(".chip-sort-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.disposedMode === "hide");
    });
  }
  if (typeof saveData === "function") saveData("disposedFilterMode", "hide");
  if (typeof renderTable === "function") renderTable();
  renderActiveFilters();
};

/**
 * Collects category-summary chips into `chips` (honoring category config order,
 * grouping, and sort preference) and returns the set of fields that produced a
 * category. Mutates `chips` in place.
 * @param {Object} categorySummary - Output of generateCategorySummary
 * @param {Array<Object>} chips - The chip accumulator (mutated)
 * @returns {Set<string>} The set of category fields rendered
 */
const _buildCategoryFilterChips = (categorySummary, chips) => {
  // Category descriptor map — maps category ID to summary key, chip field, and extra props
  const categoryDescriptors = {
    metal: { summaryKey: "metals", field: "metal" },
    type: { summaryKey: "types", field: "type" },
    name: { summaryKey: "names", field: "name", extraProps: { isGrouped: true } },
    customGroup: { summaryKey: "customGroups", field: "customGroup" },
    dynamicName: {
      summaryKey: "dynamicNames",
      field: "dynamicName",
      extraProps: { isDynamic: true },
    },
    paymentMethod: { summaryKey: "paymentMethods", field: "paymentMethod" },
    purchaseLocation: { summaryKey: "purchaseLocations", field: "purchaseLocation" },
    storageLocation: { summaryKey: "storageLocations", field: "storageLocation" },
    year: { summaryKey: "years", field: "year" },
    grade: { summaryKey: "grades", field: "grade" },
    numistaId: { summaryKey: "numistaIds", field: "numistaId" },
    purity: { summaryKey: "purities", field: "purity" },
    tags: { summaryKey: "tags", field: "tags" },
  };

  // Read category config (order + enabled state) and sort preference
  const categoryConfig =
    typeof getFilterChipCategoryConfig === "function"
      ? getFilterChipCategoryConfig()
      : [
          { id: "metal", enabled: true },
          { id: "type", enabled: true },
          { id: "name", enabled: true },
          { id: "customGroup", enabled: true },
          { id: "dynamicName", enabled: true },
          { id: "paymentMethod", enabled: true },
          { id: "purchaseLocation", enabled: true },
          { id: "storageLocation", enabled: true },
          { id: "year", enabled: true },
          { id: "grade", enabled: true },
          { id: "numistaId", enabled: true },
          { id: "purity", enabled: true },
          { id: "tags", enabled: true },
        ];

  // Read sort preference from toggle active button or localStorage (default: alpha)
  const sortEl = document.getElementById("chipSortOrder");
  const activeBtn = sortEl && sortEl.querySelector(".chip-sort-btn.active");
  const rawPref =
    (activeBtn && activeBtn.dataset.sort) || localStorage.getItem("chipSortOrder") || "alpha";
  const chipSortPref = rawPref === "count" ? "count" : "alpha";

  // Helper: collect chips for a single category from the summary data
  const collectCategoryChips = (cat) => {
    const desc = categoryDescriptors[cat.id];
    if (!desc) return [];
    const data = categorySummary[desc.summaryKey];
    if (!data) return [];
    const result = [];
    if (cat.id === "customGroup") {
      Object.entries(data).forEach(([groupId, info]) => {
        if (info.count > 0) {
          result.push({
            field: desc.field,
            value: groupId,
            displayLabel: info.label,
            count: info.count,
            total: categorySummary.totalItems,
            isCustomGroup: true,
          });
        }
      });
    } else {
      Object.entries(data).forEach(([value, count]) => {
        if (count > 0) {
          result.push({
            field: desc.field,
            value,
            count,
            total: categorySummary.totalItems,
            ...(desc.extraProps || {}),
          });
        }
      });
    }
    return result;
  };

  // Helper: sort a chip array in place based on preference
  const sortChips = (arr) => {
    if (chipSortPref === "alpha") {
      arr.sort((a, b) => {
        const aLabel = (a.displayLabel || a.value || "").toString();
        const bLabel = (b.displayLabel || b.value || "").toString();
        return aLabel.localeCompare(bLabel, undefined, { numeric: true, sensitivity: "base" });
      });
    } else if (chipSortPref === "count") {
      arr.sort((a, b) => (b.count || 0) - (a.count || 0));
    }
  };

  // Build chips — categories with the same group letter pool and sort together
  const categoryFields = new Set();
  const emittedGroups = new Set();

  for (const cat of categoryConfig) {
    if (!cat.enabled) continue;
    const desc = categoryDescriptors[cat.id];
    if (!desc) continue;
    categoryFields.add(desc.field);

    if (cat.group) {
      // Grouped: first encounter collects ALL categories in this group
      if (emittedGroups.has(cat.group)) continue;
      emittedGroups.add(cat.group);

      const pooled = [];
      for (const gc of categoryConfig) {
        if (!gc.enabled || gc.group !== cat.group) continue;
        const gcDesc = categoryDescriptors[gc.id];
        if (gcDesc) categoryFields.add(gcDesc.field);
        pooled.push(...collectCategoryChips(gc));
      }
      sortChips(pooled);
      chips.push(...pooled);
    } else {
      // Ungrouped: collect and sort individually
      const catChips = collectCategoryChips(cat);
      sortChips(catChips);
      chips.push(...catChips);
    }
  }

  return categoryFields;
};

/**
 * Applies the chipMaxCount cap to category chips only — search chips are always
 * kept and re-prepended. Mutates `chips` in place.
 * @param {Array<Object>} chips - The chip accumulator (mutated)
 */
const _applyChipMaxCount = (chips) => {
  const chipMaxCountEl = safeGetElement("chipMaxCount");
  const maxCount = chipMaxCountEl
    ? parseInt(chipMaxCountEl.value, 10)
    : parseInt(localStorage.getItem("chipMaxCount") || "0", 10);
  if (maxCount > 0) {
    const uncappedChips = chips.filter((c) => c && c.field === "search");
    const cappedCandidates = chips.filter((c) => !c || c.field !== "search");
    if (cappedCandidates.length > maxCount) {
      cappedCandidates.splice(maxCount);
    }
    chips.length = 0;
    chips.push(...uncappedChips, ...cappedCandidates);
  }
};

/**
 * Appends explicitly-applied active-filter chips that are not already covered by
 * a category summary chip (excluded filters stay visible). Mutates `chips`.
 * @param {Array<Object>} chips - The chip accumulator (mutated)
 * @param {Set<string>} categoryFields - Fields already rendered as category chips
 */
const _appendActiveFilterChips = (chips, categoryFields) => {
  Object.entries(activeFilters).forEach(([field, criteria]) => {
    // Skip fields already rendered as category summary chips to avoid duplicates
    // BUT: if no summary chip was rendered for this field (all below minCount),
    // fall through so the user can still see and remove their active filter
    if (categoryFields.has(field)) {
      let hasSummaryChip = chips.some((c) => c.field === field && c.count !== undefined);
      // For 'name' filters, customGroup/dynamicName chips provide visual coverage
      // so suppress the individual name fallback when those chips are present
      if (field === "name" && !hasSummaryChip) {
        hasSummaryChip = chips.some(
          (c) => (c.field === "customGroup" || c.field === "dynamicName") && c.count !== undefined
        );
      }
      // Keep excluded filters visible even when category summary chips exist.
      const isExcludeFilter = !!(criteria && typeof criteria === "object" && criteria.exclude);
      if (hasSummaryChip && !isExcludeFilter) return;
    }

    if (criteria && typeof criteria === "object" && Array.isArray(criteria.values)) {
      criteria.values.forEach((value) => {
        if (value && value.toString().trim()) {
          chips.push({ field, value, exclude: criteria.exclude });
        }
      });
    } else {
      if (criteria && criteria.toString().trim()) {
        chips.push({ field, value: criteria });
      }
    }
  });
};

/**
 * Determines whether a chip represents a currently-active filter (controls the
 * `filter-chip-active` class). Summary chips check their value against
 * activeFilters (expansion chips check their dedicated entry); fallback chips are
 * always active.
 * @param {Object} f - The chip descriptor
 * @returns {boolean} True when the chip is an active filter
 */
const _resolveChipActiveState = (f) => {
  if (f.count === undefined || f.total === undefined) {
    // Fallback active-filter chips (below minCount or excluded) are always "active"
    return true;
  }
  // STAK-551: expansion chips store their own activeFilters entries.
  if (f.field === "customGroup") {
    const cg = activeFilters["customGroup"];
    return !!(cg && !cg.exclude && cg.values && cg.values.includes(f.value));
  }
  if (f.field === "dynamicName") {
    const dn = activeFilters["dynamicName"];
    return !!(dn && !dn.exclude && dn.values && dn.values.includes(f.value));
  }
  if (f.field === "name" && f.isGrouped) {
    const gn = activeFilters["groupedName"];
    return !!(gn && !gn.exclude && gn.values && gn.values.includes(f.value));
  }
  const criteria = activeFilters[f.field];
  if (criteria && Array.isArray(criteria.values) && !criteria.exclude) {
    return criteria.values.includes(f.value);
  }
  return false;
};

/**
 * Resolves the display text for a chip value (custom-group label, dynamic/name
 * passthrough, Numista "N#" prefix, or the simplified value).
 * @param {Object} f - The chip descriptor
 * @returns {string} Display value
 */
const _resolveChipDisplayValue = (f) => {
  if (f.isCustomGroup) return f.displayLabel;
  if (f.isDynamic) return f.value;
  if (f.field === "name") return f.value;
  if (f.field === "numistaId") return `N#${f.value}`;
  return simplifyChipValue(f.value, f.field);
};

/**
 * Resolves the full chip label (disposed-mode text, search passthrough, optional
 * count badge on summary chips, or the value with an "(exclude)" suffix).
 * @param {Object} f - The chip descriptor
 * @param {string} displayValue - The resolved display value
 * @returns {string} The chip label
 */
const _resolveChipLabel = (f, displayValue) => {
  if (f.field === "disposed-mode") return "Showing: Disposed Items";
  if (f.field === "search") return displayValue;
  if (f.count !== undefined && f.total !== undefined) {
    // For category summary chips, show count badge if enabled
    const showQty = window.featureFlags && window.featureFlags.isEnabled("CHIP_QTY_BADGE");
    return showQty ? `${displayValue} (${f.count})` : displayValue;
  }
  return `${displayValue}${f.exclude ? " (exclude)" : ""}`;
};

/**
 * Shared close (×) action for a chip — disposed reset, active-filter removal, or
 * idle-summary-chip exclusion. Invoked by both the click and keyboard handlers.
 * @param {Object} f - The chip descriptor
 * @param {boolean} isActiveFilter - Whether the chip is an active filter
 */
const _chipCloseAction = (f, isActiveFilter) => {
  if (f.field === "disposed-mode") {
    _resetDisposedFilter();
  } else if (isActiveFilter) {
    // Active filter chip × — always removes the filter (de-activate, not exclude)
    removeFilter(f.field, f.value);
    renderActiveFilters();
  } else if (f.count !== undefined && f.total !== undefined && f.field !== "search") {
    // Idle summary chip × — exclude this value while keeping other filters intact
    applyQuickFilter(
      f.field,
      f.value,
      f.isGrouped || f.isCustomGroup || f.isDynamic || false,
      true
    );
  } else {
    removeFilter(f.field, f.value);
    renderActiveFilters();
  }
};

/**
 * Attaches the right-click context menu (blacklist) to name and dynamicName chips.
 * @param {HTMLElement} chip - The chip element
 * @param {Object} f - The chip descriptor
 */
const _attachChipContextMenu = (chip, f) => {
  if (f.field !== "name" && f.field !== "dynamicName") return;
  chip.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const chipName = f.field === "dynamicName" ? f.value : f.value;
    if (typeof window.showChipContextMenu === "function") {
      window.showChipContextMenu(e.clientX, e.clientY, chipName);
    }
  });
};

/**
 * Attaches the tooltip and primary click behavior for a chip: summary chips apply
 * (or shift+click blacklist) a filter, the disposed-mode chip resets, and active
 * filter chips remove themselves.
 * @param {HTMLElement} chip - The chip element
 * @param {Object} f - The chip descriptor
 * @param {string} displayValue - The resolved display value (for the tooltip)
 */
const _attachChipPrimaryClick = (chip, f, displayValue) => {
  if (f.count !== undefined && f.total !== undefined) {
    // Category summary chips - clicking adds filter; shift+click blacklists supported chip names.
    const canBlacklist =
      f.field === "name" ||
      f.field === "dynamicName" ||
      f.field === "customGroup" ||
      f.field === "tags";
    const chipNameForBlacklist = f.field === "customGroup" ? f.displayLabel || f.value : f.value;
    chip.title =
      `Click to filter by ${f.field}: ${displayValue} (${f.count} items)` +
      (canBlacklist ? " · Shift+click to ignore" : "");
    chip.addEventListener("click", (e) => {
      if (canBlacklist && e.shiftKey && typeof window.showBlacklistConfirm === "function") {
        e.preventDefault();
        window.showBlacklistConfirm(e.clientX, e.clientY, chipNameForBlacklist);
        return;
      }
      applyQuickFilter(f.field, f.value, f.isGrouped || f.isCustomGroup || f.isDynamic || false);
    });
  } else if (f.field === "disposed-mode") {
    // Disposed-mode chip — clicking resets disposed filter back to 'hide'
    chip.title = "Showing disposed items only (click to hide disposed)";
    chip.addEventListener("click", _resetDisposedFilter);
  } else {
    // Active filter chips - clicking removes filter
    chip.title =
      f.field === "search"
        ? `Search term: ${displayValue} (click to remove)`
        : `Active ${f.exclude ? "excluded" : "included"} filter: ${f.field} = ${displayValue} (click to remove)`;
    chip.addEventListener("click", () => {
      removeFilter(f.field, f.value);
      renderActiveFilters();
    });
  }
};

/**
 * Attaches the accessible close (×) control to a chip: ARIA role/label plus click
 * and keyboard (Enter/Space) handlers, both delegating to `_chipCloseAction`.
 * @param {HTMLElement} close - The close-marker span
 * @param {Object} f - The chip descriptor
 * @param {boolean} isActiveFilter - Whether the chip is an active filter
 * @param {string} displayValue - The resolved display value (for the ARIA label)
 */
const _attachChipCloseControl = (close, f, isActiveFilter, displayValue) => {
  // Make the close glyph interactive and keyboard accessible (removes the filter)
  close.setAttribute("role", "button");
  close.setAttribute("tabindex", "0");
  close.setAttribute("aria-label", `Remove filter ${displayValue}`);
  close.onclick = (e) => {
    e.stopPropagation();
    _chipCloseAction(f, isActiveFilter);
  };
  close.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      _chipCloseAction(f, isActiveFilter);
    }
  };
};

/**
 * Builds a single filter-chip element (color, classes, label, close marker, and
 * all interaction handlers) and appends it to the container.
 * @param {Object} f - The chip descriptor
 * @param {number} i - The chip index (for fallback color cycling)
 * @param {HTMLElement} container - The chip container to append into
 */
const _buildFilterChipElement = (f, i, container) => {
  const chip = document.createElement("span");
  chip.className = "filter-chip";
  if (f.exclude) chip.classList.add("filter-chip-excluded");
  // All chip categories render visually identical — no italic/bold distinction
  const firstValue = String(f.value).split(", ")[0];
  const colorKey = f.field === "customGroup" ? f.displayLabel || firstValue : firstValue;
  const { bg, text: textColor } = getChipColors(f.field, colorKey, i);
  chip.style.backgroundColor = bg;
  chip.style.color = textColor || getContrastColor(bg);

  const isActiveFilter = _resolveChipActiveState(f);
  if (isActiveFilter) chip.classList.add("filter-chip-active");
  if (f.field === "search") chip.classList.add("filter-chip-search");

  const displayValue = _resolveChipDisplayValue(f);
  const label = _resolveChipLabel(f, displayValue);

  // Use safe textContent and a separate close marker span to avoid HTML injection
  chip.textContent = label + " ";
  const close = document.createElement("span");
  close.className = "chip-close";
  close.textContent = "×";
  close.setAttribute("aria-hidden", "true");
  chip.appendChild(close);

  // Debug logging (opt-in)
  if (window.DEBUG_FILTERS) {
    console.debug("renderActiveFilters: adding chip", { field: f.field, value: f.value, label });
  }

  _attachChipContextMenu(chip, f);
  _attachChipPrimaryClick(chip, f, displayValue);
  _attachChipCloseControl(close, f, isActiveFilter, displayValue);

  container.appendChild(chip);
};

/**
 * Renders active filter chips beneath the search bar.
 * Updates the filter chip container based on current filters and inventory.
 */
const renderActiveFilters = () => {
  const container = document.getElementById("activeFilters");
  if (!container) return;

  container.innerHTML = "";

  // Get the current filtered inventory first
  const filteredInventory = filterInventoryAdvanced();

  if (filteredInventory.length === 0) {
    // Show a hint when search narrows to 0 results instead of hiding chips entirely (UX-004)
    if (searchQuery && searchQuery.trim()) {
      container.style.display = "";
      const hint = document.createElement("span");
      hint.className = "filter-chip search-hint-chip";
      hint.style.opacity = "0.55";
      hint.style.cursor = "default";
      hint.textContent = "Clear search to use filter chips";
      container.appendChild(hint);
      return;
    }
    container.style.display = "none";
    return;
  }

  // Build chips based on what's actually in the filtered inventory
  const chips = [];

  // Add search term chip if there's a search query
  if (searchQuery && searchQuery.trim()) {
    chips.push({ field: "search", value: searchQuery });
  }

  // Add disposed-only mode chip (STAK-388)
  var activeDisposedBtnChip = document.querySelector("#disposedFilterGroup .chip-sort-btn.active");
  var disposedModeChip =
    (activeDisposedBtnChip &&
      activeDisposedBtnChip.dataset &&
      activeDisposedBtnChip.dataset.disposedMode) ||
    "hide";
  if (disposedModeChip === "show-only") {
    chips.push({ field: "disposed-mode", value: "show-only" });
  }

  // Generate category summary chips from filtered inventory
  const categorySummary = generateCategorySummary(filteredInventory);
  const categoryFields = _buildCategoryFilterChips(categorySummary, chips);

  // Apply chipMaxCount cap to category chips only — search and active chips append after
  _applyChipMaxCount(chips);

  // Add any explicitly applied filter chips (but not if they duplicate category chips)
  _appendActiveFilterChips(chips, categoryFields);

  if (chips.length === 0) {
    container.style.display = "none";
    return;
  }

  container.style.display = "";

  chips.forEach((f, i) => _buildFilterChipElement(f, i, container));

  // Add clear button if there are any chips (check for both active and summary chips)
  if (chips.length > 0) {
    const clearButton = document.createElement("button");
    clearButton.className = "filter-clear-btn";
    clearButton.innerHTML = "Clear All";
    clearButton.title = "Clear all active filters";
    clearButton.onclick = () => {
      clearAllFilters();
    };
    container.appendChild(clearButton);
  }
};

/**
 * Checks whether a two-word search like "Silver Eagle" should match an item,
 * preventing cross-metal false positives (e.g. "Silver Eagle" matching "American Gold Eagle").
 *
 * @param {string} searchMetal - First word of the two-word search (lowercase)
 * @param {string} coinType - Second word of the two-word search (lowercase)
 * @param {string} itemText - Concatenated item fields (lowercase)
 * @param {string} exactPhrase - Full two-word search string (lowercase)
 * @returns {boolean|null} true/false for definitive match result, null to fall through to default logic
 */
const matchCoinSeries = (searchMetal, coinType, itemText, exactPhrase) => {
  const metalWords = ["gold", "silver", "platinum", "palladium"];

  // Two-word coin-series disambiguation rules — mirrors search.js's `_COIN_SERIES`
  // table-dispatch (filters.js keeps a function-local copy because both files are
  // top-level script-tag globals and cannot share a module-scope `const`).
  // `country` = origin prefix(es) that must not have an unrequested metal between
  // them and the series word; `metalPhrase` = extra accepted phrase for
  // metal-prefixed queries (maple leaf); `krugerSpecial` = krugerrand's
  // dual-pattern origin check.
  const series = {
    eagle: { country: ["american"], metalPhrase: null },
    maple: { country: ["canadian"], metalPhrase: (m) => `${m} maple leaf` },
    britannia: { country: ["british"], metalPhrase: null },
    krugerrand: { country: ["south", "african"], metalPhrase: null, krugerSpecial: true },
    buffalo: { country: ["american"], metalPhrase: null },
    panda: { country: ["chinese"], metalPhrase: null },
    kangaroo: { country: ["australian"], metalPhrase: null },
  };

  // True when itemText contains "<prefix> <metal> <coinType>" for a metal the
  // query did not specify — i.e. an unrequested cross-metal match.
  const hasMetalBetween = (prefix) =>
    metalWords.some(
      (metal) => itemText.includes(`${prefix} ${metal} ${coinType}`) && !exactPhrase.includes(metal)
    );

  const rule = series[coinType];
  if (!rule) return null; // No series match — fall through to default logic

  if (metalWords.includes(searchMetal)) {
    if (rule.metalPhrase) {
      return itemText.includes(exactPhrase) || itemText.includes(rule.metalPhrase(searchMetal));
    }
    return itemText.includes(exactPhrase);
  }

  if (rule.country.includes(searchMetal)) {
    if (rule.krugerSpecial) {
      return !metalWords.some(
        (metal) =>
          (itemText.includes(`south african ${metal} krugerrand`) ||
            itemText.includes(`${metal} krugerrand`)) &&
          !exactPhrase.includes(metal)
      );
    }
    return !hasMetalBetween(searchMetal);
  }

  return null; // Recognized series but unrecognized prefix — fall through
};

/**
 * Applies a minimum count threshold to a category data object, filtering out entries below the threshold.
 * @param {Object} data - Map of { key: count }
 * @param {number} minCount - Minimum count to include
 * @returns {Object} Filtered map
 */
const applyMinCountThreshold = (data, minCount) => {
  return Object.fromEntries(Object.entries(data).filter(([, count]) => count >= minCount));
};

/**
 * Returns chip color and text color for a given field/value combination.
 * @param {string} field - Chip field type
 * @param {string} value - Chip value
 * @param {number} index - Chip index for fallback color cycling
 * @returns {{ bg: string, text: string|undefined }} Background and optional text color
 */
const getChipColors = (field, value, index) => {
  const fallbackColors = [
    "var(--primary)",
    "var(--secondary)",
    "var(--success)",
    "var(--warning)",
    "var(--danger)",
    "var(--info)",
  ];
  let color;
  let textColor;

  switch (field) {
    case "type":
      color = getTypeColor(value);
      break;
    case "metal":
      if (!METAL_COLORS[value]) {
        color = getColor(nameColors, value);
      } else {
        color = METAL_COLORS[value];
        textColor = METAL_TEXT_COLORS[value] ? METAL_TEXT_COLORS[value]() : undefined;
      }
      break;
    case "name":
    case "dynamicName":
      color = getColor(nameColors, value);
      break;
    case "customGroup":
      color = getColor(nameColors, value);
      break;
    case "tags":
      color = getColor(nameColors, value);
      break;
    case "purchaseLocation":
      color = getPurchaseLocationColor(value);
      break;
    case "storageLocation":
      color = getStorageLocationColor(value);
      break;
    default:
      color = fallbackColors[index % fallbackColors.length];
  }

  return { bg: color || fallbackColors[index % fallbackColors.length], text: textColor };
};

/**
 * Recursively collect all string/number leaf values from a Numista catalog object,
 * walking nested objects (obverse, reverse, edge, etc.) while skipping booleans and arrays.
 *
 * Defined at module scope so a single function object is reused for every item
 * rather than a new closure being allocated per filter-loop iteration.
 *
 * @param {object} obj - The object to flatten
 * @returns {string[]} Array of stringified leaf values
 */
const collectNumistaStrings = (obj) =>
  Object.values(obj).flatMap((v) => {
    if ((typeof v === "string" || typeof v === "number") && v !== "") return [String(v)];
    if (v && typeof v === "object" && !Array.isArray(v)) return collectNumistaStrings(v);
    return [];
  });

/**
 * Build the full-text search haystack for a single inventory item.
 * Extracts and joins all searchable fields (including recursively-flattened
 * Numista catalog data) into a single lowercase string.
 *
 * Extracted from `filterInventoryAdvanced` to reduce its cyclomatic complexity
 * and make the indexing logic independently testable.
 *
 * @param {InventoryItem} item - The inventory item to index
 * @param {string} searchTags - Pre-joined tag string for the item
 * @param {string} formattedDate - Pre-formatted display date (lowercase)
 * @returns {string} Lowercase haystack string
 */
const getItemSearchHaystack = (item, searchTags, formattedDate) => {
  let catalogText = "";
  if (item.numistaData && typeof item.numistaData === "object") {
    catalogText = collectNumistaStrings(item.numistaData).join(" ").toLowerCase();
  }

  return [
    item.metal,
    item.composition || "",
    item.name,
    item.type,
    item.purchaseLocation,
    item.storageLocation || "",
    item.notes || "",
    item.capsule || "",
    item.capsuleNotes || "",
    String(item.year || ""),
    item.grade || "",
    item.gradingAuthority || "",
    String(item.certNumber || ""),
    String(item.numistaId || ""),
    item.serialNumber || "",
    searchTags,
    formattedDate,
    catalogText,
  ]
    .join(" ")
    .toLowerCase();
};

/**
 * Filters by exact (simplified) name match.
 * @param {Array<Object>} result - Items to filter
 * @param {Array<string>} values - Selected name values
 * @param {boolean} exclude - Exclusion mode
 * @returns {Array<Object>} Filtered items
 */
const _filterByName = (result, values, exclude) => {
  const simplifiedValues = values.map((v) => simplifyChipValue(v, "name"));
  return result.filter((item) => {
    const itemName = simplifyChipValue(item.name || "", "name");
    const match = simplifiedValues.includes(itemName);
    return exclude ? !match : match;
  });
};

/**
 * Filters by metal (first composition words, case-insensitive).
 * @param {Array<Object>} result - Items to filter
 * @param {Array<string>} values - Selected metal values
 * @param {boolean} exclude - Exclusion mode
 * @returns {Array<Object>} Filtered items
 */
const _filterByMetal = (result, values, exclude) => {
  const lowerVals = values.map((v) => v.toLowerCase());
  return result.filter((item) => {
    const itemMetal = getCompositionFirstWords(item.composition || item.metal || "").toLowerCase();
    const match = lowerVals.includes(itemMetal);
    return exclude ? !match : match;
  });
};

/**
 * Filters by exact type match.
 * @param {Array<Object>} result - Items to filter
 * @param {Array<string>} values - Selected type values
 * @param {boolean} exclude - Exclusion mode
 * @returns {Array<Object>} Filtered items
 */
const _filterByType = (result, values, exclude) => {
  return result.filter((item) => {
    const match = values.includes(item.type);
    return exclude ? !match : match;
  });
};

/**
 * Filters by payment method, normalizing empty values to the "—" placeholder.
 * @param {Array<Object>} result - Items to filter
 * @param {Array<string>} values - Selected payment-method values
 * @param {boolean} exclude - Exclusion mode
 * @returns {Array<Object>} Filtered items
 */
const _filterByPaymentMethod = (result, values, exclude) => {
  return result.filter((item) => {
    const method = (item.paymentMethod || "").trim();
    const normalized = !method ? "—" : method;
    const match = values.includes(normalized);
    return exclude ? !match : match;
  });
};

/**
 * Filters by a location field (purchaseLocation / storageLocation), normalizing
 * empty / "Unknown" / "Numista Import" to the "—" placeholder.
 * @param {Array<Object>} result - Items to filter
 * @param {Array<string>} values - Selected location values
 * @param {boolean} exclude - Exclusion mode
 * @param {string} field - The item field to read (`purchaseLocation`/`storageLocation`)
 * @returns {Array<Object>} Filtered items
 */
const _filterByLocationField = (result, values, exclude, field) => {
  return result.filter((item) => {
    const loc = item[field];
    const normalized = !loc || loc === "Unknown" || loc === "Numista Import" ? "—" : loc;
    const match = values.includes(normalized);
    return exclude ? !match : match;
  });
};

/**
 * Filters by tags (STAK-126/546): include requires ALL selected tags (AND);
 * exclude removes items carrying ANY selected tag. No-op when getItemTags is absent.
 * @param {Array<Object>} result - Items to filter
 * @param {Array<string>} values - Selected tag values
 * @param {boolean} exclude - Exclusion mode
 * @returns {Array<Object>} Filtered items
 */
const _filterByTags = (result, values, exclude) => {
  if (typeof getItemTags !== "function") return result;
  const lowerVals = values.map((v) => v.toLowerCase());
  return result.filter((item) => {
    const rawTags = getItemTags(item.uuid);
    const itemTags = Array.isArray(rawTags) ? rawTags.map((t) => t.toLowerCase()) : [];
    const matchAll = lowerVals.every((v) => itemTags.includes(v));
    const matchAny = lowerVals.some((v) => itemTags.includes(v));
    return exclude ? !matchAny : matchAll;
  });
};

/**
 * Filters by dynamic-name keys embedded in the item name as "(key)" or '"key"'.
 * @param {Array<Object>} result - Items to filter
 * @param {Array<string>} values - Selected dynamic-name keys
 * @param {boolean} exclude - Exclusion mode
 * @returns {Array<Object>} Filtered items
 */
const _filterByDynamicName = (result, values, exclude) => {
  return result.filter((item) => {
    const name = item.name || "";
    const matchAny = values.some(
      (key) => name.includes("(" + key + ")") || name.includes('"' + key + '"')
    );
    return exclude ? !matchAny : matchAny;
  });
};

/**
 * Filters by grouped (normalized) base name, using autocomplete normalization when available.
 * @param {Array<Object>} result - Items to filter
 * @param {Array<string>} values - Selected base names
 * @param {boolean} exclude - Exclusion mode
 * @returns {Array<Object>} Filtered items
 */
const _filterByGroupedName = (result, values, exclude) => {
  return result.filter((item) => {
    const matchAny = values.some((base) => {
      if (window.autocomplete && typeof window.autocomplete.normalizeItemName === "function") {
        return window.autocomplete.normalizeItemName(item.name || "") === base;
      }
      return (item.name || "") === base;
    });
    return exclude ? !matchAny : matchAny;
  });
};

/**
 * Generic fallback filter: case-insensitive exact match on an arbitrary field.
 * @param {Array<Object>} result - Items to filter
 * @param {Array<string>} values - Selected values
 * @param {boolean} exclude - Exclusion mode
 * @param {string} field - The item field to compare
 * @returns {Array<Object>} Filtered items
 */
const _filterByDefault = (result, values, exclude, field) => {
  const lowerVals = values.map((v) => String(v).toLowerCase());
  return result.filter((item) => {
    const fieldVal = String(item[field] ?? "").toLowerCase();
    const match = lowerVals.includes(fieldVal);
    return exclude ? !match : match;
  });
};

/**
 * Weight filter (STRK-240). Constitutional ("cu") items store a face value in
 * `item.weight`, but the table displays — and therefore filters on — the derived
 * pure-silver oz (rounded to the displayed 2 decimals). This keeps the chip matching the
 * clicked cell and stops a $10-face item from colliding with a 10 oz item. Every other
 * unit keeps the raw `item.weight` comparison, identical to `_filterByDefault`.
 * @param {Array<Object>} result - Items to filter
 * @param {Array<string>} values - Selected values
 * @param {boolean} exclude - Exclusion mode
 * @returns {Array<Object>} Filtered items
 */
const _filterByWeight = (result, values, exclude) => {
  const lowerVals = values.map((v) => String(v).toLowerCase());
  return result.filter((item) => {
    const fieldVal =
      item.weightUnit === "cu" && typeof getConstitutionalSilverOz === "function"
        ? getConstitutionalSilverOz(item).toFixed(2)
        : String(item.weight ?? "");
    const match = lowerVals.includes(fieldVal.toLowerCase());
    return exclude ? !match : match;
  });
};

/**
 * Routes a multi-value (array-criteria) active filter to its per-field handler.
 * `_filterByCustomGroup` (regex-bearing) is defined near the file end and resolved
 * here at call time.
 * @param {Array<Object>} result - Items to filter
 * @param {string} field - The active-filter field
 * @param {Array<string>} values - Selected values
 * @param {boolean} exclude - Exclusion mode
 * @returns {Array<Object>} Filtered items
 */
const _applyArrayFilter = (result, field, values, exclude) => {
  switch (field) {
    case "name":
      return _filterByName(result, values, exclude);
    case "metal":
      return _filterByMetal(result, values, exclude);
    case "type":
      return _filterByType(result, values, exclude);
    case "paymentMethod":
      return _filterByPaymentMethod(result, values, exclude);
    case "purchaseLocation":
    case "storageLocation":
      return _filterByLocationField(result, values, exclude, field);
    case "tags":
      return _filterByTags(result, values, exclude);
    case "customGroup":
      return _filterByCustomGroup(result, values, exclude);
    case "dynamicName":
      return _filterByDynamicName(result, values, exclude);
    case "groupedName":
      return _filterByGroupedName(result, values, exclude);
    case "weight":
      return _filterByWeight(result, values, exclude);
    default:
      return _filterByDefault(result, values, exclude, field);
  }
};

/**
 * Routes a scalar (non-array) active filter — the date-range fields.
 * @param {Array<Object>} result - Items to filter
 * @param {string} field - The active-filter field (`dateFrom`/`dateTo`)
 * @param {string} value - The scalar criteria value
 * @returns {Array<Object>} Filtered items
 */
const _applyScalarFilter = (result, field, value) => {
  if (field === "dateFrom") return result.filter((item) => item.date >= value);
  if (field === "dateTo") return result.filter((item) => item.date <= value);
  return result;
};

/**
 * Retrieves (or computes and caches) an item's search data: the lowercase
 * haystack, formatted date, and catalog text. Upgrades legacy string-cache misses.
 * @param {InventoryItem} item - The inventory item
 * @returns {{ text: string, formattedDate: string, catalogText: string }}
 */
const _filterResolveSearchCache = (item) => {
  let cached = searchCache.get(item);
  if (!cached || typeof cached === "string") {
    const _searchTags =
      typeof getItemTags === "function" && item.uuid
        ? (getItemTags(item.uuid) || []).join(" ")
        : "";
    const _formattedDate = formatDisplayDate(item.date).toLowerCase();

    // STRK-86: Delegate haystack assembly to getItemSearchHaystack so that
    // filterInventoryAdvanced stays focused on filter orchestration only.
    const itemText = getItemSearchHaystack(item, _searchTags, _formattedDate);

    const _catalogText =
      item.numistaData && typeof item.numistaData === "object"
        ? collectNumistaStrings(item.numistaData).join(" ").toLowerCase()
        : "";
    cached = { text: itemText, formattedDate: _formattedDate, catalogText: _catalogText };
    searchCache.set(item, cached);
  }
  return cached;
};

/**
 * Tests whether a single search word matches any of an item's fields. Preserves
 * the original OR chain's per-field guarding: the unguarded fields (metal / name /
 * type / purchaseLocation) are regex-tested even when undefined (legacy coercion),
 * while the remaining text fields are skipped when falsy. Date and numeric fields
 * use substring (`includes`) matching; tags use word-boundary regex matching.
 * @param {InventoryItem} item - The inventory item
 * @param {RegExp} wordRegex - Pre-compiled word matcher for this word
 * @param {string} word - The raw search word (for substring/number matching)
 * @param {string} formattedDate - Pre-formatted display date (lowercase)
 * @param {string} catalogText - Pre-flattened Numista catalog text (lowercase)
 * @returns {boolean} True when the word matches any field
 */
const _filterFieldMatchesWord = (item, wordRegex, word, formattedDate, catalogText) => {
  // Unguarded text fields — tested even when undefined (preserves legacy coercion).
  const unguarded = [item.metal, item.name, item.type, item.purchaseLocation];
  if (unguarded.some((f) => wordRegex.test(f))) return true;

  // Guarded text fields — skipped when falsy.
  const guarded = [
    item.composition,
    item.paymentMethod,
    item.storageLocation,
    item.notes,
    item.capsule,
    item.capsuleNotes,
    item.year && String(item.year),
    item.grade,
    item.gradingAuthority,
    item.certNumber && String(item.certNumber),
    item.numistaId && String(item.numistaId),
    item.serialNumber,
    catalogText,
  ];
  if (guarded.some((f) => f && wordRegex.test(f))) return true;

  // Date / numeric fields — substring match against the raw word.
  const numericIncludes = [
    item.date,
    formattedDate,
    String(Number.isFinite(Number(item.qty)) ? Number(item.qty) : ""),
    String(Number.isFinite(Number(item.weight)) ? Number(item.weight) : ""),
    String(Number.isFinite(Number(item.price)) ? Number(item.price) : ""),
  ];
  if (numericIncludes.some((f) => f.includes(word))) return true;

  // Tags (word-boundary match against each tag).
  return (
    typeof getItemTags === "function" &&
    item.uuid &&
    (getItemTags(item.uuid) || []).some((t) => wordRegex.test(t))
  );
};

/**
 * Matches a single-word term: every compiled field regex must match some field,
 * then falls back to custom chip-group label matching and fuzzy autocomplete.
 * @param {Object} termData - Parsed term (q, words, compiledFieldRegexes)
 * @param {InventoryItem} item - The inventory item
 * @param {string} formattedDate - Pre-formatted display date (lowercase)
 * @param {string} catalogText - Pre-flattened Numista catalog text (lowercase)
 * @returns {boolean} True when the term matches the item
 */
const _filterMatchSingleWordTerm = (termData, item, formattedDate, catalogText) => {
  const { q, words, compiledFieldRegexes } = termData;

  // For single words, use word boundary matching with pre-compiled regexes
  const fieldMatch = compiledFieldRegexes.every((wordRegex, index) =>
    _filterFieldMatchesWord(item, wordRegex, words[index], formattedDate, catalogText)
  );
  if (fieldMatch) return true;

  // STACK-23: Fall back to custom chip group label matching
  if (typeof window.itemMatchesCustomGroupLabel === "function") {
    return window.itemMatchesCustomGroupLabel(item, q);
  }

  // STACK-62: Fuzzy fallback — score item fields when exact matching fails
  if (
    typeof window.featureFlags !== "undefined" &&
    window.featureFlags.isEnabled("FUZZY_AUTOCOMPLETE") &&
    typeof fuzzyMatch === "function"
  ) {
    const fuzzyThreshold =
      typeof AUTOCOMPLETE_CONFIG !== "undefined" ? AUTOCOMPLETE_CONFIG.threshold : 0.3;
    const fieldsToCheck = [
      item.name,
      item.purchaseLocation,
      item.storageLocation || "",
      item.notes || "",
      item.capsule || "",
      item.capsuleNotes || "",
    ];
    for (const field of fieldsToCheck) {
      if (field && fuzzyMatch(q, field, { threshold: fuzzyThreshold }) > 0) {
        if (!window._fuzzyMatchUsed) window._fuzzyMatchUsed = true;
        return true;
      }
    }
  }

  return false;
};

/**
 * Matches a multi-word (>=2) term: exact/expanded phrase, custom-group label,
 * word-boundary presence, then coin-series, three-word, and fractional-weight
 * disambiguation rules.
 * @param {Object} termData - Parsed term (q, words, exactPhrase, expandedPhrase, compiledWordRegexes)
 * @param {InventoryItem} item - The inventory item
 * @param {string} itemText - The lowercase item haystack
 * @returns {boolean} True when the term matches the item
 */
const _filterMatchMultiWordTerm = (termData, item, itemText) => {
  const { q, words, exactPhrase, expandedPhrase, compiledWordRegexes } = termData;

  // Check for exact phrase match first
  if (itemText.includes(exactPhrase)) {
    return true;
  }

  // STACK-62: Check expanded abbreviation phrase (e.g. "ase 2024" → "american silver eagle 2024")
  if (expandedPhrase !== exactPhrase && itemText.includes(expandedPhrase)) {
    return true;
  }

  // STACK-23: Check custom chip group label matching for multi-word searches
  if (
    typeof window.itemMatchesCustomGroupLabel === "function" &&
    window.itemMatchesCustomGroupLabel(item, q)
  ) {
    return true;
  }

  // For phrase searches like "American Eagle", be more restrictive
  // Check that all words are present as word boundaries using pre-compiled regexes
  const allWordsPresent = compiledWordRegexes.every((regex) => regex.test(itemText));

  if (!allWordsPresent) {
    return false;
  }

  // Prevent cross-metal matching for common coin series
  if (words.length === 2) {
    const seriesResult = matchCoinSeries(words[0], words[1], itemText, exactPhrase);
    if (seriesResult !== null) return seriesResult;
  }

  // Handle three-word searches with special patterns
  if (words.length === 3) {
    // Handle "American Gold Eagle" type searches - these should be exact
    const firstWord = words[0];
    const middleWord = words[1];
    const lastWord = words[2];

    if (
      ["american", "canadian", "british", "chinese", "australian", "south"].includes(firstWord) &&
      ["gold", "silver", "platinum", "palladium"].includes(middleWord) &&
      ["eagle", "maple", "britannia", "krugerrand", "buffalo", "panda", "kangaroo"].includes(
        lastWord
      )
    ) {
      // For "American Gold Eagle" type searches, require exact phrase or very close match
      return (
        itemText.includes(exactPhrase) ||
        (lastWord === "maple" && itemText.includes(`${firstWord} ${middleWord} maple leaf`))
      );
    }
  }

  // Handle fractional weight searches to be more specific
  // "1/4 oz" should be distinct from "1/2 oz" and "1 oz"
  if (words.length >= 2) {
    const hasFraction = words.some((word) => word.includes("/"));
    const hasOz = words.some((word) => word === "oz" || word === "ounce");

    if (hasFraction && hasOz) {
      // For fractional searches, require exact phrase match
      return itemText.includes(exactPhrase);
    }
  }

  return true;
};

/**
 * Matches one parsed search term against an item, routing to the multi-word or
 * single-word matcher. Comma-separated terms are OR'd by the caller.
 * @param {Object} termData - Parsed term descriptor
 * @param {InventoryItem} item - The inventory item
 * @param {string} itemText - The lowercase item haystack
 * @param {string} formattedDate - Pre-formatted display date (lowercase)
 * @param {string} catalogText - Pre-flattened Numista catalog text (lowercase)
 * @returns {boolean} True when the term matches the item
 */
const _filterTermMatchesItem = (termData, item, itemText, formattedDate, catalogText) => {
  // Special handling for multi-word searches to prevent partial matches.
  // If searching for "American Eagle", it should only match items that have both
  // words but NOT match "American Gold Eagle" (extra word in between).
  if (termData.words.length >= 2) {
    return _filterMatchMultiWordTerm(termData, item, itemText);
  }
  return _filterMatchSingleWordTerm(termData, item, formattedDate, catalogText);
};

/**
 * Enhanced filter inventory function that includes advanced filters.
 * Applies all active filters in `activeFilters` to the inventory.
 *
 * @returns {Array<InventoryItem>} Filtered inventory items
 */
const filterInventoryAdvanced = () => {
  let result = inventory;

  // Three-state disposed filter (STAK-388)
  var activeDisposedBtn = document.querySelector("#disposedFilterGroup .chip-sort-btn.active");
  var disposedMode =
    (activeDisposedBtn && activeDisposedBtn.dataset && activeDisposedBtn.dataset.disposedMode) ||
    "hide";
  if (disposedMode === "hide") {
    result = result.filter(function (item) {
      return !isDisposed(item);
    });
  } else if (disposedMode === "show-only") {
    result = result.filter(function (item) {
      return isDisposed(item);
    });
  }
  // 'show-all' → no filter applied

  // Apply advanced filters — route each active filter to its per-field handler.
  // STAK-551: scalar fields use OR (item matches ANY value); tags use AND (must
  // carry ALL selected tags); expansion chips (customGroup/dynamicName/groupedName)
  // resolve with OR; exclude mode hides items that match ANY value.
  Object.entries(activeFilters).forEach(([field, criteria]) => {
    if (criteria && typeof criteria === "object" && Array.isArray(criteria.values)) {
      result = _applyArrayFilter(result, field, criteria.values, criteria.exclude);
    } else {
      result = _applyScalarFilter(result, field, criteria);
    }
  });

  // Apply text search
  if (!searchQuery.trim()) return result;

  let query = searchQuery.toLowerCase().trim();

  const terms = query
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t);
  if (!terms.length) return result;

  // Pre-calculate search terms and hoist Regex compilation out of the filter loop.
  // This prevents O(N*M) recompilation overhead during large inventory renders.
  const parsedTerms = terms.map((q) => _filterBuildParsedTerm(q));

  return result.filter((item) => {
    const { text: itemText, formattedDate, catalogText } = _filterResolveSearchCache(item);

    // Handle comma-separated terms (OR logic between comma terms)
    return parsedTerms.some((termData) =>
      _filterTermMatchesItem(termData, item, itemText, formattedDate, catalogText)
    );
  });
};

/**
 * Toggles a single-value keyed filter (customGroup / dynamicName / groupedName).
 * These expansion-chip filters store one value whose predicate expands at filter
 * time. If the same value+exclude is already active the filter is removed
 * (toggle-off); otherwise it replaces any existing entry.
 *
 * @param {string} filterKey - The `activeFilters` key to toggle
 * @param {string} value - The value to store
 * @param {boolean} exclude - Whether the filter runs in exclusion mode
 */
const _toggleKeyedFilter = (filterKey, value, exclude) => {
  const existing = activeFilters[filterKey];
  const isCurrentlyActive = !!(
    existing &&
    existing.values &&
    existing.values.includes(value) &&
    existing.exclude === exclude
  );

  if (isCurrentlyActive) {
    delete activeFilters[filterKey];
  } else {
    activeFilters[filterKey] = { values: [value], exclude };
  }
};

/**
 * Toggles an individual value in or out of an accumulating multi-select filter
 * (metal / type / tags). Removes the value when present, appends it otherwise,
 * and deletes the whole filter once its last value is cleared.
 *
 * @param {string} field - The accumulating `activeFilters` field
 * @param {string} value - The value to toggle within the set
 * @param {boolean} exclude - Exclusion mode (carried onto the updated entry)
 */
const _accumulateFilterValue = (field, value, exclude) => {
  const existing = activeFilters[field].values;
  const idx = existing.indexOf(value);
  if (idx !== -1) {
    const updated = existing.filter((v) => v !== value);
    if (updated.length === 0) {
      delete activeFilters[field];
    } else {
      activeFilters[field] = { values: updated, exclude };
    }
  } else {
    activeFilters[field] = { values: [...existing, value], exclude };
  }
};

/**
 * Applies a quick filter for a specific field value (when clicking on table values)
 * Supports 3-level deep filtering - clicking same filter removes it, clicking different filters stacks them
 * @param {string} field - The field to filter by
 * @param {string} value - The value to filter for
 * @param {boolean} [isGrouped=false] - Whether this is a grouped/special filter (uses 'include' logic)
 * @param {boolean} [exclude=false] - Whether to apply the filter in exclusion mode
 */
const applyQuickFilter = (field, value, isGrouped = false, exclude = false) => {
  // Fields that accumulate values on repeated clicks (multi-select).
  // metal/type: OR in predicate (scalar — item has one value, show any match).
  // tags: AND in predicate (array — item has many, must match all selected).
  const isAccumulate = field === "tags" || field === "metal" || field === "type";

  // Handle expansion-chip clicks (customGroup / dynamicName) — store the key;
  // predicate expands at filter time. Toggle on repeat click.
  if (field === "customGroup" || field === "dynamicName") {
    _toggleKeyedFilter(field, value, exclude);
    renderTable();
    renderActiveFilters();
    return;
  }

  // If this exact filter is already active, remove it (toggle behavior — single-select fields only)
  if (
    !isAccumulate &&
    activeFilters[field]?.values?.[0] === value &&
    activeFilters[field]?.exclude === exclude &&
    !isGrouped
  ) {
    delete activeFilters[field];
  } else if (
    field === "name" &&
    isGrouped &&
    window.featureFlags &&
    window.featureFlags.isEnabled("GROUPED_NAME_CHIPS")
  ) {
    // Handle grouped name filtering — store the base name; predicate expands at filter time
    _toggleKeyedFilter("groupedName", value, exclude);
  } else if (isAccumulate && activeFilters[field] && activeFilters[field].exclude === exclude) {
    // Accumulate: toggle individual values in/out of the active set
    _accumulateFilterValue(field, value, exclude);
  } else {
    // Single-select fields, first click, or switching exclude mode: replace
    activeFilters[field] = { values: [value], exclude };
  }

  // Don't clear search query - allow search + filters to work together
  renderTable();
  renderActiveFilters();
};

/**
 * Legacy function for backward compatibility with table click handlers
 * @param {string} field - The field to filter by
 * @param {string} value - The value to filter for
 */
const applyColumnFilter = (field, value) => {
  applyQuickFilter(field, value);
};

// ── Regex-bearing filter helpers (kept last in the file to avoid the Lizard
//    regex-tokenization desync that can roll an extracted helper's CCN into a
//    following function — see [[lizard-esc-regex-desync]]). ──

/**
 * Filters by custom-group membership (STAK-551): resolves selected group IDs to
 * groups, precompiles each pattern to a word-boundary RegExp (falling back to a
 * lowercase substring on invalid patterns), and matches item names against ANY
 * pattern. No-op when no selected ID resolves to a group.
 * @param {Array<Object>} result - Items to filter
 * @param {Array<string>} values - Selected custom-group IDs
 * @param {boolean} exclude - Exclusion mode
 * @returns {Array<Object>} Filtered items
 */
const _filterByCustomGroup = (result, values, exclude) => {
  const groups = typeof window.loadCustomGroups === "function" ? window.loadCustomGroups() : [];
  // Skip filter if none of the selected groupIds resolve to valid groups
  const resolvedGroups = values.map((id) => groups.find((g) => g.id === id)).filter(Boolean);
  if (resolvedGroups.length === 0) return result;
  // Precompile regex matchers once per filter pass (not per item)
  const groupMatchers = resolvedGroups.map((group) => {
    const patterns = Array.isArray(group.patterns) ? group.patterns : [];
    return patterns.map((p) => {
      try {
        // nosemgrep: javascript.dos.rule-non-literal-regexp
        const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp("\\b" + escaped + "\\b", "i");
      } catch (e) {
        return String(p).toLowerCase();
      }
    });
  });
  return result.filter((item) => {
    const itemName = (item.name || "").toLowerCase();
    const matchAny = groupMatchers.some((matchers) =>
      matchers.some((m) => (m instanceof RegExp ? m.test(itemName) : itemName.includes(m)))
    );
    return exclude ? !matchAny : matchAny;
  });
};

/**
 * Parses one search term into its matcher descriptor, hoisting all RegExp
 * compilation out of the per-item filter loop. Multi-word terms also precompile
 * strict word-boundary regexes and an abbreviation-expanded phrase.
 * @param {string} q - A single (comma-split) search term, lowercased and trimmed
 * @returns {{q: string, words: string[], exactPhrase: string, expandedPhrase: string,
 *   compiledWordRegexes: RegExp[], compiledFieldRegexes: RegExp[]}} Parsed term descriptor
 */
const _filterBuildParsedTerm = (q) => {
  const words = q.split(/\s+/).filter((w) => w.length > 0);
  const exactPhrase = q;
  let expandedPhrase = exactPhrase;
  let compiledWordRegexes = [];
  let compiledFieldRegexes = [];

  if (words.length >= 2) {
    const abbrevs = typeof METAL_ABBREVIATIONS !== "undefined" ? METAL_ABBREVIATIONS : {};
    const expandedWords = words.map((w) => abbrevs[w.toLowerCase()] || w);
    expandedPhrase = expandedWords.join(" ").toLowerCase();

    // Compile regexes for strict word boundary checking
    compiledWordRegexes = words.map((word) => {
      // nosemgrep: javascript.dos.rule-non-literal-regexp
      return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    });
  }

  // Always compile field matching regexes with abbreviation expansion
  const abbrevs = typeof METAL_ABBREVIATIONS !== "undefined" ? METAL_ABBREVIATIONS : {};
  compiledFieldRegexes = words.map((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [escaped];
    const expansion = abbrevs[word.toLowerCase()];
    if (expansion) {
      patterns.push(expansion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    }
    const combined = patterns.join("|");
    // nosemgrep: javascript.dos.rule-non-literal-regexp
    return new RegExp(`\\b(?:${combined})`, "i");
  });

  return {
    q,
    words,
    exactPhrase,
    expandedPhrase,
    compiledWordRegexes,
    compiledFieldRegexes,
  };
};

// Export functions for global access
window.clearAllFilters = clearAllFilters;
window.applyQuickFilter = applyQuickFilter;
window.applyColumnFilter = applyColumnFilter;
window.filterInventoryAdvanced = filterInventoryAdvanced;
window.renderActiveFilters = renderActiveFilters;

// =============================================================================

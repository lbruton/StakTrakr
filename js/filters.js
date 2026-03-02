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
  if (item && typeof item === 'object') {
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
  searchQuery = '';

  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  if (typeof window.updateSaveSearchButton === 'function') {
    window.updateSaveSearchButton('', false);
  }

  const typeFilter = document.getElementById('typeFilter');
  if (typeFilter) typeFilter.value = '';

  const metalFilter = document.getElementById('metalFilter');
  if (metalFilter) metalFilter.value = '';

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
  if (field === 'search') {
    // Clear search query
    searchQuery = '';
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
    if (typeof window.updateSaveSearchButton === 'function') {
      window.updateSaveSearchButton('', false);
    }
  } else if (activeFilters[field]) {
    if (activeFilters[field].values && Array.isArray(activeFilters[field].values)) {
      // Remove specific value from array
      activeFilters[field].values = activeFilters[field].values.filter(v => v !== value);
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
  if (!value || typeof value !== 'string') {
    return value;
  }

  // Handle comma-separated values
  if (value.includes(', ')) {
    return value.split(', ')
      .map(v => simplifyChipValue(v.trim(), field))
      .join(', ');
  }

  return value;
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
  const chipMinCountEl = document.getElementById('chipMinCount');
  let minCount = 3;
  if (chipMinCountEl && chipMinCountEl.value) {
    minCount = parseInt(chipMinCountEl.value, 10);
  } else {
    minCount = parseInt(localStorage.getItem('chipMinCount') || '3', 10);
  }

  // When the user has active filters or a search query, drop minCount to 1
  // for descriptive categories (metal, type, year, grade, location, groups)
  // so the filtered subset's attributes are always visible.
  // Name chips keep the user's threshold (min 2) to avoid flooding the chip
  // bar with every unique item name in the filtered set.
  const hasActiveFilters = Object.keys(activeFilters).length > 0;
  const hasSearchQuery = typeof searchQuery === 'string' && searchQuery.trim().length > 0;
  const nameMinCount = Math.max(2, minCount);
  if (hasActiveFilters || hasSearchQuery) {
    minCount = 1;
  }

  const metals = {};
  const types = {};
  const purchaseLocations = {};
  const storageLocations = {};
  const names = {};
  const years = {};
  const grades = {};
  const numistaIds = {};
  const purities = {};
  const tags = {};

  inventory.forEach(item => {
    // Count metals
    const metal = getCompositionFirstWords(item.composition || item.metal || '');
    if (metal) {
      metals[metal] = (metals[metal] || 0) + 1;
    }

    // Count types
    if (item.type) {
      types[item.type] = (types[item.type] || 0) + 1;
    }

    // Count purchase locations (skip empty / "Unknown")
    const pLoc = (item.purchaseLocation || '').trim();
    if (pLoc && pLoc.toLowerCase() !== 'unknown') {
      purchaseLocations[item.purchaseLocation] = (purchaseLocations[item.purchaseLocation] || 0) + 1;
    }

    // Count storage locations (skip empty / "Unknown")
    const sLoc = (item.storageLocation || '').trim();
    if (sLoc && sLoc.toLowerCase() !== 'unknown') {
      storageLocations[item.storageLocation] = (storageLocations[item.storageLocation] || 0) + 1;
    }

    // Count normalized names (grouped name chips)
    if (window.featureFlags && window.featureFlags.isEnabled('GROUPED_NAME_CHIPS')) {
      const itemName = (item.name || '').trim();
      if (itemName) {
        let baseName = itemName;
        if (window.autocomplete && typeof window.autocomplete.normalizeItemName === 'function') {
          baseName = window.autocomplete.normalizeItemName(itemName);
        }
        names[baseName] = (names[baseName] || 0) + 1;
      }
    }

    // Count years (skip empty)
    const yr = (item.year || '').trim();
    if (yr) {
      years[yr] = (years[yr] || 0) + 1;
    }

    // Count grades (skip empty)
    const gr = (item.grade || '').trim();
    if (gr) {
      grades[gr] = (grades[gr] || 0) + 1;
    }

    // Count Numista IDs (skip empty)
    const nId = (item.numistaId || '').trim();
    if (nId) {
      numistaIds[nId] = (numistaIds[nId] || 0) + 1;
    }

    // Count purities (skip default 1.0 — only show non-pure fineness)
    const pur = parseFloat(item.purity);
    if (!isNaN(pur) && pur > 0 && pur < 1.0) {
      const purKey = String(pur);
      purities[purKey] = (purities[purKey] || 0) + 1;
    }

    // Count tags (STAK-126)
    if (typeof getItemTags === 'function' && item.uuid) {
      const itemTags = getItemTags(item.uuid);
      itemTags.forEach(tag => {
        tags[tag] = (tags[tag] || 0) + 1;
      });
    }
  });

  // Count custom groups
  let customGroups = {};
  if (typeof window.countCustomGroups === 'function') {
    customGroups = window.countCustomGroups(inventory);
  }

  // Extract dynamic chips (text from parentheses/quotes)
  let dynamicNames = {};
  if (window.featureFlags && window.featureFlags.isEnabled('DYNAMIC_NAME_CHIPS') && typeof window.extractDynamicChips === 'function') {
    dynamicNames = window.extractDynamicChips(inventory);
  }

  // Apply minCount threshold to all categories
  const filteredMetals = applyMinCountThreshold(metals, minCount);
  const filteredTypes = applyMinCountThreshold(types, minCount);
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
  if (typeof window.isBlacklisted === 'function') {
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
  const customLabelsLower = new Set(Object.values(customGroups).map(g => g.label.toLowerCase()));
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
    totalItems: inventory.length
  };
};

/**
 * Renders active filter chips beneath the search bar.
 * Updates the filter chip container based on current filters and inventory.
 */
const renderActiveFilters = () => {
  const container = document.getElementById('activeFilters');
  if (!container) return;

  container.innerHTML = '';

  // Get the current filtered inventory first
  const filteredInventory = filterInventoryAdvanced();
  
  if (filteredInventory.length === 0) {
    // Show a hint when search narrows to 0 results instead of hiding chips entirely (UX-004)
    if (searchQuery && searchQuery.trim()) {
      container.style.display = '';
      const hint = document.createElement('span');
      hint.className = 'filter-chip search-hint-chip';
      hint.style.opacity = '0.55';
      hint.style.cursor = 'default';
      hint.textContent = 'Clear search to use filter chips';
      container.appendChild(hint);
      return;
    }
    container.style.display = 'none';
    return;
  }

  // Build chips based on what's actually in the filtered inventory
  const chips = [];
  
  // Add search term chip if there's a search query
  if (searchQuery && searchQuery.trim()) {
    chips.push({ field: 'search', value: searchQuery });
  }

  // Add disposed-only mode chip (STAK-388)
  var activeDisposedBtnChip = document.querySelector('#disposedFilterGroup .chip-sort-btn.active');
  var disposedModeChip = (activeDisposedBtnChip && activeDisposedBtnChip.dataset && activeDisposedBtnChip.dataset.disposedMode) || 'hide';
  if (disposedModeChip === 'show-only') {
    chips.push({ field: 'disposed-mode', value: 'show-only' });
  }

  // Generate category summary chips from filtered inventory
  const categorySummary = generateCategorySummary(filteredInventory);
  
  // Category descriptor map — maps category ID to summary key, chip field, and extra props
  const categoryDescriptors = {
    metal:            { summaryKey: 'metals',            field: 'metal' },
    type:             { summaryKey: 'types',             field: 'type' },
    name:             { summaryKey: 'names',             field: 'name',             extraProps: { isGrouped: true } },
    customGroup:      { summaryKey: 'customGroups',      field: 'customGroup' },
    dynamicName:      { summaryKey: 'dynamicNames',      field: 'dynamicName',      extraProps: { isDynamic: true } },
    purchaseLocation: { summaryKey: 'purchaseLocations', field: 'purchaseLocation' },
    storageLocation:  { summaryKey: 'storageLocations',  field: 'storageLocation' },
    year:             { summaryKey: 'years',             field: 'year' },
    grade:            { summaryKey: 'grades',            field: 'grade' },
    numistaId:        { summaryKey: 'numistaIds',        field: 'numistaId' },
    purity:           { summaryKey: 'purities',          field: 'purity' },
    tags:             { summaryKey: 'tags',              field: 'tags' },
  };

  // Read category config (order + enabled state) and sort preference
  const categoryConfig = typeof getFilterChipCategoryConfig === 'function'
    ? getFilterChipCategoryConfig()
    : [
        { id: 'metal', enabled: true }, { id: 'type', enabled: true },
        { id: 'name', enabled: true }, { id: 'customGroup', enabled: true },
        { id: 'dynamicName', enabled: true }, { id: 'purchaseLocation', enabled: true },
        { id: 'storageLocation', enabled: true }, { id: 'year', enabled: true },
        { id: 'grade', enabled: true }, { id: 'numistaId', enabled: true },
        { id: 'purity', enabled: true },
        { id: 'tags', enabled: true },
      ];

  // Read sort preference from toggle active button or localStorage (default: alpha)
  const sortEl = document.getElementById('chipSortOrder');
  const activeBtn = sortEl && sortEl.querySelector('.chip-sort-btn.active');
  const rawPref = (activeBtn && activeBtn.dataset.sort) || localStorage.getItem('chipSortOrder') || 'alpha';
  const chipSortPref = (rawPref === 'count') ? 'count' : 'alpha';

  // Helper: collect chips for a single category from the summary data
  const collectCategoryChips = (cat) => {
    const desc = categoryDescriptors[cat.id];    if (!desc) return [];
    const data = categorySummary[desc.summaryKey];    if (!data) return [];
    const result = [];
    if (cat.id === 'customGroup') {
      Object.entries(data).forEach(([groupId, info]) => {
        if (info.count > 0) {
          result.push({ field: desc.field, value: groupId, displayLabel: info.label, count: info.count, total: categorySummary.totalItems, isCustomGroup: true });
        }
      });
    } else {
      Object.entries(data).forEach(([value, count]) => {
        if (count > 0) {
          result.push({ field: desc.field, value, count, total: categorySummary.totalItems, ...(desc.extraProps || {}) });
        }
      });
    }
    return result;
  };

  // Helper: sort a chip array in place based on preference
  const sortChips = (arr) => {
    if (chipSortPref === 'alpha') {
      arr.sort((a, b) => {
        const aLabel = (a.displayLabel || a.value || '').toString();
        const bLabel = (b.displayLabel || b.value || '').toString();
        return aLabel.localeCompare(bLabel, undefined, { numeric: true, sensitivity: 'base' });
      });
    } else if (chipSortPref === 'count') {
      arr.sort((a, b) => (b.count || 0) - (a.count || 0));
    }
  };

  // Build chips — categories with the same group letter pool and sort together
  const categoryFields = new Set();
  const emittedGroups = new Set();

  for (const cat of categoryConfig) {
    if (!cat.enabled) continue;
    const desc = categoryDescriptors[cat.id];    if (!desc) continue;
    categoryFields.add(desc.field);

    if (cat.group) {
      // Grouped: first encounter collects ALL categories in this group
      if (emittedGroups.has(cat.group)) continue;
      emittedGroups.add(cat.group);

      const pooled = [];
      for (const gc of categoryConfig) {
        if (!gc.enabled || gc.group !== cat.group) continue;
        const gcDesc = categoryDescriptors[gc.id];        if (gcDesc) categoryFields.add(gcDesc.field);
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

  // Add any explicitly applied filter chips (but not if they duplicate category chips)
  Object.entries(activeFilters).forEach(([field, criteria]) => {
    // Skip fields already rendered as category summary chips to avoid duplicates
    // BUT: if no summary chip was rendered for this field (all below minCount),
    // fall through so the user can still see and remove their active filter
    if (categoryFields.has(field)) {
      let hasSummaryChip = chips.some(c => c.field === field && c.count !== undefined);
      // For 'name' filters, customGroup/dynamicName chips provide visual coverage
      // so suppress the individual name fallback when those chips are present
      if (field === 'name' && !hasSummaryChip) {
        hasSummaryChip = chips.some(c => (c.field === 'customGroup' || c.field === 'dynamicName') && c.count !== undefined);
      }
      // Keep excluded filters visible even when category summary chips exist.
      const isExcludeFilter = !!(criteria && typeof criteria === 'object' && criteria.exclude);
      if (hasSummaryChip && !isExcludeFilter) return;
    }
    
    if (criteria && typeof criteria === 'object' && Array.isArray(criteria.values)) {
      criteria.values.forEach(value => {
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
  
  if (chips.length === 0) {
    container.style.display = 'none';
    return;
  }
  
  container.style.display = '';

  chips.forEach((f, i) => {
    const chip = document.createElement('span');
    chip.className = 'filter-chip';
    if (f.exclude) chip.classList.add('filter-chip-excluded');
    // All chip categories render visually identical — no italic/bold distinction
    const firstValue = String(f.value).split(', ')[0];
    const colorKey = f.field === 'customGroup' ? (f.displayLabel || firstValue) : firstValue;
    const { bg, text: textColor } = getChipColors(f.field, colorKey, i);
    chip.style.backgroundColor = bg;
    chip.style.color = textColor || getContrastColor(bg);

    // Determine if this chip represents a currently active filter
    let isActiveFilter = false;
    if (f.count !== undefined && f.total !== undefined) {
      // Summary chip — active only if its value is in activeFilters
      const criteria = activeFilters[f.field];
      if (criteria && Array.isArray(criteria.values) && !criteria.exclude) {
        if (f.field === 'customGroup') {
          // customGroup expands to name values — active if any non-excluded name filter exists
          const nc = activeFilters['name'];
          isActiveFilter = !!(nc && !nc.exclude && nc.values && nc.values.length > 0);
        } else if (f.field === 'dynamicName') {
          // dynamicName expands to name values — same check
          const nc = activeFilters['name'];
          isActiveFilter = !!(nc && !nc.exclude && nc.values && nc.values.length > 0);
        } else {
          isActiveFilter = criteria.values.includes(f.value);
        }
      }
    } else {
      // Fallback active-filter chips (below minCount or excluded) are always "active"
      isActiveFilter = true;
    }

    if (isActiveFilter) chip.classList.add('filter-chip-active');
    if (f.field === 'search') chip.classList.add('filter-chip-search');

    // Display simplified value for most chips, but keep full base name for name chips
    // Custom groups use their display label; dynamic chips are italic (via CSS class)
    const displayValue = f.isCustomGroup ? f.displayLabel
      : f.isDynamic ? f.value
      : f.field === 'name' ? f.value
      : f.field === 'numistaId' ? `N#${f.value}`
      : simplifyChipValue(f.value, f.field);
    let label;

    if (f.field === 'disposed-mode') {
      label = 'Showing: Disposed Items';
    } else if (f.field === 'search') {
      label = displayValue;
    } else if (f.count !== undefined && f.total !== undefined) {
      // For category summary chips, show count badge if enabled
      const showQty = window.featureFlags && window.featureFlags.isEnabled('CHIP_QTY_BADGE');
      label = showQty ? `${displayValue} (${f.count})` : displayValue;
    } else {
      label = `${displayValue}${f.exclude ? ' (exclude)' : ''}`;
    }
    
    // Use safe textContent and a separate close marker span to avoid HTML injection
    chip.textContent = label + ' ';
    const close = document.createElement('span');
    close.className = 'chip-close';
    close.textContent = '×';
    close.setAttribute('aria-hidden', 'true');
    chip.appendChild(close);

    // Debug logging (opt-in)
    if (window.DEBUG_FILTERS) {
      console.debug('renderActiveFilters: adding chip', { field: f.field, value: f.value, label });
    }
    
    // Right-click context menu for name and dynamic chips (blacklist)
    if (f.field === 'name' || f.field === 'dynamicName') {
      chip.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const chipName = f.field === 'dynamicName' ? f.value : f.value;
        if (typeof window.showChipContextMenu === 'function') {
          window.showChipContextMenu(e.clientX, e.clientY, chipName);
        }
      });
    }

    // Different tooltip and click behavior for different chip types
    if (f.count !== undefined && f.total !== undefined) {
      // Category summary chips - clicking adds filter; shift+click blacklists supported chip names.
      const canBlacklist = f.field === 'name' || f.field === 'dynamicName' || f.field === 'customGroup' || f.field === 'tags';
      const chipNameForBlacklist = f.field === 'customGroup' ? (f.displayLabel || f.value) : f.value;
      chip.title = `Click to filter by ${f.field}: ${displayValue} (${f.count} items)` +
        (canBlacklist ? ' · Shift+click to ignore' : '');
      chip.addEventListener('click', (e) => {
        if (canBlacklist && e.shiftKey && typeof window.showBlacklistConfirm === 'function') {
          e.preventDefault();
          window.showBlacklistConfirm(e.clientX, e.clientY, chipNameForBlacklist);
          return;
        }
        applyQuickFilter(f.field, f.value, f.isGrouped || f.isCustomGroup || f.isDynamic || false);
      });
    } else if (f.field === 'disposed-mode') {
      // Disposed-mode chip — clicking resets disposed filter back to 'hide'
      chip.title = 'Showing disposed items only (click to hide disposed)';
      chip.addEventListener('click', function() {
        var dfg = document.getElementById('disposedFilterGroup');
        if (dfg) {
          dfg.querySelectorAll('.chip-sort-btn').forEach(function(b) {
            b.classList.toggle('active', b.dataset.disposedMode === 'hide');
          });
          if (typeof saveData === 'function') saveData('disposedFilterMode', 'hide');
        }
        if (typeof filterInventory === 'function') filterInventory();
        renderActiveFilters();
      });
    } else {
      // Active filter chips - clicking removes filter
      chip.title = f.field === 'search'
        ? `Search term: ${displayValue} (click to remove)`
        : `Active ${f.exclude ? 'excluded' : 'included'} filter: ${f.field} = ${displayValue} (click to remove)`;
      chip.addEventListener('click', () => {
        removeFilter(f.field, f.value);
        renderActiveFilters();
      });
    }
    // Make the close glyph interactive and keyboard accessible (removes the filter)
    close.setAttribute('role', 'button');
    close.setAttribute('tabindex', '0');
    close.setAttribute('aria-label', `Remove filter ${displayValue}`);
    // Helper to reset disposed filter to 'hide' (for chip × button)
    var _resetDisposedFilter = function() {
      var dfg = document.getElementById('disposedFilterGroup');
      if (dfg) {
        dfg.querySelectorAll('.chip-sort-btn').forEach(function(b) {
          b.classList.toggle('active', b.dataset.disposedMode === 'hide');
        });
        if (typeof saveData === 'function') saveData('disposedFilterMode', 'hide');
      }
      if (typeof filterInventory === 'function') filterInventory();
      renderActiveFilters();
    };
    close.onclick = (e) => {
      e.stopPropagation();
      if (f.field === 'disposed-mode') {
        _resetDisposedFilter();
      } else if (isActiveFilter) {
        // Active filter chip × — always removes the filter (de-activate, not exclude)
        removeFilter(f.field, f.value);
        renderActiveFilters();
      } else if (f.count !== undefined && f.total !== undefined && f.field !== 'search') {
        // Idle summary chip × — exclude this value while keeping other filters intact
        applyQuickFilter(f.field, f.value, f.isGrouped || f.isCustomGroup || f.isDynamic || false, true);
      } else {
        removeFilter(f.field, f.value);
        renderActiveFilters();
      }
    };
    close.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        if (f.field === 'disposed-mode') {
          _resetDisposedFilter();
        } else if (isActiveFilter) {
          removeFilter(f.field, f.value);
          renderActiveFilters();
        } else if (f.count !== undefined && f.total !== undefined && f.field !== 'search') {
          applyQuickFilter(f.field, f.value, f.isGrouped || f.isCustomGroup || f.isDynamic || false, true);
        } else {
          removeFilter(f.field, f.value);
          renderActiveFilters();
        }
      }
    };

    container.appendChild(chip);
  });

  // Add clear button if there are any chips (check for both active and summary chips)
  if (chips.length > 0) {
    const clearButton = document.createElement('button');
    clearButton.className = 'filter-clear-btn';
    clearButton.innerHTML = 'Clear All';
    clearButton.title = 'Clear all active filters';
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
  const metalWords = ['gold', 'silver', 'platinum', 'palladium'];

  const checkNationalPrefix = (prefix) => {
    const hasMetalBetween = metalWords.some(metal =>
      itemText.includes(`${prefix} ${metal} ${coinType}`) && !exactPhrase.includes(metal)
    );
    return !hasMetalBetween;
  };

  // Eagle series
  if (coinType === 'eagle') {
    if (searchMetal === 'american') return checkNationalPrefix('american');
    if (metalWords.includes(searchMetal)) return itemText.includes(exactPhrase);
  }
  // Maple series
  if (coinType === 'maple') {
    if (metalWords.includes(searchMetal)) {
      return itemText.includes(exactPhrase) || itemText.includes(`${searchMetal} maple leaf`);
    }
    if (searchMetal === 'canadian') return checkNationalPrefix('canadian');
  }
  // Britannia series
  if (coinType === 'britannia') {
    if (metalWords.includes(searchMetal)) return itemText.includes(exactPhrase);
    if (searchMetal === 'british') {
      const hasMetalBetween = metalWords.some(metal =>
        itemText.includes(`british ${metal} britannia`) && !exactPhrase.includes(metal)
      );
      return !hasMetalBetween;
    }
  }
  // Krugerrand series
  if (coinType === 'krugerrand') {
    if (metalWords.includes(searchMetal)) return itemText.includes(exactPhrase);
    if (searchMetal === 'south' || searchMetal === 'african') {
      const hasMetalBetween = metalWords.some(metal =>
        (itemText.includes(`south african ${metal} krugerrand`) ||
         itemText.includes(`${metal} krugerrand`)) && !exactPhrase.includes(metal)
      );
      return !hasMetalBetween;
    }
  }
  // Buffalo series
  if (coinType === 'buffalo') {
    if (metalWords.includes(searchMetal)) return itemText.includes(exactPhrase);
    if (searchMetal === 'american') return checkNationalPrefix('american');
  }
  // Panda series
  if (coinType === 'panda') {
    if (metalWords.includes(searchMetal)) return itemText.includes(exactPhrase);
    if (searchMetal === 'chinese') return checkNationalPrefix('chinese');
  }
  // Kangaroo series
  if (coinType === 'kangaroo') {
    if (metalWords.includes(searchMetal)) return itemText.includes(exactPhrase);
    if (searchMetal === 'australian') {
      const hasMetalBetween = metalWords.some(metal =>
        itemText.includes(`australian ${metal} kangaroo`) && !exactPhrase.includes(metal)
      );
      return !hasMetalBetween;
    }
  }

  return null; // No series match — fall through to default logic
};

/**
 * Applies a minimum count threshold to a category data object, filtering out entries below the threshold.
 * @param {Object} data - Map of { key: count }
 * @param {number} minCount - Minimum count to include
 * @returns {Object} Filtered map
 */
const applyMinCountThreshold = (data, minCount) => {
  return Object.fromEntries(
    Object.entries(data).filter(([, count]) => count >= minCount)
  );
};

/**
 * Returns chip color and text color for a given field/value combination.
 * @param {string} field - Chip field type
 * @param {string} value - Chip value
 * @param {number} index - Chip index for fallback color cycling
 * @returns {{ bg: string, text: string|undefined }} Background and optional text color
 */
const getChipColors = (field, value, index) => {
  const fallbackColors = ['var(--primary)', 'var(--secondary)', 'var(--success)', 'var(--warning)', 'var(--danger)', 'var(--info)'];
  let color;
  let textColor;

  switch (field) {
    case 'type':
      color = getTypeColor(value);
      break;
    case 'metal':
      if (!METAL_COLORS[value]) {
        color = getColor(nameColors, value);
      } else {
        color = METAL_COLORS[value];
        textColor = METAL_TEXT_COLORS[value] ? METAL_TEXT_COLORS[value]() : undefined;
      }
      break;
    case 'name':
    case 'dynamicName':
      color = getColor(nameColors, value);
      break;
    case 'customGroup':
      color = getColor(nameColors, value);
      break;
    case 'tags':
      color = getColor(nameColors, value);
      break;
    case 'purchaseLocation':
      color = getPurchaseLocationColor(value);
      break;
    case 'storageLocation':
      color = getStorageLocationColor(value);
      break;
    default:
      color = fallbackColors[index % fallbackColors.length];
  }

  return { bg: color || fallbackColors[index % fallbackColors.length], text: textColor };
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
  var activeDisposedBtn = document.querySelector('#disposedFilterGroup .chip-sort-btn.active');
  var disposedMode = (activeDisposedBtn && activeDisposedBtn.dataset && activeDisposedBtn.dataset.disposedMode) || 'hide';
  if (disposedMode === 'hide') {
    result = result.filter(function(item) { return !item.disposition; });
  } else if (disposedMode === 'show-only') {
    result = result.filter(function(item) { return isDisposed(item); });
  }
  // 'show-all' → no filter applied

  // Apply advanced filters
  Object.entries(activeFilters).forEach(([field, criteria]) => {
    if (criteria && typeof criteria === 'object' && Array.isArray(criteria.values)) {
      const { values, exclude } = criteria;
      switch (field) {
        case 'name': {
          const simplifiedValues = values.map(v => simplifyChipValue(v, field));
          result = result.filter(item => {
            const itemName = simplifyChipValue(item.name || '', field);
            const match = simplifiedValues.includes(itemName);
            return exclude ? !match : match;
          });
          break;
        }
        case 'metal': {
          const lowerVals = values.map(v => v.toLowerCase());
          result = result.filter(item => {
            const itemMetal = getCompositionFirstWords(item.composition || item.metal || '').toLowerCase();
            const match = lowerVals.includes(itemMetal);
            return exclude ? !match : match;
          });
          break;
        }
        case 'type':
          result = result.filter(item => {
            const match = values.includes(item.type);
            return exclude ? !match : match;
          });
          break;
        case 'purchaseLocation':
          result = result.filter(item => {
            const loc = item.purchaseLocation;
            const normalized = (!loc || loc === 'Unknown' || loc === 'Numista Import') ? '—' : loc;
            const match = values.includes(normalized);
            return exclude ? !match : match;
          });
          break;
        case 'storageLocation':
          result = result.filter(item => {
            const loc = item.storageLocation;
            const normalized = (!loc || loc === 'Unknown' || loc === 'Numista Import') ? '—' : loc;
            const match = values.includes(normalized);
            return exclude ? !match : match;
          });
          break;
        case 'tags': {
          // STAK-126: Filter by item tags
          if (typeof getItemTags === 'function') {
            const lowerVals = values.map(v => v.toLowerCase());
            result = result.filter(item => {
              const tags = getItemTags(item.uuid);
              const match = tags.some(t => lowerVals.includes(t.toLowerCase()));
              return exclude ? !match : match;
            });
          }
          break;
        }
        default: {
          const lowerVals = values.map(v => String(v).toLowerCase());
          result = result.filter(item => {
            const fieldVal = String(item[field] ?? '').toLowerCase();
            const match = lowerVals.includes(fieldVal);
            return exclude ? !match : match;
          });
          break;
        }
      }
    } else {
      const value = criteria;
      switch (field) {
        case 'dateFrom':
          result = result.filter(item => item.date >= value);
          break;
        case 'dateTo':
          result = result.filter(item => item.date <= value);
          break;
      }
    }
  });

  // Apply text search
  if (!searchQuery.trim()) return result;

  let query = searchQuery.toLowerCase().trim();

  const terms = query.split(',').map(t => t.trim()).filter(t => t);

  return result.filter(item => {
    if (!terms.length) return true;

    // Retrieve or compute cached search data
    let cached = searchCache.get(item);

    // Upgrade legacy cache (string) to object or handle cache miss
    if (!cached || typeof cached === 'string') {
      const _searchTags = typeof getItemTags === 'function' ? getItemTags(item.uuid).join(' ') : '';
      const _formattedDate = formatDisplayDate(item.date).toLowerCase();

      const itemText = [
        item.metal,
        item.composition || '',
        item.name,
        item.type,
        item.purchaseLocation,
        item.storageLocation || '',
        item.notes || '',
        String(item.year || ''),
        item.grade || '',
        item.gradingAuthority || '',
        String(item.certNumber || ''),
        String(item.numistaId || ''),
        item.serialNumber || '',
        _searchTags,
        _formattedDate
      ].join(' ').toLowerCase();

      cached = { text: itemText, formattedDate: _formattedDate };
      searchCache.set(item, cached);
    }

    const { text: itemText, formattedDate } = cached;

    // Handle comma-separated terms (OR logic between comma terms)
    return terms.some(q => {
      // Split each comma term into individual words for AND logic
      const words = q.split(/\s+/).filter(w => w.length > 0);

      // Special handling for multi-word searches to prevent partial matches
      // If searching for "American Eagle", it should only match items that have both words
      // but NOT match "American Gold Eagle" (which has an extra word in between)
      if (words.length >= 2) {
        // STACK-62: Expand abbreviations in the query words for multi-word searches
        const abbrevs = typeof METAL_ABBREVIATIONS !== 'undefined' ? METAL_ABBREVIATIONS : {};
        const expandedWords = words.map(w => abbrevs[w.toLowerCase()] || w);
        const expandedPhrase = expandedWords.join(' ').toLowerCase();

        // For multi-word searches, check if the exact phrase exists or
        // if all words exist as separate word boundaries without conflicting words
        const exactPhrase = q.toLowerCase();

        // Check for exact phrase match first
        if (itemText.includes(exactPhrase)) {
          return true;
        }

        // STACK-62: Check expanded abbreviation phrase (e.g. "ase 2024" → "american silver eagle 2024")
        if (expandedPhrase !== exactPhrase && itemText.includes(expandedPhrase)) {
          return true;
        }

        // STACK-23: Check custom chip group label matching for multi-word searches
        if (typeof window.itemMatchesCustomGroupLabel === 'function' &&
            window.itemMatchesCustomGroupLabel(item, q)) {
          return true;
        }

        // For phrase searches like "American Eagle", be more restrictive
        // Check that all words are present as word boundaries
        const allWordsPresent = words.every(word => {
          // nosemgrep: javascript.dos.rule-non-literal-regexp
          const wordRegex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
          return wordRegex.test(itemText);
        });

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
          
          if (['american', 'canadian', 'british', 'chinese', 'australian', 'south'].includes(firstWord) &&
              ['gold', 'silver', 'platinum', 'palladium'].includes(middleWord) &&
              ['eagle', 'maple', 'britannia', 'krugerrand', 'buffalo', 'panda', 'kangaroo'].includes(lastWord)) {
            // For "American Gold Eagle" type searches, require exact phrase or very close match
            return itemText.includes(exactPhrase) || 
                   (lastWord === 'maple' && itemText.includes(`${firstWord} ${middleWord} maple leaf`));
          }
        }
        
        // Handle fractional weight searches to be more specific
        // "1/4 oz" should be distinct from "1/2 oz" and "1 oz"
        if (words.length >= 2) {
          const hasFraction = words.some(word => word.includes('/'));
          const hasOz = words.some(word => word === 'oz' || word === 'ounce');
          
          if (hasFraction && hasOz) {
            // For fractional searches, require exact phrase match
            return itemText.includes(exactPhrase);
          }
        }
        
        // Prevent overly broad country/origin searches
        const broadTerms = ['american', 'canadian', 'australian', 'british', 'chinese', 'south', 'mexican'];
        if (words.length === 1 && broadTerms.includes(words[0])) {
          // Single broad geographic terms should require additional context
          // Return false to prevent matching everything from that country
          return false;
        }
        
        return true;
      }
      
      // For single words, use word boundary matching with abbreviation expansion
      const fieldMatch = words.every(word => {
        // STACK-62: Build regex with original word + abbreviation expansion
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [escaped];
        const abbrevs = typeof METAL_ABBREVIATIONS !== 'undefined' ? METAL_ABBREVIATIONS : {};
        const expansion = abbrevs[word.toLowerCase()];
        if (expansion) {
          patterns.push(expansion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        }
        const combined = patterns.join('|');
        // nosemgrep: javascript.dos.rule-non-literal-regexp
        const wordRegex = new RegExp(`\\b(?:${combined})`, 'i');

        return (
          wordRegex.test(item.metal) ||
          (item.composition && wordRegex.test(item.composition)) ||
          wordRegex.test(item.name) ||
          wordRegex.test(item.type) ||
          wordRegex.test(item.purchaseLocation) ||
          (item.storageLocation && wordRegex.test(item.storageLocation)) ||
          (item.notes && wordRegex.test(item.notes)) ||
          item.date.includes(word) ||
          formattedDate.includes(word) ||
          String(Number.isFinite(Number(item.qty)) ? Number(item.qty) : '').includes(word) ||
          String(Number.isFinite(Number(item.weight)) ? Number(item.weight) : '').includes(word) ||
          String(Number.isFinite(Number(item.price)) ? Number(item.price) : '').includes(word) ||
          (item.year && wordRegex.test(String(item.year))) ||
          (item.grade && wordRegex.test(item.grade)) ||
          (item.gradingAuthority && wordRegex.test(item.gradingAuthority)) ||
          (item.certNumber && wordRegex.test(String(item.certNumber))) ||
          (item.numistaId && wordRegex.test(String(item.numistaId))) ||
          (item.serialNumber && wordRegex.test(item.serialNumber)) ||
          (typeof getItemTags === 'function' && getItemTags(item.uuid).some(t => wordRegex.test(t)))
        );
      });
      if (fieldMatch) return true;

      // STACK-23: Fall back to custom chip group label matching
      if (typeof window.itemMatchesCustomGroupLabel === 'function') {
        return window.itemMatchesCustomGroupLabel(item, q);
      }

      // STACK-62: Fuzzy fallback — score item fields when exact matching fails
      if (typeof window.featureFlags !== 'undefined' &&
          window.featureFlags.isEnabled('FUZZY_AUTOCOMPLETE') &&
          typeof fuzzyMatch === 'function') {
        const fuzzyThreshold = typeof AUTOCOMPLETE_CONFIG !== 'undefined'
          ? AUTOCOMPLETE_CONFIG.threshold : 0.3;
        const fieldsToCheck = [item.name, item.purchaseLocation, item.storageLocation || '', item.notes || ''];
        for (const field of fieldsToCheck) {
          if (field && fuzzyMatch(q, field, { threshold: fuzzyThreshold }) > 0) {
            if (!window._fuzzyMatchUsed) window._fuzzyMatchUsed = true;
            return true;
          }
        }
      }

      return false;
    });
  });
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
  // Fields that support OR-logic multi-select (filter engine already handles these natively)
  const isMultiSelect = field === 'tags' || field === 'metal' || field === 'type';

  // Handle custom group chip click
  if (field === 'customGroup') {
    const groups = typeof window.loadCustomGroups === 'function' ? window.loadCustomGroups() : [];
    const group = groups.find(g => g.id === value);
    if (group) {
      const matchingNames = [];
      inventory.forEach(item => {
        const itemName = (item.name || '').toLowerCase();
        if (group.patterns.some(p => {
          try {
            // nosemgrep: javascript.dos.rule-non-literal-regexp
            return new RegExp('\\b' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(itemName);
          } catch (e) { return itemName.includes(p.toLowerCase()); }
        })) {
          matchingNames.push(item.name);
        }
      });
      const uniqueNames = [...new Set(matchingNames)];

      // Toggle behavior: if same custom group filter is active, remove it
      const currentValues = activeFilters['name']?.values || [];
      const currentExclude = !!activeFilters['name']?.exclude;
      const isCurrentlyActive = uniqueNames.length > 0 &&
        uniqueNames.every(n => currentValues.includes(n)) &&
        currentValues.length === uniqueNames.length &&
        currentExclude === exclude;

      if (isCurrentlyActive) {
        delete activeFilters['name'];
      } else if (uniqueNames.length > 0) {
        activeFilters['name'] = { values: uniqueNames, exclude };
      }
    }
    renderTable();
    renderActiveFilters();
    return;
  }

  // Handle dynamic name chip click
  if (field === 'dynamicName') {
    const matchingNames = [];
    inventory.forEach(item => {
      const name = item.name || '';
      if (name.includes('(' + value + ')') || name.includes('"' + value + '"')) {
        matchingNames.push(name);
      }
    });
    const uniqueNames = [...new Set(matchingNames)];

    // Toggle behavior
    const currentValues = activeFilters['name']?.values || [];
    const currentExclude = !!activeFilters['name']?.exclude;
    const isCurrentlyActive = uniqueNames.length > 0 &&
      uniqueNames.every(n => currentValues.includes(n)) &&
      currentValues.length === uniqueNames.length &&
      currentExclude === exclude;

    if (isCurrentlyActive) {
      delete activeFilters['name'];
    } else if (uniqueNames.length > 0) {
      activeFilters['name'] = { values: uniqueNames, exclude };
    }
    renderTable();
    renderActiveFilters();
    return;
  }

  // If this exact filter is already active, remove it (toggle behavior — single-select fields only)
  if (!isMultiSelect && activeFilters[field]?.values?.[0] === value && activeFilters[field]?.exclude === exclude && !isGrouped) {
    delete activeFilters[field];
  } else if (field === 'name' && isGrouped && window.featureFlags && window.featureFlags.isEnabled('GROUPED_NAME_CHIPS')) {
    // Handle grouped name filtering
    if (window.autocomplete && window.autocomplete.normalizeItemName) {
      // Find all item names that normalize to this base name
      const matchingNames = [];
      inventory.forEach(item => {
        if (item.name) {
          const baseName = window.autocomplete.normalizeItemName(item.name);
          if (baseName === value) {
            matchingNames.push(item.name);
          }
        }
      });
      
      // Remove duplicates
      const uniqueNames = [...new Set(matchingNames)];
      
      if (uniqueNames.length > 0) {
        // Check if this grouped filter is already active
        const currentValues = activeFilters[field]?.values || [];
        const currentExclude = !!activeFilters[field]?.exclude;
        const isCurrentlyActive = uniqueNames.every(name => currentValues.includes(name)) &&
                                 currentValues.length === uniqueNames.length &&
                                 currentExclude === exclude;
        
        if (isCurrentlyActive) {
          // Toggle off - remove the filter
          delete activeFilters[field];
        } else {
          // Apply the grouped filter
          activeFilters[field] = { values: uniqueNames, exclude };
        }
      }
    } else {
      // Fallback to regular filtering if normalization is not available
      activeFilters[field] = { values: [value], exclude };
    }
  } else if (isMultiSelect && activeFilters[field] && activeFilters[field].exclude === exclude) {
    // Accumulate: toggle individual values in/out of the active set
    const existing = activeFilters[field].values;
    const idx = existing.indexOf(value);
    if (idx !== -1) {
      const updated = existing.filter(v => v !== value);
      if (updated.length === 0) {
        delete activeFilters[field];
      } else {
        activeFilters[field] = { values: updated, exclude };
      }
    } else {
      activeFilters[field] = { values: [...existing, value], exclude };
    }
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

// Export functions for global access
window.clearAllFilters = clearAllFilters;
window.applyQuickFilter = applyQuickFilter;
window.applyColumnFilter = applyColumnFilter;
window.filterInventoryAdvanced = filterInventoryAdvanced;
window.renderActiveFilters = renderActiveFilters;

// =============================================================================

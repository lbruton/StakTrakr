// SETTINGS MODAL
// =============================================================================

/**
 * Opens the unified Settings modal, optionally navigating to a section.
 * @param {string} [section='site'] - Section to display: 'site', 'system', 'table', 'grouping', 'api', 'cloud', 'images', 'storage', 'goldback', 'changelog', 'market'
 */
const showSettingsModal = (section = 'site') => {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  syncSettingsUI();
  switchSettingsSection(section);

  if (window.openModalById) {
    openModalById('settingsModal');
  } else {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
};

/**
 * Closes the Settings modal.
 */
const hideSettingsModal = () => {
  if (window.closeModalById) {
    closeModalById('settingsModal');
  } else {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'none';
    try { document.body.style.overflow = ''; } catch (e) { /* ignore */ }
  }
};

/**
 * Switches the visible section panel in the Settings modal.
 * @param {string} name - Section key: 'site', 'system', 'table', 'grouping', 'api', 'cloud', 'images', 'storage', 'goldback', 'changelog', 'market'
 */
const switchSettingsSection = (name) => {
  const targetName = document.getElementById(`settingsPanel_${name}`) ? name : 'system';

  // Hide all panels
  document.querySelectorAll('.settings-section-panel').forEach(panel => {
    panel.style.display = 'none';
  });

  // Show target panel
  const target = document.getElementById(`settingsPanel_${targetName}`);
  if (target) target.style.display = 'block';

  // Update active nav item
  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.section === targetName);
  });

  // Populate API data when switching to API section
  if (targetName === 'api' && typeof populateApiSection === 'function') {
    populateApiSection();
  }

  // Populate Images data and sync toggles when switching to Images section (STACK-96)
  if (targetName === 'images') {
    syncChipToggle('tableImagesToggle', localStorage.getItem('tableImagesEnabled') !== 'false');
    const sidesSync = safeGetElement('tableImageSidesToggle');
    if (sidesSync) {
      const curSides = localStorage.getItem('tableImageSides') || 'both';
      sidesSync.querySelectorAll('.chip-sort-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.val === curSides));
    }
    populateImagesSection();
  }

  // Render the active log sub-tab when switching to the changelog section
  if (targetName === 'changelog') {
    const activeTab = document.querySelector('.settings-log-tab.active');
    const activeKey = activeTab ? activeTab.dataset.logTab : 'changelog';
    switchLogTab(activeKey);
  }

  // Render coin price cards when switching to the market section
  if (targetName === 'market' && typeof renderRetailCards === 'function') {
    renderRetailCards();
  }

  // Populate Storage section when switching to it
  if (targetName === 'storage' && typeof renderStorageSection === 'function') {
    renderStorageSection();
  }

  // Populate Inventory Summary card and show/hide Cloud section when switching to Inventory
  if (targetName === 'system') {
    const countEl = safeGetElement('invSummaryCount');
    const weightEl = safeGetElement('invSummaryWeight');
    const meltEl = safeGetElement('invSummaryMelt');
    const modEl = safeGetElement('invSummaryModified');
    if (countEl || weightEl || meltEl || modEl) {
      try {
        const items = loadDataSync(LS_KEY, []);
        if (countEl) countEl.textContent = items.length + ' items';
        // Total weight — sum all items in troy oz (convert Goldback denominations)
        if (weightEl) {
          const totalOz = items.reduce((sum, it) => {
            const w = parseFloat(it.weight) || 0;
            const qty = Number(it.qty) || 1;
            const oz = (it.weightUnit === 'gb' && typeof GB_TO_OZT !== 'undefined') ? w * GB_TO_OZT : w;
            return sum + oz * qty;
          }, 0);
          weightEl.textContent = typeof formatWeight === 'function' ? formatWeight(totalOz) : `${totalOz.toFixed(2)} oz`;
        }
        // Melt value — use canonical computeMeltValue() helper from utils.js
        if (meltEl) {
          const totalMelt = items.reduce((sum, it) => {
            const metalKey = (it.metal || 'silver').toLowerCase();
            const spot = (typeof spotPrices !== 'undefined' && spotPrices[metalKey]) || 0;
            return spot ? sum + computeMeltValue(it, spot) : sum;
          }, 0);
          meltEl.textContent = totalMelt > 0 ? (typeof formatCurrency === 'function' ? formatCurrency(totalMelt) : `$${totalMelt.toFixed(2)}`) : '—';
        }
        // Last modified — newest updatedAt across all items
        if (modEl) {
          const newest = items.reduce((max, it) => {
            const ts = it.updatedAt || it.dateAdded || 0;
            return ts > max ? ts : max;
          }, 0);
          modEl.textContent = newest
            ? new Date(newest).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            : '—';
        }
      } catch (e) { console.warn('[settings] Inventory Summary card failed to populate:', e); }
    }

    // Sync cloud UI state (connected/disconnected badges, button states)
    if (typeof syncCloudUI === 'function') syncCloudUI();
  }
};

/**
 * Switches the visible provider tab in the API section.
 * @param {string} key - Provider key: 'NUMISTA', 'METALS_DEV', 'METALS_API', 'METAL_PRICE_API', 'CUSTOM'
 */
const switchProviderTab = (key) => {
  // Hide all provider panels
  document.querySelectorAll('.settings-provider-panel').forEach(panel => {
    panel.style.display = 'none';
  });

  // Show target panel
  const target = document.getElementById(`providerPanel_${key}`);
  if (target) target.style.display = 'block';

  // Update active tab
  document.querySelectorAll('.settings-provider-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.provider === key);
  });

  // Render Numista bulk sync UI when switching to Numista tab (STACK-87/88)
  if (key === 'NUMISTA' && typeof renderNumistaSyncUI === 'function') {
    const syncGroup = document.getElementById('numistaBulkSyncGroup');
    if (syncGroup && syncGroup.style.display !== 'none') {
      renderNumistaSyncUI();
    }
  }

  // Render Numista tag settings (auto-apply toggle + blacklist)
  if (key === 'NUMISTA') {
    renderNumistaTagSettings();
  }
};

/**
 * Switches the visible log sub-tab in the Activity Log panel.
 * Re-renders the tab content on every switch to ensure fresh data.
 * @param {string} key - Sub-tab key: 'changelog', 'metals', 'catalogs', 'pricehistory'
 */
const switchLogTab = (key) => {
  // Hide all log panels
  document.querySelectorAll('.settings-log-panel').forEach(panel => {
    panel.style.display = 'none';
  });

  // Show target panel
  const target = document.getElementById(`logPanel_${key}`);
  if (target) target.style.display = 'block';

  // Update active tab
  document.querySelectorAll('.settings-log-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.logTab === key);
  });

  // Always re-render to show fresh data
  renderLogTab(key);
};

/** Dispatch map: log sub-tab key → window function name */
const LOG_TAB_RENDERERS = {
  changelog: 'renderChangeLog',
  metals: 'renderSpotHistoryTable',
  lbma: 'renderLbmaHistoryTable',
  catalogs: 'renderCatalogHistoryForSettings',
  pricehistory: 'renderItemPriceHistoryTable',
  cloud: 'renderCloudActivityTable',
  market: 'renderRetailHistoryTable',
};

/**
 * Dispatches to the appropriate render function for a log sub-tab.
 * @param {string} key - Sub-tab key
 */
const renderLogTab = (key) => {
  const fn = window[LOG_TAB_RENDERERS[key]];
  if (typeof fn === 'function') fn();
};

/**
 * Syncs all Settings UI controls with current application state.
 * Called each time the modal opens to ensure controls reflect live values.
 */
const syncSettingsUI = () => {
  // Theme picker
  const currentTheme = localStorage.getItem(THEME_KEY) || 'light';
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === currentTheme);
  });

  // Items per page
  const ippSelect = safeGetElement('settingsItemsPerPage');
  if (ippSelect) {
    ippSelect.value = itemsPerPage === Infinity ? 'all' : String(itemsPerPage);
  }

  // Cloud backup history depth
  var historySelect = safeGetElement('cloudBackupHistoryDepth');
  if (historySelect) {
    var savedDepth = loadData(CLOUD_BACKUP_HISTORY_KEY) || String(CLOUD_BACKUP_HISTORY_DEFAULT);
    historySelect.value = savedDepth;
  }

  // Chip min count — sync with inline control
  const chipMinSetting = document.getElementById('settingsChipMinCount');
  const chipMinInline = document.getElementById('chipMinCount');
  if (chipMinSetting) {
    chipMinSetting.value = localStorage.getItem('chipMinCount') || '3';
  }

  // Chip max count — sync with inline control
  const chipMaxSetting = document.getElementById('settingsChipMaxCount');
  if (chipMaxSetting) {
    chipMaxSetting.value = localStorage.getItem('chipMaxCount') || '0';
  }

  // Smart name grouping — sync with inline toggle
  const groupSetting = document.getElementById('settingsGroupNameChips');
  if (groupSetting && window.featureFlags) {
    const gVal = featureFlags.isEnabled('GROUPED_NAME_CHIPS') ? 'yes' : 'no';
    groupSetting.querySelectorAll('.chip-sort-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === gVal);
    });
  }

  // Dynamic name chips — sync toggle with feature flag
  const dynamicSetting = document.getElementById('settingsDynamicChips');
  if (dynamicSetting && window.featureFlags) {
    const dVal = featureFlags.isEnabled('DYNAMIC_NAME_CHIPS') ? 'yes' : 'no';
    dynamicSetting.querySelectorAll('.chip-sort-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === dVal);
    });
  }

  // Chip quantity badge — sync toggle with feature flag
  const qtyBadgeSetting = document.getElementById('settingsChipQtyBadge');
  if (qtyBadgeSetting && window.featureFlags) {
    const qVal = featureFlags.isEnabled('CHIP_QTY_BADGE') ? 'yes' : 'no';
    qtyBadgeSetting.querySelectorAll('.chip-sort-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === qVal);
    });
  }

  // Fuzzy autocomplete — sync toggle with feature flag
  const autocompleteSetting = document.getElementById('settingsFuzzyAutocomplete');
  if (autocompleteSetting && window.featureFlags) {
    const aVal = featureFlags.isEnabled('FUZZY_AUTOCOMPLETE') ? 'yes' : 'no';
    autocompleteSetting.querySelectorAll('.chip-sort-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === aVal);
    });
  }

  // Numista name matching — sync toggle with feature flag
  const numistaLookupSetting = document.getElementById('settingsNumistaLookup');
  if (numistaLookupSetting && window.featureFlags) {
    const nlVal = featureFlags.isEnabled('NUMISTA_SEARCH_LOOKUP') ? 'yes' : 'no';
    numistaLookupSetting.querySelectorAll('.chip-sort-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === nlVal);
    });
  }

  // Numista lookup rule tables
  renderSeedRuleTable();
  renderCustomRuleTable();

  // Chip grouping tables and dropdown
  if (typeof window.populateBlacklistDropdown === 'function') window.populateBlacklistDropdown();
  if (typeof window.renderBlacklistTable === 'function') window.renderBlacklistTable();
  if (typeof window.renderCustomGroupTable === 'function') window.renderCustomGroupTable();

  // Inline chip config table
  renderInlineChipConfigTable();

  // Filter chip category config table
  renderFilterChipCategoryTable();

  // Chip sort order — sync settings toggle with stored value
  const chipSortSetting = document.getElementById('settingsChipSortOrder');
  if (chipSortSetting) {
    const saved = localStorage.getItem('chipSortOrder');
    const active = (saved === 'count') ? 'count' : 'alpha';
    chipSortSetting.querySelectorAll('.chip-sort-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sort === active);
    });
  }

  // Storage footer
  updateSettingsFooter();

  // API status
  if (typeof renderApiStatusSummary === 'function') {
    renderApiStatusSummary();
  }

  // Numista usage bar
  if (typeof renderNumistaUsageBar === 'function') {
    renderNumistaUsageBar();
  }

  // PCGS usage bar
  if (typeof renderPcgsUsageBar === 'function') {
    renderPcgsUsageBar();
  }

  // Display currency (STACK-50)
  if (typeof syncCurrencySettingsUI === 'function') {
    syncCurrencySettingsUI();
  }

  // Goldback denomination pricing (STACK-45)
  if (typeof syncGoldbackSettingsUI === 'function') {
    syncGoldbackSettingsUI();
  }

  // Numista bulk sync visibility (STACK-87/88)
  const numistaSyncGroup = document.getElementById('numistaBulkSyncGroup');
  if (numistaSyncGroup) {
    const showBulkSync = window.featureFlags?.isEnabled('COIN_IMAGES');
    numistaSyncGroup.style.display = showBulkSync ? '' : 'none';
  }

  // Card style (STAK-118)
  const cardStyleSelect = document.getElementById('settingsCardStyle');
  if (cardStyleSelect) {
    cardStyleSelect.value = localStorage.getItem(CARD_STYLE_KEY) || 'D';
  }

  // Desktop card view toggle (STAK-118)
  const desktopCardToggle = document.getElementById('settingsDesktopCardView');
  if (desktopCardToggle) {
    const dcVal = localStorage.getItem(DESKTOP_CARD_VIEW_KEY) === 'true' ? 'yes' : 'no';
    desktopCardToggle.querySelectorAll('.chip-sort-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === dcVal);
    });
  }

  // Display timezone (STACK-63)
  const tzSelect = document.getElementById('settingsTimezone');
  if (tzSelect) {
    tzSelect.value = localStorage.getItem(TIMEZONE_KEY) || 'auto';
  }

  // Spot compare mode (STACK-92)
  const spotCompareSelect = document.getElementById('settingsSpotCompareMode');
  if (spotCompareSelect) {
    spotCompareSelect.value = localStorage.getItem(SPOT_COMPARE_MODE_KEY) || 'close-close';
  }

  // Header shortcuts (STACK-54)
  syncHeaderToggleUI();
  // Layout visibility (STACK-54)
  syncLayoutVisibilityUI();

  // Set first provider tab active if none visible — default to Numista
  const anyVisible = document.querySelector('.settings-provider-panel[style*="display: block"]');
  if (!anyVisible) {
    switchProviderTab('NUMISTA');
  }

  // Hide Cloud nav item when no provider is connected (STAK-317)
  const cloudNavItem = document.querySelector('.settings-nav-item[data-section="cloud"]');
  if (cloudNavItem && typeof cloudIsConnected === 'function' && typeof CLOUD_PROVIDERS !== 'undefined') {
    const connectedCount = Object.keys(CLOUD_PROVIDERS).filter(p => cloudIsConnected(p)).length;
    cloudNavItem.style.display = connectedCount >= 1 ? '' : 'none';
  }
};

/**
 * Updates the storage + version footer bar at the bottom of the Settings modal.
 */
const updateSettingsFooter = async () => {
  const footerEl = document.getElementById('settingsFooter');
  if (!footerEl) return;

  let storageText = '';
  try {
    let totalBytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key);
      totalBytes += (key.length + (val ? val.length : 0)) * 2; // UTF-16
    }
    const lsMb = (totalBytes / (1024 * 1024)).toFixed(2);
    storageText = `LS: ${lsMb} MB / 5 MB`;

    // Append IndexedDB usage if available
    if (window.imageCache?.isAvailable()) {
      try {
        const idbUsage = await imageCache.getStorageUsage();
        const idbMb = (idbUsage.totalBytes / (1024 * 1024)).toFixed(2);
        const idbLimit = (idbUsage.limitBytes / (1024 * 1024)).toFixed(0);
        storageText += `  \u00b7  IDB: ${idbMb} MB / ${idbLimit} MB`;
      } catch { /* ignore */ }
    }
  } catch (e) {
    storageText = 'Storage: unknown';
  }

  footerEl.textContent = `${storageText}  \u00b7  v${APP_VERSION}`;
};

/**
 * Wires a yes/no chip toggle to a feature flag.
 * Handles click delegation, flag enable/disable, active-class sync,
 * optional mirror element sync, and optional callback.
 *
 * @param {string} elementId - DOM id of the toggle container
 * @param {string} flagName - Feature flag key (e.g. 'GROUPED_NAME_CHIPS')
 * @param {Object} [opts]
 * @param {string} [opts.syncId] - DOM id of a mirror toggle to keep in sync
 * @param {Function} [opts.onApply] - Called after toggle with (isEnabled) arg
 */
const wireFeatureFlagToggle = (elementId, flagName, opts = {}) => {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-sort-btn');
    if (!btn) return;
    const isEnabled = btn.dataset.val === 'yes';
    if (window.featureFlags) {
      if (isEnabled) featureFlags.enable(flagName);
      else featureFlags.disable(flagName);
    }
    el.querySelectorAll('.chip-sort-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.val === btn.dataset.val);
    });
    if (opts.syncId) {
      const syncEl = document.getElementById(opts.syncId);
      if (syncEl) syncEl.querySelectorAll('.chip-sort-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.val === btn.dataset.val);
      });
    }
    if (opts.onApply) opts.onApply(isEnabled);
  });
};
window.wireFeatureFlagToggle = wireFeatureFlagToggle;

/**
 * Syncs a chip-sort-toggle's active state from a boolean value.
 * @param {string} elementId - DOM id of the .chip-sort-toggle container
 * @param {boolean} isOn - Whether the 'yes' button should be active
 */
const syncChipToggle = (elementId, isOn) => {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.querySelectorAll('.chip-sort-btn').forEach(btn => {
    const btnIsYes = btn.dataset.val === 'yes';
    btn.classList.toggle('active', isOn ? btnIsYes : !btnIsYes);
  });
};

/**
 * Wires a yes/no chip toggle to a raw localStorage key (not a feature flag).
 * Handles click delegation, localStorage read/write, active-class sync, and optional callback.
 *
 * @param {string} elementId - DOM id of the toggle container
 * @param {string} storageKey - localStorage key to read/write ('true'/'false')
 * @param {Object} [opts]
 * @param {boolean} [opts.defaultVal=false] - Default value when no localStorage entry exists
 * @param {Function} [opts.onApply] - Called after toggle with (isEnabled) arg
 */
const wireStorageToggle = (elementId, storageKey, opts = {}) => {
  const el = document.getElementById(elementId);
  if (!el) return;
  // Set initial state
  const defaultVal = opts.defaultVal ?? false;
  const stored = localStorage.getItem(storageKey);
  const isOn = stored !== null ? stored === 'true' : defaultVal;
  syncChipToggle(elementId, isOn);

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-sort-btn');
    if (!btn) return;
    const isEnabled = btn.dataset.val === 'yes';
    localStorage.setItem(storageKey, isEnabled ? 'true' : 'false');
    syncChipToggle(elementId, isEnabled);
    if (opts.onApply) opts.onApply(isEnabled);
  });
};
window.wireStorageToggle = wireStorageToggle;
window.syncChipToggle = syncChipToggle;

/**
 * Wires a chip sort order toggle (alpha/count) with bidirectional sync.
 *
 * @param {string} elementId - DOM id of the toggle container
 * @param {string} [syncId] - DOM id of a mirror toggle to keep in sync
 */
const wireChipSortToggle = (elementId, syncId) => {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-sort-btn');
    if (!btn) return;
    const val = btn.dataset.sort;
    localStorage.setItem('chipSortOrder', val);
    el.querySelectorAll('.chip-sort-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.sort === val);
    });
    if (syncId) {
      const syncEl = document.getElementById(syncId);
      if (syncEl) syncEl.querySelectorAll('.chip-sort-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.sort === val);
      });
    }
    if (typeof renderActiveFilters === 'function') renderActiveFilters();
  });
};
window.wireChipSortToggle = wireChipSortToggle;

// STAK-135:
// setupSettingsEventListeners() moved to js/settings-listeners.js to keep
// listener wiring split by settings tab/concern.

/**
 * One-time migration from legacy apiProviderOrder + syncMode to priority numbers (STACK-90).
 * Maps first "always" provider → 1, remaining providers → 2,3 in order, disabled → 0.
 * @returns {Object} Priority map { METALS_DEV: 1, METALS_API: 2, ... }
 */
const migrateProviderPriority = () => {
  const priorities = {};
  const metalsProviders = Object.keys(API_PROVIDERS);
  let order;
  try {
    const stored = localStorage.getItem('apiProviderOrder');
    order = stored ? JSON.parse(stored) : null;
  } catch (e) { /* ignore */ }
  if (!Array.isArray(order) || order.length === 0) {
    order = metalsProviders;
  }

  // Read legacy sync modes
  let syncModes = {};
  try {
    const cfg = loadApiConfig();
    syncModes = cfg.syncMode || {};
  } catch (e) { /* ignore */ }

  let nextPriority = 1;
  // First pass: assign based on legacy order + sync mode
  order.forEach(prov => {
    if (!metalsProviders.includes(prov)) return;
    const mode = syncModes[prov] || 'always';
    if (mode === 'backup' && nextPriority === 1) {
      // All backup = assign sequentially starting at 2
      priorities[prov] = nextPriority++;
    } else {
      priorities[prov] = nextPriority++;
    }
  });

  // Ensure any providers not in legacy order get a priority
  metalsProviders.forEach(prov => {
    if (!(prov in priorities)) {
      priorities[prov] = nextPriority++;
    }
  });

  // Ensure STAKTRAKR is always rank 1 for fresh migrations
  if (priorities.STAKTRAKR && priorities.STAKTRAKR !== 1) {
    const currentRank1 = Object.entries(priorities).find(([, p]) => p === 1);
    if (currentRank1) priorities[currentRank1[0]] = priorities.STAKTRAKR;
    priorities.STAKTRAKR = 1;
  }

  saveProviderPriorities(priorities);
  return priorities;
};

/**
 * Loads provider priority map from localStorage.
 * Falls back to migration if not found.
 * @returns {Object} Priority map { METALS_DEV: 1, METALS_API: 2, ... }
 */
const loadProviderPriorities = () => {
  try {
    const stored = localStorage.getItem('providerPriority');
    if (stored) {
      const priorities = JSON.parse(stored);
      if (typeof priorities === 'object' && priorities !== null) {
        // Inject STAKTRAKR at rank 1 for existing users upgrading
        if (!('STAKTRAKR' in priorities)) {
          Object.keys(priorities).forEach(prov => {
            if (priorities[prov] > 0) priorities[prov]++;
          });
          priorities.STAKTRAKR = 1;
          saveProviderPriorities(priorities);
        }
        return priorities;
      }
    }
  } catch (e) { /* ignore */ }
  return migrateProviderPriority();
};

/**
 * Saves provider priority map and writes backward-compatible apiProviderOrder (STACK-90).
 * @param {Object} priorities - { METALS_DEV: 1, METALS_API: 2, ... }
 */
const saveProviderPriorities = (priorities) => {
  try {
    localStorage.setItem('providerPriority', JSON.stringify(priorities));
    // Backward compatibility: write apiProviderOrder sorted by priority (non-disabled only)
    const sorted = Object.entries(priorities)
      .filter(([, p]) => p > 0)
      .sort((a, b) => a[1] - b[1])
      .map(([prov]) => prov);
    localStorage.setItem('apiProviderOrder', JSON.stringify(sorted));
  } catch (e) { /* ignore */ }
};

/**
 * Sets all priority <select> values from a priority map.
 * @param {Object} priorities - { METALS_DEV: 1, ... }
 */
const syncProviderPriorityUI = (priorities) => {
  Object.entries(priorities).forEach(([prov, val]) => {
    const sel = document.getElementById(`providerPriority_${prov}`);
    if (sel) sel.value = String(val);
  });
};

/**
 * Sets up change listeners on provider priority selects (STACK-90).
 * Auto-shifts: setting provider X to priority N bumps any existing N holder to N+1 (cascade).
 */
const setupProviderPriority = () => {
  const selects = document.querySelectorAll('.provider-priority-select');
  if (!selects.length) return;

  selects.forEach(sel => {
    sel.addEventListener('change', () => {
      const provider = sel.dataset.provider;
      const newVal = parseInt(sel.value, 10);
      const priorities = loadProviderPriorities();

      if (newVal === 0) {
        // Disabled — just set it
        priorities[provider] = 0;
      } else {
        // Auto-shift: bump any provider already at this priority
        const oldVal = priorities[provider];
        Object.keys(priorities).forEach(prov => {
          if (prov !== provider && priorities[prov] === newVal && priorities[prov] > 0) {
            // Cascade: shift this one to the old slot (or next available)
            priorities[prov] = oldVal > 0 ? oldVal : newVal + 1;
          }
        });
        priorities[provider] = newVal;
      }

      saveProviderPriorities(priorities);
      syncProviderPriorityUI(priorities);
      if (typeof autoSelectDefaultProvider === 'function') {
        autoSelectDefaultProvider();
      }
    });
  });
};

/**
 * Renders the inline chip config table in Settings > Grouping.
 * Delegates to the generic _renderSectionConfigTable helper.
 */
const renderInlineChipConfigTable = () => _renderSectionConfigTable({
  containerId: 'inlineChipConfigContainer',
  getConfig: getInlineChipConfig,
  saveConfig: saveInlineChipConfig,
  emptyText: 'No chip types available',
  onApply: typeof renderTable === 'function' ? renderTable : null,
  onRender: () => renderInlineChipConfigTable(),
});

/**
 * Renders the filter chip category config table in Settings > Chips.
 * Each row has a checkbox (enable/disable) and up/down arrows for reordering.
 */
const renderFilterChipCategoryTable = () => {
  const container = document.getElementById('filterChipCategoryContainer');
  if (!container || typeof getFilterChipCategoryConfig !== 'function') return;

  const config = getFilterChipCategoryConfig();
  container.textContent = '';

  if (!config.length) {
    const empty = document.createElement('div');
    empty.className = 'chip-grouping-empty';
    empty.textContent = 'No chip categories available';
    container.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'chip-grouping-table';

  // Header row
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['', 'Category', 'Group', ''].forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    th.style.cssText = 'font-size:0.75rem;font-weight:normal;opacity:0.6;padding:0.2rem 0.4rem';
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  config.forEach((cat, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.catId = cat.id;

    // Checkbox cell
    const tdCheck = document.createElement('td');
    tdCheck.style.cssText = 'width:2rem;text-align:center';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = cat.enabled;
    cb.className = 'filter-cat-toggle';
    cb.title = 'Toggle ' + cat.label;
    cb.addEventListener('change', () => {
      const cfg = getFilterChipCategoryConfig();
      const item = cfg.at(idx);
      if (item) {
        item.enabled = cb.checked;
        saveFilterChipCategoryConfig(cfg);
        if (typeof renderActiveFilters === 'function') renderActiveFilters();
      }
    });
    tdCheck.appendChild(cb);

    // Label cell
    const tdLabel = document.createElement('td');
    tdLabel.textContent = cat.label;

    // Group dropdown cell
    const tdGroup = document.createElement('td');
    tdGroup.style.cssText = 'width:3rem;text-align:center';
    const groupSelect = document.createElement('select');
    groupSelect.className = 'control-select';
    groupSelect.title = 'Merge group — same letter = chips sort together';
    groupSelect.style.cssText = 'width:auto;min-width:3.2rem;padding:0.15rem 0.3rem;font-size:0.8rem';
    const groupOptions = ['\u2014', 'A', 'B', 'C', 'D', 'E'];
    groupOptions.forEach(letter => {
      const opt = document.createElement('option');
      opt.value = letter === '\u2014' ? '' : letter;
      opt.textContent = letter;
      if ((cat.group || '') === opt.value) opt.selected = true;
      groupSelect.appendChild(opt);
    });
    groupSelect.addEventListener('change', () => {
      const cfg = getFilterChipCategoryConfig();
      const item = cfg.at(idx);
      if (item) {
        item.group = groupSelect.value || null;
        saveFilterChipCategoryConfig(cfg);
        renderFilterChipCategoryTable();
        if (typeof renderActiveFilters === 'function') renderActiveFilters();
      }
    });
    tdGroup.appendChild(groupSelect);

    // Arrow buttons cell
    const tdMove = document.createElement('td');
    tdMove.style.cssText = 'width:3.5rem;text-align:right;white-space:nowrap';

    const makeBtn = (dir, disabled) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'inline-chip-move';
      btn.textContent = dir === 'up' ? '\u2191' : '\u2193';
      btn.title = 'Move ' + dir;
      btn.disabled = disabled;
      btn.addEventListener('click', () => {
        const cfg = getFilterChipCategoryConfig();
        const j = dir === 'up' ? idx - 1 : idx + 1;
        if (j < 0 || j >= cfg.length) return;
        const moved = cfg.splice(idx, 1).at(0);
        cfg.splice(j, 0, moved);
        saveFilterChipCategoryConfig(cfg);
        renderFilterChipCategoryTable();
        if (typeof renderActiveFilters === 'function') renderActiveFilters();
      });
      return btn;
    };
    tdMove.appendChild(makeBtn('up', idx === 0));
    tdMove.appendChild(makeBtn('down', idx === config.length - 1));

    tr.append(tdCheck, tdLabel, tdGroup, tdMove);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
};

/**
 * Renders the built-in (seed) Numista lookup rules table with enable/disable toggles.
 */
const renderSeedRuleTable = () => {
  const container = document.getElementById('seedRuleTableContainer');
  if (!container || !window.NumistaLookup) return;

  const rules = NumistaLookup.listSeedRules();
  const enabledCount = typeof NumistaLookup.getEnabledSeedRuleCount === 'function'
    ? NumistaLookup.getEnabledSeedRuleCount() : rules.length;
  const countBadge = document.getElementById('seedRuleCount');
  if (countBadge) countBadge.textContent = `(${enabledCount}/${rules.length})`;

  container.textContent = '';
  if (!rules.length) {
    const empty = document.createElement('div');
    empty.className = 'chip-grouping-empty';
    empty.textContent = 'No built-in patterns';
    container.appendChild(empty);
    return;
  }

  // Bulk toggle buttons
  const btnBar = document.createElement('div');
  btnBar.style.cssText = 'display:flex;gap:0.5rem;margin-bottom:0.5rem';

  const enableAllBtn = document.createElement('button');
  enableAllBtn.type = 'button';
  enableAllBtn.className = 'btn';
  enableAllBtn.textContent = 'Enable All';
  enableAllBtn.style.cssText = 'font-size:0.75rem;padding:0.2rem 0.6rem';
  enableAllBtn.addEventListener('click', () => {
    NumistaLookup.setAllSeedRulesEnabled(true);
    renderSeedRuleTable();
  });

  const disableAllBtn = document.createElement('button');
  disableAllBtn.type = 'button';
  disableAllBtn.className = 'btn';
  disableAllBtn.textContent = 'Disable All';
  disableAllBtn.style.cssText = 'font-size:0.75rem;padding:0.2rem 0.6rem';
  disableAllBtn.addEventListener('click', () => {
    NumistaLookup.setAllSeedRulesEnabled(false);
    renderSeedRuleTable();
  });

  btnBar.append(enableAllBtn, disableAllBtn);
  container.appendChild(btnBar);

  const table = document.createElement('table');
  table.className = 'chip-grouping-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['Enabled', 'Pattern', 'Numista Query', 'N#'].forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    th.style.cssText = 'font-size:0.75rem;font-weight:normal;opacity:0.6;padding:0.2rem 0.4rem';
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const rule of rules) {
    const tr = document.createElement('tr');

    // Enabled checkbox
    const tdEnabled = document.createElement('td');
    tdEnabled.style.cssText = 'width:2.5rem;text-align:center';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = typeof NumistaLookup.isSeedRuleEnabled === 'function'
      ? NumistaLookup.isSeedRuleEnabled(rule.id) : true;
    cb.title = 'Toggle ' + rule.id;
    cb.addEventListener('change', () => {
      if (typeof NumistaLookup.setSeedRuleEnabled === 'function') {
        NumistaLookup.setSeedRuleEnabled(rule.id, cb.checked);
      }
      // Update count badge
      const newCount = typeof NumistaLookup.getEnabledSeedRuleCount === 'function'
        ? NumistaLookup.getEnabledSeedRuleCount() : rules.length;
      if (countBadge) countBadge.textContent = `(${newCount}/${rules.length})`;
    });
    tdEnabled.appendChild(cb);

    const tdPattern = document.createElement('td');
    tdPattern.style.cssText = 'font-family:monospace;font-size:0.8rem;word-break:break-all';
    tdPattern.textContent = rule.pattern;

    const tdReplacement = document.createElement('td');
    tdReplacement.textContent = rule.replacement;

    const tdId = document.createElement('td');
    tdId.style.cssText = 'font-size:0.85rem;opacity:0.7;white-space:nowrap';
    tdId.textContent = rule.numistaId || '\u2014';

    tr.append(tdEnabled, tdPattern, tdReplacement, tdId);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  container.appendChild(table);
};

/**
 * Renders the custom Numista lookup rules table with delete buttons.
 */
const renderCustomRuleTable = () => {
  const container = document.getElementById('customRuleTableContainer');
  if (!container || !window.NumistaLookup) return;

  const rules = NumistaLookup.listCustomRules();
  container.textContent = '';

  if (!rules.length) {
    const empty = document.createElement('div');
    empty.className = 'chip-grouping-empty';
    empty.textContent = 'No custom patterns';
    container.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'chip-grouping-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['Pattern', 'Numista Query', 'N#', ''].forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    th.style.cssText = 'font-size:0.75rem;font-weight:normal;opacity:0.6;padding:0.2rem 0.4rem';
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const rule of rules) {
    const tr = document.createElement('tr');

    const tdPattern = document.createElement('td');
    tdPattern.style.cssText = 'font-family:monospace;font-size:0.8rem;word-break:break-all';
    tdPattern.textContent = rule.pattern;

    const tdReplacement = document.createElement('td');
    tdReplacement.textContent = rule.replacement;

    const tdId = document.createElement('td');
    tdId.style.cssText = 'font-size:0.85rem;opacity:0.7;white-space:nowrap';
    tdId.textContent = rule.numistaId || '\u2014';

    const tdDelete = document.createElement('td');
    tdDelete.style.cssText = 'width:2rem;text-align:center';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'inline-chip-move';
    delBtn.textContent = '\u2715';
    delBtn.title = 'Delete rule';
    delBtn.addEventListener('click', () => {
      NumistaLookup.removeRule(rule.id);
      renderCustomRuleTable();
    });
    tdDelete.appendChild(delBtn);

    tr.append(tdPattern, tdReplacement, tdId, tdDelete);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  container.appendChild(table);
};

/**
 * Syncs the display currency dropdown with current state (STACK-50).
 * Populates options from SUPPORTED_CURRENCIES on first call.
 */
const syncCurrencySettingsUI = () => {
  const sel = document.getElementById('settingsDisplayCurrency');
  if (!sel) return;
  if (sel.options.length === 0) {
    SUPPORTED_CURRENCIES.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.code;
      opt.textContent = `${c.code} \u2014 ${c.name}`;
      sel.appendChild(opt);
    });
  }
  sel.value = displayCurrency;
};

/**
 * Syncs the Goldback settings panel UI with current state.
 * Renders denomination price rows and updates enabled toggle.
 */
const syncGoldbackSettingsUI = () => {
  // Toggle — Goldback pricing enabled
  const toggleGroup = document.getElementById('settingsGoldbackEnabled');
  if (toggleGroup) {
    toggleGroup.querySelectorAll('.chip-sort-btn').forEach(btn => {
      const isOn = btn.dataset.val === 'on';
      btn.classList.toggle('active', goldbackEnabled ? isOn : !isOn);
    });
  }

  // Toggle — estimation enabled
  const estToggle = document.getElementById('settingsGoldbackEstimateEnabled');
  if (estToggle) {
    estToggle.querySelectorAll('.chip-sort-btn').forEach(btn => {
      const isOn = btn.dataset.val === 'on';
      btn.classList.toggle('active', goldbackEstimateEnabled ? isOn : !isOn);
    });
  }

  // Refresh button — visible whenever Goldback pricing is ON (API fetch is independent of estimation)
  const refreshBtn = document.getElementById('goldbackEstimateRefreshBtn');
  if (refreshBtn) {
    refreshBtn.style.display = goldbackEnabled ? '' : 'none';
  }

  // Modifier row — visible only when estimation ON
  const modifierRow = document.getElementById('goldbackEstimateModifierRow');
  if (modifierRow) {
    modifierRow.style.display = goldbackEstimateEnabled ? '' : 'none';
  }
  const modifierInput = document.getElementById('goldbackEstimateModifierInput');
  if (modifierInput) {
    modifierInput.value = goldbackEstimateModifier.toFixed(2);
  }

  // Info line — show estimated rate + gold spot reference
  const infoEl = document.getElementById('goldbackEstimateInfo');
  if (infoEl) {
    const goldSpot = spotPrices && spotPrices.gold ? spotPrices.gold : 0;
    if (goldbackEstimateEnabled && goldSpot > 0) {
      const rate = typeof computeGoldbackEstimatedRate === 'function'
        ? computeGoldbackEstimatedRate(goldSpot)
        : 0;
      const fmtRate = typeof formatCurrency === 'function' ? formatCurrency(rate) : '$' + rate.toFixed(2);
      const fmtSpot = typeof formatCurrency === 'function' ? formatCurrency(goldSpot) : '$' + goldSpot.toFixed(2);
      infoEl.textContent = `Estimated 1 GB rate: ${fmtRate}  (gold spot: ${fmtSpot})`;
      infoEl.style.display = '';
    } else {
      infoEl.style.display = 'none';
    }
  }

  // Denomination table
  const tbody = document.getElementById('goldbackPriceTableBody');
  if (!tbody || typeof GOLDBACK_DENOMINATIONS === 'undefined') return;

  tbody.innerHTML = '';
  // Convert stored USD prices to display currency for the input fields (STACK-50)
  const fxRate = (typeof getExchangeRate === 'function') ? getExchangeRate() : 1;
  for (const d of GOLDBACK_DENOMINATIONS) {
    const key = String(d.weight);
    const entry = goldbackPrices[key];
    const usdPrice = entry ? entry.price : '';
    const displayPrice = (usdPrice !== '' && fxRate !== 1) ? (usdPrice * fxRate).toFixed(2) : usdPrice;
    let updatedAt = entry && entry.updatedAt
      ? (typeof formatTimestamp === 'function' ? formatTimestamp(entry.updatedAt) : new Date(entry.updatedAt).toLocaleString())
      : '\u2014';
    if (goldbackEstimateEnabled && entry && entry.updatedAt) {
      updatedAt += ' (auto)';
    }

    const tr = document.createElement('tr');
    tr.dataset.denom = key;
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
    tr.innerHTML = `
      <td>${d.label}</td>
      <td>${d.goldOz} oz</td>
      <td><span class="gb-denom-symbol" style="margin-right:2px;">${typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '$'}</span><input type="number" min="0" step="0.01" value="${displayPrice}" style="width:80px;" /></td>
      <td style="font-size:0.85em;color:var(--text-secondary);">${updatedAt}</td>
    `;
    tbody.appendChild(tr);
  }

  // Update Quick Fill currency symbol (STACK-50)
  const gbQfSymbol = document.getElementById('gbQuickFillSymbol');
  if (gbQfSymbol && typeof getCurrencySymbol === 'function') {
    gbQfSymbol.textContent = getCurrencySymbol();
  }
};

// =============================================================================
// HEADER TOGGLE & LAYOUT VISIBILITY (STACK-54)
// =============================================================================

/**
 * Syncs the header shortcut UI in Settings with stored state.
 * Re-renders the config table and applies current header state.
 */
const syncHeaderToggleUI = () => {
  // settingsHeaderCurrencyBtn still exists in the Currency settings panel
  const currencyVisible = localStorage.getItem('headerCurrencyBtnVisible') !== 'false';
  syncChipToggle('settingsHeaderCurrencyBtn', currencyVisible);

  renderHeaderBtnConfigTable();
  applyHeaderToggleVisibility();
};

/**
 * Shows/hides and reorders header shortcut buttons based on stored config.
 * All buttons default visible for new users.
 */
const applyHeaderToggleVisibility = () => {
  const config = getHeaderBtnConfig();
  const BTN_ID_MAP = {
    themeBtn:    'headerThemeBtn',
    currencyBtn: 'headerCurrencyBtn',
    marketBtn:   'headerMarketBtn',
    trendBtn:    'headerTrendBtn',
    syncBtn:     'headerSyncBtn',
    vaultBtn:    'headerVaultBtn',
    restoreBtn:  'headerRestoreBtn',
    cloudSyncBtn: 'headerCloudSyncWrapper',
    aboutBtn:    'aboutBtn',
    settingsBtn: 'settingsBtn',
  };

  // Apply visibility
  for (const { id, enabled } of config) {
    const btnId = BTN_ID_MAP[id];
    if (!btnId) continue;
    const btn = safeGetElement(btnId);
    if (btn) btn.style.display = enabled ? '' : 'none';
  }

  // Apply order to live header container; settingsBtn is last (it's last in config)
  const container = safeGetElement('headerBtnContainer');
  if (container) {
    for (const { id } of config) {
      const btnId = BTN_ID_MAP[id];
      if (!btnId) continue;
      const btn = container.querySelector(`#${btnId}`);
      if (btn) container.append(btn);
    }
  }

  // Show text toggle
  const showText = localStorage.getItem(HEADER_BTN_SHOW_TEXT_KEY) !== 'false';
  if (container && container.classList) {
    container.classList.toggle('header-buttons--show-text', showText);
  }
};
window.applyHeaderToggleVisibility = applyHeaderToggleVisibility;

/**
 * Returns the header button config as [{id, label, enabled}] in saved order.
 * Reads visibility from individual legacy keys; order from `headerBtnOrder`.
 * @returns {Array<{id:string, label:string, enabled:boolean}>}
 */
const getHeaderBtnConfig = () => {
  const vis = {
    themeBtn:    localStorage.getItem('headerThemeBtnVisible') !== 'false',
    currencyBtn: localStorage.getItem('headerCurrencyBtnVisible') !== 'false',
    marketBtn:   localStorage.getItem(HEADER_MARKET_BTN_KEY) !== 'false',
    trendBtn:    (() => { const v = localStorage.getItem(HEADER_TREND_BTN_KEY); return v !== null ? v === 'true' : true; })(),
    syncBtn:     (() => { const v = localStorage.getItem(HEADER_SYNC_BTN_KEY); return v !== null ? v === 'true' : true; })(),
    vaultBtn:    (() => { const v = localStorage.getItem(HEADER_VAULT_BTN_KEY); return v !== null ? v === 'true' : true; })(),
    restoreBtn:  localStorage.getItem(HEADER_RESTORE_BTN_KEY) !== 'false',
    cloudSyncBtn: (() => { const v = localStorage.getItem(HEADER_CLOUD_SYNC_BTN_KEY); return v !== null ? v === 'true' : true; })(),
    aboutBtn:    localStorage.getItem('headerAboutBtnVisible') !== 'false',
  };
  const labelMap = {
    themeBtn: 'Theme', currencyBtn: 'Currency', marketBtn: 'Market',
    trendBtn: 'Trend', syncBtn: 'Spot Sync', vaultBtn: 'Backup',
    restoreBtn: 'Restore', cloudSyncBtn: 'Cloud Sync', aboutBtn: 'About',
  };
  const defaultOrder = Object.keys(vis);
  const savedOrder = (() => {
    const o = localStorage.getItem('headerBtnOrder');
    try { const p = o ? JSON.parse(o) : null; return Array.isArray(p) ? p : null; } catch { return null; }
  })();
  const order = savedOrder
    ? [...savedOrder.filter(k => k in vis), ...defaultOrder.filter(k => !savedOrder.includes(k))]
    : defaultOrder;
  const cfg = order.map(id => ({ id, label: labelMap[id] || id, enabled: vis[id] ?? true }));
  // Settings is always last and always visible (locked — cannot be hidden or reordered)
  cfg.push({ id: 'settingsBtn', label: 'Settings', enabled: true, locked: true });
  return cfg;
};

/**
 * Persists header button config: writes visibility to individual keys and
 * order to `headerBtnOrder`.
 * @param {Array<{id:string, enabled:boolean}>} cfg
 */
const saveHeaderBtnConfig = (cfg) => {
  const visKeys = {
    themeBtn:    'headerThemeBtnVisible',
    currencyBtn: 'headerCurrencyBtnVisible',
    marketBtn:   HEADER_MARKET_BTN_KEY,
    trendBtn:    HEADER_TREND_BTN_KEY,
    syncBtn:     HEADER_SYNC_BTN_KEY,
    vaultBtn:    HEADER_VAULT_BTN_KEY,
    restoreBtn:  HEADER_RESTORE_BTN_KEY,
    cloudSyncBtn: HEADER_CLOUD_SYNC_BTN_KEY,
    aboutBtn:    'headerAboutBtnVisible',
  };
  for (const item of cfg) {
    if (item.locked) continue;
    const key = visKeys[item.id];
    if (key) {
      try { localStorage.setItem(key, item.enabled ? 'true' : 'false'); } catch { /* ignore */ }
    }
  }
  try {
    // Exclude locked items from saved order (settingsBtn is always re-appended by getHeaderBtnConfig)
    localStorage.setItem('headerBtnOrder', JSON.stringify(
      cfg.filter(c => !c.locked).map(c => c.id)
    ));
  } catch (err) {
    console.warn('[HeaderBtnConfig] could not save order:', err);
  }
};

/** Renders the header button config table in Settings → Appearance (STAK-320). */
const renderHeaderBtnConfigTable = () => _renderSectionConfigTable({
  containerId: 'headerBtnConfigTable',
  getConfig: getHeaderBtnConfig,
  saveConfig: saveHeaderBtnConfig,
  onApply: () => applyHeaderToggleVisibility(),
  onRender: () => renderHeaderBtnConfigTable(),
});
window.renderHeaderBtnConfigTable = renderHeaderBtnConfigTable;

/**
 * Syncs layout section config table in Settings and applies layout order.
 */
const syncLayoutVisibilityUI = () => {
  renderLayoutSectionConfigTable();
  renderViewModalSectionConfigTable();
  renderMetalOrderConfigTable();
  renderInlineChipConfigTable();
  applyLayoutOrder();
};

/**
 * Generic section-config table renderer.
 * Builds a checkbox + arrow reorder table for any {id, label, enabled}[] config.
 *
 * @param {Object} opts
 * @param {string} opts.containerId - DOM id of the container element
 * @param {function} opts.getConfig - Returns the current config array
 * @param {function} opts.saveConfig - Persists the updated config array
 * @param {string} [opts.emptyText] - Text shown when config is empty (default: 'No sections available')
 * @param {function} [opts.onApply] - Called after every change (e.g. applyLayoutOrder)
 * @param {function} [opts.onRender] - Called to re-render after reorder (defaults to self)
 */
const _renderSectionConfigTable = (opts) => {
  const container = document.getElementById(opts.containerId);
  if (!container || typeof opts.getConfig !== 'function') return;

  const config = opts.getConfig();
  container.textContent = '';

  if (!config.length) {
    const empty = document.createElement('div');
    empty.className = 'chip-grouping-empty';
    empty.textContent = opts.emptyText || 'No sections available';
    container.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'chip-grouping-table';
  const tbody = document.createElement('tbody');

  // Count sortable (non-locked) items to bound arrow movement
  const sortableCount = config.filter(c => !c.locked).length;

  config.forEach((section, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.sectionId = section.id;

    // Checkbox cell
    const tdCheck = document.createElement('td');
    tdCheck.style.cssText = 'width:2rem;text-align:center';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = section.enabled;
    cb.className = 'inline-chip-toggle';
    cb.title = section.locked ? section.label + ' (always visible)' : 'Toggle ' + section.label;
    cb.disabled = !!section.locked;
    if (!section.locked) {
      cb.addEventListener('change', () => {
        const cfg = opts.getConfig();
        const item = cfg.at(idx);
        if (item) {
          item.enabled = cb.checked;
          opts.saveConfig(cfg);
          if (opts.onApply) opts.onApply();
        }
      });
    }
    tdCheck.appendChild(cb);

    // Label cell
    const tdLabel = document.createElement('td');
    tdLabel.textContent = section.label;

    // Arrow buttons cell (locked items get none)
    const tdMove = document.createElement('td');
    tdMove.style.cssText = 'width:3.5rem;text-align:right;white-space:nowrap';

    if (!section.locked) {
      const makeBtn = (dir, disabled) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'inline-chip-move';
        btn.textContent = dir === 'up' ? '\u2191' : '\u2193';
        btn.title = 'Move ' + dir;
        btn.disabled = disabled;
        btn.addEventListener('click', () => {
          const cfg = opts.getConfig();
          const maxSortable = cfg.filter(c => !c.locked).length;
          const j = dir === 'up' ? idx - 1 : idx + 1;
          if (j < 0 || j >= maxSortable) return;
          const moved = cfg.splice(idx, 1).at(0);
          cfg.splice(j, 0, moved);
          opts.saveConfig(cfg);
          (opts.onRender || (() => _renderSectionConfigTable(opts)))();
          if (opts.onApply) opts.onApply();
        });
        return btn;
      };
      tdMove.appendChild(makeBtn('up', idx === 0));
      tdMove.appendChild(makeBtn('down', idx >= sortableCount - 1));
    }

    tr.append(tdCheck, tdLabel, tdMove);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
};

/** Renders the main page layout section config table in Settings > Layout. */
const renderLayoutSectionConfigTable = () => _renderSectionConfigTable({
  containerId: 'layoutSectionConfigContainer',
  getConfig: getLayoutSectionConfig,
  saveConfig: saveLayoutSectionConfig,
  onApply: typeof applyLayoutOrder === 'function' ? applyLayoutOrder : null,
  onRender: () => renderLayoutSectionConfigTable(),
});

/** Renders the view modal section config table in Settings > Layout. */
const renderViewModalSectionConfigTable = () => _renderSectionConfigTable({
  containerId: 'viewModalSectionConfigContainer',
  getConfig: getViewModalSectionConfig,
  saveConfig: saveViewModalSectionConfig,
  onRender: () => renderViewModalSectionConfigTable(),
});

// =============================================================================
// METAL ORDER CONFIG
// =============================================================================

const METAL_ORDER_DEFAULTS = [
  { id: 'silver',    label: 'Silver',     enabled: true },
  { id: 'gold',      label: 'Gold',       enabled: true },
  { id: 'platinum',  label: 'Platinum',   enabled: true },
  { id: 'palladium', label: 'Palladium',  enabled: true },
  { id: 'all',       label: 'All Metals', enabled: true },
];

/**
 * Returns the current metal order config, merging stored data with defaults.
 * New metals added to defaults will be appended to existing stored configs.
 * @returns {Array<{id:string, label:string, enabled:boolean}>}
 */
const getMetalOrderConfig = () => {
  const stored = localStorage.getItem(METAL_ORDER_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      // Append any new defaults not yet in stored config
      const knownIds = new Set(parsed.map(m => m.id));
      METAL_ORDER_DEFAULTS.filter(m => !knownIds.has(m.id)).forEach(m => parsed.push({ ...m }));
      return parsed;
    } catch (e) { /* fall through to defaults */ }
  }
  return METAL_ORDER_DEFAULTS.map(m => ({ ...m }));
};

const saveMetalOrderConfig = (config) => {
  localStorage.setItem(METAL_ORDER_KEY, JSON.stringify(config));
};

/**
 * Applies metal order config: reorders and shows/hides spot price cards and totals cards.
 */
const applyMetalOrder = () => {
  const config = getMetalOrderConfig();
  const spotGrid     = document.querySelector('.spot-cards-grid');
  const totalsEl     = document.getElementById('totalsCarousel');

  const spotMap = {
    silver:   document.querySelector('.spot-input.silver'),
    gold:     document.querySelector('.spot-input.gold'),
    platinum: document.querySelector('.spot-input.platinum'),
    palladium:document.querySelector('.spot-input.palladium'),
  };
  const totalsMap = {
    silver:   document.querySelector('.total-card.silver'),
    gold:     document.querySelector('.total-card.gold'),
    platinum: document.querySelector('.total-card.platinum'),
    palladium:document.querySelector('.total-card.palladium'),
    all:      document.querySelector('.total-card.total-card-all'),
  };

  config.forEach(({ id, enabled }) => {
    const spotEl = spotMap[id];
    if (spotEl && spotGrid) {
      spotEl.style.display = enabled ? '' : 'none';
      spotGrid.appendChild(spotEl);
    }
    const totalEl = totalsMap[id];
    if (totalEl && totalsEl) {
      totalEl.style.display = enabled ? '' : 'none';
      totalsEl.appendChild(totalEl);
    }
  });

  if (typeof window.refreshTotalsDots === 'function') window.refreshTotalsDots();
};
window.applyMetalOrder = applyMetalOrder;

/** Renders the metal order config table in Settings > Chips. */
const renderMetalOrderConfigTable = () => _renderSectionConfigTable({
  containerId: 'metalOrderConfigContainer',
  getConfig: getMetalOrderConfig,
  saveConfig: saveMetalOrderConfig,
  onApply: applyMetalOrder,
  onRender: () => renderMetalOrderConfigTable(),
});
window.renderMetalOrderConfigTable = renderMetalOrderConfigTable;

/**
 * Shows/hides and reorders major page sections based on layout section config.
 * Reads from localStorage and applies both visibility and DOM order.
 */
const applyLayoutOrder = () => {
  const config = getLayoutSectionConfig();
  const sectionMap = {
    spotPrices: elements.spotPricesSection,
    totals:     elements.totalsSectionEl,
    search:     elements.searchSectionEl,
    table:      elements.tableSectionEl,
  };
  const container = document.querySelector('.container');
  if (!container) return;

  for (const section of config) {
    const el = sectionMap[section.id];
    if (!el) continue;
    el.style.display = section.enabled ? '' : 'none';
    container.append(el);
  }
};
const applyLayoutVisibility = applyLayoutOrder;
window.applyLayoutVisibility = applyLayoutVisibility;
window.applyLayoutOrder = applyLayoutOrder;

/**
 * Toggles the floating currency picker dropdown anchored to the header button.
 * Creates the dropdown lazily on first use; subsequent calls toggle visibility.
 */
const toggleCurrencyDropdown = () => {
  const btn = document.getElementById('headerCurrencyBtn');
  if (!btn) return;

  // If dropdown already open, close it
  const existing = document.getElementById('headerCurrencyDropdown');
  if (existing) {
    closeCurrencyDropdown();
    return;
  }

  // Build dropdown
  const dropdown = document.createElement('div');
  dropdown.id = 'headerCurrencyDropdown';
  dropdown.className = 'header-currency-dropdown';

  const currentCode = displayCurrency || 'USD';

  SUPPORTED_CURRENCIES.forEach(c => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'header-currency-item';
    if (c.code === currentCode) item.classList.add('active');

    const symbol = getCurrencySymbol(c.code);
    item.textContent = `${symbol}  ${c.code} — ${c.name}`;

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      saveDisplayCurrency(c.code);
      if (typeof renderTable === 'function') renderTable();
      if (typeof updateSummary === 'function') updateSummary();
      if (typeof updateAllSparklines === 'function') updateAllSparklines();
      if (typeof syncGoldbackSettingsUI === 'function') syncGoldbackSettingsUI();
      // Sync settings dropdown if open
      const sel = document.getElementById('settingsDisplayCurrency');
      if (sel) sel.value = c.code;
      closeCurrencyDropdown();
    });

    dropdown.appendChild(item);
  });

  // Position below button
  document.body.appendChild(dropdown);
  const rect = btn.getBoundingClientRect();
  dropdown.style.top = (rect.bottom + 4) + 'px';
  // Align right edge of dropdown with right edge of button
  dropdown.style.right = (window.innerWidth - rect.right) + 'px';

  // Close on outside click; header button click already stops propagation
  document.addEventListener('click', closeCurrencyDropdownOnOutside);
};

/** Closes the currency dropdown and removes the outside-click listener. */
const closeCurrencyDropdown = () => {
  const el = document.getElementById('headerCurrencyDropdown');
  if (el) el.remove();
  document.removeEventListener('click', closeCurrencyDropdownOnOutside);
};

/** Click-outside handler for the currency dropdown. */
const closeCurrencyDropdownOnOutside = (e) => {
  const dropdown = document.getElementById('headerCurrencyDropdown');
  const btn = elements.headerCurrencyBtn;
  if (dropdown && !dropdown.contains(e.target) && e.target !== btn) {
    closeCurrencyDropdown();
  }
};

// =============================================================================
// IMAGES SETTINGS TAB (STACK-96)
// =============================================================================

/**
 * Populate all sub-sections of the Images settings tab.
 */
const populateImagesSection = () => {
  renderImageStorageStats();
  renderCustomPatternRules();
  renderUserImageGrid();
};

/**
 * Create a thumbnail element (img or placeholder) for a given blob URL.
 * @param {string|null} src - Object URL or null
 * @param {string} alt - Alt text
 * @returns {HTMLElement}
 */
const createThumbEl = (src, alt) => {
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.className = 'pattern-rule-thumb';
    return img;
  }
  const placeholder = document.createElement('div');
  placeholder.className = 'pattern-rule-thumb pattern-rule-thumb-empty';
  placeholder.textContent = 'No img';
  return placeholder;
};

/**
 * Render user-created pattern image rules with dual thumbnails, edit, and delete.
 */
const renderCustomPatternRules = async () => {
  const container = document.getElementById('customPatternImageRules');
  if (!container) return;

  if (typeof NumistaLookup === 'undefined') {
    container.innerHTML = '<p style="font-size:0.85em;color:var(--text-secondary)">NumistaLookup not available.</p>';
    return;
  }

  const rules = NumistaLookup.listCustomRules();
  if (!rules.length) {
    container.innerHTML = '<p style="font-size:0.85em;color:var(--text-secondary)">No custom pattern rules yet. Use the form above to add one.</p>';
    return;
  }

  container.textContent = '';

  for (const rule of rules) {
    const row = document.createElement('div');
    row.className = 'pattern-rule-row';

    // Dual thumbnails (obverse + reverse)
    const thumbs = document.createElement('div');
    thumbs.className = 'pattern-rule-thumbs';

    let obverseSrc = null;
    let reverseSrc = null;
    if (rule.seedImageId && window.imageCache?.isAvailable()) {
      try { obverseSrc = await imageCache.getPatternImageUrl(rule.seedImageId, 'obverse'); } catch { /* ignore */ }
      try { reverseSrc = await imageCache.getPatternImageUrl(rule.seedImageId, 'reverse'); } catch { /* ignore */ }
    }
    thumbs.appendChild(createThumbEl(obverseSrc, rule.pattern + ' obverse'));
    thumbs.appendChild(createThumbEl(reverseSrc, rule.pattern + ' reverse'));
    row.appendChild(thumbs);

    // Info
    const info = document.createElement('div');
    info.className = 'pattern-rule-info';
    info.innerHTML = `<div class="rule-pattern">/${sanitizeHtml(rule.pattern)}/i</div>
      <div class="rule-replacement">${sanitizeHtml(rule.replacement) || '\u2014'}</div>`;
    row.appendChild(info);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'pattern-rule-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn';
    editBtn.textContent = 'Edit';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      NumistaLookup.removeRule(rule.id);
      if (rule.seedImageId && window.imageCache?.isAvailable()) {
        await imageCache.deletePatternImage(rule.seedImageId);
      }
      renderCustomPatternRules();
      renderImageStorageStats();
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    row.appendChild(actions);

    // Inline edit form (hidden by default)
    const editForm = document.createElement('div');
    editForm.className = 'pattern-rule-edit-form';
    editForm.style.display = 'none';
    editForm.innerHTML = `
      <div class="edit-form-fields">
        <label>Pattern <input type="text" class="edit-pattern" value="${rule.pattern.replace(/"/g, '&quot;')}" /></label>
        <label>Replacement <input type="text" class="edit-replacement" value="${(rule.replacement || '').replace(/"/g, '&quot;')}" /></label>
        <label>Obverse <input type="file" class="edit-obverse" accept="image/*" /></label>
        <label>Reverse <input type="file" class="edit-reverse" accept="image/*" /></label>
      </div>
      <div class="edit-form-actions">
        <button type="button" class="btn edit-save-btn">Save</button>
        <button type="button" class="btn edit-cancel-btn">Cancel</button>
      </div>`;

    // Toggle edit form
    editBtn.addEventListener('click', () => {
      const isVisible = editForm.style.display !== 'none';
      editForm.style.display = isVisible ? 'none' : 'block';
      editBtn.textContent = isVisible ? 'Edit' : 'Editing...';
    });

    // Cancel
    editForm.querySelector('.edit-cancel-btn').addEventListener('click', () => {
      editForm.style.display = 'none';
      editBtn.textContent = 'Edit';
    });

    // Save
    editForm.querySelector('.edit-save-btn').addEventListener('click', async () => {
      const newPattern = editForm.querySelector('.edit-pattern').value.trim();
      const newReplacement = editForm.querySelector('.edit-replacement').value.trim();

      if (!newPattern || !newReplacement) {
        appAlert('Pattern and replacement are required.');
        return;
      }

      const result = NumistaLookup.updateRule(rule.id, {
        pattern: newPattern,
        replacement: newReplacement,
        numistaId: null,  // STAK-306: clear any legacy N# — edit form no longer manages it
      });

      if (!result.success) {
        appAlert(result.error || 'Failed to update rule.');
        return;
      }

      // Handle new image uploads
      const obvFile = editForm.querySelector('.edit-obverse').files[0];
      const revFile = editForm.querySelector('.edit-reverse').files[0];
      if ((obvFile || revFile) && window.imageCache?.isAvailable()) {
        const ruleId = rule.seedImageId || rule.id;
        const processor = typeof imageProcessor !== 'undefined' ? imageProcessor : null;
        let obvBlob = null;
        let revBlob = null;

        try {
          if (obvFile) {
            obvBlob = processor ? (await processor.processFile(obvFile))?.blob || null : obvFile;
          }
          if (revFile) {
            revBlob = processor ? (await processor.processFile(revFile))?.blob || null : revFile;
          }
        } catch (err) {
          console.error('Image processing failed:', err);
          appAlert('Failed to process image: ' + err.message);
          return;
        }

        // Preserve existing side when only one side is uploaded
        if (rule.seedImageId && !(obvFile && revFile)) {
          const existing = await imageCache.getPatternImage(rule.seedImageId);
          await imageCache.cachePatternImage(ruleId, obvBlob || existing?.obverse || null, revBlob || existing?.reverse || null);
        } else {
          await imageCache.cachePatternImage(ruleId, obvBlob, revBlob);
        }

        // Ensure seedImageId is set on the rule
        if (!rule.seedImageId) {
          NumistaLookup.updateRule(rule.id, { seedImageId: ruleId });
        }
      }

      renderCustomPatternRules();
      renderImageStorageStats();
    });

    row.appendChild(editForm);
    container.appendChild(row);
  }
};

/**
 * Render storage statistics for the image system.
 */
const renderImageStorageStats = async () => {
  const container = document.getElementById('imageStorageStats');
  if (!container) return;

  if (!window.imageCache?.isAvailable()) {
    container.innerHTML = '<span class="stat-item">IndexedDB unavailable</span>';
    return;
  }

  const usage = await imageCache.getStorageUsage();
  const limitBytes = usage.limitBytes || 1;

  const fmt = (b) => {
    if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    return Math.round(b / 1024) + ' KB';
  };

  const pct = (b) => Math.min(100, ((b / limitBytes) * 100)).toFixed(1);

  const barColor = (b) => {
    const p = (b / limitBytes) * 100;
    if (p > 90) return 'var(--danger, #e74c3c)';
    if (p > 70) return 'var(--warning, #f39c12)';
    return 'var(--accent, #3498db)';
  };

  const userBar = document.getElementById('gaugeUserBar');
  const userSize = document.getElementById('gaugeUserSize');
  const numistaBar = document.getElementById('gaugeNumistaBar');
  const numistaSize = document.getElementById('gaugeNumistaSize');
  const persistLine = document.getElementById('gaugePersistLine');

  if (userBar) {
    userBar.style.width = pct(usage.userImageBytes || 0) + '%';
    userBar.style.background = barColor(usage.userImageBytes || 0);
  }
  if (userSize) {
    userSize.textContent = `${fmt(usage.userImageBytes || 0)} (${usage.userImageCount} items)`;
  }
  if (numistaBar) {
    numistaBar.style.width = pct(usage.numistaBytes || 0) + '%';
    numistaBar.style.background = barColor(usage.numistaBytes || 0);
  }
  if (numistaSize) {
    numistaSize.textContent = `${fmt(usage.numistaBytes || 0)} (${usage.numistaCount} coins)`;
  }
  if (persistLine) {
    const granted = localStorage.getItem(STORAGE_PERSIST_GRANTED_KEY);
    if (granted === 'true') {
      persistLine.textContent = '✅ Persistent storage granted — browser will not auto-clear your images';
      persistLine.style.color = 'var(--success, #27ae60)';
    } else if (granted === 'false') {
      persistLine.textContent = '⚠️ Persistent storage not granted — consider using Full Backup regularly';
      persistLine.style.color = 'var(--warning, #f39c12)';
    } else {
      persistLine.textContent = 'Upload a photo to request persistent storage protection';
      persistLine.style.color = 'var(--text-secondary)';
    }
  }
};

/**
 * Render user-uploaded images as rows with dual thumbnails, edit link, and delete.
 */
const renderUserImageGrid = async () => {
  const container = document.getElementById('userImageGrid');
  if (!container) return;

  if (!window.imageCache?.isAvailable()) {
    container.innerHTML = '<p style="font-size:0.85em;color:var(--text-secondary)">IndexedDB unavailable.</p>';
    return;
  }

  let userImages;
  try {
    userImages = await imageCache.exportAllUserImages();
  } catch {
    container.innerHTML = '<p style="font-size:0.85em;color:var(--text-secondary)">Could not load user images.</p>';
    return;
  }

  if (!userImages?.length) {
    container.innerHTML = '<p style="font-size:0.85em;color:var(--text-secondary)">No user-uploaded images yet.</p>';
    return;
  }

  container.textContent = '';

  for (const rec of userImages) {
    const row = document.createElement('div');
    row.className = 'pattern-rule-row';

    // Dual thumbnails
    const thumbs = document.createElement('div');
    thumbs.className = 'pattern-rule-thumbs';
    let obverseSrc = null;
    let reverseSrc = null;
    if (rec.obverse) { try { obverseSrc = URL.createObjectURL(rec.obverse); } catch { /* ignore */ } }
    if (rec.reverse) { try { reverseSrc = URL.createObjectURL(rec.reverse); } catch { /* ignore */ } }
    thumbs.appendChild(createThumbEl(obverseSrc, 'obverse'));
    thumbs.appendChild(createThumbEl(reverseSrc, 'reverse'));
    row.appendChild(thumbs);

    // Item name
    const item = typeof inventory !== 'undefined' ? inventory.find(i => i.uuid === rec.uuid) : null;
    const itemIndex = item && typeof inventory !== 'undefined' ? inventory.indexOf(item) : -1;
    const name = item ? item.name : rec.uuid.slice(0, 8) + '...';

    const info = document.createElement('div');
    info.className = 'pattern-rule-info';
    info.innerHTML = `<div class="rule-replacement">${name}</div>`;
    row.appendChild(info);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'pattern-rule-actions';

    // Edit link — opens item's edit modal
    if (itemIndex >= 0) {
      const editLink = document.createElement('button');
      editLink.className = 'btn';
      editLink.textContent = 'Edit';
      editLink.addEventListener('click', () => {
        hideSettingsModal();
        if (typeof editItem === 'function') editItem(itemIndex);
      });
      actions.appendChild(editLink);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      const confirmed = await appConfirm(`Delete images for "${name}"?`, 'User Images');
      if (!confirmed) return;
      await imageCache.deleteUserImage(rec.uuid);
      renderUserImageGrid();
      renderImageStorageStats();
    });
    actions.appendChild(deleteBtn);
    row.appendChild(actions);

    container.appendChild(row);
  }
};

// =============================================================================
// STORAGE SECTION
// =============================================================================

/** Friendly display names for known localStorage keys */
const STORAGE_KEY_LABELS = {
  metalInventory:                  { label: 'Inventory Data',            icon: '📋', category: 'Inventory' },
  inventorySerial:                 { label: 'Item Serial Counter',        icon: '🔢', category: 'Inventory' },
  catalogMap:                      { label: 'Catalog Map',                icon: '🗂', category: 'Inventory' },
  itemTags:                        { label: 'Item Tags',                  icon: '🏷', category: 'Inventory' },
  changeLog:                       { label: 'Change Log',                 icon: '📝', category: 'Inventory' },
  metalSpotHistory:                { label: 'Spot Price History',         icon: '📈', category: 'Prices' },
  'item-price-history':            { label: 'Item Price History',         icon: '💰', category: 'Prices' },
  'goldback-prices':               { label: 'Goldback Prices',            icon: '🥇', category: 'Prices' },
  'goldback-price-history':        { label: 'Goldback Price History',     icon: '🥇', category: 'Prices' },
  spotSilver:                      { label: 'Silver Spot (live)',         icon: '🪙', category: 'Prices' },
  spotGold:                        { label: 'Gold Spot (live)',           icon: '🪙', category: 'Prices' },
  spotPlatinum:                    { label: 'Platinum Spot (live)',       icon: '🪙', category: 'Prices' },
  spotPalladium:                   { label: 'Palladium Spot (live)',      icon: '🪙', category: 'Prices' },
  metalApiConfig:                  { label: 'API Configuration',          icon: '🔑', category: 'API & Cache' },
  metalApiCache:                   { label: 'API Cache',                  icon: '⚡', category: 'API & Cache' },
  lastCacheRefresh:                { label: 'Last Cache Refresh',         icon: '⏱', category: 'API & Cache' },
  lastApiSync:                     { label: 'Last API Sync',              icon: '⏱', category: 'API & Cache' },
  apiProviderOrder:                { label: 'API Provider Order',         icon: '↕', category: 'API & Cache' },
  providerPriority:                { label: 'Provider Priority',          icon: '↕', category: 'API & Cache' },
  'autocomplete_lookup_cache':     { label: 'Autocomplete Cache',         icon: '⚡', category: 'API & Cache' },
  'autocomplete_cache_timestamp':  { label: 'Autocomplete Cache Stamp',   icon: '⏱', category: 'API & Cache' },
  'staktrakr.catalog.cache':       { label: 'Catalog Cache',              icon: '⚡', category: 'API & Cache' },
  'staktrakr.catalog.history':     { label: 'Catalog Call History',       icon: '📜', category: 'API & Cache' },
  'catalog_api_config':            { label: 'Catalog API Config',         icon: '🔑', category: 'API & Cache' },
  exchangeRates:                   { label: 'Exchange Rates',             icon: '💱', category: 'API & Cache' },
  appTheme:                        { label: 'Theme',                      icon: '🎨', category: 'Settings' },
  displayCurrency:                 { label: 'Display Currency',           icon: '💱', category: 'Settings' },
  appTimeZone:                     { label: 'Timezone',                   icon: '🕐', category: 'Settings' },
  settingsItemsPerPage:            { label: 'Items Per Page',             icon: '⚙️', category: 'Settings' },
  cardViewStyle:                   { label: 'Card View Style',            icon: '⚙️', category: 'Settings' },
  desktopCardView:                 { label: 'Desktop Card View',          icon: '⚙️', category: 'Settings' },
  defaultSortColumn:               { label: 'Default Sort Column',        icon: '⚙️', category: 'Settings' },
  defaultSortDir:                  { label: 'Default Sort Direction',     icon: '⚙️', category: 'Settings' },
  metalOrderConfig:                { label: 'Metal Order / Visibility',   icon: '⚙️', category: 'Settings' },
  layoutVisibility:                { label: 'Layout Visibility',          icon: '⚙️', category: 'Settings' },
  layoutSectionConfig:             { label: 'Layout Section Config',      icon: '⚙️', category: 'Settings' },
  viewModalSectionConfig:          { label: 'View Modal Section Config',  icon: '⚙️', category: 'Settings' },
  chipMinCount:                    { label: 'Chip Min Count',             icon: '⚙️', category: 'Settings' },
  chipMaxCount:                    { label: 'Chip Max Count',             icon: '⚙️', category: 'Settings' },
  chipCustomGroups:                { label: 'Chip Custom Groups',         icon: '⚙️', category: 'Settings' },
  chipBlacklist:                   { label: 'Chip Blacklist',             icon: '⚙️', category: 'Settings' },
  inlineChipConfig:                { label: 'Inline Chip Config',         icon: '⚙️', category: 'Settings' },
  filterChipCategoryConfig:        { label: 'Filter Chip Categories',     icon: '⚙️', category: 'Settings' },
  chipSortOrder:                   { label: 'Chip Sort Order',            icon: '⚙️', category: 'Settings' },
  numistaLookupRules:              { label: 'Numista Lookup Rules',       icon: '🔍', category: 'Settings' },
  numistaViewFields:               { label: 'Numista View Fields',        icon: '🔍', category: 'Settings' },
  'staktrakr.catalog.settings':   { label: 'Catalog Settings',           icon: '🔍', category: 'Settings' },
  tableImagesEnabled:              { label: 'Table Images',               icon: '🖼', category: 'Settings' },
  tableImageSides:                 { label: 'Table Image Sides',          icon: '🖼', category: 'Settings' },
  enabledSeedRules:                { label: 'Enabled Seed Rules',         icon: '🌱', category: 'Settings' },
  featureFlags:                    { label: 'Feature Flags',              icon: '🚩', category: 'Settings' },
  headerTrendBtnVisible:           { label: 'Trend Btn Visible',          icon: '⚙️', category: 'Settings' },
  headerSyncBtnVisible:            { label: 'Sync Btn Visible',           icon: '⚙️', category: 'Settings' },
  headerThemeBtnVisible:           { label: 'Theme Btn Visible',          icon: '⚙️', category: 'Settings' },
  headerCurrencyBtnVisible:        { label: 'Currency Btn Visible',       icon: '⚙️', category: 'Settings' },
  spotTrendRange:                  { label: 'Spot Trend Range',           icon: '📈', category: 'Settings' },
  spotCompareMode:                 { label: 'Spot Compare Mode',          icon: '📈', category: 'Settings' },
  spotTrendPeriod:                 { label: 'Spot Trend Period',          icon: '📈', category: 'Settings' },
  'goldback-enabled':              { label: 'Goldback Enabled',           icon: '🥇', category: 'Settings' },
  'goldback-estimate-enabled':     { label: 'Goldback Estimate On',       icon: '🥇', category: 'Settings' },
  'goldback-estimate-modifier':    { label: 'Goldback Modifier',          icon: '🥇', category: 'Settings' },
  cloud_token_dropbox:             { label: 'Dropbox Token',              icon: '☁️', category: 'Cloud & Auth' },
  cloud_token_pcloud:              { label: 'pCloud Token',               icon: '☁️', category: 'Cloud & Auth' },
  cloud_token_box:                 { label: 'Box Token',                  icon: '☁️', category: 'Cloud & Auth' },
  cloud_last_backup:               { label: 'Last Cloud Backup',          icon: '☁️', category: 'Cloud & Auth' },
  cloud_activity_log:              { label: 'Cloud Activity Log',         icon: '☁️', category: 'Cloud & Auth' },
  cloud_kraken_seen:               { label: 'Cloud Onboarding Seen',      icon: '☁️', category: 'Cloud & Auth' },
  staktrakr_oauth_result:          { label: 'OAuth Result',               icon: '🔐', category: 'Cloud & Auth' },
  currentAppVersion:               { label: 'App Version (stored)',       icon: 'ℹ️', category: 'App State' },
  ackVersion:                      { label: 'Acknowledged Version',       icon: 'ℹ️', category: 'App State' },
  ackDismissed:                    { label: 'Acknowledgment Dismissed',   icon: 'ℹ️', category: 'App State' },
  lastVersionCheck:                { label: 'Last Version Check',         icon: 'ℹ️', category: 'App State' },
  latestRemoteVersion:             { label: 'Latest Remote Version',      icon: 'ℹ️', category: 'App State' },
  latestRemoteUrl:                 { label: 'Latest Remote URL',          icon: 'ℹ️', category: 'App State' },
  seedImagesVer:                   { label: 'Seed Images Version',        icon: '🌱', category: 'App State' },
  ff_migration_fuzzy_autocomplete: { label: 'Migration: Fuzzy Autocomplete', icon: '🔄', category: 'App State' },
  migration_hourlySource:          { label: 'Migration: Hourly Source',   icon: '🔄', category: 'App State' },
  'staktrakr.debug':               { label: 'Debug Flag',                 icon: '🐛', category: 'App State' },
  'stackrtrackr.debug':            { label: 'Debug Flag (legacy typo)',   icon: '🐛', category: 'App State' },
};

/** Keys under this KB threshold are considered "minor" and hidden by default */
const STORAGE_TINY_THRESHOLD_KB = 0.5;

/** True = show minor keys; toggled by the button in the panel */
let _storageTinyVisible = false;

/**
 * Populates the Storage settings panel with live LS and IDB data.
 * @param {boolean} [silent=false] - If true, skip the loading spinner on refresh
 */
const renderStorageSection = async (silent = false) => {
  const keyTable  = document.getElementById('storageKeyTable');
  const idbTable  = document.getElementById('storageIdbTable');
  if (!keyTable) return;

  if (!silent) {
    keyTable.innerHTML  = '<div class="storage-key-table-loading">Loading…</div>';
    if (idbTable) idbTable.innerHTML = '<div class="storage-key-table-loading">Loading…</div>';
  }

  // ── 1. Gather localStorage data ──────────────────────────────────────────
  const lsItems = [];
  let lsTotalKB = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const val = localStorage.getItem(key) || '';
    const sizeKB = ((key.length + val.length) * 2) / 1024;
    lsTotalKB += sizeKB;

    let type = 'String', records = null;
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed))        { type = 'Array';  records = parsed.length; }
      else if (parsed && typeof parsed === 'object') { type = 'Object'; records = Object.keys(parsed).length; }
      else                               { type = 'Value'; }
    } catch (e) { /* not JSON */ }

    const meta = STORAGE_KEY_LABELS[key] || {};
    lsItems.push({ key, sizeKB, type, records, label: meta.label || key, icon: meta.icon || '📄', category: meta.category || 'Other' });
  }
  lsItems.sort((a, b) => b.sizeKB - a.sizeKB);

  // ── 2. Gather IndexedDB data ──────────────────────────────────────────────
  let idbStats = null;
  if (window.imageCache?.isAvailable()) {
    try { idbStats = await imageCache.getStorageUsage(); } catch (e) { /* unavailable */ }
  }

  const idbTotalKB  = idbStats ? idbStats.totalBytes / 1024 : 0;
  const idbLimitKB  = idbStats ? idbStats.limitBytes / 1024 : 50 * 1024;
  const lsLimitKB   = 5 * 1024;
  const combinedKB  = lsTotalKB + idbTotalKB;
  const combinedLimitKB = lsLimitKB + idbLimitKB;

  // ── 3. Update summary stat cards ─────────────────────────────────────────
  const fmt = (kb) => kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`;
  const pct = (used, limit) => limit > 0 ? Math.min((used / limit) * 100, 100) : 0;

  const setCard = (id, val, sub, barId, barPct, barClass) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
    const subEl = document.getElementById(`${id}_sub`);
    if (subEl) subEl.textContent = sub;
    const bar = document.getElementById(barId);
    if (bar) { bar.style.width = `${barPct.toFixed(1)}%`; if (barClass) bar.className = `storage-stat-bar ${barClass}`; }
  };

  setCard('storageStat_ls',       fmt(lsTotalKB),    `${pct(lsTotalKB, lsLimitKB).toFixed(1)}% of 5,120 KB`,    'storageStatBar_ls',            pct(lsTotalKB, lsLimitKB),    'storage-stat-bar--ls');
  setCard('storageStat_idb',      fmt(idbTotalKB),   `${pct(idbTotalKB, idbLimitKB).toFixed(1)}% of ${fmt(idbLimitKB)}`, 'storageStatBar_idb', pct(idbTotalKB, idbLimitKB),   'storage-stat-bar--idb');
  setCard('storageStat_combined', fmt(combinedKB),   `of ~${fmt(combinedLimitKB)} cap`, 'storageStatBar_combined_ls',  pct(lsTotalKB, combinedLimitKB), 'storage-stat-bar--ls');
  const combinedIdbBar = document.getElementById('storageStatBar_combined_idb');
  if (combinedIdbBar) combinedIdbBar.style.width = `${pct(idbTotalKB, combinedLimitKB).toFixed(1)}%`;

  // ── 4. Render localStorage key table ─────────────────────────────────────
  const major = lsItems.filter(it => it.sizeKB >= STORAGE_TINY_THRESHOLD_KB);
  const minor = lsItems.filter(it => it.sizeKB < STORAGE_TINY_THRESHOLD_KB);
  const visible = _storageTinyVisible ? lsItems : major;

  const rowsHtml = visible.map(it => {
    const barPct = lsTotalKB > 0 ? Math.min((it.sizeKB / lsTotalKB) * 100, 100) : 0;
    const recStr = it.records !== null ? it.records.toLocaleString() : '—';
    const sizeStr = it.sizeKB >= 1 ? `${it.sizeKB.toFixed(1)} KB` : `${(it.sizeKB * 1024).toFixed(0)} B`;
    return `<tr class="storage-key-row">
      <td class="storage-key-icon">${it.icon}</td>
      <td class="storage-key-label">${sanitizeHtml(it.label)}<span class="storage-key-raw">${sanitizeHtml(it.key)}</span></td>
      <td class="storage-key-size">${sizeStr}</td>
      <td class="storage-key-bar-cell"><div class="storage-key-bar-wrap"><div class="storage-key-bar" style="width:${barPct.toFixed(1)}%"></div></div></td>
      <td class="storage-key-pct">${barPct.toFixed(1)}%</td>
      <td class="storage-key-type"><span class="storage-type-badge storage-type-badge--${it.type.toLowerCase()}">${it.type}</span></td>
      <td class="storage-key-records">${recStr}</td>
    </tr>`;
  }).join('');

  keyTable.innerHTML = `
    <table class="storage-data-table">
      <thead><tr>
        <th></th>
        <th>Key</th>
        <th>Size</th>
        <th class="storage-col-bar">Usage</th>
        <th>%</th>
        <th>Type</th>
        <th>Records</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    ${minor.length > 0 ? `<p class="storage-minor-note">${_storageTinyVisible ? '' : `${minor.length} minor keys hidden. `}<button class="btn-link storage-toggle-tiny" id="storageToggleTinyBottom">${_storageTinyVisible ? 'Hide minor keys' : 'Show all'}</button></p>` : ''}
  `;

  // wire bottom toggle
  const bottomToggle = document.getElementById('storageToggleTinyBottom');
  if (bottomToggle) bottomToggle.addEventListener('click', _handleStorageTinyToggle);

  // ── 5. Render IndexedDB table ─────────────────────────────────────────────
  if (idbTable) {
    if (!idbStats) {
      idbTable.innerHTML = '<p class="settings-subtext">IndexedDB unavailable in this browser.</p>';
    } else {
      const idbRows = [
        { label: 'Coin Images',     icon: '🖼', count: idbStats.numistaCount,      sizeKB: null },
        { label: 'User Images',     icon: '📷', count: idbStats.userImageCount,    sizeKB: null },
        { label: 'Pattern Images',  icon: '🎨', count: idbStats.patternImageCount || 0, sizeKB: null },
        { label: 'Coin Metadata',   icon: '📄', count: idbStats.metadataCount,     sizeKB: null },
      ];
      // Estimate size by proportion of total (exact per-store breakdown not available from getStorageUsage)
      const idbTotalCount = idbRows.reduce((s, r) => s + r.count, 0) || 1;
      idbRows.forEach(r => { r.sizeKB = idbTotalCount > 0 ? (r.count / idbTotalCount) * idbTotalKB : 0; });

      const idbRowsHtml = idbRows.map(r => {
        const barPct = idbTotalKB > 0 ? Math.min((r.sizeKB / idbTotalKB) * 100, 100) : 0;
        const sizeStr = r.sizeKB >= 1024 ? `${(r.sizeKB / 1024).toFixed(1)} MB` : `${r.sizeKB.toFixed(1)} KB`;
        return `<tr class="storage-key-row">
          <td class="storage-key-icon">${r.icon}</td>
          <td class="storage-key-label">${r.label}<span class="storage-key-raw">StakTrakrImages</span></td>
          <td class="storage-key-size">~${sizeStr}</td>
          <td class="storage-key-bar-cell"><div class="storage-key-bar-wrap"><div class="storage-key-bar storage-key-bar--idb" style="width:${barPct.toFixed(1)}%"></div></div></td>
          <td class="storage-key-pct">${barPct.toFixed(1)}%</td>
          <td class="storage-key-type"><span class="storage-type-badge storage-type-badge--idb">IDB</span></td>
          <td class="storage-key-records">${r.count.toLocaleString()}</td>
        </tr>`;
      }).join('');

      const idbTotalStr = idbTotalKB >= 1024 ? `${(idbTotalKB / 1024).toFixed(1)} MB` : `${idbTotalKB.toFixed(1)} KB`;
      const idbLimitStr = idbLimitKB >= 1024 ? `${(idbLimitKB / 1024).toFixed(0)} MB` : `${idbLimitKB.toFixed(0)} KB`;

      idbTable.innerHTML = `
        <table class="storage-data-table">
          <thead><tr>
            <th></th>
            <th>Store</th>
            <th>~Size</th>
            <th class="storage-col-bar">Usage</th>
            <th>%</th>
            <th>Type</th>
            <th>Records</th>
          </tr></thead>
          <tbody>${idbRowsHtml}</tbody>
        </table>
        <p class="storage-minor-note">Total: ${idbTotalStr} / ${idbLimitStr} &nbsp;·&nbsp; Size per store is estimated proportionally from record count.</p>
      `;
    }
  }

  // ── 6. Update top toggle button text ─────────────────────────────────────
  const topToggle = document.getElementById('storageToggleTiny');
  if (topToggle) topToggle.textContent = _storageTinyVisible ? 'Hide minor keys' : `Show minor keys (${minor.length})`;
};

const _handleStorageTinyToggle = () => {
  _storageTinyVisible = !_storageTinyVisible;
  renderStorageSection(true);
};

/**
 * Builds and renders the Numista tag settings UI:
 * 1. Auto-apply Numista tags toggle
 * 2. Tag blacklist management section
 * Appended after the numistaBulkSyncGroup inside the Numista provider panel.
 */
const renderNumistaTagSettings = () => {
  const container = safeGetElement('numistaTagSettingsGroup');
  if (!container) return;

  // Clear previous render
  container.innerHTML = '';

  // ── 1. Auto-apply toggle ──────────────────────────────────────────────
  const autoGroup = document.createElement('div');
  autoGroup.className = 'settings-group';
  autoGroup.style.cssText = 'margin-top: 1rem; border-top: 1px solid var(--border); padding-top: 0.75rem;';

  const autoLabel = document.createElement('div');
  autoLabel.className = 'settings-group-label';
  autoLabel.textContent = 'Auto-apply Numista tags on import';
  autoGroup.appendChild(autoLabel);

  const autoSubtext = document.createElement('p');
  autoSubtext.className = 'settings-subtext';
  autoSubtext.textContent = 'When enabled, tags from Numista are automatically applied to items during search and bulk sync. Disable to skip tag assignment entirely.';
  autoGroup.appendChild(autoSubtext);

  const toggleWrap = document.createElement('div');
  toggleWrap.className = 'chip-sort-toggle';
  toggleWrap.id = 'settingsNumistaTagsAuto';

  const btnYes = document.createElement('button');
  btnYes.type = 'button';
  btnYes.className = 'chip-sort-btn';
  btnYes.dataset.val = 'yes';
  btnYes.textContent = 'On';

  const btnNo = document.createElement('button');
  btnNo.type = 'button';
  btnNo.className = 'chip-sort-btn';
  btnNo.dataset.val = 'no';
  btnNo.textContent = 'Off';

  toggleWrap.appendChild(btnYes);
  toggleWrap.appendChild(btnNo);
  autoGroup.appendChild(toggleWrap);
  container.appendChild(autoGroup);

  // Sync initial state
  const autoOn = loadDataSync('numista_tags_auto', true);
  syncChipToggle('settingsNumistaTagsAuto', autoOn);

  // Wire toggle
  toggleWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-sort-btn');
    if (!btn) return;
    const isEnabled = btn.dataset.val === 'yes';
    saveDataSync('numista_tags_auto', isEnabled);
    syncChipToggle('settingsNumistaTagsAuto', isEnabled);
  });

  // ── 2. Tag blacklist section ──────────────────────────────────────────
  const blGroup = document.createElement('div');
  blGroup.className = 'settings-group';
  blGroup.style.cssText = 'margin-top: 1rem; border-top: 1px solid var(--border); padding-top: 0.75rem;';

  const blLabel = document.createElement('div');
  blLabel.className = 'settings-group-label';
  blLabel.textContent = 'Tag Blacklist';
  blGroup.appendChild(blLabel);

  const blSubtext = document.createElement('p');
  blSubtext.className = 'settings-subtext';
  blSubtext.textContent = 'Tags in this list will never be applied from Numista imports. Matching is case-insensitive.';
  blGroup.appendChild(blSubtext);

  // Input row
  const inputRow = document.createElement('div');
  inputRow.style.cssText = 'display:flex;gap:0.5rem;margin-bottom:0.5rem;';

  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.id = 'numistaTagBlacklistInput';
  tagInput.placeholder = 'e.g. Circulation';
  tagInput.style.cssText = 'flex:1;padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:4px;font-size:0.85rem;background:var(--bg);color:var(--text);';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn info';
  addBtn.style.fontSize = '0.85rem';
  addBtn.textContent = 'Add';

  inputRow.appendChild(tagInput);
  inputRow.appendChild(addBtn);
  blGroup.appendChild(inputRow);

  // Tag list container
  const tagList = document.createElement('div');
  tagList.id = 'numistaTagBlacklistList';
  tagList.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.35rem;';
  blGroup.appendChild(tagList);

  container.appendChild(blGroup);

  // Render current blacklist
  const renderBlacklist = () => {
    tagList.innerHTML = '';
    const blacklist = typeof window.loadTagBlacklist === 'function' ? window.loadTagBlacklist() : [];
    if (blacklist.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'settings-subtext';
      hint.style.fontSize = '0.8rem';
      hint.textContent = 'No blacklisted tags.';
      tagList.appendChild(hint);
      return;
    }
    for (const tag of blacklist) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:0.25rem;padding:0.2rem 0.5rem;border-radius:12px;font-size:0.8rem;background:var(--bg-secondary, #eee);color:var(--text);';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = sanitizeHtml(tag);
      chip.appendChild(nameSpan);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '\u00d7';
      removeBtn.title = 'Remove from blacklist';
      removeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:1rem;line-height:1;padding:0 0.15rem;color:var(--text-secondary);';
      removeBtn.addEventListener('click', () => {
        if (typeof window.removeFromTagBlacklist === 'function') {
          window.removeFromTagBlacklist(tag);
          renderBlacklist();
        }
      });
      chip.appendChild(removeBtn);
      tagList.appendChild(chip);
    }
  };

  // Wire add button
  const doAdd = () => {
    const val = tagInput.value.trim();
    if (!val) return;
    if (typeof window.addToTagBlacklist === 'function') {
      window.addToTagBlacklist(val);
    }
    tagInput.value = '';
    renderBlacklist();
  };

  addBtn.addEventListener('click', doAdd);
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doAdd(); }
  });

  renderBlacklist();
};

// Expose globally
if (typeof window !== 'undefined') {
  window.showSettingsModal = showSettingsModal;
  window.hideSettingsModal = hideSettingsModal;
  window.switchSettingsSection = switchSettingsSection;
  window.switchProviderTab = switchProviderTab;
  window.renderInlineChipConfigTable = renderInlineChipConfigTable;
  window.renderFilterChipCategoryTable = renderFilterChipCategoryTable;
  window.renderLayoutSectionConfigTable = renderLayoutSectionConfigTable;
  window.syncGoldbackSettingsUI = syncGoldbackSettingsUI;
  window.syncCurrencySettingsUI = syncCurrencySettingsUI;
  window.syncHeaderToggleUI = syncHeaderToggleUI;
  window.syncLayoutVisibilityUI = syncLayoutVisibilityUI;
  window.renderSeedRuleTable = renderSeedRuleTable;
  window.renderCustomRuleTable = renderCustomRuleTable;
  window.populateImagesSection = populateImagesSection;
  window.renderStorageSection = renderStorageSection;
  window.renderNumistaTagSettings = renderNumistaTagSettings;
}

// INITIALIZATION - FIXED VERSION
// =============================================================================

/**
 * Helper function to create dummy DOM elements to prevent null reference errors
 * @returns {Object} A dummy element object with basic properties
 */
function createDummyElement() {
  return {
    textContent: "",
    innerHTML: "",
    style: {},
    value: "",
    checked: false,
    disabled: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    focus: () => {},
    click: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

/**
 * Safely retrieves a DOM element by ID with fallback to dummy element
 * @param {string} id - Element ID
 * @param {boolean} required - Whether to log warning if element missing
 * @returns {HTMLElement|Object} Element or dummy element
 */
function safeGetElement(id, required = false) {
  const element = document.getElementById(id);
  if (!element && required) {
    console.warn(`Required element '${id}' not found in DOM`);
  }
  return element || createDummyElement();
}

/**
 * Main application initialization function
 *
 * This function coordinates the complete application startup process with proper
 * error handling, DOM element validation, and event binding.
 *
 * @returns {void} Fully initializes the application interface
 */
document.addEventListener("DOMContentLoaded", async () => {
  debugLog(`=== APPLICATION INITIALIZATION STARTED (v${APP_VERSION}) ===`);

  try {
    // Phase 0: Apply domain-based logo branding
    const brandName = typeof getBrandingName === 'function' ? getBrandingName() : BRANDING_TITLE;
    const logoSplit = BRANDING_DOMAIN_OPTIONS.logoSplit[brandName];
    if (logoSplit) {
      document.querySelectorAll('.logo-silver').forEach(el => { el.textContent = logoSplit[0]; });
      document.querySelectorAll('.logo-gold').forEach(el => { el.textContent = logoSplit[1]; });
      // Adjust SVG viewBox for longer brand names
      if (logoSplit[2]) {
        const logoSvg = document.querySelector('.stackr-logo');
        if (logoSvg) logoSvg.setAttribute('viewBox', `0 0 ${logoSplit[2]} 200`);
      }
    }
    const appLogo = document.getElementById('appLogo');
    if (appLogo) appLogo.setAttribute('aria-label', brandName);
    const footerBrand = document.getElementById('footerBrand');
    if (footerBrand) footerBrand.textContent = brandName;
    // Update About modal site link to match current domain
    const siteDomain = typeof getFooterDomain === 'function' ? getFooterDomain() : 'staktrakr.com';
    const aboutSiteLink = document.getElementById('aboutSiteLink');
    const aboutSiteDomain = document.getElementById('aboutSiteDomain');
    if (aboutSiteLink) aboutSiteLink.href = `https://www.${siteDomain}`;
    if (aboutSiteDomain) aboutSiteDomain.textContent = siteDomain;

    // Phase 0b: Environment badge + toast for non-production origins (STAK-376)
    const envLabel = typeof getEnvironmentLabel === 'function' ? getEnvironmentLabel() : null;
    if (envLabel) {
      const envBadge = document.getElementById('envBadge');
      if (envBadge) {
        envBadge.textContent = envLabel.label;
        envBadge.className = 'env-badge ' + envLabel.className;
        envBadge.style.display = '';
      }
      // One-time toast per session explaining data isolation
      const toastKey = 'envToastShown';
      if (!sessionStorage.getItem(toastKey)) {
        sessionStorage.setItem(toastKey, '1');
        const msg = envLabel.label === 'BETA'
          ? 'You are on the BETA site. Your data here is separate from the main site.'
          : envLabel.label === 'PREVIEW'
            ? 'Preview deployment — data is separate from the main site.'
            : 'Running locally — data is stored on this device only.';
        setTimeout(() => { if (typeof showToast === 'function') showToast(msg, 5000); }, 1500);
      }
    }

    // Phase 1: Initialize Core DOM Elements
    debugLog("Phase 1: Initializing core DOM elements...");

    // Core form elements
    elements.inventoryForm = safeGetElement("inventoryForm", true);

    const inventoryTableEl = safeGetElement("inventoryTable", true);
    const tbody = inventoryTableEl && inventoryTableEl.querySelector ? inventoryTableEl.querySelector("tbody") : null;
    elements.inventoryTable = tbody;

    elements.itemMetal = safeGetElement("itemMetal", true);
    elements.itemName = safeGetElement("itemName", true);
    elements.itemQty = safeGetElement("itemQty", true);
    elements.itemType = safeGetElement("itemType", true);
    elements.itemWeight = safeGetElement("itemWeight", true);
    elements.itemWeightUnit = safeGetElement("itemWeightUnit", true);
    elements.itemGbDenom = safeGetElement("itemGbDenom");
    elements.itemPrice = safeGetElement("itemPrice", true);
    elements.itemMarketValue = safeGetElement("itemMarketValue");
    elements.marketValueField = safeGetElement("marketValueField");
    elements.dateField = safeGetElement("dateField");
    elements.purchaseLocation = safeGetElement("purchaseLocation", true);
    elements.storageLocation = safeGetElement("storageLocation");
    elements.itemNotes = safeGetElement("itemNotes");
    elements.itemDate = safeGetElement("itemDate", true);
    elements.itemSpotPrice = safeGetElement("itemSpotPrice");
    elements.itemCatalog = safeGetElement("itemCatalog");
    elements.itemYear = safeGetElement("itemYear");
    elements.itemGrade = safeGetElement("itemGrade");
    elements.itemGradingAuthority = safeGetElement("itemGradingAuthority");
    elements.itemCertNumber = safeGetElement("itemCertNumber");
    elements.itemObverseImageUrl = safeGetElement("itemObverseImageUrl");
    elements.itemReverseImageUrl = safeGetElement("itemReverseImageUrl");
    elements.itemPcgsNumber = safeGetElement("itemPcgsNumber");
    elements.itemSerialNumber = safeGetElement("itemSerialNumber");
    elements.searchNumistaBtn = safeGetElement("searchNumistaBtn");
    elements.lookupPcgsBtn = safeGetElement("lookupPcgsBtn");
    elements.spotLookupBtn = safeGetElement("spotLookupBtn");
    elements.itemPuritySelect = safeGetElement("itemPuritySelect");
    elements.itemPurity = safeGetElement("itemPurity");
    elements.purityCustomWrapper = safeGetElement("purityCustomWrapper");
    elements.searchNumistaNameBtn = safeGetElement("searchNumistaNameBtn");
    elements.cloneItemBtn = safeGetElement("cloneItemBtn");
    elements.viewItemFromEditBtn = safeGetElement("viewItemFromEditBtn");
    elements.cloneItemSaveAnotherBtn = safeGetElement("cloneItemSaveAnotherBtn");
    elements.clonePickerCount = safeGetElement("clonePickerCount");
    elements.itemDateNABtn = safeGetElement("itemDateNABtn");
    elements.estimateRetailFromSpot = safeGetElement("estimateRetailFromSpot");
    elements.retailSpotModifier = safeGetElement("retailSpotModifier");
    elements.numistaDataSection = safeGetElement("numistaDataSection");
    elements.tagsSection = safeGetElement("tagsSection");
    elements.newTagInput = safeGetElement("newTagInput");
    elements.addTagBtn = safeGetElement("addTagBtn");

    // Header buttons - CRITICAL
    debugLog("Phase 2: Initializing header buttons...");
    elements.appLogo = safeGetElement("appLogo");
    elements.settingsBtn = safeGetElement("settingsBtn", true);
    elements.aboutBtn = safeGetElement("aboutBtn");

    // STACK-54 header toggles
    elements.headerThemeBtn = safeGetElement("headerThemeBtn");
    elements.headerCurrencyBtn = safeGetElement("headerCurrencyBtn");

    // STACK-54 layout sections
    elements.spotPricesSection = safeGetElement("spotPricesSection");
    elements.totalsSectionEl = safeGetElement("totalsSectionEl");
    elements.searchSectionEl = safeGetElement("searchSectionEl");
    elements.tableSectionEl = safeGetElement("tableSectionEl");

    // Check if critical buttons exist
    debugLog(
      "Settings Button found:",
      !!document.getElementById("settingsBtn"),
    );

    // Import/Export elements
    debugLog("Phase 3: Initializing import/export elements...");
    elements.importCsvFile = safeGetElement("importCsvFile");
    elements.importCsvOverride = safeGetElement("importCsvOverride");
    elements.importCsvMerge = safeGetElement("importCsvMerge");
    elements.importJsonFile = safeGetElement("importJsonFile");
    elements.importJsonOverride = safeGetElement("importJsonOverride");
    elements.importJsonMerge = safeGetElement("importJsonMerge");
    elements.importProgress = safeGetElement("importProgress");
    elements.importProgressText = safeGetElement("importProgressText");
    elements.numistaImportBtn = safeGetElement("numistaImportBtn");
    elements.numistaImportFile = safeGetElement("numistaImportFile");
    elements.numistaMerge = safeGetElement("numistaMerge");
      elements.numistaImportOptions = safeGetElement("numistaImportOptions");
      elements.exportCsvBtn = safeGetElement("exportCsvBtn");
    elements.exportJsonBtn = safeGetElement("exportJsonBtn");
    elements.exportPdfBtn = safeGetElement("exportPdfBtn");
    elements.cloudSyncBtn = safeGetElement("cloudSyncBtn");
    elements.syncAllBtn = safeGetElement("syncAllBtn");
    elements.numistaApiKey = safeGetElement("numistaApiKey");
    elements.removeInventoryDataBtn = safeGetElement("removeInventoryDataBtn");
    elements.boatingAccidentBtn = safeGetElement("boatingAccidentBtn");
    elements.forceRefreshBtn = safeGetElement("forceRefreshBtn");
    elements.vaultExportBtn = safeGetElement("vaultExportBtn");
    elements.vaultImportBtn = safeGetElement("vaultImportBtn");
    elements.vaultImportFile = safeGetElement("vaultImportFile");

    // Modal elements
    debugLog("Phase 4: Initializing modal elements...");
    elements.settingsModal = safeGetElement("settingsModal");
    elements.apiInfoModal = safeGetElement("apiInfoModal");
    elements.apiHistoryModal = safeGetElement("apiHistoryModal");
    elements.goldbackHistoryModal = safeGetElement("goldbackHistoryModal");
    elements.cloudSyncModal = safeGetElement("cloudSyncModal");
    elements.cloudSyncConflictModal = safeGetElement("cloudSyncConflictModal");
    elements.vaultModal = safeGetElement("vaultModal");
    elements.apiQuotaModal = safeGetElement("apiQuotaModal");
    elements.aboutModal = safeGetElement("aboutModal");
    elements.ackModal = safeGetElement("ackModal");
    elements.ackAcceptBtn = safeGetElement("ackAcceptBtn");
    // Unified item modal elements (add/edit)
    elements.itemModal = safeGetElement("itemModal");
    elements.itemCloseBtn = safeGetElement("itemCloseBtn");
    elements.cancelItemBtn = safeGetElement("cancelItem");
    elements.itemModalTitle = safeGetElement("itemModalTitle");
    elements.itemModalSubmit = safeGetElement("itemModalSubmit");
    elements.itemSerial = safeGetElement("itemSerial");
    elements.undoChangeBtn = safeGetElement("undoChangeBtn");

    // Show acknowledgment modal immediately and set up modal events
    if (typeof setupAckModalEvents === "function") {
      setupAckModalEvents();
    }
    if (typeof setupAboutModalEvents === "function") {
      setupAboutModalEvents();
    }
    if (typeof setupFaqModalEvents === "function") {
      setupFaqModalEvents();
    }

    // Notes modal elements
    elements.notesModal = safeGetElement("notesModal");
    elements.notesTextarea = safeGetElement("notesTextarea");
    elements.saveNotesBtn = safeGetElement("saveNotes");
    elements.cancelNotesBtn = safeGetElement("cancelNotes");
    elements.notesCloseBtn = safeGetElement("notesCloseBtn");

    // View item modal elements
    elements.viewItemModal = safeGetElement("viewItemModal");
    elements.viewModalCloseBtn = safeGetElement("viewModalCloseBtn");

    // Debug modal elements
    elements.debugModal = safeGetElement("debugModal");
    elements.debugCloseBtn = safeGetElement("debugCloseBtn");

    // Bulk edit modal elements
    elements.bulkEditModal = safeGetElement("bulkEditModal");
    elements.bulkEditBtn = safeGetElement("bulkEditBtn");
    elements.bulkEditCloseBtn = safeGetElement("bulkEditCloseBtn");


    // Settings change log panel
    elements.settingsChangeLogClearBtn = safeGetElement("settingsChangeLogClearBtn");

    // Settings Activity Log sub-tab elements (STACK-44)
    elements.settingsSpotHistoryClearBtn = safeGetElement("settingsSpotHistoryClearBtn");
    elements.settingsCatalogHistoryClearBtn = safeGetElement("settingsCatalogHistoryClearBtn");
    elements.settingsPriceHistoryClearBtn = safeGetElement("settingsPriceHistoryClearBtn");
    elements.settingsCloudActivityClearBtn = safeGetElement("settingsCloudActivityClearBtn");
    elements.priceHistoryFilterInput = safeGetElement("priceHistoryFilterInput");

    // Pagination elements
    debugLog("Phase 5: Initializing pagination elements...");
    elements.itemsPerPage = safeGetElement("itemsPerPage");
    elements.itemCount = safeGetElement("itemCount");

      elements.changeLogBtn = safeGetElement("changeLogBtn");
      elements.backupReminder = safeGetElement("backupReminder");
      elements.changeLogModal = safeGetElement("changeLogModal");
      elements.changeLogCloseBtn = safeGetElement("changeLogCloseBtn");
      elements.changeLogClearBtn = safeGetElement("changeLogClearBtn");
      elements.changeLogTable = safeGetElement("changeLogTable");
      elements.storageUsage = safeGetElement("storageUsage");
      elements.storageReportLink = safeGetElement("storageReportLink");

    // Search elements
    debugLog("Phase 6: Initializing search elements...");
    elements.searchInput = safeGetElement("searchInput");
    elements.clearBtn = safeGetElement("clearBtn");
    elements.newItemBtn = safeGetElement("newItemBtn");
    elements.searchResultsInfo = safeGetElement("searchResultsInfo");
    elements.activeFilters = safeGetElement("activeFilters");

    // Ensure chipMinCount has a sensible default for new installs
    try {
      const chipMinEl = document.getElementById('chipMinCount');
      const saved = localStorage.getItem('chipMinCount');
      if (!saved) {
        localStorage.setItem('chipMinCount', '3');
      }
      if (chipMinEl) {
        chipMinEl.value = localStorage.getItem('chipMinCount') || '3';
      }
    } catch (e) {
      // ignore storage errors
    }

    // Ensure chipMaxCount has a sensible default for new installs
    try {
      const chipMaxEl = document.getElementById('chipMaxCount');
      const savedMax = localStorage.getItem('chipMaxCount');
      if (!savedMax) {
        localStorage.setItem('chipMaxCount', '0');
      }
      if (chipMaxEl) {
        chipMaxEl.value = localStorage.getItem('chipMaxCount') || '0';
      }
    } catch (e) {
      // ignore storage errors
    }

    // Details modal elements
    debugLog("Phase 7: Initializing details modal elements...");
    elements.detailsModal = safeGetElement("detailsModal");
    elements.detailsModalTitle = safeGetElement("detailsModalTitle");
    elements.typeBreakdown = safeGetElement("typeBreakdown");
    elements.locationBreakdown = safeGetElement("locationBreakdown");
    elements.detailsCloseBtn = safeGetElement("detailsCloseBtn");
    elements.totalTitles = document.querySelectorAll(".total-title");

    // Chart elements
    debugLog("Phase 8: Initializing chart elements...");
    elements.typeChart = safeGetElement("typeChart");
    elements.locationChart = safeGetElement("locationChart");

    // Phase 9: Initialize Metal-Specific Elements
    debugLog("Phase 9: Initializing metal-specific elements...");

    // Initialize nested objects for spot price cards
    elements.spotPriceDisplay = {};
    elements.spotSyncIcon = {};
    elements.spotRangeSelect = {};
    elements.spotSparkline = {};

    Object.values(METALS).forEach((metalConfig) => {
      const metalKey = metalConfig.key;
      const metalName = metalConfig.name;

      debugLog(`  Setting up ${metalName} elements...`);

      elements.spotPriceDisplay[metalKey] = safeGetElement(
        `spotPriceDisplay${metalName}`,
      );
      elements.spotSyncIcon[metalKey] = safeGetElement(
        `syncIcon${metalName}`,
      );
      elements.spotRangeSelect[metalKey] = safeGetElement(
        `spotRange${metalName}`,
      );
      elements.spotSparkline[metalKey] = safeGetElement(
        `sparkline${metalName}`,
      );

      debugLog(`    - ${metalName} display element:`, !!document.getElementById(`spotPriceDisplay${metalName}`));
      debugLog(`    - ${metalName} sparkline canvas:`, !!document.getElementById(`sparkline${metalName}`));
    });

    // Phase 10: Initialize Totals Elements
    debugLog("Phase 10: Initializing totals elements...");

    if (!elements.totals) {
      elements.totals = {};
    }

    Object.values(METALS).forEach((metalConfig) => {
      const metalKey = metalConfig.key;
      const metalName = metalConfig.name;

      elements.totals[metalKey] = {
        items: safeGetElement(`totalItems${metalName}`),
        weight: safeGetElement(`totalWeight${metalName}`),
        value: safeGetElement(`currentValue${metalName}`),
        purchased: safeGetElement(`totalPurchased${metalName}`),
        retailValue: safeGetElement(`retailValue${metalName}`),
        lossProfit: safeGetElement(`lossProfit${metalName}`),
        avgCostPerOz: safeGetElement(`avgCostPerOz${metalName}`),
      };
    });

    // Initialize "All" totals
    elements.totals.all = {
      items: safeGetElement("totalItemsAll"),
      weight: safeGetElement("totalWeightAll"),
      value: safeGetElement("currentValueAll"),
      purchased: safeGetElement("totalPurchasedAll"),
      retailValue: safeGetElement("retailValueAll"),
      lossProfit: safeGetElement("lossProfitAll"),
      avgCostPerOz: safeGetElement("avgCostPerOzAll"),
    };

    // Phase 11: Version Management
    debugLog("Phase 11: Updating version information...");
    document.title = getAppTitle();
    // COMMENTED OUT: This was overriding the SVG logo in the header
    // const appHeader = document.querySelector(".app-header h1");
    // if (appHeader) {
    //   const headerBrand = getBrandingName();
    //   appHeader.textContent = headerBrand;
    // }
    const aboutVersion = document.getElementById("aboutVersion");
    if (aboutVersion) {
      aboutVersion.textContent = `v${APP_VERSION}`;
    }
    const footerDomainEl = document.getElementById("footerDomain");
    if (footerDomainEl) {
      footerDomainEl.textContent = getFooterDomain();
    }
    if (typeof loadAnnouncements === "function") {
      loadAnnouncements();
    }

    // Phase 12: Data Initialization
    debugLog("Phase 12: Loading application data...");

    // Set default date
    if (elements.itemDate && elements.itemDate.value !== undefined) {
      elements.itemDate.value = todayStr();
    }

    // Load data
    await loadInventory();

    // Migrate: existing users keep header theme button visible
    if (inventory.length > 0 && localStorage.getItem('headerThemeBtnVisible') === null) {
      localStorage.setItem('headerThemeBtnVisible', 'true');
    }

    // Load seed rule toggles before seed inventory (so migration sees real user data)
    if (typeof NumistaLookup !== 'undefined' && typeof NumistaLookup.loadEnabledSeedRules === 'function') {
      NumistaLookup.loadEnabledSeedRules();
    }

    // Seed sample inventory for first-time users
    if (typeof loadSeedInventory === 'function') {
      loadSeedInventory();
    }
    if (typeof sanitizeTablesOnLoad === "function") {
      sanitizeTablesOnLoad();
    }
    inventory.forEach((i) => addCompositionOption(i.composition || i.metal));
    refreshCompositionOptions();
    loadSpotHistory();

    // Load per-item price history (STACK-43)
    if (typeof loadItemPriceHistory === 'function') {
      loadItemPriceHistory();
    }

    // Load item tags (STAK-126)
    if (typeof loadItemTags === 'function') {
      loadItemTags();
      debugLog(`Loaded tags for ${Object.keys(itemTags).length} items`);
    }

    // Load Goldback denomination pricing (STACK-45)
    if (typeof loadGoldbackPrices === 'function') loadGoldbackPrices();
    if (typeof loadGoldbackPriceHistory === 'function') loadGoldbackPriceHistory();
    if (typeof loadGoldbackEnabled === 'function') loadGoldbackEnabled();
    if (typeof loadGoldbackEstimateEnabled === 'function') loadGoldbackEstimateEnabled();
    if (typeof loadGoldbackEstimateModifier === 'function') loadGoldbackEstimateModifier();

    // Load retail market prices and start background auto-sync
    if (typeof initRetailPrices === 'function') initRetailPrices();
    if (typeof startRetailBackgroundSync === 'function') startRetailBackgroundSync();

    // Load display currency preference and cached exchange rates (STACK-50)
    if (typeof loadDisplayCurrency === 'function') loadDisplayCurrency();
    if (typeof loadExchangeRates === 'function') loadExchangeRates();

    // Seed spot history for first-time users
    if (typeof loadSeedSpotHistory === 'function') {
      await loadSeedSpotHistory();
    }

    // Initialize API system
    apiConfig = loadApiConfig();
    apiCache = loadApiCache();

    // Apply saved desktop card view setting (STAK-118)
    const _isCardOnInit = localStorage.getItem(DESKTOP_CARD_VIEW_KEY) === 'true';
    if (_isCardOnInit) {
      document.body.classList.add('force-card-view');
    }

    // Load persisted items-per-page setting (view-aware defaults: card=3, table=24)
    try {
      const savedIpp = localStorage.getItem(ITEMS_PER_PAGE_KEY);
      if (savedIpp) {
        if (savedIpp === 'all') {
          itemsPerPage = Infinity;
          if (elements.itemsPerPage) elements.itemsPerPage.value = 'all';
        } else {
          const parsed = parseInt(savedIpp, 10);
          if ([3, 6, 12, 24, 48, 96, 128, 512].includes(parsed)) {
            itemsPerPage = parsed;
            if (elements.itemsPerPage) elements.itemsPerPage.value = String(parsed);
          }
        }
      } else {
        // No saved preference — default to all
        itemsPerPage = Infinity;
        if (elements.itemsPerPage) elements.itemsPerPage.value = 'all';
      }
    } catch (e) { /* ignore */ }

    // Apply saved theme attribute early so CSS variables resolve correctly
    // before renderActiveFilters() computes contrast colors in Phase 13
    const earlyTheme = localStorage.getItem(THEME_KEY);
    if (earlyTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (earlyTheme === 'sepia') {
      document.documentElement.setAttribute('data-theme', 'sepia');
    }

    // Initialize IndexedDB image cache (COIN_IMAGES feature)
    if (typeof imageCache !== 'undefined' && featureFlags.isEnabled('COIN_IMAGES')) {
      try {
        await imageCache.init();
        debugLog('ImageCache available:', imageCache.isAvailable());
      } catch (e) {
        console.warn('ImageCache init failed:', e);
      }
    }

    // CDN Backfill removed — URLs are written at save/bulk-sync time (STAK-309)
    debugLog('[Init] Skipping CDN backfill (removed in STAK-309 fix)');

    // Clean up stale localStorage keys from removed systems
    try { localStorage.removeItem('seedImagesVersion'); } catch (_) { /* ignore */ }

    // Wire view modal close button
    if (elements.viewModalCloseBtn) {
      elements.viewModalCloseBtn.addEventListener('click', () => {
        if (typeof closeViewModal === 'function') closeViewModal();
      });
    }
    // Background click dismiss for view modal
    if (elements.viewItemModal) {
      elements.viewItemModal.addEventListener('click', (e) => {
        if (e.target === elements.viewItemModal && typeof closeViewModal === 'function') closeViewModal();
      });
    }

    // Apply header toggle & layout visibility from saved prefs (STACK-54)
    if (typeof applyHeaderToggleVisibility === 'function') applyHeaderToggleVisibility();
    if (typeof updateSpotSyncHealthDot === 'function') updateSpotSyncHealthDot();
    if (typeof updateMarketHealthDot === 'function') updateMarketHealthDot();
    if (typeof applyLayoutOrder === 'function') applyLayoutOrder();
    if (typeof applyMetalOrder === 'function') applyMetalOrder();

    // Phase 13: Initial Rendering
    debugLog("Phase 13: Rendering initial display...");
      renderTable();
      if (typeof renderActiveFilters === 'function') {
        renderActiveFilters();
      }
      fetchSpotPrice();
      if (typeof updateAllSparklines === "function") {
        updateAllSparklines();
      }
      updateSyncButtonStates();
      if (typeof updateStorageStats === "function") {
        updateStorageStats();
      }

    // STAK-149: Initialize cloud auto-sync (starts poller if previously enabled)
    if (typeof initCloudSync === 'function') {
      initCloudSync();
    }

    // Load Numista search lookup custom rules
    if (typeof NumistaLookup !== 'undefined' && typeof NumistaLookup.loadCustomRules === 'function') {
      NumistaLookup.loadCustomRules();
    }

    // Load seed custom pattern rules + images for first-time users
    // Must run after loadCustomRules() so addRule() doesn't clobber existing rules
    if (typeof loadSeedImages === 'function') {
      await loadSeedImages();
    }

    // STACK-62: Initialize autocomplete/fuzzy search system
    if (typeof initializeAutocomplete === 'function') {
      initializeAutocomplete(inventory);
    }

    // Automatically sync prices if cache is stale and API keys are available
    if (typeof autoSyncSpotPrices === "function") {
      autoSyncSpotPrices();
    }

    // STAK-222: Start background spot price polling
    if (typeof startSpotBackgroundSync === 'function') {
      startSpotBackgroundSync();
    }

    // Fetch fresh exchange rates in the background (STACK-50)
    if (typeof fetchExchangeRates === 'function') {
      fetchExchangeRates().then(updated => {
        if (updated && displayCurrency !== 'USD') {
          // Re-render with fresh rates
          if (typeof renderTable === 'function') renderTable();
          if (typeof updateSummary === 'function') updateSummary();
        }
      }).catch(() => {});
    }

    // Phase 14: Event Listeners Setup (Delayed)
    debugLog("Phase 14: Setting up event listeners...");

    // Use a small delay to ensure all DOM manipulation is complete
    setTimeout(() => {
      try {
        setupEventListeners();
        setupPagination();
        setupBulkEditControls();
        setupThemeToggle();
        if (typeof setupSettingsEventListeners === 'function') {
          setupSettingsEventListeners();
        }
        setupColumnResizing();

        // Purity select ↔ custom input toggle
        if (elements.itemPuritySelect) {
          elements.itemPuritySelect.addEventListener('change', () => {
            const wrapper = elements.purityCustomWrapper || document.getElementById('purityCustomWrapper');
            const input = elements.itemPurity || document.getElementById('itemPurity');
            const isCustom = elements.itemPuritySelect.value === 'custom';
            if (wrapper) wrapper.style.display = isCustom ? '' : 'none';
            if (input && !isCustom) input.value = '';
          });
        }

        // Weight unit ↔ denomination picker toggle (STACK-45)
        if (elements.itemWeightUnit) {
          elements.itemWeightUnit.addEventListener('change', () => {
            if (typeof toggleGbDenomPicker === 'function') toggleGbDenomPicker();
          });
        }
        if (elements.itemGbDenom) {
          elements.itemGbDenom.addEventListener('change', () => {
            if (elements.itemWeight) {
              elements.itemWeight.value = elements.itemGbDenom.value;
            }
          });
        }

        // Setup Edit header toggle functionality
        const editHeader = document.querySelector('th[data-column="actions"]');
        if (editHeader) {
          editHeader.addEventListener('click', (event) => {
            if (event.shiftKey) {
              // Shift + Click = Toggle all items edit mode
              if (typeof toggleAllItemsEdit === 'function') {
                toggleAllItemsEdit();
              }
            } else {
              // Regular Click = Toggle edit mode (quick/modal)
              if (typeof toggleEditMode === 'function') {
                toggleEditMode();
              }
            }
          });
          editHeader.title = 'Click to toggle edit mode • Shift+Click to toggle all items edit';
          debugLog("✓ Edit header toggle initialized");
        }
        
        debugLog("✓ All event listeners setup complete");
      } catch (eventError) {
        console.error("❌ Error setting up event listeners:", eventError);

        // Try basic event setup as fallback
        setupBasicEventListeners();
      }

      // Always set up search listeners
      setupSearch();
    }, 200); // Increased delay for better compatibility

    // Phase 15: Completion
    debugLog("=== INITIALIZATION COMPLETE ===");
    debugLog("✓ Version:", APP_VERSION);
    debugLog("✓ API configured:", !!apiConfig);
    debugLog("✓ Inventory items:", inventory.length);
    debugLog("✓ Critical elements check:");
    debugLog("  - Settings button:", !!elements.settingsBtn);
    debugLog("  - Inventory form:", !!elements.inventoryForm);
    debugLog("  - Inventory table:", !!elements.inventoryTable);
    // API health badge — runs after safeGetElement and all DOM setup are ready
    if (typeof initApiHealth === 'function') initApiHealth();

    // Phase 16: Storage optimization pass
    if (typeof optimizeStoragePhase1C === 'function') { optimizeStoragePhase1C(); }

    // Phase 17: Hash deep-link handling (runs after event listeners are wired)
    // Supports privacy.html redirect shim and any direct #privacy / #faq links.
    setTimeout(() => { // nosemgrep: javascript.lang.security.detect-eval-with-expression.detect-eval-with-expression
      const hash = window.location.hash;
      if (hash === '#privacy') {
        window.location.hash = '';
        if (window.openModalById) openModalById('privacyModal');
      } else if (hash === '#faq') {
        window.location.hash = '';
        if (typeof showSettingsModal === 'function') showSettingsModal('faq');
      }
    }, 250);

  } catch (error) {
    console.error("=== CRITICAL INITIALIZATION ERROR ===");
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);

    // Try to show a user-friendly error message
    setTimeout(() => {
      appAlert(
        `Application initialization failed: ${error.message}\n\nPlease refresh the page and try again. If the problem persists, check the browser console for more details.`,
      );
    }, 100);
  }
});


/**
 * Basic event listener setup as fallback
 */
function setupBasicEventListeners() {
  debugLog("Setting up basic event listeners as fallback...");

  // Settings button
  const settingsBtn = document.getElementById("settingsBtn");
  if (settingsBtn) {
    settingsBtn.onclick = function () {
      if (typeof showSettingsModal === "function") {
        showSettingsModal();
      }
    };
  }

  debugLog("Basic event listeners setup complete");
}

// Make functions available globally for inline event handlers
window.showDetailsModal = showDetailsModal;
window.closeDetailsModal = closeDetailsModal;
window.showViewModal = typeof showViewModal !== 'undefined' ? showViewModal : () => {};
window.closeViewModal = typeof closeViewModal !== 'undefined' ? closeViewModal : () => {};
window.editItem = editItem;
window.deleteItem = deleteItem;
window.showNotes = showNotes;
window.applyColumnFilter = applyColumnFilter;

// Register service worker for PWA support (HTTP/HTTPS only, skip file://)
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

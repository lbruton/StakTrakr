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
    dataset: {},
    classList: {
      add: () => {},
      remove: () => {},
      toggle: () => false,
      contains: () => false,
      replace: () => false,
      forEach: () => {},
      length: 0,
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    remove: () => {},
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

// Auto-reload when a new service worker takes control (STAK-485)
if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!document._swReloading) {
      document._swReloading = true;
      window.location.reload();
    }
  });
}

/**
 * One-time boot migration: derive `spotPricingSource` from legacy keys (STAK-443, REQ-9)
 *
 * Idempotent — early-returns if `spotPricingSource` is already a non-null string.
 * Otherwise walks the legacy fallback chain:
 *   1. `providerPriority` object → key whose value equals 1
 *   2. `apiProviderOrder` array → index 0
 *   3. `metalApiConfig.provider`
 *   4. default `"STAKTRAKR"`
 * Validates the candidate against `API_PROVIDERS` keys (plus `"MANUAL"`); coerces
 * to `"STAKTRAKR"` if invalid. Legacy keys remain untouched for one release cycle.
 *
 * @returns {Promise<void>}
 */
async function migrateSpotPricingSource() {
  try {
    const existing = await loadData(SPOT_PRICING_SOURCE_KEY, null);
    const allowed = new Set([...Object.keys(API_PROVIDERS), "MANUAL"]);
    if (typeof existing === "string" && existing.length > 0 && allowed.has(existing)) return;

    let candidate = null;

    // Step 2: providerPriority (object) — pick key whose value equals 1
    const priority = await loadData("providerPriority", null);
    if (priority && typeof priority === "object" && !Array.isArray(priority)) {
      for (const [prov, rank] of Object.entries(priority)) {
        if (rank === 1) {
          candidate = prov;
          break;
        }
      }
    }

    // Step 3: apiProviderOrder (array) — index 0
    if (!candidate) {
      const order = await loadData("apiProviderOrder", null);
      if (Array.isArray(order) && order.length > 0 && typeof order[0] === "string") {
        candidate = order[0];
      }
    }

    // Step 4: metalApiConfig.provider
    if (!candidate) {
      const cfg = await loadData("metalApiConfig", null);
      if (cfg && typeof cfg === "object" && typeof cfg.provider === "string" && cfg.provider) {
        candidate = cfg.provider;
      }
    }

    // Step 5: default
    if (!candidate) candidate = "STAKTRAKR";

    // Step 6: validate against API_PROVIDERS keys + "MANUAL"
    if (!allowed.has(candidate)) candidate = "STAKTRAKR";

    // Step 7: persist
    await saveData(SPOT_PRICING_SOURCE_KEY, candidate);
  } catch (err) {
    console.warn("migrateSpotPricingSource failed:", err);
  }
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
    const brandName = typeof getBrandingName === "function" ? getBrandingName() : BRANDING_TITLE;
    const logoSplit = BRANDING_DOMAIN_OPTIONS.logoSplit[brandName];
    if (logoSplit) {
      document.querySelectorAll(".logo-silver").forEach((el) => {
        el.textContent = logoSplit[0];
      });
      document.querySelectorAll(".logo-gold").forEach((el) => {
        el.textContent = logoSplit[1];
      });
      // Adjust SVG viewBox for longer brand names
      if (logoSplit[2]) {
        const logoSvg = document.querySelector(".stackr-logo");
        if (logoSvg) logoSvg.setAttribute("viewBox", `0 0 ${logoSplit[2]} 80`);
      }
    }
    const appLogo = document.getElementById("appLogo");
    if (appLogo) appLogo.setAttribute("aria-label", brandName);
    const footerBrand = document.getElementById("footerBrand");
    if (footerBrand) footerBrand.textContent = brandName;
    // Update About modal site link to match current domain
    const siteDomain = typeof getFooterDomain === "function" ? getFooterDomain() : "staktrakr.com";
    const aboutSiteLink = document.getElementById("aboutSiteLink");
    const aboutSiteDomain = document.getElementById("aboutSiteDomain");
    if (aboutSiteLink) aboutSiteLink.href = `https://www.${siteDomain}`;
    if (aboutSiteDomain) aboutSiteDomain.textContent = siteDomain;

    // Phase 0b: Environment badge + toast for non-production origins (STAK-376)
    const envLabel = typeof getEnvironmentLabel === "function" ? getEnvironmentLabel() : null;
    if (envLabel) {
      const envBadge = document.getElementById("envBadge");
      if (envBadge) {
        envBadge.textContent = envLabel.label;
        envBadge.className = "env-badge " + envLabel.className;
        envBadge.style.display = "";
      }
      // One-time toast per session explaining data isolation
      const toastKey = "envToastShown"; // nosemgrep: codacy.javascript.security.hard-coded-password
      if (!sessionStorage.getItem(toastKey)) {
        sessionStorage.setItem(toastKey, "1");
        const msg =
          envLabel.label === "BETA"
            ? "You are on the BETA site. Your data here is separate from the main site."
            : envLabel.label === "PREVIEW"
              ? "Preview deployment — data is separate from the main site."
              : "Running locally — data is stored on this device only.";
        setTimeout(() => {
          if (typeof showToast === "function") showToast(msg, 5000);
        }, 1500);
      }
    }

    // Phase 1: Initialize Core DOM Elements
    debugLog("Phase 1: Initializing core DOM elements...");

    // Core form elements
    elements.inventoryForm = safeGetElement("inventoryForm", true);

    const inventoryTableEl = safeGetElement("inventoryTable", true);
    const tbody =
      inventoryTableEl && inventoryTableEl.querySelector
        ? inventoryTableEl.querySelector("tbody")
        : null;
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
    elements.itemPaymentMethod = safeGetElement("itemPaymentMethod");
    elements.purchaseLocation = safeGetElement("purchaseLocation", true);
    elements.storageLocation = safeGetElement("storageLocation");
    elements.itemNotes = safeGetElement("itemNotes");
    elements.itemCapsule = safeGetElement("itemCapsule");
    elements.itemCapsuleNotes = safeGetElement("itemCapsuleNotes");
    elements.capsuleSuggestion = safeGetElement("capsuleSuggestion");
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
    elements.retailSpotLookupBtn = safeGetElement("retailSpotLookupBtn");
    elements.itemPuritySelect = safeGetElement("itemPuritySelect");
    elements.itemPurity = safeGetElement("itemPurity");
    elements.purityCustomWrapper = safeGetElement("purityCustomWrapper");
    elements.searchNumistaNameBtn = safeGetElement("searchNumistaNameBtn");
    elements.cloneItemBtn = safeGetElement("cloneItemBtn");
    elements.viewItemFromEditBtn = safeGetElement("viewItemFromEditBtn");
    elements.cloneItemSaveAnotherBtn = safeGetElement("cloneItemSaveAnotherBtn");
    elements.clonePickerCount = safeGetElement("clonePickerCount");
    elements.itemDateNABtn = safeGetElement("itemDateNABtn");
    elements.numistaDataSection = safeGetElement("numistaDataSection");
    elements.tagsSection = safeGetElement("tagsSection");
    elements.newTagInput = safeGetElement("newTagInput");
    elements.addTagBtn = safeGetElement("addTagBtn");

    const numistaDiameterEl = safeGetElement("numistaDiameter");
    if (numistaDiameterEl && typeof safeAttachListener === "function") {
      safeAttachListener(
        numistaDiameterEl,
        "input",
        () => {
          if (typeof updateCapsuleSuggestion === "function") {
            updateCapsuleSuggestion(numistaDiameterEl.value);
          }
        },
        "Capsule suggestion diameter input"
      );
    }

    // Header buttons - CRITICAL
    debugLog("Phase 2: Initializing header buttons...");
    elements.appLogo = safeGetElement("appLogo");
    elements.settingsBtn = safeGetElement("settingsBtn", true);
    // elements.aboutBtn retired (STRK-289) — the button no longer exists.

    // STACK-54 header toggles
    elements.headerThemeBtn = safeGetElement("headerThemeBtn");
    // headerCurrencyBtn registration removed with the button (STRK-288)

    // STACK-54 layout sections
    elements.spotPricesSection = safeGetElement("spotPricesSection");
    elements.totalsSectionEl = safeGetElement("totalsSectionEl");
    elements.searchSectionEl = safeGetElement("searchSectionEl");
    elements.tableSectionEl = safeGetElement("tableSectionEl");

    // Check if critical buttons exist
    debugLog("Settings Button found:", !!document.getElementById("settingsBtn"));

    // Import/Export elements
    debugLog("Phase 3: Initializing import/export elements...");
    elements.importCsvFile = safeGetElement("importCsvFile");
    elements.importCsvOverride = safeGetElement("importCsvOverride");
    elements.importJsonFile = safeGetElement("importJsonFile");
    elements.importJsonOverride = safeGetElement("importJsonOverride");
    elements.importProgress = safeGetElement("importProgress");
    elements.importProgressText = safeGetElement("importProgressText");
    elements.numistaImportBtn = safeGetElement("numistaImportBtn");
    elements.numistaImportFile = safeGetElement("numistaImportFile");
    elements.numistaImportOptions = safeGetElement("numistaImportOptions");
    elements.exportCsvBtn = safeGetElement("exportCsvBtn");
    elements.exportJsonBtn = safeGetElement("exportJsonBtn");
    elements.exportPdfBtn = safeGetElement("exportPdfBtn");
    elements.printBtn = safeGetElement("printBtn");
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
    elements.vaultModal = safeGetElement("vaultModal");
    elements.apiQuotaModal = safeGetElement("apiQuotaModal");
    // Unified item modal elements (add/edit)
    elements.itemModal = safeGetElement("itemModal");
    elements.itemCloseBtn = safeGetElement("itemCloseBtn");
    elements.cancelItemBtn = safeGetElement("cancelItem");
    elements.itemModalTitle = safeGetElement("itemModalTitle");
    elements.itemModalSubmit = safeGetElement("itemModalSubmit");
    elements.itemSerial = safeGetElement("itemSerial");
    elements.undoChangeBtn = safeGetElement("undoChangeBtn");

    if (typeof setupWhatsNewPopupEvents === "function") {
      setupWhatsNewPopupEvents();
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
      const chipMinEl = document.getElementById("chipMinCount");
      const saved = localStorage.getItem("chipMinCount");
      if (!saved) {
        localStorage.setItem("chipMinCount", "3");
      }
      if (chipMinEl) {
        chipMinEl.value = localStorage.getItem("chipMinCount") || "3";
      }
    } catch (e) {
      // ignore storage errors
    }

    // Ensure chipMaxCount has a sensible default for new installs
    try {
      const chipMaxEl = document.getElementById("chipMaxCount");
      const savedMax = localStorage.getItem("chipMaxCount");
      if (!savedMax) {
        localStorage.setItem("chipMaxCount", "0");
      }
      if (chipMaxEl) {
        chipMaxEl.value = localStorage.getItem("chipMaxCount") || "0";
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

      elements.spotPriceDisplay[metalKey] = safeGetElement(`spotPriceDisplay${metalName}`);
      elements.spotSyncIcon[metalKey] = safeGetElement(`syncIcon${metalName}`);
      elements.spotRangeSelect[metalKey] = safeGetElement(`spotRange${metalName}`);
      elements.spotSparkline[metalKey] = safeGetElement(`sparkline${metalName}`);

      debugLog(
        `    - ${metalName} display element:`,
        !!document.getElementById(`spotPriceDisplay${metalName}`)
      );
      debugLog(
        `    - ${metalName} sparkline canvas:`,
        !!document.getElementById(`sparkline${metalName}`)
      );
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
    // STAK-500: Removed redundant loadAnnouncements() call — it's called by
    // showWhatsNewPopup() (which internally awaits loadAnnouncements()) and populateAboutTab() when those are needed

    // Phase 12: Data Initialization
    debugLog("Phase 12: Loading application data...");

    // Set default date
    if (elements.itemDate && elements.itemDate.value !== undefined) {
      elements.itemDate.value = todayStr();
    }

    // STRK-13: Snapshot boot state BEFORE loadInventory() runs. loadInventory
    // unconditionally writes inventorySerial (inventory.js:291), which would
    // trip classifyBootState's "damaged-key" branch on a first-run boot. Design.md
    // documented classify-after-load, but empirically that ordering breaks the
    // first-run path — see STRK-13 task 9 notes for the design follow-up.
    let bootState = null;
    if (typeof classifyBootState === "function") {
      bootState = classifyBootState();
    }

    // Load data
    await loadInventory();

    // Migrate: existing users keep header theme button visible
    if (inventory.length > 0 && localStorage.getItem("headerThemeBtnVisible") === null) {
      localStorage.setItem("headerThemeBtnVisible", "true");
    }

    // Load seed rule toggles before seed inventory (so migration sees real user data)
    if (
      typeof NumistaLookup !== "undefined" &&
      typeof NumistaLookup.loadEnabledSeedRules === "function"
    ) {
      NumistaLookup.loadEnabledSeedRules();
    }

    if (bootState) {
      if (bootState.classification === "first-run") {
        if (typeof loadSeedInventory === "function") {
          loadSeedInventory(bootState);
        }
      } else if (bootState.classification === "returning-with-data") {
        if (typeof migrateSentinelIfMissing === "function") {
          migrateSentinelIfMissing(bootState);
        }
      } else if (
        bootState.classification === "damaged-key" ||
        bootState.classification === "parse-error"
      ) {
        var cloudConnected = false;
        if (typeof syncIsEnabled === "function" && typeof cloudIsConnected === "function") {
          var providers =
            typeof CLOUD_PROVIDERS === "object"
              ? Object.keys(CLOUD_PROVIDERS)
              : ["dropbox", "pcloud", "box"];
          cloudConnected = !!(
            syncIsEnabled() &&
            providers.some(function (p) {
              return cloudIsConnected(p);
            })
          );
        }
        if (typeof showInventoryRecoveryBanner === "function") {
          showInventoryRecoveryBanner({ cloudConnected: cloudConnected });
        }
        if (typeof setInventoryRecoveryActive === "function") {
          setInventoryRecoveryActive(true);
        }
      }

      if (typeof recordBootDiagnostic === "function") {
        var diag = {
          classification: bootState.classification,
          keyPresence: bootState.keyPresence,
        };
        if (bootState.errorName) {
          diag.errorName = bootState.errorName;
        }
        recordBootDiagnostic(diag);
      }
    }
    if (typeof sanitizeTablesOnLoad === "function") {
      sanitizeTablesOnLoad();
    }
    inventory.forEach((i) => addCompositionOption(i.composition || i.metal));
    refreshCompositionOptions();

    // STRK-141: Initialize the market-history IndexedDB store and run the
    // one-time, idempotent localStorage→IndexedDB migration BEFORE hydrating
    // the spot/retail globals, so loadSpotHistory()/initRetailPrices() read
    // from the store (not the localStorage fallback). Both calls swallow their
    // own failures and return safely if IndexedDB is unavailable — the spot/
    // retail wrappers then transparently fall back to localStorage. This must
    // complete before the Phase 13 first render so history-dependent views
    // (spot table, sparklines, retail charts) render hydrated (R4), and the
    // migration runs exactly once, awaited (R2). Do NOT wrap in try/catch that
    // blocks boot — graceful degradation (R3) is handled inside the store.
    if (typeof historyStore !== "undefined") {
      await historyStore.init();
      await historyStore.migrate();
      debugLog("HistoryStore available:", historyStore.isAvailable());
    }

    // Hydrate spot history from the store (awaited, before render — R4)
    await loadSpotHistory();

    // Roll legacy hourly spot source into the loaded history. Previously called
    // at parse time in spot.js; moved here so it runs AFTER spot history loads
    // and the store is ready (STRK-141).
    if (typeof migrateHourlySource === "function") {
      await migrateHourlySource();
    }

    // Load per-item price history (STACK-43)
    if (typeof loadItemPriceHistory === "function") {
      loadItemPriceHistory();
    }

    // Load item tags (STAK-126)
    if (typeof loadItemTags === "function") {
      loadItemTags();
      debugLog(`Loaded tags for ${Object.keys(itemTags).length} items`);
    }

    // Load Goldback denomination pricing (STACK-45)
    if (typeof loadGoldbackPrices === "function") loadGoldbackPrices();
    if (typeof loadGoldbackPriceHistory === "function") loadGoldbackPriceHistory();
    if (typeof loadGoldbackEnabled === "function") loadGoldbackEnabled();
    if (typeof loadGoldbackEstimateEnabled === "function") loadGoldbackEstimateEnabled();
    if (typeof loadGoldbackEstimateModifier === "function") loadGoldbackEstimateModifier();
    if (
      typeof fetchGoldbackApiPrices === "function" &&
      typeof goldbackPricingSource !== "undefined" &&
      goldbackPricingSource === "api"
    ) {
      void fetchGoldbackApiPrices({ expectedSource: "api" }).catch((error) =>
        console.warn("Initial Goldback API fetch failed:", error)
      );
    }

    // Load retail market prices and start background auto-sync.
    // STRK-141: initRetailPrices() is async and awaits _loadV2RetailHistory()
    // internally, so awaiting it here hydrates retailPriceHistory from the
    // store before the Phase 13 render (R4). Single load path — no double-load.
    if (typeof initRetailPrices === "function") await initRetailPrices();
    if (typeof startRetailBackgroundSync === "function") startRetailBackgroundSync();

    // Load display currency preference and cached exchange rates (STACK-50)
    if (typeof loadDisplayCurrency === "function") loadDisplayCurrency();
    if (typeof loadExchangeRates === "function") loadExchangeRates();

    // Seed spot history for first-time users
    if (typeof loadSeedSpotHistory === "function") {
      await loadSeedSpotHistory();
    }

    // Derive spotPricingSource from legacy keys on first load after upgrade (STAK-443, REQ-9)
    await migrateSpotPricingSource();

    // Initialize API system
    if (typeof loadApiConfig !== "function" || typeof loadApiCache !== "function") {
      console.warn("[Init] API helpers unavailable; continuing with degraded API state");
    }
    apiConfig = typeof loadApiConfig === "function" ? loadApiConfig() : {};
    apiCache = typeof loadApiCache === "function" ? loadApiCache() : {};

    // Apply saved desktop card view setting (STAK-118)
    const _isCardOnInit = localStorage.getItem(DESKTOP_CARD_VIEW_KEY) === "true";
    if (_isCardOnInit) {
      document.body.classList.add("force-card-view");
    }

    // Load persisted items-per-page setting (view-aware defaults: card=3, table=24)
    try {
      const savedIpp = localStorage.getItem(ITEMS_PER_PAGE_KEY);
      if (savedIpp) {
        if (savedIpp === "all") {
          itemsPerPage = Infinity;
          if (elements.itemsPerPage) elements.itemsPerPage.value = "all";
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
        if (elements.itemsPerPage) elements.itemsPerPage.value = "all";
      }
    } catch (e) {
      /* ignore */
    }

    // Apply saved theme attribute early so CSS variables resolve correctly
    // before renderActiveFilters() computes contrast colors in Phase 13
    const earlyTheme = localStorage.getItem(THEME_KEY);
    if (VALID_THEMES.includes(earlyTheme)) {
      document.documentElement.setAttribute("data-theme", earlyTheme);
    }

    // Initialize IndexedDB image cache (COIN_IMAGES feature)
    if (typeof imageCache !== "undefined" && featureFlags.isEnabled("COIN_IMAGES")) {
      try {
        await imageCache.init();
        debugLog("ImageCache available:", imageCache.isAvailable());
      } catch (e) {
        console.warn("ImageCache init failed:", e);
      }
    }

    // Initialize IndexedDB attachment manager (STRK-45)
    if (typeof attachmentManager !== "undefined") {
      try {
        await attachmentManager.init();
        debugLog("AttachmentManager available:", attachmentManager.isAvailable());
      } catch (e) {
        console.warn("AttachmentManager init failed:", e);
      }
    }

    // CDN Backfill removed — URLs are written at save/bulk-sync time (STAK-309)
    debugLog("[Init] Skipping CDN backfill (removed in STAK-309 fix)");

    // Clean up stale localStorage keys from removed systems
    try {
      localStorage.removeItem("seedImagesVersion");
    } catch (_) {
      /* ignore */
    }

    // Wire view modal close button
    if (elements.viewModalCloseBtn) {
      elements.viewModalCloseBtn.addEventListener("click", () => {
        if (typeof closeViewModal === "function") closeViewModal();
      });
    }
    // Background click dismiss for view modal
    if (elements.viewItemModal) {
      elements.viewItemModal.addEventListener("click", (e) => {
        if (e.target === elements.viewItemModal && typeof closeViewModal === "function")
          closeViewModal();
      });
    }

    // Apply header toggle & layout visibility from saved prefs (STACK-54)
    if (typeof applyHeaderToggleVisibility === "function") applyHeaderToggleVisibility();
    if (typeof updateSpotSyncHealthDot === "function") updateSpotSyncHealthDot();
    if (typeof updateMarketHealthDot === "function") updateMarketHealthDot();
    if (typeof applyLayoutOrder === "function") applyLayoutOrder();
    if (typeof applyMetalOrder === "function") applyMetalOrder();

    // Phase 13: Initial Rendering
    debugLog("Phase 13: Rendering initial display...");
    renderTable();
    if (typeof renderActiveFilters === "function") {
      renderActiveFilters();
    }
    fetchSpotPrice();
    if (typeof updateAllSparklines === "function") {
      updateAllSparklines();
    }
    if (typeof updateSyncButtonStates === "function") {
      updateSyncButtonStates();
    }
    if (typeof updateStorageStats === "function") {
      updateStorageStats();
    }

    // STAK-149: Initialize cloud auto-sync (starts poller if previously enabled)
    if (typeof initCloudSync === "function") {
      initCloudSync();
    }

    // Load Numista search lookup custom rules
    if (
      typeof NumistaLookup !== "undefined" &&
      typeof NumistaLookup.loadCustomRules === "function"
    ) {
      NumistaLookup.loadCustomRules();
    }

    // Load seed custom pattern rules + images for first-time users
    // Must run after loadCustomRules() so addRule() doesn't clobber existing rules
    if (typeof loadSeedImages === "function") {
      await loadSeedImages();
    }

    // STACK-62: Initialize autocomplete/fuzzy search system
    if (typeof initializeAutocomplete === "function") {
      initializeAutocomplete(inventory);
    }

    // Automatically sync prices if cache is stale and API keys are available
    if (typeof autoSyncSpotPrices === "function") {
      autoSyncSpotPrices();
    }

    // STAK-222: Start background spot price polling
    if (typeof startSpotBackgroundSync === "function") {
      startSpotBackgroundSync();
    }

    // Fetch fresh exchange rates in the background (STACK-50)
    if (typeof fetchExchangeRates === "function") {
      fetchExchangeRates()
        .then((updated) => {
          if (updated && displayCurrency !== "USD") {
            // Re-render with fresh rates
            if (typeof renderTable === "function") renderTable();
            if (typeof updateSummary === "function") updateSummary();
          }
        })
        .catch(() => {});
    }

    // Market Data Module (STAK-504)
    if (typeof initMarketData === "function") {
      initMarketData().catch(function (e) {
        if (typeof debugLog === "function")
          debugLog("[market-data] Init failed: " + e.message, "warn");
      });
    }

    // Refresh market data on theme change (STAK-504)
    const _themeObserver = new MutationObserver(function () {
      if (typeof refreshMarketData === "function") refreshMarketData();
    });
    _themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    // Phase 14: Event Listeners Setup (Delayed)
    debugLog("Phase 14: Setting up event listeners...");

    // Use a small delay to ensure all DOM manipulation is complete
    setTimeout(() => {
      try {
        setupEventListeners();
        setupPagination();
        setupBulkEditControls();
        setupThemeToggle();
        if (typeof setupSettingsEventListeners === "function") {
          setupSettingsEventListeners();
        }
        setupColumnResizing();

        // Purity select ↔ custom input toggle
        if (elements.itemPuritySelect) {
          elements.itemPuritySelect.addEventListener("change", () => {
            const wrapper =
              elements.purityCustomWrapper || document.getElementById("purityCustomWrapper");
            const input = elements.itemPurity || document.getElementById("itemPurity");
            const isCustom = elements.itemPuritySelect.value === "custom";
            if (wrapper) wrapper.style.display = isCustom ? "" : "none";
            if (input && !isCustom) input.value = "";
          });
        }

        // Weight unit ↔ denomination picker toggle (STACK-45)
        if (elements.itemWeightUnit) {
          elements.itemWeightUnit.addEventListener("change", () => {
            if (typeof toggleGbDenomPicker === "function") toggleGbDenomPicker();
          });
        }
        if (elements.itemGbDenom) {
          elements.itemGbDenom.addEventListener("change", () => {
            if (elements.itemWeight) {
              elements.itemWeight.value = elements.itemGbDenom.value;
            }
          });
        }

        // Setup Edit header toggle functionality
        const editHeader = document.querySelector('th[data-column="actions"]');
        if (editHeader) {
          editHeader.addEventListener("click", (event) => {
            if (event.shiftKey) {
              // Shift + Click = Toggle all items edit mode
              if (typeof toggleAllItemsEdit === "function") {
                toggleAllItemsEdit();
              }
            } else {
              // Regular Click = Toggle edit mode (quick/modal)
              if (typeof toggleEditMode === "function") {
                toggleEditMode();
              }
            }
          });
          editHeader.title = "Click to toggle edit mode • Shift+Click to toggle all items edit";
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

      // STRK-294: readiness signal for anything that needs to interact with a
      // header control. Every listener above is attached inside this 200ms
      // timer, so page-load signals (an element being visible, a global being
      // defined) all go true well BEFORE the header is actually clickable —
      // clicking #settingsBtn earlier silently does nothing, which reads as a
      // broken button rather than a race.
      //
      // Set AFTER the try/catch and after setupSearch() deliberately: it must
      // mean "listener setup is finished", true whether the primary path or the
      // setupBasicEventListeners() fallback ran. It is a flag rather than an
      // event so a late observer can still poll it — an event fired at this
      // moment would be missed by anyone who started listening afterwards.
      // Dispatched on `window`, not `document`, to match the only other
      // app-level custom event in the codebase (`currencychange`, fired in
      // js/utils-format.js and consumed via window.addEventListener in
      // inventory-table / market-data / retail). CustomEvent defaults to
      // bubbles:false, so a document-dispatched event would never reach a
      // window listener — the inconsistency would have been silent.
      window.appListenersReady = true;
      window.dispatchEvent(new CustomEvent("app:listeners-ready"));
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
    if (typeof initApiHealth === "function") initApiHealth();

    // Phase 16: Storage optimization pass
    if (typeof optimizeStoragePhase1C === "function") {
      optimizeStoragePhase1C();
    }

    // Phase 17: Hash deep-link handling (runs after event listeners are wired).
    // Supports privacy.html redirect shim and any direct #privacy / #faq links.
    //
    // STRK-294: keyed off the listener-readiness signal instead of its own
    // setTimeout(..., 250). That timer was a SECOND guess at the same Phase 14
    // 200ms timer, with only 50ms of headroom — thinner than the 100ms the test
    // helpers used, and wrong in the same way. Waiting on the signal makes
    // "runs after event listeners are wired" a guarantee rather than an
    // assumption.
    const handleBootHash = () => {
      // nosemgrep: javascript.lang.security.detect-eval-with-expression.detect-eval-with-expression
      const hash = window.location.hash;
      if (hash === "#privacy") {
        window.location.hash = "";
        if (window.openModalById) openModalById("privacyModal");
      } else if (hash === "#faq") {
        window.location.hash = "";
        if (typeof showSettingsModal === "function") showSettingsModal("faq");
      }
    };
    // Both orders handled: Phase 17 registers synchronously so the flag is
    // normally still false here, but checking it first means a future reorder
    // cannot leave the deep link waiting for an event that already fired.
    if (window.appListenersReady) {
      handleBootHash();
    } else {
      window.addEventListener("app:listeners-ready", handleBootHash, { once: true });
    }

    // Clear stale-cache recovery flags on successful init (STAK-485, STRK-56)
    sessionStorage.removeItem("sw-recovery-attempted");
    sessionStorage.removeItem("sw-recovery-nuked");
  } catch (error) {
    console.error("=== CRITICAL INITIALIZATION ERROR ===");
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);

    // Flag init failure for cloud sync guard (STAK-485)
    window._initFailed = true;

    const isKnownAssetReferenceError =
      error instanceof ReferenceError &&
      /\b(loadApiConfig|loadApiCache)\b/.test(error.message || "");

    const nukeStakTrakrCachesAndReload = async () => {
      const [registrations, cacheKeys] = await Promise.all([
        "serviceWorker" in navigator
          ? navigator.serviceWorker.getRegistrations()
          : Promise.resolve([]),
        typeof caches !== "undefined" ? caches.keys() : Promise.resolve([]),
      ]);
      const cleanupResults = await Promise.allSettled([
        ...registrations.map((registration) => registration.unregister()),
        ...cacheKeys
          .filter((cacheKey) => cacheKey.startsWith("staktrakr-"))
          .map((cacheKey) => caches.delete(cacheKey)),
      ]);
      cleanupResults
        .filter((result) => result.status === "rejected")
        .forEach((result) =>
          console.warn("[Init] Service worker cache reset step failed:", result.reason)
        );
      window.location.reload();
    };

    const showInitializationErrorDialog = (dialogError = error) => {
      const message = `Application initialization failed: ${dialogError.message || dialogError}\n\nPlease refresh the page and try again. If the problem persists, use Reset App to clear cached application files.`;
      if (typeof appActionDialog !== "function") {
        window.alert(message);
        return;
      }
      appActionDialog({
        title: "Application Error",
        message,
        primaryLabel: "Reset App",
        primaryAction: nukeStakTrakrCachesAndReload,
        secondaryLabel: "OK",
      }).catch((dialogFailure) => {
        console.error("[Init] Error dialog failed:", dialogFailure);
        window.alert(message);
      });
    };

    // Detect stale SW cache: known asset globals failed to load after an update
    const isStaleCache =
      isKnownAssetReferenceError &&
      "serviceWorker" in navigator &&
      !sessionStorage.getItem("sw-recovery-attempted");

    if (isStaleCache) {
      document._swReloading = true;
      sessionStorage.setItem("sw-recovery-attempted", "1");
      console.warn("[Init] Stale cache detected — reloading for new version");
      document.body.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#ccc;background:#0f172a"><p>Updating to new version\u2026</p></div>';
      setTimeout(() => window.location.reload(), 800);
      return;
    }

    const needsNukeRecovery =
      isKnownAssetReferenceError &&
      "serviceWorker" in navigator &&
      sessionStorage.getItem("sw-recovery-attempted") === "1" &&
      sessionStorage.getItem("sw-recovery-nuked") !== "1";

    if (needsNukeRecovery) {
      document._swReloading = true;
      sessionStorage.setItem("sw-recovery-nuked", "1");
      console.warn("[Init] Persistent stale cache detected — clearing service worker caches");
      document.body.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#ccc;background:#0f172a"><p>Resetting cached app files\u2026</p></div>';
      nukeStakTrakrCachesAndReload().catch((recoveryError) => {
        console.error("[Init] Service worker cache reset failed:", recoveryError);
        setTimeout(() => showInitializationErrorDialog(recoveryError), 100);
      });
      return;
    }

    // Catch-all error dialog after automatic recovery tiers are unavailable or exhausted
    setTimeout(() => {
      try {
        showInitializationErrorDialog();
      } catch (dialogFailure) {
        console.error("[Init] Error dialog scheduling failed:", dialogFailure);
        window.alert(`Application initialization failed: ${error.message || error}`);
      }
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
window.showViewModal = typeof showViewModal !== "undefined" ? showViewModal : () => {};
window.closeViewModal = typeof closeViewModal !== "undefined" ? closeViewModal : () => {};
window.editItem = editItem;
window.deleteItem = deleteItem;
window.showNotes = showNotes;
window.applyColumnFilter = applyColumnFilter;

// Register service worker for PWA support (HTTP/HTTPS only, skip file://)
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

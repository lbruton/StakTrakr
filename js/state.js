// APPLICATION STATE
// =============================================================================

/** @type {Object} Sorting state tracking — initialized from user preference or factory default */
const _storedSortCol = localStorage.getItem("defaultSortColumn");
let sortColumn = _storedSortCol !== null ? parseInt(_storedSortCol, 10) : 4;
const _storedSortDir = localStorage.getItem("defaultSortDir");
let sortDirection = _storedSortDir || "asc";

/** @type {number|null} Index of item being edited (null = no edit in progress) */
let editingIndex = null;
/** @type {number|null} Index of item whose notes are being edited */
let notesIndex = null;
/** @type {number|null} Change log entry currently being edited */
let editingChangeLogIndex = null;

/** @type {number} Number of visible rows in the portal (scrollable table) view */
let itemsPerPage = Infinity;

/** @type {string} Current search query */
let searchQuery = "";

/** @type {Object} Chart instances for proper cleanup */
let chartInstances = {
  typeChart: null,
  locationChart: null,
};

/** @type {Object} Sparkline Chart.js instances keyed by metal (for cleanup) */
let sparklineInstances = {
  silver: null,
  gold: null,
  platinum: null,
  palladium: null,
};

/** @type {Set<string>} Available composition options */
let compositionOptions = new Set(["Gold", "Silver", "Platinum", "Palladium", "Alloy"]);

/** @type {Set<number>} Items currently showing market value instead of purchase price */
let marketValueViewItems = new Set();

/** @type {Object} Cached DOM elements for performance */
const elements = {
  // Spot price elements
  spotPriceDisplay: {},
  spotSyncIcon: {},
  spotRangeSelect: {},
  spotSparkline: {},

  // Form elements
  inventoryForm: null,
  inventoryTable: null,
  itemMetal: null,
  itemName: null,
  itemQty: null,
  itemType: null,
  itemWeight: null,
  itemWeightUnit: null,
  itemGbDenom: null,
  itemPrice: null,
  itemMarketValue: null,
  marketValueField: null,
  dateField: null,
  itemPaymentMethod: null,
  purchaseLocation: null,
  storageLocation: null,
  itemSerialNumber: null,
  itemNotes: null,
  itemCapsule: null,
  itemCapsuleNotes: null,
  capsuleSuggestion: null,
  itemDate: null,
  itemSpotPrice: null,
  itemCatalog: null,
  itemYear: null,
  itemGrade: null,
  itemGradingAuthority: null,
  itemCertNumber: null,
  itemObverseImageUrl: null,
  itemReverseImageUrl: null,
  searchNumistaBtn: null,
  lookupPcgsBtn: null,
  spotLookupBtn: null,
  retailSpotLookupBtn: null,
  itemPuritySelect: null,
  itemPurity: null,
  purityCustomWrapper: null,

  // Spot price sync icons (per-metal)
  syncIconSilver: null,
  syncIconGold: null,
  syncIconPlatinum: null,
  syncIconPalladium: null,

  // Import elements
  importCsvFile: null,
  importCsvOverride: null,
  importJsonFile: null,
  importJsonOverride: null,
  importProgress: null,
  importProgressText: null,
  numistaImportFile: null,

  // Export elements
  exportCsvBtn: null,
  exportJsonBtn: null,
  exportPdfBtn: null,
  printBtn: null,
  cloudSyncBtn: null,
  syncAllBtn: null,
  // Vault encrypted backup elements
  vaultExportBtn: null,
  vaultImportBtn: null,
  vaultImportFile: null,
  vaultModal: null,
  // Emergency reset button
  removeInventoryDataBtn: null,
  boatingAccidentBtn: null,
  forceRefreshBtn: null,

  // Notes modal elements
  notesModal: null,
  notesTextarea: null,
  saveNotesBtn: null,
  cancelNotesBtn: null,
  notesCloseBtn: null,

  // Debug modal elements
  debugModal: null,
  debugCloseBtn: null,

  // Details modal elements
  detailsModal: null,
  detailsModalTitle: null,
  typeBreakdown: null,
  locationBreakdown: null,
  detailsCloseBtn: null,
  totalTitles: null,

  // Chart canvas elements
  typeChart: null,
  locationChart: null,

  // Portal view elements
  itemsPerPage: null,
  itemCount: null,

  // Change log elements
  changeLogBtn: null,
  backupReminder: null,
  changeLogModal: null,
  changeLogCloseBtn: null,
  changeLogClearBtn: null,
  changeLogTable: null,
  storageUsage: null,
  storageReportLink: null,

  // Search elements
  searchInput: null,
  typeFilter: null,
  metalFilter: null,
  clearBtn: null,
  newItemBtn: null,
  searchResultsInfo: null,
  activeFilters: null,

  // Unified item modal elements (add/edit)
  itemModal: null,
  itemCloseBtn: null,
  cancelItemBtn: null,
  itemModalTitle: null,
  itemModalSubmit: null,
  itemSerial: null,
  undoChangeBtn: null,

  // Clone mode elements (STAK-375)
  cloneItemSaveAnotherBtn: null,
  clonePickerCount: null,

  // Date N/A toggle button (STAK-375)
  itemDateNABtn: null,

  // About modal elements (aboutBtn retired — STRK-289)
  aboutModal: null,

  // Header toggle buttons (STACK-54)
  headerThemeBtn: null,

  // Layout section containers (STACK-54)
  spotPricesSection: null,
  totalsSectionEl: null,
  searchSectionEl: null,
  tableSectionEl: null,

  // View item modal elements
  viewItemModal: null,
  viewModalCloseBtn: null,

  // Settings modal elements
  settingsBtn: null,
  settingsModal: null,

  // Sub-modals (stacking overlays opened from within Settings)
  apiInfoModal: null,
  apiHistoryModal: null,
  goldbackHistoryModal: null,
  cloudSyncModal: null,
  apiQuotaModal: null,

  // Spot price action buttons
  spotSyncBtn: null,
  spotAddBtn: null,
  spotResetBtn: null,

  // Totals display elements (organized by metal type)
  totals: {
    silver: {
      items: null, // Total item count
      weight: null, // Total weight in ounces
      value: null, // Current market value
      purchased: null, // Total purchase price
      avgPrice: null, // Average price per ounce
      avgPremium: null, // Average premium per ounce
      premium: null, // Total premium paid
      lossProfit: null, // Total loss/profit
    },
    gold: {
      // Same structure as silver
      items: null,
      weight: null,
      value: null,
      purchased: null,
      avgPrice: null,
      avgPremium: null,
      premium: null, // Total premium paid
      lossProfit: null, // Total loss/profit
    },
    platinum: {
      items: null,
      weight: null,
      value: null,
      purchased: null,
      avgPrice: null,
      avgPremium: null,
      premium: null, // Total premium paid
      lossProfit: null, // Total loss/profit
    },
    palladium: {
      items: null,
      weight: null,
      value: null,
      purchased: null,
      avgPrice: null,
      avgPremium: null,
      premium: null, // Total premium paid
      lossProfit: null, // Total loss/profit
    },
    all: {
      // Combined totals for all metals
      items: null,
      weight: null,
      value: null,
      purchased: null,
      avgPrice: null,
      avgPremium: null,
      premium: null, // Total premium paid
      lossProfit: null, // Total loss/profit
    },
  },
};

/** @type {Array} Change log entries */
let changeLog = (function () {
  try {
    var _raw = localStorage.getItem("changeLog");
    if (!_raw) return [];
    // Decompress before parsing: saveDataSync may prefix payloads ≥ 4 KB.
    // CMP2: = real lz-string. The LOCAL vendored LZString loads before state.js via defer
    // order; if that local file fails to load, the CDN fallback (DOMContentLoaded) is too
    // late for this boot-time read, so CMP2 values are treated as unreadable and we fall
    // back to [] safely (no overwrite — guarded by __wouldClobberCompressed in utils.js).
    // CMP1: = legacy identity-stub (uncompressed body, slice only). (STRK-140)
    if (_raw.startsWith("CMP2:")) {
      // engine unavailable → cannot read; fall through to the safe [] default rather than
      // parsing the still-compressed body (which would throw or yield a non-array).
      _raw =
        typeof LZString !== "undefined" && LZString.decompressFromUTF16
          ? LZString.decompressFromUTF16(_raw.slice(5))
          : null;
    } else if (_raw.startsWith("CMP1:")) {
      _raw = _raw.slice(5);
    }
    // Validate before parsing: decompressFromUTF16 returns null on malformed/truncated
    // input, and JSON.parse(null) yields null (a non-array). Always return an array. (STRK-140)
    if (typeof _raw !== "string" || _raw === "") return [];
    const parsed = JSON.parse(_raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("[state] changeLog parse failed — resetting to []. Error:", e);
    return [];
  }
})();
Object.defineProperty(window, "changeLog", {
  get: () => changeLog,
  set: (val) => {
    changeLog = val;
  },
  configurable: true,
});

/** @type {Array} Main inventory data structure */
let inventory = [];
// STAK-301: expose via getter so other scripts can safely access window.inventory
// without hitting the TDZ on Chrome when empty inventory triggers a faster load path
Object.defineProperty(window, "inventory", {
  get: () => inventory,
  set: (val) => {
    inventory = val;
  },
  configurable: true,
});

/** @type {Object} Current spot prices for all metals */
let spotPrices = {
  silver: 0,
  gold: 0,
  platinum: 0,
  palladium: 0,
};

/** @type {Array} Historical spot price records */
let spotHistory = [];

/** @type {Object} Per-item price history keyed by UUID (STACK-43) */
let itemPriceHistory = {};

/** @type {Object} Goldback denomination prices keyed by weight string (STACK-45) */
let goldbackPrices = {};

/** @type {Object} Goldback price history keyed by weight string (STACK-45) */
let goldbackPriceHistory = {};

/** @type {boolean} Whether Goldback denomination pricing is enabled (STACK-45) */
let goldbackEnabled = false;

/** @type {boolean} Whether Goldback real-time price estimation is enabled (STACK-52) */
let goldbackEstimateEnabled = false;

/** @type {number} User-configurable premium modifier for Goldback estimation (STACK-52) */
let goldbackEstimateModifier = GB_ESTIMATE_PREMIUM;

/** @type {string} User's selected display currency (ISO 4217), default USD (STACK-50) */
let displayCurrency = DEFAULT_CURRENCY;

/** @type {Object<string, number>} Cached exchange rates: 1 USD = rate × target currency (STACK-50) */
let exchangeRates = {};

/** @type {Object} Item tags mapping: { [uuid]: string[] } (STAK-126) */
let itemTags = {};

/** @type {Array} Catalog API call history records */
let catalogHistory = [];

/** @type {Object|null} Current Metals API configuration */
let apiConfig = null;

/** @type {Object|null} Cached API data with timestamp */
let apiCache = null;

/** @type {Object} Backward compatibility for catalogMap - now managed by catalogManager */
let catalogMap = new Proxy(
  {},
  {
    get(target, prop) {
      if (window.catalogManager) {
        return catalogManager.getCatalogId(prop) || "";
      }
      return target[prop];
    },
    set(target, prop, value) {
      if (window.catalogManager) {
        catalogManager.setCatalogId(prop, value);
      }
      target[prop] = value;
      return true;
    },
    deleteProperty(target, prop) {
      if (window.catalogManager) {
        catalogManager.setCatalogId(prop, "");
      }
      delete target[prop];
      return true;
    },
  }
);

// =============================================================================

// CATALOG API SYSTEM
// =============================================================================
// Provider-agnostic catalog API architecture for StakTrakr
// Provider-agnostic architecture for catalog lookups
//
// The Numista results-modal UI (search results, field picker, usage bars, and
// their DOMContentLoaded wiring) lives in js/catalog-numista-modal.js
// (STRK-178 split — loads after this file in index.html).

/**
 * Catalog API Configuration with base64-encoded key storage
 * Matches the metals API key pattern in js/api.js
 */
class CatalogConfig {
  constructor() {
    this.storageKey = "catalog_api_config";
    this.load();
  }

  load() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Decode base64 keys on load
        if (parsed.numista && parsed.numista.apiKey) {
          try {
            parsed.numista.apiKey = atob(parsed.numista.apiKey);
          } catch (e) {
            // Key wasn't base64 encoded (legacy or plain text) — keep as-is
          }
        }
        if (parsed.pcgs) {
          if (!parsed.pcgs.bearerToken && parsed.pcgs.apiKey) {
            parsed.pcgs.bearerToken = parsed.pcgs.apiKey;
            delete parsed.pcgs.apiKey;
          }
          if (parsed.pcgs.bearerToken) {
            try {
              parsed.pcgs.bearerToken = atob(parsed.pcgs.bearerToken);
            } catch (e) {
              // Token wasn't base64 encoded (legacy or plain text) — keep as-is
            }
          }
        }
        this.config = parsed;
      } else {
        this.config = this.getDefaultConfig();
      }
    } catch (error) {
      console.warn("Failed to load catalog config:", error);
      this.config = this.getDefaultConfig();
    }
  }

  getDefaultConfig() {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const today = now.toISOString().slice(0, 10);
    return {
      numista: {
        apiKey: "",
        quota: 2000,
      },
      numistaUsage: {
        used: 0,
        month: month,
      },
      pcgs: {
        bearerToken: "",
      },
      pcgsUsage: {
        used: 0,
        date: today,
      },
      local: {
        enabled: true,
      },
    };
  }

  save() {
    try {
      // Encode keys as base64 before writing to localStorage
      const toStore = JSON.parse(JSON.stringify(this.config));
      if (toStore.numista && toStore.numista.apiKey) {
        toStore.numista.apiKey = btoa(toStore.numista.apiKey);
      }
      if (toStore.pcgs && toStore.pcgs.bearerToken) {
        toStore.pcgs.bearerToken = btoa(toStore.pcgs.bearerToken);
      }
      localStorage.setItem(this.storageKey, JSON.stringify(toStore));
    } catch (error) {
      console.error("Failed to save catalog config:", error);
    }
  }

  /**
   * Set Numista API key
   * @param {string} apiKey - Plain text API key
   * @param {number} quota - API quota (default 2000)
   */
  setNumistaConfig(apiKey, quota = 2000) {
    this.config.numista = {
      apiKey: apiKey || "",
      quota,
    };
    this.save();
    return true;
  }

  /**
   * Get current Numista configuration
   */
  getNumistaConfig() {
    return {
      ...this.config.numista,
      apiKey: this.config.numista.apiKey || "",
    };
  }

  /**
   * Check if Numista is configured with a valid key
   */
  isNumistaEnabled() {
    return !!this.config.numista.apiKey;
  }

  /**
   * Clear stored Numista key
   */
  clearNumistaKey() {
    this.config.numista = {
      apiKey: "",
      quota: 2000,
    };
    this.save();
  }

  /**
   * Check if user has stored a key
   */
  hasNumistaKey() {
    return !!this.config.numista.apiKey;
  }

  /**
   * Increment Numista usage counter, auto-resetting if month changed
   */
  incrementNumistaUsage() {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (!this.config.numistaUsage) {
      this.config.numistaUsage = { used: 0, month: currentMonth };
    }
    if (this.config.numistaUsage.month !== currentMonth) {
      this.config.numistaUsage.used = 0;
      this.config.numistaUsage.month = currentMonth;
    }
    this.config.numistaUsage.used++;
    this.save();
  }

  /**
   * Get current Numista usage stats
   * @returns {{ used: number, quota: number, month: string }}
   */
  getNumistaUsage() {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (!this.config.numistaUsage) {
      this.config.numistaUsage = { used: 0, month: currentMonth };
    }
    if (this.config.numistaUsage.month !== currentMonth) {
      this.config.numistaUsage.used = 0;
      this.config.numistaUsage.month = currentMonth;
    }
    return {
      used: this.config.numistaUsage.used,
      quota: this.config.numista?.quota || 2000,
      month: this.config.numistaUsage.month,
    };
  }

  // ─── PCGS Methods ───────────────────────────────────────────────────────

  /**
   * Set PCGS bearer token
   * @param {string} token - Bearer token from PCGS
   */
  setPcgsConfig(token) {
    if (!this.config.pcgs) this.config.pcgs = {};
    this.config.pcgs.bearerToken = token || "";
    this.save();
    return true;
  }

  /**
   * Get current PCGS configuration
   * @returns {{ bearerToken: string }}
   */
  getPcgsConfig() {
    if (!this.config.pcgs) this.config.pcgs = { bearerToken: "" };
    return { bearerToken: this.config.pcgs.bearerToken || "" };
  }

  /**
   * Check if PCGS is configured with a valid token
   * @returns {boolean}
   */
  isPcgsEnabled() {
    return !!(this.config.pcgs && this.config.pcgs.bearerToken);
  }

  /**
   * Clear stored PCGS token
   */
  clearPcgsToken() {
    this.config.pcgs = { bearerToken: "" };
    this.save();
  }

  /**
   * Increment PCGS usage counter, auto-resetting if date changed (daily limit)
   */
  incrementPcgsUsage() {
    const today = new Date().toISOString().slice(0, 10);
    if (!this.config.pcgsUsage) {
      this.config.pcgsUsage = { used: 0, date: today };
    }
    if (this.config.pcgsUsage.date !== today) {
      this.config.pcgsUsage.used = 0;
      this.config.pcgsUsage.date = today;
    }
    this.config.pcgsUsage.used++;
    this.save();
  }

  /**
   * Check if a PCGS API request can be made (under daily rate limit)
   * @returns {boolean}
   */
  canMakePcgsRequest() {
    const today = new Date().toISOString().slice(0, 10);
    if (!this.config.pcgsUsage || this.config.pcgsUsage.date !== today) {
      return true; // New day, counter resets
    }
    return this.config.pcgsUsage.used < 1000;
  }

  /**
   * Get current PCGS usage stats
   * @returns {{ used: number, limit: number, date: string }}
   */
  getPcgsUsage() {
    const today = new Date().toISOString().slice(0, 10);
    if (!this.config.pcgsUsage) {
      this.config.pcgsUsage = { used: 0, date: today };
    }
    if (this.config.pcgsUsage.date !== today) {
      this.config.pcgsUsage.used = 0;
      this.config.pcgsUsage.date = today;
    }
    return {
      used: this.config.pcgsUsage.used,
      limit: 1000,
      date: this.config.pcgsUsage.date,
    };
  }

  async testPcgsKey() {
    const PCGS_TEST_COIN_NUMBER = "38472177";
    const token = this.config.pcgs && this.config.pcgs.bearerToken;
    if (!token) return { success: false, message: "No PCGS token configured" };
    try {
      const resp = await fetch(
        `https://api.pcgs.com/publicapi/coindetail/GetCoinFactsByPCGSNo/${PCGS_TEST_COIN_NUMBER}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (resp.ok) return { success: true, message: "PCGS API connected" };
      if (resp.status === 401)
        return { success: false, message: "Invalid or expired bearer token" };
      if (resp.status === 404) return { success: true, message: "PCGS API connected" };
      return {
        success: false,
        message: `PCGS API error (HTTP ${resp.status})`,
      };
    } catch (err) {
      return { success: false, message: "PCGS API unreachable" };
    }
  }
}

// Global catalog configuration instance
const catalogConfig = new CatalogConfig();

console.log("🔌 Catalog API system ready - configure API keys through settings");

// ---------------------------------------------------------------------------
// Numista Response Cache (STAK-222)
// ---------------------------------------------------------------------------

const NUMISTA_CACHE_TTL_DAYS = 30;

/**
 * Loads a cached Numista API response for a given type ID.
 * Returns null if not cached or entry is older than NUMISTA_CACHE_TTL_DAYS.
 * @param {string} typeId - Numista type ID string
 * @returns {Object|null} Cached response data or null
 */
const loadNumistaCache = (typeId) => {
  try {
    const cache = loadDataSync(NUMISTA_RESPONSE_CACHE_KEY, {});
    const entry = cache[typeId];
    if (!entry) return null;
    const ageMs = Date.now() - new Date(entry.fetchedAt).getTime();
    if (ageMs > entry.ttlDays * 24 * 60 * 60 * 1000) return null;
    return entry.data;
  } catch (e) {
    debugLog("[numista-cache] Load error: " + e.message, "warn");
    return null;
  }
};

/**
 * Saves a Numista API response to the 30-day response cache.
 * @param {string} typeId - Numista type ID string
 * @param {Object} data - Raw API response to cache
 */
const saveNumistaCache = (typeId, data) => {
  try {
    const cache = loadDataSync(NUMISTA_RESPONSE_CACHE_KEY, {});
    cache[typeId] = { data, fetchedAt: new Date().toISOString(), ttlDays: NUMISTA_CACHE_TTL_DAYS };
    saveDataSync(NUMISTA_RESPONSE_CACHE_KEY, cache);
  } catch (e) {
    debugLog("[numista-cache] Save error: " + e.message, "warn");
  }
};

/**
 * Clears the entire Numista response cache.
 * @returns {number} Count of entries cleared
 */
const clearNumistaCache = () => {
  try {
    const cache = loadDataSync(NUMISTA_RESPONSE_CACHE_KEY, {});
    const count = Object.keys(cache).length;
    saveDataSync(NUMISTA_RESPONSE_CACHE_KEY, {});
    return count;
  } catch (e) {
    debugLog("[numista-cache] Clear error: " + e.message, "warn");
    return 0;
  }
};

/**
 * Returns count of valid (non-expired) entries in the Numista cache.
 * @returns {number}
 */
const getNumistaCacheCount = () => {
  try {
    const cache = loadDataSync(NUMISTA_RESPONSE_CACHE_KEY, {});
    const now = Date.now();
    return Object.values(cache).filter((entry) => {
      const ageMs = now - new Date(entry.fetchedAt).getTime();
      return ageMs <= entry.ttlDays * 24 * 60 * 60 * 1000;
    }).length;
  } catch (e) {
    return 0;
  }
};

/**
 * Base interface for all catalog providers
 * Ensures consistent API regardless of provider
 */
class CatalogProvider {
  constructor(config = {}) {
    this.name = config.name || "Unknown";
    this.apiKey = config.apiKey || "";
    this.baseUrl = config.baseUrl || "";
    this.rateLimit = config.rateLimit || 60; // requests per minute
    this.timeout = config.timeout || 10000; // 10 seconds
    this.lastRequest = 0;
    this.requestCount = 0;
    this.requestWindow = 60000; // 1 minute window
  }

  /**
   * Check if we can make a request (rate limiting)
   * @returns {boolean} True if request is allowed
   */
  canMakeRequest() {
    const now = Date.now();
    if (now - this.lastRequest > this.requestWindow) {
      this.requestCount = 0;
      this.lastRequest = now;
    }
    return this.requestCount < this.rateLimit;
  }

  /**
   * Make rate-limited HTTP request
   * @param {string} url - Request URL
   * @param {Object} options - Fetch options
   * @returns {Promise} Fetch response
   */
  async request(url, options = {}) {
    if (!this.canMakeRequest()) {
      throw new Error(`Rate limit exceeded for ${this.name}. Try again later.`);
    }

    this.requestCount++;

    // Persist Numista usage across page reloads
    if (this instanceof NumistaProvider) {
      catalogConfig.incrementNumistaUsage();
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        throw new Error(`Request timeout for ${this.name}`);
      }
      throw error;
    }
  }

  /**
   * Lookup item by catalog ID - MUST be implemented by providers
   * @param {string} catalogId - Catalog identifier
   * @returns {Promise<Object>} Standardized item data
   */
  async lookupItem(catalogId) {
    throw new Error("lookupItem must be implemented by provider");
  }

  /**
   * Search for items by query - MUST be implemented by providers
   * @param {string} query - Search term
   * @param {Object} filters - Search filters
   * @returns {Promise<Array>} Array of standardized item data
   */
  async searchItems(query, filters = {}) {
    throw new Error("searchItems must be implemented by provider");
  }

  /**
   * Get current market value for item - MUST be implemented by providers
   * @param {string} catalogId - Catalog identifier
   * @returns {Promise<number>} Current market value in USD
   */
  async getMarketValue(catalogId) {
    throw new Error("getMarketValue must be implemented by provider");
  }
}

// ---------------------------------------------------------------------------
// Shape classification & dimension parsing (STAK-528)
// ---------------------------------------------------------------------------

function classifyShape(shapeStr) {
  if (!shapeStr) return "round";
  const s = shapeStr.toLowerCase();
  if (s.startsWith("round") || s.startsWith("circular")) return "round";
  if (s.startsWith("rectangular") || s.startsWith("rectangle")) return "rectangular";
  if (s.startsWith("square")) return "square";
  if (s.startsWith("oval") || s.startsWith("elliptical")) return "oval";
  return "other";
}

function parseDimensions(sizeValue, shapeStr) {
  let diameter = 0;
  let length = 0;
  let width = 0;

  // Check for "LxW" pattern in sizeValue
  const sizeStr = sizeValue != null ? String(sizeValue).trim() : "";
  const splitMatch = sizeStr.match(/^([\d.]+)\s*[xX\u00D7]\s*([\d.]+)/);
  if (splitMatch && splitMatch.length >= 3) {
    length = parseFloat(splitMatch[1]) || 0;
    width = parseFloat(splitMatch[2]) || 0;
    return { diameter: 0, length, width };
  }

  // Check for embedded width in shape string, e.g. "Rectangular (41.8mm wide)"
  const shapeString = shapeStr || "";
  const embeddedMatch = shapeString.match(/\((\d+\.?\d*)\s*mm\s*wide\)/i);
  const embeddedWidth = embeddedMatch ? parseFloat(embeddedMatch[1]) || 0 : 0;

  const category = classifyShape(shapeString);
  if (category === "rectangular" || category === "square") {
    length = parseFloat(sizeValue) || 0;
    // Square items: default width to length when no embedded width available
    width = embeddedWidth || (category === "square" ? length : 0);
  } else {
    diameter = parseFloat(sizeValue) || 0;
  }

  return { diameter, length, width };
}

/**
 * Numista API Provider
 * Implements Numista-specific API calls
 */
class NumistaProvider extends CatalogProvider {
  constructor() {
    const config = catalogConfig.getNumistaConfig();
    super({
      name: "Numista",
      apiKey: config.apiKey,
      baseUrl: "https://api.numista.com/v3",
      rateLimit: 100, // Numista allows 100 requests per minute
      timeout: 15000,
    });
    this.clientName = config.clientName;
    this.clientId = config.clientId;
    this.quota = config.quota;
  }

  /**
   * Lookup item by Numista catalog ID
   * @param {string} catalogId - Numista item ID
   * @returns {Promise<Object>} Standardized item data
   */
  async lookupItem(catalogId) {
    if (!catalogId) throw new Error("Catalog ID is required");

    // STAK-222: Check response cache before hitting the API
    const cached = loadNumistaCache(catalogId);
    if (cached) {
      debugLog(`[numista-cache] Cache hit for type ${catalogId}`, "info");
      return this.normalizeItemData(cached);
    }

    const url = `${this.baseUrl}/types/${catalogId}?lang=en`;

    try {
      const response = await this.request(url, {
        headers: { "Numista-API-Key": this.apiKey },
      });
      const data = await response.json();
      if (typeof window !== "undefined" && typeof window.debugLog === "function") {
        window.debugLog(`Numista lookup ${catalogId}: keys=${Object.keys(data).join(",")}`);
        if (data.obverse) window.debugLog(`  obverse keys: ${Object.keys(data.obverse).join(",")}`);
        if (data.reverse) window.debugLog(`  reverse keys: ${Object.keys(data.reverse).join(",")}`);
      }

      // STAK-222: Cache the raw response for 30 days
      saveNumistaCache(catalogId, data);

      return this.normalizeItemData(data);
    } catch (error) {
      console.error(`Numista lookup failed for ID ${catalogId}:`, error);
      throw new Error(`Failed to lookup item ${catalogId} from Numista: ${error.message}`);
    }
  }

  /**
   * Search for items on Numista
   * @param {string} query - Search term
   * @param {Object} filters - Search filters
   * @returns {Promise<Array>} Array of standardized item data
   */
  async searchItems(query, filters = {}) {
    const params = buildNumistaSearchParams(query, filters);
    if (!params) return [];

    const url = `${this.baseUrl}/types?${params.toString()}`;

    try {
      const response = await this.request(url, {
        headers: { "Numista-API-Key": this.apiKey },
      });
      const data = await response.json();

      return data.types ? data.types.map((item) => this.normalizeItemData(item)) : [];
    } catch (error) {
      console.error("Numista search failed:", error);
      throw new Error(`Numista search failed: ${error.message}`);
    }
  }

  /**
   * Get current market value from Numista
   * @param {string} catalogId - Numista item ID
   * @returns {Promise<number>} Current market value in USD
   */
  async getMarketValue(catalogId) {
    // Note: Numista doesn't provide real-time market values
    // This would need to be enhanced or combined with other sources
    try {
      const item = await this.lookupItem(catalogId);
      return item.estimatedValue || 0;
    } catch (error) {
      console.warn(`Could not get market value for ${catalogId}:`, error);
      return 0;
    }
  }

  /**
   * Normalize Numista data to standard format
   * @param {Object} numistaData - Raw Numista API response
   * @returns {Object} Standardized item data
   */
  normalizeItemData(numistaData) {
    const composition = numistaExtractComposition(numistaData);
    const images = numistaExtractImages(numistaData);
    const imageUrl = images.imageUrl;
    const reverseImageUrl = images.reverseImageUrl;

    debugLog(
      `  imageUrl: ${imageUrl || "(empty)"}, reverseImageUrl: ${reverseImageUrl || "(empty)"}`
    );

    const denomination = numistaData.value?.text || "";
    const contextText = `${numistaData.title || ""} ${denomination}`;

    const derived = {
      year: numistaComposeYear(numistaData),
      composition,
      imageUrl,
      reverseImageUrl,
      denomination,
      metal: this.normalizeMetal(composition),
      type: this.normalizeType(numistaData.category || "", contextText),
      kmReferences: numistaExtractReferences(numistaData),
      mintageByYear: numistaExtractMintageByYear(numistaData),
    };

    const result = numistaBuildResultObject(numistaData, derived);

    // Attach field-level origin tracking (fieldMeta) for re-sync picker
    if (typeof window.initFieldMeta === "function") {
      result.fieldMeta = window.initFieldMeta(result, "numista");
    }

    return result;
  }

  /**
   * Normalize metal composition from Numista format
   * @param {string} composition - Numista composition string
   * @returns {string} Standardized metal name
   */
  normalizeMetal(composition) {
    const comp = composition.toLowerCase();
    if (comp.includes("gold") || comp.includes("au")) return "Gold";
    if (comp.includes("silver") || comp.includes("ag")) return "Silver";
    if (comp.includes("platinum") || comp.includes("pt")) return "Platinum";
    if (comp.includes("palladium") || comp.includes("pd")) return "Palladium";
    // STRK-305: pure copper is a first-class metal; bronze/brass stay alloys.
    // No "cu" substring check on purpose — it matches too many words.
    if (comp.includes("copper")) return "Copper";
    if (comp.includes("bronze") || comp.includes("brass")) return "Alloy/Other";
    return "Alloy/Other";
  }

  /**
   * Normalize item type from Numista format
   * @param {string} category - Numista category/type string
   * @param {string} [contextText] - Extra context (title + denomination) used to
   *   detect Goldback/Silverback, which Numista files under generic categories.
   * @returns {string} Standardized type
   */
  normalizeType(category, contextText = "") {
    // STRK-138: Goldback/Silverback are not distinct Numista categories — detect
    // them from the combined category + context text before the keyword checks.
    const ctx = `${category} ${contextText}`.toLowerCase();
    if (ctx.includes("goldback")) return "Goldback";
    if (ctx.includes("silverback")) return "Silverback";

    const t = category.toLowerCase();
    if (t.includes("coin") || t.includes("circulation")) return "Coin";
    if (t.includes("bar") || t.includes("ingot")) return "Bar";
    if (t.includes("round")) return "Round";
    if (t.includes("note") || t.includes("bill")) return "Note";
    return "Other";
  }
}

/**
 * Local Provider (Fallback)
 * Uses local data when external APIs are unavailable
 */
class LocalProvider extends CatalogProvider {
  constructor() {
    super({
      name: "Local",
      rateLimit: 1000, // No real rate limit for local data
      timeout: 1000,
    });
    this.localData = this.loadLocalData();
  }

  loadLocalData() {
    // Load any cached catalog data from localStorage
    try {
      const stored = localStorage.getItem("staktrakr.catalog.cache");
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.warn("Could not load local catalog cache:", error);
      return {};
    }
  }

  async lookupItem(catalogId) {
    const item = this.localData[catalogId];
    if (!item) {
      throw new Error(`Item ${catalogId} not found in local cache`);
    }
    return item;
  }

  async searchItems(query, filters = {}) {
    const results = Object.values(this.localData).filter(
      (item) =>
        item.name.toLowerCase().includes(query.toLowerCase()) ||
        item.description.toLowerCase().includes(query.toLowerCase())
    );
    return results.slice(0, filters.limit || 20);
  }

  async getMarketValue(catalogId) {
    const item = this.localData[catalogId];
    return item ? item.estimatedValue || 0 : 0;
  }

  /**
   * Cache item data locally
   * @param {string} catalogId - Catalog identifier
   * @param {Object} itemData - Standardized item data
   */
  cacheItem(catalogId, itemData) {
    this.localData[catalogId] = itemData;
    try {
      localStorage.setItem("staktrakr.catalog.cache", JSON.stringify(this.localData));
    } catch (error) {
      console.warn("Could not cache item data:", error);
    }
  }
}

/**
 * Main Catalog API Manager
 * Coordinates multiple providers with fallback chain
 */
class CatalogAPI {
  constructor() {
    this.providers = [];
    this.localProvider = new LocalProvider();
    this.activeProvider = null;
    this.settings = this.loadSettings();

    this.initializeProviders();
  }

  /**
   * Load API settings from localStorage
   */
  loadSettings() {
    try {
      const stored = localStorage.getItem("staktrakr.catalog.settings");
      return stored
        ? JSON.parse(stored)
        : {
            activeProvider: "numista",
            numistaApiKey: "",
            enableFallback: true,
            cacheDuration: 3600000, // 1 hour
          };
    } catch (error) {
      console.warn("Could not load catalog API settings:", error);
      return {};
    }
  }

  /**
   * Save API settings to localStorage
   */
  saveSettings() {
    try {
      // codeql[js/clear-text-storage-of-sensitive-data]
      // User-owned catalog credentials are intentionally stored locally for this offline-first app.
      localStorage.setItem("staktrakr.catalog.settings", JSON.stringify(this.settings));
    } catch (error) {
      console.warn("Could not save catalog API settings:", error);
    }
  }

  /**
   * Initialize available providers based on API keys
   */
  initializeProviders() {
    this.providers = [];

    // Add Numista provider if configured and enabled
    if (catalogConfig.isNumistaEnabled()) {
      try {
        const numista = new NumistaProvider();
        this.providers.push(numista);
        this.activeProvider = numista;
        console.log("✅ Numista provider initialized");
      } catch (error) {
        console.error("❌ Failed to initialize Numista provider:", error);
      }
    }

    // Default to first available provider if none set
    if (!this.activeProvider && this.providers.length > 0) {
      this.activeProvider = this.providers[0];
    }

    console.log(`🔌 Catalog API initialized with ${this.providers.length} provider(s)`);
  }

  /**
   * Set API key for a provider
   * @param {string} provider - Provider name ('numista')
   * @param {string} apiKey - API key
   */
  setApiKey(provider, apiKey) {
    if (provider === "numista") {
      this.settings.numistaApiKey = apiKey;
    }

    this.saveSettings();
    this.initializeProviders();
  }

  /**
   * Switch active provider
   * @param {string} providerName - Provider name to switch to
   */
  switchProvider(providerName) {
    const provider = this.providers.find(
      (p) => p.name.toLowerCase() === providerName.toLowerCase()
    );
    if (provider) {
      this.activeProvider = provider;
      this.settings.activeProvider = providerName.toLowerCase();
      this.saveSettings();
      console.log(`Switched to ${provider.name} catalog provider`);
    } else {
      throw new Error(`Provider ${providerName} not available`);
    }
  }

  /**
   * Lookup item with fallback chain
   * @param {string} catalogId - Catalog identifier
   * @param {Object} [options={}] - Options (e.g. { action: 'test' })
   * @returns {Promise<Object>} Standardized item data
   */
  async lookupItem(catalogId, options = {}) {
    const startTime = Date.now();
    const action = options.action || "lookup";
    const providers = this.settings.enableFallback
      ? [
          this.activeProvider,
          ...this.providers.filter((p) => p !== this.activeProvider),
          this.localProvider,
        ]
      : [this.activeProvider];

    let lastError;

    for (const provider of providers) {
      if (!provider) continue;

      try {
        console.log(`Attempting lookup with ${provider.name}...`);
        const result = await provider.lookupItem(catalogId);

        // Cache successful results locally
        if (provider !== this.localProvider) {
          this.localProvider.cacheItem(catalogId, result);
        }

        recordCatalogHistory({
          action,
          query: catalogId,
          result: "success",
          itemCount: 1,
          provider: provider.name,
          duration: Date.now() - startTime,
        });

        return result;
      } catch (error) {
        console.warn(`${provider.name} lookup failed:`, error.message);
        lastError = error;
        continue;
      }
    }

    recordCatalogHistory({
      action,
      query: catalogId,
      result: "fail",
      itemCount: 0,
      provider: "",
      duration: Date.now() - startTime,
      error: lastError ? lastError.message : "All providers failed",
    });

    throw lastError || new Error("All catalog providers failed");
  }

  /**
   * Search items with active provider
   * @param {string} query - Search term
   * @param {Object} filters - Search filters
   * @returns {Promise<Array>} Array of standardized item data
   */
  async searchItems(query, filters = {}) {
    const startTime = Date.now();

    if (!this.activeProvider) {
      recordCatalogHistory({
        action: "search",
        query,
        result: "fail",
        itemCount: 0,
        provider: "",
        duration: Date.now() - startTime,
        error: "No catalog provider available",
      });
      throw new Error("No catalog provider available");
    }

    try {
      const results = await this.activeProvider.searchItems(query, filters);
      recordCatalogHistory({
        action: "search",
        query,
        result: "success",
        itemCount: results.length,
        provider: this.activeProvider.name,
        duration: Date.now() - startTime,
      });
      return results;
    } catch (error) {
      recordCatalogHistory({
        action: "search",
        query,
        result: "fail",
        itemCount: 0,
        provider: this.activeProvider.name,
        duration: Date.now() - startTime,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get market value with fallback
   * @param {string} catalogId - Catalog identifier
   * @returns {Promise<number>} Current market value in USD
   */
  async getMarketValue(catalogId) {
    const startTime = Date.now();
    const providers = this.settings.enableFallback
      ? [this.activeProvider, ...this.providers.filter((p) => p !== this.activeProvider)]
      : [this.activeProvider];

    let lastError;

    for (const provider of providers) {
      if (!provider) continue;

      try {
        const value = await provider.getMarketValue(catalogId);
        recordCatalogHistory({
          action: "market_value",
          query: catalogId,
          result: "success",
          itemCount: 1,
          provider: provider.name,
          duration: Date.now() - startTime,
        });
        return value;
      } catch (error) {
        console.warn(`${provider.name} market value lookup failed:`, error.message);
        lastError = error;
        continue;
      }
    }

    recordCatalogHistory({
      action: "market_value",
      query: catalogId,
      result: "fail",
      itemCount: 0,
      provider: "",
      duration: Date.now() - startTime,
      error: lastError ? lastError.message : "All providers failed",
    });

    return 0; // Fallback to 0 if all providers fail
  }

  /**
   * Get provider status information
   * @returns {Object} Status of all providers
   */
  getProviderStatus() {
    return {
      active: this.activeProvider ? this.activeProvider.name : "None",
      available: this.providers.map((p) => p.name),
      settings: this.settings,
    };
  }
}

// Global catalog API instance
let catalogAPI = new CatalogAPI();

// =============================================================================
// CATALOG HISTORY LOGGING
// =============================================================================

let catalogHistoryEntries = [];
let catalogHistorySortColumn = "";
let catalogHistorySortAsc = true;
let catalogHistoryFilterText = "";

/**
 * Save catalog history to localStorage
 */
const saveCatalogHistory = () => {
  try {
    saveDataSync(CATALOG_HISTORY_KEY, catalogHistory);
  } catch (e) {
    console.warn("Failed to save catalog history:", e);
  }
};

/**
 * Load catalog history from localStorage
 */
const loadCatalogHistory = () => {
  catalogHistory = loadDataSync(CATALOG_HISTORY_KEY, []);
};

/**
 * Purge catalog history entries older than given number of days
 * @param {number} days - Maximum age in days (default 180)
 */
const purgeCatalogHistory = (days = 180) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  catalogHistory = catalogHistory.filter((e) => e.timestamp >= cutoffStr);
};

/**
 * Record a catalog API call to history
 * @param {Object} entry - History entry data
 */
const recordCatalogHistory = (entry) => {
  loadCatalogHistory();
  purgeCatalogHistory();

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  catalogHistory.push({
    timestamp,
    action: entry.action || "lookup",
    query: entry.query || "",
    result: entry.result || "success",
    itemCount: entry.itemCount || 0,
    provider: entry.provider || "",
    duration: entry.duration || 0,
    error: entry.error || null,
  });

  saveCatalogHistory();
};

/**
 * Renders catalog history table with filtering and sorting
 * Mirrors renderApiHistoryTable() in api.js
 */
const renderCatalogHistoryTable = () => {
  const table = document.getElementById("catalogHistoryTable");
  if (!table) return;

  let data = [...catalogHistoryEntries];
  if (catalogHistoryFilterText) {
    const f = catalogHistoryFilterText.toLowerCase();
    data = data.filter((e) => Object.values(e).some((v) => String(v).toLowerCase().includes(f)));
  }
  if (catalogHistorySortColumn) {
    data.sort((a, b) => {
      const valA = a[catalogHistorySortColumn];
      const valB = b[catalogHistorySortColumn];
      if (valA < valB) return catalogHistorySortAsc ? -1 : 1;
      if (valA > valB) return catalogHistorySortAsc ? 1 : -1;
      return 0;
    });
  }
  if (!catalogHistorySortColumn) {
    data.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }

  let html =
    '<tr><th data-column="timestamp">Time</th><th data-column="action">Action</th><th data-column="query">Query</th><th data-column="result">Result</th><th data-column="itemCount">Items</th><th data-column="provider">Provider</th><th data-column="duration">Duration</th></tr>';
  data.forEach((e) => {
    const resultClass = e.result === "fail" ? ' style="color: var(--danger, #e74c3c);"' : "";
    const errorTitle = e.error ? ` title="${e.error.replace(/"/g, "&quot;")}"` : "";
    html += `<tr><td>${e.timestamp}</td><td>${e.action}</td><td>${e.query}</td><td${resultClass}${errorTitle}>${e.result}</td><td>${e.itemCount}</td><td>${e.provider || ""}</td><td>${e.duration}ms</td></tr>`;
  });
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
  table.innerHTML = html;

  table.querySelectorAll("th").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.column;
      if (catalogHistorySortColumn === col) {
        catalogHistorySortAsc = !catalogHistorySortAsc;
      } else {
        catalogHistorySortColumn = col;
        catalogHistorySortAsc = true;
      }
      renderCatalogHistoryTable();
    });
  });
};

/**
 * Shows catalog history modal
 */
const showCatalogHistoryModal = () => {
  const modal = document.getElementById("catalogHistoryModal");
  if (!modal) return;

  loadCatalogHistory();
  catalogHistoryEntries = [...catalogHistory];
  catalogHistorySortColumn = "";
  catalogHistorySortAsc = true;
  catalogHistoryFilterText = "";

  const filterInput = document.getElementById("catalogHistoryFilter");
  const clearFilterBtn = document.getElementById("catalogHistoryClearFilterBtn");
  if (filterInput) {
    filterInput.value = "";
    filterInput.oninput = (e) => {
      catalogHistoryFilterText = e.target.value;
      renderCatalogHistoryTable();
    };
  }
  if (clearFilterBtn) {
    clearFilterBtn.onclick = () => {
      catalogHistoryFilterText = "";
      if (filterInput) filterInput.value = "";
      renderCatalogHistoryTable();
    };
  }
  renderCatalogHistoryTable();
  modal.style.display = "flex";
};

/**
 * Hides catalog history modal
 */
const hideCatalogHistoryModal = () => {
  const modal = document.getElementById("catalogHistoryModal");
  if (modal) modal.style.display = "none";
};

// =============================================================================
// CATALOG HISTORY — SETTINGS LOG TABLE
// =============================================================================

/** @type {string} Sort column for settings catalog history table */
let settingsCatalogSortColumn = "";
/** @type {boolean} Sort ascending for settings catalog history table */
let settingsCatalogSortAsc = true;

/**
 * Renders the catalog history table in the Settings > Activity Log > Catalogs sub-tab.
 * Reads from global catalogHistory, sorts by timestamp descending by default.
 */
const renderCatalogHistoryForSettings = () => {
  const table = document.getElementById("settingsCatalogHistoryTable");
  if (!table) return;

  loadCatalogHistory();
  let data = [...catalogHistory];

  // Sort
  if (settingsCatalogSortColumn) {
    data.sort((a, b) => {
      const valA = a[settingsCatalogSortColumn];
      const valB = b[settingsCatalogSortColumn];
      if (valA < valB) return settingsCatalogSortAsc ? -1 : 1;
      if (valA > valB) return settingsCatalogSortAsc ? 1 : -1;
      return 0;
    });
  } else {
    data.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }

  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  if (data.length === 0) {
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
    tbody.innerHTML =
      '<tr class="settings-log-empty"><td colspan="7">No catalog history recorded yet.</td></tr>';
    return;
  }

  const rows = data.map((e) => {
    const resultClass = e.result === "fail" ? ' style="color: var(--danger, #e74c3c);"' : "";
    const errorTitle = e.error ? ` title="${String(e.error).replace(/"/g, "&quot;")}"` : "";
    return `<tr><td>${e.timestamp || ""}</td><td>${e.action || ""}</td><td>${e.query || ""}</td><td${resultClass}${errorTitle}>${e.result || ""}</td><td>${e.itemCount || 0}</td><td>${e.provider || ""}</td><td>${e.duration || 0}ms</td></tr>`;
  });

  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  tbody.innerHTML = rows.join("");

  // Sortable headers
  table.querySelectorAll("th").forEach((th) => {
    th.style.cursor = "pointer";
    th.onclick = () => {
      const cols = ["timestamp", "action", "query", "result", "itemCount", "provider", "duration"];
      const idx = Array.from(th.parentNode.children).indexOf(th);
      const col = cols[idx];
      if (settingsCatalogSortColumn === col) {
        settingsCatalogSortAsc = !settingsCatalogSortAsc;
      } else {
        settingsCatalogSortColumn = col;
        settingsCatalogSortAsc = true;
      }
      renderCatalogHistoryForSettings();
    };
  });
};

/**
 * Clears all catalog API history after user confirmation.
 */
const clearCatalogHistory = async () => {
  const confirmed = await appConfirm(
    "Clear all catalog history? This cannot be undone.",
    "Catalog History"
  );
  if (!confirmed) return;
  catalogHistory = [];
  saveCatalogHistory();
  const panel = document.getElementById("logPanel_catalogs");
  if (panel) delete panel.dataset.rendered;
  renderCatalogHistoryForSettings();
};

// Test function for Numista API
async function testNumistaAPI() {
  if (!catalogConfig.isNumistaEnabled()) {
    console.log("❌ Numista API not configured");
    return;
  }

  console.log("🧪 Testing Numista API...");

  try {
    // Test with a known coin ID (American Silver Eagle)
    const testId = "5685"; // This is a common test ID for American Silver Eagle 1986
    const result = await catalogAPI.lookupItem(testId, { action: "test" });
    console.log("✅ Numista API test successful:", result);
    return result;
  } catch (error) {
    console.error("❌ Numista API test failed:", error);
    return null;
  }
}

/**
 * Re-read catalog config + settings from localStorage and rebuild providers.
 * Call after any restore flow that writes catalog_api_config /
 * staktrakr.catalog.settings directly to localStorage (STRK-186) — the
 * constructor-cached singletons otherwise hold stale state and the next
 * save() clobbers the restored keys.
 */
function rehydrateCatalogState() {
  catalogConfig.load();
  catalogAPI.settings = catalogAPI.loadSettings();
  catalogAPI.initializeProviders();
}

// Export for use in other modules
if (typeof window !== "undefined") {
  window.catalogAPI = catalogAPI;
  window.catalogConfig = catalogConfig;
  window.rehydrateCatalogState = rehydrateCatalogState;
  window.testNumistaAPI = testNumistaAPI;
  window.CatalogAPI = CatalogAPI;
  window.NumistaProvider = NumistaProvider;
  window.LocalProvider = LocalProvider;
  window.showCatalogHistoryModal = showCatalogHistoryModal;
  window.hideCatalogHistoryModal = hideCatalogHistoryModal;
  window.recordCatalogHistory = recordCatalogHistory;
  window.loadCatalogHistory = loadCatalogHistory;
  window.saveCatalogHistory = saveCatalogHistory;
  window.renderCatalogHistoryForSettings = renderCatalogHistoryForSettings;
  window.clearCatalogHistory = clearCatalogHistory;
  // STAK-528: Shape-aware dimension helpers
  window.classifyShape = classifyShape;
  window.parseDimensions = parseDimensions;
  // STAK-222: Numista response cache
  window.loadNumistaCache = loadNumistaCache;
  window.saveNumistaCache = saveNumistaCache;
  window.clearNumistaCache = clearNumistaCache;
  window.getNumistaCacheCount = getNumistaCacheCount;
}

// Initialize UI event handlers when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  // Numista API key input handler
  const numistaApiKeyInput = document.getElementById("numistaApiKey");
  const saveNumistaBtn = document.getElementById("saveNumistaBtn");
  const testNumistaBtn = document.getElementById("testNumistaBtn");
  const clearNumistaBtn = document.getElementById("clearNumistaBtn");

  if (numistaApiKeyInput) {
    // Load existing API key
    const existingConfig = catalogConfig.getNumistaConfig();
    if (existingConfig.apiKey) {
      numistaApiKeyInput.value = existingConfig.apiKey;
    }

    // Save API key when input changes
    numistaApiKeyInput.addEventListener("change", function () {
      const apiKey = this.value.trim();
      if (apiKey) {
        catalogConfig.setNumistaConfig(apiKey, 2000);
        catalogAPI.initializeProviders();
        console.log("✅ Numista API key saved");
      }
    });
  }

  // Save key button
  if (saveNumistaBtn) {
    saveNumistaBtn.addEventListener("click", function () {
      const apiKey = numistaApiKeyInput?.value.trim();
      if (!apiKey) {
        appAlert("Please enter your Numista API key first");
        return;
      }
      catalogConfig.setNumistaConfig(apiKey, 2000);
      catalogAPI.initializeProviders();
      renderNumistaUsageBar();
      appAlert("Numista API key saved.");
    });
  }

  // Test connection button
  if (testNumistaBtn) {
    testNumistaBtn.addEventListener("click", async function () {
      const apiKey = numistaApiKeyInput?.value.trim();
      if (!apiKey) {
        appAlert("Please enter your Numista API key first");
        return;
      }

      // Save the key first
      catalogConfig.setNumistaConfig(apiKey, 2000);
      catalogAPI.initializeProviders();

      // Test the connection
      this.textContent = "Testing...";
      this.disabled = true;

      try {
        const result = await testNumistaAPI();
        if (result) {
          renderNumistaUsageBar();
          appAlert("✅ Numista API connection successful!");
        } else {
          appAlert("❌ Numista API connection failed. Please check your API key.");
        }
      } catch (error) {
        appAlert("❌ Connection failed: " + error.message);
      } finally {
        this.textContent = "Test Connection";
        this.disabled = false;
      }
    });
  }

  // Clear API key button
  if (clearNumistaBtn) {
    clearNumistaBtn.addEventListener("click", async function () {
      if (await appConfirm("Are you sure you want to clear your Numista API key?", "Numista API")) {
        catalogConfig.clearNumistaKey();
        if (numistaApiKeyInput) {
          numistaApiKeyInput.value = "";
        }
        catalogAPI.initializeProviders();
        console.log("🗑️ Numista API key cleared");
      }
    });
  }

  // =========================================================================
  // PCGS API — settings UI event wiring
  // =========================================================================

  const pcgsTokenInput = document.getElementById("pcgsBearerToken");
  const savePcgsBtn = document.getElementById("savePcgsBtn");
  const testPcgsBtn = document.getElementById("testPcgsBtn");
  const clearPcgsBtn = document.getElementById("clearPcgsBtn");
  const pcgsStatus = document.getElementById("pcgsStatus");

  if (pcgsTokenInput) {
    const existingPcgs = catalogConfig.getPcgsConfig();
    if (existingPcgs.bearerToken) {
      pcgsTokenInput.value = existingPcgs.bearerToken;
    }
  }

  if (savePcgsBtn) {
    savePcgsBtn.addEventListener("click", function () {
      const token = pcgsTokenInput?.value.trim();
      if (!token) {
        appAlert("Please enter your PCGS bearer token first");
        return;
      }
      catalogConfig.setPcgsConfig(token);
      if (pcgsStatus) pcgsStatus.textContent = "Token saved.";
      // Update provider status indicator and header status row
      const statusEl = document.getElementById("pcgsProviderStatus");
      if (statusEl) {
        statusEl.querySelector(".status-dot")?.classList.add("connected");
        const txt = statusEl.querySelector(".status-text");
        if (txt) txt.textContent = "Connected";
      }
      if (typeof renderApiStatusSummary === "function") renderApiStatusSummary();
      renderPcgsUsageBar();
      appAlert("PCGS bearer token saved.");
    });
  }

  if (testPcgsBtn) {
    testPcgsBtn.addEventListener("click", async function () {
      const token = pcgsTokenInput?.value.trim();
      if (!token) {
        appAlert("Please enter your PCGS bearer token first");
        return;
      }

      // Save first
      catalogConfig.setPcgsConfig(token);

      this.textContent = "Testing...";
      this.disabled = true;

      try {
        if (typeof verifyPcgsCert === "function") {
          const result = await verifyPcgsCert("00000000");
          // Even a "not found" response means the API is reachable
          if (pcgsStatus) pcgsStatus.textContent = "Connected — API reachable.";
          appAlert("PCGS API connection successful!");
        } else {
          if (pcgsStatus) pcgsStatus.textContent = "pcgs-api.js not loaded.";
          appAlert("PCGS API module not loaded. Ensure pcgs-api.js is included.");
        }
      } catch (error) {
        const msg = error.message || "Unknown error";
        if (pcgsStatus) pcgsStatus.textContent = "Connection failed: " + msg;
        appAlert("PCGS API connection failed: " + msg);
      } finally {
        this.textContent = "Test Connection";
        this.disabled = false;
      }
    });
  }

  if (clearPcgsBtn) {
    clearPcgsBtn.addEventListener("click", async function () {
      if (await appConfirm("Are you sure you want to clear your PCGS bearer token?", "PCGS API")) {
        catalogConfig.clearPcgsToken();
        if (pcgsTokenInput) pcgsTokenInput.value = "";
        if (pcgsStatus) pcgsStatus.textContent = "Token cleared.";
        // Update provider status indicator and header status row
        const statusEl = document.getElementById("pcgsProviderStatus");
        if (statusEl) {
          statusEl.querySelector(".status-dot")?.classList.remove("connected");
          const txt = statusEl.querySelector(".status-text");
          if (txt) txt.textContent = "Disconnected";
        }
        if (typeof renderApiStatusSummary === "function") renderApiStatusSummary();
      }
    });
  }
});

// =============================================================================
// NumistaProvider.normalizeItemData field-derivation helpers (STRK-170).
// Pure functions extracted to keep normalizeItemData a low-complexity
// orchestrator. Each owns one cluster of the raw → standardized mapping.
// =============================================================================

/**
 * Compose a display year from a Numista min_year / max_year range.
 * @param {Object} numistaData - Raw Numista API response
 * @returns {string} A "min-max" range, a single year, or "" when absent
 */
function numistaComposeYear(numistaData) {
  const minY = numistaData.min_year;
  const maxY = numistaData.max_year;
  const year = minY && maxY && minY !== maxY ? `${minY}-${maxY}` : minY || maxY || "";
  return year.toString();
}

/**
 * Resolve the composition string from Numista data, which may be a plain
 * string or an object with a `.text` field.
 * @param {Object} numistaData - Raw Numista API response
 * @returns {string} Composition text, or "" when absent
 */
function numistaExtractComposition(numistaData) {
  const rawComp = numistaData.composition;
  return typeof rawComp === "object" && rawComp !== null ? rawComp.text || "" : rawComp || "";
}

/**
 * Resolve obverse/reverse thumbnail image URLs with nested fallbacks.
 * @param {Object} numistaData - Raw Numista API response
 * @returns {{imageUrl: string, reverseImageUrl: string}} Image URLs (each "" when absent)
 */
function numistaExtractImages(numistaData) {
  // Image: prefer obverse_thumbnail with nested fallback
  const imageUrl =
    numistaData.obverse_thumbnail ||
    numistaData.obverse?.thumbnail ||
    numistaData.reverse_thumbnail ||
    "";
  // Reverse image: separate field for showing both sides
  const reverseImageUrl = numistaData.reverse_thumbnail || numistaData.reverse?.thumbnail || "";
  return { imageUrl, reverseImageUrl };
}

/**
 * Extract catalog references (KM#, Schon#, etc.) from Numista data.
 * @param {Object} numistaData - Raw Numista API response
 * @returns {string[]} Formatted reference strings ("CODE# NUMBER")
 */
function numistaExtractReferences(numistaData) {
  const kmReferences = [];
  if (Array.isArray(numistaData.references)) {
    numistaData.references.forEach((ref) => {
      if (ref.catalogue?.code && ref.number) {
        kmReferences.push(`${ref.catalogue.code}# ${ref.number}`);
      }
    });
  }
  return kmReferences;
}

/**
 * Extract per-year mintage data from Numista data.
 * @param {Object} numistaData - Raw Numista API response
 * @returns {Array<{year: *, mintage: number, remark: string}>} Mintage rows
 */
function numistaExtractMintageByYear(numistaData) {
  const mintageByYear = [];
  if (Array.isArray(numistaData.years)) {
    numistaData.years.forEach((y) => {
      if (y.year) {
        mintageByYear.push({
          year: y.year,
          mintage: y.mintage || 0,
          remark: y.remark || "",
        });
      }
    });
  }
  return mintageByYear;
}

/**
 * Assemble the standardized item object from raw Numista data plus the
 * pre-computed derived fields.
 * @param {Object} numistaData - Raw Numista API response
 * @param {Object} derived - Pre-computed fields
 * @param {string} derived.year - Composed display year
 * @param {string} derived.composition - Composition text
 * @param {string} derived.imageUrl - Obverse image URL
 * @param {string} derived.reverseImageUrl - Reverse image URL
 * @param {string} derived.denomination - Face value text
 * @param {string} derived.metal - Normalized metal name
 * @param {string} derived.type - Normalized item type
 * @param {string[]} derived.kmReferences - Catalog references
 * @param {Array} derived.mintageByYear - Per-year mintage rows
 * @returns {Object} Standardized item data
 */
function numistaBuildResultObject(numistaData, derived) {
  return {
    catalogId: numistaData.id?.toString() || "",
    name: numistaData.title || "",
    year: derived.year,
    country: numistaData.issuer?.name || "",
    metal: derived.metal,
    weight: numistaData.weight || 0,
    ...parseDimensions(numistaData.size, numistaData.shape || ""),
    thickness: numistaData.thickness || 0,
    type: derived.type,
    mintage: 0, // Mintage is per-issue, not per-type in Numista API
    estimatedValue: numistaData.value?.numeric_value || 0,
    imageUrl: derived.imageUrl,
    reverseImageUrl: derived.reverseImageUrl,
    description: numistaData.comments || "",
    provider: "Numista",
    lastUpdated: new Date().toISOString(),
    // Enriched fields for view modal
    denomination: derived.denomination,
    shape: numistaData.shape || "",
    composition: derived.composition,
    orientation: numistaData.orientation || "",
    commemorative: !!numistaData.is_commemorative,
    commemorativeDesc: numistaData.commemorative_description || "",
    rarityIndex: numistaData.rarity_index || 0,
    kmReferences: derived.kmReferences,
    mintageByYear: derived.mintageByYear,
    tags: Array.isArray(numistaData.tags) ? numistaData.tags : [],
    technique:
      typeof numistaData.technique === "object"
        ? numistaData.technique?.text || ""
        : numistaData.technique || "",
    obverseDesc: numistaData.obverse?.description || "",
    reverseDesc: numistaData.reverse?.description || "",
    edgeDesc: numistaData.edge?.description || "",
  };
}

// =============================================================================
// Regex-heavy helpers — kept LAST in the file. Lizard's tokenizer desyncs on a
// regex literal that contains a double-quote (here: /[-()+"]/g), rolling the
// remainder of the file into a phantom high-NLOC function. Keeping these at the
// file end means any residual desync rolls up only trailing whitespace.
// =============================================================================

/**
 * Build the Numista /types query string from a search term and filters.
 * Sanitizes the query (STAK-494: strips characters the Numista API treats as
 * search operators) and assembles the URLSearchParams. Returns null when the
 * query is missing, non-string, or empty after sanitization so callers can
 * short-circuit to an empty result set.
 * @param {string} query - Raw search term
 * @param {Object} [filters] - Search filters (limit, page, country, category, year)
 * @returns {URLSearchParams|null} Query params, or null when there is nothing to search
 */
function buildNumistaSearchParams(query, filters = {}) {
  if (!query || typeof query !== "string") return null;
  // STAK-494: Strip characters the Numista API interprets as search operators
  // - hyphens are negation, parentheses are grouping, plus is required-term
  const sanitized = query
    .replace(/[-()+"]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!sanitized) return null;

  const params = new URLSearchParams({
    q: sanitized,
    count: Math.min(filters.limit || 20, 50),
    lang: "en",
  });

  if (filters.page) params.append("page", filters.page);
  if (filters.country) params.append("issuer", filters.country);
  if (filters.category) params.append("category", filters.category);
  if (filters.year) params.append("year", filters.year);

  return params;
}

// CATALOG API SYSTEM
// =============================================================================
// Provider-agnostic catalog API architecture for StakTrakr
// Provider-agnostic architecture for catalog lookups

/**
 * Catalog API Configuration with base64-encoded key storage
 * Matches the metals API key pattern in js/api.js
 */
class CatalogConfig {
  constructor() {
    this.storageKey = 'catalog_api_config';
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
        if (parsed.pcgs && parsed.pcgs.bearerToken) {
          try {
            parsed.pcgs.bearerToken = atob(parsed.pcgs.bearerToken);
          } catch (e) {
            // Token wasn't base64 encoded — keep as-is
          }
        }
        this.config = parsed;
      } else {
        this.config = this.getDefaultConfig();
      }
    } catch (error) {
      console.warn('Failed to load catalog config:', error);
      this.config = this.getDefaultConfig();
    }
  }

  getDefaultConfig() {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const today = now.toISOString().slice(0, 10);
    return {
      numista: {
        apiKey: '',
        quota: 2000
      },
      numistaUsage: {
        used: 0,
        month: month
      },
      pcgs: {
        bearerToken: ''
      },
      pcgsUsage: {
        used: 0,
        date: today
      },
      local: {
        enabled: true
      }
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
      console.error('Failed to save catalog config:', error);
    }
  }

  /**
   * Set Numista API key
   * @param {string} apiKey - Plain text API key
   * @param {number} quota - API quota (default 2000)
   */
  setNumistaConfig(apiKey, quota = 2000) {
    this.config.numista = {
      apiKey: apiKey || '',
      quota
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
      apiKey: this.config.numista.apiKey || ''
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
      apiKey: '',
      quota: 2000
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
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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
      month: this.config.numistaUsage.month
    };
  }

  // ─── PCGS Methods ───────────────────────────────────────────────────────

  /**
   * Set PCGS bearer token
   * @param {string} token - Bearer token from PCGS
   */
  setPcgsConfig(token) {
    if (!this.config.pcgs) this.config.pcgs = {};
    this.config.pcgs.bearerToken = token || '';
    this.save();
    return true;
  }

  /**
   * Get current PCGS configuration
   * @returns {{ bearerToken: string }}
   */
  getPcgsConfig() {
    if (!this.config.pcgs) this.config.pcgs = { bearerToken: '' };
    return { bearerToken: this.config.pcgs.bearerToken || '' };
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
    this.config.pcgs = { bearerToken: '' };
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
      date: this.config.pcgsUsage.date
    };
  }
}

// Global catalog configuration instance
const catalogConfig = new CatalogConfig();

console.log('🔌 Catalog API system ready - configure API keys through settings');

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
    debugLog('[numista-cache] Load error: ' + e.message, 'warn');
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
    debugLog('[numista-cache] Save error: ' + e.message, 'warn');
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
    debugLog('[numista-cache] Clear error: ' + e.message, 'warn');
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
    return Object.values(cache).filter(entry => {
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
    this.name = config.name || 'Unknown';
    this.apiKey = config.apiKey || '';
    this.baseUrl = config.baseUrl || '';
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
          'Content-Type': 'application/json',
          ...options.headers
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
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
    throw new Error('lookupItem must be implemented by provider');
  }

  /**
   * Search for items by query - MUST be implemented by providers
   * @param {string} query - Search term
   * @param {Object} filters - Search filters
   * @returns {Promise<Array>} Array of standardized item data
   */
  async searchItems(query, filters = {}) {
    throw new Error('searchItems must be implemented by provider');
  }

  /**
   * Get current market value for item - MUST be implemented by providers
   * @param {string} catalogId - Catalog identifier
   * @returns {Promise<number>} Current market value in USD
   */
  async getMarketValue(catalogId) {
    throw new Error('getMarketValue must be implemented by provider');
  }
}

/**
 * Numista API Provider
 * Implements Numista-specific API calls
 */
class NumistaProvider extends CatalogProvider {
  constructor() {
    const config = catalogConfig.getNumistaConfig();
    super({
      name: 'Numista',
      apiKey: config.apiKey,
      baseUrl: 'https://api.numista.com/v3',
      rateLimit: 100, // Numista allows 100 requests per minute
      timeout: 15000
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
    if (!catalogId) throw new Error('Catalog ID is required');

    // STAK-222: Check response cache before hitting the API
    const cached = loadNumistaCache(catalogId);
    if (cached) {
      debugLog(`[numista-cache] Cache hit for type ${catalogId}`, 'info');
      return this.normalizeItemData(cached);
    }

    const url = `${this.baseUrl}/types/${catalogId}?lang=en`;

    try {
      const response = await this.request(url, {
        headers: { 'Numista-API-Key': this.apiKey }
      });
      const data = await response.json();
      if (typeof window !== 'undefined' && typeof window.debugLog === 'function') {
        window.debugLog(`Numista lookup ${catalogId}: keys=${Object.keys(data).join(',')}`);
        if (data.obverse) window.debugLog(`  obverse keys: ${Object.keys(data.obverse).join(',')}`);
        if (data.reverse) window.debugLog(`  reverse keys: ${Object.keys(data.reverse).join(',')}`);
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
    const params = new URLSearchParams({
      q: query,
      count: Math.min(filters.limit || 20, 50),
      lang: 'en'
    });

    if (filters.page) params.append('page', filters.page);
    if (filters.country) params.append('issuer', filters.country);
    if (filters.category) params.append('category', filters.category);
    if (filters.year) params.append('year', filters.year);

    const url = `${this.baseUrl}/types?${params.toString()}`;

    try {
      const response = await this.request(url, {
        headers: { 'Numista-API-Key': this.apiKey }
      });
      const data = await response.json();

      return data.types ? data.types.map(item => this.normalizeItemData(item)) : [];
    } catch (error) {
      console.error('Numista search failed:', error);
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
    // Compose year from min_year / max_year range
    const minY = numistaData.min_year;
    const maxY = numistaData.max_year;
    const year = minY && maxY && minY !== maxY ? `${minY}-${maxY}` : (minY || maxY || '');

    // Handle composition — can be a string or object with .text
    const rawComp = numistaData.composition;
    const composition = typeof rawComp === 'object' && rawComp !== null ? (rawComp.text || '') : (rawComp || '');

    // Image: prefer obverse_thumbnail with nested fallback
    const imageUrl = numistaData.obverse_thumbnail ||
      numistaData.obverse?.thumbnail ||
      numistaData.reverse_thumbnail ||
      '';

    // Reverse image: separate field for showing both sides
    const reverseImageUrl = numistaData.reverse_thumbnail ||
      numistaData.reverse?.thumbnail ||
      '';

    debugLog(`  imageUrl: ${imageUrl || '(empty)'}, reverseImageUrl: ${reverseImageUrl || '(empty)'}`);

    // Extract catalog references (KM#, Schon#, etc.)
    const kmReferences = [];
    if (Array.isArray(numistaData.references)) {
      numistaData.references.forEach(ref => {
        if (ref.catalogue?.code && ref.number) {
          kmReferences.push(`${ref.catalogue.code}# ${ref.number}`);
        }
      });
    }

    // Extract mintage data by year
    const mintageByYear = [];
    if (Array.isArray(numistaData.years)) {
      numistaData.years.forEach(y => {
        if (y.year) {
          mintageByYear.push({
            year: y.year,
            mintage: y.mintage || 0,
            remark: y.remark || '',
          });
        }
      });
    }

    // Denomination / face value
    const denomination = numistaData.value?.text || '';

    const result = {
      catalogId: numistaData.id?.toString() || '',
      name: numistaData.title || '',
      year: year.toString(),
      country: numistaData.issuer?.name || '',
      metal: this.normalizeMetal(composition),
      weight: numistaData.weight || 0,
      diameter: numistaData.size || 0,
      thickness: numistaData.thickness || 0,
      type: this.normalizeType(numistaData.category || ''),
      mintage: 0, // Mintage is per-issue, not per-type in Numista API
      estimatedValue: numistaData.value?.numeric_value || 0,
      imageUrl: imageUrl,
      reverseImageUrl: reverseImageUrl,
      description: numistaData.comments || '',
      provider: 'Numista',
      lastUpdated: new Date().toISOString(),
      // Enriched fields for view modal
      denomination: denomination,
      shape: numistaData.shape || '',
      composition: composition,
      orientation: numistaData.orientation || '',
      commemorative: !!numistaData.is_commemorative,
      commemorativeDesc: numistaData.commemorative_description || '',
      rarityIndex: numistaData.rarity_index || 0,
      kmReferences: kmReferences,
      mintageByYear: mintageByYear,
      tags: Array.isArray(numistaData.tags) ? numistaData.tags : [],
      technique: typeof numistaData.technique === 'object' ? (numistaData.technique?.text || '') : (numistaData.technique || ''),
      obverseDesc: numistaData.obverse?.description || '',
      reverseDesc: numistaData.reverse?.description || '',
      edgeDesc: numistaData.edge?.description || '',
    };

    // Attach field-level origin tracking (fieldMeta) for re-sync picker
    if (typeof window.initFieldMeta === 'function') {
      result.fieldMeta = window.initFieldMeta(result, 'numista');
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
    if (comp.includes('gold') || comp.includes('au')) return 'Gold';
    if (comp.includes('silver') || comp.includes('ag')) return 'Silver';
    if (comp.includes('platinum') || comp.includes('pt')) return 'Platinum';
    if (comp.includes('palladium') || comp.includes('pd')) return 'Palladium';
    if (comp.includes('copper') || comp.includes('bronze') || comp.includes('brass')) return 'Alloy/Other';
    return 'Alloy/Other';
  }

  /**
   * Normalize item type from Numista format
   * @param {string} type - Numista type string
   * @returns {string} Standardized type
   */
  normalizeType(type) {
    const t = type.toLowerCase();
    if (t.includes('coin') || t.includes('circulation')) return 'Coin';
    if (t.includes('bar') || t.includes('ingot')) return 'Bar';
    if (t.includes('round')) return 'Round';
    if (t.includes('note') || t.includes('bill')) return 'Note';
    return 'Other';
  }
}

/**
/**
 * Local Provider (Fallback)
 * Uses local data when external APIs are unavailable
 */
class LocalProvider extends CatalogProvider {
  constructor() {
    super({
      name: 'Local',
      rateLimit: 1000, // No real rate limit for local data
      timeout: 1000
    });
    this.localData = this.loadLocalData();
  }

  loadLocalData() {
    // Load any cached catalog data from localStorage
    try {
      const stored = localStorage.getItem('staktrakr.catalog.cache');
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.warn('Could not load local catalog cache:', error);
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
    const results = Object.values(this.localData).filter(item => 
      item.name.toLowerCase().includes(query.toLowerCase()) ||
      item.description.toLowerCase().includes(query.toLowerCase())
    );
    return results.slice(0, filters.limit || 20);
  }

  async getMarketValue(catalogId) {
    const item = this.localData[catalogId];
    return item ? (item.estimatedValue || 0) : 0;
  }

  /**
   * Cache item data locally
   * @param {string} catalogId - Catalog identifier
   * @param {Object} itemData - Standardized item data
   */
  cacheItem(catalogId, itemData) {
    this.localData[catalogId] = itemData;
    try {
      localStorage.setItem('staktrakr.catalog.cache', JSON.stringify(this.localData));
    } catch (error) {
      console.warn('Could not cache item data:', error);
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
      const stored = localStorage.getItem('staktrakr.catalog.settings');
      return stored ? JSON.parse(stored) : {
        activeProvider: 'numista',
        numistaApiKey: '',
        enableFallback: true,
        cacheDuration: 3600000 // 1 hour
      };
    } catch (error) {
      console.warn('Could not load catalog API settings:', error);
      return {};
    }
  }

  /**
   * Save API settings to localStorage
   */
  saveSettings() {
    try {
      localStorage.setItem('staktrakr.catalog.settings', JSON.stringify(this.settings));
    } catch (error) {
      console.warn('Could not save catalog API settings:', error);
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
        console.log('✅ Numista provider initialized');
      } catch (error) {
        console.error('❌ Failed to initialize Numista provider:', error);
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
    if (provider === 'numista') {
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
    const provider = this.providers.find(p => p.name.toLowerCase() === providerName.toLowerCase());
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
    const action = options.action || 'lookup';
    const providers = this.settings.enableFallback ?
      [this.activeProvider, ...this.providers.filter(p => p !== this.activeProvider), this.localProvider] :
      [this.activeProvider];

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
          result: 'success',
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
      result: 'fail',
      itemCount: 0,
      provider: '',
      duration: Date.now() - startTime,
      error: lastError ? lastError.message : 'All providers failed',
    });

    throw lastError || new Error('All catalog providers failed');
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
        action: 'search',
        query,
        result: 'fail',
        itemCount: 0,
        provider: '',
        duration: Date.now() - startTime,
        error: 'No catalog provider available',
      });
      throw new Error('No catalog provider available');
    }

    try {
      const results = await this.activeProvider.searchItems(query, filters);
      recordCatalogHistory({
        action: 'search',
        query,
        result: 'success',
        itemCount: results.length,
        provider: this.activeProvider.name,
        duration: Date.now() - startTime,
      });
      return results;
    } catch (error) {
      recordCatalogHistory({
        action: 'search',
        query,
        result: 'fail',
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
    const providers = this.settings.enableFallback ?
      [this.activeProvider, ...this.providers.filter(p => p !== this.activeProvider)] :
      [this.activeProvider];

    let lastError;

    for (const provider of providers) {
      if (!provider) continue;

      try {
        const value = await provider.getMarketValue(catalogId);
        recordCatalogHistory({
          action: 'market_value',
          query: catalogId,
          result: 'success',
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
      action: 'market_value',
      query: catalogId,
      result: 'fail',
      itemCount: 0,
      provider: '',
      duration: Date.now() - startTime,
      error: lastError ? lastError.message : 'All providers failed',
    });

    return 0; // Fallback to 0 if all providers fail
  }

  /**
   * Get provider status information
   * @returns {Object} Status of all providers
   */
  getProviderStatus() {
    return {
      active: this.activeProvider ? this.activeProvider.name : 'None',
      available: this.providers.map(p => p.name),
      settings: this.settings
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
let selectedNumistaResult = null;

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
  catalogHistory = catalogHistory.filter(
    (e) => e.timestamp >= cutoffStr
  );
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
    data = data.filter((e) =>
      Object.values(e).some((v) => String(v).toLowerCase().includes(f))
    );
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
// NUMISTA RESULTS MODAL — Search results + field picker UI
// =============================================================================

/**
 * Escape HTML for safe insertion into innerHTML
 * @param {string} str - Raw string
 * @returns {string} Escaped string
 */
const escapeHtmlCatalog = (str) =>
  String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Build a safe Numista catalogue URL from a catalog id.
 * Supports piece ids (e.g. "75250", "N#75250") and set ids (e.g. "S123", "N#S123").
 *
 * @param {string} catalogId - Raw catalog id
 * @returns {string} Absolute Numista URL or empty string when invalid
 */
const buildNumistaCatalogUrl = (catalogId) => {
  const raw = String(catalogId || '').trim();
  if (!raw) return '';

  // Strip N# prefix first, THEN detect S for sets
  const stripped = raw.replace(/^N#\s*/i, '').trim();
  const isSet = /^S/i.test(stripped);
  const clean = isSet ? stripped.replace(/^S/i, '').trim() : stripped;
  if (!/^\d+$/.test(clean)) return '';

  return isSet
    ? `https://en.numista.com/catalogue/set.php?id=${clean}`
    : `https://en.numista.com/catalogue/pieces${clean}.html`;
};

/**
 * Render a single result card HTML string
 * @param {Object} result - Normalized Numista item data
 * @param {number} index - Index in results array
 * @returns {string} HTML string
 */
/**
 * Render catalog ID as a clickable link (when URL is available) or plain span.
 * @param {string} catalogId - Raw catalog ID from Numista
 * @returns {string} HTML string
 */
const renderCatalogIdAction = (catalogId) => {
  const numistaUrl = buildNumistaCatalogUrl(catalogId);
  const catalogIdLabel = `N#${escapeHtmlCatalog(catalogId)}`;
  return numistaUrl
    ? `<button type="button" class="numista-result-id numista-result-id-link" onclick="openNumistaModal('${escapeHtmlCatalog(catalogId)}','')" aria-label="Open ${catalogIdLabel} on Numista">${catalogIdLabel}</button>`
    : `<span class="numista-result-id">${catalogIdLabel}</span>`;
};

const renderNumistaResultCard = (result, index) => {
  const placeholder = `<div class="numista-img-placeholder">🪙</div>`;
  const obverseImg = result.imageUrl
    ? `<img src="${escapeHtmlCatalog(result.imageUrl)}" alt="Obverse" loading="lazy">`
    : placeholder;
  const reverseImg = result.reverseImageUrl
    ? `<img src="${escapeHtmlCatalog(result.reverseImageUrl)}" alt="Reverse" loading="lazy">`
    : '';
  const meta = [
    result.year,
    result.country,
    result.metal,
    result.weight ? `${result.weight}g` : '',
    result.type
  ].filter(Boolean).join(' · ');
  const catalogIdAction = renderCatalogIdAction(result.catalogId);

  return `<div class="numista-result-card" data-result-index="${index}">
    <div class="numista-result-images">${obverseImg}${reverseImg}</div>
    <div class="numista-result-info">
      <div class="numista-result-name">${escapeHtmlCatalog(result.name)}</div>
      <div class="numista-result-meta">${escapeHtmlCatalog(meta)}</div>
      <div class="numista-result-footer">
        ${catalogIdAction}
      </div>
    </div>
  </div>`;
};

/**
 * Render the selected item preview in field picker
 * @param {Object} result - Normalized Numista item data
 * @returns {string} HTML string
 */
const renderNumistaSelectedItem = (result) => {
  const placeholder = `<div class="numista-img-placeholder">🪙</div>`;
  const obverseImg = result.imageUrl
    ? `<img src="${escapeHtmlCatalog(result.imageUrl)}" alt="Obverse" loading="lazy">`
    : placeholder;
  const reverseImg = result.reverseImageUrl
    ? `<img src="${escapeHtmlCatalog(result.reverseImageUrl)}" alt="Reverse" loading="lazy">`
    : '';
  const meta = [
    result.year,
    result.country,
    result.metal,
    result.weight ? `${result.weight}g` : '',
    result.type
  ].filter(Boolean).join(' · ');
  const catalogIdAction = renderCatalogIdAction(result.catalogId);

  return `<div class="numista-result-images">${obverseImg}${reverseImg}</div>
    <div class="numista-result-info">
      <div class="numista-result-name">${escapeHtmlCatalog(result.name)}</div>
      <div class="numista-result-meta">${escapeHtmlCatalog(meta)}</div>
      <div class="numista-result-footer">
        ${catalogIdAction}
      </div>
    </div>`;
};

/**
 * Check if a value matches a valid <select> option
 * @param {string} selectId - DOM id of the select element
 * @param {string} value - Value to check
 * @returns {boolean}
 */
const isValidSelectOption = (selectId, value) => {
  const el = document.getElementById(selectId);
  if (!el) return false;
  return Array.from(el.options).some(o => o.value === value);
};

/**
 * Render field checkboxes with editable input fields for the selected result.
 * Each row: [checkbox] [label] [editable text input]
 * User can tweak values before hitting "Fill Fields".
 * @param {Object} result - Normalized Numista item data
 */
const renderNumistaFieldCheckboxes = (result) => {
  const container = document.getElementById('numistaFieldCheckboxes');
  if (!container) return;

  const typeValid = result.type && isValidSelectOption('itemType', result.type);
  const metalValid = result.metal && result.metal !== 'Alloy/Other' && isValidSelectOption('itemMetal', result.metal);

  // Fields ordered: primary (checked by default) first, then optional (unchecked)
  const fields = [
    { key: 'name', label: 'Name', value: result.name || '', available: true, defaultOn: true },
    { key: 'catalog', label: 'Catalog N#', value: result.catalogId || '', available: true, defaultOn: true },
    { key: 'year', label: 'Year', value: result.year || '', available: !!result.year, defaultOn: false },
    {
      key: 'type', label: 'Type',
      value: result.type || '',
      available: typeValid,
      defaultOn: false,
      warn: result.type && !typeValid ? `"${result.type}" — not in form options` : ''
    },
    { key: 'weight', label: 'Weight (g)', value: result.weight ? String(result.weight) : '', available: result.weight > 0, defaultOn: result.weight > 0 },
    { key: 'obverseImage', label: 'Obverse Image', value: result.imageUrl || '', available: !!result.imageUrl, defaultOn: true },
    { key: 'reverseImage', label: 'Reverse Image', value: result.reverseImageUrl || '', available: !!result.reverseImageUrl, defaultOn: true },
    { key: 'metal', label: 'Metal', value: result.metal || '', available: metalValid, defaultOn: metalValid, warn: result.metal && !metalValid ? `"${result.metal}" — not in form options` : '' },
  ];

  // Keep the heading, rebuild field rows
  const heading = container.querySelector('.numista-fields-heading');
  container.innerHTML = '';
  if (heading) {
    container.appendChild(heading);
  } else {
    const h = document.createElement('div');
    h.className = 'numista-fields-heading';
    h.textContent = 'Fields to fill:';
    container.appendChild(h);
  }

  // Map field keys to current form values for "Current:" hints
  const currentFormValues = {
    name: (elements.itemName || safeGetElement('itemName'))?.value?.trim() || '',
    catalog: (elements.itemCatalog || safeGetElement('itemCatalog'))?.value?.trim() || '',
    year: (elements.itemYear || safeGetElement('itemYear'))?.value?.trim() || '',
    type: (elements.itemType || safeGetElement('itemType'))?.value || '',
    weight: (elements.itemWeight || safeGetElement('itemWeight'))?.value?.trim() || '',
    obverseImage: (elements.itemObverseImageUrl || safeGetElement('itemObverseImageUrl'))?.value?.trim() || '',
    reverseImage: (elements.itemReverseImageUrl || safeGetElement('itemReverseImageUrl'))?.value?.trim() || '',
    metal: (elements.itemMetal || safeGetElement('itemMetal'))?.value || '',
  };

  fields.forEach(f => {
    // Checkbox — grid column 1
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.name = 'numistaField';
    cb.value = f.key;
    cb.checked = f.available && !!f.value && f.defaultOn;
    if (!f.value) cb.disabled = true;

    // Label — grid column 2
    const label = document.createElement('span');
    label.className = 'numista-field-label';
    label.textContent = f.label + ':';

    // Editable text input — grid column 3
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'numista-field-input';
    input.name = 'numistaFieldValue_' + f.key;
    input.value = f.value;
    input.placeholder = f.available ? '' : 'N/A';
    if (!f.available && !f.value) input.disabled = true;

    // Toggle input enabled/disabled when checkbox changes
    cb.addEventListener('change', () => { input.disabled = !cb.checked; });
    if (!cb.checked) input.disabled = true;

    container.appendChild(cb);
    container.appendChild(label);
    container.appendChild(input);

    // "Current:" hint showing existing form value (helps user compare before filling)
    const currentVal = currentFormValues[f.key];
    if (currentVal) {
      const hint = document.createElement('div');
      hint.className = 'numista-field-current';
      hint.textContent = `Current: ${currentVal}`;
      hint.title = currentVal;
      container.appendChild(hint);
    }

    // Warning text spanning all columns (e.g. "Alloy/Other — not in form options")
    if (f.warn) {
      const warn = document.createElement('div');
      warn.className = 'numista-field-warn';
      warn.textContent = f.warn;
      container.appendChild(warn);
    }
  });
};

/**
 * Curated list of popular bullion items for quick-pick in the no-results modal.
 * Focused on items silver/gold stackers commonly own.
 * @returns {Array<{id: string, name: string, metal: string}>}
 */
const getPopularNumistaItems = () => [
  // Silver bullion
  { id: '1493',   name: 'American Silver Eagle',         metal: 'Silver' },
  { id: '298883', name: 'American Silver Eagle (New Rev)', metal: 'Silver' },
  { id: '9164',   name: 'Canadian Silver Maple Leaf',    metal: 'Silver' },
  { id: '13410',  name: 'British Silver Britannia',      metal: 'Silver' },
  { id: '9165',   name: 'Austrian Silver Philharmonic',  metal: 'Silver' },
  { id: '13855',  name: 'Mexican Silver Libertad',       metal: 'Silver' },
  { id: '143754', name: 'Silver Krugerrand',             metal: 'Silver' },
  // Gold bullion
  { id: '23134',  name: 'American Gold Eagle',           metal: 'Gold' },
  { id: '18451',  name: 'American Gold Buffalo',         metal: 'Gold' },
  { id: '6002',   name: 'Gold Krugerrand',               metal: 'Gold' },
  { id: '15150',  name: 'Austrian Gold Philharmonic',    metal: 'Gold' },
  // Classic silver
  { id: '1492',   name: 'Morgan Dollar',                 metal: 'Silver' },
  { id: '5580',   name: 'Peace Dollar',                  metal: 'Silver' },
];

/**
 * Show Numista results modal with search results
 * @param {Array} results - Array of normalized Numista item data
 * @param {boolean} directLookup - If true and single result, skip list and show field picker
 * @param {string} originalQuery - The search query used (for retry pre-fill)
 */
const showNumistaResults = (results, directLookup = false, originalQuery = '') => {
  const modal = document.getElementById('numistaResultsModal');
  const list = document.getElementById('numistaResultsList');
  const picker = document.getElementById('numistaFieldPicker');
  const title = document.getElementById('numistaResultsTitle');
  const preview = document.getElementById('numistaSelectedItem');
  if (!modal || !list || !picker) return;

  selectedNumistaResult = null;
  list.innerHTML = '';
  picker.style.display = 'none';

  if (!results || results.length === 0) {
    title.textContent = 'No Results';

    // Build quick-picks from curated popular items
    const popularItems = getPopularNumistaItems();
    const quickPicksHtml = `<div class="numista-quick-picks">
        <p class="numista-quick-picks-label">Popular bullion items:</p>
        <div class="numista-quick-picks-list">
          ${popularItems.map(item =>
            `<button type="button" class="numista-quick-pick" data-numista-id="${escapeHtmlCatalog(item.id)}">
              <span class="quick-pick-id">N#${escapeHtmlCatalog(item.id)}</span>
              <span class="quick-pick-name">${escapeHtmlCatalog(item.name)}</span>
              <span class="quick-pick-count">${escapeHtmlCatalog(item.metal)}</span>
            </button>`
          ).join('')}
        </div>
      </div>`;

    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
    list.innerHTML = `<div class="numista-no-results-enhanced">
      <div class="numista-retry-search">
        <p>No matching items found on Numista.</p>
        <div class="numista-retry-row">
          <input type="text" id="numistaRetryInput" class="numista-retry-input"
                 placeholder="Refine your search..." value="${escapeHtmlCatalog(originalQuery)}">
          <button type="button" id="numistaRetryBtn" class="btn premium numista-retry-btn">Search</button>
        </div>
      </div>
      ${quickPicksHtml}
    </div>`;
    list.style.display = 'block';
    modal.style.display = 'flex';

    // Wire up retry search
    const retryBtn = document.getElementById('numistaRetryBtn');
    const retryInput = document.getElementById('numistaRetryInput');
    if (retryBtn && retryInput) {
      const doRetry = async () => {
        const query = retryInput.value.trim();
        if (!query) return;
        retryBtn.disabled = true;
        retryBtn.textContent = 'Searching\u2026';
        try {
          const retryResults = await catalogAPI.searchItems(query, { limit: 20 });
          showNumistaResults(retryResults, false, query);
        } catch (err) {
          console.error('Numista retry search failed:', err);
          retryBtn.textContent = 'Failed';
          setTimeout(() => { retryBtn.textContent = 'Search'; retryBtn.disabled = false; }, 1500);
        }
      };
      retryBtn.addEventListener('click', doRetry);
      retryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doRetry(); });
      // Auto-focus the search input for quick editing
      setTimeout(() => retryInput.select(), 50);
    }

    // Wire up quick-pick clicks
    list.querySelectorAll('.numista-quick-pick').forEach(pickBtn => {
      pickBtn.addEventListener('click', async () => {
        const nId = pickBtn.dataset.numistaId;
        if (!nId) return;
        pickBtn.style.opacity = '0.5';
        pickBtn.disabled = true;
        try {
          const result = await catalogAPI.lookupItem(nId);
          showNumistaResults(result ? [result] : [], true, nId);
        } catch (err) {
          console.error('Numista quick-pick lookup failed:', err);
          pickBtn.style.opacity = '1';
          pickBtn.disabled = false;
        }
      });
    });

    return;
  }

  // Direct lookup with single result → skip to field picker
  if (directLookup && results.length === 1) {
    title.textContent = 'Numista Item Found';
    list.style.display = 'none';
    selectedNumistaResult = results[0];
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
    preview.innerHTML = renderNumistaSelectedItem(results[0]);
    renderNumistaFieldCheckboxes(results[0]);
    picker.style.display = 'block';
    modal.style.display = 'flex';
    return;
  }

  // Multiple results → show selectable card list with search refinement
  title.textContent = `Numista Results (${results.length})`;
  // Stash results on the list element for delegated click retrieval
  list._numistaResults = results;

  // Build refinement search bar + result cards
  const searchBarHtml = `<div class="numista-refine-search">
    <input type="text" id="numistaRefineInput" class="numista-refine-input"
           placeholder="Refine search..." value="${escapeHtmlCatalog(originalQuery)}">
    <button type="button" id="numistaRefineBtn" class="btn premium numista-refine-btn">Search</button>
  </div>`;
  const cardsHtml = results.slice(0, 20).map((r, i) => renderNumistaResultCard(r, i)).join('');
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
  list.innerHTML = searchBarHtml + cardsHtml;
  list.style.display = 'flex';
  modal.style.display = 'flex';

  // Wire up refinement search
  const refineBtn = document.getElementById('numistaRefineBtn');
  const refineInput = document.getElementById('numistaRefineInput');
  if (refineBtn && refineInput) {
    const doRefine = async () => {
      const query = refineInput.value.trim();
      if (!query) return;
      refineBtn.disabled = true;
      refineBtn.textContent = 'Searching\u2026';
      try {
        const refineResults = await catalogAPI.searchItems(query, { limit: 20 });
        showNumistaResults(refineResults, false, query);
      } catch (err) {
        console.error('Numista refine search failed:', err);
        refineBtn.textContent = 'Failed';
        setTimeout(() => { refineBtn.textContent = 'Search'; refineBtn.disabled = false; }, 1500);
      }
    };
    refineBtn.addEventListener('click', doRefine);
    refineInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doRefine(); });
    setTimeout(() => refineInput.select(), 50);
  }
};

/**
 * Fill form fields from the editable picker inputs.
 * Reads values from the numistaFieldValue_* text inputs (user may have edited them).
 */
const fillFormFromNumistaResult = () => {
  const container = document.getElementById('numistaFieldCheckboxes');
  if (!container) return;

  // Collect checked fields and their edited values from the picker inputs
  const checkboxes = container.querySelectorAll('input[name="numistaField"]');

  // Intercept for bulk edit — when callback is set, route field values there instead
  if (typeof window._bulkEditNumistaCallback === 'function') {
    const fieldMap = {};
    checkboxes.forEach(cb => {
      if (!cb.checked) return;
      const input = container.querySelector('input[name="numistaFieldValue_' + cb.value + '"]');
      if (input && input.value.trim()) fieldMap[cb.value] = input.value.trim();
    });
    window._bulkEditNumistaCallback(fieldMap);
    window._bulkEditNumistaCallback = null;
    closeNumistaResultsModal();
    return;
  }

  checkboxes.forEach(cb => {
    if (!cb.checked) return;
    const input = container.querySelector(`input[name="numistaFieldValue_${cb.value}"]`);
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;

    switch (cb.value) {
      case 'name': {
        const el = elements.itemName || safeGetElement('itemName');
        if (el) el.value = val;
        break;
      }
      case 'year': {
        const el = elements.itemYear || safeGetElement('itemYear');
        if (el) el.value = val;
        break;
      }
      case 'type': {
        const el = elements.itemType || safeGetElement('itemType');
        if (el) {
          const valid = Array.from(el.options).map(o => o.value);
          if (valid.includes(val)) el.value = val;
        }
        break;
      }
      case 'weight': {
        const el = elements.itemWeight || safeGetElement('itemWeight');
        const unitEl = safeGetElement('itemWeightUnit');
        const num = parseFloat(val);
        if (el && !isNaN(num) && num > 0) {
          el.value = num;
          if (unitEl) unitEl.value = 'g';
        }
        break;
      }
      case 'catalog': {
        const el = elements.itemCatalog || safeGetElement('itemCatalog');
        if (el) el.value = val;
        break;
      }
      case 'obverseImage': {
        const el = elements.itemObverseImageUrl || safeGetElement('itemObverseImageUrl');
        if (el && !el.value.trim()) el.value = val;
        break;
      }
      case 'reverseImage': {
        const el = elements.itemReverseImageUrl || safeGetElement('itemReverseImageUrl');
        if (el && !el.value.trim()) el.value = val;
        break;
      }
      case 'metal': {
        const el = elements.itemMetal || safeGetElement('itemMetal');
        if (el) {
          const valid = Array.from(el.options).map(o => o.value);
          if (valid.includes(val)) el.value = val;
        }
        break;
      }
    }
  });

  // Auto-populate Numista Data fields from the selected result (STAK-173)
  if (selectedNumistaResult && typeof populateNumistaDataFields === 'function') {
    // Cache the metadata first so populateNumistaDataFields can read it
    const catId = selectedNumistaResult.catalogId;
    if (catId && window.imageCache?.isAvailable()) {
      imageCache.cacheMetadata(catId, selectedNumistaResult).then(() => {
        populateNumistaDataFields(catId);
      }).catch(() => {});
    }
  }
};

/**
 * Close Numista results modal and clean up state
 */
const closeNumistaResultsModal = () => {
  const modal = document.getElementById('numistaResultsModal');
  if (modal) modal.style.display = 'none';
  selectedNumistaResult = null;
};

// Test function for Numista API
async function testNumistaAPI() {
  if (!catalogConfig.isNumistaEnabled()) {
    console.log('❌ Numista API not configured');
    return;
  }

  console.log('🧪 Testing Numista API...');
  
  try {
    // Test with a known coin ID (American Silver Eagle)
    const testId = '5685'; // This is a common test ID for American Silver Eagle 1986
    const result = await catalogAPI.lookupItem(testId, { action: 'test' });
    console.log('✅ Numista API test successful:', result);
    return result;
  } catch (error) {
    console.error('❌ Numista API test failed:', error);
    return null;
  }
}

/**
 * Renders Numista API usage progress bar into #numistaUsageBar
 * Reuses the same .api-usage / .usage-bar / .usage-text CSS as metals providers
 */
const renderNumistaUsageBar = () => {
  const container = document.getElementById('numistaUsageBar');
  if (!container) return;
  const usage = catalogConfig.getNumistaUsage();
  // Coerce to safe finite numbers and validate month format
  const used = Number.isFinite(usage.used) ? Math.max(0, usage.used) : 0;
  const quota = Number.isFinite(usage.quota) && usage.quota > 0 ? usage.quota : 2000;
  const month = /^\d{4}-\d{2}$/.test(usage.month) ? usage.month : '';
  const usedPercent = Math.min((used / quota) * 100, 100);
  const remainingPercent = 100 - usedPercent;
  const warning = used / quota >= 0.9;

  // Build DOM nodes safely (no innerHTML with localStorage-sourced values)
  container.textContent = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'api-usage';
  const bar = document.createElement('div');
  bar.className = 'usage-bar';
  const usedDiv = document.createElement('div');
  usedDiv.className = 'used';
  usedDiv.style.width = `${usedPercent}%`;
  const remainDiv = document.createElement('div');
  remainDiv.className = 'remaining';
  remainDiv.style.width = `${remainingPercent}%`;
  bar.appendChild(usedDiv);
  bar.appendChild(remainDiv);
  const text = document.createElement('div');
  text.className = 'usage-text';
  text.textContent = `${used}/${quota} calls${month ? ` (${month})` : ''}${warning ? ' 🚩' : ''}`;
  wrapper.appendChild(bar);
  wrapper.appendChild(text);
  container.appendChild(wrapper);
};

/**
 * Renders PCGS API usage progress bar into #pcgsUsageBar
 * Clones the Numista pattern but uses daily granularity (1,000/day)
 */
const renderPcgsUsageBar = () => {
  const container = document.getElementById('pcgsUsageBar');
  if (!container) return;
  const usage = catalogConfig.getPcgsUsage();
  const used = Number.isFinite(usage.used) ? Math.max(0, usage.used) : 0;
  const quota = Number.isFinite(usage.limit) && usage.limit > 0 ? usage.limit : 1000;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(usage.date) ? usage.date : '';
  const usedPercent = Math.min((used / quota) * 100, 100);
  const remainingPercent = 100 - usedPercent;
  const warning = used / quota >= 0.9;

  container.textContent = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'api-usage';
  const bar = document.createElement('div');
  bar.className = 'usage-bar';
  const usedDiv = document.createElement('div');
  usedDiv.className = 'used';
  usedDiv.style.width = `${usedPercent}%`;
  const remainDiv = document.createElement('div');
  remainDiv.className = 'remaining';
  remainDiv.style.width = `${remainingPercent}%`;
  bar.appendChild(usedDiv);
  bar.appendChild(remainDiv);
  const text = document.createElement('div');
  text.className = 'usage-text';
  text.textContent = `${used}/${quota} calls${day ? ` (${day})` : ''}${warning ? ' \uD83D\uDEA9' : ''}`;
  wrapper.appendChild(bar);
  wrapper.appendChild(text);
  container.appendChild(wrapper);
};

// =============================================================================
// CATALOG HISTORY — SETTINGS LOG TABLE
// =============================================================================

/** @type {string} Sort column for settings catalog history table */
let settingsCatalogSortColumn = '';
/** @type {boolean} Sort ascending for settings catalog history table */
let settingsCatalogSortAsc = true;

/**
 * Renders the catalog history table in the Settings > Activity Log > Catalogs sub-tab.
 * Reads from global catalogHistory, sorts by timestamp descending by default.
 */
const renderCatalogHistoryForSettings = () => {
  const table = document.getElementById('settingsCatalogHistoryTable');
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

  const tbody = table.querySelector('tbody');
  if (!tbody) return;

  if (data.length === 0) {
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
    tbody.innerHTML = '<tr class="settings-log-empty"><td colspan="7">No catalog history recorded yet.</td></tr>';
    return;
  }

  const rows = data.map(e => {
    const resultClass = e.result === 'fail' ? ' style="color: var(--danger, #e74c3c);"' : '';
    const errorTitle = e.error ? ` title="${String(e.error).replace(/"/g, '&quot;')}"` : '';
    return `<tr><td>${e.timestamp || ''}</td><td>${e.action || ''}</td><td>${e.query || ''}</td><td${resultClass}${errorTitle}>${e.result || ''}</td><td>${e.itemCount || 0}</td><td>${e.provider || ''}</td><td>${e.duration || 0}ms</td></tr>`;
  });

  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  tbody.innerHTML = rows.join('');

  // Sortable headers
  table.querySelectorAll('th').forEach(th => {
    th.style.cursor = 'pointer';
    th.onclick = () => {
      const cols = ['timestamp', 'action', 'query', 'result', 'itemCount', 'provider', 'duration'];
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
  const confirmed = await appConfirm('Clear all catalog history? This cannot be undone.', 'Catalog History');
  if (!confirmed) return;
  catalogHistory = [];
  saveCatalogHistory();
  const panel = document.getElementById('logPanel_catalogs');
  if (panel) delete panel.dataset.rendered;
  renderCatalogHistoryForSettings();
};

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.catalogAPI = catalogAPI;
  window.catalogConfig = catalogConfig;
  window.testNumistaAPI = testNumistaAPI;
  window.CatalogAPI = CatalogAPI;
  window.NumistaProvider = NumistaProvider;
  window.LocalProvider = LocalProvider;
  window.showCatalogHistoryModal = showCatalogHistoryModal;
  window.hideCatalogHistoryModal = hideCatalogHistoryModal;
  window.recordCatalogHistory = recordCatalogHistory;
  window.loadCatalogHistory = loadCatalogHistory;
  window.saveCatalogHistory = saveCatalogHistory;
  window.showNumistaResults = showNumistaResults;
  window.fillFormFromNumistaResult = fillFormFromNumistaResult;
  window.closeNumistaResultsModal = closeNumistaResultsModal;
  window.renderNumistaUsageBar = renderNumistaUsageBar;
  window.renderPcgsUsageBar = renderPcgsUsageBar;
  window.renderCatalogHistoryForSettings = renderCatalogHistoryForSettings;
  window.clearCatalogHistory = clearCatalogHistory;
  // STAK-222: Numista response cache
  window.loadNumistaCache = loadNumistaCache;
  window.saveNumistaCache = saveNumistaCache;
  window.clearNumistaCache = clearNumistaCache;
  window.getNumistaCacheCount = getNumistaCacheCount;
}

// Initialize UI event handlers when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  // Numista API key input handler
  const numistaApiKeyInput = document.getElementById('numistaApiKey');
  const saveNumistaBtn = document.getElementById('saveNumistaBtn');
  const testNumistaBtn = document.getElementById('testNumistaBtn');
  const clearNumistaBtn = document.getElementById('clearNumistaBtn');

  if (numistaApiKeyInput) {
    // Load existing API key
    const existingConfig = catalogConfig.getNumistaConfig();
    if (existingConfig.apiKey) {
      numistaApiKeyInput.value = existingConfig.apiKey;
    }

    // Save API key when input changes
    numistaApiKeyInput.addEventListener('change', function() {
      const apiKey = this.value.trim();
      if (apiKey) {
        catalogConfig.setNumistaConfig(apiKey, 2000);
        catalogAPI.initializeProviders();
        console.log('✅ Numista API key saved');
      }
    });
  }

  // Save key button
  if (saveNumistaBtn) {
    saveNumistaBtn.addEventListener('click', function() {
      const apiKey = numistaApiKeyInput?.value.trim();
      if (!apiKey) {
        appAlert('Please enter your Numista API key first');
        return;
      }
      catalogConfig.setNumistaConfig(apiKey, 2000);
      catalogAPI.initializeProviders();
      renderNumistaUsageBar();
      appAlert('Numista API key saved.');
    });
  }

  // Test connection button
  if (testNumistaBtn) {
    testNumistaBtn.addEventListener('click', async function() {
      const apiKey = numistaApiKeyInput?.value.trim();
      if (!apiKey) {
        appAlert('Please enter your Numista API key first');
        return;
      }

      // Save the key first
      catalogConfig.setNumistaConfig(apiKey, 2000);
      catalogAPI.initializeProviders();

      // Test the connection
      this.textContent = 'Testing...';
      this.disabled = true;

      try {
        const result = await testNumistaAPI();
        if (result) {
          renderNumistaUsageBar();
          appAlert('✅ Numista API connection successful!');
        } else {
          appAlert('❌ Numista API connection failed. Please check your API key.');
        }
      } catch (error) {
        appAlert('❌ Connection failed: ' + error.message);
      } finally {
        this.textContent = 'Test Connection';
        this.disabled = false;
      }
    });
  }

  // Clear API key button
  if (clearNumistaBtn) {
    clearNumistaBtn.addEventListener('click', async function() {
      if (await appConfirm('Are you sure you want to clear your Numista API key?', 'Numista API')) {
        catalogConfig.clearNumistaKey();
        if (numistaApiKeyInput) {
          numistaApiKeyInput.value = '';
        }
        catalogAPI.initializeProviders();
        console.log('🗑️ Numista API key cleared');
      }
    });
  }

  // =========================================================================
  // PCGS API — settings UI event wiring
  // =========================================================================

  const pcgsTokenInput = document.getElementById('pcgsBearerToken');
  const savePcgsBtn = document.getElementById('savePcgsBtn');
  const testPcgsBtn = document.getElementById('testPcgsBtn');
  const clearPcgsBtn = document.getElementById('clearPcgsBtn');
  const pcgsStatus = document.getElementById('pcgsStatus');

  if (pcgsTokenInput) {
    const existingPcgs = catalogConfig.getPcgsConfig();
    if (existingPcgs.bearerToken) {
      pcgsTokenInput.value = existingPcgs.bearerToken;
    }
  }

  if (savePcgsBtn) {
    savePcgsBtn.addEventListener('click', function() {
      const token = pcgsTokenInput?.value.trim();
      if (!token) {
        appAlert('Please enter your PCGS bearer token first');
        return;
      }
      catalogConfig.setPcgsConfig(token);
      if (pcgsStatus) pcgsStatus.textContent = 'Token saved.';
      // Update provider status indicator and header status row
      const statusEl = document.getElementById('pcgsProviderStatus');
      if (statusEl) {
        statusEl.querySelector('.status-dot')?.classList.add('connected');
        const txt = statusEl.querySelector('.status-text');
        if (txt) txt.textContent = 'Connected';
      }
      if (typeof renderApiStatusSummary === 'function') renderApiStatusSummary();
      renderPcgsUsageBar();
      appAlert('PCGS bearer token saved.');
    });
  }

  if (testPcgsBtn) {
    testPcgsBtn.addEventListener('click', async function() {
      const token = pcgsTokenInput?.value.trim();
      if (!token) {
        appAlert('Please enter your PCGS bearer token first');
        return;
      }

      // Save first
      catalogConfig.setPcgsConfig(token);

      this.textContent = 'Testing...';
      this.disabled = true;

      try {
        if (typeof verifyPcgsCert === 'function') {
          const result = await verifyPcgsCert('00000000');
          // Even a "not found" response means the API is reachable
          if (pcgsStatus) pcgsStatus.textContent = 'Connected — API reachable.';
          appAlert('PCGS API connection successful!');
        } else {
          if (pcgsStatus) pcgsStatus.textContent = 'pcgs-api.js not loaded.';
          appAlert('PCGS API module not loaded. Ensure pcgs-api.js is included.');
        }
      } catch (error) {
        const msg = error.message || 'Unknown error';
        if (pcgsStatus) pcgsStatus.textContent = 'Connection failed: ' + msg;
        appAlert('PCGS API connection failed: ' + msg);
      } finally {
        this.textContent = 'Test Connection';
        this.disabled = false;
      }
    });
  }

  if (clearPcgsBtn) {
    clearPcgsBtn.addEventListener('click', async function() {
      if (await appConfirm('Are you sure you want to clear your PCGS bearer token?', 'PCGS API')) {
        catalogConfig.clearPcgsToken();
        if (pcgsTokenInput) pcgsTokenInput.value = '';
        if (pcgsStatus) pcgsStatus.textContent = 'Token cleared.';
        // Update provider status indicator and header status row
        const statusEl = document.getElementById('pcgsProviderStatus');
        if (statusEl) {
          statusEl.querySelector('.status-dot')?.classList.remove('connected');
          const txt = statusEl.querySelector('.status-text');
          if (txt) txt.textContent = 'Disconnected';
        }
        if (typeof renderApiStatusSummary === 'function') renderApiStatusSummary();
      }
    });
  }

  // =========================================================================
  // NUMISTA RESULTS MODAL — event wiring
  // =========================================================================

  const numistaResultsModal = document.getElementById('numistaResultsModal');
  const numistaResultsCloseBtn = document.getElementById('numistaResultsCloseBtn');
  const numistaFillCancelBtn = document.getElementById('numistaFillCancelBtn');
  const numistaFillBtn = document.getElementById('numistaFillBtn');
  const numistaResultsList = document.getElementById('numistaResultsList');

  // Close button
  if (numistaResultsCloseBtn) {
    numistaResultsCloseBtn.addEventListener('click', closeNumistaResultsModal);
  }

  // Cancel button in field picker
  if (numistaFillCancelBtn) {
    numistaFillCancelBtn.addEventListener('click', closeNumistaResultsModal);
  }

  // Fill Fields button
  if (numistaFillBtn) {
    numistaFillBtn.addEventListener('click', function() {
      if (selectedNumistaResult) {
        fillFormFromNumistaResult();

        // Fire-and-forget: cache metadata in IndexedDB
        if (window.imageCache?.isAvailable() && selectedNumistaResult.catalogId &&
            window.featureFlags?.isEnabled('COIN_IMAGES')) {
          imageCache.cacheMetadata(
            selectedNumistaResult.catalogId,
            selectedNumistaResult
          ).catch(e => console.warn('Metadata cache failed:', e));
        }
      }
      closeNumistaResultsModal();
    });
  }

  // Delegated click on result cards → select and show field picker
  if (numistaResultsList) {
    numistaResultsList.addEventListener('click', function(e) {
      // Let N# links open Numista without also selecting the row.
      const catalogLink = e.target.closest('.numista-result-id-link');
      if (catalogLink) {
        e.stopPropagation();
        return;
      }

      const results = numistaResultsList._numistaResults;
      const card = e.target.closest('.numista-result-card');
      if (!card) return;

      const index = parseInt(card.dataset.resultIndex, 10);
      if (!results || !results[index]) return;

      // Highlight selected card
      numistaResultsList.querySelectorAll('.numista-result-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');

      // Transition to field picker
      selectedNumistaResult = results[index];
      const preview = document.getElementById('numistaSelectedItem');
      const picker = document.getElementById('numistaFieldPicker');
      const title = document.getElementById('numistaResultsTitle');
      // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
      if (preview) preview.innerHTML = renderNumistaSelectedItem(selectedNumistaResult);
      renderNumistaFieldCheckboxes(selectedNumistaResult);
      if (numistaResultsList) numistaResultsList.style.display = 'none';
      if (picker) picker.style.display = 'block';
      if (title) title.textContent = 'Fill Form Fields';
    });
  }

  // Background click dismiss
  if (numistaResultsModal) {
    numistaResultsModal.addEventListener('click', function(e) {
      if (e.target === numistaResultsModal) {
        closeNumistaResultsModal();
      }
    });
  }

  // ESC key handler — results modal has higher z-index, check it first
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const resultsModal = document.getElementById('numistaResultsModal');
      if (resultsModal && resultsModal.style.display !== 'none') {
        e.stopImmediatePropagation();
        closeNumistaResultsModal();
      }
    }
  });
});

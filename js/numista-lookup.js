/**
 * Numista Search Lookup Module
 * Pattern-based query rewriting for improved Numista search results.
 * Matches user input against known coin naming patterns and rewrites
 * queries to use Numista's canonical naming convention.
 *
 * Follows the IIFE module pattern used by customMapping.js.
 */

const NumistaLookup = (() => {
  // =========================================================================
  // CUSTOM RULES — user-created, persisted to localStorage
  // =========================================================================

  /** @type {Array<{id: string, pattern: string, replacement: string, numistaId: string|null, builtIn: boolean}>} */
  let customRules = [];

  /** Compiled regex cache: id → RegExp */
  const compiledRegex = new Map();

  /**
   * Compiles and caches a regex for the given rule.
   * @param {Object} rule - Rule with pattern string
   * @returns {RegExp|null} Compiled regex or null on error
   */
  const getRegex = (rule) => {
    if (compiledRegex.has(rule.id)) return compiledRegex.get(rule.id);
    try {
      const re = new RegExp(rule.pattern, "i");
      compiledRegex.set(rule.id, re);
      return re;
    } catch (e) {
      console.warn("NumistaLookup: invalid regex for rule", rule.id, e);
      return null;
    }
  };

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  /**
   * Matches user input against all rules (custom first, then seed).
   * Custom rules take priority so users can override built-in behavior.
   * @param {string} userInput - Raw search text from the user
   * @returns {{ rule: Object, replacement: string, numistaId: string|null }|null}
   */
  const matchQuery = (userInput) => {
    if (!userInput || typeof userInput !== "string") return null;
    const text = userInput.trim();
    if (!text) return null;

    // Check custom rules first (user overrides)
    for (const rule of customRules) {
      const re = getRegex(rule);
      if (re && re.test(text)) {
        return { rule, replacement: rule.replacement, numistaId: rule.numistaId || null };
      }
    }

    return null;
  };

  /**
   * Adds a custom rule, validates the regex, and persists.
   * @param {string} pattern - Regex pattern string
   * @param {string} replacement - Rewritten Numista query
   * @param {string} [numistaId] - Optional Numista N# for direct lookup
   * @returns {{ success: boolean, error: (string|undefined) }}
   */
  const addRule = (pattern, replacement, numistaId, seedImageId) => {
    if (!pattern || !replacement) {
      return { success: false, error: "Pattern and replacement are required." };
    }

    // Validate regex
    try {
      new RegExp(pattern, "i");
    } catch (e) {
      return { success: false, error: "Invalid regex pattern: " + e.message };
    }

    // Security enhancement: prefer CSPRNG via generateUUID(); fall back to
    // crypto.getRandomValues() to maintain cryptographic strength when
    // generateUUID is not yet in scope (unit tests, future refactors).
    const randomPart =
      typeof generateUUID === "function"
        ? generateUUID().split("-")[0]
        : Array.from(crypto.getRandomValues(new Uint8Array(4)))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    const id = "custom-" + Date.now() + "-" + randomPart;
    const rule = {
      id,
      pattern,
      replacement,
      numistaId: numistaId || null,
      seedImageId: seedImageId || null,
      builtIn: false,
    };

    customRules.push(rule);
    compiledRegex.delete(id); // clear any stale cache
    getRegex(rule); // eagerly compile
    saveCustomRules();
    return { success: true, id };
  };

  /**
   * Updates an existing custom rule by ID. Only specified fields are changed.
   * @param {string} id - Rule ID to update
   * @param {Object} updates - Fields to update (pattern, replacement, numistaId, seedImageId)
   * @returns {{ success: boolean, error: (string|undefined) }}
   */
  const updateRule = (id, updates) => {
    const rule = customRules.find((r) => r.id === id);
    if (!rule) return { success: false, error: "Rule not found." };

    if (updates.pattern !== undefined) {
      try {
        new RegExp(updates.pattern, "i");
      } catch (e) {
        return { success: false, error: "Invalid regex pattern: " + e.message };
      }
      rule.pattern = updates.pattern;
      compiledRegex.delete(id);
      getRegex(rule);
    }
    if (updates.replacement !== undefined) rule.replacement = updates.replacement;
    if (updates.numistaId !== undefined) rule.numistaId = updates.numistaId || null;
    if (updates.seedImageId !== undefined) rule.seedImageId = updates.seedImageId || null;

    saveCustomRules();
    return { success: true };
  };

  /**
   * Removes a custom rule by ID and persists.
   * @param {string} id - Rule ID to remove
   */
  const removeRule = (id) => {
    customRules = customRules.filter((r) => r.id !== id);
    compiledRegex.delete(id);
    saveCustomRules();
  };

  /**
   * Returns only custom (user-created) rules.
   * @returns {Array}
   */
  const getCustomRules = () => [...customRules];

  /**
   * Persists custom rules to localStorage as JSON.
   */
  const saveCustomRules = () => {
    try {
      const data = customRules.map((r) => ({
        id: r.id,
        pattern: r.pattern,
        replacement: r.replacement,
        numistaId: r.numistaId,
        seedImageId: r.seedImageId || null,
        builtIn: false,
      }));
      localStorage.setItem("numistaLookupRules", JSON.stringify(data));
    } catch (e) {
      console.warn("NumistaLookup: failed to save custom rules:", e);
    }
  };

  /**
   * Loads custom rules from localStorage. Called during app init.
   */
  const loadCustomRules = () => {
    let raw = null;
    try {
      raw = localStorage.getItem("numistaLookupRules");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          customRules = parsed.map((r) => ({
            id: r.id || "custom-" + Date.now(),
            pattern: r.pattern || "",
            replacement: r.replacement || "",
            numistaId: r.numistaId || null,
            seedImageId: r.seedImageId || null,
            builtIn: false,
          }));
          // Compile custom rule regexes
          for (const rule of customRules) {
            getRegex(rule);
          }
        }
      }

      // STAK-437: Pre-seed ASE pattern for new users (only when numistaLookupRules key
      // has never been set). Once the key exists — even as "[]" — we never pre-seed again.
      if (raw === null) {
        addRule(
          "\\b(american\\s+silver\\s+eagle|\\bASE\\b)",
          '"American Silver Eagle" Bullion',
          "1493"
        );
      }
    } catch (e) {
      console.warn("NumistaLookup: failed to load custom rules:", e);
      customRules = [];
    }
  };

  return {
    matchQuery,
    addRule,
    updateRule,
    removeRule,
    getCustomRules,
    loadCustomRules,
  };
})();

// Expose globally
if (typeof window !== "undefined") {
  window.NumistaLookup = NumistaLookup;
}

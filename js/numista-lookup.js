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

  /** @type {Array<{id: string, pattern: string, replacement: string, numistaId: string|null, seedImageId: string|null, builtIn: boolean}>} */
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

  /**
   * Derives a stable, content-based id for a rule persisted without one
   * (legacy / imported / malformed data). Reuses the global simpleHash so the id
   * is deterministic across reloads — id-less rules no longer collide on a shared
   * Date.now() millisecond or churn their identity on every load (STRK-202). The
   * image binding keys on seedImageId, not this id, so a derived id never changes
   * which pattern image renders.
   * @param {{pattern?: string, replacement?: string}} r - Rule-like object
   * @param {number} [index=0] - Position in the source list; disambiguates the
   *   fallback id when the global hash util is unavailable (isolated harnesses).
   * @returns {string} Deterministic id, e.g. "custom-sh:1a2b3c"
   */
  const _deriveStableRuleId = (r, index = 0) =>
    typeof simpleHash === "function"
      ? "custom-" + simpleHash((r.pattern || "") + "|" + (r.replacement || ""))
      : "custom-idless-" + index;

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
          customRules = parsed.map((r, i) => ({
            id: r.id || _deriveStableRuleId(r, i),
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
    } catch (e) {
      console.warn("NumistaLookup: failed to load custom rules:", e);
      customRules = [];
    }
  };

  /**
   * Imports custom rules from an external source (e.g. a backup restore),
   * preserving each rule's id AND seedImageId so previously-cached pattern images
   * stay bound (STRK-202). Routing through addRule would mint fresh ids/seedImageIds
   * and orphan the images, so this is a dedicated path. Id-less rules get a stable
   * content-derived id; rules missing a pattern or replacement are skipped.
   *
   * @param {Array<Object>} rules - Rule objects to import.
   * @param {boolean} [merge=true] - When true, keep existing rules and add only
   *   ones whose id isn't already present; when false, replace all custom rules.
   * @returns {{ success: boolean, imported: number, error: (string|undefined) }}
   */
  const importRules = (rules, merge = true) => {
    if (!Array.isArray(rules)) {
      return { success: false, imported: 0, error: "Rules must be an array." };
    }
    const incoming = rules
      .map((r, i) => ({
        id: r.id || _deriveStableRuleId(r, i),
        pattern: r.pattern || "",
        replacement: r.replacement || "",
        numistaId: r.numistaId || null,
        seedImageId: r.seedImageId || null,
        builtIn: false,
      }))
      .filter((r) => r.pattern && r.replacement);

    const merged = merge ? customRules.slice() : [];
    const seen = new Set(merged.map((r) => r.id));
    let imported = 0;
    for (const rule of incoming) {
      if (seen.has(rule.id)) continue; // existing rule wins on an id collision
      merged.push(rule);
      seen.add(rule.id);
      imported++;
    }

    customRules = merged;
    compiledRegex.clear();
    for (const rule of customRules) getRegex(rule);
    saveCustomRules();
    return { success: true, imported };
  };

  return {
    matchQuery,
    addRule,
    updateRule,
    removeRule,
    getCustomRules,
    loadCustomRules,
    importRules,
  };
})();

// Expose globally
if (typeof window !== "undefined") {
  window.NumistaLookup = NumistaLookup;
}

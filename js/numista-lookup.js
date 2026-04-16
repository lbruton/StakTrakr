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
  // SEED RULES — shipped with the app, read-only for users
  // =========================================================================

  /**
   * Seed rules — verified against the Numista API (Feb 2026).
   * numistaId values were tested via /v3/types/{id} and confirmed correct.
   * Coins with yearly-changing designs (Kookaburra, Kangaroo, Panda, etc.)
   * intentionally use null — Numista has no generic series entry.
   * @type {Array<{id: string, pattern: string, replacement: string, numistaId: string|null, builtIn: boolean}>}
   */
  const SEED_RULES = [
    // === US Coins (all N# verified 2026-02-13) ===
    {
      id: "us-ase",
      pattern: "\\b(american\\s+silver\\s+eagle|\\bASE\\b)",
      replacement: '"American Silver Eagle" Bullion',
      numistaId: "1493",
      builtIn: true,
    },
    {
      id: "us-ase-new",
      pattern: "\\b(ASE\\s+type\\s*2|silver\\s+eagle\\s+type\\s*2)",
      replacement: '"American Silver Eagle" New Reverse Bullion',
      numistaId: "298883",
      builtIn: true,
    },
    {
      id: "us-age",
      pattern: "\\b(american\\s+gold\\s+eagle|\\bAGE\\b)",
      replacement: '"American Gold Eagle" Bullion Coinage',
      numistaId: "23134",
      builtIn: true,
    },
    {
      id: "us-age-1oz",
      pattern: "\\bgold\\s+eagle\\s+1\\s*oz\\b",
      replacement: '50 Dollars "American Gold Eagle" Bullion Coinage',
      numistaId: "23134",
      builtIn: true,
    },
    {
      id: "us-age-half",
      pattern: "\\bgold\\s+eagle\\s+(1/2|half)\\s*oz\\b",
      replacement: '25 Dollars "American Gold Eagle" Bullion Coinage',
      numistaId: "21899",
      builtIn: true,
    },
    {
      id: "us-age-quarter",
      pattern: "\\bgold\\s+eagle\\s+(1/4|quarter)\\s*oz\\b",
      replacement: '10 Dollars "American Gold Eagle" Bullion Coinage',
      numistaId: "25416",
      builtIn: true,
    },
    {
      id: "us-age-tenth",
      pattern: "\\bgold\\s+eagle\\s+(1/10|tenth)\\s*oz\\b",
      replacement: '5 Dollars "American Gold Eagle" Bullion Coinage',
      numistaId: "10493",
      builtIn: true,
    },
    {
      id: "us-ape",
      pattern: "\\b(american\\s+platinum\\s+eagle|\\bAPE\\b)",
      replacement: '100 Dollars "American Platinum Eagle" Bullion Coinage',
      numistaId: "23137",
      builtIn: true,
    },
    {
      id: "us-apde",
      pattern: "\\b(american\\s+palladium\\s+eagle)",
      replacement: "25 Dollars Palladium Eagle",
      numistaId: "173899",
      builtIn: true,
    },
    {
      id: "us-agb",
      pattern: "\\b(gold\\s+buffalo|\\bAGB\\b)",
      replacement: '50 Dollars "American Buffalo" Gold Bullion',
      numistaId: "18451",
      builtIn: true,
    },
    {
      id: "us-morgan",
      pattern: "\\bmorgan\\s+(silver\\s+)?dollar\\b",
      replacement: '1 Dollar "Morgan Dollar"',
      numistaId: "1492",
      builtIn: true,
    },
    {
      id: "us-peace",
      pattern: "\\bpeace\\s+(silver\\s+)?dollar\\b",
      replacement: '1 Dollar "Peace Dollar"',
      numistaId: "5580",
      builtIn: true,
    },
    {
      id: "us-walking-lib",
      pattern: "\\bwalking\\s+liberty\\b",
      replacement: '½ Dollar "Walking Liberty Half Dollar"',
      numistaId: "4455",
      builtIn: true,
    },
    {
      id: "us-mercury",
      pattern: "\\bmercury\\s+dime\\b",
      replacement: '1 Dime "Mercury Dime"',
      numistaId: "51",
      builtIn: true,
    },
    {
      id: "us-washington-q",
      pattern: "\\bwashington\\s+quarter\\s+silver\\b",
      replacement: '¼ Dollar "Washington Silver Quarter"',
      numistaId: "54",
      builtIn: true,
    },
    {
      id: "us-roosevelt-d",
      pattern: "\\broosevelt\\s+dime\\s+silver\\b",
      replacement: '1 Dime "Roosevelt Silver Dime"',
      numistaId: "52",
      builtIn: true,
    },
    {
      id: "us-franklin-h",
      pattern: "\\bfranklin\\s+half\\b",
      replacement: '½ Dollar "Franklin Half Dollar"',
      numistaId: "2835",
      builtIn: true,
    },
    {
      id: "us-kennedy-h",
      pattern: "\\bkennedy\\s+half\\s+silver\\b",
      replacement: '½ Dollar "Kennedy Half Dollar" 90% Silver',
      numistaId: "943",
      builtIn: true,
    },
    {
      id: "us-liberty-20",
      pattern: "\\bliberty\\s+double\\s+eagle\\b",
      replacement: "20 Dollars Liberty Head Double Eagle",
      numistaId: "23656",
      builtIn: true,
    },
    {
      id: "us-saint-g",
      pattern: "\\bsaint.?gaudens\\b",
      replacement: "20 Dollars Saint-Gaudens Double Eagle",
      numistaId: "23126",
      builtIn: true,
    },

    // === Canada (N# verified 2026-02-13) ===
    {
      id: "ca-sml",
      pattern: "\\b(silver\\s+maple\\s+leaf|\\bSML\\b)",
      replacement: "5 Dollars SML Bullion Coinage Canada",
      numistaId: "18655",
      builtIn: true,
    },
    {
      id: "ca-gml",
      pattern: "\\b(gold\\s+maple\\s+leaf|\\bGML\\b)",
      replacement: "50 Dollars GML Bullion Coinage Canada",
      numistaId: "32727",
      builtIn: true,
    },
    {
      id: "ca-pml",
      pattern: "\\bplatinum\\s+maple\\s+leaf\\b",
      replacement: "50 Dollars platinum Bullion Coinage Canada Maple",
      numistaId: "67528",
      builtIn: true,
    },
    {
      id: "ca-pdml",
      pattern: "\\bpalladium\\s+maple\\s+leaf\\b",
      replacement: "50 Dollars palladium Bullion Coinage Canada",
      numistaId: "36214",
      builtIn: true,
    },
    {
      id: "ca-predator",
      pattern: "\\bcanadian?\\s+predator\\b",
      replacement: '"Predator" silver Canada Bullion',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "ca-wildlife",
      pattern: "\\bcanadian?\\s+wildlife\\b",
      replacement: '"Wildlife" silver Canada Bullion',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "ca-maple-1g",
      pattern: "\\bmaple\\s+leaf\\s+maplegram\\b",
      replacement: "GML bullion Maplegram Canada",
      numistaId: null,
      builtIn: true,
    },

    // === Australia (yearly designs — no single N#, query-rewrite only) ===
    {
      id: "au-kook",
      pattern: "\\bkookaburra\\b",
      replacement: '"Australian Kookaburra" silver Bullion',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "au-koala",
      pattern: "\\bkoala\\b",
      replacement: '"Koala" silver Bullion Australia',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "au-kangaroo-s",
      pattern: "\\b(kangaroo\\s+silver|silver\\s+kangaroo)\\b",
      replacement: '"Australian Kangaroo" silver Bullion',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "au-kangaroo",
      pattern: "\\b(kangaroo|nugget)\\s*(gold)?\\b",
      replacement: '"Australian Nugget" gold Bullion',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "au-lunar-i",
      pattern: "\\blunar\\s+(series\\s+)?I\\b",
      replacement: '"Lunar" series I silver Australia',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "au-lunar-ii",
      pattern: "\\blunar\\s+(series\\s+)?II\\b",
      replacement: '"Lunar" series II silver Australia',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "au-lunar-iii",
      pattern: "\\blunar\\s+(series\\s+)?III\\b",
      replacement: '"Lunar" series III silver Australia',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "au-lunar",
      pattern: "\\b(perth|australian?)\\s+lunar\\b",
      replacement: '"Lunar" silver Bullion Australia',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "au-swan",
      pattern: "\\b(perth\\s+)?swan\\b",
      replacement: '"Swan" silver Australia Perth',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "au-emu",
      pattern: "\\b(perth\\s+)?emu\\b",
      replacement: '"Emu" silver Australia Perth',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "au-platypus",
      pattern: "\\bplatypus\\b",
      replacement: '"Platypus" platinum Australia',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "au-dragon-bar",
      pattern: "\\bdragon\\s+(silver\\s+)?bar\\b",
      replacement: '"Dragon" rectangular silver Australia',
      numistaId: null,
      builtIn: true,
    },

    // === South Africa (yearly/anniversary variants — query-rewrite only) ===
    {
      id: "za-krugerrand-s",
      pattern: "\\b(krugerrand\\s+silver|silver\\s+krugerrand)\\b",
      replacement: "Krugerrand silver South Africa",
      numistaId: null,
      builtIn: true,
    },
    {
      id: "za-krugerrand",
      pattern: "\\bkrugerrand\\b",
      replacement: "Krugerrand gold South Africa",
      numistaId: null,
      builtIn: true,
    },

    // === UK (yearly/variant designs — query-rewrite only) ===
    {
      id: "uk-britannia-s",
      pattern: "\\bbritannia\\s*(silver)?\\b",
      replacement: '"Britannia" silver Bullion United Kingdom',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "uk-britannia-g",
      pattern: "\\bbritannia\\s+gold\\b",
      replacement: '"Britannia" gold Bullion United Kingdom',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "uk-sovereign",
      pattern: "\\bsovereign\\s+gold\\b",
      replacement: "Sovereign gold United Kingdom",
      numistaId: null,
      builtIn: true,
    },

    // === Austria (N# verified 2026-02-13) ===
    {
      id: "at-philharmonic-s",
      pattern: "\\bphilharmonic\\s*(silver)?\\b",
      replacement: "1½ Euro Vienna Philharmonic silver",
      numistaId: "9165",
      builtIn: true,
    },
    {
      id: "at-philharmonic-g",
      pattern: "\\bphilharmonic\\s+gold\\b",
      replacement: "100 Euros Vienna Philharmonic gold",
      numistaId: "23519",
      builtIn: true,
    },

    // === Mexico (pattern/variant issues — query-rewrite only) ===
    {
      id: "mx-libertad-s",
      pattern: "\\blibertad\\s*(silver)?\\b",
      replacement: 'Onza "Libertad" silver Bullion Mexico',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "mx-libertad-g",
      pattern: "\\blibertad\\s+gold\\b",
      replacement: 'Onza "Libertad" gold Bullion Mexico',
      numistaId: null,
      builtIn: true,
    },

    // === China (yearly designs — query-rewrite only) ===
    {
      id: "cn-panda-s",
      pattern: "\\bpanda\\s*(silver)?\\b",
      replacement: "10 Yuan Panda silver China",
      numistaId: null,
      builtIn: true,
    },
    {
      id: "cn-panda-g",
      pattern: "\\bpanda\\s+gold\\b",
      replacement: "500 Yuan Panda gold China",
      numistaId: null,
      builtIn: true,
    },

    // === Armenia (N# verified 2026-02-13) ===
    {
      id: "am-noahs-ark",
      pattern: "\\bnoah.?s\\s+ark\\b",
      replacement: "500 Dram Noah's Ark silver Armenia",
      numistaId: "26279",
      builtIn: true,
    },

    // === Somalia (yearly designs — query-rewrite only) ===
    {
      id: "so-elephant",
      pattern: "\\b(somalian?\\s+)?elephant\\b",
      replacement: "100 Shillings Elephant silver Somalia",
      numistaId: null,
      builtIn: true,
    },

    // === Generic bullion types ===
    {
      id: "gen-jm-bar",
      pattern: "\\bjohnson\\s+matthey\\b",
      replacement: '"Johnson Matthey" silver bar',
      numistaId: null,
      builtIn: true,
    },
    {
      id: "gen-engelhard",
      pattern: "\\bengelhard\\b",
      replacement: '"Engelhard" silver bar',
      numistaId: null,
      builtIn: true,
    },
  ];

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

  /**
   * Compile all seed rule regexes eagerly on load.
   */
  const compileSeedRules = () => {
    for (const rule of SEED_RULES) {
      getRegex(rule);
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

    // Then check seed rules (skip disabled ones)
    for (const rule of SEED_RULES) {
      if (!isSeedRuleEnabled(rule.id)) continue;
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
   * Returns all rules (seed + custom).
   * @returns {Array}
   */
  const listRules = () => [...SEED_RULES, ...customRules];

  /**
   * Returns only seed (built-in) rules.
   * @returns {Array}
   */
  const listSeedRules = () => [...SEED_RULES];

  /**
   * Returns only custom (user-created) rules.
   * @returns {Array}
   */
  const listCustomRules = () => [...customRules];

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
    try {
      const raw = localStorage.getItem("numistaLookupRules");
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
    } catch (e) {
      console.warn("NumistaLookup: failed to load custom rules:", e);
      customRules = [];
    }
  };

  // =========================================================================
  // SEED RULE ENABLE/DISABLE — per-rule toggles with migration
  // =========================================================================

  /** @type {Set<string>} IDs of enabled seed rules */
  let enabledSeedRuleIds = new Set();

  /**
   * Loads enabled seed rule IDs from localStorage with migration.
   * - Key missing + inventory has items (existing user) → all enabled, persist
   * - Key missing + no inventory (new user) → all disabled (empty set), persist
   * - Key exists → use stored array
   */
  const loadEnabledSeedRules = () => {
    try {
      const raw = localStorage.getItem("enabledSeedRules");
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        enabledSeedRuleIds = new Set(Array.isArray(parsed) ? parsed : []);
        return;
      }
      // Migration: key missing
      const hasInventory =
        typeof inventory !== "undefined" && Array.isArray(inventory) && inventory.length > 0;
      if (hasInventory) {
        // Existing user: enable all seed rules
        enabledSeedRuleIds = new Set(SEED_RULES.map((r) => r.id));
      } else {
        // New user: all disabled
        enabledSeedRuleIds = new Set();
      }
      saveEnabledSeedRules();
    } catch (e) {
      console.warn("NumistaLookup: failed to load enabled seed rules:", e);
      enabledSeedRuleIds = new Set();
    }
  };

  /**
   * Persists the enabled seed rule IDs set as a JSON array.
   */
  const saveEnabledSeedRules = () => {
    try {
      localStorage.setItem("enabledSeedRules", JSON.stringify([...enabledSeedRuleIds]));
    } catch (e) {
      console.warn("NumistaLookup: failed to save enabled seed rules:", e);
    }
  };

  /**
   * Checks if a seed rule is enabled.
   * @param {string} ruleId - The rule ID to check
   * @returns {boolean}
   */
  const isSeedRuleEnabled = (ruleId) => enabledSeedRuleIds.has(ruleId);

  /**
   * Toggles a single seed rule on/off and persists.
   * @param {string} ruleId - The rule ID to toggle
   * @param {boolean} enabled - Whether to enable or disable
   */
  const setSeedRuleEnabled = (ruleId, enabled) => {
    if (enabled) {
      enabledSeedRuleIds.add(ruleId);
    } else {
      enabledSeedRuleIds.delete(ruleId);
    }
    saveEnabledSeedRules();
  };

  /**
   * Bulk enable/disable all seed rules and persist.
   * @param {boolean} enabled - Whether to enable or disable all
   */
  const setAllSeedRulesEnabled = (enabled) => {
    if (enabled) {
      enabledSeedRuleIds = new Set(SEED_RULES.map((r) => r.id));
    } else {
      enabledSeedRuleIds = new Set();
    }
    saveEnabledSeedRules();
  };

  /**
   * Returns the count of currently enabled seed rules.
   * @returns {number}
   */
  const getEnabledSeedRuleCount = () => enabledSeedRuleIds.size;

  // Compile seed rules on module load
  compileSeedRules();

  return {
    matchQuery,
    addRule,
    updateRule,
    removeRule,
    listRules,
    listSeedRules,
    listCustomRules,
    loadCustomRules,
    loadEnabledSeedRules,
    isSeedRuleEnabled,
    setSeedRuleEnabled,
    setAllSeedRulesEnabled,
    getEnabledSeedRuleCount,
  };
})();

// Expose globally
if (typeof window !== "undefined") {
  window.NumistaLookup = NumistaLookup;
}

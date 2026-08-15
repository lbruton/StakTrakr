// SEARCH FUNCTIONALITY
// =============================================================================

// Legacy fallback search-term matching helpers (cohort 2.5). filterInventory()
// below delegates to filterInventoryAdvanced() when filters.js is loaded; these
// power its standalone fallback path.
const _METAL_NAMES = ["gold", "silver", "platinum", "palladium", "copper"];

/**
 * Escapes regex metacharacters so a search word can be matched literally.
 * @param {string} word
 * @returns {string}
 */
const _escapeSearchRegex = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Builds a left-boundary, case-insensitive regex for a word, OR-ing in any
 * metal-abbreviation expansion (e.g. "ase" → "American Silver Eagle").
 * @param {string} word
 * @returns {RegExp}
 */
const _buildSearchWordRegex = (word) => {
  const patterns = [_escapeSearchRegex(word)];
  const abbrevs = typeof METAL_ABBREVIATIONS !== "undefined" ? METAL_ABBREVIATIONS : {};
  const expansion = abbrevs[word.toLowerCase()];
  if (expansion) patterns.push(_escapeSearchRegex(expansion));
  return new RegExp(`\\b(?:${patterns.join("|")})`, "i");
};

/**
 * Whole-word (both boundaries) case-insensitive regex, no abbreviation expansion.
 * @param {string} word
 * @returns {RegExp}
 */
const _wholeWordRegex = (word) => new RegExp(`\\b${_escapeSearchRegex(word)}\\b`, "i");

/**
 * Concatenates an item's searchable fields (incl. tags) into one lowercased
 * string for phrase matching. Field order matches the legacy inline build.
 * @param {Object} item
 * @returns {string}
 */
const _buildItemSearchText = (item) => {
  const tags = typeof getItemTags === "function" ? getItemTags(item.uuid).join(" ") : "";
  return [
    item.metal,
    item.composition || "",
    item.name,
    item.type,
    item.purchaseLocation,
    item.storageLocation || "",
    item.notes || "",
    item.capsule || "",
    item.capsuleNotes || "",
    String(item.year || ""),
    item.grade || "",
    item.gradingAuthority || "",
    String(item.certNumber || ""),
    String(item.numistaId || ""),
    item.serialNumber || "",
    String(item.pcgsNumber || ""),
    String(item.purity || ""),
    tags,
  ]
    .join(" ")
    .toLowerCase();
};

/**
 * True when itemText contains "<prefix> <metal> <coinType>" for a metal the
 * query did not specify — i.e. an unrequested cross-metal match.
 * @returns {boolean}
 */
const _hasMetalBetween = (itemText, prefix, coinType, exactPhrase) =>
  _METAL_NAMES.some(
    (metal) => itemText.includes(`${prefix} ${metal} ${coinType}`) && !exactPhrase.includes(metal)
  );

// Two-word coin-series disambiguation rules (STAK-era): keep "American Eagle"
// from matching "American Gold Eagle", "Silver Maple" from "Gold Maple", etc.
// `country` = origin prefix(es) that must not have an unrequested metal between;
// `metalPhrase` = extra accepted phrase for metal-prefixed queries (maple leaf);
// `krugerSpecial` = krugerrand's dual-pattern origin check.
const _COIN_SERIES = {
  eagle: { country: ["american"], metalPhrase: null },
  maple: { country: ["canadian"], metalPhrase: (m) => `${m} maple leaf` },
  britannia: { country: ["british"], metalPhrase: null },
  krugerrand: { country: ["south", "african"], metalPhrase: null, krugerSpecial: true },
  buffalo: { country: ["american"], metalPhrase: null },
  panda: { country: ["chinese"], metalPhrase: null },
  kangaroo: { country: ["australian"], metalPhrase: null },
};

/**
 * Applies the two-word coin-series rule for "<metal|origin> <series>".
 * @returns {boolean|null} the match decision, or null when (metal, series) is not
 *   a recognized rule (caller continues with other checks).
 */
const _matchCoinSeries = (searchMetal, coinType, itemText, exactPhrase) => {
  const rule = _COIN_SERIES[coinType];
  if (!rule) return null;
  if (_METAL_NAMES.includes(searchMetal)) {
    if (rule.metalPhrase) {
      return itemText.includes(exactPhrase) || itemText.includes(rule.metalPhrase(searchMetal));
    }
    return itemText.includes(exactPhrase);
  }
  if (rule.country.includes(searchMetal)) {
    if (rule.krugerSpecial) {
      return !_METAL_NAMES.some(
        (metal) =>
          (itemText.includes(`south african ${metal} krugerrand`) ||
            itemText.includes(`${metal} krugerrand`)) &&
          !exactPhrase.includes(metal)
      );
    }
    return !_hasMetalBetween(itemText, searchMetal, coinType, exactPhrase);
  }
  return null;
};

/**
 * Matches a multi-word (>=2) search term against an item: exact/expanded phrase,
 * custom-group label, word-boundary presence, then coin-series, three-word, and
 * fractional-weight disambiguation rules.
 * @returns {boolean}
 */
const _matchMultiWordTerm = (q, item, words) => {
  const abbrevs = typeof METAL_ABBREVIATIONS !== "undefined" ? METAL_ABBREVIATIONS : {};
  const expandedPhrase = words
    .map((w) => abbrevs[w.toLowerCase()] || w)
    .join(" ")
    .toLowerCase();
  const exactPhrase = q.toLowerCase();
  const itemText = _buildItemSearchText(item);

  if (itemText.includes(exactPhrase)) return true;
  if (expandedPhrase !== exactPhrase && itemText.includes(expandedPhrase)) return true;
  if (
    typeof window.itemMatchesCustomGroupLabel === "function" &&
    window.itemMatchesCustomGroupLabel(item, q)
  ) {
    return true;
  }

  const allWordsPresent = words.every((word) => _wholeWordRegex(word).test(itemText));
  if (!allWordsPresent) return false;

  if (words.length === 2) {
    const seriesResult = _matchCoinSeries(words[0], words[1], itemText, exactPhrase);
    if (seriesResult !== null) return seriesResult;
  }

  if (words.length === 3) {
    const [firstWord, middleWord, lastWord] = words;
    if (
      ["american", "canadian", "british", "chinese", "australian", "south"].includes(firstWord) &&
      _METAL_NAMES.includes(middleWord) &&
      ["eagle", "maple", "britannia", "krugerrand", "buffalo", "panda", "kangaroo"].includes(
        lastWord
      )
    ) {
      return (
        itemText.includes(exactPhrase) ||
        (lastWord === "maple" && itemText.includes(`${firstWord} ${middleWord} maple leaf`))
      );
    }
  }

  const hasFraction = words.some((word) => word.includes("/"));
  const hasOz = words.some((word) => word === "oz" || word === "ounce");
  if (hasFraction && hasOz) return itemText.includes(exactPhrase);

  return true;
};

/**
 * Tests whether a single word matches any of an item's fields (word-boundary +
 * abbreviation expansion for text fields; substring for date/numeric fields).
 * @returns {boolean}
 */
const _wordMatchesItem = (word, item, formattedDate) => {
  const wordRegex = _buildSearchWordRegex(word);
  if ([item.metal, item.name, item.type, item.purchaseLocation].some((f) => wordRegex.test(f))) {
    return true;
  }
  const guarded = [
    item.composition,
    item.storageLocation,
    item.notes,
    item.capsule,
    item.capsuleNotes,
    item.year,
    item.grade,
    item.gradingAuthority,
    item.certNumber,
    item.numistaId,
    item.serialNumber,
    item.pcgsNumber,
  ];
  if (guarded.some((f) => f && wordRegex.test(String(f)))) return true;
  if (item.date.includes(word) || formattedDate.includes(word)) return true;
  if (
    [item.qty, item.weight, item.price].some((n) =>
      String(Number.isFinite(Number(n)) ? Number(n) : "").includes(word)
    )
  ) {
    return true;
  }
  return typeof getItemTags === "function" && getItemTags(item.uuid).some((t) => wordRegex.test(t));
};

/**
 * Matches a single-word search term: field match, then custom-group label, then
 * (only when no custom-group matcher exists) the fuzzy fallback.
 * @param {Object} ctx - { formattedDate, fuzzyEnabled, fuzzyOptions }
 * @returns {boolean}
 */
const _matchSingleWordTerm = (q, item, words, ctx) => {
  const fieldMatch = words.every((word) => _wordMatchesItem(word, item, ctx.formattedDate));
  if (fieldMatch) return true;
  if (typeof window.itemMatchesCustomGroupLabel === "function") {
    return window.itemMatchesCustomGroupLabel(item, q);
  }
  if (ctx.fuzzyEnabled) {
    if (
      (item.name && fuzzyMatch(q, item.name, ctx.fuzzyOptions) > 0) ||
      (q.length > 2 &&
        item.purchaseLocation &&
        fuzzyMatch(q, item.purchaseLocation, ctx.fuzzyOptions) > 0) ||
      (q.length > 2 &&
        item.storageLocation &&
        fuzzyMatch(q, item.storageLocation, ctx.fuzzyOptions) > 0) ||
      (q.length > 3 && item.notes && fuzzyMatch(q, item.notes, ctx.fuzzyOptions) > 0) ||
      (q.length > 2 && item.capsule && fuzzyMatch(q, item.capsule, ctx.fuzzyOptions) > 0) ||
      (q.length > 3 && item.capsuleNotes && fuzzyMatch(q, item.capsuleNotes, ctx.fuzzyOptions) > 0)
    ) {
      if (!window._fuzzyMatchUsed) window._fuzzyMatchUsed = true;
      return true;
    }
  }
  return false;
};

/**
 * Routes a single search term to the multi-word or single-word matcher.
 * @param {Object} ctx - { formattedDate, fuzzyEnabled, fuzzyOptions }
 * @returns {boolean}
 */
const _termMatchesItem = (q, item, ctx) => {
  const words = q.split(/\s+/).filter((w) => w.length > 0);
  if (words.length >= 2) return _matchMultiWordTerm(q, item, words);
  return _matchSingleWordTerm(q, item, words, ctx);
};

/**
 * Filters inventory based on the current search query and active column filters.
 * Handles advanced multi-term, phrase, and series-specific logic for coins and metals.
 *
 * @returns {Array<Object>} Filtered inventory items matching the search query and filters
 *
 * @example
 * filterInventory();
 */
const filterInventory = () => {
  // Use the advanced filtering system if available, otherwise fall back to legacy
  if (typeof filterInventoryAdvanced === "function") {
    return filterInventoryAdvanced();
  }

  // Legacy filtering for compatibility
  let result = inventory;

  Object.entries(activeFilters).forEach(([field, criteria]) => {
    if (criteria && typeof criteria === "object" && Array.isArray(criteria.values)) {
      const lowerVals = criteria.values.map((v) => String(v).toLowerCase());
      result = result.filter((item) => {
        const rawVal = item[field] ?? (field === "metal" ? item.metal : "");
        const fieldVal = String(rawVal ?? "").toLowerCase();
        const match = lowerVals.includes(fieldVal);
        return criteria.exclude ? !match : match;
      });
    }
  });

  if (!searchQuery.trim()) return result;

  let query = searchQuery.toLowerCase().trim();

  // Support comma-separated terms for multi-value search
  const terms = query
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t);

  // Pre-calculate fuzzy matching settings outside the loop for performance
  const fuzzyEnabled =
    typeof window.featureFlags !== "undefined" &&
    window.featureFlags.isEnabled("FUZZY_AUTOCOMPLETE") &&
    typeof fuzzyMatch === "function";
  const fuzzyThreshold =
    fuzzyEnabled && typeof AUTOCOMPLETE_CONFIG !== "undefined"
      ? AUTOCOMPLETE_CONFIG.threshold
      : 0.3;
  // Reuse options object to avoid allocation in loop
  const fuzzyOptions = fuzzyEnabled ? { threshold: fuzzyThreshold } : null;

  return result.filter((item) => {
    if (!terms.length) return true;

    const ctx = {
      formattedDate: formatDisplayDate(item.date).toLowerCase(),
      fuzzyEnabled,
      fuzzyOptions,
    };

    // Comma-separated terms use OR logic; each term is matched as a whole.
    return terms.some((q) => _termMatchesItem(q, item, ctx));
  });
};

// Note: applyColumnFilter function is now in filters.js for advanced filtering

/**
 * Safely retrieves a DOM element by ID, using safeGetElement if available.
 *
 * @param {string} id - The ID of the element to retrieve
 * @returns {HTMLElement|null} The DOM element or null
 */
const resolveElement = (id) => {
  if (typeof safeGetElement === "function") {
    return safeGetElement(id);
  }
  return document.getElementById(id);
};

/**
 * Normalizes a list of search patterns for comparison.
 * Trims, lowercases, and sorts the patterns.
 *
 * @param {string[]} list - The list of patterns to normalize
 * @returns {string[]} The normalized list
 */
const _normalizePatterns = (list) =>
  list
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0)
    .sort();

/**
 * Parses a comma-separated search query into individual patterns.
 *
 * @param {string} query - The search query string
 * @returns {string[]} Array of individual search patterns
 */
const parseSearchPatterns = (query) => {
  if (!query || typeof query !== "string") return [];
  return query
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
};

/**
 * Checks if a set of search patterns already exists as a custom group.
 *
 * @param {string[]} patterns - The patterns to check
 * @returns {boolean} True if a matching custom group exists
 */
const searchPatternExistsInCustomGroups = (patterns) => {
  if (!patterns.length) return false;
  if (typeof loadCustomGroups !== "function") return false;
  const targetKey = _normalizePatterns(patterns).join("|");
  return loadCustomGroups().some((group) => {
    if (!group || !Array.isArray(group.patterns)) return false;
    const groupKey = _normalizePatterns(group.patterns).join("|");
    return groupKey === targetKey;
  });
};

/**
 * Checks if a set of search patterns matches any auto-generated chips.
 *
 * @param {string[]} patterns - The patterns to check
 * @returns {boolean} True if any pattern matches an auto-chip
 */
const searchPatternMatchesAutoChip = (patterns) => {
  if (!patterns.length) return false;
  if (typeof generateCategorySummary !== "function") return false;
  if (typeof inventory === "undefined") return false;

  const summary = generateCategorySummary(inventory);
  if (!summary || typeof summary !== "object") return false;

  const summaryKeys = [
    "metals",
    "types",
    "names",
    "purchaseLocations",
    "storageLocations",
    "years",
    "grades",
    "numistaIds",
    "purities",
    "dynamicNames",
    "tags",
  ];

  const autoValues = new Set();
  summaryKeys.forEach((key) => {
    const bucket = summary[key];
    if (bucket && typeof bucket === "object") {
      Object.keys(bucket).forEach((val) => {
        autoValues.add(String(val).toLowerCase());
      });
    }
  });

  return patterns.some((p) => autoValues.has(p.toLowerCase()));
};

/**
 * Determines whether the "Save Search" button should be displayed.
 *
 * @param {string} query - The current search query
 * @param {boolean} fuzzyUsed - Whether fuzzy matching was used for this query
 * @returns {boolean} True if the save button should be shown
 */
const shouldShowSearchSaveButton = (query, fuzzyUsed) => {
  const patterns = parseSearchPatterns(query);
  if (patterns.length < 2) return false;
  if (fuzzyUsed) return false;
  if (searchPatternExistsInCustomGroups(patterns)) return false;
  if (searchPatternMatchesAutoChip(patterns)) return false;
  return true;
};

/**
 * Updates the visibility of the "Save Search" button based on the query.
 *
 * @param {string} query - The search query string
 * @param {boolean} [fuzzyUsed=false] - Whether fuzzy matching was active
 */
const updateSaveSearchButton = (query, fuzzyUsed = false) => {
  const group = resolveElement("saveSearchPatternGroup");
  if (!group || !group.id) return;
  const canSave = shouldShowSearchSaveButton(query, fuzzyUsed);
  group.style.display = canSave ? "" : "none";
};

/**
 * Derives a default display label for a set of search patterns.
 *
 * @param {string[]} patterns - The patterns to derive a label from
 * @returns {string} The derived display label
 */
const deriveSearchLabel = (patterns) => {
  if (!patterns.length) return "";
  const pretty = patterns.map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return pretty.join(" / ");
};

/**
 * Handles the "Save Search" button click event.
 * Prompts the user for a label and creates a new custom group.
 */
const handleSaveSearchPattern = async () => {
  const input = resolveElement("searchInput");
  if (!input || !input.id) return;
  const query = input.value || "";
  const fuzzyUsed = !!(query.trim() && window._fuzzyMatchUsed);
  if (!shouldShowSearchSaveButton(query, fuzzyUsed)) {
    updateSaveSearchButton(query, fuzzyUsed);
    return;
  }

  const patterns = parseSearchPatterns(query);
  const defaultLabel = deriveSearchLabel(patterns);
  const label =
    typeof showAppPrompt === "function"
      ? await showAppPrompt("Label for saved filter chip:", defaultLabel, "Save Search Pattern")
      : null;
  if (!label || !label.trim()) {
    updateSaveSearchButton(query, fuzzyUsed);
    return;
  }

  if (typeof addCustomGroup === "function") {
    const group = addCustomGroup(label.trim(), patterns.join(", "));
    if (group && typeof renderActiveFilters === "function") {
      renderActiveFilters();
    }
  }

  updateSaveSearchButton(query, fuzzyUsed);
};

window.updateSaveSearchButton = updateSaveSearchButton;

/**
 * Show or hide the fuzzy search indicator banner.
 * Displayed when exact search returns 0 results but fuzzy returns > 0.
 *
 * @param {string} query - The search query that triggered fuzzy matching
 * @param {boolean} show - Whether to show or hide the indicator
 */
const updateFuzzyIndicator = (query, show) => {
  let indicator = safeGetElement("fuzzySearchIndicator");
  // safeGetElement returns a dummy if not found; check for real DOM node
  if (!indicator.id) indicator = null;
  if (!show) {
    if (indicator) indicator.style.display = "none";
    return;
  }
  if (!indicator) {
    // Create indicator next to searchResultsInfo
    const parent = safeGetElement("searchResultsInfo");
    if (!parent.id || !parent.parentElement) return;
    indicator = document.createElement("div");
    indicator.id = "fuzzySearchIndicator";
    indicator.className = "fuzzy-indicator";
    parent.parentElement.insertBefore(indicator, parent.nextSibling);
  }
  indicator.textContent = `Showing approximate matches for \u2018${query}\u2019`;
  indicator.style.display = "";
};

// Expose for global access
window.filterInventory = filterInventory;
window.updateFuzzyIndicator = updateFuzzyIndicator;

// Apply debounce to search input
const searchInput = resolveElement("searchInput");
const saveSearchPatternBtn = resolveElement("saveSearchPatternBtn");

if (searchInput && searchInput.id) {
  const debouncedSearch = debounce((query) => {
    window._fuzzyMatchUsed = false;
    searchQuery = query;
    renderTable();
    renderActiveFilters();
    // Show fuzzy indicator if fuzzy matching was used
    const fuzzyActive = !!(query.trim() && window._fuzzyMatchUsed);
    updateFuzzyIndicator(query, fuzzyActive);
    updateSaveSearchButton(query, fuzzyActive);
  }, 300);

  searchInput.addEventListener("input", (e) => {
    debouncedSearch(e.target.value);
  });

  // Dismiss mobile keyboard on Enter (STAK-126)
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      searchInput.blur();
    }
  });

  updateSaveSearchButton(searchInput.value || "", false);
}

if (saveSearchPatternBtn && saveSearchPatternBtn.id) {
  saveSearchPatternBtn.addEventListener("click", handleSaveSearchPattern);
}

// =============================================================================

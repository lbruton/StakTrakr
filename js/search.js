// SEARCH FUNCTIONALITY
// =============================================================================

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

    const formattedDate = formatDisplayDate(item.date).toLowerCase();

    // Handle comma-separated terms (OR logic between comma terms)
    return terms.some((q) => {
      // Split each comma term into individual words for AND logic
      const words = q.split(/\s+/).filter((w) => w.length > 0);

      // Special handling for multi-word searches to prevent partial matches
      // If searching for "American Eagle", it should only match items that have both words
      // but NOT match "American Gold Eagle" (which has an extra word in between)
      if (words.length >= 2) {
        // Expand abbreviations in the query words for multi-word searches
        const abbrevs = typeof METAL_ABBREVIATIONS !== "undefined" ? METAL_ABBREVIATIONS : {};
        const expandedWords = words.map((w) => abbrevs[w.toLowerCase()] || w);
        const expandedPhrase = expandedWords.join(" ").toLowerCase();

        // For multi-word searches, check if the exact phrase exists or
        // if all words exist as separate word boundaries without conflicting words
        const exactPhrase = q.toLowerCase();
        // STAK-126: include tags in searchable text
        const _searchTags =
          typeof getItemTags === "function" ? getItemTags(item.uuid).join(" ") : "";
        const itemText = [
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
          _searchTags,
        ]
          .join(" ")
          .toLowerCase();

        // Check for exact phrase match first
        if (itemText.includes(exactPhrase)) {
          return true;
        }

        // Check expanded abbreviation phrase (e.g. "ase 2024" → "american silver eagle 2024")
        if (expandedPhrase !== exactPhrase && itemText.includes(expandedPhrase)) {
          return true;
        }

        // STACK-23: Check custom chip group label matching for multi-word searches
        if (
          typeof window.itemMatchesCustomGroupLabel === "function" &&
          window.itemMatchesCustomGroupLabel(item, q)
        ) {
          return true;
        }

        // For phrase searches like "American Eagle", be more restrictive
        // Check that all words are present as word boundaries
        const allWordsPresent = words.every((word) => {
          const wordRegex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
          return wordRegex.test(itemText);
        });

        if (!allWordsPresent) {
          return false;
        }

        // Additional check: prevent cross-metal matching for common coin series
        // "Silver Eagle" should not match "American Gold Eagle"
        // "Gold Maple" should not match "Silver Maple Leaf"
        // etc.
        if (words.length === 2) {
          const searchMetal = words[0];
          const coinType = words[1];

          // Handle Eagle series
          if (coinType === "eagle") {
            if (searchMetal === "american") {
              // "American Eagle" should not match "American [Metal] Eagle"
              const metalWords = ["gold", "silver", "platinum", "palladium"];
              const hasMetalBetween = metalWords.some(
                (metal) =>
                  itemText.includes(`american ${metal} eagle`) && !exactPhrase.includes(metal)
              );
              return !hasMetalBetween;
            } else if (["silver", "gold", "platinum", "palladium"].includes(searchMetal)) {
              // Metal-specific eagle searches must match exact phrase
              return itemText.includes(exactPhrase);
            }
          }

          // Handle Maple series (Canadian Maple Leaf)
          else if (coinType === "maple") {
            if (["silver", "gold", "platinum", "palladium"].includes(searchMetal)) {
              // "Silver Maple" should only match items with "silver maple"
              return (
                itemText.includes(exactPhrase) || itemText.includes(`${searchMetal} maple leaf`)
              );
            } else if (searchMetal === "canadian") {
              // "Canadian Maple" should not match specific metal maples unless no metal specified
              const metalWords = ["gold", "silver", "platinum", "palladium"];
              const hasMetalBetween = metalWords.some(
                (metal) =>
                  itemText.includes(`canadian ${metal} maple`) && !exactPhrase.includes(metal)
              );
              return !hasMetalBetween;
            }
          }

          // Handle Britannia series (British Britannia)
          else if (coinType === "britannia") {
            if (["silver", "gold", "platinum", "palladium"].includes(searchMetal)) {
              // "Silver Britannia" should only match items with "silver britannia"
              return itemText.includes(exactPhrase);
            } else if (searchMetal === "british") {
              // "British Britannia" should not match specific metal britannias
              const metalWords = ["gold", "silver", "platinum", "palladium"];
              const hasMetalBetween = metalWords.some(
                (metal) =>
                  itemText.includes(`british ${metal} britannia`) && !exactPhrase.includes(metal)
              );
              return !hasMetalBetween;
            }
          }

          // Handle Krugerrand series
          else if (coinType === "krugerrand") {
            if (["silver", "gold", "platinum", "palladium"].includes(searchMetal)) {
              // "Gold Krugerrand" should only match gold krugerrands
              return itemText.includes(exactPhrase);
            } else if (searchMetal === "south" || searchMetal === "african") {
              // Handle "South African Krugerrand" - don't match if metal specified
              const metalWords = ["gold", "silver", "platinum", "palladium"];
              const hasMetalBetween = metalWords.some(
                (metal) =>
                  (itemText.includes(`south african ${metal} krugerrand`) ||
                    itemText.includes(`${metal} krugerrand`)) &&
                  !exactPhrase.includes(metal)
              );
              return !hasMetalBetween;
            }
          }

          // Handle Buffalo series
          else if (coinType === "buffalo") {
            if (["silver", "gold", "platinum", "palladium"].includes(searchMetal)) {
              // "Gold Buffalo" should only match gold buffalos
              return itemText.includes(exactPhrase);
            } else if (searchMetal === "american") {
              // "American Buffalo" should not match if metal specified
              const metalWords = ["gold", "silver", "platinum", "palladium"];
              const hasMetalBetween = metalWords.some(
                (metal) =>
                  itemText.includes(`american ${metal} buffalo`) && !exactPhrase.includes(metal)
              );
              return !hasMetalBetween;
            }
          }

          // Handle Panda series
          else if (coinType === "panda") {
            if (["silver", "gold", "platinum", "palladium"].includes(searchMetal)) {
              // "Silver Panda" should only match silver pandas
              return itemText.includes(exactPhrase);
            } else if (searchMetal === "chinese") {
              // "Chinese Panda" should not match if metal specified
              const metalWords = ["gold", "silver", "platinum", "palladium"];
              const hasMetalBetween = metalWords.some(
                (metal) =>
                  itemText.includes(`chinese ${metal} panda`) && !exactPhrase.includes(metal)
              );
              return !hasMetalBetween;
            }
          }

          // Handle Kangaroo series
          else if (coinType === "kangaroo") {
            if (["silver", "gold", "platinum", "palladium"].includes(searchMetal)) {
              return itemText.includes(exactPhrase);
            } else if (searchMetal === "australian") {
              const metalWords = ["gold", "silver", "platinum", "palladium"];
              const hasMetalBetween = metalWords.some(
                (metal) =>
                  itemText.includes(`australian ${metal} kangaroo`) && !exactPhrase.includes(metal)
              );
              return !hasMetalBetween;
            }
          }
        }

        // Handle three-word searches with special patterns
        if (words.length === 3) {
          // Handle "American Gold Eagle" type searches - these should be exact
          const firstWord = words[0];
          const middleWord = words[1];
          const lastWord = words[2];

          if (
            ["american", "canadian", "british", "chinese", "australian", "south"].includes(
              firstWord
            ) &&
            ["gold", "silver", "platinum", "palladium"].includes(middleWord) &&
            ["eagle", "maple", "britannia", "krugerrand", "buffalo", "panda", "kangaroo"].includes(
              lastWord
            )
          ) {
            // For "American Gold Eagle" type searches, require exact phrase or very close match
            return (
              itemText.includes(exactPhrase) ||
              (lastWord === "maple" && itemText.includes(`${firstWord} ${middleWord} maple leaf`))
            );
          }
        }

        // Handle fractional weight searches to be more specific
        // "1/4 oz" should be distinct from "1/2 oz" and "1 oz"
        if (words.length >= 2) {
          const hasFraction = words.some((word) => word.includes("/"));
          const hasOz = words.some((word) => word === "oz" || word === "ounce");

          if (hasFraction && hasOz) {
            // For fractional searches, require exact phrase match
            return itemText.includes(exactPhrase);
          }
        }

        // Prevent overly broad country/origin searches
        const broadTerms = [
          "american",
          "canadian",
          "australian",
          "british",
          "chinese",
          "south",
          "mexican",
        ];
        if (words.length === 1 && broadTerms.includes(words[0])) {
          // Single broad geographic terms should require additional context
          // Return false to prevent matching everything from that country
          return false;
        }

        return true;
      }

      // For single words, use word boundary matching with abbreviation expansion
      const fieldMatch = words.every((word) => {
        // Build regex patterns: original word + any abbreviation expansion
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const patterns = [escaped];

        // Expand abbreviation if one exists (e.g. 'ase' → 'American Silver Eagle')
        const abbrevs = typeof METAL_ABBREVIATIONS !== "undefined" ? METAL_ABBREVIATIONS : {};
        const expansion = abbrevs[word.toLowerCase()];
        if (expansion) {
          patterns.push(expansion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        }

        // OR together: match original word OR expanded term
        const combined = patterns.join("|");
        const wordRegex = new RegExp(`\\b(?:${combined})`, "i");

        return (
          wordRegex.test(item.metal) ||
          (item.composition && wordRegex.test(item.composition)) ||
          wordRegex.test(item.name) ||
          wordRegex.test(item.type) ||
          wordRegex.test(item.purchaseLocation) ||
          (item.storageLocation && wordRegex.test(item.storageLocation)) ||
          (item.notes && wordRegex.test(item.notes)) ||
          (item.capsule && wordRegex.test(item.capsule)) ||
          (item.capsuleNotes && wordRegex.test(item.capsuleNotes)) ||
          item.date.includes(word) ||
          formattedDate.includes(word) ||
          String(Number.isFinite(Number(item.qty)) ? Number(item.qty) : "").includes(word) ||
          String(Number.isFinite(Number(item.weight)) ? Number(item.weight) : "").includes(word) ||
          String(Number.isFinite(Number(item.price)) ? Number(item.price) : "").includes(word) ||
          (item.year && wordRegex.test(String(item.year))) ||
          (item.grade && wordRegex.test(item.grade)) ||
          (item.gradingAuthority && wordRegex.test(item.gradingAuthority)) ||
          (item.certNumber && wordRegex.test(String(item.certNumber))) ||
          (item.numistaId && wordRegex.test(String(item.numistaId))) ||
          (item.serialNumber && wordRegex.test(item.serialNumber)) ||
          (item.pcgsNumber && wordRegex.test(String(item.pcgsNumber))) ||
          (typeof getItemTags === "function" &&
            getItemTags(item.uuid).some((t) => wordRegex.test(t)))
        );
      });
      if (fieldMatch) return true;

      // STACK-23: Fall back to custom chip group label matching
      if (typeof window.itemMatchesCustomGroupLabel === "function") {
        return window.itemMatchesCustomGroupLabel(item, q);
      }

      // STACK-62: Fuzzy fallback — score item fields when exact matching fails
      if (fuzzyEnabled) {
        // Unrolled loop: avoids array allocation per item; skips secondary fields for short queries
        if (
          (item.name && fuzzyMatch(q, item.name, fuzzyOptions) > 0) ||
          (q.length > 2 &&
            item.purchaseLocation &&
            fuzzyMatch(q, item.purchaseLocation, fuzzyOptions) > 0) ||
          (q.length > 2 &&
            item.storageLocation &&
            fuzzyMatch(q, item.storageLocation, fuzzyOptions) > 0) ||
          (q.length > 3 && item.notes && fuzzyMatch(q, item.notes, fuzzyOptions) > 0) ||
          (q.length > 2 && item.capsule && fuzzyMatch(q, item.capsule, fuzzyOptions) > 0) ||
          (q.length > 3 && item.capsuleNotes && fuzzyMatch(q, item.capsuleNotes, fuzzyOptions) > 0)
        ) {
          // Mark that fuzzy matching was used (for indicator)
          if (!window._fuzzyMatchUsed) window._fuzzyMatchUsed = true;
          return true;
        }
      }

      return false;
    });
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

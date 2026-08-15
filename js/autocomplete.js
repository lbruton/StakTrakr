/**
 * Autocomplete Module for StakTrakr
 *
 * Provides lookup table generation and management for fuzzy autocomplete functionality.
 * Works with the fuzzy-search.js module to provide intelligent search suggestions.
 *
 * @fileoverview Autocomplete lookup table generation and management
 * @version 3.04.62
 * @requires fuzzy-search.js
 */

/**
 * Autocomplete system configuration
 */
const AUTOCOMPLETE_CONFIG = {
  /** Maximum number of suggestions to show */
  maxSuggestions: 8,
  /** Minimum characters before showing suggestions */
  minCharacters: 2,
  /** Fuzzy match threshold (0-1) */
  threshold: 0.3,
  /** Cache TTL in milliseconds (5 minutes — inventory changes frequently) */
  cacheTTL: 5 * 60 * 1000,
  /** LocalStorage key for lookup cache */
  cacheKey: "autocomplete_lookup_cache",
  /** LocalStorage key for cache timestamp */
  timestampKey: "autocomplete_cache_timestamp",
};

/**
 * Lookup table data structure for autocomplete suggestions
 *
 * @typedef {Object} LookupTable
 * @property {string[]} names - Unique item names from inventory
 * @property {string[]} purchaseLocations - Unique purchase locations
 * @property {string[]} storageLocations - Unique storage locations
 * @property {string[]} capsules - Standard and user-entered capsule model codes
 * @property {string[]} types - Unique item types
 * @property {Object} abbreviations - Common abbreviations and expansions
 * @property {number} lastUpdated - Timestamp of last update
 * @property {number} itemCount - Number of inventory items used to generate table
 */

/**
 * Current lookup table instance
 * @type {LookupTable|null}
 */
let currentLookupTable = null;

/**
 * Pre-built lookup database with common precious metals items
 * Sourced from comprehensive industry data for enhanced autocomplete suggestions
 */
const PREBUILT_LOOKUP_DATA = [
  // Government Mint Coins
  "American Gold Eagle",
  "American Silver Eagle",
  "American Platinum Eagle",
  "American Palladium Eagle",
  "American Gold Buffalo",
  "Canadian Gold Maple Leaf",
  "Canadian Silver Maple Leaf",
  "Canadian Platinum Maple Leaf",
  "Canadian Palladium Maple Leaf",
  "British Gold Britannia",
  "British Silver Britannia",
  "British Platinum Britannia",
  "British Gold Sovereign",
  "British Half Sovereign",
  "British Quarter Sovereign",
  "British Double Sovereign",
  "British Five Sovereign",
  "Austrian Gold Philharmonic",
  "Austrian Silver Philharmonic",
  "Austrian Platinum Philharmonic",
  "South African Gold Krugerrand",
  "South African Silver Krugerrand",
  "South African Platinum Krugerrand",
  "Chinese Gold Panda",
  "Chinese Silver Panda",
  "Australian Gold Kangaroo",
  "Australian Silver Kangaroo",
  "Australian Platinum Platypus",
  "Australian Silver Kookaburra",
  "Australian Silver Koala",
  "Australian Gold Lunar Series III",
  "Australian Silver Lunar Series III",
  "Australian Platinum Lunar Series III",
  "Mexican Gold Libertad",
  "Mexican Silver Libertad",
  "Mexican Platinum Libertad",

  // Fractional Government Coins
  "Philharmonic 1/10 oz Gold",
  "Philharmonic 1/4 oz Gold",
  "Philharmonic 1/2 oz Gold",
  "Britannia 1/10 oz Gold",
  "Britannia 1/4 oz Gold",
  "Britannia 1/2 oz Gold",
  "Maple Leaf 1/10 oz Gold",
  "Maple Leaf 1/4 oz Gold",
  "Maple Leaf 1/2 oz Gold",
  "Krugerrand 1/10 oz Gold",
  "Krugerrand 1/4 oz Gold",
  "Krugerrand 1/2 oz Gold",
  "American Eagle 1/10 oz Gold",
  "American Eagle 1/4 oz Gold",
  "American Eagle 1/2 oz Gold",

  // Lunar Series
  "Australian Gold Lunar Year of the Rat",
  "Australian Gold Lunar Year of the Ox",
  "Australian Gold Lunar Year of the Tiger",
  "Australian Gold Lunar Year of the Rabbit",
  "Australian Gold Lunar Year of the Dragon",
  "Australian Gold Lunar Year of the Snake",
  "Australian Gold Lunar Year of the Horse",
  "Australian Gold Lunar Year of the Goat",
  "Australian Gold Lunar Year of the Monkey",
  "Australian Gold Lunar Year of the Rooster",
  "Australian Gold Lunar Year of the Dog",
  "Australian Gold Lunar Year of the Pig",
  "Australian Silver Lunar Year of the Rat",
  "Australian Silver Lunar Year of the Ox",
  "Australian Silver Lunar Year of the Tiger",
  "Australian Silver Lunar Year of the Rabbit",
  "Australian Silver Lunar Year of the Dragon",
  "Australian Silver Lunar Year of the Snake",
  "Australian Silver Lunar Year of the Horse",
  "Australian Silver Lunar Year of the Goat",
  "Australian Silver Lunar Year of the Monkey",
  "Australian Silver Lunar Year of the Rooster",
  "Australian Silver Lunar Year of the Dog",
  "Australian Silver Lunar Year of the Pig",

  // International and Regional Coins
  "New Zealand Silver Fern",
  "New Zealand Silver Kiwi",
  "Niue Silver Hawksbill Turtle",
  "Niue Silver Czech Lion",
  "Niue Gold Czech Lion",
  "Somalian Silver Elephant",
  "Somalian Gold Elephant",
  "Armenian Silver Noah's Ark",
  "Armenian Gold Noah's Ark",
  "Armenian Platinum Noah's Ark",
  "Isle of Man Gold Angel",
  "Isle of Man Silver Angel",
  "Isle of Man Platinum Noble",
  "Isle of Man Gold Noble",
  "Cook Islands Silver Bounty",
  "Cook Islands Gold Bounty",

  // Modern Collectible Series
  "Niue Silver Disney Mickey",
  "Niue Silver Star Wars",
  "Niue Silver Marvel",
  "Niue Silver Harry Potter",
  "Tuvalu Silver Marvel Series",
  "Tuvalu Silver Lunar Dragon",
  "Tuvalu Silver Zeus",
  "Tuvalu Silver Thor",
  "Tuvalu Silver Black Panther",
  "Tuvalu Silver James Bond",
  "Tuvalu Silver Simpson",
  "Tuvalu Black Flag",

  // Wildlife and Nature Series
  "Somalia Silver Leopard",
  "Somalia Silver African Wildlife Buffalo",
  "Somalia Silver African Wildlife Giraffe",
  "Somalia Silver African Wildlife Rhino",
  "Somalia Silver African Wildlife Hippo",
  "Somalia Silver African Wildlife Cheetah",
  "Somalia Silver African Wildlife Zebra",
  "Somalia Silver African Wildlife Lion",
  "Somalia Silver African Wildlife Elephant Prooflike",
  "RCM Silver Wildlife Wolf",
  "RCM Silver Wildlife Grizzly",
  "RCM Silver Wildlife Cougar",
  "RCM Silver Wildlife Moose",
  "RCM Silver Wildlife Antelope",
  "RCM Silver Wildlife Bison",
  "RCM Silver Birds of Prey Peregrine Falcon",
  "RCM Silver Birds of Prey Bald Eagle",
  "RCM Silver Birds of Prey Red-Tailed Hawk",
  "RCM Silver Birds of Prey Great Horned Owl",
  "Australian Silver Wedge-Tailed Eagle",
  "Australian Gold Wedge-Tailed Eagle",
  "Australian Silver Emu",
  "Australian Silver Swan",
  "Australian Gold Swan",
  "Kazakhstan Silver Snow Leopard",

  // Private Mint Rounds
  "Buffalo 1 oz Silver Round",
  "Walking Liberty 1 oz Silver Round",
  "Incuse Indian 1 oz Silver Round",
  "Morgan Design 1 oz Silver Round",
  "Saint-Gaudens Design 1 oz Silver Round",
  "Mercury Dime Design 1 oz Silver Round",
  "Standing Liberty Design 1 oz Silver Round",
  "Aztec Calendar 1 oz Silver Round",
  "Don't Tread on Me 1 oz Silver Round",
  "Sunshine Minting 1 oz Silver Round",
  "Sunshine Minting 1 oz Gold Round",
  "Asahi 1 oz Silver Round",
  "Scottsdale Stacker 2 oz Silver Round",
  "Scottsdale King Stacker 2 oz Silver Round",
  "Geiger Edelmetalle 1 oz Silver Round",
  "Geiger Edelmetalle 1 oz Gold Round",
  "SilverTowne Prospector 1 oz Silver Round",
  "SilverTowne Indian Head 1 oz Silver Round",
  "Golden State Mint Buffalo 1 oz Silver Round",
  "Golden State Mint Walking Liberty 1 oz Silver Round",
  "Prospector 1 oz Silver Round",
  "Freedom Girl 1 oz Silver Round",
  "Spartan Helmet 1 oz Silver Round",

  // Specialty and Themed Rounds
  "Zombucks Walker 1 oz Silver Round",
  "Zombucks Morgan 1 oz Silver Round",
  "Zombucks Barber 1 oz Silver Round",
  "Zombucks Standing Liberty 1 oz Silver Round",
  "Zombucks St. Gaudens 1 oz Silver Round",
  "Intaglio Mint Buffalo 1 oz Silver Round",
  "Intaglio Mint Molon Labe 1 oz Silver Round",
  "Intaglio Mint Egyptian Pyramid 1 oz Silver Round",
  "Intaglio Mint Crusader 1 oz Silver Round",
  "Egyptian God Anubis 2 oz Silver Round",
  "Egyptian God Osiris 2 oz Silver Round",
  "Egyptian God Horus 2 oz Silver Round",

  // Precious Metals Bars - PAMP Suisse
  "PAMP Suisse 1 g Gold Bar",
  "PAMP Suisse 2.5 g Gold Bar",
  "PAMP Suisse 5 g Gold Bar",
  "PAMP Suisse 10 g Gold Bar",
  "PAMP Suisse 20 g Gold Bar",
  "PAMP Suisse 1 oz Gold Bar",
  "PAMP Suisse 50 g Gold Bar",
  "PAMP Suisse 100 g Gold Bar",
  "PAMP Suisse 250 g Gold Bar",
  "PAMP Suisse 10 oz Gold Bar",
  "PAMP Suisse 500 g Gold Bar",
  "PAMP Suisse 1 kg Gold Bar",
  "PAMP Suisse 1 oz Silver Bar",
  "PAMP Suisse 50 g Silver Bar",
  "PAMP Suisse 100 g Silver Bar",
  "PAMP Suisse 250 g Silver Bar",
  "PAMP Suisse 10 oz Silver Bar",
  "PAMP Suisse 500 g Silver Bar",
  "PAMP Suisse 1 kg Silver Bar",

  // Credit Suisse Bars
  "Credit Suisse 1 g Gold Bar",
  "Credit Suisse 2.5 g Gold Bar",
  "Credit Suisse 5 g Gold Bar",
  "Credit Suisse 10 g Gold Bar",
  "Credit Suisse 20 g Gold Bar",
  "Credit Suisse 1 oz Gold Bar",
  "Credit Suisse 50 g Gold Bar",
  "Credit Suisse 100 g Gold Bar",
  "Credit Suisse 250 g Gold Bar",
  "Credit Suisse 10 oz Gold Bar",
  "Credit Suisse 500 g Gold Bar",
  "Credit Suisse 1 kg Gold Bar",
  "Credit Suisse 1 oz Silver Bar",
  "Credit Suisse 50 g Silver Bar",
  "Credit Suisse 100 g Silver Bar",
  "Credit Suisse 250 g Silver Bar",
  "Credit Suisse 10 oz Silver Bar",
  "Credit Suisse 500 g Silver Bar",
  "Credit Suisse 1 kg Silver Bar",

  // Valcambi Bars
  "Valcambi 1 g Gold Bar",
  "Valcambi 2.5 g Gold Bar",
  "Valcambi 5 g Gold Bar",
  "Valcambi 10 g Gold Bar",
  "Valcambi 20 g Gold Bar",
  "Valcambi 1 oz Gold Bar",
  "Valcambi 50 g Gold Bar",
  "Valcambi 100 g Gold Bar",
  "Valcambi 250 g Gold Bar",
  "Valcambi 10 oz Gold Bar",
  "Valcambi 500 g Gold Bar",
  "Valcambi 1 kg Gold Bar",
  "Valcambi 1 oz Silver Bar",
  "Valcambi 50 g Silver Bar",
  "Valcambi 100 g Silver Bar",
  "Valcambi 250 g Silver Bar",
  "Valcambi 10 oz Silver Bar",
  "Valcambi 500 g Silver Bar",
  "Valcambi 1 kg Silver Bar",

  // Perth Mint Bars
  "Perth Mint 1 g Gold Bar",
  "Perth Mint 2.5 g Gold Bar",
  "Perth Mint 5 g Gold Bar",
  "Perth Mint 10 g Gold Bar",
  "Perth Mint 20 g Gold Bar",
  "Perth Mint 1 oz Gold Bar",
  "Perth Mint 50 g Gold Bar",
  "Perth Mint 100 g Gold Bar",
  "Perth Mint 250 g Gold Bar",
  "Perth Mint 10 oz Gold Bar",
  "Perth Mint 500 g Gold Bar",
  "Perth Mint 1 kg Gold Bar",
  "Perth Mint 1 oz Silver Bar",
  "Perth Mint 50 g Silver Bar",
  "Perth Mint 100 g Silver Bar",
  "Perth Mint 250 g Silver Bar",
  "Perth Mint 10 oz Silver Bar",
  "Perth Mint 500 g Silver Bar",
  "Perth Mint 1 kg Silver Bar",

  // Royal Canadian Mint Bars
  "Royal Canadian Mint 1 g Gold Bar",
  "Royal Canadian Mint 2.5 g Gold Bar",
  "Royal Canadian Mint 5 g Gold Bar",
  "Royal Canadian Mint 10 g Gold Bar",
  "Royal Canadian Mint 20 g Gold Bar",
  "Royal Canadian Mint 1 oz Gold Bar",
  "Royal Canadian Mint 50 g Gold Bar",
  "Royal Canadian Mint 100 g Gold Bar",
  "Royal Canadian Mint 250 g Gold Bar",
  "Royal Canadian Mint 10 oz Gold Bar",
  "Royal Canadian Mint 500 g Gold Bar",
  "Royal Canadian Mint 1 kg Gold Bar",
  "Royal Canadian Mint 1 oz Silver Bar",
  "Royal Canadian Mint 50 g Silver Bar",
  "Royal Canadian Mint 100 g Silver Bar",
  "Royal Canadian Mint 250 g Silver Bar",
  "Royal Canadian Mint 10 oz Silver Bar",
  "Royal Canadian Mint 500 g Silver Bar",
  "Royal Canadian Mint 1 kg Silver Bar",

  // Additional Major Refiners
  "Johnson Matthey 1 oz Gold Bar",
  "Johnson Matthey 10 oz Gold Bar",
  "Johnson Matthey 1 oz Silver Bar",
  "Johnson Matthey 10 oz Silver Bar",
  "Johnson Matthey 100 oz Silver Bar",
  "Engelhard 1 oz Gold Bar",
  "Engelhard 10 oz Gold Bar",
  "Engelhard 1 oz Silver Bar",
  "Engelhard 10 oz Silver Bar",
  "Engelhard 100 oz Silver Bar",
  "Heraeus 1 oz Gold Bar",
  "Heraeus 10 oz Gold Bar",
  "Heraeus 1 oz Silver Bar",
  "Heraeus 10 oz Silver Bar",
  "Metalor 1 oz Gold Bar",
  "Metalor 10 oz Gold Bar",
  "Metalor 1 oz Silver Bar",
  "Metalor 10 oz Silver Bar",
  "Argor-Heraeus 1 oz Gold Bar",
  "Argor-Heraeus 10 oz Gold Bar",
  "Argor-Heraeus 1 oz Silver Bar",
  "Argor-Heraeus 10 oz Silver Bar",
];

const AIRTITE_CAPSULE_SIZES = [
  // Direct Fit capsules
  { diameter: 16.5, model: "A-16.5-DF", series: "Direct Fit", description: "Model A direct fit" },
  { diameter: 17.9, model: "A-18-DF", series: "Direct Fit", description: "Model A direct fit" },
  { diameter: 19.0, model: "A-19-DF", series: "Direct Fit", description: "Model A direct fit" },
  { diameter: 21.2, model: "A-21-DF", series: "Direct Fit", description: "Model A direct fit" },
  { diameter: 22.0, model: "A-22-DF", series: "Direct Fit", description: "Model A direct fit" },
  { diameter: 24.3, model: "A-24-DF", series: "Direct Fit", description: "Model A direct fit" },
  { diameter: 26.5, model: "A-26-DF", series: "Direct Fit", description: "Model A direct fit" },
  { diameter: 30.6, model: "T-30.6-DF", series: "Direct Fit", description: "Model T direct fit" },
  { diameter: 27.0, model: "H-27-DF", series: "Direct Fit", description: "Model H direct fit" },
  { diameter: 32.7, model: "H-32-DF", series: "Direct Fit", description: "Model H direct fit" },
  { diameter: 38.1, model: "H-38-DF", series: "Direct Fit", description: "Model H direct fit" },
  { diameter: 39.0, model: "H-39-DF", series: "Direct Fit", description: "Model H direct fit" },
  { diameter: 40.6, model: "H-40.6-DF", series: "Direct Fit", description: "Model H direct fit" },
  { diameter: 38.0, model: "X-38-DF", series: "Direct Fit", description: "Model X direct fit" },
  { diameter: 43.8, model: "X-43-DF", series: "Direct Fit", description: "Model X direct fit" },
  { diameter: 44.5, model: "X-44-DF", series: "Direct Fit", description: "Model X direct fit" },
  { diameter: 47.6, model: "X-47.6-DF", series: "Direct Fit", description: "Model X direct fit" },
  { diameter: 65.0, model: "Y-65-DF", series: "Direct Fit", description: "Model Y direct fit" },
  { diameter: 76.8, model: "Z-76.8-DF", series: "Direct Fit", description: "Model Z direct fit" },

  // Common Ring Type ranges
  { diameter: 26.0, model: "H-26-Ring", series: "Ring Type", description: "Model H ring type" },
  { diameter: 27.0, model: "H-27-Ring", series: "Ring Type", description: "Model H ring type" },
  { diameter: 28.0, model: "H-28-Ring", series: "Ring Type", description: "Model H ring type" },
  { diameter: 29.0, model: "H-29-Ring", series: "Ring Type", description: "Model H ring type" },
  { diameter: 30.0, model: "H-30-Ring", series: "Ring Type", description: "Model H ring type" },
  { diameter: 31.0, model: "H-31-Ring", series: "Ring Type", description: "Model H ring type" },
  { diameter: 32.0, model: "H-32-Ring", series: "Ring Type", description: "Model H ring type" },
  { diameter: 33.0, model: "I-33-Ring", series: "Ring Type", description: "Model I ring type" },
  { diameter: 34.0, model: "I-34-Ring", series: "Ring Type", description: "Model I ring type" },
  { diameter: 35.0, model: "I-35-Ring", series: "Ring Type", description: "Model I ring type" },
  { diameter: 36.0, model: "I-36-Ring", series: "Ring Type", description: "Model I ring type" },
  { diameter: 37.0, model: "I-37-Ring", series: "Ring Type", description: "Model I ring type" },
  { diameter: 38.0, model: "X-38-Ring", series: "Ring Type", description: "Model X ring type" },
  { diameter: 39.0, model: "X-39-Ring", series: "Ring Type", description: "Model X ring type" },
  { diameter: 40.0, model: "X-40-Ring", series: "Ring Type", description: "Model X ring type" },
  { diameter: 43.0, model: "X-43-Ring", series: "Ring Type", description: "Model X ring type" },
  { diameter: 44.0, model: "X-44-Ring", series: "Ring Type", description: "Model X ring type" },
];

const getAirtiteModelCodes = () => AIRTITE_CAPSULE_SIZES.map((size) => size.model);

const sortCapsuleCodes = (codes) =>
  Array.from(new Set(codes.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );

const buildCapsuleLookupValues = (inventoryCapsules = []) =>
  sortCapsuleCodes([...getAirtiteModelCodes(), ...inventoryCapsules]);

const parseCapsuleDiameter = (diameterMm) => {
  if (diameterMm === null || diameterMm === undefined) return null;
  const raw = String(diameterMm).trim();
  if (!raw || /[xX\u00D7]/.test(raw)) return null;
  const match = raw.replace(",", ".").match(/\d*\.?\d+/);
  if (!match) return null;
  const parsed = parseFloat(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const formatCapsuleDiameter = (diameter) => String(Number(diameter));

const shouldShowCapsuleSuggestion = () => {
  if (typeof document === "undefined") return true;
  const shapeEl =
    typeof elements !== "undefined" && elements?.numistaShape
      ? elements.numistaShape
      : safeGetElement("numistaShape");
  if (!shapeEl || !shapeEl.value) return true;
  return shapeEl.value === "Round";
};

const getNearestAirtiteSize = (diameterMm) => {
  const diameter = parseCapsuleDiameter(diameterMm);
  if (diameter === null) return null;

  return AIRTITE_CAPSULE_SIZES.reduce((bestFit, size) => {
    if (size.diameter < diameter) return bestFit;
    if (!bestFit) return size;
    return size.diameter < bestFit.diameter ? size : bestFit;
  }, null);
};

const updateCapsuleSuggestion = (diameterMm) => {
  const hint =
    typeof elements !== "undefined" && elements?.capsuleSuggestion
      ? elements.capsuleSuggestion
      : typeof document !== "undefined"
        ? safeGetElement("capsuleSuggestion")
        : null;
  if (!hint) return null;

  if (!shouldShowCapsuleSuggestion()) {
    hint.textContent = "";
    hint.removeAttribute("title");
    return null;
  }

  const match = getNearestAirtiteSize(diameterMm);
  if (!match) {
    hint.textContent = "";
    hint.removeAttribute("title");
    return null;
  }

  hint.textContent = `Suggested: ${match.model} (${formatCapsuleDiameter(match.diameter)}mm)`;
  hint.title = match.description;
  return match;
};

const METAL_ABBREVIATIONS = {
  // Coin series abbreviations (stacker slang)
  ase: "American Silver Eagle",
  age: "American Gold Eagle",
  agl: "American Gold Eagle",
  ape: "American Platinum Eagle",
  cml: "Maple Leaf",
  sml: "Silver Maple Leaf",
  gml: "Gold Maple Leaf",
  krug: "Krugerrand",
  kruger: "Krugerrand",
  phil: "Philharmonic",
  buff: "Buffalo",
  ap: "Philharmonic",
  br: "Britannia",
  panda: "Panda",
  libertad: "Libertad",
  kook: "Kookaburra",
  koala: "Koala",

  // Common purchase/storage locations
  jmb: "JM Bullion",
  lcs: "Local Coin Shop",
  sdb: "Safety Deposit Box",

  // Common metal types
  ag: "silver",
  au: "gold",
  pt: "platinum",
  pd: "palladium",
  // STRK-305: search-abbreviation namespace only — the weightUnit code "cu"
  // means constitutional silver and is unrelated to this table.
  cu: "copper",

  // Common terms
  oz: "ounce",
  "1oz": "1 ounce",
  bu: "brilliant uncirculated",
  ms: "mint state",
  pf: "proof",
  pr: "proof",
};

/**
 * Extract unique values from inventory for a specific field
 *
 * @param {Array} inventory - Current inventory data
 * @param {string} field - Field name to extract
 * @param {Object} [options={}] - Extraction options
 * @param {boolean} [options.includeEmpty=false] - Include empty/null values
 * @param {boolean} [options.caseSensitive=false] - Preserve original case
 * @returns {string[]} Array of unique values
 */
const extractUniqueValues = (inventory, field, options = {}) => {
  try {
    const { includeEmpty = false, caseSensitive = false } = options;

    if (!Array.isArray(inventory)) {
      console.warn("extractUniqueValues: inventory must be an array");
      return [];
    }

    const values = new Set();

    inventory.forEach((item) => {
      if (!item || typeof item !== "object") return;

      let value = item[field];

      // Handle different value types
      if (value === null || value === undefined) {
        if (includeEmpty) values.add("");
        return;
      }

      // Convert to string and normalize
      value = String(value).trim();

      if (!value && !includeEmpty) return;

      // Normalize case if not case sensitive
      const normalizedValue = caseSensitive ? value : value.toLowerCase();

      // Only add non-empty values or if empty values are explicitly included
      if (normalizedValue || includeEmpty) {
        values.add(caseSensitive ? value : normalizedValue);
      }
    });

    return Array.from(values).sort();
  } catch (error) {
    console.error("extractUniqueValues error:", error);
    return [];
  }
};

/**
 * Generate searchable variations for a given term
 * Includes common abbreviations, partial matches, and variations
 *
 * @param {string} term - Original term
 * @returns {string[]} Array of searchable variations
 */
const generateVariations = (term) => {
  if (!term || typeof term !== "string") return [];

  const variations = new Set([term]);
  const normalized = term.toLowerCase().trim();

  // Add normalized version
  variations.add(normalized);

  // Add individual words
  const words = normalized.split(/\s+/);
  words.forEach((word) => {
    if (word.length >= 2) {
      variations.add(word);
    }
  });

  // Add partial prefixes (for names 4+ characters)
  if (normalized.length >= 4) {
    for (let i = 3; i <= Math.min(normalized.length, 8); i++) {
      variations.add(normalized.substring(0, i));
    }
  }

  // Check for known abbreviations
  const abbrevExpansion = METAL_ABBREVIATIONS[normalized];
  if (abbrevExpansion) {
    variations.add(abbrevExpansion);
  }

  // Check if this term could be an expansion of an abbreviation
  Object.entries(METAL_ABBREVIATIONS).forEach(([abbrev, expansion]) => {
    if (expansion.toLowerCase().includes(normalized)) {
      variations.add(abbrev);
    }
  });

  return Array.from(variations);
};

/**
 * Normalize item name to base form for grouping (e.g., filter chips).
 * Uses precise starts-with matching against PREBUILT_LOOKUP_DATA — longest
 * match wins. Falls back to suffix stripping for items not in the lookup.
 *
 * @param {string} fullName - Full item name (e.g., "2024 American Silver Eagle PCGS MS70")
 * @returns {string} Base name (e.g., "American Silver Eagle")
 */
const normalizeItemName = (fullName) => {
  if (!fullName || typeof fullName !== "string") {
    return fullName || "";
  }

  let name = fullName.trim();

  // Step 1: Strip year prefixes (1900-2039, with optional mint marks like P, S, D, PDSSS)
  name = name.replace(/^(1[89]\d{2}|20[0-3]\d)[A-Za-z]*\s+/, "");

  // Step 2: Strip weight prefixes ("1 oz", "2 oz", "1/2 oz", "1/10 oz", "30 gram", etc.)
  name = name.replace(/^\d+(?:\s*\/\s*\d+)?\s*(?:oz|ounce|gram|g)\s+/i, "");

  // Step 3: Find the longest PREBUILT_LOOKUP_DATA entry that the name starts with
  const nameLower = name.toLowerCase();
  let bestMatch = null;
  let bestMatchLen = 0;

  for (const baseName of PREBUILT_LOOKUP_DATA) {
    const baseNameLower = baseName.toLowerCase();
    if (nameLower.startsWith(baseNameLower) && baseName.length > bestMatchLen) {
      // Ensure word boundary — next char must be space, end-of-string, or non-alpha
      const nextChar = name[baseName.length];
      if (!nextChar || nextChar === " " || !/[a-zA-Z]/.test(nextChar)) {
        bestMatch = baseName;
        bestMatchLen = baseName.length;
      }
    }
  }

  if (bestMatch) {
    return bestMatch;
  }

  // Step 4: No lookup match — strip known suffixes for clean grouping
  // First, collapse embedded weight patterns (" 1 oz ", " 30 gram ") to a single space
  name = name.replace(/\s+\d+(?:\s*\/\s*\d+)?\s*(?:oz|ounce|gram|g)\s+/i, " ");

  name = name
    .replace(/\b(?:PCGS|NGC|NCG|ICG|ANACS)\b.*/i, "")
    .replace(/\b(?:MS|PR|PF)\s*\d{2}\b.*/i, "")
    .replace(/\b(?:BU|Proof|UNC|Uncirculated)\b.*/i, "")
    .replace(/\b(?:In Capsule|In Assay|Sealed|w\/Box|COA)\b.*/i, "")
    .replace(/\b(?:Colorized|Colored|Antiqued|Abrasions)\b.*/i, "")
    .replace(/\b(?:with\s+TEP|TEP)\b.*/i, "")
    .replace(/\b(?:FS|FR|DCAM|First Strike|First Release|Deep Cameo)\b.*/i, "")
    .replace(/\s+(?:Silver|Gold|Platinum|Palladium|Copper)\s+(?:Coin|Bar|Round)\s*$/i, "")
    .trim();

  // Clean up any leading punctuation/dashes left after stripping
  name = name.replace(/^[\s\-–—:,]+/, "").trim();

  return name || fullName.trim();
};

/**
 * Build searchable indices with variants for all lookup data
 *
 * @param {LookupTable} lookupTable - Base lookup table data
 * @returns {Object} Enhanced lookup table with search indices
 */
const buildSearchIndices = (lookupTable) => {
  try {
    const indices = {
      nameVariants: new Map(),
      locationVariants: new Map(),
      typeVariants: new Map(),
    };

    // Build name variants index
    lookupTable.names.forEach((name) => {
      const variations = generateVariations(name);
      variations.forEach((variant) => {
        if (!indices.nameVariants.has(variant)) {
          indices.nameVariants.set(variant, []);
        }
        indices.nameVariants.get(variant).push(name);
      });
    });

    // Build purchase location variants index
    lookupTable.purchaseLocations.forEach((location) => {
      const variations = generateVariations(location);
      variations.forEach((variant) => {
        if (!indices.locationVariants.has(variant)) {
          indices.locationVariants.set(variant, []);
        }
        indices.locationVariants.get(variant).push(location);
      });
    });

    // Build storage location variants index
    lookupTable.storageLocations.forEach((location) => {
      const variations = generateVariations(location);
      variations.forEach((variant) => {
        if (!indices.locationVariants.has(variant)) {
          indices.locationVariants.set(variant, []);
        }
        indices.locationVariants.get(variant).push(location);
      });
    });

    // Build type variants index
    lookupTable.types.forEach((type) => {
      const variations = generateVariations(type);
      variations.forEach((variant) => {
        if (!indices.typeVariants.has(variant)) {
          indices.typeVariants.set(variant, []);
        }
        indices.typeVariants.get(variant).push(type);
      });
    });

    return {
      ...lookupTable,
      searchIndices: {
        nameVariants: indices.nameVariants,
        locationVariants: indices.locationVariants,
        typeVariants: indices.typeVariants,
      },
    };
  } catch (error) {
    console.error("buildSearchIndices error:", error);
    return lookupTable;
  }
};

/**
 * Generate lookup table from current inventory data with pre-built seed data
 *
 * @param {Array} [inventory] - Inventory data (defaults to global inventory)
 * @param {Object} [options={}] - Generation options
 * @param {boolean} [options.includeAbbreviations=true] - Include metal abbreviations
 * @param {boolean} [options.buildIndices=true] - Build search indices
 * @param {boolean} [options.usePrebuiltData=true] - Include pre-built industry data
 * @returns {LookupTable} Generated lookup table
 */
const generateLookupTable = (inventory, options = {}) => {
  try {
    const { includeAbbreviations = true, buildIndices = true, usePrebuiltData = true } = options;

    // Use global inventory if not provided
    const data = inventory || (typeof window !== "undefined" && window.inventory) || [];

    if (!Array.isArray(data)) {
      console.warn("generateLookupTable: No valid inventory data provided");
      return createEmptyLookupTable();
    }
    debugLog(`🔍 Generating lookup table from ${data.length} inventory items...`);
    // Extract unique values for each field from inventory
    const inventoryNames = extractUniqueValues(data, "name");
    const inventoryPurchaseLocations = extractUniqueValues(data, "purchaseLocation", {
      caseSensitive: true,
    });
    const inventoryStorageLocations = extractUniqueValues(data, "storageLocation", {
      caseSensitive: true,
    });
    const inventoryCapsules = extractUniqueValues(data, "capsule", { caseSensitive: true });
    const inventoryTypes = extractUniqueValues(data, "type");

    // Combine with pre-built data if enabled
    let allNames = inventoryNames;
    let allPurchaseLocations = inventoryPurchaseLocations;
    let allStorageLocations = inventoryStorageLocations;
    let allCapsules = inventoryCapsules;
    let allTypes = inventoryTypes;

    if (usePrebuiltData) {
      // Add pre-built names
      const combinedNames = new Set([...inventoryNames, ...PREBUILT_LOOKUP_DATA]);
      allNames = Array.from(combinedNames).sort();

      // Merge inventory purchase locations with common vendors
      const COMMON_PURCHASE_LOCATIONS = [
        "APMEX",
        "JM Bullion",
        "SD Bullion",
        "Provident Metals",
        "Golden Eagle Coins",
        "Money Metals Exchange",
        "Bullion Exchanges",
        "Liberty Coin",
        "Local Coin Shop",
        "Precious Metals Exchange",
        "Scottsdale Mint",
        "SilverTowne",
        "BGASC",
        "Gainesville Coins",
        "Texas Precious Metals",
        "Bullion Depot",
        "Hero Bullion",
        "Monument Metals",
      ];
      const combinedPurchase = new Set([
        ...inventoryPurchaseLocations,
        ...COMMON_PURCHASE_LOCATIONS,
      ]);
      allPurchaseLocations = Array.from(combinedPurchase).sort();

      // Merge inventory storage locations with common defaults
      const COMMON_STORAGE_LOCATIONS = [
        "Home Safe",
        "Bank Safety Deposit Box",
        "Private Vault",
        "Home Storage",
        "Safety Deposit Box",
        "Secure Storage Facility",
        "Personal Safe",
        "Bank Vault",
        "Precious Metals Depository",
        "Allocated Storage",
      ];
      const combinedStorage = new Set([...inventoryStorageLocations, ...COMMON_STORAGE_LOCATIONS]);
      allStorageLocations = Array.from(combinedStorage).sort();

      allCapsules = buildCapsuleLookupValues(inventoryCapsules);

      // Add standard types (if none exist)
      if (inventoryTypes.length === 0) {
        allTypes = ["Coin", "Bar", "Round", "Note", "Other"].sort();
      } else {
        const combinedTypes = new Set([...inventoryTypes, "Coin", "Bar", "Round", "Note", "Other"]);
        allTypes = Array.from(combinedTypes).sort();
      }
    }

    // Create base lookup table
    let lookupTable = {
      names: allNames,
      purchaseLocations: allPurchaseLocations,
      storageLocations: allStorageLocations,
      capsules: allCapsules,
      types: allTypes,
      abbreviations: includeAbbreviations ? { ...METAL_ABBREVIATIONS } : {},
      lastUpdated: Date.now(),
      itemCount: data.length,
      prebuiltItemCount: usePrebuiltData ? PREBUILT_LOOKUP_DATA.length : 0,
    };

    // Build search indices if requested
    if (buildIndices) {
      lookupTable = buildSearchIndices(lookupTable);
    }

    const totalNames = allNames.length;
    const prebuiltCount = usePrebuiltData ? PREBUILT_LOOKUP_DATA.length : 0;

    console.log(
      `✅ Lookup table generated: ${totalNames} names (${prebuiltCount} pre-built + ${inventoryNames.length} from inventory), ${allPurchaseLocations.length} purchase locations, ${allStorageLocations.length} storage locations, ${allCapsules.length} capsule codes, ${allTypes.length} types`
    );

    return lookupTable;
  } catch (error) {
    console.error("generateLookupTable error:", error);
    return createEmptyLookupTable();
  }
};

/**
 * Create an empty lookup table structure with pre-built data
 *
 * @returns {LookupTable} Empty lookup table with pre-built seed data
 */
const createEmptyLookupTable = () => ({
  names: [...PREBUILT_LOOKUP_DATA],
  purchaseLocations: [
    "APMEX",
    "JM Bullion",
    "SD Bullion",
    "Provident Metals",
    "Golden Eagle Coins",
    "Money Metals Exchange",
    "Bullion Exchanges",
    "Liberty Coin",
    "Local Coin Shop",
    "Precious Metals Exchange",
    "Scottsdale Mint",
    "SilverTowne",
    "BGASC",
  ],
  storageLocations: [
    "Home Safe",
    "Bank Safety Deposit Box",
    "Private Vault",
    "Home Storage",
    "Safety Deposit Box",
    "Secure Storage Facility",
    "Personal Safe",
  ],
  capsules: buildCapsuleLookupValues(),
  types: ["Coin", "Bar", "Round", "Note", "Other"],
  abbreviations: { ...METAL_ABBREVIATIONS },
  lastUpdated: Date.now(),
  itemCount: 0,
  prebuiltItemCount: PREBUILT_LOOKUP_DATA.length,
  searchIndices: {
    nameVariants: new Map(),
    locationVariants: new Map(),
    typeVariants: new Map(),
  },
});

/**
 * Load lookup table from cache or generate new one
 *
 * @param {Array} [inventory] - Current inventory data
 * @param {boolean} [forceRefresh=false] - Force regeneration regardless of cache
 * @returns {LookupTable} Lookup table data
 */
const loadLookupTable = (inventory, forceRefresh = false) => {
  try {
    // Check if we should use cached data
    if (!forceRefresh) {
      const cached = getCachedLookupTable();
      if (cached) {
        const currentCount = Array.isArray(inventory) ? inventory.length : 0;
        if (cached.itemCount !== currentCount && currentCount > 0) {
          console.log(
            `📋 Inventory count changed (${cached.itemCount} → ${currentCount}), rebuilding`
          );
        } else {
          console.log("📋 Using cached lookup table");
          currentLookupTable = cached;
          return cached;
        }
      }
    }

    // Generate new lookup table
    const newTable = generateLookupTable(inventory);

    // Cache the result
    cacheLookupTable(newTable);
    currentLookupTable = newTable;

    return newTable;
  } catch (error) {
    console.error("loadLookupTable error:", error);
    const emptyTable = createEmptyLookupTable();
    currentLookupTable = emptyTable;
    return emptyTable;
  }
};

/**
 * Get cached lookup table if valid
 *
 * @returns {LookupTable|null} Cached lookup table or null if invalid/expired
 */
const getCachedLookupTable = () => {
  try {
    if (typeof localStorage === "undefined") return null;

    const timestampStr = localStorage.getItem(AUTOCOMPLETE_CONFIG.timestampKey);
    const cacheStr = localStorage.getItem(AUTOCOMPLETE_CONFIG.cacheKey);

    if (!timestampStr || !cacheStr) return null;

    const timestamp = parseInt(timestampStr, 10);
    const now = Date.now();

    // Check if cache has expired
    if (now - timestamp > AUTOCOMPLETE_CONFIG.cacheTTL) {
      console.log("📋 Lookup table cache expired");
      return null;
    }

    const cached = JSON.parse(cacheStr);

    // Invalidate cache when app version changes (ensures code fixes take effect)
    const currentVersion = typeof APP_VERSION !== "undefined" ? APP_VERSION : "";
    if (cached._appVersion && cached._appVersion !== currentVersion) {
      console.log("📋 Lookup table cache stale (version mismatch)");
      return null;
    }

    // Validate cache structure
    if (
      !cached ||
      typeof cached !== "object" ||
      !Array.isArray(cached.names) ||
      !Array.isArray(cached.capsules)
    ) {
      console.warn("📋 Invalid cached lookup table structure");
      return null;
    }

    // Convert search indices back to Maps (they're serialized as objects)
    if (cached.searchIndices) {
      cached.searchIndices.nameVariants = new Map(
        Object.entries(cached.searchIndices.nameVariants || {})
      );
      cached.searchIndices.locationVariants = new Map(
        Object.entries(cached.searchIndices.locationVariants || {})
      );
      cached.searchIndices.typeVariants = new Map(
        Object.entries(cached.searchIndices.typeVariants || {})
      );
    }

    return cached;
  } catch (error) {
    console.warn("getCachedLookupTable error:", error);
    return null;
  }
};

/**
 * Cache lookup table to localStorage
 *
 * @param {LookupTable} lookupTable - Lookup table to cache
 */
const cacheLookupTable = (lookupTable) => {
  try {
    if (typeof localStorage === "undefined") return;

    // Convert Maps to objects for serialization
    const serializable = { ...lookupTable };
    if (lookupTable.searchIndices) {
      serializable.searchIndices = {
        nameVariants: Object.fromEntries(lookupTable.searchIndices.nameVariants || []),
        locationVariants: Object.fromEntries(lookupTable.searchIndices.locationVariants || []),
        typeVariants: Object.fromEntries(lookupTable.searchIndices.typeVariants || []),
      };
    }

    serializable._appVersion = typeof APP_VERSION !== "undefined" ? APP_VERSION : "";
    localStorage.setItem(AUTOCOMPLETE_CONFIG.cacheKey, JSON.stringify(serializable));
    localStorage.setItem(AUTOCOMPLETE_CONFIG.timestampKey, Date.now().toString());

    console.log("💾 Lookup table cached");
  } catch (error) {
    console.warn("cacheLookupTable error:", error);
  }
};

/**
 * Clear cached lookup table
 */
const clearLookupCache = () => {
  try {
    if (typeof localStorage === "undefined") return;

    localStorage.removeItem(AUTOCOMPLETE_CONFIG.cacheKey);
    localStorage.removeItem(AUTOCOMPLETE_CONFIG.timestampKey);

    console.log("🗑️ Lookup table cache cleared");
  } catch (error) {
    console.warn("clearLookupCache error:", error);
  }
};

/**
 * Get current lookup table stats
 *
 * @returns {Object} Lookup table statistics
 */
const getLookupStats = () => {
  const table = currentLookupTable || createEmptyLookupTable();

  return {
    names: table.names.length,
    purchaseLocations: table.purchaseLocations.length,
    storageLocations: table.storageLocations.length,
    capsules: table.capsules.length,
    types: table.types.length,
    abbreviations: Object.keys(table.abbreviations).length,
    lastUpdated: table.lastUpdated,
    itemCount: table.itemCount,
    hasSearchIndices: !!table.searchIndices,
    cacheValid: getCachedLookupTable() !== null,
  };
};

/**
 * Refresh lookup table from current inventory
 *
 * @param {Array} [inventory] - Current inventory data
 * @returns {LookupTable} Refreshed lookup table
 */
const refreshLookupTable = (inventory) => {
  console.log("🔄 Refreshing lookup table...");
  clearLookupCache();
  return loadLookupTable(inventory, true);
};

/**
 * Register a new item name into the current lookup table.
 * Called automatically when items are added or imported.
 *
 * @param {string} name - Item name to register
 */
const registerName = (name) => {
  if (!name || !currentLookupTable) return;
  const trimmed = name.trim();
  if (!trimmed || currentLookupTable.names.includes(trimmed)) return;
  currentLookupTable.names.push(trimmed);
  if (currentLookupTable.searchIndices?.nameVariants) {
    const variations = generateVariations(trimmed);
    for (const v of variations) {
      if (!currentLookupTable.searchIndices.nameVariants.has(v)) {
        currentLookupTable.searchIndices.nameVariants.set(v, []);
      }
      const arr = currentLookupTable.searchIndices.nameVariants.get(v);
      if (!arr.includes(trimmed)) {
        arr.push(trimmed);
      }
    }
  }
};

// Expose registerName globally so existing call sites pick it up
if (typeof window !== "undefined") {
  window.registerName = registerName;
}

const registerCapsule = (capsule) => {
  if (!capsule || !currentLookupTable) return;
  const trimmed = String(capsule).trim();
  if (!trimmed) return;
  if (!Array.isArray(currentLookupTable.capsules)) {
    currentLookupTable.capsules = buildCapsuleLookupValues();
  }
  if (currentLookupTable.capsules.includes(trimmed)) return;
  currentLookupTable.capsules = sortCapsuleCodes([...currentLookupTable.capsules, trimmed]);
};

if (typeof window !== "undefined") {
  window.registerCapsule = registerCapsule;
}

/**
 * Attach autocomplete dropdown to an input element.
 * Creates a dropdown that shows filtered suggestions from the lookup table.
 *
 * @param {HTMLInputElement} inputEl - The input element to attach to
 * @param {string} sourceType - Key into currentLookupTable ('names', 'purchaseLocations', 'storageLocations')
 */
const attachAutocomplete = (inputEl, sourceType) => {
  if (!inputEl || !inputEl.tagName) return;
  if (inputEl.dataset?.autocompleteSource === sourceType) return;
  if (inputEl.dataset) inputEl.dataset.autocompleteSource = sourceType;

  // Suppress native browser autocomplete
  // Firefox ignores "off" — a non-standard value forces it to back off
  inputEl.setAttribute("autocomplete", "staktrakr-no-autofill");

  let dropdown = null;
  let activeIndex = -1;
  let items = [];
  let debounceTimer = null;

  const getSourceArray = () => {
    if (!currentLookupTable) return [];
    return currentLookupTable[sourceType] || [];
  };

  /**
   * Position the dropdown using fixed coordinates relative to the input.
   * This "portal" approach escapes overflow:hidden on parent containers
   * (like modal-body / modal-content).
   */
  const positionDropdown = () => {
    if (!dropdown) return;
    const rect = inputEl.getBoundingClientRect();
    dropdown.style.position = "fixed";
    dropdown.style.top = `${rect.bottom}px`;
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.width = `${rect.width}px`;
  };

  const createDropdown = () => {
    if (dropdown) return dropdown;
    dropdown = document.createElement("div");
    dropdown.className = "autocomplete-dropdown";
    dropdown.setAttribute("role", "listbox");
    // Append to body to escape modal overflow clipping
    document.body.appendChild(dropdown);
    positionDropdown();
    return dropdown;
  };

  const hideDropdown = () => {
    if (dropdown) {
      dropdown.remove();
      dropdown = null;
    }
    activeIndex = -1;
    items = [];
  };

  const setActiveItem = (index) => {
    const children = dropdown ? dropdown.querySelectorAll(".autocomplete-item") : [];
    children.forEach((c) => c.classList.remove("active"));
    activeIndex = index;
    if (index >= 0 && index < children.length) {
      children[index].classList.add("active");
      children[index].scrollIntoView({ block: "nearest" });
    }
  };

  const selectItem = (value) => {
    inputEl.value = value;
    hideDropdown();
    // Fire input event so any listeners (e.g. validation) react
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    inputEl.focus();
  };

  const renderSuggestions = (suggestions) => {
    const dd = createDropdown();
    dd.innerHTML = "";
    activeIndex = -1;
    items = suggestions;

    if (!suggestions.length) {
      hideDropdown();
      return;
    }

    suggestions.forEach((s, i) => {
      const div = document.createElement("div");
      div.className = "autocomplete-item";
      div.setAttribute("role", "option");
      // Highlight the matching portion
      const query = inputEl.value.trim();
      div.innerHTML = highlightMatch(s.text, query);
      div.addEventListener("mousedown", (e) => {
        e.preventDefault(); // prevent blur before selection
        selectItem(s.text);
      });
      div.addEventListener("mouseenter", () => setActiveItem(i));
      dd.appendChild(div);
    });
  };

  /**
   * Highlight matching characters in suggestion text
   */
  const highlightMatch = (text, query) => {
    if (!query) return escapeHtml(text);
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    return escapeHtml(text).replace(regex, "<mark>$1</mark>");
  };

  const onInput = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const query = inputEl.value.trim();
      if (query.length < AUTOCOMPLETE_CONFIG.minCharacters) {
        hideDropdown();
        return;
      }

      const source = getSourceArray();
      let suggestions = [];

      // Check abbreviation expansion first
      const abbrevKey = query.toLowerCase();
      const expansion = METAL_ABBREVIATIONS[abbrevKey];
      if (expansion) {
        // Prepend the expanded term as top suggestion
        const expandedResults = fuzzySearch(expansion, source, {
          threshold: AUTOCOMPLETE_CONFIG.threshold,
          maxResults: AUTOCOMPLETE_CONFIG.maxSuggestions,
        });
        suggestions = expandedResults;
      }

      // Run fuzzy search on the original query
      const fuzzyResults = fuzzySearch(query, source, {
        threshold: AUTOCOMPLETE_CONFIG.threshold,
        maxResults: AUTOCOMPLETE_CONFIG.maxSuggestions,
      });

      // Merge: prefix matches first, then fuzzy, deduplicated
      const seen = new Set();
      const merged = [];

      // Exact prefix matches get highest priority
      const queryLower = query.toLowerCase();
      for (const item of source) {
        if (item.toLowerCase().startsWith(queryLower)) {
          if (!seen.has(item)) {
            seen.add(item);
            merged.push({ text: item, score: 2 }); // high score for prefix
          }
        }
      }

      // Add abbreviation expansion results
      for (const r of suggestions) {
        if (!seen.has(r.text)) {
          seen.add(r.text);
          merged.push(r);
        }
      }

      // Add fuzzy results
      for (const r of fuzzyResults) {
        if (!seen.has(r.text)) {
          seen.add(r.text);
          merged.push(r);
        }
      }

      // Limit to maxSuggestions
      renderSuggestions(merged.slice(0, AUTOCOMPLETE_CONFIG.maxSuggestions));
    }, 150);
  };

  const onKeydown = (e) => {
    if (!dropdown) return;
    const count = items.length;
    if (!count) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveItem(activeIndex < count - 1 ? activeIndex + 1 : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveItem(activeIndex > 0 ? activeIndex - 1 : count - 1);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      selectItem(items[activeIndex].text);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      hideDropdown();
    } else if (e.key === "Tab" && activeIndex >= 0) {
      selectItem(items[activeIndex].text);
    }
  };

  const onBlur = () => {
    // Delay to allow mousedown on dropdown items to fire first
    setTimeout(() => hideDropdown(), 150);
  };

  // Hide dropdown on scroll within the modal body (fixed position gets stale)
  const onScroll = () => {
    if (dropdown) hideDropdown();
  };
  const modalBody = inputEl.closest(".modal-body");
  if (modalBody) {
    modalBody.addEventListener("scroll", onScroll, { passive: true });
  }

  inputEl.addEventListener("input", onInput);
  inputEl.addEventListener("keydown", onKeydown);
  inputEl.addEventListener("blur", onBlur);
  inputEl.addEventListener("focus", () => {
    // Re-show suggestions if there's text and dropdown isn't visible
    if (inputEl.value.trim().length >= AUTOCOMPLETE_CONFIG.minCharacters && !dropdown) {
      onInput();
    }
  });
};

/**
 * Initialize autocomplete system
 * Should be called when inventory is loaded or changed
 *
 * @param {Array} [inventory] - Current inventory data
 */
const initializeAutocomplete = (inventory) => {
  try {
    // Check feature flag
    if (
      typeof window !== "undefined" &&
      window.featureFlags &&
      !window.featureFlags.isEnabled("FUZZY_AUTOCOMPLETE")
    ) {
      console.log("⏭️ Autocomplete disabled by feature flag");
      return createEmptyLookupTable();
    }

    console.log("🚀 Initializing autocomplete system...");

    // Load or generate lookup table
    const lookupTable = loadLookupTable(inventory);

    // Attach to form inputs if DOM elements are available
    // Note: `elements` is a global lexical binding from state.js, not window.elements
    if (typeof elements !== "undefined" && elements) {
      if (elements.itemName) attachAutocomplete(elements.itemName, "names");
      if (elements.purchaseLocation)
        attachAutocomplete(elements.purchaseLocation, "purchaseLocations");
      if (elements.storageLocation)
        attachAutocomplete(elements.storageLocation, "storageLocations");
      if (elements.itemCapsule) attachAutocomplete(elements.itemCapsule, "capsules");
    }

    // Log initialization stats
    const stats = getLookupStats();
    console.log("📊 Autocomplete initialized:", stats);

    return lookupTable;
  } catch (error) {
    console.error("initializeAutocomplete error:", error);
    return createEmptyLookupTable();
  }
};

/**
 * Dismiss all open autocomplete dropdowns (e.g. when the modal closes).
 */
const dismissAllAutocompletes = () => {
  document.querySelectorAll(".autocomplete-dropdown").forEach((dd) => dd.remove());
};

// Export functions for use by other modules
if (typeof window !== "undefined") {
  window.dismissAllAutocompletes = dismissAllAutocompletes;
  window.initializeAutocomplete = initializeAutocomplete;
  window.clearLookupCache = clearLookupCache;
  window.getNearestAirtiteSize = getNearestAirtiteSize;
  window.updateCapsuleSuggestion = updateCapsuleSuggestion;
  window.autocomplete = {
    // Core functions
    generateLookupTable,
    loadLookupTable,
    refreshLookupTable,
    initializeAutocomplete,
    registerName,
    registerCapsule,
    attachAutocomplete,

    // Utility functions
    extractUniqueValues,
    generateVariations,
    buildSearchIndices,
    normalizeItemName,
    getNearestAirtiteSize,
    updateCapsuleSuggestion,

    // Cache management
    getCachedLookupTable,
    cacheLookupTable,
    clearLookupCache,

    // Stats and info
    getLookupStats,

    // Configuration
    config: AUTOCOMPLETE_CONFIG,
    airtiteCapsuleSizes: AIRTITE_CAPSULE_SIZES,
    abbreviations: METAL_ABBREVIATIONS,

    // Current state
    getCurrentLookupTable: () => currentLookupTable,
  };
}

// For potential Node.js compatibility
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    generateLookupTable,
    loadLookupTable,
    refreshLookupTable,
    initializeAutocomplete,
    registerName,
    registerCapsule,
    attachAutocomplete,
    extractUniqueValues,
    generateVariations,
    buildSearchIndices,
    normalizeItemName,
    getNearestAirtiteSize,
    updateCapsuleSuggestion,
    getCachedLookupTable,
    cacheLookupTable,
    clearLookupCache,
    getLookupStats,
    config: AUTOCOMPLETE_CONFIG,
    airtiteCapsuleSizes: AIRTITE_CAPSULE_SIZES,
    abbreviations: METAL_ABBREVIATIONS,
    getCurrentLookupTable: () => currentLookupTable,
  };
}

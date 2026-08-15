// UTILS · CORE (STRK-177)
// =============================================================================
// Core utilities remaining after the STRK-177 split: HTML escaping, UUID,
// debounce, composition + spot-timestamp helpers, type/Numista normalization,
// inventory validation + valuation, error handling, modal/focus-trap, color
// contrast, eBay search, button-loading state. Persistence → js/utils-storage.js;
// date/currency/weight → js/utils-format.js; storage report →
// js/utils-storage-report.js. Bare global declarations (no IIFE); loads after its
// three sibling utils files in index.html.
// =============================================================================

// UTILITY FUNCTIONS

/**
 * Escape HTML special characters to prevent XSS when interpolating into innerHTML.
 * @param {*} str - Value to escape (coerced to string)
 * @returns {string} Escaped HTML-safe string
 */
const escapeHtml = (str) =>
  String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Logs messages to console when DEBUG flag is enabled
 *
 * @param {...any} args - Values to log when debugging
 */
const debugLog = (...args) => {
  if (DEBUG) {
    console.log(...args);
  }
};

/**
 * Generates a UUID v4 string for stable item identification.
 * Uses crypto.randomUUID() where available, with a Math.random() RFC 4122 v4 fallback
 * for environments (e.g. file:// protocol) that lack crypto.randomUUID.
 *
 * @returns {string} A UUID v4 string (e.g. "550e8400-e29b-41d4-a716-446655440000")
 */
/**
 * Splits a raw tag input string on commas and semicolons, trims whitespace,
 * and filters out empty tokens.
 *
 * @param {string} raw - Raw input string (e.g. "foo, bar; baz")
 * @returns {string[]} Non-empty trimmed tokens
 */
const parseTagInput = (raw) =>
  String(raw ?? "")
    .split(/[,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

const generateUUID = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // CSPRNG fallback (file:// protocol or older browsers)
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  // RFC 4122 v4 fallback (insecure Math.random)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * Gets the active branding name considering domain overrides
 *
 * @returns {string} Active branding name
 */
let brandingWarned = false;
const getBrandingName = () => {
  if (
    !BRANDING_DOMAIN_OVERRIDE &&
    !brandingWarned &&
    typeof window !== "undefined" &&
    window.location &&
    window.location.hostname
  ) {
    console.warn(`No branding mapping found for domain: ${window.location.hostname}`);
    brandingWarned = true;
  }
  return BRANDING_DOMAIN_OVERRIDE || BRANDING_TITLE;
};

/**
 * Returns full application title with version when no branding is configured
 *
 * @param {string} [baseTitle='StakTrakr'] - Base application title
 * @returns {string} Full title with version or branding name
 */
const getAppTitle = (baseTitle = "StakTrakr") => {
  const brand = getBrandingName();
  return brand && brand.trim() ? brand : `${baseTitle} ${getVersionString()}`;
};

/**
 * Determines active domain for footer copyright
 *
 * @returns {string} Domain name to display
 */
const getFooterDomain = () => {
  const host = window.location.hostname.toLowerCase();
  if (host === "staktrakr.com" || host.endsWith(".staktrakr.com")) return "staktrakr.com";
  if (host === "stackrtrackr.com" || host.endsWith(".stackrtrackr.com")) return "stackrtrackr.com";
  if (host === "stackertrackr.com" || host.endsWith(".stackertrackr.com"))
    return "stackertrackr.com";
  return "staktrakr.com";
};

/**
 * Performance monitoring utility
 *
 * @param {Function} fn - Function to monitor
 * @param {string} name - Name for logging
 * @param {...any} args - Arguments to pass to function
 * @returns {any} Result of function execution
 */
const monitorPerformance = (fn, name, ...args) => {
  const startTime = performance.now();
  const result = fn(...args);
  const endTime = performance.now();

  const duration = endTime - startTime;
  if (duration > 100) {
    console.warn(`Performance warning: ${name} took ${duration.toFixed(2)}ms`);
  } else {
    debugLog(`Performance: ${name} took ${duration.toFixed(2)}ms`);
  }

  return result;
};

/**
 * Creates a debounced function that delays invoking `func` until after `wait`
 * milliseconds have elapsed since the last time the debounced function was
 * invoked. The debounced function comes with a `cancel` method to cancel
 * delayed `func` invocations and a `flush` method to immediately invoke them.
 *
 * @param {Function} func The function to debounce.
 * @param {number} wait The number of milliseconds to delay.
 * @returns {Function} Returns the new debounced function.
 */
const debounce = (func, wait) => {
  let timeout;
  let result;

  const later = (context, args) => {
    timeout = null;
    if (args) {
      result = func.apply(context, args);
    }
  };

  const debounced = function (...args) {
    const context = this;
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => later(context, args), wait);
    return result;
  };

  debounced.cancel = () => {
    clearTimeout(timeout);
    timeout = null;
  };

  debounced.flush = () => {
    if (timeout) {
      debounced.cancel();
      later(this, []);
    }
  };

  return debounced;
};

/**
 * Refreshes composition dropdown options in add/edit modals
 */
const refreshCompositionOptions = () => {
  const priority = ["Gold", "Silver", "Platinum", "Palladium", "Copper", "Alloy"];
  const sorted = [...compositionOptions].sort((a, b) => {
    const ai = priority.indexOf(a);
    const bi = priority.indexOf(b);
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
    }
    return a.localeCompare(b);
  });
  [elements.itemMetal].forEach((sel) => {
    if (!sel) return;
    const current = sel.value;
    // STAK-580: build options as DOM nodes (no innerHTML) AND prepend a
    // required-selection placeholder so any later `itemMetal.value = ""`
    // selects something. Without the placeholder, selectedIndex falls to -1
    // and the closed select renders blank instead of the prompt text.
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = "Select metal…";
    const optionNodes = sorted.map((opt) => {
      const node = document.createElement("option");
      node.value = opt;
      node.textContent = opt;
      return node;
    });
    sel.replaceChildren(placeholder, ...optionNodes);
    if (sorted.includes(current)) sel.value = current;
  });
};

/**
 * Adds a composition option and updates dropdowns
 *
 * @param {string} value - Composition to add
 */
const addCompositionOption = (value) => {
  if (!value) return;
  compositionOptions.add(value);
  refreshCompositionOptions();
};

/**
 * Extracts up to the first two words from a composition string
 * while removing parenthetical content and numeric values.
 *
 * @param {string} composition - Raw composition description
 * @returns {string} First two cleaned words joined by a space
 */
const getCompositionFirstWords = (composition = "") => {
  return composition
    .replace(/\([^)]*\)/g, "") // remove parentheses and their contents
    .replace(/\d+(\.\d+)?%?/g, "") // remove numbers and percentages
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
};

/**
 * Determines display-friendly composition text.
 *
 * Returns "Alloy" when the first word isn't one of the primary metals
 * (Gold, Silver, Platinum, Palladium).
 *
 * @param {string} composition - Raw composition description
 * @returns {string} Display text for the composition
 */
const getDisplayComposition = (composition = "") => {
  const firstWords = getCompositionFirstWords(composition);
  const first = firstWords.split(/\s+/)[0] || "";
  const metals = ["gold", "silver", "platinum", "palladium", "copper"];
  return metals.includes(first.toLowerCase()) ? firstWords : "Alloy";
};

/**
 * Builds two-line HTML showing source and last cache refresh or API sync info for a metal
 *
 * @param {string} metalName - Metal name ('Silver', 'Gold', 'Platinum', 'Palladium')
 * @param {string} [mode="cache"] - "cache" or "api" to select timestamp
 * @returns {string} HTML string with source line and time line
 */
const getLastUpdateTime = (metalName, mode = "cache") => {
  if (!spotHistory || spotHistory.length === 0) return "";

  const metalEntries = spotHistory.filter((entry) => entry.metal === metalName);
  if (metalEntries.length === 0) return "";

  const latestEntry = metalEntries[metalEntries.length - 1];

  if (latestEntry.source === "manual") {
    return `Manual<br>Time entered ${formatTimestamp(latestEntry.timestamp)}`;
  }

  if (latestEntry.source === "seed") {
    const dateText = latestEntry.timestamp.slice(0, 10);
    // STRK-153: when the seed bundle includes a today-dated (noon) entry, saveSpotHistory
    // re-sorts it back to the tail even after a real same-day API sync recorded earlier in
    // the day. Compare by LOCAL CALENDAR DAY (not raw timestamps \u2014 the seed is noon, a real
    // sync may be morning): if a real sync occurred on/after the seed's date, prefer the live
    // label by falling through; otherwise keep the "Seed" label.
    const syncInfo =
      loadDataSync(LAST_API_SYNC_KEY, null) || loadDataSync(LAST_CACHE_REFRESH_KEY, null);
    const syncTs = syncInfo && syncInfo.timestamp;
    const syncDate =
      syncTs && !Number.isNaN(new Date(syncTs).getTime())
        ? new Date(syncTs).toLocaleDateString("en-CA")
        : null;
    if (!syncDate || syncDate < dateText) {
      return `Seed \u00b7 ${dateText}<br>Shift+click or long-press to set`;
    }
    // fall through to the api/cache label path below
  }

  if (latestEntry.source === "default") return "";

  const info = loadDataSync(mode === "api" ? LAST_API_SYNC_KEY : LAST_CACHE_REFRESH_KEY, null);
  if (!info || !info.timestamp) return "";

  const label = mode === "api" ? "Last API Sync" : "Last Cache Refresh";
  const provider = info.provider || "";
  const escapedProvider = escapeHtml(provider);
  const providerSpan = provider
    ? `<span class="ts-provider" title="Source: ${escapedProvider}">${escapedProvider} · </span>`
    : "";

  return `${providerSpan}<span class="ts-full">${label}</span><span class="ts-short">Last Synced</span> ${formatTimestamp(info.timestamp)}`;
};

/**
 * Updates spot timestamp element with toggle between cache refresh and API sync times
 *
 * @param {string} metalName - Metal name ('Silver', 'Gold', 'Platinum', 'Palladium')
 */
const updateSpotTimestamp = (metalName) => {
  const el = document.getElementById(`spotTimestamp${metalName}`);
  if (!el) return;

  const cacheHtml = getLastUpdateTime(metalName, "cache");
  const apiHtml = getLastUpdateTime(metalName, "api");

  // If no price data at all, show shift+click hint for discoverability
  if (!cacheHtml && !apiHtml) {
    el.innerHTML = "Shift+click or long-press to set";
    el.onclick = null;
    return;
  }

  // Compare raw storage data — when both keys hold the same provider+timestamp
  // (e.g. cache disabled / duration=0), the rendered HTML differs only by label text.
  // Compare the underlying data to detect this case correctly (STAK-274).
  const cacheData = loadDataSync(LAST_CACHE_REFRESH_KEY, null);
  const apiData = loadDataSync(LAST_API_SYNC_KEY, null);
  const sameUnderlying =
    cacheData &&
    apiData &&
    cacheData.provider === apiData.provider &&
    cacheData.timestamp === apiData.timestamp;

  // When cache and API have the same underlying data (e.g. cache disabled / duration=0),
  // or when only API data exists, show "Last API Sync" directly without toggle (STAK-274)
  if (!cacheHtml || sameUnderlying) {
    el.dataset.mode = "api";
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
    el.innerHTML = apiHtml || cacheHtml;
    el.onclick = null;
    return;
  }

  // When only cache data exists (no API sync yet), show cache without toggle
  if (!apiHtml) {
    el.dataset.mode = "cache";
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
    el.innerHTML = cacheHtml;
    el.onclick = null;
    return;
  }

  // Both cache and API have different data — show cache first with click-to-toggle
  el.dataset.mode = "cache";
  el.dataset.cache = cacheHtml;
  el.dataset.api = apiHtml;
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
  el.innerHTML = cacheHtml;

  el.onclick = () => {
    if (el.dataset.mode === "cache") {
      el.dataset.mode = "api";
      // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
      el.innerHTML = apiHtml;
    } else {
      el.dataset.mode = "cache";
      // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
      el.innerHTML = cacheHtml;
    }
  };
};

/**
 * Sanitizes text input for safe HTML display
 * Prevents XSS attacks by encoding HTML special characters
 *
 * @param {string} text - Text to sanitize
 * @returns {string} Sanitized text safe for HTML insertion
 */
const sanitizeHtml = (text) => {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

/**
 * Removes all non-alphanumeric characters from a string, preserving spaces.
 *
 * @param {string} str - Input string
 * @returns {string} Cleaned string containing only letters, numbers, and spaces
 */
const stripNonAlphanumeric = (str = "", { allowHyphen = false, allowSlash = false } = {}) =>
  str
    .toString()
    .replace(
      allowHyphen && allowSlash
        ? /[^a-zA-Z0-9 \\/-]/g
        : allowHyphen
          ? /[^a-zA-Z0-9 -]/g
          : allowSlash
            ? /[^a-zA-Z0-9 \\/]/g
            : /[^a-zA-Z0-9 ]/g,
      ""
    );

/**
 * Cleans a string by stripping HTML tags and control characters while
 * preserving punctuation. Normalizes whitespace and removes diacritics.
 *
 * @param {string} str - Input string
 * @returns {string} Cleaned string
 */
const cleanString = (str = "") => {
  let s = str.toString();
  let prev;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, "");
  } while (s !== prev);
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * Sanitizes all string properties of an object by stripping non-alphanumeric characters.
 *
 * @param {Object} obj - Object whose string fields will be sanitized
 * @returns {Object} New object with sanitized string fields
 */
const sanitizeObjectFields = (obj) => {
  const cleaned = { ...obj };
  for (const key of Object.keys(cleaned)) {
    if (typeof cleaned[key] === "string" && key !== "notes" && key !== "capsuleNotes") {
      // URL fields must not be sanitized — they contain :, /, . characters
      // UUID fields must not be sanitized — hyphens are part of the format
      // constitutionalVariant is a hyphenated enum id (e.g. "con-90-quarter") validated
      // against CONSTITUTIONAL_VARIANTS on read; stripping hyphens would break the lookup (STRK-235).
      if (
        key === "obverseImageUrl" ||
        key === "reverseImageUrl" ||
        key === "uuid" ||
        key === "tradedFromUuid" ||
        key === "constitutionalVariant"
      ) {
        continue;
      }
      const allowHyphen = key === "date";
      cleaned[key] =
        key === "name" ||
        key === "purchaseLocation" ||
        key === "year" ||
        key === "grade" ||
        key === "gradingAuthority" ||
        key === "certNumber" ||
        key === "serialNumber" ||
        key === "capsule"
          ? cleanString(cleaned[key])
          : stripNonAlphanumeric(cleaned[key], { allowHyphen });
    }
  }
  return cleaned;
};

/**
 * Allowed inventory item types
 * @constant {string[]}
 */
const VALID_TYPES = [
  "Coin",
  "Bar",
  "Round",
  "Note",
  "Aurum",
  "Goldback",
  "Silverback",
  "Constitutional",
  "Set",
  "Other",
];

/**
 * Normalizes item type to one of the predefined options
 *
 * @param {string} [type=""] - Raw type string
 * @returns {string} Normalized type value
 */
const normalizeType = (type = "") => {
  const t = type.toString().trim().toLowerCase();
  const match = VALID_TYPES.find((v) => v.toLowerCase() === t);
  return match || "Other";
};

/**
 * Maps Numista type strings to internal StakTrakr categories
 *
 * @param {string} type - Numista type string
 * @returns {string} Mapped internal type
 */
const mapNumistaType = (type = "") => {
  const t = type.toLowerCase();
  if (t.includes("goldback")) return "Goldback";
  if (t.includes("silverback")) return "Silverback";
  if (t.includes("aurum")) return "Aurum";
  if (t.includes("note")) return "Note";
  if (t.includes("bar") || t.includes("ingot")) return "Bar";
  if (t.includes("round") || t.includes("token") || t.includes("medal")) return "Round";
  if (t.includes("coin")) return "Coin";
  return "Other";
};

/**
 * Determines metal type from Numista composition string
 *
 * @param {string} composition - Composition description
 * @returns {string} Recognized metal or 'Alloy' if not silver/gold/platinum/palladium/copper
 */
const parseNumistaMetal = (composition = "") => {
  const c = composition.trim().toLowerCase();
  if (c.startsWith("silver")) return "Silver";
  if (c.startsWith("gold")) return "Gold";
  if (c.startsWith("platinum")) return "Platinum";
  if (c.startsWith("palladium")) return "Palladium";
  // STRK-305: pure copper only — "copper" or "copper (.999)". Numista alloy
  // strings like "copper-nickel" or "copper plated steel" must stay Alloy, or
  // the import gate would accept them with a defaulted purity of 1.0 and
  // produce materially wrong copper melt values.
  if (/^copper(\s*\(|$)/.test(c)) return "Copper";
  if (c.startsWith("paper")) return "Paper";
  return "Alloy";
};

/**
 * Sorts inventory by date (newest first)
 *
 * @param {Array} [data=inventory] - Data to sort
 * @returns {Array} Sorted inventory data
 */
const sortInventoryByDateNewestFirst = (data = inventory) => {
  return [...data].sort((a, b) => {
    // Handle unknown dates (—, empty, or Unknown) - they should sort to the bottom (oldest)
    const isUnknownA =
      !a.date || a.date.trim() === "" || a.date.trim() === "—" || a.date.trim() === "Unknown";
    const isUnknownB =
      !b.date || b.date.trim() === "" || b.date.trim() === "—" || b.date.trim() === "Unknown";

    if (isUnknownA && isUnknownB) return 0; // Both unknown, equal
    if (isUnknownA) return 1; // A is unknown, put it after B (older)
    if (isUnknownB) return -1; // B is unknown, put it after A (older)

    // Both have dates, compare normally
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    const timeA = isNaN(dateA) ? 0 : dateA.getTime();
    const timeB = isNaN(dateB) ? 0 : dateB.getTime();
    return timeB - timeA; // Descending order (newest first)
  });
};

/**
 * Validates inventory item data
 *
 * @param {Object} item - Inventory item to validate
 * @returns {Object} Validation result with isValid flag and errors array
 */
const validateInventoryItem = (item) => {
  const errors = [];

  // Required fields
  if (!item.name || typeof item.name !== "string" || item.name.trim().length === 0) {
    errors.push("Name is required");
  } else if (item.name.length > 100) {
    errors.push("Name must be 100 characters or less");
  }

  if (!item.metal || !["Silver", "Gold", "Platinum", "Palladium", "Copper"].includes(item.metal)) {
    errors.push("Valid metal type is required");
  }

  // Numeric validations
  if (!item.qty || !Number.isInteger(Number(item.qty)) || Number(item.qty) < 1) {
    errors.push("Quantity must be a positive integer");
  }

  if (!item.weight || isNaN(Number(item.weight)) || Number(item.weight) <= 0) {
    errors.push("Weight must be a positive number");
  }

  if (item.price === undefined || item.price === null || isNaN(Number(item.price))) {
    errors.push("Price must be a number");
  } else if (Number(item.price) < 0) {
    errors.push("Price cannot be negative");
  }

  // Optional field validations
  if (item.storageLocation && item.storageLocation.length > 50) {
    errors.push("Storage location must be 50 characters or less");
  }

  if (item.purchaseLocation && item.purchaseLocation.length > 100) {
    errors.push("Purchase location must be 100 characters or less");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Batch-validates an array of sanitized inventory items.
 * @param {Array} items - Items already processed by sanitizeImportedItem()
 * @param {Array} [skippedNonPM] - Items pre-filtered as non-PM (CSV only), default []
 * @returns {{ valid: Array, invalid: Array, skippedNonPM: Array, skippedCount: number }}
 */
const buildImportValidationResult = (items, skippedNonPM) => {
  const skippedItems = skippedNonPM || [];
  const valid = [];
  const invalid = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const result = validateInventoryItem(item);
    if (result.isValid) {
      valid.push(item);
    } else {
      invalid.push({
        index: i,
        name: item.name && item.name.trim() ? item.name.trim() : "Item " + (i + 1),
        reasons: result.errors,
      });
    }
  }
  return {
    valid,
    invalid,
    skippedNonPM: skippedItems,
    skippedCount: invalid.length + skippedItems.length,
  };
};

/**
 * Sanitizes imported inventory data, coercing invalid fields to safe defaults.
 *
 * String fields default to an empty string and numeric fields become null when
 * parsing fails. This allows imports to proceed even when some fields are
 * malformed.
 *
 * @param {Object} item - Raw item data from an import process
 * @returns {Object} Sanitized item
 */
const sanitizeImportedItem = (item) => {
  const sanitized = { ...item };

  // Ensure metal and composition are strings
  if (typeof sanitized.metal !== "string") {
    sanitized.metal = "";
  }
  if (typeof sanitized.composition !== "string") {
    sanitized.composition = sanitized.metal;
  }

  // Ensure price always has a numeric value
  const parsedPrice = parseFloat(sanitized.price);
  sanitized.price = isNaN(parsedPrice) ? 0 : parsedPrice;

  // Default purity to 1.0 (pure/fine) when missing or invalid
  const parsedPurity = parseFloat(sanitized.purity);
  sanitized.purity =
    isNaN(parsedPurity) || parsedPurity <= 0 || parsedPurity > 1 ? 1.0 : parsedPurity;

  // Ensure other numeric fields parse correctly
  const numFields = ["qty", "weight", "spotPriceAtPurchase"];
  for (const field of numFields) {
    if (sanitized[field] !== undefined) {
      const parsed = parseFloat(sanitized[field]);
      sanitized[field] = isNaN(parsed) ? null : parsed;
    }
  }

  // Normalize and sanitize string fields
  const basicFields = [
    "name",
    "type",
    "paymentMethod",
    "purchaseLocation",
    "storageLocation",
    "capsule",
  ];
  const cleanMultilineString = (str = "") => {
    let s = str.toString();
    let prev;
    do {
      prev = s;
      s = s.replace(/<[^>]*>/g, "");
    } while (s !== prev);
    return s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim();
  };
  for (const field of basicFields) {
    sanitized[field] = cleanString(sanitized[field]);
  }
  sanitized.notes = cleanMultilineString(sanitized.notes);
  sanitized.capsuleNotes = cleanMultilineString(sanitized.capsuleNotes);
  sanitized.type = normalizeType(sanitized.type);

  // Reset premium calculations if price or weight are missing
  if (!sanitized.price || !sanitized.weight) {
    sanitized.premiumPerOz = 0;
    sanitized.totalPremium = 0;
  }

  // UUID generation is NOT done here — callers provide uuid from the import
  // source (CSV/JSON/Numista), and loadInventory() assigns UUIDs to items
  // that reach storage without one. This allows the DiffEngine serial→UUID
  // bridge to work for backward-compat imports (STAK-380).

  return sanitizeObjectFields(sanitized);
};

/**
 * Returns the active constitutional-silver wear factor.
 * Reads the global worn/fresh basis (CONSTITUTIONAL_BASIS_KEY): "fresh" → 1.0,
 * "worn" (default) → CONSTITUTIONAL_WORN_SCALAR. Read at compute time so a basis
 * change reprices every item without a per-item edit (STRK-235).
 *
 * @returns {number} 1.0 for fresh ASW, CONSTITUTIONAL_WORN_SCALAR for worn
 */
const getConstitutionalWearFactor = () => {
  const basis =
    typeof loadDataSync === "function" ? loadDataSync(CONSTITUTIONAL_BASIS_KEY, "worn") : "worn";
  return basis === "fresh" ? 1 : CONSTITUTIONAL_WORN_SCALAR;
};

/**
 * Computes the total pure silver troy oz for a constitutional ("cu") item.
 * Deferred conversion: the item stores inputs (variant + count, or face value) and
 * the troy-oz figure is derived on demand. Face mode treats the stored weight as a
 * 90% subsidiary face value; denomination mode multiplies the variant's mint silver
 * weight by the coin count. The variant figures are ALREADY pure silver, so callers
 * must NOT re-apply item purity (that would double-discount). Unknown/missing variant
 * → 0 (corrupt or legacy import) rather than throwing (STRK-235).
 *
 * @param {Object} item - A weightUnit "cu" inventory item
 * @param {number} [wearFactor] - Pre-loaded wear factor; when omitted it is read from storage
 *   via getConstitutionalWearFactor(). Pass it to hoist the read out of a per-item loop.
 * @returns {number} Total pure silver troy oz (0 for an unknown variant)
 */
const getConstitutionalSilverOz = (item, wearFactor) => {
  if (!item) return 0;
  const wear = wearFactor !== undefined ? wearFactor : getConstitutionalWearFactor();
  if (item.constitutionalEntryMode === "face") {
    return (Number(item.weight) || 0) * CONSTITUTIONAL_SUBSIDIARY_OZT_PER_DOLLAR * wear;
  }
  const variant =
    typeof CONSTITUTIONAL_VARIANTS !== "undefined"
      ? CONSTITUTIONAL_VARIANTS.find((v) => v.id === item.constitutionalVariant)
      : null;
  if (!variant) return 0;
  // Invalid/zero count → 0 oz (matches the add-modal preview); a blank count fails
  // validation on save rather than silently counting one coin (STRK-235).
  const qty = Number(item.qty);
  return variant.silverOzFresh * wear * (Number.isFinite(qty) && qty > 0 ? qty : 0);
};

/**
 * The per-unit troy-ounce equivalent of an item's stored weight (STRK-316).
 *
 * Goldback ("gb") and Silverback ("sb") items store the raw *denomination* in `item.weight` —
 * a 5 Goldback stores `5`, not its 0.005 ozt of gold — so any consumer that reads the stored
 * number as troy ounces ranks and buckets them as if they were bullion ounces. Every other
 * unit already stores troy oz (`formatWeight` converts outward for display only), so those
 * pass through unchanged and stay byte-identical to the previous `parseFloat(item.weight)`.
 *
 * Deliberately **per-unit**, not qty-folded: the Weight sort key and the weight filter key are
 * both per-unit for bullion, and this helper has to slot into that existing frame. Callers that
 * need a lot total multiply by qty themselves (see `computeMeltValue`).
 *
 * Constitutional ("cu") is deliberately NOT handled here — its silver weight is variant-derived
 * *and* qty-folded, so callers route it through `getConstitutionalSilverOz` before reaching this.
 *
 * @param {Object} item - Inventory item (needs weight, weightUnit)
 * @returns {number} Per-unit troy ounces — denomination × conversion for gb/sb, else raw weight
 */
const getUnitOztWeight = (item) => {
  const weight = parseFloat(item?.weight) || 0;
  const gbFactor = typeof GB_TO_OZT !== "undefined" ? GB_TO_OZT : 0.001;
  if (item?.weightUnit === "gb") return weight * gbFactor;
  if (item?.weightUnit === "sb")
    return weight * (typeof SB_TO_OZT !== "undefined" ? SB_TO_OZT : gbFactor);
  return weight;
};

/**
 * Decimal places used for the gb/sb weight filter key (STRK-316).
 *
 * Five is the smallest width that keeps every Goldback denomination in its own bucket: the
 * quarter-Goldback is 0.00025 ozt, so 2 decimals (the cu precedent) collapses ¼/½/1/2 gb into
 * "0.00" and 3 decimals still collides ½ gb with 1 gb. It also has to be a fixed width rather
 * than a raw `String()` — `9 * 0.001` is `0.009000000000000001` in IEEE-754, and the key is
 * compared as a string, so float artifacts would be correctness bugs, not cosmetic ones.
 * @constant {number}
 */
const WEIGHT_FILTER_OZT_DECIMALS = 5;

/**
 * The string value used for weight filtering and the inventory-table Weight filter chip
 * (STRK-240, extended by STRK-316).
 *
 * Three key shapes, all on a troy-oz scale so units cannot collide across the column:
 * - Constitutional ("cu") → derived pure-silver oz at 2 decimals (unchanged).
 * - Goldback/Silverback ("gb"/"sb") → converted ozt at {@link WEIGHT_FILTER_OZT_DECIMALS}
 *   decimals. These store the raw denomination, so the legacy raw-weight key put a `2 gb` note
 *   and a `2.00 oz` round in the same bucket; keying on ozt separates them the same way cu was
 *   separated from bullion.
 * - Everything else → the raw stored `item.weight`, byte-identical to the legacy default.
 *
 * The gb/sb key is intentionally *not* human-facing — `getWeightFilterLabel` supplies the
 * chip text so the user still reads "5 gb" while the filter matches on "0.00500".
 *
 * Note: gb and sb share a conversion factor (both 0.001 ozt per unit), so a 1 Goldback and a
 * 1 Silverback resolve to the same key. That is intended — the weight filter is metal-agnostic
 * by design, and the metal filter is the axis that separates them.
 *
 * `wearFactor` lets a caller hoist the storage-backed wear basis out of a per-item loop (the
 * filter predicate reads it once so a large cu inventory does not re-read storage for every row).
 * @param {Object} item - Inventory item
 * @param {number} [wearFactor] - Pre-loaded constitutional wear factor (optional)
 * @returns {string} Filterable weight string (e.g. "7.15" cu, "0.00500" gb, "10" oz)
 */
const getItemFilterWeight = (item, wearFactor) => {
  if (item && item.weightUnit === "cu" && typeof getConstitutionalSilverOz === "function") {
    return getConstitutionalSilverOz(item, wearFactor).toFixed(2);
  }
  if (item && (item.weightUnit === "gb" || item.weightUnit === "sb")) {
    return getUnitOztWeight(item).toFixed(WEIGHT_FILTER_OZT_DECIMALS);
  }
  return String(item?.weight ?? "");
};

/**
 * Whether an item's stored weight is a *derived* value that `getItemFilterWeight` rewrites
 * (cu face value, gb/sb denomination) rather than a troy-oz figure it passes through.
 *
 * Exists so the inventory-table Weight cell does not carry its own copy of the unit list: the
 * cell's onclick key must be the exact key `_filterByWeight` recomputes, and a second literal
 * list would silently drift the moment a new derived unit is added (PR #1405 review, Codacy).
 * Plain bullion is excluded so the cell keeps emitting its raw `item.weight` — `filterLink`
 * JSON-stringifies that value, so routing it through the stringifying helper would change the
 * emitted onclick from `applyColumnFilter('weight', 10)` to `applyColumnFilter('weight', "10")`.
 *
 * @param {Object} item - Inventory item
 * @returns {boolean} True when the filter key differs from the stored weight
 */
const isDerivedWeightUnit = (item) =>
  item?.weightUnit === "cu" || item?.weightUnit === "gb" || item?.weightUnit === "sb";

/**
 * Units whose Weight cell text differs from the value stored in `item.weight` (STRK-319).
 *
 * `gb`/`sb` store a denomination; `g`/`kg`/`lb`/`mg` store troy ounces and convert outward for
 * display. Either way the filter key — which is the stored value — does not resemble the cell,
 * so a chip echoing it verbatim shows something the user never saw on the row. Plain `oz` is
 * absent because it is stored and displayed in the same unit, and `cu` is absent because its
 * key is a derived figure with no cell text to borrow (handled separately).
 *
 * This replaced two key-shape regexes that let `getWeightFilterLabel` skip its scan for keys
 * that could not be gb/sb or cu (PR #1405 review, Codacy). A metric key is a raw stored float
 * with no recognisable shape, so that shortcut could not be extended to cover it; the function
 * now makes a single pass instead of one per unit family, which is no more work than before.
 * @constant {string[]}
 */
const WEIGHT_DISPLAY_LENS_UNITS = ["gb", "sb", "g", "kg", "lb", "mg", "avdp"];

/**
 * The human-readable chip label for a weight filter key (STRK-316).
 *
 * Goldback/Silverback keys are converted troy-oz strings ("0.00500"), which are correct for
 * matching but unreadable in a filter chip — the chip renderer echoes the key verbatim, and a
 * Goldback stacker thinks in denominations, not ten-thousandths of an ounce. This resolves the
 * key back to the same text the Weight cell shows ("5 gb") so the chip and the cell agree.
 *
 * **Ambiguity is named, not hidden** (PR #1405 review, Codex + Copilot): gb and sb share a
 * conversion factor, so a 1 Goldback and a 1 Silverback both key to "0.00100" and the filter
 * genuinely selects both — correct for a metal-agnostic weight column. Labelling that chip
 * "1 gb" would hide the Silverbacks and, because it resolved by inventory order, could even
 * render "1 gb" for a click on a `1 sb` cell. When a key matches more than one unit the label
 * names them all ("1 gb/sb"); units are sorted so the result never depends on inventory order.
 *
 * STRK-319 extends this to every unit whose cell text differs from its key — `g`/`kg`/`lb`/`mg`
 * store troy ounces and display converted, so a 31.65 g bar keyed on "1.0175711288970755" put
 * that raw float in the chip. Plain `oz` already reads as its own key and falls through
 * unchanged, so bullion chips stay byte-identical.
 *
 * @param {string} value - The weight filter key
 * @param {Array<Object>} [items] - Item source; defaults to the global inventory
 * @returns {string} Display label (e.g. "5 gb", "1 gb/sb", "31.65 g"), or the key unchanged
 */
const getWeightFilterLabel = (value, items) => {
  const key = String(value ?? "");
  if (!key || typeof formatWeight !== "function") return key;
  const source = Array.isArray(items)
    ? items
    : typeof inventory !== "undefined" && Array.isArray(inventory)
      ? inventory
      : [];
  if (!source.length) return key;
  // One pass, not one per unit family: a metric key is a raw stored float with no recognisable
  // shape, so it cannot be pre-filtered the way gb/sb and cu keys were. At most one weight chip
  // is ever active, so this runs once per render.
  const wear =
    typeof getConstitutionalWearFactor === "function" ? getConstitutionalWearFactor() : undefined;
  const matches = source.filter((it) => it && getItemFilterWeight(it, wear) === key);
  if (!matches.length) return key;

  // STRK-300 (PR #1406 review, Codex): a cu key is a DERIVED ASW figure, not the stored weight,
  // so there is no cell text to borrow — name the unit instead, matching the cell tooltip's
  // "7.15 ozt ASW". Deliberately "oz" and not "ASW": the key is a plain troy-oz figure that by
  // design also matches a 7.15 oz bullion bar (that shared scale is the point of STRK-240), so
  // an ASW-specific label would misdescribe the bullion rows the same filter selects.
  if (matches.some((it) => it.weightUnit === "cu")) return `${key} oz`;

  const lensMatches = matches.filter((it) => WEIGHT_DISPLAY_LENS_UNITS.includes(it.weightUnit));
  if (!lensMatches.length) return key;
  // Sorted so the label is deterministic regardless of inventory order.
  const units = [...new Set(lensMatches.map((it) => it.weightUnit))].sort();
  const labels = units.map((unit) => {
    const match = lensMatches.find((it) => it.weightUnit === unit);
    return formatWeight(match.weight, unit, match);
  });
  if (labels.length === 1) return labels[0];
  // More than one unit produced this key, so the label must not imply a single one.
  //
  // Compact to a shared numeral ONLY when every unit renders the same number — gb and sb have
  // the same conversion factor, so a 1 Goldback and a 1 Silverback both read "1" and "1 gb/sb"
  // is accurate. Across metric units the numbers differ (0.025 g is 25 mg), and appending only
  // the second suffix would read as "0.025 g/mg" — implying 0.025 applies to both, or worse a
  // ratio (PR #1407 review, Codex + Copilot). Those are spelled out in full instead.
  const numerals = labels.map((label) => label.slice(0, label.lastIndexOf(" ")));
  const sharesNumeral = numerals.every((numeral) => numeral === numerals[0]);
  return sharesNumeral ? `${numerals[0]} ${units.join("/")}` : labels.join(" / ");
};

/**
 * Computes the melt value for an inventory item.
 * Centralises the formula: weight × qty × spot × purity.
 * Constitutional ("cu") items return early via getConstitutionalSilverOz × spot —
 * their silver weight is already pure, so purity is NOT applied again (STRK-235).
 *
 * @param {Object} item  - Inventory item (needs weight, qty, purity)
 * @param {number} spot  - Current spot price for the item's metal
 * @returns {number} Qty-adjusted melt value
 */
const computeMeltValue = (item, spot) => {
  if (item.weightUnit === "cu") {
    return getConstitutionalSilverOz(item) * (Number(spot) || 0);
  }
  const qty = Number(item.qty) || 1;
  const purity = parseFloat(item.purity) || 1.0;
  // STRK-316: the gb/sb denomination → troy-oz conversion now lives in one place.
  // Numerically identical to the previous inline ternary.
  return getUnitOztWeight(item) * qty * spot * purity;
};

/**
 * Finds an inventory item by UUID.
 *
 * @param {string} uuid - Inventory item UUID
 * @returns {Object|null} Matching item or null
 */
const findInventoryItemByUuid = (uuid) => {
  if (!uuid || typeof inventory === "undefined" || !Array.isArray(inventory)) return null;
  return inventory.find((item) => item?.uuid === uuid) || null;
};

/**
 * Computes a spot-derived trade value snapshot for an item on a date.
 *
 * @param {Object} item - Inventory item to value
 * @param {string} dateStr - Trade date in YYYY-MM-DD format
 * @returns {{meltValue: number, spotPrice: number, isCustom: boolean}|null}
 */
const computeTradeValue = (item, dateStr) => {
  if (!item) return null;
  // For today/future trades, prefer the live current spot — the daily
  // spot-history bundle lags by up to ~24h and would otherwise return
  // yesterday's snapshot, mismatching the inventory table's melt column.
  // (STRK-131)
  const today = new Date().toLocaleDateString("en-CA");
  if (dateStr && dateStr >= today && typeof spotPrices !== "undefined") {
    const liveSpot = spotPrices[String(item.metal || "").toLowerCase()];
    if (liveSpot > 0) {
      return {
        meltValue: computeMeltValue(item, liveSpot),
        spotPrice: liveSpot,
        isCustom: false,
      };
    }
  }
  if (typeof lookupHistoricalSpot !== "function") return null;
  const spotPrice = lookupHistoricalSpot(item.metal, dateStr);
  if (spotPrice === null) return null;
  return {
    meltValue: computeMeltValue(item, spotPrice),
    spotPrice,
    isCustom: false,
  };
};

/**
 * Returns the per-unit Goldback denomination retail price, or null.
 * Checks: weightUnit is 'gb', Goldback pricing is enabled, and a price exists.
 *
 * @param {Object} item - Inventory item
 * @returns {number|null} Per-unit denomination price, or null
 */
const getGoldbackRetailPrice = (item) => {
  if (item.weightUnit !== "gb") return null;
  if (typeof isGoldbackPricingActive !== "function" || !isGoldbackPricingActive()) return null;
  if (typeof getGoldbackDenominationPrice !== "function") return null;
  return getGoldbackDenominationPrice(parseFloat(item.weight));
};

/**
 * Calculates qty-adjusted retail value using the portfolio hierarchy:
 * max(Goldback denomination price, manual market value) → melt value.
 *
 * @param {Object} item - Inventory item
 * @param {number} currentSpot - Current spot price for the item's metal
 * @returns {{
 *   qty: number,
 *   marketValue: number,
 *   meltValue: number,
 *   gbDenomPrice: number|null,
 *   isManualRetail: boolean,
 *   retailTotal: number
 * }}
 */
const calculateRetailPrice = (item, currentSpot) => {
  const qty = Number(item?.qty) || 1;
  const marketValue = parseFloat(item?.marketValue) || 0;
  const meltValue = computeMeltValue(item, Number(currentSpot) || 0);
  const gbDenomPrice =
    typeof getGoldbackRetailPrice === "function" ? getGoldbackRetailPrice(item) : null;
  const retailUnitPrice = gbDenomPrice ? Math.max(gbDenomPrice, marketValue) : marketValue;
  const isManualRetail = marketValue > 0 && (!gbDenomPrice || marketValue >= gbDenomPrice);
  const retailTotal = retailUnitPrice > 0 ? retailUnitPrice * qty : meltValue;

  return {
    qty,
    marketValue,
    meltValue,
    gbDenomPrice,
    isManualRetail,
    retailTotal,
  };
};

/**
 * Computes normalized valuation values for an inventory item.
 * Centralizes purchase, melt, retail, and gain/loss calculations.
 *
 * @param {Object} item - Inventory item
 * @param {number} currentSpot - Current spot price for the item's metal
 * @returns {{
 *   qty: number,
 *   purchasePrice: number,
 *   purchaseTotal: number,
 *   marketValue: number,
 *   meltValue: number,
 *   gbDenomPrice: number|null,
 *   isManualRetail: boolean,
 *   retailTotal: number,
 *   hasRetailSignal: boolean,
 *   gainLoss: number|null
 * }}
 */
const computeItemValuation = (item, currentSpot) => {
  const normalizedSpot = Number(currentSpot) || 0;
  const { qty, marketValue, meltValue, gbDenomPrice, isManualRetail, retailTotal } =
    calculateRetailPrice(item, normalizedSpot);

  const purchasePrice = typeof item?.price === "number" ? item.price : parseFloat(item?.price) || 0;
  const purchaseTotal = purchasePrice * qty;
  const hasRetailSignal = normalizedSpot > 0 || isManualRetail || !!gbDenomPrice;
  const gainLoss = hasRetailSignal ? retailTotal - purchaseTotal : null;

  return {
    qty,
    purchasePrice,
    purchaseTotal,
    marketValue,
    meltValue,
    gbDenomPrice,
    isManualRetail,
    retailTotal,
    hasRetailSignal,
    gainLoss,
  };
};

/**
 * Builds the 13 leading value cells (Date..Gain/Loss) of a CSV row for one item.
 *
 * Single source of truth shared by the full inventory CSV export (csv-export.js) and
 * the backup ZIP CSV (inventory-backup.js); both column orders begin with this identical
 * group. Applies the valuation helper when available and falls back to legacy fields,
 * guarding a missing metal / non-numeric weight so a degenerate item serializes as
 * Silver/0.0000 instead of crashing the export (STRK-211/212).
 *
 * @param {Object} item - Inventory item.
 * @returns {Array<string|number>} The 13 Date-through-Gain/Loss cells.
 */
const buildCsvValueCells = (item) => {
  const currentSpot = spotPrices[(item.metal || "Silver").toLowerCase()] || 0;
  const valuation =
    typeof computeItemValuation === "function" ? computeItemValuation(item, currentSpot) : null;
  const purchasePrice = valuation
    ? valuation.purchasePrice
    : typeof item.price === "number"
      ? item.price
      : parseFloat(item.price) || 0;
  const meltValue = valuation ? valuation.meltValue : computeMeltValue(item, currentSpot);
  const gainLoss = valuation ? valuation.gainLoss : null;

  return [
    item.date,
    item.metal || "Silver",
    item.type,
    item.name,
    item.year || "",
    item.qty,
    (parseFloat(item.weight) || 0).toFixed(4),
    item.weightUnit || "oz",
    item.constitutionalVariant || "",
    item.constitutionalEntryMode || "",
    parseFloat(item.purity) || 1.0,
    formatCurrency(purchasePrice),
    currentSpot > 0 ? formatCurrency(meltValue) : "—",
    formatCurrency(item.marketValue || 0),
    gainLoss !== null ? formatCurrency(gainLoss) : "—",
  ];
};

/**
 * Handles errors with user-friendly messaging
 *
 * @param {Error|string} error - Error to handle
 * @param {string} context - Context where error occurred
 */
const handleError = (error, context = "") => {
  const errorMessage = error instanceof Error ? error.message : error.toString();

  console.error(`Error in ${context}:`, error);

  // Show user-friendly message
  const userMessage = getUserFriendlyMessage(errorMessage);
  appAlert(`Error: ${userMessage}`);
};

/**
 * Converts technical error messages to user-friendly ones
 *
 * @param {string} errorMessage - Technical error message
 * @returns {string} User-friendly error message
 */
const getUserFriendlyMessage = (errorMessage) => {
  if (errorMessage.includes("localStorage")) {
    return "Unable to save data. Please check your browser settings.";
  }
  if (errorMessage.includes("parse") || errorMessage.includes("JSON")) {
    return "The file format is not supported or corrupted.";
  }
  if (errorMessage.includes("network") || errorMessage.includes("fetch")) {
    return "Network connection issue. Please check your internet connection.";
  }

  // Default fallback
  return errorMessage || "An unexpected error occurred.";
};

/**
 * Downloads a file with the specified content and filename
 *
 * @param {string} filename - Name of the file to download
 * @param {string} content - Content of the file
 * @param {string} mimeType - MIME type of the file (default: text/plain)
 */
const downloadFile = (filename, content, mimeType = "text/plain") => {
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    link.style.display = "none";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up the object URL after a short delay
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error("Error downloading file:", error);
    handleError(error, "file download");
  }
};

/**
 * Globally close a modal by id and clear body overflow safely.
 * @param {string} id
 */
const closeModalById = (id) => {
  try {
    const modal = document.getElementById(id);
    if (modal) {
      releaseFocus(modal);
      modal.style.display = "none";
    }
  } catch (e) {
    /* ignore */
  }
  try {
    if (document && document.body) document.body.style.overflow = "";
  } catch (e) {}
};
// ---------------------------------------------------------------------------
// Focus trap — confines Tab/Shift+Tab within the topmost open modal
// ---------------------------------------------------------------------------
const _FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])';

/** Stack of { modal, previousFocus, handler } for nested modals */
const _focusTrapStack = [];

/**
 * Activate a focus trap on a modal element.
 * @param {HTMLElement} modal
 */
const trapFocus = (modal) => {
  // Idempotency: remove stale entry for this modal before re-registering
  const existingIdx = _focusTrapStack.findIndex((entry) => entry.modal === modal);
  if (existingIdx !== -1) {
    const stale = _focusTrapStack.splice(existingIdx, 1)[0];
    modal.removeEventListener("keydown", stale.handler);
  }

  const previousFocus = document.activeElement;

  const handler = (e) => {
    if (e.key !== "Tab") return;
    const focusable = Array.from(modal.querySelectorAll(_FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetWidth > 0 || el.offsetHeight > 0
    );
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  modal.addEventListener("keydown", handler);
  _focusTrapStack.push({ modal, previousFocus, handler });
};

/**
 * Release the focus trap on a modal and restore previous focus.
 * @param {HTMLElement} modal
 */
const releaseFocus = (modal) => {
  const idx = _focusTrapStack.findIndex((entry) => entry.modal === modal);
  if (idx === -1) return;
  const entry = _focusTrapStack.splice(idx, 1)[0];
  modal.removeEventListener("keydown", entry.handler);
  if (entry.previousFocus && entry.previousFocus.focus) {
    try {
      entry.previousFocus.focus();
    } catch (e) {
      /* element may have been removed */
    }
  }
};

/**
 * Opens a modal by id and sets body overflow to hidden.
 * Also initializes a click-outside-to-close handler once.
 * @param {string} id
 */
const openModalById = (id) => {
  try {
    const modal = document.getElementById(id);
    if (!modal) return;

    // initialize click-outside handler once per modal
    if (!modal.dataset.initialized) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModalById(id);
      });
      modal.dataset.initialized = "true";
    }

    modal.style.display = "flex";
    try {
      if (document && document.body) document.body.style.overflow = "hidden";
    } catch (e) {}
    // activate focus trap
    trapFocus(modal);
    // focus first focusable element for a11y
    try {
      const focusable = modal.querySelector(_FOCUSABLE_SELECTOR);
      if (focusable && focusable.focus) focusable.focus();
    } catch (e) {}
  } catch (e) {
    /* ignore */
  }
};
/**
 * Returns black or white contrast color for a given background.
 * Supports hex strings and CSS variables.
 * @param {string} bg - Background color in hex or CSS var format
 * @returns {string} '#000000' or '#ffffff'
 */
function getContrastColor(bg) {
  if (!bg) return "#000000";
  let hex = bg.trim();
  if (hex.startsWith("var(")) {
    const varName = hex.slice(4, -1).trim();
    hex = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }
  if (hex.startsWith("#")) {
    hex = hex.slice(1);
  }
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (hex.length !== 6) return "#000000";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

/**
 * Strips search-operator characters from a search term for use in external URLs.
 * Removes quotes, parentheses, and backslashes that act as search operators on eBay.
 * @param {string} term - Raw search term (may contain user-entered punctuation)
 * @returns {string} Cleaned term safe for external search queries
 */
function cleanSearchTerm(term) {
  return term
    .replace(/["'()\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function openEbayBuySearch(searchTerm) {
  if (!searchTerm) return;
  const cleanTerm = cleanSearchTerm(searchTerm);
  const encodedTerm = encodeURIComponent(cleanTerm);
  // eBay active listings URL — items currently for sale, sorted by best match
  const ebayUrl = `https://www.ebay.com/sch/i.html?_from=R40&_nkw=${encodedTerm}&_sacat=0&LH_BIN=1&_sop=12`;
  const popup = window.open(
    ebayUrl,
    `ebay_buy_${Date.now()}`,
    "width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no"
  );
  if (popup) {
    popup.opener = null;
    popup.focus();
  }
}

function openEbaySoldSearch(searchTerm) {
  if (!searchTerm) return;
  const cleanTerm = cleanSearchTerm(searchTerm);
  const encodedTerm = encodeURIComponent(cleanTerm);
  // eBay sold listings URL — completed sales, sorted by most recent
  const ebayUrl = `https://www.ebay.com/sch/i.html?_from=R40&_nkw=${encodedTerm}&_sacat=0&LH_Sold=1&LH_Complete=1&_sop=13`;
  const popup = window.open(
    ebayUrl,
    `ebay_sold_${Date.now()}`,
    "width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no"
  );
  if (popup) {
    popup.opener = null;
    popup.focus();
  }
}

/**
 * Sets a button's loading state, preserving its width and original content.
 * @param {HTMLButtonElement} btn - The button element
 * @param {boolean} isLoading - Whether to set loading state
 * @param {string} [loadingText] - Optional text to show next to spinner
 */
const setButtonLoading = (btn, isLoading, loadingText = "") => {
  if (!btn) return;
  if (isLoading) {
    if (!btn.dataset.originalHtml) {
      btn.dataset.originalHtml = btn.innerHTML;
      // Lock width to prevent layout jump
      const rect = btn.getBoundingClientRect();
      if (rect.width > 0) btn.style.width = rect.width + "px";
    }
    btn.disabled = true;
    // Spinner SVG (reusing existing spin animation)
    const spinner =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 0.8s linear infinite; margin-right:0.4em; vertical-align: middle;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
    btn.innerHTML = spinner + escapeHtml(loadingText || "Loading...");
  } else {
    if (btn.dataset.originalHtml) {
      btn.innerHTML = btn.dataset.originalHtml;
      delete btn.dataset.originalHtml;
    }
    btn.style.width = "";
    btn.disabled = false;
  }
};

// Local-data staleness thresholds (STRK-291).
//
// SUBJECT: how old the data in THIS BROWSER is — the age of the last successful
// sync or cache refresh. Drives the spot-card refresh icons and the market
// freshness dot.
//
// NOT the same measurement as `API_HEALTH_SPOT_STALE_MIN = 20` (js/api-health.js),
// which asks whether the PUBLISHER is still writing hourly files. That is a
// server-liveness check with a tight bound because the poller runs every ~15 min.
// This is a client-side "is what I'm looking at current" check, and a user who
// syncs manually would sit permanently alarmed under a 20-minute rule.
//
// Two numbers, two subjects, deliberately not unified. They are not meant to
// track each other — changing one does not imply changing the other.
const SPOT_FRESH_MAX_MIN = 60; // under an hour old → fresh
const SPOT_STALE_MAX_MIN = 1440; // under a day old → stale; beyond that → expired

/**
 * Returns CSS modifier class for a health-status dot based on timestamp age.
 * Handles both ISO and "YYYY-MM-DD HH:MM:SS" (local-stripped) formats.
 *
 * A null/absent timestamp returns `--red`. Callers that treat "no data" as a
 * milder state than "known-old data" must special-case it BEFORE calling —
 * `getSpotFreshnessStatus` (js/spot.js) does exactly that.
 * @param {string|null} timestamp
 * @returns {'--green'|'--orange'|'--red'}
 */
function getHealthStatusClass(timestamp) {
  if (!timestamp) return "--red";
  // A NEGATIVE offset ("-08:00") carries no "Z" and no "+", so the older
  // `includes("Z") || includes("+")` test appended a second designator and
  // produced "…T12:00:00-08:00Z" — an Invalid Date, whose NaN age fell through
  // both comparisons and reported `--red` for data that might be seconds old.
  // This mirrors `_normalizeTs` in js/api-health.js; the offset alternative is
  // anchored so a plain "YYYY-MM-DD HH:MM:SS" still gets its "Z".
  const trimmed = timestamp.trim();
  const normalized = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)
    ? trimmed.replace(" ", "T")
    : `${trimmed.replace(" ", "T")}Z`;
  const ageMin = Math.floor((Date.now() - new Date(normalized).getTime()) / 60000);
  if (ageMin < SPOT_FRESH_MAX_MIN) return "--green";
  if (ageMin < SPOT_STALE_MAX_MIN) return "--orange";
  return "--red";
}
window.getHealthStatusClass = getHealthStatusClass;

/**
 * Comparator ordering two ISO publication timestamps newest-first, with
 * unparseable values sinking to the end.
 *
 * Shared by the spot envelope race (js/api.js) and the retail manifest race
 * (js/retail.js), which pick the freshest of several endpoints publishing the
 * same feed. Both encode the same precedence rule — a timestamped candidate
 * always outranks an undated one, and an undated one wins only when it is all
 * that is left — so the rule lives in one place rather than being restated per
 * feed, where the two copies could drift apart silently.
 * @param {string|undefined} aIso - First publication timestamp
 * @param {string|undefined} bIso - Second publication timestamp
 * @returns {number} Negative when a is fresher, positive when b is
 */
function compareIsoFreshnessDesc(aIso, bIso) {
  const aTs = Date.parse(aIso);
  const bTs = Date.parse(bIso);
  if (isNaN(aTs) && isNaN(bTs)) return 0;
  if (isNaN(aTs)) return 1;
  if (isNaN(bTs)) return -1;
  return bTs - aTs;
}
window.compareIsoFreshnessDesc = compareIsoFreshnessDesc;

if (typeof window !== "undefined") {
  window.getContrastColor = getContrastColor;
  window.generateUUID = generateUUID;
  window.parseTagInput = parseTagInput;
  window.updateSpotTimestamp = updateSpotTimestamp;
  /**
   * Show a brief toast notification that auto-dismisses.
   * Reuses the cloud-toast CSS class + keyframes already in styles.css.
   * @param {string} message - Text to display
   * @param {number} [duration=3000] - Auto-dismiss time in ms
   */
  window.showToast = (message, duration = 3000) => {
    const toast = document.createElement("div");
    toast.className = "cloud-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("fade-out");
      toast.addEventListener("animationend", () => toast.remove());
    }, duration);
  };

  window.trapFocus = trapFocus;
  window.releaseFocus = releaseFocus;
  window.closeModalById = closeModalById;
  window.openModalById = openModalById;
  window.debounce = debounce;
  window.openEbayBuySearch = openEbayBuySearch;
  window.openEbaySoldSearch = openEbaySoldSearch;
  window.cleanSearchTerm = cleanSearchTerm;
  window.computeMeltValue = computeMeltValue;
  window.getConstitutionalWearFactor = getConstitutionalWearFactor;
  window.getConstitutionalSilverOz = getConstitutionalSilverOz;
  window.getUnitOztWeight = getUnitOztWeight;
  window.getItemFilterWeight = getItemFilterWeight;
  window.isDerivedWeightUnit = isDerivedWeightUnit;
  window.getWeightFilterLabel = getWeightFilterLabel;
  window.findItemByUuid = findInventoryItemByUuid;
  window.computeTradeValue = computeTradeValue;
  window.calculateRetailPrice = calculateRetailPrice;
  window.computeItemValuation = computeItemValuation;
  window.buildCsvValueCells = buildCsvValueCells;
  window.setButtonLoading = setButtonLoading;
  window.escapeHtml = escapeHtml;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    stripNonAlphanumeric,
    sanitizeObjectFields,
    sanitizeImportedItem,
    computeMeltValue,
    getConstitutionalSilverOz,
    getUnitOztWeight,
    getItemFilterWeight,
    isDerivedWeightUnit,
    getWeightFilterLabel,
    findItemByUuid: findInventoryItemByUuid,
    computeTradeValue,
    calculateRetailPrice,
    computeItemValuation,
    buildCsvValueCells,
    getContrastColor,
    debounce,
    generateUUID,
    setButtonLoading,
    escapeHtml,
  };
}

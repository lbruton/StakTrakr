// UTILS · FORMAT (STRK-177)
// =============================================================================
// Date / currency / weight formatting, extracted verbatim from js/utils.js to keep
// each file under the Codacy Lizard file-nloc gate (1500). Pure code motion — no
// behavior change. Holds: date helpers (pad2/todayStr/formatTimestamp/parseDate…),
// the multi-currency layer (formatCurrency, exchange rates, display currency) and
// weight conversions (grams/ozt/kg/lb, formatWeight, parseFraction).
//
// Bare global declarations (no IIFE) — other modules keep calling these as globals
// with no call-site change. Reads displayCurrency/exchangeRates from state.js at
// call time. Loads before js/utils.js in index.html.
// =============================================================================

// =============================================================================

/**
 * Pads a number with leading zeros to ensure two-digit format
 *
 * @param {number} n - Number to pad
 * @returns {string} Two-digit string representation
 * @example pad2(5) returns "05", pad2(12) returns "12"
 */
const pad2 = (n) => n.toString().padStart(2, "0");

/**
 * Returns current date as ISO string (YYYY-MM-DD)
 *
 * @returns {string} Current date in ISO format
 */
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/**
 * Returns current month key in YYYY-MM format
 *
 * @returns {string} Current month identifier
 */
const currentMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

/**
 * Formats a date/timestamp for display using the user's timezone preference (STACK-63).
 * When timezone is "auto" (default), uses the browser's local timezone — identical to previous behavior.
 *
 * @param {Date|string|number} date - Date object, ISO string, or epoch ms
 * @param {Intl.DateTimeFormatOptions} [options] - Override individual format options
 * @returns {string} Formatted date+time string
 */
const formatTimestamp = (date, options = {}) => {
  let d;
  if (date instanceof Date) {
    d = date;
  } else if (typeof date === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(date)) {
    // Bare UTC timestamp stored by recordSpot (e.g. "2026-02-15 01:58:32")
    // These are toISOString() values with T/Z stripped — re-attach Z so Date parses as UTC
    d = new Date(date.replace(" ", "T") + "Z");
  } else {
    d = new Date(date);
  }
  if (isNaN(d.getTime())) return "—";
  const tz = localStorage.getItem(TIMEZONE_KEY) || "auto";
  const resolvedTz = tz === "auto" ? undefined : tz;
  const defaults = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(resolvedTz ? { timeZone: resolvedTz } : {}),
  };
  try {
    return d.toLocaleString(undefined, { ...defaults, ...options });
  } catch (err) {
    if (err instanceof RangeError) {
      // Invalid IANA timezone in localStorage — fall back to auto and clear bad value
      try {
        localStorage.removeItem(TIMEZONE_KEY);
      } catch (_) {
        /* ignore */
      }
      const safeDefaults = { ...defaults };
      delete safeDefaults.timeZone;
      return d.toLocaleString(undefined, { ...safeDefaults, ...options });
    }
    throw err;
  }
};

/**
 * Formats a date for display (time only, no date) using the user's timezone preference.
 *
 * @param {Date|string|number} date - Date object, ISO string, or epoch ms
 * @returns {string} Formatted time string
 */
const formatTimeOnly = (date) => {
  return formatTimestamp(date, {
    year: undefined,
    month: undefined,
    day: undefined,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

/**
 * Formats a Date's LOCAL calendar components as YYYY-MM-DD. Deterministic
 * replacement for toLocaleDateString("en-CA"), whose output shape is
 * implementation-defined and can drift under small-icu / limited-locale
 * environments — formatDisplayDate splits this string on dashes.
 *
 * @param {Date} date - Locally-constructed Date
 * @returns {string} Local calendar date in YYYY-MM-DD format
 */
const localIsoDate = (date) => {
  // padStart keeps four-digit years below 0100 (e.g. 0099) zero-padded.
  const year = String(date.getFullYear()).padStart(4, "0");
  return `${year}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

/**
 * Constructs a local-midnight Date from numeric components and verifies they
 * round-trip unchanged. The Date constructor silently rolls impossible
 * calendar dates (Feb 31 → Mar 2/3), so a component mismatch means the input
 * date does not exist on the calendar (STRK-267).
 *
 * @param {number} year - Full 4-digit year
 * @param {number} monthIndex - Zero-based month (0-11)
 * @param {number} day - Day of month
 * @returns {Date|null} The validated Date, or null if the components rolled
 */
const validatedLocalDate = (year, monthIndex, day) => {
  // setFullYear sets all three components atomically — the Date constructor
  // would map years 0-99 to 1900-1999 and break the round-trip check.
  const date = new Date(2000, 0, 1);
  date.setFullYear(year, monthIndex, day);
  const roundTrips =
    date.getFullYear() === year && date.getMonth() === monthIndex && date.getDate() === day;
  return roundTrips ? date : null;
};

/**
 * Logs a parse-failure warning and returns the em-dash sentinel — the shared
 * tail for every parseDate rejection path.
 *
 * @param {string} dateStr - The original unparseable input
 * @returns {string} The "—" sentinel
 */
const warnUnparseableDate = (dateStr) => {
  console.warn(`Could not parse date: "${dateStr}", returning '—'`);
  return "—";
};

/**
 * Parses various date formats into standard YYYY-MM-DD format
 *
 * Handles:
 * - ISO format (YYYY-MM-DD)
 * - US format (MM/DD/YYYY)
 * - European format (DD/MM/YYYY)
 * - Year-first format (YYYY/MM/DD)
 *
 * Uses intelligent parsing to distinguish between US and European formats
 * based on date values and context clues.
 *
 * Parsed-date return sites format the Date's LOCAL components via
 * localIsoDate() — never toISOString, which reads UTC and shifts the calendar
 * day back for positive-UTC-offset users (STRK-266). Strict YYYY-MM-DD input
 * is returned verbatim after validation.
 *
 * Every numeric branch validates components via validatedLocalDate() and
 * rejects impossible calendar dates like Feb 31 with "—" (STRK-267) — both
 * the Date constructor and V8's string parsers would otherwise silently roll
 * them into the next month.
 *
 * @param {string} dateStr - Date string in any supported format
 * @returns {string} Date in YYYY-MM-DD format, or '—' if parsing fails
 */
function parseDate(dateStr) {
  if (!dateStr) return "—";

  // Clean the input string
  const cleanDateStr = dateStr.trim();

  // Try ISO format (YYYY-MM-DD) first - most reliable. Impossible dates are
  // rejected outright: V8 rolls new Date("2024-02-31") to Mar 1 rather than
  // producing Invalid Date, so string-construction validity cannot be trusted.
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDateStr)) {
    const [year, month, day] = cleanDateStr.split("-").map(Number);
    if (validatedLocalDate(year, month - 1, day)) {
      return cleanDateStr;
    }
    return warnUnparseableDate(dateStr);
  }

  // Try YYYY/MM/DD format (unambiguous)
  const ymdMatch = cleanDateStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);

    const date = validatedLocalDate(year, month, day);
    if (date) {
      return localIsoDate(date);
    }
    // Reject directly — the generic fallback also rolls "2026/02/31" → Mar 3.
    return warnUnparseableDate(dateStr);
  }

  // Handle ambiguous MM/DD/YYYY vs DD/MM/YYYY formats
  const ambiguousMatch = cleanDateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ambiguousMatch) {
    const first = parseInt(ambiguousMatch[1], 10);
    const second = parseInt(ambiguousMatch[2], 10);
    const year = parseInt(ambiguousMatch[3], 10);

    // If first number > 12, it must be DD/MM/YYYY (European)
    if (first > 12 && second <= 12) {
      const date = validatedLocalDate(year, second - 1, first);
      if (date) {
        return localIsoDate(date);
      }
    }
    // Otherwise treat as MM/DD/YYYY (US) — unambiguous when second > 12,
    // and the default when both numbers are <= 12 (ambiguous)
    else if (first <= 12) {
      const date = validatedLocalDate(year, first - 1, second);
      if (date) {
        return localIsoDate(date);
      }
    }
    // Matched a numeric shape but no interpretation survived validation —
    // reject directly so the rolling generic parser never sees the string.
    return warnUnparseableDate(dateStr);
  }

  // Try parsing as a general date string (fallback)
  try {
    const date = new Date(cleanDateStr);
    if (!isNaN(date) && date.toString() !== "Invalid Date") {
      return localIsoDate(date);
    }
  } catch (e) {
    // Continue to fallback
  }

  // If all parsing fails, return '—'
  return warnUnparseableDate(dateStr);
}

/**
 * Formats a date string into compact MM/DD/YY format
 *
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {string} Formatted date (e.g., "1/1/69")
 */
const formatDisplayDate = (dateStr) => {
  if (!dateStr || dateStr === "—" || dateStr === "Unknown") return "—";

  const parts = dateStr.split("-");
  if (parts.length !== 3) return "—";

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (isNaN(year) || isNaN(month) || isNaN(day) || month < 1 || month > 12) return "—";

  const yy = String(year).slice(-2);
  return `${month}/${day}/${yy}`;
};

// Cache Intl.NumberFormat instances to reduce instantiation overhead
// Key format: 'default-USD', 'en-EUR' — locale prefix + uppercase currency code
const numberFormatCache = new Map();

/**
 * Formats a number as a currency string using the default currency
 *
 * @param {number|string} value - Number to format
 * @param {string} [currency=DEFAULT_CURRENCY] - ISO currency code
 * @returns {string} Formatted currency string (e.g., "$1,234.56")
 */
const formatCurrency = (
  value,
  currency = typeof displayCurrency !== "undefined" ? displayCurrency : DEFAULT_CURRENCY
) => {
  const num = parseFloat(value);
  if (isNaN(num)) return "";
  // Convert internal USD value to target currency (STACK-50)
  const rate = typeof getExchangeRate === "function" ? getExchangeRate(currency) : 1;
  const converted = num * rate;
  try {
    const upperCurrency = currency.toUpperCase();
    const cacheKey = `default-${upperCurrency}`;
    let formatter = numberFormatCache.get(cacheKey);
    if (!formatter) {
      formatter = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: upperCurrency,
      });
      numberFormatCache.set(cacheKey, formatter);
    }
    return formatter.format(converted);
  } catch (e) {
    // Fallback for environments without Intl support
    return `${currency} ${converted.toFixed(2)}`;
  }
};

/**
 * Loads the display currency preference from localStorage (STACK-50)
 */
const loadDisplayCurrency = () => {
  try {
    const saved = loadDataSync(DISPLAY_CURRENCY_KEY, DEFAULT_CURRENCY);
    if (saved && typeof saved === "string") {
      displayCurrency = saved;
    }
  } catch (e) {
    displayCurrency = DEFAULT_CURRENCY;
  }
};

/**
 * Saves the display currency preference to localStorage (STACK-50)
 * @param {string} code - ISO 4217 currency code
 */
const saveDisplayCurrency = (code) => {
  displayCurrency = code;
  saveDataSync(DISPLAY_CURRENCY_KEY, code);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("currencychange", { detail: { code } }));
  }
  if (typeof scheduleSyncPush === "function") scheduleSyncPush();
};

/**
 * Extracts the currency symbol from Intl.NumberFormat for the given currency code (STACK-50)
 * @param {string} [currency] - ISO 4217 code; defaults to displayCurrency
 * @returns {string} Currency symbol (e.g. "$", "€", "£", "₽")
 */
const getCurrencySymbol = (currency) => {
  const code = (
    currency || (typeof displayCurrency !== "undefined" ? displayCurrency : "USD")
  ).toUpperCase();
  try {
    const cacheKey = `en-${code}`;
    let formatter = numberFormatCache.get(cacheKey);
    if (!formatter) {
      formatter = new Intl.NumberFormat("en", { style: "currency", currency: code });
      numberFormatCache.set(cacheKey, formatter);
    }
    const parts = formatter.formatToParts(0);
    const sym = parts.find((p) => p.type === "currency");
    return sym ? sym.value : code;
  } catch (e) {
    return code;
  }
};

/**
 * Returns the number of minor-unit fraction digits for a currency code.
 * Uses Intl.NumberFormat to resolve the correct decimal count per ISO 4217.
 * Examples: USD → 2, EUR → 2, JPY → 0, KWD → 3.
 *
 * @param {string} [currency] - ISO 4217 code; defaults to displayCurrency
 * @returns {number} Number of fraction digits (typically 2 for most currencies)
 * @STRK-88
 */
const getCurrencyFractionDigits = (currency) => {
  const code = (
    currency || (typeof displayCurrency !== "undefined" ? displayCurrency : "USD")
  ).toUpperCase();
  try {
    const cacheKey = `frac-${code}`;
    let cached = numberFormatCache.get(cacheKey);
    if (!cached) {
      cached = new Intl.NumberFormat(undefined, { style: "currency", currency: code });
      numberFormatCache.set(cacheKey, cached);
    }
    return cached.resolvedOptions().minimumFractionDigits;
  } catch (e) {
    return 2; // safe default
  }
};

/**
 * Rounds a numeric price value to the active display-currency's minor-unit precision.
 * Prevents floating-point drift artifacts such as "56.666667" from appearing in
 * price input fields after LOT/EACH toggle conversions (STRK-88).
 *
 * @param {number} value - Price value to round (in display currency units)
 * @param {string} [currency] - ISO 4217 code; defaults to displayCurrency
 * @returns {number} Rounded value
 * @STRK-88
 */
const roundToPricePrecision = (value, currency) => {
  const digits = getCurrencyFractionDigits(currency);
  const factor = Math.pow(10, digits);
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

/**
 * Updates the add/edit modal's currency symbols and placeholders (STACK-50)
 * Sets the CSS custom property --currency-symbol on .currency-input wrappers
 * and updates input placeholders with the current currency code.
 */
const updateModalCurrencyUI = () => {
  const symbol = getCurrencySymbol();
  // Scale padding based on symbol width: 1 char → 2rem, 2 → 2.5rem, 3+ → 3.25rem
  const padding = symbol.length <= 1 ? "2rem" : symbol.length <= 2 ? "2.5rem" : "3.25rem";
  document.querySelectorAll(".currency-input").forEach((el) => {
    el.style.setProperty("--currency-symbol", `"${symbol}"`);
    el.style.setProperty("--currency-padding", padding);
  });
  const marketInput = document.getElementById("itemMarketValue");
  if (marketInput) marketInput.placeholder = `${displayCurrency || "USD"} — defaults to melt value`;
};

/**
 * Returns the exchange rate for a target currency (STACK-50).
 * 1 USD = getExchangeRate(code) × target currency.
 * Falls back: cached exchangeRates → FALLBACK_EXCHANGE_RATES → 1.
 *
 * @param {string} [targetCurrency] - ISO 4217 code; defaults to displayCurrency
 * @returns {number} Exchange rate multiplier
 */
const getExchangeRate = (targetCurrency) => {
  const target = targetCurrency || displayCurrency;
  if (target === "USD") return 1;
  if (exchangeRates[target]) return exchangeRates[target];
  if (typeof FALLBACK_EXCHANGE_RATES !== "undefined" && FALLBACK_EXCHANGE_RATES[target]) {
    return FALLBACK_EXCHANGE_RATES[target];
  }
  return 1;
};

/**
 * Loads cached exchange rates from localStorage (STACK-50).
 * Called on startup before any rendering.
 */
const loadExchangeRates = () => {
  try {
    const saved = loadDataSync(EXCHANGE_RATES_KEY, null);
    if (saved && typeof saved === "object") {
      exchangeRates = saved;
    }
  } catch (e) {
    exchangeRates = {};
  }
};

/**
 * Saves exchange rates to localStorage (STACK-50).
 * @param {Object<string, number>} rates - Exchange rates keyed by currency code
 */
const saveExchangeRates = (rates) => {
  exchangeRates = rates;
  saveDataSync(EXCHANGE_RATES_KEY, rates);
};

let exchangeRatesFetchPromise = null;
let exchangeRatesLastFetchedAt = 0;
const EXCHANGE_RATES_FETCH_DEDUPE_MS = 60 * 1000;

/**
 * Fetches latest exchange rates from the free API and caches them (STACK-50).
 * Non-blocking — if fetch fails, existing cached/fallback rates are used.
 * @returns {Promise<boolean>} Whether the fetch succeeded
 */
const fetchExchangeRates = async () => {
  if (exchangeRatesFetchPromise) return exchangeRatesFetchPromise;
  if (
    exchangeRatesLastFetchedAt &&
    Date.now() - exchangeRatesLastFetchedAt < EXCHANGE_RATES_FETCH_DEDUPE_MS
  ) {
    return true;
  }

  exchangeRatesFetchPromise = (async () => {
    try {
      // Safe: URL from hardcoded constant EXCHANGE_RATE_API_URL or fallback literal
      const url =
        typeof EXCHANGE_RATE_API_URL !== "undefined"
          ? EXCHANGE_RATE_API_URL
          : "https://open.er-api.com/v6/latest/USD";
      const response = await fetch(url, {
        method: "GET",
        mode: "cors",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data && data.rates && typeof data.rates === "object") {
        saveExchangeRates(data.rates);
        exchangeRatesLastFetchedAt = Date.now();
        return true;
      }
      // Payload unusable — still open the dedupe window to suppress retry storms
      exchangeRatesLastFetchedAt = Date.now();
    } catch (e) {
      console.warn("Exchange rate fetch failed, using cached/fallback rates:", e.message);
      // Failed fetch still counts as an attempt — suppress retry storms
      exchangeRatesLastFetchedAt = Date.now();
    }
    return false;
  })();

  try {
    return await exchangeRatesFetchPromise;
  } finally {
    exchangeRatesFetchPromise = null;
  }
};

/**
 * Formats a profit/loss value with color coding
 *
 * @param {number} value - Profit/loss value
 * @returns {string} HTML string with appropriate color styling
 */
const formatLossProfit = (value, percent) => {
  const formatted = formatCurrency(value);
  const pctHtml =
    percent !== undefined && percent !== 0
      ? `<span class="gain-loss-pct">${percent > 0 ? "+" : ""}${percent.toFixed(1)}%</span>`
      : "";
  if (value > 0) {
    return `<span style="color: var(--success);">${pctHtml}${formatted}</span>`;
  } else if (value < 0) {
    return `<span style="color: var(--danger);">${pctHtml}${formatted}</span>`;
  }
  return pctHtml + formatted;
};

/**
 * Parses a weight string that may contain fractions
 * Supports: "0.5", "1/1000", "1 1/2" (mixed numbers)
 *
 * @param {string} str - Weight string to parse
 * @returns {number} Parsed decimal value, or NaN if invalid
 */
const parseFraction = (str) => {
  if (typeof str !== "string") return parseFloat(str);
  str = str.trim();
  if (!str) return NaN;

  // Mixed number: "1 1/2"
  const mixedMatch = str.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (mixedMatch) {
    const whole = parseFloat(mixedMatch[1]);
    const num = parseFloat(mixedMatch[2]);
    const denom = parseFloat(mixedMatch[3]);
    if (denom === 0) return NaN;
    return whole + num / denom;
  }

  // Simple fraction: "1/1000"
  const fracMatch = str.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (fracMatch) {
    const num = parseFloat(fracMatch[1]);
    const denom = parseFloat(fracMatch[2]);
    if (denom === 0) return NaN;
    return num / denom;
  }

  // Plain number
  return parseFloat(str);
};

/**
 * Converts grams to troy ounces
 *
 * @param {number} grams - Weight in grams
 * @returns {number} Weight in troy ounces
 */
const gramsToOzt = (grams) => grams / 31.1035;

/**
 * Converts troy ounces to grams
 *
 * @param {number} ozt - Weight in troy ounces
 * @returns {number} Weight in grams
 */
const oztToGrams = (ozt) => ozt * 31.1035;

/**
 * Converts milligrams to troy ounces (STRK-319).
 * Aurum notes and other foil products are sold in milligrams (25 mg, 50 mg), a scale at which
 * a gram figure is all leading zeros. Storage stays troy ounces like every other metric unit —
 * `mg` is an entry and display lens only, so melt, totals, and sort need no special case.
 * @param {number} mg - Weight in milligrams
 * @returns {number} Weight in troy ounces
 */
const mgToOzt = (mg) => gramsToOzt(mg / 1000);

/**
 * Converts troy ounces to milligrams (STRK-319).
 * @param {number} ozt - Weight in troy ounces
 * @returns {number} Weight in milligrams
 */
const oztToMg = (ozt) => oztToGrams(ozt) * 1000;

/**
 * Converts kilograms to troy ounces
 *
 * @param {number} kg - Weight in kilograms
 * @returns {number} Weight in troy ounces
 */
const kgToOzt = (kg) => kg * KG_TO_OZT;

/**
 * Converts troy ounces to kilograms
 *
 * @param {number} ozt - Weight in troy ounces
 * @returns {number} Weight in kilograms
 */
const oztToKg = (ozt) => ozt / KG_TO_OZT;

/**
 * Converts avoirdupois pounds to troy ounces
 *
 * @param {number} lb - Weight in pounds
 * @returns {number} Weight in troy ounces
 */
const lbToOzt = (lb) => lb * LB_TO_OZT;

/**
 * Converts troy ounces to avoirdupois pounds
 *
 * @param {number} ozt - Weight in troy ounces
 * @returns {number} Weight in pounds
 */
const oztToLb = (ozt) => ozt / LB_TO_OZT;

/**
 * The total face value of a constitutional ("cu") lot, in US dollars (STRK-300).
 *
 * Face mode stores the entered TOTAL face in `item.weight` (qty is 1 by contract); denomination
 * mode stores face-per-coin, so the total is weight × coin count. Mirrors
 * `getConstitutionalSilverOz`'s qty handling (invalid or zero qty → 0) so the face value and the
 * derived ASW can never disagree about how many coins are in the lot.
 *
 * @param {Object} item - Constitutional inventory item
 * @returns {number} Total face value in USD
 */
const getConstitutionalTotalFace = (item) => {
  const face = parseFloat(item?.weight) || 0;
  return item?.constitutionalEntryMode === "face" ? face : face * (Number(item?.qty) || 0);
};

/**
 * The Weight-column and card-chip string for a constitutional lot — total face value with the
 * `fv` suffix (STRK-300), e.g. `"$6.00 fv"`.
 *
 * Value-then-suffix matches the rest of the unit family (`0.54 oz`, `5 gb`), and the suffix is
 * what stops the figure reading as a fourth money column beside Purchase, Melt, and Retail.
 *
 * **Never currency-converted.** Face value is a US legal-tender denomination, not a market
 * price, so it stays in USD even when the display currency is EUR — hence the literal `$`
 * rather than `formatCurrency`.
 *
 * @param {Object} item - Constitutional inventory item
 * @returns {string} Total face value, e.g. "$6.00 fv"
 */
const formatConstitutionalFace = (item) => `$${getConstitutionalTotalFace(item).toFixed(2)} fv`;

/**
 * Largest relative error a rendered weight may carry before it earns more decimals (STRK-319).
 * One percent: tight enough that 25 mg cannot render as "0.03 g" (a 20% overstatement), loose
 * enough that ordinary float noise never inflates a well-behaved figure.
 * @constant {number}
 */
const WEIGHT_ROUNDING_TOLERANCE = 0.01;

/**
 * Hard ceiling on decimals, so a float artifact can never produce a seventeen-digit cell.
 * @constant {number}
 */
const WEIGHT_MAX_DECIMALS = 6;

/**
 * Renders a measured weight at a unit's normal precision, adding decimals only when that
 * precision would misrepresent the value (STRK-319).
 *
 * Fixed decimal places assume a value stays within one band of magnitude, and weights do not:
 * this inventory spans a 25 mg Aurum note and a 100 ozt bar. At two decimals a 25 mg item
 * renders "0.03 g" (a 20% overstatement) or, in troy ounces, "0.00 oz" — literally weightless.
 *
 * So: render at the unit's base precision and keep it when the result is faithful. Only when
 * the text would read zero, or drift past {@link WEIGHT_ROUNDING_TOLERANCE}, grow the decimals
 * until it is faithful, then trim the trailing zeros that growth introduces. Values that were
 * already rendering correctly are returned byte-identical — "1.00 oz" and "31.65 g" do not
 * become "1 oz" and "31.65 g" — so this fixes the broken tail without restyling every row.
 *
 * @param {number} value - The weight already converted into the display unit
 * @param {number} baseDecimals - The unit's normal decimal places (oz/g 2, kg/lb 4, mg 0)
 * @returns {string} The rendered number, without a unit suffix
 */
const formatMeasuredWeight = (value, baseDecimals) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return (0).toFixed(baseDecimals);
  const faithful = (text) =>
    parseFloat(text) !== 0 &&
    Math.abs(parseFloat(text) - n) / Math.abs(n) <= WEIGHT_ROUNDING_TOLERANCE;
  const base = n.toFixed(baseDecimals);
  if (faithful(base)) return base;
  // Only reached by values the base precision cannot represent — trimming here cannot alter
  // any figure that was already rendering correctly.
  const trim = (text) => (text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text);
  for (let decimals = baseDecimals + 1; decimals <= WEIGHT_MAX_DECIMALS; decimals += 1) {
    const text = n.toFixed(decimals);
    if (faithful(text)) return trim(text);
  }
  return trim(n.toFixed(WEIGHT_MAX_DECIMALS));
};

/**
 * Fraction glyphs for the sub-1 Goldback denominations (STRK-318). Keyed by the stored
 * denomination value; object keys stringify, so `GB_DENOMINATION_GLYPHS[0.25]` resolves.
 * Matches the labels `GOLDBACK_DENOMINATIONS` already uses ("¼ Goldback", "½ Goldback").
 * @constant {Object<string, string>}
 */
const GB_DENOMINATION_GLYPHS = { 0.25: "¼", 0.5: "½" };

/**
 * Renders a Goldback/Silverback denomination for display (STRK-318).
 *
 * A denomination is an exact enum value from `GOLDBACK_DENOMINATIONS`, not a measurement, so it
 * must never be rounded. The previous `toFixed(1)` turned a ¼ Goldback into "0.3 gb" and made
 * two distinct denominations look like near-neighbours on the same scale — the bug this fixes.
 *
 * Sub-1 standard denominations render as fraction glyphs to match the names the app already
 * uses for them; everything else renders exactly, with no trailing zeros (`String` on a Number
 * already drops them, so 1 → "1" and 2.5 → "2.5"). An unrecognised or hand-entered value still
 * renders exactly rather than being rounded into a neighbouring denomination.
 *
 * @param {number|string} denomination - The stored denomination (item.weight for gb/sb)
 * @returns {string} Display text, e.g. "¼", "½", "1", "100"
 */
const formatDenomination = (denomination) => {
  const value = parseFloat(denomination);
  if (!Number.isFinite(value)) return String(denomination ?? "");
  return GB_DENOMINATION_GLYPHS[value] ?? String(value);
};

/**
 * Formats a weight in troy ounces to either grams or ounces.
 * If weightUnit is 'gb' or 'sb', displays the exact denomination (no rounding, no gram
 * auto-conversion) — see {@link formatDenomination}. The metal content those notes carry is
 * surfaced in the Weight cell tooltip instead (STRK-318).
 *
 * For 'cu' (constitutional silver) the stored `weight` is a face value, so a meaningful weight
 * requires the whole item: pass `item` to get the derived pure-silver oz (the ASW). 2-arg
 * callers fall back to a per-coin face string.
 *
 * **The 3-arg cu semantics are deliberately unchanged by STRK-300.** The Weight cell, the card
 * chip, and the detail modal now lead with total face value, but they build that text from
 * `formatConstitutionalFace` rather than by inverting this function — the 2-arg fallback has
 * six other callers (change log, bulk edit preview, backup print, add toast, print/export rows)
 * that expect the existing frame. Only the fallback's suffix changed, `face` → `fv`, so every
 * surface names the figure the same way.
 *
 * @param {number} ozt - Weight in troy ounces (or denomination value if weightUnit='gb'/'sb'/'cu')
 * @param {string} [weightUnit] - Optional weight unit: 'oz', 'g', 'kg', 'lb', 'gb', 'sb', or 'cu'
 * @param {Object} [item] - The full inventory item; only used for 'cu' to derive silver oz
 * @returns {string} Formatted weight string with unit
 */
const formatWeight = (ozt, weightUnit, item) => {
  if (weightUnit === "gb") {
    return `${formatDenomination(ozt)} gb`;
  }
  if (weightUnit === "sb") {
    return `${formatDenomination(ozt)} sb`;
  }
  if (weightUnit === "cu") {
    // Constitutional items store a face value in `weight`; the derived pure-silver oz (the ASW,
    // with qty + worn/fresh basis folded in) is what shares a scale with every other row and
    // the portfolio totals, so the 3-arg form returns that. STRK-235 fallback (legacy 2-arg
    // callers): a per-coin face string, suffix normalised to `fv` by STRK-300 so the change
    // log, bulk edit preview, backup print, add toast, and print/export rows all name the
    // figure the same way the Weight cell does.
    if (item && typeof getConstitutionalSilverOz === "function") {
      return `${getConstitutionalSilverOz(item).toFixed(2)} oz`;
    }
    const w = parseFloat(ozt) || 0;
    return `$${w.toFixed(2)} fv`;
  }
  const weight = parseFloat(ozt);
  if (weightUnit === "kg") {
    return `${formatMeasuredWeight(oztToKg(weight), 4)} kg`;
  }
  if (weightUnit === "lb") {
    return `${formatMeasuredWeight(oztToLb(weight), 4)} lb`;
  }
  if (weightUnit === "g") {
    return `${formatMeasuredWeight(oztToGrams(weight), 2)} g`;
  }
  if (weightUnit === "mg") {
    // Milligram products are whole numbers (25, 50, 100), so the base precision is 0 and
    // formatMeasuredWeight only adds decimals for a genuinely fractional entry.
    return `${formatMeasuredWeight(oztToMg(weight), 0)} mg`;
  }
  return `${formatMeasuredWeight(weight, 2)} oz`;
};

/**
 * Converts amount from specified currency to USD using static rates
 *
 * @param {number} amount - Monetary amount
 * @param {string} [currency="USD"] - Currency code of amount
 * @returns {number} Amount converted to USD
 */
const convertToUsd = (amount, currency = "USD") => {
  const code = currency.toUpperCase();
  if (code === "USD") return amount;
  if (typeof getExchangeRate === "function") {
    const rate = getExchangeRate(code);
    // rate === 1 for a non-USD currency is the sentinel value (no rate loaded);
    // fall through to the static table rather than silently returning the wrong value.
    if (Number.isFinite(rate) && rate > 0 && rate !== 1) return amount / rate;
  }
  // Static fallback — rates expressed as foreign-per-USD (same convention as getExchangeRate).
  // 1 USD = N foreign → USD = amount / N
  const rates = { EUR: 0.926, GBP: 0.787, CAD: 1.351 };
  const rate = rates[code] || 1;
  return amount / rate;
};

/**
 * Detects currency code from a value string containing symbols or codes
 *
 * @param {string} str - Value containing currency information
 * @returns {string|null} Detected currency code or null if not found
 */
const detectCurrency = (str = "") => {
  const s = str.toUpperCase();
  if (/[€]|EUR/.test(s)) return "EUR";
  if (/[£]|GBP/.test(s)) return "GBP";
  if (/CAD|C\$|CA\$/.test(s)) return "CAD";
  if (/USD|US\$/.test(s)) return "USD";
  return null;
};

// =============================================================================
// Public surface (moved verbatim from js/utils.js with the functions). Multi-currency (STACK-50).
if (typeof window !== "undefined") {
  window.loadDisplayCurrency = loadDisplayCurrency;
  window.saveDisplayCurrency = saveDisplayCurrency;
  window.getCurrencySymbol = getCurrencySymbol;
  window.getCurrencyFractionDigits = getCurrencyFractionDigits;
  window.roundToPricePrecision = roundToPricePrecision;
  window.updateModalCurrencyUI = updateModalCurrencyUI;
  window.getExchangeRate = getExchangeRate;
  window.loadExchangeRates = loadExchangeRates;
  window.saveExchangeRates = saveExchangeRates;
  window.fetchExchangeRates = fetchExchangeRates;
  // STRK-300: the constitutional face-value display seam. Bare top-level `const` is reachable
  // by sibling scripts but is not a window property, so it is published explicitly here.
  window.getConstitutionalTotalFace = getConstitutionalTotalFace;
  window.formatConstitutionalFace = formatConstitutionalFace;
  window.formatDenomination = formatDenomination;
  window.formatMeasuredWeight = formatMeasuredWeight;
  window.mgToOzt = mgToOzt;
  window.oztToMg = oztToMg;
  window.formatWeight = formatWeight;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getCurrencyFractionDigits,
    roundToPricePrecision,
  };
}

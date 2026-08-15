/**
 * spot-metals.js — the single source of truth for the tracked spot metals,
 * plus the pure price maths that turns a MetalPriceAPI response into a USD
 * price per troy ounce.
 *
 * Deliberately dependency-free (no sqld, no better-sqlite3, no node built-ins)
 * so unit tests can import it without the poller's container-only packages.
 * Same seam as price-extract-shared.js and v2-utils.js.
 *
 * Before STRK-303 the metal set was duplicated across at least five files with
 * two different casings and no link between the copies. Everything here is
 * derived from METAL_MAP so adding a sixth metal is a one-line change.
 */

/**
 * Tracked metals, keyed by MetalPriceAPI symbol.
 *
 * ORDER IS LOAD-BEARING. Object insertion order drives the published JSON entry
 * array (buildEntries in spot-extract.js) and every list derived below. Append
 * new metals at the END — inserting one earlier renumbers every existing entry
 * in every published hourly and 15-minute file.
 *
 * Values are the capitalised display names that appear in the JSON `metal`
 * field. The database stores the LOWERCASE form — see SPOT_METAL_KEYS.
 * @constant {Record<string, string>}
 */
export const METAL_MAP = {
  XAU: "Gold",
  XAG: "Silver",
  XPT: "Platinum",
  XPD: "Palladium",
  XCU: "Copper",
};

/**
 * Capitalised metal names in METAL_MAP order — the JSON `metal` field vocabulary.
 * @constant {string[]}
 */
export const METAL_ORDER = Object.values(METAL_MAP);

/**
 * Lowercase metal keys in METAL_MAP order — the `spot_prices.metal` column
 * vocabulary, and the key set of the prices object passed to insertSpotPrices.
 * @constant {string[]}
 */
export const SPOT_METAL_KEYS = METAL_ORDER.map((name) => name.toLowerCase());

/**
 * Metals tracked before copper was added (STRK-303).
 *
 * A deliberate literal, not a derivation — it describes what the ARCHIVE
 * contains, which is a fact about the past and does not change when a new metal
 * is tracked. Every archived hourly and 15-minute file holds exactly these
 * four, so they stay unconditionally required when importing history while
 * copper is only required from the cutover onward.
 * @constant {string[]}
 */
export const LEGACY_SPOT_METAL_KEYS = ["gold", "silver", "platinum", "palladium"];

/**
 * Plausible USD-per-troy-ounce range for each metal, used as a sanity guard on
 * every poll.
 *
 * These must be per-metal. A single global range cannot span metals four orders
 * of magnitude apart: the previous `price < 5 || price > 50000` guard rejected
 * every correct copper quote (~$0.41/ozt) while still waving through a gold
 * price that had lost a factor of a hundred.
 *
 * Ranges are deliberately generous — this catches feed corruption and unit
 * mix-ups, not ordinary market moves.
 * @constant {Record<string, {min: number, max: number}>}
 */
export const METAL_PRICE_BOUNDS = {
  XAU: { min: 100, max: 50000 },
  XAG: { min: 1, max: 1000 },
  XPT: { min: 50, max: 20000 },
  XPD: { min: 50, max: 20000 },
  XCU: { min: 0.02, max: 20 },
};

/** Below this USD price a metal keeps extra decimal places. @constant {number} */
const SUB_DOLLAR_THRESHOLD = 1;

/** Decimal places for metals priced at or above SUB_DOLLAR_THRESHOLD. @constant {number} */
const DECIMALS_STANDARD = 2;

/** Decimal places for sub-dollar metals such as copper. @constant {number} */
const DECIMALS_SUB_DOLLAR = 4;

/**
 * Derive the USD price per troy ounce for one metal from a MetalPriceAPI
 * `/v1/latest?base=USD` response.
 *
 * The response carries the same figure twice. `USDXAU` is the direct USD price
 * per troy ounce; the bare `XAU` key is its reciprocal (troy ounces per USD).
 * This reads the direct key and falls back to inverting the reciprocal — both
 * deterministic, neither inferred from the value's magnitude.
 *
 * The previous implementation guessed with `rate >= 1 ? rate : 1 / rate`. That
 * worked only while every tracked metal was worth far more than $1/ozt, which
 * made the two candidates orders of magnitude apart and the larger one always
 * correct. Copper trades near $0.41/ozt, so its reciprocal is ~2.42 — above the
 * threshold — and the guess silently returned $2.42 (STRK-303).
 *
 * @param {Record<string, number>|undefined} rates - The `rates` object from the API response.
 * @param {string} code - MetalPriceAPI symbol, e.g. "XAU".
 * @returns {number} USD price per troy ounce, unrounded.
 * @throws {Error} When neither key holds a usable positive number.
 */
export const derivePrice = (rates, code) => {
  const direct = rates?.[`USD${code}`];
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) return direct;

  const reciprocal = rates?.[code];
  if (typeof reciprocal === "number" && Number.isFinite(reciprocal) && reciprocal > 0) {
    return 1 / reciprocal;
  }

  throw new Error(`Missing or zero rate for ${code}`);
};

/**
 * Assert a derived price falls inside its metal's plausible range.
 *
 * @param {string} code - MetalPriceAPI symbol, e.g. "XCU".
 * @param {string} name - Display name used in the error message, e.g. "Copper".
 * @param {number} price - Derived USD price per troy ounce.
 * @returns {void}
 * @throws {Error} When the metal has no bounds, or the price falls outside them.
 */
export const assertPriceInRange = (code, name, price) => {
  const bounds = METAL_PRICE_BOUNDS[code];
  if (!bounds) {
    throw new Error(`No price bounds defined for ${code} (${name})`);
  }
  if (price < bounds.min || price > bounds.max) {
    throw new Error(
      `Price out of range for ${name}: $${price} (expected $${bounds.min}–$${bounds.max})`
    );
  }
};

/**
 * Round a price to a precision appropriate for its magnitude.
 *
 * Two decimals is ample at $4,000/ozt but quantises copper (~$0.41/ozt) by
 * roughly 0.6% on every tick, and that error is permanent once written to
 * history. Sub-dollar metals therefore keep four decimals.
 *
 * This is a precision choice, not a direction guess: it never changes WHICH
 * value is returned, only how finely it is recorded.
 *
 * @param {number} price - USD price per troy ounce.
 * @returns {number} The price rounded for storage.
 */
export const roundPrice = (price) => {
  const decimals = price < SUB_DOLLAR_THRESHOLD ? DECIMALS_SUB_DOLLAR : DECIMALS_STANDARD;
  const factor = 10 ** decimals;
  return Math.round(price * factor) / factor;
};

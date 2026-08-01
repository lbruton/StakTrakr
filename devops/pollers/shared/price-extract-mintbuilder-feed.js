/**
 * MintBuilder direct price feed client (STRK-321).
 *
 * MintBuilder granted StakTrakr first-party API access — the first vendor with
 * a direct feed. One GET of /feed/api/prices?key=…&mintbuilder=all returns
 * every active product as an id-keyed map ({ title, link, price, retail,
 * tiers, premium }), so the poll loop's per-target lookups are served from a
 * per-process memoized index: exactly one feed request per run, N cache hits.
 *
 * Matching: a feed product's `link` is its public product-page URL — the same
 * URL stored in provider_vendors.url — so rows match by canonicalized URL
 * comparison. A row can pin an exact product with {"mbProductId": "…"} in its
 * free-form `hints` column (dashboard gear row) when the URL drifts.
 *
 * Key hygiene: MB_API_KEY is read at CALL time (import purity — this module
 * sits in price-extract.js's import graph) and the request URL is never
 * logged. provider_vendors.url must keep the human product URL; it is
 * republished into public JSON and rendered as Buy links.
 */

export const MINTBUILDER_FEED_URL = "https://mintbuilder.com/feed/api/prices";
// Mirrors the goldback-scraper.js feed timeout; no shared constant exists yet.
export const FEED_TIMEOUT_MS = 15_000;
const FEED_RETRY_DELAY_MS = 2_000;

// Per-process feed memo. Promise-valued so concurrent lookups share one
// in-flight request; fingerprinted by key so a rotated key refetches.
let _feedState = null;
let _feedFingerprint = null;

/** Sleep helper for the single transient-failure retry. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Canonicalize a product URL for feed↔row matching.
 *
 * Collapses the differences that show up between stored rows and feed links
 * without changing product identity: protocol (http/https), host case and a
 * leading "www.", path case, query string, fragment, and a trailing slash.
 * Root URLs normalize to the bare host.
 *
 * @param {unknown} raw - URL string to canonicalize.
 * @returns {string|null} "host/path" canonical form, or null when unparseable.
 */
export function normalizeProductUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let path = parsed.pathname.toLowerCase();
  if (path.endsWith("/")) path = path.slice(0, -1);
  return `${host}${path}`;
}

/**
 * Read the optional {"mbProductId": "…"} pin from a provider row's free-form
 * hints column. Defensive by design: the dashboard JSON-validates hints on
 * save, but rows can predate that validation or be edited directly in sqld,
 * and the column is shared with other free-form uses.
 *
 * @param {unknown} hintsText - Raw provider_vendors.hints value.
 * @param {(msg: string) => void} [warn] - Warn sink for malformed JSON.
 * @returns {string|null} The pinned product id, or null when absent/unusable.
 */
export function parseHintsProductId(hintsText, warn = console.warn) {
  if (typeof hintsText !== "string" || hintsText.trim() === "") return null;
  let parsed;
  try {
    parsed = JSON.parse(hintsText);
  } catch {
    warn("[mintbuilder-feed] unparseable hints JSON — ignoring the mbProductId pin");
    return null;
  }
  const id = parsed?.mbProductId;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  if (typeof id === "string" && id.trim() !== "") return id.trim();
  return null;
}

/**
 * Select the price to record from a feed product. The feed's `price` field is
 * the lowest quantity tier (check/wire); this seam exists so a tier-selection
 * change (e.g. preferring the qty-1 tier) stays confined to one function.
 *
 * @param {{price?: unknown}} product - Feed product entry.
 * @returns {number|null} A finite positive price, or null when unusable.
 */
export function selectFeedPrice(product) {
  const price = Number(product?.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * Fetch and index the full MintBuilder feed. Always resolves to a FeedState —
 * never throws — so a cached failure cannot fan out unhandled rejections:
 *   { ok: true, byId: Map, byUrl: Map, fetchedAt }
 *   { ok: false, reason: "no_key"|"bad_key"|"fetch_failed"|"bad_payload" }
 *
 * @param {object} opts - Fetch collaborators (apiKey, fetchImpl, log, warn, retryDelayMs).
 * @returns {Promise<object>} The resolved FeedState.
 */
async function buildFeedState({ apiKey, fetchImpl, log, warn, retryDelayMs }) {
  if (!apiKey) {
    warn("[mintbuilder-feed] MB_API_KEY not set — mintbuilder targets fall back to page scrape");
    return { ok: false, reason: "no_key" };
  }

  // The key travels only in the request itself — never log this URL. Error
  // messages are redacted too: some fetch implementations echo the full
  // request URL (key included) into err.message.
  const requestUrl = `${MINTBUILDER_FEED_URL}?key=${encodeURIComponent(apiKey)}&mintbuilder=all`;
  const redactKey = (text) =>
    String(text).replaceAll(apiKey, "***").replaceAll(encodeURIComponent(apiKey), "***");
  let response = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      response = await fetchImpl(requestUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": "StakTrakr/1.0 mintbuilder-feed",
        },
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      });
    } catch (err) {
      warn(
        `[mintbuilder-feed] feed request failed (attempt ${attempt}/2): ${redactKey(err.message)}`
      );
      response = null;
    }

    if (response && response.status === 401) {
      warn("[mintbuilder-feed] feed rejected the API key (HTTP 401) — falling back to page scrape");
      return { ok: false, reason: "bad_key" };
    }
    if (response && response.ok) break;
    if (response) {
      // Only 5xx is treated as transient; other non-OK statuses (403, 404,
      // 429, …) are terminal for this run — retrying them wastes a request.
      const transient = response.status >= 500;
      warn(
        `[mintbuilder-feed] feed HTTP ${response.status}` +
          (transient ? ` (attempt ${attempt}/2)` : " — not retrying")
      );
      if (!transient) return { ok: false, reason: "fetch_failed" };
      response = null;
    }
    if (attempt === 1 && retryDelayMs > 0) await sleep(retryDelayMs);
  }

  if (!response) return { ok: false, reason: "fetch_failed" };

  let payload;
  try {
    payload = await response.json();
  } catch {
    warn("[mintbuilder-feed] feed body is not valid JSON");
    return { ok: false, reason: "bad_payload" };
  }

  const products = payload?.data?.products;
  if (typeof products !== "object" || products === null || Array.isArray(products)) {
    warn("[mintbuilder-feed] feed payload has no data.products map");
    return { ok: false, reason: "bad_payload" };
  }

  const byId = new Map();
  const byUrl = new Map();
  for (const [productId, product] of Object.entries(products)) {
    byId.set(String(productId), product);
    const urlKey = normalizeProductUrl(product?.link);
    if (urlKey) byUrl.set(urlKey, { productId: String(productId), product });
  }

  log(`[mintbuilder-feed] indexed ${byId.size} products from the direct feed`);
  return { ok: true, byId, byUrl, fetchedAt: new Date().toISOString() };
}

/**
 * Memoized accessor for the feed index. The first caller in a process fetches
 * the full catalog; every later caller (the poll loop runs one coin×vendor
 * target at a time) shares the same resolved state. The memo is fingerprinted
 * by API key so a rotated key builds a fresh index.
 *
 * @param {object} [opts] - apiKey (default: process.env.MB_API_KEY read at
 *   call time), fetchImpl (default: global fetch), log/warn sinks, retryDelayMs.
 * @returns {Promise<object>} The (possibly cached) FeedState.
 */
export function getFeedIndex({
  apiKey,
  fetchImpl = fetch,
  log = console.log,
  warn = console.warn,
  retryDelayMs = FEED_RETRY_DELAY_MS,
} = {}) {
  const key = apiKey !== undefined ? apiKey : process.env.MB_API_KEY;
  const fingerprint = key || "";
  if (_feedState && _feedFingerprint === fingerprint) return _feedState;
  _feedFingerprint = fingerprint;
  _feedState = buildFeedState({ apiKey: key, fetchImpl, log, warn, retryDelayMs });
  return _feedState;
}

/**
 * Resolve one provider row against the feed. Never throws.
 *
 * Match order: a hints {"mbProductId"} pin (when present in the feed) beats
 * URL matching; otherwise the row URL is canonicalized and looked up against
 * the feed links. Callers treat "unavailable"/"miss" as fall-back-to-scrape.
 *
 * @param {object} opts - { url, hints, apiKey?, fetchImpl?, log?, warn?, retryDelayMs? }.
 * @returns {Promise<object>} {status:"hit", product:{productId, price, link, title}}
 *   | {status:"miss", reason} | {status:"unavailable", reason}.
 */
export async function lookupMintbuilderProduct({
  url,
  hints = null,
  apiKey,
  fetchImpl,
  log = console.log,
  warn = console.warn,
  retryDelayMs,
} = {}) {
  const state = await getFeedIndex({ apiKey, fetchImpl, log, warn, retryDelayMs });
  if (!state.ok) return { status: "unavailable", reason: state.reason };

  let productId = null;
  let product = null;

  const pinnedId = parseHintsProductId(hints, warn);
  if (pinnedId && state.byId.has(pinnedId)) {
    productId = pinnedId;
    product = state.byId.get(pinnedId);
  } else {
    const urlKey = normalizeProductUrl(url);
    const match = urlKey ? state.byUrl.get(urlKey) : undefined;
    if (match) ({ productId, product } = match);
  }

  if (!product) return { status: "miss", reason: "not_in_feed" };

  const price = selectFeedPrice(product);
  if (price === null) return { status: "miss", reason: "invalid_price" };

  return {
    status: "hit",
    product: {
      productId,
      price,
      link: product.link ?? null,
      title: product.title ?? null,
    },
  };
}

/** Reset the per-process feed memo (test hook). */
export function _resetFeedCacheForTests() {
  _feedState = null;
  _feedFingerprint = null;
}

/**
 * Bullion Exchanges GraphQL client.
 *
 * Bullion Exchanges is a Magento 2 storefront that renders its quantity-tier
 * table in the browser, so a page snapshot can miss the prices. Its GraphQL GET
 * endpoint returns the same data as JSON. Cloudflare binds cf_clearance to the
 * browser's TLS fingerprint, so a Node fetch with the cookie gets HTTP 403; the
 * client asks Byparr to load the GraphQL URL instead and reads the JSON from
 * the page Firefox renders.
 *
 * The index costs two Byparr loads per process: a products query maps every
 * url_key to an id and stock status, and a LivePrices query returns the tier
 * prices of the in-stock ids. The server rejects more than 10 aliases per
 * query, so both queries use list filters instead of aliases.
 */

import { fetchByparrOnce } from "./cf-clearance.js";

export const BE_GRAPHQL_URL = "https://bullionexchanges.com/graphql";
const BE_HOST = "bullionexchanges.com";
// products pageSize allows 100; smaller chunks keep the GET URL short.
const PRODUCTS_CHUNK = 50;
const LIVE_PRICES_CHUNK = 50;
const DEFAULT_TIMEOUT_MS = 20_000;

// Per-process memo. Promise-valued so concurrent lookups share one build.
let _indexState = null;

/**
 * url_key of a Bullion Exchanges product URL: its path without slashes.
 * @param {unknown} url - Product page URL.
 * @returns {string|null} The url_key, or null for other hosts and root URLs.
 */
export function beUrlKey(url) {
  if (typeof url !== "string") return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase().replace(/^www\./, "") !== BE_HOST) return null;
  const key = parsed.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
  return key === "" ? null : key;
}

/**
 * JSON object from a Byparr response for a JSON URL. Firefox wraps the body in
 * a pre element; a Cloudflare challenge page holds no JSON object.
 * @param {unknown} html - Byparr `solution.response`.
 * @returns {object|null}
 */
export function parseByparrJson(html) {
  if (typeof html !== "string" || html === "") return null;
  const pre = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  const raw = (pre ? pre[1] : html)
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * (E)check/Wire price of the smallest-quantity tier, rounded to cents. The
 * tier-1 range differs per product (1-4, 1-19, 1-99), so the tier is chosen by
 * its minimum quantity, not by its position.
 * @param {{tierPrices?: Array}} livePrice - One LivePrices entry.
 * @returns {number|null}
 */
export function selectTierOnePrice(livePrice) {
  const tiers = Array.isArray(livePrice?.tierPrices) ? livePrice.tierPrices : [];
  let best = null;
  for (const tier of tiers) {
    const quantity = Number(tier?.quantity);
    const price = Number(tier?.price_wire_checkmo?.value);
    if (!Number.isFinite(quantity) || !Number.isFinite(price) || price <= 0) continue;
    if (best === null || quantity < best.quantity) best = { quantity, price };
  }
  return best === null ? null : Math.round(best.price * 100) / 100;
}

/**
 * GraphQL products query that maps url_keys to ids and stock status.
 * @param {string[]} keys - url_keys.
 * @returns {string}
 */
export function productsQuery(keys) {
  return (
    `{products(filter:{url_key:{in:${JSON.stringify(keys)}}},pageSize:100)` +
    "{total_count items{id url_key stock_status}}}"
  );
}

/**
 * GraphQL LivePrices query for tier prices.
 * @param {number[]} ids - Product ids.
 * @returns {string}
 */
export function livePricesQuery(ids) {
  return `{LivePrices(ids:[${ids.join(",")}]){id tierPrices{quantity quantity_range price_wire_checkmo{value}}}}`;
}

/**
 * Run one GraphQL query through Byparr. Retries one timed-out attempt; other
 * failures return at once. Makes no request unless CF_CLEARANCE_ENABLED is "1"
 * (the default), the flag getCFClearanceCookie honors. Never throws.
 * @param {string} query - GraphQL query text.
 * @param {object} [opts] - byparrFetch (test seam), timeoutMs, warn.
 * @returns {Promise<{ok: true, data: object}|{ok: false, reason: string}>}
 */
export async function fetchGraphqlViaByparr(
  query,
  { byparrFetch = fetchByparrOnce, timeoutMs, warn = console.warn } = {}
) {
  if ((process.env.CF_CLEARANCE_ENABLED ?? "1") !== "1") {
    return { ok: false, reason: "byparr_disabled" };
  }
  const limit = timeoutMs ?? (Number(process.env.CF_CLEARANCE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const url = `${BE_GRAPHQL_URL}?query=${encodeURIComponent(query)}`;
  let result = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    result = await byparrFetch(url, limit);
    if (result.ok || !result.timedOut) break;
    warn(`[be-graphql] Byparr timed out (attempt ${attempt}/2)`);
  }
  if (!result.ok) {
    warn(`[be-graphql] Byparr failed: ${String(result.errorMsg ?? "").slice(0, 120)}`);
    return { ok: false, reason: "byparr_failed" };
  }
  const json = parseByparrJson(result.data?.solution?.response);
  if (!json) {
    warn("[be-graphql] response holds no JSON (Cloudflare challenge or error page)");
    return { ok: false, reason: "bad_payload" };
  }
  if (!json.data) {
    warn(`[be-graphql] GraphQL error: ${JSON.stringify(json.errors ?? json).slice(0, 160)}`);
    return { ok: false, reason: "graphql_error" };
  }
  return { ok: true, data: json.data };
}

/** Split a list into chunks of at most `size` items. */
function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Build the url_key index. Resolves to { ok: true, requested, byKey } or
 * { ok: false, reason }. A failed LivePrices call keeps the stock data, so
 * out-of-stock rows still resolve and in-stock rows fall back to the page.
 */
async function buildIndex({ keys, fetchJson, log, warn }) {
  const requested = new Set(keys);
  const byKey = new Map();
  for (const part of chunk(keys, PRODUCTS_CHUNK)) {
    const res = await fetchJson(productsQuery(part));
    if (!res.ok) return { ok: false, reason: res.reason };
    const items = res.data?.products?.items;
    if (!Array.isArray(items)) {
      warn("[be-graphql] products payload has no items list");
      return { ok: false, reason: "bad_payload" };
    }
    for (const item of items) {
      const key = typeof item?.url_key === "string" ? item.url_key.toLowerCase() : null;
      if (!key || !Number.isFinite(Number(item.id))) continue;
      byKey.set(key, {
        id: Number(item.id),
        inStock: item.stock_status === "IN_STOCK",
        price: null,
      });
    }
  }

  const byId = new Map([...byKey.values()].map((entry) => [entry.id, entry]));
  const inStockIds = [...byId.values()].filter((e) => e.inStock).map((e) => e.id);
  for (const part of chunk(inStockIds, LIVE_PRICES_CHUNK)) {
    const res = await fetchJson(livePricesQuery(part));
    if (!res.ok) {
      warn(
        `[be-graphql] LivePrices unavailable (${res.reason}); in-stock rows use the page scrape`
      );
      break;
    }
    const prices = Array.isArray(res.data?.LivePrices) ? res.data.LivePrices : [];
    for (const live of prices) {
      const entry = byId.get(Number(live?.id));
      if (entry) entry.price = selectTierOnePrice(live);
    }
  }

  log(
    `[be-graphql] indexed ${byKey.size}/${requested.size} products (${inStockIds.length} in stock)`
  );
  return { ok: true, requested, byKey };
}

/**
 * Memoized index for the run. The first caller's URL list fixes the request
 * set; later URLs outside it resolve as a miss.
 * @param {object} opts - urls, fetchJson, log, warn.
 * @returns {Promise<object>} The index state; never rejects.
 */
export function getBullionExchangesIndex({ urls, fetchJson, log, warn }) {
  if (_indexState) return _indexState;
  const keys = [...new Set(urls.map(beUrlKey).filter(Boolean))];
  _indexState = buildIndex({ keys, fetchJson, log, warn }).catch((err) => {
    warn(`[be-graphql] index build failed: ${String(err?.message ?? err).slice(0, 120)}`);
    return { ok: false, reason: "fetch_failed" };
  });
  return _indexState;
}

/**
 * Resolve one Bullion Exchanges product URL. Never throws.
 * @param {object} opts - url (target), urls (every BE URL in the run),
 *   fetchJson (default: fetchGraphqlViaByparr), log, warn.
 * @returns {Promise<object>} {status:"hit", product:{id, inStock, price}} |
 *   {status:"miss", reason} | {status:"unavailable", reason}. An out-of-stock
 *   hit has price null.
 */
export async function lookupBullionExchangesProduct({
  url,
  urls,
  fetchJson,
  log = console.log,
  warn = console.warn,
} = {}) {
  const key = beUrlKey(url);
  if (!key) return { status: "miss", reason: "bad_url" };

  const fetcher = fetchJson ?? ((query) => fetchGraphqlViaByparr(query, { warn }));
  const all = Array.isArray(urls) ? [...urls, url] : [url];
  const state = await getBullionExchangesIndex({ urls: all, fetchJson: fetcher, log, warn });
  if (!state.ok) return { status: "unavailable", reason: state.reason };
  if (!state.requested.has(key)) return { status: "miss", reason: "not_requested" };

  const entry = state.byKey.get(key);
  if (!entry) return { status: "miss", reason: "not_found" };
  if (!entry.inStock)
    return { status: "hit", product: { id: entry.id, inStock: false, price: null } };
  if (entry.price === null) return { status: "miss", reason: "no_live_price" };
  return { status: "hit", product: { id: entry.id, inStock: true, price: entry.price } };
}

/** Reset the per-process index memo (test hook). */
export function _resetIndexCacheForTests() {
  _indexState = null;
}

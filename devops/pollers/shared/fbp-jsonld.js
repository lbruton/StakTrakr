/**
 * FindBullionPrices (FBP) JSON-LD helpers (STRK-334, design C1/C2).
 *
 * Pure extraction of dealer offers from an FBP product page plus a polite,
 * timeout-bounded fetch. FBP embeds a schema.org `ItemList` of per-dealer
 * `Offer` objects in a `<script type="application/ld+json">` block; this module
 * reads only the fields we trust (`seller.name`, `price`, `priceCurrency`,
 * `position`) by explicit path — never spreads untrusted parsed objects into
 * config — and never throws on malformed JSON (per-block try/catch).
 */

const LD_JSON_BLOCK =
  /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Extract every dealer offer from an FBP page's schema.org ItemList JSON-LD.
 *
 * @param {string} html - Raw FBP product-page HTML.
 * @returns {Array<{ seller: string, price: number, currency: string, position: number }>}
 *   One entry per finite-priced Offer in the first ItemList; `[]` when no valid
 *   ItemList is present.
 */
function parseFbpItemList(html) {
  if (typeof html !== "string" || html.length === 0) {
    return [];
  }

  let match;
  LD_JSON_BLOCK.lastIndex = 0;
  while ((match = LD_JSON_BLOCK.exec(html)) !== null) {
    let parsed;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }

    if (!parsed || parsed["@type"] !== "ItemList" || !Array.isArray(parsed.itemListElement)) {
      continue;
    }

    const offers = [];
    for (const entry of parsed.itemListElement) {
      const item = entry && entry.item;
      if (!item) {
        continue;
      }
      const rawPrice = item.price;
      const isUsableRaw =
        typeof rawPrice === "number" || (typeof rawPrice === "string" && rawPrice.trim() !== "");
      if (!isUsableRaw) {
        continue;
      }
      const price = Number(rawPrice);
      if (!Number.isFinite(price) || price <= 0) {
        continue;
      }
      offers.push({
        seller: item.seller && item.seller.name,
        price,
        currency: item.priceCurrency,
        position: entry.position,
      });
    }
    return offers;
  }

  return [];
}

/**
 * First offer whose seller exactly matches `sellerName`.
 *
 * @param {Array<{ seller: string }>} offers - Offers from `parseFbpItemList`.
 * @param {string} sellerName - Exact seller name (case-sensitive).
 * @returns {object|null} The matching offer, or `null` when absent.
 */
function findVendorOffer(offers, sellerName) {
  if (!Array.isArray(offers)) {
    return null;
  }
  return offers.find((offer) => offer && offer.seller === sellerName) || null;
}

/**
 * Polite, timeout-bounded GET of an FBP page.
 *
 * Uses global `fetch` with a browser `User-Agent`. The AbortController timeout
 * is cleared in an OUTER `finally` so a stalled body read can't leave the timer
 * live and hang the poller (project AbortController-timeout gotcha).
 *
 * @param {string} url - FBP product-page URL.
 * @param {{ timeoutMs?: number }} [options] - `timeoutMs` defaults to 10000.
 * @returns {Promise<string>} The response body text.
 * @throws on non-200 responses or timeout/abort.
 */
async function fetchFbpPage(url, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": BROWSER_USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`FBP fetch failed: ${response.status} ${response.statusText} (${url})`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export { parseFbpItemList, findVendorOffer, fetchFbpPage };

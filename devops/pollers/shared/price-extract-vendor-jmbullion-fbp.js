/**
 * FBP-backed JM Bullion vendor module (STRK-334, design C3).
 *
 * JM Bullion's own product pages sit behind a Cloudflare/Webscale reCAPTCHA
 * challenge that the poller cannot clear, so `context.url` (the direct URL) is
 * unusable. Instead this module reads the coin's FindBullionPrices (FBP) page —
 * an SSR page with a schema.org `ItemList` of per-dealer offers — and extracts
 * the "JM Bullion" offer from it (design C1/C2 helpers). The FBP price is a
 * gap-fill: reported unmodified, never re-scored here.
 *
 * The network fetch is injected through `context.fetchFbpPage` (test seam) and
 * falls back to the real C2 `fetchFbpPage` when absent. `scrape` never throws:
 * every fetch/parse failure resolves to an `ok:false` envelope.
 */

import { parseFbpItemList, findVendorOffer, fetchFbpPage } from "./fbp-jsonld.js";

const JM_SELLER_NAME = "JM Bullion";

// Exact apex host FBP pages are served from. Matches the allowlist
// resolve-fbp-slugs.js enforces when it writes fbp_url, so a poisoned or
// misconfigured provider_coins.fbp_url pointing at any other host fails closed
// here before we ever open a socket (SSRF defense-in-depth).
const FBP_HOST = "findbullionprices.com";

export const vendor = {
  id: "jmbullion",
  displayName: "JM Bullion",
  config: {},
  /**
   * Resolve a JM Bullion price from the coin's FBP page.
   *
   * @param {object} context - Scrape context. `context.coin.fbp_url` is the FBP
   *   product page; `context.fetchFbpPage` is an optional network double
   *   (falls back to the real C2 fetch). `context.url` (CF-blocked direct URL)
   *   is intentionally ignored.
   * @returns {Promise<object>} `{ ok, price, inStock, source: "fbp", url, error? }`.
   *   Never throws.
   */
  async scrape(context) {
    const fbpUrl = context.coin && context.coin.fbp_url;
    if (!fbpUrl) {
      return {
        ok: false,
        price: null,
        inStock: false,
        source: "fbp",
        error: "no-fbp-url",
        url: null,
      };
    }

    // SSRF guard: only ever fetch the FBP apex. A malformed URL also fails
    // closed (new URL throws). This never reaches the network on a bad host.
    let host;
    try {
      host = new URL(fbpUrl).host;
    } catch {
      host = "";
    }
    if (host !== FBP_HOST) {
      return {
        ok: false,
        price: null,
        inStock: false,
        source: "fbp",
        error: "off-host-fbp-url",
        url: fbpUrl,
      };
    }

    try {
      const fetchPage = context.fetchFbpPage || fetchFbpPage;
      const html = await fetchPage(fbpUrl);
      const offers = parseFbpItemList(html);
      const offer = findVendorOffer(offers, JM_SELLER_NAME);

      if (offer) {
        return { ok: true, price: offer.price, inStock: true, source: "fbp", url: fbpUrl };
      }
      // Genuine no-offer: JM is not listed on a page we successfully fetched
      // and parsed. This is a confirmed absence (inStock:false → is_failed=0),
      // so it ages out per R4 rather than being retried forever.
      return {
        ok: false,
        price: null,
        inStock: false,
        source: "fbp",
        error: "jm-not-listed",
        url: fbpUrl,
      };
    } catch (error) {
      // Transport/parse failure (timeout, non-2xx, unparseable HTML) — NOT a
      // confirmed out-of-stock. runFullPoller derives is_failed from
      // `price === null && inStock`, so we report inStock:true here to mark
      // this a retryable scrape failure and preserve carry-forward of the
      // last-known price, matching the pipeline's failure convention.
      return {
        ok: false,
        price: null,
        inStock: true,
        source: "fbp",
        error: error.message,
        url: fbpUrl,
      };
    }
  },
};

export default vendor;

/**
 * Bullion Exchanges Vendor module.
 *
 * scrape() prices a row from the store's GraphQL API first
 * (price-extract-bullionexchanges-graphql.js, two Byparr loads per run) and
 * falls back to the Byparr page scrape on a miss or when the API is
 * unavailable. Page-scrape config stays in LEGACY_PROVIDER_OVERRIDES because
 * scrapeViaCFClearance's cookie path reads providerCfg(providerId) without the
 * module config.
 */

import { lookupBullionExchangesProduct } from "./price-extract-bullionexchanges-graphql.js";

/**
 * Every URL of a Bullion Exchanges row in the run, so one index serves all rows.
 * @param {object} context - Scrape context.
 * @returns {string[]}
 */
function collectRunUrls(context) {
  const own = Array.isArray(context.urls) && context.urls.length ? context.urls : [context.url];
  if (!Array.isArray(context.runTargets)) return own.filter(Boolean);
  const urls = [];
  for (const target of context.runTargets) {
    if (target?.provider?.id !== "bullionexchanges") continue;
    for (const url of target.urls ?? []) if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

/**
 * Scrape result for a GraphQL hit.
 * @param {{inStock: boolean, price: number|null}} product - Lookup product.
 * @param {string} url - Row URL the product came from.
 * @returns {object}
 */
function graphqlResult(product, url) {
  return {
    price: product.price,
    inStock: product.inStock,
    source: "bullionexchanges-graphql",
    ok: true,
    error: null,
    url,
  };
}

export const vendor = {
  id: "bullionexchanges",
  displayName: "Bullion Exchanges",
  config: {},
  cutoffPatterns: [],
  headerSkipPattern: null,
  preorderTolerant: false,
  // JSON-LD offer.price is the card price; the page fallback reads the tier table.
  untrustedOfferPrice: true,
  usesAsLowAs: false,
  /**
   * Resolve a row from GraphQL, page scrape as fallback. The first in-stock URL
   * wins; an all-out-of-stock row records its first URL out of stock.
   * @param {object} context - Registry scrape context (coinSlug, provider,
   *   urls, url, runTargets, scrapeGeneric, log, warn, optional
   *   beGraphqlLookup test seam).
   * @returns {Promise<object>} { price, inStock, source, ok, error, url }.
   */
  async scrape(context) {
    const log = context.log || console.log;
    const warn = context.warn || console.warn;
    const lookup = context.beGraphqlLookup || lookupBullionExchangesProduct;
    const ownUrls =
      Array.isArray(context.urls) && context.urls.length
        ? context.urls
        : [context.url || context.provider?.url].filter(Boolean);
    const runUrls = collectRunUrls(context);
    // A poll run shares one index through its target list; a single-vendor
    // scrape builds its own, so no prices outlive the call.
    const scope = Array.isArray(context.runTargets) ? context.runTargets : {};

    let outOfStock = null;
    let unresolved = null;
    for (const url of ownUrls) {
      const resolved = await lookup({ url, urls: runUrls, scope, log, warn });
      if (resolved.status === "hit" && resolved.product.inStock) {
        return graphqlResult(resolved.product, url);
      }
      if (resolved.status === "hit") outOfStock ??= { product: resolved.product, url };
      else unresolved ??= { resolved, url };
    }

    if (!unresolved && outOfStock) return graphqlResult(outOfStock.product, outOfStock.url);

    const { resolved, url } = unresolved ?? { resolved: { status: "miss", reason: "bad_url" } };
    const note = `GraphQL ${resolved.status} (${resolved.reason}) for ${context.coinSlug}`;
    if (resolved.status === "miss")
      warn(`[bullionexchanges] ${note} @ ${url} - page-scrape fallback`);
    else log(`[bullionexchanges] ${note} - page-scrape fallback`);
    return context.scrapeGeneric(context);
  },
};

export default vendor;

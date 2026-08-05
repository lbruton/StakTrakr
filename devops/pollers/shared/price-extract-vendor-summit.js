/**
 * Summit Metals Vendor module (STRK-32 / STRK-144).
 *
 * Owns ALL Summit-specific scraping behavior so a change here cannot touch any
 * other vendor:
 *   - config: phase0 defaults (Playwright-direct, networkidle).
 *   - cutoffPatterns: trim the description/reviews/FAQ tail. Every Summit product
 *     page embeds an FAQ containing "...or marked as 'Out of stock.'", which would
 *     otherwise false-flag EVERY item OOS, and trailing "Regular price" cards that
 *     carry the 100+ BULK price.
 *   - extractPrice: prefer the first qty-tier (1-9 Check/Wire) from the pricing
 *     table over the "Regular price" bulk cards. Pipe path resolves via
 *     firstTableRowFirstPrice(); flattened prose path via tierAnchoredPrice();
 *     regularPricePrices() is the last-resort fallback only.
 *   - positiveStockPatterns: buy-box "In Stock, Ready to Ship" suppresses the
 *     negative OOS patterns so "Sold out" badges on related-product carousel
 *     cards (which render before every cutoff anchor) cannot false-flag the
 *     page OOS (STRK-251).
 */

import { mergeProviderConfig } from "./price-extract-provider-config.js";

// Summit uses the phase0 defaults (Playwright-direct first, then Firecrawl).
export const SUMMIT_CONFIG = mergeProviderConfig({
  // phase: "phase0", waitUntil: "networkidle" — inherited from PROVIDER_DEFAULTS.
});

export const vendor = {
  id: "summitmetals",
  displayName: "Summit Metals",
  config: SUMMIT_CONFIG,

  // --- Per-vendor markdown shaping (owned here, not in price-extract-shared.js) ---
  cutoffPatterns: [
    /^\s*Description Shipping & Returns\s*$/im,
    /^#{0,6}\s*What Our Clients/im,
    /^#{0,6}\s*Faq'?s\s*$/im,
  ],
  headerSkipPattern: null,
  // Summit's related-products carousel renders BETWEEN the buy box and every
  // cutoff anchor above, so cutoffPatterns cannot trim it. When any carousel
  // product sells out, its "Sold out" badge appears on EVERY product page and
  // false-flags the whole vendor OOS (STRK-251). The buy box prints
  // "In Stock, Ready to Ship" only for the main product — and drops it on
  // genuinely sold-out pages (buy box shows "Out of Stock" instead) — so its
  // presence suppresses the negative OOS patterns in detectStockStatus.
  positiveStockPatterns: [/\bIn Stock, Ready to Ship\b/i],
  preorderTolerant: false,
  // Summit's Shopify JSON-LD advertises offer.price = the 100+ BULK tier (e.g.
  // $71.97), not the 1-9 single-unit Check/Wire price. The poller treats JSON-LD
  // as authoritative and checks it BEFORE extractMarkdownPrice, so a trusted
  // offer.price short-circuits straight to the bulk price and the table-first
  // strategy below never runs. Marking offer.price untrusted makes the JSON-LD
  // path skip it and fall through to the qty-tier table extraction. (STRK-144)
  untrustedOfferPrice: true,
  usesAsLowAs: false,

  // --- Per-vendor price strategy ---
  // Single-unit (1-9) Check/Wire price first; bulk "Regular price" cards last.
  extractPrice(helpers) {
    const tblFirst = helpers.firstTableRowFirstPrice();
    if (tblFirst !== null) return { price: tblFirst, matchedBy: "tableFirstRow" };
    const tier = helpers.tierAnchoredPrice();
    if (tier !== null) return { price: tier, matchedBy: "tierAnchored" };
    const reg = helpers.regularPricePrices();
    if (reg.length > 0) return { price: Math.min(...reg), matchedBy: "regularPrice" };
    return null;
  },

  /**
   * Scrape a Summit Metals product page via the shared generic strategy.
   * @param {object} context - Scrape context from the vendor registry, carrying
   *   a config already merged as provider defaults → this module's config →
   *   caller-explicit overrides (STRK-314).
   * @returns {Promise<object>} The result from context.scrapeGeneric.
   */
  async scrape(context) {
    return context.scrapeGeneric(context);
  },
};

export default vendor;

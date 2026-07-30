/**
 * MintBuilder Vendor module (STRK-307 / STRK-311).
 *
 * MintBuilder serves clean schema.org Product/Offer JSON-LD (price +
 * availability) on every real product page, with no bot-challenge (Cloudflare
 * sits in front purely as a CDN — cf-cache-status: HIT, no JS challenge, no
 * cf_clearance cookie needed). Same "trust JSON-LD, no markdown quirks" shape
 * as Goldback: no cutoff patterns, no OOS text-pattern workaround, no custom
 * price strategy. `availability` (InStock/OutOfStock) is authoritative and
 * populated even when `price` is present on an out-of-stock page — the
 * Phase 0 (Playwright-direct) scraper now combines JSON-LD availability with
 * text-based stock detection (same formula as scrapeViaCFClearance) so this
 * case reports OOS correctly instead of trusting text detection alone.
 */

import { mergeProviderConfig } from "./price-extract-provider-config.js";

// Plain SSR HTML — JSON-LD is present in the initial response, no JS render
// needed. domcontentloaded is sufficient; waiting for networkidle only adds
// latency (same reasoning as sdbullion).
export const MINTBUILDER_CONFIG = mergeProviderConfig({
  waitUntil: "domcontentloaded",
});

export const vendor = {
  id: "mintbuilder",
  displayName: "MintBuilder",
  config: MINTBUILDER_CONFIG,
  // No vendor-specific markdown shaping — MintBuilder needs no cutoff/header trimming.
  cutoffPatterns: [],
  headerSkipPattern: null,
  preorderTolerant: false,
  untrustedOfferPrice: false,
  usesAsLowAs: false,
  // No extractPrice override → shared default strategy (JSON-LD offer.price authoritative).
  /**
   * Scrape a MintBuilder product page via the shared generic strategy.
   * @param {object} context - Scrape context supplied by the vendor registry
   *   (coinSlug, coin, provider, urls, scrapeGeneric, and optionally a
   *   caller-provided config).
   * @returns {Promise<object>} The result from context.scrapeGeneric —
   *   { price, inStock, source, ok, error, url }.
   */
  async scrape(context) {
    return context.scrapeGeneric({
      ...context,
      // Merge (not overwrite) so a caller-supplied partial config can't
      // silently drop this module's own overrides (e.g. waitUntil).
      config: { ...vendor.config, ...(context.config || {}) },
    });
  },
};

export default vendor;

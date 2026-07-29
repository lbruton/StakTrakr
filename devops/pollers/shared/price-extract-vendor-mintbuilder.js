/**
 * MintBuilder Vendor module (STRK-307 / STRK-311).
 *
 * MintBuilder serves clean schema.org Product/Offer JSON-LD (price +
 * availability) on every real product page, with no bot-challenge (Cloudflare
 * sits in front purely as a CDN — cf-cache-status: HIT, no JS challenge, no
 * cf_clearance cookie needed). Same "trust JSON-LD, no markdown quirks" shape
 * as Goldback: no cutoff patterns, no OOS text-pattern workaround, no custom
 * price strategy. `availability` (InStock/OutOfStock) is authoritative and
 * populated even when `price` is present on an out-of-stock page, so the
 * shared JSON-LD path's default handling (offer.price trusted, availability
 * read from the same block) is sufficient as-is.
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
  async scrape(context) {
    return context.scrapeGeneric({
      ...context,
      config: context.config || vendor.config,
    });
  },
};

export default vendor;

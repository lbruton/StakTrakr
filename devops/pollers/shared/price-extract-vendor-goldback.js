import { mergeProviderConfig } from "./price-extract-provider-config.js";

export function isGoldbackCoinSlug(coinSlug) {
  return String(coinSlug || "").startsWith("goldback");
}

export function shouldBypassFirecrawlPreferredForPhase0({
  coinSlug,
  providerId,
  tableParseProviderIds,
} = {}) {
  return Boolean(isGoldbackCoinSlug(coinSlug) && tableParseProviderIds?.has(providerId));
}

export const vendor = {
  id: "goldback",
  displayName: "Goldback",
  config: mergeProviderConfig({}), // phase0 defaults — owned here, not in LEGACY_PROVIDER_OVERRIDES.
  // No vendor-specific markdown shaping — Goldback needs no cutoff/header trimming.
  cutoffPatterns: [],
  headerSkipPattern: null,
  preorderTolerant: false,
  untrustedOfferPrice: false,
  usesAsLowAs: false,
  // No extractPrice override → shared default strategy.
  /**
   * Scrape a Goldback product page via the shared generic strategy.
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

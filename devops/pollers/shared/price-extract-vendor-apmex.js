import { FIRECRAWL_TIMEOUT_MS, mergeProviderConfig } from "./price-extract-provider-config.js";

export const APMEX_CONFIG = mergeProviderConfig({
  phase: "firecrawl",
  waitFor: 8000,
  timeout: FIRECRAWL_TIMEOUT_MS,
});

export const vendor = {
  id: "apmex",
  displayName: "APMEX",
  config: APMEX_CONFIG,
  // No vendor-specific markdown shaping — APMEX needs no cutoff/header trimming.
  cutoffPatterns: [],
  headerSkipPattern: null,
  preorderTolerant: false,
  untrustedOfferPrice: false,
  usesAsLowAs: false,
  // No extractPrice override → shared default strategy (Firecrawl pipe table, table-first).
  /**
   * Scrape an APMEX product page via the shared generic strategy.
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

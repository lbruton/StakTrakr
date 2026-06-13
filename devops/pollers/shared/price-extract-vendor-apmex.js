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
  async scrape(context) {
    return context.scrapeGeneric({
      ...context,
      config: vendor.config,
    });
  },
};

export default vendor;

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
  async scrape(context) {
    return context.scrapeGeneric({
      ...context,
      config: vendor.config,
    });
  },
};

export default vendor;

import { providerCfg } from "./price-extract-provider-config.js";

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
  config: providerCfg("goldback"),
  async scrape(context) {
    return context.scrapeGeneric({
      ...context,
      config: context.config || vendor.config,
    });
  },
};

export default vendor;

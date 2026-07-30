import apmexVendor from "./price-extract-vendor-apmex.js";
import goldbackVendor from "./price-extract-vendor-goldback.js";
import summitVendor from "./price-extract-vendor-summit.js";
import mintbuilderVendor from "./price-extract-vendor-mintbuilder.js";
import legacyVendor from "./price-extract-vendor-legacy.js";

const MIGRATED_VENDOR_MAP = new Map([
  [goldbackVendor.id, goldbackVendor],
  [apmexVendor.id, apmexVendor],
  [summitVendor.id, summitVendor],
  [mintbuilderVendor.id, mintbuilderVendor],
]);

export const MIGRATED_VENDOR_IDS = Array.from(MIGRATED_VENDOR_MAP.keys());

export function getVendorModule(providerId) {
  return MIGRATED_VENDOR_MAP.get(providerId) || legacyVendor;
}

export async function scrapeVendor(context) {
  const providerId = context.provider?.id || context.providerId || "";
  const vendor = getVendorModule(providerId);
  return vendor.scrape({
    ...context,
    vendorModule: vendor,
  });
}

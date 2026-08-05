import apmexVendor from "./price-extract-vendor-apmex.js";
import goldbackVendor from "./price-extract-vendor-goldback.js";
import summitVendor from "./price-extract-vendor-summit.js";
import mintbuilderVendor from "./price-extract-vendor-mintbuilder.js";
import legacyVendor from "./price-extract-vendor-legacy.js";
import { mergeProviderConfig, providerCfg } from "./price-extract-provider-config.js";

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

/**
 * Resolve the scrape config for one vendor dispatch — the single merge
 * authority for the registry path (STRK-314).
 *
 * Precedence, lowest to highest:
 *   1. PROVIDER_DEFAULTS + LEGACY_PROVIDER_OVERRIDES  (via providerCfg)
 *   2. the vendor module's own config                 (module-owned overrides)
 *   3. the caller's EXPLICIT config                   (per-call overrides)
 *
 * Callers must pass `null`/`undefined` when they have no override of their own.
 * A defaulted `providerCfg(id)` handed in as `callerConfig` is indistinguishable
 * from a deliberate one and would outrank module-owned settings — that is the
 * STRK-311 phase0 regression shape.
 *
 * @param {string} providerId
 * @param {{config?: Object}|null} vendorModule  Module from getVendorModule().
 * @param {Object|null} [callerConfig=null]  Explicit per-call overrides only.
 * @returns {Object} Fully merged provider config.
 */
export function resolveVendorConfig(providerId, vendorModule, callerConfig = null) {
  return mergeProviderConfig(providerCfg(providerId), vendorModule?.config, callerConfig);
}

export async function scrapeVendor(context) {
  const providerId = context.provider?.id || context.providerId || "";
  const vendor = getVendorModule(providerId);
  return vendor.scrape({
    ...context,
    vendorModule: vendor,
    // Resolved once, here — vendor modules forward this untouched and
    // scrapeGenericTarget consumes it as authoritative (STRK-314). Previously
    // each module merged its own way and scrapeGenericTarget re-derived the
    // config from vendorModule.config, discarding every caller override.
    config: resolveVendorConfig(providerId, vendor, context.config),
  });
}

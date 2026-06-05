/**
 * Legacy Vendor adapter for not-yet-migrated retail Vendors.
 *
 * The adapter conforms to the standard Vendor interface while delegating all
 * scrape behavior to the current generic price-extract path.
 */

export const vendor = {
  id: "legacy",
  displayName: "Legacy Vendor",
  config: {},
  async scrape(context) {
    if (typeof context.scrapeGeneric !== "function") {
      throw new TypeError("legacy Vendor requires context.scrapeGeneric");
    }
    return context.scrapeGeneric(context);
  },
};

export default vendor;

// Slices of js/bulkEdit.js that several unit suites evaluate with injected doubles.

import { evalSource, rangeOf, readSource } from "./source-extract.js";
import { sliceArrowConst } from "../test-helpers.js";

const BULK_FILE = "js/bulkEdit.js";

/**
 * Evaluates recordBulkPriceHistory with its globals bound to test stubs.
 * @param {object} env - recordItemPrice, bulkEnabledFields, inventory, bulkSelection,
 *   saveItemPriceHistory.
 * @returns {(valuesToApply: Object<string, string>) => void}
 */
export function loadRecordBulkPriceHistory(env) {
  const src = readSource(BULK_FILE);
  return evalSource(BULK_FILE, {
    params: {
      recordItemPrice: env.recordItemPrice,
      bulkEnabledFields: env.bulkEnabledFields,
      inventory: env.inventory,
      bulkSelection: env.bulkSelection,
      saveItemPriceHistory: env.saveItemPriceHistory,
    },
    slice: rangeOf(src, sliceArrowConst(src, "const recordBulkPriceHistory = (")),
    suffix: "\nreturn recordBulkPriceHistory;",
  });
}

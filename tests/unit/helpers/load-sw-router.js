// Shared loader for sw-router.js in Node unit tests.
//
// sw-router.js is a plain importScripts-compatible script, not an ES module, so
// it is evaluated with a synthetic CommonJS module context to trip its export
// guard — no ESM refactor of the production script required.

import { evalSource } from "./source-extract.js";

/**
 * Evaluate sw-router.js with a synthetic CJS context and return its exports.
 *
 * @returns {Record<string, any>} sw-router.js's CommonJS exports.
 */
export function loadSwRouter() {
  const swModule = { exports: {} };
  evalSource("sw-router.js", { params: { module: swModule, exports: swModule.exports } });
  return swModule.exports;
}

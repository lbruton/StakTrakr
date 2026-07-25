// Shared loader for sw-router.js in Node unit tests.
//
// sw-router.js is a plain importScripts-compatible script, not an ES module, so
// it is evaluated with a synthetic CommonJS module context to trip its export
// guard — no ESM refactor of the production script required.
//
// Centralised here because three suites need it (STRK-249 routing matrix,
// STRK-256 cache fallback, STRK-264 providers strategy).

import { readFileSync } from "node:fs";
import { URL } from "node:url";

/**
 * Evaluate sw-router.js with a synthetic CJS context and return its exports.
 *
 * The source is a first-party repo file read from disk and passed verbatim;
 * no external or caller-supplied string is interpolated into the function body.
 *
 * @returns {Record<string, any>} sw-router.js's CommonJS exports.
 */
export function loadSwRouter() {
  const routerCode = readFileSync(new URL("../../../sw-router.js", import.meta.url), "utf-8");
  const swModule = { exports: {} };
  new Function("module", "exports", routerCode)(swModule, swModule.exports);
  return swModule.exports;
}

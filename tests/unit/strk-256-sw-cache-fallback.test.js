// Unit tests for the service worker's non-OK cache-fallback decision (STRK-256).
//
// Found by Copilot on PR #1358, in the STRK-249 network-first path. The
// network-first branch of `classifiedFetch` only fell back to CacheStorage when
// the fetch itself *rejected* (offline, DNS failure). A transient upstream
// 500/503 resolves normally, so the service worker handed the error response
// straight to the page even with a perfectly good cached copy on disk — the
// user saw an error state instead of last-known-good prices.
//
// The decision is kept in sw-router.js (rather than inline in sw.js) because
// sw.js can only run inside a real service worker: `page.route()` does not
// intercept SW-originated fetches, and every networkFirst family is API-host
// only, so the network-first branch is not drivable from the Playwright
// harness. Keeping the predicate pure makes it directly testable here.
//
// Run: npm run test:unit

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const routerCode = readFileSync(new URL("../../sw-router.js", import.meta.url), "utf-8");
const _module = { exports: {} };
new Function("module", "exports", routerCode)(_module, _module.exports);
const { shouldFallBackToCache } = _module.exports;

/**
 * Build a minimal stand-in for a fetch Response.
 *
 * Node 18+ has a global Response, but constructing one with status 0 or type
 * "opaque" is not possible, so the properties the predicate reads are faked.
 *
 * @param {object} props - Response properties.
 * @param {number} props.status - HTTP status code.
 * @param {string} [props.type] - Response type ("basic", "cors", "opaque", "error").
 * @returns {{ok: boolean, status: number, type: string}} Fake response.
 */
function fakeResponse({ status, type = "basic" }) {
  return { ok: status >= 200 && status < 300, status, type };
}

describe("STRK-256 shouldFallBackToCache", () => {
  it("does not fall back on a successful response", () => {
    assert.equal(shouldFallBackToCache(fakeResponse({ status: 200 })), false);
    assert.equal(shouldFallBackToCache(fakeResponse({ status: 204 })), false);
  });

  it("falls back on transient upstream errors", () => {
    // The reported case: a 500/503 from the API must serve last-known-good
    // prices rather than surfacing an error state to the page.
    assert.equal(shouldFallBackToCache(fakeResponse({ status: 500 })), true);
    assert.equal(shouldFallBackToCache(fakeResponse({ status: 502 })), true);
    assert.equal(shouldFallBackToCache(fakeResponse({ status: 503 })), true);
    assert.equal(shouldFallBackToCache(fakeResponse({ status: 504 })), true);
  });

  it("falls back on client errors too", () => {
    // A 404/403 is just as unusable to the page as a 500. The issue's fix
    // direction is to treat any non-OK the same as a fetch rejection.
    assert.equal(shouldFallBackToCache(fakeResponse({ status: 404 })), true);
    assert.equal(shouldFallBackToCache(fakeResponse({ status: 403 })), true);
    assert.equal(shouldFallBackToCache(fakeResponse({ status: 429 })), true);
  });

  it("does NOT fall back on an opaque response", () => {
    // Opaque (no-cors cross-origin) responses always report status 0 / ok
    // false, but they are legitimate and fetchAndCacheClassified caches and
    // returns them. Treating them as failures would discard a valid response
    // and, worse, replace it with a stale one on every no-cors request.
    assert.equal(shouldFallBackToCache(fakeResponse({ status: 0, type: "opaque" })), false);
  });

  it("falls back on a network error response", () => {
    // Response.error() — type "error", status 0.
    assert.equal(shouldFallBackToCache(fakeResponse({ status: 0, type: "error" })), true);
  });

  it("falls back when there is no response at all", () => {
    assert.equal(shouldFallBackToCache(null), true);
    assert.equal(shouldFallBackToCache(undefined), true);
  });
});

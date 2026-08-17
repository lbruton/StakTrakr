#!/usr/bin/env node
/**
 * Source-contract tests for home-poller dashboard hygiene (STRK-323).
 *
 * Run with:
 *   node --test devops/pollers/home-poller/dashboard-hygiene.test.mjs
 *
 * Why source-contract rather than behavioral: dashboard.js is only runnable
 * inside the poller container. The Dockerfile flattens `shared/*.js` and
 * `home-poller/dashboard.js` into a single `/app` directory, so its
 * `./provider-db.js` import (the real file lives in `shared/`) and its
 * `@libsql/client` dependency both resolve there and nowhere in the repo
 * layout. It also has no exports and calls `server.listen()` at module top
 * level. Both defects guarded here are source-shape regressions, so asserting
 * on the source is the check that can actually run outside Docker.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const DASHBOARD_SRC = readFileSync(new URL("./dashboard.js", import.meta.url), "utf8");

/**
 * Return the single source line declaring the named top-level const.
 * @param {string} name Constant identifier to locate.
 * @returns {string} The full source line declaring that constant.
 */
function constLine(name) {
  const line = DASHBOARD_SRC.split("\n").find((l) => l.startsWith(`const ${name} `));
  assert.ok(line, `expected a top-level \`const ${name}\` declaration in dashboard.js`);
  return line;
}

/**
 * Return the source line that renders the element carrying the given class.
 * @param {string} className Class attribute value to locate.
 * @returns {string} The full source line rendering that element.
 */
function renderLineFor(className) {
  // Match the class as a token so multi-class attributes (class="btn-sm foo")
  // are found, not just exact single-class ones.
  const attr = new RegExp(`class="[^"]*\\b${className}\\b[^"]*"`);
  const line = DASHBOARD_SRC.split("\n").find((l) => attr.test(l));
  assert.ok(line, `expected dashboard.js to render an element with class "${className}"`);
  return line;
}

test("loadEnv() runs before every env-derived constant (STRK-323)", () => {
  const lines = DASHBOARD_SRC.split("\n");
  const loadEnvAt = lines.findIndex((l) => l.includes("function loadEnv()"));
  assert.ok(loadEnvAt >= 0, "expected a loadEnv() bootstrap in dashboard.js");

  // The container exports env directly, but the LXC/bare-metal install
  // (setup-lxc.sh) ships a .env beside the script. A const declared above
  // loadEnv() reads process.env too early and silently takes its default.
  const offenders = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line, i }) => i < loadEnvAt && /^const \w+ = .*process\.env\./.test(line))
    .map(({ line, i }) => `  line ${i + 1}: ${line.trim()}`);

  assert.deepEqual(
    offenders,
    [],
    `these constants read process.env before loadEnv() runs, so a .env value is ignored:\n${offenders.join("\n")}`
  );
});

test("DATA_DIR honors the container's $DATA_DIR env var (STRK-323)", () => {
  const line = constLine("DATA_DIR");
  assert.match(
    line,
    /process\.env\.DATA_DIR/,
    "DATA_DIR must read process.env.DATA_DIR — the compose file sets DATA_DIR=/data " +
      "and mounts poller-data there, while import.meta.url resolves into the image layer"
  );
  assert.doesNotMatch(
    line,
    /import\.meta\.url/,
    "DATA_DIR must not resolve relative to import.meta.url — dashboard.js is copied to " +
      "/app/dashboard.js, so that yields /app/data (image layer), not the /data volume"
  );
});

test("PROVIDERS_FILE resolves under DATA_DIR, not the script directory (STRK-323)", () => {
  const line = constLine("PROVIDERS_FILE");
  assert.doesNotMatch(
    line,
    /import\.meta\.url/,
    "PROVIDERS_FILE must not resolve relative to import.meta.url — POST /providers/export " +
      "would write where nothing reads, and the sqld-down fallback would read an empty path"
  );
  assert.match(
    line,
    /DATA_DIR/,
    "PROVIDERS_FILE must be derived from DATA_DIR so it matches the path " +
      "export-providers-json.js writes (DATA_DIR/retail/providers.json)"
  );
});

test("By Vendor API product ID input honors the readOnly flag (STRK-324)", () => {
  assert.match(
    renderLineFor("vendor-productid-byvendor"),
    /readOnly \? "disabled" : ""/,
    "the feed product ID pin is a write control and must be disabled when sqld is down"
  );
});

test("the product-id endpoint writes hints only, never updateVendorFields (STRK-324)", () => {
  const handler = DASHBOARD_SRC.slice(
    DASHBOARD_SRC.indexOf('url === "/providers/vendor-product-id"'),
    DASHBOARD_SRC.indexOf('url === "/providers/bulk-toggle"')
  );
  assert.ok(handler.length > 0, "expected a /providers/vendor-product-id handler");
  assert.match(
    handler,
    /updateVendorHints\(/,
    "must use the hints-only writer so the selector column survives"
  );
  assert.doesNotMatch(
    handler,
    /updateVendorFields\(/,
    "updateVendorFields writes selector AND hints — calling it here resolves " +
      "selector to null and silently wipes it"
  );
  assert.match(
    handler,
    /mergeHintsProductId\(/,
    "must merge into the existing hints JSON rather than overwrite the column"
  );
});

test("vendor section expand/collapse resolves the body by class, not position (STRK-324)", () => {
  const raw = DASHBOARD_SRC.slice(
    DASHBOARD_SRC.indexOf("document.querySelectorAll('.vendor-section-header')"),
    DASHBOARD_SRC.indexOf("document.querySelectorAll('.vendor-url-byvendor')")
  );
  assert.ok(raw.length > 0, "expected a .vendor-section-header click handler");
  // Assert on code, not prose — the comment explaining the fix names the very
  // API the guard forbids.
  const handler = raw.replace(/\/\/[^\n]*/g, "");

  // API-fed vendors render a feed health line between the header and the rows.
  // A nextElementSibling lookup then toggles the health line and the item rows
  // never expand — for exactly the vendor the feed controls exist to operate.
  assert.doesNotMatch(
    handler,
    /nextElementSibling/,
    "positional lookup breaks whenever anything is rendered between the header " +
      "and .vendor-section-body"
  );
  assert.match(
    handler,
    /querySelector\(['"]\.vendor-section-body['"]\)/,
    "the collapse target must be resolved by class"
  );
});

test("the feed health probe is bounded so a long-running dashboard refreshes (STRK-324)", () => {
  assert.match(
    DASHBOARD_SRC,
    /getFeedIndex\(\{\s*maxAgeMs:/,
    "getFeedIndex memoizes forever by default; the dashboard is a long-running " +
      "process, so an unbounded call would freeze the health line at first page load"
  );
});

test("the feed probe stays off the /providers response path (STRK-324)", () => {
  const handler = DASHBOARD_SRC.slice(
    DASHBOARD_SRC.indexOf('url === "/providers"'),
    DASHBOARD_SRC.indexOf('url === "/providers/coin-data"')
  );
  assert.ok(handler.length > 0, "expected a GET /providers handler");

  // buildFeedState allows two 15s attempts plus a 2s retry delay. Awaiting it
  // while rendering would stall the entire provider editor for ~32s on the
  // first load after each cache expiry whenever the vendor endpoint hangs.
  assert.doesNotMatch(
    handler,
    /probeFeedHealth\(/,
    "the provider page must not await an external vendor endpoint; the health " +
      "line is fetched client-side from GET /providers/feed-health"
  );
  assert.match(
    DASHBOARD_SRC,
    /url === "\/providers\/feed-health"/,
    "expected a separate feed-health endpoint"
  );
});

test("By Vendor URL input honors the readOnly flag (STRK-323)", () => {
  assert.match(
    renderLineFor("vendor-url-byvendor"),
    /readOnly \? "disabled" : ""/,
    "the By Vendor URL input must be disabled when sqld is down, matching the " +
      "per-coin vendor-url input"
  );
});

test("By Vendor enable/disable toggle honors the readOnly flag (STRK-323)", () => {
  assert.match(
    renderLineFor("vendor-toggle-byvendor"),
    /readOnly \? "disabled" : ""/,
    "the By Vendor toggle must be disabled when sqld is down — an enabled control " +
      "in read-only mode issues a write that cannot succeed"
  );
});

test("FBP-backed vendor ids are declared as a Set including jmbullion (STRK-347)", () => {
  const line = constLine("FBP_VENDOR_IDS");
  assert.match(
    line,
    /new Set\(\[/,
    "FBP_VENDOR_IDS must be a Set so the render can test membership per vendor"
  );
  assert.match(
    line,
    /"jmbullion"/,
    "jmbullion is the current FBP-backed vendor (price scraped from FindBullionPrices.com)"
  );
});

test("the provider editor surfaces an FBP-backed badge (STRK-347)", () => {
  assert.match(
    DASHBOARD_SRC,
    /FBP-backed/,
    "FBP-backed vendors must carry a visible badge so the price-source distinction is obvious"
  );
});

test("By Vendor FBP price-source URL input honors the readOnly flag (STRK-347)", () => {
  assert.match(
    renderLineFor("vendor-fbp-url-byvendor"),
    /readOnly \? "disabled" : ""/,
    "the By Vendor FBP price-source URL is a write control and must be disabled when sqld is down"
  );
});

test("By Coin FBP price-source URL input honors the readOnly flag (STRK-347)", () => {
  const line = DASHBOARD_SRC.split("\n").find((l) => l.includes('class="vendor-fbp-url"'));
  assert.ok(line, 'expected a By-Coin input with class="vendor-fbp-url"');
  assert.match(
    line,
    /readOnly \? "disabled" : ""/,
    "the By Coin FBP price-source URL is a write control and must be disabled when sqld is down"
  );
});

test("the coin-fbp-url endpoint writes fbp_url alone, never upsertCoin (STRK-347)", () => {
  const start = DASHBOARD_SRC.indexOf('url === "/providers/coin-fbp-url"');
  assert.ok(start >= 0, "expected a /providers/coin-fbp-url handler");
  // Slice to the next route marker so the assertion is scoped to this handler.
  const rest = DASHBOARD_SRC.slice(start + 1);
  const nextRoute = rest.indexOf('url === "/providers/');
  const handler = DASHBOARD_SRC.slice(start, nextRoute >= 0 ? start + 1 + nextRoute : undefined);
  assert.match(
    handler,
    /updateCoinFbpUrl\(/,
    "must use the dedicated fbp_url writer so the coin's identity columns survive"
  );
  assert.doesNotMatch(
    handler,
    /upsertCoin\(/,
    "upsertCoin writes metal/name/weight from its payload — calling it here with a " +
      "partial coin would null the coin's identity fields"
  );
});

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

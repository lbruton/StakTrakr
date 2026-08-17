#!/usr/bin/env node
/**
 * TDD contract tests for the FBP-backed jmbullion vendor module
 * (STRK-334, design C3).
 *
 * The module fetches the coin's fbp_url, parses the JSON-LD ItemList, and
 * extracts the "JM Bullion" offer. To keep these tests network-free, the
 * fetch is injected through the context as `context.fetchFbpPage` — the same
 * context-injected-double seam the mintbuilder module uses for `mbFeedLookup`
 * / `scrapeGeneric` (price-extract-vendors.test.mjs). The module must consume
 * that override when present and fall back to the real C2 fetch otherwise.
 *
 * RED phase: `./price-extract-vendor-jmbullion-fbp.js` does not exist yet.
 *
 * Run with:
 *   node --test devops/pollers/shared/price-extract-vendor-jmbullion-fbp.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FIXTURE_HTML = readFileSync(
  new URL("./__fixtures__/fbp-ase-2026.html", import.meta.url),
  "utf8"
);
const NO_JM_HTML = readFileSync(
  new URL("./__fixtures__/fbp-ase-no-jm.html", import.meta.url),
  "utf8"
);

const FBP_URL = "https://findbullionprices.com/p/2026-american-silver-eagle-1-oz-bu-coin/";

const importVendor = async () => {
  const mod = await import(new URL("./price-extract-vendor-jmbullion-fbp.js", import.meta.url));
  return mod.vendor ?? mod.default;
};

/** Build a scrape context whose fetchFbpPage returns the supplied HTML. */
const contextWithHtml = (html, { fbpUrl = FBP_URL } = {}) => ({
  provider: { id: "jmbullion", url: fbpUrl },
  coin: { fbp_url: fbpUrl, metal: "silver", weight_oz: 1 },
  url: fbpUrl,
  log: () => {},
  warn: () => {},
  fetchFbpPage: async () => html,
});

test("scrape returns the JM price with source:'fbp' when JM is listed", async () => {
  const vendor = await importVendor();
  const result = await vendor.scrape(contextWithHtml(FIXTURE_HTML));

  assert.equal(result.ok, true);
  assert.equal(result.price, 82.95);
  assert.equal(result.inStock, true);
  assert.equal(result.source, "fbp");
  assert.equal(result.url, FBP_URL);
});

test("scrape reports a confirmed absence (inStock:false) when JM is not listed on a fetched page", async () => {
  const vendor = await importVendor();
  const result = await vendor.scrape(contextWithHtml(NO_JM_HTML));

  assert.equal(result.ok, false);
  assert.equal(result.source, "fbp");
  // Genuine no-offer must age out (R4): price:null + inStock:false → is_failed=0,
  // no retry, no perpetual carry-forward.
  assert.equal(result.price, null);
  assert.equal(result.inStock, false);
  assert.equal(result.error, "jm-not-listed");
});

test("scrape marks a fetch throw as a retryable transport failure (inStock:true)", async () => {
  const vendor = await importVendor();
  const context = {
    provider: { id: "jmbullion", url: FBP_URL },
    coin: { fbp_url: FBP_URL, metal: "silver", weight_oz: 1 },
    url: FBP_URL,
    log: () => {},
    warn: () => {},
    fetchFbpPage: async () => {
      throw new Error("network down");
    },
  };

  const result = await vendor.scrape(context);
  assert.equal(result.ok, false);
  assert.equal(result.source, "fbp");
  // Transport error must NOT read as confirmed OOS. runFullPoller derives
  // is_failed from `price === null && inStock`, so a retryable failure is
  // price:null + inStock:true — that keeps the row in the retry/failure queue
  // and preserves carry-forward of the last-known price.
  assert.equal(result.price, null);
  assert.equal(result.inStock, true);
});

test("scrape fails closed on an off-host fbp_url without fetching (SSRF guard)", async () => {
  const vendor = await importVendor();
  let fetchCalled = false;
  const context = {
    provider: { id: "jmbullion", url: FBP_URL },
    coin: { fbp_url: "https://evil.example.com/p/2026-american-silver-eagle/", metal: "silver", weight_oz: 1 },
    url: FBP_URL,
    log: () => {},
    warn: () => {},
    fetchFbpPage: async () => {
      fetchCalled = true;
      return FIXTURE_HTML;
    },
  };

  const result = await vendor.scrape(context);
  assert.equal(fetchCalled, false, "must not open a socket to an off-host URL");
  assert.equal(result.ok, false);
  assert.equal(result.source, "fbp");
  assert.equal(result.price, null);
  assert.equal(result.inStock, false);
  assert.equal(result.error, "off-host-fbp-url");
});

test("scrape returns ok:false with error 'no-fbp-url' when the coin has no fbp_url", async () => {
  const vendor = await importVendor();
  const context = {
    provider: { id: "jmbullion" },
    coin: { metal: "silver", weight_oz: 1 },
    url: null,
    log: () => {},
    warn: () => {},
    // fetchFbpPage must never be reached — the missing url short-circuits first.
    fetchFbpPage: async () => {
      throw new Error("fetch should not be called when fbp_url is missing");
    },
  };

  const result = await vendor.scrape(context);
  assert.equal(result.ok, false);
  assert.equal(result.error, "no-fbp-url");
});

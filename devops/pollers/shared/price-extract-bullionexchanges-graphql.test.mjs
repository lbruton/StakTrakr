#!/usr/bin/env node
/**
 * Contract tests for the Bullion Exchanges GraphQL client and vendor module.
 *
 * Bullion Exchanges renders its quantity-tier table client-side, so a Byparr
 * page snapshot can miss it. The client asks the store's GraphQL API through
 * Byparr instead: one products query maps every url_key to an id and stock
 * status, and one LivePrices query returns the tier prices. These tests pin:
 *   - url_key extraction, Byparr JSON parsing and tier-1 price selection,
 *   - the two-call batched index and its per-process memo,
 *   - lookup results (hit, out of stock, miss, unavailable),
 *   - the vendor module's GraphQL-first scrape with page-scrape fallback.
 *
 * Fixtures are Byparr responses recorded on 2026-11-10 for the 26 Bullion
 * Exchanges rows in providers.json.
 *
 * Run with:
 *   node devops/pollers/shared/price-extract-bullionexchanges-graphql.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const clientUrl = new URL("./price-extract-bullionexchanges-graphql.js", import.meta.url);
const vendorUrl = new URL("./price-extract-vendor-bullionexchanges.js", import.meta.url);

const PRODUCTS_HTML = readFileSync(
  new URL("./fixtures/be-graphql-products.html", import.meta.url),
  "utf8"
);
const LIVE_HTML = readFileSync(
  new URL("./fixtures/be-graphql-liveprices.html", import.meta.url),
  "utf8"
);

const BE = "https://bullionexchanges.com";
const ASE_URL = `${BE}/2026-1-oz-silver-american-eagle-1-coin-bu`;
const AGE_URL = `${BE}/2026-1-oz-gold-american-eagle-50-coin-bu`;
const BAR_URL = `${BE}/10-oz-generic-silver-bar`;
const GOLDBACK_URL = `${BE}/1-utah-goldback-1-1000-oz-24k-gold-foil-aurum-note`;
const APE_URL = `${BE}/1-oz-platinum-american-eagle`;
const ALL_URLS = [ASE_URL, AGE_URL, BAR_URL, GOLDBACK_URL, APE_URL];

const silent = () => {};

/** Load the client with a fresh memo. */
const loadClient = async () => {
  const mod = await import(clientUrl);
  mod._resetIndexCacheForTests();
  return mod;
};

/**
 * Fake fetchJson that answers from the recorded fixtures and counts calls.
 * @returns {{fetchJson: Function, calls: string[]}}
 */
const fixtureFetch = (client, overrides = {}) => {
  const calls = [];
  const fetchJson = async (query) => {
    calls.push(query);
    if (query.includes("products(")) {
      return overrides.products ?? { ok: true, data: client.parseByparrJson(PRODUCTS_HTML).data };
    }
    if (query.includes("LivePrices(")) {
      return overrides.live ?? { ok: true, data: client.parseByparrJson(LIVE_HTML).data };
    }
    throw new Error(`unexpected query ${query}`);
  };
  return { fetchJson, calls };
};

// --- url_key, parsing, tier selection ------------------------------------

test("beUrlKey returns the path of a Bullion Exchanges product URL", async () => {
  const client = await loadClient();
  assert.equal(client.beUrlKey(ASE_URL), "2026-1-oz-silver-american-eagle-1-coin-bu");
  assert.equal(
    client.beUrlKey("https://www.BullionExchanges.com/10-oz-generic-silver-bar/?x=1#top"),
    "10-oz-generic-silver-bar"
  );
});

test("beUrlKey rejects other hosts, root URLs and junk", async () => {
  const client = await loadClient();
  assert.equal(client.beUrlKey("https://apmex.com/10-oz-generic-silver-bar"), null);
  assert.equal(client.beUrlKey(`${BE}/`), null);
  assert.equal(client.beUrlKey("not a url"), null);
  assert.equal(client.beUrlKey(null), null);
});

test("parseByparrJson reads JSON from a Firefox pre wrapper", async () => {
  const client = await loadClient();
  const parsed = client.parseByparrJson(PRODUCTS_HTML);
  assert.equal(parsed.data.products.total_count, 26);
});

test("parseByparrJson decodes HTML entities inside the pre block", async () => {
  const client = await loadClient();
  const html =
    "<html><body><pre>{&quot;data&quot;:{&quot;a&quot;:&quot;x &amp; y&quot;}}</pre></body></html>";
  assert.deepEqual(client.parseByparrJson(html), { data: { a: "x & y" } });
});

test("parseByparrJson returns null for a Cloudflare challenge page", async () => {
  const client = await loadClient();
  const challenge =
    "<!DOCTYPE html><html><head><title>Just a moment...</title></head>" +
    "<body><script>window._cf_chl_opt = {cType: 'managed'};</script></body></html>";
  assert.equal(client.parseByparrJson(challenge), null);
  assert.equal(client.parseByparrJson(""), null);
  assert.equal(client.parseByparrJson(null), null);
});

test("selectTierOnePrice takes the smallest-quantity tier and rounds to cents", async () => {
  const client = await loadClient();
  const price = client.selectTierOnePrice({
    id: 1,
    tierPrices: [
      { quantity: 5, price_wire_checkmo: { value: 4248.1728 } },
      { quantity: 1, price_wire_checkmo: { value: 4250.1996 } },
    ],
  });
  assert.equal(price, 4250.2);
});

test("selectTierOnePrice returns null when no tier has a positive price", async () => {
  const client = await loadClient();
  assert.equal(client.selectTierOnePrice({ tierPrices: [] }), null);
  assert.equal(client.selectTierOnePrice({ tierPrices: "junk" }), null);
  assert.equal(
    client.selectTierOnePrice({ tierPrices: [{ quantity: 1, price_wire_checkmo: { value: 0 } }] }),
    null
  );
  assert.equal(client.selectTierOnePrice(null), null);
});

// --- index and lookup -----------------------------------------------------

test("lookup prices an in-stock product from the tier-1 wire column", async () => {
  const client = await loadClient();
  const { fetchJson } = fixtureFetch(client);
  const result = await client.lookupBullionExchangesProduct({
    url: ASE_URL,
    urls: ALL_URLS,
    fetchJson,
    log: silent,
    warn: silent,
  });
  assert.deepEqual(result, {
    status: "hit",
    product: { id: 26648, inStock: true, price: 58.49 },
  });
});

test("lookup prices gold, bar and Goldback rows from their own tier-1 range", async () => {
  const client = await loadClient();
  const { fetchJson } = fixtureFetch(client);
  const priceOf = async (url) =>
    (await client.lookupBullionExchangesProduct({ url, urls: ALL_URLS, fetchJson, log: silent }))
      .product.price;
  assert.equal(await priceOf(AGE_URL), 4250.2);
  assert.equal(await priceOf(BAR_URL), 544.9);
  assert.equal(await priceOf(GOLDBACK_URL), 7.78);
});

test("lookup reports an OUT_OF_STOCK product as out of stock with no price", async () => {
  const client = await loadClient();
  const { fetchJson } = fixtureFetch(client);
  const result = await client.lookupBullionExchangesProduct({
    url: APE_URL,
    urls: ALL_URLS,
    fetchJson,
    log: silent,
  });
  assert.deepEqual(result, { status: "hit", product: { id: 277, inStock: false, price: null } });
});

test("the index costs one products call and one LivePrices call per process", async () => {
  const client = await loadClient();
  const { fetchJson, calls } = fixtureFetch(client);
  for (const url of ALL_URLS) {
    await client.lookupBullionExchangesProduct({ url, urls: ALL_URLS, fetchJson, log: silent });
  }
  assert.equal(calls.length, 2);
  assert.match(calls[0], /products\(filter:\{url_key:\{in:\[/);
  assert.match(calls[1], /LivePrices\(ids:\[/);
});

test("the products query names every requested url_key once", async () => {
  const client = await loadClient();
  const { fetchJson, calls } = fixtureFetch(client);
  await client.lookupBullionExchangesProduct({
    url: ASE_URL,
    urls: [...ALL_URLS, ASE_URL, "https://apmex.com/other"],
    fetchJson,
    log: silent,
  });
  const keys = JSON.parse(calls[0].match(/in:(\[[^\]]*\])/)[1]);
  assert.deepEqual(keys.sort(), ALL_URLS.map((u) => client.beUrlKey(u)).sort());
});

test("LivePrices asks only for in-stock ids", async () => {
  const client = await loadClient();
  const { fetchJson, calls } = fixtureFetch(client);
  await client.lookupBullionExchangesProduct({
    url: ASE_URL,
    urls: ALL_URLS,
    fetchJson,
    log: silent,
  });
  const ids = calls[1]
    .match(/ids:\[([^\]]*)\]/)[1]
    .split(",")
    .map(Number);
  assert.ok(ids.includes(26648));
  assert.ok(!ids.includes(277), "out-of-stock id 277 must not be requested");
});

test("the target URL joins the products query when urls omits it", async () => {
  const client = await loadClient();
  const { fetchJson, calls } = fixtureFetch(client);
  const result = await client.lookupBullionExchangesProduct({
    url: ASE_URL,
    fetchJson,
    log: silent,
  });
  assert.equal(result.status, "hit");
  assert.match(calls[0], /2026-1-oz-silver-american-eagle-1-coin-bu/);
});

test("a url_key the store does not return is a miss", async () => {
  const client = await loadClient();
  const { fetchJson } = fixtureFetch(client);
  const result = await client.lookupBullionExchangesProduct({
    url: `${BE}/retired-product`,
    urls: [...ALL_URLS, `${BE}/retired-product`],
    fetchJson,
    log: silent,
  });
  assert.deepEqual(result, { status: "miss", reason: "not_found" });
});

test("a URL outside the memoized request set is a miss", async () => {
  const client = await loadClient();
  const { fetchJson } = fixtureFetch(client);
  await client.lookupBullionExchangesProduct({
    url: ASE_URL,
    urls: [ASE_URL],
    fetchJson,
    log: silent,
  });
  const result = await client.lookupBullionExchangesProduct({
    url: AGE_URL,
    urls: [AGE_URL],
    fetchJson,
    log: silent,
  });
  assert.deepEqual(result, { status: "miss", reason: "not_requested" });
});

test("an in-stock product without a live price is a miss", async () => {
  const client = await loadClient();
  const { fetchJson } = fixtureFetch(client, {
    live: { ok: true, data: { LivePrices: [] } },
  });
  const result = await client.lookupBullionExchangesProduct({
    url: ASE_URL,
    urls: ALL_URLS,
    fetchJson,
    log: silent,
    warn: silent,
  });
  assert.deepEqual(result, { status: "miss", reason: "no_live_price" });
});

test("a failed LivePrices call keeps out-of-stock results", async () => {
  const client = await loadClient();
  const { fetchJson } = fixtureFetch(client, { live: { ok: false, reason: "bad_payload" } });
  const opts = { urls: ALL_URLS, fetchJson, log: silent, warn: silent };
  assert.deepEqual(await client.lookupBullionExchangesProduct({ url: ASE_URL, ...opts }), {
    status: "miss",
    reason: "no_live_price",
  });
  assert.equal(
    (await client.lookupBullionExchangesProduct({ url: APE_URL, ...opts })).product.inStock,
    false
  );
});

test("a failed products call is unavailable and is memoized", async () => {
  const client = await loadClient();
  const { fetchJson, calls } = fixtureFetch(client, {
    products: { ok: false, reason: "byparr_failed" },
  });
  const opts = { urls: ALL_URLS, fetchJson, log: silent, warn: silent };
  assert.deepEqual(await client.lookupBullionExchangesProduct({ url: ASE_URL, ...opts }), {
    status: "unavailable",
    reason: "byparr_failed",
  });
  await client.lookupBullionExchangesProduct({ url: AGE_URL, ...opts });
  assert.equal(calls.length, 1, "a failed index must not retry for every target");
});

test("a products payload without items is unavailable", async () => {
  const client = await loadClient();
  const { fetchJson } = fixtureFetch(client, { products: { ok: true, data: { products: null } } });
  const result = await client.lookupBullionExchangesProduct({
    url: ASE_URL,
    urls: ALL_URLS,
    fetchJson,
    log: silent,
    warn: silent,
  });
  assert.deepEqual(result, { status: "unavailable", reason: "bad_payload" });
});

test("a fetchJson that throws is unavailable, never a rejection", async () => {
  const client = await loadClient();
  const result = await client.lookupBullionExchangesProduct({
    url: ASE_URL,
    urls: ALL_URLS,
    fetchJson: async () => {
      throw new Error("boom");
    },
    log: silent,
    warn: silent,
  });
  assert.deepEqual(result, { status: "unavailable", reason: "fetch_failed" });
});

test("a non-Bullion-Exchanges target URL is a miss without any request", async () => {
  const client = await loadClient();
  const { fetchJson, calls } = fixtureFetch(client);
  const result = await client.lookupBullionExchangesProduct({
    url: "https://apmex.com/x",
    fetchJson,
    log: silent,
  });
  assert.deepEqual(result, { status: "miss", reason: "bad_url" });
  assert.equal(calls.length, 0);
});

// --- Byparr transport -----------------------------------------------------

test("fetchGraphqlViaByparr sends the GraphQL GET URL and parses the reply", async () => {
  const client = await loadClient();
  const seen = [];
  const result = await client.fetchGraphqlViaByparr("{x}", {
    byparrFetch: async (url) => {
      seen.push(url);
      return { ok: true, data: { status: "ok", solution: { response: PRODUCTS_HTML } } };
    },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0], `${client.BE_GRAPHQL_URL}?query=${encodeURIComponent("{x}")}`);
  assert.equal(result.ok, true);
  assert.equal(result.data.products.total_count, 26);
});

test("fetchGraphqlViaByparr retries a timed-out attempt once", async () => {
  const client = await loadClient();
  let attempts = 0;
  const result = await client.fetchGraphqlViaByparr("{x}", {
    byparrFetch: async () => {
      attempts++;
      if (attempts === 1) return { ok: false, errorMsg: "HTTP 408", timedOut: true };
      return { ok: true, data: { status: "ok", solution: { response: PRODUCTS_HTML } } };
    },
  });
  assert.equal(attempts, 2);
  assert.equal(result.ok, true);
});

test("fetchGraphqlViaByparr does not retry other Byparr failures", async () => {
  const client = await loadClient();
  let attempts = 0;
  const result = await client.fetchGraphqlViaByparr("{x}", {
    byparrFetch: async () => {
      attempts++;
      return { ok: false, errorMsg: "ECONNREFUSED" };
    },
    warn: silent,
  });
  assert.equal(attempts, 1);
  assert.deepEqual(result, { ok: false, reason: "byparr_failed" });
});

test("fetchGraphqlViaByparr reports a challenge page as bad_payload", async () => {
  const client = await loadClient();
  const result = await client.fetchGraphqlViaByparr("{x}", {
    byparrFetch: async () => ({
      ok: true,
      data: { status: "ok", solution: { response: "<title>Just a moment...</title>" } },
    }),
    warn: silent,
  });
  assert.deepEqual(result, { ok: false, reason: "bad_payload" });
});

test("fetchGraphqlViaByparr reports GraphQL errors without data", async () => {
  const client = await loadClient();
  const html =
    '<pre>{"errors":[{"message":"Max Aliases in query should be 10 but got 26."}]}</pre>';
  const result = await client.fetchGraphqlViaByparr("{x}", {
    byparrFetch: async () => ({ ok: true, data: { status: "ok", solution: { response: html } } }),
    warn: silent,
  });
  assert.deepEqual(result, { ok: false, reason: "graphql_error" });
});

// --- vendor module --------------------------------------------------------

/** Scrape context with a fake lookup and a recording scrapeGeneric. */
const vendorContext = (lookupResult, extra = {}) => {
  const state = { genericCalls: 0, lookupArgs: null };
  const context = {
    coinSlug: "ase",
    coin: { metal: "silver", weight_oz: 1 },
    provider: { id: "bullionexchanges", url: ASE_URL },
    urls: [ASE_URL],
    url: ASE_URL,
    log: silent,
    warn: silent,
    beGraphqlLookup: async (args) => {
      state.lookupArgs = args;
      return lookupResult;
    },
    scrapeGeneric: async () => {
      state.genericCalls++;
      return { price: 1, inStock: true, source: "playwright", ok: true, error: null, url: ASE_URL };
    },
    ...extra,
  };
  return { context, state };
};

test("the registry routes bullionexchanges to its own module", async () => {
  const registry = await import(new URL("./price-extract-vendors.js", import.meta.url));
  const vendor = registry.getVendorModule("bullionexchanges");
  assert.equal(vendor.id, "bullionexchanges");
  assert.ok(registry.MIGRATED_VENDOR_IDS.includes("bullionexchanges"));
});

test("the module keeps the tier-table extraction flags for its page fallback", async () => {
  const { vendor } = await import(vendorUrl);
  assert.equal(vendor.untrustedOfferPrice, true);
  assert.equal(vendor.usesAsLowAs, false);
  assert.equal(vendor.preorderTolerant, false);
});

test("a GraphQL hit records the price without a page scrape", async () => {
  const { vendor } = await import(vendorUrl);
  const { context, state } = vendorContext({
    status: "hit",
    product: { id: 26648, inStock: true, price: 58.49 },
  });
  const result = await vendor.scrape(context);
  assert.deepEqual(result, {
    price: 58.49,
    inStock: true,
    source: "bullionexchanges-graphql",
    ok: true,
    error: null,
    url: ASE_URL,
  });
  assert.equal(state.genericCalls, 0);
});

test("an out-of-stock GraphQL hit records out of stock without a page scrape", async () => {
  const { vendor } = await import(vendorUrl);
  const { context, state } = vendorContext({
    status: "hit",
    product: { id: 277, inStock: false, price: null },
  });
  const result = await vendor.scrape(context);
  assert.equal(result.price, null);
  assert.equal(result.inStock, false);
  assert.equal(result.ok, true);
  assert.equal(result.source, "bullionexchanges-graphql");
  assert.equal(state.genericCalls, 0);
});

test("a GraphQL miss falls back to the page scrape", async () => {
  const { vendor } = await import(vendorUrl);
  const { context, state } = vendorContext({ status: "miss", reason: "not_found" });
  const result = await vendor.scrape(context);
  assert.equal(state.genericCalls, 1);
  assert.equal(result.source, "playwright");
});

test("an unavailable GraphQL index falls back to the page scrape", async () => {
  const { vendor } = await import(vendorUrl);
  const { context, state } = vendorContext({ status: "unavailable", reason: "byparr_failed" });
  await vendor.scrape(context);
  assert.equal(state.genericCalls, 1);
});

test("the module batches every Bullion Exchanges URL in the run", async () => {
  const { vendor } = await import(vendorUrl);
  const runTargets = [
    { coinSlug: "ase", provider: { id: "bullionexchanges" }, urls: [ASE_URL] },
    { coinSlug: "age", provider: { id: "bullionexchanges" }, urls: [AGE_URL] },
    { coinSlug: "ase", provider: { id: "apmex" }, urls: ["https://apmex.com/ase"] },
  ];
  const { context, state } = vendorContext(
    { status: "hit", product: { id: 26648, inStock: true, price: 58.49 } },
    { runTargets }
  );
  await vendor.scrape(context);
  assert.equal(state.lookupArgs.url, ASE_URL);
  assert.deepEqual(state.lookupArgs.urls, [ASE_URL, AGE_URL]);
});

test("without runTargets the module looks up the target's own URLs", async () => {
  const { vendor } = await import(vendorUrl);
  const { context, state } = vendorContext({ status: "miss", reason: "not_found" });
  await vendor.scrape(context);
  assert.deepEqual(state.lookupArgs.urls, [ASE_URL]);
});

let passed = 0;
let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

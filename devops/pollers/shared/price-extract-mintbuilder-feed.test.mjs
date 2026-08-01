#!/usr/bin/env node
/**
 * TDD contract tests for the MintBuilder direct price feed client (STRK-321).
 *
 * The feed client wraps GET mintbuilder.com/feed/api/prices?key=…&mintbuilder=all
 * behind a per-process memoized index so the poll loop (one target per
 * coin×vendor) costs exactly one feed request per run. These tests pin:
 *   - URL canonicalization used to match feed `link` values to stored
 *     provider_vendors.url rows,
 *   - the hints {"mbProductId"} override parse,
 *   - lookup semantics (hit / miss / unavailable — never throws),
 *   - single-fetch memoization incl. cached failures and key-rotation refetch,
 *   - retry policy (401 never retries, 5xx/network retries once),
 *   - key hygiene (the API key never appears in log/warn output),
 *   - import purity (the module enters price-extract.js's import graph).
 *
 * Run with:
 *   node devops/pollers/shared/price-extract-mintbuilder-feed.test.mjs
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const feedModuleUrl = new URL("./price-extract-mintbuilder-feed.js", import.meta.url);

/** Import the feed module fresh state via its test-reset hook before each fetch test. */
const loadFeed = async () => {
  const mod = await import(feedModuleUrl);
  mod._resetFeedCacheForTests();
  return mod;
};

/** Build a data.products fixture keyed by product id, in the documented feed shape. */
const feedPayload = (products) => ({
  data: {
    products,
    metals: { silver: { price: 38.1, change: 0.2 } },
    spot_version: "0f6e2c5f",
    timestamp: "2026-08-01T14:00:00Z",
  },
});

const PRODUCTS = {
  101: {
    title: "1 oz Silver Buffalo Round",
    link: "https://mintbuilder.com/products/1oz-silver-buffalo-round",
    image: "https://mintbuilder.com/img/101.jpg",
    price: "38.42",
    retail: "44.99",
    tiers: [{ qty: 1, check_wire: "38.42" }],
    premium: "Over Spot",
  },
  202: {
    title: "1/10 oz Gold Eagle",
    link: "https://www.mintbuilder.com/products/tenth-oz-gold-eagle/",
    image: "https://mintbuilder.com/img/202.jpg",
    price: 412.77,
    retail: 449.0,
    tiers: [{ qty: 1, check_wire: 412.77 }],
    premium: null,
  },
  303: {
    title: "Broken price product",
    link: "https://mintbuilder.com/products/broken",
    price: "N/A",
    retail: null,
    tiers: [],
    premium: null,
  },
};

/** fetch double: returns queued results in order (an Error entry throws). Records calls. */
const makeFetch = (...results) => {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, opts });
    const next = results.length > 1 ? results.shift() : results[0];
    if (next instanceof Error) throw next;
    return next;
  };
  impl.calls = calls;
  return impl;
};

const okResponse = (json) => ({ ok: true, status: 200, json: async () => json });
const errResponse = (status) => ({ ok: false, status, json: async () => ({}) });

/** Capture log/warn lines for assertion (and key-leak scanning). */
const makeSpy = () => {
  const lines = [];
  const fn = (...args) => lines.push(args.join(" "));
  fn.lines = lines;
  return fn;
};

// ---------------------------------------------------------------------------
// Import purity — the vendor module imports this client, which puts it in the
// price-extract.js import graph pinned by price-extract-imports.test.mjs.
// ---------------------------------------------------------------------------

test("feed module imports with zero side effects and no env reads at import time", () => {
  const script = `
    const sideEffects = [];
    console.log = (...a) => sideEffects.push("log:" + a.join(" "));
    console.warn = (...a) => sideEffects.push("warn:" + a.join(" "));
    console.error = (...a) => sideEffects.push("error:" + a.join(" "));
    const mod = await import(${JSON.stringify(feedModuleUrl.href)});
    process.stdout.write(JSON.stringify({
      sideEffects,
      lookup: typeof mod.lookupMintbuilderProduct,
      getFeedIndex: typeof mod.getFeedIndex,
      normalizeProductUrl: typeof mod.normalizeProductUrl,
    }) + "\\n");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: __dirname,
    env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "" },
    encoding: "utf8",
    timeout: 3_000,
  });

  assert.equal(result.status, 0, `import probe failed:\n${result.stdout}\n${result.stderr}`);
  const probe = JSON.parse(result.stdout.trim().split("\n").filter(Boolean).at(-1));
  assert.deepEqual(probe.sideEffects, [], "importing the feed client must not log or warn");
  assert.equal(probe.lookup, "function");
  assert.equal(probe.getFeedIndex, "function");
  assert.equal(probe.normalizeProductUrl, "function");
});

// ---------------------------------------------------------------------------
// normalizeProductUrl
// ---------------------------------------------------------------------------

test("normalizeProductUrl canonicalizes equivalent product URLs", async () => {
  const { normalizeProductUrl } = await import(feedModuleUrl);
  const canonical = "mintbuilder.com/products/1oz-silver-buffalo-round";

  // https/http, www, trailing slash, query, fragment, and case all collapse.
  assert.equal(
    normalizeProductUrl("https://www.MintBuilder.com/Products/1oz-Silver-Buffalo-Round/?aff=reddit#top"),
    canonical
  );
  assert.equal(normalizeProductUrl("http://mintbuilder.com/products/1oz-silver-buffalo-round"), canonical);
  assert.equal(normalizeProductUrl("https://mintbuilder.com/products/1oz-silver-buffalo-round/"), canonical);

  // Root URLs normalize to the bare host.
  assert.equal(normalizeProductUrl("https://mintbuilder.com/"), "mintbuilder.com");
  assert.equal(normalizeProductUrl("https://mintbuilder.com"), "mintbuilder.com");

  // Garbage in → null out (never throws).
  for (const bad of [null, undefined, "", "not a url", "products/relative", 42]) {
    assert.equal(normalizeProductUrl(bad), null, `expected null for ${String(bad)}`);
  }
});

// ---------------------------------------------------------------------------
// parseHintsProductId
// ---------------------------------------------------------------------------

test("parseHintsProductId reads the mbProductId pin defensively", async () => {
  const { parseHintsProductId } = await import(feedModuleUrl);

  const quiet = makeSpy();
  assert.equal(parseHintsProductId('{"mbProductId":"12345"}', quiet), "12345");
  assert.equal(parseHintsProductId('{"mbProductId":12345}', quiet), "12345", "numbers coerce");
  assert.equal(parseHintsProductId('{"mbProductId":"  678 "}', quiet), "678", "trimmed");
  // Absent/empty/no-key inputs are the normal case — silent null.
  assert.equal(parseHintsProductId(null, quiet), null);
  assert.equal(parseHintsProductId("", quiet), null);
  assert.equal(parseHintsProductId('{"selector":".price"}', quiet), null);
  assert.equal(parseHintsProductId('{"mbProductId":{}}', quiet), null, "non-scalar ignored");
  assert.equal(parseHintsProductId('{"mbProductId":"   "}', quiet), null, "blank ignored");
  assert.equal(quiet.lines.length, 0, "no warns for absent/no-key hints");

  // Malformed JSON warns (rows can predate dashboard validation) but never throws.
  const noisy = makeSpy();
  assert.equal(parseHintsProductId("{not json", noisy), null);
  assert.equal(noisy.lines.length, 1, "malformed hints should warn exactly once");
});

// ---------------------------------------------------------------------------
// selectFeedPrice
// ---------------------------------------------------------------------------

test("selectFeedPrice accepts finite positive prices only", async () => {
  const { selectFeedPrice } = await import(feedModuleUrl);

  assert.equal(selectFeedPrice({ price: "38.42" }), 38.42, "string prices coerce");
  assert.equal(selectFeedPrice({ price: 412.77 }), 412.77);
  for (const bad of [{ price: 0 }, { price: -3 }, { price: "N/A" }, { price: null }, {}]) {
    assert.equal(selectFeedPrice(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

// ---------------------------------------------------------------------------
// lookupMintbuilderProduct — matching
// ---------------------------------------------------------------------------

test("lookup matches a stored URL to a feed product across normalization drift", async () => {
  const feed = await loadFeed();
  const fetchImpl = makeFetch(okResponse(feedPayload(PRODUCTS)));

  const result = await feed.lookupMintbuilderProduct({
    // Stored row URL differs from the feed link by case, www, slash, and query.
    url: "https://WWW.mintbuilder.com/Products/1oz-Silver-Buffalo-Round/?utm_source=stak",
    hints: null,
    apiKey: "test-key",
    fetchImpl,
  });

  assert.deepEqual(result, {
    status: "hit",
    product: {
      productId: "101",
      price: 38.42,
      link: "https://mintbuilder.com/products/1oz-silver-buffalo-round",
      title: "1 oz Silver Buffalo Round",
    },
  });
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(
    fetchImpl.calls[0].url.includes("mintbuilder=all"),
    "feed request should ask for the full catalog"
  );
});

test("lookup matches www-carrying feed links from a bare stored URL", async () => {
  const feed = await loadFeed();
  const fetchImpl = makeFetch(okResponse(feedPayload(PRODUCTS)));

  const result = await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/tenth-oz-gold-eagle",
    apiKey: "test-key",
    fetchImpl,
  });

  assert.equal(result.status, "hit");
  assert.equal(result.product.productId, "202");
  assert.equal(result.product.price, 412.77);
});

test("a hints mbProductId pin beats URL matching", async () => {
  const feed = await loadFeed();
  const fetchImpl = makeFetch(okResponse(feedPayload(PRODUCTS)));

  const result = await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/1oz-silver-buffalo-round", // would match 101
    hints: '{"mbProductId":"202"}',
    apiKey: "test-key",
    fetchImpl,
  });

  assert.equal(result.status, "hit");
  assert.equal(result.product.productId, "202", "the pinned id must win over the URL match");
});

test("lookup misses cleanly when the product is not in the feed", async () => {
  const feed = await loadFeed();
  const fetchImpl = makeFetch(okResponse(feedPayload(PRODUCTS)));

  const result = await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/discontinued-item",
    apiKey: "test-key",
    fetchImpl,
  });

  assert.deepEqual(result, { status: "miss", reason: "not_in_feed" });
});

test("lookup reports invalid_price when the matched product price is unusable", async () => {
  const feed = await loadFeed();
  const fetchImpl = makeFetch(okResponse(feedPayload(PRODUCTS)));

  const result = await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/broken",
    apiKey: "test-key",
    fetchImpl,
  });

  assert.deepEqual(result, { status: "miss", reason: "invalid_price" });
});

// ---------------------------------------------------------------------------
// lookupMintbuilderProduct — availability + retry policy
// ---------------------------------------------------------------------------

test("missing key short-circuits without fetching and warns once per process", async () => {
  const feed = await loadFeed();
  const fetchImpl = makeFetch(okResponse(feedPayload(PRODUCTS)));
  const warn = makeSpy();

  const first = await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/1oz-silver-buffalo-round",
    apiKey: "",
    fetchImpl,
    warn,
  });
  const second = await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/tenth-oz-gold-eagle",
    apiKey: "",
    fetchImpl,
    warn,
  });

  assert.deepEqual(first, { status: "unavailable", reason: "no_key" });
  assert.deepEqual(second, { status: "unavailable", reason: "no_key" });
  assert.equal(fetchImpl.calls.length, 0, "no key must mean no network traffic");
  assert.equal(warn.lines.length, 1, "the missing-key warn must fire once, not per target");
  assert.match(warn.lines[0], /MB_API_KEY/);
});

test("HTTP 401 reports bad_key without retrying", async () => {
  const feed = await loadFeed();
  const fetchImpl = makeFetch(errResponse(401));
  const warn = makeSpy();

  const result = await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/1oz-silver-buffalo-round",
    apiKey: "revoked-key",
    fetchImpl,
    warn,
  });

  assert.deepEqual(result, { status: "unavailable", reason: "bad_key" });
  assert.equal(fetchImpl.calls.length, 1, "401 is not transient — never retry it");
});

test("HTTP 5xx retries once then reports fetch_failed", async () => {
  const feed = await loadFeed();
  const fetchImpl = makeFetch(errResponse(503), errResponse(503));

  const result = await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/1oz-silver-buffalo-round",
    apiKey: "test-key",
    fetchImpl,
    warn: makeSpy(),
    retryDelayMs: 0,
  });

  assert.deepEqual(result, { status: "unavailable", reason: "fetch_failed" });
  assert.equal(fetchImpl.calls.length, 2, "one retry, no more");
});

test("network errors retry once then report fetch_failed", async () => {
  const feed = await loadFeed();
  const fetchImpl = makeFetch(new Error("ECONNRESET"), new Error("ECONNRESET"));

  const result = await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/1oz-silver-buffalo-round",
    apiKey: "test-key",
    fetchImpl,
    warn: makeSpy(),
    retryDelayMs: 0,
  });

  assert.deepEqual(result, { status: "unavailable", reason: "fetch_failed" });
  assert.equal(fetchImpl.calls.length, 2);
});

test("a payload without data.products reports bad_payload without retrying", async () => {
  const feed = await loadFeed();
  const fetchImpl = makeFetch(okResponse({ hello: "world" }));

  const result = await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/1oz-silver-buffalo-round",
    apiKey: "test-key",
    fetchImpl,
    warn: makeSpy(),
  });

  assert.deepEqual(result, { status: "unavailable", reason: "bad_payload" });
  assert.equal(fetchImpl.calls.length, 1, "a well-formed non-feed response is not transient");
});

// ---------------------------------------------------------------------------
// Memoization
// ---------------------------------------------------------------------------

test("the feed is fetched once per process across many lookups", async () => {
  const feed = await loadFeed();
  const fetchImpl = makeFetch(okResponse(feedPayload(PRODUCTS)));

  for (const url of [
    "https://mintbuilder.com/products/1oz-silver-buffalo-round",
    "https://mintbuilder.com/products/tenth-oz-gold-eagle",
    "https://mintbuilder.com/products/not-in-feed",
  ]) {
    await feed.lookupMintbuilderProduct({ url, apiKey: "test-key", fetchImpl });
  }

  assert.equal(fetchImpl.calls.length, 1, "the poll loop must cost one feed GET per run");

  feed._resetFeedCacheForTests();
  await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/1oz-silver-buffalo-round",
    apiKey: "test-key",
    fetchImpl,
  });
  assert.equal(fetchImpl.calls.length, 2, "reset must allow a fresh fetch");
});

test("a failed fetch is cached — later targets fall back without re-fetching", async () => {
  const feed = await loadFeed();
  const fetchImpl = makeFetch(errResponse(503), errResponse(503));

  const first = await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/1oz-silver-buffalo-round",
    apiKey: "test-key",
    fetchImpl,
    warn: makeSpy(),
    retryDelayMs: 0,
  });
  const second = await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/tenth-oz-gold-eagle",
    apiKey: "test-key",
    fetchImpl,
    warn: makeSpy(),
    retryDelayMs: 0,
  });

  assert.equal(first.status, "unavailable");
  assert.deepEqual(second, first, "the cached failure must be reused");
  assert.equal(fetchImpl.calls.length, 2, "attempt + one retry — nothing more for the whole run");
});

test("a changed API key invalidates the memoized feed", async () => {
  const feed = await loadFeed();
  const fetchImpl = makeFetch(okResponse(feedPayload(PRODUCTS)));

  await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/1oz-silver-buffalo-round",
    apiKey: "key-a",
    fetchImpl,
  });
  await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/1oz-silver-buffalo-round",
    apiKey: "key-b",
    fetchImpl,
  });

  assert.equal(fetchImpl.calls.length, 2, "key rotation must not serve the stale index");
});

// ---------------------------------------------------------------------------
// Key hygiene
// ---------------------------------------------------------------------------

test("the API key never appears in log or warn output", async () => {
  const feed = await loadFeed();
  const secret = "sekret-key-do-not-log";
  const log = makeSpy();
  const warn = makeSpy();

  // Happy path, then a 401 path — the two chattiest branches.
  await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/1oz-silver-buffalo-round",
    apiKey: secret,
    fetchImpl: makeFetch(okResponse(feedPayload(PRODUCTS))),
    log,
    warn,
  });
  feed._resetFeedCacheForTests();
  await feed.lookupMintbuilderProduct({
    url: "https://mintbuilder.com/products/1oz-silver-buffalo-round",
    apiKey: secret,
    fetchImpl: makeFetch(errResponse(401)),
    log,
    warn,
  });

  for (const line of [...log.lines, ...warn.lines]) {
    assert.ok(!line.includes(secret), `output leaked the API key: ${line}`);
  }
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

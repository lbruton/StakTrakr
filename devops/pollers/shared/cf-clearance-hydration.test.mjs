#!/usr/bin/env node
/**
 * Contract tests for the Byparr loaded-page check in cf-clearance.js.
 *
 * Run with:
 *   node --test devops/pollers/shared/cf-clearance-hydration.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.CF_CLEARANCE_ENABLED = "1";
process.env.CF_CLEARANCE_RETRY_DELAY_MS = "0";
delete process.env.CF_CLEARANCE_MAX_ATTEMPTS;
delete process.env.CF_CLEARANCE_BUDGET_MS;

const importModule = () => import(new URL("./cf-clearance.js", import.meta.url));

const BE_URL = "https://bullionexchanges.com/2026-1-oz-gold-american-eagle-50-coin-bu";

// The Bullion Exchanges metals ticker: a price and a daily change per metal (8 tokens).
const BE_TICKER =
  "<div>GOLD <span>$4,141.60</span> <span>$25.10</span></div>" +
  "<div>SILVER <span>$53.65</span> <span>$0.63</span></div>" +
  "<div>PLATINUM <span>$1,580.10</span> <span>$13.40</span></div>" +
  "<div>PALLADIUM <span>$1,057.00</span> <span>$10.50</span></div>";

const BE_TIER_TABLE =
  '<div class="grid-JMDT head-NOGO"><div>Quantity</div>' +
  '<div class="icons-Lyy2">(E)check/Wire</div><div>Crypto</div><div>Card/PayPal</div></div>' +
  '<div class="grid-JMDT body-Pez9"><div>1-4</div><div>$4,346.03</div>' +
  "<div>$4,389.93</div><div>$4,519.87</div></div>";

const BE_UNLOADED = `<html><body>${BE_TICKER}<h1>2026 1 oz Gold American Eagle</h1></body></html>`;
const BE_LOADED = `<html><body>${BE_TICKER}<h1>2026 1 oz Gold American Eagle</h1>${BE_TIER_TABLE}</body></html>`;

// The poller's own request timeout, as fetch reports it.
const ABORTED = new DOMException("This operation was aborted", "AbortError");

/**
 * Replace global fetch with a Byparr stub that answers each call with the next page.
 * An Error entry is thrown instead of answered. Request bodies land in `bodies`.
 * @param {Array<string|Error>} pages - Response HTML or error per call, in order.
 * @param {() => void} [onCall] - Runs on every call, before the answer.
 * @returns {{ calls: number, bodies: object[], restore: () => void }}
 */
function stubByparr(pages, onCall = () => {}) {
  const original = globalThis.fetch;
  const state = { calls: 0, bodies: [], restore: () => (globalThis.fetch = original) };
  globalThis.fetch = async (_url, init) => {
    const html = pages[Math.min(state.calls, pages.length - 1)];
    state.calls++;
    state.bodies.push(JSON.parse(init.body));
    onCall();
    if (html instanceof Error) throw html;
    return new Response(
      JSON.stringify({
        status: "ok",
        solution: { cookies: [], userAgent: "test-agent", response: html },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  return state;
}

test("a Bullion Exchanges page with only the metals ticker is not usable", async () => {
  const { isUsableByparrHtml } = await importModule();
  assert.equal(isUsableByparrHtml(BE_URL, BE_UNLOADED), false);
});

test("a Bullion Exchanges page with the tier table is usable", async () => {
  const { isUsableByparrHtml } = await importModule();
  assert.equal(isUsableByparrHtml(BE_URL, BE_LOADED), true);
  assert.equal(isUsableByparrHtml("https://www.bullionexchanges.com/x", BE_LOADED), true);
});

test("other hosts keep the dollar-count rule", async () => {
  const { isUsableByparrHtml } = await importModule();
  assert.equal(isUsableByparrHtml("https://example-dealer.com/coin", BE_UNLOADED), true);
  assert.equal(isUsableByparrHtml("https://example-dealer.com/coin", "<p>$1.00</p>"), false);
});

test("getCFClearanceCookie retries a ticker-only Bullion Exchanges page", async () => {
  const { getCFClearanceCookie } = await importModule();
  const stub = stubByparr([BE_UNLOADED, BE_LOADED]);
  try {
    const result = await getCFClearanceCookie(BE_URL);
    assert.equal(stub.calls, 2);
    assert.ok(result.responseHtml.includes("$4,346.03"));
  } finally {
    stub.restore();
  }
});

const BE_OOS_JSONLD =
  '<script type="application/ld+json">' +
  '{"@context":"https://schema.org","@type":"Product","name":"2026 1 oz Gold American Eagle",' +
  '"offers":{"@type":"Offer","availability":"https://schema.org/OutOfStock"}}</script>';
const BE_OOS = `<html><head>${BE_OOS_JSONLD}</head><body>${BE_TICKER}<h1>2026 1 oz Gold American Eagle</h1></body></html>`;

test("a Bullion Exchanges page marked out of stock in JSON-LD is usable without the tier table", async () => {
  const { isUsableByparrHtml } = await importModule();
  assert.equal(isUsableByparrHtml(BE_URL, BE_OOS), true);
});

test("getCFClearanceCookie accepts an out-of-stock Bullion Exchanges page on the first attempt", async () => {
  const { getCFClearanceCookie } = await importModule();
  const stub = stubByparr([BE_OOS, BE_LOADED]);
  try {
    const result = await getCFClearanceCookie(BE_URL);
    assert.equal(stub.calls, 1);
    assert.ok(result.responseHtml.includes("OutOfStock"));
  } finally {
    stub.restore();
  }
});

test("the Byparr request carries max_timeout in whole seconds", async () => {
  const { getCFClearanceCookie } = await importModule();
  const stub = stubByparr([BE_LOADED]);
  try {
    await getCFClearanceCookie(BE_URL);
    const body = stub.bodies[0];
    assert.ok(Number.isInteger(body.max_timeout) && body.max_timeout > 0);
    assert.equal(body.max_timeout, Math.ceil(body.maxTimeout / 1000));
  } finally {
    stub.restore();
  }
});

test("getCFClearanceCookie retries an attempt the poller timeout aborted", async () => {
  const { getCFClearanceCookie } = await importModule();
  const stub = stubByparr([ABORTED, BE_LOADED]);
  try {
    const result = await getCFClearanceCookie(BE_URL);
    assert.equal(stub.calls, 2);
    assert.ok(result.responseHtml.includes("$4,346.03"));
  } finally {
    stub.restore();
  }
});

test("getCFClearanceCookie retries an attempt that Byparr timed out", async () => {
  const { getCFClearanceCookie } = await importModule();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return new Response('{"detail":"Timed out while solving the challenge"}', { status: 408 });
    }
    return new Response(
      JSON.stringify({
        status: "ok",
        solution: { cookies: [], userAgent: "ua", response: BE_LOADED },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  try {
    const result = await getCFClearanceCookie(BE_URL);
    assert.equal(calls, 2);
    assert.ok(result.responseHtml.includes("$4,346.03"));
  } finally {
    globalThis.fetch = original;
  }
});

test("getCFClearanceCookie does not retry an error that only names a timeout URL", async () => {
  const { getCFClearanceCookie } = await importModule();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      '{"detail":"page.goto: net::ERR_NAME_NOT_RESOLVED at https://x.test/timeout-page"}',
      { status: 502 }
    );
  };
  try {
    assert.equal(await getCFClearanceCookie(BE_URL), null);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("getCFClearanceCookie returns null after one Byparr HTTP error", async () => {
  const { getCFClearanceCookie } = await importModule();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("boom", { status: 500 });
  };
  try {
    assert.equal(await getCFClearanceCookie(BE_URL), null);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("getCFClearanceCookie makes six attempts by default", async () => {
  const { getCFClearanceCookie } = await importModule();
  const stub = stubByparr([BE_UNLOADED]);
  try {
    await getCFClearanceCookie(BE_URL);
    assert.equal(stub.calls, 6);
  } finally {
    stub.restore();
  }
});

test("getCFClearanceCookie starts no attempt after the time budget is spent", async () => {
  const { getCFClearanceCookie } = await importModule();
  let clock = 0;
  const stub = stubByparr([BE_UNLOADED], () => (clock += 25000));
  try {
    await getCFClearanceCookie(BE_URL, { budgetMs: 60000, now: () => clock });
    assert.equal(stub.calls, 3);
  } finally {
    stub.restore();
  }
});

test("getCFClearanceCookie accepts a loaded Bullion Exchanges page on the first attempt", async () => {
  const { getCFClearanceCookie } = await importModule();
  const stub = stubByparr([BE_LOADED]);
  try {
    const result = await getCFClearanceCookie(BE_URL);
    assert.equal(stub.calls, 1);
    assert.ok(result.responseHtml.includes("(E)check/Wire"));
  } finally {
    stub.restore();
  }
});

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
process.env.CF_CLEARANCE_MAX_ATTEMPTS = "3";

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

/**
 * Replace global fetch with a Byparr stub that answers each call with the next page.
 * @param {string[]} pages - Response HTML per call, in order.
 * @returns {{ calls: number, restore: () => void }}
 */
function stubByparr(pages) {
  const original = globalThis.fetch;
  const state = { calls: 0, restore: () => (globalThis.fetch = original) };
  globalThis.fetch = async () => {
    const html = pages[Math.min(state.calls, pages.length - 1)];
    state.calls++;
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

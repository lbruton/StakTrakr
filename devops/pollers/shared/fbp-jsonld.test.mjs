#!/usr/bin/env node
/**
 * TDD contract tests for the FBP JSON-LD parse helper (STRK-334, design C1).
 *
 * RED phase: `./fbp-jsonld.js` does not exist yet — each test dynamically
 * imports it so a missing module fails that test in isolation rather than
 * aborting the whole file at parse time (mirrors price-extract-vendors.test.mjs).
 *
 * Run with:
 *   node --test devops/pollers/shared/fbp-jsonld.test.mjs
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

const importModule = () => import(new URL("./fbp-jsonld.js", import.meta.url));

test("parseFbpItemList extracts the JM Bullion offer with numeric price + USD currency", async () => {
  const { parseFbpItemList } = await importModule();
  const offers = parseFbpItemList(FIXTURE_HTML);

  assert.ok(Array.isArray(offers), "parseFbpItemList must return an array");
  assert.ok(offers.length >= 2, "the ASE ItemList carries multiple vendor offers");

  const jm = offers.find((offer) => offer.seller === "JM Bullion");
  assert.ok(jm, "the JM Bullion offer must be present in the parsed offers");
  assert.equal(typeof jm.price, "number", "price must be coerced to a number");
  assert.equal(jm.price, 82.95, "JM price must match the captured FBP fixture value");
  assert.equal(jm.currency, "USD");
});

test("parseFbpItemList returns [] for malformed / missing-ItemList HTML without throwing", async () => {
  const { parseFbpItemList } = await importModule();

  assert.deepEqual(parseFbpItemList("<html><body>no json-ld here</body></html>"), []);
  assert.deepEqual(
    parseFbpItemList(
      '<script type="application/ld+json">{ this is : not valid json }</script>'
    ),
    [],
    "a malformed ld+json block must be swallowed per-block, not thrown"
  );
  assert.deepEqual(parseFbpItemList(""), []);
});

test("findVendorOffer returns the JM offer, and null when the seller is absent", async () => {
  const { parseFbpItemList, findVendorOffer } = await importModule();

  const offers = parseFbpItemList(FIXTURE_HTML);
  const jm = findVendorOffer(offers, "JM Bullion");
  assert.ok(jm, "findVendorOffer must locate the JM Bullion offer");
  assert.equal(jm.price, 82.95);
  assert.equal(jm.currency, "USD");

  const noJmOffers = parseFbpItemList(NO_JM_HTML);
  assert.equal(
    findVendorOffer(noJmOffers, "JM Bullion"),
    null,
    "findVendorOffer must return null when the seller is not listed"
  );
});

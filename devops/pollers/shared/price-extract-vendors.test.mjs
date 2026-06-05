#!/usr/bin/env node
/**
 * TDD Vendor registry contract tests for STRK-32.
 *
 * Run with:
 *   node devops/pollers/shared/price-extract-vendors.test.mjs
 */

import assert from "node:assert/strict";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const migratedVendorIds = ["goldback", "apmex"];
const notYetMigratedVendorIds = ["jmbullion"];

const unwrapVendor = (candidate) => candidate?.vendor ?? candidate?.default ?? candidate;

const assertStandardVendorModule = (candidate, expectedId) => {
  const vendor = unwrapVendor(candidate);
  assert.equal(typeof vendor, "object", `${expectedId} Vendor module should be an object`);
  assert.equal(vendor.id, expectedId, `${expectedId} Vendor id should match registry id`);
  assert.equal(typeof vendor.config, "object", `${expectedId} Vendor should expose config`);
  assert.equal(typeof vendor.scrape, "function", `${expectedId} Vendor should expose scrape(context)`);
};

test("registry exports migrated ids and dispatcher functions", async () => {
  const registry = await import(new URL("./price-extract-vendors.js", import.meta.url));

  assert.equal(typeof registry.getVendorModule, "function");
  assert.equal(typeof registry.scrapeVendor, "function");
  assert.ok(Array.isArray(registry.MIGRATED_VENDOR_IDS));

  for (const vendorId of migratedVendorIds) {
    assert.ok(
      registry.MIGRATED_VENDOR_IDS.includes(vendorId),
      `${vendorId} should be listed in MIGRATED_VENDOR_IDS`
    );
  }
});

test("Goldback module exists and uses the standard interface", async () => {
  const goldbackModule = await import(new URL("./price-extract-vendor-goldback.js", import.meta.url));

  assertStandardVendorModule(goldbackModule, "goldback");
  assert.equal(goldbackModule.default, goldbackModule.vendor);
});

test("APMEX module exists and preserves Firecrawl-preferred config", async () => {
  const apmexModule = await import(new URL("./price-extract-vendor-apmex.js", import.meta.url));
  const apmex = unwrapVendor(apmexModule);

  assertStandardVendorModule(apmexModule, "apmex");
  assert.equal(apmexModule.default, apmexModule.vendor);
  assert.equal(apmex.config.phase, "firecrawl");
  assert.equal(apmex.config.waitFor, 8000);
  assert.equal(
    apmex.config.timeout,
    55_000,
    "APMEX timeout should match the current FIRECRAWL_TIMEOUT_MS value"
  );
});

test("Goldback module owns the Goldback table-parse Phase 0 bypass predicate", async () => {
  const goldbackModule = await import(new URL("./price-extract-vendor-goldback.js", import.meta.url));
  const tableParseProviderIds = new Set(["monumentmetals"]);

  assert.equal(typeof goldbackModule.isGoldbackCoinSlug, "function");
  assert.equal(typeof goldbackModule.shouldBypassFirecrawlPreferredForPhase0, "function");
  assert.equal(goldbackModule.isGoldbackCoinSlug("goldback-utah-g1"), true);
  assert.equal(goldbackModule.isGoldbackCoinSlug("american-eagle-silver-1oz"), false);
  assert.equal(
    goldbackModule.shouldBypassFirecrawlPreferredForPhase0({
      coinSlug: "goldback-utah-g1",
      providerId: "monumentmetals",
      tableParseProviderIds,
    }),
    true
  );
  assert.equal(
    goldbackModule.shouldBypassFirecrawlPreferredForPhase0({
      coinSlug: "goldback-utah-g1",
      providerId: "jmbullion",
      tableParseProviderIds,
    }),
    false
  );
  assert.equal(
    goldbackModule.shouldBypassFirecrawlPreferredForPhase0({
      coinSlug: "american-eagle-silver-1oz",
      providerId: "monumentmetals",
      tableParseProviderIds,
    }),
    false
  );
});

test("registry returns migrated modules for completed Vendor migrations", async () => {
  const registry = await import(new URL("./price-extract-vendors.js", import.meta.url));

  for (const vendorId of migratedVendorIds) {
    const vendor = registry.getVendorModule(vendorId);
    assertStandardVendorModule(vendor, vendorId);
  }
});

test("registry returns the legacy adapter for not-yet-migrated Vendors", async () => {
  const registry = await import(new URL("./price-extract-vendors.js", import.meta.url));
  const legacyModule = await import(new URL("./price-extract-vendor-legacy.js", import.meta.url));
  const legacyVendor = unwrapVendor(legacyModule);

  for (const vendorId of notYetMigratedVendorIds) {
    assert.equal(registry.getVendorModule(vendorId), legacyVendor);
  }
  assert.equal(typeof legacyVendor.scrape, "function");
});

test("scrapeVendor dispatches through the selected module interface", async () => {
  const registry = await import(new URL("./price-extract-vendors.js", import.meta.url));
  const result = await registry.scrapeVendor({
    provider: { id: "goldback" },
    coinSlug: "goldback-utah-g1",
    url: "https://example.test/goldback",
    scrapeGeneric: async () => ({
      price: 10.25,
      inStock: true,
      source: "test-double",
      ok: true,
      error: null,
      url: "https://example.test/goldback",
    }),
  });

  assert.deepEqual(result, {
    price: 10.25,
    inStock: true,
    source: "test-double",
    ok: true,
    error: null,
    url: "https://example.test/goldback",
  });
});

test("scrapeVendor dispatches APMEX with module-owned Firecrawl config", async () => {
  const registry = await import(new URL("./price-extract-vendors.js", import.meta.url));
  let observedConfig = null;
  const result = await registry.scrapeVendor({
    provider: { id: "apmex" },
    coinSlug: "american-eagle-silver-1oz",
    url: "https://example.test/apmex",
    scrapeGeneric: async (context) => {
      observedConfig = context.config;
      return {
        price: 77.82,
        inStock: true,
        source: "test-double",
        ok: true,
        error: null,
        url: "https://example.test/apmex",
      };
    },
  });

  assert.deepEqual(
    {
      phase: observedConfig?.phase,
      waitFor: observedConfig?.waitFor,
      timeout: observedConfig?.timeout,
    },
    { phase: "firecrawl", waitFor: 8000, timeout: 55_000 }
  );
  assert.deepEqual(result, {
    price: 77.82,
    inStock: true,
    source: "test-double",
    ok: true,
    error: null,
    url: "https://example.test/apmex",
  });
});

test("APMEX config preserves Firecrawl-preferred retry eligibility after migration", async () => {
  const registry = await import(new URL("./price-extract-vendors.js", import.meta.url));
  const apmex = registry.getVendorModule("apmex");
  const legacyPreferred = new Set(["monumentmetals", "herobullion", "gainesvillecoins"]);
  const retryEligible = apmex.config.phase === "firecrawl" || legacyPreferred.has(apmex.id);

  assert.equal(
    legacyPreferred.has("apmex"),
    false,
    "APMEX should not rely on legacy preferred-provider membership after migration"
  );
  assert.equal(retryEligible, true);
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

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

const migratedVendorIds = ["goldback", "apmex", "summitmetals", "mintbuilder"];
const notYetMigratedVendorIds = ["jmbullion"];

const unwrapVendor = (candidate) => candidate?.vendor ?? candidate?.default ?? candidate;

const assertStandardVendorModule = (candidate, expectedId) => {
  const vendor = unwrapVendor(candidate);
  assert.equal(typeof vendor, "object", `${expectedId} Vendor module should be an object`);
  assert.equal(vendor.id, expectedId, `${expectedId} Vendor id should match registry id`);
  assert.equal(typeof vendor.config, "object", `${expectedId} Vendor should expose config`);
  assert.equal(
    typeof vendor.scrape,
    "function",
    `${expectedId} Vendor should expose scrape(context)`
  );
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
  const goldbackModule = await import(
    new URL("./price-extract-vendor-goldback.js", import.meta.url)
  );

  assertStandardVendorModule(goldbackModule, "goldback");
  assert.equal(goldbackModule.default, goldbackModule.vendor);
});

test("Summit module owns the full Vendor interface (cutoff + strategy)", async () => {
  const summitModule = await import(new URL("./price-extract-vendor-summit.js", import.meta.url));
  const summit = unwrapVendor(summitModule);

  assertStandardVendorModule(summitModule, "summitmetals");
  assert.equal(summitModule.default, summitModule.vendor);

  // Per-vendor markdown shaping + flags live on the module, not in shared.js.
  assert.ok(
    Array.isArray(summit.cutoffPatterns) && summit.cutoffPatterns.length > 0,
    "summit cutoffPatterns missing"
  );
  assert.equal(summit.headerSkipPattern, null);
  assert.equal(summit.preorderTolerant, false);
  // Summit's JSON-LD offer.price is the 100+ bulk tier, so it must be untrusted —
  // otherwise the poller's authoritative JSON-LD path short-circuits to the bulk price.
  assert.equal(summit.untrustedOfferPrice, true);
  assert.equal(summit.usesAsLowAs, false);
  assert.equal(typeof summit.extractPrice, "function");

  // Strategy (tested in isolation via fake helpers): qty-tier first, bulk cards last.
  assert.deepEqual(
    summit.extractPrice({
      firstTableRowFirstPrice: () => 79.22,
      tierAnchoredPrice: () => 78.83,
      regularPricePrices: () => [77.78],
    }),
    { price: 79.22, matchedBy: "tableFirstRow" }
  );
  assert.deepEqual(
    summit.extractPrice({
      firstTableRowFirstPrice: () => null,
      tierAnchoredPrice: () => 79.22,
      regularPricePrices: () => [77.78],
    }),
    { price: 79.22, matchedBy: "tierAnchored" }
  );
  assert.deepEqual(
    summit.extractPrice({
      firstTableRowFirstPrice: () => null,
      tierAnchoredPrice: () => null,
      regularPricePrices: () => [77.78, 79.22],
    }),
    { price: 77.78, matchedBy: "regularPrice" }
  );
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
  const goldbackModule = await import(
    new URL("./price-extract-vendor-goldback.js", import.meta.url)
  );
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

test("MintBuilder module exists and uses the standard interface (STRK-311)", async () => {
  const mintbuilderModule = await import(
    new URL("./price-extract-vendor-mintbuilder.js", import.meta.url)
  );
  const mintbuilder = unwrapVendor(mintbuilderModule);

  assertStandardVendorModule(mintbuilderModule, "mintbuilder");
  assert.equal(mintbuilderModule.default, mintbuilderModule.vendor);

  // MintBuilder serves clean schema.org Product/Offer JSON-LD (price + availability)
  // on every real product page with no bot-challenge — same "trust JSON-LD, no
  // markdown quirks" shape as Goldback, so it needs no cutoff/OOS/strategy overrides.
  assert.deepEqual(mintbuilder.cutoffPatterns, []);
  assert.equal(mintbuilder.headerSkipPattern, null);
  assert.equal(mintbuilder.preorderTolerant, false);
  assert.equal(mintbuilder.untrustedOfferPrice, false);
  assert.equal(mintbuilder.usesAsLowAs, false);

  // Plain SSR HTML (JSON-LD present in the raw response, no JS render needed) —
  // domcontentloaded is sufficient, no need to wait for networkidle.
  assert.equal(mintbuilder.config.waitUntil, "domcontentloaded");
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

// ---------------------------------------------------------------------------
// STRK-314 — config resolution on the vendor-registry path
//
// Before STRK-314, scrapeGenericTarget resolved
//   providerCfg(id, context.vendorModule?.config ?? context.config)
// and every vendor module's `config` is a truthy object (including the legacy
// adapter's `{}`), so `??` never fell through and context.config was discarded
// on every registry-routed scrape. scrapeVendor now owns a single merge —
// provider defaults + legacy overrides, then module-owned config, then
// caller-EXPLICIT overrides last.
// ---------------------------------------------------------------------------

/** Dispatch through scrapeVendor and capture the config scrapeGeneric receives. */
const resolveConfigVia = async (registry, providerId, callerConfig) => {
  let observed = null;
  const context = {
    provider: { id: providerId },
    coinSlug: "american-eagle-silver-1oz",
    url: "https://example.test/target",
    scrapeGeneric: async (ctx) => {
      observed = ctx.config;
      return { price: 1, inStock: true, source: "test-double", ok: true, error: null, url: "" };
    },
  };
  if (callerConfig !== undefined) context.config = callerConfig;
  await registry.scrapeVendor(context);
  return observed;
};

test("STRK-314: resolveVendorConfig layers defaults, module config, then caller config", async () => {
  const registry = await import(new URL("./price-extract-vendors.js", import.meta.url));
  const { PROVIDER_DEFAULTS } = await import(
    new URL("./price-extract-provider-config.js", import.meta.url)
  );

  assert.equal(typeof registry.resolveVendorConfig, "function");

  // Tested directly rather than only through a scrapeGeneric double: the
  // pre-STRK-314 test doubles intercepted at the vendor-module boundary, which
  // sits UPSTREAM of the discard, so the defect was invisible to them.
  const module = { config: { waitFor: 111, waitUntil: "domcontentloaded" } };
  const resolved = registry.resolveVendorConfig("not-a-real-vendor", module, { waitFor: 222 });

  assert.equal(resolved.waitFor, 222, "caller-explicit config must win");
  assert.equal(resolved.waitUntil, "domcontentloaded", "module config must survive");
  assert.equal(resolved.phase, PROVIDER_DEFAULTS.phase, "provider defaults must fill the rest");

  // An absent caller config must not blank out the module layer.
  assert.equal(registry.resolveVendorConfig("not-a-real-vendor", module).waitFor, 111);
  assert.equal(registry.resolveVendorConfig("not-a-real-vendor", null).waitFor, 0);
});

test("STRK-314: resolveVendorConfig is idempotent on an already-resolved config", async () => {
  const registry = await import(new URL("./price-extract-vendors.js", import.meta.url));

  // scrapeGenericTarget re-runs the resolution on a context config that
  // scrapeVendor already merged. That second pass must be a no-op, or the
  // registry and the scrape would disagree about the effective config.
  for (const providerId of [...migratedVendorIds, "bullionexchanges", "jmbullion"]) {
    const module = registry.getVendorModule(providerId);
    const once = registry.resolveVendorConfig(providerId, module, { waitAfter: 31 });
    const twice = registry.resolveVendorConfig(providerId, module, once);
    assert.deepEqual(twice, once, `${providerId} resolution is not idempotent`);
  }
});

test("STRK-314: caller-explicit override reaches the resolved config on the registry path", async () => {
  const registry = await import(new URL("./price-extract-vendors.js", import.meta.url));
  const resolved = await resolveConfigVia(registry, "mintbuilder", { waitAfter: 4321 });

  assert.equal(resolved.waitAfter, 4321, "caller-explicit waitAfter must reach the scrape");
  assert.equal(
    resolved.waitUntil,
    "domcontentloaded",
    "MintBuilder's module-owned waitUntil must survive a partial caller override"
  );
});

test("STRK-314: caller override wins over a colliding module-owned key", async () => {
  const registry = await import(new URL("./price-extract-vendors.js", import.meta.url));
  const resolved = await resolveConfigVia(registry, "apmex", { waitFor: 999 });

  assert.equal(resolved.waitFor, 999, "caller-explicit value must beat the module value");
  assert.equal(resolved.phase, "firecrawl", "untouched module keys must still survive");
});

test("STRK-314: module-owned config survives when the caller supplies none", async () => {
  const registry = await import(new URL("./price-extract-vendors.js", import.meta.url));

  const apmex = await resolveConfigVia(registry, "apmex", undefined);
  assert.equal(apmex.phase, "firecrawl", "APMEX phase must not regress to the phase0 default");
  assert.equal(apmex.waitFor, 8000);
  assert.equal(apmex.timeout, 55_000);

  const mintbuilder = await resolveConfigVia(registry, "mintbuilder", undefined);
  assert.equal(
    mintbuilder.waitUntil,
    "domcontentloaded",
    "MintBuilder waitUntil must not regress to the networkidle default (STRK-311 phase0 fix)"
  );
});

test("STRK-314: no-caller-config resolution is unchanged from the pre-fix chain", async () => {
  const registry = await import(new URL("./price-extract-vendors.js", import.meta.url));
  const { providerCfg } = await import(
    new URL("./price-extract-provider-config.js", import.meta.url)
  );

  // The production poll loop passes no explicit override, so every vendor —
  // migrated or legacy — must resolve exactly as it did before STRK-314.
  for (const providerId of [...migratedVendorIds, "jmbullion", "sdbullion", "monumentmetals"]) {
    const vendor = registry.getVendorModule(providerId);
    const resolved = await resolveConfigVia(registry, providerId, undefined);
    assert.deepEqual(
      resolved,
      providerCfg(providerId, vendor.config),
      `${providerId} config resolution changed with no caller override`
    );
  }
});

test("STRK-314: legacy vendors accept caller overrides without losing legacy config", async () => {
  const registry = await import(new URL("./price-extract-vendors.js", import.meta.url));
  const resolved = await resolveConfigVia(registry, "gainesvillecoins", { waitAfter: 250 });

  assert.equal(resolved.waitAfter, 250, "caller override must reach a legacy-adapter vendor too");
  assert.equal(resolved.phase, "firecrawl", "legacy override map value must survive");
  assert.equal(resolved.waitFor, 3000);
});

test("STRK-314: caller proxy override deep-merges instead of replacing", async () => {
  const registry = await import(new URL("./price-extract-vendors.js", import.meta.url));
  const resolved = await resolveConfigVia(registry, "bullionexchanges", {
    proxy: { fly: "socks5://example.test" },
  });

  assert.equal(resolved.proxy.fly, "socks5://example.test", "caller proxy key must apply");
  assert.equal(resolved.proxy.home, null, "sibling proxy keys must not be dropped by the merge");
});

test("STRK-314: scrapeSingleVendor does not fabricate a caller config", async () => {
  const priceExtract = await import(new URL("./price-extract.js", import.meta.url));
  let observed = "UNSET";

  await priceExtract.scrapeSingleVendor({
    coinSlug: "american-eagle-silver-1oz",
    coin: { metal: "silver", weight_oz: 1 },
    provider: { id: "mintbuilder", url: "https://example.test/target" },
    scrapeVendor: async (ctx) => {
      observed = ctx.config;
      return { price: 1, inStock: true, source: "test-double", ok: true, error: null, url: "" };
    },
  });

  // A defaulted providerCfg(id) here is indistinguishable from an explicit
  // caller config downstream, which is what let the bare provider default
  // outrank module-owned config (STRK-311 phase0 regression shape).
  assert.equal(observed, undefined, "an absent caller config must stay absent");
});

test("STRK-314: scrapeSingleVendor forwards an explicit caller config verbatim", async () => {
  const priceExtract = await import(new URL("./price-extract.js", import.meta.url));
  let observed = null;

  await priceExtract.scrapeSingleVendor({
    coinSlug: "american-eagle-silver-1oz",
    coin: { metal: "silver", weight_oz: 1 },
    provider: { id: "mintbuilder", url: "https://example.test/target" },
    config: { waitAfter: 77 },
    scrapeVendor: async (ctx) => {
      observed = ctx.config;
      return { price: 1, inStock: true, source: "test-double", ok: true, error: null, url: "" };
    },
  });

  assert.deepEqual(observed, { waitAfter: 77 });
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

// Unit tests for STRK-264: providers.json must be network-first.
//
// The `providers` family was cache-first with a 24h floor while its siblings
// (spot-latest, goldback-latest, retail-latest) were networkFirst. Because
// classifiedFetch returns a cached hit without ever touching the network while
// the entry is inside its TTL, any change to provider_vendors could take up to
// 24h to reach a browser that already had a Service-Worker-cached copy — and a
// hard refresh does not clear it, only unregistering the SW does.
//
// Found 2026-07-24 onboarding STRK-261/262/263: the new coins' prices appeared
// correctly (served by the networkFirst retail-latest family) but clicking a
// price cell opened the vendor's homepage instead of the product page, because
// window.retailProviders was still built from a 24h-old providers.json. A fresh
// browser context resolved the links immediately, which localised the fault to
// the SW cache layer rather than the export pipeline.
//
// Note: `manifest` is NOT network-first (floor 1800, cache-first). The issue
// description groups it with retail-latest as though it were; only
// retail-latest carries the flag. Corrected here so this file does not
// propagate that.
//
// The durable case is vendor-URL rollover: when a yearly-dated coin's product
// page is superseded, the price feed updates at once while the URL behind it
// can lag a day — the UI then shows a current price under a stale link.
//
// Run: npm run test:unit

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { loadSwRouter } from "./helpers/load-sw-router.js";

const { classifyEndpoint, FAMILY_TABLE } = loadSwRouter();

const API1 = "https://api.staktrakr.com";
const API2 = "https://api2.staktrakr.com";
const SELF = "https://staktrakr.com";

describe("STRK-264 providers is network-first", () => {
  it("emits networkFirst:true on both API hosts", () => {
    for (const host of [API1, API2]) {
      const r = classifyEndpoint(`${host}/v2/providers.json`, SELF);
      assert.equal(r.family, "providers");
      assert.equal(r.networkFirst, true, `${host} must classify providers as network-first`);
    }
  });

  it("also applies to the production /data/v2 path shape", () => {
    // Production API endpoints are served under a /data prefix (STRK-190), so
    // the real request shape must get the same strategy as the bare one.
    const r = classifyEndpoint(`${API1}/data/v2/providers.json`, SELF);
    assert.equal(r.family, "providers");
    assert.equal(r.networkFirst, true);
  });

  it("leaves the TTL floor and envelope flag untouched", () => {
    // Only the strategy changes. floor is unused on the networkFirst path (it
    // skips matchWithAgeCheck entirely) but is left alone so the entry stays
    // consistent with its realtime siblings, which also keep their floors.
    const entry = FAMILY_TABLE.find((e) => e.family === "providers");
    assert.equal(entry.floor, 86400);
    assert.equal(entry.hasEnvelope, true);
  });

  it("matches the descriptor shape of the other realtime families", () => {
    const providers = classifyEndpoint(`${API1}/v2/providers.json`, SELF);
    const spotLatest = classifyEndpoint(`${API1}/v2/spot/latest.json`, SELF);
    assert.deepEqual(Object.keys(providers).sort(), Object.keys(spotLatest).sort());
  });

  it("does not make every family network-first", () => {
    // Guard against a blanket flag: the genuinely slow-moving families must
    // still be cache-first, or every page load pays a network round trip.
    for (const path of [
      "/v2/manifest.json",
      "/v2/retail/apmex/history-30d.json",
      "/v2/spot/xau/2026/05/15.json",
    ]) {
      const r = classifyEndpoint(`${API1}${path}`, SELF);
      assert.equal(
        Object.prototype.hasOwnProperty.call(r, "networkFirst"),
        false,
        `${path} must remain cache-first`
      );
    }
  });
});

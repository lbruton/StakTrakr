// Unit tests for sw-router.js using Node built-in test runner.
// Run: npm run test:unit  (node --test tests/unit/sw-router.test.js)
//
// sw-router.js is a plain script file (importScripts-compatible, no ESM syntax).
// We load it via new Function() with a synthetic CJS module context so the CJS
// export guard fires and exports FAMILY_TABLE / classifyEndpoint without requiring
// ESM refactoring of the production script.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const routerCode = readFileSync(new URL("../../sw-router.js", import.meta.url), "utf-8");
const _module = { exports: {} };
new Function("module", "exports", routerCode)(_module, _module.exports);
const { FAMILY_TABLE, classifyEndpoint, parseGeneratedAtSeconds } = _module.exports;

const API1 = "https://api.staktrakr.com";
const API2 = "https://api2.staktrakr.com";
const SELF = "https://staktrakr.com"; // mock selfOrigin for local-origin tests

function classifyOnBothHosts(path) {
  return {
    api1: classifyEndpoint(API1 + path, SELF),
    api2: classifyEndpoint(API2 + path, SELF),
  };
}

describe("FAMILY_TABLE", () => {
  it("has exactly 11 entries", () => {
    assert.equal(FAMILY_TABLE.length, 11);
  });

  it("contains all expected family names in order", () => {
    assert.deepEqual(
      FAMILY_TABLE.map((e) => e.family),
      [
        "manifest",
        "spot-latest",
        "spot-history-daily",
        "goldback-latest",
        "goldback-intraday",
        "retail-latest",
        "retail-intraday",
        "retail-history-short",
        "retail-history-long",
        "providers",
        "annual-spot-history",
      ]
    );
  });
});

describe("classifyEndpoint — manifest", () => {
  it("classifies on api.staktrakr.com", () => {
    const r = classifyEndpoint(API1 + "/v2/manifest.json", SELF);
    assert.equal(r.family, "manifest");
    assert.equal(r.floor, 1800);
    assert.equal(r.hasEnvelope, true);
  });

  it("classifies on api2.staktrakr.com", () => {
    assert.equal(classifyEndpoint(API2 + "/v2/manifest.json", SELF).family, "manifest");
  });
});

describe("classifyEndpoint — spot-latest", () => {
  it("classifies on both API hosts", () => {
    const { api1, api2 } = classifyOnBothHosts("/v2/spot/latest.json");
    assert.equal(api1.family, "spot-latest");
    assert.equal(api1.floor, 1200);
    assert.equal(api1.hasEnvelope, true);
    assert.equal(api2.family, "spot-latest");
  });
});

describe("classifyEndpoint — spot-history-daily", () => {
  it("classifies hourly backfill path on both API hosts", () => {
    const { api1, api2 } = classifyOnBothHosts("/v2/spot/xau/2026/05/15.json");
    assert.equal(api1.family, "spot-history-daily");
    assert.equal(api1.floor, 3600);
    assert.equal(api1.hasEnvelope, true);
    assert.equal(api2.family, "spot-history-daily");
  });

  it("classifies different metal ISO codes", () => {
    assert.equal(
      classifyEndpoint(API1 + "/v2/spot/xag/2025/12/31.json", SELF).family,
      "spot-history-daily"
    );
  });

  it("does NOT match spot-latest as spot-history-daily (regexes are mutually exclusive)", () => {
    assert.equal(classifyEndpoint(API1 + "/v2/spot/latest.json", SELF).family, "spot-latest");
  });
});

describe("classifyEndpoint — goldback-latest", () => {
  it("classifies on both API hosts", () => {
    const { api1, api2 } = classifyOnBothHosts("/v2/goldback/latest.json");
    assert.equal(api1.family, "goldback-latest");
    assert.equal(api1.floor, 7200);
    assert.equal(api1.hasEnvelope, true);
    assert.equal(api2.family, "goldback-latest");
  });
});

describe("classifyEndpoint — goldback-intraday", () => {
  it("classifies on both API hosts", () => {
    const { api1, api2 } = classifyOnBothHosts("/v2/goldback/intraday.json");
    assert.equal(api1.family, "goldback-intraday");
    assert.equal(api1.floor, 7200);
    assert.equal(api1.hasEnvelope, true);
    assert.equal(api2.family, "goldback-intraday");
  });

  it("does NOT emit networkFirst on goldback-intraday (key must be absent)", () => {
    const r = classifyEndpoint(API1 + "/v2/goldback/intraday.json", SELF);
    assert.equal(r.family, "goldback-intraday");
    assert.equal(Object.prototype.hasOwnProperty.call(r, "networkFirst"), false);
  });

  it("returns null for a non-API host", () => {
    assert.equal(classifyEndpoint("https://example.com/v2/goldback/intraday.json", SELF), null);
  });

  it("does NOT classify goldback/latest.json as goldback-intraday", () => {
    assert.equal(
      classifyEndpoint(API1 + "/v2/goldback/latest.json", SELF).family,
      "goldback-latest"
    );
  });
});

describe("classifyEndpoint — retail-latest", () => {
  it("classifies on both API hosts", () => {
    const { api1, api2 } = classifyOnBothHosts("/v2/retail/apmex/latest.json");
    assert.equal(api1.family, "retail-latest");
    assert.equal(api1.floor, 1800);
    assert.equal(api1.hasEnvelope, true);
    assert.equal(api2.family, "retail-latest");
  });

  it("classifies with hyphenated slug", () => {
    assert.equal(
      classifyEndpoint(API1 + "/v2/retail/jm-bullion/latest.json", SELF).family,
      "retail-latest"
    );
  });
});

describe("classifyEndpoint — retail-intraday", () => {
  it("classifies on both API hosts", () => {
    const { api1, api2 } = classifyOnBothHosts("/v2/retail/apmex/intraday.json");
    assert.equal(api1.family, "retail-intraday");
    assert.equal(api1.floor, 1200);
    assert.equal(api1.hasEnvelope, true);
    assert.equal(api2.family, "retail-intraday");
  });
});

describe("classifyEndpoint — retail-history-short", () => {
  it("classifies history-7d on both API hosts", () => {
    const { api1, api2 } = classifyOnBothHosts("/v2/retail/apmex/history-7d.json");
    assert.equal(api1.family, "retail-history-short");
    assert.equal(api1.floor, 3600);
    assert.equal(api1.hasEnvelope, true);
    assert.equal(api2.family, "retail-history-short");
  });
});

describe("classifyEndpoint — retail-history-long", () => {
  it("classifies history-30d on both API hosts", () => {
    const { api1, api2 } = classifyOnBothHosts("/v2/retail/apmex/history-30d.json");
    assert.equal(api1.family, "retail-history-long");
    assert.equal(api1.floor, 86400);
    assert.equal(api1.hasEnvelope, true);
    assert.equal(api2.family, "retail-history-long");
  });

  it("classifies history-90d on both API hosts", () => {
    const { api1, api2 } = classifyOnBothHosts("/v2/retail/apmex/history-90d.json");
    assert.equal(api1.family, "retail-history-long");
    assert.equal(api2.family, "retail-history-long");
  });
});

describe("classifyEndpoint — providers", () => {
  it("classifies on both API hosts", () => {
    const { api1, api2 } = classifyOnBothHosts("/v2/providers.json");
    assert.equal(api1.family, "providers");
    assert.equal(api1.floor, 86400);
    assert.equal(api1.hasEnvelope, true);
    assert.equal(api2.family, "providers");
  });
});

describe("classifyEndpoint — annual-spot-history", () => {
  it("classifies /data/spot-history-YYYY.json on local (self) origin", () => {
    const r = classifyEndpoint(SELF + "/data/spot-history-2025.json", SELF);
    assert.equal(r.family, "annual-spot-history");
    assert.equal(r.floor, 86400);
    assert.equal(r.hasEnvelope, false);
  });

  it("classifies /spot-history-YYYY.json (API-root path) on api.staktrakr.com", () => {
    const r = classifyEndpoint(API1 + "/spot-history-2025.json", SELF);
    assert.equal(r.family, "annual-spot-history");
    assert.equal(r.hasEnvelope, false);
  });

  it("classifies /spot-history-YYYY.json on api2.staktrakr.com", () => {
    assert.equal(
      classifyEndpoint(API2 + "/spot-history-2026.json", SELF).family,
      "annual-spot-history"
    );
  });

  it("classifies /data/spot-history-YYYY.json when path is under /data/ on API host", () => {
    assert.equal(
      classifyEndpoint(API1 + "/data/spot-history-2024.json", SELF).family,
      "annual-spot-history"
    );
  });
});

describe("classifyEndpoint — negative cases", () => {
  it("returns null for staktrakr.com when it is NOT the selfOrigin (third-party scope)", () => {
    const r = classifyEndpoint(
      "https://staktrakr.com/data/spot-history-2025.json",
      "https://other.example.com"
    );
    assert.equal(r, null);
  });

  it("returns null for unclassified API paths", () => {
    assert.equal(classifyEndpoint(API1 + "/v2/unknown/endpoint.json", SELF), null);
  });

  it("returns null for non-API non-local hosts", () => {
    assert.equal(classifyEndpoint("https://example.com/v2/spot/latest.json", SELF), null);
  });

  it("returns null for a malformed URL", () => {
    assert.equal(classifyEndpoint("not-a-url", SELF), null);
  });

  it("returns null for empty string", () => {
    assert.equal(classifyEndpoint("", SELF), null);
  });

  it("returns null for monthly archive retail path (not in FAMILY_TABLE)", () => {
    assert.equal(classifyEndpoint(API1 + "/v2/retail/apmex/2025/11.json", SELF), null);
  });
});

// STRK-190: production requests are built from V2_API_ENDPOINTS
// (https://api{,2}.staktrakr.com/data/v2), so every real pathname carries a
// /data prefix. These tests pin classification of the REAL URL shapes.
describe("classifyEndpoint — production /data/v2 prefix (STRK-190)", () => {
  const PROD_CASES = [
    ["/data/v2/manifest.json", "manifest", 1800],
    ["/data/v2/spot/latest.json", "spot-latest", 1200],
    ["/data/v2/spot/xau/2026/05/15.json", "spot-history-daily", 3600],
    ["/data/v2/goldback/latest.json", "goldback-latest", 7200],
    ["/data/v2/goldback/intraday.json", "goldback-intraday", 7200],
    ["/data/v2/retail/apmex/latest.json", "retail-latest", 1800],
    ["/data/v2/retail/apmex/intraday.json", "retail-intraday", 1200],
    ["/data/v2/retail/apmex/history-7d.json", "retail-history-short", 3600],
    ["/data/v2/retail/apmex/history-30d.json", "retail-history-long", 86400],
    ["/data/v2/providers.json", "providers", 86400],
  ];

  for (const [path, family, floor] of PROD_CASES) {
    it(`classifies ${path} as ${family} on both API hosts`, () => {
      const { api1, api2 } = classifyOnBothHosts(path);
      assert.equal(api1.family, family);
      assert.equal(api1.floor, floor);
      assert.equal(api1.hasEnvelope, true);
      assert.equal(api2.family, family);
    });
  }

  it("still returns null for unclassified paths under /data/v2", () => {
    assert.equal(classifyEndpoint(API1 + "/data/v2/unknown/endpoint.json", SELF), null);
  });

  it("does not strip a non-segment /data prefix (e.g. /database/…)", () => {
    assert.equal(classifyEndpoint(API1 + "/database/v2/spot/latest.json", SELF), null);
  });

  it("strips only ONE /data segment (/data/data/v2/… stays unclassified)", () => {
    assert.equal(classifyEndpoint(API1 + "/data/data/v2/spot/latest.json", SELF), null);
  });

  it("does not classify envelope families on the local origin even with /data prefix", () => {
    assert.equal(classifyEndpoint(SELF + "/data/v2/spot/latest.json", SELF), null);
  });
});

// STRK-249 (B.1): classifyEndpoint emits networkFirst:true on the three
// realtime families (spot-latest, goldback-latest, retail-latest) and must
// NOT emit the key at all on the other 7 families. C.1 is implemented in
// this PR — these assertions are green.
describe("classifyEndpoint — networkFirst on realtime families (STRK-249)", () => {
  // A representative classifiable path per family (on an API host) so we can
  // inspect the descriptor classifyEndpoint returns for each.
  const FAMILY_PATHS = {
    manifest: "/v2/manifest.json",
    "spot-latest": "/v2/spot/latest.json",
    "spot-history-daily": "/v2/spot/xau/2026/05/15.json",
    "goldback-latest": "/v2/goldback/latest.json",
    "retail-latest": "/v2/retail/apmex/latest.json",
    "retail-intraday": "/v2/retail/apmex/intraday.json",
    "retail-history-short": "/v2/retail/apmex/history-7d.json",
    "retail-history-long": "/v2/retail/apmex/history-30d.json",
    providers: "/v2/providers.json",
    "annual-spot-history": "/spot-history-2025.json",
  };

  // `providers` moved from NON_REALTIME to REALTIME in STRK-264. It is not
  // realtime data, but cache-first let a provider_vendors change sit behind a
  // 24h SW-cached copy while the price feed updated immediately, so the UI
  // could show a current price under a stale vendor URL. Dedicated coverage
  // lives in tests/unit/strk-264-providers-network-first.test.js.
  const REALTIME_FAMILIES = ["spot-latest", "goldback-latest", "retail-latest", "providers"];
  const NON_REALTIME_FAMILIES = [
    "manifest",
    "spot-history-daily",
    "retail-intraday",
    "retail-history-short",
    "retail-history-long",
    "annual-spot-history",
  ];

  for (const family of REALTIME_FAMILIES) {
    it(`emits networkFirst:true on ${family} (both API hosts)`, () => {
      const { api1, api2 } = classifyOnBothHosts(FAMILY_PATHS[family]);
      assert.equal(api1.family, family);
      assert.equal(api1.networkFirst, true);
      assert.equal(api2.family, family);
      assert.equal(api2.networkFirst, true);
    });
  }

  for (const family of NON_REALTIME_FAMILIES) {
    it(`does NOT emit networkFirst on ${family} (key must be absent)`, () => {
      const r = classifyEndpoint(API1 + FAMILY_PATHS[family], SELF);
      assert.equal(r.family, family);
      assert.equal(Object.prototype.hasOwnProperty.call(r, "networkFirst"), false);
    });
  }
});

describe("parseGeneratedAtSeconds — STRK-189", () => {
  it("parses an ISO-8601 string (production envelope format) to unix seconds", () => {
    assert.equal(parseGeneratedAtSeconds({ generated_at: "2026-06-11T22:14:00Z" }), 1781216040);
  });

  it("parses an ISO string with milliseconds and offset", () => {
    assert.equal(
      parseGeneratedAtSeconds({ generated_at: "2026-06-11T17:14:00.000-05:00" }),
      1781216040
    );
  });

  it("passes through a numeric unix-seconds value (backward compat)", () => {
    assert.equal(parseGeneratedAtSeconds({ generated_at: 1781216040 }), 1781216040);
  });

  it("returns null when generated_at is absent", () => {
    assert.equal(parseGeneratedAtSeconds({}), null);
  });

  it("returns null for a malformed timestamp string", () => {
    assert.equal(parseGeneratedAtSeconds({ generated_at: "not-a-date" }), null);
  });

  it("returns null for a null/undefined body", () => {
    assert.equal(parseGeneratedAtSeconds(null), null);
    assert.equal(parseGeneratedAtSeconds(undefined), null);
  });
});

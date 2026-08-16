// Unit tests for the third-party spot provider registry.
//
// STRK-342 (registry hygiene) established the invariants:
// - One canonical metal→symbol map (SPOT_PROVIDER_METAL_SYMBOLS) in
//   constants.js; api.js and spotLookup.js must not carry inline copies
//   (source-scan tests below enforce it).
// - An unmapped metal resolves to null (a provider miss) — never falls
//   through to another metal's symbol/price.
// - CUSTOM's {METAL} substitution returns null for unmapped metals so the
//   literal string "undefined" never reaches a user-configured URL.
//
// STRK-303 Part 2 wires copper into the user-selectable providers. The
// provider-verified facts (recorded on the issue, 2026-08-15):
// - Metals-API / MetalPriceAPI: XCU is per TROY OUNCE; the unconditional
//   1/rate inversion is kept on BOTH the latest and timeseries paths (the
//   USD-prefixed direct key exists on /latest only — do not read it here).
//   Magnitude trap: copper's bare rate (~2.42) is >= 1 while the four
//   precious rates are << 1; any size-based direction heuristic silently
//   yields ~$2.42/ozt. The inversion must be unconditional.
// - gold-api.com: copper is COMEX HG, quoted per POUND while the same
//   endpoint shape serves the other four per troy ounce. Copper divides by
//   TROY_OUNCES_PER_POUND (7000/480 grains — exact); the COMEX-over-LME
//   premium is accepted by decision (issue comment 2026-08-15).
// - metals.dev: copper comes ONLY from the batch /latest endpoint, which
//   requests &unit=toz and must assert the echoed unit. The per-metal
//   /metal/spot endpoint has no unit parameter (returns tonnes for
//   industrial metals) so METALS_DEV.endpoints must never gain a copper
//   entry, and the /timeseries parser skips copper (no unit parameter is
//   documented for that endpoint; a tonnes row is a 32,150x error).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// --- constants.js: whole-file eval with a mock window ---
// Top-level code reads window.location.search (debug flag) and
// window.localStorage (app-version stamp), so both get inert stubs.
const constSrc = readFileSync(new URL("../../js/constants.js", import.meta.url), "utf-8");
const win = {
  location: { search: "", protocol: "https:" },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
new Function("window", constSrc)(win);

const {
  API_PROVIDERS,
  SPOT_PROVIDER_METAL_SYMBOLS,
  SPOT_PROVIDER_SYMBOL_TO_METAL,
  TROY_OUNCES_PER_POUND,
  getSpotProviderMetalCode,
  isProviderHistoryMetal,
} = win;

assert.ok(API_PROVIDERS, "API_PROVIDERS must load from constants.js");

const apiSrc = readFileSync(new URL("../../js/api.js", import.meta.url), "utf-8");
const lookupSrc = readFileSync(new URL("../../js/spotLookup.js", import.meta.url), "utf-8");
const settingsSrc = readFileSync(new URL("../../js/settings.js", import.meta.url), "utf-8");

/**
 * Extract an object literal assigned to `const <name> = {...};` from source
 * text and evaluate it. Tolerates line comments inside the literal.
 * @param {string} src file source
 * @param {string} name identifier to extract
 * @returns {Object} evaluated literal
 */
const extractObjectLiteral = (src, name) => {
  const match = src.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\});`));
  assert.ok(match, `could not locate const ${name} literal`);
  return new Function(`return ${match[1]};`)();
};

/** Assert a is within relative tolerance of b. */
const assertClose = (actual, expected, message, tolerance = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * tolerance,
    `${message}: expected ~${expected}, got ${actual}`
  );
};

describe("canonical provider symbol map (STRK-342 + STRK-303 Part 2)", () => {
  test("maps exactly the five wired metals, palladium and copper explicit", () => {
    // Spread copies onto a plain object — the canonical maps carry a null
    // prototype so inherited names can never resolve as mapped metals.
    assert.deepEqual(
      { ...SPOT_PROVIDER_METAL_SYMBOLS },
      {
        silver: "XAG",
        gold: "XAU",
        platinum: "XPT",
        palladium: "XPD",
        copper: "XCU",
      }
    );
  });

  test("inverse map is the exact inverse", () => {
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(SPOT_PROVIDER_SYMBOL_TO_METAL).map(([symbol, metal]) => [metal, symbol])
      ),
      { ...SPOT_PROVIDER_METAL_SYMBOLS }
    );
  });

  test("inherited property names never resolve as mapped metals", () => {
    for (const name of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      assert.equal(SPOT_PROVIDER_METAL_SYMBOLS[name], undefined);
      assert.equal(SPOT_PROVIDER_SYMBOL_TO_METAL[name], undefined);
      assert.equal(getSpotProviderMetalCode(name, "symbol"), null);
      assert.equal(getSpotProviderMetalCode(name, "word"), null);
    }
  });

  test("pound→troy-ounce divisor is the exact grain-defined ratio", () => {
    // 1 lb avoirdupois = 7000 grains; 1 troy oz = 480 grains.
    assert.equal(TROY_OUNCES_PER_POUND, 7000 / 480);
    assertClose(TROY_OUNCES_PER_POUND, 14.5833333, "matches the issue's documented divisor", 1e-8);
  });
});

describe("getSpotProviderMetalCode (CUSTOM provider guard)", () => {
  test("known metals resolve in both formats", () => {
    assert.equal(getSpotProviderMetalCode("silver", "symbol"), "XAG");
    assert.equal(getSpotProviderMetalCode("palladium", "symbol"), "XPD");
    assert.equal(getSpotProviderMetalCode("copper", "symbol"), "XCU");
    assert.equal(getSpotProviderMetalCode("gold", "word"), "gold");
    assert.equal(getSpotProviderMetalCode("copper", "word"), "copper");
  });

  test("unknown metals return null in both formats — never undefined", () => {
    for (const format of ["symbol", "word"]) {
      assert.equal(getSpotProviderMetalCode("unobtainium", format), null);
      assert.equal(getSpotProviderMetalCode("aluminum", format), null);
    }
  });
});

for (const provider of ["METALS_API", "METAL_PRICE_API"]) {
  describe(`${provider}.parseResponse symbol resolution`, () => {
    const { parseResponse } = API_PROVIDERS[provider];

    test("regression: all five wired metals invert their own rate", () => {
      const cases = {
        silver: "XAG",
        gold: "XAU",
        platinum: "XPT",
        palladium: "XPD",
        copper: "XCU",
      };
      for (const [metal, symbol] of Object.entries(cases)) {
        const price = parseResponse({ rates: { [symbol]: 0.5 } }, metal);
        assert.equal(price, 2, `${metal} must read rates.${symbol} and invert`);
      }
    });

    test("copper magnitude trap: rate ~2.42 still inverts to ~$0.41", () => {
      // The bare XCU rate is the one wired metal whose rate is >= 1. A
      // size-based direction heuristic (rate >= 1 ? rate : 1/rate) would
      // return $2.42/ozt here — the exact bug Part 1 removed from the
      // poller. Live probe values from the issue (2026-08-15).
      const price = parseResponse({ rates: { XCU: 2.42350016 } }, "copper");
      assertClose(price, 0.41262639, "copper must invert unconditionally", 1e-6);
      assert.ok(price < 1, "copper price must be the inverted sub-dollar value");
    });

    test("unknown metal returns null even when rates.XPD is present", () => {
      // Pre-STRK-342 behavior: the ternary chain fell through to XPD,
      // pricing an unknown metal as palladium.
      const data = { rates: { XPD: 0.00076, XAG: 0.0155 } };
      assert.equal(parseResponse(data, "unobtainium"), null);
      assert.equal(parseResponse(data, "aluminum"), null);
    });

    test("missing rate for a known metal returns null", () => {
      assert.equal(parseResponse({ rates: {} }, "gold"), null);
      assert.equal(parseResponse({ rates: {} }, "copper"), null);
      assert.equal(parseResponse({}, "gold"), null);
    });
  });

  describe(`${provider}.parseBatchResponse symbol mapping`, () => {
    const { parseBatchResponse } = API_PROVIDERS[provider];

    test("maps the five wired symbols and ignores unknown symbols", () => {
      const { current } = parseBatchResponse({
        rates: { XAG: 0.05, XAU: 0.0002, XPT: 0.001, XPD: 0.0008, XCU: 2.5, XAL: 1.1 },
      });
      assert.deepEqual(current, {
        silver: 20,
        gold: 5000,
        platinum: 1000,
        palladium: 1250,
        copper: 0.4,
      });
    });

    test("timeseries shape maps copper per date with unconditional inversion", () => {
      // USDXCU exists on /latest only — the timeseries path has no
      // USD-prefixed key, so 1/rate is mandatory here (issue comment
      // 2026-08-15). Do not port the poller's read-the-direct-key fix.
      const { history, current } = parseBatchResponse({
        rates: { "2026-08-14": { XAG: 0.05, XCU: 2.5 } },
      });
      assert.deepEqual(Object.keys(history).sort(), ["copper", "silver"]);
      assert.equal(history.silver[0].price, 20);
      assert.equal(history.copper[0].price, 0.4);
      assert.equal(current.copper, 0.4);
    });

    test(`${provider} copper latest endpoint requests XCU`, () => {
      assert.match(API_PROVIDERS[provider].endpoints.copper, /XCU/);
    });
  });
}

describe("GOLD_API metal-aware parseResponse (COMEX HG per pound)", () => {
  const { parseResponse, endpoints } = API_PROVIDERS.GOLD_API;

  test("precious metals pass through unchanged", () => {
    assert.equal(parseResponse({ price: 4376.56 }, "gold"), 4376.56);
    assert.equal(parseResponse({ price: 64.7 }, "silver"), 64.7);
    assert.equal(parseResponse({ price: 1316.48 }, "palladium"), 1316.48);
  });

  test("copper divides the per-pound HG price by 7000/480", () => {
    // Live probe 2026-08-15: /price/HG returned 6.545967 (USD per pound).
    // Converted: $0.448866/ozt. Unconverted it ships ~14.6x too high.
    const price = parseResponse({ price: 6.545967 }, "copper");
    assertClose(price, 6.545967 / (7000 / 480), "HG must convert lb → ozt");
    assert.ok(price < 1, "converted copper must be sub-dollar");
  });

  test("bad payloads return null for every metal", () => {
    for (const metal of ["gold", "copper"]) {
      assert.equal(parseResponse({}, metal), null);
      assert.equal(parseResponse({ price: 0 }, metal), null);
      assert.equal(parseResponse({ price: "6.5" }, metal), null);
      assert.equal(parseResponse(null, metal), null);
    }
  });

  test("copper endpoint is uppercase /price/HG (symbol is case-sensitive)", () => {
    assert.equal(endpoints.copper, "/price/HG");
  });
});

describe("METALS_DEV copper unit safety", () => {
  const { endpoints, latestBatchEndpoint, parseLatestBatchResponse, parseBatchResponse } =
    API_PROVIDERS.METALS_DEV;

  test("per-metal endpoints must never gain a copper entry", () => {
    // /v1/metal/spot documents no unit parameter — industrial metals come
    // back per metric tonne there (a 32,150x error). Copper is batch-only.
    assert.equal(endpoints.copper, undefined);
  });

  test("batch latest endpoint requests troy ounces explicitly", () => {
    assert.match(latestBatchEndpoint, /unit=toz/);
  });

  test("latest batch accepts copper only when the echoed unit is toz", () => {
    const payload = {
      unit: "toz",
      metals: { gold: 4376.56, silver: 64.7, copper: 0.4126 },
    };
    const parsed = parseLatestBatchResponse(payload);
    assert.equal(parsed.copper, 0.4126);
    assert.equal(parsed.gold, 4376.56);
  });

  test("latest batch rejects the whole payload when the echoed unit is not toz", () => {
    // We requested toz; a different echo means the server ignored the
    // parameter and every number is suspect. Return nothing so the caller
    // falls back to the per-metal endpoints (precious-only, always toz).
    const parsed = parseLatestBatchResponse({
      unit: "mt",
      metals: { gold: 4376.56, copper: 13266 },
    });
    assert.deepEqual(parsed, {});
  });

  test("latest batch without a unit echo keeps precious but skips copper", () => {
    const parsed = parseLatestBatchResponse({
      metals: { gold: 4376.56, copper: 13266 },
    });
    assert.equal(parsed.gold, 4376.56);
    assert.equal(parsed.copper, undefined);
  });

  test("history capability excludes copper for METALS_DEV only", () => {
    // The history-pull gate and cost preview must not admit a metal the
    // provider's timeseries parser will discard — a copper-only metals.dev
    // pull would burn an API call to pull zero points (Codex P2, PR #1462).
    assert.equal(isProviderHistoryMetal("METALS_DEV", "copper"), false);
    assert.equal(isProviderHistoryMetal("METALS_DEV", "gold"), true);
    assert.equal(isProviderHistoryMetal("METALS_API", "copper"), true);
    assert.equal(isProviderHistoryMetal("METAL_PRICE_API", "copper"), true);
    // Unmapped metals stay excluded everywhere.
    assert.equal(isProviderHistoryMetal("METALS_API", "unobtainium"), false);
  });

  test("timeseries parser skips copper (no unit parameter on /timeseries)", () => {
    const { current, history } = parseBatchResponse({
      unit: "toz",
      rates: {
        "2026-08-14": { metals: { gold: 4376.56, copper: 13266 } },
      },
    });
    assert.equal(current.gold, 4376.56);
    assert.equal(current.copper, undefined);
    assert.deepEqual(Object.keys(history), ["gold"]);
  });
});

describe("map copies stay in sync across files", () => {
  test("api.js _V2_METAL_MAP agrees with the canonical map on shared metals", () => {
    const v2Map = extractObjectLiteral(apiSrc, "_V2_METAL_MAP");
    for (const [iso, metal] of Object.entries(v2Map)) {
      const symbol = SPOT_PROVIDER_METAL_SYMBOLS[metal];
      if (symbol) {
        assert.equal(iso, symbol.toLowerCase(), `_V2_METAL_MAP ${iso} must match ${symbol}`);
      }
    }
    assert.equal(v2Map.xcu, "copper");
  });

  test("spotLookup.js METAL_SYMBOLS agrees with the canonical map on shared metals", () => {
    const lookupMap = extractObjectLiteral(lookupSrc, "METAL_SYMBOLS");
    for (const [displayName, symbol] of Object.entries(lookupMap)) {
      const canonical = SPOT_PROVIDER_METAL_SYMBOLS[displayName.toLowerCase()];
      if (canonical) {
        assert.equal(symbol, canonical, `METAL_SYMBOLS.${displayName} must match canonical`);
      }
    }
    assert.equal(lookupMap.Copper, "XCU");
  });

  test("settings metals grid renders a copper checkbox", () => {
    // _buildMetalsCheckboxes hydrates from config.metals[provider]; copper
    // has been config-truthy since the STRK-305 backfill, so the grid must
    // surface it or users cannot opt out of the fifth metal's API calls.
    assert.match(settingsSrc, /metal:\s*"copper"/);
  });

  test("no inline five-metal symbol map literals survive outside constants.js", () => {
    const inlineCopies = apiSrc.match(/silver:\s*"XAG"/g) || [];
    assert.equal(
      inlineCopies.length,
      0,
      `api.js must reference the canonical map, found ${inlineCopies.length} inline copies`
    );
  });

  test("constants.js declares the metal→symbol literal exactly once", () => {
    const declarations = constSrc.match(/silver:\s*"XAG"/g) || [];
    assert.equal(declarations.length, 1, "canonical map must be the only metal→symbol literal");
    const inverseLiterals = constSrc.match(/XAG:\s*"silver"/g) || [];
    assert.equal(inverseLiterals.length, 0, "inverse map must be derived, not redeclared");
  });

  test("dead setupProviderSettingsListeners stays deleted", () => {
    // Defined-but-never-called; its .provider-metal selector matched no markup.
    // The live wiring is the delegated handler in settings-listeners.js.
    assert.ok(!apiSrc.includes("setupProviderSettingsListeners"));
    assert.ok(!apiSrc.includes("provider-metal"));
  });
});

// Unit tests for STRK-342 — spot provider registry hygiene.
//
// Defect 1 (the serious one): the METALS_API and METAL_PRICE_API parseResponse
// symbol resolvers used a ternary chain with no explicit palladium test, so XPD
// was the else-branch AND the catch-all. An unknown metal was not rejected — it
// was silently priced as palladium (~$1,316/ozt for copper's true ~$0.41).
//
// Defect 2: the CUSTOM provider's metal-code map had no entry for unknown
// metals, so pattern.replace("{METAL}", undefined) substituted the literal
// string "undefined" into a user-configured endpoint URL. Live since STRK-305
// backfilled copper:true into every provider's config.metals.
//
// Defect 3: the four-metal symbol map was redeclared eight times across
// constants.js / api.js / spotLookup.js. Copies drift (spotLookup gained
// copper in STRK-305 while the rest did not). One canonical map now lives in
// constants.js: SPOT_PROVIDER_METAL_SYMBOLS (+ derived inverse). The
// source-scan tests below are the enforcement that no inline copy returns.
//
// Copper is deliberately ABSENT from the canonical provider map until
// STRK-303 Part 2 wires the third-party providers — an unmapped metal must
// resolve to null (provider miss), never to a wrong price.

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
  getSpotProviderMetalCode,
} = win;

assert.ok(API_PROVIDERS, "API_PROVIDERS must load from constants.js");

const apiSrc = readFileSync(new URL("../../js/api.js", import.meta.url), "utf-8");
const lookupSrc = readFileSync(new URL("../../js/spotLookup.js", import.meta.url), "utf-8");

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

describe("canonical provider symbol map (STRK-342)", () => {
  test("maps exactly the four wired metals, palladium explicitly", () => {
    assert.deepEqual(SPOT_PROVIDER_METAL_SYMBOLS, {
      silver: "XAG",
      gold: "XAU",
      platinum: "XPT",
      palladium: "XPD",
    });
  });

  test("copper stays unmapped until STRK-303 Part 2", () => {
    assert.equal(SPOT_PROVIDER_METAL_SYMBOLS.copper, undefined);
  });

  test("inverse map is the exact inverse", () => {
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(SPOT_PROVIDER_SYMBOL_TO_METAL).map(([symbol, metal]) => [metal, symbol])
      ),
      SPOT_PROVIDER_METAL_SYMBOLS
    );
  });
});

describe("getSpotProviderMetalCode (CUSTOM provider guard)", () => {
  test("known metals resolve in both formats", () => {
    assert.equal(getSpotProviderMetalCode("silver", "symbol"), "XAG");
    assert.equal(getSpotProviderMetalCode("palladium", "symbol"), "XPD");
    assert.equal(getSpotProviderMetalCode("gold", "word"), "gold");
    assert.equal(getSpotProviderMetalCode("palladium", "word"), "palladium");
  });

  test("unknown metals return null in both formats — never undefined", () => {
    for (const format of ["symbol", "word"]) {
      assert.equal(getSpotProviderMetalCode("copper", format), null);
      assert.equal(getSpotProviderMetalCode("unobtainium", format), null);
    }
  });
});

for (const provider of ["METALS_API", "METAL_PRICE_API"]) {
  describe(`${provider}.parseResponse symbol resolution`, () => {
    const { parseResponse } = API_PROVIDERS[provider];

    test("regression: all four wired metals invert their own rate", () => {
      const cases = {
        silver: "XAG",
        gold: "XAU",
        platinum: "XPT",
        palladium: "XPD",
      };
      for (const [metal, symbol] of Object.entries(cases)) {
        const price = parseResponse({ rates: { [symbol]: 0.5 } }, metal);
        assert.equal(price, 2, `${metal} must read rates.${symbol} and invert`);
      }
    });

    test("unknown metal returns null even when rates.XPD is present", () => {
      // Pre-fix behavior: the ternary chain fell through to XPD, pricing an
      // unknown metal as palladium — a plausible number in the right column.
      const data = { rates: { XPD: 0.00076, XAG: 0.0155 } };
      assert.equal(parseResponse(data, "copper"), null);
      assert.equal(parseResponse(data, "unobtainium"), null);
    });

    test("missing rate for a known metal returns null", () => {
      assert.equal(parseResponse({ rates: {} }, "gold"), null);
      assert.equal(parseResponse({}, "gold"), null);
    });
  });

  describe(`${provider}.parseBatchResponse symbol mapping`, () => {
    const { parseBatchResponse } = API_PROVIDERS[provider];

    test("maps the four wired symbols and ignores unknown symbols", () => {
      const { current } = parseBatchResponse({
        rates: { XAG: 0.05, XAU: 0.0002, XPT: 0.001, XPD: 0.0008, XCU: 2.4 },
      });
      assert.deepEqual(current, {
        silver: 20,
        gold: 5000,
        platinum: 1000,
        palladium: 1250,
      });
    });

    test("timeseries shape maps symbols per date", () => {
      const { history } = parseBatchResponse({
        rates: { "2026-08-14": { XAG: 0.05, XCU: 2.4 } },
      });
      assert.deepEqual(Object.keys(history), ["silver"]);
      assert.equal(history.silver[0].price, 20);
    });
  });
}

describe("map copies stay in sync across files", () => {
  test("api.js _V2_METAL_MAP agrees with the canonical map on shared metals", () => {
    const v2Map = extractObjectLiteral(apiSrc, "_V2_METAL_MAP");
    for (const [iso, metal] of Object.entries(v2Map)) {
      const symbol = SPOT_PROVIDER_METAL_SYMBOLS[metal];
      if (symbol) {
        assert.equal(iso, symbol.toLowerCase(), `_V2_METAL_MAP ${iso} must match ${symbol}`);
      }
    }
    // The v2 feed is StakTrakr's own API and already carries copper.
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
    // Spot-date lookup supports copper ahead of full provider wiring (STRK-305).
    assert.equal(lookupMap.Copper, "XCU");
  });

  test("no inline four-metal symbol map literals survive outside constants.js", () => {
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

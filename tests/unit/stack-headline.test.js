// Unit tests for the Dashboard stack headline figures and the layout section merge
// that places a new Dashboard section at its default position.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evalSource, rangeOf, readSource } from "./helpers/source-extract.js";
import { sliceArrowConst, sliceConstArray } from "./test-helpers.js";

const headlineSrc = readSource("js/stack-headline.js");
const computeStackHeadline = evalSource("js/stack-headline.js", {
  slice: rangeOf(headlineSrc, sliceArrowConst(headlineSrc, "const computeStackHeadline = (")),
  suffix: "\nreturn computeStackHeadline;",
});

/** Builds one metal's updateSummary accumulator with zeroed defaults. */
const metal = (fields) => ({
  totalItems: 0,
  totalMeltValue: 0,
  totalPurchased: 0,
  totalRetailValue: 0,
  totalGainLoss: 0,
  activeRows: 0,
  disposedItems: 0,
  ...fields,
});

describe("computeStackHeadline", () => {
  test("sums retail, melt and gain on cost across every metal", () => {
    const figures = computeStackHeadline(
      {
        silver: metal({
          totalItems: 10,
          totalMeltValue: 300,
          totalPurchased: 200,
          totalRetailValue: 350,
          totalGainLoss: 150,
          activeRows: 2,
        }),
        gold: metal({
          totalItems: 1,
          totalMeltValue: 4000,
          totalPurchased: 4200,
          totalRetailValue: 4100,
          totalGainLoss: -100,
          activeRows: 1,
        }),
      },
      () => ({ pct: 0, valid: false })
    );
    assert.equal(figures.retail, 4450);
    assert.equal(figures.melt, 4300);
    assert.equal(figures.gain, 50);
    assert.equal(figures.gainPct, (50 / 4400) * 100);
    assert.equal(figures.empty, false);
  });

  test("today's change prices each metal's pure ounces at the two compared prices", () => {
    // Silver: melt 330 at spot 33 is 10 oz; 30 -> 33 is +30.
    // Gold: melt 3800 at spot 3800 is 1 oz; 4000 -> 3800 is -200.
    const changes = {
      silver: { valid: true, oldPrice: 30, newPrice: 33, spot: 33 },
      gold: { valid: true, oldPrice: 4000, newPrice: 3800, spot: 3800 },
    };
    const figures = computeStackHeadline(
      {
        silver: metal({ totalMeltValue: 330, activeRows: 1 }),
        gold: metal({ totalMeltValue: 3800, activeRows: 1 }),
      },
      (key) => changes[key]
    );
    assert.equal(figures.hasToday, true);
    assert.ok(Math.abs(figures.today - -170) < 1e-9, `today ${figures.today}`);
    assert.ok(Math.abs(figures.todayPct - (-170 / 4300) * 100) < 1e-9);
  });

  test("an open-to-open comparison uses its own prices, not the current spot", () => {
    // 1 oz: yesterday's open 100, today's open 110, current spot 121.
    const figures = computeStackHeadline(
      { gold: metal({ totalMeltValue: 121, activeRows: 1 }) },
      () => ({ valid: true, oldPrice: 100, newPrice: 110, spot: 121 })
    );
    assert.ok(Math.abs(figures.today - 10) < 1e-9, `today ${figures.today}`);
    assert.ok(Math.abs(figures.todayPct - 10) < 1e-9);
  });

  test("a metal without a valid 24h change or spot adds nothing to today's change", () => {
    const changes = {
      silver: { valid: true, oldPrice: 30, newPrice: 33, spot: 33 },
      platinum: { pct: 0, valid: false },
      palladium: { valid: true, oldPrice: 900, newPrice: 1000, spot: 0 },
    };
    const figures = computeStackHeadline(
      {
        silver: metal({ totalMeltValue: 330, activeRows: 1 }),
        platinum: metal({ totalMeltValue: 1000, activeRows: 1 }),
        palladium: metal({ totalMeltValue: 1000, activeRows: 1 }),
      },
      (key) => changes[key]
    );
    assert.ok(Math.abs(figures.today - 30) < 1e-9);
    assert.ok(Math.abs(figures.todayPct - 10) < 1e-9);
  });

  test("with no valid 24h change anywhere, today's change is unavailable", () => {
    const figures = computeStackHeadline({ silver: metal({ totalMeltValue: 330 }) }, () => ({
      pct: 0,
      valid: false,
    }));
    assert.equal(figures.hasToday, false);
  });

  test("counts the active rows across every metal", () => {
    const figures = computeStackHeadline(
      { silver: metal({ activeRows: 3 }), gold: metal({ activeRows: 1 }) },
      () => ({ pct: 0, valid: false })
    );
    assert.equal(figures.activeRows, 4);
  });

  test("an inventory with no active or disposed Items is empty", () => {
    const empty = computeStackHeadline({ silver: metal({}) }, () => ({ pct: 0, valid: false }));
    assert.equal(empty.empty, true);
    const disposedOnly = computeStackHeadline({ silver: metal({ disposedItems: 2 }) }, () => ({
      pct: 0,
      valid: false,
    }));
    assert.equal(disposedOnly.empty, false);
  });
});

describe("layout section merge", () => {
  const constantsSrc = readSource("js/constants.js");
  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
  };
  const { loadSectionConfig, defaults } = evalSource("js/constants.js", {
    params: { localStorage },
    slice: [
      sliceConstArray(constantsSrc, "const LAYOUT_SECTION_DEFAULTS = ["),
      sliceArrowConst(constantsSrc, "const _loadSectionConfig = ("),
    ].map((text) => rangeOf(constantsSrc, text)),
    suffix:
      "\nreturn { loadSectionConfig: _loadSectionConfig, defaults: LAYOUT_SECTION_DEFAULTS };",
  });

  test("the stack headline sits between the ticker and the totals by default", () => {
    assert.deepEqual(
      defaults.slice(0, 4).map((d) => d.id),
      ["spotPrices", "bestPriceTicker", "stackHeadline", "totals"]
    );
    assert.equal(defaults[2].enabled, true);
  });

  test("a saved config gains a new default section at its default position", () => {
    const saved = defaults
      .filter((d) => d.id !== "stackHeadline")
      .map((d) => ({ ...d, enabled: d.id !== "totals" }));
    storage.set("layoutSectionConfig", JSON.stringify(saved));
    const merged = loadSectionConfig("layoutSectionConfig", defaults);
    assert.deepEqual(
      merged.map((s) => s.id),
      defaults.map((d) => d.id)
    );
    assert.equal(merged.find((s) => s.id === "totals").enabled, false);
  });

  test("a reordered saved config keeps its order and places the new section before its next default", () => {
    const saved = [
      { id: "totals", label: "Summary totals", enabled: true },
      { id: "spotPrices", label: "Spot price cards", enabled: true },
      { id: "bestPriceTicker", label: "Best Price Ticker", enabled: true },
    ];
    storage.set("layoutSectionConfig", JSON.stringify(saved));
    const ids = loadSectionConfig("layoutSectionConfig", defaults).map((s) => s.id);
    assert.deepEqual(ids.slice(0, 4), ["stackHeadline", "totals", "spotPrices", "bestPriceTicker"]);
  });
});

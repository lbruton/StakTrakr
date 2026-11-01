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
const HEADLINE_HELPERS = [
  "pickStackLead",
  "computeStackWeights",
  "formatStackPace",
  "stackActivityWindowStart",
];
const { pickStackLead, computeStackWeights, formatStackPace, stackActivityWindowStart } =
  evalSource("js/stack-headline.js", {
    slice: HEADLINE_HELPERS.map((name) =>
      rangeOf(headlineSrc, sliceArrowConst(headlineSrc, `const ${name} = (`))
    ),
    params: { STACK_ACTIVITY_DAYS: 365 },
    suffix: `\nreturn { ${HEADLINE_HELPERS.join(", ")} };`,
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

  test("sums cost basis, average cost per ounce and realized gain across every metal", () => {
    const figures = computeStackHeadline(
      {
        silver: metal({
          totalPurchased: 200,
          totalWeight: 10,
          realizedGainLoss: 30,
          totalDisposedCost: 100,
        }),
        gold: metal({
          totalPurchased: 4200,
          totalWeight: 1,
          realizedGainLoss: -10,
          totalDisposedCost: 100,
        }),
      },
      () => ({ pct: 0, valid: false })
    );
    assert.equal(figures.purchased, 4400);
    assert.equal(figures.avgCostPerOz, 4400 / 11);
    assert.equal(figures.realized, 20);
    assert.equal(figures.disposedCost, 200);
    assert.equal(figures.realizedPct, 10);
  });

  test("with no weight or no disposed cost, the average and realized percentage are zero", () => {
    const figures = computeStackHeadline({ silver: metal({}) }, () => ({ pct: 0, valid: false }));
    assert.equal(figures.avgCostPerOz, 0);
    assert.equal(figures.realized, 0);
    assert.equal(figures.realizedPct, 0);
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

  test("retail's premium over melt is retail minus melt over melt, and zero without melt", () => {
    const priced = computeStackHeadline(
      { silver: metal({ totalMeltValue: 200, totalRetailValue: 250, activeRows: 1 }) },
      () => ({ pct: 0, valid: false })
    );
    assert.equal(priced.premiumPct, 25);
    const noMelt = computeStackHeadline({ silver: metal({}) }, () => ({ pct: 0, valid: false }));
    assert.equal(noMelt.premiumPct, 0);
  });
});

describe("Your stack lead", () => {
  const figures = { retail: 1200, melt: 900, gain: 200, gainPct: 20, purchased: 1000 };

  test("Retail lead keeps the retail gain on cost", () => {
    assert.deepEqual(pickStackLead(figures, "retail"), {
      lead: "retail",
      other: "melt",
      gain: 200,
      gainPct: 20,
    });
  });

  test("Melt lead takes gain on cost at melt: melt minus cost basis", () => {
    assert.deepEqual(pickStackLead(figures, "melt"), {
      lead: "melt",
      other: "retail",
      gain: -100,
      gainPct: -10,
    });
  });

  test("an unknown or missing preference leads with retail", () => {
    for (const saved of [undefined, null, "", "Melt", "spot", []]) {
      assert.equal(pickStackLead(figures, saved).lead, "retail", String(saved));
    }
  });

  test("with no cost basis the melt gain percentage is zero", () => {
    assert.equal(pickStackLead({ ...figures, purchased: 0 }, "melt").gainPct, 0);
  });
});

describe("Your stack weights", () => {
  const order = [
    { id: "gold", enabled: true },
    { id: "silver", enabled: true },
    { id: "platinum", enabled: true },
    { id: "copper", enabled: false },
  ];

  test("lists held, enabled metals in Metal Order with their ounces", () => {
    const rows = computeStackWeights(
      {
        silver: metal({ totalItems: 10, totalWeight: 10.5 }),
        gold: metal({ totalItems: 1, totalWeight: 0.1 }),
        platinum: metal({}),
        copper: metal({ totalItems: 4, totalWeight: 32 }),
      },
      order
    );
    assert.deepEqual(rows, [
      { key: "gold", weight: 0.1 },
      { key: "silver", weight: 10.5 },
    ]);
  });

  test("a metal with only disposed Items is not listed", () => {
    const rows = computeStackWeights(
      { silver: metal({ disposedItems: 2, realizedGainLoss: 5 }), gold: metal({}) },
      order
    );
    assert.deepEqual(rows, []);
  });
});

describe("Your stack activity", () => {
  test("pace uses the breakdown modal's digits with a leading plus", () => {
    assert.equal(formatStackPace(2.44), "+2.4 oz/mo");
    assert.equal(formatStackPace(1 / 12), "+0.083 oz/mo");
  });

  test("a metal with no buys in the window reads No buys", () => {
    assert.equal(formatStackPace(0), "No buys");
  });

  test("the window starts 365 days before the series' last day, like the 1Y pill", () => {
    const days = Array.from({ length: 400 }, (_, i) => `d${i}`);
    assert.equal(stackActivityWindowStart(days), "d34");
  });

  test("a series shorter than a year starts the window at its first day", () => {
    assert.equal(stackActivityWindowStart(["a", "b", "c"]), "a");
    assert.equal(stackActivityWindowStart([]), "");
  });
});

describe("layout section merge", () => {
  const constantsSrc = readSource("js/constants.js");
  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
  };
  const { loadLayout, loadSectionConfig, defaults } = evalSource("js/constants.js", {
    params: { localStorage },
    slice: [
      sliceConstArray(constantsSrc, "const LAYOUT_SECTION_DEFAULTS = ["),
      sliceArrowConst(constantsSrc, "const _loadSectionConfig = ("),
      sliceArrowConst(constantsSrc, "const _foldStackHeadlineSection = ("),
    ].map((text) => rangeOf(constantsSrc, text)),
    suffix: `
return {
  loadSectionConfig: _loadSectionConfig,
  loadLayout: () =>
    _loadSectionConfig("layoutSectionConfig", LAYOUT_SECTION_DEFAULTS, null, null,
      _foldStackHeadlineSection),
  defaults: LAYOUT_SECTION_DEFAULTS,
};`,
  });

  /** Saves a layout config built from [id, enabled] pairs, with the labels it shipped with. */
  const saveLayout = (pairs) =>
    storage.set(
      "layoutSectionConfig",
      JSON.stringify(pairs.map(([id, enabled]) => ({ id, label: `old ${id}`, enabled })))
    );
  const DASHBOARD = ["spotPrices", "totals", "bestPriceTicker"];

  test("Your stack sits between the spot cards and the ticker by default, as one section", () => {
    assert.deepEqual(
      defaults.slice(0, 3).map((d) => d.id),
      DASHBOARD
    );
    assert.deepEqual(defaults[1], { id: "totals", label: "Your stack", enabled: true });
    assert.equal(
      defaults.some((d) => d.id === "stackHeadline"),
      false
    );
  });

  test("a saved config gains a new default section at its default position", () => {
    saveLayout(defaults.filter((d) => d.id !== "bestPriceTicker").map((d) => [d.id, true]));
    const merged = loadSectionConfig("layoutSectionConfig", defaults);
    assert.deepEqual(
      merged.map((s) => s.id),
      defaults.map((d) => d.id)
    );
  });

  test("saved labels give way to the current default labels", () => {
    saveLayout(defaults.map((d) => [d.id, d.id !== "table"]));
    const merged = loadSectionConfig("layoutSectionConfig", defaults);
    assert.deepEqual(
      merged.map((s) => s.label),
      defaults.map((d) => d.label)
    );
    assert.equal(merged.find((s) => s.id === "table").enabled, false);
  });

  const folds = [
    {
      name: "both enabled, ticker between them",
      saved: [
        ["spotPrices", true],
        ["stackHeadline", true],
        ["bestPriceTicker", true],
        ["totals", true],
      ],
      ids: DASHBOARD,
      enabled: true,
    },
    {
      name: "totals first, headline after the ticker",
      saved: [
        ["totals", true],
        ["spotPrices", true],
        ["bestPriceTicker", true],
        ["stackHeadline", true],
      ],
      ids: ["totals", "spotPrices", "bestPriceTicker"],
      enabled: true,
    },
    {
      name: "headline disabled, totals enabled",
      saved: [
        ["spotPrices", true],
        ["bestPriceTicker", true],
        ["stackHeadline", false],
        ["totals", true],
      ],
      ids: ["spotPrices", "bestPriceTicker", "totals"],
      enabled: true,
    },
    {
      name: "headline enabled, totals disabled",
      saved: [
        ["spotPrices", true],
        ["stackHeadline", true],
        ["bestPriceTicker", true],
        ["totals", false],
      ],
      ids: DASHBOARD,
      enabled: true,
    },
    {
      name: "both disabled",
      saved: [
        ["spotPrices", true],
        ["bestPriceTicker", true],
        ["stackHeadline", false],
        ["totals", false],
      ],
      ids: ["spotPrices", "bestPriceTicker", "totals"],
      enabled: false,
    },
    {
      name: "headline only",
      saved: [
        ["stackHeadline", false],
        ["spotPrices", true],
        ["bestPriceTicker", true],
      ],
      ids: ["totals", "spotPrices", "bestPriceTicker"],
      enabled: false,
    },
  ];
  for (const fold of folds) {
    test(`a saved stack headline and totals load as one section: ${fold.name}`, () => {
      saveLayout(fold.saved);
      const layout = loadLayout();
      assert.deepEqual(
        layout.slice(0, 3).map((s) => s.id),
        fold.ids
      );
      assert.equal(layout.filter((s) => s.id === "totals").length, 1);
      assert.deepEqual(
        layout.find((s) => s.id === "totals"),
        {
          id: "totals",
          label: "Your stack",
          enabled: fold.enabled,
        }
      );
      assert.equal(
        layout.some((s) => s.id === "stackHeadline"),
        false
      );
    });
  }
});

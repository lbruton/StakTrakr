// Unit tests for the shared ratios panel component (STRK-270).
//
// These tests ENCODE the STRK-270 acceptance criteria for the pure (string /
// math) layer of js/ratios-panel.js — the Layout C ("Signal") panel lifted
// from playground/ratios-panel-playground.html. DOM wiring and Chart.js
// drawing are covered by tests/playwright/core/ratios-panel.spec.js; this
// file locks:
//
//   ratioPanelFmt / ratioPanelOrdinal — display formatting with "—" guards.
//   ratioTrendLabel — signed magnitude vs a trailing average ("9.4% above
//     trend"), "At trend" inside ±0.05%, "—" when the average is unusable.
//   ratioMeanLineVisible — the prototype's chart defect fix: draw the
//     long-run-mean dataset only when it lands within ~35% of the visible
//     window (Au:Pt's 1.10 mean vs a 90-day window near 2.5 must hide).
//   ratioPanelHtml — Layout C structure: header + live/last-close badge,
//     in-panel pair selector (4 real buttons, aria-pressed), hero + delta,
//     labeled 52-week bar + all-time percentile (both scales named), the
//     interpretive legend gating (Au:Ag only; Pt:Pd says "Both metals are"),
//     4 trend tiles, chart range control, provenance footer.
//
// Harness: like spot-ratio-chips.test.js, both script-tag-global modules are
// evaluated with a mock `window` via new Function("window", src). The panel
// reads RATIO_PAIRS as a bare global at call time, so the surface keys are
// mirrored onto globalThis for the duration of each test.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mathSrc = readFileSync(new URL("../../js/spot-ratio-math.js", import.meta.url), "utf-8");
const panelSrc = readFileSync(new URL("../../js/ratios-panel.js", import.meta.url), "utf-8");

const surface = {
  document: { getElementById: () => null, querySelector: () => null },
};
new Function("window", mathSrc)(surface);
new Function("window", panelSrc)(surface);

// The panel reads engine globals (RATIO_PAIRS) bare; mirror the surface onto
// globalThis while the suite runs, restoring afterward.
const MIRRORED = ["RATIO_PAIRS", "RATIO_SESSIONS_PER_YEAR", "computeRatio", "formatRatio"];
const saved = {};
before(() => {
  for (const key of MIRRORED) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    globalThis[key] = surface[key];
  }
});
after(() => {
  for (const key of MIRRORED) {
    if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
    else delete globalThis[key];
  }
});

const pairById = (id) => surface.RATIO_PAIRS.find((p) => p.id === id);

/** Full stats fixture in the computeRatioStats shape (STRK-269). */
const STATS = {
  current: 63.8,
  spanStart: "1968-01-02",
  spanEnd: "2026-07-24",
  points: 14778,
  histMean: 57.2,
  median: 55.1,
  vsMeanPct: 11.5,
  percentile: 82.4,
  avg7: 62.1,
  avg30: 60.4,
  avg90: 58.8,
  avg365: 57.9,
  avg5y: 55.3,
  prevClose: 63.2,
  high52: ["2026-04-12", 68.3],
  low52: ["2025-09-02", 52.1],
  allHigh: ["2020-03-18", 125.3],
  allLow: ["1968-06-12", 14.2],
};

// =============================================================================
// Formatting helpers
// =============================================================================
describe("ratioPanelFmt / ratioPanelOrdinal", () => {
  test("formats to fixed decimals and em-dashes unusable values", () => {
    assert.equal(surface.ratioPanelFmt(63.84, 1), "63.8");
    assert.equal(surface.ratioPanelFmt(2.432, 2), "2.43");
    for (const bad of [null, undefined, NaN, Infinity]) {
      assert.equal(surface.ratioPanelFmt(bad, 1), "—", `fmt(${String(bad)})`);
    }
  });

  test("ordinal suffixes including the teens", () => {
    assert.equal(surface.ratioPanelOrdinal(1), "1st");
    assert.equal(surface.ratioPanelOrdinal(2), "2nd");
    assert.equal(surface.ratioPanelOrdinal(3), "3rd");
    assert.equal(surface.ratioPanelOrdinal(4), "4th");
    assert.equal(surface.ratioPanelOrdinal(11), "11th");
    assert.equal(surface.ratioPanelOrdinal(12), "12th");
    assert.equal(surface.ratioPanelOrdinal(13), "13th");
    assert.equal(surface.ratioPanelOrdinal(21), "21st");
    assert.equal(surface.ratioPanelOrdinal(82.4), "82nd");
  });
});

// =============================================================================
// Trend label — signed magnitude, not a bare above/below
// =============================================================================
describe("ratioTrendLabel", () => {
  test("reports signed magnitude vs the trailing average", () => {
    assert.equal(surface.ratioTrendLabel(110, 100), "10.0% above trend");
    assert.equal(surface.ratioTrendLabel(90, 100), "10.0% below trend");
  });

  test("inside ±0.05% reads as at-trend", () => {
    assert.equal(surface.ratioTrendLabel(100.0004, 100), "At trend");
    assert.equal(surface.ratioTrendLabel(100, 100), "At trend");
  });

  test("unusable averages degrade to an em dash", () => {
    for (const bad of [null, undefined, 0, -5, NaN, Infinity]) {
      assert.equal(surface.ratioTrendLabel(100, bad), "—", `avg=${String(bad)}`);
    }
  });
});

// =============================================================================
// Conditional mean line — the Au:Pt y-axis defect must not return
// =============================================================================
describe("ratioMeanLineVisible", () => {
  test("mean inside the visible window is drawn", () => {
    assert.equal(surface.ratioMeanLineVisible([90, 95, 100, 105, 110], 100), true);
  });

  test("mean just outside the window is still drawn within the 35% pad", () => {
    // window 100–110 → pad 3.5 → visible down to 96.5
    assert.equal(surface.ratioMeanLineVisible([100, 105, 110], 97), true);
  });

  test("Au:Pt-style far mean is hidden (1.10 vs a window near 2.5)", () => {
    assert.equal(surface.ratioMeanLineVisible([2.45, 2.5, 2.55], 1.1), false);
  });

  test("flat window falls back to a 10% pad instead of zero", () => {
    assert.equal(surface.ratioMeanLineVisible([100, 100, 100], 105), true);
    assert.equal(surface.ratioMeanLineVisible([100, 100, 100], 120), false);
  });

  test("empty window never draws the mean", () => {
    assert.equal(surface.ratioMeanLineVisible([], 100), false);
  });
});

// =============================================================================
// End-anchored chart thinning — the newest close must survive
// =============================================================================
describe("ratioPanelThinSeries", () => {
  const rows = Array.from({ length: 100 }, (_, i) => [`2024-${String(i).padStart(3, "0")}`, i]);

  test("keeps the newest observation on long ranges", () => {
    const pts = surface.ratioPanelThinSeries(rows, 7);
    assert.deepEqual(pts[pts.length - 1], rows[rows.length - 1]);
    assert.ok(pts.length <= 7, `expected ≤ 7 points, got ${pts.length}`);
  });

  test("preserves ascending order", () => {
    const vals = surface.ratioPanelThinSeries(rows, 7).map((p) => p[1]);
    assert.deepEqual(
      vals,
      [...vals].sort((a, b) => a - b)
    );
  });

  test("short series pass through untouched", () => {
    assert.equal(surface.ratioPanelThinSeries(rows, 420), rows);
    assert.deepEqual(surface.ratioPanelThinSeries(null, 420), []);
  });
});

// =============================================================================
// Live-badge gate — only feed-sourced quotes count as synced
// =============================================================================
describe("ratioPanelMetalIsSynced", () => {
  const withHistory = (rows, fn) => {
    const had = Object.getOwnPropertyDescriptor(globalThis, "spotHistory");
    globalThis.spotHistory = rows;
    try {
      fn();
    } finally {
      if (had) Object.defineProperty(globalThis, "spotHistory", had);
      else delete globalThis.spotHistory;
    }
  };
  const row = (metal, source) => ({ metal, source, spot: 100, timestamp: "2026-07-24 12:00:00" });

  test("a feed-sourced latest entry counts as synced", () => {
    withHistory([row("Gold", "api")], () => {
      assert.equal(surface.ratioPanelMetalIsSynced("Gold"), true);
    });
  });

  test("default, manual, and seed quotes never count as live", () => {
    for (const source of ["default", "manual", "seed"]) {
      withHistory([row("Gold", source)], () => {
        assert.equal(surface.ratioPanelMetalIsSynced("Gold"), false, source);
      });
    }
  });

  test("the LATEST entry per metal decides — a newer default overrides an old sync", () => {
    withHistory([row("Gold", "api"), row("Gold", "default")], () => {
      assert.equal(surface.ratioPanelMetalIsSynced("Gold"), false);
    });
  });

  test("empty or missing history is never synced", () => {
    withHistory([], () => {
      assert.equal(surface.ratioPanelMetalIsSynced("Gold"), false);
    });
    withHistory([row("Silver", "api")], () => {
      assert.equal(surface.ratioPanelMetalIsSynced("Gold"), false, "other metal only");
    });
  });
});

// =============================================================================
// Panel HTML — Layout C structure and copy rules
// =============================================================================
describe("ratioPanelHtml — structure", () => {
  const html = () => surface.ratioPanelHtml(pairById("au-ag"), STATS, true);

  test("root carries the denominator accent", () => {
    assert.match(html(), /class="gsr-panel" data-accent="silver"/);
  });

  test("header shows eyebrow, title, and a Live badge when live", () => {
    const h = html();
    assert.ok(h.includes("Gold ÷ Silver"), "eyebrow");
    assert.ok(h.includes(pairById("au-ag").title), "plain-English title");
    assert.match(h, /gsr-live" data-state="live"/);
    assert.ok(h.includes(">Live<") || /dot"><\/span>Live/.test(h), "Live badge text");
  });

  test("badge flips to Last close when not live", () => {
    const h = surface.ratioPanelHtml(pairById("au-ag"), STATS, false);
    assert.match(h, /gsr-live" data-state="stale"/);
    assert.ok(h.includes("Last close"));
  });

  test("in-panel pair selector renders all five pairs with aria-pressed", () => {
    const h = html();
    // Five since STRK-341 added ag-cu.
    assert.equal((h.match(/data-pair="/g) || []).length, 5);
    assert.match(h, /data-pair="au-ag" aria-pressed="true"/);
    assert.match(h, /data-pair="au-pt" aria-pressed="false"/);
    assert.match(h, /data-pair="ag-cu" aria-pressed="false"/);
    assert.match(h, /role="group" aria-label="Metal pair"/);
  });

  test("hero readout uses pair precision and delta uses one extra place", () => {
    const h = html();
    assert.ok(h.includes('>63.8<span class="unit">:1</span>'), "hero 1dp for Au:Ag");
    assert.ok(h.includes("0.60"), "delta |63.8-63.2| at 2dp");
    assert.ok(h.includes("vs prior close"));
  });

  test("both bar scales are named: 52-week range AND all-time percentile", () => {
    const h = html();
    assert.ok(h.includes("52-week range"));
    assert.ok(h.includes("82nd percentile all-time"));
    assert.ok(h.includes("mean-mark"), "long-run mean marker present");
  });

  test("Au:Ag keeps the interpretive mean-reversion line", () => {
    assert.ok(
      html().includes("silver\n             is relatively cheaper against gold") ||
        html().includes("silver is relatively cheaper against gold")
    );
  });

  test("four trend tiles carry signed-magnitude context", () => {
    const h = html();
    for (const label of ["7-day", "30-day", "90-day", "1-year"]) {
      assert.ok(h.includes(label), `${label} tile`);
    }
    assert.ok(h.includes("above trend") || h.includes("below trend"));
  });

  test("chart range control offers 30D/90D/1Y/5Y/MAX with 90D pressed by default", () => {
    const h = html();
    for (const r of ["30D", "90D", "1Y", "5Y", "MAX"]) assert.ok(h.includes(`>${r}</button>`), r);
    assert.match(h, /data-r="90" aria-pressed="true"/);
    assert.ok(h.includes("gsr-canvas"));
  });

  test("pressed range pill follows the supplied active range, not a hard-coded 90D", () => {
    const h = surface.ratioPanelHtml(pairById("au-ag"), STATS, false, "365");
    assert.match(h, /data-r="365" aria-pressed="true"/);
    assert.match(h, /data-r="90" aria-pressed="false"/);
  });

  test("footer carries provenance, span year, session count, and the disclaimer", () => {
    const h = html();
    assert.ok(h.includes("1968"), "span start year");
    assert.ok(h.includes("14,778"), "localized session count");
    assert.ok(h.includes("both metals printed"));
    assert.ok(h.includes("Not investment advice"));
    assert.ok(h.includes("trading sessions"), "sessions, not calendar days");
  });
});

describe("ratioPanelHtml — copy rules per pair", () => {
  test("Au:Pt gets neutral positional copy naming platinum, no verdict", () => {
    const h = surface.ratioPanelHtml(pairById("au-pt"), STATS, false);
    assert.ok(h.includes("Platinum is priced largely by"));
    assert.ok(h.includes("context — not a signal"));
    assert.ok(!h.includes("relatively cheaper against gold"), "no interpretive verdict");
    assert.ok(h.includes("1968-to-date mean"), "span-anchored mean label");
  });

  test("Pt:Pd says Both metals are", () => {
    const h = surface.ratioPanelHtml(pairById("pt-pd"), STATS, false);
    assert.ok(h.includes("Both metals are priced largely by"));
  });

  test("Au:Pt hero uses 2 decimals", () => {
    const stats = { ...STATS, current: 2.432, prevClose: 2.4 };
    const h = surface.ratioPanelHtml(pairById("au-pt"), stats, false);
    assert.ok(h.includes('>2.43<span class="unit">:1</span>'));
  });
});

describe("ratioPanelHtml — degraded stats", () => {
  test("null prevClose renders without NaN and without a fake delta", () => {
    const h = surface.ratioPanelHtml(pairById("au-ag"), { ...STATS, prevClose: null }, false);
    assert.ok(!h.includes("NaN"));
    assert.ok(!h.includes("vs prior close"), "no delta clause without a prior close");
  });

  test("null stats produce the empty state, not a crash", () => {
    const h = surface.ratioPanelHtml(pairById("au-ag"), null, false);
    assert.ok(h.includes("gsr-empty"));
    assert.ok(!h.includes("NaN"));
  });
});

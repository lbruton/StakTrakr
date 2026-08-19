// Unit tests for the StakTrakr hourly-backfill window decision (STRK-343).
//
// Root cause being locked in: backfillStaktrakrHourly's "fresh load vs
// incremental" check was GLOBAL across metals — any recent api-hourly row
// (always true on an existing profile via the legacy four) forced the 24 h
// window, so a newly added metal (copper, STRK-303/306) never received its
// 7-day deep backfill and its sparkline flat-lined on every ≤180d range.
//
// The invariant (hardened in review): the 24 h fast path is allowed only when
// EVERY metal in METALS has BOTH
//   (a) a recent api-hourly row (within 24 h), AND
//   (b) deep hourly coverage (an api-hourly row at least 6 days old — proof a
//       7-day pull has already landed for that metal).
// Requirement (b) exists because a profile that kept syncing after a new
// metal shipped accrues recent rows for it immediately, while still missing
// the trailing week — recency alone would strand exactly the cohort this fix
// repairs (Codex review, PR #1465). purgeSpotHistory retains 180 days, so
// deep rows persist far beyond the 6-day threshold.
//
// Timestamps are compared in the UTC frame: stored rows are UTC-naive
// ("YYYY-MM-DD HH:MM:SS", Z stripped by the writer), and parsing them as
// local time makes rows look up to a day newer in negative UTC offsets —
// enough to wrongly skip the deep pull at the boundary.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evalConstantsWindow, extractConstFn } from "./helpers/source-extract.js";

const { METALS } = evalConstantsWindow();
assert.ok(METALS, "METALS must load from constants.js");

const apiSrc = readFileSync(new URL("../../js/api.js", import.meta.url), "utf-8");
const hoursBackFor = extractConstFn(apiSrc, "_staktrakrBackfillHoursBack", { METALS });

// Fixture rows mirror the writer exactly: UTC ISO with "T"→" " and no "Z"
// (_fetchStaktrakrHourlyRangeV2's stored shape).
const NOW = Date.UTC(2026, 7, 16, 12, 0, 0);
const tsHoursAgo = (h) => new Date(NOW - h * 3600000).toISOString().replace("T", " ").slice(0, 19);

const row = (metal, hoursAgo, source = "api-hourly") => ({
  metal,
  source,
  spot: 1,
  timestamp: tsHoursAgo(hoursAgo),
});

// Full coverage for a metal: one recent row + one deep row (150 h ≥ the
// 144 h deep threshold).
const covered = (metal) => [row(metal, 2), row(metal, 150)];

const LEGACY_FOUR = ["Gold", "Silver", "Platinum", "Palladium"];
const ALL_METALS = Object.values(METALS).map((m) => m.name);

describe("STRK-343 — _staktrakrBackfillHoursBack requires per-metal recency AND depth", () => {
  test("legacy four covered but copper absent → 7-day window (the STRK-343 bug case)", () => {
    const history = LEGACY_FOUR.flatMap(covered);
    assert.equal(hoursBackFor(history, NOW), 7 * 24);
  });

  test("every METALS entry recent AND deep → 24 h incremental window", () => {
    const history = ALL_METALS.flatMap(covered);
    assert.equal(hoursBackFor(history, NOW), 24);
  });

  test("copper recent but shallow (no ≥6-day row) → 7-day window (post-ship sync cohort)", () => {
    const history = [...LEGACY_FOUR.flatMap(covered), row("Copper", 2)];
    assert.equal(hoursBackFor(history, NOW), 7 * 24);
  });

  test("copper deep but not recent (idle profile) → 7-day window", () => {
    const history = [...LEGACY_FOUR.flatMap(covered), row("Copper", 150)];
    assert.equal(hoursBackFor(history, NOW), 7 * 24);
  });

  test("empty history (fresh profile) → 7-day window", () => {
    assert.equal(hoursBackFor([], NOW), 7 * 24);
  });

  test("rows with non-hourly sources do not count as coverage", () => {
    const history = ALL_METALS.flatMap((m) => [row(m, 2, "api"), row(m, 150, "api")]);
    assert.equal(hoursBackFor(history, NOW), 7 * 24);
  });

  test("boundaries: 24 h counts as recent, 144 h counts as deep", () => {
    const history = [...LEGACY_FOUR.flatMap(covered), row("Copper", 24), row("Copper", 144)];
    assert.equal(hoursBackFor(history, NOW), 24);
  });

  test("timestamps are compared in the UTC frame — a 25 h-old row is stale in every timezone", () => {
    // With local-frame parsing, a UTC-naive row 25 h old looks ≤24 h old on
    // any machine west of UTC and would wrongly take the fast path.
    const history = [...LEGACY_FOUR.flatMap(covered), row("Copper", 25), row("Copper", 150)];
    assert.equal(hoursBackFor(history, NOW), 7 * 24);
  });
});

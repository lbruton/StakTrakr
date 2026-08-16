// Unit tests for the StakTrakr hourly-backfill window decision (STRK-343).
//
// Root cause being locked in: backfillStaktrakrHourly's "fresh load vs
// incremental" check was GLOBAL across metals — any recent api-hourly row
// (always true on an existing profile via the legacy four) forced the 24 h
// window, so a newly added metal (copper, STRK-303/306) never received its
// 7-day deep backfill and its sparkline flat-lined on every ≤180d range.
// Incognito/fresh profiles took the 7-day branch and rendered fine — every
// EXISTING user was in the broken bucket.
//
// The invariant: the 24 h fast path is allowed only when EVERY metal in
// METALS has a recent api-hourly row. Otherwise the whole pull extends to
// 7×24 so the newest metal self-heals. Deriving the tracked set from METALS
// means the next metal addition inherits this behavior with no new code.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// --- constants.js: whole-file eval with a mock window (same harness as
// spot-provider-symbols.test.js) ---
const constSrc = readFileSync(new URL("../../js/constants.js", import.meta.url), "utf-8");
const win = {
  location: { search: "", protocol: "https:" },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
new Function("window", constSrc)(win);

const { METALS } = win;
assert.ok(METALS, "METALS must load from constants.js");

// --- extract _staktrakrBackfillHoursBack from api.js source ---
const apiSrc = readFileSync(new URL("../../js/api.js", import.meta.url), "utf-8");

const extractArrowFn = (src, name) => {
  const match = src.match(new RegExp(`const ${name} = (\\([\\s\\S]*?\\n\\});`));
  assert.ok(match, `could not locate const ${name} arrow function in js/api.js`);
  return new Function("METALS", `return ${match[1]};`)(METALS);
};

const hoursBackFor = extractArrowFn(apiSrc, "_staktrakrBackfillHoursBack");

// History entries use the app's stored timestamp shape: "YYYY-MM-DD HH:MM:SS"
// (local frame — matches how _fetchStaktrakrHourlyRangeV2 records rows).
const NOW = new Date("2026-08-16T12:00:00").getTime();
const tsHoursAgo = (h) => {
  const d = new Date(NOW - h * 3600000);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
};

const row = (metal, hoursAgo, source = "api-hourly") => ({
  metal,
  source,
  spot: 1,
  timestamp: tsHoursAgo(hoursAgo),
});

const LEGACY_FOUR = ["Gold", "Silver", "Platinum", "Palladium"];
const ALL_METALS = Object.values(METALS).map((m) => m.name);

describe("STRK-343 — _staktrakrBackfillHoursBack is per-metal, not global", () => {
  test("legacy four recent but copper absent → 7-day window (the STRK-343 bug case)", () => {
    const history = LEGACY_FOUR.map((m) => row(m, 2));
    assert.equal(hoursBackFor(history, NOW), 7 * 24);
  });

  test("every METALS entry recent → 24 h incremental window", () => {
    const history = ALL_METALS.map((m) => row(m, 2));
    assert.equal(hoursBackFor(history, NOW), 24);
  });

  test("empty history (fresh profile) → 7-day window", () => {
    assert.equal(hoursBackFor([], NOW), 7 * 24);
  });

  test("recent rows with non-hourly sources do not count as coverage", () => {
    const history = ALL_METALS.map((m) => row(m, 2, "api"));
    assert.equal(hoursBackFor(history, NOW), 7 * 24);
  });

  test("a metal whose newest api-hourly row is older than 24 h → 7-day window", () => {
    const history = [...LEGACY_FOUR.map((m) => row(m, 2)), row("Copper", 30)];
    assert.equal(hoursBackFor(history, NOW), 7 * 24);
  });

  test("copper row exactly at the 24 h boundary still counts as recent", () => {
    const history = [...LEGACY_FOUR.map((m) => row(m, 2)), row("Copper", 24)];
    assert.equal(hoursBackFor(history, NOW), 24);
  });
});

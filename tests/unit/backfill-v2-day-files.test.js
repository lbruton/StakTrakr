// Unit tests for the pure helpers in devops/pollers/shared/backfill-v2-day-files.js
// (STRK-345: backfill a metal's v2 per-day files from year-file daily history).
// Run: npm run test:unit
//
// Why this tool exists: the STRK-302 copper epic pre-seeded copper's DEEP
// history as daily rows (year files / bundle / sqld-era), but the v2 per-day
// hourly archive (data/v2/spot/{iso}/YYYY/MM/DD.json) only begins at each
// metal's poller go-live — copper's first day file is 2026-08-15 while the
// legacy metals' archive floor is 2026-03-25. sqld cannot source the gap
// (spot_prices only reaches back to 2026-02, copper rows only from go-live),
// so the backfill reads the year files and emits one honest single-sample
// OHLCA entry per day (open=high=low=close=avg, n:1, t at noon UTC — the
// daily row's own frame).
//
// The script lazy-guards its main() (fs writes) so importing the helpers here
// has no side effects.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sep } from "node:path";

import {
  parseArgs,
  enumerateDates,
  dailyRowsByDay,
  buildDayEntry,
  dayFilePathFor,
} from "../../devops/pollers/shared/backfill-v2-day-files.js";

describe("parseArgs", () => {
  it("parses --metal/--from/--to/--source and flags", () => {
    const opts = parseArgs([
      "--metal",
      "xcu",
      "--from",
      "2026-03-25",
      "--to",
      "2026-08-14",
      "--source",
      "/tmp/spot-history-2026.json",
      "--dry-run",
    ]);
    assert.deepEqual(opts, {
      metal: "xcu",
      from: "2026-03-25",
      to: "2026-08-14",
      source: "/tmp/spot-history-2026.json",
      overwrite: false,
      dryRun: true,
    });
  });

  it("defaults --to to --from (single day) and lowercases the metal", () => {
    const opts = parseArgs(["--metal", "XCU", "--from", "2026-06-01"]);
    assert.equal(opts.to, "2026-06-01");
    assert.equal(opts.metal, "xcu");
  });

  it("requires --metal and --from", () => {
    assert.throws(() => parseArgs(["--from", "2026-06-01"]), /--metal/);
    assert.throws(() => parseArgs(["--metal", "xcu"]), /--from/);
  });

  it("rejects an unknown metal iso code", () => {
    assert.throws(() => parseArgs(["--metal", "xrh", "--from", "2026-06-01"]), /unknown metal/i);
  });

  it("rejects malformed and impossible calendar dates", () => {
    assert.throws(() => parseArgs(["--metal", "xcu", "--from", "2026-6-1"]), /YYYY-MM-DD/);
    assert.throws(() => parseArgs(["--metal", "xcu", "--from", "2026-02-31"]), /invalid calendar/i);
  });
});

describe("enumerateDates", () => {
  it("enumerates inclusive UTC dates across a month boundary", () => {
    assert.deepEqual(enumerateDates("2026-03-30", "2026-04-02"), [
      "2026-03-30",
      "2026-03-31",
      "2026-04-01",
      "2026-04-02",
    ]);
  });

  it("rejects a reversed range and enforces the sanity cap", () => {
    assert.throws(() => enumerateDates("2026-04-02", "2026-03-30"), /before/);
    assert.throws(() => enumerateDates("2020-01-01", "2026-01-01"), /cap/i);
  });
});

describe("dailyRowsByDay", () => {
  const rows = [
    { spot: 0.4126, metal: "Copper", source: "sqld", timestamp: "2026-06-01 12:00:00" },
    { spot: 0.42, metal: "Copper", source: "sqld", timestamp: "2026-06-02 12:00:00" },
    { spot: 64.7, metal: "Silver", source: "sqld", timestamp: "2026-06-01 12:00:00" },
    { spot: -1, metal: "Copper", source: "sqld", timestamp: "2026-06-03 12:00:00" },
  ];

  it("indexes only the requested metal's valid rows by day", () => {
    const byDay = dailyRowsByDay(rows, "Copper");
    assert.deepEqual([...byDay.keys()].sort(), ["2026-06-01", "2026-06-02"]);
    assert.equal(byDay.get("2026-06-01").spot, 0.4126);
  });

  it("keeps the last row when a day repeats (later source wins)", () => {
    const dup = [
      { spot: 0.41, metal: "Copper", source: "seed", timestamp: "2026-06-01 12:00:00" },
      { spot: 0.4126, metal: "Copper", source: "sqld", timestamp: "2026-06-01 12:00:00" },
    ];
    assert.equal(dailyRowsByDay(dup, "Copper").get("2026-06-01").spot, 0.4126);
  });
});

describe("buildDayEntry", () => {
  it("emits an honest single-sample OHLCA entry at noon UTC", () => {
    const entry = buildDayEntry("2026-06-01", 0.4126);
    assert.deepEqual(entry, {
      t: "2026-06-01T12:00:00Z",
      ts: Date.UTC(2026, 5, 1, 12) / 1000,
      open: 0.4126,
      high: 0.4126,
      low: 0.4126,
      close: 0.4126,
      avg: 0.4126,
      n: 1,
    });
  });
});

describe("dayFilePathFor", () => {
  it("builds the v2 day-file path", () => {
    const p = dayFilePathFor("/data", "xcu", "2026-06-01");
    assert.equal(p, ["/data", "v2", "spot", "xcu", "2026", "06", "01.json"].join(sep));
  });

  it("refuses path traversal in the metal segment", () => {
    assert.throws(() => dayFilePathFor("/data", "../evil", "2026-06-01"), /traversal|unknown/i);
  });
});

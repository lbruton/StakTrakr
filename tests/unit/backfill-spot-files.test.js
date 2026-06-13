// Unit tests for the pure helpers in devops/pollers/shared/backfill-spot-files.js
// (STRK-187 sqld→hourly-JSON reverse backfill).
// Run: npm run test:unit
//
// The script lazy-imports its sqld client inside main(), so importing the
// helpers here needs no @libsql/client install and has no side effects.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sep } from "node:path";

import {
  parseArgs,
  enumerateHours,
  hourlyPathFor,
  rowsToEntries,
  isoToSpaceTs,
} from "../../devops/pollers/shared/backfill-spot-files.js";

describe("parseArgs", () => {
  it("parses --from/--to and flags", () => {
    const opts = parseArgs(["--from", "2026-06-11T06", "--to", "2026-06-11T13", "--dry-run"]);
    assert.deepEqual(opts, {
      from: "2026-06-11T06",
      to: "2026-06-11T13",
      overwrite: false,
      dryRun: true,
    });
  });

  it("defaults --to to --from (single hour)", () => {
    const opts = parseArgs(["--from", "2026-06-11T06"]);
    assert.equal(opts.to, "2026-06-11T06");
  });

  it("requires --from", () => {
    assert.throws(() => parseArgs([]), /--from/);
  });

  it("rejects malformed hour strings", () => {
    assert.throws(() => parseArgs(["--from", "2026-06-11"]), /YYYY-MM-DDTHH/);
    assert.throws(() => parseArgs(["--from", "2026-06-11T6"]), /YYYY-MM-DDTHH/);
    assert.throws(() => parseArgs(["--from", "2026-06-11T24"]), /YYYY-MM-DDTHH/);
  });

  it("rejects unknown arguments", () => {
    assert.throws(() => parseArgs(["--frmo", "2026-06-11T06"]), /Unknown argument/);
  });
});

describe("enumerateHours", () => {
  it("enumerates an inclusive range", () => {
    assert.deepEqual(enumerateHours("2026-06-11T06", "2026-06-11T08"), [
      "2026-06-11T06",
      "2026-06-11T07",
      "2026-06-11T08",
    ]);
  });

  it("returns a single hour when from == to", () => {
    assert.deepEqual(enumerateHours("2026-06-11T06", "2026-06-11T06"), ["2026-06-11T06"]);
  });

  it("rolls over day boundaries", () => {
    assert.deepEqual(enumerateHours("2026-06-30T23", "2026-07-01T01"), [
      "2026-06-30T23",
      "2026-07-01T00",
      "2026-07-01T01",
    ]);
  });

  it("rejects reversed ranges", () => {
    assert.throws(() => enumerateHours("2026-06-11T13", "2026-06-11T06"), /before/);
  });

  it("rejects ranges beyond the sanity cap", () => {
    assert.throws(() => enumerateHours("2024-01-01T00", "2026-01-01T00"), /sanity cap/);
  });
});

describe("hourlyPathFor", () => {
  it("builds the spot-extract hourly layout with zero-padding", () => {
    const p = hourlyPathFor("/data/export", "2026-06-11T06");
    assert.equal(p, ["/data/export", "hourly", "2026", "06", "11", "06.json"].join(sep));
  });
});

describe("isoToSpaceTs", () => {
  it("converts ISO-Z to the space-separated hourly format", () => {
    assert.equal(isoToSpaceTs("2026-06-11T06:05:00Z"), "2026-06-11 06:05:00");
  });

  it("tolerates fractional seconds and missing Z", () => {
    assert.equal(isoToSpaceTs("2026-06-11T06:05:00.000Z"), "2026-06-11 06:05:00");
    assert.equal(isoToSpaceTs("2026-06-11T06:05:00"), "2026-06-11 06:05:00");
  });
});

describe("rowsToEntries", () => {
  const row = (metal, spot, floor, ts) => ({
    metal,
    spot,
    timestamp_floor: floor,
    timestamp: ts,
  });

  const fullHour = [
    row("gold", 3380.1, "2026-06-11T06:00:00Z", "2026-06-11T06:05:00Z"),
    row("silver", 48.2, "2026-06-11T06:00:00Z", "2026-06-11T06:05:00Z"),
    row("platinum", 1410.5, "2026-06-11T06:00:00Z", "2026-06-11T06:05:00Z"),
    row("palladium", 1320.7, "2026-06-11T06:00:00Z", "2026-06-11T06:05:00Z"),
  ];

  it("emits the four metals in spot-extract order with the exact entry shape", () => {
    const entries = rowsToEntries(fullHour);
    assert.deepEqual(entries, [
      {
        spot: 3380.1,
        metal: "Gold",
        source: "hourly",
        provider: "StakTrakr",
        timestamp: "2026-06-11 06:05:00",
      },
      {
        spot: 48.2,
        metal: "Silver",
        source: "hourly",
        provider: "StakTrakr",
        timestamp: "2026-06-11 06:05:00",
      },
      {
        spot: 1410.5,
        metal: "Platinum",
        source: "hourly",
        provider: "StakTrakr",
        timestamp: "2026-06-11 06:05:00",
      },
      {
        spot: 1320.7,
        metal: "Palladium",
        source: "hourly",
        provider: "StakTrakr",
        timestamp: "2026-06-11 06:05:00",
      },
    ]);
  });

  it("picks the latest row per metal (max timestamp_floor — overwrite-wins-last)", () => {
    const twoPolls = [
      ...fullHour,
      row("gold", 3390.9, "2026-06-11T06:30:00Z", "2026-06-11T06:35:00Z"),
      row("silver", 48.9, "2026-06-11T06:30:00Z", "2026-06-11T06:35:00Z"),
      row("platinum", 1411.0, "2026-06-11T06:30:00Z", "2026-06-11T06:35:00Z"),
      row("palladium", 1321.0, "2026-06-11T06:30:00Z", "2026-06-11T06:35:00Z"),
    ];
    const entries = rowsToEntries(twoPolls);
    assert.equal(entries[0].spot, 3390.9);
    assert.equal(entries[0].timestamp, "2026-06-11 06:35:00");
  });

  it("returns null when a metal is missing", () => {
    assert.equal(rowsToEntries(fullHour.slice(0, 3)), null);
  });

  it("returns null on empty or undefined input", () => {
    assert.equal(rowsToEntries([]), null);
    assert.equal(rowsToEntries(undefined), null);
  });
});

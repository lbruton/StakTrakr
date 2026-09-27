/**
 * Public spot-history-YYYY.json year file (STRK-403).
 *
 * The API copy of data/spot-history-YYYY.json froze at 2026-02-26 when the
 * Python seed poller retired. api-export.js now rewrites it from sqld every
 * publish. These tests pin the rule it shares with update-spot-bundle.py:
 *
 *   - one entry per (metal, UTC day) = AVG(spot), stamped "YYYY-MM-DD 12:00:00"
 *   - COMPLETE UTC days only — never the day in progress (a partial average
 *     frozen into the file is exactly the repo-side bug this issue found)
 *   - aggregated in SQL, never raw rows over Hrana (RESPONSE_TOO_LARGE, STRK-407)
 *   - sqld fills missing (date, metal) keys and replaces its own earlier
 *     "sqld" entries; a "seed" entry is never overwritten
 *
 * spot-year-history.js is dependency-free (node built-ins only), so it imports
 * without the poller's container-only packages.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  yearsToRefresh,
  dailyAverageWindow,
  sqldRowsToEntries,
  mergeYearEntries,
  querySpotDailyAverages,
  refreshSpotYearFiles,
} from "./spot-year-history.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Fake Hrana client that records every statement and returns canned rows. */
const fakeClient = (rows) => {
  const calls = [];
  return {
    calls,
    execute: async (stmt) => {
      calls.push(stmt);
      return { rows };
    },
  };
};

const silent = () => {};

// --- yearsToRefresh ---------------------------------------------------------

test("yearsToRefresh: mid-year refreshes only the current UTC year", () => {
  assert.deepEqual(yearsToRefresh(new Date("2026-09-27T17:00:00Z")), [2026]);
});

test("yearsToRefresh: Jan 1-7 UTC also refreshes the previous year so Dec 31 lands", () => {
  assert.deepEqual(yearsToRefresh(new Date("2027-01-01T00:05:00Z")), [2026, 2027]);
  assert.deepEqual(yearsToRefresh(new Date("2027-01-07T23:59:00Z")), [2026, 2027]);
  assert.deepEqual(yearsToRefresh(new Date("2027-01-08T00:00:00Z")), [2027]);
});

test("yearsToRefresh: uses the UTC year, not the local year", () => {
  // 2026-12-31 20:00 in America/Chicago is already 2027-01-01 in UTC.
  assert.deepEqual(yearsToRefresh(new Date("2027-01-01T02:00:00Z")), [2026, 2027]);
});

// --- dailyAverageWindow -----------------------------------------------------

test("dailyAverageWindow: current year ends at the start of today (complete days only)", () => {
  assert.deepEqual(dailyAverageWindow(2026, new Date("2026-09-27T17:23:00Z")), {
    startIso: "2026-01-01T00:00:00Z",
    endIso: "2026-09-27T00:00:00Z",
  });
});

test("dailyAverageWindow: a past year covers the whole year", () => {
  assert.deepEqual(dailyAverageWindow(2026, new Date("2027-01-03T08:00:00Z")), {
    startIso: "2026-01-01T00:00:00Z",
    endIso: "2027-01-01T00:00:00Z",
  });
});

test("dailyAverageWindow: Jan 1 of the current year has no complete day yet", () => {
  assert.equal(dailyAverageWindow(2027, new Date("2027-01-01T09:00:00Z")), null);
});

// --- sqldRowsToEntries ------------------------------------------------------

test("sqldRowsToEntries: maps an aggregate row to the seed entry shape", () => {
  const entries = sqldRowsToEntries([{ metal: "gold", day: "2026-06-15", spot: 4328.0249 }]);
  assert.deepEqual(entries, [
    { spot: 4328.02, metal: "Gold", source: "sqld", timestamp: "2026-06-15 12:00:00" },
  ]);
});

test("sqldRowsToEntries: sub-dollar copper keeps 4 decimals", () => {
  const [entry] = sqldRowsToEntries([{ metal: "copper", day: "2026-09-26", spot: 0.420712 }]);
  assert.equal(entry.spot, 0.4207);
  assert.equal(entry.metal, "Copper");
});

test("sqldRowsToEntries: drops unknown metals and non-finite spots", () => {
  const entries = sqldRowsToEntries([
    { metal: "rhodium", day: "2026-06-15", spot: 5000 },
    { metal: "gold", day: "2026-06-15", spot: null },
    { metal: "silver", day: "2026-06-15", spot: "not-a-number" },
    { metal: "silver", day: "2026-06-15", spot: "70.4" },
  ]);
  assert.deepEqual(
    entries.map((e) => [e.metal, e.spot]),
    [["Silver", 70.4]]
  );
});

// --- mergeYearEntries -------------------------------------------------------

test("mergeYearEntries: sqld replaces a stale partial-day value for the same (date, metal)", () => {
  const existing = [
    { spot: 4285.13, metal: "Gold", source: "sqld", timestamp: "2026-09-26 12:00:00" },
  ];
  const fresh = [
    { spot: 4285.06, metal: "Gold", source: "sqld", timestamp: "2026-09-26 12:00:00" },
  ];
  assert.deepEqual(mergeYearEntries(existing, fresh), fresh);
});

test("mergeYearEntries: preserves entries sqld cannot cover (pre-sqld seed, copper backfill)", () => {
  const seed = {
    spot: 4386.85,
    metal: "Gold",
    source: "seed",
    provider: "LBMA",
    timestamp: "2026-01-02 12:00:00",
  };
  const copperBackfill = {
    spot: 0.4086,
    metal: "Copper",
    source: "seed",
    provider: "StakTrakr",
    timestamp: "2026-06-15 12:00:00",
  };
  const fresh = [
    { spot: 4328.02, metal: "Gold", source: "sqld", timestamp: "2026-06-15 12:00:00" },
  ];
  const merged = mergeYearEntries([seed, copperBackfill], fresh);
  assert.deepEqual(merged, [seed, copperBackfill, fresh[0]]);
});

test("mergeYearEntries: never overwrites a seed entry, even when sqld has the same (date, metal)", () => {
  // sqld's first days were sparse (1 sample/day Feb 17-20; copper 44/96 on
  // 2026-08-15). The seed values (MetalPriceAPI daily, STRK-304 backfill) are
  // better data than a 1-sample average.
  const seed = {
    spot: 5065.11,
    metal: "Gold",
    source: "seed",
    provider: "MetalPriceAPI",
    timestamp: "2026-02-20 12:00:00",
  };
  const fresh = [
    { spot: 5105.27, metal: "Gold", source: "sqld", timestamp: "2026-02-20 12:00:00" },
  ];
  assert.deepEqual(mergeYearEntries([seed], fresh), [seed]);
});

test("mergeYearEntries: fills a gap day that the existing file is missing", () => {
  const existing = [
    { spot: 1, metal: "Gold", source: "sqld", timestamp: "2026-02-26 12:00:00" },
    { spot: 3, metal: "Gold", source: "sqld", timestamp: "2026-03-10 12:00:00" },
  ];
  const fresh = [{ spot: 2, metal: "Gold", source: "sqld", timestamp: "2026-02-27 12:00:00" }];
  assert.deepEqual(
    mergeYearEntries(existing, fresh).map((e) => e.timestamp.slice(0, 10)),
    ["2026-02-26", "2026-02-27", "2026-03-10"]
  );
});

test("mergeYearEntries: sorts by date, then metal name — deterministic output", () => {
  const e = (metal, day) => ({ spot: 1, metal, source: "sqld", timestamp: `${day} 12:00:00` });
  const merged = mergeYearEntries(
    [e("Silver", "2026-03-11"), e("Gold", "2026-03-10")],
    [e("Copper", "2026-03-11"), e("Platinum", "2026-03-10"), e("Palladium", "2026-03-10")]
  );
  assert.deepEqual(
    merged.map((x) => `${x.timestamp.slice(0, 10)} ${x.metal}`),
    [
      "2026-03-10 Gold",
      "2026-03-10 Palladium",
      "2026-03-10 Platinum",
      "2026-03-11 Copper",
      "2026-03-11 Silver",
    ]
  );
});

test("mergeYearEntries: the repo 2026 file merged with its own sqld entries is unchanged in content", () => {
  // Parity with update-spot-bundle.py: both writers apply the same rule, so
  // re-deriving the sqld-sourced entries from the file itself is a no-op.
  const repo = JSON.parse(readFileSync(join(REPO_ROOT, "data/spot-history-2026.json"), "utf8"));
  const sqldOnly = repo.filter((x) => x.source === "sqld");
  const key = (x) => `${x.timestamp.slice(0, 10)}|${x.metal}`;
  const asMap = (list) => new Map(list.map((x) => [key(x), x]));
  assert.deepEqual(asMap(mergeYearEntries(repo, sqldOnly)), asMap(repo));
});

// --- querySpotDailyAverages -------------------------------------------------

test("querySpotDailyAverages: aggregates in SQL over a half-open window, never SELECT *", async () => {
  const client = fakeClient([{ metal: "gold", day: "2026-06-15", spot: 4328.02 }]);
  const rows = await querySpotDailyAverages(client, "2026-01-01T00:00:00Z", "2026-09-27T00:00:00Z");
  assert.equal(rows.length, 1);
  const [{ sql, args }] = client.calls;
  assert.doesNotMatch(sql, /SELECT\s+\*/i);
  assert.match(sql, /AVG\(spot\)/i);
  assert.match(sql, /GROUP BY/i);
  // Rounded in SQL, not in JS/Python: Math.round (half-up) and Python round()
  // (half-even) disagree on rare .xx5 values, which would break writer parity.
  assert.match(sql, /ROUND\(AVG\(spot\),\s*4\)/i);
  assert.match(sql, /ROUND\(AVG\(spot\),\s*2\)/i);
  assert.match(sql, /timestamp_floor\s*>=\s*\?/i);
  assert.match(sql, /timestamp_floor\s*<\s*\?/i);
  assert.deepEqual(args, ["2026-01-01T00:00:00Z", "2026-09-27T00:00:00Z"]);
});

// --- refreshSpotYearFiles (I/O) ---------------------------------------------

const tmpDataDir = () => mkdtempSync(join(tmpdir(), "strk403-"));

test("refreshSpotYearFiles: merges sqld days into the existing year file and keeps the seed", async () => {
  const dataDir = tmpDataDir();
  const path = join(dataDir, "spot-history-2026.json");
  const seed = {
    spot: 4386.85,
    metal: "Gold",
    source: "seed",
    provider: "LBMA",
    timestamp: "2026-01-02 12:00:00",
  };
  writeFileSync(path, JSON.stringify([seed]));
  const client = fakeClient([{ metal: "gold", day: "2026-09-26", spot: 4285.06 }]);

  const result = await refreshSpotYearFiles({
    client,
    dataDir,
    now: new Date("2026-09-27T17:08:00Z"),
    log: silent,
    warn: silent,
  });

  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), [
    seed,
    { spot: 4285.06, metal: "Gold", source: "sqld", timestamp: "2026-09-26 12:00:00" },
  ]);
  assert.deepEqual(result, [{ year: 2026, written: true, entries: 2 }]);
  assert.deepEqual(client.calls[0].args, ["2026-01-01T00:00:00Z", "2026-09-27T00:00:00Z"]);
});

test("refreshSpotYearFiles: creates the file when none exists yet", async () => {
  const dataDir = tmpDataDir();
  const client = fakeClient([{ metal: "silver", day: "2026-09-26", spot: 64.3 }]);
  await refreshSpotYearFiles({
    client,
    dataDir,
    now: new Date("2026-09-27T17:08:00Z"),
    log: silent,
    warn: silent,
  });
  const written = JSON.parse(readFileSync(join(dataDir, "spot-history-2026.json"), "utf8"));
  assert.equal(written.length, 1);
  assert.equal(written[0].metal, "Silver");
});

test("refreshSpotYearFiles: does not rewrite an unchanged file (no git churn every publish)", async () => {
  const dataDir = tmpDataDir();
  const client = fakeClient([{ metal: "gold", day: "2026-09-26", spot: 4285.06 }]);
  const opts = {
    client,
    dataDir,
    now: new Date("2026-09-27T17:08:00Z"),
    log: silent,
    warn: silent,
  };
  await refreshSpotYearFiles(opts);
  const path = join(dataDir, "spot-history-2026.json");
  const before = statSync(path).mtimeMs;
  await new Promise((r) => setTimeout(r, 20));
  const result = await refreshSpotYearFiles(opts);
  assert.equal(statSync(path).mtimeMs, before);
  assert.deepEqual(result, [{ year: 2026, written: false, entries: 1 }]);
});

test("refreshSpotYearFiles: an unparsable existing file is left alone, never clobbered", async () => {
  const dataDir = tmpDataDir();
  const path = join(dataDir, "spot-history-2026.json");
  writeFileSync(path, "{ not json");
  const warnings = [];
  const client = fakeClient([{ metal: "gold", day: "2026-09-26", spot: 4285.06 }]);
  const result = await refreshSpotYearFiles({
    client,
    dataDir,
    now: new Date("2026-09-27T17:08:00Z"),
    log: silent,
    warn: (m) => warnings.push(m),
  });
  assert.equal(readFileSync(path, "utf8"), "{ not json");
  assert.deepEqual(result, [{ year: 2026, written: false, entries: 0 }]);
  assert.equal(warnings.length, 1);
});

test("refreshSpotYearFiles: zero sqld rows leaves the existing file untouched", async () => {
  const dataDir = tmpDataDir();
  const result = await refreshSpotYearFiles({
    client: fakeClient([]),
    dataDir,
    now: new Date("2026-09-27T17:08:00Z"),
    log: silent,
    warn: silent,
  });
  assert.equal(existsSync(join(dataDir, "spot-history-2026.json")), false);
  assert.deepEqual(result, [{ year: 2026, written: false, entries: 0 }]);
});

test("refreshSpotYearFiles: dryRun reports but writes nothing", async () => {
  const dataDir = tmpDataDir();
  const result = await refreshSpotYearFiles({
    client: fakeClient([{ metal: "gold", day: "2026-09-26", spot: 4285.06 }]),
    dataDir,
    now: new Date("2026-09-27T17:08:00Z"),
    dryRun: true,
    log: silent,
    warn: silent,
  });
  assert.equal(existsSync(join(dataDir, "spot-history-2026.json")), false);
  assert.deepEqual(result, [{ year: 2026, written: false, entries: 1 }]);
});

test("refreshSpotYearFiles: Jan 1 writes the previous year only (current year has no complete day)", async () => {
  const dataDir = tmpDataDir();
  const client = fakeClient([{ metal: "gold", day: "2026-12-31", spot: 4400 }]);
  const result = await refreshSpotYearFiles({
    client,
    dataDir,
    now: new Date("2027-01-01T00:08:00Z"),
    log: silent,
    warn: silent,
  });
  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0].args, ["2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z"]);
  assert.deepEqual(result, [{ year: 2026, written: true, entries: 1 }]);
  assert.equal(existsSync(join(dataDir, "spot-history-2027.json")), false);
});

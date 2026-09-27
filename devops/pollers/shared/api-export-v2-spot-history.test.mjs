/**
 * v2 spot history windows (STRK-407).
 *
 * spot/history/90d.json froze at 2026-05-22: exportSpot() pulled every raw
 * spot_prices column for all five metals over the window in one query
 * (~43k rows for 90 days), which sqld rejects with RESPONSE_TOO_LARGE. The
 * fix keeps the JS OHLCA bucketing (so 7d/30d output is unchanged) but asks
 * sqld for one metal at a time and only the three columns the bucketing reads.
 *
 * api-export-v2.js is import-safe: better-sqlite3 is lazy-imported inside
 * main(), and main() only runs when the module is the process entrypoint.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { querySpotRange, buildSpotHistory } from "./api-export-v2.js";

const METALS = ["gold", "silver", "platinum", "palladium", "copper"];
const ISO = { gold: "xau", silver: "xag", platinum: "xpt", palladium: "xpd", copper: "xcu" };

/**
 * Fake Hrana client over an in-memory spot_prices table. Honours the
 * [startIso, endIso, metal?] argument contract so a query that forgets the
 * metal filter returns every metal (and the size test below catches it).
 */
const fakeClient = (table) => {
  const calls = [];
  return {
    calls,
    execute: async ({ sql, args }) => {
      calls.push({ sql, args });
      const [startIso, endIso, metal] = args;
      const rows = table
        .filter((r) => r.timestamp_floor >= startIso && r.timestamp_floor < endIso)
        .filter((r) => metal === undefined || r.metal === metal)
        .sort((a, b) =>
          a.metal === b.metal
            ? a.timestamp_floor.localeCompare(b.timestamp_floor)
            : a.metal.localeCompare(b.metal)
        );
      return { rows };
    },
  };
};

/** 15-minute samples for every metal over [start, end), price rising by 1 per sample. */
const buildTable = (startMs, endMs) => {
  const table = [];
  for (const metal of METALS) {
    let price = 100;
    for (let t = startMs; t < endMs; t += 15 * 60 * 1000) {
      table.push({
        id: table.length,
        metal,
        spot: price++,
        source: "metalprice-api",
        poller_id: "api",
        timestamp: new Date(t).toISOString().replace(".000Z", "Z"),
        timestamp_floor: new Date(t).toISOString().replace(".000Z", "Z"),
        scraped_at: new Date(t).toISOString(),
      });
    }
  }
  return table;
};

const NOW = new Date("2026-09-27T17:53:00Z");
const TABLE = buildTable(Date.parse("2026-06-20T00:00:00Z"), NOW.getTime());

// --- querySpotRange ---------------------------------------------------------

test("querySpotRange: selects only metal, spot, timestamp_floor — never SELECT *", async () => {
  const client = fakeClient(TABLE);
  await querySpotRange(client, "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", "gold");
  const [{ sql, args }] = client.calls;
  assert.doesNotMatch(sql, /SELECT\s+\*/i);
  assert.match(sql, /SELECT\s+metal,\s*spot,\s*timestamp_floor\s+FROM spot_prices/i);
  assert.match(sql, /metal\s*=\s*\?/i);
  assert.deepEqual(args, ["2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", "gold"]);
});

test("querySpotRange: returns only the requested metal's rows, ascending", async () => {
  const client = fakeClient(TABLE);
  const rows = await querySpotRange(
    client,
    "2026-09-01T00:00:00Z",
    "2026-09-02T00:00:00Z",
    "silver"
  );
  assert.equal(rows.length, 96);
  assert.ok(rows.every((r) => r.metal === "silver"));
  assert.equal(rows[0].timestamp_floor, "2026-09-01T00:00:00Z");
});

// --- buildSpotHistory -------------------------------------------------------

test("buildSpotHistory: queries one metal at a time — no window pulls every metal at once", async () => {
  const client = fakeClient(TABLE);
  await buildSpotHistory(client, NOW);
  assert.equal(client.calls.length, 3 * METALS.length);
  for (const { args } of client.calls) {
    assert.equal(args.length, 3, `query without a metal filter: ${JSON.stringify(args)}`);
    assert.ok(METALS.includes(args[2]));
  }
});

test("buildSpotHistory: no single query returns more than one metal's 90-day window", async () => {
  // The pre-fix all-metal 90d pull returned ~5x this. One metal x 90 days x
  // 96 samples/day is the ceiling for any single response.
  const client = fakeClient(TABLE);
  const sizes = [];
  const wrapped = {
    execute: async (stmt) => {
      const res = await client.execute(stmt);
      sizes.push(res.rows.length);
      return res;
    },
  };
  await buildSpotHistory(wrapped, NOW);
  assert.ok(Math.max(...sizes) <= 90 * 96 + 96, `largest response ${Math.max(...sizes)} rows`);
});

test("buildSpotHistory: 7d/30d/90d each carry every metal with daily OHLCA entries", async () => {
  const history = await buildSpotHistory(fakeClient(TABLE), NOW);
  assert.deepEqual(Object.keys(history), ["7", "30", "90"]);
  for (const [days, byIso] of Object.entries(history)) {
    assert.deepEqual(Object.keys(byIso).sort(), Object.values(ISO).sort());
    for (const entries of Object.values(byIso)) {
      // A rolling N-day window starting mid-day spans N+1 calendar days.
      assert.equal(entries.length, Number(days) + 1, `${days}d entry count`);
      const e = entries[0];
      for (const k of ["t", "ts", "open", "high", "low", "close", "avg", "n"])
        assert.ok(k in e, `${k} missing`);
    }
  }
});

test("buildSpotHistory: a daily entry is the OHLCA of that UTC day's samples", async () => {
  const history = await buildSpotHistory(fakeClient(TABLE), NOW);
  const day = history["30"].xau.find((e) => e.t.startsWith("2026-09-01"));
  const samples = TABLE.filter(
    (r) => r.metal === "gold" && r.timestamp_floor.startsWith("2026-09-01")
  ).map((r) => r.spot);
  assert.equal(day.n, 96);
  assert.equal(day.open, samples[0]);
  assert.equal(day.close, samples[samples.length - 1]);
  assert.equal(day.high, Math.max(...samples));
  assert.equal(day.low, Math.min(...samples));
});

/** Wraps a client so any query whose window starts on `failStartPrefix` (optionally for one metal) throws. */
const failingClient = (inner, failStartPrefix, failMetal) => ({
  calls: inner.calls,
  execute: async (stmt) => {
    const [start, , metal] = stmt.args;
    if (start.startsWith(failStartPrefix) && (!failMetal || metal === failMetal)) {
      throw new Error("RESPONSE_TOO_LARGE: Response is too large");
    }
    return inner.execute(stmt);
  },
});

test("buildSpotHistory: publishes each window as it completes — a 90d failure still delivers 7d and 30d", async () => {
  const published = [];
  const client = failingClient(fakeClient(TABLE), "2026-06-29");
  await assert.rejects(
    buildSpotHistory(client, NOW, (days, data) => published.push([days, Object.keys(data).length])),
    /RESPONSE_TOO_LARGE/
  );
  assert.deepEqual(published, [
    ["7", 5],
    ["30", 5],
  ]);
});

test("buildSpotHistory: one failed window does not stop later windows, and the failure still surfaces", async () => {
  const published = [];
  const client = failingClient(fakeClient(TABLE), "2026-08-28", "copper"); // 30d window, copper only
  await assert.rejects(
    buildSpotHistory(client, NOW, (days) => published.push(days)),
    /RESPONSE_TOO_LARGE/
  );
  assert.deepEqual(published, ["7", "90"]);
});

test("buildSpotHistory: the 90d window starts 90 days before now", async () => {
  const client = fakeClient(TABLE);
  await buildSpotHistory(client, NOW);
  const ninety = client.calls.filter(({ args }) => args[0].startsWith("2026-06-29"));
  assert.equal(ninety.length, METALS.length);
  assert.deepEqual(ninety[0].args.slice(0, 2), ["2026-06-29T17:53:00Z", "2026-09-27T17:53:00Z"]);
});

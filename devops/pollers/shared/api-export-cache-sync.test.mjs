/**
 * Cache sync between sqld and the api-export SQLite cache.
 *
 * A home retail run stamps every row with the run start but writes rows over
 * several minutes, so an export can land mid-run. The next sync must still
 * load the rest of that run.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { syncCacheFromSqld } from "./api-export-cache-sync.js";

// One hour ago keeps the run inside the 31-day backfill cutoff on any run date.
const RUN_START_MS = Date.now() - 60 * 60 * 1000;
const T = new Date(RUN_START_MS).toISOString();
const W = new Date(Math.floor(RUN_START_MS / 900000) * 900000).toISOString().replace(".000Z", "Z");

/**
 * In-memory cache with the better-sqlite3 calls the sync uses.
 * @returns {object} Cache adapter over node:sqlite.
 */
function makeCache() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE price_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scraped_at TEXT NOT NULL, window_start TEXT NOT NULL,
    coin_slug TEXT NOT NULL, vendor TEXT NOT NULL, price REAL, source TEXT NOT NULL,
    confidence INTEGER, is_failed INTEGER NOT NULL DEFAULT 0, in_stock INTEGER DEFAULT 1)`);
  return {
    raw,
    prepare: (sql) => raw.prepare(sql),
    transaction: (fn) => (rows) => {
      raw.exec("BEGIN");
      try {
        fn(rows);
        raw.exec("COMMIT");
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

/**
 * sqld double that answers the sync queries from an in-memory row list.
 * @param {object[]} rows - Rows sqld holds.
 * @returns {object} Client with execute().
 */
function makeSqld(rows) {
  return {
    calls: [],
    async execute({ sql, args }) {
      this.calls.push({ sql, args });
      const [bound] = args;
      const inclusive = /scraped_at >= \?/.test(sql);
      const picked = /window_start >= \?/.test(sql)
        ? rows.filter((r) => r.window_start >= bound)
        : rows.filter((r) => (inclusive ? r.scraped_at >= bound : r.scraped_at > bound));
      return { rows: picked };
    },
  };
}

/**
 * One sqld row for the run at T.
 * @param {string} coin - Coin slug.
 * @returns {object} Row.
 */
function row(coin) {
  return {
    coin_slug: coin,
    vendor: "bullionexchanges",
    price: 10,
    window_start: W,
    scraped_at: T,
    source: "bullionexchanges-graphql",
    confidence: null,
    in_stock: 1,
  };
}

test("sync loads the rest of a run that an earlier export saw only in part", async () => {
  const cache = makeCache();
  const first = [row("ase"), row("age")];
  await syncCacheFromSqld({ cache, sqld: makeSqld(first), isNew: true, log: () => {} });

  const all = [...first, row("maple-gold"), row("kangaroo-silver")];
  await syncCacheFromSqld({ cache, sqld: makeSqld(all), isNew: false, log: () => {} });

  const coins = cache.raw
    .prepare("SELECT coin_slug FROM price_snapshots ORDER BY coin_slug")
    .all()
    .map((r) => r.coin_slug);
  assert.deepEqual(coins, ["age", "ase", "kangaroo-silver", "maple-gold"]);
});

test("sync leaves one cache row per sqld row when nothing new arrived", async () => {
  const cache = makeCache();
  const rows = [row("ase"), row("age")];
  await syncCacheFromSqld({ cache, sqld: makeSqld(rows), isNew: true, log: () => {} });
  await syncCacheFromSqld({ cache, sqld: makeSqld(rows), isNew: false, log: () => {} });

  const { n } = cache.raw.prepare("SELECT COUNT(*) AS n FROM price_snapshots").get();
  assert.equal(n, 2);
});

test("sync returns the rows it fetched", async () => {
  const cache = makeCache();
  const fetched = await syncCacheFromSqld({
    cache,
    sqld: makeSqld([row("ase")]),
    isNew: true,
    log: () => {},
  });
  assert.equal(fetched.length, 1);
});

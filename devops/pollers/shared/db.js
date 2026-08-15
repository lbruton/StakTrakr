#!/usr/bin/env node
/**
 * StakTrakr Retail Poller — SQLite Helper
 * =========================================
 * Opens (or initialises) prices.db in the data repo root.
 * All public functions use better-sqlite3's synchronous API.
 *
 * DB location: path.join(DATA_DIR, '..', 'prices.db')
 *   → /data-repo/prices.db when DATA_DIR=/data-repo/data
 */

import Database from "better-sqlite3";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createSqldClient, initSqldSchema } from "./sqld-client.js";
import { SPOT_METAL_KEYS } from "./spot-metals.js";

// ---------------------------------------------------------------------------
// Window floor utility (shared by price-extract and api-export)
// ---------------------------------------------------------------------------

/**
 * Returns the ISO8601 UTC 15-minute floor for a timestamp.
 * e.g. 14:22:45 → "2026-02-20T14:15:00Z"
 */
export function windowFloor(ts = new Date()) {
  const d = new Date(ts);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15, 0, 0);
  return d.toISOString().replace(".000Z", "Z");
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS price_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    scraped_at   TEXT NOT NULL,
    window_start TEXT NOT NULL,
    coin_slug    TEXT NOT NULL,
    vendor       TEXT NOT NULL,
    price        REAL,
    source       TEXT NOT NULL,
    confidence   INTEGER,
    is_failed    INTEGER NOT NULL DEFAULT 0,
    in_stock     INTEGER NOT NULL DEFAULT 1
  );
`;

const CREATE_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_coin_window ON price_snapshots(coin_slug, window_start);",
  "CREATE INDEX IF NOT EXISTS idx_window      ON price_snapshots(window_start);",
  "CREATE INDEX IF NOT EXISTS idx_coin_date   ON price_snapshots(coin_slug, substr(window_start, 1, 10));",
  "CREATE INDEX IF NOT EXISTS idx_coin_vendor_stock ON price_snapshots(coin_slug, vendor, in_stock, scraped_at DESC);",
];

// ---------------------------------------------------------------------------
// Open / initialise
// ---------------------------------------------------------------------------

/**
 * Opens sqld database connection.
 * Creates the table and indexes if they don't exist.
 *
 * @returns {Promise<import("@libsql/client").Client>}
 */
export async function openSqldDb() {
  const client = createSqldClient();
  await initSqldSchema(client);
  return client;
}

/** @deprecated Alias for openSqldDb — will be removed in a future version. */
export const openTursoDb = openSqldDb;

/**
 * DEPRECATED: Opens local SQLite database.
 * Kept for generating read-only snapshots from sqld data.
 * Use openSqldDb() for live database operations.
 *
 * @param {string} dataDir  Path to the data/ folder
 * @returns {Database.Database}
 */
export function openLocalDb(dataDir) {
  const dbPath = resolve(join(dataDir, "..", "prices.db"));
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(CREATE_TABLE);
  for (const idx of CREATE_INDEXES) {
    db.exec(idx);
  }
  return db;
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Append one line to the local JSONL price log (outside the git data repo).
 * Only logs successful scrapes (price !== null). Non-fatal — never throws.
 * Controlled by PRICE_LOG_DIR env var; no-ops if unset.
 *
 * Log format: one JSON object per line in prices-YYYY-MM-DD.jsonl
 * Recovery:   node import-from-log.js <file.jsonl>
 *
 * @param {object} row  same shape as writeSnapshot row
 */
function appendPriceLog(row) {
  const logDir = process.env.PRICE_LOG_DIR;
  if (!logDir || row.price == null) return;
  try {
    const date = row.scrapedAt.slice(0, 10);
    mkdirSync(logDir, { recursive: true });
    const line =
      JSON.stringify({
        scraped_at: row.scrapedAt,
        window_start: row.windowStart,
        coin_slug: row.coinSlug,
        vendor: row.vendor,
        price: row.price,
        source: row.source,
        in_stock: row.inStock !== false ? 1 : 0,
      }) + "\n";
    appendFileSync(join(logDir, `prices-${date}.jsonl`), line);
  } catch {
    // Non-fatal — a log write failure is never worth crashing the scrape
  }
}

// ---------------------------------------------------------------------------
// STAK-496: Price bounds guard — reject implausible prices at write time.
// If row.baseline is provided (spot-based melt value or goldback G1 rate),
// prices outside the reject threshold are written as is_failed=1, price=null.
// ---------------------------------------------------------------------------
const BOUNDS_REJECT_HIGH = 1.5; // > +50% above baseline
const BOUNDS_REJECT_LOW = 0.7; // < -30% below baseline

/**
 * Check whether a price is within plausible bounds of its baseline.
 * @param {number} price
 * @param {number} baseline
 * @returns {{ ok: boolean, ratio: number, reason?: string }}
 */
function checkPriceBounds(price, baseline) {
  if (!isFinite(price) || price <= 0)
    return { ok: false, ratio: NaN, reason: `non-finite or non-positive price (${price})` };
  if (baseline <= 0 || !isFinite(baseline)) return { ok: true, ratio: 1 };
  const ratio = price / baseline;
  if (ratio > BOUNDS_REJECT_HIGH) {
    return {
      ok: false,
      ratio,
      reason: `${((ratio - 1) * 100).toFixed(1)}% above baseline ($${price.toFixed(2)} vs $${baseline.toFixed(2)})`,
    };
  }
  if (ratio < BOUNDS_REJECT_LOW) {
    return {
      ok: false,
      ratio,
      reason: `${((1 - ratio) * 100).toFixed(1)}% below baseline ($${price.toFixed(2)} vs $${baseline.toFixed(2)})`,
    };
  }
  return { ok: true, ratio };
}

/**
 * Insert a single price snapshot row.
 *
 * @param {import("@libsql/client").Client} client
 * @param {object} row
 * @param {string} row.scrapedAt    ISO8601 UTC timestamp of scrape
 * @param {string} row.windowStart  15-min floor ISO8601 UTC
 * @param {string} row.coinSlug
 * @param {string} row.vendor       provider id (e.g. "apmex")
 * @param {number|null} row.price   null if scrape failed
 * @param {string} row.source       "firecrawl" | "playwright"
 * @param {number|null} [row.confidence]  populated later by merge step
 * @param {boolean} [row.isFailed]  true if this scrape returned no price
 * @param {boolean} [row.inStock]   false if product is out of stock (defaults to true)
 * @param {number|null} [row.baseline]  dynamic baseline for bounds check (STAK-496)
 * @param {boolean} [row.skipPriceBounds]  true to exempt from bounds check
 */
export async function writeSnapshot(client, row) {
  let price = row.price;
  let isFailed = row.isFailed ? 1 : 0;

  // STAK-496: Bounds check — reject implausible prices
  if (price != null && row.baseline != null && !row.skipPriceBounds) {
    const bounds = checkPriceBounds(price, row.baseline);
    if (!bounds.ok) {
      console.warn(`[bounds-guard] REJECTED ${row.coinSlug}/${row.vendor}: ${bounds.reason}`);
      price = null;
      isFailed = 1;
    }
  }

  appendPriceLog({ ...row, price, isFailed: isFailed === 1 });

  await client.execute({
    sql: `
      INSERT INTO price_snapshots (
        scraped_at, window_start, coin_slug, vendor, price,
        source, confidence, is_failed, in_stock
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      row.scrapedAt,
      row.windowStart,
      row.coinSlug,
      row.vendor,
      price,
      row.source,
      row.confidence || null,
      isFailed,
      row.inStock === false ? 0 : 1,
    ],
  });
}

/**
 * Write confidence scores back for all rows in a given window + coin.
 * Called by api-export.js during per-slug export.
 *
 * @param {Database.Database} db
 * @param {Array<{coinSlug: string, vendor: string, windowStart: string, confidence: number}>} scores
 */
export function writeConfidenceScores(db, scores) {
  const stmt = db.prepare(`
    UPDATE price_snapshots
    SET confidence = @confidence
    WHERE coin_slug = @coinSlug
      AND vendor    = @vendor
      AND window_start = @windowStart
  `);
  const updateMany = db.transaction((rows) => {
    for (const row of rows) {
      stmt.run(row);
    }
  });
  updateMany(scores);
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Returns all price_snapshots rows for the given 15-minute window.
 *
 * @param {Database.Database} db
 * @param {string} windowStart  ISO8601 UTC 15-min floor
 * @returns {Array<object>}
 */
export function readWindow(db, windowStart) {
  return db
    .prepare("SELECT * FROM price_snapshots WHERE window_start = ? ORDER BY coin_slug, vendor")
    .all(windowStart);
}

/**
 * Returns per-window rows for a specific coin within cutoffHours of the latest
 * snapshot (chronological). Used for building the 24h time series in api-export.
 *
 * @param {Database.Database} db
 * @param {string} coinSlug
 * @param {number} [windowCount=96]  safety-cap LIMIT (default 96 × 20 rows)
 * @param {number} [cutoffHours=24]  only return rows within this many hours of the latest window
 * @returns {Array<object>}
 */
export function readRecentWindows(db, coinSlug, windowCount = 96, cutoffHours = 24) {
  const latest = db
    .prepare(
      "SELECT MAX(window_start) as latest FROM price_snapshots WHERE coin_slug = ? AND price IS NOT NULL"
    )
    .get(coinSlug);
  if (!latest || !latest.latest) return [];
  const cutoff = new Date(new Date(latest.latest).getTime() - cutoffHours * 60 * 60 * 1000)
    .toISOString()
    .replace(".000Z", "Z");
  return db
    .prepare(
      `
      SELECT *
      FROM price_snapshots
      WHERE coin_slug = ? AND price IS NOT NULL AND window_start >= ?
      ORDER BY window_start DESC
      LIMIT ?
    `
    )
    .all(coinSlug, cutoff, windowCount * 20)
    .reverse();
}

/**
 * Returns daily aggregates for a coin over the past N days.
 * Each row: { date, avg_median, avg_low, sample_count, vendor_avgs (JSON string) }
 *
 * @param {Database.Database} db
 * @param {string} coinSlug
 * @param {number} [days=30]
 * @returns {Array<object>}
 */
export function readDailyAggregates(db, coinSlug, days = 30) {
  return db
    .prepare(
      `
      SELECT
        substr(window_start, 1, 10) AS date,
        COUNT(*)                    AS sample_count,
        AVG(price)                  AS avg_price,
        MIN(price)                  AS min_price,
        vendor,
        MAX(in_stock)               AS in_stock
      FROM price_snapshots
      WHERE coin_slug   = ?
        AND substr(window_start, 1, 10) >= date('now', ? || ' days')
      GROUP BY date, vendor
      ORDER BY date ASC, vendor ASC
    `
    )
    .all(coinSlug, `-${days}`);
}

/**
 * Returns the most recent window_start that has at least one price row.
 *
 * @param {Database.Database} db
 * @returns {string|null}
 */
export function readLatestWindow(db) {
  const row = db
    .prepare(
      "SELECT window_start FROM price_snapshots WHERE price IS NOT NULL ORDER BY window_start DESC LIMIT 1"
    )
    .get();
  return row ? row.window_start : null;
}

/**
 * Returns all distinct coin slugs that have data in the DB.
 *
 * @param {Database.Database} db
 * @returns {string[]}
 */
export function readCoinSlugs(db) {
  return db
    .prepare("SELECT DISTINCT coin_slug FROM price_snapshots ORDER BY coin_slug")
    .all()
    .map((r) => r.coin_slug);
}

/**
 * Returns all rows for a given coin and window_start (for building per-vendor maps).
 *
 * @param {Database.Database} db
 * @param {string} coinSlug
 * @param {string} windowStart
 * @returns {Array<object>}
 */
export function readCoinWindow(db, coinSlug, windowStart) {
  return db
    .prepare("SELECT * FROM price_snapshots WHERE coin_slug = ? AND window_start = ?")
    .all(coinSlug, windowStart);
}

/**
 * Returns the most recent non-failed row per vendor for a given coin,
 * looking back `lookbackHours` hours from now.  Used by api-export to
 * merge data from both pollers (Fly.io :00/:15 and home :30) into a
 * single vendor map.
 *
 * @param {Database.Database} db
 * @param {string} coinSlug
 * @param {number} [lookbackHours=2]
 * @returns {Array<object>}
 */
export function readLatestPerVendor(db, coinSlug, lookbackHours = 2) {
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000)
    .toISOString()
    .replace(".000Z", "Z");
  return db
    .prepare(
      `
      SELECT ps.*
      FROM price_snapshots ps
      INNER JOIN (
        SELECT vendor, MAX(scraped_at) AS max_scraped
        FROM price_snapshots
        WHERE coin_slug = ? AND scraped_at >= ? AND is_failed = 0 AND price IS NOT NULL
        GROUP BY vendor
      ) latest ON ps.vendor = latest.vendor AND ps.scraped_at = latest.max_scraped
      WHERE ps.coin_slug = ? AND ps.is_failed = 0 AND ps.price IS NOT NULL
    `
    )
    .all(coinSlug, cutoff, coinSlug);
}

/**
 * Returns all distinct window_starts in descending order, up to limit.
 *
 * @param {Database.Database} db
 * @param {number} [limit=96]
 * @returns {string[]}
 */
export function readRecentWindowStarts(db, limit = 96) {
  return db
    .prepare("SELECT DISTINCT window_start FROM price_snapshots ORDER BY window_start DESC LIMIT ?")
    .all(limit)
    .map((r) => r.window_start)
    .reverse();
}

// ---------------------------------------------------------------------------
// Poller run log
// ---------------------------------------------------------------------------

/**
 * Insert a new poller run row with status "running".
 * Returns the run_id (used to update the row when the run finishes).
 *
 * @param {import("@libsql/client").Client} client
 * @param {{ pollerId: string, startedAt: string, total: number }} opts
 * @returns {Promise<string>}  run_id
 */
export async function startRunLog(client, { pollerId, startedAt, total }) {
  const runId = `${pollerId}-${startedAt.replace(/[^0-9T]/g, "")}`;
  await client.execute({
    sql: `
      INSERT INTO poller_runs (run_id, poller_id, started_at, status, total)
      VALUES (?, ?, ?, 'running', ?)
      ON CONFLICT(run_id) DO NOTHING
    `,
    args: [runId, pollerId, startedAt, total],
  });
  return runId;
}

/**
 * Update a poller run row to finished status.
 *
 * @param {import("@libsql/client").Client} client
 * @param {{ runId: string, finishedAt: string, captured: number, failures: number, fbpFilled: number, error?: string }} opts
 */
export async function finishRunLog(
  client,
  { runId, finishedAt, captured, failures, fbpFilled, error }
) {
  await client.execute({
    sql: `
      UPDATE poller_runs
      SET finished_at = ?, status = ?, captured = ?, failures = ?, fbp_filled = ?, error = ?
      WHERE run_id = ?
    `,
    args: [finishedAt, error ? "error" : "ok", captured, failures, fbpFilled, error || null, runId],
  });
}

/**
 * Read the most recent N runs across all pollers (for the dashboard).
 *
 * @param {import("@libsql/client").Client} client
 * @param {number} [limit=20]
 * @returns {Promise<Array<object>>}
 */
export async function readRecentRuns(client, limit = 20) {
  const result = await client.execute({
    sql: `
      SELECT run_id, poller_id, started_at, finished_at, status,
             total, captured, failures, fbp_filled, error
      FROM poller_runs
      ORDER BY started_at DESC
      LIMIT ?
    `,
    args: [limit],
  });
  return result.rows;
}

/**
 * Record a scrape failure for the failure queue.
 *
 * @param {import("@libsql/client").Client} client
 * @param {object} params
 * @param {string} params.coinSlug
 * @param {string} params.vendorId
 * @param {string} [params.url]
 * @param {string} [params.error]
 * @param {string} params.failedAt  ISO8601 UTC timestamp
 */
export async function recordFailure(client, { coinSlug, vendorId, url, error, failedAt }) {
  await client.execute({
    sql: "INSERT INTO provider_failures (coin_slug, vendor_id, url, error, failed_at) VALUES (?, ?, ?, ?, ?)",
    args: [coinSlug, vendorId, url ?? null, error ?? null, failedAt],
  });
}

// ---------------------------------------------------------------------------
// Spot price operations
// ---------------------------------------------------------------------------

/**
 * Insert one spot price row per tracked metal into the spot_prices table.
 * Uses INSERT OR REPLACE keyed on (metal, timestamp_floor).
 *
 * The metal list is imported from spot-metals.js rather than declared here.
 * It was previously a private array plus a matching parameter destructure, and
 * the two had to be kept in step by hand — a payload key this function did not
 * name was silently discarded, so a caller could add a metal and see a green
 * run that wrote no row for it (STRK-303).
 *
 * Every metal is validated BEFORE the first write. The loop is not wrapped in a
 * transaction, so throwing partway through would leave earlier metals committed
 * and the run log reporting a total failure for a poll that half succeeded.
 *
 * @param {import("@libsql/client").Client} client - Open sqld client.
 * @param {Record<string, number|string>} prices - One numeric key per metal in
 *   `metals`, plus a `timestamp` string.
 * @param {string} pollerId - e.g. "fly-spot" or "home-spot".
 * @param {string[]} [metals] - Metals to write. Defaults to every tracked metal.
 *   Callers importing archived files pass only the metals that file contains,
 *   since rows are independent per (metal, timestamp_floor) and a pre-copper
 *   archive legitimately has no copper row to write.
 * @returns {Promise<void>}
 * @throws {Error} When a requested metal is missing or non-numeric.
 */
export async function insertSpotPrices(client, prices, pollerId, metals = SPOT_METAL_KEYS) {
  const { timestamp } = prices;
  const floor = windowFloor(timestamp);

  // Number.isFinite, not typeof — NaN and Infinity are both typeof "number" and
  // would pass a bare type check straight into a REAL NOT NULL column.
  const missing = metals.filter((metal) => !Number.isFinite(prices[metal]));
  if (missing.length) {
    throw new Error(`insertSpotPrices missing numeric price for: ${missing.join(", ")}`);
  }

  for (const metal of metals) {
    await client.execute({
      sql: `
        INSERT OR REPLACE INTO spot_prices
          (metal, spot, source, poller_id, timestamp, timestamp_floor)
        VALUES (?, ?, 'metalprice-api', ?, ?, ?)
      `,
      args: [metal, prices[metal], pollerId, timestamp, floor],
    });
  }
}

/**
 * Returns the latest spot price per metal.
 *
 * @param {import("@libsql/client").Client} client
 * @returns {Promise<Array<object>>}
 */
export async function readSpotCurrent(client) {
  const result = await client.execute({
    sql: `
      SELECT s.*
      FROM spot_prices s
      INNER JOIN (
        SELECT metal, MAX(timestamp) AS max_ts
        FROM spot_prices
        GROUP BY metal
      ) latest ON s.metal = latest.metal AND s.timestamp = latest.max_ts
      ORDER BY s.metal
    `,
    args: [],
  });
  return result.rows;
}

/**
 * Returns all spot entries whose timestamp_floor falls within a given UTC hour.
 *
 * @param {import("@libsql/client").Client} client
 * @param {string} date   'YYYY-MM-DD'
 * @param {number} hour   0-23
 * @returns {Promise<Array<object>>}
 */
export async function readSpotHourly(client, date, hour) {
  const hh = String(hour).padStart(2, "0");
  const hourStart = `${date}T${hh}:00:00Z`;
  const nextHour = `${date}T${String(hour + 1).padStart(2, "0")}:00:00Z`;
  // Handle hour 23 → next day 00:00
  let upperBound = nextHour;
  if (hour === 23) {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    upperBound = next.toISOString().replace(".000Z", "Z");
  }

  const result = await client.execute({
    sql: `
      SELECT *
      FROM spot_prices
      WHERE timestamp_floor >= ? AND timestamp_floor < ?
      ORDER BY metal, timestamp_floor
    `,
    args: [hourStart, upperBound],
  });
  return result.rows;
}

/**
 * Returns spot entries for a specific 15-minute window floor.
 *
 * @param {import("@libsql/client").Client} client
 * @param {string} floor  ISO8601 UTC 15-min floor (e.g. "2026-02-20T14:15:00Z")
 * @returns {Promise<Array<object>>}
 */
export async function readSpot15min(client, floor) {
  const result = await client.execute({
    sql: `
      SELECT *
      FROM spot_prices
      WHERE timestamp_floor = ?
      ORDER BY metal
    `,
    args: [floor],
  });
  return result.rows;
}

/**
 * Returns all price snapshots from the last N hours (for sqld async operations).
 *
 * @param {import("@libsql/client").Client} client
 * @param {number} [hoursBack=24]
 * @returns {Promise<Array<object>>}
 */
export async function readLatestPrices(client, hoursBack = 24) {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  const result = await client.execute({
    sql: `
      SELECT
        scraped_at, window_start, coin_slug, vendor, price,
        source, confidence, is_failed, in_stock
      FROM price_snapshots
      WHERE scraped_at >= ?
      ORDER BY scraped_at DESC
    `,
    args: [cutoff],
  });

  return result.rows;
}

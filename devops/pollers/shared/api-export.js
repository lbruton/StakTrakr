#!/usr/bin/env node
/**
 * StakTrakr Retail Poller — REST API JSON Exporter
 * ==================================================
 * Reads from Turso (source of truth), writes static JSON endpoints to
 * DATA_DIR/api/.
 * Called by run-local.sh after merge-prices.js.
 *
 * Output structure:
 *   data/api/
 *     manifest.json            ← coins list, last updated, window count
 *     latest.json              ← all coins, current 15-min window prices
 *     {slug}/
 *       latest.json            ← single coin: current prices + 96-window 24h series
 *       history-7d.json        ← daily aggregates, last 7 days
 *       history-30d.json       ← daily aggregates, last 30 days
 *
 * Usage:
 *   DATA_DIR=/path/to/data node api-export.js
 *
 * Environment:
 *   DATA_DIR   Path to repo data/ folder (default: ../../data)
 *   DRY_RUN    Set to "1" to skip writing files
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { loadProviders } from "./provider-db.js";
import {
  openTursoDb,
  openLocalDb,
  readLatestWindow,
  readCoinSlugs,
  readCoinWindow,
  readLatestPerVendor,
  readRecentWindows,
  readRecentWindowStarts,
  readDailyAggregates,
  writeConfidenceScores,
  readSpotCurrent,
  readSpotHourly,
  readSpot15min,
  windowFloor,
} from "./db.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, "../../data"));
const DRY_RUN = process.env.DRY_RUN === "1";
// Home poller uses tight staleness; Fly.io uses 24h so cards never vanish
// due to a single failed poll cycle.
const T4_MAX_STALE_HOURS = (process.env.POLLER_ID || "api") === "home" ? 4 : 24;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function warn(msg) {
  console.warn(`[${new Date().toISOString().slice(11, 19)}] WARN: ${msg}`);
}

// ---------------------------------------------------------------------------
// File writer
// ---------------------------------------------------------------------------

function writeApiFile(relPath, data) {
  const filePath = join(DATA_DIR, "api", relPath);
  if (DRY_RUN) {
    log(`[DRY RUN] ${filePath}`);
    return;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  log(`Wrote ${filePath}`);
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

/**
 * Compute median price from an array of price_snapshots rows.
 * Excludes out-of-stock vendors (in_stock = 0).
 */
function medianPrice(rows) {
  const prices = rows
    .filter((r) => r.in_stock === 1)  // Only in-stock vendors
    .map((r) => r.price)
    .filter((p) => p !== null && p !== undefined);
  if (!prices.length) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100;
}

/**
 * Compute lowest price from an array of rows.
 * Excludes out-of-stock vendors (in_stock = 0).
 */
function lowestPrice(rows) {
  const prices = rows
    .filter((r) => r.in_stock === 1)  // Only in-stock vendors
    .map((r) => r.price)
    .filter((p) => p !== null && p !== undefined);
  if (!prices.length) return null;
  return Math.round(Math.min(...prices) * 100) / 100;
}

/**
 * Build a vendor map { vendorId: { price, confidence, source, inStock } } from rows.
 */
function vendorMap(rows) {
  const map = {};
  for (const row of rows) {
    // Include OOS rows (in_stock=0) even with null price
    if (row.price !== null || row.in_stock === 0) {
      map[row.vendor] = {
        price:      row.price !== null ? Math.round(row.price * 100) / 100 : null,
        confidence: row.confidence ?? null,
        source:     row.source,
        inStock:    row.in_stock === 1,  // SQLite stores as INTEGER 0/1
      };
    }
  }
  return map;
}

/**
 * Aggregate window rows into {window, median, low, vendors} entries.
 * Groups by window_start, computes median/low across all vendors and
 * includes per-vendor prices for individual chart lines.
 * Excludes out-of-stock vendors (in_stock = 0).
 */
/**
 * Aggregate raw snapshot rows into consensus time-bucket windows with
 * carry-forward so every window has all vendors.
 *
 * 1. Bucket rows by time (30-min default) — merge both pollers.
 * 2. Walk buckets chronologically, carrying forward each vendor's last
 *    known price into any window where that vendor has no new data.
 * 3. Recompute median/low from the FULL vendor set (carried + fresh).
 *
 * Result: every window always has all vendors. Fresh data overwrites
 * carried data. The API serves complete, clean consensus windows.
 *
 * @param {Array} allRows  Raw price_snapshots rows (must include scraped_at)
 * @param {number} bucketMinutes  Bucket size in minutes: 15, 30, or 60
 * @returns {Array<{window: string, median: number, low: number, vendors: Object}>}
 */
function aggregateWindows(allRows, bucketMinutes = 30) {
  // Step 1: Bucket rows — keep most recent price per vendor per bucket
  const byBucket = new Map();
  for (const row of allRows) {
    if (row.price === null || row.in_stock !== 1) continue;  // Skip OOS
    const d = new Date(row.window_start);
    const mins = d.getUTCMinutes();
    d.setUTCMinutes(mins - (mins % bucketMinutes), 0, 0);
    const bucketKey = d.toISOString();
    if (!byBucket.has(bucketKey)) byBucket.set(bucketKey, { vendors: {} });
    const entry = byBucket.get(bucketKey);
    const existing = entry.vendors[row.vendor];
    if (!existing || row.scraped_at > existing.scraped_at) {
      entry.vendors[row.vendor] = {
        price: Math.round(row.price * 100) / 100,
        scraped_at: row.scraped_at,
      };
    }
  }

  // Step 2: Sort buckets chronologically, then carry forward
  const sortedKeys = [...byBucket.keys()].sort();
  const lastSeen = {};  // vendorId → { price, scraped_at }

  const result = [];
  for (const bucket of sortedKeys) {
    const { vendors } = byBucket.get(bucket);

    // Update lastSeen with any fresh data in this bucket
    for (const [vendorId, data] of Object.entries(vendors)) {
      lastSeen[vendorId] = data;
    }

    // Build the full vendor map: fresh data + carried-forward
    const vendorPrices = {};
    for (const [vendorId, data] of Object.entries(lastSeen)) {
      vendorPrices[vendorId] = data.price;
    }

    const prices = Object.values(vendorPrices);
    if (prices.length === 0) continue;
    const sorted = [...prices].sort((a, b) => a - b);

    result.push({
      window: bucket,
      median: Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100,
      low:    Math.round(sorted[0] * 100) / 100,
      vendors: vendorPrices,
    });
  }
  return result;
}

/**
 * Aggregate daily rows (from readDailyAggregates) into per-date summaries.
 * Input rows have: { date, avg_price, min_price, sample_count, vendor, in_stock }
 */
function aggregateDailyRows(rawRows) {
  const byDate = new Map();
  for (const row of rawRows) {
    if (!byDate.has(row.date)) {
      byDate.set(row.date, { date: row.date, prices: [], mins: [], sampleCount: 0, vendors: {} });
    }
    const entry = byDate.get(row.date);
    if (row.avg_price !== null) entry.prices.push(row.avg_price);
    if (row.min_price !== null)  entry.mins.push(row.min_price);
    entry.sampleCount += row.sample_count || 0;
    if (row.vendor) {
      entry.vendors[row.vendor] = {
        avg: row.avg_price !== null ? Math.round(row.avg_price * 100) / 100 : null,
        inStock: row.in_stock === 1,
      };
    }
  }
  const result = [];
  for (const [date, entry] of byDate) {
    const sorted = [...entry.prices].sort((a, b) => a - b);
    result.push({
      date,
      avg_median:   sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100 : null,
      avg_low:      entry.mins.length ? Math.round(Math.min(...entry.mins) * 100) / 100 : null,
      sample_count: entry.sampleCount,
      vendors:      entry.vendors,
    });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Score a vendor price for a single coin window.
 * Single-source scoring (no Firecrawl+Vision agreement available).
 * @param {number} price - The vendor's price for this window
 * @param {number|null} windowMedian - Median of all vendors for this window
 * @param {number|null} prevMedian - Previous day's median (for day-over-day check)
 * @returns {number} Score 0-100
 */
function scoreVendorPrice(price, windowMedian, prevMedian) {
  let score = 50; // base: single source
  if (windowMedian !== null && windowMedian !== 0) {
    const deviation = Math.abs(price - windowMedian) / windowMedian;
    if (deviation <= 0.03) score += 30;
    else if (deviation > 0.08) score -= 15;
  }
  if (prevMedian !== null && prevMedian !== 0) {
    const dayDiff = Math.abs(price - prevMedian) / prevMedian;
    if (dayDiff > 0.10) score -= 20;
  }
  return Math.max(0, Math.min(100, score));
}
/**
 * Load today's Gemini Vision extraction results for a coin slug.
 * Returns null if no vision file exists for today.
 */
function loadVisionData(dataDir, slug) {
  const today = new Date().toISOString().slice(0, 10);
  // extract-vision.js writes per-coin vision files to DATA_DIR/retail/{slug}/{date}-vision.json
  const filePath = join(dataDir, "retail", slug, `${today}-vision.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Query SQLite for the most recent in-stock price for a coin+vendor.
 * Returns { price, scraped_at } or null if never had an in-stock price.
 */
function getLastKnownPrice(db, coinSlug, vendorId) {
  const row = db.prepare(`
    SELECT price, scraped_at
    FROM price_snapshots
    WHERE coin_slug = ?
      AND vendor = ?
      AND in_stock = 1
      AND price IS NOT NULL
    ORDER BY scraped_at DESC
    LIMIT 1
  `).get(coinSlug, vendorId);

  return row ? { price: row.price, scraped_at: row.scraped_at } : null;
}

/**
 * Returns true if the given scraped_at timestamp is within T4_MAX_STALE_HOURS.
 * Used to gate T4 fallback so ancient last-known prices are not surfaced.
 */
function isWithinT4Threshold(scrapedAt) {
  const ageHours = (Date.now() - new Date(scrapedAt).getTime()) / 3_600_000;
  return ageHours >= 0 && ageHours <= T4_MAX_STALE_HOURS;
}

/**
 * Score a vendor price incorporating Vision cross-validation when available.
 * Returns { price, confidence, method }.
 *
 * Confidence tiers when both Firecrawl and Vision are present and agree:
 *   ≤2% diff  → 90 base
 *   ≤5% diff  → 70 base
 *   >5% diff  → 35 base (disagreement)
 *
 * Falls back to scoreVendorPrice() when no vision data available.
 */
/**
 * Resolve the canonical vendor price using Firecrawl result and Vision verification.
 *
 * Decision matrix:
 *   Both agree  (≤3%)       → use Firecrawl price, 99% confidence
 *   Both present, disagree  → use price closest to window median, ≤70% confidence
 *   Firecrawl null, Vision  → Vision as primary, ~70% confidence
 *   Firecrawl only          → existing scoreVendorPrice(), no change
 *   Neither                 → { price: null, confidence: 0, source: null }
 *
 * Stock status consensus:
 *   Both OOS                → out of stock (both_oos)
 *   Vision OOS              → trust Vision (vision_oos)
 *   Firecrawl OOS, Vision in-stock → trust Vision (vision_override)
 *
 * @param {string} coinSlug
 * @param {string} vendorId
 * @param {object|null} firecrawlData - { price, inStock }
 * @param {object|null} visionData - Full vision JSON for this coin
 * @param {import('better-sqlite3').Database} db
 * @param {number|null} windowMedian
 * @param {number|null} prevMedian
 */
function resolveVendorPrice(coinSlug, vendorId, firecrawlData, visionData, db, windowMedian, prevMedian) {
  const fcPrice = firecrawlData?.price ?? null;
  const fcInStock = firecrawlData?.inStock ?? true;
  const visionPrice = visionData?.prices_by_site?.[vendorId] ?? null;
  // Extract Vision stock status (undefined if Vision has no data for this vendor)
  const visionInStock = visionData?.availability_by_site?.[vendorId];
  const visionHasData = visionInStock !== undefined;
  const visionConf = visionData?.confidence_by_site?.[vendorId] ?? null;
  // New field from updated extract-vision.js; fall back to diff calc for old JSONs
  const agreedField = visionData?.agreement_by_site?.[vendorId] ?? null;

  // CONSENSUS LOGIC: Trust Vision on stock status disagreement
  let finalInStock = true;
  let stockReason = "in_stock";

  if (!fcInStock && !visionInStock) {
    // Both say out of stock (or Vision missing but Firecrawl OOS)
    finalInStock = false;
    stockReason = !visionHasData ? "firecrawl_oos" : "both_oos";
  } else if (visionHasData && !visionInStock) {
    // Vision explicitly says OOS → trust Vision
    finalInStock = false;
    stockReason = "vision_oos";
  } else if (!fcInStock && visionHasData && visionInStock) {
    // Firecrawl OOS, Vision explicitly says in-stock → trust Vision
    finalInStock = true;
    stockReason = "vision_override";
  } else if (!fcInStock) {
    // Firecrawl OOS, Vision has no data → trust Firecrawl
    finalInStock = false;
    stockReason = "firecrawl_oos";
  }
  // else: both in-stock (default finalInStock = true already set)

  // If out of stock, return null price with availability metadata
  if (!finalInStock) {
    const lastKnown = getLastKnownPrice(db, coinSlug, vendorId);
    return {
      price: null,
      confidence: null,
      source: "consensus_oos",
      inStock: false,
      lastKnownPrice: lastKnown?.price ?? null,
      lastAvailableDate: lastKnown?.date ?? null,
      stockReason,
    };
  }

  // --- IN STOCK: Continue with existing price resolution logic ---

  // Determine agreement: prefer Gemini's own judgement; fall back to ≤3% diff check
  const agrees = (() => {
    if (agreedField !== null) return agreedField;
    if (fcPrice !== null && visionPrice !== null) {
      const diff = Math.abs(fcPrice - visionPrice) / Math.max(fcPrice, visionPrice);
      return diff <= 0.03;
    }
    return null;
  })();

  // CASE 1: Both sources agree → 99% confidence
  if (fcPrice !== null && visionPrice !== null && agrees === true) {
    return {
      price: fcPrice,
      confidence: 99,
      source: "firecrawl+vision",
      inStock: true,
      lastKnownPrice: null,
      lastAvailableDate: null,
      stockReason: "in_stock",
    };
  }

  // CASE 2: Both present, disagree → prefer price closest to window median
  if (fcPrice !== null && visionPrice !== null && agrees === false) {
    const ref = windowMedian ?? (fcPrice + visionPrice) / 2;
    const useFirecrawl = Math.abs(fcPrice - ref) <= Math.abs(visionPrice - ref);
    const price = useFirecrawl ? fcPrice : visionPrice;
    const base = scoreVendorPrice(price, windowMedian, prevMedian);
    return {
      price,
      confidence: Math.min(base, 70),
      source: useFirecrawl ? "firecrawl" : "vision",
      inStock: true,
      lastKnownPrice: null,
      lastAvailableDate: null,
      stockReason: "in_stock",
    };
  }

  // CASE 3: Firecrawl null, Vision has a price → Vision as primary
  if (fcPrice === null && visionPrice !== null) {
    const vcMod = visionConf === "high" ? 10 : visionConf === "medium" ? 0 : -15;
    const base = Math.max(0, 70 + vcMod);
    const medianScore = scoreVendorPrice(visionPrice, windowMedian, prevMedian);
    return {
      price: visionPrice,
      confidence: Math.min(base, medianScore + 20),
      source: "vision",
      inStock: true,
      lastKnownPrice: null,
      lastAvailableDate: null,
      stockReason: "in_stock",
    };
  }

  // CASE 4: Firecrawl only (no vision data for this vendor)
  if (fcPrice !== null) {
    return {
      price: fcPrice,
      confidence: scoreVendorPrice(fcPrice, windowMedian, prevMedian),
      source: "firecrawl",
      inStock: true,
      lastKnownPrice: null,
      lastAvailableDate: null,
      stockReason: "in_stock",
    };
  }

  // CASE 5: Neither source has a price
  return {
    price: null,
    confidence: 0,
    source: null,
    inStock: true,  // Default to in-stock if no data
    lastKnownPrice: null,
    lastAvailableDate: null,
    stockReason: "no_data",
  };
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

function openOrCreateCache(cachePath) {
  const isNew = !existsSync(cachePath);
  const db = new Database(cachePath);

  // Integrity check on existing DBs
  if (!isNew) {
    try {
      const check = db.pragma('integrity_check');
      if (check[0].integrity_check !== 'ok') {
        warn('Cache DB integrity check failed — rebuilding');
        db.close();
        unlinkSync(cachePath);
        return openOrCreateCache(cachePath);
      }
    } catch (err) {
      warn(`Cache DB corrupt: ${err.message} — rebuilding`);
      db.close();
      unlinkSync(cachePath);
      return openOrCreateCache(cachePath);
    }
  }

  // Create schema if new
  if (isNew) {
    db.exec(`
      CREATE TABLE price_snapshots (
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
      CREATE INDEX idx_coin_window ON price_snapshots(coin_slug, window_start);
      CREATE INDEX idx_window ON price_snapshots(window_start);
      CREATE INDEX idx_coin_date ON price_snapshots(coin_slug, substr(window_start, 1, 10));
      CREATE INDEX idx_coin_vendor_stock ON price_snapshots(coin_slug, vendor, in_stock, scraped_at DESC);
    `);
    log('Created new cache DB at ' + cachePath);
  }

  return { db, isNew };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Determine cache path — sits alongside the data/ directory
  const cachePath = join(dirname(DATA_DIR), 'prices-cache.db');

  // FULL_EXPORT=1 escape hatch: drop cache and rebuild from scratch
  if (process.env.FULL_EXPORT === '1') {
    log('[api-export] FULL_EXPORT=1 — rebuilding cache from scratch');
    try { unlinkSync(cachePath); } catch {}
  }

  log('Opening price cache at ' + cachePath);
  const { db, isNew } = openOrCreateCache(cachePath);

  try {
    const generatedAt = new Date().toISOString();
    const tursoClient = await openTursoDb();

    // Determine watermark — what's the most recent data we have?
    let watermark = null;
    if (!isNew) {
      const row = db.prepare('SELECT MAX(scraped_at) AS wm FROM price_snapshots').get();
      watermark = row?.wm || null;
    }

    // Query Turso: full backfill if new, incremental if existing
    let tursoRows;
    if (watermark) {
      log(`Incremental sync from watermark: ${watermark}`);
      const result = await tursoClient.execute({
        sql: `SELECT coin_slug, vendor, price, window_start, scraped_at, source, confidence, in_stock
              FROM price_snapshots WHERE scraped_at > ? ORDER BY scraped_at`,
        args: [watermark],
      });
      tursoRows = result.rows;
      log(`Fetched ${tursoRows.length} new rows from Turso`);
    } else {
      log('Full backfill from Turso (new cache)...');
      const cutoff = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      const result = await tursoClient.execute({
        sql: `SELECT coin_slug, vendor, price, window_start, scraped_at, source, confidence, in_stock
              FROM price_snapshots WHERE window_start >= ? ORDER BY window_start DESC`,
        args: [cutoff],
      });
      tursoRows = result.rows;
      log(`Backfill: loaded ${tursoRows.length} rows from Turso`);
    }
    tursoClient.close();

    if (!tursoRows.length && isNew) {
      warn('No price data in Turso — skipping API export');
      return;
    }

    // Insert all Turso rows into cache — no UNIQUE constraint, no deduplication.
    // The cache is a dumb mirror of Turso. aggregateWindows() handles deduplication
    // by keeping the latest scraped_at per vendor per time bucket.
    if (tursoRows.length > 0) {
      const insertStmt = db.prepare(`
        INSERT INTO price_snapshots (
          scraped_at, window_start, coin_slug, vendor, price,
          source, confidence, is_failed, in_stock
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMany = db.transaction((rows) => {
        for (const row of rows) {
          insertStmt.run(
            row.scraped_at, row.window_start, row.coin_slug, row.vendor,
            row.price, row.source, row.confidence || null,
            0, row.in_stock !== undefined ? row.in_stock : 1
          );
        }
      });
      insertMany(tursoRows);
      log(`Inserted ${tursoRows.length} rows into cache`);
    }

    // Prune old data (keep 31 days)
    const pruneResult = db.prepare(
      "DELETE FROM price_snapshots WHERE window_start < datetime('now', '-31 days')"
    ).run();
    if (pruneResult.changes > 0) {
      log(`Pruned ${pruneResult.changes} rows older than 31 days`);
    }

  // Determine the latest window and all coin slugs
  const latestWindow = readLatestWindow(db);
  if (!latestWindow) {
    warn("No price data in DB yet — skipping API export");
    return; // finally block closes db
  }

  // Read coin slugs from Turso provider tables (falls back to local file)
  let coinSlugs = readCoinSlugs(db);
  let providersJson = null;
  try {
    let tursoClient = null;
    try { tursoClient = (await import("./turso-client.js")).createTursoClient(); } catch {}
    providersJson = await loadProviders(tursoClient, DATA_DIR);
    const allSlugs = Object.keys(providersJson.coins);
    // Merge: include any slug in provider DB even if not yet in price DB
    coinSlugs = [...new Set([...allSlugs, ...coinSlugs])].sort();
  } catch {
    warn("Could not load providers from Turso or file — using slugs from DB only");
  }

  log(`API export: ${coinSlugs.length} coins, latest window: ${latestWindow}`);

  // --------------------------------------------------------------------------
  // latest.json (global) — all coins at current window
  // --------------------------------------------------------------------------
  const globalLatestCoins = {};
  for (const slug of coinSlugs) {
    let rows = readLatestPerVendor(db, slug, 2);
    let isStale = false;
    if (!rows.length) {
      // T4 fallback: try last 24h so cards never vanish due to a failed poll cycle
      rows = readLatestPerVendor(db, slug, 24);
      if (!rows.length) continue;
      isStale = true;
    }
    globalLatestCoins[slug] = {
      window_start:  latestWindow,
      median_price:  medianPrice(rows),
      lowest_price:  lowestPrice(rows),
      vendor_count:  Object.keys(vendorMap(rows)).length,
      ...(isStale ? { is_stale: true } : {}),
    };
  }

  writeApiFile("latest.json", {
    window_start:  latestWindow,
    generated_at:  generatedAt,
    coin_count:    Object.keys(globalLatestCoins).length,
    coins:         globalLatestCoins,
  });

  // --------------------------------------------------------------------------
  // Per-slug endpoints
  // --------------------------------------------------------------------------

  // Collect recent 96 windows for 24h time series
  const recentWindowStarts = readRecentWindowStarts(db, 96);
  const windowCount = recentWindowStarts.length;

  for (const slug of coinSlugs) {
    // latest.json per slug — use most recent row per vendor across last 2h
    // so data from both pollers (Fly.io :00 and home :30) is represented
    const latestRows = readLatestPerVendor(db, slug, 2);
    const vendors = vendorMap(latestRows);

    // Confidence scoring: score each vendor's price, update SQLite
    const windowMedian = medianPrice(latestRows);

    // Previous day's median for day-over-day check
    const raw2d = readDailyAggregates(db, slug, 2);
    const prevEntries = aggregateDailyRows(raw2d);
    const today = latestWindow.slice(0, 10);
    const prevEntry = prevEntries.find((e) => e.date !== today);
    const prevMedian = prevEntry ? prevEntry.avg_median : null;

    const visionData = loadVisionData(DATA_DIR, slug);

    // Build set of vendor IDs that have SQLite rows (for confidence write-back)
    const sqliteVendorIds = new Set(Object.keys(vendors));

    // Augment vendors map: add null-price stubs for providers configured in providers.json
    // but absent from SQLite (i.e., Firecrawl returned null for them).
    // resolveVendorPrice() will try Vision for these.
    // configuredVendorIds is kept in outer scope so T4 Pass 2 can use it.
    const configuredVendorIds = new Set(
      providersJson?.coins?.[slug]?.providers
        ?.filter(p => p.enabled !== false)
        ?.map(p => p.id) ?? []
    );
    for (const vendorId of configuredVendorIds) {
      if (!vendors[vendorId]) {
        vendors[vendorId] = { price: null, confidence: null, source: null };
      }
    }

    const confidenceUpdates = [];
    const availabilityBySite = {};
    const lastKnownPriceBySite = {};
    const lastAvailableDateBySite = {};

    for (const [vendorId, vendorData] of Object.entries(vendors)) {
      // Build Firecrawl data object from SQLite row
      const firecrawlData = {
        price: vendorData.price,
        inStock: vendorData.inStock ?? true,
      };

      const resolved = resolveVendorPrice(
        slug,
        vendorId,
        firecrawlData,
        visionData,
        db,
        windowMedian,
        prevMedian
      );

      vendorData.price = resolved.price;
      vendorData.confidence = resolved.confidence;
      vendorData.source = resolved.source;

      // Capture availability metadata
      availabilityBySite[vendorId] = resolved.inStock;
      if (resolved.lastKnownPrice !== null) {
        lastKnownPriceBySite[vendorId] = resolved.lastKnownPrice;
      }
      if (resolved.lastAvailableDate !== null) {
        lastAvailableDateBySite[vendorId] = resolved.lastAvailableDate;
      }

      // Only write back to SQLite for rows that came from SQLite
      if (sqliteVendorIds.has(vendorId) && resolved.confidence > 0) {
        confidenceUpdates.push({ coinSlug: slug, vendor: vendorId, windowStart: latestWindow, confidence: resolved.confidence });
      }
    }

    // Remove vendors where no price found; for in-stock failures, fill from Turso last-known (T4)
    for (const vendorId of Object.keys(vendors)) {
      if (vendors[vendorId].price === null) {
        const isOos = availabilityBySite[vendorId] === false;
        if (!isOos) {
          // T4: use most recent in-stock price from Turso history
          const lastKnown = getLastKnownPrice(db, slug, vendorId);
          if (lastKnown && isWithinT4Threshold(lastKnown.scraped_at)) {
            vendors[vendorId] = {
              price:      Math.round(lastKnown.price * 100) / 100,
              confidence: null,
              source:     "turso_last_known",
              inStock:    true,
              stale:      true,
              stale_since: lastKnown.scraped_at,
            };
          } else if (lastKnown) {
            log('[T4-expired] ' + slug + '/' + vendorId + ' last known at ' + lastKnown.scraped_at + ' exceeds ' + T4_MAX_STALE_HOURS + 'h threshold');
            delete vendors[vendorId];
          } else {
            delete vendors[vendorId];
          }
        } else {
          delete vendors[vendorId];
        }
      }
    }

    // T4 Pass 2: absent vendors — configured in providers.json but missing from this window.
    // Fires when a vendor's scrape completely failed (403, timeout, proxy error) and left
    // no record in the 2-hour SQLite window. availabilityBySite guards against OOS vendors
    // that Pass 1 already deleted — getLastKnownPrice alone cannot distinguish "absent due
    // to scrape failure" from "absent because Pass 1 deleted an OOS vendor". The
    // availabilityBySite check ensures we only attempt T4 for vendors with no OOS signal
    // from the current window.
    for (const vendorId of configuredVendorIds) {
      if (vendors[vendorId] === undefined && availabilityBySite[vendorId] !== false) {
        const lastKnown = getLastKnownPrice(db, slug, vendorId);
        if (lastKnown && isWithinT4Threshold(lastKnown.scraped_at)) {
          vendors[vendorId] = {
            price:       Math.round(lastKnown.price * 100) / 100,
            confidence:  null,
            source:      "turso_last_known",
            inStock:     true,
            stale:       true,
            stale_since: lastKnown.scraped_at,
          };
          log('[T4-absent] ' + slug + '/' + vendorId + ' recovered from Turso (' + lastKnown.scraped_at + ')');
        } else if (lastKnown) {
          log('[T4-absent-expired] ' + slug + '/' + vendorId + ' last known at ' + lastKnown.scraped_at + ' — exceeds ' + T4_MAX_STALE_HOURS + 'h threshold, omitting');
        }
        // else: no history → vendor stays absent (correct)
      }
    }

    if (confidenceUpdates.length > 0) {
      try {
        writeConfidenceScores(db, confidenceUpdates);
      } catch (err) {
        warn(`Could not write confidence scores for ${slug}: ${err.message}`);
      }
    }

    // 24h windows time series — aggregate into 30-min consensus buckets
    // Merges both pollers (:00 Fly.io + :30 home) into one bucket with all vendors
    const recentRows = readRecentWindows(db, slug, 96);
    const windows24h = aggregateWindows(recentRows, 30);

    writeApiFile(`${slug}/latest.json`, {
      slug,
      window_start:  latestWindow,
      median_price:  medianPrice(latestRows),
      lowest_price:  lowestPrice(latestRows),
      vendors,
      availability_by_site: availabilityBySite,
      last_known_price_by_site: lastKnownPriceBySite,
      last_available_date_by_site: lastAvailableDateBySite,
      windows_24h:   windows24h,
    });

    // history-7d.json
    const raw7d = readDailyAggregates(db, slug, 7);
    const history7d = aggregateDailyRows(raw7d);
    writeApiFile(`${slug}/history-7d.json`, history7d);

    // history-30d.json
    const raw30d = readDailyAggregates(db, slug, 30);
    const history30d = aggregateDailyRows(raw30d);
    writeApiFile(`${slug}/history-30d.json`, history30d);
  }

  // --------------------------------------------------------------------------
  // manifest.json
  // --------------------------------------------------------------------------
  const coinsMeta = {};
  if (providersJson) {
    for (const [slug, coinData] of Object.entries(providersJson.coins || {})) {
      coinsMeta[slug] = {
        name: coinData.name,
        metal: coinData.metal,
        weight: coinData.weight_oz,
      };
    }
  }

  writeApiFile("manifest.json", {
    generated_at:   generatedAt,
    latest_window:  latestWindow,
    window_count:   windowCount,
    coin_count:     coinSlugs.length,
    coins:          coinSlugs,
    ...(Object.keys(coinsMeta).length > 0 ? { coins_meta: coinsMeta } : {}),
    endpoints: {
      latest:      "api/latest.json",
      slug_latest: "api/{slug}/latest.json",
      history_7d:  "api/{slug}/history-7d.json",
      history_30d: "api/{slug}/history-30d.json",
      providers:   "api/providers.json",
    },
  });

  // --------------------------------------------------------------------------
  // providers.json — flatten product URLs for frontend consumption
  // --------------------------------------------------------------------------
  if (providersJson) {
    const frontendProviders = {};
    for (const [slug, coinData] of Object.entries(providersJson.coins || {})) {
      frontendProviders[slug] = {};
      for (const provider of (coinData.providers || [])) {
        const canonicalUrl = provider.url ?? provider.urls?.[0];
        if (provider.enabled !== false && canonicalUrl) {
          frontendProviders[slug][provider.id] = canonicalUrl;
        }
      }
    }
    writeApiFile("providers.json", frontendProviders);
  }

  // --------------------------------------------------------------------------
  // goldback-spot.json — generated from Turso goldback-g1 data; backward compat
  // for api-health.js freshness check and denomination lookups
  // --------------------------------------------------------------------------
  if (coinSlugs.includes("goldback-g1")) {
    const gbRows = readLatestPerVendor(db, "goldback-g1", 2);
    const gbVendors = vendorMap(gbRows);
    const g1Raw = gbVendors?.goldback?.price;
    if (g1Raw != null) {
      const g1 = Math.round(g1Raw * 100) / 100;
      writeApiFile("goldback-spot.json", {
        date:        generatedAt.slice(0, 10),
        scraped_at:  generatedAt,
        g1_usd:      g1,
        denominations: {
          g1:  g1,
          g5:  Math.round(g1 * 5  * 100) / 100,
          g10: Math.round(g1 * 10 * 100) / 100,
          g25: Math.round(g1 * 25 * 100) / 100,
          g50: Math.round(g1 * 50 * 100) / 100,
        },
        source:     "goldback.com",
        confidence: "high",
      });
    }
  }

  log(`API export complete: ${coinSlugs.length} coin(s), ${windowCount} window(s) in history`);

  } finally {
    db.close();
  }

  // --------------------------------------------------------------------------
  // Spot price export — read from Turso, write hourly + 15min JSON files
  // --------------------------------------------------------------------------

  log("Exporting spot prices from Turso...");
  const spotClient = await openTursoDb();

  try {
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const hh = String(now.getUTCHours()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;

    /**
     * Transform a Turso spot_prices row into the standard JSON output format.
     * @param {object} row  Turso row with metal, spot, timestamp fields
     * @param {string} source  "hourly" or "seed"
     * @returns {object}
     */
    function formatSpotRow(row, source) {
      const metal = String(row.metal).charAt(0).toUpperCase() + String(row.metal).slice(1);
      const ts = String(row.timestamp).replace("T", " ").replace("Z", "").replace(/\.\d+$/, "");
      return {
        spot: row.spot,
        metal,
        source,
        provider: "StakTrakr",
        timestamp: ts,
      };
    }

    // --- Hourly file (overwrite) ---
    const hourlyRows = await readSpotHourly(spotClient, dateStr, now.getUTCHours());
    if (hourlyRows.length) {
      const hourlyEntries = hourlyRows.map((r) => formatSpotRow(r, "hourly"));
      const hourlyFilePath = join(DATA_DIR, "hourly", yyyy, mm, dd, `${hh}.json`);
      if (!DRY_RUN) {
        mkdirSync(dirname(hourlyFilePath), { recursive: true });
        writeFileSync(hourlyFilePath, JSON.stringify(hourlyEntries, null, 2) + "\n");
        log(`Wrote ${hourlyFilePath}`);
      } else {
        log(`[DRY RUN] ${hourlyFilePath}`);
      }
    } else {
      warn(`No Turso spot data for hourly window ${dateStr} ${hh}:00`);
    }

    // --- 15-min file (immutable snapshot — write only if missing) ---
    let floor = windowFloor(now);
    let fifteenRows = await readSpot15min(spotClient, floor);

    // If no data for current floor (race: api-export ran before spot poller),
    // fall back to the most recently completed 15-min window.
    if (!fifteenRows.length) {
      const prevDate = new Date(now.getTime() - 15 * 60 * 1000);
      const prevFloor = windowFloor(prevDate);
      const prevRows = await readSpot15min(spotClient, prevFloor);
      if (prevRows.length) {
        floor = prevFloor;
        fifteenRows = prevRows;
      }
    }
    const floorMin = floor.slice(11, 13) + floor.slice(14, 16); // "HHMM"
    const fifteenFilePath = join(DATA_DIR, "15min", yyyy, mm, dd, `${floorMin}.json`);
    // FILE-READ FALLBACK (uncomment to revert to pre-Turso behavior):
    // const fifteenData = JSON.parse(readFileSync(fifteenFilePath, 'utf-8'));

    if (fifteenRows.length) {
      if (!existsSync(fifteenFilePath)) {
        const fifteenEntries = fifteenRows.map((r) => formatSpotRow(r, "seed"));
        if (!DRY_RUN) {
          mkdirSync(dirname(fifteenFilePath), { recursive: true });
          writeFileSync(fifteenFilePath, JSON.stringify(fifteenEntries, null, 2) + "\n");
          log(`Wrote ${fifteenFilePath}`);
        } else {
          log(`[DRY RUN] ${fifteenFilePath}`);
        }
      } else {
        log(`15min snapshot already exists: ${fifteenFilePath}`);
      }
    } else {
      warn(`No Turso spot data for 15-min window ${floor}`);
    }

    log("Spot export complete");
  } finally {
    spotClient.close();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

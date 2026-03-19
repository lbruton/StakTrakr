#!/usr/bin/env node
/**
 * StakTrakr Turso Backup Sync — sqld → Turso Cloud
 * ==================================================
 * Nightly incremental sync from self-hosted sqld to Turso Cloud free tier
 * for disaster recovery. Runs via cron at 03:00 UTC daily.
 *
 * Environment:
 *   SQLD_URL            Self-hosted sqld (default: http://staktrakr-sqld:8080)
 *   TURSO_BACKUP_URL    Turso Cloud database URL (required)
 *   TURSO_BACKUP_TOKEN  Turso Cloud auth token (required)
 *
 * Watermark file: /data/turso-sync-watermark.json
 */

import { createClient } from "@libsql/client";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const WATERMARK_PATH = "/data/turso-sync-watermark.json";
const BATCH_SIZE = 1000;

const TAG = "[turso-sync]";

function log(msg) {
  console.log(`${TAG} ${msg}`);
}

function logError(msg) {
  console.error(`${TAG} ERROR: ${msg}`);
}

// ---------------------------------------------------------------------------
// Watermark helpers
// ---------------------------------------------------------------------------

function readWatermark() {
  if (existsSync(WATERMARK_PATH)) {
    try {
      return JSON.parse(readFileSync(WATERMARK_PATH, "utf-8"));
    } catch (err) {
      log(`Failed to parse watermark file, resetting: ${err.message}`);
    }
  }

  // Default: 24 hours ago
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const defaults = {
    price_snapshots: cutoff,
    spot_prices: cutoff,
    poller_runs: cutoff,
    provider_failures: cutoff,
  };
  writeFileSync(WATERMARK_PATH, JSON.stringify(defaults, null, 2) + "\n");
  log("Created watermark file with 24h-ago defaults");
  return defaults;
}

function saveWatermark(wm) {
  writeFileSync(WATERMARK_PATH, JSON.stringify(wm, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Batch insert helper
// ---------------------------------------------------------------------------

async function batchInsert(target, table, columns, rows) {
  if (rows.length === 0) return 0;

  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const stmts = batch.map((row) => ({
      sql,
      args: columns.map((col) => row[col] ?? null),
    }));
    await target.batch(stmts);
    inserted += batch.length;
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Full sync helper (small tables — delete all + reinsert)
// ---------------------------------------------------------------------------

async function fullSync(source, target, table, columns) {
  const result = await source.execute(`SELECT ${columns.join(", ")} FROM ${table}`);
  const rows = result.rows;

  await target.execute(`DELETE FROM ${table}`);

  if (rows.length === 0) return 0;

  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;

  const stmts = rows.map((row) => ({
    sql,
    args: columns.map((col) => row[col] ?? null),
  }));

  // Batch in groups for safety
  for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
    await target.batch(stmts.slice(i, i + BATCH_SIZE));
  }

  return rows.length;
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

async function main() {
  const sqldUrl = process.env.SQLD_URL || "http://staktrakr-sqld:8080";
  const tursoUrl = process.env.TURSO_BACKUP_URL;
  const tursoToken = process.env.TURSO_BACKUP_TOKEN;

  if (!tursoUrl || !tursoToken) {
    log("TURSO_BACKUP_URL and TURSO_BACKUP_TOKEN not set — skipping backup sync");
    return;
  }

  const startTime = Date.now();
  log(`Starting backup sync: sqld=${sqldUrl} → Turso Cloud`);

  let source;
  let target;

  try {
    source = createClient({ url: sqldUrl });
  } catch (err) {
    logError(`Failed to connect to sqld: ${err.message}`);
    return;
  }

  try {
    target = createClient({ url: tursoUrl, authToken: tursoToken });
  } catch (err) {
    logError(`Failed to connect to Turso Cloud: ${err.message}`);
    return;
  }

  // Verify Turso Cloud is reachable
  try {
    await target.execute("SELECT 1");
  } catch (err) {
    logError(`Turso Cloud unreachable: ${err.message}`);
    return;
  }

  const watermark = readWatermark();
  const summary = {};

  // ── price_snapshots (incremental) ─────────────────────────────────────
  try {
    const result = await source.execute({
      sql: `SELECT id, scraped_at, window_start, coin_slug, vendor, price,
                   source, confidence, is_failed, in_stock
            FROM price_snapshots WHERE scraped_at > ? ORDER BY scraped_at`,
      args: [watermark.price_snapshots],
    });
    const rows = result.rows;
    const cols = [
      "id", "scraped_at", "window_start", "coin_slug", "vendor",
      "price", "source", "confidence", "is_failed", "in_stock",
    ];
    const count = await batchInsert(target, "price_snapshots", cols, rows);
    summary.price_snapshots = count;

    if (rows.length > 0) {
      watermark.price_snapshots = rows[rows.length - 1].scraped_at;
      saveWatermark(watermark);
    }
    log(`price_snapshots: ${count} rows`);
  } catch (err) {
    logError(`price_snapshots sync failed: ${err.message}`);
    summary.price_snapshots = "ERROR";
  }

  // ── spot_prices (incremental) ─────────────────────────────────────────
  try {
    const result = await source.execute({
      sql: `SELECT id, metal, spot, source, poller_id, timestamp,
                   timestamp_floor, scraped_at
            FROM spot_prices WHERE scraped_at > ? ORDER BY scraped_at`,
      args: [watermark.spot_prices],
    });
    const rows = result.rows;
    const cols = [
      "id", "metal", "spot", "source", "poller_id",
      "timestamp", "timestamp_floor", "scraped_at",
    ];
    const count = await batchInsert(target, "spot_prices", cols, rows);
    summary.spot_prices = count;

    if (rows.length > 0) {
      watermark.spot_prices = rows[rows.length - 1].scraped_at;
      saveWatermark(watermark);
    }
    log(`spot_prices: ${count} rows`);
  } catch (err) {
    logError(`spot_prices sync failed: ${err.message}`);
    summary.spot_prices = "ERROR";
  }

  // ── poller_runs (incremental) ─────────────────────────────────────────
  try {
    const result = await source.execute({
      sql: `SELECT id, run_id, poller_id, started_at, finished_at,
                   status, total, captured, failures, fbp_filled, error
            FROM poller_runs WHERE started_at > ? ORDER BY started_at`,
      args: [watermark.poller_runs],
    });
    const rows = result.rows;
    const cols = [
      "id", "run_id", "poller_id", "started_at", "finished_at",
      "status", "total", "captured", "failures", "fbp_filled", "error",
    ];
    const count = await batchInsert(target, "poller_runs", cols, rows);
    summary.poller_runs = count;

    if (rows.length > 0) {
      watermark.poller_runs = rows[rows.length - 1].started_at;
      saveWatermark(watermark);
    }
    log(`poller_runs: ${count} rows`);
  } catch (err) {
    logError(`poller_runs sync failed: ${err.message}`);
    summary.poller_runs = "ERROR";
  }

  // ── provider_failures (incremental) ───────────────────────────────────
  try {
    const result = await source.execute({
      sql: `SELECT id, coin_slug, vendor_id, url, error, failed_at
            FROM provider_failures WHERE failed_at > ? ORDER BY failed_at`,
      args: [watermark.provider_failures],
    });
    const rows = result.rows;
    const cols = ["id", "coin_slug", "vendor_id", "url", "error", "failed_at"];
    const count = await batchInsert(target, "provider_failures", cols, rows);
    summary.provider_failures = count;

    if (rows.length > 0) {
      watermark.provider_failures = rows[rows.length - 1].failed_at;
      saveWatermark(watermark);
    }
    log(`provider_failures: ${count} rows`);
  } catch (err) {
    logError(`provider_failures sync failed: ${err.message}`);
    summary.provider_failures = "ERROR";
  }

  // ── provider_coins (full sync — small table) ─────────────────────────
  try {
    const cols = [
      "slug", "metal", "name", "weight_oz", "fbp_url",
      "notes", "enabled", "created_at", "updated_at",
    ];
    const count = await fullSync(source, target, "provider_coins", cols);
    summary.provider_coins = count;
    log(`provider_coins: ${count} rows (full sync)`);
  } catch (err) {
    logError(`provider_coins sync failed: ${err.message}`);
    summary.provider_coins = "ERROR";
  }

  // ── provider_vendors (full sync — small table) ────────────────────────
  try {
    const cols = [
      "id", "coin_slug", "vendor_id", "vendor_name", "url",
      "enabled", "selector", "hints", "created_at", "updated_at",
    ];
    const count = await fullSync(source, target, "provider_vendors", cols);
    summary.provider_vendors = count;
    log(`provider_vendors: ${count} rows (full sync)`);
  } catch (err) {
    logError(`provider_vendors sync failed: ${err.message}`);
    summary.provider_vendors = "ERROR";
  }

  // ── Summary ───────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalRows = Object.values(summary)
    .filter((v) => typeof v === "number")
    .reduce((a, b) => a + b, 0);

  log(
    Object.entries(summary)
      .map(([table, count]) => `${table}: ${count}`)
      .join(", ") + ` | Total: ${totalRows} rows in ${elapsed}s`
  );
}

main().catch((err) => {
  logError(`Unexpected error: ${err.message}`);
  // Exit 0 — never fatal for cron
});

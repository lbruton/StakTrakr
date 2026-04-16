#!/usr/bin/env node
/**
 * StakTrakr — One-Time Migration: Turso Cloud → Self-Hosted sqld
 * ===============================================================
 * Copies all data from Turso Cloud to a self-hosted sqld instance.
 * Run once during the migration to sqld. Does NOT delete source data.
 *
 * Environment:
 *   SOURCE_URL    Turso Cloud database URL (required)
 *   SOURCE_TOKEN  Turso Cloud auth token (required)
 *   TARGET_URL    Self-hosted sqld URL (required)
 *   TARGET_TOKEN  sqld auth token (optional — empty string if no auth)
 */

import { createClient } from "@libsql/client";
import { initSqldSchema } from "./sqld-client.js";
import { initProviderSchema } from "./provider-db.js";

const TAG = "[migrate]";
const BATCH_SIZE = 5000;

function log(msg) {
  console.log(`${TAG} ${msg}`);
}

function logError(msg) {
  console.error(`${TAG} ERROR: ${msg}`);
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
// Table definitions — column lists and migration config
// ---------------------------------------------------------------------------

const TABLES = [
  {
    name: "provider_coins",
    columns: [
      "slug", "metal", "name", "weight_oz", "fbp_url",
      "notes", "enabled", "created_at", "updated_at",
    ],
    batched: false,
  },
  {
    name: "provider_vendors",
    columns: [
      "id", "coin_slug", "vendor_id", "vendor_name", "url",
      "enabled", "selector", "hints", "created_at", "updated_at",
    ],
    batched: false,
  },
  {
    name: "price_snapshots",
    columns: [
      "id", "scraped_at", "window_start", "coin_slug", "vendor",
      "price", "source", "confidence", "is_failed", "in_stock",
    ],
    batched: true,
    orderBy: "id",
  },
  {
    name: "spot_prices",
    columns: [
      "id", "metal", "spot", "source", "poller_id",
      "timestamp", "timestamp_floor", "scraped_at",
    ],
    batched: false,
  },
  {
    name: "poller_runs",
    columns: [
      "id", "run_id", "poller_id", "started_at", "finished_at",
      "status", "total", "captured", "failures", "fbp_filled", "error",
    ],
    batched: false,
  },
  {
    name: "provider_failures",
    columns: [
      "id", "coin_slug", "vendor_id", "url", "error", "failed_at",
    ],
    batched: false,
  },
];

// ---------------------------------------------------------------------------
// Per-table migration
// ---------------------------------------------------------------------------

async function migrateSmallTable(source, target, table) {
  const { name, columns } = table;
  log(`${name}: migrating...`);

  const colList = columns.join(", ");
  const result = await source.execute(`SELECT ${colList} FROM ${name}`);
  const rows = result.rows;

  if (rows.length === 0) {
    log(`${name}: 0 rows (empty table)`);
    return 0;
  }

  const count = await batchInsert(target, name, columns, rows);
  log(`${name}: ${count} rows migrated`);
  return count;
}

async function migrateBatchedTable(source, target, table) {
  const { name, columns, orderBy } = table;
  log(`${name}: counting rows...`);

  const countResult = await source.execute(`SELECT COUNT(*) AS cnt FROM ${name}`);
  const totalRows = Number(countResult.rows[0].cnt);

  if (totalRows === 0) {
    log(`${name}: 0 rows (empty table)`);
    return 0;
  }

  const totalBatches = Math.ceil(totalRows / BATCH_SIZE);
  const colList = columns.join(", ");
  let migrated = 0;

  for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
    const offset = batchNum * BATCH_SIZE;
    log(`${name}: migrating... (batch ${batchNum + 1}/${totalBatches})`);

    const result = await source.execute({
      sql: `SELECT ${colList} FROM ${name} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      args: [BATCH_SIZE, offset],
    });

    const rows = result.rows;
    if (rows.length === 0) break;

    await batchInsert(target, name, columns, rows);
    migrated += rows.length;
  }

  log(`${name}: ${migrated} rows migrated`);
  return migrated;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function verifyCounts(source, target) {
  const results = [];

  for (const table of TABLES) {
    const srcResult = await source.execute(`SELECT COUNT(*) AS cnt FROM ${table.name}`);
    const tgtResult = await target.execute(`SELECT COUNT(*) AS cnt FROM ${table.name}`);
    const srcCount = Number(srcResult.rows[0].cnt);
    const tgtCount = Number(tgtResult.rows[0].cnt);

    results.push({
      name: table.name,
      source: srcCount,
      target: tgtCount,
      ok: srcCount === tgtCount,
    });
  }

  return results;
}

function printSummary(counts, failed) {
  const nameWidth = 20;
  const numWidth = 10;
  const lineWidth = nameWidth + numWidth * 2 + 6;

  log("\u2550".repeat(lineWidth));
  log(
    " " +
      "Table".padEnd(nameWidth) +
      "Source".padStart(numWidth) +
      "Target".padStart(numWidth) +
      "  OK"
  );
  log("\u2500".repeat(lineWidth));

  let totalRows = 0;

  for (const row of counts) {
    const mark = row.ok ? "\u2713" : "\u2717";
    const srcStr = row.source.toLocaleString();
    const tgtStr = row.target.toLocaleString();
    log(
      " " +
        row.name.padEnd(nameWidth) +
        srcStr.padStart(numWidth) +
        tgtStr.padStart(numWidth) +
        "  " +
        mark
    );
    totalRows += row.target;
  }

  log("\u2550".repeat(lineWidth));

  if (failed.length > 0) {
    log(` Migration finished with errors. Failed tables: ${failed.join(", ")}`);
  } else {
    log(` Migration complete. Total: ${totalRows.toLocaleString()} rows`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sourceUrl = process.env.SOURCE_URL;
  const sourceToken = process.env.SOURCE_TOKEN;
  const targetUrl = process.env.TARGET_URL;
  const targetToken = process.env.TARGET_TOKEN;

  if (!sourceUrl || !sourceToken || !targetUrl) {
    console.log(`Usage:
  SOURCE_URL=<turso-cloud-url> \\
  SOURCE_TOKEN=<turso-auth-token> \\
  TARGET_URL=<sqld-url> \\
  TARGET_TOKEN=<sqld-token-or-empty> \\
  node migrate-turso-to-sqld.js

Environment variables:
  SOURCE_URL    Turso Cloud database URL (required)
  SOURCE_TOKEN  Turso Cloud auth token (required)
  TARGET_URL    Self-hosted sqld URL (required)
  TARGET_TOKEN  sqld auth token (optional — omit or empty if no auth)`);
    process.exit(1);
  }

  const startTime = Date.now();
  log(`Starting migration: Turso Cloud → sqld`);
  log(`  Source: ${sourceUrl}`);
  log(`  Target: ${targetUrl}`);

  // Connect to source (Turso Cloud)
  const source = createClient({ url: sourceUrl, authToken: sourceToken });
  try {
    await source.execute("SELECT 1");
    log("Source (Turso Cloud) connected");
  } catch (err) {
    logError(`Failed to connect to source: ${err.message}`);
    process.exit(1);
  }

  // Connect to target (sqld)
  const targetOpts = { url: targetUrl };
  if (targetToken) targetOpts.authToken = targetToken;
  const target = createClient(targetOpts);
  try {
    await target.execute("SELECT 1");
    log("Target (sqld) connected");
  } catch (err) {
    logError(`Failed to connect to target: ${err.message}`);
    process.exit(1);
  }

  // Initialize schema on target
  log("Initializing schema on target...");
  await initSqldSchema(target);
  await initProviderSchema(target);
  log("Schema ready");

  // Migrate tables in FK-safe order
  const failed = [];

  for (const table of TABLES) {
    try {
      if (table.batched) {
        await migrateBatchedTable(source, target, table);
      } else {
        await migrateSmallTable(source, target, table);
      }
    } catch (err) {
      logError(`${table.name}: migration failed — ${err.message}`);
      failed.push(table.name);
    }
  }

  // Verify row counts
  log("Verifying row counts...");
  const counts = await verifyCounts(source, target);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Elapsed: ${elapsed}s`);
  printSummary(counts, failed);

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  logError(`Unexpected error: ${err.message}`);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * StakTrakr Retail Poller — Turso libSQL Client
 * ==============================================
 * Connects to Turso cloud database via @libsql/client.
 * Replaces better-sqlite3 for remote database operations.
 */

import { createClient } from "@libsql/client";

/**
 * Create and return a Turso client connection.
 * Requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN env vars.
 *
 * @returns {import("@libsql/client").Client}
 */
export function createTursoClient() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    throw new Error(
      "TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set"
    );
  }

  return createClient({ url, authToken });
}

/**
 * Initialize Turso database schema (table + indexes).
 * Idempotent — safe to run multiple times.
 *
 * @param {import("@libsql/client").Client} client
 */
export async function initTursoSchema(client) {
  // Create table
  await client.execute(`
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
  `);

  // Create indexes
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_coin_window ON price_snapshots(coin_slug, window_start);",
    "CREATE INDEX IF NOT EXISTS idx_window ON price_snapshots(window_start);",
    "CREATE INDEX IF NOT EXISTS idx_coin_date ON price_snapshots(coin_slug, substr(window_start, 1, 10));",
    "CREATE INDEX IF NOT EXISTS idx_coin_vendor_stock ON price_snapshots(coin_slug, vendor, in_stock, scraped_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_scraped_at ON price_snapshots(scraped_at);",
  ];

  for (const sql of indexes) {
    await client.execute(sql);
  }

  // Poller run log — one row per scrape run, written by each poller instance
  await client.execute(`
    CREATE TABLE IF NOT EXISTS poller_runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id       TEXT NOT NULL UNIQUE,
      poller_id    TEXT NOT NULL,
      started_at   TEXT NOT NULL,
      finished_at  TEXT,
      status       TEXT NOT NULL DEFAULT 'running',
      total        INTEGER,
      captured     INTEGER,
      failures     INTEGER,
      fbp_filled   INTEGER,
      error        TEXT
    );
  `);

  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_runs_poller_started ON poller_runs(poller_id, started_at DESC);"
  );

  // Provider failure tracking — one row per failed scrape attempt
  await client.execute(`
    CREATE TABLE IF NOT EXISTS provider_failures (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      coin_slug  TEXT NOT NULL,
      vendor_id  TEXT NOT NULL,
      url        TEXT,
      error      TEXT,
      failed_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_pf_coin_vendor ON provider_failures(coin_slug, vendor_id);"
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_pf_failed_at ON provider_failures(failed_at);"
  );

  // Spot price history — one row per metal per 15-minute floor
  await client.execute(`
    CREATE TABLE IF NOT EXISTS spot_prices (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      metal           TEXT NOT NULL,
      spot            REAL NOT NULL,
      source          TEXT NOT NULL DEFAULT 'metalprice-api',
      poller_id       TEXT NOT NULL,
      timestamp       TEXT NOT NULL,
      timestamp_floor TEXT NOT NULL,
      scraped_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(metal, timestamp_floor)
    );
  `);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_spot_metal_floor ON spot_prices(metal, timestamp_floor DESC);"
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_spot_floor ON spot_prices(timestamp_floor DESC);"
  );
}

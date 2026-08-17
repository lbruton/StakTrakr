#!/usr/bin/env node
/**
 * StakTrakr Provider Database Module
 * ===================================
 * Single source of truth for provider configuration (coins + vendors).
 * Reads/writes sqld (self-hosted libSQL). Falls back to local providers.json
 * if sqld is unreachable.
 *
 * All consumers (price-extract, capture, api-export, dashboard) import
 * from this module instead of reading providers.json directly.
 *
 * @see STAK-348 — Migrate providers.json to sqld
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Schema — provider_coins + provider_vendors
// ---------------------------------------------------------------------------

const CREATE_PROVIDER_COINS = `
  CREATE TABLE IF NOT EXISTS provider_coins (
    slug        TEXT PRIMARY KEY,
    metal       TEXT NOT NULL,
    name        TEXT NOT NULL,
    weight_oz   REAL NOT NULL DEFAULT 1.0,
    fbp_url     TEXT,
    notes       TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

const CREATE_PROVIDER_VENDORS = `
  CREATE TABLE IF NOT EXISTS provider_vendors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    coin_slug   TEXT NOT NULL REFERENCES provider_coins(slug),
    vendor_id   TEXT NOT NULL,
    vendor_name TEXT NOT NULL,
    url         TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    selector    TEXT,
    hints       TEXT,
    skip_bounds INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(coin_slug, vendor_id)
  );
`;

const CREATE_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_pv_coin ON provider_vendors(coin_slug);",
  "CREATE INDEX IF NOT EXISTS idx_pv_vendor ON provider_vendors(vendor_id);",
  "CREATE INDEX IF NOT EXISTS idx_pv_enabled ON provider_vendors(coin_slug, enabled);",
];

/**
 * Initialize provider tables + indexes. Idempotent — safe to call on every
 * startup. Does NOT interfere with existing price_snapshots or poller_runs
 * tables managed by sqld-client.js.
 *
 * @param {import("@libsql/client").Client} client
 */
export async function initProviderSchema(client) {
  await client.execute(CREATE_PROVIDER_COINS);
  await client.execute(CREATE_PROVIDER_VENDORS);
  for (const sql of CREATE_INDEXES) {
    await client.execute(sql);
  }
  // STAK-496: Add skip_bounds column if missing (migration for existing DBs)
  try {
    await client.execute(
      "ALTER TABLE provider_vendors ADD COLUMN skip_bounds INTEGER NOT NULL DEFAULT 0"
    );
  } catch {
    // Column already exists — expected on subsequent runs
  }
  // STRK-334: Add fbp_match column if missing (migration for existing DBs)
  try {
    await client.execute("ALTER TABLE provider_coins ADD COLUMN fbp_match TEXT");
  } catch {
    // Column already exists — expected on subsequent runs
  }
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Load all provider data from sqld, shaped to match providers.json:
 *
 *   { coins: { [slug]: { metal, name, weight_oz, fbp_url, notes, providers: [...] } } }
 *
 * @param {import("@libsql/client").Client} client
 * @returns {Promise<object>}
 */
export async function getProviders(client) {
  const coinsResult = await client.execute(
    "SELECT slug, metal, name, weight_oz, fbp_url, fbp_match, notes, enabled FROM provider_coins ORDER BY slug"
  );
  const vendorsResult = await client.execute(
    "SELECT coin_slug, vendor_id, vendor_name, url, enabled, selector, hints, skip_bounds FROM provider_vendors ORDER BY coin_slug, vendor_id"
  );

  // Index vendors by coin_slug for fast lookup
  const vendorsByCoin = new Map();
  for (const row of vendorsResult.rows) {
    const slug = row.coin_slug;
    if (!vendorsByCoin.has(slug)) vendorsByCoin.set(slug, []);
    vendorsByCoin.get(slug).push({
      id: row.vendor_id,
      name: row.vendor_name,
      enabled: row.enabled === 1,
      url: row.url || undefined,
      ...(row.selector ? { selector: row.selector } : {}),
      ...(row.hints ? { hints: row.hints } : {}),
      ...(row.skip_bounds === 1 ? { skipPriceBounds: true } : {}),
    });
  }

  const coins = {};
  for (const row of coinsResult.rows) {
    coins[row.slug] = {
      name: row.name,
      metal: row.metal,
      weight_oz: row.weight_oz,
      ...(row.fbp_url ? { fbp_url: row.fbp_url } : {}),
      ...(row.fbp_match ? { fbp_match: row.fbp_match } : {}),
      ...(row.notes ? { notes: row.notes } : {}),
      providers: vendorsByCoin.get(row.slug) || [],
    };
  }

  return { coins };
}

/**
 * Get vendors for a specific coin.
 *
 * @param {import("@libsql/client").Client} client
 * @param {string} coinSlug
 * @returns {Promise<Array<object>>}
 */
export async function getProvidersByCoin(client, coinSlug) {
  const result = await client.execute({
    sql: "SELECT vendor_id, vendor_name, url, enabled, selector, hints, skip_bounds FROM provider_vendors WHERE coin_slug = ? ORDER BY vendor_id",
    args: [coinSlug],
  });
  return result.rows.map((row) => ({
    id: row.vendor_id,
    name: row.vendor_name,
    url: row.url,
    enabled: row.enabled === 1,
    ...(row.selector ? { selector: row.selector } : {}),
    ...(row.hints ? { hints: row.hints } : {}),
    ...(row.skip_bounds === 1 ? { skipPriceBounds: true } : {}),
  }));
}

/**
 * Get all coins (without vendors).
 *
 * @param {import("@libsql/client").Client} client
 * @returns {Promise<Array<object>>}
 */
export async function getAllCoins(client) {
  const result = await client.execute(
    "SELECT slug, metal, name, weight_oz, fbp_url, fbp_match, notes, enabled FROM provider_coins ORDER BY slug"
  );
  return result.rows.map((row) => ({
    slug: row.slug,
    metal: row.metal,
    name: row.name,
    weight_oz: row.weight_oz,
    fbp_url: row.fbp_url,
    fbp_match: row.fbp_match,
    notes: row.notes,
    enabled: row.enabled === 1,
  }));
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Insert or update a coin.
 *
 * @param {import("@libsql/client").Client} client
 * @param {object} coin
 * @param {string} coin.slug
 * @param {string} coin.metal
 * @param {string} coin.name
 * @param {number} [coin.weight_oz=1.0]
 * @param {string} [coin.fbp_url]
 * @param {string} [coin.fbp_match]
 * @param {string} [coin.notes]
 * @param {boolean} [coin.enabled=true]
 */
export async function upsertCoin(client, coin) {
  await client.execute({
    sql: `
      INSERT INTO provider_coins (slug, metal, name, weight_oz, fbp_url, fbp_match, notes, enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(slug) DO UPDATE SET
        metal = excluded.metal,
        name = excluded.name,
        weight_oz = excluded.weight_oz,
        fbp_url = excluded.fbp_url,
        fbp_match = excluded.fbp_match,
        notes = excluded.notes,
        enabled = excluded.enabled,
        updated_at = datetime('now')
    `,
    args: [
      coin.slug,
      coin.metal,
      coin.name,
      coin.weight_oz ?? 1.0,
      coin.fbp_url ?? null,
      coin.fbp_match ?? null,
      coin.notes ?? null,
      coin.enabled !== false ? 1 : 0,
    ],
  });
}

/**
 * Insert or update a vendor for a coin.
 *
 * @param {import("@libsql/client").Client} client
 * @param {object} vendor
 * @param {string} vendor.coin_slug
 * @param {string} vendor.vendor_id
 * @param {string} vendor.vendor_name
 * @param {string} [vendor.url]
 * @param {boolean} [vendor.enabled=true]
 * @param {string} [vendor.selector]
 * @param {string} [vendor.hints]
 */
export async function upsertVendor(client, vendor) {
  await client.execute({
    sql: `
      INSERT INTO provider_vendors (coin_slug, vendor_id, vendor_name, url, enabled, selector, hints, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(coin_slug, vendor_id) DO UPDATE SET
        vendor_name = excluded.vendor_name,
        url = excluded.url,
        enabled = excluded.enabled,
        selector = excluded.selector,
        hints = excluded.hints,
        updated_at = datetime('now')
    `,
    args: [
      vendor.coin_slug,
      vendor.vendor_id,
      vendor.vendor_name,
      vendor.url ?? null,
      vendor.enabled !== false ? 1 : 0,
      vendor.selector ?? null,
      vendor.hints ?? null,
    ],
  });
}

/**
 * Toggle a vendor's enabled flag.
 *
 * @param {import("@libsql/client").Client} client
 * @param {string} coinSlug
 * @param {string} vendorId
 * @param {boolean} enabled
 */
export async function toggleVendor(client, coinSlug, vendorId, enabled) {
  await client.execute({
    sql: "UPDATE provider_vendors SET enabled = ?, updated_at = datetime('now') WHERE coin_slug = ? AND vendor_id = ?",
    args: [enabled ? 1 : 0, coinSlug, vendorId],
  });
}

/**
 * Update a vendor's URL.
 *
 * @param {import("@libsql/client").Client} client
 * @param {string} coinSlug
 * @param {string} vendorId
 * @param {string} url
 */
export async function updateVendorUrl(client, coinSlug, vendorId, url) {
  await client.execute({
    sql: "UPDATE provider_vendors SET url = ?, updated_at = datetime('now') WHERE coin_slug = ? AND vendor_id = ?",
    args: [url, coinSlug, vendorId],
  });
}

/**
 * Delete a coin and all its vendors (atomic batch).
 *
 * @param {import("@libsql/client").Client} client
 * @param {string} slug
 */
export async function deleteCoin(client, slug) {
  await client.batch([
    { sql: "DELETE FROM provider_vendors WHERE coin_slug = ?", args: [slug] },
    { sql: "DELETE FROM provider_coins WHERE slug = ?", args: [slug] },
  ]);
}

/**
 * Delete a single vendor.
 *
 * @param {import("@libsql/client").Client} client
 * @param {string} coinSlug
 * @param {string} vendorId
 */
export async function deleteVendor(client, coinSlug, vendorId) {
  await client.execute({
    sql: "DELETE FROM provider_vendors WHERE coin_slug = ? AND vendor_id = ?",
    args: [coinSlug, vendorId],
  });
}

/**
 * Update a vendor's selector and hints fields.
 *
 * @param {import("@libsql/client").Client} client
 * @param {string} coinSlug
 * @param {string} vendorId
 * @param {object} fields
 * @param {string|null} [fields.selector]
 * @param {string|null} [fields.hints]
 */
export async function updateVendorFields(client, coinSlug, vendorId, { selector, hints }) {
  await client.execute({
    sql: "UPDATE provider_vendors SET selector = ?, hints = ?, updated_at = datetime('now') WHERE coin_slug = ? AND vendor_id = ?",
    args: [selector ?? null, hints ?? null, coinSlug, vendorId],
  });
}

/**
 * Read one vendor row's raw hints JSON.
 *
 * @param {import("@libsql/client").Client} client
 * @param {string} coinSlug
 * @param {string} vendorId
 * @returns {Promise<string|null>} The stored hints text, or null when unset.
 * @throws {Error} When no such provider row exists.
 */
export async function getVendorHints(client, coinSlug, vendorId) {
  const result = await client.execute({
    sql: "SELECT hints FROM provider_vendors WHERE coin_slug = ? AND vendor_id = ?",
    args: [coinSlug, vendorId],
  });
  if (result.rows.length === 0) throw new Error(`No provider row for ${vendorId}/${coinSlug}`);
  return result.rows[0].hints ?? null;
}

/**
 * Update only a vendor's hints, leaving selector untouched.
 *
 * Deliberately separate from updateVendorFields, which writes both columns:
 * calling that one with just hints resolves selector to null and silently wipes
 * it. The dashboard's API Product ID input edits hints alone (STRK-324).
 *
 * Throws when the UPDATE matches no row. This is a read-modify-write partner
 * to getVendorHints, so a row deleted between the two calls would otherwise
 * make the write vanish while the caller reports success.
 *
 * @param {import("@libsql/client").Client} client
 * @param {string} coinSlug
 * @param {string} vendorId
 * @param {string|null} hints
 * @returns {Promise<{rowsAffected: number}>}
 * @throws {Error} When no provider row matched.
 */
export async function updateVendorHints(client, coinSlug, vendorId, hints) {
  const result = await client.execute({
    sql: "UPDATE provider_vendors SET hints = ?, updated_at = datetime('now') WHERE coin_slug = ? AND vendor_id = ?",
    args: [hints ?? null, coinSlug, vendorId],
  });
  if (result.rowsAffected === 0) {
    throw new Error(`No provider row for ${vendorId}/${coinSlug} — it may have just been deleted`);
  }
  return { rowsAffected: result.rowsAffected };
}

/**
 * Get the latest scrape status for every vendor.
 * Returns a Map keyed by "coinSlug:vendorId" with
 * { price, isFailed, scrapedAt, source }.
 *
 * `source` records how the row was obtained ("mintbuilder-api" for a direct
 * feed hit, "firecrawl"/"playwright"/… for a page scrape). The dashboard uses
 * it to show, per row, whether an API-fed vendor actually matched the feed or
 * quietly fell back to scraping (STRK-324).
 *
 * @param {import("@libsql/client").Client} client
 * @returns {Promise<Map<string, {price: number|null, isFailed: boolean, scrapedAt: string, source: string|null}>>}
 */
export async function getVendorScrapeStatus(client) {
  const result = await client.execute(`
    SELECT coin_slug, vendor, price, is_failed, scraped_at, source
    FROM (
      SELECT coin_slug, vendor, price, is_failed, scraped_at, source,
             ROW_NUMBER() OVER (PARTITION BY coin_slug, vendor ORDER BY scraped_at DESC) AS rn
      FROM price_snapshots
    ) sub
    WHERE rn = 1
  `);
  const map = new Map();
  for (const row of result.rows) {
    map.set(`${row.coin_slug}:${row.vendor}`, {
      price: row.price,
      isFailed: row.is_failed === 1,
      scrapedAt: row.scraped_at,
      source: row.source ?? null,
    });
  }
  return map;
}

/**
 * Get vendors with 24+ failures in the last 7 days (chronic failures).
 * Threshold: 24 failures = ~1 full day of consecutive hourly failures.
 *
 * @param {import("@libsql/client").Client} client
 * @returns {Promise<Array<{coinSlug: string, coinName: string, vendorId: string, url: string, failureCount: number, lastFailure: string, lastError: string}>>}
 */
export async function getFailureStats(client) {
  const result = await client.execute(`
    SELECT pf.coin_slug, pf.vendor_id, pv.url,
           pc.name AS coin_name, pc.metal,
           COUNT(*) AS failure_count,
           MAX(pf.failed_at) AS last_failure,
           (SELECT pf2.error FROM provider_failures pf2
            WHERE pf2.coin_slug = pf.coin_slug AND pf2.vendor_id = pf.vendor_id
            ORDER BY pf2.failed_at DESC LIMIT 1) AS last_error
    FROM provider_failures pf
    JOIN provider_coins pc ON pc.slug = pf.coin_slug
    JOIN provider_vendors pv ON pv.coin_slug = pf.coin_slug AND pv.vendor_id = pf.vendor_id
    WHERE pf.failed_at > datetime('now', '-7 days')
    GROUP BY pf.coin_slug, pf.vendor_id
    HAVING COUNT(*) >= 24
    ORDER BY failure_count DESC
  `);
  return result.rows.map((row) => ({
    coinSlug: row.coin_slug,
    coinName: row.coin_name,
    vendorId: row.vendor_id,
    url: row.url,
    metal: row.metal,
    failureCount: row.failure_count,
    lastFailure: row.last_failure,
    lastError: row.last_error,
  }));
}

/**
 * Get failures from the last completed poller run (not the current/pending one).
 * Used by the failure queue to show actionable items from the previous scan.
 *
 * @param {import("@libsql/client").Client} client
 * @returns {Promise<Array<{coinSlug: string, coinName: string, metal: string, vendorId: string, url: string, error: string, failedAt: string, runId: string}>>}
 */
export async function getLastScanFailures(client) {
  const result = await client.execute(`
    WITH last_run AS (
      SELECT run_id, started_at, finished_at
      FROM poller_runs
      WHERE poller_id IN ('home', 'home-retail')
        AND status = 'ok'
        AND finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    )
    SELECT pf.coin_slug, pf.vendor_id, pf.error, pf.failed_at,
           pc.name AS coin_name, pc.metal,
           pv.url,
           lr.run_id
    FROM provider_failures pf
    JOIN provider_coins pc ON pc.slug = pf.coin_slug
    JOIN provider_vendors pv ON pv.coin_slug = pf.coin_slug AND pv.vendor_id = pf.vendor_id
    CROSS JOIN last_run lr
    WHERE pf.failed_at >= lr.started_at
      AND pf.failed_at <= lr.finished_at
    ORDER BY pf.failed_at ASC
  `);
  return result.rows.map((row) => ({
    coinSlug: row.coin_slug,
    coinName: row.coin_name,
    metal: row.metal,
    vendorId: row.vendor_id,
    url: row.url,
    error: row.error,
    failedAt: row.failed_at,
    runId: row.run_id,
  }));
}

/**
 * Clear a specific chronic failure entry (dismiss from chronic list).
 *
 * @param {import("@libsql/client").Client} client
 * @param {string} coinSlug
 * @param {string} vendorId
 * @returns {Promise<{rowsAffected: number}>}
 */
export async function clearChronicFailure(client, coinSlug, vendorId) {
  const result = await client.execute({
    sql: "DELETE FROM provider_failures WHERE coin_slug = ? AND vendor_id = ? AND failed_at > datetime('now', '-7 days')",
    args: [coinSlug, vendorId],
  });
  return { rowsAffected: result.rowsAffected };
}

/**
 * Clear ALL chronic failure entries (bulk dismiss).
 *
 * @param {import("@libsql/client").Client} client
 * @returns {Promise<{rowsAffected: number}>}
 */
export async function clearAllChronicFailures(client) {
  const result = await client.execute(
    "DELETE FROM provider_failures WHERE failed_at > datetime('now', '-7 days')"
  );
  return { rowsAffected: result.rowsAffected };
}

/**
 * Get all providers grouped by vendor (for vendor-centric view).
 * Returns vendors with their items and aggregate scrape stats.
 *
 * @param {import("@libsql/client").Client} client
 * @returns {Promise<Array<{vendorId: string, vendorName: string, items: Array}>>}
 */
export async function getProvidersByVendor(client) {
  const result = await client.execute(`
    SELECT pv.vendor_id, pv.vendor_name, pv.coin_slug, pv.url, pv.enabled,
           pv.selector, pv.hints, pv.skip_bounds,
           pc.name AS coin_name, pc.metal, pc.weight_oz
    FROM provider_vendors pv
    JOIN provider_coins pc ON pc.slug = pv.coin_slug
    ORDER BY pv.vendor_id, pc.metal, pc.name
  `);

  const vendorMap = new Map();
  for (const row of result.rows) {
    if (!vendorMap.has(row.vendor_id)) {
      vendorMap.set(row.vendor_id, {
        vendorId: row.vendor_id,
        vendorName: row.vendor_name,
        items: [],
      });
    }
    vendorMap.get(row.vendor_id).items.push({
      coinSlug: row.coin_slug,
      coinName: row.coin_name,
      metal: row.metal,
      weightOz: row.weight_oz,
      url: row.url,
      enabled: row.enabled === 1,
      selector: row.selector,
      hints: row.hints,
      skipBounds: row.skip_bounds === 1,
    });
  }
  return [...vendorMap.values()];
}

/**
 * Get poller run stats for the last 24 hours.
 *
 * @param {import("@libsql/client").Client} client
 * @returns {Promise<{totalRuns: number, successRate: number, avgCaptureRate: number, avgDuration: string}>}
 */

/**
 * Get daily failure counts for the last N days (for trend chart).
 *
 * @param {import("@libsql/client").Client} client
 * @param {number} [days=7]
 * @returns {Promise<Array<{day: string, failures: number, uniquePairs: number}>>}
 */
export async function getFailureTrend(client, days = 7) {
  const result = await client.execute({
    sql: `
      SELECT date(failed_at) AS day, COUNT(*) AS failures,
             COUNT(DISTINCT coin_slug || ':' || vendor_id) AS unique_pairs
      FROM provider_failures
      WHERE failed_at > datetime('now', ? || ' days')
      GROUP BY day ORDER BY day
    `,
    args: [`-${days}`],
  });
  return result.rows.map((r) => ({
    day: r.day,
    failures: Number(r.failures),
    uniquePairs: Number(r.unique_pairs),
  }));
}
export async function getRunStats(client, pollerId = null) {
  const where = pollerId
    ? "WHERE started_at > datetime('now', '-24 hours') AND poller_id IN ('" +
      (Array.isArray(pollerId) ? pollerId.join("','") : pollerId) +
      "')"
    : "WHERE started_at > datetime('now', '-24 hours')";
  const result = await client.execute(`
    SELECT
      COUNT(*) AS total_runs,
      SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0) AS success_rate,
      AVG(captured * 100.0 / NULLIF(captured + failures, 0)) AS avg_capture_rate,
      AVG(CAST((julianday(finished_at) - julianday(started_at)) * 86400 AS INTEGER)) AS avg_duration_sec
    FROM poller_runs
    ${where}
  `);
  const row = result.rows[0];
  return {
    totalRuns: row.total_runs ?? 0,
    successRate: Math.round(row.success_rate ?? 0),
    avgCaptureRate: Math.round(row.avg_capture_rate ?? 0),
    avgDurationSec: Math.round(row.avg_duration_sec ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

/**
 * Toggle enabled flag for all vendors of a given vendor ID + metal type.
 *
 * @param {import("@libsql/client").Client} client
 * @param {object} options
 * @param {string} options.vendorId
 * @param {string} options.metal
 * @param {boolean} options.enabled
 * @returns {Promise<{rowsAffected: number}>}
 */
export async function batchToggleVendor(client, { vendorId, metal, enabled }) {
  const result = await client.execute({
    sql: `UPDATE provider_vendors SET enabled = ?, updated_at = datetime('now')
          WHERE vendor_id = ? AND coin_slug IN (SELECT slug FROM provider_coins WHERE metal = ?)`,
    args: [enabled ? 1 : 0, vendorId, metal],
  });
  return { rowsAffected: result.rowsAffected };
}

/**
 * Delete all vendor entries for a given vendor ID + metal type.
 *
 * @param {import("@libsql/client").Client} client
 * @param {object} options
 * @param {string} options.vendorId
 * @param {string} options.metal
 * @returns {Promise<{rowsAffected: number}>}
 */
export async function batchDeleteVendor(client, { vendorId, metal }) {
  const result = await client.execute({
    sql: `DELETE FROM provider_vendors
          WHERE vendor_id = ? AND coin_slug IN (SELECT slug FROM provider_coins WHERE metal = ?)`,
    args: [vendorId, metal],
  });
  return { rowsAffected: result.rowsAffected };
}

/**
 * Toggle enabled flag for a vendor across specific coin slugs.
 *
 * @param {import("@libsql/client").Client} client
 * @param {object} options
 * @param {string} options.vendorId
 * @param {string[]} options.coinSlugs
 * @param {boolean} options.enabled
 * @returns {Promise<{rowsAffected: number}>}
 */
export async function batchToggleVendorByCoins(client, { vendorId, coinSlugs, enabled }) {
  if (!coinSlugs || coinSlugs.length === 0) return { rowsAffected: 0 };
  const placeholders = coinSlugs.map(() => "?").join(", ");
  const result = await client.execute({
    sql: `UPDATE provider_vendors SET enabled = ?, updated_at = datetime('now')
          WHERE vendor_id = ? AND coin_slug IN (${placeholders})`,
    args: [enabled ? 1 : 0, vendorId, ...coinSlugs],
  });
  return { rowsAffected: result.rowsAffected };
}

/**
 * Get a summary of all vendors grouped by vendor ID and metal type.
 *
 * @param {import("@libsql/client").Client} client
 * @returns {Promise<Object<string, {total: number, enabled: number, disabled: number, byMetal: Object<string, {total: number, enabled: number, disabled: number}>}>>}
 */
export async function getVendorSummary(client) {
  const result = await client.execute(`
    SELECT pv.vendor_id, pc.metal, pv.enabled, COUNT(*) AS cnt
    FROM provider_vendors pv
    JOIN provider_coins pc ON pc.slug = pv.coin_slug
    GROUP BY pv.vendor_id, pc.metal, pv.enabled
    ORDER BY pv.vendor_id, pc.metal
  `);

  const summary = {};
  for (const row of result.rows) {
    const vid = row.vendor_id;
    if (!summary[vid]) summary[vid] = { total: 0, enabled: 0, disabled: 0, byMetal: {} };
    const vendor = summary[vid];
    const count = Number(row.cnt);
    const isEnabled = row.enabled === 1;

    vendor.total += count;
    if (isEnabled) vendor.enabled += count;
    else vendor.disabled += count;

    if (!vendor.byMetal[row.metal])
      vendor.byMetal[row.metal] = { total: 0, enabled: 0, disabled: 0 };
    const m = vendor.byMetal[row.metal];
    m.total += count;
    if (isEnabled) m.enabled += count;
    else m.disabled += count;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Coverage & missing items (dashboard)
// ---------------------------------------------------------------------------

/**
 * Get hourly coverage stats — how many enabled vendor-coin pairs had a
 * successful price snapshot in each of the last N hours.
 *
 * @param {import("@libsql/client").Client} client
 * @param {number} [hours=12]
 * @returns {Promise<{totalEnabled: number, hours: Array<{hour: string, covered: number, pct: number}>}>}
 */
export async function getCoverageStats(client, hours = 24) {
  const enabledResult = await client.execute(
    "SELECT COUNT(*) AS cnt FROM provider_vendors WHERE enabled = 1"
  );
  const totalEnabled = Number(enabledResult.rows[0].cnt);

  const result = await client.execute({
    sql: `
      SELECT strftime('%Y-%m-%dT%H:00', scraped_at) AS hour,
             COUNT(DISTINCT coin_slug || ':' || vendor) AS covered
      FROM price_snapshots
      WHERE is_failed = 0
        AND scraped_at > datetime('now', ? || ' hours')
      GROUP BY hour
      ORDER BY hour DESC
    `,
    args: [`-${hours}`],
  });

  const hourlyStats = result.rows.map((row) => ({
    hour: row.hour,
    covered: Number(row.covered),
    pct:
      totalEnabled > 0 ? Math.min(100, Math.round((Number(row.covered) / totalEnabled) * 100)) : 0,
  }));

  return { totalEnabled, hours: hourlyStats };
}

/**
 * Get enabled vendor-coin pairs that had NO successful price in the current hour.
 *
 * @param {import("@libsql/client").Client} client
 * @returns {Promise<Array<{coinSlug: string, coinName: string, metal: string, vendor: string, url: string|null}>>}
 */

/**
 * Get spot price coverage by 15-min interval for the last N hours.
 * Returns stats about how many intervals had spot data from each source.
 *
 * @param {import("@libsql/client").Client} client
 * @param {number} [hours=6]
 * @returns {Promise<{totalIntervals: number, coveredIntervals: number, intervals: Array<{quarter: string, sources: number, metals: number}>, byPoller: Object<string, number>}>}
 */
export async function getSpotCoverage(client, hours = 6) {
  // Expected intervals = hours * 4 (every 15 min)
  const totalIntervals = hours * 4;

  const result = await client.execute({
    sql: `
      SELECT
        strftime('%Y-%m-%dT%H:', timestamp) ||
        CASE
          WHEN CAST(strftime('%M', timestamp) AS INTEGER) < 15 THEN '00'
          WHEN CAST(strftime('%M', timestamp) AS INTEGER) < 30 THEN '15'
          WHEN CAST(strftime('%M', timestamp) AS INTEGER) < 45 THEN '30'
          ELSE '45'
        END AS quarter,
        COUNT(DISTINCT poller_id) AS sources,
        COUNT(DISTINCT metal) AS metals
      FROM spot_prices
      WHERE timestamp > datetime('now', ? || ' hours')
      GROUP BY quarter
      ORDER BY quarter
    `,
    args: [`-${hours}`],
  });

  const intervals = result.rows.map((r) => ({
    quarter: r.quarter,
    sources: Number(r.sources),
    metals: Number(r.metals),
  }));

  // By-poller breakdown
  const pollerResult = await client.execute({
    sql: `
      SELECT poller_id, COUNT(DISTINCT
        strftime('%Y-%m-%dT%H:', timestamp) ||
        CASE
          WHEN CAST(strftime('%M', timestamp) AS INTEGER) < 15 THEN '00'
          WHEN CAST(strftime('%M', timestamp) AS INTEGER) < 30 THEN '15'
          WHEN CAST(strftime('%M', timestamp) AS INTEGER) < 45 THEN '30'
          ELSE '45'
        END
      ) AS covered
      FROM spot_prices
      WHERE timestamp > datetime('now', ? || ' hours')
      GROUP BY poller_id
    `,
    args: [`-${hours}`],
  });

  const byPoller = {};
  for (const r of pollerResult.rows) {
    byPoller[r.poller_id] = Number(r.covered);
  }

  return {
    totalIntervals,
    coveredIntervals: intervals.length,
    intervals,
    byPoller,
    hours,
  };
}

export async function getMissingItems(client) {
  const result = await client.execute(`
    SELECT pv.coin_slug, pc.name AS coin_name, pc.metal, pv.vendor_id AS vendor, pv.url
    FROM provider_vendors pv
    JOIN provider_coins pc ON pc.slug = pv.coin_slug
    WHERE pv.enabled = 1
      AND NOT EXISTS (
        SELECT 1 FROM price_snapshots ps
        WHERE ps.coin_slug = pv.coin_slug
          AND ps.vendor = pv.vendor_id
          AND ps.is_failed = 0
          AND ps.scraped_at > strftime('%Y-%m-%dT%H:00', 'now')
      )
    ORDER BY pc.metal, pc.name, pv.vendor_id
  `);
  return result.rows.map((row) => ({
    coinSlug: row.coin_slug,
    coinName: row.coin_name,
    metal: row.metal,
    vendor: row.vendor,
    url: row.url,
  }));
}

// ---------------------------------------------------------------------------
// Export — generates providers.json content from sqld
// ---------------------------------------------------------------------------

/**
 * Generate a JSON string matching the current providers.json format.
 * Used by run-publish.sh to write the file before pushing to the api branch.
 *
 * @param {import("@libsql/client").Client} client
 * @returns {Promise<string>}  JSON string (pretty-printed, 2-space indent)
 */
export async function exportProvidersJson(client) {
  const data = await getProviders(client);
  return JSON.stringify(data, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Fallback — read from local providers.json when sqld is unreachable
// ---------------------------------------------------------------------------

/**
 * Read providers.json from the local filesystem.
 * Used as fallback when sqld is down.
 *
 * @param {string} dataDir  Path to the data/ folder
 * @returns {object}  Parsed providers.json
 */
export function loadProvidersFromFile(dataDir) {
  const filePath = join(dataDir, "retail", "providers.json");
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

/**
 * Load providers with file-first, sqld-fallback strategy.
 * Set FORCE_TURSO_PROVIDERS=1 to bypass file and go straight to sqld.
 *
 * @param {import("@libsql/client").Client|null} client  sqld client (null to skip)
 * @param {string} dataDir  Path to the data/ folder (for file read)
 * @returns {Promise<object>}  Provider data in providers.json shape
 */
export async function loadProviders(client, dataDir) {
  if (process.env.FORCE_TURSO_PROVIDERS === "1") {
    if (client) {
      try {
        const data = await getProviders(client);
        const coinCount = Object.keys(data.coins).length;
        console.log(`[provider-db] Loaded ${coinCount} coins from sqld (forced)`);
        return data;
      } catch (err) {
        console.warn(`[provider-db] sqld failed (forced mode): ${err.message}`);
      }
    }
    throw new Error("[provider-db] FORCE_TURSO_PROVIDERS=1 but sqld unavailable");
  }

  try {
    const data = loadProvidersFromFile(dataDir);
    const coinCount = Object.keys(data.coins || {}).length;
    if (coinCount > 0) {
      console.log(`[provider-db] Loaded ${coinCount} coins from local file`);
      return data;
    }
    console.warn("[provider-db] WARN: local providers.json is empty, falling back to sqld");
  } catch (err) {
    console.warn(
      `[provider-db] WARN: local providers.json unavailable, falling back to sqld: ${err.message}`
    );
  }

  if (client) {
    try {
      const data = await getProviders(client);
      const coinCount = Object.keys(data.coins).length;
      console.log(`[provider-db] Loaded ${coinCount} coins from sqld (fallback)`);
      return data;
    } catch (err) {
      console.warn(`[provider-db] sqld fallback also failed: ${err.message}`);
    }
  }

  throw new Error("[provider-db] Both local file and sqld unavailable");
}

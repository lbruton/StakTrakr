#!/usr/bin/env node
/**
 * StakTrakr v2 API Publisher — Spot Endpoints
 * =============================================
 * Reads spot_prices from Turso, writes v2 JSON endpoints.
 * Called by run-publish.sh after api-export.js.
 *
 * Output structure:
 *   data/v2/
 *     spot/
 *       latest.json
 *       history/{7,30,90}d.json
 *       {metal}/
 *         latest.json
 *         intraday.json
 *         {YYYY}/{MM}/{DD}.json
 *         {YYYY}/{MM}.json
 *
 * Usage:
 *   DATA_DIR=/path/to/data node api-export-v2.js
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openTursoDb } from "./db.js";
import {
  toTimestampPair,
  computeOhlca,
  wrapEnvelope,
} from "./v2-utils.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, "../../data"));
const DRY_RUN = process.env.DRY_RUN === "1";

const METALS = ["gold", "silver", "platinum", "palladium"];
const METAL_TO_ISO = { gold: "xau", silver: "xag", platinum: "xpt", palladium: "xpd" };

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

function writeV2File(relPath, data, staleAfterSeconds) {
  const filePath = join(DATA_DIR, "v2", relPath);
  if (DRY_RUN) {
    log(`[DRY RUN] ${filePath}`);
    return;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  const envelope = wrapEnvelope(data, staleAfterSeconds);
  writeFileSync(filePath, JSON.stringify(envelope, null, 2) + "\n");
  log(`Wrote ${filePath}`);
}

// ---------------------------------------------------------------------------
// Turso spot queries
// ---------------------------------------------------------------------------

async function querySpotCurrent(client) {
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

async function querySpotRange(client, startIso, endIso) {
  const result = await client.execute({
    sql: `
      SELECT *
      FROM spot_prices
      WHERE timestamp_floor >= ? AND timestamp_floor < ?
      ORDER BY metal, timestamp_floor
    `,
    args: [startIso, endIso],
  });
  return result.rows;
}

async function querySpot24hAgo(client, metal) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace(".000Z", "Z");
  const result = await client.execute({
    sql: `
      SELECT spot
      FROM spot_prices
      WHERE metal = ? AND timestamp_floor >= ?
      ORDER BY timestamp_floor ASC
      LIMIT 1
    `,
    args: [metal, cutoff],
  });
  return result.rows.length ? Number(result.rows[0].spot) : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByMetal(rows) {
  const map = {};
  for (const row of rows) {
    const metal = String(row.metal);
    if (!map[metal]) map[metal] = [];
    map[metal].push(row);
  }
  return map;
}

function buildOhlcaBuckets(rows, granularity) {
  const buckets = {};
  for (const row of rows) {
    const { t, ts } = toTimestampPair(new Date(String(row.timestamp_floor)), granularity);
    if (!buckets[t]) buckets[t] = { t, ts, samples: [] };
    buckets[t].samples.push({ price: Number(row.spot), timestamp: String(row.timestamp_floor) });
  }

  const entries = [];
  for (const key of Object.keys(buckets).sort()) {
    const bucket = buckets[key];
    const ohlca = computeOhlca(bucket.samples);
    if (ohlca) {
      entries.push({ t: bucket.t, ts: bucket.ts, ...ohlca });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Spot export
// ---------------------------------------------------------------------------

async function exportSpot(client) {
  log("Exporting v2 spot prices...");

  const now = new Date();

  // --- spot/latest.json (all metals) ---
  const currentRows = await querySpotCurrent(client);
  if (!currentRows.length) {
    warn("No current spot data — skipping spot export");
    return;
  }

  const latestAll = {};
  for (const row of currentRows) {
    const iso = METAL_TO_ISO[String(row.metal)];
    if (!iso) continue;
    const { t, ts } = toTimestampPair(new Date(String(row.timestamp_floor)), "15min");
    latestAll[iso] = { price: Number(row.spot), t, ts };
  }
  writeV2File("spot/latest.json", latestAll, 1200);

  // --- Per-metal endpoints ---
  for (const metal of METALS) {
    const iso = METAL_TO_ISO[metal];
    const metalRows = currentRows.filter((r) => String(r.metal) === metal);
    if (!metalRows.length) {
      warn(`No spot data for ${metal} — skipping`);
      continue;
    }

    // spot/{metal}/latest.json
    const row = metalRows[0];
    const { t, ts } = toTimestampPair(new Date(String(row.timestamp_floor)), "15min");
    const price24hAgo = await querySpot24hAgo(client, metal);
    const price = Number(row.spot);
    const perMetalLatest = { metal: iso, price, t, ts };
    if (price24hAgo !== null) {
      perMetalLatest.change_24h = parseFloat((price - price24hAgo).toFixed(2));
      perMetalLatest.change_24h_pct = parseFloat((((price - price24hAgo) / price24hAgo) * 100).toFixed(2));
    }
    writeV2File(`spot/${iso}/latest.json`, perMetalLatest, 1200);

    // spot/{metal}/intraday.json — rolling 24h of 15-min OHLCA
    const intradayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().replace(".000Z", "Z");
    const intradayEnd = now.toISOString().replace(".000Z", "Z");
    const intradayRows = (await querySpotRange(client, intradayStart, intradayEnd))
      .filter((r) => String(r.metal) === metal);
    const intradayEntries = buildOhlcaBuckets(intradayRows, "15min");
    writeV2File(`spot/${iso}/intraday.json`, intradayEntries, 1200);

    // spot/{metal}/{YYYY}/{MM}/{DD}.json — today's hourly OHLCA
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const dayStart = `${yyyy}-${mm}-${dd}T00:00:00Z`;
    const nextDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const dayEnd = nextDay.toISOString().replace(".000Z", "Z");
    const dayRows = (await querySpotRange(client, dayStart, dayEnd))
      .filter((r) => String(r.metal) === metal);
    const hourlyEntries = buildOhlcaBuckets(dayRows, "hourly");
    if (hourlyEntries.length) {
      writeV2File(`spot/${iso}/${yyyy}/${mm}/${dd}.json`, hourlyEntries, 3600);
    }

    // spot/{metal}/{YYYY}/{MM}.json — current month daily OHLCA (noon UTC)
    const monthStart = `${yyyy}-${mm}-01T00:00:00Z`;
    const monthEnd = nextDay.toISOString().replace(".000Z", "Z");
    const monthRows = (await querySpotRange(client, monthStart, monthEnd))
      .filter((r) => String(r.metal) === metal);
    const dailyEntries = buildOhlcaBuckets(monthRows, "daily");
    if (dailyEntries.length) {
      writeV2File(`spot/${iso}/${yyyy}/${mm}.json`, dailyEntries, 86400);
    }
  }

  // --- spot/history/{7,30,90}d.json ---
  for (const days of [7, 30, 90]) {
    const histStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().replace(".000Z", "Z");
    const histEnd = now.toISOString().replace(".000Z", "Z");
    const histRows = await querySpotRange(client, histStart, histEnd);
    const byMetal = groupByMetal(histRows);

    const histData = {};
    for (const metal of METALS) {
      const iso = METAL_TO_ISO[metal];
      const metalHist = byMetal[metal] || [];
      histData[iso] = buildOhlcaBuckets(metalHist, "daily");
    }
    writeV2File(`spot/history/${days}d.json`, histData, 3600);
  }

  log("Spot export complete");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log("v2 publisher starting...");
  log(`DATA_DIR: ${DATA_DIR}`);

  const client = await openTursoDb();
  try {
    await exportSpot(client);
  } finally {
    client.close();
  }

  log("v2 publisher finished");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

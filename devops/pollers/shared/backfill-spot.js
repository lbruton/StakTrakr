/**
 * backfill-spot.js — One-time import of historical JSON spot files into sqld.
 *
 * Usage:
 *   DATA_DIR=/path/to/data node backfill-spot.js
 *
 * Scans DATA_DIR/hourly/ and DATA_DIR/15min/ for spot price JSON files,
 * parses each, and inserts into the spot_prices table via insertSpotPrices().
 * Idempotent — safe to re-run (INSERT OR REPLACE semantics).
 */

import { createSqldClient, initSqldSchema } from "./sqld-client.js";
import { insertSpotPrices } from "./db.js";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DATA_DIR = process.env.DATA_DIR;
if (!DATA_DIR) {
  console.error("ERROR: DATA_DIR environment variable is required.");
  process.exit(1);
}

/**
 * Recursively collect all .json file paths under a directory.
 * @param {string} dir - Root directory to scan.
 * @returns {Promise<string[]>} Sorted list of absolute paths.
 */
async function collectJsonFiles(dir) {
  const results = [];

  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return; // directory doesn't exist or unreadable — skip
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        results.push(full);
      }
    }
  }

  await walk(dir);
  results.sort();
  return results;
}

/**
 * Convert "YYYY-MM-DD HH:MM:SS" to ISO 8601 "YYYY-MM-DDTHH:MM:SSZ".
 * @param {string} ts
 * @returns {string}
 */
function toISO(ts) {
  return ts.replace(" ", "T") + "Z";
}

/**
 * Parse a spot JSON file and return the payload for insertSpotPrices,
 * or null if the file is corrupt / missing expected data.
 * @param {string} filePath
 * @returns {Promise<{gold: number, silver: number, platinum: number, palladium: number, timestamp: string} | null>}
 */
async function parseSpotFile(filePath) {
  const raw = await readFile(filePath, "utf-8");
  const entries = JSON.parse(raw);

  if (!Array.isArray(entries) || entries.length === 0) return null;

  const metals = { gold: null, silver: null, platinum: null, palladium: null };
  let timestamp = null;

  for (const entry of entries) {
    const key = entry.metal?.toLowerCase();
    if (key && key in metals) {
      metals[key] = entry.spot;
      if (!timestamp && entry.timestamp) {
        timestamp = toISO(entry.timestamp);
      }
    }
  }

  if (!timestamp) return null;

  // Ensure all four metals have non-null values before inserting.
  if (Object.values(metals).some((value) => value == null)) {
    return null;
  }

  return { ...metals, timestamp };
}

async function main() {
  const client = createSqldClient();
  await initSqldSchema(client);

  const hourlyDir = join(DATA_DIR, "hourly");
  const fifteenMinDir = join(DATA_DIR, "15min");

  console.log(`Scanning ${hourlyDir} and ${fifteenMinDir} ...`);

  const hourlyFiles = await collectJsonFiles(hourlyDir);
  const fifteenMinFiles = await collectJsonFiles(fifteenMinDir);
  const allFiles = [...hourlyFiles, ...fifteenMinFiles];

  console.log(
    `Found ${hourlyFiles.length} hourly + ${fifteenMinFiles.length} 15min = ${allFiles.length} total files.`
  );

  let processed = 0;
  let skipped = 0;
  let rows = 0;

  for (const filePath of allFiles) {
    try {
      const payload = await parseSpotFile(filePath);
      if (!payload) {
        console.warn(`SKIP (no valid data): ${filePath}`);
        skipped++;
        continue;
      }
      await insertSpotPrices(client, payload, "backfill");
      processed++;
      rows += 4;
    } catch (err) {
      console.warn(`SKIP (error): ${filePath} — ${err.message}`);
      skipped++;
      continue;
    }

    if ((processed + skipped) % 100 === 0) {
      console.log(
        `Progress: ${processed + skipped}/${allFiles.length} files (${processed} ok, ${skipped} skipped)`
      );
    }
  }

  console.log(
    `Backfill complete: ${processed} files processed, ${skipped} skipped, ${rows} rows imported`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

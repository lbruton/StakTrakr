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
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SPOT_METAL_KEYS, LEGACY_SPOT_METAL_KEYS } from "./spot-metals.js";

// Checked inside main() rather than at module scope — a top-level process.exit
// kills any test that imports this file just to reach the pure helpers.
const DATA_DIR = process.env.DATA_DIR;

/**
 * ISO instant from which copper must be present in an archived spot file.
 *
 * Copper started being written at a specific deploy, so archived files split
 * into two eras: before it, a file with no copper is CORRECT; after it, a file
 * with no copper means the poll failed and the gap should be reported loudly.
 *
 * Making copper permanently optional was considered and rejected. It would
 * destroy the only copper-gap detector — an outage would import as a silently
 * incomplete file that the healer reports as success, leaving a permanent hole
 * nothing could find (STRK-303).
 *
 * Unset means "no enforcement", which is correct for a purely pre-copper
 * archive. A one-time warning is emitted so that state is never silent.
 * @constant {string|undefined}
 */
const COPPER_REQUIRED_FROM = process.env.COPPER_REQUIRED_FROM;

/** Parsed cutover, or null when enforcement is off. @constant {number|null} */
const COPPER_CUTOVER_MS = (() => {
  if (!COPPER_REQUIRED_FROM) return null;
  const parsed = Date.parse(COPPER_REQUIRED_FROM);
  if (Number.isNaN(parsed)) {
    console.error(`ERROR: COPPER_REQUIRED_FROM is not a valid ISO date: ${COPPER_REQUIRED_FROM}`);
    process.exit(1);
  }
  return parsed;
})();

/**
 * Metals that must be present for a given file timestamp.
 * @param {string} timestamp - ISO timestamp taken from the file's entries.
 * @returns {string[]} Required lowercase metal keys.
 */
function requiredMetalsFor(timestamp) {
  if (COPPER_CUTOVER_MS === null) return LEGACY_SPOT_METAL_KEYS;
  const fileMs = Date.parse(timestamp);
  if (Number.isNaN(fileMs) || fileMs < COPPER_CUTOVER_MS) return LEGACY_SPOT_METAL_KEYS;
  return SPOT_METAL_KEYS;
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
 * Parse a spot JSON file into an insertSpotPrices payload.
 *
 * Returns null when the file is corrupt, undated, or missing a metal that was
 * required for its era — the caller reports those loudly rather than importing
 * a partial hour.
 *
 * @param {string} filePath - Absolute path to an archived spot JSON file.
 * @returns {Promise<{payload: Record<string, number|string>, metals: string[]} | null>}
 *   The payload plus the metal keys actually present, or null to skip.
 */
async function parseSpotFile(filePath) {
  const raw = await readFile(filePath, "utf-8");
  const entries = JSON.parse(raw);

  if (!Array.isArray(entries) || entries.length === 0) return null;

  const metals = {};
  let timestamp = null;

  for (const entry of entries) {
    const key = entry.metal?.toLowerCase();
    if (key && SPOT_METAL_KEYS.includes(key) && entry.spot != null) {
      metals[key] = entry.spot;
      if (!timestamp && entry.timestamp) {
        timestamp = toISO(entry.timestamp);
      }
    }
  }

  if (!timestamp) return null;

  // Era-aware completeness gate. Pre-cutover files legitimately carry no
  // copper; post-cutover files missing it represent a real gap.
  const required = requiredMetalsFor(timestamp);
  if (required.some((metal) => metals[metal] == null)) {
    return null;
  }

  const present = SPOT_METAL_KEYS.filter((metal) => metals[metal] != null);
  return { payload: { ...metals, timestamp }, metals: present };
}

async function main() {
  if (!DATA_DIR) {
    console.error("ERROR: DATA_DIR environment variable is required.");
    process.exit(1);
  }

  if (COPPER_CUTOVER_MS === null) {
    console.warn(
      "COPPER_REQUIRED_FROM is not set — copper gaps will NOT be reported. " +
        "Set it to the Phase 1a deploy instant (ISO 8601) once copper is live."
    );
  } else {
    console.log(`Copper required for files at or after ${COPPER_REQUIRED_FROM}.`);
  }

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
      const parsed = await parseSpotFile(filePath);
      if (!parsed) {
        console.warn(`SKIP (no valid data): ${filePath}`);
        skipped++;
        continue;
      }
      await insertSpotPrices(client, parsed.payload, "backfill", parsed.metals);
      processed++;
      rows += parsed.metals.length;
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

// Run only when executed directly, so tests can import the pure helpers without
// starting a live import. Matches backfill-spot-files.js (STRK-303).
const isDirectRun = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

export { parseSpotFile, requiredMetalsFor };

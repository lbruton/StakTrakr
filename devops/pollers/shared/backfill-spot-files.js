/**
 * backfill-spot-files.js — Regenerate hourly spot JSON files from sqld.
 *
 * Reverse of backfill-spot.js (which imports files INTO sqld). Used to heal
 * publication gaps where spot rows kept landing in sqld but file writes
 * failed (e.g. the 2026-06-11 inode-exhaustion outage, STRK-187).
 *
 * Usage (on the Fly machine, or anywhere with sqld access):
 *   DATA_DIR=/data/staktrakr-api-export/data node backfill-spot-files.js \
 *     --from 2026-06-11T06 --to 2026-06-11T13 [--overwrite] [--dry-run]
 *
 * Hours are UTC, inclusive on both ends; --to defaults to --from.
 * Existing files are skipped unless --overwrite. Output is byte-compatible
 * with the hourly files spot-extract.js writes.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const METAL_ORDER = ["Gold", "Silver", "Platinum", "Palladium"];
const HOUR_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/;
const MAX_RANGE_HOURS = 24 * 366; // sanity cap — one year

/**
 * Parse CLI arguments.
 * @param {string[]} argv - e.g. process.argv.slice(2)
 * @returns {{ from: string, to: string, overwrite: boolean, dryRun: boolean }}
 */
export function parseArgs(argv) {
  const opts = { from: null, to: null, overwrite: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--from") opts.from = argv[++i];
    else if (arg === "--to") opts.to = argv[++i];
    else if (arg === "--overwrite") opts.overwrite = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!opts.from) throw new Error("--from YYYY-MM-DDTHH is required");
  if (!opts.to) opts.to = opts.from;
  for (const [name, value] of [
    ["--from", opts.from],
    ["--to", opts.to],
  ]) {
    const m = HOUR_RE.exec(value);
    if (!m || Number(m[4]) > 23) {
      throw new Error(`${name} must be YYYY-MM-DDTHH (UTC, hour 00-23), got: ${value}`);
    }
    // Reject impossible calendar dates (e.g. 2026-02-31) instead of letting
    // Date.UTC silently normalize them into a different day's files.
    const [, y, mo, d, hh] = m;
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh)));
    if (dt.toISOString().slice(0, 13) !== value) {
      throw new Error(`${name} contains an invalid calendar date: ${value}`);
    }
  }
  return opts;
}

/**
 * Enumerate inclusive UTC hours between two "YYYY-MM-DDTHH" bounds.
 * @param {string} fromHour
 * @param {string} toHour
 * @returns {string[]} e.g. ["2026-06-11T06", "2026-06-11T07", ...]
 */
export function enumerateHours(fromHour, toHour) {
  const toMs = (h) => {
    const [, y, mo, d, hh] = HOUR_RE.exec(h);
    return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh));
  };
  const start = toMs(fromHour);
  const end = toMs(toHour);
  if (end < start) throw new Error(`--to (${toHour}) is before --from (${fromHour})`);
  const hours = (end - start) / 3600000 + 1;
  if (hours > MAX_RANGE_HOURS) {
    throw new Error(`Range of ${hours} hours exceeds sanity cap (${MAX_RANGE_HOURS})`);
  }
  const out = [];
  for (let t = start; t <= end; t += 3600000) {
    out.push(new Date(t).toISOString().slice(0, 13));
  }
  return out;
}

/**
 * Hourly file path for a "YYYY-MM-DDTHH" hour, matching spot-extract.js layout.
 * @param {string} dataDir
 * @param {string} hour
 * @returns {string} dataDir/hourly/YYYY/MM/DD/HH.json
 */
export function hourlyPathFor(dataDir, hour) {
  const [, y, mo, d, hh] = HOUR_RE.exec(hour);
  return join(dataDir, "hourly", y, mo, d, `${hh}.json`);
}

/**
 * Convert ISO 8601 "YYYY-MM-DDTHH:MM:SSZ" to "YYYY-MM-DD HH:MM:SS"
 * (the format spot-extract.js writes into hourly entries).
 * @param {string} iso
 * @returns {string}
 */
export function isoToSpaceTs(iso) {
  return iso.replace("T", " ").replace(/(?:\.\d+)?Z?$/, "");
}

/**
 * Build hourly-file entries from sqld spot_prices rows for one hour.
 * Picks the latest row (max timestamp_floor) per metal — matching
 * spot-extract's overwrite-wins-last hourly semantics. Returns null if any
 * of the four metals is missing.
 * @param {Array<{metal: string, spot: number, timestamp: string, timestamp_floor: string}>} rows
 * @returns {Array<object> | null}
 */
export function rowsToEntries(rows) {
  const latest = {};
  for (const row of rows ?? []) {
    const key = row.metal?.toLowerCase();
    if (!key) continue;
    if (!latest[key] || row.timestamp_floor > latest[key].timestamp_floor) {
      latest[key] = row;
    }
  }
  const entries = [];
  for (const metal of METAL_ORDER) {
    const row = latest[metal.toLowerCase()];
    if (!row) return null;
    entries.push({
      spot: row.spot,
      metal,
      source: "hourly",
      provider: "StakTrakr",
      timestamp: isoToSpaceTs(row.timestamp),
    });
  }
  return entries;
}

/**
 * Whether a path exists and is accessible (async wrapper over fs.access).
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * CLI entry point: parse args, then for each UTC hour in range read the latest
 * sqld spot rows and write a byte-compatible hourly JSON file (skipping existing
 * files unless --overwrite, and only logging under --dry-run). Requires the
 * DATA_DIR env var; exits non-zero when it is unset.
 * @returns {Promise<void>}
 */
async function main() {
  const dataDir = process.env.DATA_DIR;
  if (!dataDir) {
    console.error("ERROR: DATA_DIR environment variable is required.");
    process.exit(1);
  }

  const opts = parseArgs(process.argv.slice(2));

  // Lazy import so unit tests can load the pure helpers above without
  // @libsql/client being installed (root CI has no shared/node_modules).
  const { createSqldClient } = await import("./sqld-client.js");
  const { readSpotHourly } = await import("./db.js");

  const client = createSqldClient();
  const hours = enumerateHours(opts.from, opts.to);
  console.log(
    `Backfilling ${hours.length} hour(s) ${opts.from}..${opts.to}` +
      `${opts.dryRun ? " (dry-run)" : ""}${opts.overwrite ? " (overwrite)" : ""}`
  );

  let written = 0;
  let skipped = 0;

  for (const hour of hours) {
    const filePath = hourlyPathFor(dataDir, hour);
    if (!opts.overwrite && (await fileExists(filePath))) {
      console.log(`SKIP (exists): ${filePath}`);
      skipped++;
      continue;
    }
    const [date, hh] = hour.split("T");
    const rows = await readSpotHourly(client, date, Number(hh));
    const entries = rowsToEntries(rows);
    if (!entries) {
      const present = new Set(rows.map((r) => r.metal?.toLowerCase()).filter(Boolean));
      const missing = METAL_ORDER.filter((name) => !present.has(name.toLowerCase()));
      console.warn(
        `SKIP (incomplete sqld data, missing: ${missing.join(", ")}; ${rows.length} rows): ${hour}`
      );
      skipped++;
      continue;
    }
    if (opts.dryRun) {
      console.log(`WOULD WRITE: ${filePath} (ts=${entries[0].timestamp})`);
    } else {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(entries, null, 2), "utf-8");
      console.log(`Wrote: ${filePath} (ts=${entries[0].timestamp})`);
    }
    written++;
  }

  console.log(
    `Backfill complete: ${written} file(s) ${opts.dryRun ? "would be " : ""}written, ${skipped} skipped`
  );
}

// Run only when executed directly (unlike backfill-spot.js) so tests can
// import the pure helpers without side effects.
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

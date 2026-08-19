/**
 * backfill-v2-day-files.js — Backfill a metal's v2 per-day files from
 * year-file daily history (STRK-345).
 *
 * Why: the v2 per-day hourly archive (data/v2/spot/{iso}/YYYY/MM/DD.json)
 * only begins at each metal's poller go-live — copper's first day file is
 * 2026-08-15 while the legacy metals' archive floor is 2026-03-25 — so the
 * client's hourly-resolution pulls 404 across a metal's pre-go-live window.
 * sqld cannot source the gap: spot_prices only reaches back to 2026-02 and
 * holds copper only from go-live. The deep history the STRK-302 epic
 * pre-seeded lives in the year files (data/spot-history-YYYY.json), one
 * daily row per metal — so this tool reads a year file and emits one honest
 * single-sample OHLCA entry per day (open=high=low=close=avg, n:1, t at the
 * daily row's own noon-UTC frame), wrapped in the standard v2 envelope.
 *
 * Usage (on the Fly machine; run-publish.sh pushes the files on its next cycle):
 *   DATA_DIR=/data/staktrakr-api-export/data node backfill-v2-day-files.js \
 *     --metal xcu --from 2026-03-25 --to 2026-08-14 \
 *     --source https://staktrakr.com/data/spot-history-2026.json \
 *     [--overwrite] [--dry-run]
 *
 * --source accepts a local path or an https URL (the app's published year
 * file). Days with no daily row in the source are skipped loudly. Existing
 * files are skipped unless --overwrite, so a re-run can never clobber a real
 * hourly file written by the live exporter.
 */

import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { METAL_MAP } from "./spot-metals.js";
import { wrapEnvelope } from "./v2-utils.js";

/**
 * Lowercase iso code → capitalised display name, derived from METAL_MAP so an
 * unknown code fails loudly instead of writing files for a bogus metal.
 * @constant {Record<string, string>}
 */
const ISO_TO_METAL = Object.fromEntries(
  Object.entries(METAL_MAP).map(([iso, name]) => [iso.toLowerCase(), name])
);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_RANGE_DAYS = 366; // sanity cap — one year of day files per run
const DAY_FILE_STALE_AFTER = 3600; // matches the live exporter's day-file TTL

/**
 * Parse CLI arguments.
 * @param {string[]} argv - e.g. process.argv.slice(2)
 * @returns {{ metal: string, from: string, to: string, source: string|null,
 *   overwrite: boolean, dryRun: boolean }}
 */
export function parseArgs(argv) {
  const opts = { metal: null, from: null, to: null, source: null, overwrite: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--metal") opts.metal = String(argv[++i] ?? "").toLowerCase();
    else if (arg === "--from") opts.from = argv[++i];
    else if (arg === "--to") opts.to = argv[++i];
    else if (arg === "--source") opts.source = argv[++i];
    else if (arg === "--overwrite") opts.overwrite = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!opts.metal) throw new Error("--metal <iso code, e.g. xcu> is required");
  if (!ISO_TO_METAL[opts.metal]) {
    throw new Error(
      `Unknown metal iso code: ${opts.metal} (known: ${Object.keys(ISO_TO_METAL).join(", ")})`
    );
  }
  if (!opts.from) throw new Error("--from YYYY-MM-DD is required");
  if (!opts.to) opts.to = opts.from;
  for (const [name, value] of [
    ["--from", opts.from],
    ["--to", opts.to],
  ]) {
    const m = DATE_RE.exec(value);
    if (!m) throw new Error(`${name} must be YYYY-MM-DD (UTC), got: ${value}`);
    // Reject impossible calendar dates (e.g. 2026-02-31) instead of letting
    // Date.UTC silently normalize them into a different day's file.
    const [, y, mo, d] = m;
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    if (dt.toISOString().slice(0, 10) !== value) {
      throw new Error(`${name} contains an invalid calendar date: ${value}`);
    }
  }
  return opts;
}

/**
 * Enumerate inclusive UTC dates between two "YYYY-MM-DD" bounds.
 * @param {string} fromDate
 * @param {string} toDate
 * @returns {string[]} e.g. ["2026-03-30", "2026-03-31", ...]
 */
export function enumerateDates(fromDate, toDate) {
  const toMs = (d) => {
    const [, y, mo, dd] = DATE_RE.exec(d);
    return Date.UTC(Number(y), Number(mo) - 1, Number(dd));
  };
  const start = toMs(fromDate);
  const end = toMs(toDate);
  if (end < start) throw new Error(`--to (${toDate}) is before --from (${fromDate})`);
  const days = (end - start) / 86400000 + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new Error(`Range of ${days} days exceeds sanity cap (${MAX_RANGE_DAYS})`);
  }
  const out = [];
  for (let t = start; t <= end; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Index a year file's daily rows for one metal by "YYYY-MM-DD" day key.
 * Rows are the year-file shape: { spot, metal, source, timestamp } with
 * UTC-naive "YYYY-MM-DD HH:MM:SS" timestamps. Invalid spots are dropped;
 * when a day repeats, the LAST row wins (year files are appended in
 * seed→sqld order, so later rows carry the fresher source).
 * @param {Array<{spot: number, metal: string, timestamp: string}>} rows
 * @param {string} metalName - Capitalised display name (e.g. "Copper").
 * @returns {Map<string, {spot: number}>}
 */
export function dailyRowsByDay(rows, metalName) {
  const byDay = new Map();
  for (const row of rows ?? []) {
    if (!row || row.metal !== metalName) continue;
    if (typeof row.spot !== "number" || row.spot <= 0) continue;
    if (typeof row.timestamp !== "string" || row.timestamp.length < 10) continue;
    byDay.set(row.timestamp.slice(0, 10), row);
  }
  return byDay;
}

/**
 * Build the single honest OHLCA entry for a daily-resolution backfill day.
 * open=high=low=close=avg with n:1 states plainly that the day carries one
 * sample; t sits at noon UTC — the daily rows' own frame (LBMA/daily-close
 * convention used across the year files).
 * @param {string} day - "YYYY-MM-DD"
 * @param {number} spot - USD/ozt daily price
 * @returns {{t: string, ts: number, open: number, high: number, low: number,
 *   close: number, avg: number, n: number}}
 */
export function buildDayEntry(day, spot) {
  const t = `${day}T12:00:00Z`;
  return {
    t,
    ts: Date.parse(t) / 1000,
    open: spot,
    high: spot,
    low: spot,
    close: spot,
    avg: spot,
    n: 1,
  };
}

/**
 * v2 day-file path for a metal + "YYYY-MM-DD" day, matching api-export-v2.js
 * layout. The metal must be a known iso code — that both validates input and
 * makes path traversal impossible.
 * @param {string} dataDir
 * @param {string} metalIso - lowercase iso code (e.g. "xcu")
 * @param {string} day - "YYYY-MM-DD"
 * @returns {string} dataDir/v2/spot/{iso}/YYYY/MM/DD.json
 */
export function dayFilePathFor(dataDir, metalIso, day) {
  if (!ISO_TO_METAL[metalIso]) {
    throw new Error(`Unknown metal iso code (possible traversal): ${metalIso}`);
  }
  const [, y, mo, d] = DATE_RE.exec(day);
  return join(dataDir, "v2", "spot", metalIso, y, mo, `${d}.json`);
}

/**
 * Read year-file rows from a local path or https URL.
 * @param {string} source
 * @returns {Promise<Array<object>>}
 */
async function readSourceRows(source) {
  let raw;
  if (/^https?:\/\//.test(source)) {
    const resp = await fetch(source);
    if (!resp.ok) throw new Error(`Source fetch failed: HTTP ${resp.status} for ${source}`);
    raw = await resp.json();
  } else {
    raw = JSON.parse(await readFile(source, "utf-8"));
  }
  if (!Array.isArray(raw)) throw new Error(`Source is not a JSON array: ${source}`);
  return raw;
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
 * CLI entry point: parse args, load the source year file, and for each UTC
 * date in range write a v2-envelope day file with the day's single daily
 * sample (skipping existing files unless --overwrite, and only logging under
 * --dry-run). Requires the DATA_DIR env var; exits non-zero when unset.
 * @returns {Promise<void>}
 */
async function main() {
  const dataDir = process.env.DATA_DIR;
  if (!dataDir) {
    console.error("ERROR: DATA_DIR environment variable is required.");
    process.exit(1);
  }

  const opts = parseArgs(process.argv.slice(2));
  const metalName = ISO_TO_METAL[opts.metal];
  const days = enumerateDates(opts.from, opts.to);
  const years = [...new Set(days.map((d) => d.slice(0, 4)))];
  const sources = opts.source
    ? [opts.source]
    : years.map((y) => `https://staktrakr.com/data/spot-history-${y}.json`);

  let rows = [];
  for (const source of sources) {
    console.log(`Reading source: ${source}`);
    rows = rows.concat(await readSourceRows(source));
  }
  const byDay = dailyRowsByDay(rows, metalName);
  console.log(
    `Backfilling ${days.length} day file(s) for ${metalName} (${opts.metal}) ` +
      `${opts.from}..${opts.to} from ${byDay.size} daily rows` +
      `${opts.dryRun ? " (dry-run)" : ""}${opts.overwrite ? " (overwrite)" : ""}`
  );

  let written = 0;
  let skipped = 0;

  for (const day of days) {
    const filePath = dayFilePathFor(dataDir, opts.metal, day);
    if (!opts.overwrite && (await fileExists(filePath))) {
      console.log(`SKIP (exists): ${filePath}`);
      skipped++;
      continue;
    }
    const row = byDay.get(day);
    if (!row) {
      console.warn(`SKIP (no daily row in source): ${day}`);
      skipped++;
      continue;
    }
    const entries = [buildDayEntry(day, row.spot)];
    if (opts.dryRun) {
      console.log(`WOULD WRITE: ${filePath} (close=${row.spot})`);
    } else {
      await mkdir(dirname(filePath), { recursive: true });
      // Second-precision generated_at for byte parity with the live exporter's
      // envelopes (wrapEnvelope only strips an exact ".000Z").
      const envelope = wrapEnvelope(
        entries,
        DAY_FILE_STALE_AFTER,
        Math.floor(Date.now() / 1000) * 1000
      );
      await writeFile(filePath, JSON.stringify(envelope, null, 2) + "\n", "utf-8");
      console.log(`Wrote: ${filePath} (close=${row.spot})`);
    }
    written++;
  }

  console.log(
    `Backfill complete: ${written} file(s) ${opts.dryRun ? "would be " : ""}written, ${skipped} skipped`
  );
}

// Run only when executed directly so tests can import the pure helpers
// without side effects (same guard as backfill-spot-files.js).
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

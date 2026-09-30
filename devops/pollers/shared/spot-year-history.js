/**
 * spot-year-history.js — writer for the public data/spot-history-YYYY.json
 * year files (STRK-403).
 *
 * The API copy of the year file froze at 2026-02-26 when the Python seed
 * poller (spot-poller/poller.py) retired: spot-extract.js replaced it but
 * never wrote a year file. api-export.js now calls refreshSpotYearFiles()
 * every publish.
 *
 * The derivation rule is SHARED with .claude/skills/update-spot-bundle/
 * update-spot-bundle.py (the repo-side writer). Change one, change both:
 *
 *   - one entry per (metal, UTC day) = AVG(spot), rounded IN SQL (4dp below
 *     $1, else 2dp) so Math.round and Python round() never disagree
 *   - stamped "YYYY-MM-DD 12:00:00", source "sqld"
 *   - COMPLETE UTC days only: the window ends at the start of today. A partial
 *     day's average, once written, was never revisited — the repo file carried
 *     frozen partial values until STRK-403.
 *   - aggregated in SQL; never pull raw spot rows over Hrana (a 90-day raw pull
 *     hits RESPONSE_TOO_LARGE, STRK-407)
 *   - sqld fills missing (date, metal) keys and replaces its own earlier
 *     "sqld" entries; a "seed" entry (pre-sqld history, the STRK-304 copper
 *     backfill) is never overwritten
 *
 * Dependency-free apart from node built-ins, so unit tests import it without
 * the poller's container-only packages (same seam as spot-metals.js).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { METAL_ORDER } from "./spot-metals.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** During the first N days of January the previous year is still refreshed so its Dec 31 lands. */
const PREVIOUS_YEAR_GRACE_DAYS = 7;

/** Lowercase sqld metal key → capitalised JSON display name. */
const DISPLAY_BY_METAL_KEY = Object.assign(
  Object.create(null),
  Object.fromEntries(METAL_ORDER.map((name) => [name.toLowerCase(), name]))
);

const DAILY_AVERAGE_SQL = `
  SELECT
    metal,
    DATE(timestamp_floor) AS day,
    CASE
      WHEN AVG(spot) < 1 THEN ROUND(AVG(spot), 4)
      ELSE ROUND(AVG(spot), 2)
    END AS spot
  FROM spot_prices
  WHERE timestamp_floor >= ? AND timestamp_floor < ?
  GROUP BY metal, day
  ORDER BY day, metal
`;

/**
 * Format a Date as a second-precision UTC ISO string ("2026-09-27T00:00:00Z"),
 * the shape spot_prices.timestamp_floor is stored in.
 * @param {Date} date
 * @returns {string}
 */
const toFloorIso = (date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * The UTC years whose file should be rewritten on this run.
 * @param {Date} now
 * @returns {number[]} Ascending years — the current UTC year, preceded by the
 *   previous year during the first PREVIOUS_YEAR_GRACE_DAYS days of January.
 */
export const yearsToRefresh = (now) => {
  const year = now.getUTCFullYear();
  const inGrace = now.getUTCMonth() === 0 && now.getUTCDate() <= PREVIOUS_YEAR_GRACE_DAYS;
  return inGrace ? [year - 1, year] : [year];
};

/**
 * Half-open [startIso, endIso) timestamp_floor window of COMPLETE UTC days for a year.
 * @param {number} year
 * @param {Date} now
 * @returns {{startIso: string, endIso: string} | null} null when the year has
 *   no complete day yet (Jan 1 of the current year).
 */
export const dailyAverageWindow = (year, now) => {
  const start = Date.UTC(year, 0, 1);
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = Math.min(Date.UTC(year + 1, 0, 1), todayStart);
  if (end - start < MS_PER_DAY) return null;
  return { startIso: toFloorIso(new Date(start)), endIso: toFloorIso(new Date(end)) };
};

/**
 * Read per-(metal, UTC day) average spot prices from sqld, aggregated and rounded in SQL.
 * @param {{execute: Function}} client  libSQL/Hrana client (openTursoDb()).
 * @param {string} startIso  Inclusive timestamp_floor lower bound.
 * @param {string} endIso    Exclusive timestamp_floor upper bound.
 * @returns {Promise<Array<{metal: string, day: string, spot: number}>>}
 */
export const querySpotDailyAverages = async (client, startIso, endIso) => {
  const result = await client.execute({ sql: DAILY_AVERAGE_SQL, args: [startIso, endIso] });
  return result.rows;
};

/**
 * Map aggregate sqld rows to the year-file entry shape. Unknown metals and
 * non-finite spots are dropped (same unexpected-metal gate as the bundle script).
 * @param {Array<{metal: string, day: string, spot: unknown}>} rows
 * @returns {Array<{spot: number, metal: string, source: string, timestamp: string}>}
 */
export const sqldRowsToEntries = (rows) => {
  const entries = [];
  for (const row of rows) {
    const metal = DISPLAY_BY_METAL_KEY[String(row.metal).toLowerCase()];
    const spot = row.spot == null ? NaN : Number(row.spot);
    if (!metal || !Number.isFinite(spot)) continue;
    // Already rounded by SQL; roundPrice-equivalent here only guards float noise.
    const decimals = spot < 1 ? 4 : 2;
    entries.push({
      spot: Number(spot.toFixed(decimals)),
      metal,
      source: "sqld",
      timestamp: `${String(row.day)} 12:00:00`,
    });
  }
  return entries;
};

const entryKey = (entry) => `${String(entry.timestamp).slice(0, 10)}|${entry.metal}`;

/**
 * Merge freshly derived sqld entries over an existing year file.
 *
 * A fresh entry fills a missing (date, metal) key or replaces an earlier
 * source:"sqld" entry (a frozen partial day). It never replaces a
 * source:"seed" entry: sqld's first days held as little as 1 sample/day, and
 * the seed values (MetalPriceAPI daily closes, the STRK-304 copper backfill)
 * are the better record.
 *
 * @param {object[]} existing  Current file entries (any source).
 * @param {object[]} fresh     sqldRowsToEntries() output.
 * @returns {object[]} Merged entries sorted by date, then metal name.
 */
export const mergeYearEntries = (existing, fresh) => {
  const byKey = new Map();
  for (const entry of existing) byKey.set(entryKey(entry), entry);
  for (const entry of fresh) {
    const key = entryKey(entry);
    if (byKey.get(key)?.source === "seed") continue;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => {
    const day = String(a.timestamp).slice(0, 10).localeCompare(String(b.timestamp).slice(0, 10));
    return day !== 0 ? day : String(a.metal).localeCompare(String(b.metal));
  });
};

/**
 * Read a year file. Returns [] when absent, null when present but unusable
 * (so the caller refuses to overwrite a file it could not understand).
 * @param {string} path
 * @returns {object[] | null}
 */
const readYearFile = (path) => {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Rewrite data/spot-history-YYYY.json for each year in yearsToRefresh(now).
 *
 * Writes only when the serialized content changed, so the file changes at most
 * once per UTC day instead of adding a git blob every publish (STRK-406).
 *
 * @param {object} opts
 * @param {{execute: Function}} opts.client  libSQL/Hrana client.
 * @param {string} opts.dataDir  The export repo's data/ directory.
 * @param {Date} [opts.now]
 * @param {boolean} [opts.dryRun]
 * @param {(msg: string) => void} opts.log
 * @param {(msg: string) => void} opts.warn
 * @returns {Promise<Array<{year: number, written: boolean, entries: number}>>}
 *   One result per year that had a complete-day window.
 */
export const refreshSpotYearFiles = async ({
  client,
  dataDir,
  now = new Date(),
  dryRun = false,
  log,
  warn,
}) => {
  const results = [];
  for (const year of yearsToRefresh(now)) {
    const window = dailyAverageWindow(year, now);
    if (!window) continue;

    const path = join(dataDir, `spot-history-${year}.json`);
    const existing = readYearFile(path);
    if (existing === null) {
      warn(`spot-history-${year}.json is not a JSON array — leaving it untouched`);
      results.push({ year, written: false, entries: 0 });
      continue;
    }

    const fresh = sqldRowsToEntries(
      await querySpotDailyAverages(client, window.startIso, window.endIso)
    );
    if (!fresh.length) {
      warn(`No sqld spot data for ${year} — spot-history-${year}.json left as-is`);
      results.push({ year, written: false, entries: existing.length });
      continue;
    }

    const merged = mergeYearEntries(existing, fresh);
    const serialized = `${JSON.stringify(merged)}\n`;
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    const changed = serialized !== current;

    if (changed && !dryRun) {
      writeFileSync(path, serialized);
      log(
        `Wrote ${path} (${merged.length} entries through ${window.endIso.slice(0, 10)} exclusive)`
      );
    } else if (changed) {
      log(`[DRY RUN] ${path} (${merged.length} entries)`);
    }
    results.push({ year, written: changed && !dryRun, entries: merged.length });
  }
  return results;
};

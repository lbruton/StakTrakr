#!/usr/bin/env node
/**
 * StakTrakr Retail Poller — JSONL Price Log Recovery Tool
 * =========================================================
 * Reads one or more prices-YYYY-MM-DD.jsonl files and re-inserts their
 * rows into prices.db, skipping rows that already exist.
 *
 * Use this when prices.db is lost, corrupted, or out of sync with
 * what was actually scraped (e.g. after a container volume wipe, a
 * failed git reset, or a crash between scrape and commit).
 *
 * After import, re-run api-export.js to regenerate the API JSON:
 *   DATA_DIR=/path/to/data node api-export.js
 *
 * Usage:
 *   # Import a single day's log
 *   DATA_DIR=/path/to/data node import-from-log.js prices-2026-02-21.jsonl
 *
 *   # Import all logs in a directory
 *   DATA_DIR=/path/to/data node import-from-log.js /var/log/retail-prices/
 *
 *   # Dry run (shows what would be inserted without writing)
 *   DRY_RUN=1 DATA_DIR=/path/to/data node import-from-log.js prices-2026-02-21.jsonl
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, windowFloor } from "./db.js";

const DATA_DIR = process.env.DATA_DIR;
const DRY_RUN = process.env.DRY_RUN === "1";
const target = process.argv[2];

if (!DATA_DIR) {
  console.error("ERROR: DATA_DIR not set (path to data/ folder in the data repo checkout)");
  process.exit(1);
}
if (!target) {
  console.error("Usage: DATA_DIR=/path/to/data node import-from-log.js <file.jsonl|directory>");
  process.exit(1);
}

// Collect files to import
const targetPath = resolve(target);
let files;
try {
  const stat = statSync(targetPath);
  if (stat.isDirectory()) {
    files = readdirSync(targetPath)
      .filter((f) => /^prices-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .sort()
      .map((f) => `${targetPath}/${f}`);
    if (files.length === 0) {
      console.error(`No prices-YYYY-MM-DD.jsonl files found in ${targetPath}`);
      process.exit(1);
    }
  } else {
    files = [targetPath];
  }
} catch (e) {
  console.error(`Cannot access ${targetPath}: ${e.message}`);
  process.exit(1);
}

const db = openDb(DATA_DIR);

// Check for existing row to avoid duplicates (no UNIQUE constraint in schema)
const existsStmt = db.prepare(`
  SELECT 1 FROM price_snapshots
  WHERE coin_slug = ? AND vendor = ? AND window_start = ? AND source = ?
  LIMIT 1
`);

const insertStmt = db.prepare(`
  INSERT INTO price_snapshots
    (scraped_at, window_start, coin_slug, vendor, price, source)
  VALUES
    (@scraped_at, @window_start, @coin_slug, @vendor, @price, @source)
`);

let totalInserted = 0;
let totalSkipped = 0;
let totalErrors = 0;

for (const file of files) {
  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);

  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (!r.coin_slug || !r.vendor || !r.scraped_at || r.price == null) {
        errors++;
        continue;
      }
      // Derive window_start if missing (log may predate the field)
      const windowStart = r.window_start ?? windowFloor(new Date(r.scraped_at));

      const exists = existsStmt.get(r.coin_slug, r.vendor, windowStart, r.source ?? "firecrawl");
      if (exists) {
        skipped++;
        continue;
      }

      if (!DRY_RUN) {
        insertStmt.run({
          scraped_at: r.scraped_at,
          window_start: windowStart,
          coin_slug: r.coin_slug,
          vendor: r.vendor,
          price: r.price,
          source: r.source ?? "firecrawl",
        });
      }
      inserted++;
    } catch {
      errors++;
    }
  }

  console.log(
    `${file}: ${lines.length} lines → ${inserted} inserted, ${skipped} already exist, ${errors} errors` +
      (DRY_RUN ? " [DRY RUN]" : "")
  );
  totalInserted += inserted;
  totalSkipped += skipped;
  totalErrors += errors;
}

db.close();

console.log(
  `\nTotal: ${totalInserted} inserted, ${totalSkipped} skipped, ${totalErrors} errors` +
    (DRY_RUN ? " [DRY RUN — nothing written]" : "")
);

if (totalInserted > 0 && !DRY_RUN) {
  console.log("\nNext step: regenerate API JSON from restored data:");
  console.log(`  DATA_DIR=${DATA_DIR} node api-export.js`);
}

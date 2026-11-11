/**
 * Mirrors sqld price_snapshots rows into the api-export SQLite cache.
 */

const SELECT_COLUMNS =
  "SELECT coin_slug, vendor, price, window_start, scraped_at, source, confidence, in_stock";

/**
 * Copies new sqld rows into the cache: a 31-day backfill for a new cache, else an incremental read.
 * @param {object} opts
 * @param {object} opts.cache - better-sqlite3 cache handle.
 * @param {object} opts.sqld - libSQL client with execute().
 * @param {boolean} opts.isNew - True when the cache file was just created.
 * @param {(msg: string) => void} opts.log - Logger.
 * @returns {Promise<object[]>} The rows fetched from sqld.
 */
export async function syncCacheFromSqld({ cache, sqld, isNew, log }) {
  let watermark = null;
  if (!isNew) {
    const row = cache.prepare("SELECT MAX(scraped_at) AS wm FROM price_snapshots").get();
    watermark = row?.wm || null;
  }

  let rows;
  if (watermark) {
    // A poller run stamps all its rows with the run start but writes them over minutes,
    // so the run at the watermark may be partial. Drop it here and read it again in full.
    log(`Incremental sync from watermark: ${watermark}`);
    const result = await sqld.execute({
      sql: `${SELECT_COLUMNS} FROM price_snapshots WHERE scraped_at >= ? ORDER BY scraped_at`,
      args: [watermark],
    });
    rows = result.rows;
    log(`Fetched ${rows.length} rows from sqld at or after the watermark`);
  } else {
    log("Full backfill from sqld (new cache)...");
    const cutoff = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const result = await sqld.execute({
      sql: `${SELECT_COLUMNS} FROM price_snapshots WHERE window_start >= ? ORDER BY window_start DESC`,
      args: [cutoff],
    });
    rows = result.rows;
    log(`Backfill: loaded ${rows.length} rows from sqld`);
  }

  if (rows.length > 0) {
    const deleteStmt = cache.prepare("DELETE FROM price_snapshots WHERE scraped_at >= ?");
    const insertStmt = cache.prepare(`
      INSERT INTO price_snapshots (
        scraped_at, window_start, coin_slug, vendor, price,
        source, confidence, is_failed, in_stock
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = cache.transaction((batch) => {
      if (watermark) deleteStmt.run(watermark);
      for (const row of batch) {
        insertStmt.run(
          row.scraped_at,
          row.window_start,
          row.coin_slug,
          row.vendor,
          row.price,
          row.source,
          row.confidence || null,
          0,
          row.in_stock !== undefined ? row.in_stock : 1
        );
      }
    });
    insertMany(rows);
    log(`Inserted ${rows.length} rows into cache`);
  }
  return rows;
}

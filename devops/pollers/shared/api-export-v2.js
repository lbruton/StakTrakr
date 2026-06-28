#!/usr/bin/env node
/**
 * StakTrakr v2 API Publisher — Spot + Retail + Goldback + Manifest
 * ================================================================
 * Reads spot_prices and price_snapshots from sqld, writes v2 JSON endpoints.
 * Called by run-publish.sh after api-export.js.
 *
 * Output structure:
 *   data/v2/
 *     manifest.json
 *     spot/
 *       latest.json
 *       history/{7,30,90}d.json
 *       {metal}/
 *         latest.json
 *         intraday.json
 *         {YYYY}/{MM}/{DD}.json
 *         {YYYY}/{MM}.json
 *     retail/
 *       latest.json
 *       vendors/index.json
 *       vendors/{vendor-id}.json
 *       {slug}/
 *         latest.json
 *         intraday.json
 *         history-{7,30,90}d.json
 *         {YYYY}/{MM}.json
 *     goldback/
 *       latest.json
 *       intraday.json
 *       history-30d.json
 *       {YYYY}/{MM}.json
 *
 * Usage:
 *   DATA_DIR=/path/to/data node api-export-v2.js
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { toTimestampPair, computeOhlca, wrapEnvelope } from "./v2-utils.js";

// db.js / provider-db.js statically import the poller-only native dep
// better-sqlite3, which is not installed where unit tests run. They are
// lazy-imported inside main() (matching backfill-spot-files.js) so this
// module can be imported side-effect-free for unit testing.
let openTursoDb;
let initProviderSchema;
let getProviders;

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, "../../data"));
const DRY_RUN = process.env.DRY_RUN === "1";

const METALS = ["gold", "silver", "platinum", "palladium"];
const METAL_TO_ISO = { gold: "xau", silver: "xag", platinum: "xpt", palladium: "xpd" };
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

const VENDOR_META = {
  apmex: { name: "APMEX", color: "#60a5fa", url: "https://www.apmex.com" },
  jmbullion: { name: "JM Bullion", color: "#fbbf24", url: "https://www.jmbullion.com" },
  sdbullion: { name: "SDB", color: "#34d399", url: "https://www.sdbullion.com" },
  monumentmetals: { name: "Monument", color: "#c4b5fd", url: "https://www.monumentmetals.com" },
  herobullion: { name: "Hero", color: "#f87171", url: "https://www.herobullion.com" },
  bullionexchanges: { name: "BullionX", color: "#f472b6", url: "https://www.bullionexchanges.com" },
  summitmetals: { name: "Summit", color: "#22d3ee", url: "https://www.summitmetals.com" },
  goldback: { name: "Goldback", color: "#d4a017", url: "https://www.goldback.com" },
  providentmetals: { name: "Provident", color: "#a3e635", url: "https://www.providentmetals.com" },
  gainesvillecoins: {
    name: "Gainesville",
    color: "#fb923c",
    url: "https://www.gainesvillecoins.com",
  },
};

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
  const resolved = resolve(join(DATA_DIR, "v2", relPath));
  if (!resolved.startsWith(resolve(join(DATA_DIR, "v2")))) {
    throw new Error(`Path traversal detected: ${relPath}`);
  }
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
// sqld spot queries
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
  const cutoff = new Date(Date.now() - MS_PER_DAY).toISOString().replace(".000Z", "Z");
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
    try {
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
      if (price24hAgo !== null && price24hAgo !== 0) {
        perMetalLatest.change_24h = parseFloat((price - price24hAgo).toFixed(2));
        perMetalLatest.change_24h_pct = parseFloat(
          (((price - price24hAgo) / price24hAgo) * 100).toFixed(2)
        );
      }
      writeV2File(`spot/${iso}/latest.json`, perMetalLatest, 1200);

      // spot/{metal}/intraday.json — rolling 24h of 15-min OHLCA
      const intradayStart = new Date(now.getTime() - MS_PER_DAY)
        .toISOString()
        .replace(".000Z", "Z");
      const intradayEnd = now.toISOString().replace(".000Z", "Z");
      const intradayRows = (await querySpotRange(client, intradayStart, intradayEnd)).filter(
        (r) => String(r.metal) === metal
      );
      const intradayEntries = buildOhlcaBuckets(intradayRows, "15min");
      writeV2File(`spot/${iso}/intraday.json`, intradayEntries, 1200);

      // spot/{metal}/{YYYY}/{MM}/{DD}.json — today's hourly OHLCA
      const yyyy = String(now.getUTCFullYear());
      const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(now.getUTCDate()).padStart(2, "0");
      const dayStart = `${yyyy}-${mm}-${dd}T00:00:00Z`;
      const nextDay = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
      );
      const dayEnd = nextDay.toISOString().replace(".000Z", "Z");
      const dayRows = (await querySpotRange(client, dayStart, dayEnd)).filter(
        (r) => String(r.metal) === metal
      );
      const hourlyEntries = buildOhlcaBuckets(dayRows, "hourly");
      if (hourlyEntries.length) {
        writeV2File(`spot/${iso}/${yyyy}/${mm}/${dd}.json`, hourlyEntries, 3600);
      }

      // spot/{metal}/{YYYY}/{MM}.json — current month daily OHLCA (noon UTC)
      const monthStart = `${yyyy}-${mm}-01T00:00:00Z`;
      const monthEnd = nextDay.toISOString().replace(".000Z", "Z");
      const monthRows = (await querySpotRange(client, monthStart, monthEnd)).filter(
        (r) => String(r.metal) === metal
      );
      const dailyEntries = buildOhlcaBuckets(monthRows, "daily");
      if (dailyEntries.length) {
        writeV2File(`spot/${iso}/${yyyy}/${mm}.json`, dailyEntries, 86400);
      }
    } catch (err) {
      warn(`${metal}: ${err.message}`);
      continue;
    }
  }

  // --- spot/history/{7,30,90}d.json ---
  for (const days of [7, 30, 90]) {
    const histStart = new Date(now.getTime() - days * MS_PER_DAY)
      .toISOString()
      .replace(".000Z", "Z");
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
// sqld retail queries
// ---------------------------------------------------------------------------

async function queryRetailCoinSlugs(client) {
  const result = await client.execute(
    "SELECT DISTINCT coin_slug FROM price_snapshots WHERE price IS NOT NULL ORDER BY coin_slug"
  );
  return result.rows.map((r) => String(r.coin_slug));
}

async function queryLatestPerVendor(client, coinSlug, lookbackHours = 2) {
  const cutoff = new Date(Date.now() - lookbackHours * MS_PER_HOUR)
    .toISOString()
    .replace(".000Z", "Z");
  const result = await client.execute({
    sql: `
      SELECT ps.*
      FROM price_snapshots ps
      INNER JOIN (
        SELECT vendor, MAX(scraped_at) AS max_scraped
        FROM price_snapshots
        WHERE coin_slug = ? AND scraped_at >= ? AND is_failed = 0 AND price IS NOT NULL
        GROUP BY vendor
      ) latest ON ps.vendor = latest.vendor AND ps.scraped_at = latest.max_scraped
      WHERE ps.coin_slug = ? AND ps.is_failed = 0 AND ps.price IS NOT NULL
    `,
    args: [coinSlug, cutoff, coinSlug],
  });
  return result.rows;
}

async function queryInStockNoPriceVendors(client, coinSlug, lookbackHours = 2) {
  const cutoff = new Date(Date.now() - lookbackHours * MS_PER_HOUR)
    .toISOString()
    .replace(".000Z", "Z");
  const result = await client.execute({
    sql: `
      SELECT ps.vendor, ps.in_stock, ps.scraped_at
      FROM price_snapshots ps
      INNER JOIN (
        SELECT vendor, MAX(scraped_at) AS max_scraped
        FROM price_snapshots
        WHERE coin_slug = ? AND scraped_at >= ?
        GROUP BY vendor
      ) latest ON ps.vendor = latest.vendor AND ps.scraped_at = latest.max_scraped
      WHERE ps.coin_slug = ? AND ps.price IS NULL AND ps.in_stock = 1
    `,
    args: [coinSlug, cutoff, coinSlug],
  });
  return result.rows;
}

async function queryCarryForwardPrice(client, coinSlug, vendorId) {
  const cutoff = new Date(Date.now() - MS_PER_DAY).toISOString().replace(".000Z", "Z");
  const result = await client.execute({
    sql: `
      SELECT price, scraped_at
      FROM price_snapshots
      WHERE coin_slug = ? AND vendor = ? AND is_failed = 0 AND price IS NOT NULL
        AND scraped_at >= ?
      ORDER BY scraped_at DESC
      LIMIT 1
    `,
    args: [coinSlug, vendorId, cutoff],
  });
  return result.rows.length ? result.rows[0] : null;
}

async function queryRetailRange(client, coinSlug, startIso, endIso) {
  const result = await client.execute({
    sql: `
      SELECT *
      FROM price_snapshots
      WHERE coin_slug = ? AND price IS NOT NULL AND is_failed = 0
        AND window_start >= ? AND window_start < ?
      ORDER BY window_start, vendor
    `,
    args: [coinSlug, startIso, endIso],
  });
  return result.rows;
}

async function queryRetailDailyAggregates(client, coinSlug, startIso, endIso) {
  const result = await client.execute({
    sql: `
      SELECT
        substr(window_start, 1, 10) AS date,
        vendor,
        AVG(price) AS avg_price,
        MIN(price) AS min_price,
        MAX(price) AS max_price,
        COUNT(*) AS sample_count,
        MAX(in_stock) AS in_stock
      FROM price_snapshots
      WHERE coin_slug = ? AND price IS NOT NULL AND is_failed = 0
        AND window_start >= ? AND window_start < ?
      GROUP BY date, vendor
      ORDER BY date ASC, vendor ASC
    `,
    args: [coinSlug, startIso, endIso],
  });
  return result.rows;
}

async function queryVendor7dAvg(client, vendorId) {
  const cutoff = new Date(Date.now() - 7 * MS_PER_DAY).toISOString().replace(".000Z", "Z");
  const result = await client.execute({
    sql: `
      SELECT coin_slug, AVG(price) AS avg_price
      FROM price_snapshots
      WHERE vendor = ? AND price IS NOT NULL AND is_failed = 0
        AND scraped_at >= ?
      GROUP BY coin_slug
    `,
    args: [vendorId, cutoff],
  });
  return result.rows;
}

// ---------------------------------------------------------------------------
// Retail helpers
// ---------------------------------------------------------------------------

function medianOf(prices) {
  if (!prices.length) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  return parseFloat(sorted[Math.floor(sorted.length / 2)].toFixed(2));
}

function buildRetailOhlcaBuckets(rows, granularity) {
  const buckets = {};
  for (const row of rows) {
    const { t, ts } = toTimestampPair(new Date(String(row.window_start)), granularity);
    if (!buckets[t]) buckets[t] = { t, ts, samples: [], vendorPrices: {} };
    const price = Number(row.price);
    buckets[t].samples.push({ price, timestamp: String(row.window_start) });
    const vendor = String(row.vendor);
    if (!buckets[t].vendorPrices[vendor]) buckets[t].vendorPrices[vendor] = [];
    buckets[t].vendorPrices[vendor].push(price);
  }

  const entries = [];
  for (const key of Object.keys(buckets).sort()) {
    const bucket = buckets[key];
    const ohlca = computeOhlca(bucket.samples);
    if (ohlca) {
      entries.push({ t: bucket.t, ts: bucket.ts, ...ohlca, _vendorPrices: bucket.vendorPrices });
    }
  }
  return entries;
}

function buildRetailIntradayEntries(rows) {
  const buckets = {};
  for (const row of rows) {
    const { t, ts } = toTimestampPair(new Date(String(row.window_start)), "15min");
    if (!buckets[t]) buckets[t] = { t, ts, prices: [], vendors: {} };
    const price = Number(row.price);
    const vendor = String(row.vendor);
    buckets[t].prices.push(price);
    if (!buckets[t].vendors[vendor] || price < buckets[t].vendors[vendor]) {
      buckets[t].vendors[vendor] = price;
    }
  }

  const entries = [];
  for (const key of Object.keys(buckets).sort()) {
    const b = buckets[key];
    if (!b.prices.length) continue;
    entries.push({
      t: b.t,
      ts: b.ts,
      median: medianOf(b.prices),
      low: parseFloat(Math.min(...b.prices).toFixed(2)),
      vendors: b.vendors,
    });
  }
  return entries;
}

async function applyConditionalCarryForward(
  currentVendors,
  slug,
  client,
  configuredVendorIds,
  lookbackHours
) {
  const inStockNoPriceRows = await queryInStockNoPriceVendors(client, slug, lookbackHours);
  const inStockNoPriceSet = new Set(inStockNoPriceRows.map((r) => String(r.vendor)));

  for (const vendorId of configuredVendorIds) {
    if (currentVendors[vendorId]) continue;

    if (inStockNoPriceSet.has(vendorId)) {
      try {
        const carried = await queryCarryForwardPrice(client, slug, vendorId);
        if (carried) {
          currentVendors[vendorId] = {
            price: parseFloat(Number(carried.price).toFixed(2)),
            in_stock: true,
            confidence: null,
            carried: true,
            carried_from: String(carried.scraped_at),
          };
          continue;
        }
      } catch (err) {
        warn(`carry-forward ${slug}/${vendorId}: ${err.message}`);
      }
    }

    currentVendors[vendorId] = {
      price: null,
      in_stock: false,
      confidence: null,
      carried: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Retail export
// ---------------------------------------------------------------------------

async function exportRetail(client) {
  log("Exporting v2 retail prices...");

  const now = new Date();
  const nowIso = now.toISOString().replace(".000Z", "Z");

  await initProviderSchema(client);
  const providersData = await getProviders(client);
  const coins = providersData.coins || {};

  const coinSlugs = await queryRetailCoinSlugs(client);
  if (!coinSlugs.length) {
    warn("No retail data — skipping retail export");
    return;
  }

  // --- retail/latest.json (all slugs summary) ---
  const { t: latestT, ts: latestTs } = toTimestampPair(now, "15min");
  const allCoinsData = {};

  // Track per-vendor data for vendor endpoints
  const vendorCoinMap = {};

  for (const slug of coinSlugs) {
    try {
      if (slug === "goldback-g1") continue;

      const coinMeta = coins[slug] || {};
      const metalIso = METAL_TO_ISO[coinMeta.metal] || coinMeta.metal || "unknown";
      const coinName = coinMeta.name || slug;
      const weightOz = coinMeta.weight_oz || 1.0;

      // Configured vendor IDs for this coin
      const configuredVendorIds = (coinMeta.providers || [])
        .filter((p) => p.enabled !== false)
        .map((p) => p.id);

      // --- Per-slug latest ---
      let latestRows = await queryLatestPerVendor(client, slug, 2);
      if (!latestRows.length) {
        latestRows = await queryLatestPerVendor(client, slug, 24);
        if (!latestRows.length) continue;
      }

      const vendors = {};
      for (const row of latestRows) {
        const vid = String(row.vendor);
        vendors[vid] = {
          price: parseFloat(Number(row.price).toFixed(2)),
          in_stock: row.in_stock === 1,
          confidence: row.confidence != null ? Number(row.confidence) : null,
          carried: false,
        };
      }

      await applyConditionalCarryForward(vendors, slug, client, configuredVendorIds, 2);

      // Aggregate fresh in-stock prices only (carried prices excluded from aggregation)
      const allPrices = Object.values(vendors)
        .filter((v) => v.price !== null && v.in_stock === true && !v.carried)
        .map((v) => v.price);

      const median = medianOf(allPrices);
      const low = allPrices.length ? parseFloat(Math.min(...allPrices).toFixed(2)) : null;
      const high = allPrices.length ? parseFloat(Math.max(...allPrices).toFixed(2)) : null;

      allCoinsData[slug] = {
        median,
        low,
        high,
        vendor_count: Object.keys(vendors).filter((v) => vendors[v].price !== null).length,
        name: coinName,
        metal: metalIso,
        weight_oz: weightOz,
      };

      // --- retail/{slug}/latest.json ---
      writeV2File(
        `retail/${slug}/latest.json`,
        {
          slug,
          name: coinName,
          metal: metalIso,
          weight_oz: weightOz,
          t: latestT,
          ts: latestTs,
          median,
          low,
          high,
          vendors,
        },
        1800
      );

      // --- retail/{slug}/intraday.json ---
      const intradayStart = new Date(now.getTime() - MS_PER_DAY)
        .toISOString()
        .replace(".000Z", "Z");
      const intradayRows = await queryRetailRange(client, slug, intradayStart, nowIso);
      const intradayEntries = buildRetailIntradayEntries(intradayRows);
      writeV2File(`retail/${slug}/intraday.json`, intradayEntries, 1200);

      // --- retail/{slug}/history-7d.json (hourly OHLCA, up to 168 entries) ---
      const hist7dStart = new Date(now.getTime() - 7 * MS_PER_DAY)
        .toISOString()
        .replace(".000Z", "Z");
      const hist7dRows = await queryRetailRange(client, slug, hist7dStart, nowIso);
      const hist7dEntries = buildRetailOhlcaBuckets(hist7dRows, "hourly");
      const hist7dClean = hist7dEntries.map(({ _vendorPrices, ...rest }) => rest);
      writeV2File(`retail/${slug}/history-7d.json`, hist7dClean.slice(-168), 3600);

      // --- retail/{slug}/history-30d.json (daily OHLCA with per-vendor breakdown) ---
      const hist30dStart = new Date(now.getTime() - 30 * MS_PER_DAY)
        .toISOString()
        .replace(".000Z", "Z");
      const dailyAgg30d = await queryRetailDailyAggregates(client, slug, hist30dStart, nowIso);
      const daily30dEntries = buildDailyWithVendors(dailyAgg30d);
      writeV2File(`retail/${slug}/history-30d.json`, daily30dEntries, 86400);

      // --- retail/{slug}/history-90d.json (daily OHLCA with per-vendor breakdown) ---
      const hist90dStart = new Date(now.getTime() - 90 * MS_PER_DAY)
        .toISOString()
        .replace(".000Z", "Z");
      const dailyAgg90d = await queryRetailDailyAggregates(client, slug, hist90dStart, nowIso);
      const daily90dEntries = buildDailyWithVendors(dailyAgg90d);
      writeV2File(`retail/${slug}/history-90d.json`, daily90dEntries, 86400);

      // --- retail/{slug}/{YYYY}/{MM}.json (monthly archive) ---
      const yyyy = String(now.getUTCFullYear());
      const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
      const monthStart = `${yyyy}-${mm}-01T00:00:00Z`;
      const monthRows = await queryRetailRange(client, slug, monthStart, nowIso);
      const monthEntries = buildRetailOhlcaBuckets(monthRows, "daily");
      const monthClean = monthEntries.map(({ _vendorPrices, ...rest }) => rest);
      if (monthClean.length) {
        writeV2File(`retail/${slug}/${yyyy}/${mm}.json`, monthClean, 86400);
      }

      // Accumulate per-vendor data for vendor endpoints
      for (const [vid, vdata] of Object.entries(vendors)) {
        if (!vendorCoinMap[vid]) vendorCoinMap[vid] = {};
        const providerEntry = (coinMeta.providers || []).find((p) => p.id === vid);
        vendorCoinMap[vid][slug] = {
          price: vdata.price,
          in_stock: vdata.in_stock,
          ...(vdata.carried ? { carried: true, carried_from: vdata.carried_from } : {}),
          product_url: providerEntry?.url || null,
        };
      }
    } catch (err) {
      warn(`retail ${slug}: ${err.message}`);
      continue;
    }
  }

  // --- retail/latest.json ---
  writeV2File(
    "retail/latest.json",
    {
      t: latestT,
      ts: latestTs,
      coins: allCoinsData,
    },
    1800
  );

  // --- retail/vendors/index.json ---
  const allVendorIds = new Set();
  for (const coinData of Object.values(coins)) {
    for (const p of coinData.providers || []) {
      if (p.enabled !== false) allVendorIds.add(p.id);
    }
  }
  const vendorIndex = [];
  for (const vid of [...allVendorIds].sort()) {
    const meta = VENDOR_META[vid] || { name: vid, color: "#94a3b8", url: null };
    vendorIndex.push({ id: vid, name: meta.name, color: meta.color, url: meta.url });
  }
  writeV2File("retail/vendors/index.json", vendorIndex, 86400);

  // --- retail/vendors/{vendor-id}.json ---
  for (const vid of [...allVendorIds].sort()) {
    try {
      const meta = VENDOR_META[vid] || { name: vid, color: "#94a3b8", url: null };
      const vendorCoins = vendorCoinMap[vid] || {};

      // Compute history_7d_avg per coin for this vendor
      const avgRows = await queryVendor7dAvg(client, vid);
      const avgMap = {};
      for (const r of avgRows) {
        avgMap[String(r.coin_slug)] = parseFloat(Number(r.avg_price).toFixed(2));
      }

      const coinsOut = {};
      for (const [slug, coinData] of Object.entries(vendorCoins)) {
        coinsOut[slug] = {
          ...coinData,
          history_7d_avg: avgMap[slug] ?? null,
        };
      }

      writeV2File(
        `retail/vendors/${vid}.json`,
        {
          vendor: { id: vid, name: meta.name, color: meta.color, url: meta.url },
          t: latestT,
          ts: latestTs,
          coins: coinsOut,
        },
        1800
      );
    } catch (err) {
      warn(`vendor ${vid}: ${err.message}`);
      continue;
    }
  }

  log("Retail export complete");
}

function buildDailyWithVendors(dailyAggRows) {
  const byDate = {};
  for (const row of dailyAggRows) {
    const date = String(row.date);
    if (!byDate[date]) byDate[date] = { allPrices: [], vendors: {} };
    const avg = Number(row.avg_price);
    const count = Number(row.sample_count);

    for (let i = 0; i < count; i++) byDate[date].allPrices.push(avg);

    const vendor = String(row.vendor);
    byDate[date].vendors[vendor] = {
      avg: parseFloat(avg.toFixed(2)),
      in_stock: row.in_stock === 1,
    };
  }

  const entries = [];
  for (const date of Object.keys(byDate).sort()) {
    const { allPrices, vendors } = byDate[date];
    if (!allPrices.length) continue;
    const { t, ts } = toTimestampPair(new Date(date + "T12:00:00Z"), "daily");
    const ohlca = computeOhlca(
      allPrices.map((p) => ({ price: p, timestamp: `${date}T12:00:00Z` }))
    );
    if (ohlca) {
      entries.push({ t, ts, ...ohlca, vendors });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Goldback queries
// ---------------------------------------------------------------------------

async function queryGoldbackLatest(client) {
  const cutoff = new Date(Date.now() - 2 * MS_PER_HOUR).toISOString().replace(".000Z", "Z");
  const result = await client.execute({
    sql: `
      SELECT price, scraped_at
      FROM price_snapshots
      WHERE coin_slug = 'goldback-g1' AND vendor = 'goldback'
        AND price IS NOT NULL AND is_failed = 0
        AND scraped_at >= ?
      ORDER BY scraped_at DESC
      LIMIT 1
    `,
    args: [cutoff],
  });
  if (result.rows.length) return result.rows[0];

  // Fall back to 24h lookback
  const cutoff24 = new Date(Date.now() - MS_PER_DAY).toISOString().replace(".000Z", "Z");
  const fallback = await client.execute({
    sql: `
      SELECT price, scraped_at
      FROM price_snapshots
      WHERE coin_slug = 'goldback-g1' AND vendor = 'goldback'
        AND price IS NOT NULL AND is_failed = 0
        AND scraped_at >= ?
      ORDER BY scraped_at DESC
      LIMIT 1
    `,
    args: [cutoff24],
  });
  return fallback.rows.length ? fallback.rows[0] : null;
}

async function queryGoldbackRange(client, startIso, endIso) {
  const result = await client.execute({
    sql: `
      SELECT price, scraped_at
      FROM price_snapshots
      WHERE coin_slug = 'goldback-g1' AND vendor = 'goldback'
        AND price IS NOT NULL AND is_failed = 0
        AND scraped_at >= ? AND scraped_at < ?
      ORDER BY scraped_at ASC
    `,
    args: [startIso, endIso],
  });
  return result.rows;
}

// ---------------------------------------------------------------------------
// Goldback helpers
// ---------------------------------------------------------------------------

function buildGoldbackDenominations(g1) {
  return {
    "g0.25": Math.round(g1 * 0.25 * 100) / 100,
    g1: g1,
    g5: Math.round(g1 * 5 * 100) / 100,
    g10: Math.round(g1 * 10 * 100) / 100,
    g25: Math.round(g1 * 25 * 100) / 100,
    g50: Math.round(g1 * 50 * 100) / 100,
  };
}

function buildGoldbackOhlcaBuckets(rows, granularity) {
  const buckets = {};
  for (const row of rows) {
    const { t, ts } = toTimestampPair(new Date(String(row.scraped_at)), granularity);
    if (!buckets[t]) buckets[t] = { t, ts, samples: [] };
    buckets[t].samples.push({ price: Number(row.price), timestamp: String(row.scraped_at) });
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

function buildGoldbackIntradayEntries(rows) {
  const entries = [];
  for (const row of rows) {
    const { t, ts } = toTimestampPair(new Date(String(row.scraped_at)), "hourly");
    entries.push({ t, ts, g1_usd: Math.round(Number(row.price) * 100) / 100 });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Goldback export
// ---------------------------------------------------------------------------

async function exportGoldback(client) {
  log("Exporting v2 goldback prices...");

  const now = new Date();
  const nowIso = now.toISOString().replace(".000Z", "Z");

  // --- goldback/latest.json ---
  const latestRow = await queryGoldbackLatest(client);
  if (!latestRow) {
    warn("No goldback data — skipping goldback export");
    return;
  }

  const g1 = Math.round(Number(latestRow.price) * 100) / 100;
  const { t, ts } = toTimestampPair(new Date(String(latestRow.scraped_at)), "hourly");

  writeV2File(
    "goldback/latest.json",
    {
      t,
      ts,
      g1_usd: g1,
      denominations: buildGoldbackDenominations(g1),
      source: "goldback.com",
    },
    7200
  );

  // --- goldback/intraday.json (raw point series, hourly-floored `t` labels, last 72h) ---
  // Raw 1:1 row→point mapping (NOT OHLCA-bucketed); multiple scrapes in one hour
  // can share the same hourly-floored `t`.
  try {
    const intradayStart = new Date(now.getTime() - 72 * MS_PER_HOUR)
      .toISOString()
      .replace(".000Z", "Z");
    const intradayRows = await queryGoldbackRange(client, intradayStart, nowIso);
    const intradayEntries = buildGoldbackIntradayEntries(intradayRows);
    writeV2File("goldback/intraday.json", intradayEntries, 7200);
  } catch (err) {
    warn(`goldback intraday: ${err.message}`);
  }

  // --- goldback/history-30d.json ---
  try {
    const hist30dStart = new Date(now.getTime() - 30 * MS_PER_DAY)
      .toISOString()
      .replace(".000Z", "Z");
    const hist30dRows = await queryGoldbackRange(client, hist30dStart, nowIso);
    const hist30dEntries = buildGoldbackOhlcaBuckets(hist30dRows, "daily");
    writeV2File("goldback/history-30d.json", hist30dEntries, 86400);
  } catch (err) {
    warn(`goldback history-30d: ${err.message}`);
  }

  // --- goldback/{YYYY}/{MM}.json ---
  try {
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const monthStart = `${yyyy}-${mm}-01T00:00:00Z`;
    const monthRows = await queryGoldbackRange(client, monthStart, nowIso);
    const monthEntries = buildGoldbackOhlcaBuckets(monthRows, "daily");
    if (monthEntries.length) {
      writeV2File(`goldback/${yyyy}/${mm}.json`, monthEntries, 86400);
    }
  } catch (err) {
    warn(`goldback monthly archive: ${err.message}`);
  }

  log("Goldback export complete");
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

async function writeProviders(client) {
  log("Writing v2 providers...");
  await initProviderSchema(client);
  const providersData = await getProviders(client);
  // 86400s (24h) stale_after — vendor product URLs are stable reference data,
  // not price data. They change only when a dealer restructures their site.
  // This fills the gap where v1 had data/api/providers.json but v2 never
  // published an equivalent under data/v2/, causing the frontend to 404 on
  // every providers.json lookup and fall back to vendor homepage URLs.
  writeV2File("providers.json", providersData, 86400);
  log("Providers written");
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

async function writeManifest(client) {
  log("Writing v2 manifest...");

  await initProviderSchema(client);
  const providersData = await getProviders(client);
  const coins = providersData.coins || {};

  // Build coins list (exclude goldback-g1 from retail coins)
  const coinList = [];
  for (const [slug, meta] of Object.entries(coins)) {
    if (slug === "goldback-g1") continue;
    coinList.push({
      slug,
      name: meta.name || slug,
      metal: METAL_TO_ISO[meta.metal] || meta.metal || "unknown",
      weight_oz: meta.weight_oz || 1.0,
    });
  }
  coinList.sort((a, b) => a.slug.localeCompare(b.slug));

  // Build vendors list from all configured providers
  const vendorIds = new Set();
  for (const coinData of Object.values(coins)) {
    for (const p of coinData.providers || []) {
      if (p.enabled !== false) vendorIds.add(p.id);
    }
  }
  const vendorList = [];
  for (const vid of [...vendorIds].sort()) {
    const meta = VENDOR_META[vid] || { name: vid, color: "#94a3b8", url: null };
    vendorList.push({ id: vid, name: meta.name, color: meta.color, url: meta.url });
  }

  writeV2File(
    "manifest.json",
    {
      metals: ["xau", "xag", "xpt", "xpd"],
      coins: coinList,
      vendors: vendorList,
      endpoints: {
        spot_latest: "spot/latest.json",
        spot_metal_latest: "spot/{metal}/latest.json",
        spot_metal_intraday: "spot/{metal}/intraday.json",
        spot_metal_daily: "spot/{metal}/{YYYY}/{MM}/{DD}.json",
        spot_metal_monthly: "spot/{metal}/{YYYY}/{MM}.json",
        spot_history: "spot/history/{N}d.json",
        retail_latest: "retail/latest.json",
        retail_slug_latest: "retail/{slug}/latest.json",
        retail_slug_intraday: "retail/{slug}/intraday.json",
        retail_slug_monthly: "retail/{slug}/{YYYY}/{MM}.json",
        retail_slug_history: "retail/{slug}/history-{N}d.json",
        retail_vendors: "retail/vendors/index.json",
        retail_vendor: "retail/vendors/{vendor}.json",
        goldback_latest: "goldback/latest.json",
        goldback_intraday: "goldback/intraday.json",
        goldback_monthly: "goldback/{YYYY}/{MM}.json",
        goldback_history: "goldback/history-30d.json",
        providers: "providers.json",
        manifest: "manifest.json",
      },
    },
    1800
  );

  log("Manifest written");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log("v2 publisher starting...");
  log(`DATA_DIR: ${DATA_DIR}`);

  ({ openTursoDb } = await import("./db.js"));
  ({ initProviderSchema, getProviders } = await import("./provider-db.js"));

  const client = await openTursoDb();
  let hadError = false;

  try {
    // Spot export
    const spotStart = Date.now();
    try {
      await exportSpot(client);
      log(`Spot phase: ${Date.now() - spotStart}ms`);
    } catch (err) {
      hadError = true;
      warn(`Spot export failed: ${err.message}`);
    }

    // Retail export
    const retailStart = Date.now();
    try {
      await exportRetail(client);
      log(`Retail phase: ${Date.now() - retailStart}ms`);
    } catch (err) {
      hadError = true;
      warn(`Retail export failed: ${err.message}`);
    }

    // Goldback export
    const gbStart = Date.now();
    try {
      await exportGoldback(client);
      log(`Goldback phase: ${Date.now() - gbStart}ms`);
    } catch (err) {
      hadError = true;
      warn(`Goldback export failed: ${err.message}`);
    }

    // Providers export (vendor product URLs — stable reference data, 24h stale)
    const providersStart = Date.now();
    try {
      await writeProviders(client);
      log(`Providers phase: ${Date.now() - providersStart}ms`);
    } catch (err) {
      hadError = true;
      warn(`Providers export failed: ${err.message}`);
    }

    // Manifest (always written last, even if some exports failed)
    const manifestStart = Date.now();
    try {
      await writeManifest(client);
      log(`Manifest phase: ${Date.now() - manifestStart}ms`);
    } catch (err) {
      hadError = true;
      warn(`Manifest write failed: ${err.message}`);
    }
  } finally {
    client.close();
  }

  log(`v2 publisher finished${hadError ? " (with errors)" : ""}`);
  if (hadError) process.exitCode = 1;
}

export { buildGoldbackIntradayEntries };

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}

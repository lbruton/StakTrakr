#!/usr/bin/env node
/**
 * StakTrakr Goldback Rate Scraper
 * =======================================
 * Fetches the G1 USD exchange rate from goldback.com's JSON API.
 * Runs hourly at :05 — the rate is CurrencyLayer-backed and shifts intraday (STRK-58).
 *
 * Primary source:  GET https://www.goldback.com/gb-proxy.php
 *   → { success: true, quotes: { USDUSD: 8.89 } }
 *   The USDUSD field is the G1 goldback rate in USD.
 *
 * Fallback source: GET https://www.goldback.com/wp-admin/admin-ajax.php?action=get_goldback_data
 *   → { success: true, data: { labels: [...dates], data: [...rates] } }
 *   Full daily history — last entry is the latest rate.
 *
 * Writes:
 *   sqld price_snapshots table        -- coin_slug="goldback-g1", vendor="goldback"
 *   DATA_DIR/api/goldback-spot.json   -- latest rate (local backup, overwritten each run)
 *   DATA_DIR/goldback-{YYYY}.json     -- rolling log, one entry per day (last run of the day wins)
 *
 * Usage:
 *   DATA_DIR=/path/to/data node goldback-scraper.js
 *
 * Environment:
 *   DATA_DIR            Path to repo data/ folder (default: ../../data)
 *   SQLD_URL            sqld connection string (legacy: TURSO_DATABASE_URL)
 *   SQLD_AUTH_TOKEN     sqld auth token (optional — sqld has no auth by default)
 *   DRY_RUN             Set to "1" to skip writes
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openTursoDb, writeSnapshot, windowFloor } from "./db.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, "../../data"));
const DRY_RUN = process.env.DRY_RUN === "1";

const GOLDBACK_PROXY_URL = "https://www.goldback.com/gb-proxy.php";
const GOLDBACK_HISTORY_URL =
  "https://www.goldback.com/wp-admin/admin-ajax.php?action=get_goldback_data";

// G1 price must fall in this range (sanity check)
const G1_MIN = 0.5;
const G1_MAX = 20.0;

// Denomination multipliers relative to G1
const DENOMINATION_MULTIPLIERS = { "g0.25": 0.25, g1: 1, g5: 5, g10: 10, g25: 25, g50: 50 };

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
// Data fetchers
// ---------------------------------------------------------------------------

/**
 * Primary: fetch live G1 rate from gb-proxy.php.
 * Returns the USDUSD quote which is the G1 goldback value in USD.
 */
async function fetchFromProxy() {
  const resp = await fetch(GOLDBACK_PROXY_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "StakTrakr/1.0 goldback-scraper",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    throw new Error(`gb-proxy.php HTTP ${resp.status}`);
  }

  const json = await resp.json();
  if (!json.success || !json.quotes?.USDUSD) {
    throw new Error("gb-proxy.php: missing quotes.USDUSD in response");
  }

  return json.quotes.USDUSD;
}

/**
 * Fallback: fetch from the chart history endpoint.
 * Returns the last entry's rate value.
 */
async function fetchFromHistory() {
  const resp = await fetch(GOLDBACK_HISTORY_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "StakTrakr/1.0 goldback-scraper",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    throw new Error(`get_goldback_data HTTP ${resp.status}`);
  }

  const json = await resp.json();
  if (!json.success || !json.data?.data?.length) {
    throw new Error("get_goldback_data: missing data array in response");
  }

  const rates = json.data.data;
  return rates[rates.length - 1];
}

// ---------------------------------------------------------------------------
// File writers
// ---------------------------------------------------------------------------

function writeLatestJson(g1Rate, dateStr, scrapedAt) {
  const denominations = {};
  for (const [key, mult] of Object.entries(DENOMINATION_MULTIPLIERS)) {
    denominations[key] = Math.round(g1Rate * mult * 100) / 100;
  }

  const data = {
    date: dateStr,
    scraped_at: scrapedAt,
    g1_usd: g1Rate,
    denominations,
    source: "goldback.com",
    confidence: "high",
  };

  const filePath = join(DATA_DIR, "api", "goldback-spot.json");
  if (DRY_RUN) {
    log(`[DRY RUN] would write ${filePath}`);
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  mkdirSync(join(DATA_DIR, "api"), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  log(`Wrote ${filePath}`);
}

function appendHistoryJson(g1Rate, dateStr, scrapedAt) {
  const year = dateStr.slice(0, 4);
  const filePath = join(DATA_DIR, `goldback-${year}.json`);

  let history = [];
  if (existsSync(filePath)) {
    try {
      history = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      warn(`Could not parse ${filePath} -- starting fresh`);
    }
  }

  // Remove existing entry for today (idempotent re-run)
  history = history.filter((e) => e.date !== dateStr);
  history.push({ date: dateStr, g1_usd: g1Rate, scraped_at: scrapedAt });
  history.sort((a, b) => b.date.localeCompare(a.date)); // newest first

  if (DRY_RUN) {
    log(`[DRY RUN] would update ${filePath} (${history.length} entries)`);
    return;
  }
  writeFileSync(filePath, JSON.stringify(history, null, 2) + "\n");
  log(`Updated ${filePath} (${history.length} entries)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const scrapedAt = now.toISOString();

  log(`Goldback daily rate fetch for ${dateStr}`);
  if (DRY_RUN) log("DRY RUN -- no files written");

  // Try primary endpoint, fall back to history endpoint
  let g1Rate = null;
  let source = "";

  try {
    g1Rate = await fetchFromProxy();
    source = "gb-proxy.php";
    log(`gb-proxy.php: $${g1Rate}`);
  } catch (err) {
    warn(`Primary source failed: ${err.message} -- trying history fallback`);
  }

  if (g1Rate === null) {
    try {
      g1Rate = await fetchFromHistory();
      source = "get_goldback_data";
      log(`History fallback: $${g1Rate}`);
    } catch (err) {
      console.error(`Both sources failed. History: ${err.message}`);
      process.exit(1);
    }
  }

  // Sanity check
  if (g1Rate < G1_MIN || g1Rate > G1_MAX) {
    console.error(`G1 rate $${g1Rate} outside valid range ($${G1_MIN}-$${G1_MAX}). Aborting.`);
    process.exit(1);
  }

  log(`G1 rate: $${g1Rate} (source: ${source})`);

  // Write to sqld so Fly.io publisher can export goldback endpoints
  try {
    const client = await openTursoDb();
    await writeSnapshot(client, {
      scrapedAt,
      windowStart: windowFloor(now),
      coinSlug: "goldback-g1",
      vendor: "goldback",
      price: g1Rate,
      source,
      isFailed: false,
    });
    client.close();
    log("Wrote goldback rate to sqld");
  } catch (err) {
    // DB write failure is non-fatal — local files still get written
    warn(`sqld write failed (non-fatal): ${err.message}`);
  }

  // Local file writes (backup on home poller, primary on Fly.io legacy path)
  writeLatestJson(g1Rate, dateStr, scrapedAt);
  appendHistoryJson(g1Rate, dateStr, scrapedAt);
  log("Done.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

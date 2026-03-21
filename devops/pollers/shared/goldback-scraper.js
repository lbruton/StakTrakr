#!/usr/bin/env node
/**
 * StakTrakr Goldback Daily Rate Scraper
 * =======================================
 * Scrapes goldback.com/goldback-value/ for the current G1 USD exchange rate.
 * Writes:
 *   sqld price_snapshots table        -- coin_slug="goldback-g1", vendor="goldback"
 *   DATA_DIR/api/goldback-spot.json   -- latest rate (local backup, overwritten each day)
 *   DATA_DIR/goldback-{YYYY}.json     -- rolling daily log (local backup, appended)
 *
 * Usage:
 *   DATA_DIR=/path/to/data node goldback-scraper.js
 *
 * Environment:
 *   DATA_DIR            Path to repo data/ folder (default: ../../data)
 *   TURSO_DATABASE_URL  sqld/Turso connection string
 *   TURSO_AUTH_TOKEN    sqld/Turso auth token
 *   FIRECRAWL_BASE_URL  Self-hosted Firecrawl (default: http://firecrawl:3002)
 *   FIRECRAWL_API_KEY   Cloud Firecrawl only (omit for self-hosted)
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
const FIRECRAWL_BASE_URL = process.env.FIRECRAWL_BASE_URL || "http://firecrawl:3002";
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "not-set";

const GOLDBACK_URL = "https://www.goldback.com/exchange-rates/";

// G1 price must fall in this range (sanity check)
const G1_MIN = 0.50;
const G1_MAX = 20.00;

// Denomination multipliers relative to G1
const DENOMINATION_MULTIPLIERS = { g1: 1, g5: 5, g10: 10, g25: 25, g50: 50 };

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
// Firecrawl scrape
// ---------------------------------------------------------------------------

async function scrapeGoldbackPage() {
  const body = JSON.stringify({
    url: GOLDBACK_URL,
    formats: ["markdown"],
    waitFor: 5000, // prices are JS-rendered; wait for them to inject
  });

  const headers = {
    "Content-Type": "application/json",
    ...(FIRECRAWL_API_KEY !== "not-set" ? { Authorization: `Bearer ${FIRECRAWL_API_KEY}` } : {}),
  };

  const resp = await fetch(`${FIRECRAWL_BASE_URL}/v1/scrape`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Firecrawl ${resp.status}: ${text.slice(0, 200)}`);
  }

  const json = await resp.json();
  return json?.data?.markdown || json?.markdown || "";
}

// ---------------------------------------------------------------------------
// Price extraction
// ---------------------------------------------------------------------------

/**
 * Extract G1 USD rate from Firecrawl markdown.
 * Goldback.com shows the rate as "$3.87" in the page content.
 * Scan all dollar amounts in the valid G1 range and return the most frequent.
 */
function extractG1Rate(markdown) {
  if (!markdown) return null;

  const dollarPattern = /\$\s*(\d+\.\d{1,2})/g;
  const candidates = [...markdown.matchAll(dollarPattern)]
    .map(m => parseFloat(m[1]))
    .filter(val => val >= G1_MIN && val <= G1_MAX);

  if (candidates.length === 0) return null;

  // Return most common value (robust to repeated display of the same rate)
  const freq = {};
  for (const v of candidates) freq[v] = (freq[v] || 0) + 1;
  return parseFloat(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);
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
  history = history.filter(e => e.date !== dateStr);
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

  log(`Goldback rate scrape for ${dateStr}`);
  if (DRY_RUN) log("DRY RUN -- no files written");

  let markdown;
  try {
    markdown = await scrapeGoldbackPage();
    log(`Firecrawl: ${markdown.length} chars`);
  } catch (err) {
    console.error(`Firecrawl failed: ${err.message}`);
    process.exit(1);
  }

  const g1Rate = extractG1Rate(markdown);
  if (g1Rate === null) {
    console.error("Could not extract G1 rate from page. Check goldback.com page structure.");
    log("No write -- previous data retained.");
    process.exit(1);
  }

  log(`G1 rate: $${g1Rate}`);

  // Write to sqld so Fly.io publisher can export goldback-spot.json
  try {
    const client = await openTursoDb();
    await writeSnapshot(client, {
      scrapedAt,
      windowStart: windowFloor(now),
      coinSlug: "goldback-g1",
      vendor: "goldback",
      price: g1Rate,
      source: "firecrawl",
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

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

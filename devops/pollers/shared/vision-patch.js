#!/usr/bin/env node
/**
 * StakTrakr Retail Poller — Vision Confidence Patcher
 * =====================================================
 * Reads today's Gemini Vision extractions and patches the existing
 * REST API endpoints (data/api/{slug}/latest.json) with updated confidence
 * scores. Designed for the GitHub Actions vision follow-up workflow, where
 * SQLite is not available.
 *
 * Flow:
 *   1. Read base prices from data/api/{slug}/latest.json (committed by local cron)
 *   2. Read vision data from data/retail/{slug}/{date}-vision.json
 *   3. Recompute vendor confidence via mergeVendorWithVision()
 *   4. Write back updated data/api/{slug}/latest.json + data/api/latest.json
 *
 * Usage:
 *   DATA_DIR=/path/to/data node vision-patch.js [YYYY-MM-DD]
 *
 * Environment:
 *   DATA_DIR   Path to repo data/ folder (default: ../../data)
 *   DRY_RUN    Set to "1" to skip writing files
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, "../../data"));
const DRY_RUN = process.env.DRY_RUN === "1";
const dateStr = process.argv[2] || new Date().toISOString().slice(0, 10);

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function warn(msg) {
  console.warn(`[${new Date().toISOString().slice(11, 19)}] WARN: ${msg}`);
}

function readJsonSafe(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Confidence scoring — mirrors api-export.js; keep in sync when changing either
// ---------------------------------------------------------------------------

function scoreVendorPrice(price, windowMedian, prevMedian) {
  let score = 50;
  if (windowMedian !== null && windowMedian !== 0) {
    const deviation = Math.abs(price - windowMedian) / windowMedian;
    if (deviation <= 0.03) score += 10;
    else if (deviation > 0.08) score -= 15;
  }
  if (prevMedian !== null && prevMedian !== 0) {
    const dayDiff = Math.abs(price - prevMedian) / prevMedian;
    if (dayDiff > 0.1) score -= 20;
  }
  return Math.max(0, Math.min(100, score));
}

function mergeVendorWithVision(firecrawlPrice, visionData, vendorId, windowMedian, prevMedian) {
  if (!visionData?.prices_by_site) {
    return {
      price: firecrawlPrice,
      confidence: scoreVendorPrice(firecrawlPrice, windowMedian, prevMedian),
      method: "firecrawl",
    };
  }
  const visionPrice = visionData.prices_by_site[vendorId];
  const visionConfidence = visionData.confidence_by_site?.[vendorId] ?? "medium";
  if (!visionPrice) {
    return {
      price: firecrawlPrice,
      confidence: scoreVendorPrice(firecrawlPrice, windowMedian, prevMedian),
      method: "firecrawl",
    };
  }
  const diff = Math.abs(firecrawlPrice - visionPrice) / Math.max(firecrawlPrice, visionPrice);
  // Exact match (within rounding) — highest possible confidence
  if (diff === 0) {
    return { price: firecrawlPrice, confidence: 99, method: "firecrawl+vision(exact)" };
  }
  let base = diff <= 0.02 ? 90 : diff <= 0.05 ? 70 : 35;
  const visionMod = visionConfidence === "high" ? 5 : visionConfidence === "medium" ? 0 : -10;
  let medianMod = 0;
  if (windowMedian !== null && windowMedian !== 0) {
    const deviation = Math.abs(firecrawlPrice - windowMedian) / windowMedian;
    if (deviation <= 0.03) medianMod = 5;
    else if (deviation > 0.08) medianMod = -10;
  }
  let dodMod = 0;
  if (prevMedian !== null && prevMedian !== 0) {
    const dayDiff = Math.abs(firecrawlPrice - prevMedian) / prevMedian;
    if (dayDiff > 0.1) dodMod = -15;
  }
  return {
    price: firecrawlPrice,
    confidence: Math.max(0, Math.min(100, base + visionMod + medianMod + dodMod)),
    method: "firecrawl+vision",
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const providersPath = join(DATA_DIR, "retail", "providers.json");
  if (!existsSync(providersPath)) {
    console.error(`providers.json not found at ${providersPath}`);
    process.exit(1);
  }
  const providers = JSON.parse(readFileSync(providersPath, "utf-8"));
  const coinSlugs = Object.keys(providers.coins);

  log(`Vision patch: ${coinSlugs.length} coins, date ${dateStr}${DRY_RUN ? " [DRY RUN]" : ""}`);

  let patchedCoins = 0;
  const globalLatest = readJsonSafe(join(DATA_DIR, "api", "latest.json"));

  for (const slug of coinSlugs) {
    const latestPath = join(DATA_DIR, "api", slug, "latest.json");
    const latestData = readJsonSafe(latestPath);
    if (!latestData?.vendors || Object.keys(latestData.vendors).length === 0) {
      warn(`${slug}: latest.json missing or has no vendors — skipping`);
      continue;
    }

    const visionPath = join(DATA_DIR, "retail", slug, `${dateStr}-vision.json`);
    const visionData = readJsonSafe(visionPath);
    if (!visionData?.prices_by_site || Object.keys(visionData.prices_by_site).length === 0) {
      log(`${slug}: no vision data for ${dateStr} — confidence unchanged`);
      continue;
    }

    // Get prev-day median from history-7d for day-over-day check
    const hist7d = readJsonSafe(join(DATA_DIR, "api", slug, "history-7d.json")) || [];
    const today = latestData.window_start?.slice(0, 10) ?? dateStr;
    const prevEntry = hist7d
      .filter((e) => e.date < today)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const prevMedian = prevEntry?.avg_median ?? null;

    const windowMedian = latestData.median_price;
    const updatedVendors = {};

    for (const [vendorId, vendorData] of Object.entries(latestData.vendors)) {
      const { price, confidence, method } = mergeVendorWithVision(
        vendorData.price,
        visionData,
        vendorId,
        windowMedian,
        prevMedian
      );
      updatedVendors[vendorId] = { ...vendorData, price, confidence, method };
    }

    // Recompute median and lowest from updated prices
    const prices = Object.values(updatedVendors)
      .map((v) => v.price)
      .filter((p) => p != null);
    const sortedPrices = [...prices].sort((a, b) => a - b);
    const newMedian = sortedPrices.length
      ? Math.round(sortedPrices[Math.floor(sortedPrices.length / 2)] * 100) / 100
      : latestData.median_price;
    const newLowest = sortedPrices.length ? sortedPrices[0] : latestData.lowest_price;

    const updatedLatest = {
      ...latestData,
      vendors: updatedVendors,
      median_price: newMedian,
      lowest_price: newLowest,
    };

    if (DRY_RUN) {
      log(`[DRY RUN] ${latestPath}`);
    } else {
      writeFileSync(latestPath, JSON.stringify(updatedLatest, null, 2) + "\n");
      log(`${slug}: patched ${Object.keys(updatedVendors).length} vendor(s), median $${newMedian}`);
    }

    // Update global latest.json entry
    if (globalLatest?.coins?.[slug]) {
      globalLatest.coins[slug].median_price = newMedian;
      globalLatest.coins[slug].lowest_price = newLowest;
    }
    patchedCoins++;
  }

  // Write updated global latest.json
  if (globalLatest?.coins) {
    const globalPath = join(DATA_DIR, "api", "latest.json");
    if (DRY_RUN) {
      log(`[DRY RUN] ${globalPath}`);
    } else {
      writeFileSync(globalPath, JSON.stringify(globalLatest, null, 2) + "\n");
      log(`Updated global latest.json`);
    }
  }

  log(`Done: ${patchedCoins}/${coinSlugs.length} coin(s) patched with vision confidence`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

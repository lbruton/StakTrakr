#!/usr/bin/env node

/**
 * spot-extract.js — Node.js spot price poller (ESM)
 *
 * Fetches latest spot prices from MetalPriceAPI, writes to sqld
 * and JSON files for backward compatibility.
 *
 * Env: METAL_PRICE_API_KEY, DATA_DIR, POLLER_ID, SQLD_URL (legacy: TURSO_DATABASE_URL)
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createSqldClient, initSqldSchema } from "./sqld-client.js";
import { insertSpotPrices, startRunLog, finishRunLog, windowFloor } from "./db.js";

const API_URL = "https://api.metalpriceapi.com/v1/latest";

const METAL_MAP = {
  XAU: "Gold",
  XAG: "Silver",
  XPT: "Platinum",
  XPD: "Palladium",
};

/**
 * Format a Date as "YYYY-MM-DD HH:MM:SS" in UTC.
 * @param {Date} d
 * @returns {string}
 */
function formatTimestamp(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * Round a number to 2 decimal places.
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Check if a file exists.
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
 * Write a JSON spot file, creating directories as needed.
 * @param {string} filePath
 * @param {Array} entries
 */
async function writeJsonFile(filePath, entries) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(entries, null, 2), "utf-8");
}

async function main() {
  const apiKey = process.env.METAL_PRICE_API_KEY;
  if (!apiKey) {
    console.error("METAL_PRICE_API_KEY is not set");
    process.exit(1);
  }

  const dataDir = process.env.DATA_DIR;
  if (!dataDir) {
    console.error("DATA_DIR is not set");
    process.exit(1);
  }

  const pollerId = process.env.POLLER_ID || "fly-spot";
  const now = new Date();
  const startedAt = now.toISOString();
  const tsFormatted = formatTimestamp(now);
  const tsWindow = windowFloor(now);

  // --- sqld connection (best-effort) ---
  let client = null;
  let runId = null;
  try {
    client = createSqldClient();
    await initSqldSchema(client);
    runId = await startRunLog(client, { pollerId, startedAt, total: 4 });
  } catch (err) {
    console.error("sqld init failed (degraded mode):", err.message);
    client = null;
  }

  // --- Fetch spot prices ---
  let prices;
  try {
    const url = `${API_URL}?api_key=${apiKey}&base=USD&currencies=XAU,XAG,XPT,XPD`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`API returned ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    if (!data.success) {
      throw new Error(`API error: ${JSON.stringify(data)}`);
    }

    prices = {};
    for (const [code, name] of Object.entries(METAL_MAP)) {
      const rateKey = code;
      const rate = data.rates?.[rateKey];
      if (!rate || rate === 0) {
        throw new Error(`Missing or zero rate for ${rateKey}`);
      }
      // MetalPriceAPI USDXAG returns the direct USD price per troy oz.
      // If the value is < 1, it's the inverse rate (oz-per-USD) — invert it.
      const price = rate >= 1 ? round2(rate) : round2(1 / rate);
      // Sanity bounds: reject obviously wrong prices
      if (price < 5 || price > 50000) {
        throw new Error(`Price out of range for ${name}: $${price} (rate=${rate})`);
      }
      prices[name.toLowerCase()] = price;
    }
  } catch (err) {
    console.error("API fetch failed:", err.message);
    if (client && runId) {
      try {
        await finishRunLog(client, {
          runId,
          finishedAt: new Date().toISOString(),
          captured: 0,
          failures: 4,
          fbpFilled: 0,
          error: err.message,
        });
      } catch (dbErr) {
        console.error("Failed to log error run:", dbErr.message);
      }
    }
    process.exit(1);
  }

  console.log(
    `Spot prices: Gold=$${prices.gold}, Silver=$${prices.silver}, Platinum=$${prices.platinum}, Palladium=$${prices.palladium}`
  );

  // --- Write to sqld ---
  let dbOk = false;
  if (client) {
    try {
      await insertSpotPrices(
        client,
        {
          gold: prices.gold,
          silver: prices.silver,
          platinum: prices.platinum,
          palladium: prices.palladium,
          timestamp: tsWindow,
        },
        pollerId
      );
      dbOk = true;
    } catch (err) {
      console.error("sqld insert failed:", err.message);
    }
  }

  // --- Build JSON entries ---
  const buildEntries = (source) =>
    Object.values(METAL_MAP).map((metal) => ({
      spot: prices[metal.toLowerCase()],
      metal,
      source,
      provider: "StakTrakr",
      timestamp: tsFormatted,
    }));

  // --- Write JSON files ---
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = String(now.getUTCFullYear());
  const mm = pad(now.getUTCMonth() + 1);
  const dd = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const min = pad(now.getUTCMinutes());

  let filesWritten = 0;

  // Hourly file — overwrite
  try {
    const hourlyPath = join(dataDir, "hourly", yyyy, mm, dd, `${hh}.json`);
    await writeJsonFile(hourlyPath, buildEntries("hourly"));
    console.log(`Wrote hourly: ${hourlyPath}`);
    filesWritten++;
  } catch (err) {
    console.error("Failed to write hourly file:", err.message);
  }

  // 15min file — immutable, skip if exists
  try {
    const floorMin = tsWindow.slice(11, 13) + tsWindow.slice(14, 16); // "HHMM" floored
    const fifteenPath = join(dataDir, "15min", yyyy, mm, dd, `${floorMin}.json`);
    if (await fileExists(fifteenPath)) {
      console.log(`15min file exists, skipping: ${fifteenPath}`);
    } else {
      await writeJsonFile(fifteenPath, buildEntries("seed"));
      console.log(`Wrote 15min: ${fifteenPath}`);
      filesWritten++;
    }
  } catch (err) {
    console.error("Failed to write 15min file:", err.message);
  }

  // --- Finish run log ---
  if (client && runId) {
    try {
      const error = dbOk ? null : "sqld insert failed";
      const captured = dbOk ? 4 : 0;
      const failures = dbOk ? 0 : 4;
      await finishRunLog(client, {
        runId,
        finishedAt: new Date().toISOString(),
        captured,
        failures,
        fbpFilled: 0,
        error,
      });
    } catch (err) {
      console.error("Failed to finish run log:", err.message);
    }
  }

  console.log(`Done. DB: ${dbOk ? "ok" : "degraded"}, files: ${filesWritten}`);
}

main();

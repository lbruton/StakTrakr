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
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSqldClient, initSqldSchema } from "./sqld-client.js";
import { insertSpotPrices, startRunLog, finishRunLog, windowFloor } from "./db.js";
import {
  METAL_MAP,
  METAL_ORDER,
  SPOT_METAL_KEYS,
  derivePrice,
  assertPriceInRange,
  roundPrice,
} from "./spot-metals.js";

const API_URL = "https://api.metalpriceapi.com/v1/latest";

/** Metal count, derived so a new metal never leaves a stale hardcoded total behind. */
const METAL_COUNT = METAL_ORDER.length;

/**
 * Format a Date as "YYYY-MM-DD HH:MM:SS" in UTC.
 * @param {Date} d
 * @returns {string}
 */
function formatTimestamp(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// Price rounding lives in spot-metals.js (roundPrice) — it is magnitude-aware,
// because two decimals quantises a sub-dollar metal like copper by ~0.6% per
// tick and that error is permanent once written to history (STRK-303).

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
    runId = await startRunLog(client, { pollerId, startedAt, total: METAL_COUNT });
  } catch (err) {
    console.error("sqld init failed (degraded mode):", err.message);
    client = null;
  }

  // --- Fetch spot prices ---
  let prices;
  try {
    // Symbol list is derived from METAL_MAP so it cannot drift from the loop
    // below. When these were two separate literals, adding a metal to one and
    // not the other made every poll throw and exit (STRK-303).
    const currencies = Object.keys(METAL_MAP).join(",");
    const url = `${API_URL}?api_key=${apiKey}&base=USD&currencies=${currencies}`;
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
      const price = roundPrice(derivePrice(data.rates, code));
      assertPriceInRange(code, name, price);
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
          failures: METAL_COUNT,
          fbpFilled: 0,
          error: err.message,
        });
      } catch (dbErr) {
        console.error("Failed to log error run:", dbErr.message);
      }
    }
    process.exit(1);
  }

  // Derived from METAL_ORDER — a hand-written list here silently omitted any
  // metal added later, which is how this line stayed four-wide (STRK-303).
  const priceSummary = METAL_ORDER.map((metal) => `${metal}=$${prices[metal.toLowerCase()]}`).join(
    ", "
  );
  console.log(`Spot prices: ${priceSummary}`);

  // --- Write to sqld ---
  let dbOk = false;
  if (client) {
    try {
      // Built from SPOT_METAL_KEYS rather than spelled out. db.js destructures
      // this payload by name and silently discards anything it does not know
      // about, so a hand-written object here drops a new metal with no error
      // and no log line (STRK-303).
      const spotPayload = { timestamp: tsWindow };
      for (const key of SPOT_METAL_KEYS) {
        spotPayload[key] = prices[key];
      }
      await insertSpotPrices(client, spotPayload, pollerId);
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
      const captured = dbOk ? METAL_COUNT : 0;
      const failures = dbOk ? 0 : METAL_COUNT;
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

/**
 * Whether this module was executed directly rather than imported.
 *
 * Gates the call to main() so a test can import this file without starting a
 * live poll. Same guard as backfill-spot-files.js (STRK-303).
 * @constant {boolean}
 */
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

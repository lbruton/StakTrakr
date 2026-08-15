/**
 * v2 API utility functions — timestamp normalization, OHLCA computation, envelope wrapping.
 * Pure functions only. No database access, no file I/O, no side effects.
 * All timestamps are ISO 8601 UTC with Z suffix.
 */

import { roundPrice } from "./spot-metals.js";

/**
 * Floor a Date to the given granularity boundary and return an ISO 8601 UTC Z-suffixed string.
 */
export function floorTimestamp(date, granularity) {
  const d = new Date(date);
  switch (granularity) {
    case "15min":
      d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15, 0, 0);
      d.setUTCMilliseconds(0);
      break;
    case "hourly":
      d.setUTCMinutes(0, 0, 0);
      d.setUTCMilliseconds(0);
      break;
    case "daily":
      d.setUTCHours(12, 0, 0, 0);
      break;
    case "weekly": {
      const dow = d.getUTCDay();
      const diff = dow === 0 ? -6 : 1 - dow;
      d.setUTCDate(d.getUTCDate() + diff);
      d.setUTCHours(12, 0, 0, 0);
      break;
    }
    case "monthly":
      d.setUTCDate(1);
      d.setUTCHours(12, 0, 0, 0);
      break;
    default:
      throw new Error(`Unknown granularity: ${granularity}`);
  }
  return d.toISOString().replace(".000Z", "Z");
}

/**
 * Returns {t, ts} where t is the floored ISO 8601 string and ts is Unix epoch seconds (integer).
 */
export function toTimestampPair(date, granularity) {
  const t = floorTimestamp(date, granularity);
  const ts = Math.floor(new Date(t).getTime() / 1000);
  return { t, ts };
}

/**
 * Compute OHLCA from an array of {price, timestamp} samples.
 * Returns {open, high, low, close, avg, n} or null if empty.
 */
export function computeOhlca(samples) {
  if (!samples || samples.length === 0) return null;

  const sorted = [...samples].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const prices = sorted.map((s) => s.price);
  const sum = prices.reduce((acc, p) => acc + p, 0);

  return {
    open: sorted[0].price,
    high: Math.max(...prices),
    low: Math.min(...prices),
    close: sorted[sorted.length - 1].price,
    // Magnitude-aware: open/high/low/close pass through raw, so a flat 2-decimal
    // avg would publish `avg: 0.41` beside `high: 0.4126` in the same object for
    // a sub-dollar metal like copper. Identical to the old behaviour at or
    // above $1, so retail and the precious metals are unaffected (STRK-303).
    avg: roundPrice(sum / prices.length),
    n: prices.length,
  };
}

/**
 * Wrap data in a v2 envelope with version, generated_at, and stale_after.
 *
 * @param {*} data - The payload to wrap
 * @param {number} staleAfterSeconds - Budget in seconds before the envelope is stale
 * @param {Date|string|number} [generatedAt] - Optional override for generated_at.
 *   When provided, the envelope carries the real data-origin time (e.g. the
 *   scrape timestamp for a stale goldback row) instead of publish time.
 *   Spot and retail callers omit this param and keep the publish-time default.
 * @returns {{ v: number, generated_at: string, stale_after: number, data: * }}
 */
export function wrapEnvelope(data, staleAfterSeconds, generatedAt) {
  return {
    v: 2,
    generated_at:
      generatedAt !== undefined
        ? new Date(generatedAt).toISOString().replace(".000Z", "Z")
        : new Date().toISOString().replace(".000Z", "Z"),
    stale_after: staleAfterSeconds,
    data,
  };
}

// ---------------------------------------------------------------------------
// Inline tests — run with: node devops/pollers/shared/v2-utils.js
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  let passed = 0;
  let failed = 0;

  function assert(condition, label) {
    if (condition) {
      passed++;
    } else {
      failed++;
      console.error(`FAIL: ${label}`);
    }
  }

  // --- computeOhlca: single sample ---
  const single = computeOhlca([{ price: 100, timestamp: "2026-03-24T14:00:00Z" }]);
  assert(single.open === 100, "single OHLCA open");
  assert(single.high === 100, "single OHLCA high");
  assert(single.low === 100, "single OHLCA low");
  assert(single.close === 100, "single OHLCA close");
  assert(single.avg === 100, "single OHLCA avg");
  assert(single.n === 1, "single OHLCA n");

  // --- computeOhlca: multi sample ---
  const multi = computeOhlca([
    { price: 105, timestamp: "2026-03-24T14:30:00Z" },
    { price: 95, timestamp: "2026-03-24T14:00:00Z" },
    { price: 110, timestamp: "2026-03-24T15:00:00Z" },
    { price: 100, timestamp: "2026-03-24T14:15:00Z" },
  ]);
  assert(multi.open === 95, "multi OHLCA open (earliest)");
  assert(multi.high === 110, "multi OHLCA high");
  assert(multi.low === 95, "multi OHLCA low");
  assert(multi.close === 110, "multi OHLCA close (latest)");
  assert(multi.avg === 102.5, "multi OHLCA avg");
  assert(multi.n === 4, "multi OHLCA n");

  // --- computeOhlca: empty array ---
  assert(computeOhlca([]) === null, "empty array returns null");

  // --- floorTimestamp: 15min ---
  assert(
    floorTimestamp(new Date("2026-03-24T14:22:45Z"), "15min") === "2026-03-24T14:15:00Z",
    "15min floor"
  );
  assert(
    floorTimestamp(new Date("2026-03-24T14:00:00Z"), "15min") === "2026-03-24T14:00:00Z",
    "15min exact"
  );
  assert(
    floorTimestamp(new Date("2026-03-24T14:44:59Z"), "15min") === "2026-03-24T14:30:00Z",
    "15min :44"
  );
  assert(
    floorTimestamp(new Date("2026-03-24T14:59:59Z"), "15min") === "2026-03-24T14:45:00Z",
    "15min :59"
  );

  // --- floorTimestamp: hourly ---
  assert(
    floorTimestamp(new Date("2026-03-24T14:22:45Z"), "hourly") === "2026-03-24T14:00:00Z",
    "hourly floor"
  );

  // --- floorTimestamp: daily ---
  assert(
    floorTimestamp(new Date("2026-03-24T23:59:59Z"), "daily") === "2026-03-24T12:00:00Z",
    "daily floor"
  );
  assert(
    floorTimestamp(new Date("2026-03-24T00:00:00Z"), "daily") === "2026-03-24T12:00:00Z",
    "daily midnight"
  );

  // --- floorTimestamp: weekly (Monday noon) ---
  // 2026-03-24 is a Tuesday
  assert(
    floorTimestamp(new Date("2026-03-24T14:22:45Z"), "weekly") === "2026-03-23T12:00:00Z",
    "weekly Tuesday→Monday"
  );
  // 2026-03-23 is a Monday
  assert(
    floorTimestamp(new Date("2026-03-23T08:00:00Z"), "weekly") === "2026-03-23T12:00:00Z",
    "weekly Monday stays Monday"
  );
  // 2026-03-29 is a Sunday
  assert(
    floorTimestamp(new Date("2026-03-29T20:00:00Z"), "weekly") === "2026-03-23T12:00:00Z",
    "weekly Sunday→Monday"
  );

  // --- floorTimestamp: monthly ---
  assert(
    floorTimestamp(new Date("2026-03-24T14:22:45Z"), "monthly") === "2026-03-01T12:00:00Z",
    "monthly floor"
  );

  // --- Month boundary: Jan 31 → Jan 1 noon ---
  assert(
    floorTimestamp(new Date("2026-01-31T23:59:59Z"), "monthly") === "2026-01-01T12:00:00Z",
    "Jan 31 monthly → Jan 1 noon"
  );

  // --- Midnight edge case ---
  assert(
    floorTimestamp(new Date("2026-03-24T00:00:00Z"), "15min") === "2026-03-24T00:00:00Z",
    "midnight 15min"
  );
  assert(
    floorTimestamp(new Date("2026-03-24T00:00:00Z"), "hourly") === "2026-03-24T00:00:00Z",
    "midnight hourly"
  );
  assert(
    floorTimestamp(new Date("2026-03-24T00:00:00Z"), "daily") === "2026-03-24T12:00:00Z",
    "midnight daily"
  );

  // --- toTimestampPair ---
  const pair = toTimestampPair(new Date("2026-03-24T14:22:45Z"), "hourly");
  assert(pair.t === "2026-03-24T14:00:00Z", "pair t");
  assert(pair.ts === Math.floor(new Date("2026-03-24T14:00:00Z").getTime() / 1000), "pair ts");
  assert(Number.isInteger(pair.ts), "pair ts is integer");

  // --- wrapEnvelope ---
  const env = wrapEnvelope({ foo: "bar" }, 1800);
  assert(env.v === 2, "envelope v");
  assert(env.stale_after === 1800, "envelope stale_after");
  assert(env.data.foo === "bar", "envelope data");
  assert(env.generated_at.endsWith("Z"), "envelope generated_at Z suffix");
  assert(!env.generated_at.includes(".000Z"), "envelope no .000Z");

  console.log(`\nv2-utils tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

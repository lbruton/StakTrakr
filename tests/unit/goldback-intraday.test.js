// Unit tests for buildGoldbackIntradayEntries (api-export-v2.js) — STRK-248.
// Run: npm run test:unit  (node --test tests/unit/goldback-intraday.test.js)
//
// The import MUST NOT run main() (api-export-v2.js is guarded by an isMain check).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildGoldbackIntradayEntries } from "../../devops/pollers/shared/api-export-v2.js";

const ROWS = [
  { price: 4.23, scraped_at: "2026-06-28T17:22:45Z" },
  { price: 4.25, scraped_at: "2026-06-28T18:05:00Z" },
];

describe("buildGoldbackIntradayEntries", () => {
  it("returns an array of { t, ts, g1_usd } objects", () => {
    const out = buildGoldbackIntradayEntries(ROWS);
    assert.ok(Array.isArray(out));
    assert.equal(out.length, 2);
    for (const e of out) {
      assert.ok(Object.prototype.hasOwnProperty.call(e, "t"));
      assert.ok(Object.prototype.hasOwnProperty.call(e, "ts"));
      assert.ok(Object.prototype.hasOwnProperty.call(e, "g1_usd"));
    }
  });

  it("floors t to the hour (ISO 8601 UTC Z) and ts to matching epoch seconds", () => {
    const out = buildGoldbackIntradayEntries(ROWS);
    assert.equal(out[0].t, "2026-06-28T17:00:00Z");
    assert.equal(out[1].t, "2026-06-28T18:00:00Z");
    // ts is the epoch-seconds twin of the hourly-floored t (not the raw scrape time)
    assert.equal(out[0].ts, Date.parse("2026-06-28T17:00:00Z") / 1000);
    assert.equal(out[1].ts, Date.parse("2026-06-28T18:00:00Z") / 1000);
  });

  it("rounds g1_usd to 2 decimals", () => {
    const out = buildGoldbackIntradayEntries([
      { price: 4.237, scraped_at: "2026-06-28T17:22:45Z" },
    ]);
    assert.equal(out[0].g1_usd, Math.round(4.237 * 100) / 100);
  });

  it("preserves ascending order of the input", () => {
    const out = buildGoldbackIntradayEntries(ROWS);
    assert.equal(out[0].g1_usd, 4.23);
    assert.equal(out[1].g1_usd, 4.25);
  });

  it("keeps one point per hour — last scrape in the hour wins", () => {
    const out = buildGoldbackIntradayEntries([
      { price: 4.2, scraped_at: "2026-06-28T17:05:00Z" },
      { price: 4.28, scraped_at: "2026-06-28T17:55:00Z" },
      { price: 4.3, scraped_at: "2026-06-28T18:10:00Z" },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].t, "2026-06-28T17:00:00Z");
    assert.equal(out[0].g1_usd, 4.28); // last scrape within 17:00 hour
    assert.equal(out[1].t, "2026-06-28T18:00:00Z");
    assert.equal(out[1].g1_usd, 4.3);
  });

  it("emits NO OHLCA fields (raw point series)", () => {
    const out = buildGoldbackIntradayEntries(ROWS);
    for (const e of out) {
      for (const k of ["o", "h", "l", "c", "a"]) {
        assert.equal(Object.prototype.hasOwnProperty.call(e, k), false);
      }
    }
  });

  it("returns [] for empty input", () => {
    assert.deepEqual(buildGoldbackIntradayEntries([]), []);
  });
});

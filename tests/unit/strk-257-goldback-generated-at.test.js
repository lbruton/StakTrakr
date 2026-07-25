// Unit tests for STRK-257: anchor goldback generated_at to scraped_at ALWAYS.
//
// Found by Codex (P2) on PR #1358, in the STRK-250 honest-envelope fix.
// STRK-250 only returned the real scrape time once a row had already gone
// stale; for a row still inside the budget it returned undefined and
// wrapEnvelope stamped generated_at with the *publish* time instead.
//
// That reopened the exact bug STRK-250 existed to close, just one step
// earlier: a row scraped 1h59m before export was published with a
// generated_at of "now" and a 2h stale_after, handing consumers a fresh
// 2-hour window for data that had ~1 minute of life left. The service worker
// and _strictMarketFreshness would then keep serving it — from cache, offline
// — for nearly four hours total while reporting it as fresh.
//
// The contract is now simply: generated_at is the data's own timestamp
// whenever we have a valid one. Freshness is always measured against when the
// price was actually scraped, never against when we happened to publish it.
//
// Run: npm run test:unit

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { wrapEnvelope } from "../../devops/pollers/shared/v2-utils.js";
import { resolveGoldbackGeneratedAt } from "../../devops/pollers/shared/api-export-v2.js";

/** Realtime freshness budget for goldback/latest.json, in seconds. */
const BUDGET_SECONDS = 7200;

/** Fixed reference instant so age maths are deterministic across runs. */
const NOW = new Date("2026-06-30T12:00:00Z");
const NOW_MS = NOW.getTime();

/**
 * Build an ISO timestamp a given number of seconds before the reference now.
 *
 * @param {number} seconds - How far in the past.
 * @returns {string} Normalised ISO-8601 string.
 */
function agoIso(seconds) {
  return new Date(NOW_MS - seconds * 1000).toISOString().replace(".000Z", "Z");
}

describe("STRK-257 resolveGoldbackGeneratedAt anchors to scraped_at", () => {
  it("returns the scrape time for a FRESH row (was undefined before)", () => {
    // The regression STRK-257 fixes. Under STRK-250 this returned undefined,
    // so wrapEnvelope fell back to publish time.
    const scrapedAt = agoIso(300);
    assert.equal(resolveGoldbackGeneratedAt(scrapedAt), scrapedAt);
  });

  it("returns the scrape time for a STALE row (STRK-250 behaviour preserved)", () => {
    const scrapedAt = agoIso(3 * 60 * 60);
    assert.equal(resolveGoldbackGeneratedAt(scrapedAt), scrapedAt);
  });

  it("returns the scrape time exactly on the budget boundary", () => {
    const scrapedAt = agoIso(BUDGET_SECONDS);
    assert.equal(resolveGoldbackGeneratedAt(scrapedAt), scrapedAt);
  });

  it("normalises a Date instance and a millisecond-bearing string", () => {
    assert.equal(
      resolveGoldbackGeneratedAt(new Date("2026-06-01T00:00:00Z")),
      "2026-06-01T00:00:00Z"
    );
    assert.equal(resolveGoldbackGeneratedAt("2026-06-01T00:00:00.000Z"), "2026-06-01T00:00:00Z");
  });

  it("returns undefined only when there is no usable timestamp", () => {
    // Without a real timestamp there is nothing honest to stamp, so the
    // publish-time default remains the only option.
    assert.equal(resolveGoldbackGeneratedAt(null), undefined);
    assert.equal(resolveGoldbackGeneratedAt(undefined), undefined);
    assert.equal(resolveGoldbackGeneratedAt("not-a-date"), undefined);
    // `new Date(null)` is the epoch, not Invalid Date — the null guard must
    // run before the NaN check or this would stamp 1970 (STRK-250 lesson).
    assert.notEqual(resolveGoldbackGeneratedAt(null), "1970-01-01T00:00:00Z");
  });
});

describe("STRK-257 remaining freshness is measured from the scrape", () => {
  it("a row scraped 1h59m ago has ~1 minute of budget left, not a full 2h", () => {
    // The concrete failure in the issue. Publish-time anchoring reported
    // 7200 s of remaining life for data that had 60 s left, letting the SW
    // and _strictMarketFreshness serve a >2h-old price as fresh.
    const ageSeconds = 119 * 60;
    const scrapedAt = agoIso(ageSeconds);

    const env = wrapEnvelope(
      { g1_usd: 4.25 },
      BUDGET_SECONDS,
      resolveGoldbackGeneratedAt(scrapedAt)
    );

    const generatedMs = new Date(env.generated_at).getTime();
    const observedAge = (NOW_MS - generatedMs) / 1000;
    assert.equal(observedAge, ageSeconds);

    const remaining = BUDGET_SECONDS - observedAge;
    assert.equal(remaining, 60);
    assert.ok(remaining < 120, "a nearly-expired row must not report a fresh window");
  });

  it("the envelope keeps its v2 shape and stale_after", () => {
    const env = wrapEnvelope(
      { g1_usd: 4.25 },
      BUDGET_SECONDS,
      resolveGoldbackGeneratedAt(agoIso(60))
    );
    assert.equal(env.v, 2);
    assert.equal(env.stale_after, BUDGET_SECONDS);
    assert.deepEqual(env.data, { g1_usd: 4.25 });
  });

  it("falls back to publish time when the row has no usable timestamp", () => {
    // Guard path: generated_at must still be present and recent.
    const before = Date.now();
    const env = wrapEnvelope({ g1_usd: 4.25 }, BUDGET_SECONDS, resolveGoldbackGeneratedAt(null));
    const ts = new Date(env.generated_at).getTime();
    assert.ok(ts >= before - 1000 && ts <= Date.now() + 5000);
  });
});

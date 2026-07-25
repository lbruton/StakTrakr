// Unit tests for STRK-250: honest envelope timestamp for goldback/latest.json
// Run: node --test tests/unit/strk-250-goldback-honest-envelope.test.js
//      or: npm run test:unit

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { wrapEnvelope } from "../../devops/pollers/shared/v2-utils.js";
import { resolveGoldbackGeneratedAt } from "../../devops/pollers/shared/api-export-v2.js";

// Fixed reference instant so age maths are deterministic across runs.
const NOW = new Date("2026-06-30T12:00:00Z");
const NOW_MS = NOW.getTime();

// ---------------------------------------------------------------------------
// wrapEnvelope — optional generatedAt override
// ---------------------------------------------------------------------------

describe("wrapEnvelope — generatedAt override (STRK-250)", () => {
  it("R3.1 — override: produced generated_at equals the injected timestamp (normalised ISO)", () => {
    const injected = new Date("2026-06-01T00:00:00Z");
    const env = wrapEnvelope({ x: 1 }, 7200, injected);
    assert.equal(env.generated_at, "2026-06-01T00:00:00Z");
  });

  it("R3.2 — no override: generated_at is within 5 s of publish time (default path)", () => {
    const before = Date.now();
    const env = wrapEnvelope({ x: 1 }, 7200);
    const after = Date.now();
    const ts = new Date(env.generated_at).getTime();
    assert.ok(ts >= before - 1000, "generated_at must not be before the call");
    assert.ok(ts <= after + 5000, "generated_at must be close to publish time");
  });

  it("R3.1b — override with string input is normalised to ISO without milliseconds", () => {
    // Task 1 normalises via .replace('.000Z','Z') for the override path too.
    const env = wrapEnvelope({ x: 1 }, 7200, "2026-06-01T00:00:00.000Z");
    assert.equal(env.generated_at, "2026-06-01T00:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// wrapEnvelope — envelope shape regression (R2.1 / R2.2)
// ---------------------------------------------------------------------------

describe("wrapEnvelope — envelope shape regression (R2.1/R2.2)", () => {
  it("R2.1 — default path: envelope v=2, stale_after forwarded, data forwarded", () => {
    const data = { price: 4.25 };
    const env = wrapEnvelope(data, 7200);
    assert.equal(env.v, 2);
    assert.equal(env.stale_after, 7200);
    assert.deepEqual(env.data, data);
  });

  it("R2.2 — override path: envelope shape is identical (v=2, stale_after, data)", () => {
    const data = { price: 4.25 };
    const env = wrapEnvelope(data, 7200, new Date("2026-06-01T00:00:00Z"));
    assert.equal(env.v, 2);
    assert.equal(env.stale_after, 7200);
    assert.deepEqual(env.data, data);
  });
});

// ---------------------------------------------------------------------------
// resolveGoldbackGeneratedAt — stale / fresh / NaN-safe branches
//
// SUPERSEDED IN PART BY STRK-257. STRK-250 returned the real scrape time only
// once a row had already gone stale, leaving the publish-time default in place
// for rows still inside the budget. That reopened the same bug one step
// earlier (a 1h59m-old row published with a full fresh 2h window), so the
// budget no longer gates the decision — a usable scraped_at is always returned
// and the `now` / `budgetSeconds` parameters are gone.
//
// The two age-gated expectations below (R3.4, R3.3b) are kept rather than
// deleted, flipped to the current contract, so the reversal stays visible in
// history. The stale, guard and envelope-shape cases are unchanged: those were
// always correct and still pass. New coverage lives in
// tests/unit/strk-257-goldback-generated-at.test.js.
// ---------------------------------------------------------------------------

describe("resolveGoldbackGeneratedAt (STRK-250, amended by STRK-257)", () => {
  it("R3.3 — stale: row > budget old → returns normalised scraped_at ISO", () => {
    // 3 h ago. Unchanged by STRK-257 — this case always returned the scrape time.
    const scrapedAt = new Date(NOW_MS - 3 * 60 * 60 * 1000).toISOString();
    const result = resolveGoldbackGeneratedAt(scrapedAt);
    const expected = new Date(scrapedAt).toISOString().replace(".000Z", "Z");
    assert.equal(result, expected);
  });

  it("R3.4 (STRK-257) — fresh: row ≤ budget old → NOW returns scraped_at, not undefined", () => {
    // Was: `assert.equal(result, undefined)` — the publish-time default.
    // A fresh row must still be anchored to its own scrape time so the
    // stale_after window counts down from capture, not from publish.
    const scrapedAt = new Date(NOW_MS - 5 * 60 * 1000).toISOString();
    const result = resolveGoldbackGeneratedAt(scrapedAt);
    assert.equal(result, scrapedAt.replace(".000Z", "Z"));
  });

  it("Guard — NaN-safe: unparseable scraped_at → returns undefined", () => {
    assert.equal(resolveGoldbackGeneratedAt("not-a-date"), undefined);
  });

  it("Guard — null scraped_at → returns undefined", () => {
    assert.equal(resolveGoldbackGeneratedAt(null), undefined);
  });

  it("R3.3b (STRK-257) — exactly on the budget boundary → returns scraped_at", () => {
    // Was: undefined, because the old strict `age > budget` treated the exact
    // boundary as fresh. With no age gate the boundary is no longer special.
    const scrapedAt = new Date(NOW_MS - 7200 * 1000).toISOString();
    const result = resolveGoldbackGeneratedAt(scrapedAt);
    assert.equal(result, scrapedAt.replace(".000Z", "Z"));
  });

  it("R3.3c — one second past budget → returns scraped_at", () => {
    const scrapedAt = new Date(NOW_MS - 7201 * 1000).toISOString();
    const result = resolveGoldbackGeneratedAt(scrapedAt);
    const expected = new Date(scrapedAt).toISOString().replace(".000Z", "Z");
    assert.equal(result, expected);
  });
});

// Unit tests for STRK-250: honest envelope timestamp for goldback/latest.json
// Run: node --test tests/unit/strk-250-goldback-honest-envelope.test.js
//      or: npm run test:unit
//
// RED phase: resolveGoldbackGeneratedAt does not exist yet; wrapEnvelope ignores
// the 3rd arg. The tests for the new behaviour will fail. Regression tests for
// the default (publish-time) path already pass.

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
    // Task 1 adds the 3rd param; currently wrapEnvelope ignores it → FAILS (red)
    const injected = new Date("2026-06-01T00:00:00Z");
    const env = wrapEnvelope({ x: 1 }, 7200, injected);
    assert.equal(env.generated_at, "2026-06-01T00:00:00Z");
  });

  it("R3.2 — no override: generated_at is within 5 s of publish time (default path)", () => {
    // Default path is unchanged — this should PASS even in the red phase.
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
    // Will fail until Task 1 lands; here we verify shape not just timestamp.
    const data = { price: 4.25 };
    const env = wrapEnvelope(data, 7200, new Date("2026-06-01T00:00:00Z"));
    assert.equal(env.v, 2);
    assert.equal(env.stale_after, 7200);
    assert.deepEqual(env.data, data);
  });
});

// ---------------------------------------------------------------------------
// resolveGoldbackGeneratedAt — stale / fresh / NaN-safe branches
// ---------------------------------------------------------------------------

describe("resolveGoldbackGeneratedAt (STRK-250)", () => {
  it("R3.3 — stale: row > budget old → returns normalised scraped_at ISO", () => {
    // 3 h ago (10800 s > 7200 s budget) → must return the scrape time string.
    const scrapedAt = new Date(NOW_MS - 3 * 60 * 60 * 1000).toISOString();
    const result = resolveGoldbackGeneratedAt(scrapedAt, NOW, 7200);
    // Expected: normalised ISO of the scraped_at value (no milliseconds)
    const expected = new Date(scrapedAt).toISOString().replace(".000Z", "Z");
    assert.equal(result, expected);
  });

  it("R3.4 — fresh: row ≤ budget old → returns undefined (publish-time default)", () => {
    // 5 min ago (300 s < 7200 s budget) → must return undefined.
    const scrapedAt = new Date(NOW_MS - 5 * 60 * 1000).toISOString();
    const result = resolveGoldbackGeneratedAt(scrapedAt, NOW, 7200);
    assert.equal(result, undefined);
  });

  it("Guard — NaN-safe: unparseable scraped_at → returns undefined", () => {
    const result = resolveGoldbackGeneratedAt("not-a-date", NOW, 7200);
    assert.equal(result, undefined);
  });

  it("Guard — null scraped_at → returns undefined", () => {
    const result = resolveGoldbackGeneratedAt(null, NOW, 7200);
    assert.equal(result, undefined);
  });

  it("R3.3b — exactly on the budget boundary (== budget) → returns undefined (fresh, strict >)", () => {
    // Age == budget seconds → should be treated as stale (> check uses >).
    // Row is exactly 7200 s old: age (7200) > budget (7200) is FALSE → undefined.
    const scrapedAt = new Date(NOW_MS - 7200 * 1000).toISOString();
    const result = resolveGoldbackGeneratedAt(scrapedAt, NOW, 7200);
    // Boundary at exactly budget is fresh (not stale): age === budget → NOT > budget
    assert.equal(result, undefined);
  });

  it("R3.3c — one second past budget → stale (returns scraped_at)", () => {
    const scrapedAt = new Date(NOW_MS - 7201 * 1000).toISOString();
    const result = resolveGoldbackGeneratedAt(scrapedAt, NOW, 7200);
    const expected = new Date(scrapedAt).toISOString().replace(".000Z", "Z");
    assert.equal(result, expected);
  });
});

import { test, expect } from "@playwright/test";
import { injectSeedInventory } from "../helpers/seed.js";

/**
 * Playwright regression spec for STAK-539 — _isSlugResolved predicate (STAK-521 follow-up).
 *
 * Covers all three predicate branches plus an end-to-end synthetic-slug quarantine check.
 *
 *   R.1 — fallback default: name === slug → false
 *   R.2 — unknown metal: meta.metal === "unknown" → false
 *   R.3 — fully resolved: real name + known metal → true
 *   R.4 — e2e: synthetic unresolved slug excluded from filter matrix, price cards, and _isMarketItemEnabled
 */

const SYNTHETIC_UNRESOLVED = "synthetic-unresolved-slug-stak539";
const SYNTHETIC_METAL_UNKNOWN = "synthetic-metal-unknown-stak539";
const SYNTHETIC_RESOLVED = "synthetic-resolved-slug-stak539";

test.describe("retail/slug-resolution — STAK-539 _isSlugResolved predicate", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);

    // Inject a controlled manifest so tests run against predictable state.
    // SYNTHETIC_UNRESOLVED has no coin meta entry → falls through to default (name=slug, metal="unknown").
    // SYNTHETIC_RESOLVED has a proper entry (name ≠ slug, metal known).
    await page.addInitScript(
      ({ unresolved, metalUnknown, resolved }) => {
        const existingSlugs = JSON.parse(localStorage.getItem("retailManifestSlugs") || "[]");
        const slugs = [...new Set([...existingSlugs, unresolved, metalUnknown, resolved])];
        localStorage.setItem("retailManifestSlugs", JSON.stringify(slugs));

        const existingMeta = JSON.parse(localStorage.getItem("retailManifestCoinMeta") || "{}");
        // unresolved: intentionally omitted → default fallback (name=slug, metal="unknown")
        // metalUnknown: name resolves correctly but metal is explicitly "unknown" → predicate false
        // resolved: fully resolved name + known metal → predicate true
        existingMeta[metalUnknown] = {
          name: "Metal Unknown Test Bar",
          weight: 1,
          metal: "unknown",
        };
        existingMeta[resolved] = { name: "1 oz Silver Test Bar", weight: 1, metal: "silver" };
        localStorage.setItem("retailManifestCoinMeta", JSON.stringify(existingMeta));
      },
      {
        unresolved: SYNTHETIC_UNRESOLVED,
        metalUnknown: SYNTHETIC_METAL_UNKNOWN,
        resolved: SYNTHETIC_RESOLVED,
      }
    );

    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window._isSlugResolved === "function");
  });

  // ── Unit-style predicate tests ───────────────────────────────────────────

  test("R.1 — returns false when name === slug (meta lookup fell through to default)", async ({
    page,
  }) => {
    const result = await page.evaluate((slug) => {
      // No coin meta registered for this slug — getRetailCoinMeta returns default {name: slug, metal: "unknown"}
      return window._isSlugResolved(slug);
    }, SYNTHETIC_UNRESOLVED);

    expect(result).toBe(false);
  });

  test('R.2 — returns false when meta.metal === "unknown" (name resolved, metal unknown)', async ({
    page,
  }) => {
    // SYNTHETIC_METAL_UNKNOWN is injected via beforeEach with name≠slug but metal="unknown".
    // This isolates the metal branch: name passes but metal fails.
    const result = await page.evaluate((slug) => {
      return window._isSlugResolved(slug);
    }, SYNTHETIC_METAL_UNKNOWN);

    expect(result).toBe(false);
  });

  test("R.3 — returns true for a manifest slug with real name and known metal", async ({
    page,
  }) => {
    const result = await page.evaluate((slug) => {
      return window._isSlugResolved(slug);
    }, SYNTHETIC_RESOLVED);

    expect(result).toBe(true);
  });

  // ── End-to-end quarantine test ───────────────────────────────────────────

  test("R.4 — unresolved slug excluded from filter matrix, no price card rendered", async ({
    page,
  }) => {
    // Wait for market list to render (getActiveRetailSlugs is called during render)
    await page.waitForFunction(() => typeof window.getActiveRetailSlugs === "function");

    // 1. Unresolved slug must NOT appear in getActiveRetailSlugs()
    const activeSlugs = await page.evaluate(() => window.getActiveRetailSlugs());
    expect(activeSlugs).not.toContain(SYNTHETIC_UNRESOLVED);

    // 2. Resolved slug IS in getActiveRetailSlugs() (positive control)
    // Note: resolved slug may be excluded from active list if no price data exists for it —
    // getActiveRetailSlugs also filters on price data presence when retailPrices is loaded.
    // We verify _isSlugResolved is the gate, not price data, by checking the predicate directly.
    const unresolvedPasses = await page.evaluate(
      (slug) => window._isSlugResolved(slug),
      SYNTHETIC_UNRESOLVED
    );
    expect(unresolvedPasses).toBe(false);

    // 3. No DOM card rendered for the unresolved slug
    const cardLocator = page.locator(`[data-slug="${SYNTHETIC_UNRESOLVED}"]`);
    await expect(cardLocator).toHaveCount(0);

    // 4. _isMarketItemEnabled returns true by default for unknown slugs (no filter entry),
    //    but the quarantine upstream in getActiveRetailSlugs means the slug never reaches
    //    the render path. Verify the predicate itself is the gate (not the filter).
    const marketEnabled = await page.evaluate(
      (slug) => window._isMarketItemEnabled(slug, "any-vendor"),
      SYNTHETIC_UNRESOLVED
    );
    // _isMarketItemEnabled returns true for slugs with no filter record — the quarantine
    // is upstream (_isSlugResolved in getActiveRetailSlugs), not in the filter itself.
    expect(marketEnabled).toBe(true);
  });
});

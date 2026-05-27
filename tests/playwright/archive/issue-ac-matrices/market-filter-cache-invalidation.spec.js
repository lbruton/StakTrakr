/**
 * STAK-517 — Market filter cache invalidation after vault restore
 *
 * Verifies that after restoreVaultData writes a new value for
 * `staktrakr.market_filter` to localStorage, the in-memory cache
 * `_marketFilterCache` in retail.js is invalidated so that subsequent calls to
 * `_loadMarketFilter()` return the new value rather than stale cached state.
 *
 * This test verifies observable behavior (cache reflects restored value) rather
 * than implementation detail (spy on _invalidateMarketFilterCache), because
 * vault.js references _invalidateMarketFilterCache as a lexical binding — it
 * calls the original function directly, not via window, so patching
 * window._invalidateMarketFilterCache in tests would not intercept the call.
 *
 * BEFORE Task 2: restoreVaultData does NOT call _invalidateMarketFilterCache,
 * so _marketFilterCache stays stale and _loadMarketFilter() returns the old
 * cached value → test FAILS.
 *
 * AFTER Task 2: restoreVaultData calls _invalidateMarketFilterCache() which
 * sets _marketFilterCache = null, so _loadMarketFilter() reads fresh from
 * localStorage and returns the restored value → test PASSES.
 *
 * Slug choice: "ase" (American Silver Eagle 1 oz) is a hardcoded manifest slug
 * with known resolved metadata (name≠slug, metal="silver"), so it survives the
 * STAK-521 quarantine predicate inside _loadMarketFilter.
 */

import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

const MARKET_FILTER_KEY = "staktrakr.market_filter";

// "ase" is a real manifest slug with resolved metadata — survives _isSlugResolved.
const TEST_SLUG = "ase";
const INITIAL_FILTER = { [TEST_SLUG]: { vendorA: false } };
const UPDATED_FILTER = { [TEST_SLUG]: { vendorA: true } };

test.describe("STAK-517 — Market filter cache invalidation after vault restore", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);

    // Pre-set the market filter to INITIAL_FILTER so the cache is primed
    // with a non-empty value on first _loadMarketFilter() call.
    await page.addInitScript(
      ({ key, value }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      { key: MARKET_FILTER_KEY, value: INITIAL_FILTER }
    );

    await page.goto("/index.html");
    // Wait for retail.js and vault.js to expose their window functions.
    await page.waitForFunction(
      () =>
        typeof window._loadMarketFilter === "function" &&
        typeof window._invalidateMarketFilterCache === "function" &&
        typeof window.restoreVaultData === "function"
    );
  });

  test("cache reflects restored market filter value after restoreVaultData without page reload", async ({
    page,
  }) => {
    // Step 1: Prime the in-memory cache by calling _loadMarketFilter().
    // After this call, _marketFilterCache holds INITIAL_FILTER (vendorA: false).
    const cachedBefore = await page.evaluate((slug) => {
      const filter = window._loadMarketFilter();
      if (filter === null || filter === undefined) return null;
      return Object.prototype.hasOwnProperty.call(filter, slug) ? filter[slug] : undefined;
    }, TEST_SLUG);
    expect(cachedBefore).not.toBeNull();
    expect(cachedBefore).not.toBeUndefined();
    expect(cachedBefore).toEqual({ vendorA: false });

    // Step 2: Call restoreVaultData with a minimal payload containing the
    // updated market filter value. This writes the new value to localStorage
    // and — after Task 2 — calls _invalidateMarketFilterCache() to clear the cache.
    await page.evaluate(
      ({ key, value }) => window.restoreVaultData({ data: { [key]: JSON.stringify(value) } }),
      { key: MARKET_FILTER_KEY, value: UPDATED_FILTER }
    );

    // Step 3: Assert that _loadMarketFilter() now returns the UPDATED value.
    // FAILS before Task 2: stale cache still holds INITIAL_FILTER.
    // PASSES after Task 2: cache cleared, fresh read from localStorage.
    const cachedAfter = await page.evaluate((slug) => {
      const filter = window._loadMarketFilter();
      if (filter === null || filter === undefined) return null;
      return Object.prototype.hasOwnProperty.call(filter, slug) ? filter[slug] : undefined;
    }, TEST_SLUG);
    expect(cachedAfter).not.toBeNull();
    expect(cachedAfter).not.toBeUndefined();
    expect(cachedAfter).toEqual({ vendorA: true });
  });
});

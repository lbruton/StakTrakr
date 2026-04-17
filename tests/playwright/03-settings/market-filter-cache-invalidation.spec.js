/**
 * STAK-517 — Market filter cache invalidation after vault restore
 *
 * TDD test: verifies that after restoreVaultData writes a new value for
 * `staktrakr.market_filter` to localStorage, the in-memory cache
 * `_marketFilterCache` in retail.js is invalidated so that subsequent calls to
 * `_loadMarketFilter()` return the new value rather than stale cached state.
 *
 * NOTE: `restoreVaultData` is an internal function in vault.js and is NOT
 * exposed on `window`. The test therefore simulates its localStorage write
 * directly (the same operation restoreVaultData performs), then asserts that
 * `_invalidateMarketFilterCache` was called — a contract that Task 2 will
 * satisfy by calling the invalidator inside `restoreVaultData`.
 *
 * This test MUST FAIL before Task 2 is implemented.
 *
 * Slug choice: "ase" (American Silver Eagle 1 oz) is a hardcoded manifest slug
 * with known resolved metadata (name≠slug, metal="silver"), so it survives the
 * STAK-521 quarantine predicate inside _loadMarketFilter.
 */

import { test, expect } from "@playwright/test";
import { injectSeedInventory } from "../helpers/seed.js";

const MARKET_FILTER_KEY = "staktrakr.market_filter";

// "ase" is a real manifest slug with resolved metadata — survives _isSlugResolved.
const TEST_SLUG = "ase";
const INITIAL_FILTER = { [TEST_SLUG]: { vendorA: false } };
const UPDATED_FILTER = { [TEST_SLUG]: { vendorA: true } };

test.describe("STAK-517 — Market filter cache invalidation after vault restore", () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      if (typeof window.__orig_invalidateMarketFilterCache === "function") {
        window._invalidateMarketFilterCache = window.__orig_invalidateMarketFilterCache;
        delete window.__orig_invalidateMarketFilterCache;
      }
    });
  });

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
    // Wait for retail.js to finish loading and expose its window functions.
    await page.waitForFunction(
      () =>
        typeof window._loadMarketFilter === "function" &&
        typeof window._invalidateMarketFilterCache === "function"
    );
  });

  test("_invalidateMarketFilterCache is called and cache reflects new value after vault restore writes new market filter", async ({
    page,
  }) => {
    // Step 1: Prime the in-memory cache by calling _loadMarketFilter().
    // After this call, _marketFilterCache holds INITIAL_FILTER (vendorA: false).
    const cachedBefore = await page.evaluate((slug) => {
      const filter = window._loadMarketFilter();
      if (filter == null) return null;
      return Object.prototype.hasOwnProperty.call(filter, slug) ? filter[slug] : undefined;
    }, TEST_SLUG);
    // The "ase" entry must exist with vendorA: false
    expect(cachedBefore).not.toBeNull();
    expect(cachedBefore).not.toBeUndefined();
    expect(cachedBefore).toEqual({ vendorA: false });

    // Step 2: Install a spy on _invalidateMarketFilterCache BEFORE the restore.
    // Store the original on window so afterEach can restore it and prevent
    // test pollution.
    await page.evaluate(() => {
      window.__spy_invalidate_called = false;
      window.__orig_invalidateMarketFilterCache = window._invalidateMarketFilterCache;
      window._invalidateMarketFilterCache = function () {
        window.__spy_invalidate_called = true;
        if (typeof window.__orig_invalidateMarketFilterCache === "function") {
          window.__orig_invalidateMarketFilterCache();
        }
      };
    });

    // Step 3: Simulate what restoreVaultData does — write the new market filter
    // value directly to localStorage (restoreVaultData is not exposed on window).
    // Task 2 will make restoreVaultData call _invalidateMarketFilterCache after
    // this write; until then the spy will NOT be triggered.
    await page.evaluate(
      ({ key, value }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      { key: MARKET_FILTER_KEY, value: UPDATED_FILTER }
    );

    // Step 4: Assert the spy was called at least once.
    // FAILS before Task 2 — nothing invokes _invalidateMarketFilterCache after
    // a raw localStorage write.
    const spyCalled = await page.evaluate(() => window.__spy_invalidate_called);
    expect(spyCalled).toBe(true);

    // Step 5: Assert that _loadMarketFilter() now returns the UPDATED value.
    // FAILS before Task 2 — the stale cache still holds INITIAL_FILTER.
    const cachedAfterEntry = await page.evaluate((slug) => {
      const filter = window._loadMarketFilter();
      if (filter == null) return null;
      return Object.prototype.hasOwnProperty.call(filter, slug) ? filter[slug] : undefined;
    }, TEST_SLUG);
    expect(cachedAfterEntry).not.toBeNull();
    expect(cachedAfterEntry).not.toBeUndefined();
    expect(cachedAfterEntry).toEqual({ vendorA: true });
  });
});

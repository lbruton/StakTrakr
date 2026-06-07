import { test, expect } from "../helpers/mocks/extended-test.js";

// STRK-162 — userImages storage-usage cache (O(1) pre-flight).
// The pre-flight quota guard in `cacheUserImageResult` must stop re-scanning the
// whole `userImages` store on every save. A nullable byte total is cached on the
// ImageCache singleton: lazily computed on first need, incremented by the signed
// delta on a successful save, and invalidated (null → recompute) on
// deleteUserImage / clearAll / importUserImageRecord.
//
// Tests drive `window.imageCache` directly and observe scans via a counter that
// wraps `_userImagesBytes` (the single scan seam — see approach D-6). `_quotaBytes`
// is pinned per-test for deterministic pressure behavior, matching strk-146.

const QUOTA_HUGE = 100_000_000; // ample headroom; saves never blocked unless a test wants it

async function bootImageCache(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.imageCache && typeof window.imageCache.init === "function"
  );
  // Init once, settle the async quota estimate so it can't overwrite a test's
  // `_quotaBytes`, then start from an empty store.
  await page.evaluate(async () => {
    await window.imageCache.init();
    if (typeof window.imageCache._initQuota === "function") {
      await window.imageCache._initQuota();
    }
    if (typeof window.imageCache.clearAll === "function") {
      await window.imageCache.clearAll();
    }
  });
}

/**
 * Install (idempotently) a counter that increments every time the underlying
 * `_userImagesBytes` store scan actually runs, and reset it to 0. The cached
 * accessor delegates to `_userImagesBytes` only on a cold read, so this counter
 * measures real scans — the observable behavior AC-1/AC-2 assert on.
 */
async function installScanCounter(page) {
  await page.evaluate(() => {
    const ic = window.imageCache;
    if (!ic.__origUserImagesBytes) {
      ic.__origUserImagesBytes = ic._userImagesBytes.bind(ic);
      ic._userImagesBytes = async function countingUserImagesBytes() {
        window.__userImagesScanCount = (window.__userImagesScanCount || 0) + 1;
        return ic.__origUserImagesBytes();
      };
    }
    window.__userImagesScanCount = 0;
  });
}

/** Read the current scan count. */
async function scanCount(page) {
  return page.evaluate(() => window.__userImagesScanCount || 0);
}

/** Reset the scan counter to 0 (e.g. after a warm-up save). */
async function resetScanCount(page) {
  await page.evaluate(() => {
    window.__userImagesScanCount = 0;
  });
}

/**
 * Seed one userImages record of an exact obverse byte size via the public API.
 * Returns the boolean save result so callers can assert it landed.
 */
async function seedUserImage(page, uuid, bytes) {
  return page.evaluate(
    async ({ uuid, bytes }) => {
      const blob = new Blob([new Uint8Array(bytes)]);
      return window.imageCache.cacheUserImage(uuid, blob);
    },
    { uuid, bytes }
  );
}

test.describe("core/strk-162-image-usage-cache", () => {
  test.beforeEach(async ({ page }) => {
    await bootImageCache(page);
    await installScanCounter(page);
  });

  // Cohort B (RED) fills these: AC-1 warm-skip, AC-2 lazy-once, AC-3 signed-delta
  // increment (incl. shrink), AC-4 no-delta-on-non-write, AC-5 invalidation
  // (delete-then-save / clearAll / import), AC-6 STRK-146 regression contract.
  test.fixme("STRK-162 coherency assertions — added in Cohort B", () => {
    expect(true).toBe(true);
  });
});

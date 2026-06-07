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

test.describe("core/strk-162-image-usage-cache", () => {
  test.beforeEach(async ({ page }) => {
    await bootImageCache(page);
    await installScanCounter(page);
  });

  // AC-1 — WHILE the cache is warm, the pre-flight performs NO userImages scan.
  test("AC-1: a warm cache serves the pre-flight without re-scanning userImages", async ({
    page,
  }) => {
    // Warm-up save (cold → 1 scan); a subsequent save must perform zero scans.
    await page.evaluate(async (q) => {
      window.imageCache._quotaBytes = q;
      await window.imageCache.cacheUserImageResult("ac1-warmup", new Blob([new Uint8Array(1000)]));
    }, QUOTA_HUGE);
    await resetScanCount(page);
    await page.evaluate(async () => {
      await window.imageCache.cacheUserImageResult("ac1-second", new Blob([new Uint8Array(2000)]));
    });
    expect(await scanCount(page)).toBe(0);
  });

  // AC-2 — the total is computed once and retained: two cold-start saves scan once.
  test("AC-2: usage is computed once and retained across needs", async ({ page }) => {
    await resetScanCount(page);
    await page.evaluate(async (q) => {
      window.imageCache._quotaBytes = q;
      await window.imageCache.cacheUserImageResult("ac2-a", new Blob([new Uint8Array(1000)]));
      await window.imageCache.cacheUserImageResult("ac2-b", new Blob([new Uint8Array(1000)]));
    }, QUOTA_HUGE);
    expect(await scanCount(page)).toBe(1);
  });

  // AC-3 — WHEN a save succeeds, the cached total moves by the signed delta
  // (positive for new/grown, negative for a shrinking in-place replace).
  test("AC-3: the cached total tracks the signed delta, including a shrinking replace", async ({
    page,
  }) => {
    const out = await page.evaluate(async (q) => {
      const ic = window.imageCache;
      ic._quotaBytes = q;
      await ic.cacheUserImageResult("ac3-a", new Blob([new Uint8Array(1000)]));
      const afterA = ic._userImagesBytesCache;
      await ic.cacheUserImageResult("ac3-b", new Blob([new Uint8Array(2000)]));
      const afterB = ic._userImagesBytesCache;
      // Replace ac3-a with a smaller blob: delta = 500 - 1000 = -500.
      await ic.cacheUserImageResult("ac3-a", new Blob([new Uint8Array(500)]));
      const afterShrink = ic._userImagesBytesCache;
      return { afterA, afterB, afterShrink };
    }, QUOTA_HUGE);
    expect(out.afterA).toBe(1000);
    expect(out.afterB).toBe(3000);
    expect(out.afterShrink).toBe(2500);
  });

  // AC-4 — IF a save does not write (pre-flight block or _put failure), THEN the
  // cached total does not move by delta. Per review: assert "no delta applied",
  // NOT "field stayed null" (a cold→warm scan is allowed). Here the cache is warm,
  // so the exact pre-call value must be preserved.
  test("AC-4: a blocked write and a failed _put leave the cached total unmoved", async ({
    page,
  }) => {
    const out = await page.evaluate(async (q) => {
      const ic = window.imageCache;
      ic._quotaBytes = q;
      await ic.cacheUserImageResult("ac4-base", new Blob([new Uint8Array(1000)]));
      const base = ic._userImagesBytesCache; // warm = 1000

      // (1) Pre-flight block: tiny quota, oversized save.
      ic._quotaBytes = 1000;
      const blocked = await ic.cacheUserImageResult("ac4-big", new Blob([new Uint8Array(50000)]));
      const afterBlock = ic._userImagesBytesCache;

      // (2) _put failure: restore quota, stub _put to fail, then a fitting save.
      ic._quotaBytes = q;
      const origPut = ic._put.bind(ic);
      ic._put = async () => false;
      const failed = await ic.cacheUserImageResult("ac4-putfail", new Blob([new Uint8Array(2000)]));
      const afterFail = ic._userImagesBytesCache;
      ic._put = origPut;

      return {
        base,
        blockedQuota: blocked.quotaExceeded,
        afterBlock,
        failOk: failed.ok,
        afterFail,
      };
    }, QUOTA_HUGE);
    expect(out.base).toBe(1000);
    expect(out.blockedQuota).toBe(true);
    expect(out.afterBlock).toBe(1000); // unchanged by the blocked write
    expect(out.failOk).toBe(false);
    expect(out.afterFail).toBe(1000); // unchanged by the failed put (no delta applied)
  });

  // AC-5 — WHEN deleteUserImage / clearAll / importUserImageRecord mutate the
  // store, the next read recomputes from a fresh scan (load-bearing: delete-then-save).
  test("AC-5: delete / clearAll / import invalidate the cache so the next read recomputes", async ({
    page,
  }) => {
    const out = await page.evaluate(async (q) => {
      const ic = window.imageCache;
      ic._quotaBytes = q;

      // delete-then-save
      await ic.cacheUserImageResult("ac5-a", new Blob([new Uint8Array(1000)]));
      await ic.cacheUserImageResult("ac5-b", new Blob([new Uint8Array(2000)])); // warm = 3000
      await ic.deleteUserImage("ac5-a"); // invalidate
      await ic.cacheUserImageResult("ac5-c", new Blob([new Uint8Array(500)])); // recompute: 2000 + 500
      const afterDeleteSave = ic._userImagesBytesCache;

      // clearAll-then-save
      await ic.clearAll(); // invalidate
      await ic.cacheUserImageResult("ac5-d", new Blob([new Uint8Array(700)])); // recompute from empty: 700
      const afterClearSave = ic._userImagesBytesCache;

      // import-then-save
      await ic.clearAll();
      await ic.cacheUserImageResult("ac5-e", new Blob([new Uint8Array(400)])); // warm = 400
      await ic.importUserImageRecord({
        uuid: "ac5-imp",
        obverse: new Blob([new Uint8Array(600)]),
        reverse: null,
        size: 600,
        cachedAt: 1,
      }); // invalidate
      await ic.cacheUserImageResult("ac5-f", new Blob([new Uint8Array(100)])); // recompute: 400 + 600 + 100
      const afterImportSave = ic._userImagesBytesCache;

      return { afterDeleteSave, afterClearSave, afterImportSave };
    }, QUOTA_HUGE);
    expect(out.afterDeleteSave).toBe(2500); // ac5-a's 1000 excluded
    expect(out.afterClearSave).toBe(700); // store emptied, then 700
    expect(out.afterImportSave).toBe(1100); // 400 + 600 (imported) + 100
  });

  // AC-6 — no STRK-146 regression. This is a GREEN-throughout guard (not a RED
  // test): it protects the quota contract while C.2 adds the increment/invalidate.
  test("AC-6: STRK-146 quota contract intact (block report + warn toast)", async ({ page }) => {
    const out = await page.evaluate(async () => {
      const ic = window.imageCache;
      ic._quotaBytes = 1000;
      const res = await ic.cacheUserImageResult("ac6-block", new Blob([new Uint8Array(50000)]));
      return {
        ok: res.ok,
        quotaExceeded: res.quotaExceeded,
        usageBytes: res.usageBytes,
        limitBytes: res.limitBytes,
      };
    });
    expect(out.ok).toBe(false);
    expect(out.quotaExceeded).toBe(true);
    expect(out.limitBytes).toBe(1000);
    expect(typeof out.usageBytes).toBe("number");

    // An accepted near-quota save still fires the pressure-band toast.
    await page.evaluate(async () => {
      const ic = window.imageCache;
      ic._quotaBytes = 1_000_000;
      ic._lastWarnedLevel = "ok";
      await ic.cacheUserImageWithFeedback("ac6-warn", new Blob([new Uint8Array(900000)]));
    });
    await expect(page.locator(".cloud-toast")).toContainText("full");
  });
});

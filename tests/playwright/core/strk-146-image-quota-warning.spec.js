import { test, expect } from "../helpers/mocks/extended-test.js";

// STRK-146 — Image storage near quota: writes must fail loudly, not silently.
// The fix makes `_quotaBytes` a real pre-flight soft-cap guard and surfaces
// warning/error toasts. Tests drive `window.imageCache` directly and control
// `_quotaBytes` for deterministic near-quota behavior (issue AC3).

const QUOTA_TINY = 1000; // bytes — below any real image
const QUOTA_1MB = 1_000_000;
const QUOTA_HUGE = 100_000_000;

async function bootImageCache(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.imageCache && typeof window.imageCache.init === "function"
  );
  // Init once, then settle the async quota estimate so it cannot overwrite the
  // `_quotaBytes` value a test sets later (init() won't re-run _initQuota).
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

test.describe("core/strk-146-image-quota-warning", () => {
  test.beforeEach(async ({ page }) => {
    await bootImageCache(page);
  });

  test("cacheUserImageResult refuses the write and reports quotaExceeded when over the soft cap (REQ-4)", async ({
    page,
  }) => {
    const out = await page.evaluate(async (quota) => {
      const uuid = "strk146-preflight";
      window.imageCache._quotaBytes = quota;
      const blob = new Blob([new Uint8Array(50000)]); // 50 KB >> 1 KB cap
      const res = await window.imageCache.cacheUserImageResult(uuid, blob);
      const stored = await window.imageCache.getUserImage(uuid);
      return { ok: res.ok, quotaExceeded: res.quotaExceeded, stored: !!stored };
    }, QUOTA_TINY);

    expect(out.ok).toBe(false);
    expect(out.quotaExceeded).toBe(true);
    expect(out.stored).toBe(false); // doomed write was never attempted
  });

  test("cacheUserImageWithFeedback shows an explicit error toast on quota failure (REQ-3)", async ({
    page,
  }) => {
    const ok = await page.evaluate(async (quota) => {
      window.imageCache._quotaBytes = quota;
      window.imageCache._lastWarnedLevel = "ok";
      const blob = new Blob([new Uint8Array(50000)]);
      return window.imageCache.cacheUserImageWithFeedback("strk146-err", blob);
    }, QUOTA_TINY);

    expect(ok).toBe(false);
    await expect(page.locator(".cloud-toast")).toContainText("Storage full");
  });

  test("warns when an accepted save crosses the 85% pressure band (REQ-1)", async ({ page }) => {
    const out = await page.evaluate(async (quota) => {
      window.imageCache._quotaBytes = quota; // 1 MB
      window.imageCache._lastWarnedLevel = "ok";
      const blob = new Blob([new Uint8Array(900000)]); // 90% of 1 MB — fits
      const ok = await window.imageCache.cacheUserImageWithFeedback("strk146-warn", blob);
      const stored = await window.imageCache.getUserImage("strk146-warn");
      return { ok, stored: !!stored };
    }, QUOTA_1MB);

    expect(out.ok).toBe(true);
    expect(out.stored).toBe(true); // accepted save
    await expect(page.locator(".cloud-toast")).toContainText("full");
  });

  test("ample quota: save succeeds with no toast and a usable image URL (NFR-2 regression)", async ({
    page,
  }) => {
    const out = await page.evaluate(async (quota) => {
      window.imageCache._quotaBytes = quota; // 100 MB
      window.imageCache._lastWarnedLevel = "ok";
      const blob = new Blob([new Uint8Array(50000)]);
      const ok = await window.imageCache.cacheUserImageWithFeedback("strk146-ok", blob);
      const url = await window.imageCache.getUserImageUrl("strk146-ok");
      // legacy boolean API must still work
      const legacy = await window.imageCache.cacheUserImage(
        "strk146-ok-legacy",
        new Blob([new Uint8Array(40000)])
      );
      return { ok, urlIsBlob: typeof url === "string" && url.startsWith("blob:"), legacy };
    }, QUOTA_HUGE);

    expect(out.ok).toBe(true);
    expect(out.urlIsBlob).toBe(true);
    expect(out.legacy).toBe(true);
    await expect(page.locator(".cloud-toast")).toHaveCount(0);
  });

  test("does not re-warn while staying in the same pressure band (REQ-2)", async ({ page }) => {
    await page.evaluate(async (quota) => {
      window.imageCache._quotaBytes = quota; // 1 MB
      window.imageCache._lastWarnedLevel = "ok";
      // First save → 88% (warn band): one warning toast.
      await window.imageCache.cacheUserImageWithFeedback(
        "strk146-spamA",
        new Blob([new Uint8Array(880000)])
      );
      // Second tiny save → still warn band (no escalation): no new toast.
      await window.imageCache.cacheUserImageWithFeedback(
        "strk146-spamB",
        new Blob([new Uint8Array(10000)])
      );
    }, QUOTA_1MB);

    await expect(page.locator(".cloud-toast")).toHaveCount(1);
  });

  test("escalates the warning when usage crosses from the warn band into the critical band (REQ-1)", async ({
    page,
  }) => {
    await page.evaluate(async (quota) => {
      window.imageCache._quotaBytes = quota; // 1 MB
      window.imageCache._lastWarnedLevel = "ok";
      // First save → 88% (warn band): one warning toast.
      await window.imageCache.cacheUserImageWithFeedback(
        "strk146-escA",
        new Blob([new Uint8Array(880000)])
      );
      // Second save → 98% (critical band): escalation fires a second toast.
      await window.imageCache.cacheUserImageWithFeedback(
        "strk146-escB",
        new Blob([new Uint8Array(100000)])
      );
    }, QUOTA_1MB);

    await expect(page.locator(".cloud-toast")).toHaveCount(2);
    await expect(page.locator(".cloud-toast").last()).toContainText("saves may start failing");
  });
});

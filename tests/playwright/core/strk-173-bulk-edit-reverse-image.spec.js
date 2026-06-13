// STRK-173 — `_loadBulkRowImages` must not throw on an undeclared `resolved`.
//
// Regression guard for a pre-existing latent bug in the bulk-edit row image
// loader (js/bulkEdit.js). The reverse-side render gate referenced an
// **undeclared** `resolved` binding:
//
//   if (showRev && (revUrl || (resolved && resolved.source === "user"))) { ... }
//
// In a classic (non-module) script, reading an undeclared binding throws a
// ReferenceError (it does not yield `undefined`). Short-circuit evaluation hides
// it until `revUrl` is falsy — i.e. reverse images are displayed (tableImageSides
// = "both" or "reverse") AND the item has no resolvable reverse image. The loader
// runs un-awaited per row, so the throw surfaced as an unhandled promise
// rejection that silently broke that row's reverse slot.
//
// The bug lives PAST the `imageCache.isAvailable()` guard, so it only reproduces
// on the IndexedDB path — the file:// fallback returns before the buggy line.
// The test therefore forces `imageCache.init()` before opening the modal.

import { test, expect } from "../helpers/mocks/extended-test.js";

// 1x1 transparent PNG — gives the obverse side a real <img> without a network
// round-trip, so the only placeholder left in the cell is the reverse slot.
const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const OBVERSE_ONLY_ITEM = {
  uuid: "strk-173-no-reverse",
  metal: "Silver",
  composition: "Silver",
  name: "STRK-173 Obverse Only",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 30,
  marketValue: 0,
  date: "2026-01-01",
  purchaseLocation: "staktrakr.com",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2026",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 0,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: "",
  serial: 1,
  obverseImageUrl: TRANSPARENT_PNG, // resolves -> obverse <img>
  reverseImageUrl: "", // no reverse -> revUrl falsy -> hits the buggy gate
  ignorePatternImages: true, // skip pattern lookup -> deterministic null reverse
};

test.describe("STRK-173 — bulk-edit reverse image render", () => {
  test("reverse display + item with no reverse image renders a placeholder without throwing", async ({
    page,
  }) => {
    // The loader is async and fired un-awaited, so its throw surfaces as an
    // unhandled rejection rather than a page error — capture both.
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    await page.addInitScript(() => {
      window.__bulkImgErrors = [];
      window.addEventListener("unhandledrejection", (e) =>
        window.__bulkImgErrors.push(String(e.reason))
      );
      window.addEventListener("error", (e) =>
        window.__bulkImgErrors.push(String(e.error || e.message))
      );
    });

    // Seed: reverse images ON ("both") + one obverse-only item.
    await page.addInitScript((item) => {
      localStorage.setItem("metalInventory", JSON.stringify([item]));
      localStorage.setItem("tableImageSides", "both");
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (typeof APP_VERSION !== "undefined") {
            localStorage.setItem("ackVersion", APP_VERSION);
          }
        },
        { once: true }
      );
    }, OBVERSE_ONLY_ITEM);

    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#newItemBtn", { state: "visible" });
    await page.waitForFunction(
      () => typeof window.openBulkEdit === "function" && Array.isArray(window.inventory)
    );

    // Force the IndexedDB path (the bug lives past `imageCache.isAvailable()`).
    await page.waitForFunction(
      () => window.imageCache && typeof window.imageCache.init === "function"
    );
    await page.evaluate(async () => {
      await window.imageCache.init();
    });
    await page.waitForFunction(() => window.imageCache.isAvailable() === true);

    await page.evaluate(() => window.openBulkEdit());
    await expect(page.locator("#bulkEditModal")).toBeVisible({ timeout: 10000 });

    const cell = page.locator(
      '#bulkEditModal .bulk-edit-table tbody tr[data-serial="1"] .bulk-img-cell'
    );
    // Obverse <img> proves the loader reached the obverse/reverse gate.
    await expect(cell.locator('img[data-side="obverse"]')).toBeAttached({ timeout: 10000 });

    // The reverse slot must render as a placeholder. On the pre-fix code the
    // loader throws on `resolved` before appending it, so it never appears.
    await expect(cell.locator(".bulk-img-placeholder")).toHaveCount(1, { timeout: 10000 });

    // And no ReferenceError on `resolved` should have surfaced from the loader.
    const resolvedErrors = [
      ...pageErrors,
      ...(await page.evaluate(() => window.__bulkImgErrors || [])),
    ].filter((m) => /resolved/.test(m) && /not defined|ReferenceError/.test(m));
    expect(
      resolvedErrors,
      `unexpected ReferenceError(s) from _loadBulkRowImages: ${resolvedErrors.join(" | ")}`
    ).toEqual([]);
  });
});

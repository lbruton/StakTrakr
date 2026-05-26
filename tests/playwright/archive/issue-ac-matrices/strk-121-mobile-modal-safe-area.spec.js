import { test, expect } from "../../helpers/mocks/extended-test.js";

/**
 * Playwright regression suite for STAK-578 — Mobile modal safe-area insets.
 *
 * Implementation is complete and all 8 tests run GREEN. This suite acts as a
 * regression guard: it will catch any future edit to index.html or
 * css/styles.css that removes an env(safe-area-inset-*) rule or the
 * viewport-fit=cover meta tag introduced by STAK-578.
 *
 * Why styleSheets-traversal instead of getComputedStyle():
 *   Playwright's emulated viewport does not supply OS-level safe-area
 *   values, so env(safe-area-inset-*) resolves to 0 even with
 *   viewport-fit=cover. getComputedStyle() returns the resolved pixel
 *   value (effectively the static fallback), which would not differ from
 *   today's production CSS and would not catch a future regression that
 *   deletes the env() argument. Reading the rule TEXT catches the
 *   regression deterministically.
 *
 * Acceptance criteria mapping:
 *   Test 1  (.view-modal-footer env-bottom)                  -> R1.5
 *   Test 1b (.view-modal-footer env-left/right)              -> R1.4
 *   Test 2  (#inventoryForm .item-modal-actions env-bottom)  -> R2.5
 *   Test 2b (#inventoryForm .item-modal-actions env-left/right) -> R2.4
 *   Test 3a (#itemModal mobile header env-top)               -> R3.3 + R5.2
 *   Test 3b (#viewItemModal mobile header env-top)           -> R3.3 + R5.2
 *   Test 3c (#viewItemModal modal-content 100dvh)            -> Phase 5.2
 *           (Android Chrome resolves env(safe-area-inset-bottom) to 0;
 *            only 100dvh keeps the modal clear of the gesture bar.)
 *   Test 4  (viewport-fit=cover meta)                        -> R4.1
 */

// ---------------------------------------------------------------------------
// Per-spec viewport override (iPhone 13/14 portrait).
// playwright.config.js registers only Desktop Chrome — override here.
// ---------------------------------------------------------------------------
test.use({ viewport: { width: 390, height: 844 } });

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const BASE_ITEM = {
  uuid: "stak578-safe-area-item",
  metal: "Silver",
  composition: "Silver",
  name: "STAK-578 Safe Area Fixture",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 35,
  marketValue: 0,
  date: "2026-04-25",
  purchaseLocation: "StakTrakr",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2024",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 32,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: "",
  serial: 1,
};

// ---------------------------------------------------------------------------
// Setup helpers (mirrors existing specs — view-modal-no-auto-resync.spec.js,
// modal-layout.spec.js)
// ---------------------------------------------------------------------------

async function seedInventory(page, items) {
  await page.addInitScript((inventory) => {
    localStorage.setItem("metalInventory", JSON.stringify(inventory));
    localStorage.setItem("itemTags", JSON.stringify({}));

    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") {
          localStorage.setItem("ackVersion", APP_VERSION);
        }
      },
      { once: true }
    );
  }, items);
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.showViewModal === "function" &&
      typeof window.editItem === "function" &&
      Array.isArray(window.inventory) &&
      window.inventory.length > 0
  );
}

async function openViewModal(page, index = 0) {
  await page.evaluate((idx) => window.showViewModal(idx), index);
  await expect(page.locator("#viewItemModal")).toBeVisible();
}

async function openEditModal(page, index = 0) {
  await page.evaluate((idx) => window.editItem(idx), index);
  await expect(page.locator("#itemModal")).toBeVisible();
}

// ---------------------------------------------------------------------------
// Stylesheet traversal — runs in the page context.
//
// All helpers below are passed to page.evaluate() and execute in the browser.
// Each iterates document.styleSheets, swallowing cross-origin access errors,
// and returns either a matched cssText string or null. Tests then assert
// "not null" before substring-matching, so a missing rule produces a clear
// "rule must exist" failure rather than a vague "cannot read property of
// undefined" error.
// ---------------------------------------------------------------------------

/** Find the first CSSStyleRule whose selectorText exactly matches `selector`. */
async function findRuleCssText(page, selector) {
  return page.evaluate((sel) => {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch (_e) {
        continue; // cross-origin or otherwise inaccessible
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSStyleRule)) continue;
        if (rule.selectorText === sel) {
          return rule.cssText;
        }
      }
    }
    return null;
  }, selector);
}

/**
 * Find rules inside `@media (max-width: 768px)` whose selector includes the
 * given target substring AND declare `padding-top` containing `env(`.
 *
 * Per-modal isolation matters: a loose "any rule that mentions the selector"
 * concatenation lets the existing border-radius rule mask whether the new
 * env() padding-top actually targets the right modal. Tests must assert the
 * env() declaration on the rule that actually applies it.
 *
 * Returns the matched rule's cssText, or null if no rule satisfies both the
 * selector match and the `padding-top: ...env(...)` declaration.
 */
async function findMobileHeaderEnvRule(page, targetSelectorSubstring) {
  return page.evaluate((target) => {
    for (const sheet of Array.from(document.styleSheets)) {
      let topRules;
      try {
        topRules = sheet.cssRules;
      } catch (_e) {
        continue;
      }
      if (!topRules) continue;
      for (const rule of Array.from(topRules)) {
        if (!(rule instanceof CSSMediaRule)) continue;
        const mediaText = (rule.media && rule.media.mediaText) || rule.conditionText || "";
        if (!mediaText.includes("max-width: 768px")) continue;
        const innerRules = rule.cssRules;
        if (!innerRules) continue;
        for (const inner of Array.from(innerRules)) {
          if (!(inner instanceof CSSStyleRule)) continue;
          const sel = inner.selectorText || "";
          if (!sel.includes(target)) continue;
          const padTop = inner.style.getPropertyValue("padding-top") || "";
          if (padTop.includes("env(safe-area-inset-top")) {
            return inner.cssText;
          }
        }
      }
    }
    return null;
  }, targetSelectorSubstring);
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe("mobile-modal-safe-area — STAK-578", () => {
  // ========================================================================
  // Test 1 — .view-modal-footer uses env(safe-area-inset-bottom)
  // Maps to R1.5 (no-regression guard for R1.1–R1.4 on real devices)
  // ========================================================================
  test("view-modal-footer-uses-env-safe-area-inset-bottom", async ({ page }) => {
    await seedInventory(page, [BASE_ITEM]);
    await gotoApp(page);
    await openViewModal(page);

    const cssText = await findRuleCssText(page, ".view-modal-footer");

    expect(
      cssText,
      "CSSStyleRule with selector '.view-modal-footer' must be present in document.styleSheets"
    ).not.toBeNull();
    expect(
      cssText,
      "'.view-modal-footer' rule cssText must contain 'max(' for safe-area fallback"
    ).toContain("max(");
    expect(
      cssText,
      "'.view-modal-footer' rule cssText must contain 'env(safe-area-inset-bottom'"
    ).toContain("env(safe-area-inset-bottom");
  });

  // ========================================================================
  // Test 1b — .view-modal-footer uses env(safe-area-inset-left|right)
  // Maps to R1.4 (landscape side-notch clearance — iOS Safari)
  // ========================================================================
  test("view-modal-footer-uses-env-safe-area-inset-left-right", async ({ page }) => {
    await seedInventory(page, [BASE_ITEM]);
    await gotoApp(page);
    await openViewModal(page);

    const cssText = await findRuleCssText(page, ".view-modal-footer");

    expect(
      cssText,
      "'.view-modal-footer' rule must reference 'env(safe-area-inset-left' for landscape notch clearance"
    ).toContain("env(safe-area-inset-left");
    expect(
      cssText,
      "'.view-modal-footer' rule must reference 'env(safe-area-inset-right' for landscape notch clearance"
    ).toContain("env(safe-area-inset-right");
  });

  // ========================================================================
  // Test 2 — #inventoryForm .item-modal-actions uses env(safe-area-inset-bottom)
  // Maps to R2.5 (no-regression guard for R2.1–R2.4 on real devices)
  // ========================================================================
  test("item-modal-actions-uses-env-safe-area-inset-bottom", async ({ page }) => {
    await seedInventory(page, [BASE_ITEM]);
    await gotoApp(page);
    await openEditModal(page);

    const cssText = await findRuleCssText(page, "#inventoryForm .item-modal-actions");

    expect(
      cssText,
      "CSSStyleRule with selector '#inventoryForm .item-modal-actions' must be present in document.styleSheets"
    ).not.toBeNull();
    expect(
      cssText,
      "'#inventoryForm .item-modal-actions' rule cssText must contain 'max(' for safe-area fallback"
    ).toContain("max(");
    expect(
      cssText,
      "'#inventoryForm .item-modal-actions' rule cssText must contain 'env(safe-area-inset-bottom'"
    ).toContain("env(safe-area-inset-bottom");
  });

  // ========================================================================
  // Test 2b — #inventoryForm .item-modal-actions uses env(safe-area-inset-left|right)
  // Maps to R2.4 (landscape side-notch clearance — iOS Safari)
  // ========================================================================
  test("item-modal-actions-uses-env-safe-area-inset-left-right", async ({ page }) => {
    await seedInventory(page, [BASE_ITEM]);
    await gotoApp(page);
    await openEditModal(page);

    const cssText = await findRuleCssText(page, "#inventoryForm .item-modal-actions");

    expect(
      cssText,
      "'#inventoryForm .item-modal-actions' rule must reference 'env(safe-area-inset-left' for landscape notch clearance"
    ).toContain("env(safe-area-inset-left");
    expect(
      cssText,
      "'#inventoryForm .item-modal-actions' rule must reference 'env(safe-area-inset-right' for landscape notch clearance"
    ).toContain("env(safe-area-inset-right");
  });

  // ========================================================================
  // Test 3a — #itemModal mobile header uses env(safe-area-inset-top)
  //           with var(--spacing) static fallback
  // Maps to R3.3 (per-modal regression guard) + R5.2 (no regression on
  // non-notched devices: existing #itemModal desktop padding-top is
  // var(--spacing), so the fallback must match exactly)
  // ========================================================================
  test("itemModal-mobile-header-uses-env-safe-area-inset-top", async ({ page }) => {
    await seedInventory(page, [BASE_ITEM]);
    await gotoApp(page);

    const cssText = await findMobileHeaderEnvRule(page, "#itemModal .modal-content .modal-header");

    expect(
      cssText,
      "Inside @media (max-width: 768px), a CSSStyleRule targeting '#itemModal .modal-content .modal-header' must declare padding-top with env(safe-area-inset-top"
    ).not.toBeNull();
    expect(
      cssText,
      "#itemModal mobile header rule must use 'var(--spacing)' as the static fallback so non-notched devices match existing rendering"
    ).toContain("var(--spacing)");
    expect(
      cssText,
      "#itemModal mobile header rule must reference 'env(safe-area-inset-top'"
    ).toContain("env(safe-area-inset-top");
  });

  // ========================================================================
  // Test 3b — #viewItemModal mobile header uses env(safe-area-inset-top)
  //           with var(--spacing-sm) static fallback
  // Maps to R3.3 (per-modal regression guard) + R5.2 (no regression on
  // non-notched devices: existing #viewItemModal mobile rule already sets
  // padding-top to var(--spacing-sm), so the fallback must match it — using
  // var(--spacing) here would visibly increase header padding-top on every
  // non-notched mobile device)
  // ========================================================================
  test("viewItemModal-mobile-header-uses-env-safe-area-inset-top", async ({ page }) => {
    await seedInventory(page, [BASE_ITEM]);
    await gotoApp(page);

    const cssText = await findMobileHeaderEnvRule(page, "#viewItemModal .modal-header");

    expect(
      cssText,
      "Inside @media (max-width: 768px), a CSSStyleRule targeting '#viewItemModal .modal-header' must declare padding-top with env(safe-area-inset-top"
    ).not.toBeNull();
    expect(
      cssText,
      "#viewItemModal mobile header rule must use 'var(--spacing-sm)' as the static fallback so non-notched devices keep the existing 0.4rem padding-top (R5.2)"
    ).toContain("var(--spacing-sm)");
    expect(
      cssText,
      "#viewItemModal mobile header rule must reference 'env(safe-area-inset-top'"
    ).toContain("env(safe-area-inset-top");
  });

  // ========================================================================
  // Test 3c — #viewItemModal .modal-content mobile rule uses 100dvh
  // Phase 5.2 QA finding: on Android Chrome, env(safe-area-inset-bottom)
  // resolves to 0 even with viewport-fit=cover. The compound selector at
  // css/styles.css line 12462 covers #itemModal, but #viewItemModal is
  // governed by its more-specific rule earlier in the file. Without an
  // explicit 100dvh override there, the View modal stays sized to the
  // LARGE viewport (under the gesture bar) on Android, clipping the
  // sticky footer buttons. Only the 100vh + 100dvh fallback pair keeps
  // the modal exactly inside the visible viewport.
  // ========================================================================
  test("viewItemModal-modal-content-mobile-uses-100dvh", async ({ page }) => {
    await seedInventory(page, [BASE_ITEM]);
    await gotoApp(page);

    const cssText = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        let topRules;
        try {
          topRules = sheet.cssRules;
        } catch (_e) {
          continue;
        }
        if (!topRules) continue;
        for (const rule of Array.from(topRules)) {
          if (!(rule instanceof CSSMediaRule)) continue;
          const mediaText = (rule.media && rule.media.mediaText) || rule.conditionText || "";
          if (!mediaText.includes("max-width: 768px")) continue;
          const innerRules = rule.cssRules;
          if (!innerRules) continue;
          for (const inner of Array.from(innerRules)) {
            if (!(inner instanceof CSSStyleRule)) continue;
            const sel = inner.selectorText || "";
            if (sel === "#viewItemModal .modal-content") {
              return inner.cssText;
            }
          }
        }
      }
      return null;
    });

    expect(
      cssText,
      "Inside @media (max-width: 768px), a CSSStyleRule for '#viewItemModal .modal-content' must exist"
    ).not.toBeNull();
    expect(
      cssText,
      "'#viewItemModal .modal-content' mobile rule must declare height: 100dvh (Android Chrome gesture-bar clearance)"
    ).toContain("100dvh");
  });

  // ========================================================================
  // Test 4 — viewport meta declares viewport-fit=cover
  // Maps to R4.1 (gate that lets env() resolve non-zero on iOS)
  // ========================================================================
  test("viewport-meta-includes-viewport-fit-cover", async ({ page }) => {
    await seedInventory(page, [BASE_ITEM]);
    await gotoApp(page);

    const viewportContent = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="viewport"]');
      return meta ? meta.content : null;
    });

    expect(viewportContent, '<meta name="viewport"> tag must exist in index.html').not.toBeNull();
    expect(
      viewportContent,
      "viewport meta content must include 'viewport-fit=cover' to enable iOS safe-area-inset resolution"
    ).toContain("viewport-fit=cover");
  });
});

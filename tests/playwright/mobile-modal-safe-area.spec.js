import { test, expect } from "@playwright/test";

/**
 * Playwright TDD spec for STAK-578 — Mobile modal safe-area insets.
 *
 * RED PHASE: These four tests MUST fail before any Phase 1+ implementation
 * lands. They become green once index.html and css/styles.css are patched
 * per spec STAK-578-mobile-modal-safe-area/design.md.
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
 *   Test 1 (.view-modal-footer)              -> R1.5 (regression guard for R1)
 *   Test 2 (#inventoryForm .item-modal-actions) -> R2.5 (regression guard for R2)
 *   Test 3 (mobile fullscreen header)        -> R3.3 (regression guard for R3)
 *   Test 4 (viewport-fit=cover meta)         -> R4.1
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
        // CSSStyleRule.type === 1
        if (rule.type !== 1) continue;
        if (rule.selectorText === sel) {
          return rule.cssText;
        }
      }
    }
    return null;
  }, selector);
}

/**
 * Find the @media (max-width: 768px) block(s) and collect cssText of any
 * inner CSSStyleRule whose selectorText references either
 * `#itemModal .modal-content .modal-header` or `#viewItemModal .modal-header`.
 *
 * Returns the concatenated cssText of all matching inner rules (so the
 * implementation may land as one compound selector list OR two separate
 * rules — both shapes pass).
 */
async function collectMobileHeaderRuleText(page) {
  return page.evaluate(() => {
    const TARGETS = ["#itemModal .modal-content .modal-header", "#viewItemModal .modal-header"];
    const matches = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let topRules;
      try {
        topRules = sheet.cssRules;
      } catch (_e) {
        continue;
      }
      if (!topRules) continue;
      for (const rule of Array.from(topRules)) {
        // CSSMediaRule.type === 4
        if (rule.type !== 4) continue;
        const mediaText = (rule.media && rule.media.mediaText) || rule.conditionText || "";
        if (!mediaText.includes("max-width: 768px")) continue;
        const innerRules = rule.cssRules;
        if (!innerRules) continue;
        for (const inner of Array.from(innerRules)) {
          if (inner.type !== 1) continue;
          const sel = inner.selectorText || "";
          // Selector may be a compound list ("#itemModal ..., #viewItemModal ...")
          // OR a single-target rule. Match either by substring.
          const hits = TARGETS.some((t) => sel.includes(t));
          if (hits) {
            matches.push(inner.cssText);
          }
        }
      }
    }
    return matches.length === 0 ? null : matches.join("\n");
  });
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
  // Test 3 — mobile fullscreen header padding-top uses env(safe-area-inset-top)
  // Maps to R3.3 (no-regression guard for R3.1–R3.2 on real devices)
  // ========================================================================
  test("mobile-fullscreen-header-uses-env-safe-area-inset-top", async ({ page }) => {
    await seedInventory(page, [BASE_ITEM]);
    await gotoApp(page);

    const concatenatedCssText = await collectMobileHeaderRuleText(page);

    expect(
      concatenatedCssText,
      "Inside @media (max-width: 768px), at least one CSSStyleRule must target '#itemModal .modal-content .modal-header' and/or '#viewItemModal .modal-header'"
    ).not.toBeNull();
    expect(
      concatenatedCssText,
      "Mobile fullscreen header rule(s) must declare 'padding-top'"
    ).toContain("padding-top");
    expect(
      concatenatedCssText,
      "Mobile fullscreen header rule(s) must reference 'env(safe-area-inset-top'"
    ).toContain("env(safe-area-inset-top");
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

// @ts-check
/**
 * Playwright test suite — STRK-48 valuation premium display.
 *
 * Coverage:
 *  T1–T5:  lookupHistoricalSpot() — exact match, weekend fallback, null date,
 *          unsupported metal, case-insensitive metal name.
 *  T6–T8:  computeItemValuation() — item.price is always per-unit; pricingType
 *          does not affect purchasePrice. Covers lot, each, and legacy (missing).
 *  T9–T15: Valuation section DOM — cell counts, premium %, G/L %, sign classes,
 *          missing-spot fallback to "—" / .muted.
 *  T16–T17: .six-col grid column count — desktop 6-col, mobile 3-col.
 *  T18–T19: Diff scoping — only expected runtime files changed, no new
 *           localStorage keys introduced.
 */

import { test, expect } from "./helpers/mocks/extended-test.js";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
// tests/playwright → ../../ = repo root
const REPO_ROOT = path.resolve(path.dirname(__filename), "../../");

// =============================================================================
// Fixture items
// =============================================================================
//
// Dates 2030+ are beyond the spot-history bundle (1968–2026-05-17), so
// lookupHistoricalSpot returns null for these items. resolvedSpot falls back
// to item.spotPriceAtPurchase, giving deterministic test values independent
// of live bundle content.

/** Single 1-oz pure-Gold coin with a positive premium and positive G/L. */
const SINGLE_GOLD = {
  uuid: "strk48-test-single-gold",
  metal: "Gold",
  composition: "Gold",
  name: "STRK-48 Single Gold Eagle",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  purity: 1.0, // pure → asw = 1.0 oz, making premium math exact
  price: 2100, // purchasePrice = 2100
  pricingType: "each",
  spotPriceAtPurchase: 2000, // resolvedSpot = 2000 → premium = +5.0 %
  marketValue: 2200, // manual retail → retailTotal = 2200 → G/L = +$100 ≈ +4.8 %
  date: "2030-01-15",
  purchaseLocation: "APMEX",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2024",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  premiumPerOz: 100,
  totalPremium: 100,
  numistaId: "",
  serial: 1,
};

/** Silver lot — qty=5 bought as a lot, no manual market and no stored spot. */
const LOT_SILVER = {
  uuid: "strk48-test-lot-silver",
  metal: "Silver",
  composition: "Silver",
  name: "STRK-48 Silver Lot",
  qty: 5,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  purity: 0.999,
  price: 150, // per-unit price (form already converted at save time)
  pricingType: "lot",
  spotPriceAtPurchase: 0, // no stored spot → premium = null → "—"
  marketValue: 0, // no manual retail → retailTotal = meltValue = 0 (no live spot)
  date: "2030-01-15",
  purchaseLocation: "SD Bullion",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2024",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  premiumPerOz: 0,
  totalPremium: 0,
  numistaId: "",
  serial: 2,
};

/** Single Gold coin bought below spot — negative premium → .loss class. */
const NEG_PREMIUM = {
  uuid: "strk48-test-neg-premium",
  metal: "Gold",
  composition: "Gold",
  name: "STRK-48 Negative Premium Coin",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  purity: 1.0,
  price: 2800, // purchasePrice = 2800
  pricingType: "each",
  spotPriceAtPurchase: 3000, // spot = 3000 → premium = (2800/3000−1)×100 = −6.7 %
  marketValue: 2900,
  date: "2030-01-15",
  purchaseLocation: "LCS",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2023",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  premiumPerOz: -200,
  totalPremium: -200,
  numistaId: "",
  serial: 3,
};

/**
 * Gold coin with zero ASW (weight=0) and no stored spot — both conditions
 * needed to show "—" for Premium AND G/L%.
 *
 * Premium="—" requires resolvedSpot=null OR asw=0. With weight=0, asw=0 → null.
 * G/L%="—" requires retailTotal=0. meltValue = 0*spot*purity = 0, and with no
 * manual marketValue, retailTotal = meltValue = 0 regardless of live spot price
 * (the mock API always returns a non-zero default; weight=0 neutralises it).
 */
const NO_SPOT = {
  uuid: "strk48-test-no-spot",
  metal: "Gold",
  composition: "Gold",
  name: "STRK-48 No Spot Coin",
  qty: 1,
  type: "Coin",
  weight: 0, // zero weight → asw=0 → meltValue=0 → retailTotal=0 → G/L%="—"
  weightUnit: "oz",
  purity: 0.9167,
  price: 1800,
  pricingType: "each",
  spotPriceAtPurchase: 0, // no stored spot → resolvedSpot=null → premium="—"
  marketValue: 0, // no manual retail
  date: "2031-06-15", // beyond bundle AND distinct year from 2030 items
  purchaseLocation: "Unknown",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2022",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  premiumPerOz: 0,
  totalPremium: 0,
  numistaId: "",
  serial: 4,
};

// Full render fixture list (indices: 0=SINGLE_GOLD, 1=LOT_SILVER, 2=NEG_PREMIUM, 3=NO_SPOT)
const RENDER_ITEMS = [SINGLE_GOLD, LOT_SILVER, NEG_PREMIUM, NO_SPOT];

// =============================================================================
// Helpers
// =============================================================================

/**
 * Seed inventory into localStorage before page load and suppress the
 * What's New popup by pre-setting ackVersion = APP_VERSION at DOMContentLoaded.
 */
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

/**
 * Navigate to the app and wait for the core globals needed by these tests.
 * window.historicalDataCache is set synchronously by spot.js before defer
 * scripts run, so it's always available after DOMContentLoaded.
 */
async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.lookupHistoricalSpot === "function" &&
      typeof window.computeItemValuation === "function" &&
      typeof window.showViewModal === "function" &&
      typeof window._loadSpotSeedBundle === "function" &&
      Array.isArray(window.inventory) &&
      window.inventory.length > 0
  );
}

async function openViewModal(page, index = 0) {
  await page.evaluate((idx) => window.showViewModal(idx), index);
  await expect(page.locator("#viewItemModal")).toBeVisible();
}

// =============================================================================
// T1–T5 — lookupHistoricalSpot()
// =============================================================================

test.describe("STRK-48 — spot lookup", () => {
  test.beforeEach(async ({ page }) => {
    await seedInventory(page, [SINGLE_GOLD]);
    await gotoApp(page);
    // Inject synthetic spot data for 2035 — not in the bundle — so tests are
    // independent of real LBMA data. _loadSpotSeedBundle skips if the year
    // already has cache entries, and 2035 will never be in the bundle.
    await page.evaluate(() => {
      window._loadSpotSeedBundle({
        2035: {
          Gold: [
            ["01-16", 3200], // Wednesday — only entry for this year
          ],
          Silver: [["01-16", 34.5]],
        },
      });
    });
  });

  test("T1: exact date returns correct spot for a supported metal", async ({ page }) => {
    // 2035-01-16 is the only entry; exact match → window 0.
    const result = await page.evaluate(() => window.lookupHistoricalSpot("Gold", "2035-01-16"));
    expect(result).toBe(3200);
  });

  test("T2: date with no exact entry falls back to nearest trading day (≤3 days)", async ({
    page,
  }) => {
    // 2035-01-13 is 3 days before 2035-01-16. Window 0 (exact) and window 1
    // (±1 day) both miss; window 3 (±3 days) catches the Monday entry.
    const result = await page.evaluate(() => window.lookupHistoricalSpot("Gold", "2035-01-13"));
    expect(result).toBe(3200);
  });

  test("T3: null / missing date returns null", async ({ page }) => {
    const result = await page.evaluate(() => window.lookupHistoricalSpot("Gold", null));
    expect(result).toBeNull();
  });

  test("T4: unsupported metal (Alloy) returns null", async ({ page }) => {
    const result = await page.evaluate(() => window.lookupHistoricalSpot("Alloy", "2035-01-16"));
    expect(result).toBeNull();
  });

  test("T5: lowercase metal name is normalised — gold → Gold lookup succeeds", async ({ page }) => {
    const result = await page.evaluate(() => window.lookupHistoricalSpot("gold", "2035-01-16"));
    expect(result).toBe(3200);
  });
});

// =============================================================================
// T6–T8 — computeItemValuation() purchasePrice derivation
//
// item.price is ALWAYS stored as per-unit — the Add/Edit form converts a lot
// total → per-unit at save time. pricingType is a UI display flag only and
// must NOT affect the purchase price calculation.
// =============================================================================

test.describe("STRK-48 — pricingType purchasePrice derivation", () => {
  test.beforeEach(async ({ page }) => {
    await seedInventory(page, [SINGLE_GOLD]);
    await gotoApp(page);
  });

  test("T6: pricingType 'lot' — purchasePrice equals item.price (per-unit, no division)", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const item = {
        qty: 3,
        price: 100, // already per-unit — the form converted at save time
        pricingType: "lot",
        weight: 1,
        weightUnit: "oz",
        purity: 0.999,
        marketValue: 0,
      };
      const { purchasePrice, purchaseTotal } = window.computeItemValuation(item, 0);
      return { purchasePrice, purchaseTotal };
    });
    expect(result.purchasePrice).toBeCloseTo(100, 5);
    expect(result.purchaseTotal).toBeCloseTo(300, 5); // 100 × 3
  });

  test("T7: pricingType 'each' — purchasePrice equals item.price (same result as lot)", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const item = {
        qty: 3,
        price: 100,
        pricingType: "each",
        weight: 1,
        weightUnit: "oz",
        purity: 0.999,
        marketValue: 0,
      };
      const { purchasePrice, purchaseTotal } = window.computeItemValuation(item, 0);
      return { purchasePrice, purchaseTotal };
    });
    expect(result.purchasePrice).toBeCloseTo(100, 5);
    expect(result.purchaseTotal).toBeCloseTo(300, 5); // 100 × 3
  });

  test("T8: missing pricingType (legacy) — purchasePrice equals item.price", async ({ page }) => {
    const result = await page.evaluate(() => {
      const item = {
        qty: 3,
        price: 100,
        // no pricingType field — legacy item
        weight: 1,
        weightUnit: "oz",
        purity: 0.999,
        marketValue: 0,
      };
      const { purchasePrice, purchaseTotal } = window.computeItemValuation(item, 0);
      return { purchasePrice, purchaseTotal };
    });
    expect(result.purchasePrice).toBeCloseTo(100, 5);
    expect(result.purchaseTotal).toBeCloseTo(300, 5); // 100 × 3
  });
});

// =============================================================================
// T9–T15 — Valuation section DOM rendering
// =============================================================================

test.describe("STRK-48 — valuation section rendering", () => {
  test.beforeEach(async ({ page }) => {
    await seedInventory(page, RENDER_ITEMS);
    await gotoApp(page);
  });

  // Selector for cells within the valuation section's six-column grid
  const valuationCells = (page) =>
    page.locator(
      "#viewItemModal .view-valuation-section .view-detail-grid.six-col .view-detail-item"
    );

  test("T9: single item (qty=1) has exactly 6 grid cells", async ({ page }) => {
    await openViewModal(page, 0); // SINGLE_GOLD — qty=1
    await expect(valuationCells(page)).toHaveCount(6);
  });

  test("T10: lot item (qty>1) has 12 grid cells (total row + per-unit row)", async ({ page }) => {
    await openViewModal(page, 1); // LOT_SILVER — qty=5
    await expect(valuationCells(page)).toHaveCount(12);
  });

  test("T11: Premium cell shows a percentage string with a sign (+/−)", async ({ page }) => {
    // SINGLE_GOLD: spotPriceAtPurchase=2000, price=2100 → +5.0 %
    await openViewModal(page, 0);
    const premiumValue = page.locator(
      "#viewItemModal .view-valuation-section .view-detail-grid.six-col " +
        ".view-detail-item:nth-child(2) .view-detail-value"
    );
    await expect(premiumValue).toHaveText(/^[+\-]\d+\.\d+%$/);
  });

  test("T12: G/L% cell shows a percentage string with a sign (+/−)", async ({ page }) => {
    // SINGLE_GOLD: retailTotal=2200 > purchaseTotal=2100 → positive G/L%
    await openViewModal(page, 0);
    const glValue = page.locator(
      "#viewItemModal .view-valuation-section .view-detail-grid.six-col " +
        ".view-detail-item:nth-child(6) .view-detail-value"
    );
    await expect(glValue).toHaveText(/^[+\-]\d+\.\d+%$/);
  });

  test("T13: negative premium applies .loss class to the Premium value span", async ({ page }) => {
    // NEG_PREMIUM: price=2800, spot=3000 → premium ≈ −6.7 % → .loss
    await openViewModal(page, 2);
    const lossSpan = page.locator(
      "#viewItemModal .view-valuation-section .view-detail-grid.six-col " +
        ".view-detail-item:nth-child(2) .view-detail-value.loss"
    );
    await expect(lossSpan).toBeVisible();
    await expect(lossSpan).toHaveText(/^-\d+\.\d+%$/);
  });

  test("T14: positive gain/loss applies .gain class to Gain/Loss and G/L% value spans", async ({
    page,
  }) => {
    // SINGLE_GOLD: retailTotal=2200, purchaseTotal=2100 → G/L = +$100, G/L% = +4.8 %
    await openViewModal(page, 0);
    const valSection = page.locator(
      "#viewItemModal .view-valuation-section .view-detail-grid.six-col"
    );
    // Both Gain/Loss (cell 5) and G/L% (cell 6) should carry .gain
    await expect(valSection.locator(".view-detail-value.gain")).toHaveCount(3);
    // Premium (.gain) + Gain/Loss (.gain) + G/L% (.gain) = 3 gain spans
  });

  test("T15: missing spot and ASW shows '—' with .muted on Premium and G/L%", async ({ page }) => {
    // NO_SPOT: spotPriceAtPurchase=0, no marketValue, future date → resolvedSpot=null
    await openViewModal(page, 3);
    const premiumValue = page.locator(
      "#viewItemModal .view-valuation-section .view-detail-grid.six-col " +
        ".view-detail-item:nth-child(2) .view-detail-value"
    );
    const glValue = page.locator(
      "#viewItemModal .view-valuation-section .view-detail-grid.six-col " +
        ".view-detail-item:nth-child(6) .view-detail-value"
    );
    await expect(premiumValue).toHaveText("—");
    await expect(premiumValue).toHaveClass(/muted/);
    await expect(glValue).toHaveText("—");
    await expect(glValue).toHaveClass(/muted/);
  });
});

// =============================================================================
// T16–T17 — .six-col grid layout (computed column count)
// =============================================================================

test.describe("STRK-48 — six-col layout breakpoints", () => {
  async function getValuationGridColCount(page) {
    const grid = page.locator("#viewItemModal .view-valuation-section .view-detail-grid.six-col");
    await expect(grid).toBeVisible();
    return grid.evaluate((el) => {
      const cols = window.getComputedStyle(el).gridTemplateColumns;
      // Computed value is space-separated pixel widths, one per track.
      return cols.trim().split(/\s+/).length;
    });
  }

  test("T16: desktop viewport (1280px) → .six-col has 6 columns", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedInventory(page, [SINGLE_GOLD]);
    await gotoApp(page);
    await openViewModal(page, 0);
    const colCount = await getValuationGridColCount(page);
    expect(colCount).toBe(6);
  });

  test("T17: mobile viewport (375px) → .six-col collapses to 3 columns", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await seedInventory(page, [SINGLE_GOLD]);
    await gotoApp(page);
    await openViewModal(page, 0);
    const colCount = await getValuationGridColCount(page);
    expect(colCount).toBe(3);
  });
});

// =============================================================================
// T18–T19 — Diff scoping verification (code review, no browser needed)
// =============================================================================

test.describe("STRK-48 — diff scoping", () => {
  test("T18: diff vs origin/dev touches only expected runtime files", () => {
    const out = execSync("git diff origin/dev --name-only", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    const changed = out.split("\n").filter(Boolean);

    // sw.js is auto-stamped by the stamp-sw-cache pre-commit hook; it is not a
    // hand-edited runtime file but appears in every diff that touches JS/CSS.
    const allowed = new Set([
      "js/viewModal.js",
      "js/spot.js",
      "js/utils.js",
      "js/filters.js",
      "css/styles.css",
      "sw.js",
      "tests/playwright/view-modal-valuation.spec.js",
    ]);

    const unexpected = changed.filter((f) => !allowed.has(f));
    expect(unexpected, `Unexpected files in diff: ${unexpected.join(", ")}`).toHaveLength(0);
  });

  test("T19: diff introduces no new localStorage keys or ALLOWED_STORAGE_KEYS changes", () => {
    const diff = execSync("git diff origin/dev -- js/viewModal.js js/spot.js js/utils.js", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });

    // Added lines (excluding diff headers) that touch storage key machinery
    const addedLines = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));

    const storageChanges = addedLines.filter((l) => /ALLOWED_STORAGE_KEYS|saveData\s*\(/.test(l));

    expect(
      storageChanges,
      `Diff must not add storage key references:\n${storageChanges.join("\n")}`
    ).toHaveLength(0);
  });
});
